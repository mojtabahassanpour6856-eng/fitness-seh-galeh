-- Identity columns already generate IDs. Do not ALTER COLUMN ... SET DEFAULT:
-- PostgreSQL rejects that for IDENTITY columns. This migration only realigns
-- each identity sequence to existing rows, preventing duplicate IDs on next insert.
-- Review before applying; this file is not applied to production by this PR.

select setval(
  pg_get_serial_sequence('public.trainee_workout_plans', 'id')::regclass,
  coalesce((select max(id) from public.trainee_workout_plans), 1),
  exists(select 1 from public.trainee_workout_plans)
);

select setval(
  pg_get_serial_sequence('public.trainee_workout_exercises', 'id')::regclass,
  coalesce((select max(id) from public.trainee_workout_exercises), 1),
  exists(select 1 from public.trainee_workout_exercises)
);
