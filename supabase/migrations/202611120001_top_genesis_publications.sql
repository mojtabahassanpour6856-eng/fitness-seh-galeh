-- Publish coach-approved Top Genesis analysis snapshots to the linked trainee.
-- This is additive: existing body_analysis_reports and body_analyses records are untouched.
create table if not exists public.trainee_body_analysis_publications (
  id uuid primary key default gen_random_uuid(),
  trainee_id uuid not null references public.trainees(id) on delete cascade,
  coach_user_id uuid not null references auth.users(id) on delete restrict,
  analysis_date date not null,
  report_metrics jsonb not null default '{}'::jsonb
    check (jsonb_typeof(report_metrics) = 'object'),
  training_notes text not null
    check (char_length(training_notes) between 1 and 4000),
  nutrition_notes text not null
    check (char_length(nutrition_notes) between 1 and 4000),
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists trainee_body_analysis_publications_trainee_date_idx
  on public.trainee_body_analysis_publications (trainee_id, analysis_date asc, created_at asc);

alter table public.trainee_body_analysis_publications enable row level security;

grant select, insert on public.trainee_body_analysis_publications to authenticated;

drop policy if exists trainee_body_analysis_publications_coach_select
  on public.trainee_body_analysis_publications;
create policy trainee_body_analysis_publications_coach_select
  on public.trainee_body_analysis_publications
  for select to authenticated
  using (
    private.is_coach()
    and coach_user_id = (select auth.uid())
    and exists (
      select 1 from public.trainees t
      where t.id = trainee_body_analysis_publications.trainee_id
        and t.coach_user_id = (select auth.uid())
    )
  );

drop policy if exists trainee_body_analysis_publications_coach_insert
  on public.trainee_body_analysis_publications;
create policy trainee_body_analysis_publications_coach_insert
  on public.trainee_body_analysis_publications
  for insert to authenticated
  with check (
    private.is_coach()
    and coach_user_id = (select auth.uid())
    and exists (
      select 1 from public.trainees t
      where t.id = trainee_body_analysis_publications.trainee_id
        and t.coach_user_id = (select auth.uid())
    )
  );

drop policy if exists trainee_body_analysis_publications_trainee_select
  on public.trainee_body_analysis_publications;
create policy trainee_body_analysis_publications_trainee_select
  on public.trainee_body_analysis_publications
  for select to authenticated
  using (
    exists (
      select 1 from public.trainees t
      where t.id = trainee_body_analysis_publications.trainee_id
        and t.auth_user_id = (select auth.uid())
        and t.approval_status = 'approved'
    )
  );

-- No trainee INSERT/UPDATE/DELETE policies are created. Published snapshots are immutable to trainees.
