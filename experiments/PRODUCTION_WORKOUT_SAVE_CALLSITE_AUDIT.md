# Production workout-save call-site audit

Date: 2026-10-22
Target branch: `main`
Production `index.html` blob SHA: `659096df630de2654d8c32725c80d00a5c5db666`
Production file size: 1,038,026 characters (fetched by blob SHA; not inferred from the experimental copy)
Status: read-only source trace. No production file, database schema, or trainee row was changed.

## Confirmed production behavior

The actual production `main/index.html` was read by its Git blob SHA and the exact workout functions were inspected.

1. `saveWorkoutPlan()` validates the selected trainee and start date, then saves plan metadata to `public.trainee_workout_plans` through the legacy `sbWrite` REST helper.
2. When replacing a plan, it makes a separate read to verify ownership and then a separate PATCH. When creating, it first reads for an existing plan, then PATCHes or POSTs. It then reads the saved plan back and calls `loadWorkoutForClient()`.
3. `addWorkoutExercise()` is a separate write path. It may call `saveWorkoutPlan()` first, then POSTs an individual row to `public.trainee_workout_exercises`. This means plan metadata and exercise rows are currently not one atomic transaction.
4. The production source contains the existing `saveWorkoutPlan()` and `addWorkoutExercise()` paths. The experimental-only names `getWorkoutPlannerContext`, `enableAtomicWorkoutSave`, and `saveToSupabaseAtomic` were not found in the production blob during this audit.
5. The live production database read-only check previously confirmed that `public.save_trainee_workout_plan_transaction(uuid,bigint,jsonb,jsonb,jsonb)` does not exist.

## Important integration mismatch

The draft RPC and experimental adapter expect a complete plan snapshot plus a complete array of exercise rows in one call. The current production UI saves metadata first and then adds exercises one at a time. Simply switching the metadata save to the RPC would be incorrect: it could require a non-empty full exercise array before the UI has assembled the plan, and the following per-exercise REST writes would still bypass the transaction.

## Safe next implementation step

Before rollout, make an isolated copy of the exact production `index.html` on the experiment branch and refactor only the coach workout editor's in-memory draft/save flow so the full plan and ordered exercise list are submitted together through the RPC. Preserve existing trainee-facing markup and behavior. Then:
- add browser tests against this exact production-derived copy;
- verify create/update/read-after-write, rejected RPC, double-click, and no legacy REST mutation after atomic save;
- rerun the disposable PostgreSQL rollback, authorization, RLS, trigger, and concurrency suite;
- compare the resulting diff to confirm no trainee-facing sections, branding, icon, manifest, or unrelated coach features changed.

## Safety / rollout status

- No production database writes or schema changes.
- No production branch changes.
- The RPC remains a draft and is not installed in production.
- Atomic saving is not enabled in the live app.
- Do not merge/deploy until the production-derived integration tests pass and the RPC is reviewed and explicitly approved for deployment.
