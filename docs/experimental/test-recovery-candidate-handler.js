'use strict';
import assert from 'node:assert/strict';
import { createRecoveryCandidateHandler } from './recovery-candidate-handler.mjs';
import { digestRecoveryCode } from './recovery-candidate-core.mjs';

const ENV = {
  RECOVERY_HMAC_KEYS: JSON.stringify({
    k0: 'older-candidate-test-secret-longer-than-32-bytes',
    k1: 'candidate-test-secret-longer-than-32-bytes'
  }),
  RECOVERY_HMAC_KEY_VERSION: 'k1',
  RECOVERY_ALLOWED_ORIGINS: 'https://app.example.test'
};
const UUID = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
const OP = '6ba7b811-9dad-41d1-80b4-00c04fd430c8';
const AUTH_USER = '6ba7b812-9dad-41d1-80b4-00c04fd430c8';

function queryResult(data, error = null) {
  const q = {
    select() { return q; }, eq() { return q; }, in() { return q; },
    order() { return q; }, limit() { return q; },
    maybeSingle: async () => ({ data, error }),
    then(resolve, reject) { return Promise.resolve({ data, error }).then(resolve, reject); }
  };
  return q;
}
function fixture(overrides = {}) {
  const calls = [];
  const state = {
    rate: true, submit: true,
    reviewed: { ok: true, status: 'approved', delivery_operation_id: OP },
    beginDelivery: true, finishDelivery: true,
    matches: [{ id: UUID, phone_normalized: '+989123456789', hmac_key_version: 'k1' }],
    target: { phone_normalized: '+989123456789', trainees: {
      phone_normalized: '+989123456789', coach_user_id: AUTH_USER,
      approval_status: 'active', archived_at: null
    }},
    claim: { claimed: false },
    beginAuth: true, finishAuth: true,
    updateError: null,
    ...overrides
  };
  const admin = {
    rpc: async (name, args) => {
      calls.push({ type: 'rpc', name, args });
      if (name === 'consume_registration_rate_limit') return { data: state.rate, error: state.rateError || null };
      const map = {
        recovery_submit_request: state.submit,
        recovery_coach_review: state.reviewed,
        recovery_begin_delivery: state.beginDelivery,
        recovery_finish_delivery: state.finishDelivery,
        recovery_claim_reset: state.claim,
        recovery_record_wrong_attempt: { incremented: true },
        recovery_begin_auth_update: state.beginAuth,
        recovery_finish_auth_update: state.finishAuth
      };
      return { data: map[name], error: state.rpcError || null };
    },
    from: table => ({
      select: () => {
        if (table === 'profiles') return queryResult({ role: 'coach' });
        if (table === 'trainee_password_recovery_requests') {
          const filters = [];
          const q = {
            select() { return q; }, eq(column, value) { filters.push([column, value]); return q; }, in() { return q; },
            order() { return q; }, limit() { return q; },
            maybeSingle: async () => ({ data: state.target, error: null }),
            then(resolve, reject) { const rows = filters.some(([k,v]) => k === 'status' && v === 'approved') ? state.matches : (state.listRows || []); return Promise.resolve({ data: rows, error: null }).then(resolve, reject); }
          };
          // Reset lookup is a list query; coach recipient lookup uses maybeSingle.
          q.limit = n => { calls.push({ type: 'limit', n }); return q; };
          return q;
        }
        return queryResult(null);
      }
    }),
    auth: { admin: { updateUserById: async (id, payload) => {
      calls.push({ type: 'auth_update', id, payload });
      return { error: state.updateError };
    }}}
  };
  const deps = {
    env: ENV, admin,
    createUserClient: authorization => ({
      auth: { getUser: async () => ({ data: { user: { id: AUTH_USER } }, error: null }) }
    }),
    now: () => 1790000000000,
    randomBytes: size => Buffer.from([0, 7]),
    randomUUID: () => OP,
    ...overrides.deps
  };
  return { handler: createRecoveryCandidateHandler(deps), calls, state, deps };
}
function request(body, { origin = 'https://app.example.test', authorization = '' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (origin) headers.origin = origin;
  if (authorization) headers.authorization = authorization;
  return new Request('https://candidate.invalid/', {
    method: 'POST', headers, body: JSON.stringify(body)
  });
}
async function body(response) { return await response.json(); }

{
  const a = fixture({ submit: false });
  const b = fixture({ submit: true });
  const ra = await a.handler(request({ action: 'request', phone: '09123456789' }));
  const rb = await b.handler(request({ action: 'request', phone: '09123456789' }));
  assert.equal(ra.status, 202); assert.equal(rb.status, 202);
  assert.deepEqual(await body(ra), await body(rb));
  assert.equal(a.calls.findIndex(x => x.name === 'consume_registration_rate_limit') <
    a.calls.findIndex(x => x.name === 'recovery_submit_request'), true);
  assert.equal(b.calls.find(x => x.name === 'recovery_submit_request').args.p_phone_normalized, '+989123456789');
  console.log('PASS: public request response is identical regardless of internal account eligibility result.');
}
{
  const f = fixture();
  const r = await f.handler(request({ action: 'request', phone: '09123456789' }, { origin: 'https://evil.example.test' }));
  assert.equal(r.status, 403);
  assert.equal(f.calls.length, 0);
}
{
  const f = fixture();
  const r = await f.handler(request({ action: 'review', request_id: UUID, decision: 'approve' }, { authorization: 'Bearer test' }));
  assert.equal(r.status, 202);
  const result = await body(r);
  assert.equal(result.status, 'approved');
  assert.equal(result.delivery_status, 'queued');
  assert.match(result.message, /هنوز ارسال پیامک تأیید نشده است/);
  assert.equal(f.calls.some(x => x.name === 'recovery_coach_review'), true);
  assert.equal(f.calls.some(x => x.name === 'recovery_begin_delivery'), false);
  assert.equal(f.calls.some(x => x.name === 'recovery_finish_delivery'), false);
  assert.equal(result.code, undefined);
  console.log('PASS: coach approval only queues the delivery; HTTP handler never sends SMS or claims it was sent.');
}
{
  const f = fixture({ reviewed: { ok: true, status: 'approved', delivery_operation_id: 'not-a-uuid' } });
  const r = await f.handler(request({ action: 'review', request_id: UUID, decision: 'approve' }, { authorization: 'Bearer test' }));
  assert.equal(r.status, 503);
  assert.equal((await body(r)).success, false);
  console.log('PASS: malformed delivery operation identifier fails closed after approval without attempting SMS.');
}
{
  const f = fixture({
    matches: [{ id: UUID, phone_normalized: '+989123456789', hmac_key_version: 'k0' }],
    claim: { claimed: true, operation_id: OP, auth_user_id: AUTH_USER }
  });
  const r = await f.handler(request({ action: 'reset', phone: '09123456789', code: '0007', new_password: 'StrongPass!234' }));
  assert.equal(r.status, 200);
  const claim = f.calls.find(x => x.name === 'recovery_claim_reset');
  assert.equal(claim.args.p_code_digest, digestRecoveryCode('0007', 'older-candidate-test-secret-longer-than-32-bytes', 'k0'));
  console.log('PASS: reset uses the exact historical HMAC key version recorded on the request.');
}
{
  const f = fixture({
    matches: [{ id: UUID, phone_normalized: '+989123456789', hmac_key_version: 'retired-missing-key' }]
  });
  const r = await f.handler(request({ action: 'reset', phone: '09123456789', code: '0007', new_password: 'StrongPass!234' }));
  assert.equal(r.status, 400);
  assert.equal(f.calls.some(x => x.name === 'recovery_claim_reset'), false);
  assert.equal(f.calls.some(x => x.name === 'recovery_record_wrong_attempt'), false);
  assert.equal(f.calls.some(x => x.type === 'auth_update'), false);
  console.log('PASS: missing historical HMAC key fails closed without consuming attempts or calling Auth.');
}

console.log('All dependency-injected recovery handler candidate tests passed.');
