# Health-file upload failure test plan

Status: test-design only. This document adds no runtime code, SQL, migrations, policies, or Storage operations.

## Purpose

Prepare deterministic tests for the current `TRAINEE_HEALTH_REPORT_V1` upload path and the proposed durable cleanup lifecycle. Tests must distinguish the original business-operation failure from a later cleanup failure. A successful cleanup must never be inferred from a resolved promise alone.

## Test boundary and environment

- Use a local fake Supabase client / deterministic adapter first. Do not point failure-injection tests at the live project.
- Use synthetic coach, trainee, and object identifiers only.
- Use an isolated test bucket/project only after the mock suite passes and a separate test environment is confirmed.
- Never upload, overwrite, or delete any of the four unidentified legacy objects.
- Never use real trainee health documents as fixtures.
- Never expose a service-role key to browser tests.
- Do not alter the payment-receipt upload path in this workstream.

## Required observable events

Each test records an ordered event log with: intent creation, Storage upload attempt/result, injury-row insert/transaction attempt/result, Storage remove attempt/result, job state/attempt count, and surfaced error. Assertions must inspect both returned Supabase `error` values and thrown exceptions.

## Deterministic failure matrix

| ID | Injected condition | Expected result | Must never happen |
|---|---|---|---|
| HUP-01 | Cleanup intent insert returns error | Upload is not attempted; error is surfaced | Storage object or injury row created |
| HUP-02 | Storage upload returns `{ error }` without throwing | Upload is treated as failed; no injury row is inserted | False success / reference row |
| HUP-03 | Storage upload throws | No injury row; error is surfaced | Unhandled rejection or false success |
| HUP-04 | Upload succeeds; injury insert returns error; remove succeeds | Original insert error remains primary; exact uploaded path is removed or queued for worker cleanup | Other object paths touched |
| HUP-05 | Upload succeeds; injury insert returns error; remove resolves with `{ error }` | Cleanup failure is recorded visibly; intent remains retryable / manual-review eligible | Cleanup reported as successful |
| HUP-06 | Upload succeeds; injury insert returns error; remove throws | Thrown cleanup error is recorded; original insert error remains available as cause/context | Cleanup exception silently swallowed |
| HUP-07 | Injury insert commits but retained-state transition fails | Transaction rolls back both, or a single atomic RPC prevents split state | A committed row paired with a deletable pending job |
| HUP-08 | Client retries same logical upload after timeout | Idempotency key prevents duplicate row/object; retry returns deterministic result | Duplicate medical attachment rows |
| HUP-09 | Same cleanup request delivered twice | Second execution is idempotent and does not damage unrelated data | Duplicate deletion side effects |
| HUP-10 | Referencing row exists at worker check | Worker does not remove object; job is retained or escalated | Referenced object deleted |
| HUP-11 | Reference query errors / inventory incomplete | Job enters manual review; no Storage remove call | Fail-open deletion |
| HUP-12 | Storage remove returns error or throws on worker attempt | Attempt/error persisted; bounded retry/backoff; eventual manual review | Infinite retry or silent completion |
| HUP-13 | Object is already absent | Complete only after full reference check; record absent-object outcome | Treat absence as proof of no references |
| HUP-14 | Malformed path, wrong bucket, traversal segment, foreign owner/trainee path | Reject before Storage operation | Arbitrary path deletion |
| HUP-15 | Trainee row is deleted after intent creation | Cleanup intent remains because it has no cascading trainee FK | Intent disappears in cascade |
| HUP-16 | Two workers claim same eligible job concurrently | Exactly one lease owner can perform the removal | Two active deleters for one job |

## Core invariants

1. The browser never calls Storage removal as the only durable cleanup mechanism.
2. A returned `{ error }` is a failure even when the promise resolves.
3. A thrown exception is a failure and is captured with sanitized diagnostics.
4. Cleanup targets only the exact bucket/path recorded by a trusted intent.
5. A reference lookup error is a hard stop (manual review), never permission to delete.
6. A successful business-row write and transition to `retained` are atomic.
7. `retained` cannot automatically transition back to `pending`.
8. Retry uses a stable idempotency key and bounded attempts.
9. Job rows survive trainee deletion and registration-rejection cascades.
10. Payment receipts remain outside this test suite.

## Test implementation sequence

### Phase A — pure mocked tests (first)

Implement a small injectable adapter around the upload/insert/cleanup orchestration. The adapter exposes methods returning Supabase-shaped results and can also throw. Use Node's built-in test/assert libraries and no network credentials. Verify HUP-01 through HUP-09 and event ordering.

### Phase B — worker state-machine tests

Once the server-side worker design is selected, test claims, leases, reference checks, retries, idempotency, invalid paths, and trainee-cascade independence against a disposable local database / mocked Storage adapter. Verify HUP-10 through HUP-16.

### Phase C — isolated Supabase integration

Only after a separate non-production Supabase project/bucket is positively identified and credentials are scoped to it:
- create synthetic rows and uniquely prefixed objects;
- inject upload/insert/remove failures through a test adapter or controlled endpoint;
- verify object and row state after each case;
- clean up only the synthetic fixture prefix created by that test run;
- retain logs with IDs and outcomes, never health-file contents.

No live-production failure injection is permitted.

## Exit criteria before runtime implementation

- Every applicable HUP case passes in the mock suite.
- Worker state-machine tests pass.
- Integration tests run only against a confirmed disposable environment.
- The reference inventory covers all current and historical health-file pointer formats and all tables that may reference the bucket.
- The transaction boundary and worker deployment mechanism are verified against current Supabase capabilities.
- A reviewer confirms that no payment code, trainee data, legacy object, live policy, or production Storage object is touched.

Until all exit criteria are met, PR 237 and this test-plan branch remain draft-only.