import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  calls.push({
    url: url.toString(),
    method: init.method || 'GET',
    headers: new Headers(init.headers),
    body: init.body ? JSON.parse(init.body) : null
  });
  return new Response(JSON.stringify({
    id: '11111111-1111-4111-8111-111111111111',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'auth-contract@example.test',
    user_metadata: {},
    app_metadata: {}
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

try {
  const serviceKey = 'test-only-service-role-key-never-valid';
  const client = createClient('https://auth-contract.invalid', serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });
  const userId = '11111111-1111-4111-8111-111111111111';
  const result = await client.auth.admin.updateUserById(userId, { password: 'Disposable-Only-Password-123!' });

  assert.equal(result.error, null);
  assert.equal(calls.length, 1, 'one Auth Admin request must be made');
  const call = calls[0];
  assert.equal(call.url, `https://auth-contract.invalid/auth/v1/admin/users/${userId}`);
  assert.equal(call.method, 'PUT');
  assert.equal(call.headers.get('apikey'), serviceKey);
  assert.equal(call.headers.get('authorization'), `Bearer ${serviceKey}`);
  assert.deepEqual(call.body, { password: 'Disposable-Only-Password-123!' });
  assert.ok(!call.url.includes('supabase.co'), 'test must not contact a real Supabase project');
  console.log('PASS: Supabase JS 2.119.0 Auth Admin password update uses the expected server-only endpoint and payload; network is fully intercepted.');
} finally {
  globalThis.fetch = originalFetch;
}
