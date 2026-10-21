#!/usr/bin/env bash
set -euo pipefail

DB_ARGS=(-h localhost -U postgres -d workout_test -v ON_ERROR_STOP=1)
export PGPASSWORD=postgres

# Add a disposable trigger that pauses the first update after the RPC has
# acquired its per-trainee advisory transaction lock.
psql "${DB_ARGS[@]}" <<'SQL'
CREATE OR REPLACE FUNCTION public.test_delay_plan_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('test.slow_update', true), 'false') = 'true' THEN
    PERFORM pg_sleep(3);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER test_delay_plan_update
BEFORE UPDATE ON public.trainee_workout_plans
FOR EACH ROW EXECUTE FUNCTION public.test_delay_plan_update();
SQL

TRAINEE='11111111-1111-4111-8111-111111111111'
AUTH_SETUP="SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false); SELECT set_config('test.is_coach','true',false); SELECT set_config('test.allowed_trainee','${TRAINEE}',false);"

SNAPSHOT="$(psql "${DB_ARGS[@]}" -At -c "${AUTH_SETUP} SELECT public.experimental_workout_snapshot('${TRAINEE}'::uuid);")"
PLAN_ID="$(printf '%s\n' "${SNAPSHOT}" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read().strip().splitlines()[-1])["plan_id"])')"
FINGERPRINT="$(printf '%s\n' "${SNAPSHOT}" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read().strip().splitlines()[-1])["fingerprint"])')"

SAVE_SQL='SELECT public.experimental_save_trainee_workout(
  '${TRAINEE}'::uuid,
  '${PLAN_ID}'::bigint,
  '${FINGERPRINT}',
  jsonb_build_object('title', :'new_title', 'goal', 'concurrency-test', 'notes', null, 'plan_date', '2026-10-22'),
  '[{"exercise_id":1,"sets":3,"reps":"8","rest_seconds":60,"sort_order":1,"training_system":"normal","training_day":"Session 1"}]'::jsonb
);'

# Both writers use the same snapshot. Writer A pauses inside its UPDATE while
# holding the advisory lock; writer B must wait, then fail the stale snapshot check.
psql "${DB_ARGS[@]}" -At -v new_title='Concurrent writer A' -c "${AUTH_SETUP} SELECT set_config('test.slow_update','true',false); ${SAVE_SQL}" > /tmp/workout-writer-a.log 2>&1 &
A_PID=$!
sleep 1
set +e
psql "${DB_ARGS[@]}" -At -v new_title='Concurrent writer B' -c "${AUTH_SETUP} SELECT set_config('test.slow_update','false',false); ${SAVE_SQL}" > /tmp/workout-writer-b.log 2>&1
B_STATUS=$?
wait "${A_PID}"
A_STATUS=$?
set -e

if [[ "${A_STATUS}" -ne 0 ]]; then
  cat /tmp/workout-writer-a.log
  echo "FAIL: first concurrent writer did not succeed"
  exit 1
fi
if [[ "${B_STATUS}" -eq 0 ]]; then
  cat /tmp/workout-writer-b.log
  echo "FAIL: second concurrent writer unexpectedly succeeded with stale snapshot"
  exit 1
fi
if ! grep -q 'workout changed since it was opened' /tmp/workout-writer-b.log; then
  cat /tmp/workout-writer-b.log
  echo "FAIL: second writer failed for an unexpected reason"
  exit 1
fi

FINAL_TITLE="$(psql "${DB_ARGS[@]}" -At -c "SELECT title FROM public.trainee_workout_plans WHERE id = ${PLAN_ID};")"
if [[ "${FINAL_TITLE}" != 'Concurrent writer A' ]]; then
  echo "FAIL: unexpected final title after concurrent writes: ${FINAL_TITLE}"
  exit 1
fi

echo "PASS: first concurrent writer committed; stale second writer was rejected; no lost update"
