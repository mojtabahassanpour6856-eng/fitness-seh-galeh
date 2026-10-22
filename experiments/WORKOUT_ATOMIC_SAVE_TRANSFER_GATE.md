# Atomic workout save — transfer gate

Date: 2026-10-22
Branch: `coach-workout-editor-isolated-preview`
Production branch: `main`

## Current disposition

**Prepared for controlled review, not approved for production transfer.** The production-derived editor copy and its tests are isolated. Do not merge this branch wholesale: it is 70 commits ahead and 2 commits behind `main`, and the comparison contains unrelated experimental files. Do not deploy `experiments/production-derived-index.html` as the live app entry point.

## Safety boundary

- Production `index.html`, GitHub Pages, Supabase schema/data, student UI, and existing workout plans remain unchanged.
- The proposed RPC is not installed in production.
- The prototype uses one RPC for plan+exercise writes and has no legacy-write fallback.
- The adapter fails closed unless `enableAtomicRpc === true`; the current app launch context does not enable that flag.
- The disposable PostgreSQL test suite has passed on a previously recorded commit, but that is not equivalent to a fresh pass on the current branch head or a test against production RLS/triggers.

## Verification evidence

- Source isolation: the production-derived copy was checked against the production `index.html`; after normalizing the two added state variables and replacing the specifically targeted coach workout-editor section, all remaining content was byte-for-byte identical at the time of that check.
- SQL fixture tests previously passed for save/replacement, validation, authorization, rollback, and concurrent stale-snapshot rejection in disposable PostgreSQL.
- The CI workflow now includes a guard asserting that the atomic adapter is opt-in, calls the RPC only, passes the expected snapshot, and does not fall back to legacy table mutations. A fresh run on the current head must be confirmed before this gate can be marked complete.
- Read-only live-schema review found the expected tables/columns and helper grants, but did not execute DDL/DML in production.

## Mandatory gates before any production transfer

1. Confirm the fresh GitHub Actions run triggered by the latest test commit has completed successfully; inspect both browser and disposable-PostgreSQL jobs.
2. Use a separate disposable Supabase project/database that reproduces the relevant live schema, RLS policies, helper functions, grants, and exercise update trigger. No production writes for testing.
3. Test with an authenticated coach session: create a first plan, update an existing plan, reject a stale snapshot, reject a non-coach, reject an inaccessible trainee, and verify full rollback after an injected failure.
4. Reconcile the RPC snapshot contract with the exact live adapter data shape, including NULL legacy values, numeric IDs/order, completion flags, grouping fields, and date formatting.
5. Resolve the mixed-writer race: the existing production multi-request writer does not take the RPC advisory lock. The rollout must switch the relevant editor to a single writer in one controlled release, or introduce and test a shared concurrency protocol. Do not enable RPC and legacy writes concurrently for the same trainee.
6. Prepare a minimal production transfer based on the current `main` head, containing only reviewed app changes and the separately reviewed migration. Do not merge this 70-commit experiment branch wholesale.
7. Before any production database migration or app deployment, obtain explicit approval. Apply the database migration first only after review, verify grants/RLS, then deploy the matching app commit. Keep the known-good production commit for rollback.
8. Post-deploy, verify using a designated test trainee only with explicit permission; check coach save/reload and trainee read-only display, then confirm no unrelated student UI changed.

## Rollback requirements

- Revert the app entry point to the last known-good commit if the editor cannot save/reload correctly.
- Revoke execution of the exact RPC signature and use a reviewed rollback migration if necessary.
- Never delete or blanket-restore workout data as a rollback.
- Inspect any potentially affected plan read-only before considering a narrowly scoped repair, which requires explicit approval.

## Decision

The code package is organized for review, but production transfer remains blocked until the fresh CI result, authenticated disposable Supabase integration, and single-writer rollout plan are verified. This document intentionally does not authorize a production change.
