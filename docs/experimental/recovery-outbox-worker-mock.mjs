/**
 * Experimental Outbox worker. Fake-provider only; never deploy or connect a real SMS provider.
 * The database RPCs own all lease fencing and state transitions.
 */
import { decryptRecoveryDeliveryCode } from './recovery-delivery-payload-crypto.mjs';

export class FakeRecoverySmsProvider {
  constructor(script = [{ kind: 'accepted', messageId: 'mock-sms-1' }]) {
    this.script = [...script];
    this.calls = [];
  }
  async send({ phone, code, idempotencyKey }) {
    this.calls.push({ phone, code, idempotencyKey });
    const next = this.script.length ? this.script.shift() : { kind: 'accepted', messageId: 'mock-sms-default' };
    if (next.kind === 'timeout') throw new Error('MOCK_PROVIDER_TIMEOUT');
    if (next.kind === 'definite_failure') return { accepted: false, definite: true };
    if (next.kind === 'accepted') return { accepted: true, messageId: next.messageId };
    return { accepted: true, malformed: true };
  }
}

function oneRow(data) { return Array.isArray(data) ? data[0] : data; }
async function rpc(admin, name, args) {
  const result = await admin.rpc(name, args);
  if (result?.error) throw new Error('RECOVERY_WORKER_RPC_FAILED:' + name);
  return result?.data;
}
async function finish(admin, lease, outcome, providerMessageId = null, safeErrorCode = null) {
  const ok = await rpc(admin, 'recovery_outbox_finish', {
    p_outbox_id: lease.outbox_id, p_worker_id: lease.workerId,
    p_generation: lease.lease_generation, p_outcome: outcome,
    p_provider_message_id: providerMessageId, p_safe_error_code: safeErrorCode
  });
  return ok === true;
}

export async function processOneRecoveryOutboxItem({
  admin, workerId, deliveryKeys, cryptoImpl = globalThis.crypto, provider
}) {
  if (!admin?.rpc || !admin?.from || !workerId) throw new Error('INVALID_WORKER_DEPENDENCIES');
  if (!(provider instanceof FakeRecoverySmsProvider)) throw new Error('REAL_PROVIDER_DISABLED_IN_EXPERIMENT');
  if (!deliveryKeys || typeof deliveryKeys !== 'object') throw new Error('DELIVERY_KEYS_REQUIRED');

  const claimed = await rpc(admin, 'recovery_outbox_claim', {
    p_worker_id: workerId, p_lease_seconds: 60
  });
  const lease = oneRow(claimed);
  if (!lease) return { status: 'idle' };
  if (typeof lease.provider_idempotency_key !== 'string' ||
      lease.provider_idempotency_key.length < 1 ||
      lease.provider_idempotency_key.length > 200) {
    return { status: 'invalid_lease' };
  }
  const fencedLease = { ...lease, workerId };

  const heartbeat = await rpc(admin, 'recovery_outbox_heartbeat', {
    p_outbox_id: lease.outbox_id, p_worker_id: workerId,
    p_generation: lease.lease_generation, p_lease_seconds: 60
  });
  if (heartbeat !== true) return { status: 'lease_lost' };

  const started = await rpc(admin, 'recovery_outbox_begin_send', {
    p_outbox_id: lease.outbox_id, p_worker_id: workerId,
    p_generation: lease.lease_generation
  });
  if (started !== true) return { status: 'send_not_started' };

  try {
    const payloadRows = await rpc(admin, 'recovery_outbox_fetch_payload', {
      p_outbox_id: lease.outbox_id, p_worker_id: workerId,
      p_generation: lease.lease_generation
    });
    const payload = oneRow(payloadRows);
    if (!payload?.recovery_request_id || !payload?.delivery_operation_id || !payload?.delivery_payload) {
      await finish(admin, fencedLease, 'unknown', null, 'payload_unavailable_after_send_start');
      return { status: 'unknown' };
    }

    const code = await decryptRecoveryDeliveryCode({
      envelope: payload.delivery_payload, keys: deliveryKeys,
      requestId: payload.recovery_request_id, operationId: payload.delivery_operation_id,
      cryptoImpl
    });

    const requestResult = await admin.from('trainee_password_recovery_requests')
      .select('id,trainee_id,phone_normalized,status,delivery_outcome,delivery_operation_id,reviewed_by')
      .eq('id', payload.recovery_request_id).maybeSingle();
    if (requestResult?.error || !requestResult?.data) {
      await finish(admin, fencedLease, 'failed', null, 'recovery_request_unavailable');
      return { status: 'failed' };
    }
    const request = requestResult.data;
    const traineeResult = await admin.from('trainees')
      .select('id,phone_normalized,approval_status,archived_at,coach_user_id')
      .eq('id', request.trainee_id).maybeSingle();
    const trainee = traineeResult?.data;
    const validTarget = !traineeResult?.error && trainee &&
      trainee.approval_status === 'active' &&
      trainee.archived_at == null &&
      trainee.phone_normalized === request.phone_normalized &&
      typeof request.reviewed_by === 'string' && request.reviewed_by.length > 0 &&
      trainee.coach_user_id === request.reviewed_by &&
      request.status === 'approved' &&
      request.delivery_outcome === 'attempting' &&
      request.delivery_operation_id === payload.delivery_operation_id;
    if (!validTarget) {
      await finish(admin, fencedLease, 'failed', null, 'recovery_target_recheck_failed');
      return { status: 'failed' };
    }

    const result = await provider.send({
      phone: request.phone_normalized, code,
      idempotencyKey: lease.provider_idempotency_key
    });
    if (result?.accepted === true && !result.malformed &&
        typeof result.messageId === 'string' && result.messageId.length > 0 &&
        result.messageId.length <= 128) {
      const completed = await finish(admin, fencedLease, 'sent', result.messageId, null);
      return { status: completed ? 'sent' : 'unknown' };
    }
    if (result?.accepted === false && result.definite === true) {
      const completed = await finish(admin, fencedLease, 'failed', null, 'provider_definite_failure');
      return { status: completed ? 'failed' : 'unknown' };
    }
    await finish(admin, fencedLease, 'unknown', null, 'provider_response_ambiguous');
    return { status: 'unknown' };
  } catch {
    // A failure after durable send-start is ambiguous. Never automatically resend.
    await finish(admin, fencedLease, 'unknown', null, 'worker_error_after_send_start');
    return { status: 'unknown' };
  }
}
