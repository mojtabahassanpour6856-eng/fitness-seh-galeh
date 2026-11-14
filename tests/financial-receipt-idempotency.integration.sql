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
    '40000000-0000-0000-0000-000000000001','approve',
    '50000000-0000-0000-0000-000000000001'
  );
  v_retry := public.review_receipt_idempotent(
    '40000000-0000-0000-0000-000000000001','approve',
    '50000000-0000-0000-0000-000000000001'
  );
  if v_first is distinct from v_retry then
    raise exception 'same operation retry did not return the stored result';
  end if;
  select count(*) into v_count from public.trainee_payments
   where trainee_id='30000000-0000-0000-0000-000000000001' and amount=125000;
  if v_count <> 1 then raise exception 'expected exactly one payment after retry; got %',v_count; end if;

  -- Reusing the operation ID for a different decision/payload is rejected.
  begin
    perform public.review_receipt_idempotent(
      '40000000-0000-0000-0000-000000000001','reject',
      '50000000-0000-0000-0000-000000000001'
    );
    raise exception 'expected changed-payload operation ID reuse to fail';
  exception when sqlstate '22023' then null;
  end;

  -- A distinct operation ID cannot approve an already terminal receipt.
  begin
    perform public.review_receipt_idempotent(
      '40000000-0000-0000-0000-000000000001','approve',
      '50000000-0000-0000-0000-000000000002'
    );
    raise exception 'expected terminal receipt re-approval to fail';
  exception when sqlstate '55000' then null;
  end;

  -- Rejection is terminal and never creates a payment.
  perform public.review_receipt_idempotent(
    '40000000-0000-0000-0000-000000000002','reject',
    '50000000-0000-0000-0000-000000000003'
  );
  select count(*) into v_count from public.trainee_payments
   where trainee_id='30000000-0000-0000-0000-000000000001' and amount=95000;
  if v_count <> 0 then raise exception 'rejected receipt unexpectedly created a payment'; end if;
end;
$$;

-- Cross-coach access must fail, and the failed operation must roll back its ledger claim.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
do $$
begin
  begin
    perform public.review_receipt_idempotent(
      '40000000-0000-0000-0000-000000000001','approve',
      '50000000-0000-0000-0000-000000000004'
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
      '40000000-0000-0000-0000-000000000001','approve',
      '50000000-0000-0000-0000-000000000005'
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

insert into public.trainee_payment_receipts(id,trainee_id,submitted_by,amount) values
 ('40000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',55555);

set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
do $$
begin
  begin
    perform public.review_receipt_idempotent(
      '40000000-0000-0000-0000-000000000004','approve',
      '50000000-0000-0000-0000-000000000006'
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
