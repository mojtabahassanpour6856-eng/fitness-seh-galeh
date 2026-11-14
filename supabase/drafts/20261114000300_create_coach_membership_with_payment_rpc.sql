-- DRAFT ONLY — DO NOT APPLY TO PRODUCTION.
-- Atomic coach path: create one membership and, when marked paid, exactly
-- one payment linked to the membership returned by this same transaction.
-- Depends on PR #226 draft migration adding trainee_payments.membership_id.

begin;

create schema if not exists private;

create table if not exists private.coach_membership_payment_operations (
  actor_uid uuid not null,
  operation_id uuid not null,
  request_payload jsonb not null,
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (actor_uid, operation_id)
);

revoke all on table private.coach_membership_payment_operations
  from public, anon, authenticated;

create or replace function public.create_coach_membership_with_payment(
  p_trainee_id uuid,
  p_operation_id uuid,
  p_start_date date,
  p_end_date date,
  p_amount numeric,
  p_payment_status text,
  p_payment_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_payload jsonb;
  v_existing_payload jsonb;
  v_result jsonb;
  v_rows integer;
  v_membership_id bigint;
  v_payment_id bigint;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_trainee_id is null or p_operation_id is null
     or p_start_date is null or p_amount is null
     or p_amount < 0
     or p_payment_status is null
     or p_payment_status not in ('paid', 'unpaid', 'pending')
     or (p_end_date is not null and p_end_date < p_start_date)
     or (p_payment_status = 'paid' and p_amount <= 0) then
    raise exception 'Invalid membership/payment request' using errcode = '22023';
  end if;

  if not exists (
    select 1
      from public.profiles p
     where p.id = v_actor
       and p.role = 'coach'
  ) then
    raise exception 'Coach role required' using errcode = '42501';
  end if;

  -- Lock and authorize the trainee before creating or replaying an operation.
  perform 1
    from public.trainees t
   where t.id = p_trainee_id
     and t.coach_user_id = v_actor
   for update;

  if not found then
    raise exception 'Coach cannot manage this trainee' using errcode = '42501';
  end if;

  v_payload := jsonb_build_object(
    'trainee_id', p_trainee_id,
    'start_date', p_start_date,
    'end_date', p_end_date,
    'amount', p_amount,
    'payment_status', p_payment_status,
    'payment_date', p_payment_date,
    'membership_status', 'active',
    'membership_description', 'عضویت باشگاه',
    'payment_description', 'شهریه پرداخت‌شده توسط مربی'
  );

  insert into private.coach_membership_payment_operations
    (actor_uid, operation_id, request_payload)
  values
    (v_actor, p_operation_id, v_payload)
  on conflict do nothing;

  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    select request_payload, result
      into v_existing_payload, v_result
      from private.coach_membership_payment_operations
     where actor_uid = v_actor
       and operation_id = p_operation_id
     for update;

    if v_existing_payload is distinct from v_payload then
      raise exception 'Operation ID was already used with a different payload'
        using errcode = '22023';
    end if;

    if v_result is not null then
      return v_result;
    end if;

    raise exception 'Operation is not in a replayable terminal state'
      using errcode = '55000';
  end if;

  insert into public.trainee_memberships
    (trainee_id, start_date, end_date, status, amount, payment_status, description)
  values
    (p_trainee_id, p_start_date, p_end_date, 'active', p_amount,
     p_payment_status, 'عضویت باشگاه')
  returning id into v_membership_id;

  if p_payment_status = 'paid' then
    insert into public.trainee_payments
      (trainee_id, membership_id, amount, payment_date, description)
    values
      (p_trainee_id, v_membership_id, p_amount,
       coalesce(p_payment_date, current_date),
       'شهریه پرداخت‌شده توسط مربی')
    returning id into v_payment_id;
  end if;

  v_result := jsonb_build_object(
    'success', true,
    'trainee_id', p_trainee_id,
    'membership_id', v_membership_id,
    'payment_id', v_payment_id,
    'payment_created', (p_payment_status = 'paid')
  );

  update private.coach_membership_payment_operations
     set result = v_result,
         completed_at = now()
   where actor_uid = v_actor
     and operation_id = p_operation_id;

  return v_result;
end;
$function$;

revoke all on function public.create_coach_membership_with_payment(
  uuid, uuid, date, date, numeric, text, date
) from public, anon;

grant execute on function public.create_coach_membership_with_payment(
  uuid, uuid, date, date, numeric, text, date
) to authenticated;

commit;
