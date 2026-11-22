# Mock recovery engine (isolated experiment)

Run tests with Node.js (no dependencies):
`node test-mock-recovery.js`

This is a local in-memory state-machine fixture, **not a password reset implementation**.
- SMS is simulated and recorded in `mockMessages`.
- No real authentication provider, database, SMS service, or trainee records are touched.
- The mock completion method only changes this fixture's state; it does not update a password.
- The in-memory map is not concurrency-safe and must not be reused for production.
- The mock code generator uses unbiased rejection sampling; codes remain strings to preserve leading zeros.

The experimental default validity window is 24 hours (86400000 ms), matching the requested policy. This is only a fixture setting; production expiry must be enforced server-side.

The next gate is reviewing the implementation and fixing/expanding tests before building any UI or production integration.


## Pending-request cancellation
The mock supports trainee cancellation only while a request is still `REQUESTED`. Ownership is checked against the trainee ID supplied to the fixture; in production this identity must come from the authenticated session, not client input. Cancellation does not send SMS and cannot cancel a code already issued. The fixture has no real delivery retry logic or provider acknowledgement.

## Mock delivery failure and retry cap
`approve()` accepts a simulated delivery callback. If it reports failure, no code digest is stored and state remains `APPROVED`, allowing a controlled retry. `maxDeliveryAttempts` defaults to 3 total attempts (initial delivery included). After the limit, another attempt throws and does not call the delivery callback. Successful delivery transitions to `CODE_ISSUED` and subsequent approvals are idempotent. This is only simulated behavior; production needs provider response handling, retry scheduling/backoff, delivery idempotency, and delivery-status callbacks where supported.


## Re-entrant approval guard
The fixture now marks delivery as `DELIVERY_PENDING` before invoking the synchronous mock delivery callback. A nested/re-entrant approval cannot proceed from that state, preventing duplicate mock code issuance in this narrow fixture. This is **not** a concurrency primitive for production: asynchronous workers, parallel server instances, and database races must be protected with transactional state transitions, row locks or compare-and-swap, and an idempotency key enforced by persistent storage.


Delivery callback exceptions are also handled in the fixture: the request returns to `APPROVED`, records failure, clears code digest/expiry, and may retry within the configured attempt limit. The thrown exception text is not exposed in the mock result. A test covers retry after a callback throws.


## Stale request expiry
The fixture adds a default 24-hour `requestTTLms` for requests left in `REQUESTED` or `APPROVED` after failed delivery. `sweepExpired()` marks stale requests as `EXPIRED`, clears code digest/expiry, and returns the count. It runs opportunistically when a new request, approval, or verification is attempted; it is not a background scheduler. A separate 24-hour code validity window remains for `CODE_ISSUED`. Tests cover expiration of both pending states and that a new recovery can then begin. Production should use server-side scheduled cleanup plus state checks at every operation, not rely on client activity.


## Recovery request rate limit
A rolling-window limit is added per trainee (default: at most 3 requests in 24 hours), alongside the short cooldown and single-active-request guard. Expired timestamps are pruned when a new request is evaluated. The limit applies even if prior requests were rejected or cancelled, reducing repeated coach notifications. Tests cover hitting the cap and allowing a new request after the window rolls off. Production enforcement must be server-side and based on authenticated trainee identity; consider abuse monitoring and account/IP/device signals without exposing account existence.


## Privacy and account-enumeration gate
See `recovery-privacy-acceptance.md` for the public response contract, server-side identity resolution, verified-phone delivery requirements, coach authorization, abuse controls, and production acceptance tests. The current mock has no account lookup or HTTP layer and cannot demonstrate resistance to account enumeration. Do not connect this fixture directly to a public endpoint.


## Expiry enforcement on every pending-state action
The fixture now calls `sweepExpired()` before trainee cancellation and coach rejection as well as request creation, coach approval, and code verification. This prevents a stale `REQUESTED` item from being cancelled/rejected as if it were still live after its TTL. Tests cover both terminal-action paths. The fixture still performs opportunistic cleanup only; production must check expiry atomically inside every state-changing transaction and run scheduled cleanup.


## Verification lockout cleanup
When the configured failed-code attempt limit is reached, the fixture now transitions to `EXPIRED` and immediately clears both the stored code digest and expiry timestamp. Tests assert this cleanup for repeated wrong codes. This is a mock-state hygiene guarantee only; production must make lockout and digest cleanup atomic in persistent storage.


## Active-flow isolation and state encapsulation
The fixture now treats `APPROVED` and `DELIVERY_PENDING` as active states when preventing parallel requests, and includes `DELIVERY_PENDING` in pending-request expiry cleanup. `request()` returns a shallow snapshot rather than the mutable internal record. Tests cover a second request during a re-entrant delivery callback and mutation of the returned snapshot. This remains single-process mock behavior; production needs database-enforced uniqueness and atomic transitions.
