import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Pool } from 'pg';

const baseUrl = process.env.PGRST_URL || 'http://127.0.0.1:3000';
const secret = process.env.PGRST_JWT_SECRET;
assert.ok(secret && secret.length >= 32, 'disposable PostgREST JWT secret is required');
assert.equal(new URL(baseUrl).hostname, '127.0.0.1', 'PostgREST test must target loopback only');

const pool = new Pool({
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'recovery_ci',
  max: 2
});

function jwt(role) {
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const payload = b64({ role, iss: 'postgrest-local-contract-test', iat: now, exp: now + 300 });
  const input = header + '.' + payload;
  const signature = createHmac('sha256', secret).update(input).digest('base64url');
  return input + '.' + signature;
}

async function waitForPostgrest() {
  let lastError;
  for (let i = 0; i < 40; i++) {
    try {
      const response = await fetch(baseUrl + '/', { headers: { Authorization: 'Bearer ' + jwt('anon') } });
      if (response.status < 500) return;
      lastError = new Error('PostgREST returned ' + response.status);
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 750));
  }
  throw lastError || new Error('PostgREST did not become ready');
}

try {
  await waitForPostgrest();
  // Migrations ran immediately before this test. Force a schema-cache refresh,
  // then wait for the named RPC to become visible through the actual REST layer.
  await pool.query("NOTIFY pgrst, 'reload schema'");
  const serviceToken = jwt('service_role');
  const anonToken = jwt('anon');
  const keyHash = 'c'.repeat(64);
  let serviceResponse;
  for (let i = 0; i < 20; i++) {
    serviceResponse = await fetch(baseUrl + '/rpc/recovery_consume_request_rate_limit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + serviceToken
      },
      body: JSON.stringify({
        p_key_hash: keyHash,
        p_window_seconds: 3600,
        p_max_requests: 1
      })
    });
    if (serviceResponse.status !== 404 && serviceResponse.status !== 503) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const serviceBody = await serviceResponse.text();
  assert.equal(serviceResponse.status, 200,
    'service_role must resolve the public RPC by named PostgREST parameters; got ' +
    serviceResponse.status + ': ' + serviceBody);
  assert.equal(serviceBody, 'true', 'the first request should be admitted');

  const anonResponse = await fetch(baseUrl + '/rpc/recovery_consume_request_rate_limit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + anonToken
    },
    body: JSON.stringify({
      p_key_hash: 'd'.repeat(64),
      p_window_seconds: 3600,
      p_max_requests: 1
    })
  });
  const anonBody = await anonResponse.text();
  assert.ok([401, 403].includes(anonResponse.status),
    'anon must not execute the service-only recovery RPC; got ' + anonResponse.status + ': ' + anonBody);

  const secondServiceResponse = await fetch(baseUrl + '/rpc/recovery_consume_request_rate_limit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + serviceToken },
    body: JSON.stringify({
      p_key_hash: keyHash,
      p_window_seconds: 3600,
      p_max_requests: 1
    })
  });
  assert.equal(secondServiceResponse.status, 200);
  assert.equal(await secondServiceResponse.text(), 'false',
    'the PostgREST invocation must preserve the SQL rate-limit result');

  // Exercise every remaining public recovery RPC over HTTP using non-existent synthetic IDs.
  // These calls must resolve their exact PostgREST parameter names but cannot mutate a real request.
  const missingId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const missingOperation = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const recoveryRpcContracts = [
    ['recovery_coach_review', { p_request_id: missingId, p_actor_user_id: missingId, p_decision: 'approve', p_token_hash: 'a'.repeat(64), p_token_expires_at: new Date(Date.now() + 60000).toISOString(), p_hmac_key_version: 'ci' }],
    ['recovery_record_wrong_attempt', { p_request_id: missingId, p_submitted_digest: 'b'.repeat(64) }],
    ['recovery_begin_delivery', { p_request_id: missingId, p_delivery_operation_id: missingOperation }],
    ['recovery_finish_delivery', { p_request_id: missingId, p_delivery_operation_id: missingOperation, p_outcome: 'unknown' }],
    ['recovery_claim_reset', { p_request_id: missingId, p_code_digest: 'c'.repeat(64), p_operation_id: missingOperation }],
    ['recovery_begin_auth_update', { p_request_id: missingId, p_operation_id: missingOperation }],
    ['recovery_finish_auth_update', { p_request_id: missingId, p_operation_id: missingOperation, p_outcome: 'unknown', p_safe_error_code: null }]
  ];
  for (const [rpc, args] of recoveryRpcContracts) {
    const response = await fetch(baseUrl + '/rpc/' + rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + serviceToken },
      body: JSON.stringify(args)
    });
    const body = await response.text();
    assert.equal(response.status, 200, rpc + ' must resolve through PostgREST with its named arguments; got ' + response.status + ': ' + body);
    const denied = await fetch(baseUrl + '/rpc/' + rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + anonToken },
      body: JSON.stringify(args)
    });
    const deniedBody = await denied.text();
    assert.ok([401, 403].includes(denied.status), rpc + ' must deny anon; got ' + denied.status + ': ' + deniedBody);
  }
  console.log('PASS: PostgREST resolves all eight public recovery RPCs by named arguments; service_role can execute; anon is denied; rate-limit result is preserved.');
} finally {
  await pool.end();
}
