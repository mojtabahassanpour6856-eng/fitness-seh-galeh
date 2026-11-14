-- Isolated tests for audited legacy receipt-to-membership reconciliation.
-- Uses only the synthetic PostgreSQL fixture; no Supabase project is contacted.
\set ON_ERROR_STOP on
\i tests/financial-receipt-idempotency.fixture.sql
\i supabase/drafts/20261114000100_receipt_membership_link.sql
\i supabase/drafts/20261114000400_reconcile_legacy_receipt_membership_rpc.sql

insert into public.trainee_payment_receipts
  (id, trainee_id, membership_id, submitted_by, receipt_path, amount, payment_date, review_status)
values
  ('40000000-0000-0000-0000-000000000008',
   '30000000-0000-0000-0000-000000000001', null,
   '20000000-0000-0000-0000-000000000001',
   'synthetic/legacy-receipt-to-map.jpg', 60000, '2026-11-10', 'pending'),
  ('40000000-0000-0000-0000-000000000009',
   '30000000-0000-0000-0000-000000000002', null,
   '20000000-0000-0000-0000-000000000001',
   'synthetic/other-coach-legacy-receipt.jpg', 70000, '2026-11-10', 'pending'),
  ('40000000-0000-0000-0000-000000000010',
   '30000000-0000-0000-0000-000000000001', null,
   '20000000-0000-0000-0000-000000000001',
   'synthetic/legacy-receipt-wrong-membership.jpg', 65000, '2026-11-10', 'pending');

set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);

do $$
declare
  v_first jsonb;
  v_retry jsonb;
  v_count integer;
begin
  v_first := public.reconcile_legacy_trainee_receipt_membership(
    '40000000-0000-0000-0000-000000000008',
    1,
    '62000000-0000-0000-0000-000000000001',
    'بررسی اصل فیش و تطبیق با عضویت آبان',
    true
  );

  v_retry := public.reconcile_legacy_trainee_receipt_membership(
    '40000000-0000-0000-0000-000000000008',
    1,
    '62000000-0000-0000-0000-000000000001',
    'بررسی اصل فیش و تطبیق با عضویت آبان',
    true
  );

  if v_first is distinct from v_retry then
    raise exception 'reconciliation retry did not return the original result';
  end if;

  if (v_first->>'membership_id')::bigint <> 1
     or (v_first->>'payment_created')::boolean is not false
     or v_first->>'review_status' <> 'pending' then
    raise exception 'reconciliation returned an unexpected result';
  end if;

  select count(*) into v_count
    from public.trainee_payment_receipts
   where id='40000000-0000-0000-0000-000000000008'
     and membership_id=1
     and review_status='pending';
  if v_count <> 1 then
    raise exception 'legacy receipt was not linked while remaining pending';
  end if;

  select count(*) into v_count
    from public.trainee_payments
   where receipt_id='40000000-0000-0000-0000-000000000008';
  if v_count <> 0 then
    raise exception 'manual reconciliation unexpectedly created a payment';
  end if;

  select count(*) into v_count
    from public.trainee_memberships
   where id=1 and payment_status='unpaid' and status='pending';
  if v_count <> 1 then
    raise exception 'manual reconciliation changed membership payment/status';
  end if;

  -- Reusing the operation UUID with a different target or reason is rejected.
  begin
    perform public.reconcile_legacy_trainee_receipt_membership(
      '40000000-0000-0000-0000-000000000008',
      2,
      '62000000-0000-0000-0000-000000000001',
      'تطبیق تغییر یافته با عضویت دیگر',
      true
    );
    raise exception 'expected reconciliation payload mismatch rejection';
  exception when sqlstate '22023' then null;
  end;

  -- A new operation cannot silently remap an already reconciled receipt.
  begin
    perform public.reconcile_legacy_trainee_receipt_membership(
      '40000000-0000-0000-0000-000000000008',
      2,
      '62000000-0000-0000-0000-000000000002',
      'تلاش برای تغییر اتصال ثبت‌شده',
      true
    );
    raise exception 'expected already-linked receipt rejection';
  exception when sqlstate '23505' then null;
  end;

  -- Explicit confirmation and a meaningful reason are mandatory.
  begin
    perform public.reconcile_legacy_trainee_receipt_membership(
      '40000000-0000-0000-0000-000000000009',
      3,
      '62000000-0000-0000-0000-000000000003',
      'بررسی فیش دیگر',
      false
    );
    raise exception 'expected missing payment-history confirmation rejection';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.reconcile_legacy_trainee_receipt_membership(
      '40000000-0000-0000-0000-000000000009',
      3,
      '62000000-0000-0000-0000-000000000004',
      'کوتاه',
      true
    );
    raise exception 'expected short reconciliation reason rejection';
  exception when sqlstate '22023' then null;
  end;

  -- A coach cannot reconcile another coach's receipt.
  begin
    perform public.reconcile_legacy_trainee_receipt_membership(
      '40000000-0000-0000-0000-000000000009',
      3,
      '62000000-0000-0000-0000-000000000005',
      'تلاش برای دسترسی به پرونده مربی دیگر',
      true
    );
    raise exception 'expected cross-coach authorization rejection';
  exception when sqlstate '42501' then null;
  end;

  -- A membership from another trainee cannot be selected.
  begin
    perform public.reconcile_legacy_trainee_receipt_membership(
      '40000000-0000-0000-0000-000000000010',
      3,
      '62000000-0000-0000-0000-000000000006',
      'تلاش برای انتخاب عضویت شاگرد دیگر',
      true
    );
    raise exception 'expected cross-trainee membership rejection';
  exception when sqlstate '23514' then null;
  end;
end;
$$;

reset role;

do $audit$
declare
  v_count integer;
begin
  select count(*) into v_count
    from private.receipt_membership_reconciliation_audit
   where receipt_id='40000000-0000-0000-0000-000000000008'
     and trainee_id='30000000-0000-0000-0000-000000000001'
     and membership_id=1
     and coach_user_id='10000000-0000-0000-0000-000000000001'
     and reason='بررسی اصل فیش و تطبیق با عضویت آبان'
     and confirmed_not_already_recorded is true;
  if v_count <> 1 then
    raise exception 'manual reconciliation audit record is missing or incorrect';
  end if;

  if has_function_privilege(
       'anon',
       'public.reconcile_legacy_trainee_receipt_membership(uuid,bigint,uuid,text,boolean)',
       'EXECUTE'
     ) then
    raise exception 'anon unexpectedly has execute permission on reconciliation RPC';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.reconcile_legacy_trainee_receipt_membership(uuid,bigint,uuid,text,boolean)',
       'EXECUTE'
     ) then
    raise exception 'authenticated is missing execute permission on reconciliation RPC';
  end if;

  if has_table_privilege(
       'authenticated',
       'private.receipt_membership_reconciliation_audit',
       'SELECT'
     ) then
    raise exception 'authenticated can directly read the private audit table';
  end if;
end;
$audit$;

select 'PASS: audited manual receipt mapping, same-trainee validation, explicit confirmation, idempotent retry, no payment/status mutation, cross-coach denial, and private-table permissions.' as result;
