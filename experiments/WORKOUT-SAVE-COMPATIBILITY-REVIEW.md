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
