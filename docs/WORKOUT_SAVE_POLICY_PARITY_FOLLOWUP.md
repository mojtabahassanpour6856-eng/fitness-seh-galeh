# Supabase policy-parity follow-up for atomic workout save

Status: review note only. This file changes no application code, schema, policies, or data.

## Live behavior observed by read-only inspection (2026-10-22)

The production helper functions currently define:

- `private.can_access_trainee(p_trainee_id)`: true when the row belongs to the active approved trainee identified by `auth.uid()`, or when `trainees.coach_user_id = auth.uid()`.
- `private.is_coach()`: true when `profiles.id = auth.uid()` and `profiles.role = 'coach'`.
- The exercise update trigger blocks authenticated non-coaches from changing any field other than `is_completed`.

## Important test-fixture mismatch

The disposable PostgreSQL fixture currently models `private.can_access_trainee` as coach-only. Production permits a trainee to access their own active, approved row. Therefore, the existing disposable integration tests validate the coach path but do not establish parity for trainee reads and completion-state writes.

## Required free CI tests before rollout

1. Model `auth.uid()`, active trainee approval, trainee ownership, coach assignment, and coach role as separate facts in the disposable fixture.
2. Verify an active trainee can SELECT only their own permitted plan and exercise rows.
3. Verify a trainee cannot SELECT another trainee's plan or exercises.
4. Verify a trainee can update only `is_completed`; changes to sets, reps, rest, training system, grouping, ordering, or exercise ID must fail.
5. Verify a trainee cannot call the coach-only RPC, even for their own plan.
6. Verify a coach assigned to trainee A cannot save a plan for trainee B.
7. Re-run create, replacement, rollback, stale-snapshot, and concurrent-save tests after changing fixture policy semantics.
8. Keep these tests in disposable PostgreSQL only. They must not connect to the production Supabase project.

## Release gate

Do not install the RPC or revoke legacy table writes until policy-parity tests pass and every production write path (including alternate editors, copying, reorder, bulk insert, and completion-state writes) has a reviewed migration plan. The current table grants mean merely adding an RPC does not prevent legacy clients from bypassing it.
