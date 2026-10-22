# Atomic workout editor payload contract — 2026-10-22

## Purpose and safety boundary

This is an implementation contract for the experimental atomic save RPC. It is not a production deployment. The live coach editor continues to use its existing REST flow until the RPC is installed and verified safely. Do not merge this document as a signal that runtime integration is complete.

## Current UI-to-database mapping

The existing coach editor reads the latest `trainee_workout_plans` row for the selected trainee and reads its child rows from `trainee_workout_exercises`.

Plan payload fields observed in the current editor:
- `trainee_id`: selected `currentClient.id` (UUID)
- `title`: `workoutTitle` (falls back to “برنامه تمرینی”)
- `plan_date`: validated ISO date from `workoutStartDate`
- `goal`: `workoutGoal` or null
- `notes`: `workoutNotes` or null

Exercise row fields observed in the grouped exercise editor:
- `workout_plan_id`: selected/saved plan ID
- `exercise_id`: selected exercise ID (bigint)
- `sets`: integer
- `reps`: text or null
- `rest_seconds`: integer
- `notes`: text or null
- `sort_order`: integer
- `training_system`: text such as `normal`, `superset`, `triset`, or `giant`
- `group_key`: shared text key for grouped movements, otherwise null
- `training_day`: text or null
- `is_completed`: boolean (newly added movements default false)

## Live schema confirmation (read-only query on 2026-10-22)

The current live schema was inspected with SELECT-only metadata queries. Both table IDs are bigint NOT NULL with no column default, and backing sequences exist; the proposed RPC therefore allocates IDs explicitly with `nextval`. The child table has FK constraints from `workout_plan_id` to `trainee_workout_plans.id` and `exercise_id` to `exercises.id`. The parent has an FK from `trainee_id` to `trainees.id`. The expected payload columns listed above exist, including `training_system`, `group_key`, `training_day`, and `is_completed`. No data or schema was changed by these inspection queries.

## RPC contract

Call signature:
`save_trainee_workout_plan_atomic(p_plan_id bigint, p_plan jsonb, p_exercises jsonb)`

- `p_plan_id`: existing plan ID when editing; null for create.
- `p_plan`: complete plan object with the fields listed above.
- `p_exercises`: the **entire authoritative exercise list** for the plan, not only newly added rows. An empty array intentionally removes all child rows.
- The RPC returns JSON containing `plan_id`, `trainee_id`, `exercise_count`, and `plan_date`.
- A failure while writing any child row should roll back the parent write and all child changes in the same transaction.

## Integration gate

Do not wire the live editor to this RPC until all of the following are true:
1. The expanded disposable-PostgreSQL contract workflow is green.
2. The migration has been runtime-tested against an isolated database matching the actual schema and authorization helpers, without using the production database for DDL.
3. The editor is changed to construct the full payload from the existing cache, including every session/day and all group metadata, and to use the returned plan ID.
4. Create/edit/reload, six-session plans, supersets/trisets/giant sets, start date, empty list, rollback, authorization, and concurrent-save behavior are tested.
5. The production trainee-facing markup/styles are unchanged and the existing multi-row/busy guard is preserved.
6. A rollback path is documented before any production merge.

## Known limitation

The current proposed RPC does not implement optimistic concurrency/version checks. Two coach tabs editing the same plan can overwrite each other's latest complete exercise list. Decide whether to serialize saves with a row lock or reject stale versions before production use. The RPC is not deployed, and the frontend is not wired to it.
