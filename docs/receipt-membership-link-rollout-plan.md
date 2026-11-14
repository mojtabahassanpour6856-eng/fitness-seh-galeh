# Receipt-to-membership link: staged rollout proposal

Status: design proposal only. No production schema or application changes have been applied.

## Confirmed business rule

Every membership payment settles exactly one specific membership history row. A receipt must never activate all memberships belonging to the trainee. The receipt and the resulting payment must carry the same `membership_id`, and the coach must see that exact membership before approving.

## Database proposal

Draft migration: `supabase/drafts/20261114000100_receipt_membership_link.sql`.

- Add nullable `membership_id` to `trainee_payment_receipts` and `trainee_payments`.
- Add a composite candidate key on `trainee_memberships(trainee_id,id)`.
- Add composite foreign keys from each financial row's `(trainee_id,membership_id)` to the matching membership row.
- Leave old rows NULL; do not infer a link from date, amount, current status, or row order.
- Use RESTRICT for membership deletion while financial history references it.
- Add lookup indexes only; no RLS, grants, Auth, Storage, or existing data changes.

The migration is deliberately not applied. Before production use, test it against a schema-faithful disposable PostgreSQL clone and verify cascade/delete behavior and lock duration.

## Application contract required before cutover

1. Trainee receipt submission must load only memberships the authenticated trainee is permitted to see and require an explicit membership selection.
2. The submitted `membership_id` must be validated server-side against the authenticated trainee; never trust a client-supplied trainee ID or membership ID alone.
3. Coach review must display the linked membership's dates, status, amount, and card details (where present). An unlinked legacy receipt must display a clear manual-reconciliation state and must not have an approval action that guesses a target.
4. The approval RPC must lock the receipt, validate the membership belongs to the receipt trainee, create one payment carrying the same `membership_id`, update only that membership row, and mark the receipt approved in one transaction.
5. The operation ledger must bind retries to actor, operation UUID, receipt, decision, membership association, and all material request fields. A replay with a changed payload must fail.
6. Rejection must not create a payment or change membership status.
7. Storage receipt uploads remain online-only until a separate staged-upload/reconciliation design exists.

## Legacy reconciliation

- Existing receipts with NULL `membership_id` remain unchanged and unapproved.
- A coach may manually map a legacy receipt only after checking the actual receipt and membership records.
- Record who performed the mapping, when, and why; then review through the same atomic approval path.
- Do not bulk-map historical receipts or activate every membership row for a trainee.

## Safe release sequence

A. Review and test the draft migration on a schema-faithful isolated database.
B. Implement trainee selection and coach review UI behind a feature flag, using only a test branch/project.
C. Implement and test the atomic RPC, including replay, cross-trainee, cross-coach, concurrent approval, rollback, legacy NULL, and mismatched-membership cases.
D. Deploy schema first only after explicit approval and verified backup/rollback plan.
E. Deploy compatible client/RPC integration; keep old direct-write paths available only during a controlled compatibility window.
F. Verify telemetry and reconciliation, then separately plan removal of unsafe direct DML grants only after all clients have migrated. Do not revoke grants as part of this draft.
G. Enable the feature gradually and monitor errors before wider coach rollout.

## Explicit non-goals

This proposal does not merge anything, run a migration, modify main, deploy a function, change production Supabase, alter grants/RLS, backfill historical records, or touch trainee data.
