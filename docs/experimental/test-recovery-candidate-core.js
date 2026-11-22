'use strict';
import assert from 'node:assert/strict';
import {
  generateRecoveryCode, digestRecoveryCode, safeDigestEqual,
  normalizeIranMobile, isAllowedOrigin, publicRequestAcceptedResponse,
  classifyAuthUpdateOutcome, assertRecoverySecrets
} from './recovery-candidate-core.mjs';

{
  const samples = [60000, 65535, 59999];
  const code = generateRecoveryCode(() => {
    const n = samples.shift();
    return Buffer.from([n >> 8, n & 255]);
  });
  assert.equal(code, '9999');
}
{
  const code = generateRecoveryCode(() => Buffer.from([0, 7]));
  assert.equal(code, '0007');
}
{
  const a = digestRecoveryCode('0042', 'candidate-test-secret-longer-than-32-bytes', 'k1');
  const b = digestRecoveryCode('0042', 'candidate-test-secret-longer-than-32-bytes', 'k1');
  const otherKey = digestRecoveryCode('0042', 'different-candidate-secret-longer-than-32', 'k1');
  const otherVersion = digestRecoveryCode('0042', 'candidate-test-secret-longer-than-32-bytes', 'k2');
  const otherCode = digestRecoveryCode('0043', 'candidate-test-secret-longer-than-32-bytes', 'k1');
  assert.equal(a, b);
  assert.equal(safeDigestEqual(a, b), true);
  assert.equal(safeDigestEqual(a, otherKey), false);
  assert.equal(safeDigestEqual(a, otherVersion), false);
  assert.equal(safeDigestEqual(a, otherCode), false);
  assert.equal(safeDigestEqual(a, 'not-a-digest'), false);
  assert.throws(() => digestRecoveryCode('42', 'candidate-test-secret-longer-than-32-bytes', 'k1'));
  assert.throws(() => digestRecoveryCode('0042', 'short', 'k1'));
}
{
  assert.equal(normalizeIranMobile('۰۹۱۲۳۴۵۶۷۸۹'), '+989123456789');
  assert.equal(normalizeIranMobile('00989123456789'), '+989123456789');
  assert.equal(normalizeIranMobile('123'), null);
}
{
  const a = publicRequestAcceptedResponse();
  const b = publicRequestAcceptedResponse();
  assert.deepEqual(a, b);
  assert.equal(a.status, 202);
  assert.equal(isAllowedOrigin('https://app.example.test', ['https://app.example.test']), true);
  assert.equal(isAllowedOrigin('https://evil.example.test', ['https://app.example.test']), false);
}
{
  assert.equal(classifyAuthUpdateOutcome({kind:'confirmed_success'}), 'completed');
  assert.equal(classifyAuthUpdateOutcome({kind:'confirmed_no_change'}), 'auth_update_failed');
  assert.equal(classifyAuthUpdateOutcome({kind:'timeout'}), 'auth_update_unknown');
  assert.equal(classifyAuthUpdateOutcome({kind:'transport_error'}), 'auth_update_unknown');
  assert.throws(() => assertRecoverySecrets({RECOVERY_HMAC_KEYS:'not-json',RECOVERY_HMAC_KEY_VERSION:'k1',RECOVERY_ALLOWED_ORIGINS:'https://app.test'}));
  assert.throws(() => assertRecoverySecrets({RECOVERY_HMAC_KEYS:JSON.stringify({k0:'short'}),RECOVERY_HMAC_KEY_VERSION:'k1',RECOVERY_ALLOWED_ORIGINS:'https://app.test'}));
  assert.throws(() => assertRecoverySecrets({RECOVERY_HMAC_KEYS:JSON.stringify({k0:'candidate-test-secret-longer-than-32-bytes'}),RECOVERY_HMAC_KEY_VERSION:'k1',RECOVERY_ALLOWED_ORIGINS:'https://app.test'}));
  const configured = assertRecoverySecrets({
    RECOVERY_HMAC_KEYS: JSON.stringify({
      k0:'older-candidate-test-secret-longer-than-32-bytes',
      k1:'candidate-test-secret-longer-than-32-bytes'
    }),
    RECOVERY_HMAC_KEY_VERSION:'k1',
    RECOVERY_ALLOWED_ORIGINS:'https://app.test,https://admin.app.test'
  });
  assert.equal(configured.hmac, 'candidate-test-secret-longer-than-32-bytes');
  assert.equal(configured.hmacKeys.k0, 'older-candidate-test-secret-longer-than-32-bytes');
  assert.deepEqual(configured.origins, ['https://app.test','https://admin.app.test']);
}
console.log('PASS: candidate crypto, phone normalization, generic response, CORS allowlist, and fail-closed Auth outcome primitives.');
