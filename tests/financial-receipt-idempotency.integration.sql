\set ON_ERROR_STOP on
\i tests/financial-receipt-idempotency.fixture.sql

-- All application calls below run as the authenticated API role.
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);

do $$
declare
  v_first jsonb;
  v_retry jsonb;
  v_count integer;
begin
  -- Same actor + operation ID + payload returns the stored result.
  v_first := public.review_receipt_idempotent(
    '40000000-0000-0000-0000-000000000001','approved',
    '50000000-0000-0000-0000-000000000001','2026-11-14'
  );
  v_retry := public.review_receipt_idempotent(
    '40000000-0000-0000-0000-000000000001','approved',
    '50000000-0000-0000-0000-000000000001','2026-11-14'
  );
  if v_first is distinct from v_retry then
    raise exception 'same operation retry did not return the stored result';
  end if;
  select count(*) into v_count from public.trainee_payments
   where trainee_id='30000000-0000-0000-0000-000000000001' and amount=125000;
  if v_count <> 1 then raise exception 'expected exactly one payment after retry; got %',v_count; end if;
  if not exists(select 1 from public.trainee_payments
    where trainee_id='30000000-0000-0000-0000-000000000001'
      and amount=125000 and payment_date='2026-11-13'
      and description='تأیید فیش واریزی') then
    raise exception 'receipt approval payment fields differ from live browser handler';
  end if;
  if (select count(*) from public.trainee_memberships
      where trainee_id='30000000-0000-0000-0000-000000000001'
        and status='active' and payment_status='paid') <> 2 then
    raise exception 'receipt approval must reproduce current UI behavior across all membership history rows';
  end if;

  -- A NULL decision must not fall through to the rejection branch.
  begin
    perform public.review_receipt_idempotent(
      '40000000-0000-0000-0000-000000000002',null,
      '50000000-0000-0000-0000-000000000009','2026-11-14'
    );
    raise exception 'expected NULL decision to be rejected';
  exception when sqlstate '22023' then null;
  end;

  -- Reusing the operation ID for a different decision/payload is rejected.
  begin
    perform public.review_receipt_idempotent(
      '40000000-0000-0000-0000-000000000001','rejected',
      '50000000-0000-0000-0000-000000000001','2026-11-14'
    );
    raise exception 'expected changed-payload operation ID reuse to fail';
  exception when sqlstate '22023' then null;
  end;

  -- A distinct operation ID cannot approve an already terminal receipt.
  begin
    perform public.review_receipt_idempotent(
      '40000000-0000-0000-0000-000000000001','approved',
      '50000000-0000-0000-0000-000000000002','2026-11-14'
    );
    raise exception 'expected terminal receipt re-approval to fail';
  exception when sqlstate '55000' then null;
  end;

  -- Rejection is terminal and never creates a payment.
  perform public.review_receipt_idempotent(
    '40000000-0000-0000-0000-000000000002','rejected',
    '50000000-0000-0000-0000-000000000003','2026-11-14'
  );
  select count(*) into v_count from public.trainee_payments
   where trainee_id='30000000-0000-0000-0000-000000000001' and amount=95000;
  if v_count <> 0 then raise exception 'rejected receipt unexpectedly created a payment'; end if;
end;
$$;

-- A receipt without its own payment date must use the browser-local fallback
-- supplied by the caller, not the database server's current_date.
insert into public.trainee_payment_receipts(id,trainee_id,submitted_by,receipt_path,amount,payment_date) values
 ('40000000-0000-0000-0000-000000000006','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','synthetic/receipt-null-date.jpg',66000,null);
select public.review_receipt_idempotent(
 '40000000-0000-0000-0000-000000000006','approved',
 '50000000-0000-0000-0000-000000000010','2026-11-14');
do $fallback$
begin
 if not exists(select 1 from public.trainee_payments
   where trainee_id='30000000-0000-0000-0000-000000000001'
     and amount=66000 and payment_date='2026-11-14'
     and description='تأیید فیش واریزی') then
   raise exception 'NULL receipt date did not use caller-supplied browser-local fallback';
 end if;
end;
$fallback$;

-- Cross-coach access must fail, and the failed operation must roll back its ledger claim.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
do $$
begin
  begin
    perform public.review_receipt_idempotent(
      '40000000-0000-0000-0000-000000000001','approved',
      '50000000-0000-0000-0000-000000000004','2026-11-14'
    );
    raise exception 'expected cross-coach receipt access to fail';
  exception when sqlstate '42501' then null;
  end;
end;
$$;

-- A trainee account cannot invoke the coach-only review endpoint.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',false);
do $$
begin
  begin
    perform public.review_receipt_idempotent(
      '40000000-0000-0000-0000-000000000001','approved',
      '50000000-0000-0000-0000-000000000005','2026-11-14'
    );
    raise exception 'expected trainee role to be rejected';
  exception when sqlstate '42501' then null;
  end;
end;
$$;

reset role;

-- Inject a failure after the receipt is locked and before the transaction completes.
create function public.fixture_fail_selected_payment()
returns trigger language plpgsql as $$
begin
  if new.amount=55555 then
    raise exception 'injected payment insert failure' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger fixture_fail_selected_payment
