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
