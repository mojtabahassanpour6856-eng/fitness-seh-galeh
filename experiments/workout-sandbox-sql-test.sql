-- SAFETY: run ONLY in Supabase project fitness-seh-galeh-test (ref udptdznbvewkublvzmtm).
-- This test inserts temporary fake workout data and deletes it before returning.
-- It must not be run against production project qfakyudgidsumeuoqoot.
DO $$
DECLARE
  fake_trainee constant uuid := '11111111-1111-4111-8111-111111111111';
  plan_id bigint;
  found_rows integer;
  mode text;
  required_rows integer;
  i integer;
BEGIN
  FOREACH mode IN ARRAY ARRAY['normal','superset','triset'] LOOP
    required_rows := CASE mode WHEN 'normal' THEN 1 WHEN 'superset' THEN 2 ELSE 3 END;

    INSERT INTO public.trainee_workout_plans (trainee_id, title, plan_date)
    VALUES (fake_trainee, 'SQL-SANDBOX-' || mode, CURRENT_DATE)
    RETURNING id INTO plan_id;

    IF plan_id IS NULL THEN
      RAISE EXCEPTION 'Generated plan id missing for %', mode;
    END IF;

    FOR i IN 1..required_rows LOOP
      INSERT INTO public.trainee_workout_exercises
        (workout_plan_id, exercise_id, sets, reps, rest_seconds, sort_order,
         training_system, group_key, training_day, is_completed)
      VALUES
        (plan_id, 100 + i, 3, '12', 60, i, mode,
         CASE WHEN mode = 'normal' THEN NULL ELSE upper(mode) || '-SQL-TEST' END,
         'روز اول', false);
    END LOOP;

    SELECT count(*) INTO found_rows
    FROM public.trainee_workout_exercises WHERE workout_plan_id = plan_id;

    IF found_rows <> required_rows THEN
      RAISE EXCEPTION 'Expected % rows for %, found %', required_rows, mode, found_rows;
    END IF;

    IF mode <> 'normal' AND (
      SELECT count(DISTINCT group_key)
      FROM public.trainee_workout_exercises WHERE workout_plan_id = plan_id
    ) <> 1 THEN
      RAISE EXCEPTION 'Group key validation failed for %', mode;
    END IF;

    DELETE FROM public.trainee_workout_exercises WHERE workout_plan_id = plan_id;
    DELETE FROM public.trainee_workout_plans WHERE id = plan_id;
  END LOOP;
END $$;

-- Expected result: zero temporary workout rows remain.
SELECT 'trainee_workout_plans' AS table_name, count(*)::int AS rows
FROM public.trainee_workout_plans
UNION ALL
SELECT 'trainee_workout_exercises', count(*)::int
FROM public.trainee_workout_exercises;
