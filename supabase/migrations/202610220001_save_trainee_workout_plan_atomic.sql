-- Atomic full workout-plan save for the coach editor.
-- Apply ONLY to an isolated Supabase development branch first.
create or replace function public.save_trainee_workout_plan_atomic(
  p_plan_id bigint,
  p_plan jsonb,
  p_exercises jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_trainee_id uuid;
  v_plan_id bigint;
  v_item jsonb;
  v_inserted integer := 0;
  v_expected integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not coalesce(private.is_coach(), false) then
    raise exception 'Coach role required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_plan) <> 'object' then
    raise exception 'Plan must be a JSON object' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_exercises, 'null'::jsonb)) <> 'array' then
    raise exception 'Exercises must be a JSON array' using errcode = '22023';
  end if;

  begin
    v_trainee_id := (p_plan->>'trainee_id')::uuid;
  exception when others then
    raise exception 'Valid trainee_id is required' using errcode = '22023';
  end;

  if not private.can_access_trainee(v_trainee_id) then
    raise exception 'Coach cannot access this trainee' using errcode = '42501';
  end if;

  v_expected := jsonb_array_length(p_exercises);
  if v_expected > 120 then
    raise exception 'Too many exercises in one plan (max 120)' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_plan->>'title','')), '') is null then
    raise exception 'Plan title is required' using errcode = '22023';
  end if;
  if nullif(p_plan->>'plan_date','') is not null then
    perform (p_plan->>'plan_date')::date;
  end if;

  if p_plan_id is null then
    insert into public.trainee_workout_plans
      (id, trainee_id, title, plan_date, goal, notes)
    values
      (nextval('public.trainee_workout_plans_id_seq'::regclass), v_trainee_id,
       btrim(p_plan->>'title'),
       nullif(p_plan->>'plan_date','')::date,
       nullif(p_plan->>'goal',''),
       nullif(p_plan->>'notes',''))
    returning id into v_plan_id;
  else
    update public.trainee_workout_plans
       set title = btrim(p_plan->>'title'),
           plan_date = nullif(p_plan->>'plan_date','')::date,
           goal = nullif(p_plan->>'goal',''),
           notes = nullif(p_plan->>'notes','')
     where id = p_plan_id
       and trainee_id = v_trainee_id
       and private.can_access_trainee(trainee_id);

    if not found then
      raise exception 'Plan not found for this trainee or access denied' using errcode = '42501';
    end if;
    v_plan_id := p_plan_id;
  end if;

  -- Replace the complete exercise list within the same transaction.
  -- Any invalid exercise/FK/field causes the header update and deletes to roll back.
  delete from public.trainee_workout_exercises
   where workout_plan_id = v_plan_id;

  for v_item in select value from jsonb_array_elements(p_exercises)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each exercise must be a JSON object' using errcode = '22023';
    end if;
    if nullif(v_item->>'exercise_id','') is null then
      raise exception 'Every exercise needs exercise_id' using errcode = '22023';
    end if;

    insert into public.trainee_workout_exercises
      (id, workout_plan_id, exercise_id, sets, reps, rest_seconds, notes,
       sort_order, training_system, group_key, training_day, is_completed)
    values
      (nextval('public.trainee_workout_exercises_id_seq'::regclass),
       v_plan_id,
       (v_item->>'exercise_id')::bigint,
       coalesce(nullif(v_item->>'sets','')::integer, 0),
       nullif(v_item->>'reps',''),
       coalesce(nullif(v_item->>'rest_seconds','')::integer, 0),
       nullif(v_item->>'notes',''),
       coalesce(nullif(v_item->>'sort_order','')::integer, v_inserted + 1),
       coalesce(nullif(v_item->>'training_system',''), 'normal'),
       case when coalesce(nullif(v_item->>'training_system',''), 'normal') = 'normal'
            then null else nullif(v_item->>'group_key','') end,
       nullif(v_item->>'training_day',''),
       coalesce(nullif(v_item->>'is_completed','')::boolean, false));
    v_inserted := v_inserted + 1;
  end loop;

  if v_inserted <> v_expected then
    raise exception 'Exercise count mismatch: expected %, inserted %', v_expected, v_inserted;
  end if;

  return jsonb_build_object(
    'plan_id', v_plan_id,
    'trainee_id', v_trainee_id,
    'exercise_count', v_inserted,
    'plan_date', (select plan_date from public.trainee_workout_plans where id = v_plan_id)
  );
end;
$function$;

revoke all on function public.save_trainee_workout_plan_atomic(bigint, jsonb, jsonb) from public;
revoke all on function public.save_trainee_workout_plan_atomic(bigint, jsonb, jsonb) from anon;
grant execute on function public.save_trainee_workout_plan_atomic(bigint, jsonb, jsonb) to authenticated;
