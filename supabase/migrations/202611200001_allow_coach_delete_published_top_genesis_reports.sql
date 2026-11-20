-- Allow coaches to delete only their own published Top Genesis report rows.
-- The report row is removed before its private HTML object is cleaned up by the client.
grant delete on table public.trainee_body_analysis_publications to authenticated;

drop policy if exists trainee_body_analysis_publications_coach_delete
  on public.trainee_body_analysis_publications;
create policy trainee_body_analysis_publications_coach_delete
  on public.trainee_body_analysis_publications
  for delete to authenticated
  using (
    private.is_coach()
    and coach_user_id = (select auth.uid())
    and exists (
      select 1 from public.trainees t
      where t.id = trainee_body_analysis_publications.trainee_id
        and t.coach_user_id = (select auth.uid())
    )
  );

-- Permit cleanup only inside the assigned trainee's published-report folder.
drop policy if exists trainee_health_reports_coach_delete_published
  on storage.objects;
create policy trainee_health_reports_coach_delete_published
  on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'trainee-health-reports'
    and private.is_coach()
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[3] = 'published'
    and exists (
      select 1 from public.trainees t
      where t.id::text = (storage.foldername(name))[2]
        and t.coach_user_id = (select auth.uid())
        and t.approval_status = 'active'
    )
  );
