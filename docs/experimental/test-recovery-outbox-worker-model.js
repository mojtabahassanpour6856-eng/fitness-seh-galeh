'use strict';
const assert = require('node:assert/strict');
const { MockOutbox, FakeSmsProvider } = require('./recovery-outbox-worker-model');

async function main() {
  let now = 100;
  const make = () => new MockOutbox({ now: () => now, leaseMs: 50 });

  // Successful provider acceptance with an empty HTTP body is represented by an accepted result.
  {
    const q = make(), p = new FakeSmsProvider([{ type: 'accept', messageId: null }]);
    q.enqueue('empty-body'); const l = q.claim('empty-body', 'A');
    assert.equal(q.beginSend(l), true);
    const r = await p.send({ idempotencyKey: l.idempotencyKey, payload: 'synthetic' });
    assert.equal(r.accepted, true);
    assert.equal(q.finish(l, 'sent', r.messageId), true);
    assert.equal(q.snapshot('empty-body').status, 'sent');
  }

  // JSON-success equivalent.
  {
    const q = make(), p = new FakeSmsProvider([{ type: 'accept', messageId: 'json-ok-1' }]);
    q.enqueue('json-success'); const l = q.claim('json-success', 'A');
    q.beginSend(l); const r = await p.send({ idempotencyKey: l.idempotencyKey, payload: 'synthetic' });
    assert.equal(q.finish(l, 'sent', r.messageId), true);
    assert.equal(q.snapshot('json-success').providerMessageId, 'json-ok-1');
  }

  // Definite rejection is failed and only then explicitly retryable.
  {
    const q = make(), p = new FakeSmsProvider([{ type: 'reject' }]);
    q.enqueue('reject'); const l = q.claim('reject', 'A'); q.beginSend(l);
    const r = await p.send({ idempotencyKey: l.idempotencyKey, payload: 'synthetic' });
    assert.equal(r.definite, true); assert.equal(q.finish(l, 'failed'), true);
    assert.equal(q.retryAfterConfirmedFailure('reject'), true);
  }

  // Malformed response and timeout are ambiguous; no blind retry.
  for (const [id, script] of [['malformed', [{ type: 'malformed' }]], ['timeout', [{ type: 'timeout' }]]]) {
    const q = make(), p = new FakeSmsProvider(script);
    q.enqueue(id); const l = q.claim(id, 'A'); q.beginSend(l);
    try {
      const r = await p.send({ idempotencyKey: l.idempotencyKey, payload: 'synthetic' });
      if (r.malformed) q.finish(l, 'unknown');
    } catch { q.finish(l, 'unknown'); }
    assert.equal(q.snapshot(id).status, 'unknown');
    assert.equal(q.claim(id, 'B'), null);
    assert.equal(p.calls.length, 1);
  }

  // Stop before send-start: expired lease can be reclaimed with a higher fencing generation.
  {
    const q = make(); q.enqueue('before-send');
    const a = q.claim('before-send', 'A'); now += 51;
    const b = q.claim('before-send', 'B');
    assert.equal(b.generation, a.generation + 1);
    assert.equal(q.beginSend(a), false);
    assert.equal(q.beginSend(b), true);
    assert.equal(q.finish(a, 'sent', 'stale'), false);
  }

  // Stop after provider acceptance: no automatic second send, even after lease expiry.
  {
    const q = make(), p = new FakeSmsProvider();
    q.enqueue('after-accept'); const a = q.claim('after-accept', 'A'); q.beginSend(a);
    const accepted = await p.send({ idempotencyKey: a.idempotencyKey, payload: 'synthetic' });
    now += 51;
    assert.equal(q.claim('after-accept', 'B'), null);
    assert.equal(q.snapshot('after-accept').status, 'unknown');
    assert.equal(q.finish(a, 'sent', accepted.messageId), false);
    assert.equal(p.calls.length, 1);
  }

  // Simultaneous claims: synchronous atomic transition has exactly one winner.
  {
    const q = make(); q.enqueue('race');
    const results = [q.claim('race', 'A'), q.claim('race', 'B')].filter(Boolean);
    assert.equal(results.length, 1);
  }

  // A lease that expires while send is in progress becomes unknown, never re-sent.
  {
    const q = make(); q.enqueue('lease-during-send');
    const a = q.claim('lease-during-send', 'A'); q.beginSend(a); now += 51;
    assert.equal(q.claim('lease-during-send', 'B'), null);
    assert.equal(q.snapshot('lease-during-send').status, 'unknown');
  }

  // Old generation cannot heartbeat or finalize after a newer generation exists.
  {
    const q = make(); q.enqueue('fencing');
    const a = q.claim('fencing', 'A'); now += 51;
    const b = q.claim('fencing', 'B');
    assert.equal(q.heartbeat(a), false);
    assert.equal(q.finish(a, 'sent', 'old'), false);
    assert.equal(q.beginSend(b), true);
    assert.equal(q.finish(b, 'sent', 'new'), true);
    assert.equal(q.snapshot('fencing').providerMessageId, 'new');
  }

  // Stable provider idempotency key deduplicates across lease generations.
  {
    const q = make(), p = new FakeSmsProvider();
    q.enqueue('idempotent'); const a = q.claim('idempotent', 'A'); q.beginSend(a);
    const first = await p.send({ idempotencyKey: a.idempotencyKey, payload: 'synthetic' });
    now += 51;
    assert.equal(q.claim('idempotent', 'B'), null); // fail closed without provider reconciliation
    const again = await p.send({ idempotencyKey: a.idempotencyKey, payload: 'synthetic' });
    assert.equal(again.deduplicated, true);
    assert.equal(first.messageId, again.messageId);
    assert.equal(p.calls.length, 2);
  }

  // Attempt count increments only when the durable send-start transition succeeds.
  {
    const q = make(); q.enqueue('attempt-count');
    const a = q.claim('attempt-count', 'A');
    assert.equal(q.beginSend(a), true);
    assert.equal(q.snapshot('attempt-count').attemptCount, 1);
    assert.equal(q.beginSend(a), false);
    assert.equal(q.snapshot('attempt-count').attemptCount, 1);
  }

  console.log('PASS: isolated Outbox/Worker model cases (11 groups)');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
