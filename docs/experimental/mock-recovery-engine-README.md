# Mock recovery engine (isolated experiment)

Run tests with Node.js (no dependencies):
`node test-mock-recovery.js`

This is a local in-memory state-machine fixture, **not a password reset implementation**.
- SMS is simulated and recorded in `mockMessages`.
- No real authentication provider, database, SMS service, or trainee records are touched.
- The mock completion method only changes this fixture's state; it does not update a password.
- The in-memory map is not concurrency-safe and must not be reused for production.
- The mock code generator uses unbiased rejection sampling; codes remain strings to preserve leading zeros.

The next gate is reviewing the implementation and fixing/expanding tests before building any UI or production integration.
