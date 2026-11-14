-- DRAFT CUTOVER ONLY — apply only after the trainee selector, coach review UI,
-- and all payment-writing clients use membership_id / the approved RPC.
-- Do not apply this file during the initial nullable-column rollout.
--
-- NOT VALID leaves historical NULL rows intact, but PostgreSQL still enforces
-- each CHECK for every new row and every updated row. Thus old clients fail
-- closed instead of silently creating unlinked new financial records.

begin;

alter table public.trainee_payment_receipts
  add constraint trainee_payment_receipts_membership_required_for_new_rows
  check (membership_id is not null)
  not valid;

alter table public.trainee_payments
  add constraint trainee_payments_membership_required_for_new_rows
  check (membership_id is not null)
  not valid;

commit;
