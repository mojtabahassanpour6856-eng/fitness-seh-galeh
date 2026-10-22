#!/usr/bin/env bash
set -euo pipefail

# Runs only against the disposable PostgreSQL service in GitHub Actions.
TRAINEE_ID="11111111-1111-4111-8111-111111111111"
PLAN_ID="$(psql -X -At -v ON_ERROR_STOP=1 -c "select id from public.trainee_workout_plans where trainee_id='${TRAINEE_ID}'")"
if [[ -z "$PLAN_ID" ]]; then
  echo "No seeded workout plan available for concurrency test" >&2
  exit 1
fi

SNAPSHOT="$(psql -X -At -v ON_ERROR_STOP=1 -c "
select jsonb_build_object(
  'plan', jsonb_build_object(
    'id', p.id, 'title', p.title,
    'plan_date', to_char(p.plan_date, 'YYYY-MM-DD'),
    'goal', p.goal, 'notes', p.notes
  ),
  'exercises', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'exercise_id', e.exercise_id, 'sets', e.sets,
      'reps', e.reps, 'rest_seconds', e.rest_seconds, 'notes', e.notes,
      'sort_order', e.sort_order, 'training_system', e.training_system,
      'group_key', e.group_key, 'training_day', e.training_day,
      'is_completed', e.is_completed
    ) order by e.sort_order, e.id)
    from public.trainee_workout_exercises e where e.workout_plan_id=p.id
  ), '[]'::jsonb)
)::text from public.trainee_workout_plans p where p.id=${PLAN_ID}
")"

GATE_DIR="$(mktemp -d)"
cleanup() { rm -rf "$GATE_DIR"; }
trap cleanup EXIT

run_save() {
  local title="$1"
  touch "$GATE_DIR/$title.ready"
  # Both workers must reach this barrier before either RPC starts.
  while [[ ! -e "$GATE_DIR/go" ]]; do sleep 0.05; done
  PGOPTIONS="-c statement_timeout=15000 -c lock_timeout=10000" \
    psql -X -v ON_ERROR_STOP=1 -v plan_id="$PLAN_ID" -v snapshot="$SNAPSHOT" >"/tmp/${title}.log" 2>&1 <<SQL
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);
select set_config('test.is_coach', 'true', false);
select set_config('test.trainee_id', '$TRAINEE_ID', false);
select pg_sleep(1);
select public.save_trainee_workout_plan_transaction(
  '$TRAINEE_ID', :'plan_id'::bigint, :'snapshot'::jsonb,
  jsonb_build_object('title', '$title', 'plan_date', '2026-10-26', 'goal', 'concurrency test'),
  '[{"exercise_id":101,"sets":3,"reps":"10","rest_seconds":60,"sort_order":1,"training_system":"normal","training_day":"جلسه اول","is_completed":false}]'::jsonb
);
SQL
}

set +e
run_save "Concurrent-A" & pid_a=$!
run_save "Concurrent-B" & pid_b=$!

# Explicit readiness barrier: both sessions hold the same preloaded snapshot.
# Fail closed if either worker never reaches the barrier.
for _ in $(seq 1 200); do
  if [[ -e "$GATE_DIR/Concurrent-A.ready" && -e "$GATE_DIR/Concurrent-B.ready" ]]; then
    break
  fi
  sleep 0.05
done
if [[ ! -e "$GATE_DIR/Concurrent-A.ready" || ! -e "$GATE_DIR/Concurrent-B.ready" ]]; then
  echo "Timed out waiting for both concurrent-save workers to reach the barrier" >&2
  touch "$GATE_DIR/go"
  wait "$pid_a"; wait "$pid_b"
  exit 1
fi
touch "$GATE_DIR/go"

wait "$pid_a"; status_a=$?
wait "$pid_b"; status_b=$?
set -e

if [[ "$status_a" -eq 0 && "$status_b" -ne 0 ]]; then
  loser="/tmp/Concurrent-B.log"
elif [[ "$status_b" -eq 0 && "$status_a" -ne 0 ]]; then
  loser="/tmp/Concurrent-A.log"
else
  echo "Expected exactly one concurrent save to succeed; statuses: A=$status_a B=$status_b" >&2
  cat /tmp/Concurrent-A.log /tmp/Concurrent-B.log >&2
  exit 1
fi

if ! grep -Eq "Plan or exercises changed since preview|Existing plan changed since preview" "$loser"; then
  echo "The losing save did not fail for the expected stale-snapshot reason" >&2
  cat "$loser" >&2
  exit 1
fi

# Assert the committed database state matches the successful writer.
if [[ "$status_a" -eq 0 ]]; then
  expected_title="Concurrent-A"
else
  expected_title="Concurrent-B"
fi
actual_title="$(PGOPTIONS="-c statement_timeout=10000" psql -X -At -v ON_ERROR_STOP=1 \
  -c "select title from public.trainee_workout_plans where id=$PLAN_ID")"
if [[ "$actual_title" != "$expected_title" ]]; then
  echo "Final plan title mismatch: expected '$expected_title', got '$actual_title'" >&2
  exit 1
fi
exercise_count="$(PGOPTIONS="-c statement_timeout=10000" psql -X -At -v ON_ERROR_STOP=1 \
  -c "select count(*) from public.trainee_workout_exercises where workout_plan_id=$PLAN_ID")"
if [[ "$exercise_count" != "1" ]]; then
  echo "Expected exactly one final exercise row; got '$exercise_count'" >&2
  exit 1
fi

echo "PASS: concurrent saves using the same snapshot: one winner, stale save rejected, final state verified."
