import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { encryptRecoveryDeliveryCode } from './recovery-delivery-payload-crypto.mjs';
import { FakeRecoverySmsProvider, processOneRecoveryOutboxItem } from './recovery-outbox-worker-mock.mjs';

const requestId='6ba7b810-9dad-41d1-80b4-00c04fd430c8';
const operationId='6ba7b811-9dad-41d1-80b4-00c04fd430c8';
const workerId='6ba7b812-9dad-41d1-80b4-00c04fd430c8';
const key=Buffer.alloc(32,9).toString('base64');
const deliveryKeys={d1:key};
const envelope=await encryptRecoveryDeliveryCode({code:'0427',key,keyVersion:'d1',requestId,operationId,cryptoImpl:webcrypto});

function makeAdmin({targetValid=true,fetchPayload=true,archived=false}={}) {
  const calls=[];
  const lease={outbox_id:'6ba7b813-9dad-41d1-80b4-00c04fd430c8',recovery_request_id:requestId,
    lease_generation:4,provider_idempotency_key:'trainee-recovery:'+operationId};
  const admin={
    calls,
    async rpc(name,args) {
      calls.push({name,args});
      const values={
        recovery_outbox_claim:[lease],
        recovery_outbox_heartbeat:true,
        recovery_outbox_begin_send:true,
        recovery_outbox_fetch_payload:fetchPayload?[{recovery_request_id:requestId,delivery_operation_id:operationId,delivery_payload:envelope}]:[],
        recovery_outbox_finish:true
      };
      return {data:values[name]};
    },
    from(table) {
      return {select(){return this;},eq(){return this;},async maybeSingle(){
        if(table==='trainee_password_recovery_requests') return {data:{id:requestId,trainee_id:'trainee-1',phone_normalized:'+989123456789',status:'approved',delivery_outcome:'attempting',delivery_operation_id:operationId}};
        return {data:targetValid?{id:'trainee-1',phone_normalized:'+989123456789',approval_status:'active',archived_at:archived?'2026-01-01T00:00:00Z':null}:{id:'trainee-1',phone_normalized:'+989000000000',approval_status:'active',archived_at:null}};
      }};
    }
  };
  return admin;
}

const admin=makeAdmin();
const provider=new FakeRecoverySmsProvider([{kind:'accepted',messageId:'mock-accepted-1'}]);
const sent=await processOneRecoveryOutboxItem({admin,workerId,deliveryKeys,cryptoImpl:webcrypto,provider});
assert.deepEqual(sent,{status:'sent'});
assert.equal(provider.calls.length,1);
assert.equal(provider.calls[0].code,'0427');
assert.equal(provider.calls[0].phone,'+989123456789');
assert.equal(provider.calls[0].idempotencyKey,'trainee-recovery:'+operationId);
assert.equal(admin.calls.at(-1).args.p_outcome,'sent');

const timeoutAdmin=makeAdmin();
const timeoutProvider=new FakeRecoverySmsProvider([{kind:'timeout'}]);
const unknown=await processOneRecoveryOutboxItem({admin:timeoutAdmin,workerId,deliveryKeys,cryptoImpl:webcrypto,provider:timeoutProvider});
assert.deepEqual(unknown,{status:'unknown'});
assert.equal(timeoutAdmin.calls.at(-1).args.p_outcome,'unknown');

const invalidAdmin=makeAdmin({targetValid:false});
const unusedProvider=new FakeRecoverySmsProvider();
const failed=await processOneRecoveryOutboxItem({admin:invalidAdmin,workerId,deliveryKeys,cryptoImpl:webcrypto,provider:unusedProvider});
assert.deepEqual(failed,{status:'failed'});
assert.equal(unusedProvider.calls.length,0,'phone/status mismatch must block provider call');

const missingIdempotencyAdmin=makeAdmin();
const missingIdemRpc=missingIdempotencyAdmin.rpc.bind(missingIdempotencyAdmin);
missingIdempotencyAdmin.rpc=async(name,args)=>{
  if(name==='recovery_outbox_claim') return {data:[{outbox_id:'6ba7b813-9dad-41d1-80b4-00c04fd430c8',lease_generation:4}]};
  return missingIdemRpc(name,args);
};
const missingIdemProvider=new FakeRecoverySmsProvider();
assert.deepEqual(await processOneRecoveryOutboxItem({admin:missingIdempotencyAdmin,workerId,deliveryKeys,cryptoImpl:webcrypto,provider:missingIdemProvider}),{status:'invalid_lease'});
assert.equal(missingIdemProvider.calls.length,0);
assert.equal(missingIdempotencyAdmin.calls.some(x=>x.name==='recovery_outbox_begin_send'),false,'missing stable idempotency key must block durable send-start');

