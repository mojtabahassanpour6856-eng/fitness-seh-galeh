-- Isolated integration test for the production-draft RPC.
-- All rows are synthetic; no Supabase project or trainee data is used.
\set ON_ERROR_STOP on
\i tests/financial-receipt-idempotency.fixture.sql

-- Execute the actual draft schema migration against disposable fixture tables.
\i supabase/drafts/20261114000100_receipt_membership_link.sql

create or replace function private.can_access_trainee(p_trainee_id uuid)
returns boolean
language sql stable security definer
set search_path=pg_catalog,public
as $$
  select exists (
    select 1 from public.trainees t
     where t.id=p_trainee_id and t.coach_user_id=auth.uid()
  )
$$;

\i supabase/drafts/20261114000110_review_trainee_payment_receipt_rpc.sql

set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);

do $$
declare
  v_first jsonb;
  v_retry jsonb;
  v_count integer;
begin
  v_first := public.review_trainee_payment_receipt(
    '40000000-0000-0000-0000-000000000001','approved',
    '60000000-0000-0000-0000-000000000001','2026-11-14'
  );
  v_retry := public.review_trainee_payment_receipt(
    '40000000-0000-0000-0000-000000000001','approved',
    '60000000-0000-0000-0000-000000000001','2026-11-14'
  );
  if v_first is distinct from v_retry then
    raise exception 'same operation retry did not return original result';
  end if;

  select count(*) into v_count from public.trainee_payments
   where receipt_id='40000000-0000-0000-0000-000000000001';
  if v_count<>1 then raise exception 'expected exactly one payment for receipt, got %',v_count; end if;

  if not exists(select 1 from public.trainee_payments
     where receipt_id='40000000-0000-0000-0000-000000000001'
       and membership_id=1 and trainee_id='30000000-0000-0000-0000-000000000001'
       and amount=125000 and payment_date='2026-11-13') then
    raise exception 'payment is not linked to the exact receipt and membership';
  end if;

  if not exists(select 1 from public.trainee_memberships
     where id=1 and payment_status='paid' and status='active') then
    raise exception 'the linked membership was not activated';
  end if;
  if not exists(select 1 from public.trainee_memberships
     where id=2 and payment_status='unpaid') then
    raise exception 'a different membership history row was modified';
  end if;

  -- The schema permits at most one payment row for a given receipt.
  begin
    insert into public.trainee_payments
      (trainee_id,membership_id,receipt_id,amount,payment_date,description)
    values
      ('30000000-0000-0000-0000-000000000001',1,
       '40000000-0000-0000-0000-000000000001',125000,'2026-11-13','duplicate');
    raise exception 'expected one-payment-per-receipt unique index to reject duplicate';
  exception when sqlstate '23505' then null;
  end;

  -- Composite foreign keys must prevent cross-trainee membership associations.
  begin
    insert into public.trainee_payments
      (trainee_id,membership_id,amount,payment_date,description)
    values
      ('30000000-0000-0000-0000-000000000002',1,1000,'2026-11-14','wrong trainee');
    set constraints trainee_payments_trainee_membership_fk immediate;
    raise exception 'expected cross-trainee payment membership reference to fail';
  exception when sqlstate '23503' then null;
  end;

  begin
    insert into public.trainee_payment_receipts
      (id,trainee_id,membership_id,submitted_by,receipt_path,amount,payment_date)
    values
      ('40000000-0000-0000-0000-000000000009',
       '30000000-0000-0000-0000-000000000001',3,
       '20000000-0000-0000-0000-000000000001',
       'synthetic/cross-trainee-membership.jpg',1000,'2026-11-14');
    set constraints trainee_payment_receipts_trainee_membership_fk immediate;
    raise exception 'expected cross-trainee receipt membership reference to fail';
  exception when sqlstate '23503' then null;
  end;

  -- Reusing the same operation ID for a different receipt is rejected.
  begin
    perform public.review_trainee_payment_receipt(
      '40000000-0000-0000-0000-000000000002','rejected',
      '60000000-0000-0000-0000-000000000001','2026-11-14'
    );
    raise exception 'expected operation ID payload mismatch';
  exception when sqlstate '22023' then null;
  end;

  -- Rejection is terminal and never creates a payment or settles a membership.
  perform public.review_trainee_payment_receipt(
    '40000000-0000-0000-0000-000000000002','rejected',
    '60000000-0000-0000-0000-000000000002','2026-11-14'
  );
  select count(*) into v_count from public.trainee_payments
   where receipt_id='40000000-0000-0000-0000-000000000002';
  if v_count<>0 then raise exception 'rejected receipt created a payment'; end if;
  if not exists(select 1 from public.trainee_memberships
     where id=2 and payment_status='unpaid') then
    raise exception 'rejected receipt changed membership state';
  end if;
end;
$$;

-- A retry of the same trainee receipt submission cannot create a second row.
update public.trainee_payment_receipts
   set submission_operation_id='70000000-0000-0000-0000-000000000001'
 where id='40000000-0000-0000-0000-000000000001';

