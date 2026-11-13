-- Atomic, idempotent trainee progress submission.
-- SECURITY INVOKER preserves the caller's existing RLS policies.
create or replace function public.record_trainee_progress(
  p_trainee_id uuid,
  p_log_date date,
  p_weight numeric,
  p_waist numeric default null,
  p_chest numeric default null,
  p_hip numeric default null,
  p_abdomen numeric default null,
  p_thigh numeric default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $function$
declare
  v_weight_exists boolean;
  v_manual_exists boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_trainee_id is null or p_log_date is null or p_weight is null or p_weight <= 0 then
    raise exception 'Valid trainee, date and weight are required' using errcode = '22023';
  end if;
  if private.is_coach() then
    raise exception 'Only the trainee can submit manual progress' using errcode = '42501';
  end if;
  if not private.can_access_trainee(p_trainee_id) then
    raise exception 'You cannot access this trainee record' using errcode = '42501';
  end if;

  -- Serialize concurrent retries for the same trainee/date/weight tuple.
  perform pg_advisory_xact_lock(
    hashtextextended(p_trainee_id::text || '|' || p_log_date::text || '|' || round(p_weight, 2)::text, 0)
  );

  select exists (
    select 1 from public.weight_logs
    where trainee_id = p_trainee_id and log_date = p_log_date and weight = p_weight
  ) into v_weight_exists;

  select exists (
    select 1 from public.body_analyses
    where trainee_id = p_trainee_id
      and analysis_date = p_log_date
      and weight = p_weight
      and coalesce(notes, '') like '%MANUAL_PROGRESS_ENTRY%'
  ) into v_manual_exists;

  -- If a previous client-side attempt was interrupted, fill only its missing half.
  if not v_weight_exists then
    insert into public.weight_logs (trainee_id, log_date, weight)
    values (p_trainee_id, p_log_date, p_weight);
  end if;

  if not v_manual_exists then
    insert into public.body_analyses
      (trainee_id, analysis_date, weight, waist, chest, hip, abdomen, thigh, notes)
    values
      (p_trainee_id, p_log_date, p_weight, p_waist, p_chest, p_hip, p_abdomen, p_thigh,
       'MANUAL_PROGRESS_ENTRY: ثبت دستی و تأییدشده توسط شاگرد');
  end if;

  return jsonb_build_object(
    'success', true,
    'duplicate', v_weight_exists and v_manual_exists,
    'weight_log_created', not v_weight_exists,
    'manual_progress_created', not v_manual_exists
  );
end;
$function$;

revoke all on function public.record_trainee_progress(uuid,date,numeric,numeric,numeric,numeric,numeric,numeric) from public;
revoke all on function public.record_trainee_progress(uuid,date,numeric,numeric,numeric,numeric,numeric,numeric) from anon;
grant execute on function public.record_trainee_progress(uuid,date,numeric,numeric,numeric,numeric,numeric,numeric) to authenticated;
