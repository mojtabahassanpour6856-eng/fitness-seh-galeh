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

1. The live database's exact EXECUTE/USAGE grants for `private.is_coach()` and `private.can_access_trainee(uuid)` were not conclusively verified in this review. The function is `SECURITY INVOKER`; do not weaken RLS or switch to `SECURITY DEFINER` to work around a permission error.
2. The draft has not been installed or run against the live Supabase database, and no separate Supabase staging project was created (to avoid charges).
3. The browser editor/legacy adapter is not yet wired to call this RPC or pass `p_expected_snapshot`. Do not enable the experimental save button against real trainees.
4. Live RLS behavior must be verified with the actual coach session and actual grants in a separate disposable environment before any production migration is considered.
5. After any changes to the RPC or fixture, all CI jobs must finish successfully; a running workflow is not a passing workflow.

## Safe rollback plan for a future approved rollout

Preconditions: a reviewed migration, a known-good Git commit for the app, and an explicit approval before touching production.

1. Keep the existing production UI and existing read paths unchanged during initial rollout. Do not deploy any frontend that calls the new RPC before the database migration and grants are verified.
2. If a deployed RPC causes errors, immediately disable the experimental editor's save entry point by reverting the app commit to the last known-good commit. Do not delete or rewrite workout rows as a rollback action.
3. If the RPC itself must be disabled, use a separately reviewed rollback migration that revokes EXECUTE from `authenticated` and removes only the exact RPC signature introduced by that migration. Do not drop or alter workout tables, plans, exercise rows, RLS policies, or helper functions.
4. If any write might have occurred, inspect the affected trainee's plan and exercise rows read-only before considering repair. Restore data only from a verified snapshot and only after explicit approval; never run a blanket restore.
5. Re-run browser and disposable-PostgreSQL tests after the rollback, then confirm the production trainee UI remains unchanged.

## Decision

**Not ready for production.** Schema column names/types appear compatible, but grants/RLS compatibility and application RPC wiring remain unverified. Production database and student-facing interface were not changed in this review.
