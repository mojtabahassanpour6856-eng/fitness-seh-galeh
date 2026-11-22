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
// A copied envelope must not decrypt when transplanted to another request or operation.
const transplanted={...first};
await assert.rejects(
  decryptRecoveryDeliveryCode({envelope:transplanted,keys,requestId,operationId:otherOperationId,cryptoImpl:webcrypto}),
  /DELIVERY_PAYLOAD_AUTHENTICATION_FAILED/
);
await assert.rejects(
  decryptRecoveryDeliveryCode({envelope:transplanted,keys,requestId:'6ba7b813-9dad-41d1-80b4-00c04fd430c8',operationId,cryptoImpl:webcrypto}),
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

const oldKey=Buffer.alloc(32,0x31).toString('base64');
const newKey=Buffer.alloc(32,0x52).toString('base64');
const oldEnvelope=await encryptRecoveryDeliveryCode({
  code:'7319',key:oldKey,keyVersion:'delivery_old',requestId,operationId,cryptoImpl:webcrypto
});
// Rotation changes the active write key but retains the old key for in-flight payloads.
const rotatedKeyring={delivery_old:oldKey,delivery_new:newKey};
assert.equal(await decryptRecoveryDeliveryCode({
  envelope:oldEnvelope,keys:rotatedKeyring,requestId,operationId,cryptoImpl:webcrypto
}),'7319','old envelope must remain decryptable while its key is retained');
const newEnvelope=await encryptRecoveryDeliveryCode({
  code:'8426',key:rotatedKeyring.delivery_new,keyVersion:'delivery_new',requestId,operationId,cryptoImpl:webcrypto
});
assert.equal(newEnvelope.kid,'delivery_new');
assert.equal(await decryptRecoveryDeliveryCode({
  envelope:newEnvelope,keys:rotatedKeyring,requestId,operationId,cryptoImpl:webcrypto
}),'8426');
await assert.rejects(
  decryptRecoveryDeliveryCode({envelope:oldEnvelope,keys:{delivery_new:newKey},requestId,operationId,cryptoImpl:webcrypto}),
  /DELIVERY_KEY_VERSION_UNAVAILABLE/,
  'removing an old key before all old payloads are terminal must fail closed'
);
console.log('PASS: delivery-key rotation retains old-key decryption while new writes use the active key.');

console.log('PASS: AES-GCM round-trip, nonce uniqueness, AAD binding, tamper rejection, key-version fail-closed, and strict envelope validation.');
