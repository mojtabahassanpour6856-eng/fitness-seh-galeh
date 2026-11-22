# Password recovery UX flow — experimental

## Scope and hard boundary
Design only. No production UI, auth-provider calls, database writes, SMS sends, trainee data access, or existing-login modifications. All test identities and values are fake.

## Trainee screen states
1. **Entry** — a “Forgot password?” action on the trainee login screen; it must not change the coach login.
2. **Request form** — request using the account's registered identifier (prefer phone if already the app's established login identifier). UI wording must not confirm whether an account exists; show a generic “If the account is eligible, the request will be sent to its coach.”
3. **Pending** — show that the request is waiting for coach review; allow leaving the screen and returning. Avoid exposing sensitive coach details.
4. **Rejected** — neutral message and next step to contact the gym/coach; no revealing internal rejection reason.
5. **Code entry** — four digits as a string (leading zeros retained), numeric keyboard, paste allowed, no auto-submit until four digits; generic incorrect/expired message; remaining attempts and expiry must be server-authoritative.
6. **New password** — only after verified code; show password and confirm fields, reveal toggle, app's existing password policy, mismatch prevention. Do not accept traineeId/requestId from client as authorization.
7. **Success** — confirm reset and return to login; never auto-login unless the existing auth provider securely supports it. Old password must stop working via the authoritative auth service.
8. **Expired/locked** — explain code/request expiry or attempts exceeded, and provide a safe path to start again subject to server cooldown.

## Coach queue
- Pending recovery requests appear only to the authenticated coach who owns the trainee.
- Each row shows minimal context (request time, masked trainee identifier, status); no full phone in list.
- Actions: Approve, Reject. Confirmation before reject; approve confirmation warns that a code will be issued.
- Once acted on, disable action buttons and refresh state from authoritative server. Repeated clicks must be idempotent.
- Never allow coach to search or reset accounts outside their own roster.

## Security and abuse protections
- Generic request response to prevent account enumeration.
- Server-side rate limits per account, IP/device signal where privacy policy permits, and global service limits.
- Coach ownership check on every request and action.
- Codes: 4 digits only if accompanied by short expiry, strict attempts, cooldown, one-time use, and secure server generation. Never log code, password, or full identifier.
- Request identifiers are opaque; client must not be trusted for trainee, coach, ownership, or status.
- CSRF/session protections for browser context and secure transport.
- Password change must happen through the existing identity provider, never through a mock or direct database update.
- Notifications should avoid including code in coach-facing UI or logs; code is delivered only to the registered contact after approval.
- Avoid account enumeration via different messages, response timing, or status endpoint.

## Suggested screen copy (Persian)
- Login link: «فراموشی رمز عبور؟»
- Request: «درخواست بازیابی رمز را ثبت کنید. پس از بررسی مربی، راهنمای ادامه برای شما ارسال می‌شود.»
- Generic submission: «اگر درخواست شما قابل بررسی باشد، مراحل بعدی ارسال خواهد شد.»
- Pending: «درخواست شما ثبت شده و منتظر بررسی مربی است.»
- Code: «کد چهاررقمی ارسال‌شده را وارد کنید.»
- Wrong/expired: «کد معتبر نیست یا زمان آن به پایان رسیده است. در صورت نیاز، درخواست جدید ثبت کنید.»
- New password: «رمز جدید» / «تکرار رمز جدید»
- Success: «رمز عبور با موفقیت تغییر کرد. اکنون با رمز جدید وارد شوید.»
- Rejected: «درخواست بازیابی تأیید نشد. برای راهنمایی با مربی یا باشگاه تماس بگیرید.»

## Acceptance criteria before implementation
- Existing coach/trainee login, sessions, and records remain unchanged.
- Mock flow is visually separate and cannot reach production credentials.
- Coach queue is scoped server-side to coach ownership.
- Approval/rejection is authenticated, authorized, and auditable without sensitive data.
- Code and password never appear in logs, analytics, or coach queue.
- Verify code then set password is a server-enforced sequence; verify and reset are atomic or use a short-lived reset token.
- Test cases include double-click approve/reject, race conditions, expired requests, resend/cooldown, attempts, leading-zero code, cross-coach access, unknown account, and mobile layout.
- No merge/deployment until manual review and explicit approval.
