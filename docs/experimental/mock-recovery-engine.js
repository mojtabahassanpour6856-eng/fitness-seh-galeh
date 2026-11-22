/**
 * Experimental password-recovery state machine.
 * In-memory only; not production auth, persistence, or SMS.
 * Node built-ins only.
 */
'use strict';
const crypto = require('node:crypto');

const STATES = Object.freeze({
  REQUESTED: 'REQUESTED', APPROVED: 'APPROVED', CODE_ISSUED: 'CODE_ISSUED',
  VERIFIED: 'VERIFIED', COMPLETED: 'COMPLETED', REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED', CANCELLED: 'CANCELLED'
});

function generateCode(randomBytes = crypto.randomBytes) {
  // Rejection sampling avoids modulo bias. Keep it as a string to preserve leading zeroes.
  const range = 65536, limit = Math.floor(range / 10000) * 10000;
  while (true) {
    const b = randomBytes(2);
    const n = (b[0] << 8) | b[1];
    if (n < limit) return String(n % 10000).padStart(4, '0');
  }
}

function digestCode(code, secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('Mock secret must be at least 32 characters');
  return crypto.createHmac('sha256', secret).update(String(code)).digest('hex');
}
function safeEqualHex(a, b) {
  if (!/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

class MockRecovery {
  constructor({ secret, now = () => Date.now(), codeTTLms = 24 * 60 * 60_000, maxAttempts = 5, cooldownMs = 60_000 } = {}) {
    this.secret = secret;
    this.now = now;
    this.codeTTLms = codeTTLms;
    this.maxAttempts = maxAttempts;
    this.cooldownMs = cooldownMs;
    this.requests = new Map();
    this.lastRequestAt = new Map();
    this.mockMessages = [];
  }
  request({ traineeId, coachId, requestId }) {
    if (!traineeId || !coachId || !requestId) throw new Error('Required identifiers missing');
    if (this.requests.has(requestId)) {
      const existing = this.requests.get(requestId);
      if (existing.traineeId !== traineeId || existing.coachId !== coachId) throw new Error('Idempotency key conflict');
      return existing; // safe retry by the same identities only
    }
    // Prevent parallel active recovery flows for the same trainee.
    for (const active of this.requests.values()) {
      if (active.traineeId !== traineeId) continue;
      if (active.state === STATES.CODE_ISSUED && this.now() >= active.expiresAt) {
        active.state = STATES.EXPIRED; active.codeDigest = null;
      }
      if ([STATES.REQUESTED, STATES.CODE_ISSUED, STATES.VERIFIED].includes(active.state)) {
        throw new Error('Active recovery request exists');
      }
    }
    const last = this.lastRequestAt.get(traineeId) || 0;
    if (this.now() - last < this.cooldownMs) throw new Error('Cooldown active');
    const r = { requestId, traineeId, coachId, state: STATES.REQUESTED, createdAt: this.now(), attempts: 0 };
    this.requests.set(requestId, r);
    this.lastRequestAt.set(traineeId, this.now());
    return r;
  }
  approve({ requestId, authenticatedCoachId }) {
    const r = this.#get(requestId);
    if (r.coachId !== authenticatedCoachId) throw new Error('Coach ownership check failed');
    // Double-click/retry is idempotent: do not generate or deliver a second code.
    if (r.state === STATES.CODE_ISSUED) return { requestId, state: r.state, expiresAt: r.expiresAt, delivery: 'MOCK_ONLY', idempotent: true };
    if (r.state !== STATES.REQUESTED) throw new Error('Invalid state');
    r.state = STATES.APPROVED; r.approvedAt = this.now();
    const code = generateCode();
    r.codeDigest = digestCode(code, this.secret);
    r.expiresAt = this.now() + this.codeTTLms;
    r.state = STATES.CODE_ISSUED;
    this.mockMessages.push({ type: 'MOCK_SMS', requestId, traineeId: r.traineeId, body: 'Your test recovery code is: ' + code });
    return { requestId, state: r.state, expiresAt: r.expiresAt, delivery: 'MOCK_ONLY' };
  }
  verify({ requestId, traineeId, code }) {
    const r = this.#get(requestId);
    if (r.traineeId !== traineeId) throw new Error('Trainee ownership check failed');
    if (r.state !== STATES.CODE_ISSUED) throw new Error('Invalid state');
    if (this.now() >= r.expiresAt) { r.state = STATES.EXPIRED; r.codeDigest = null; throw new Error('Code expired'); }
    if (r.attempts >= this.maxAttempts) throw new Error('Attempt limit reached');
    if (typeof code !== 'string' || !/^\d{4}$/.test(code)) { r.attempts++; if (r.attempts >= this.maxAttempts) r.state = STATES.EXPIRED; throw new Error('Invalid code'); }
    r.attempts++;
    const candidate = digestCode(code, this.secret);
    if (!safeEqualHex(candidate, r.codeDigest)) {
      if (r.attempts >= this.maxAttempts) r.state = STATES.EXPIRED;
      throw new Error('Invalid code');
    }
    r.codeDigest = null; r.state = STATES.VERIFIED; r.verifiedAt = this.now();
    return { requestId, state: r.state };
  }
  complete({ requestId, traineeId }) {
    const r = this.#get(requestId);
    if (r.traineeId !== traineeId) throw new Error('Trainee ownership check failed');
    if (r.state !== STATES.VERIFIED) throw new Error('Not verified');
    r.state = STATES.COMPLETED; r.completedAt = this.now();
    return { requestId, state: r.state };
  }
  reject({ requestId, authenticatedCoachId }) {
    const r = this.#get(requestId);
    if (r.coachId !== authenticatedCoachId) throw new Error('Coach ownership check failed');
    if (r.state !== STATES.REQUESTED) throw new Error('Invalid state');
    r.state = STATES.REJECTED; r.rejectedAt = this.now();
    return { requestId, state: r.state };
  }
  #get(id) { const r = this.requests.get(id); if (!r) throw new Error('Request not found'); return r; }
}
module.exports = { STATES, generateCode, digestCode, safeEqualHex, MockRecovery };
