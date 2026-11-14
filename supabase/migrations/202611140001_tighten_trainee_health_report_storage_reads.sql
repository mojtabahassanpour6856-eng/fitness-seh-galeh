-- Restrict private health-report object reads to the exact trainee folder
-- and either the currently assigned coach or the trainee's own auth folder.
-- This narrows existing access without deleting or moving any stored objects.
drop policy if exists trainee_health_reports_read_own_or_assigned_coach on storage.objects;

create policy trainee_health_reports_read_own_or_assigned_coach
on storage.objects
for select
to authenticated
using (
  bucket_id = 'trainee-health-reports'
  and exists (
    select 1
    from public.trainees t
    where t.id::text = (storage.foldername(name))[2]
      and t.approval_status = 'active'
      and (
        (
          t.auth_user_id = auth.uid()
          and (storage.foldername(name))[1] in (
            auth.uid()::text,
            t.coach_user_id::text
          )
        )
        or (
          private.is_coach()
          and t.coach_user_id = auth.uid()
          and (storage.foldername(name))[1] in (
            auth.uid()::text,
            t.auth_user_id::text
          )
        )
      )
  )
);
