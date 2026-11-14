# Manual reconciliation of legacy payment receipts — draft

**Status: isolated prototype only. Do not merge, deploy, or enable the feature flag in production.**

This workflow is for old `trainee_payment_receipts` rows whose `membership_id` is NULL. It does not infer the intended membership from amount, date, or the newest membership.

## Coach UI

For a pending legacy receipt with no membership link, the coach sees:
- the full membership history for the selected trainee, with dates, amount, payment status, and card number;
- a required membership selector;
- a required explanation (8–1000 characters);
- an explicit checkbox confirming that this deposit has not already been recorded in payment history.

The coach must compare the receipt itself with the selected membership. If the coach cannot verify the match, the receipt remains unlinked and pending.

## Atomic RPC

Function:
`public.reconcile_legacy_trainee_receipt_membership(uuid, bigint, uuid, text, boolean)`

The RPC:
- requires an authenticated coach and verifies `trainees.coach_user_id = auth.uid()`;
- locks the receipt and selected membership;
- accepts only pending, currently unlinked receipts;
- requires the selected membership to belong to the same trainee;
- refuses a receipt that already has a payment linked through `trainee_payments.receipt_id`;
- requires an explicit confirmation that the payment was not already recorded elsewhere;
- writes an immutable private audit row containing coach, receipt, trainee, membership, reason, confirmation, operation UUID, and timestamp;
- updates only `trainee_payment_receipts.membership_id`;
- does not change receipt review status, membership status/payment status, or create a payment;
- uses an operation ledger so a retry with the same UUID and payload returns the original result; a changed payload is rejected.

After reconciliation, the receipt remains pending and can only be approved/rejected separately through the atomic receipt-review RPC from PR #226. That approval then creates the payment linked to the mapped membership.

## Tests

The disposable PostgreSQL 17 integration test covers:
- successful mapping and audit record;
- idempotent replay;
- payload mismatch and second mapping rejection;
- explicit confirmation and minimum reason requirements;
- wrong-coach receipt denial;
- cross-trainee membership denial;
- no payment creation and no membership/review-status mutation;
- private audit table access and function execute grants.

## Release gates

1. Review PR #226's membership-link schema.
2. Review PR #227's receipt client and operation handling.
3. Review this RPC and the audit table's retention/deletion behavior.
4. Run all PostgreSQL and browser checks against the exact combined branch.
5. Test a legacy receipt end-to-end with synthetic records in a disposable Supabase environment.
6. Confirm that a coach cannot approve the receipt until mapping succeeds and that mapping never creates a payment itself.

The UI is gated by `window.SEH_RECEIPT_MEMBERSHIP_LINK_ENABLED`, which remains false by default. No production Supabase schema, RLS, grants, Auth, Storage, or trainee records are changed.
