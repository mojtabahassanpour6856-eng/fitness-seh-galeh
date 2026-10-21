# Atomic workout-save RPC — review checklist

Status: **draft only; not deployed to Supabase**.
Branch: `coach-workout-editor-isolated-preview`.

## What was done in this step
- Inspected the live schema, constraints, row-level-security policies, helper-function signatures, and existing workout rows using read-only queries.
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
1. Review SQL syntax and behavior in a disposable/staging Supabase project first.
2. Confirm all needed schema/table privileges for `authenticated` and verify RLS behavior with the actual coach session. Do not weaken RLS to make the RPC pass.
3. The draft now returns and requires a full plan snapshot (metadata plus ordered exercise-row values) for replacements, and rejects a save if any of those values changed since preview. This guards stale previews even when another code path edits the existing plan. Re-run the disposable PostgreSQL integration suite after any change.
4. Automated disposable PostgreSQL tests cover: new plan; replacement; stale snapshot; invalid exercise id; non-coach caller; inaccessible trainee; and forced failure during exercise insert with rollback. Still add explicit invalid-trainee, empty/oversized array, duplicate sort order, and two simultaneous save-attempt tests before deployment.
5. Confirm the exercise-system values and all payload fields against the production app's actual write/read paths.
6. Check Supabase advisors and review function grants/schema exposure after deployment.
7. Only after the staging tests pass, request explicit approval before deploying a migration or saving to the real test trainee.

## Acceptance criterion
A deliberate error after deleting old exercise rows must cause the complete RPC transaction to roll back so the previous plan and all its exercise rows remain unchanged.

## Important limitation
This SQL draft is not yet production-ready and must not be run as-is. The current live app and its trainee UI are untouched.
