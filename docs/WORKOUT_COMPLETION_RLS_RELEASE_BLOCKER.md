# Workout completion write authorization: release blocker

Status: review note only. No production policy, function, grant, or data was changed.

The read-only production policy review recorded that UPDATE on `public.trainee_workout_exercises` is restricted by RLS to `private.is_coach()` plus access to the parent plan. The live update trigger separately allows a non-coach to change only `is_completed`.

These controls have different jobs: a trigger can reject forbidden changes, but it does not grant table access. If the reviewed UPDATE policy list is complete, a trainee's completion-only UPDATE is still denied by RLS before the trigger can make that change. The app's trainee completion feature must not be assumed to work from trigger behavior alone.

Before cutover:
1. Re-read the complete live policy list for this table and verify whether a separate trainee completion policy exists.
2. In a disposable Supabase-like environment, test the trainee's authenticated REST UPDATE that changes only `is_completed`.
3. Confirm a trainee cannot update sets, reps, rest, exercise ID, grouping, ordering, or training system, and cannot write another trainee's rows.
4. If production policy needs adjustment, design and review that change separately; do not loosen RLS or modify production without explicit approval and a safe rollback plan.

This is an explicit release gate. The current atomic-save RPC is coach-only and must not be used to route trainee completion writes.
