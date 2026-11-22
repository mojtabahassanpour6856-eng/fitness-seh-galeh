/**
 * Candidate security primitives for trainee password recovery.
 * Node/Deno-compatible. NOT an Edge Function and NOT deployable by itself.
 * Database authorization/state transitions must be implemented by reviewed RPCs.
 */
'use strict';
import { createHmac, randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto';

const encoder = new TextEncoder();
const ACCEPT_LIMIT = 60000; // floor(65536 / 10000) * 10000

export function generateRecoveryCode(random = nodeRandomBytes) {
  for (;;) {
    const bytes = random(2);
    if (!bytes || bytes.length !== 2) throw new Error('Secure random source unavailable');
    const sample = (bytes[0] << 8) | bytes[1];
    if (sample < ACCEPT_LIMIT) return String(sample % 10000).padStart(4, '0');
  }
}

export function digestRecoveryCode(code, secret, keyVersion) {
  if (typeof secret !== 'string' || encoder.encode(secret).length < 32) {
    throw new Error('Recovery HMAC secret unavailable');
  }
  if (typeof keyVersion !== 'string' || !/^[a-zA-Z0-9_-]{1,32}$/.test(keyVersion)) {
    throw new Error('Recovery HMAC key version invalid');
  }
  if (typeof code !== 'string' || !/^\d{4}$/.test(code)) {
    throw new Error('Recovery code format invalid');
  }
  return createHmac('sha256', secret)
    .update('trainee-password-recovery:v1:')
    .update(keyVersion)
    .update(':')
    .update(code)
    .digest('hex');
}

export function safeDigestEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

export function normalizeIranMobile(value) {
  let phone = String(value ?? '').trim()
    .replace(/[\s()-]/g, '')
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  if (/^09\d{9}$/.test(phone)) phone = '+98' + phone.slice(1);
  else if (/^989\d{9}$/.test(phone)) phone = '+' + phone;
  else if (/^00989\d{9}$/.test(phone)) phone = '+' + phone.slice(2);
  return /^\+989\d{9}$/.test(phone) ? phone : null;
}

export function isAllowedOrigin(origin, allowlist) {
  if (typeof origin !== 'string' || !Array.isArray(allowlist)) return false;
  return allowlist.some(item => typeof item === 'string' && item === origin);
}

export function publicRequestAcceptedResponse() {
  // Deliberately identical for eligible/ineligible/already-open requests.
  return Object.freeze({
    status: 202,
    body: Object.freeze({
      success: true,
      message: 'اگر شماره به حساب واجد شرایط متصل باشد، درخواست برای بررسی ارسال می‌شود.'
    })
  });
}

/**
 * Fail-closed Auth update policy.
 * Call only after the database has atomically claimed the request and persisted operationId.
 * Never retry Auth update on timeout/transport ambiguity.
 */
export function classifyAuthUpdateOutcome(outcome) {
  if (outcome?.kind === 'confirmed_success') return 'completed';
  if (outcome?.kind === 'confirmed_no_change') return 'auth_update_failed';
  return 'auth_update_unknown';
}

export function assertRecoverySecrets(env) {
  const keyVersion = env?.RECOVERY_HMAC_KEY_VERSION;
  const origins = String(env?.RECOVERY_ALLOWED_ORIGINS ?? '')
    .split(',').map(x => x.trim()).filter(Boolean);
  let parsed;
  try { parsed = JSON.parse(env?.RECOVERY_HMAC_KEYS ?? ''); }
  catch { throw new Error('RECOVERY_HMAC_KEYS must be a valid JSON key map'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('RECOVERY_HMAC_KEYS must be a JSON object');
  }
  const hmacKeys = Object.create(null);
  for (const [version, secret] of Object.entries(parsed)) {
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(version) ||
        typeof secret !== 'string' || encoder.encode(secret).length < 32) {
      throw new Error('Every recovery HMAC key must have a valid version and at least 32 bytes');
    }
    hmacKeys[version] = secret;
  }
  if (!keyVersion || !/^[a-zA-Z0-9_-]{1,32}$/.test(keyVersion) ||
      !Object.hasOwn(hmacKeys, keyVersion)) {
    throw new Error('RECOVERY_HMAC_KEY_VERSION must identify a configured key');
  }
  if (!origins.length || origins.some(x => !/^https:\/\//.test(x))) {
    throw new Error('RECOVERY_ALLOWED_ORIGINS must contain explicit HTTPS origins');
  }
  let deliveryParsed;
  try { deliveryParsed = JSON.parse(env?.RECOVERY_DELIVERY_KEYS ?? ''); }
  catch { throw new Error('RECOVERY_DELIVERY_KEYS must be a valid JSON key map'); }
  if (!deliveryParsed || typeof deliveryParsed !== 'object' || Array.isArray(deliveryParsed)) {
    throw new Error('RECOVERY_DELIVERY_KEYS must be a JSON object');
  }
  const deliveryKeys = Object.create(null);
  for (const [version, encoded] of Object.entries(deliveryParsed)) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(version) || typeof encoded !== 'string' ||
        !/^(?:[A-Za-z0-9+/]{4}){10}[A-Za-z0-9+/]{3}=$/.test(encoded)) {
      throw new Error('Every delivery key must be a versioned base64-encoded 32-byte key');
    }
    deliveryKeys[version] = encoded;
  }
  const deliveryKeyVersion = env?.RECOVERY_DELIVERY_KEY_VERSION;
  if (!deliveryKeyVersion || !Object.hasOwn(deliveryKeys, deliveryKeyVersion)) {
    throw new Error('RECOVERY_DELIVERY_KEY_VERSION must identify a configured delivery key');
  }
  return Object.freeze({ hmacKeys: Object.freeze(hmacKeys), hmac: hmacKeys[keyVersion],
    keyVersion, origins, deliveryKeys: Object.freeze(deliveryKeys), deliveryKeyVersion });
}
