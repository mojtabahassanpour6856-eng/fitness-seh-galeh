# Workout-save compatibility review (2026-10-21)

## Scope and safety boundary
- Repository: `mojtabahassanpour6856-eng/fitness-seh-galeh`
- Branch: `coach-workout-editor-experiment`
- Experimental entry point: `experiments/workout-template-planner.html`
- Persistence adapter: `experiments/workout-persistence-adapter.js`
- Live Supabase project inspected read-only: `qfakyudgidsumeuoqoot` (`fitness seghale`)
- No production SQL, migrations, Edge Functions, main-branch files, or trainee UI were changed by this review.

## Findings from live schema and RLS policies
1. The legacy tables `public.workout_plans` and `public.workout_exercises` are explicitly denied to both `anon` and `authenticated` by `deny_public_access_workout_plans` / `deny_public_access_workout_exercises`. The experimental save adapter must not use these tables.
2. The current trainee-plan tables are `public.trainee_workout_plans` and `public.trainee_workout_exercises`. The schema contains the fields the adapter writes, including `plan_date`, `training_system`, `group_key`, `training_day`, and `is_completed`.
3. RLS on trainee plans allows authenticated coaches to insert/update/delete only where `private.is_coach()` and `private.can_access_trainee(trainee_id)` pass. Exercise writes are scoped through the parent plan and the same trainee-access helper. Reads are scoped to accessible trainees. These policies are compatible in principle with the adapter's intended tables, subject to a real authenticated-session test.
4. `coach_workout_templates` is a separate coach-owned template table; it is not the trainee's assigned workout plan table and must not be substituted for it.

## Blocking compatibility issues in the current experimental adapter
- `saveToSupabase()` currently performs several separate client requests (update plan, delete old exercises, insert new exercises). These are **not one database transaction**.
- The adapter reads the existing plan and exercise rows, but does not use an expected version/revision or compare the previously-read plan and exercises immediately before writing. A stale editor can still overwrite a newer save.
- Rollback is compensating client-side writes. Those writes can fail independently, so they cannot guarantee atomic preservation of the old plan after a partial failure.
- The adapter checks that no more than one plan is returned, but that query alone does not prevent two simultaneous requests from both seeing the same state and writing.
- The browser page calls this adapter directly. No server-side atomic RPC/Edge Function is wired into this flow yet.
- This review did not execute a real authenticated save, because doing so would mutate a real trainee's plan. Schema/policy inspection alone does not establish end-to-end compatibility.

## Safe rollout / rollback gate
Do **not** connect this adapter to the live coach flow yet. Keep it isolated on this branch until all gates pass:
1. Implement a database-side transaction/RPC for save-and-replace, with coach/trainee authorization enforced server-side.
2. Add an optimistic concurrency token (revision/version or a deterministic snapshot/hash) and reject a stale request before any mutation.
3. Ensure exercise replacement and plan metadata update occur in the same transaction; a forced insert failure must leave both the old plan and its exercises unchanged.
4. Test unauthorized coach, wrong trainee, invalid exercise IDs, empty/oversized exercise lists, duplicate sort order, stale concurrent writers, and forced mid-save failure against a disposable database with the production schema/policies.
5. Confirm the existing coach save/read path uses `trainee_workout_plans` and `trainee_workout_exercises`, including the exact column mappings and refresh behavior, before wiring in the new flow.
6. Keep the old production path untouched until a separate approval to roll out. Rollback should be a frontend switch back to the prior save path; do not reverse or drop production tables/policies as a rollback mechanism.

## Decision
**Not ready for production integration.** The table mapping is partly compatible, but the advertised stale-write protection and atomic rollback are not present in the currently fetched adapter. No production changes were made.


## Follow-up verification (2026-10-21)

The disposable PostgreSQL workflow now passes on the latest experiment commit, including:
- plan creation and replacement;
- snapshot response includes the existing plan metadata and exercise rows;
- stale fingerprint rejection;
- duplicate ordering, unknown exercise IDs, missing/unsupported training systems, negative sets/rest, empty exercise list, and more than 200 rows rejected;
- forced child-insert failure rolls back the plan and exercise rows;
- inaccessible-trainee and non-coach save attempts rejected;
- two concurrent saves using one snapshot: the first commits and the stale second save is rejected.

Latest workflow run: 11, `Expand workout RPC validation and authorization tests`, successful on commit `e01cac86a1095d6485d50a3db80f75df808db9d8`. The workflow only uses a fresh disposable PostgreSQL service and a mocked auth/RLS harness.

The read-only live-schema inventory confirms the target tables and fields used by the draft exist in the production project. This is a schema-shape check only, not an authenticated end-to-end test against the production RLS/permissions. No experimental RPC exists in production, and none was installed.

## Remaining blockers (still not ready for production)

1. The planner adapter still calls direct multi-request writes and is not wired to the experimental RPC.
2. The disposable harness is a simplified mock, not a clone of the production schema, grants, helper functions, constraints, and RLS behavior.
3. A safe authenticated integration test needs a disposable Supabase project/database with matching schema/policies and throwaway coach/trainee identities; do not use production trainees.
4. The browser planner needs end-to-end tests for load/edit/save/reload and output, including confirmation that the current coach path and trainee UI remain unchanged.
5. Before wiring in the RPC, verify how the existing coach flow maps training days, exercise IDs, completion flags, and plan dates. Keep the production frontend, production SQL, and trainee-facing UI untouched until a separate explicit rollout approval.

**Current decision remains: do not merge or deploy to production.**


## Atomic adapter integration follow-up (2026-10-21)

The experimental planner now loads `atomic-workout-rpc-adapter.js` and captures an authorized workout snapshot when the editor opens. Save uses the captured `plan_id` and fingerprint with `experimental_save_trainee_workout`, rather than the old multi-request `saveToSupabase` writer. If the selected trainee changes, the initial snapshot is unavailable, the coach session cannot verify access, or the database reports a stale fingerprint, the editor blocks the save and asks the coach to reopen the planner. This change is only in the experimental branch.

Additional verification:
- Node adapter tests passed with a mocked Supabase client.
- Chromium browser integration test passed: snapshot captured at editor opening; save sent through the atomic RPC with the expected fingerprint and mapped exercise rows; no direct insert/update/delete calls were made to workout tables.
- Inline JavaScript validation passed.
- The disposable PostgreSQL transactional, authorization, and concurrency tests passed.

Latest browser integration run: https://github.com/mojtabahassanpour6856-eng/fitness-seh-galeh/actions/runs/39668760646 (success).

## Branch-isolation warning

A GitHub compare of `main` and `coach-workout-editor-experiment` shows the experiment branch is historically diverged and includes other differences to app files. Although no changes from this work were made to the production `main` branch and no deployment was triggered, **do not merge the entire experiment branch**. Any future rollout must be prepared as a clean branch based on the then-current `main`, copying/cherry-picking only reviewed experimental components and separately approving any coach-panel launch integration.
