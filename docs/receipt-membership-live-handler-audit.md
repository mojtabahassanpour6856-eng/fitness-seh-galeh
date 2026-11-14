# Live receipt and membership handler audit — 2026-11-14

Scope: read-only review of the current `main/index.html` blob at commit `b603382e1a7c83ee0c00394ec16e8b43772f5dc1`. No application code was changed.

## Confirmed live paths

The current app keeps the relevant logic in the large root `index.html` file.

### Trainee receipt submission

- Receipt form markup is generated around byte offset 680,000.
- The form currently asks for amount, Jalali payment date, receipt file, and optional note.
- It has **no membership selector**.
- `window.submitPaymentReceipt` around byte offset 686,500 uploads the file to the `payment-receipts` Storage bucket and inserts a row into `trainee_payment_receipts`.
- The insert currently writes `trainee_id`, `submitted_by`, `receipt_path`, `amount`, `payment_date`, `note`, and `review_status='pending'`; it does not write `membership_id`.
- Storage upload and metadata insert are separate operations; a best-effort object removal is attempted if metadata insertion fails. Storage remains online-only.

### Trainee membership display

- `loadTraineeMembershipCore` around byte offset 681,500 fetches membership history ordered newest-first, but displays `members[0]` as the current membership.
- Receipt history currently selects only `id,receipt_path,amount,payment_date,note,review_status,created_at`; it cannot display which membership a receipt belongs to.
- Pending state is currently inferred from any pending receipt or the newest membership's pending payment status.

### Coach receipt review

- `loadCoachReceipts` around byte offset 688,900 fetches all receipts for the selected trainee, but fetches only the newest membership row with `limit=1`.
- The review card displays that newest membership's dates and amount above every receipt, which can visually imply that all receipts belong to the same membership.
- Each pending receipt currently offers approve/reject buttons without showing a membership association.

### Unsafe approval handler

- `window.reviewPaymentReceipt` around byte offset 692,900 reads the selected receipt.
- On approval it first inserts a row into `trainee_payments` with no membership reference.
- It then updates **every** row in `trainee_memberships` for that trainee to `status='active', payment_status='paid'`.
- It then marks the receipt approved.
- These are three separate requests, not one transaction. A failure or retry can leave partial state or duplicate payment rows.
- The bulk membership update directly conflicts with the coach-confirmed rule that each payment must settle exactly its own membership.

## Membership creation path

There are two `saveSubscription` definitions/wrappers in the large page. The active later wrapper around byte offset 369,500 validates the form, calls `ensureMembershipCardNumber`, then POSTs a new `trainee_memberships` row. When paid and amount > 0 it separately POSTs a `trainee_payments` row. The membership insert response is not retained in this wrapper. This means the new receipt workflow must load membership history and require the trainee to explicitly select the target row; it must not assume the latest row is always the target.

## Required client changes after schema and RPC are ready

1. Fetch all permitted membership rows for the signed-in trainee, including `id,start_date,end_date,amount,payment_status,status,card_number`.
2. Show a required membership selector in the trainee receipt form. Include enough details to distinguish overlapping/history rows (dates, amount, card number, status).
3. Submit the selected `membership_id` with receipt metadata only after the database migration is deployed.
4. Show the exact linked membership beside every receipt in coach review; display legacy NULL links as **نیازمند تطبیق دستی** and do not offer automatic approval.
5. Update the active `saveSubscription` path as well as receipt review: retain the returned membership row ID from the insert, attach it to any coach-recorded payment, and replace the fragile sessionStorage retry marker with an operation UUID tied to that membership. Do not create a payment row without its membership ID after the migration is enabled.
6. Replace the three direct writes in `reviewPaymentReceipt` with one authenticated RPC call. The new schema should also link the payment to its originating receipt and enforce one payment per receipt with a partial unique index. The RPC must lock and authorize the receipt, validate the linked membership belongs to that trainee, create one payment with the same membership ID, update only that membership, and mark the receipt reviewed atomically.
7. Refresh the trainee membership and coach history views after the RPC succeeds.
8. Preserve rejection behavior as terminal with no payment row and no membership status change.

## Rollout guardrails

- Do not ship client code that writes `membership_id` before the column exists.
- Do not ship the RPC caller before the RPC is deployed and permission-tested.
- Do not keep a fallback to the old bulk-update approval handler once the new path is enabled.
- Do not auto-link legacy receipts by amount, date, latest membership, or row order.
- Keep changes behind a disabled-by-default feature gate until schema, RPC, UI, and tests are deployed in a coordinated sequence.
- No production data, app runtime, Auth, RLS, grants, Storage, or database objects were modified by this audit.
