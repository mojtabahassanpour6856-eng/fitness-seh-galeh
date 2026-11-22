# Experimental Trainee Password Recovery — Safety Design

Status: design-only, isolated experiment. No production integration.

## Goals
- Allow a trainee to request password recovery for their own account.
- Route the request to the correct coach for approval.
- After approval, deliver a short-lived one-time code through a mock SMS adapter only.
- Permit a password reset only after verifying the code and ownership.
- Preserve existing coach and trainee sign-in behavior.

## Explicit non-goals
- No real SMS provider or credentials.
- No changes to Supabase production schema, auth settings, RLS, Edge Functions, or live trainee data.
- No merging, deployment, or changes to main.

## Proposed state machine
REQUESTED -> APPROVED -> CODE_ISSUED -> VERIFIED -> COMPLETED
REQUESTED -> REJECTED
APPROVED/CODE_ISSUED -> EXPIRED
Any state may be CANCELLED only by a narrowly authorized action.

Transitions must be server-authoritative, atomic, and idempotent. Client-side state alone must never authorize a reset.

## Security requirements
1. Bind each recovery request to trainee identity and their owning coach; validate ownership server-side.
2. Generate codes using cryptographically secure randomness with unbiased sampling; preserve leading zeroes as strings.
3. Store only a keyed digest of the code, never plaintext. Use a secret held outside the database and app bundle.
4. Enforce expiration, single-use consumption, bounded attempts, resend cooldown, and request rate limits.
5. Invalidate prior codes when a new code is issued; late SMS/mock delivery for an old request must not revive it.
6. Use atomic compare-and-set/transaction semantics for approval, verification, and completion; reject duplicate/replayed actions.
7. Avoid account enumeration: trainee-facing responses should not reveal whether a phone/account exists.
8. Do not log codes, new passwords, phone numbers, tokens, or sensitive payloads.
9. Coach approval must require an authenticated coach session and ownership check; never trust trainee-supplied coach IDs.
10. Password reset must use a supported server-side authentication flow; do not write password hashes or privileged auth records directly from client code.

## Mock SMS adapter
- Writes messages only to test output/in-memory fixtures.
- No external network, real phone number, credentials, or provider SDK.
- Clearly mark test messages as MOCK.
- Tests must assert that the mock adapter is the only delivery path.

## Required tests
- Request ownership and cross-coach denial.
- Approval/rejection permissions.
- Code generation boundaries and leading zero.
- Expiry, attempt limits, cooldown, and resend behavior.
- Old code invalidation and late delivery handling.
- One-time verification and replay/duplicate completion denial.
- Concurrent requests and approval/verification races.
- Offline, timeout, and ambiguous responses with safe retry.
- Account-enumeration response parity.
- Mock-only SMS assertion and no production side effects.

## Acceptance gate
Implementation cannot proceed to production integration until design review, isolated test suite, and manual phone testing are complete. Any production schema or auth change requires a separate reviewed migration plan and explicit approval.
