# Workout-save single-writer rollout protocol (draft)

Date: 2026-10-22
Status: design gate only — no production change authorized.

## Problem being solved

The atomic RPC serializes new saves with a per-trainee advisory transaction lock and rejects stale snapshots. The existing production writer does not acquire that lock. Therefore the RPC lock alone does **not** prevent an older installed PWA/browser from issuing legacy REST writes at the same time.

## Confirmed writer inventory from production blob

The exact production `main/index.html` blob was re-read directly (SHA `659096df630de2654d8c32725c80d00a5c5db666`, 1,038,026 characters). This review found more than the primary editor writer. The following mutation paths must be included in any write-gate design:

- **Primary coach editor:** plan metadata INSERT/PATCH; add single exercise; delete exercise.
- **Alternate/guarded coach editor implementation:** plan metadata INSERT/PATCH; add one or multiple/grouped exercises; delete, edit, reorder exercises; copy an existing workout plan and its exercise rows.
- **Other plan-copy path:** copy previous plan by inserting a new plan and then inserting exercise rows.
- **Exercise-bank/template selection or bulk add flow:** batch INSERT of exercise rows, with a compatibility fallback that omits optional columns.
- **Trainee completion flow:** PATCH of only `is_completed` on `trainee_workout_exercises`. This must remain supported and must not be accidentally blocked by a general coach-writer gate.
- **Read-only/reporting flows:** many additional references to the tables are reads and should not be changed.

This is a concrete partial call-site audit, not yet proof that every possible mutation path across every deployed/cached client has been exhausted. It demonstrates that a blanket trigger gate on both tables would break legitimate existing operations unless they are explicitly migrated or safely exempted.

## Recommended safety strategy

Use a server-enforced write gate as part of a controlled cutover, rather than relying on clients to self-report their version. Do not write or install the gate until every mutation path above has a tested disposition.

1. **Inventory all writers first.** Search the exact current `main/index.html` and related deployed code for every INSERT/PATCH/DELETE to `trainee_workout_plans` and `trainee_workout_exercises`, including create, edit, delete/archive, template-copy, and any other coach workflows. Document which flows must remain supported. The known editor save/add/delete paths are not sufficient evidence that all writers have been found.
2. **Design (do not yet install) a transaction-local database gate.** The candidate design is to have the atomic RPC set a transaction-local marker immediately before its DML, and have reviewed database triggers reject direct legacy writes to the protected workout tables when that marker is absent. The marker must be transaction-local, the trigger must cover every relevant mutation event/table, and security review must verify that clients cannot bypass it through another exposed function. The existing trainee completion-state trigger must remain intact.
3. **Treat old clients explicitly.** Old installed PWAs would be denied workout writes after the gate is enabled until they load the compatible app. This is safer than silently allowing competing writers, but it is a potential availability regression. Plan a maintenance/cutover notice and provide a clear reload/update message in the new UI. Do not enable the gate until this user impact is accepted and tested.
4. **Cut over in a controlled window.** Prepare a clean patch based on the current `main` head and a separately reviewed migration. Pause coach workout edits for the cutover; verify the exact release commit and migration; apply the database RPC + gate together; immediately deploy the matching app version that uses the RPC; then smoke-test with a designated test trainee. If any check fails, follow a reviewed rollback plan. Never blanket-restore or delete workout data.
5. **Verify single-writer enforcement.** From a disposable Supabase environment, test: direct legacy INSERT/PATCH/DELETE denied without the marker; RPC create/update succeeds; RPC rollback leaves original rows unchanged; stale snapshots rejected; trainee completion-state updates retain existing behavior; other legitimate coach workflows are either migrated or deliberately denied with a clear error; old cached app gets a safe, understandable failure; and unauthorized users cannot bypass the gate.
6. **Post-cutover monitoring.** Check save/reload results and database/API errors before considering the release complete. Keep the previous known-good app commit and reviewed rollback migration ready.

## Why not simply deploy the RPC?

- The existing writer does not share the advisory lock.
- Deploying only the RPC leaves old clients able to bypass it.
- A client-side feature flag alone is not a security boundary because cached clients can keep using old code.
- A database gate can prevent mixed writes, but may temporarily reject old clients and any un-audited legitimate write path. That impact must be tested and approved first.

## Current blockers / next checks

- There is only one connected Supabase project, the live production project. A fresh project listing returned only this project, and its development-branch listing returned no branches.
- The draft RPC and gate have not been installed anywhere in Supabase.
- The production source write-path inventory is classified below, but still needs a second review and a search for any other deployed/cached versions before claiming complete coverage.
- The RPC snapshot/data shape still needs authenticated testing against the actual schema, RLS policies, grants, and trigger behavior in an isolated Supabase environment.
- A clean branch `workout-save-audit-main-based` now exists and is based directly on `main`; it contains documentation only. No executable app patch has been prepared on this branch. The production-derived prototype remains an experiment and must not be merged wholesale.
- No production migration or deployment is approved by this document.

## Safety boundary

This document is a rollout design, not executable migration SQL. No production branch, deployed app, Supabase schema/data, or trainee record was changed while preparing it.

## Production-source mutation-path audit (2026-10-22)

