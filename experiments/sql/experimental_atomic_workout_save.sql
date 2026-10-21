-- EXPERIMENT ONLY. Do not apply to the production project until reviewed and tested
-- against a disposable database with the exact production schema and RLS policies.
-- Atomic save-and-replace for the experimental coach workout editor.
begin;

create or replace function public.experimental_workout_snapshot(p_trainee_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan_count integer;
  v_plan jsonb;
  v_plan_id bigint;
  v_exercises jsonb;
  v_fingerprint text;
begin
  if auth.uid() is null or not private.is_coach()
     or not private.can_access_trainee(p_trainee_id) then
    raise exception 'not authorized to access this trainee workout' using errcode = '42501';
  end if;

  select count(*) into v_plan_count
  from public.trainee_workout_plans p
  where p.trainee_id = p_trainee_id;

  if v_plan_count > 1 then
    raise exception 'multiple workout plans found; manual review required' using errcode = 'P0001';
  end if;

  select to_jsonb(p), p.id
    into v_plan, v_plan_id
  from public.trainee_workout_plans p
  where p.trainee_id = p_trainee_id
  order by p.plan_date desc nulls last, p.created_at desc
  limit 1;

  if v_plan_id is null then
    v_exercises := '[]'::jsonb;
    v_fingerprint := md5(jsonb_build_object('plan', null, 'exercises', v_exercises)::text);
  else
    select coalesce(jsonb_agg(to_jsonb(e) order by e.sort_order, e.id), '[]'::jsonb)
      into v_exercises
    from public.trainee_workout_exercises e
    where e.workout_plan_id = v_plan_id;
    v_fingerprint := md5(jsonb_build_object('plan', v_plan, 'exercises', v_exercises)::text);
  end if;

  return jsonb_build_object(
    'plan_id', v_plan_id,
    'plan_count', v_plan_count,
    'fingerprint', v_fingerprint
  );
end;
$$;

create or replace function public.experimental_save_trainee_workout(
  p_trainee_id uuid,
  p_expected_plan_id bigint,
  p_expected_fingerprint text,
  p_plan jsonb,
  p_exercises jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan_count integer;
  v_plan jsonb;
  v_plan_id bigint;
  v_old_plan jsonb;
  v_old_exercises jsonb;
  v_fingerprint text;
  v_new_id bigint;
  v_count integer;
  v_has_duplicate_order boolean;
begin
  if auth.uid() is null or not private.is_coach()
     or not private.can_access_trainee(p_trainee_id) then
    raise exception 'not authorized to modify this trainee workout' using errcode = '42501';
  end if;

  if p_plan is null or jsonb_typeof(p_plan) <> 'object'
     or p_exercises is null or jsonb_typeof(p_exercises) <> 'array' then
    raise exception 'invalid plan or exercise payload' using errcode = '22023';
  end if;

  v_count := jsonb_array_length(p_exercises);
  if v_count < 1 or v_count > 200 then
    raise exception 'exercise count must be between 1 and 200' using errcode = '22023';
  end if;

  -- Serializes saves for the same trainee, including the no-existing-plan case.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_trainee_id::text, 0)
  );

  select count(*) into v_plan_count
  from public.trainee_workout_plans p
  where p.trainee_id = p_trainee_id;

  if v_plan_count > 1 then
    raise exception 'multiple workout plans found; manual review required' using errcode = 'P0001';
  end if;

  select to_jsonb(p), p.id
    into v_old_plan, v_plan_id
  from public.trainee_workout_plans p
  where p.trainee_id = p_trainee_id
  order by p.plan_date desc nulls last, p.created_at desc
  limit 1;

  if v_plan_id is null then
    v_old_exercises := '[]'::jsonb;
    v_fingerprint := md5(jsonb_build_object('plan', null, 'exercises', v_old_exercises)::text);
  else
    select coalesce(jsonb_agg(to_jsonb(e) order by e.sort_order, e.id), '[]'::jsonb)
      into v_old_exercises
    from public.trainee_workout_exercises e
    where e.workout_plan_id = v_plan_id;
    v_fingerprint := md5(jsonb_build_object('plan', v_old_plan, 'exercises', v_old_exercises)::text);
  end if;

  if v_plan_id is distinct from p_expected_plan_id
     or v_fingerprint is distinct from p_expected_fingerprint then
    raise exception 'workout changed since it was opened; reload before saving' using errcode = '40001';
  end if;

  -- Validate every exercise reference and sort order before changing anything.
  if exists (
    select 1
    from jsonb_to_recordset(p_exercises) as x(
      exercise_id bigint, sets integer, reps text, rest_seconds integer,
      notes text, sort_order integer, training_system text, group_key text,
      training_day text, is_completed boolean
    )
    left join public.exercises e on e.id = x.exercise_id
    where e.id is null
       or x.sort_order is null or x.sort_order < 1
       or x.sets is null or x.sets < 0
       or x.rest_seconds is null or x.rest_seconds < 0
       or x.training_system not in ('normal','superset','triset','giant','drop-set')
  ) then
    raise exception 'invalid exercise row or unknown exercise id' using errcode = '22023';
  end if;

  select exists (
    select 1
    from (
      select (value->>'sort_order')::integer as sort_order
      from jsonb_array_elements(p_exercises)
    ) s
    group by sort_order
    having count(*) > 1
  ) into v_has_duplicate_order;

  if v_has_duplicate_order then
    raise exception 'duplicate exercise sort order' using errcode = '22023';
  end if;

  if v_plan_id is null then
    insert into public.trainee_workout_plans(trainee_id, title, goal, notes, plan_date)
    values (
      p_trainee_id,
      coalesce(nullif(btrim(p_plan->>'title'), ''), 'برنامه تمرینی'),
      nullif(btrim(p_plan->>'goal'), ''),
      nullif(btrim(p_plan->>'notes'), ''),
      nullif(p_plan->>'plan_date', '')::date
    )
    returning id into v_new_id;
  else
    update public.trainee_workout_plans
    set title = coalesce(nullif(btrim(p_plan->>'title'), ''), 'برنامه تمرینی'),
        goal = nullif(btrim(p_plan->>'goal'), ''),
        notes = nullif(btrim(p_plan->>'notes'), ''),
        plan_date = nullif(p_plan->>'plan_date', '')::date
    where id = v_plan_id and trainee_id = p_trainee_id
    returning id into v_new_id;

    if v_new_id is null then
      raise exception 'workout plan was not updated' using errcode = 'P0001';
    end if;

    delete from public.trainee_workout_exercises where workout_plan_id = v_new_id;
  end if;

  insert into public.trainee_workout_exercises(
    workout_plan_id, exercise_id, sets, reps, rest_seconds, notes,
    sort_order, training_system, group_key, training_day, is_completed
  )
  select v_new_id, x.exercise_id, x.sets, x.reps, x.rest_seconds, x.notes,
         x.sort_order, x.training_system, x.group_key, x.training_day,
         coalesce(x.is_completed, false)
  from jsonb_to_recordset(p_exercises) as x(
    exercise_id bigint, sets integer, reps text, rest_seconds integer,
    notes text, sort_order integer, training_system text, group_key text,
    training_day text, is_completed boolean
  );

  -- Any failure above aborts the entire PostgreSQL transaction, restoring old rows.
  return jsonb_build_object('plan_id', v_new_id, 'exercise_count', v_count);
end;
$$;

revoke all on function public.experimental_workout_snapshot(uuid) from public, anon;
revoke all on function public.experimental_save_trainee_workout(uuid, bigint, text, jsonb, jsonb) from public, anon;
grant execute on function public.experimental_workout_snapshot(uuid) to authenticated;
grant execute on function public.experimental_save_trainee_workout(uuid, bigint, text, jsonb, jsonb) to authenticated;

commit;
