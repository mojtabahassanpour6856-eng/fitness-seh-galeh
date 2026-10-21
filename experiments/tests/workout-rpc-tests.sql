-- Runs only against the disposable PostgreSQL service created by the CI workflow.
\set ON_ERROR_STOP on
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);
SELECT set_config('test.is_coach', 'true', false);
SELECT set_config('test.allowed_trainee', '11111111-1111-4111-8111-111111111111', false);
DO $test$
DECLARE
  trainee constant uuid := '11111111-1111-4111-8111-111111111111';
  snap jsonb;
  snap_after jsonb;
  saved jsonb;
  pid bigint;
  n integer;
  failed boolean;
BEGIN
  snap := public.experimental_workout_snapshot(trainee);
  IF (snap->>'plan_id') IS NOT NULL OR (snap->>'plan_count')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL: initial snapshot was not empty';
  END IF;

  saved := public.experimental_save_trainee_workout(
    trainee, NULL, snap->>'fingerprint',
    '{"title":"Test plan","goal":"strength","notes":null,"plan_date":"2026-10-21"}'::jsonb,
    '[{"exercise_id":1,"sets":3,"reps":"8","rest_seconds":60,"sort_order":1,"training_system":"normal","training_day":"Session 1"},{"exercise_id":2,"sets":3,"reps":"10","rest_seconds":45,"sort_order":2,"training_system":"normal","training_day":"Session 1"}]'::jsonb
  );
  pid := (saved->>'plan_id')::bigint;
  SELECT count(*) INTO n FROM public.trainee_workout_exercises WHERE workout_plan_id = pid;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL: expected 2 inserted exercises, got %', n; END IF;
  RAISE NOTICE 'PASS: create plan and insert two exercises';

  snap_after := public.experimental_workout_snapshot(trainee);
  failed := false;
  BEGIN
    PERFORM public.experimental_save_trainee_workout(
      trainee, pid, 'stale-fingerprint',
      '{"title":"Must not save","plan_date":"2026-10-22"}'::jsonb,
      '[{"exercise_id":3,"sets":1,"reps":"1","rest_seconds":1,"sort_order":1,"training_system":"normal"}]'::jsonb
    );
  EXCEPTION WHEN SQLSTATE '40001' THEN failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'FAIL: stale fingerprint accepted'; END IF;
  SELECT count(*) INTO n FROM public.trainee_workout_exercises WHERE workout_plan_id = pid;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL: stale write changed old exercise rows'; END IF;
  RAISE NOTICE 'PASS: stale fingerprint rejected without changing rows';

  failed := false;
  BEGIN
    PERFORM public.experimental_save_trainee_workout(
      trainee, pid, snap_after->>'fingerprint',
      '{"title":"Bad order","plan_date":"2026-10-22"}'::jsonb,
      '[{"exercise_id":1,"sets":1,"rest_seconds":1,"sort_order":1,"training_system":"normal"},{"exercise_id":2,"sets":1,"rest_seconds":1,"sort_order":1,"training_system":"normal"}]'::jsonb
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'FAIL: duplicate sort order accepted'; END IF;
  RAISE NOTICE 'PASS: duplicate sort order rejected';

  PERFORM set_config('test.fail_insert', 'true', false);
  failed := false;
  BEGIN
    PERFORM public.experimental_save_trainee_workout(
      trainee, pid, snap_after->>'fingerprint',
      '{"title":"Must roll back","goal":"changed","plan_date":"2026-10-22"}'::jsonb,
      '[{"exercise_id":3,"sets":2,"reps":"5","rest_seconds":30,"sort_order":1,"training_system":"normal"}]'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN failed := true;
  END;
  PERFORM set_config('test.fail_insert', 'false', false);
  IF NOT failed THEN RAISE EXCEPTION 'FAIL: forced child insert error did not occur'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.trainee_workout_plans WHERE id = pid AND title = 'Test plan' AND goal = 'strength') THEN
    RAISE EXCEPTION 'FAIL: parent metadata was not rolled back';
  END IF;
  SELECT count(*) INTO n FROM public.trainee_workout_exercises WHERE workout_plan_id = pid;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL: child rows were not rolled back, count %', n; END IF;
  RAISE NOTICE 'PASS: forced insert failure rolled back parent and children atomically';

  -- A valid update after the rollback test must still succeed.
  snap_after := public.experimental_workout_snapshot(trainee);
  saved := public.experimental_save_trainee_workout(
    trainee, pid, snap_after->>'fingerprint',
    '{"title":"Updated test plan","goal":"hypertrophy","notes":"update succeeded","plan_date":"2026-10-22"}'::jsonb,
    '[{"exercise_id":3,"sets":4,"reps":"12","rest_seconds":40,"sort_order":1,"training_system":"normal","training_day":"Session 1"}]'::jsonb
  );
  IF (saved->>'plan_id')::bigint <> pid THEN RAISE EXCEPTION 'FAIL: update changed plan identity'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.trainee_workout_plans WHERE id = pid AND title = 'Updated test plan') THEN
    RAISE EXCEPTION 'FAIL: valid update did not update plan metadata';
  END IF;
  SELECT count(*) INTO n FROM public.trainee_workout_exercises WHERE workout_plan_id = pid;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: valid update did not replace exercise rows'; END IF;
  RAISE NOTICE 'PASS: valid update replaced plan metadata and exercises';

  PERFORM set_config('test.is_coach', 'false', false);
  failed := false;
  BEGIN
    PERFORM public.experimental_workout_snapshot(trainee);
  EXCEPTION WHEN SQLSTATE '42501' THEN failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'FAIL: unauthorized snapshot accepted'; END IF;
  RAISE NOTICE 'PASS: unauthorized snapshot rejected';
END
$test$;
RESET ROLE;
