# Workout-plan concurrency release gate

Status: **NOT PASSED**. This document defines what must be proven before the atomic-save RPC can be considered release-ready. It does not authorize a production migration.

## Current guarantees in the draft

- The RPC is SECURITY INVOKER; caller grants and RLS continue to apply.
- It takes a transaction-scoped advisory lock keyed by trainee ID.
- It checks the expected plan ID and compares the caller's preview snapshot with the current plan and ordered exercise rows.
- The draft locks existing exercise rows before constructing/comparing the snapshot, which helps the coach detect a completion update that committed first. **This does not yet guarantee a trainee completion toggle is preserved if the coach locks first**: the RPC replaces exercises by deleting and reinserting them, so a waiting PATCH against an old exercise-row ID may affect zero rows after the replacement commits. The trainee client must detect and handle a zero-row completion update (reload/retry against the new row ID), or the RPC design must preserve stable exercise-row IDs. This is a release blocker, not a solved race.
- The write is a single database transaction, so a failure inserting replacement exercises should roll back the plan update and deletes.

These are code-level properties, not proof that concurrent calls behave correctly in a real multi-connection test. The existing static assertion only checks that the lock expression remains in the function definition.

The preview snapshot also includes each exercise's `is_completed` value. If a trainee completion update commits before the coach obtains the exercise-row locks, the old coach snapshot should be rejected. The reverse ordering still needs a safe behavior for the trainee's waiting update, as described above. A disposable integration regression covers the stale-snapshot direction but has not run in CI; it does not prove the reverse race is safe.

## Required two-session race test

Run only against a disposable PostgreSQL database seeded with synthetic users, trainees, exercise-bank rows, and the draft function. Never point the harness at the live Supabase URL.

1. Session A and session B authenticate as the same synthetic coach and load the exact same plan snapshot and plan ID.
2. A calls the RPC with that snapshot and payload A, then commits.
3. B calls the RPC with the original snapshot and payload B after A commits.
4. Expected result: A succeeds; B fails with SQLSTATE 40001 (or a specifically documented stale-preview error); the final database contains payload A only.
5. Repeat with session B acquiring the per-trainee lock first. The first committed save should win; the second save with a stale snapshot must be rejected.
6. Verify a failed replacement leaves the original plan metadata and exercise rows unchanged.
7. Verify saves for two different trainee IDs are not unnecessarily serialized.
8. Capture SQLSTATE and final row state, not just process exit codes. Ensure cleanup runs even when either session fails.

The harness must coordinate sessions with explicit barriers (not timing-only sleeps) and have a timeout so a broken lock cannot hang CI indefinitely.

## Critical caveat: legacy writes

The advisory lock coordinates only callers that invoke this RPC. Existing browser clients that write directly to trainee_workout_plans or trainee_workout_exercises do not take that lock. Therefore, a passing two-session RPC test is necessary but not sufficient for a single-writer guarantee.

Before rollout:
- Inventory all client code paths that insert/update/delete these tables, including cached/older PWA bundles.
- Decide on a backward-compatible migration plan. Do not simply revoke direct table writes while old clients still rely on them.
- Either migrate every supported writer to the RPC before claiming single-writer behavior, or document and test a safe compatibility window.
- Test against the exact PostgreSQL/Supabase version and schema in a disposable project.
- Confirm rollback instructions and a data-integrity check before any production change.

## Release gate checklist

- [ ] Existing disposable-DB integration suite passes after the latest commits.
- [ ] Real two-connection stale-save race test passes repeatedly, including trainee completion PATCH vs coach replace in both lock orders.
- [ ] For unchanged exercise+slot pairs, the RPC preserves the exercise row ID and never overwrites `is_completed` from the coach's stale payload. For replaced/removed movements, the trainee client must detect a zero-row completion update and reload rather than silently report success; verify this with the real authenticated client.
- [ ] Two different trainee IDs behave independently.
- [ ] RLS/authorization tests cover coach, unrelated coach, trainee, anon, and unauthenticated roles.
- [ ] Completion-only trainee update policy is tested with real authenticated JWTs in staging.
- [ ] Legacy direct-write call sites and old-PWA compatibility are resolved.
- [ ] SQL migration and rollback reviewed.
- [ ] Production change explicitly approved by the owner.

Until every relevant gate is checked, keep the RPC and proposed policy out of production.
