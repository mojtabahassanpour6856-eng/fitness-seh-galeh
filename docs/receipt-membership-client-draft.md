# Draft client integration: exact membership per receipt

**Status: isolated prototype only. Do not merge or deploy.** This client expects the draft database migration and `review_trainee_payment_receipt` RPC from PR #226. No production schema or data was changed.

## Implemented in this branch

- Adds a membership selector to the trainee receipt form. The options come from the selected trainee's membership history and show the start/end dates and amount so the trainee can choose the correct row.
- When the feature flag is enabled, a new receipt includes the selected `membership_id`.
- Coach receipt review loads the full membership history and renders the exact membership attached to each receipt. It does not infer the link from the newest membership, amount, or date.
- Legacy receipts with a NULL or invalid membership link are labelled as requiring manual reconciliation and cannot be approved through the UI.
- Receipt approval/rejection calls the atomic `review_trainee_payment_receipt` RPC. The browser keeps a stable operation UUID in sessionStorage for retry; approval creates a payment linked to the same membership and updates only that membership.
- If the client feature flag is off, receipt review fails closed rather than using the previous three-request bulk-update path.
- When the feature flag is on, the old direct coach path for creating a paid membership is blocked until a dedicated atomic membership-plus-payment RPC is implemented. This avoids creating a payment without a membership reference.

## Feature flag and rollout order

`window.SEH_RECEIPT_MEMBERSHIP_LINK_ENABLED` defaults to false. It must only be set to true after:
1. PR #226's nullable-link migration and atomic receipt-review RPC have been reviewed and applied in a controlled environment.
2. The direct coach membership-plus-payment RPC is implemented and tested.
3. The manual reconciliation workflow for legacy NULL-linked receipts is ready.
4. The complete client is tested against a disposable database containing the exact migration set.

Do not enable this flag in production yet. With the flag off, the new selector remains hidden and receipt approval is intentionally blocked by the draft client handler. Do not deploy this client before the schema/RPC rollout is coordinated.

## Still required before release

- Implement a separate atomic RPC for coach-created membership + optional payment, returning the newly created membership ID and linking the payment to it. It must have actor/trainee authorization, operation UUID idempotency, payload mismatch protection, and tests for paid, unpaid, zero-amount, replay, and failure rollback.
- Implement coach UI to manually reconcile a legacy receipt to a membership. Never auto-map legacy receipts. The reconciliation action must validate trainee ownership and be audited.
- Add integration tests for the browser payload contract and run end-to-end tests for trainee submission, coach review, retry after simulated network loss, rejection, concurrent review, and legacy receipts.
- Verify the selector refreshes when a trainee has no membership or multiple membership history rows.
- Keep receipt file upload online-only; do not put Storage uploads into the offline outbox.

## Safety

This branch changes only `index.html` and this document. It does not change main, production Supabase, RLS, grants, Auth, Storage, existing records, or student data. The branch and its PR must remain Draft until all release gates pass.
