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

function makeAdmin({targetValid=true,fetchPayload=true}={}) {
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
        return {data:targetValid?{id:'trainee-1',phone_normalized:'+989123456789',approval_status:'active'}:{id:'trainee-1',phone_normalized:'+989000000000',approval_status:'active'}};
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

await assert.rejects(
  processOneRecoveryOutboxItem({admin:makeAdmin(),workerId,deliveryKeys,cryptoImpl:webcrypto,provider:{send:async()=>({accepted:true})}}),
  /REAL_PROVIDER_DISABLED_IN_EXPERIMENT/
);
console.log('PASS: fake-only worker success, timeout-to-unknown/no-resend, trainee recheck, and real-provider rejection.');
