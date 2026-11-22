# Recovery authorization, password update, and session invalidation

Status: production design requirements only. No live auth integration or session changes are implemented by this document.

## Trusted identity boundaries
1. The public request endpoint accepts only minimum user input (for example a normalized phone number). It must not accept traineeId, coachId, role, account status, or destination phone as authority.
2. The server resolves the account from a verified phone mapping and stores the internal trainee ID.
3. The server resolves the current coach assignment from trusted records. A client cannot choose or override the coach.
4. At coach review/approval time, re-check that the authenticated coach is still authorized for that trainee. A coach assignment changed after request creation must not leave the former coach authorized by stale request metadata unless an explicit, audited policy says otherwise.
5. Every read and state transition is scoped by authenticated actor and server-side ownership. Guessing a request ID must not reveal whether another user's request exists.

## Password update boundary
- Code verification alone must not change the password.
- After successful code verification, issue a short-lived, single-use reset grant bound to the same trainee, recovery request, and authentication transaction.
- The grant must not be a general access token and must not permit profile, training, nutrition, payment, or other account operations.
- The final password update must use the authentication provider's supported recovery/update API in a trusted server-side flow. Never update auth tables, password hashes, or privileged records directly.
- Enforce password policy on the server; never log or persist plaintext password.
- Consume the reset grant atomically with successful password update. Replays and concurrent submissions must fail safely.
- If the provider response is ambiguous (timeout after request may have succeeded), verify state through supported provider mechanisms or require a fresh recovery flow; do not blindly retry an operation that may have already changed credentials.

## Session and token invalidation
- On successful password change, revoke all refresh tokens/sessions for that user where the provider supports it.
- If global revocation is unavailable, document exact residual session lifetime and use the shortest safe access-token lifetime; do not claim all sessions are invalidated.
- Revoke the recovery grant and all outstanding recovery codes/requests for that account.
- Notify the account's verified contact that the password changed, without including the password or recovery code.
- Record a minimal security audit event (actor, user reference, time, outcome, correlation ID) without credentials, codes, full phone number, or password.
- A failed password update must not mark the recovery flow COMPLETED.

## Mandatory integration tests
1. Tampered client traineeId/coachId cannot change the resolved account or coach.
2. Coach reassignment between request and approval is handled according to current server-side assignment.
3. Coach A cannot inspect or approve a request after trainee ownership moves to Coach B unless explicitly authorized.
4. A verified code cannot be used as a normal login token or general API bearer token.
5. Reset grant is scoped to one trainee and one recovery transaction, expires, and is single-use.
6. Password update calls only the supported auth-provider API.
7. Provider failure leaves recovery incomplete; ambiguous timeout is handled without unsafe duplicate update.
8. Successful password update revokes sessions/refresh tokens to the extent provider supports and invalidates outstanding recovery grants.
9. Old password behavior and session revocation are tested on real test accounts in an isolated environment.
10. No logs, analytics, or client errors contain plaintext password, code, reset grant, or full phone number.

## Current mock limitations
The current MockRecovery fixture accepts identity values as function arguments and its complete() method only changes an in-memory state. It has no authentication middleware, trusted account/coach directory, reset grant, password provider, session store, or revocation mechanism. It therefore cannot validate any of the requirements above. Never expose this fixture as an endpoint or use it to change a real password.

## Coach reassignment race
- Resolve the authenticated coach from the server-side session; never accept an actor identity from the request body.
- Resolve the trainee's current coach assignment from the authoritative database when the request is created and re-check it immediately before approval/rejection and before any SMS dispatch.
- If assignment changed after request creation, fail closed: invalidate the stale request, do not send a code, and require a new request under the current coach. Do not silently transfer approval authority to a different coach.
- Tests must cover reassignment between request and approval, reassignment between approval and dispatch, and cross-coach access after reassignment.

## Authenticated-context transition adapters (mock only)
The experimental fixture now provides wrappers for coach approval/rejection and trainee verification/completion/cancellation. Each wrapper expects the actor ID to have been resolved by trusted server middleware and normalizes missing-request and wrong-owner failures to a generic unavailable response. These wrappers are test seams, not authentication middleware: production must not accept actor IDs from request JSON, and must enforce ownership atomically in persistent storage for every transition.
