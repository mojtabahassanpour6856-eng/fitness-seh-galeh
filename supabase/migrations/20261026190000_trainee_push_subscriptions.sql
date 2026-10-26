create table public.trainee_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  trainee_id uuid not null references public.trainees(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.trainee_push_subscriptions enable row level security;
grant select, insert, update, delete on public.trainee_push_subscriptions to authenticated;

create policy "Trainees read own push subscriptions"
on public.trainee_push_subscriptions for select to authenticated
using (exists (
  select 1 from public.trainees t
  where t.id = trainee_id and t.auth_user_id = (select auth.uid())
));

create policy "Trainees add own push subscriptions"
on public.trainee_push_subscriptions for insert to authenticated
with check (exists (
  select 1 from public.trainees t
  where t.id = trainee_id and t.auth_user_id = (select auth.uid())
));

create policy "Trainees update own push subscriptions"
on public.trainee_push_subscriptions for update to authenticated
using (exists (
  select 1 from public.trainees t
  where t.id = trainee_id and t.auth_user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.trainees t
  where t.id = trainee_id and t.auth_user_id = (select auth.uid())
));

create policy "Trainees delete own push subscriptions"
on public.trainee_push_subscriptions for delete to authenticated
using (exists (
  select 1 from public.trainees t
  where t.id = trainee_id and t.auth_user_id = (select auth.uid())
));
