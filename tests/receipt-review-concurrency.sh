#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:=localhost}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=receipt_concurrency_test}"
: "${PGPASSWORD:=postgres}"
export PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD

psql -v ON_ERROR_STOP=1 -f tests/financial-receipt-idempotency.fixture.sql
psql -v ON_ERROR_STOP=1 -f supabase/drafts/20261114000100_receipt_membership_link.sql

psql -v ON_ERROR_STOP=1 <<'SQL'
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
SQL

psql -v ON_ERROR_STOP=1 -f supabase/drafts/20261114000110_review_trainee_payment_receipt_rpc.sql

# Hold the first transaction inside payment insertion so the second request
# necessarily overlaps while the receipt row is locked.
psql -v ON_ERROR_STOP=1 <<'SQL'
create function public.test_delay_payment_insert()
returns trigger language plpgsql as $$
begin
  perform pg_sleep(2);
  return new;
end;
$$;
create trigger test_delay_payment_insert
before insert on public.trainee_payments
for each row execute function public.test_delay_payment_insert();
SQL

review_sql="set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
select public.review_trainee_payment_receipt(
 '40000000-0000-0000-0000-000000000001',
 'approved',
 '60000000-0000-0000-0000-000000000099',
 '2026-11-14'
);"

psql -v ON_ERROR_STOP=1 -c "$review_sql" > /tmp/review-first.log 2>&1 &
first_pid=$!
sleep 0.25
psql -v ON_ERROR_STOP=1 -c "$review_sql" > /tmp/review-second.log 2>&1 &
second_pid=$!

wait "$first_pid"
wait "$second_pid"

payment_count="$(psql -Atqc "select count(*) from public.trainee_payments where receipt_id='40000000-0000-0000-0000-000000000001'")"
if [[ "$payment_count" != "1" ]]; then
  cat /tmp/review-first.log /tmp/review-second.log
  echo "Expected one payment after concurrent same-operation approval; found $payment_count" >&2
  exit 1
fi

receipt_status="$(psql -Atqc "select review_status from public.trainee_payment_receipts where id='40000000-0000-0000-0000-000000000001'")"
membership_status="$(psql -Atqc "select payment_status from public.trainee_memberships where id=1")"
if [[ "$receipt_status" != "approved" || "$membership_status" != "paid" ]]; then
  echo "Receipt or membership did not reach the expected terminal state" >&2
  exit 1
fi

# A second operation ID cannot settle the same already-approved receipt.
different_operation_sql="set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
select public.review_trainee_payment_receipt(
 '40000000-0000-0000-0000-000000000001',
 'approved',
 '60000000-0000-0000-0000-000000000098',
 '2026-11-14'
);"
if psql -v ON_ERROR_STOP=1 -c "$different_operation_sql" >/tmp/review-different-operation.log 2>&1; then
  echo "Expected a distinct operation ID on an approved receipt to be rejected" >&2
  exit 1
fi

payment_count_after="$(psql -Atqc "select count(*) from public.trainee_payments where receipt_id='40000000-0000-0000-0000-000000000001'")"
if [[ "$payment_count_after" != "1" ]]; then
  echo "Distinct operation attempt changed payment count: $payment_count_after" >&2
  exit 1
fi

echo "PASS: concurrent duplicate approvals serialize, replay idempotently, and create exactly one payment."
