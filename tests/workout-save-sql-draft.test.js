// Static guardrails only: this does NOT parse or execute SQL against PostgreSQL.
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sql = fs.readFileSync('experiments/sql/save_trainee_workout_plan_transaction.sql', 'utf8');
const adapter = fs.readFileSync('experiments/workout-persistence-adapter.js', 'utf8');

function check(name, fn) {
  fn();
  console.log('PASS: ' + name);
}

check('SQL remains explicitly marked as a draft', () => {
  assert.match(sql, /DRAFT ONLY/i);
});

check('RPC is SECURITY INVOKER and does not use SECURITY DEFINER', () => {
  assert.match(sql, /security invoker/i);
  assert.doesNotMatch(sql, /security definer/i);
});

check('RPC checks authentication, coach role, and trainee access', () => {
  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /private\.is_coach\(\)/);
  assert.match(sql, /private\.can_access_trainee\(p_trainee_id\)/);
});

check('RPC serializes saves for the same trainee and guards expected plan id', () => {
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /p_expected_plan_id/);
  assert.match(sql, /Multiple existing workout plans found/);
});

check('SQL whitelist exactly covers the persistence adapter training-system values', () => {
  const adapterValues = [...adapter.matchAll(/^\s*['"][^'"]+['"]:\s*['"]([^'"]+)['"]/gm)]
    .map(match => match[1]);
  const sqlWhitelistMatch = sql.match(/training_system\) not in \(([^)]+)\)/);
  assert.ok(sqlWhitelistMatch, 'SQL training-system whitelist must exist');
  const sqlValues = [...sqlWhitelistMatch[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.deepEqual([...new Set(sqlValues)].sort(), [...new Set(adapterValues)].sort());
});

check('RPC rejects invalid exercise payloads and verifies exercise-bank ids', () => {
  assert.match(sql, /Exercise count must be between 1 and 100/);
  assert.match(sql, /Exercise sort_order values must be unique/);
  assert.match(sql, /missing from the exercise bank/);
});

check('RPC function execution is revoked from public and anon and granted to authenticated', () => {
  assert.match(sql, /revoke all on function[\s\S]*from public/i);
  assert.match(sql, /revoke all on function[\s\S]*from anon/i);
  assert.match(sql, /grant execute on function[\s\S]*to authenticated/i);
});

check('Checklist keeps staging rollback and concurrency tests as deployment blockers', () => {
  const checklist = fs.readFileSync('experiments/WORKOUT_SAVE_RPC_REVIEW_CHECKLIST.md', 'utf8');
  assert.match(checklist, /disposable\/staging Supabase project/i);
  assert.match(checklist, /forced failure/i);
  assert.match(checklist, /simultaneous save attempts/i);
  assert.match(checklist, /explicit approval/i);
});

console.log('Static draft checks passed. No SQL was parsed or executed; no database was contacted.');
