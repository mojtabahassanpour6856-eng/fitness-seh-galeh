/**
 * Dependency-injected HTTP handler candidate for trainee password recovery.
 * Deployment-shaped handler module candidate. No SMS provider/client construction here.
 * All state transitions are delegated to the service-role-only candidate RPC wrappers.
 */
'use strict';
import {
  generateRecoveryCode, digestRecoveryCode, normalizeIranMobile,
  isAllowedOrigin, publicRequestAcceptedResponse, assertRecoverySecrets
} from './recovery-candidate-core.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { encryptRecoveryDeliveryCode } from './recovery-delivery-payload-crypto.mjs';

const genericRequest = publicRequestAcceptedResponse();
const json = (body, status, origin) => {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (origin) {
    headers['access-control-allow-origin'] = origin;
    headers['vary'] = 'Origin';
    headers['access-control-allow-headers'] = 'authorization, apikey, content-type, x-client-info';
    headers['access-control-allow-methods'] = 'POST, OPTIONS';
  }
  return new Response(JSON.stringify(body), { status, headers });
};
const safeError = () => ({ success: false, message: 'درخواست در حال حاضر قابل پردازش نیست؛ کمی بعد تلاش کنید.' });
const publicResetFailure = () => ({ success: false, message: 'کد یا درخواست معتبر نیست، منقضی شده یا قبلاً استفاده شده است.' });

function rateKey(phone) {
  return createHash('sha256').update('trainee-password-recovery-rate:v1:').update(phone).digest('hex');
}
function getHeader(req, name) { return req.headers.get(name) || ''; }

