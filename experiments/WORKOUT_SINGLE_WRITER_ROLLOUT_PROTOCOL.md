# Workout-save single-writer rollout protocol (draft)

Date: 2026-10-22
Status: design gate only — no production change authorized.

## Problem being solved

The atomic RPC serializes new saves with a per-trainee advisory transaction lock and rejects stale snapshots. The existing production writer does not acquire that lock. Therefore the RPC lock alone does **not** prevent an older installed PWA/browser from issuing legacy REST writes at the same time.

## Recommended safety strategy

Use a server-enforced write gate as part of a controlled cutover, rather than relying on clients to self-report their version.

1. **Inventory all writers first.** Search the exact current `main/index.html` and related deployed code for every INSERT/PATCH/DELETE to `trainee_workout_plans` and `trainee_workout_exercises`, including create, edit, delete/archive, template-copy, and any other coach workflows. Document which flows must remain supported. The known editor save/add/delete paths are not sufficient evidence that all writers have been found.
2. **Design (do not yet install) a transaction-local database gate.** The candidate design is to have the atomic RPC set a transaction-local marker immediately before its DML, and have reviewed database triggers reject direct legacy writes to the protected workout tables when that marker is absent. The marker must be transaction-local, the trigger must cover every relevant mutation event/table, and security review must verify that clients cannot bypass it through another exposed function. The existing trainee completion-state trigger must remain intact.
3. **Treat old clients explicitly.** Old installed PWAs would be denied workout writes after the gate is enabled until they load the compatible app. This is safer than silently allowing competing writers, but it is a potential availability regression. Plan a maintenance/cutover notice and provide a clear reload/update message in the new UI. Do not enable the gate until this user impact is accepted and tested.
4. **Cut over in a controlled window.** Prepare a clean patch based on the current `main` head and a separately reviewed migration. Pause coach workout edits for the cutover; verify the exact release commit and migration; apply the database RPC + gate together; immediately deploy the matching app version that uses the RPC; then smoke-test with a designated test trainee. If any check fails, follow a reviewed rollback plan. Never blanket-restore or delete workout data.
5. **Verify single-writer enforcement.** From a disposable Supabase environment, test: direct legacy INSERT/PATCH/DELETE denied without the marker; RPC create/update succeeds; RPC rollback leaves original rows unchanged; stale snapshots rejected; trainee completion-state updates retain existing behavior; other legitimate coach workflows are either migrated or deliberately denied with a clear error; old cached app gets a safe, understandable failure; and unauthorized users cannot bypass the gate.
6. **Post-cutover monitoring.** Check save/reload results and database/API errors before considering the release complete. Keep the previous known-good app commit and reviewed rollback migration ready.

## Why not simply deploy the RPC?

- The existing writer does not share the advisory lock.
- Deploying only the RPC leaves old clients able to bypass it.
- Deploying a client-side feature flag alone is not a security boundary because cached clients can keep using old code.
- A database gate can prevent mixed writes, but may temporarily reject old clients and any un-audited legitimate write path. That impact must be tested and approved first.

## Current blockers / next checks

- There is only one connected Supabase project, the live production project. No separate Supabase project was found for authenticated integration testing.
- The draft RPC and gate have not been installed anywhere in Supabase.
- All production write call-sites still need a complete audit before deciding the exact trigger scope.
- The RPC snapshot/data shape still needs authenticated testing against the actual schema, RLS policies, grants, and trigger behavior in an isolated Supabase environment.
- A minimal transfer branch based on the current `main` head has not been created. The experiment branch must not be merged wholesale.
- No production migration or deployment is approved by this document.

## Safety boundary

This document is a rollout design, not executable migration SQL. No production branch, deployed app, Supabase schema/data, or trainee record was changed while preparing it.
