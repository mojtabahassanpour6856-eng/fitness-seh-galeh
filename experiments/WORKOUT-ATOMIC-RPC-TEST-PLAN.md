# Atomic workout-save RPC test plan

Status: design/draft only; NOT applied to Supabase and NOT wired into the planner.

## Preconditions before any test
- Create a disposable Supabase/Postgres database from the exact production schema, functions, grants, and RLS policies.
- Apply `experiments/sql/experimental_atomic_workout_save.sql` only to that disposable database.
- Use two separate authenticated coach sessions and dedicated throwaway trainee records.
- Never use real trainees or the production project for forced-failure or concurrency tests.

## Required checks
1. Snapshot for an authorized coach and accessible trainee returns zero/one plan and a fingerprint.
2. A coach without access to the trainee is denied by both RPCs.
3. Unauthenticated and non-coach sessions are denied.
4. A new plan with valid exercise IDs succeeds; metadata and all exercise fields match.
5. Replacement with a current plan ID and current fingerprint succeeds.
6. Two concurrent saves using the same fingerprint: one succeeds; the other gets stale-version rejection (SQLSTATE 40001) and does not overwrite the winner.
7. A stale plan ID or fingerprint is rejected before any write.
8. Unknown exercise IDs, duplicate sort order, invalid systems, negative sets/rest, empty lists, and >200 exercises are rejected without changing the plan.
9. Force an insert failure after the plan update/delete phase inside the RPC; PostgreSQL transaction rollback must preserve the old plan and all old exercises.
10. Multiple existing plans are rejected for manual review rather than merged or deleted.
11. Run a browser test for the planner's preview/output behavior and confirm the current coach save/read path is unchanged.
12. Verify execute grants, RLS enforcement, function search_path, and absence of unintended PUBLIC/anon execute permissions.

## Important limitations
- The draft SQL has only been reviewed as text against a read-only inspection of the live schema/policies.
- It has not been parsed/executed by PostgreSQL, so syntax, function privileges, RLS interactions, and trigger/constraint behavior are not yet proven.
- The browser adapter still calls its current direct-write implementation. It does not call these draft RPCs.
- Do not merge, deploy, apply to production, or expose the experimental save button until all tests pass and a separate rollout decision is made.
