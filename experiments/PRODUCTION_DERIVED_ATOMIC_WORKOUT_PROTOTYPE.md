# Production-derived atomic workout editor prototype

Date: 2026-10-22
Branch: `coach-workout-editor-isolated-preview`
Production source SHA: `659096df630de2654d8c32725c80d00a5c5db666`
Experiment file: `experiments/production-derived-index.html`
Status: isolated prototype only; not deployed.

## Implemented in the isolated copy

- Created the experiment copy from the exact production `index.html` blob, then changed only the coach workout-editor section and its two state variables.
- Adding or deleting an exercise now stages the change in the browser instead of immediately issuing a REST table mutation.
- The save handler builds one complete ordered plan payload and makes one call to `/rpc/save_trainee_workout_plan_transaction`.
- For existing plans, it captures the plan and exercise-row snapshot when loaded and passes that snapshot to the RPC so stale previews can be rejected.
- The save button blocks duplicate submissions, validates selected trainee/date/exercise IDs, and checks the RPC response.
- On RPC failure, staged edits remain in the page and no legacy table-write fallback is attempted.
- A successful RPC is distinguished from a subsequent read-back failure so the UI does not falsely claim that the database save itself failed.

## Regression protection added

`tests/production-workout-atomic-prototype.test.js` checks that:
- content outside the explicitly isolated coach workout-editor section remains byte-for-byte identical to `index.html`;
- the save path uses the RPC only;
- add/delete operations do not call the old table-write helper;
- the baseline snapshot is captured/reset as expected;
- inline JavaScript blocks parse.

The experiment workflow was updated to run this test along with the existing browser and disposable-PostgreSQL tests.

## What is not yet proven

- The new RPC is not installed in the production Supabase project, so the prototype cannot yet complete a live save.
- The new test suite must finish successfully before treating this copy as ready.
- The disposable PostgreSQL fixture does not reproduce every production RLS policy and trigger. A final review of actual authenticated coach privileges, exercise trigger behavior, and the function grants is still required before any migration.
- No production code or production data has been changed.

## Rollout gate

Do not merge or deploy this prototype yet. First confirm the new CI run passes; then validate the RPC against a disposable environment that matches the live schema and relevant policies/triggers. Only after that review should the RPC migration and app integration be proposed for explicit approval.
