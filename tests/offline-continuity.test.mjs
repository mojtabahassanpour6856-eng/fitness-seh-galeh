import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineContinuity, OFFLINE_CONTINUITY_STORAGE_KEY } from '../experiments/offline-continuity-prototype/offline-continuity.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    dump: () => Object.fromEntries(values)
  };
}

test('online verified session can remember only the safe shell route', () => {
  const storage = memoryStorage();
  const app = createOfflineContinuity({ storage });
  app.rememberSafeView('home');
  assert.deepEqual(JSON.parse(storage.getItem(OFFLINE_CONTINUITY_STORAGE_KEY)), { version: 1, view: 'home' });
  assert.equal(app.resolve({ online: true, verified: true }), 'authenticated-online');
});

test('network loss keeps shell but never authenticates the user', () => {
  const app = createOfflineContinuity({ storage: memoryStorage() });
  app.rememberSafeView('home');
  assert.equal(app.resolve({ online: false, verified: false }), 'offline-limited');
});

test('offline marker is not enough to open private areas', () => {
  const app = createOfflineContinuity({ storage: memoryStorage() });
  app.rememberSafeView('home');
  assert.notEqual(app.resolve({ online: false, verified: true }), 'authenticated-online');
  assert.equal(app.resolve({ online: true, verified: false }), 'reauth-required');
});

test('without a prior safe marker offline entry stays public', () => {
  const app = createOfflineContinuity({ storage: memoryStorage() });
  assert.equal(app.resolve({ online: false, verified: false }), 'offline-guest');
});

test('tampered or unknown marker fails closed', () => {
  const storage = memoryStorage();
  storage.setItem(OFFLINE_CONTINUITY_STORAGE_KEY, JSON.stringify({ version: 99, view: 'admin' }));
  const app = createOfflineContinuity({ storage });
  assert.equal(app.resolve({ online: false, verified: false }), 'offline-guest');
  assert.equal(app.getSafeView(), 'home');
});

test('sensitive or unapproved routes cannot be persisted', () => {
  const app = createOfflineContinuity({ storage: memoryStorage() });
  assert.throws(() => app.rememberSafeView('trainees'), /allow-listed/);
  assert.throws(() => app.rememberSafeView('payments'), /allow-listed/);
});

test('clear removes the local continuity marker', () => {
  const storage = memoryStorage();
  const app = createOfflineContinuity({ storage });
  app.rememberSafeView('home');
  app.clear();
  assert.equal(app.resolve({ online: false, verified: false }), 'offline-guest');
});

test('malformed JSON fails closed', () => {
  const storage = memoryStorage();
  storage.setItem(OFFLINE_CONTINUITY_STORAGE_KEY, '{broken');
  const app = createOfflineContinuity({ storage });
  assert.equal(app.resolve({ online: false, verified: false }), 'offline-guest');
});