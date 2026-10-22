# Workout-save test run review

Reviewed: 2026-10-22
Branch under review: `coach-workout-editor-isolated-preview`

## Verified GitHub Actions result

Workflow run: `39720753008`
Commit tested by that run: `ffca668133a642856a38740fc54779b319aded87`
Run URL: https://github.com/mojtabahassanpour6856-eng/fitness-seh-galeh/actions/runs/39720753008

The GitHub Actions API reports the run completed successfully. Both jobs concluded `success`:

- `browser-test`: Playwright installation, static SQL-draft guardrails, and Chromium planner tests all completed successfully.
- `postgres-integration-test`: disposable PostgreSQL fixture setup, installation of the draft RPC into that disposable database, integration tests, and concurrent stale-snapshot test all completed successfully.

## What this does and does not establish

This is meaningful automated evidence that the browser and disposable-PostgreSQL suites passed on the recorded commit. The PostgreSQL test did not install the draft function into Supabase production; it used the workflow's ephemeral PostgreSQL service.

However, this run's tested commit is `ffca668...`, which predates the later documentation-only commits for the routing audit. The app/test source files were not changed by those documentation commits, but this should not be described as a new run on the current branch head.

These tests also do not prove a live authenticated coach session, live Supabase RLS/trigger behavior, or production entry-point coverage. The same-branch app copy's launch bridge does not provide the atomic opt-in flag, so the experimental editor's save action remains fail-closed by default.

## Decision

Keep atomic saving disabled in the live app. Do not apply the SQL draft to Supabase production. Before rollout, trigger a fresh workflow against the current branch head, confirm the actual deployed app source matches the reviewed call path, and run any required authenticated integration tests only against a disposable environment.
