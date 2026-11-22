'use strict';
// CI trigger: focused crypto regression suite.
const assert = require('node:assert/strict');
const { generateCode, digestCode, safeEqualHex } = require('./mock-recovery-engine');

const secretA = 'isolated-test-secret-A-with-32-plus-characters';
const secretB = 'isolated-test-secret-B-with-32-plus-characters';

// Rejection boundary: 60000 and 65535 must be rejected; 59999 is accepted.
const samples = [60000, 65535, 59999];
let calls = 0;
const code = generateCode(() => {
  const value = samples[calls++];
  return Buffer.from([(value >> 8) & 0xff, value & 0xff]);
});
assert.equal(calls, 3, 'out-of-range 16-bit samples must be rejected');
assert.equal(code, '9999', 'largest accepted sample maps to 9999');

// Leading zeroes remain part of the four-character code.
assert.equal(generateCode(() => Buffer.from([0, 7])), '0007');

// HMAC-SHA-256 is deterministic for a key and input, and key-separated.
const digestA = digestCode('0042', secretA);
assert.match(digestA, /^[a-f0-9]{64}$/);
assert.equal(digestCode('0042', secretA), digestA);
assert.notEqual(digestCode('0042', secretB), digestA);
assert.notEqual(digestCode('0043', secretA), digestA);
assert.equal(safeEqualHex(digestA, digestA), true);
assert.equal(safeEqualHex(digestA, digestCode('0042', secretB)), false);
assert.equal(safeEqualHex('not-a-digest', digestA), false);
assert.equal(safeEqualHex(digestA, '0'.repeat(63)), false);
assert.throws(() => digestCode('0042', 'short'), /32 characters/);
assert.throws(() => digestCode('0042', undefined), /32 characters/);

console.log('PASS: rejection-sampling boundaries, leading zeroes, HMAC key separation, and digest validation');
