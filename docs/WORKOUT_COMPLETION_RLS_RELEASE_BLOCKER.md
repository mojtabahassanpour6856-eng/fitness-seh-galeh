# Workout completion write authorization: release blocker

Status: review note and proposed migration only. No production policy, function, grant, or data was changed by this work.

## Read-only live Supabase audit (2026-10-22)

The complete current `pg_policies` result for `public.trainee_workout_exercises` contains exactly these four policies:

- `workout_exercises_select` — SELECT scoped through the parent plan and `private.can_access_trainee(p.trainee_id)`.
- `workout_exercises_insert` — INSERT requires `private.is_coach()` and access to the parent plan.
- `workout_exercises_update` — UPDATE requires `private.is_coach()` and access to the parent plan, in both USING and WITH CHECK.
- `workout_exercises_delete` — DELETE requires `private.is_coach()` and access to the parent plan.

No separate trainee completion UPDATE policy appeared in the live policy list. The live trigger `guard_trainee_workout_exercise_update_trigger` calls `public.guard_trainee_workout_exercise_update()`, which is SECURITY INVOKER. Its body blocks a non-coach from changing any field other than `is_completed`.

**Additional live privilege/trigger check:** the trigger is enabled (`tgenabled = O`) and SECURITY INVOKER. The `authenticated` role currently has table-level column UPDATE privileges across the workout-exercise columns, including prescription fields and `workout_plan_id`; therefore the trigger's column guard is security-critical if a trainee UPDATE policy is added. The candidate policy must never be deployed without validating this guard through authenticated REST requests.

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


## Client payload review (main branch, read-only)

The currently published main-branch HTML defines the trainee completion handler as:

```js
window.toggleWorkoutComplete = async function(id, checked) {
  try {
    await sbWrite(`/trainee_workout_exercises?id=eq.${encodeURIComponent(id)}`, 'PATCH', {is_completed: checked});
    await loadWorkoutForClient();
  } catch (e) {
    alert('ثبت وضعیت حرکت انجام نشد.\\n' + e.message);
  }
};
```

The completion handler's PATCH payload contains only `is_completed`, which matches the intended column-level guard. This is a static source review, not a live browser/network capture, and it does not resolve the RLS blocker.

The same main-branch file also contains coach-side direct writes for adding exercises, copying plans, and other plan-edit operations. Therefore the atomic RPC draft cannot yet be treated as the sole writer. A rollout must inventory and migrate each coach-side write path, account for installed/cached older PWA versions, and preserve the existing trainee UI. Do not add a global write gate or revoke direct writes until compatibility and rollback have been tested.

## Latest disposable CI status (2026-10-22)

Run `39727719937` completed with both `browser-test` and `postgres-integration-test` successful. This remains disposable PostgreSQL evidence; it is not a Supabase REST/JWT staging test.


## Coach workout write-path inventory (main branch, read-only)

Static inspection of `fitness_seh_galeh_FINAL_CLEAN2.html` on `main` (blob SHA `f01fc7ee9ad0cabfa26d6356dd54be1675a22e0c`) found these direct REST write paths in the coach workout workflow:

| Operation | Current direct write | Rollout concern |
| --- | --- | --- |
| Save plan metadata | PATCH `/trainee_workout_plans?id=eq...` or POST `/trainee_workout_plans` | Must map to atomic save payload and preserve current plan fields/date behavior. |
| Add exercise | POST `/trainee_workout_exercises` | Separate insert can leave a partial plan if later steps fail. |
| Delete exercise | DELETE `/trainee_workout_exercises?id=eq...` | Must be represented in the full replacement payload or deliberately retained as a supported legacy operation during transition. |
| Edit prescription | PATCH exercise row with `sets`, `reps`, `rest_seconds`, `notes` | Must not be silently broken by a coach-save gate. |
| Reorder exercises | Two separate PATCH requests changing `sort_order` | Best-effort sequence is not atomic; partial success can leave order inconsistent. |
| Copy plan | POST plan metadata, then POST copied exercise rows | Multi-request flow can create an incomplete copy. |
| Mark exercise complete | PATCH exercise row with only `is_completed` | Trainee-specific authorization blocker documented above; keep separate from coach atomic-save RPC. |

This is a source-level inventory of the main-branch file, not a runtime request capture. The editor experiment and other branches may contain additional paths; before rollout, repeat the inventory across the exact release commit and search all callers of these functions.

## Safe migration sequence (no production changes performed)

1. Keep the existing production write paths unchanged while developing and testing the RPC in disposable CI.
2. Add tests for create, update, delete, reorder, copy, invalid payload rollback, stale snapshot conflict, and concurrent saves.
3. Define an adapter that translates the existing coach form state to one complete plan + exercise payload; preserve the trainee completion field and all currently supported exercise attributes.
4. Switch only the isolated coach editor to the RPC and verify its output before considering any production client rollout.
5. Only after a release build is proven compatible, plan a versioned rollout that accounts for cached/installed PWAs and has a reversible fallback. Do not revoke direct-write permissions globally as part of the first release.
6. Keep trainee completion RLS policy work separate; it requires authenticated REST/JWT testing in a zero-cost isolated environment before production approval.

No production code, database policy, RPC, grant, or trainee data was changed by this inventory.
