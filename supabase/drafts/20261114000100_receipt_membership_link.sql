-- DRAFT ONLY — DO NOT APPLY TO PRODUCTION.
-- Contract: one receipt and its resulting payment belong to exactly one
-- membership row. Legacy receipts/payments remain NULL and require manual
-- reconciliation; this migration deliberately performs no backfill.
--
-- Preconditions confirmed by read-only production schema audit:
--   trainee_memberships(id bigint PK, trainee_id uuid NOT NULL)
--   trainee_payment_receipts(id uuid PK, trainee_id uuid NOT NULL)
--   trainee_payments(id bigint PK, trainee_id uuid NOT NULL)
--
-- This file is a reviewable migration proposal, not an executed migration.
-- It does not change RLS policies, grants, triggers, Auth, or existing rows.

begin;

-- Nullable references preserve legacy rows without guessing their membership.
alter table public.trainee_payment_receipts
  add column if not exists membership_id bigint;

alter table public.trainee_payments
  add column if not exists membership_id bigint;

-- Tie the payment to the exact receipt that created it. A partial unique index
-- below enforces at most one payment row per receipt while allowing legacy rows.
alter table public.trainee_payments
  add column if not exists receipt_id uuid;

-- A composite candidate key lets the database enforce that the selected
-- membership belongs to the same trainee as the receipt/payment.
do $migration$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.trainee_memberships'::regclass
       and conname = 'trainee_memberships_trainee_id_id_key'
  ) then
    alter table public.trainee_memberships
      add constraint trainee_memberships_trainee_id_id_key
      unique (trainee_id, id);
  end if;
end
$migration$;

-- A second composite candidate key enforces same-trainee receipt references.
do $migration$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trainee_payment_receipts'::regclass
       and conname = 'trainee_payment_receipts_trainee_id_id_key'
  ) then
    alter table public.trainee_payment_receipts
      add constraint trainee_payment_receipts_trainee_id_id_key
      unique (trainee_id, id);
  end if;
end
$migration$;

-- Deferred NO ACTION prevents deleting a membership that still has financial history,
-- while allowing the existing trainee_id cascades to remove the trainee's entire
-- membership/receipt/payment set in one transaction.
do $migration$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trainee_payment_receipts'::regclass
       and conname = 'trainee_payment_receipts_trainee_membership_fk'
  ) then
    alter table public.trainee_payment_receipts
      add constraint trainee_payment_receipts_trainee_membership_fk
      foreign key (trainee_id, membership_id)
      references public.trainee_memberships (trainee_id, id)
      on delete no action
      deferrable initially deferred
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trainee_payments'::regclass
       and conname = 'trainee_payments_trainee_receipt_fk'
  ) then
    alter table public.trainee_payments
      add constraint trainee_payments_trainee_receipt_fk
      foreign key (trainee_id, receipt_id)
      references public.trainee_payment_receipts (trainee_id, id)
      on delete no action
      deferrable initially deferred
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trainee_payments'::regclass
       and conname = 'trainee_payments_trainee_membership_fk'
  ) then
    alter table public.trainee_payments
      add constraint trainee_payments_trainee_membership_fk
      foreign key (trainee_id, membership_id)
      references public.trainee_memberships (trainee_id, id)
      on delete no action
      deferrable initially deferred
      not valid;
  end if;
end
$migration$;

-- Validate explicitly before the application begins relying on the contract.
alter table public.trainee_payment_receipts
  validate constraint trainee_payment_receipts_trainee_membership_fk;

alter table public.trainee_payments
  validate constraint trainee_payments_trainee_membership_fk;
alter table public.trainee_payments
  validate constraint trainee_payments_trainee_receipt_fk;

create unique index if not exists trainee_payments_one_per_receipt_uidx
  on public.trainee_payments (receipt_id)
  where receipt_id is not null;

create index if not exists trainee_payment_receipts_membership_lookup_idx
  on public.trainee_payment_receipts (trainee_id, membership_id);

create index if not exists trainee_payments_membership_lookup_idx
  on public.trainee_payments (trainee_id, membership_id);

comment on column public.trainee_payment_receipts.membership_id is
  'Specific membership settled by this receipt; NULL legacy rows require manual reconciliation.';
comment on column public.trainee_payments.membership_id is
  'Specific membership settled by this payment; must match trainee_id.';
comment on column public.trainee_payments.receipt_id is
  'Receipt that generated this payment; unique when non-NULL to prevent duplicate settlement.';

commit;
