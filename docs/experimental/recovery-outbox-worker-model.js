'use strict';

// Deterministic in-memory Outbox lease model. Test-only: no DB, Auth, or SMS.
class MockOutbox {
  constructor({ now = () => Date.now(), leaseMs = 1000 } = {}) {
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error('leaseMs must be positive');
    this.now = now;
    this.leaseMs = leaseMs;
    this.rows = new Map();
  }

  enqueue(id) {
    if (!id || this.rows.has(id)) throw new Error('Outbox ID must be unique');
    const row = {
      id, status: 'pending', attemptCount: 0, leaseGeneration: 0,
      lockOwner: null, lockedUntil: null, sendStartedAt: null,
      providerIdempotencyKey: 'recovery-outbox:' + id,
      providerMessageId: null, lastOutcome: null
    };
    this.rows.set(id, row);
    return this.snapshot(id);
  }

  snapshot(id) {
    const row = this.#row(id);
    return { ...row };
  }

  claim(id, workerId) {
    if (!workerId) throw new Error('workerId required');
    const row = this.#row(id);
    const now = this.now();
    if (['sent', 'failed', 'unknown'].includes(row.status)) return null;

    if (row.status === 'processing' && row.lockedUntil > now) return null;
    if (row.status === 'processing' && row.sendStartedAt !== null) {
      // Once external delivery may have started, expiry is ambiguity, not permission to resend.
      row.status = 'unknown';
      row.lastOutcome = 'lease_expired_after_send_started';
      row.lockOwner = null;
      row.lockedUntil = null;
      return null;
    }

    row.status = 'processing';
    row.leaseGeneration += 1;
    row.lockOwner = workerId;
    row.lockedUntil = now + this.leaseMs;
    row.sendStartedAt = null;
    return { id, workerId, generation: row.leaseGeneration,
      lockedUntil: row.lockedUntil, idempotencyKey: row.providerIdempotencyKey };
  }

  heartbeat(lease) {
    const row = this.#row(lease.id);
    if (!this.#owns(row, lease) || row.lockedUntil <= this.now()) return false;
    row.lockedUntil = this.now() + this.leaseMs;
    return true;
  }

  beginSend(lease) {
    const row = this.#row(lease.id);
    if (!this.#owns(row, lease) || row.lockedUntil <= this.now()) return false;
    if (row.sendStartedAt !== null) return false;
    row.sendStartedAt = this.now();
    row.attemptCount += 1;
    return true;
  }

  finish(lease, outcome, providerMessageId = null) {
    if (!['sent', 'failed', 'unknown'].includes(outcome)) throw new Error('Invalid outcome');
    const row = this.#row(lease.id);
    if (!this.#owns(row, lease)) return false;
    if (outcome === 'sent' && !row.sendStartedAt) return false;
    if (outcome === 'failed' && !row.sendStartedAt) return false;
    row.status = outcome;
    row.providerMessageId = outcome === 'sent' ? providerMessageId : null;
    row.lastOutcome = outcome;
    row.lockOwner = null;
    row.lockedUntil = null;
    return true;
  }

  retryAfterConfirmedFailure(id) {
    const row = this.#row(id);
    if (row.status !== 'failed') return false;
    row.status = 'pending';
    row.sendStartedAt = null;
    row.lockOwner = null;
    row.lockedUntil = null;
    return true;
  }

  #owns(row, lease) {
    return !!lease && row.status === 'processing' &&
      row.lockOwner === lease.workerId &&
      row.leaseGeneration === lease.generation;
  }

  #row(id) {
    const row = this.rows.get(id);
    if (!row) throw new Error('Unknown Outbox item');
    return row;
  }
}

class FakeSmsProvider {
  constructor(script = []) {
    this.script = [...script];
    this.calls = [];
    this.acceptedByKey = new Map();
  }
  async send({ idempotencyKey, payload }) {
    this.calls.push({ idempotencyKey, payload });
    if (this.acceptedByKey.has(idempotencyKey)) {
      return { accepted: true, messageId: this.acceptedByKey.get(idempotencyKey), deduplicated: true };
    }
    const next = this.script.length ? this.script.shift() : { type: 'accept' };
    if (next.type === 'timeout') throw new Error('simulated timeout');
    if (next.type === 'malformed') return { accepted: true, malformed: true };
    if (next.type === 'reject') return { accepted: false, definite: true };
    if (next.type === 'accept') {
      const messageId = next.messageId || 'mock-message-' + (this.acceptedByKey.size + 1);
      this.acceptedByKey.set(idempotencyKey, messageId);
      return { accepted: true, messageId };
    }
    throw new Error('Unknown fake provider script');
  }
}

module.exports = { MockOutbox, FakeSmsProvider };
