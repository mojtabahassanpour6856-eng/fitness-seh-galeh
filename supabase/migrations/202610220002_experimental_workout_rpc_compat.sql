-- Compatibility layer for the isolated planner's RPC contract.
-- Apply only to a disposable Supabase branch after migration 202610220001.
-- This migration is not deployed to production.
create or replace function public.experimental_workout_snapshot(p_trainee_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_plan_count integer := 0;
  v_plan_id bigint := null;
  v_plan jsonb := null;
  v_exercises jsonb := '[]'::jsonb;
  v_fingerprint text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not coalesce(private.is_coach(), false)
     or not private.can_access_trainee(p_trainee_id) then
    raise exception 'Not authorized for trainee' using errcode = '42501';
  end if;

  select count(*)::integer into v_plan_count
    from public.trainee_workout_plans p
   where p.trainee_id = p_trainee_id;

  if v_plan_count = 1 then
    select p.id,
           jsonb_build_object(
             'trainee_id', p.trainee_id,
             'title', p.title,
             'plan_date', p.plan_date,
             'goal', p.goal,
             'notes', p.notes
           )
      into v_plan_id, v_plan
      from public.trainee_workout_plans p
     where p.trainee_id = p_trainee_id
     order by p.plan_date desc nulls last, p.id desc
     limit 1;

    select coalesce(jsonb_agg(jsonb_build_object(
      'exercise_id', e.exercise_id,
      'sets', e.sets,
      'reps', e.reps,
      'rest_seconds', e.rest_seconds,
      'notes', e.notes,
      'sort_order', e.sort_order,
      'training_system', e.training_system,
      'group_key', e.group_key,
      'training_day', e.training_day,
      'is_completed', e.is_completed
    ) order by e.sort_order, e.id), '[]'::jsonb)
      into v_exercises
      from public.trainee_workout_exercises e
     where e.workout_plan_id = v_plan_id;
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'plan_id', v_plan_id,
    'plan_count', v_plan_count,
    'plan', v_plan,
    'exercises', v_exercises
  )::text);

  return jsonb_build_object(
    'plan_id', v_plan_id,
    'plan_count', v_plan_count,
    'plan', v_plan,
    'exercises', v_exercises,
    'fingerprint', v_fingerprint
  );
end;
$function$;

create or replace function public.experimental_save_trainee_workout(
  p_trainee_id uuid,
  p_expected_plan_id bigint,
  p_expected_fingerprint text,
  p_plan jsonb,
  p_exercises jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_current jsonb;
  v_saved jsonb;
  v_plan jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not coalesce(private.is_coach(), false)
     or not private.can_access_trainee(p_trainee_id) then
    raise exception 'Not authorized for trainee' using errcode = '42501';
  end if;
  if jsonb_typeof(p_plan) <> 'object'
     or jsonb_typeof(p_exercises) <> 'array'
     or p_expected_fingerprint is null then
    raise exception 'Invalid workout save payload' using errcode = '22023';
  end if;

  -- Serialize writes for this trainee before checking the baseline.
  perform pg_advisory_xact_lock(hashtextextended(p_trainee_id::text, 0));
  v_current := public.experimental_workout_snapshot(p_trainee_id);

  if (v_current->>'plan_count')::integer > 1 then
    raise exception 'Multiple workout plans require manual review' using errcode = '22023';
  end if;
  if (v_current->>'plan_id') is distinct from p_expected_plan_id::text
     or v_current->>'fingerprint' is distinct from p_expected_fingerprint then
    raise exception 'Workout changed since it was opened' using errcode = '40001';
  end if;

  v_plan := p_plan || jsonb_build_object('trainee_id', p_trainee_id);
  v_saved := public.save_trainee_workout_plan_atomic(
    p_expected_plan_id,
    v_plan,
    p_exercises
  );
  return v_saved;
end;
$function$;

revoke all on function public.experimental_workout_snapshot(uuid) from public;
revoke all on function public.experimental_workout_snapshot(uuid) from anon;
grant execute on function public.experimental_workout_snapshot(uuid) to authenticated;

revoke all on function public.experimental_save_trainee_workout(uuid, bigint, text, jsonb, jsonb) from public;
revoke all on function public.experimental_save_trainee_workout(uuid, bigint, text, jsonb, jsonb) from anon;
grant execute on function public.experimental_save_trainee_workout(uuid, bigint, text, jsonb, jsonb) to authenticated;
