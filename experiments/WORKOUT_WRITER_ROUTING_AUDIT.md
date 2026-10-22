# Workout writer routing audit

Date: 2026-10-22
Branch: `coach-workout-editor-isolated-preview`
Status: read-only source review; no application, database, or trainee data changed.

## Scope inspected
- `experiments/workout-persistence-adapter.js`
- `experiments/WORKOUT_SAVE_RPC_REVIEW_CHECKLIST.md`
- Existing disposable PostgreSQL/browser workflow result recorded in GitHub Actions.

## Findings

### 1. Two distinct writers exist in the experimental adapter
`saveToSupabase()` performs separate REST requests for plan update/insert, exercise delete, and exercise insert, with compensating restoration on failure. These requests are not one database transaction.

`saveToSupabaseAtomic()` calls `save_trainee_workout_plan_transaction` and is fail-closed unless `enableAtomicRpc === true`. The atomic function call checks an expected plan snapshot before writing.

**Risk:** the expected snapshot detects stale data only when the RPC's comparison and write are protected by the RPC transaction. It does not make the legacy REST writer participate in the RPC advisory lock. Both writers must never be available for the same production save flow at the same time.

### 2. Existing-plan snapshot guard has intentional strictness
The adapter refuses replacement when the plan date is missing/invalid or the existing plan cannot be safely represented in the expected snapshot. This is safer than silently replacing a legacy record with incomplete data. Such records need a separate review path; do not auto-fill dates or rewrite them as part of the migration.

### 3. Exercise names must resolve uniquely
The adapter normalizes names and refuses to save when a movement is missing from the exercise bank or has duplicate normalized names. Preserve this fail-closed behavior; do not fall back to a guessed exercise ID.

### 4. Response validation is not a substitute for read-after-write verification
The atomic adapter validates the RPC response shape and count. Before rollout, tests should also re-read the saved plan and ordered exercise rows and compare them with the returned snapshot, especially for metadata, grouping fields, order, and completion status.

## Required routing acceptance tests

1. With atomic opt-in disabled, attempt to save: no RPC call and no writes.
2. With atomic opt-in enabled but RPC unavailable or returning an error: no legacy fallback; show a safe error and preserve the previous plan.
3. Confirm the actual experimental editor's save button invokes exactly one writer per save attempt.
4. Confirm there is no automatic retry through the legacy writer after an RPC error, timeout, malformed response, or network interruption. On uncertain outcome, reload/read the plan before another save.
5. Exercise two simultaneous editor sessions: one save succeeds; the stale session is rejected or must reload before retrying.
6. Inject failure after old exercise rows would be replaced in the disposable PostgreSQL test: transaction rolls back and previous plan and exercise rows remain unchanged.
7. Re-read saved rows and compare the ordered rows and plan metadata with the submitted payload.
8. Verify coach authorization, trainee access, RLS, and the existing exercise-update trigger in an isolated disposable fixture that models the live security behavior.
9. Test legacy plans with NULL/invalid `plan_date`: replacement fails closed and leaves all rows untouched.
10. Verify trainee-facing pages, coach dashboard, diet flows, and current production save entry points are unchanged.

## Rollout rule

Do not deploy the SQL draft or enable atomic opt-in on the live application until all routing tests pass and the actual authenticated coach/RLS/trigger integration test has succeeded in a disposable environment. If rollout is later approved, route all writes for the affected editor through one writer in a controlled release; do not keep a legacy fallback for that editor. Keep a known-good app commit and a separately reviewed RPC rollback migration. Never roll back by deleting or rewriting trainee rows.

## Current decision

**Not production-ready.** This audit records source-level constraints and test acceptance criteria only. It does not claim that all actual UI call sites have been exhaustively traced or that live authenticated integration has passed.
