-- Restore sequence-backed ID defaults expected by the mobile REST editor.
-- Align sequences to existing IDs before enabling defaults, avoiding duplicate IDs
-- if a sequence's is_called flag was reset. Empty tables start at ID 1.
-- Apply only after review and validation; this file is not applied to production by this PR.

select setval(
  'public.trainee_workout_plans_id_seq'::regclass,
  coalesce((select max(id) from public.trainee_workout_plans), 1),
  exists(select 1 from public.trainee_workout_plans)
);

select setval(
  'public.trainee_workout_exercises_id_seq'::regclass,
  coalesce((select max(id) from public.trainee_workout_exercises), 1),
  exists(select 1 from public.trainee_workout_exercises)
);

alter table public.trainee_workout_plans
  alter column id set default nextval('public.trainee_workout_plans_id_seq'::regclass);

alter table public.trainee_workout_exercises
  alter column id set default nextval('public.trainee_workout_exercises_id_seq'::regclass);
