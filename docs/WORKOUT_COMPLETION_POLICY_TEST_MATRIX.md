# Trainee workout-completion policy test matrix

Status: **BLOCKED FOR RELEASE**. The proposed policy has not been installed in production and must be tested only in a disposable database or staging project first.

## Intended behavior

A trainee may change only trainee_workout_exercises.is_completed on exercise rows belonging to their own accessible workout plan. They must not edit exercise prescription, plan metadata, another trainee's rows, or any coach-owned data. The existing trigger is a second guardrail; it does not replace an RLS UPDATE policy.

## Required tests

| Actor / action | Expected |
| --- | --- |
| Approved trainee marks own exercise complete | Allowed |
| Approved trainee marks own exercise incomplete | Allowed |
| Trainee changes sets, reps, rest_seconds, exercise_id, sort_order, training_system, group_key, or training_day | Denied |
| Trainee updates an exercise belonging to another trainee | Zero rows affected or denied |
| Unapproved trainee attempts completion update | Denied |
| Unrelated authenticated user attempts completion update | Denied |
| Anonymous caller attempts completion update | Denied |
| Coach updates a permitted exercise | Existing coach policy behavior preserved |
| Trainee submits a mixed update changing is_completed plus prescription fields | Entire update denied by trigger |
| Trainee uses stale/old PWA and sends only is_completed | Works if the supported request shape remains unchanged |
| Trainee uses old PWA and submits other changed columns | Denied without changing any row |

## Candidate policy under test (not for production execution)

```sql
create policy trainee_completion_update_candidate
on public.trainee_workout_exercises for update to authenticated
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

This candidate relies on the existing trigger to restrict non-coach updates to is_completed. Test actual JWT-backed REST requests as well as SQL role simulation; test fixtures that set custom GUCs alone do not prove the live auth path works.

## Rollback for a separately approved staging/production migration

```sql
drop policy if exists trainee_completion_update
on public.trainee_workout_exercises;
```

Do not apply or roll back this policy against production without explicit approval and a verified migration plan.
