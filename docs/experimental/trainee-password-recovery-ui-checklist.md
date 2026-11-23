# Password recovery UI prototype checklist (fake data only)

## Trainee login
- Existing login fields and behavior unchanged.
- Add separate “Forgot password?” link, only in prototype.
- Prototype flow uses fake trainee accounts and the mock engine; no production credentials.
- All messages are generic until authenticated/authorized backend status exists.

## Screens
1. Request: identifier input; submit; generic confirmation.
2. Pending: status badge, short explanation, refresh/back.
3. Code: 4 separate visual slots but one string input; numeric keyboard; leading zero retained; paste; clear; countdown display is informational only.
4. New password: new + confirm, show/hide, strength/policy feedback; submit only after mock verification.
5. Result: success or generic error; return to login.

## Coach
- Fake pending request list only.
- Approve/reject actions with confirmation.
- Mask identifier.
- No real phone, password, SMS, database or trainee profile data.
- Ownership test with fake coach IDs.

## Visual and accessibility
- Persian RTL layout, existing app font/style.
- Mobile-first, responsive, buttons comfortably tappable.
- Loading, empty, pending, error, expired, rejected and success states.
- No page-jump behavior.
- Keyboard focus and labels accessible.
- Do not expose codes in the trainee-facing UI via console or debug.

## Not authorized in this experiment
- Editing production login UI.
- Connecting to Supabase or deployed functions.
- Sending SMS.
- Resetting real passwords.
- Accessing real trainee records.
- Merging or deploying.
