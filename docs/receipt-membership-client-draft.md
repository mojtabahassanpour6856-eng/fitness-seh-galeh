# Draft client integration: exact membership per receipt

**Status: isolated prototype only. Do not merge or deploy.** This client expects the draft schema and `review_trainee_payment_receipt` RPC from PR #226, plus the coach-created membership/payment RPC from dependent PR #228. No production schema or data was changed.

## Implemented in this branch

- Adds a membership selector to the trainee receipt form. The options come from the selected trainee's membership history and show the start/end dates and amount so the trainee can choose the correct row.
- When the feature flag is enabled, a new receipt includes the selected `membership_id`.
- Coach receipt review loads the full membership history and renders the exact membership attached to each receipt. It does not infer the link from the newest membership, amount, or date.
- Legacy receipts with a NULL or invalid membership link are labelled as requiring manual reconciliation and cannot be approved through the UI.
- Receipt approval/rejection calls the atomic `review_trainee_payment_receipt` RPC. The browser keeps a stable operation UUID in sessionStorage for retry; approval creates a payment linked to the same membership and updates only that membership.
- If the client feature flag is off, receipt review fails closed rather than using the previous three-request bulk-update path.
- When the feature flag is on, the active coach `saveSubscription` handler calls `create_coach_membership_with_payment` instead of issuing separate membership and payment writes. The RPC returns the new membership/payment IDs and creates both rows in one transaction.
- The coach creation handler persists a stable operation UUID and original payload in `localStorage`. A retry after a lost response reuses the same operation. The key is cleared only after all post-save refreshes complete; if the feature flag is turned off while a pending operation exists, the legacy write path is blocked to avoid a duplicate.

## Feature flag and rollout order

`window.SEH_RECEIPT_MEMBERSHIP_LINK_ENABLED` defaults to false. It must only be set to true after:
1. PR #226's nullable-link migration and atomic receipt-review RPC have been reviewed and applied in a controlled environment.
2. PR #228's direct coach membership-plus-payment RPC is reviewed and its disposable PostgreSQL 17 workflow passes.
3. The manual reconciliation workflow for legacy NULL-linked receipts is ready.
4. The complete client is tested against a disposable database containing the exact migration set.

Do not enable this flag in production yet. With the flag off, the new selector remains hidden and receipt approval is intentionally blocked by the draft client handler. Do not deploy this client before the schema/RPC rollout is coordinated.

## Still required before release

- Complete the review and integration of PR #228's atomic coach membership/payment RPC, including browser-level retry and concurrent submission tests.
- Implement coach UI to manually reconcile a legacy receipt to a membership. Never auto-map legacy receipts. The reconciliation action must validate trainee ownership and be audited.
- Add integration tests for the browser payload contract and run end-to-end tests for trainee submission, coach review, retry after simulated network loss, rejection, concurrent review, and legacy receipts.
- Verify the selector refreshes when a trainee has no membership or multiple membership history rows.
- Keep receipt file upload online-only; do not put Storage uploads into the offline outbox.

## Safety

This branch changes only `index.html`, this document, and its syntax-check workflow. It does not change main, production Supabase, RLS, grants, Auth, Storage, existing records, or student data. The branch and its PR must remain Draft until all release gates pass.
