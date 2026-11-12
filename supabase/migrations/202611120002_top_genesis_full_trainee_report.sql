-- Store the exact coach-approved, trainee-safe HTML report (including original scan images).
-- Existing publication rows and archived source PDFs remain unchanged.
alter table public.trainee_body_analysis_publications
  add column if not exists report_storage_path text;

-- The existing private bucket already has coach-upload and trainee/assigned-coach read policies.
-- Extend its allow-list without changing its privacy or 10 MB size limit.
update storage.buckets
set allowed_mime_types = case
  when allowed_mime_types is null then array['text/html']::text[]
  else array_append(allowed_mime_types, 'text/html')
end
where id = 'trainee-health-reports'
  and not ('text/html' = any(coalesce(allowed_mime_types, array[]::text[])));