do $
begin
  begin
    insert into public.trainee_payment_receipts
      (id,trainee_id,membership_id,submission_operation_id,submitted_by,receipt_path,amount,payment_date)
    values
      ('40000000-0000-0000-0000-000000000011',
       '30000000-0000-0000-0000-000000000001',1,
       '70000000-0000-0000-0000-000000000001',
       '20000000-0000-0000-0000-000000000001',
       'synthetic/replayed-submit.jpg',125000,'2026-11-13');
    raise exception 'expected duplicate submission operation to be rejected';
  exception when unique_violation then null;
  end;
end;
$;

-- PostgreSQL numeric special values must never be treated as valid money.
insert into public.trainee_payment_receipts
  (id,trainee_id,membership_id,submitted_by,receipt_path,amount,payment_date)
values
  ('40000000-0000-0000-0000-000000000007',
   '30000000-0000-0000-0000-000000000001',1,
   '20000000-0000-0000-0000-000000000001',
   'synthetic/non-finite-amount.jpg','NaN'::numeric,'2026-11-14');

do $
declare
  v_count integer;
begin
  begin
    perform public.review_trainee_payment_receipt(
      '40000000-0000-0000-0000-000000000007','approved',
      '60000000-0000-0000-0000-000000000007','2026-11-14'
    );
    raise exception 'non-finite receipt amount should be rejected';
  exception when sqlstate '23514' then null;
  end;
  select count(*) into v_count from public.trainee_payments
   where receipt_id='40000000-0000-0000-0000-000000000007';
  if v_count<>0 then
    raise exception 'non-finite receipt amount created a payment';
  end if;
  if not exists(select 1 from public.trainee_payment_receipts
    where id='40000000-0000-0000-0000-000000000007'
      and review_status='pending') then
    raise exception 'non-finite receipt amount changed review status';
  end if;
end;
$$;

-- Legacy receipt with no trusted membership link must remain pending.
insert into public.trainee_payment_receipts
  (id,trainee_id,membership_id,submitted_by,receipt_path,amount,payment_date)
values
  ('40000000-0000-0000-0000-000000000008',
   '30000000-0000-0000-0000-000000000001',null,
   '20000000-0000-0000-0000-000000000001',
   'synthetic/legacy-unlinked.jpg',50000,'2026-11-14');

do $$
begin
  begin
    perform public.review_trainee_payment_receipt(
      '40000000-0000-0000-0000-000000000008','approved',
      '60000000-0000-0000-0000-000000000003','2026-11-14'
    );
    raise exception 'legacy unlinked receipt should not be auto-approved';
  exception when sqlstate '23514' then null;
  end;
  if not exists(select 1 from public.trainee_payment_receipts
    where id='40000000-0000-0000-0000-000000000008'
      and review_status='pending' and membership_id is null) then
    raise exception 'legacy receipt changed after failed approval';
  end if;
end;
$$;

-- Coach must not review a receipt owned by another coach.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
do $$
begin
  begin
    perform public.review_trainee_payment_receipt(
      '40000000-0000-0000-0000-000000000003','approved',
      '60000000-0000-0000-0000-000000000004','2026-11-14'
    );
    raise exception 'cross-coach receipt review should be denied';
  exception when sqlstate '42501' then null;
  end;
end;
$$;

reset role;

-- Apply the later cutover checks only after the client/RPC migration stage.
\i supabase/drafts/20261114000200_enforce_new_membership_links.sql

set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
do $cutover$
begin
  -- Existing legacy NULL receipt is retained, but cannot be changed without mapping.
  begin
    update public.trainee_payment_receipts
       set review_status='rejected'
     where id='40000000-0000-0000-0000-000000000008';
    raise exception 'expected legacy NULL receipt update to be blocked until manual mapping';
  exception when check_violation then null;
  end;

  -- New receipt rows must explicitly select a membership.
  begin
    insert into public.trainee_payment_receipts
      (id,trainee_id,membership_id,submitted_by,receipt_path,amount,payment_date)
    values
      ('40000000-0000-0000-0000-000000000010',
       '30000000-0000-0000-0000-000000000001',null,
       '20000000-0000-0000-0000-000000000001',
       'synthetic/new-unlinked.jpg',1000,'2026-11-14');
    raise exception 'expected new receipt without membership link to be blocked';
  exception when check_violation then null;
  end;

  -- New payment rows must always be linked to one membership.
  begin
    insert into public.trainee_payments
      (trainee_id,membership_id,amount,payment_date,description)
    values
      ('30000000-0000-0000-0000-000000000001',null,1000,'2026-11-14','unlinked');
    raise exception 'expected new payment without membership link to be blocked';
  exception when check_violation then null;
  end;

  if not exists(select 1 from public.trainee_payment_receipts
    where id='40000000-0000-0000-0000-000000000008'
      and membership_id is null and review_status='pending') then
    raise exception 'legacy receipt was not preserved unchanged';
  end if;
end;
$cutover$;

select 'PASS: exact membership settlement, one payment per receipt, cross-trainee FK protection, idempotent replay, legacy NULL reconciliation, fail-closed cutover checks, rejection no-op, and coach ownership.' as result;
reset role;
