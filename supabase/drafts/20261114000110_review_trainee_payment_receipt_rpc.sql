-- DRAFT ONLY — DO NOT APPLY TO PRODUCTION.
-- Atomic receipt review: one receipt -> one membership -> at most one payment.
-- Requires the nullable membership_id + receipt_id migration to be applied first.
-- Uses a dedicated private idempotency table; it does not assume that a generic
-- operation ledger already exists in production.

begin;

create table if not exists private.receipt_review_operations (
  actor_uid uuid not null,
  operation_id uuid not null,
  request_payload jsonb not null,
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (actor_uid, operation_id)
);

revoke all on table private.receipt_review_operations
  from public, anon, authenticated;

create or replace function public.review_trainee_payment_receipt(
  p_receipt_id uuid,
  p_decision text,
  p_operation_id uuid,
  p_fallback_payment_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_receipt public.trainee_payment_receipts%rowtype;
  v_membership public.trainee_memberships%rowtype;
  v_payload jsonb;
  v_existing_payload jsonb;
  v_result jsonb;
  v_rows integer;
  v_existing_payment_id bigint;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode='28000';
  end if;
  if not coalesce(private.is_coach(), false) then
    raise exception 'Coach role required' using errcode='42501';
  end if;
  if p_receipt_id is null or p_operation_id is null
     or p_fallback_payment_date is null
     or p_decision is null
     or p_decision not in ('approved','rejected') then
    raise exception 'Invalid receipt review request' using errcode='22023';
  end if;

  -- Lock first: the membership association is part of the immutable request.
  select * into v_receipt
    from public.trainee_payment_receipts
   where id=p_receipt_id
   for update;
  if not found then
    raise exception 'Receipt not found' using errcode='P0002';
  end if;

  if not coalesce(private.can_access_trainee(v_receipt.trainee_id), false) then
    raise exception 'Coach cannot review this trainee receipt'
      using errcode='42501';
  end if;

  v_payload := jsonb_build_object(
    'receipt_id', p_receipt_id,
    'membership_id', v_receipt.membership_id,
    'decision', p_decision,
    'fallback_payment_date', p_fallback_payment_date
  );

  insert into private.receipt_review_operations
    (actor_uid, operation_id, request_payload)
  values
    (v_actor, p_operation_id, v_payload)
  on conflict do nothing;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    select request_payload, result
      into v_existing_payload, v_result
      from private.receipt_review_operations
     where actor_uid=v_actor and operation_id=p_operation_id
     for update;

    if v_existing_payload is distinct from v_payload then
      raise exception 'Operation ID was already used with a different payload'
        using errcode='22023';
    end if;
    if v_result is not null then
      return v_result;
    end if;
    raise exception 'Operation is not in a replayable terminal state'
      using errcode='55000';
  end if;

  if v_receipt.review_status is distinct from 'pending' then
    raise exception 'Receipt is already in a terminal state'
      using errcode='55000';
  end if;

  if p_decision='approved' then
    if v_receipt.membership_id is null then
      raise exception 'Receipt has no membership link; manual reconciliation required'
        using errcode='23514';
    end if;
    if v_receipt.amount is null or v_receipt.amount <= 0 then
      raise exception 'Receipt amount must be greater than zero'
        using errcode='23514';
    end if;

    select * into v_membership
      from public.trainee_memberships
     where id=v_receipt.membership_id
       and trainee_id=v_receipt.trainee_id
     for update;
    if not found then
      raise exception 'Receipt membership does not belong to the receipt trainee'
        using errcode='23514';
    end if;

    -- Defense in depth in addition to the partial unique index on receipt_id.
    select id into v_existing_payment_id
      from public.trainee_payments
     where receipt_id=v_receipt.id
     limit 1;
    if found then
      raise exception 'A payment is already linked to this receipt; manual reconciliation required'
        using errcode='23505';
    end if;

    insert into public.trainee_payments
      (trainee_id, membership_id, receipt_id, amount, payment_date, description)
    values
      (v_receipt.trainee_id, v_receipt.membership_id, v_receipt.id,
       v_receipt.amount,
       coalesce(v_receipt.payment_date, p_fallback_payment_date),
       'تأیید فیش واریزی');

    -- Only the exact membership selected on this receipt is settled.
    update public.trainee_memberships
       set status='active', payment_status='paid'
     where id=v_receipt.membership_id
       and trainee_id=v_receipt.trainee_id;

    update public.trainee_payment_receipts
       set review_status='approved',
           reviewed_by=v_actor,
           reviewed_at=now()
     where id=v_receipt.id;
  else
    -- A rejected receipt never creates a payment or changes membership state.
    select id into v_existing_payment_id
      from public.trainee_payments
     where receipt_id=v_receipt.id
     limit 1;
    if found then
      raise exception 'Receipt already has a linked payment; manual reconciliation required'
        using errcode='23505';
    end if;

    update public.trainee_payment_receipts
       set review_status='rejected',
           reviewed_by=v_actor,
           reviewed_at=now()
     where id=v_receipt.id;
  end if;

  v_result := jsonb_build_object(
    'success', true,
    'receipt_id', v_receipt.id,
    'membership_id', v_receipt.membership_id,
    'operation_id', p_operation_id,
    'decision', p_decision,
    'payment_created', (p_decision='approved')
  );

  update private.receipt_review_operations
     set result=v_result, completed_at=now()
   where actor_uid=v_actor and operation_id=p_operation_id;

  return v_result;
end;
$function$;

revoke all on function public.review_trainee_payment_receipt(uuid,text,uuid,date)
  from public, anon;
grant execute on function public.review_trainee_payment_receipt(uuid,text,uuid,date)
  to authenticated;

commit;
