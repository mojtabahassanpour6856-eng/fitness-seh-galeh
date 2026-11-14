-- Isolated integration test for the production-draft RPC.
-- All rows are synthetic; no Supabase project or trainee data is used.
\set ON_ERROR_STOP on
\i tests/financial-receipt-idempotency.fixture.sql

-- Mirror the draft migration's relationship constraints in disposable PostgreSQL.
alter table public.trainee_payments add column receipt_id uuid;
alter table public.trainee_payment_receipts
  add constraint trainee_payment_receipts_trainee_id_id_key unique (trainee_id,id);
alter table public.trainee_payments
  add constraint trainee_payments_trainee_membership_fk
  foreign key (trainee_id,membership_id)
  references public.trainee_memberships(trainee_id,id)
  deferrable initially deferred;
alter table public.trainee_payments
  add constraint trainee_payments_trainee_receipt_fk
  foreign key (trainee_id,receipt_id)
  references public.trainee_payment_receipts(trainee_id,id)
  deferrable initially deferred;
create unique index trainee_payments_one_per_receipt_uidx
  on public.trainee_payments(receipt_id) where receipt_id is not null;

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
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
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

select 'PASS: exact membership settlement, payment-to-receipt uniqueness, idempotent replay, payload mismatch rejection, legacy NULL fail-closed, rejection no-op, and coach ownership.' as result;
reset role;
