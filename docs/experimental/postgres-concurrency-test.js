'use strict';

const { Pool } = require('pg');
const assert = require('node:assert/strict');

const pool = new Pool({
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'postgres',
  max: 4,
});

async function withClient(fn) {
  const client = await pool.connect();
  try { return await fn(client); } finally { client.release(); }
}

async function main() {
  await pool.query(`
    CREATE TABLE recovery_requests_ci (
      id bigserial PRIMARY KEY,
      trainee_id text NOT NULL,
      status text NOT NULL,
      attempts integer NOT NULL DEFAULT 0
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX recovery_active_ci
    ON recovery_requests_ci (trainee_id)
    WHERE status IN ('pending', 'approved')
  `);

  // Separate PostgreSQL sessions race to claim the same approved request.
  const inserted = await pool.query(
    "INSERT INTO recovery_requests_ci (trainee_id,status) VALUES ('claim-race','approved') RETURNING id"
  );
  const id = inserted.rows[0].id;
  const claim = () => withClient(client => client.query(
    "UPDATE recovery_requests_ci SET status='processing' WHERE id=$1 AND status='approved' RETURNING id",
    [id]
  ));
  const claims = await Promise.all([claim(), claim()]);
  assert.equal(claims.reduce((n, r) => n + r.rowCount, 0), 1,
    'conditional status claim must have exactly one winner');
  console.log('PASS: two independent sessions; exactly one conditional claim winner');

  // Characterize the current partial-index gap: processing is not included.
  await pool.query(
    "INSERT INTO recovery_requests_ci (trainee_id,status) VALUES ('processing-gap','approved')"
  );
  await pool.query(
    "UPDATE recovery_requests_ci SET status='processing' WHERE trainee_id='processing-gap'"
  );
  await pool.query(
    "INSERT INTO recovery_requests_ci (trainee_id,status) VALUES ('processing-gap','pending')"
  );
  const gap = await pool.query(
    "SELECT count(*)::int AS n FROM recovery_requests_ci WHERE trainee_id='processing-gap'"
  );
  assert.equal(gap.rows[0].n, 2,
    'this fixture intentionally documents that the current pending/approved-only index permits a new pending row during processing');
  console.log('KNOWN GAP REPRODUCED: partial unique index permits a second pending row while an earlier row is processing');

  // Proposed guard: include processing in the active-flow uniqueness boundary.
  await pool.query(`
    CREATE TABLE recovery_requests_guard_ci (
      id bigserial PRIMARY KEY,
      trainee_id text NOT NULL,
      status text NOT NULL
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX recovery_active_guard_ci
    ON recovery_requests_guard_ci (trainee_id)
    WHERE status IN ('pending', 'approved', 'processing')
  `);
  await pool.query(
    "INSERT INTO recovery_requests_guard_ci (trainee_id,status) VALUES ('guarded-trainee','approved')"
  );
  await pool.query(
    "UPDATE recovery_requests_guard_ci SET status='processing' WHERE trainee_id='guarded-trainee'"
  );
  await assert.rejects(
    pool.query("INSERT INTO recovery_requests_guard_ci (trainee_id,status) VALUES ('guarded-trainee','pending')"),
    error => error && error.code === '23505',
    'the proposed index must reject a second active flow while the first is processing'
  );
  const guardedCount = await pool.query(
    "SELECT count(*)::int AS n FROM recovery_requests_guard_ci WHERE trainee_id='guarded-trainee'"
  );
  assert.equal(guardedCount.rows[0].n, 1);
  await pool.query(
    "UPDATE recovery_requests_guard_ci SET status='completed' WHERE trainee_id='guarded-trainee'"
  );
  await pool.query(
    "INSERT INTO recovery_requests_guard_ci (trainee_id,status) VALUES ('guarded-trainee','pending')"
  );
  console.log('PASS: proposed three-state unique index blocks parallel flow during processing and permits a new flow after completion');

  // Atomic attempt increments under contention; cap must not be exceeded.
  const attemptsRow = await pool.query(
    "INSERT INTO recovery_requests_ci (trainee_id,status,attempts) VALUES ('attempt-race','approved',0) RETURNING id"
  );
  const attemptId = attemptsRow.rows[0].id;
  const attempt = () => withClient(client => client.query(
    "UPDATE recovery_requests_ci SET attempts=attempts+1 WHERE id=$1 AND attempts<3 RETURNING attempts",
    [attemptId]
  ));
  const results = await Promise.all(Array.from({ length: 8 }, () => attempt()));
  assert.equal(results.reduce((n, r) => n + r.rowCount, 0), 3,
    'atomic attempt counter must admit exactly the configured cap');
  const final = await pool.query("SELECT attempts FROM recovery_requests_ci WHERE id=$1", [attemptId]);
  assert.equal(final.rows[0].attempts, 3);
  console.log('PASS: eight concurrent attempts; atomic counter stops exactly at three');

  console.log('All disposable PostgreSQL concurrency checks passed.');
}

main()
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => pool.end());