before insert on public.trainee_payments
for each row execute function public.fixture_fail_selected_payment();

insert into public.trainee_payment_receipts(id,trainee_id,submitted_by,receipt_path,amount,payment_date) values
 ('40000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','synthetic/receipt-failure.jpg',55555,'2026-11-14');

set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
do $$
begin
  begin
    perform public.review_receipt_idempotent(
      '40000000-0000-0000-0000-000000000004','approved',
      '50000000-0000-0000-0000-000000000006','2026-11-14'
    );
    raise exception 'expected injected payment failure';
  exception when sqlstate '23514' then null;
  end;
end;
$$;
reset role;

do $$
declare v_status text; v_count integer;
begin
  select review_status into v_status from public.trainee_payment_receipts
   where id='40000000-0000-0000-0000-000000000004';
  if v_status <> 'pending' then raise exception 'receipt state was not rolled back'; end if;
  select count(*) into v_count from public.trainee_payments where amount=55555;
  if v_count <> 0 then raise exception 'payment row survived failed transaction'; end if;
  select count(*) into v_count from private.operation_ledger
   where operation_id='50000000-0000-0000-0000-000000000006';
  if v_count <> 0 then raise exception 'operation ledger claim survived failed transaction'; end if;
end;
$$;

-- Ledger is private: ordinary authenticated clients cannot read it.
set role authenticated;
do $$
begin
  begin
    perform 1 from private.operation_ledger;
    raise exception 'expected private ledger access to be denied';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

select 'PASS: retry idempotency, changed-payload rejection, terminal receipt protection, rejection without payment, coach ownership, trainee role denial, atomic rollback, private ledger ACL.' as result;


-- Two independent database sessions race to approve the same pending receipt
-- using different operation IDs. The first transaction keeps its row lock open
-- after the RPC returns; the second must wait, then observe the terminal state.
create extension if not exists dblink;
insert into public.trainee_payment_receipts(id,trainee_id,submitted_by,receipt_path,amount,payment_date) values
 ('40000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','synthetic/receipt-race.jpg',45000,'2026-11-14');

select dblink_connect('receipt_race_a','dbname='||current_database()||' user=postgres');
select dblink_connect('receipt_race_b','dbname='||current_database()||' user=postgres');
select dblink_exec('receipt_race_a','set role authenticated');
select dblink_exec('receipt_race_b','set role authenticated');
select dblink_exec('receipt_race_a','set request.jwt.claim.sub = ''10000000-0000-0000-0000-000000000001''');
select dblink_exec('receipt_race_b','set request.jwt.claim.sub = ''10000000-0000-0000-0000-000000000001''');
select dblink_exec('receipt_race_a','begin');

do $$
declare v_result text; v_second_error text;
begin
  if dblink_send_query('receipt_race_a',
    $query$select public.review_receipt_idempotent(
      '40000000-0000-0000-0000-000000000005','approved',
      '50000000-0000-0000-0000-000000000007'
    )::text$query$) <> 1 then
    raise exception 'could not start first concurrent approval';
  end if;
  perform * from dblink_get_result('receipt_race_a') as t(result text);
  -- Drain the async connection's final empty result before issuing COMMIT.
  perform * from dblink_get_result('receipt_race_a') as t(result text);

  if dblink_send_query('receipt_race_b',
    $query$select public.review_receipt_idempotent(
      '40000000-0000-0000-0000-000000000005','approved',
      '50000000-0000-0000-0000-000000000008'
    )::text$query$) <> 1 then
    raise exception 'could not start second concurrent approval';
  end if;

  -- Give session B time to reach and wait on the receipt row lock.
  perform pg_sleep(0.3);
  if dblink_is_busy('receipt_race_b') <> 1 then
    raise exception 'second session did not remain blocked on the receipt row lock';
  end if;
  perform dblink_exec('receipt_race_a','commit');

  begin
    perform * from dblink_get_result('receipt_race_b') as t(result text);
    raise exception 'second concurrent approval unexpectedly succeeded';
  exception when others then
    get stacked diagnostics v_second_error = message_text;
    if position('Receipt is already in a terminal state' in v_second_error) = 0 then
      raise exception 'second concurrent approval failed for an unexpected reason: %',v_second_error;
    end if;
  end;
  -- Clear the second connection's completed async result before disconnecting.
  perform * from dblink_get_result('receipt_race_b') as t(result text);
end;
$$;

select dblink_disconnect('receipt_race_a');
select dblink_disconnect('receipt_race_b');

do $$
declare v_count integer; v_status text;
begin
  select count(*) into v_count from public.trainee_payments
   where trainee_id='30000000-0000-0000-0000-000000000001' and amount=45000;
  if v_count <> 1 then raise exception 'concurrent approval created % payments, expected exactly one',v_count; end if;
  select review_status into v_status from public.trainee_payment_receipts
   where id='40000000-0000-0000-0000-000000000005';
  if v_status <> 'approved' then raise exception 'concurrent approval did not leave receipt approved'; end if;
end;
$$;

select 'PASS: two-session concurrent approval race produced one payment and one terminal receipt.' as concurrency_result;
