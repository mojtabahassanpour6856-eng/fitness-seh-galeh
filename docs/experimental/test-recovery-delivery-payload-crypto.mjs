import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { encryptRecoveryDeliveryCode, decryptRecoveryDeliveryCode } from './recovery-delivery-payload-crypto.mjs';

const requestId='6ba7b810-9dad-41d1-80b4-00c04fd430c8';
const operationId='6ba7b811-9dad-41d1-80b4-00c04fd430c8';
const otherOperationId='6ba7b812-9dad-41d1-80b4-00c04fd430c8';
const key=Buffer.from(Array.from({length:32},(_,i)=>i+1)).toString('base64');
const keys={delivery_k1:key};
const args={code:'0427',key,keyVersion:'delivery_k1',requestId,operationId,cryptoImpl:webcrypto};

const first=await encryptRecoveryDeliveryCode(args);
const second=await encryptRecoveryDeliveryCode(args);
assert.deepEqual(Object.keys(first).sort(),['alg','ct','iv','kid','v']);
assert.equal(first.v,1);
assert.equal(first.alg,'A256GCM');
assert.notEqual(first.iv,second.iv,'fresh 96-bit nonce required for every encryption');
assert.equal(await decryptRecoveryDeliveryCode({envelope:first,keys,requestId,operationId,cryptoImpl:webcrypto}),'0427');
await assert.rejects(
  decryptRecoveryDeliveryCode({envelope:first,keys,requestId,operationId:otherOperationId,cryptoImpl:webcrypto}),
  /DELIVERY_PAYLOAD_AUTHENTICATION_FAILED/
);
await assert.rejects(
  decryptRecoveryDeliveryCode({envelope:first,keys,requestId:'6ba7b813-9dad-41d1-80b4-00c04fd430c8',operationId,cryptoImpl:webcrypto}),
  /DELIVERY_PAYLOAD_AUTHENTICATION_FAILED/
);
const tampered={...first,ct:(first.ct[0]==='A'?'B':'A')+first.ct.slice(1)};
await assert.rejects(
  decryptRecoveryDeliveryCode({envelope:tampered,keys,requestId,operationId,cryptoImpl:webcrypto}),
  /DELIVERY_PAYLOAD_AUTHENTICATION_FAILED/
);
await assert.rejects(
  decryptRecoveryDeliveryCode({envelope:first,keys:{},requestId,operationId,cryptoImpl:webcrypto}),
  /DELIVERY_KEY_VERSION_UNAVAILABLE/
);
await assert.rejects(
  encryptRecoveryDeliveryCode({...args,code:'12345'}),
  /INVALID_DELIVERY_PAYLOAD/
);
await assert.rejects(
  decryptRecoveryDeliveryCode({envelope:{...first,unexpected:'x'},keys,requestId,operationId,cryptoImpl:webcrypto}),
  /INVALID_ENVELOPE/
);
console.log('PASS: AES-GCM round-trip, nonce uniqueness, AAD binding, tamper rejection, key-version fail-closed, and strict envelope validation.');
