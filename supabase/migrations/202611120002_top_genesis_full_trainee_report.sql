-- Store the exact coach-approved, trainee-safe HTML report (including original scan images).
-- Existing publication rows and archived source PDFs remain unchanged.
alter table public.trainee_body_analysis_publications
  add column if not exists report_storage_path text;

-- The existing private bucket already has coach-upload and trainee/assigned-coach read policies.
-- Extend its allow-list without changing its privacy or 10 MB size limit.
update storage.buckets
set allowed_mime_types = array(
  select distinct mime_type
  from unnest(coalesce(allowed_mime_types, array[]::text[]) || array['text/html']::text[]) as mime_type
)
where id = 'trainee-health-reports'
  and not ('text/html' = any(coalesce(allowed_mime_types, array[]::text[])));