// Bound both declared and streamed request sizes before JSON parsing.
async function readBoundedJson(req, maxBytes = 8192) {
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new Error('REQUEST_TOO_LARGE');
  if (!req.body) throw new Error('EMPTY_BODY');
  const reader = req.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('REQUEST_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
function isUuid(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function normalizeCode(value) {
  return String(value ?? '').trim()
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}
async function authenticateCoach(req, deps) {
  const authorization = getHeader(req, 'authorization');
  if (!/^Bearer\s+\S+$/i.test(authorization)) return null;
  const userClient = deps.createUserClient(authorization);
  const { data, error } = await userClient.auth.getUser();
  if (error || !data?.user?.id) return null;
  const { data: profile, error: profileError } = await deps.admin.from('profiles')
    .select('role').eq('id', data.user.id).maybeSingle();
  if (profileError || profile?.role !== 'coach') return null;
  return data.user;
}
async function rpc(admin, name, args) {
  const result = await admin.rpc(name, args);
  if (result.error) throw new Error('RPC_FAILED:' + name);
  return result.data;
}

export function createRecoveryCandidateHandler(deps) {
  const secrets = assertRecoverySecrets(deps.env);
  const now = deps.now || (() => Date.now());
  const random = deps.randomBytes;
  const codeGenerator = () => generateRecoveryCode(random);

  return async function handle(req) {
    const origin = getHeader(req, 'origin');
    if (origin && !isAllowedOrigin(origin, secrets.origins)) return json({ success: false }, 403, null);
    const corsOrigin = origin || null;

    if (req.method === 'OPTIONS') {
      if (origin && !corsOrigin) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsOrigin ? {
        'access-control-allow-origin': corsOrigin,
        'vary': 'Origin',
        'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
        'access-control-allow-methods': 'POST, OPTIONS'
      } : {} });
    }
    if (req.method !== 'POST') return json({ success: false, message: 'فقط POST مجاز است.' }, 405, corsOrigin);

    let body;
    try { body = await readBoundedJson(req); } catch { return json({ success: false, message: 'درخواست نامعتبر یا بیش از حد بزرگ است.' }, 413, corsOrigin); }
    const action = String(body?.action || '');

    try {
      if (action === 'request') {
        const phone = normalizeIranMobile(body?.phone);
        if (!phone) return json({ success: false, message: 'شماره موبایل معتبر نیست.' }, 400, corsOrigin);
        const { data: allowed, error: rateError } = await deps.admin.rpc('recovery_consume_request_rate_limit', {
          p_key_hash: rateKey(phone), p_window_seconds: 3600, p_max_requests: 5
        });
        if (rateError) return json(genericRequest.body, genericRequest.status, corsOrigin);
        if (allowed !== true) return json({ success: true, message: genericRequest.body.message }, genericRequest.status, corsOrigin);
        // Boolean result intentionally ignored: never disclose account existence or request state.
        await rpc(deps.admin, 'recovery_submit_request', { p_phone_normalized: phone });
        return json(genericRequest.body, genericRequest.status, corsOrigin);
      }

      if (action === 'list' || action === 'review') {
        const user = await authenticateCoach(req, deps);
        if (!user) return json({ success: false, message: 'نشست یا دسترسی مربی معتبر نیست.' }, 401, corsOrigin);

        if (action === 'list') {
          const { data, error } = await deps.admin.from('trainee_password_recovery_requests')
            .select('id,trainee_id,status,requested_at,reviewed_at,delivery_outcome,auth_outcome,trainees!inner(full_name,coach_user_id)')
            .eq('request_coach_user_id', user.id)
            .eq('trainees.coach_user_id', user.id)
            .in('status', ['pending', 'approved', 'processing'])
            .order('requested_at', { ascending: true }).limit(50);
          if (error) return json(safeError(), 503, corsOrigin);
          const requests = (data || []).map(row => ({
            id: row.id, trainee_id: row.trainee_id, status: row.status,
            requested_at: row.requested_at, reviewed_at: row.reviewed_at,
            delivery_outcome: row.delivery_outcome, auth_outcome: row.auth_outcome,
            trainee_name: Array.isArray(row.trainees) ? row.trainees[0]?.full_name : row.trainees?.full_name
          }));
          return json({ success: true, requests }, 200, corsOrigin);
        }

        const requestId = String(body?.request_id || '');
        const decision = String(body?.decision || '');
        if (!isUuid(requestId) || !['approve', 'reject'].includes(decision))
          return json({ success: false, message: 'درخواست نامعتبر است.' }, 400, corsOrigin);

        const code = decision === 'approve' ? codeGenerator() : null;
        const keyHash = code ? digestRecoveryCode(code, secrets.hmac, secrets.keyVersion) : null;
        const operationId = code ? (deps.randomUUID || randomUUID)() : null;
        const encryptedPayload = code ? await encryptRecoveryDeliveryCode({
          code, key: secrets.deliveryKeys[secrets.deliveryKeyVersion],
          keyVersion: secrets.deliveryKeyVersion, requestId, operationId,
          cryptoImpl: deps.crypto || globalThis.crypto
        }) : null;
        const reviewed = decision === 'approve'
          ? await rpc(deps.admin, 'recovery_coach_review_encrypted', {
              p_request_id: requestId, p_actor_user_id: user.id, p_decision: decision,
              p_token_hash: keyHash,
              p_token_expires_at: new Date(now() + 24 * 60 * 60 * 1000).toISOString(),
              p_hmac_key_version: secrets.keyVersion,
              p_delivery_operation_id: operationId,
              p_delivery_payload: encryptedPayload
            })
          : await rpc(deps.admin, 'recovery_coach_review', {
              p_request_id: requestId, p_actor_user_id: user.id, p_decision: decision,
              p_token_hash: null, p_token_expires_at: null, p_hmac_key_version: null
            });
        if (!reviewed?.ok) return json({ success: false, message: 'درخواست پیدا نشد، قبلاً بررسی شده یا دسترسی کافی ندارید.' }, 409, corsOrigin);
        if (decision === 'reject') return json({ success: true, status: 'rejected' }, 200, corsOrigin);

        // Approval and Outbox enqueue are one database transaction via trigger.
        // This HTTP handler never sends SMS; a separately reviewed Worker owns delivery.
        if (reviewed.delivery_operation_id !== operationId || !isUuid(operationId)) return json(safeError(), 503, corsOrigin);
        return json({
          success: true,
          status: 'approved',
          delivery_status: 'queued',
          message: 'درخواست تأیید شد و در صف ارسال قرار گرفت؛ هنوز ارسال پیامک تأیید نشده است.'
        }, 202, corsOrigin);
      }

      if (action === 'reset') {
        const phone = normalizeIranMobile(body?.phone);
        const code = normalizeCode(body?.code);
        const password = String(body?.new_password ?? '');
        if (!phone || !/^\d{4}$/.test(code) || password.length < 8 || password.length > 128)
          return json(publicResetFailure(), 400, corsOrigin);

        const { data: matches, error: lookupError } = await deps.admin.from('trainee_password_recovery_requests')
          .select('id,phone_normalized,hmac_key_version')
          .eq('phone_normalized', phone).eq('status', 'approved')
          .eq('delivery_outcome', 'sent').limit(2);
        if (lookupError || !Array.isArray(matches) || matches.length !== 1)
          return json(publicResetFailure(), 400, corsOrigin);

        const request = matches[0];
        const storedKeyVersion = request.hmac_key_version || secrets.keyVersion;
        if (!Object.hasOwn(secrets.hmacKeys, storedKeyVersion))
          return json(publicResetFailure(), 400, corsOrigin);
        const digest = digestRecoveryCode(code, secrets.hmacKeys[storedKeyVersion], storedKeyVersion);
        const operationId = (deps.randomUUID || randomUUID)();
        const claim = await rpc(deps.admin, 'recovery_claim_reset', {
          p_request_id: request.id, p_code_digest: digest, p_operation_id: operationId
        });
        if (!claim?.claimed) {
          await rpc(deps.admin, 'recovery_record_wrong_attempt', {
            p_request_id: request.id, p_submitted_digest: digest
          });
          return json(publicResetFailure(), 400, corsOrigin);
        }
        if (claim.operation_id !== operationId || !isUuid(claim.auth_user_id))
          return json(safeError(), 503, corsOrigin);

        const began = await rpc(deps.admin, 'recovery_begin_auth_update', {
          p_request_id: request.id, p_operation_id: operationId
        });
        if (began !== true) return json(publicResetFailure(), 409, corsOrigin);

        let updateError = null;
        try {
          const result = await deps.admin.auth.admin.updateUserById(claim.auth_user_id, { password });
          updateError = result?.error || null;
        } catch { updateError = new Error('AUTH_OUTCOME_UNKNOWN'); }

        if (updateError) {
          // Conservatively classify every SDK error/throw as ambiguous. Never reopen or retry.
          try {
            await rpc(deps.admin, 'recovery_finish_auth_update', {
              p_request_id: request.id, p_operation_id: operationId,
              p_outcome: 'unknown', p_safe_error_code: 'auth_outcome_unknown'
            });
          } catch { /* locked processing row is the fail-closed fallback */ }
          return json({ success: false, message: 'نتیجه تغییر رمز قابل تأیید نیست؛ کد دوباره قابل استفاده نخواهد بود.' }, 503, corsOrigin);
        }

        // Auth confirmed success. If this marker fails, the password is still changed and
        // the durable processing row remains locked for manual reconciliation.
        try {
          const finalized = await rpc(deps.admin, 'recovery_finish_auth_update', {
            p_request_id: request.id, p_operation_id: operationId,
            p_outcome: 'completed', p_safe_error_code: null
          });
          if (finalized !== true) {
            // Auth may already have changed the password, but durable completion is not confirmed.
            // Never claim success or invite another Auth update in this ambiguous state.
            return json({ success: false, message: 'نتیجه تغییر رمز هنوز قابل تأیید نیست؛ دوباره تلاش نکنید.' }, 503, corsOrigin);
          }
        } catch {
          // Auth may already have changed the password. Keep the durable processing row locked.
          return json({ success: false, message: 'نتیجه تغییر رمز هنوز قابل تأیید نیست؛ دوباره تلاش نکنید.' }, 503, corsOrigin);
        }
        return json({ success: true, message: 'رمز جدید ذخیره شد؛ اکنون با رمز جدید وارد شوید.' }, 200, corsOrigin);
      }

      return json({ success: false, message: 'عملیات نامعتبر است.' }, 400, corsOrigin);
    } catch {
      // Do not log request bodies, phone numbers, codes, passwords, RPC payloads, or provider errors.
      return json(safeError(), 503, corsOrigin);
    }
  };
}
