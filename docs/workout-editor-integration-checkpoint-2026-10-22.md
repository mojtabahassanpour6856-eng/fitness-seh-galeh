# Workout editor integration checkpoint — 2026-10-22

## Safety boundary
This work is isolated on `feature/atomic-workout-editor-integration-20261022`, branched from production `main` at `fdd4a45314c57f9ff7eb1e0b34430827a08e15af`. No production code, production database schema, or trainee records were changed.

## Confirmed live schema (read-only inspection)
The current app uses `public.trainee_workout_plans` and `public.trainee_workout_exercises` for the coach's active workout workflow. The exercise table has `training_system`, `group_key`, `training_day`, and `is_completed`; its plan FK points to `trainee_workout_plans`. The live policies require coach access through `private.is_coach()` and `private.can_access_trainee(...)` for coach writes. The older `workout_plans` / `workout_exercises` tables are a separate legacy model and are restricted by deny-public policies.

## Code inspection findings
- Production `main/index.html` contains `saveWorkoutPlan()`, `loadWorkoutForClient()`, and the current workout exercise editor.
- Production main already has a guarded multi-row insert for grouped exercises, validates the returned row count and plan/trainee identity, and retains an optional-column compatibility fallback.
- The isolated desktop-editor branch has a similar plan header save/load flow, but does not contain the newer `window.__workoutAddBusy` guard found in main. Copying its file wholesale would regress that safety guard and is therefore not acceptable.
- Saving the plan header and saving its exercise rows are still separate operations. A true all-or-nothing save of a complete plan requires a transaction-capable server-side operation, plus client wiring and tests; simply switching the UI to the experimental branch would not provide that guarantee.

## Required before production merge
1. Implement the full-plan transaction on an isolated Supabase development branch, enforcing the existing coach/trainee authorization checks.
2. Validate the payload before writes; ensure a failed exercise row rolls back the plan header and all exercise rows.
3. Preserve the existing plan ID/date and the `training_system`, `group_key`, `training_day`, and `is_completed` semantics.
4. Add automated tests for create, edit/reload, 6 sessions, supersets/trisets, start date, invalid exercise rollback, wrong-trainee rejection, and concurrent edits.
5. Compare the trainee-facing markup/styles against production and do not merge any trainee UI changes.
6. Merge to production only after the test run is green and the rollback commit is recorded.

## Current status
Checkpoint and schema/code audit only. No claim is made that the atomic full-plan save is implemented or that the new editor has been published.
