'use strict';

// Focused in-memory regression tests for ownership, replay, brute-force limits and idempotent approval.
// These tests do NOT exercise HTTP, JWT verification, Supabase RLS, or a real SMS provider.
const assert = require('node:assert/strict');
const { STATES, MockRecovery } = require('./mock-recovery-engine');
const secret = 'focused-abuse-test-secret-at-least-32-chars';
let now = 9000000;
const make = (extra = {}) => new MockRecovery({
  secret, now: () => now, cooldownMs: 0, maxAttempts: 3,
  codeTTLms: 60_000, ...extra
});

// Wrong-owner and unknown IDs produce the same generic denial for coach and trainee reads.
{
  const s = make();
  s.request({ traineeId: 'trainee-A', coachId: 'coach-A', requestId: 'read-A' });
  const coachErrors = [
    () => s.getForCoach({ requestId: 'read-A', authenticatedCoachId: 'coach-B' }),
    () => s.getForCoach({ requestId: 'missing', authenticatedCoachId: 'coach-A' })
  ].map(fn => { try { fn(); return 'NO_ERROR'; } catch (e) { return e.message; } });
  assert.deepEqual(coachErrors, ['Recovery request unavailable', 'Recovery request unavailable']);
  const traineeErrors = [
    () => s.getForTrainee({ requestId: 'read-A', authenticatedTraineeId: 'trainee-B' }),
    () => s.getForTrainee({ requestId: 'missing', authenticatedTraineeId: 'trainee-A' })
  ].map(fn => { try { fn(); return 'NO_ERROR'; } catch (e) { return e.message; } });
  assert.deepEqual(traineeErrors, ['Recovery request unavailable', 'Recovery request unavailable']);
}

// A wrong coach cannot approve/reject, and unauthorized attempts leave the request untouched.
{
  const s = make();
  s.request({ traineeId: 'trainee-B', coachId: 'coach-B', requestId: 'authz-B' });
  assert.throws(() => s.approveForAuthenticatedCoach({
    requestId: 'authz-B', authenticatedCoachId: 'intruder'
  }), e => e.message === 'Recovery request unavailable');
  assert.throws(() => s.rejectForAuthenticatedCoach({
    requestId: 'authz-B', authenticatedCoachId: 'intruder'
  }), e => e.message === 'Recovery request unavailable');
  assert.equal(s.requests.get('authz-B').state, STATES.REQUESTED);
  assert.equal(s.mockMessages.length, 0);
}

// Duplicate approval is idempotent and delivers only one mock code.
{
  let deliveries = 0;
  const s = make({ delivery: () => { deliveries++; return { ok: true }; } });
  s.request({ traineeId: 'trainee-C', coachId: 'coach-C', requestId: 'approve-C' });
  const first = s.approve({ requestId: 'approve-C', authenticatedCoachId: 'coach-C' });
  const second = s.approve({ requestId: 'approve-C', authenticatedCoachId: 'coach-C' });
  assert.equal(first.state, STATES.CODE_ISSUED);
  assert.equal(second.idempotent, true);
  assert.equal(deliveries, 1);
  assert.equal(s.mockMessages.length, 1);
}

// Repeated incorrect codes consume the bounded attempt budget and invalidate the code.
{
  const s = make();
  s.request({ traineeId: 'trainee-D', coachId: 'coach-D', requestId: 'wrong-D' });
  s.approve({ requestId: 'wrong-D', authenticatedCoachId: 'coach-D' });
  const row = s.requests.get('wrong-D');
  const actual = s.mockMessages[0].body.slice(-4);
  const wrong = actual === '0000' ? '0001' : '0000';
  for (let i = 0; i < 3; i++) {
    assert.throws(() => s.verify({ requestId: 'wrong-D', traineeId: 'trainee-D', code: wrong }), /Invalid code/);
  }
  assert.equal(row.attempts, 3);
  assert.equal(row.state, STATES.EXPIRED);
  assert.equal(row.codeDigest, null);
  assert.throws(() => s.verify({ requestId: 'wrong-D', traineeId: 'trainee-D', code: actual }), /Invalid state/);
}

// Expired code cannot be replayed even when the supplied digits are correct.
{
  const s = make({ codeTTLms: 1000 });
  s.request({ traineeId: 'trainee-E', coachId: 'coach-E', requestId: 'expiry-E' });
  s.approve({ requestId: 'expiry-E', authenticatedCoachId: 'coach-E' });
  const actual = s.mockMessages[0].body.slice(-4);
  now += 1001;
  assert.throws(() => s.verify({ requestId: 'expiry-E', traineeId: 'trainee-E', code: actual }), /Invalid state|expired/i);
  assert.equal(s.requests.get('expiry-E').state, STATES.EXPIRED);
  now += 1;
}

// Idempotency key reuse with different ownership data is rejected.
{
  const s = make();
  s.request({ traineeId: 'trainee-F', coachId: 'coach-F', requestId: 'same-key' });
  assert.throws(() => s.request({
    traineeId: 'attacker', coachId: 'attacker-coach', requestId: 'same-key'
  }), /Idempotency key conflict/);
  assert.equal(s.requests.get('same-key').traineeId, 'trainee-F');
}


 
// A former coach loses read access immediately after the trainee is reassigned.
{
  let currentCoach = 'coach-old';
  const s = make({ getCurrentCoachId: () => currentCoach });
  s.request({ traineeId: 'trainee-move', coachId: 'coach-old', requestId: 'read-after-move' });
  assert.equal(s.getForCoach({
    requestId: 'read-after-move', authenticatedCoachId: 'coach-old'
  }).state, STATES.REQUESTED);
  currentCoach = 'coach-new';
  assert.throws(() => s.getForCoach({
    requestId: 'read-after-move', authenticatedCoachId: 'coach-old'
  }), e => e.message === 'Recovery request unavailable');
  assert.throws(() => s.getForCoach({
    requestId: 'read-after-move', authenticatedCoachId: 'coach-new'
  }), e => e.message === 'Recovery request unavailable',
  'new coach cannot read a request still bound to the previous assignment; restart must create a fresh request');
}

console.log('PASS: generic owner denials, coach authorization, duplicate approval, brute-force cap, expiry replay, and idempotency conflict.');
