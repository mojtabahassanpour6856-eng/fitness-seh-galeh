/**
 * Experimental encrypted recovery-code envelope.
 * WebCrypto-only: suitable for Node test runtime and Deno Edge runtime.
 * Never log envelopes, plaintext codes, or key material.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_VERSION_RE = /^[A-Za-z0-9_-]{1,32}$/;
const CODE_RE = /^\d{4}$/;
const encoder = new TextEncoder();
const aadFor = (requestId, operationId) =>
  encoder.encode(`fitness-seh-galeh:trainee-recovery:v1:${requestId.toLowerCase()}:${operationId.toLowerCase()}`);

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function base64ToBytes(value) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new Error('INVALID_ENVELOPE');
  const binary = atob(value);
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}
function validateIds(requestId, operationId, keyVersion) {
  if (!UUID_RE.test(requestId || '') || !UUID_RE.test(operationId || '') || !KEY_VERSION_RE.test(keyVersion || ''))
    throw new Error('INVALID_ENVELOPE_CONTEXT');
}
async function importAesKey(rawKey, cryptoImpl) {
  const raw = typeof rawKey === 'string' ? base64ToBytes(rawKey) : new Uint8Array(rawKey || []);
  if (raw.byteLength !== 32) throw new Error('INVALID_DELIVERY_KEY');
  return cryptoImpl.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
export async function encryptRecoveryDeliveryCode({ code, key, keyVersion, requestId, operationId, cryptoImpl = globalThis.crypto }) {
  validateIds(requestId, operationId, keyVersion);
  if (!CODE_RE.test(code || '') || !cryptoImpl?.subtle || !cryptoImpl?.getRandomValues)
    throw new Error('INVALID_DELIVERY_PAYLOAD');
  const iv = cryptoImpl.getRandomValues(new Uint8Array(12));
  const cryptoKey = await importAesKey(key, cryptoImpl);
  const ciphertext = await cryptoImpl.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadFor(requestId, operationId), tagLength: 128 },
    cryptoKey, encoder.encode(code)
  );
  return Object.freeze({ v: 1, alg: 'A256GCM', kid: keyVersion, iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ciphertext)) });
}
export async function decryptRecoveryDeliveryCode({ envelope, keys, requestId, operationId, cryptoImpl = globalThis.crypto }) {
  if (!envelope || envelope.v !== 1 || envelope.alg !== 'A256GCM' ||
      typeof envelope.kid !== 'string' || !KEY_VERSION_RE.test(envelope.kid) ||
      Object.keys(envelope).sort().join(',') !== 'alg,ct,iv,kid,v')
    throw new Error('INVALID_ENVELOPE');
  validateIds(requestId, operationId, envelope.kid);
  const rawKey = keys?.[envelope.kid];
  if (!rawKey) throw new Error('DELIVERY_KEY_VERSION_UNAVAILABLE');
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ct);
  if (iv.byteLength !== 12 || ciphertext.byteLength !== 20)
    throw new Error('INVALID_ENVELOPE');
  const cryptoKey = await importAesKey(rawKey, cryptoImpl);
  let plaintext;
  try {
    plaintext = await cryptoImpl.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aadFor(requestId, operationId), tagLength: 128 },
      cryptoKey, ciphertext
    );
  } catch { throw new Error('DELIVERY_PAYLOAD_AUTHENTICATION_FAILED'); }
  const code = new TextDecoder().decode(plaintext);
  if (!CODE_RE.test(code)) throw new Error('INVALID_DELIVERY_PAYLOAD');
  return code;
}
