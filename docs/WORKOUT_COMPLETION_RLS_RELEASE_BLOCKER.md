# Workout completion write authorization: release blocker

Status: review note and proposed migration only. No production policy, function, grant, or data was changed by this work.

## Read-only live Supabase audit (2026-10-22)

The complete current `pg_policies` result for `public.trainee_workout_exercises` contains exactly these four policies:

- `workout_exercises_select` — SELECT scoped through the parent plan and `private.can_access_trainee(p.trainee_id)`.
- `workout_exercises_insert` — INSERT requires `private.is_coach()` and access to the parent plan.
- `workout_exercises_update` — UPDATE requires `private.is_coach()` and access to the parent plan, in both USING and WITH CHECK.
- `workout_exercises_delete` — DELETE requires `private.is_coach()` and access to the parent plan.

No separate trainee completion UPDATE policy appeared in the live policy list. The live trigger `guard_trainee_workout_exercise_update_trigger` calls `public.guard_trainee_workout_exercise_update()`, which is SECURITY INVOKER. Its body blocks a non-coach from changing any field other than `is_completed`.

**Conclusion:** based on this live policy snapshot, a trainee's completion-only UPDATE is blocked by RLS before the trigger can permit it. The current app feature must not be assumed to work just because the trigger has a completion exception.

## Disposable CI evidence and limits

The free GitHub Actions run `39726767840` completed successfully: both `browser-test` and `postgres-integration-test` passed. The integration fixture models trainee identity and coach assignment, confirms own-row reads and cross-trainee read isolation, demonstrates the current coach-only UPDATE policy denying completion writes, and then adds a candidate policy in the disposable database only. With that candidate, completion-state updates pass while a prescription edit is rejected by the trigger.

This is disposable PostgreSQL integration, **not** an authenticated REST test against a separate Supabase staging project. It does not prove the live API behavior end-to-end. The production project was only queried read-only for this audit.

## Proposed policy change — NOT EXECUTED

Only after the remaining release checks below pass, the following is the candidate migration to review. It is intentionally a separate permissive UPDATE policy: the existing coach policy remains in place, and this policy scopes the candidate trainee update to rows whose parent plan is accessible to the authenticated identity. The existing trigger remains the column-level guard.

```sql
-- PROPOSED ONLY. Do not run automatically or against production without approval.
create policy trainee_completion_update
on public.trainee_workout_exercises
for update
to authenticated
using (
  exists (
    select 1
    from public.trainee_workout_plans p
    where p.id = workout_plan_id
      and private.can_access_trainee(p.trainee_id)
  )
)
with check (
  exists (
    select 1
    from public.trainee_workout_plans p
    where p.id = workout_plan_id
      and private.can_access_trainee(p.trainee_id)
  )
);
```

### Rollback proposal

If this exact policy is installed and must be rolled back, remove only the new policy; do not drop or replace the existing coach policy or trigger:

```sql
-- Rollback for the proposed policy above only.
drop policy if exists trainee_completion_update
on public.trainee_workout_exercises;
```

Rollback disables trainee completion updates again; it does not change existing workout rows. A pre-deployment snapshot of the complete policy list must be retained so any unexpected policy drift is detected.

## Required release gates

1. Re-read the full live policy list immediately before any deployment and check that it matches the snapshot above.
2. In an isolated Supabase environment with real authenticated JWTs, test the REST update as an active trainee: own row completion succeeds; another trainee's row affects zero rows or is denied; changing sets, reps, rest, exercise ID, grouping, ordering, training system, or `workout_plan_id` fails.
3. Test a non-approved trainee, a coach assigned to another trainee, an anonymous caller, and the coach's existing edit flow.
4. Verify the trigger is enabled, remains SECURITY INVOKER, and cannot be bypassed by the app's normal authenticated client. Never use the service-role key for trainee requests.
5. Check column privileges and all permissive/restrictive policies as well as table grants; do not assume the trigger alone grants or limits table access.
6. Review the trainee app's actual completion-update payload and ensure it updates only `is_completed`.
7. Keep this change separate from the atomic coach-save RPC rollout. The coach-only RPC must not be used for trainee completion writes.
8. No production policy or RPC changes, legacy write revocations, PR merges, or trainee UI changes without explicit approval and a reviewed rollback plan.

## Current release status

**BLOCKED / NOT DEPLOYED.** The live policy audit confirms a likely completion-write RLS blocker. The candidate policy passed the disposable CI simulation, but authenticated Supabase REST verification and final security review are still outstanding.
