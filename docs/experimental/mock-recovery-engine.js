/**
 * Experimental password-recovery state machine.
 * In-memory only; not production auth, persistence, or SMS.
 * Node built-ins only.
 */
'use strict';
const crypto = require('node:crypto');

const STATES = Object.freeze({
  REQUESTED: 'REQUESTED', APPROVED: 'APPROVED', CODE_ISSUED: 'CODE_ISSUED',
  VERIFIED: 'VERIFIED', RESET_PENDING: 'RESET_PENDING', RESET_UNKNOWN: 'RESET_UNKNOWN', DELIVERY_PENDING: 'DELIVERY_PENDING', DELIVERY_UNKNOWN: 'DELIVERY_UNKNOWN', COMPLETED: 'COMPLETED', REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED', CANCELLED: 'CANCELLED', STALE_ASSIGNMENT: 'STALE_ASSIGNMENT'
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
  constructor({ secret, now = () => Date.now(), codeTTLms = 24 * 60 * 60_000, requestTTLms = 24 * 60 * 60_000, maxAttempts = 5, cooldownMs = 60_000, maxRequestsPerWindow = 3, requestWindowMs = 24 * 60 * 60_000, maxDeliveryAttempts = 3, delivery = () => ({ ok: true }), getCurrentCoachId = null } = {}) {
    this.secret = secret;
    this.now = now;
    this.codeTTLms = codeTTLms;
    this.requestTTLms = requestTTLms;
    this.maxAttempts = maxAttempts;
    this.cooldownMs = cooldownMs;
    this.maxRequestsPerWindow = maxRequestsPerWindow;
    this.requestWindowMs = requestWindowMs;
    this.requestHistory = new Map();
    this.delivery = delivery;
    this.getCurrentCoachId = getCurrentCoachId;
    this.maxDeliveryAttempts = maxDeliveryAttempts;
    this.requests = new Map();
    this.lastRequestAt = new Map();
    this.mockMessages = [];
  }
  // Test adapter: authenticatedTraineeId must come from trusted server context, never request JSON.
  requestForAuthenticatedTrainee({ authenticatedTraineeId, requestId }) {
    if (!authenticatedTraineeId || typeof this.getCurrentCoachId !== 'function') {
      throw new Error('Trusted identity resolver unavailable');
    }
    const currentCoachId = this.getCurrentCoachId(authenticatedTraineeId);
    if (!currentCoachId) throw new Error('Recovery unavailable');
    return this.request({ traineeId: authenticatedTraineeId, coachId: currentCoachId, requestId });
  }
  request({ traineeId, coachId, requestId }) {
    this.sweepExpired();
    if (!traineeId || !coachId || !requestId) throw new Error('Required identifiers missing');
    if (this.requests.has(requestId)) {
      const existing = this.requests.get(requestId);
      if (existing.traineeId !== traineeId || existing.coachId !== coachId) throw new Error('Idempotency key conflict');
      return { ...existing }; // do not expose mutable internal state
    }
    // Prevent parallel active recovery flows for the same trainee.
    for (const active of this.requests.values()) {
      if (active.traineeId !== traineeId) continue;
      if (active.state === STATES.CODE_ISSUED && this.now() >= active.expiresAt) {
        active.state = STATES.EXPIRED; active.codeDigest = null;
      }
      if ([STATES.REQUESTED, STATES.APPROVED, STATES.DELIVERY_PENDING, STATES.DELIVERY_UNKNOWN, STATES.CODE_ISSUED, STATES.VERIFIED, STATES.RESET_PENDING, STATES.RESET_UNKNOWN].includes(active.state)) {
        throw new Error('Active recovery request exists');
      }
    }
    const last = this.lastRequestAt.get(traineeId);
    if (last !== undefined && this.now() - last < this.cooldownMs) throw new Error('Cooldown active');
    const history = (this.requestHistory.get(traineeId) || []).filter(ts => this.now() - ts < this.requestWindowMs);
    if (history.length >= this.maxRequestsPerWindow) throw new Error('Request rate limit reached');
    const r = { requestId, traineeId, coachId, state: STATES.REQUESTED, createdAt: this.now(), attempts: 0 };
    this.requests.set(requestId, r);
    this.lastRequestAt.set(traineeId, this.now());
    history.push(this.now());
    this.requestHistory.set(traineeId, history);
    return { ...r };
  }
  approve({ requestId, authenticatedCoachId }) {
    this.sweepExpired();
    const r = this.#get(requestId);
    if (r.coachId !== authenticatedCoachId) throw new Error('Coach ownership check failed');
    if (this.getCurrentCoachId && this.getCurrentCoachId(r.traineeId) !== r.coachId) {
      r.state = STATES.STALE_ASSIGNMENT;
      r.staleAssignmentAt = this.now();
      throw new Error('Coach assignment changed; request must be restarted');
    }
    // Double-click/retry is idempotent: do not generate or deliver a second code.
    if (r.state === STATES.CODE_ISSUED) return { requestId, state: r.state, expiresAt: r.expiresAt, delivery: 'MOCK_ONLY', idempotent: true };
    if (![STATES.REQUESTED, STATES.APPROVED].includes(r.state)) throw new Error('Invalid state');
    if ((r.deliveryAttempts || 0) >= this.maxDeliveryAttempts) throw new Error('Delivery attempt limit reached');
    if (r.state === STATES.REQUESTED) { r.state = STATES.APPROVED; r.approvedAt = this.now(); }
    r.deliveryAttempts = (r.deliveryAttempts || 0) + 1;
    r.state = STATES.DELIVERY_PENDING; // blocks re-entrant approval during delivery callback
    const code = generateCode();
    let outcome;
    try { outcome = this.delivery({ requestId, traineeId: r.traineeId, code }); }
    catch (deliveryError) {
      // Never leave the fixture stuck in DELIVERY_PENDING after a thrown callback.
      r.state = STATES.DELIVERY_UNKNOWN;
      r.deliveryStatus = 'UNKNOWN';
      r.deliveryUnknownAt = this.now();
      r.codeDigest = null;
      r.expiresAt = null;
      return { requestId, state: r.state, delivery: 'UNKNOWN', retryable: false, error: 'Delivery outcome is ambiguous; reconcile provider status before retry' };
    }
    if (!outcome || outcome.ok !== true) {
      r.state = STATES.APPROVED;
      r.deliveryStatus = 'FAILED';
      r.deliveryFailedAt = this.now();
      r.codeDigest = null;
      r.expiresAt = null;
      return { requestId, state: r.state, delivery: 'FAILED', retryable: true };
    }
    r.codeDigest = digestCode(code, this.secret);
    r.expiresAt = this.now() + this.codeTTLms;
    r.deliveryStatus = 'MOCK_SENT';
    r.state = STATES.CODE_ISSUED;
    this.mockMessages.push({ type: 'MOCK_SMS', requestId, traineeId: r.traineeId, body: 'Your test recovery code is: ' + code });
    return { requestId, state: r.state, expiresAt: r.expiresAt, delivery: 'MOCK_ONLY' };
  }
  verify({ requestId, traineeId, code }) {
    this.sweepExpired();
    const r = this.#get(requestId);
    if (r.traineeId !== traineeId) throw new Error('Trainee ownership check failed');
    if (r.state !== STATES.CODE_ISSUED) throw new Error('Invalid state');
    if (this.now() >= r.expiresAt) { r.state = STATES.EXPIRED; r.codeDigest = null; r.expiresAt = null; r.expiredAt = this.now(); throw new Error('Code expired'); }
    if (r.attempts >= this.maxAttempts) throw new Error('Attempt limit reached');
    if (typeof code !== 'string' || !/^\d{4}$/.test(code)) { r.attempts++; if (r.attempts >= this.maxAttempts) { r.state = STATES.EXPIRED; r.codeDigest = null; r.expiresAt = null; r.expiredAt = this.now(); } throw new Error('Invalid code'); }
    r.attempts++;
    const candidate = digestCode(code, this.secret);
    if (!safeEqualHex(candidate, r.codeDigest)) {
      if (r.attempts >= this.maxAttempts) { r.state = STATES.EXPIRED; r.codeDigest = null; r.expiresAt = null; r.expiredAt = this.now(); }
      throw new Error('Invalid code');
    }
    r.codeDigest = null; r.state = STATES.VERIFIED; r.verifiedAt = this.now(); r.grantExpiresAt = this.now() + Math.min(this.codeTTLms, 10 * 60_000);
    return { requestId, state: r.state };
  }
  // The provider callback is a mock-only seam. It must never receive or log a plaintext password.
  // {ok:true} means confirmed success; {ok:false} means confirmed no-change; throw means ambiguous.
  applyPasswordReset({ requestId, traineeId, operationId, updateAuth }) {
    this.sweepExpired();
    const r = this.#get(requestId);
    if (r.traineeId !== traineeId) throw new Error('Trainee ownership check failed');
    if (typeof operationId !== 'string' || !operationId || typeof updateAuth !== 'function') {
      throw new Error('Operation identifier and mock Auth adapter required');
    }
    r.authOperations ||= new Map();
    const prior = r.authOperations.get(operationId);
    if (prior) return { requestId, operationId, state: r.state, authOutcome: prior.outcome, idempotent: true };
    if (r.state !== STATES.VERIFIED) throw new Error('Not verified');
    if (!r.grantExpiresAt || this.now() >= r.grantExpiresAt) {
      r.state = STATES.EXPIRED; r.expiredAt = this.now(); r.grantExpiresAt = null;
      throw new Error('Reset grant expired');
    }
    r.state = STATES.RESET_PENDING;
    r.resetOperationId = operationId;
    r.resetStartedAt = this.now();
    try {
      const outcome = updateAuth({ requestId, traineeId, operationId });
      if (!outcome || outcome.ok !== true) {
        r.state = STATES.VERIFIED;
        r.resetLastFailureAt = this.now();
        r.resetOperationId = null;
        r.authOperations.set(operationId, { outcome: 'REJECTED', at: this.now() });
        return { requestId, operationId, state: r.state, authOutcome: 'REJECTED', retryableWithNewOperationId: true };
      }
      this.#markPasswordResetSucceeded(r);
      r.authOperations.set(operationId, { outcome: 'SUCCEEDED', at: this.now() });
      return { requestId, operationId, state: r.state, authOutcome: 'SUCCEEDED' };
    } catch (error) {
      // A thrown transport error may occur after Auth committed the password change.
      r.state = STATES.RESET_UNKNOWN;
      r.resetUnknownAt = this.now();
      r.authOperations.set(operationId, { outcome: 'UNKNOWN', at: this.now() });
      return { requestId, operationId, state: r.state, authOutcome: 'UNKNOWN', retryable: false,
        message: 'Password update outcome is unknown; reconcile Auth status before retrying' };
    }
  }
  reconcilePasswordReset({ requestId, traineeId, operationId, lookupAuth }) {
    this.sweepExpired();
    const r = this.#get(requestId);
    if (r.traineeId !== traineeId) throw new Error('Trainee ownership check failed');
    if (r.state !== STATES.RESET_UNKNOWN || r.resetOperationId !== operationId ||
        typeof lookupAuth !== 'function') throw new Error('No matching ambiguous Auth operation');
    let status;
    try { status = lookupAuth({ requestId, traineeId, operationId }); }
    catch (error) { return { requestId, operationId, state: r.state, authOutcome: 'UNKNOWN', retryable: false }; }
    if (status === 'SUCCEEDED') {
      this.#markPasswordResetSucceeded(r);
      r.authOperations.set(operationId, { outcome: 'SUCCEEDED', at: this.now() });
      return { requestId, operationId, state: r.state, authOutcome: 'SUCCEEDED' };
    }
    if (status === 'NOT_APPLIED') {
      r.resetOperationId = null;
      r.resetReconciledAt = this.now();
      r.authOperations.set(operationId, { outcome: 'NOT_APPLIED', at: this.now() });
      if (!r.grantExpiresAt || this.now() >= r.grantExpiresAt) {
        r.state = STATES.EXPIRED;
        r.expiredAt = this.now();
        r.grantExpiresAt = null;
        return { requestId, operationId, state: r.state, authOutcome: 'NOT_APPLIED', retryableWithNewOperationId: false };
      }
      r.state = STATES.VERIFIED;
      return { requestId, operationId, state: r.state, authOutcome: 'NOT_APPLIED', retryableWithNewOperationId: true };
    }
    return { requestId, operationId, state: r.state, authOutcome: 'UNKNOWN', retryable: false };
  }
  #markPasswordResetSucceeded(r) {
    r.state = STATES.COMPLETED;
    r.completedAt = this.now();
    r.grantExpiresAt = null;
    r.codeDigest = null;
    r.expiresAt = null;
    r.sessionsRevocationStatus = 'NOT_MODELED';
  }
  // Legacy shortcut deliberately disabled: completion requires a confirmed Auth outcome.
  complete() {
    throw new Error('Direct completion is disabled; use applyPasswordReset with a confirmed Auth result');
  }
  cancel({ requestId, traineeId }) {
    this.sweepExpired();
    const r = this.#get(requestId);
    if (r.traineeId !== traineeId) throw new Error('Trainee ownership check failed');
    if (r.state !== STATES.REQUESTED) throw new Error('Invalid state');
    r.state = STATES.CANCELLED; r.cancelledAt = this.now();
    return { requestId, state: r.state };
  }
  reject({ requestId, authenticatedCoachId }) {
    this.sweepExpired();
    const r = this.#get(requestId);
    if (r.coachId !== authenticatedCoachId) throw new Error('Coach ownership check failed');
    if (this.getCurrentCoachId && this.getCurrentCoachId(r.traineeId) !== r.coachId) {
      r.state = STATES.STALE_ASSIGNMENT;
      r.staleAssignmentAt = this.now();
      throw new Error('Coach assignment changed; request must be restarted');
    }
    if (r.state !== STATES.REQUESTED) throw new Error('Invalid state');
    r.state = STATES.REJECTED; r.rejectedAt = this.now();
    return { requestId, state: r.state };
  }
  sweepExpired() {
    const now = this.now();
    let expiredCount = 0;
    for (const r of this.requests.values()) {
      if ([STATES.REQUESTED, STATES.APPROVED, STATES.DELIVERY_PENDING, STATES.DELIVERY_UNKNOWN].includes(r.state) && now - r.createdAt >= this.requestTTLms) {
        r.state = STATES.EXPIRED;
        r.expiredAt = now;
        r.codeDigest = null;
        r.expiresAt = null;
        expiredCount++;
      } else if (r.state === STATES.VERIFIED && (!r.grantExpiresAt || now >= r.grantExpiresAt)) {
        r.state = STATES.EXPIRED;
        r.expiredAt = now;
        r.grantExpiresAt = null;
        expiredCount++;
      } else if (r.state === STATES.CODE_ISSUED && now >= r.expiresAt) {
        r.state = STATES.EXPIRED;
        r.expiredAt = now;
        r.codeDigest = null;
        r.expiresAt = null;
        expiredCount++;
      }
    }
    return expiredCount;
  }
  // Authenticated-context adapters: identity arguments must be supplied by trusted middleware.
  verifyForAuthenticatedTrainee({ requestId, authenticatedTraineeId, code }) {
    if (!authenticatedTraineeId) throw new Error('Recovery request unavailable');
    try { return this.verify({ requestId, traineeId: authenticatedTraineeId, code }); }
    catch (error) {
      if (/Request not found|ownership check failed/.test(error.message)) throw new Error('Recovery request unavailable');
      throw error;
    }
  }
  completeForAuthenticatedTrainee({ requestId, authenticatedTraineeId }) {
    if (!authenticatedTraineeId) throw new Error('Recovery request unavailable');
    try { return this.complete({ requestId, traineeId: authenticatedTraineeId }); }
    catch (error) {
      if (/Request not found|ownership check failed/.test(error.message)) throw new Error('Recovery request unavailable');
      throw error;
    }
  }
  cancelForAuthenticatedTrainee({ requestId, authenticatedTraineeId }) {
    if (!authenticatedTraineeId) throw new Error('Recovery request unavailable');
    try { return this.cancel({ requestId, traineeId: authenticatedTraineeId }); }
    catch (error) {
      if (/Request not found|ownership check failed/.test(error.message)) throw new Error('Recovery request unavailable');
      throw error;
    }
  }
  approveForAuthenticatedCoach({ requestId, authenticatedCoachId }) {
    if (!authenticatedCoachId) throw new Error('Recovery request unavailable');
    try { return this.approve({ requestId, authenticatedCoachId }); }
    catch (error) {
      if (/Request not found|ownership check failed/.test(error.message)) throw new Error('Recovery request unavailable');
      throw error;
    }
  }
  rejectForAuthenticatedCoach({ requestId, authenticatedCoachId }) {
    if (!authenticatedCoachId) throw new Error('Recovery request unavailable');
    try { return this.reject({ requestId, authenticatedCoachId }); }
    catch (error) {
      if (/Request not found|ownership check failed/.test(error.message)) throw new Error('Recovery request unavailable');
      throw error;
    }
  }
  // Scoped lookup helpers model non-enumerating owner reads for tests.
  // Production handlers must still resolve actor identity from authenticated server context.
  getForCoach({ requestId, authenticatedCoachId }) {
    const r = this.requests.get(requestId);
    if (!r || !authenticatedCoachId || r.coachId !== authenticatedCoachId) {
      throw new Error('Recovery request unavailable');
    }
    return { requestId: r.requestId, state: r.state, createdAt: r.createdAt,
      approvedAt: r.approvedAt || null, rejectedAt: r.rejectedAt || null,
      expiresAt: r.expiresAt || null };
  }
  getForTrainee({ requestId, authenticatedTraineeId }) {
    const r = this.requests.get(requestId);
    if (!r || !authenticatedTraineeId || r.traineeId !== authenticatedTraineeId) {
      throw new Error('Recovery request unavailable');
    }
    return { requestId: r.requestId, state: r.state, createdAt: r.createdAt,
      expiresAt: r.expiresAt || null, completedAt: r.completedAt || null,
      resetStartedAt: r.resetStartedAt || null, resetUnknownAt: r.resetUnknownAt || null,
      resetReconciledAt: r.resetReconciledAt || null };
  }
  #get(id) { const r = this.requests.get(id); if (!r) throw new Error('Request not found'); return r; }
}
module.exports = { STATES, generateCode, digestCode, safeEqualHex, MockRecovery };
