-- Restore the sequence-backed ID defaults expected by the mobile REST editor.
-- Apply only after review and validation; this file is not applied to production by this PR.
alter table public.trainee_workout_plans
  alter column id set default nextval('public.trainee_workout_plans_id_seq'::regclass);

alter table public.trainee_workout_exercises
  alter column id set default nextval('public.trainee_workout_exercises_id_seq'::regclass);