const archivedAdmin=makeAdmin({archived:true});
const archivedProvider=new FakeRecoverySmsProvider();
assert.deepEqual(await processOneRecoveryOutboxItem({admin:archivedAdmin,workerId,deliveryKeys,cryptoImpl:webcrypto,provider:archivedProvider}),{status:'failed'});
assert.equal(archivedProvider.calls.length,0,'archived trainee must not receive recovery SMS');

const ambiguousCommitAdmin=makeAdmin();
let finishCalls=0;
const originalRpc=ambiguousCommitAdmin.rpc.bind(ambiguousCommitAdmin);
ambiguousCommitAdmin.rpc=async(name,args)=>{
  if(name==='recovery_outbox_finish'){
    finishCalls++;
    if(finishCalls===1) throw new Error('MOCK_DB_RESPONSE_LOST_AFTER_PROVIDER_ACCEPTANCE');
    return {data:false};
  }
  return originalRpc(name,args);
};
const acceptedBeforeDbLoss=new FakeRecoverySmsProvider([{kind:'accepted',messageId:'accepted-but-db-unknown'}]);
assert.deepEqual(await processOneRecoveryOutboxItem({admin:ambiguousCommitAdmin,workerId,deliveryKeys,cryptoImpl:webcrypto,provider:acceptedBeforeDbLoss}),{status:'unknown'});
assert.equal(acceptedBeforeDbLoss.calls.length,1,'accepted message followed by DB response loss must never be sent twice');
assert.equal(finishCalls,2,'worker attempts a fenced unknown finalization after ambiguous sent finalization');

await assert.rejects(
  processOneRecoveryOutboxItem({admin:makeAdmin(),workerId,deliveryKeys,cryptoImpl:webcrypto,provider:{send:async()=>({accepted:true})}}),
  /REAL_PROVIDER_DISABLED_IN_EXPERIMENT/
);

const badCipherAdmin=makeAdmin();
const badCipherRpc=badCipherAdmin.rpc.bind(badCipherAdmin);
badCipherAdmin.rpc=async(name,args)=>{
  if(name==='recovery_outbox_fetch_payload'){
    const result=await badCipherRpc(name,args);
    result.data[0].delivery_payload={...result.data[0].delivery_payload,ct:'AAAAAAAAAAAAAAAAAAAAAAAAAAA='};
    return result;
  }
  return badCipherRpc(name,args);
};
const badCipherProvider=new FakeRecoverySmsProvider();
assert.deepEqual(await processOneRecoveryOutboxItem({admin:badCipherAdmin,workerId,deliveryKeys,cryptoImpl:webcrypto,provider:badCipherProvider}),{status:'unknown'});
assert.equal(badCipherProvider.calls.length,0,'AES-GCM authentication failure must never call provider');
assert.equal(badCipherAdmin.calls.at(-1).args.p_outcome,'unknown','decryption failure after send-start must become terminal unknown');

const missingPayloadAdmin=makeAdmin({fetchPayload:false});
const noPayloadProvider=new FakeRecoverySmsProvider();
assert.deepEqual(await processOneRecoveryOutboxItem({admin:missingPayloadAdmin,workerId,deliveryKeys,cryptoImpl:webcrypto,provider:noPayloadProvider}),{status:'unknown'});
assert.equal(noPayloadProvider.calls.length,0);
assert.equal(missingPayloadAdmin.calls.at(-1).args.p_safe_error_code,'payload_unavailable_after_send_start');

const lostLeaseAdmin=makeAdmin();
lostLeaseAdmin.rpc=async(name,args)=>{
  lostLeaseAdmin.calls.push({name,args});
  if(name==='recovery_outbox_claim') return {data:[{outbox_id:'6ba7b813-9dad-41d1-80b4-00c04fd430c8',lease_generation:4,provider_idempotency_key:'idem'}]};
  if(name==='recovery_outbox_heartbeat') return {data:false};
  return {data:true};
};
const lostLeaseProvider=new FakeRecoverySmsProvider();
assert.deepEqual(await processOneRecoveryOutboxItem({admin:lostLeaseAdmin,workerId,deliveryKeys,cryptoImpl:webcrypto,provider:lostLeaseProvider}),{status:'lease_lost'});
assert.equal(lostLeaseProvider.calls.length,0);
assert.equal(lostLeaseAdmin.calls.some(x=>x.name==='recovery_outbox_begin_send'),false);

const malformedAdmin=makeAdmin();
const malformedProvider=new FakeRecoverySmsProvider([{kind:'malformed'}]);
assert.deepEqual(await processOneRecoveryOutboxItem({admin:malformedAdmin,workerId,deliveryKeys,cryptoImpl:webcrypto,provider:malformedProvider}),{status:'unknown'});
assert.equal(malformedAdmin.calls.at(-1).args.p_outcome,'unknown');

console.log('PASS: fake-only worker success, timeout-to-unknown/no-resend, trainee recheck, and real-provider rejection.');
