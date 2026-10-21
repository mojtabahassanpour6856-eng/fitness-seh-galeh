-- DRAFT ONLY: do not run against production until reviewed and approved.
-- Atomic workout-plan save prototype for the isolated editor experiment.
-- SECURITY INVOKER is intentional: RLS and table grants must still apply.
-- Signature changes replace the old four-argument draft overload in a clean migration.
drop function if exists public.save_trainee_workout_plan_transaction(uuid, bigint, jsonb, jsonb, jsonb);
-- One RPC call runs in one PostgreSQL transaction; any raised exception rolls it all back.


create or replace function public.save_trainee_workout_plan_transaction(
  p_trainee_id uuid,
  p_expected_plan_id bigint,
  p_expected_snapshot jsonb,
  p_plan jsonb,
  p_exercises jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_plan public.trainee_workout_plans%rowtype;
  v_existing_count integer;
  v_exercise_count integer;
  v_inserted_count integer;
  v_ids_count integer;
  v_current_snapshot jsonb;
begin
  -- Reject unauthenticated and non-coach callers before touching rows.
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if coalesce(private.is_coach(), false) is not true then
    raise exception 'Coach role required' using errcode = '42501';
  end if;

  if p_trainee_id is null or coalesce(private.can_access_trainee(p_trainee_id), false) is not true then
    raise exception 'Trainee is not accessible to this coach' using errcode = '42501';
  end if;

  if p_plan is null or jsonb_typeof(p_plan) <> 'object' then
    raise exception 'Plan must be a JSON object' using errcode = '22023';
  end if;

  if p_exercises is null or jsonb_typeof(p_exercises) <> 'array' then
    raise exception 'Exercises must be a JSON array' using errcode = '22023';
  end if;

  v_exercise_count := jsonb_array_length(p_exercises);
  if v_exercise_count < 1 or v_exercise_count > 100 then
    raise exception 'Exercise count must be between 1 and 100' using errcode = '22023';
  end if;

  if coalesce(nullif(btrim(p_plan->>'title'), ''), '') = '' then
    raise exception 'Plan title is required' using errcode = '22023';
  end if;

  if coalesce(p_plan->>'plan_date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Plan date must use YYYY-MM-DD' using errcode = '22023';
  end if;

  -- Validate the date string before any write.
  perform (p_plan->>'plan_date')::date;

  -- Serialize saves for the same trainee, including first-plan creation.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_trainee_id::text, 0)
  );

  select count(*)::integer
    into v_existing_count
    from public.trainee_workout_plans p
   where p.trainee_id = p_trainee_id;

  if v_existing_count > 1 then
    raise exception 'Multiple existing workout plans found; manual review required' using errcode = '22023';
  end if;

  if v_existing_count = 0 then
    if p_expected_plan_id is not null then
      raise exception 'Expected existing plan was not found; no changes made' using errcode = '40001';
    end if;
  else
    if p_expected_plan_id is null then
      raise exception 'An existing plan is present; explicit expected plan id is required' using errcode = '40001';
    end if;

    select p.*
      into v_plan
      from public.trainee_workout_plans p
     where p.trainee_id = p_trainee_id
     for update;

    if not found or v_plan.id <> p_expected_plan_id then
      raise exception 'Existing plan changed since preview; reload before saving' using errcode = '40001';
    end if;

    select jsonb_build_object(
      'plan', jsonb_build_object(
        'id', v_plan.id, 'title', v_plan.title,
        'plan_date', to_char(v_plan.plan_date, 'YYYY-MM-DD'),
        'goal', v_plan.goal, 'notes', v_plan.notes
      ),
      'exercises', coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'exercise_id', e.exercise_id, 'sets', e.sets,
        'reps', e.reps, 'rest_seconds', e.rest_seconds, 'notes', e.notes,
        'sort_order', e.sort_order, 'training_system', e.training_system,
        'group_key', e.group_key, 'training_day', e.training_day,
        'is_completed', e.is_completed
      ) order by e.sort_order, e.id), '[]'::jsonb)
    )
    into v_current_snapshot
    from public.trainee_workout_exercises e
    where e.workout_plan_id = v_plan.id;

    if p_expected_snapshot is null or p_expected_snapshot is distinct from v_current_snapshot then
      raise exception 'Plan or exercises changed since preview; reload before saving' using errcode = '40001';
    end if;
  end if;

  -- Validate each proposed exercise row before modifying existing data.
  if exists (
    select 1
      from jsonb_to_recordset(p_exercises) as e(
        exercise_id bigint,
        sets integer,
        reps text,
        rest_seconds integer,
        notes text,
        sort_order integer,
        training_system text,
        group_key text,
        training_day text,
        is_completed boolean
      )
     where e.exercise_id is null
        or e.sets is null or e.sets < 0
        or e.rest_seconds is null or e.rest_seconds < 0
        or e.sort_order is null or e.sort_order < 1
        or coalesce(e.training_system, 'normal') not in ('normal','superset','triset','giant','drop-set')
        or coalesce(btrim(e.training_day), '') = ''
  ) then
    raise exception 'One or more exercise rows are invalid' using errcode = '22023';
  end if;

  if (select count(distinct e.sort_order)
        from jsonb_to_recordset(p_exercises) as e(sort_order integer)) <> v_exercise_count then
    raise exception 'Exercise sort_order values must be unique' using errcode = '22023';
  end if;

  select count(distinct e.exercise_id)::integer
    into v_ids_count
    from jsonb_to_recordset(p_exercises) as e(exercise_id bigint)
    join public.exercises x on x.id = e.exercise_id;

  if v_ids_count <> (
    select count(distinct e.exercise_id)
      from jsonb_to_recordset(p_exercises) as e(exercise_id bigint)
  ) then
    raise exception 'One or more exercise ids are missing from the exercise bank' using errcode = '22023';
  end if;

  -- Insert or replace plan metadata, then replace its exercise rows.
  -- Any error aborts the entire RPC transaction; no compensating deletes needed.
  if v_existing_count = 0 then
    insert into public.trainee_workout_plans
      (trainee_id, title, plan_date, goal, notes)
    values
      (p_trainee_id,
       btrim(p_plan->>'title'),
       (p_plan->>'plan_date')::date,
       nullif(btrim(p_plan->>'goal'), ''),
       nullif(btrim(p_plan->>'notes'), ''))
    returning * into v_plan;
  else
    update public.trainee_workout_plans
       set title = btrim(p_plan->>'title'),
           plan_date = (p_plan->>'plan_date')::date,
           goal = nullif(btrim(p_plan->>'goal'), ''),
           notes = nullif(btrim(p_plan->>'notes'), '')
     where id = v_plan.id
       and trainee_id = p_trainee_id
    returning * into v_plan;

    if not found then
      raise exception 'Plan update did not affect exactly one row' using errcode = '40001';
    end if;

    delete from public.trainee_workout_exercises
     where workout_plan_id = v_plan.id;
  end if;

  insert into public.trainee_workout_exercises
    (workout_plan_id, exercise_id, sets, reps, rest_seconds, notes,
     sort_order, training_system, group_key, training_day, is_completed)
  select v_plan.id,
         e.exercise_id,
         e.sets,
         nullif(btrim(e.reps), ''),
         e.rest_seconds,
         nullif(btrim(e.notes), ''),
         e.sort_order,
         coalesce(nullif(btrim(e.training_system), ''), 'normal'),
         nullif(btrim(e.group_key), ''),
         btrim(e.training_day),
         coalesce(e.is_completed, false)
    from jsonb_to_recordset(p_exercises) as e(
      exercise_id bigint,
      sets integer,
      reps text,
      rest_seconds integer,
      notes text,
      sort_order integer,
      training_system text,
      group_key text,
      training_day text,
      is_completed boolean
    )
   order by e.sort_order;

  get diagnostics v_inserted_count = row_count;
  if v_inserted_count <> v_exercise_count then
    raise exception 'Not all exercise rows were inserted' using errcode = '40001';
  end if;

  select jsonb_build_object(
    'plan', jsonb_build_object(
      'id', v_plan.id, 'title', v_plan.title,
      'plan_date', to_char(v_plan.plan_date, 'YYYY-MM-DD'),
      'goal', v_plan.goal, 'notes', v_plan.notes
    ),
    'exercises', coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'exercise_id', e.exercise_id, 'sets', e.sets,
      'reps', e.reps, 'rest_seconds', e.rest_seconds, 'notes', e.notes,
      'sort_order', e.sort_order, 'training_system', e.training_system,
      'group_key', e.group_key, 'training_day', e.training_day,
      'is_completed', e.is_completed
    ) order by e.sort_order, e.id), '[]'::jsonb)
  )
  into v_current_snapshot
  from public.trainee_workout_exercises e
  where e.workout_plan_id = v_plan.id;

  return jsonb_build_object(
    'plan_id', v_plan.id,
    'trainee_id', v_plan.trainee_id,
    'exercise_count', v_inserted_count,
    'updated_existing_plan', p_expected_plan_id is not null,
    'plan_snapshot', v_current_snapshot
  );
end;
$function$;

-- Keep the RPC callable only by signed-in clients. RLS remains in force because
-- this function is SECURITY INVOKER. Review these grants and schema exposure
-- before deployment; this draft is not applied to the live database.
revoke all on function public.save_trainee_workout_plan_transaction(uuid, bigint, jsonb, jsonb, jsonb) from public;
revoke all on function public.save_trainee_workout_plan_transaction(uuid, bigint, jsonb, jsonb, jsonb) from anon;
grant execute on function public.save_trainee_workout_plan_transaction(uuid, bigint, jsonb, jsonb, jsonb) to authenticated;
