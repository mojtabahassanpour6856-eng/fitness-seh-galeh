import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Pool } from 'pg';

const baseUrl = process.env.PGRST_URL || 'http://127.0.0.1:3000';
const secret = process.env.PGRST_JWT_SECRET;
assert.ok(secret && secret.length >= 32, 'disposable PostgREST JWT secret is required');
assert.equal(new URL(baseUrl).hostname, '127.0.0.1', 'PostgREST test must target loopback only');
const pool = new Pool({ host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432), user: process.env.PGUSER || 'postgres', password: process.env.PGPASSWORD || 'postgres', database: process.env.PGDATABASE || 'recovery_ci', max: 2 });
function jwt(role) {
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const input = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ role, iss: 'postgrest-local-contract-test', iat: now, exp: now + 300 });
  return input + '.' + createHmac('sha256', secret).update(input).digest('base64url');
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const serviceToken = jwt('service_role');
  const anonToken = jwt('anon');
  await pool.query("NOTIFY pgrst, 'reload schema'");
  const missingId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const missingWorker = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const contracts = [
    ['recovery_outbox_heartbeat', { p_outbox_id: missingId, p_worker_id: missingWorker, p_generation: 1, p_lease_seconds: 60 }],
    ['recovery_outbox_begin_send', { p_outbox_id: missingId, p_worker_id: missingWorker, p_generation: 1 }],
    ['recovery_outbox_finish', { p_outbox_id: missingId, p_worker_id: missingWorker, p_generation: 1, p_outcome: 'unknown', p_provider_message_id: null, p_safe_error_code: null }],
    ['recovery_outbox_fetch_payload', { p_outbox_id: missingId, p_worker_id: missingWorker, p_generation: 1 }],
    ['recovery_coach_review_encrypted', { p_request_id: missingId, p_actor_user_id: missingWorker, p_decision: 'reject', p_token_hash: null, p_token_expires_at: null, p_hmac_key_version: null, p_delivery_operation_id: null, p_delivery_payload: null }]
  ];
  for (const [rpc, args] of contracts) {
    let response;
    for (let attempt = 0; attempt < 20; attempt++) {
      response = await fetch(baseUrl + '/rpc/' + rpc, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + serviceToken }, body: JSON.stringify(args) });
      if (response.status !== 404 && response.status !== 503) break;
      await wait(400);
    }
    const body = await response.text();
    assert.equal(response.status, 200, rpc + ' must resolve after PostgREST schema-cache reload; got ' + response.status + ': ' + body);
    const denied = await fetch(baseUrl + '/rpc/' + rpc, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + anonToken }, body: JSON.stringify(args) });
    const deniedBody = await denied.text();
    assert.ok([401, 403].includes(denied.status), rpc + ' must deny anon; got ' + denied.status + ': ' + deniedBody);
  }
  console.log('PASS: PostgREST resolves Outbox and encrypted-review RPCs; service_role succeeds and anon is denied. No claim/send/reconcile operation was invoked.');
} finally { await pool.end(); }
