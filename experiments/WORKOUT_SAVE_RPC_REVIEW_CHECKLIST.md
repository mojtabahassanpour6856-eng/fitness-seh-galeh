# Atomic workout-save RPC — review checklist

Status: **draft only; not deployed to Supabase**.
Branch: `coach-workout-editor-isolated-preview`.

## What was done in this step
- Inspected the live schema, constraints, row-level-security policies, helper-function signatures, and grants using read-only queries. No trainee-identifying data was retrieved for this audit.
- Read-only live audit confirms the target tables and fields used by this draft exist: `trainee_workout_plans` (`id`, `trainee_id`, `title`, `goal`, `notes`, `plan_date`, `created_at`), `trainee_workout_exercises` (including `exercise_id`, `sets`, `reps`, `rest_seconds`, `sort_order`, `training_system`, `group_key`, `training_day`, `is_completed`), and `exercises(id)`.
- The live tables grant `authenticated` SELECT/INSERT/UPDATE/DELETE as needed; RLS is enabled and policies constrain plan and exercise rows through `private.can_access_trainee` and `private.is_coach`. The helper functions are executable by `authenticated`, and `public`/`private` schema usage is available.
- Schema audit found `plan_date`, `sets`, `rest_seconds`, and `sort_order` nullable in the live schema, whereas the disposable fixture makes some of them NOT NULL. The RPC validates these payload fields before writing, but the fixture should be aligned to live nullability before treating it as a full schema replica.
- This audit did not execute any SQL writes, create functions, or change production data.
- Added `experiments/sql/save_trainee_workout_plan_transaction.sql` as a proposed implementation only.
- No SQL migration/function was run against the production database; no production rows were changed.

## Draft design
- `SECURITY INVOKER`, so existing table grants and RLS are expected to remain active.
- Checks for an authenticated user, coach role, and access to the selected trainee.
- Uses a transaction-scoped advisory lock to serialize calls through this RPC for the same trainee.
- Requires an explicit expected plan id when replacing an existing plan; refuses if the plan count is unexpected or the expected id no longer matches.
- Validates the payload before writes and checks exercise ids against the exercise bank.
- Replaces plan metadata and exercise rows within one function call; a raised exception rolls back the transaction.
- Revokes function execution from `PUBLIC` and `anon`, and grants it to `authenticated`.

## Required before any deployment
1. Align the disposable PostgreSQL fixture with live schema nullability and relevant constraints, then rerun SQL syntax and behavior tests there. Do not create a paid Supabase branch.
2. Confirm all needed schema/table privileges for `authenticated` and verify RLS behavior with the actual coach session. Do not weaken RLS to make the RPC pass.
3. The draft now returns and requires a full plan snapshot (metadata plus ordered exercise-row values) for replacements, and rejects a save if any of those values changed since preview. This guards stale previews even when another code path edits the existing plan. Re-run the disposable PostgreSQL integration suite after any change.
4. Automated disposable PostgreSQL tests cover: new plan; replacement; stale snapshot; invalid exercise id; non-coach caller; inaccessible/invalid trainee; empty and oversized exercise arrays; duplicate sort order; and forced failure during exercise insert with rollback. A separate two-session CI script checks that simultaneous saves using the same snapshot yield exactly one success and reject the stale save. These tests run only against the disposable PostgreSQL service, not production.
5. Finish a field-by-field review of the production app's actual write/read paths and the experimental planner's payload. The schema columns and grants align, but the current experimental adapter still uses separate direct writes and is not wired to the RPC snapshot contract.
6. Check Supabase advisors and review function grants/schema exposure after deployment.
7. Only after the staging tests pass, request explicit approval before deploying a migration or saving to the real test trainee.

## Acceptance criterion
A deliberate error after deleting old exercise rows must cause the complete RPC transaction to roll back so the previous plan and all its exercise rows remain unchanged.

## Important limitation
This SQL draft is not yet production-ready and must not be run as-is. The current live app and its trainee UI are untouched.