Audited the full 1,038,026-character production `main/index.html` blob at `659096df630de2654d8c32725c80d00a5c5db666` (13,454 lines). The scan found 114 total `sbWrite(` calls across the app and workout-table references; direct Supabase SDK use against `trainee_workout_plans` found was a dashboard SELECT, not a write. This is a source-level audit of that exact blob, not a guarantee about old cached clients or other deployed versions.

### Read-only production schema check (2026-10-22)

Read-only Supabase metadata queries confirmed the live tables currently expose the columns expected by the prototype for its core plan/exercise fields:

- `trainee_workout_plans`: `id` (bigint), `trainee_id` (uuid), `title` (text), `goal`, `notes`, `plan_date` (date), `created_at`.
- `trainee_workout_exercises`: `id`, `workout_plan_id`, `exercise_id`, `sets`, `reps`, `rest_seconds`, `notes`, `sort_order`, `training_system`, `group_key`, `training_day`, `is_completed`, `created_at`.
- `exercises.id` is bigint, matching the prototype's exercise ID type.
- RLS is enabled on all three tables. The existing `guard_trainee_workout_exercise_update_trigger` is present on `trainee_workout_exercises`.
- The private helper functions `private.is_coach()` and `private.can_access_trainee(uuid)` exist. The target RPC `public.save_trainee_workout_plan_transaction(...)` is absent.
- No development branches were returned for the production project.

This check confirms only column/type/trigger presence. It does **not** validate the candidate RPC's behavior under real authenticated sessions, every RLS policy, grants, concurrent writes, rollback, or all client payloads. No SQL schema or data was changed. The live production project was queried read-only only.

### Write-path disposition matrix

| Path in production source | Observed operations | Required disposition before any gate/cutover |
|---|---|---|
| Primary coach workout editor (`loadWorkoutForClient` / `saveWorkoutPlan`, approx. lines 2039–2076) | Plan PATCH/POST; add exercise POST; delete exercise DELETE | Migrate plan metadata and structural changes to reviewed RPC(s); preserve the editor’s current visible behavior and confirm save/read-back semantics. |
| Exercise-bank / grouped bulk add (approx. lines 2884–2888) | Array POST with compatibility fallback dropping optional `training_day` and `is_completed` | Replace with an atomic bulk RPC; validate all exercise IDs before any insert; retain documented optional-column compatibility only if schema actually requires it. |
| Earlier/alternate editor implementation (approx. lines 3273–3282) | Exercise PATCH for prescription; two-step reorder PATCH; plan copy POST then exercise POST | Route prescription edits, reorder, and copy through atomic RPC operations. Two-step reorder is currently non-atomic. Copy must not leave an empty/partial plan. |
| Primary completion action (approx. line 3418) | PATCH `is_completed` | Keep a narrowly scoped, independently authorized trainee completion operation; do not force trainee completion through coach-only plan replacement. |
| Later/guarded editor implementation (approx. lines 4230–4371) | Plan PATCH/POST; single/bulk exercise POST; delete; edit; reorder with best-effort rollback; copy plan then rows; completion PATCH | Migrate coach writes to RPC operations, including bulk insert, copy, reorder, edit, delete, and plan metadata. Scope every operation to the authenticated coach’s permitted trainee/plan. Preserve completion as a separate narrowly scoped operation. |
| Workout-day logs and other training reporting | Writes are to `trainee_workout_day_logs`, not the two tables covered by this audit | Out of scope for a gate on the two audited tables, but must not be accidentally blocked by a broader policy/trigger. |
| Reads, dashboard summaries, plan rendering/export, trainee workout reports | SELECT/read helpers across the two tables | Must remain available under existing role-specific RLS; verify coach and trainee read paths after any schema change. |

### Important implementation details

- The production source has multiple overlapping/alternate editor implementations. A migration must account for every active callback and not just the first visible `saveWorkoutPlan()` function.
- The plan metadata path may update an existing plan or create one after checking for an existing plan. The atomic contract must specify expected plan ID/version and conflict behavior so concurrent or stale saves cannot overwrite newer state.
- Some exercise inserts retry with optional fields omitted after a schema-compatibility error. Do not carry that fallback blindly into an RPC; test against the real schema first.
- Reorder currently performs two PATCH requests and attempts a best-effort rollback if the second fails. This is not atomic and should become one transaction.
- Copy-plan flows currently create the plan before inserting copied rows. An exercise insert failure can therefore leave a partial copy; the copy operation should be one transaction.
- Completion writes update only `is_completed`. Any write gate must distinguish this allowed state transition from edits to prescription fields and must validate that the caller can access the relevant trainee/plan. Do not broadly exempt all authenticated updates.
- A DB trigger that checks a transaction-local marker is only a design candidate. Verify that untrusted callers cannot set/bypass the marker, including through any exposed RPC or SQL execution surface, before relying on it as a security boundary.
- The source also includes fallback/older app paths. Source review cannot prove every installed PWA has refreshed; a cutover plan needs an explicit old-client behavior and user-facing recovery path.

### Audit outcome

The source-level mutation paths have now been enumerated and classified above. This **does not** clear the transfer gate: authenticated integration tests against a separate project are still unavailable; the actual schema/RLS/trigger behavior for the RPC has not been verified in staging; the database gate has not been security-reviewed; and the production-derived prototype is not a clean, tested patch based on the current `main` head. No production app, production database, trainee UI, or trainee data was changed. No merge or deployment is authorized.
