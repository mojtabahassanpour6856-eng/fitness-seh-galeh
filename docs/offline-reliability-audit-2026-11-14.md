# Offline reliability audit — 2026-11-14

## Scope and safety boundary

- Audited the current `main` snapshot at commit `23df7a441eaefa1dd4c4656f605a0e3f8c206a29`.
- Read-only inspection of application code, service worker, tests, and tracked SQL migrations.
- No production code, database rows, Supabase settings, RLS policies, or Storage objects were changed.
- A migration file in the repository is not evidence that it has been applied to the connected Supabase project. Deployment status must be checked separately before any schema-dependent implementation.

## Confirmed current behavior

1. `sbWrite(path, method, body)` sends a direct REST request and returns the response. It does not attach a durable operation ID, idempotency key, or persistent outbox record.
2. The service worker caches a constrained same-origin app shell and static assets. Its tests explicitly verify that Supabase API requests, unknown dynamic paths, and POST requests bypass the cache. This is correct for avoiding accidental caching of private API data, but it does not make writes offline-capable.
3. The only confirmed application `localStorage` persistence found in the inspected main bundle is for user-created meal recipes. It is not an authenticated, per-user write queue. No IndexedDB-backed outbox was found in the inspected main bundle.
4. The app has multiple independent write paths. A global offline queue must not intercept all writes indiscriminately.

## High-priority write paths and risks

| Area | Current observed pattern | Reliability concern |
|---|---|---|
| Manual progress | Client writes `weight_logs`, then separately writes `body_analyses` in multiple handlers | A disconnect between requests leaves a partial record. A progress RPC migration exists in the repo, but the inspected main bundle does not call `/rpc/record_trainee_progress`. |
| Membership + payment | Membership row is created, then payment row is created in a second request in several flows | A timeout or disconnect can leave membership without its corresponding payment; blind retry can duplicate either row. |
| Membership card number | Client reads existing numbers, generates a candidate, checks collision, then inserts | Read-then-insert race; uniqueness must be enforced by the database and retries must verify the existing row. |
| Workout editor | Several direct REST write paths; one path submits a selected movement group as a multi-row insert and validates returned rows | A multi-row insert is better than per-row writes but does not make the whole multi-step editing flow atomic. A full-plan atomic RPC migration exists in the repository; integration/deployment must be verified. |
| Nutrition builder | Main bundle calls `/rpc/save_coach_nutrition_builder_plan` | This is the strongest existing atomic-save pattern. The migration is tracked in the repo; confirm it is deployed and its overload resolves correctly before depending on it. |
| Water/activity/fasting/notes/goals/supplements/injuries/food logs | Independent POST/PATCH/DELETE requests | These need per-operation retry policy and server-side deduplication before any automatic replay. |
| Body-analysis files/receipts | Database metadata and Storage uploads are separate concerns | Must not replay file upload or metadata blindly; use a staged upload protocol and verify object existence/ownership. |

## Existing SQL assets discovered

- `supabase/migrations/202610220001_save_trainee_workout_plan_atomic.sql`: transactional workout-plan replacement with coach and trainee access checks.
- `supabase/migrations/202611030001_save_coach_nutrition_builder_atomic.sql`: coach-only atomic nutrition-builder save, preserving previous plans as inactive history.
- `supabase/migrations/202611130001_atomic_trainee_progress_rpc.sql`: `record_trainee_progress` uses SECURITY INVOKER, validates the active trainee owner, and attempts to fill missing halves of a prior two-table write.

Important review note for the progress RPC: its deduplication key is effectively trainee + date + rounded weight, not a client-generated operation ID. If the same trainee legitimately records the same weight/date with corrected measurements, the current function can treat it as an already-existing manual record and not update the changed measurements. Do not adopt this RPC as the generic offline idempotency mechanism without revising its contract and tests.

## Identity and isolation requirements for a future outbox

Every queued operation must be bound to:
- Supabase project/environment identifier;
- authenticated Supabase user ID (`auth.uid()`);
- resolved application role;
- trainee ID, when applicable;
- operation ID generated once at the moment of user submission;
- schema/version and operation type.

Before replay:
1. Obtain a fresh authenticated session; never store access or refresh tokens in the outbox.
2. Require the same authenticated user and expected role. If the account differs, quarantine the item; never replay it under the new account.
3. Re-check server authorization/RLS. Client-side trainee ownership checks are defense-in-depth only.
4. Send the original operation ID unchanged. The server must enforce uniqueness in a durable idempotency ledger scoped to user + operation type, and return the original result on retry.
5. Mark an item complete only after the server returns a definitive committed result and the client verifies the returned operation ID/result.
6. Treat timeouts, connection resets, browser termination, and ambiguous 5xx responses as UNKNOWN, not FAILED. Query operation status before replay.
7. Never automatically replay destructive deletes, payment/receipt operations, or multi-step file workflows until each has a purpose-built server contract.

## Proposed outbox state machine

- `draft`: local form draft only; not yet submitted.
- `queued`: validated payload persisted in IndexedDB and bound to the current account.
- `sending`: lease acquired by one sync worker/tab.
- `committed`: server confirmed operation ID and result.
- `retry_wait`: definite transient failure; exponential backoff with jitter.
- `unknown`: outcome ambiguous; status lookup required before replay.
- `blocked_auth`: user/session mismatch or expired session; wait for re-authentication.
- `blocked_validation`: permanent validation or authorization failure; user action required.
- `cancelled`: cancelled before send only. Once sending begins, cancellation cannot imply rollback.

Use a unique local key on operation ID, a lease/lock to prevent two tabs sending the same item, and a bounded retention period. Encrypt sensitive queued payloads where feasible, minimize stored fields, and clear/quarantine account-scoped records on logout or account switch. Do not cache private API responses in the service worker.

## Recommended implementation order

1. Finish the write-path inventory, including every upload, RPC, and direct REST mutation.
2. Confirm which SQL migrations are deployed in a disposable Supabase branch; inspect relevant RLS and constraints read-only first.
3. Define a server-side idempotency ledger and status RPC. Do not rely on client-only UUIDs.
4. Convert one low-risk, single-row operation (for example a trainee water log) end-to-end in an isolated test branch, including account switching, two tabs, timeout-after-commit, and browser restart tests.
5. Convert multi-table operations to purpose-built transactional RPCs before queueing them.
6. Add IndexedDB outbox and visible states only after server idempotency is proven.
7. Keep `main` unchanged until offline, duplicate, ownership-isolation, and regression suites pass.

## Explicit non-goals for this audit branch

- No implementation of offline writes.
- No changes to the production Supabase project or migrations.
- No broad caching of API responses.
- No automatic replay of payments, membership changes, body-analysis imports, or Storage uploads.
