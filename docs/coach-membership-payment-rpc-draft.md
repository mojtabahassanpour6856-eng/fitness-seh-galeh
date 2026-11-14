# Atomic coach membership + payment RPC — draft

**Status: isolated prototype only. Do not merge, deploy, or apply to production.**

This draft adds the missing server-side transaction for the active coach flow in `index.html`.

## Confirmed existing client behavior

The active `window.saveSubscription` wrapper currently:
1. Validates the start/end dates and amount.
2. Calls `ensureMembershipCardNumber(traineeId)` to ensure a card number exists in the separate `trainee_membership_cards` table.
3. Inserts `trainee_memberships` with `start_date`, `end_date`, `status='active'`, `amount`, `payment_status` (`paid` or `unpaid`), and `description='عضویت باشگاه'`.
4. If marked paid, separately inserts `trainee_payments` with the same trainee and amount, but without a membership reference.

The two financial writes are separate requests. A failure between them can leave a membership without its payment, and a retry can create a duplicate membership or payment.

## Draft RPC contract

File: `supabase/drafts/20261114000300_create_coach_membership_with_payment_rpc.sql`

Function:
`public.create_coach_membership_with_payment(uuid, uuid, date, date, numeric, text, date)`

Inputs:
- trainee ID
- stable operation UUID
- membership start and optional end date
- membership amount
- payment status (`paid`, `unpaid`, or `pending`)
- optional payment date

Behavior:
- Requires a signed-in user whose `profiles.role='coach'`.
- Verifies the trainee's `coach_user_id` equals the authenticated user and locks that trainee row.
- Creates exactly one membership row with the same fields used by the current active handler.
- If payment status is `paid`, requires a positive amount and creates exactly one payment row linked to the returned `membership_id`.
- If unpaid/pending, creates no payment row.
- Creates membership and payment in one Postgres transaction; any error rolls both back.
- Uses a private operation ledger keyed by actor + operation UUID. Replaying the same payload returns the original membership/payment IDs. Reusing the UUID with changed values fails.
- Revokes public/anon execution and grants only to authenticated callers. The function uses an empty pinned search path and schema-qualified database objects.

The separate membership-card-number helper remains a preflight step for now. It does not write a payment or membership row; the atomic boundary covered here is the membership plus its optional payment. The later client wiring must retain the same operation UUID after a network timeout and must not fall back to the old two-write path when the feature is enabled.

## Isolated tests

`tests/coach-membership-payment-rpc.integration.sql` runs against a disposable PostgreSQL 17 service with synthetic records only. It covers:
- paid membership creates one payment linked to the exact new membership;
- replay returns the original IDs without duplicates;
- unpaid membership creates no payment;
- changed payload under the same operation UUID is rejected;
- coach cannot create a membership for another coach's trainee;
- paid with zero amount is rejected;
- injected payment-insert failure rolls back the membership and operation ledger, and the same operation can then be retried.

The test fixture is extended only with membership columns needed to mirror the live schema. No production Supabase schema, RLS, grants, Auth, Storage, or trainee records are changed.

## Remaining release gates

1. Run this workflow and inspect the actual PostgreSQL test result.
2. Wire the active coach `saveSubscription` handler to this RPC behind the existing disabled feature flag; keep the card-number preflight and refresh calls.
3. Preserve operation UUID and payload across retry; clear it only after confirmed success.
4. Add browser-level tests for paid, unpaid, offline retry, and double-click/concurrent submission.
5. Finish manual reconciliation UI for legacy receipts.
6. Review Supabase Security Advisors and test function privileges on the disposable environment before any deployment.

Do not enable `SEH_RECEIPT_MEMBERSHIP_LINK_ENABLED` or apply any draft SQL to production.
