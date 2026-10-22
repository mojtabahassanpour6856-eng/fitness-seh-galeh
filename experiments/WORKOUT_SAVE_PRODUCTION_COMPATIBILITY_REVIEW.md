# Workout Save RPC — live-schema compatibility and rollback review

Status: read-only compatibility review; draft remains experimental and is NOT connected to the live app.

## Live schema facts verified read-only

Project: `fitness seghale` (PostgreSQL 17). No data rows were inserted, updated, or deleted during this review.

The live schema exposes these columns:

- `public.trainee_workout_plans`: `id bigint`, `trainee_id uuid`, `title text`, `goal text`, `notes text`, `created_at timestamptz`, `plan_date date`.
- `public.trainee_workout_exercises`: `id bigint`, `workout_plan_id bigint`, `exercise_id bigint`, `sets integer`, `reps text`, `rest_seconds integer`, `notes text`, `sort_order integer`, `created_at timestamptz`, `training_system text`, `group_key text`, `training_day text`, `is_completed boolean`.
- `public.exercises`: `id bigint`, `name text`.
- `public.trainees`: `id uuid`.

The draft writes only columns present in the live schema. It keeps the trainee UUID separate from the JSON plan metadata, uses a bigint plan ID and bigint exercise IDs, and maps the adapter's fields to the live exercise columns. The draft normalizes an empty optional goal/notes value to SQL NULL. The current legacy adapter still performs separate REST writes and compensating restoration; it is not atomic.

## Live security and compatibility checks completed

A second read-only audit was run against the live Supabase project after checking the current draft and adapter. No SQL DDL or DML was executed.

- The proposed RPC name is still absent from the live database.
- Both target tables have RLS enabled. Existing policies constrain workout-plan access using `private.can_access_trainee(trainee_id)`, and exercise-row access through the parent plan; writes additionally require `private.is_coach()`.
- `authenticated` has the needed table privileges on the target tables; `anon` has no SELECT/INSERT privileges on these target tables.
- `authenticated` has USAGE on `private` and EXECUTE on the existing helper functions `private.is_coach()` and `private.can_access_trainee(uuid)`; `anon` has neither private-schema USAGE nor EXECUTE on those helpers.
- Both existing helpers are `SECURITY DEFINER` with a restricted `search_path`. The proposed save RPC itself remains `SECURITY INVOKER`; it must not be changed to SECURITY DEFINER to work around permissions.
- A BEFORE UPDATE trigger on `trainee_workout_exercises` prevents non-coaches from changing exercise fields other than `is_completed`. The RPC replaces rows via DELETE/INSERT, and its coach-role check plus RLS policies are expected to govern that path; this still needs an authenticated integration test that mirrors the live policy/trigger behavior.
- Live schema permits NULL in `plan_date`, `sets`, `rest_seconds`, and `sort_order`; the RPC deliberately validates new payloads before writing. Existing rows with a NULL `plan_date` will fail the adapter's safe snapshot check instead of being overwritten silently.
- The disposable fixture's target columns already allow NULL where the live schema does, but it does not fully reproduce every live policy, helper, and trigger. It is a behavioral fixture, not a byte-for-byte schema clone.

## Correctness improvement made

Snapshot aggregation now uses a scalar aggregate subquery with an empty-array fallback. This is important because an existing plan with zero exercise rows must still produce a non-null snapshot, otherwise the stale-snapshot guard would prevent that plan from being replaced.

The SQL file no longer includes a statement that could remove a function with the new five-argument signature before recreating it. The draft remains a SQL artifact only.

## Additional blocker found during legacy-vs-RPC comparison

The legacy `saveToSupabase` path performs multiple independent REST operations (plan update/insert, exercise delete, exercise insert, and compensating restoration on failure). The draft RPC serializes calls with a PostgreSQL advisory transaction lock, but the legacy path does not acquire that lock and cannot participate in the RPC transaction.

**Therefore the advisory lock and snapshot guard do not prevent a legacy save from racing with an RPC save.** If both paths are ever enabled for the same trainee, a legacy write could occur between the RPC's reads/writes or after its transaction commits. This is a deployment blocker, not a theoretical guarantee of safety.

Safe choices before rollout:
- Keep the RPC opt-in disabled and do not expose it to real trainee saves; or
- Move all writes for the relevant editor to the RPC in one controlled rollout, with no fallback to the legacy multi-request writer once RPC saving is enabled; or
- Design and test a shared concurrency protocol used by every write path. Merely adding a client-side lock is insufficient across devices/sessions.

Do not modify the existing production writer as part of this review because the coach and trainee flows are to remain unchanged until a separately reviewed rollout is approved.

## Items still unverified — deployment blockers

1. Read-only audit verified helper schema/function grants for `authenticated` and `anon`. The proposed RPC's own grants have not been installed or tested live because the RPC does not exist there. Do not weaken RLS or switch the proposed RPC to `SECURITY DEFINER` to work around a permission error.
2. The draft has not been installed or run against the live Supabase database, and no separate Supabase staging project was created (to avoid charges).
3. The experimental editor now has a single-writer fail-closed guard and passes the expected snapshot to the atomic adapter only when an explicit context opt-in is true. The current coach context does not enable that opt-in, so no live save path is active.
4. Live RLS behavior, trigger interaction, and a real authenticated coach-session save must be verified in a disposable environment before any production migration is considered. The disposable fixture is not a complete copy of the live security configuration.
5. The legacy production REST writer does not use the RPC advisory lock; it must not race with RPC saves. A controlled all-at-once writer migration or a separately designed shared concurrency protocol remains mandatory.
6. After any changes to the RPC or fixture, all CI jobs must finish successfully; a running workflow is not a passing workflow.

## Safe rollback plan for a future approved rollout

Preconditions: a reviewed migration, a known-good Git commit for the app, and an explicit approval before touching production.

1. Keep the existing production UI and existing read paths unchanged during initial rollout. Do not deploy any frontend that calls the new RPC before the database migration and grants are verified.
2. If a deployed RPC causes errors, immediately disable the experimental editor's save entry point by reverting the app commit to the last known-good commit. Do not delete or rewrite workout rows as a rollback action.
3. If the RPC itself must be disabled, use a separately reviewed rollback migration that revokes EXECUTE from `authenticated` and removes only the exact RPC signature introduced by that migration. Do not drop or alter workout tables, plans, exercise rows, RLS policies, or helper functions.
4. If any write might have occurred, inspect the affected trainee's plan and exercise rows read-only before considering repair. Restore data only from a verified snapshot and only after explicit approval; never run a blanket restore.
5. Re-run browser and disposable-PostgreSQL tests after the rollback, then confirm the production trainee UI remains unchanged.

## Decision

**Not ready for production.** Target columns and helper grants appear compatible based on read-only inspection, and the experimental editor is fail-closed. Live authenticated RPC/RLS/trigger behavior and the legacy-writer concurrency blocker remain unresolved. Production database and student-facing interface were not changed in this review.
