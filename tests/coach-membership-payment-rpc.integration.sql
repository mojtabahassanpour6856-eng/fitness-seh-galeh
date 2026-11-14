-- Isolated integration test for the draft coach membership + payment RPC.
-- Synthetic PostgreSQL fixture only; never connects to a Supabase project.
\set ON_ERROR_STOP on
\i tests/financial-receipt-idempotency.fixture.sql
\i supabase/drafts/20261114000100_receipt_membership_link.sql
\i supabase/drafts/20261114000300_create_coach_membership_with_payment_rpc.sql

-- Inject a failure after membership insertion to prove transaction rollback.
create or replace function public.test_fail_coach_membership_payment()
returns trigger
language plpgsql
as $$
begin
  if new.description = 'شهریه پرداخت‌شده توسط مربی' then
    raise exception 'synthetic payment insert failure';
  end if;
  return new;
end;
$$;

create trigger test_fail_coach_membership_payment
before insert on public.trainee_payments
for each row execute function public.test_fail_coach_membership_payment();

set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);

do $$
declare
  v_paid jsonb;
  v_paid_retry jsonb;
  v_unpaid jsonb;
  v_retry_after_rollback jsonb;
  v_membership_id bigint;
  v_payment_id bigint;
  v_count integer;
begin
  -- Payment insertion fails after the membership insert; the entire RPC must roll back.
  begin
    perform public.create_coach_membership_with_payment(
      '30000000-0000-0000-0000-000000000001',
      '61000000-0000-0000-0000-000000000001',
      '2026-11-20', '2026-12-20', 150000, 'paid', '2026-11-14'
    );
    raise exception 'expected synthetic payment failure';
  exception when others then
    if sqlerrm <> 'synthetic payment insert failure' then
      raise;
    end if;
  end;

  select count(*) into v_count
    from public.trainee_memberships
   where trainee_id='30000000-0000-0000-0000-000000000001'
     and start_date='2026-11-20';
  if v_count <> 0 then
    raise exception 'membership insert survived a failed payment; transaction was not atomic';
  end if;

  -- Drop the injected failure and retry with the SAME operation ID.
  execute 'drop trigger test_fail_coach_membership_payment on public.trainee_payments';

  v_paid := public.create_coach_membership_with_payment(
    '30000000-0000-0000-0000-000000000001',
    '61000000-0000-0000-0000-000000000001',
    '2026-11-20', '2026-12-20', 150000, 'paid', '2026-11-14'
  );
  v_paid_retry := public.create_coach_membership_with_payment(
    '30000000-0000-0000-0000-000000000001',
    '61000000-0000-0000-0000-000000000001',
    '2026-11-20', '2026-12-20', 150000, 'paid', '2026-11-14'
  );

  if v_paid is distinct from v_paid_retry then
    raise exception 'idempotent retry did not return the original result';
  end if;

  v_membership_id := (v_paid->>'membership_id')::bigint;
  v_payment_id := (v_paid->>'payment_id')::bigint;

  if v_membership_id is null or v_payment_id is null
     or coalesce((v_paid->>'payment_created')::boolean,false) is not true then
    raise exception 'paid RPC did not return both the membership and payment identifiers';
  end if;

  select count(*) into v_count
    from public.trainee_payments
   where trainee_id='30000000-0000-0000-0000-000000000001'
     and membership_id=v_membership_id
     and id=v_payment_id
     and amount=150000
     and payment_date='2026-11-14';
  if v_count <> 1 then
    raise exception 'expected exactly one payment linked to the newly created membership';
  end if;

  select count(*) into v_count
    from public.trainee_memberships
   where id=v_membership_id
     and trainee_id='30000000-0000-0000-0000-000000000001'
     and status='active'
     and payment_status='paid'
     and start_date='2026-11-20'
     and end_date='2026-12-20'
     and amount=150000;
  if v_count <> 1 then
    raise exception 'new membership row does not match the paid request';
  end if;

  select count(*) into v_count
    from public.trainee_payments
   where trainee_id='30000000-0000-0000-0000-000000000001'
     and membership_id=v_membership_id;
  if v_count <> 1 then
    raise exception 'retry created a duplicate payment';
  end if;

  -- The second pre-existing membership must remain untouched.
  if not exists (
    select 1 from public.trainee_memberships
     where id=2 and payment_status='unpaid'
  ) then
    raise exception 'an unrelated membership history row changed';
  end if;

  -- A not-yet-paid membership is created, but no payment row is inserted.
  v_unpaid := public.create_coach_membership_with_payment(
    '30000000-0000-0000-0000-000000000001',
    '61000000-0000-0000-0000-000000000002',
    '2027-01-01', '2027-02-01', 90000, 'unpaid', null
  );

  if (v_unpaid->>'payment_created')::boolean is not false
     or v_unpaid->>'payment_id' is not null then
    raise exception 'unpaid membership unexpectedly created a payment';
  end if;

  select count(*) into v_count
    from public.trainee_payments
   where trainee_id='30000000-0000-0000-0000-000000000001'
     and membership_id=(v_unpaid->>'membership_id')::bigint;
  if v_count <> 0 then
    raise exception 'unpaid membership has a payment row';
  end if;

  -- Same operation ID with changed material payload must be rejected.
  begin
    perform public.create_coach_membership_with_payment(
      '30000000-0000-0000-0000-000000000001',
      '61000000-0000-0000-0000-000000000001',
      '2026-11-20', '2026-12-20', 155000, 'paid', '2026-11-14'
    );
    raise exception 'expected operation ID payload mismatch rejection';
  exception when sqlstate '22023' then null;
  end;

  -- A coach cannot create a membership for a trainee assigned to another coach.
  begin
    perform public.create_coach_membership_with_payment(
      '30000000-0000-0000-0000-000000000002',
      '61000000-0000-0000-0000-000000000003',
      '2026-11-20', '2026-12-20', 50000, 'paid', '2026-11-14'
    );
    raise exception 'expected cross-coach authorization rejection';
  exception when sqlstate '42501' then null;
  end;

  -- Paid status cannot be accepted without a positive amount.
  begin
    perform public.create_coach_membership_with_payment(
      '30000000-0000-0000-0000-000000000001',
      '61000000-0000-0000-0000-000000000004',
      '2026-11-20', '2026-12-20', 0, 'paid', '2026-11-14'
    );
    raise exception 'expected paid zero-amount validation failure';
  exception when sqlstate '22023' then null;
  end;
end;
$$;

reset role;

-- Failed operation must not leave a durable idempotency record.
do $$
begin
  if exists (
    select 1 from private.coach_membership_payment_operations
     where actor_uid='10000000-0000-0000-0000-000000000001'
       and operation_id='61000000-0000-0000-0000-000000000001'
       and result is null
  ) then
    raise exception 'failed transaction left a partial operation ledger row';
  end if;
end;
$$;

drop function public.test_fail_coach_membership_payment();

select 'PASS: atomic coach membership/payment creation, exact membership link, idempotent replay, payload mismatch rejection, cross-coach authorization, unpaid flow, and rollback/retry.' as result;
