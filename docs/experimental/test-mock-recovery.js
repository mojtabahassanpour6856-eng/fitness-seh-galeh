'use strict';
const assert = require('node:assert/strict');
const { STATES, generateCode, safeEqualHex, MockRecovery } = require('./mock-recovery-engine');
const secret = 'mock-test-secret-key-with-at-least-32-chars';
let now = 1000000;
const sys = () => new MockRecovery({ secret, now: () => now, codeTTLms: 24 * 60 * 60_000, maxAttempts: 3, cooldownMs: 60000 });
assert.equal(generateCode(() => Buffer.from([0, 0])), '0000');
assert.equal(generateCode(() => Buffer.from([0x27, 0x0f])), '9999');
const retryCode = generateCode((() => { let i=0; return () => i++===0 ? Buffer.from([0xea,0x60]) : Buffer.from([0,1]); })());
assert.equal(retryCode, '0001');

let zeroClock = 0;
const zeroClockSystem = new MockRecovery({secret,now:()=>zeroClock,cooldownMs:60000});
assert.equal(zeroClockSystem.request({traineeId:'zero',coachId:'coach',requestId:'zero1'}).state, STATES.REQUESTED,
  'first request at clock zero must not be blocked by cooldown');
assert.throws(()=>zeroClockSystem.request({traineeId:'zero',coachId:'coach',requestId:'zero2'}), /Cooldown/);


const grantClock = { value: 5000000 };
const grantSystem = new MockRecovery({secret,now:()=>grantClock.value,codeTTLms:24*60*60_000});
grantSystem.request({traineeId:'grant-trainee',coachId:'grant-coach',requestId:'grant-expiry'});
const grantIssued = grantSystem.approve({requestId:'grant-expiry',authenticatedCoachId:'grant-coach'});
const grantCode = grantSystem.mockMessages.at(-1).body.match(/(\d{4})$/)[1];
assert.equal(grantSystem.verify({requestId:'grant-expiry',traineeId:'grant-trainee',code:grantCode}).state,STATES.VERIFIED);
const grantRecord = grantSystem.requests.get('grant-expiry');
assert.equal(grantRecord.grantExpiresAt, grantClock.value + 10*60_000, 'post-verification grant must be short-lived');
grantClock.value += 10*60_000;
assert.throws(()=>grantSystem.complete({requestId:'grant-expiry',traineeId:'grant-trainee'}),/expired|not verified/i);
assert.equal(grantRecord.state,STATES.EXPIRED,'expired reset grant cannot complete');
assert.equal(grantRecord.grantExpiresAt,null,'expired grant material must be cleared');

const oneTime = sys();
oneTime.request({traineeId:'once',coachId:'coach',requestId:'once-request'});
oneTime.approve({requestId:'once-request',authenticatedCoachId:'coach'});
const oneTimeCode = oneTime.mockMessages.at(-1).body.match(/(\d{4})$/)[1];
oneTime.verify({requestId:'once-request',traineeId:'once',code:oneTimeCode});
assert.equal(oneTime.complete({requestId:'once-request',traineeId:'once'}).state,STATES.COMPLETED);
assert.throws(()=>oneTime.complete({requestId:'once-request',traineeId:'once'}),/verified/i);


let grantSweepNow = 15000000;
const grantSweep = new MockRecovery({secret,now:()=>grantSweepNow,cooldownMs:0});
grantSweep.request({traineeId:'gs',coachId:'gc',requestId:'gs1'});
grantSweep.approve({requestId:'gs1',authenticatedCoachId:'gc'});
const grantSweepCode = grantSweep.mockMessages.at(-1).body.match(/(\d{4})$/)[1];
grantSweep.verify({requestId:'gs1',traineeId:'gs',code:grantSweepCode});
grantSweepNow += 10*60_000;
assert.equal(grantSweep.sweepExpired(),1,'sweep must expire unused verified grants');
assert.equal(grantSweep.requests.get('gs1').state,STATES.EXPIRED);
assert.equal(grantSweep.requests.get('gs1').grantExpiresAt,null);
assert.equal(grantSweep.request({traineeId:'gs',coachId:'gc',requestId:'gs2'}).state,STATES.REQUESTED);


let unknownNow = 18000000;
const unknownDelivery = new MockRecovery({secret,now:()=>unknownNow,cooldownMs:0,requestTTLms:500,delivery:()=>{throw new Error('timeout');}});
unknownDelivery.request({traineeId:'uy',coachId:'uc',requestId:'uy1'});
assert.equal(unknownDelivery.approve({requestId:'uy1',authenticatedCoachId:'uc'}).delivery,'UNKNOWN');
unknownNow += 500;
assert.equal(unknownDelivery.sweepExpired(),1);
assert.equal(unknownDelivery.requests.get('uy1').state,STATES.EXPIRED);
assert.equal(unknownDelivery.request({traineeId:'uy',coachId:'uc',requestId:'uy2'}).state,STATES.REQUESTED);


let assignedCoach = 'coach-A';
const reassignment = new MockRecovery({secret,now:()=>now,cooldownMs:0,getCurrentCoachId:()=>assignedCoach});
reassignment.request({traineeId:'move-trainee',coachId:'coach-A',requestId:'move-request'});
assignedCoach = 'coach-B';
assert.throws(()=>reassignment.approve({requestId:'move-request',authenticatedCoachId:'coach-A'}),/assignment changed/i,
  'former coach must not approve after trainee reassignment');
assert.equal(reassignment.requests.get('move-request').state,STATES.STALE_ASSIGNMENT);
assert.equal(reassignment.mockMessages.length,0,'stale assignment must not trigger delivery');
assert.equal(reassignment.request({traineeId:'move-trainee',coachId:'coach-B',requestId:'move-request-B'}).coachId,'coach-B',
  'trainee may start a new request routed to the current coach after stale request is closed');
let assignedForReject = 'coach-A';
const reassignmentReject = new MockRecovery({secret,now:()=>now,cooldownMs:0,getCurrentCoachId:()=>assignedForReject});
reassignmentReject.request({traineeId:'move-reject',coachId:'coach-A',requestId:'move-reject-request'});
assignedForReject = 'coach-B';
assert.throws(()=>reassignmentReject.reject({requestId:'move-reject-request',authenticatedCoachId:'coach-A'}),/assignment changed/i);
assert.equal(reassignmentReject.requests.get('move-reject-request').state,STATES.STALE_ASSIGNMENT);


const trustedAssignments = new Map([['trusted-trainee','trusted-coach']]);
const trustedRequestSystem = new MockRecovery({secret,now:()=>now,cooldownMs:0,
  getCurrentCoachId:(traineeId)=>trustedAssignments.get(traineeId) || null});
const trustedRequest = trustedRequestSystem.requestForAuthenticatedTrainee({
  authenticatedTraineeId:'trusted-trainee',
  requestId:'trusted-request',
  traineeId:'attacker-controlled-trainee',
  coachId:'attacker-controlled-coach',
  destinationPhone:'+00000000000'
});
assert.equal(trustedRequest.traineeId,'trusted-trainee','client-supplied trainee ID must be ignored');
assert.equal(trustedRequest.coachId,'trusted-coach','client-supplied coach ID must be ignored');
assert.throws(()=>trustedRequestSystem.requestForAuthenticatedTrainee({
  authenticatedTraineeId:'unknown-trainee',requestId:'unknown-request'
}),/unavailable/i,'unknown identity must fail closed without account details');

const s = sys();
assert.equal(s.request({traineeId:'t1',coachId:'c1',requestId:'r1'}).state, STATES.REQUESTED);
const firstRequestSnapshot = s.requests.get('r1');
const firstReturned = s.request({traineeId:'t1',coachId:'c1',requestId:'r1'});
firstReturned.state = STATES.COMPLETED;
assert.equal(firstRequestSnapshot.state, STATES.REQUESTED, 'first request response must be a detached snapshot');
assert.equal(s.request({traineeId:'t1',coachId:'c1',requestId:'r1'}).requestId, 'r1');
const exposedRequest = s.request({traineeId:'t1',coachId:'c1',requestId:'r1'});
exposedRequest.state = STATES.COMPLETED;
assert.equal(s.requests.get('r1').state, STATES.REQUESTED, 'returned request must not expose mutable internal state');
assert.throws(() => s.request({traineeId:'t1',coachId:'c1',requestId:'r1b'}),/Active recovery request exists/);
assert.throws(() => s.request({traineeId:'attacker',coachId:'other',requestId:'r1'}), /Idempotency key conflict/);
assert.throws(() => s.approve({requestId:'r1',authenticatedCoachId:'c2'}), /ownership/);
assert.equal(s.approve({requestId:'r1',authenticatedCoachId:'c1'}).delivery,'MOCK_ONLY');
const approveRetry = s.approve({requestId:'r1',authenticatedCoachId:'c1'});
assert.equal(approveRetry.idempotent, true);
assert.equal(s.mockMessages.length, 1, 'approval retry must not resend/create a new code');
assert.throws(() => s.verify({requestId:'r1',traineeId:'t1',code:'1a23'}),/Invalid code/);
const code=s.mockMessages[0].body.split(': ').pop();
assert.equal(code.length,4);
assert.throws(() => s.verify({requestId:'r1',traineeId:'t2',code}),/ownership/);
assert.throws(() => s.verify({requestId:'r1',traineeId:'t1',code:'1111'}),/Invalid code/);
s.verify({requestId:'r1',traineeId:'t1',code});
assert.equal(s.requests.get('r1').state,STATES.VERIFIED);
assert.throws(() => s.verify({requestId:'r1',traineeId:'t1',code}),/Invalid state/);
s.complete({requestId:'r1',traineeId:'t1'});
assert.equal(s.requests.get('r1').state,STATES.COMPLETED);
assert.throws(() => s.complete({requestId:'r1',traineeId:'t1'}),/Not verified/);
const exp=sys();
exp.request({traineeId:'t3',coachId:'c3',requestId:'r3'});
exp.approve({requestId:'r3',authenticatedCoachId:'c3'});
now+=24 * 60 * 60_000;
assert.throws(() => exp.verify({requestId:'r3',traineeId:'t3',code:exp.mockMessages[0].body.slice(-4)}),/expired/i);
assert.equal(exp.requests.get('r3').state,STATES.EXPIRED);
assert.throws(()=>exp.request({traineeId:'t3',coachId:'c3',requestId:'r3b'}),/Cooldown/);
now += 60000;
assert.equal(exp.request({traineeId:'t3',coachId:'c3',requestId:'r3b'}).state,STATES.REQUESTED);
// Expiry boundary: valid just before 24 hours, invalid exactly at 24 hours.
let boundaryNow = 2000000;
const boundarySystem = () => new MockRecovery({ secret, now: () => boundaryNow, maxAttempts: 3, cooldownMs: 0 });
const beforeExpiry = boundarySystem();
beforeExpiry.request({traineeId:'t7',coachId:'c7',requestId:'r7'});
beforeExpiry.approve({requestId:'r7',authenticatedCoachId:'c7'});
const beforeCode = beforeExpiry.mockMessages[0].body.slice(-4);
boundaryNow += 24 * 60 * 60_000 - 1;
assert.equal(beforeExpiry.verify({requestId:'r7',traineeId:'t7',code:beforeCode}).state, STATES.VERIFIED);
const exactExpiry = boundarySystem();
exactExpiry.request({traineeId:'t8',coachId:'c8',requestId:'r8'});
const exactExpiryMeta = exactExpiry.approve({requestId:'r8',authenticatedCoachId:'c8'});
const exactCode = exactExpiry.mockMessages[0].body.slice(-4);
boundaryNow = exactExpiryMeta.expiresAt;
assert.throws(() => exactExpiry.verify({requestId:'r8',traineeId:'t8',code:exactCode}), /expired/i);
assert.equal(exactExpiry.requests.get('r8').state, STATES.EXPIRED);
const attempts=sys();
attempts.request({traineeId:'t4',coachId:'c4',requestId:'r4'});
attempts.approve({requestId:'r4',authenticatedCoachId:'c4'});
for(let i=0;i<3;i++) assert.throws(()=>attempts.verify({requestId:'r4',traineeId:'t4',code:'9999'}),/Invalid code/);
assert.throws(()=>attempts.verify({requestId:'r4',traineeId:'t4',code:'9999'}),/Invalid state|Attempt limit/);
assert.equal(attempts.requests.get('r4').codeDigest, null, 'lockout clears the stored code digest');
assert.equal(attempts.requests.get('r4').expiresAt, null, 'lockout clears the code expiry');
const rejected=sys();
rejected.request({traineeId:'t6',coachId:'c6',requestId:'r6'});
assert.throws(() => rejected.reject({requestId:'r6',authenticatedCoachId:'wrong'}),/ownership/);
rejected.reject({requestId:'r6',authenticatedCoachId:'c6'});
assert.equal(rejected.requests.get('r6').state,STATES.REJECTED);
assert.throws(() => rejected.approve({requestId:'r6',authenticatedCoachId:'c6'}),/Invalid state/);
// Rejected request should permit a fresh request after cooldown; fixture uses no cooldown.
const rejectedRetry = new MockRecovery({secret,now:()=>now,cooldownMs:0});
rejectedRetry.request({traineeId:'t9',coachId:'c9',requestId:'r9'});
rejectedRetry.reject({requestId:'r9',authenticatedCoachId:'c9'});
assert.equal(rejectedRetry.request({traineeId:'t9',coachId:'c9',requestId:'r10'}).state,STATES.REQUESTED);
const cancelled = new MockRecovery({secret,now:()=>now,cooldownMs:0});
cancelled.request({traineeId:'tc',coachId:'cc',requestId:'rc'});
assert.throws(()=>cancelled.cancel({requestId:'rc',traineeId:'wrong'}),/ownership/);
assert.equal(cancelled.cancel({requestId:'rc',traineeId:'tc'}).state,STATES.CANCELLED);
assert.throws(()=>cancelled.approve({requestId:'rc',authenticatedCoachId:'cc'}),/Invalid state/);
assert.equal(cancelled.request({traineeId:'tc',coachId:'cc',requestId:'rc2'}).state,STATES.REQUESTED);
// Simulated delivery failure: code must not be stored or accepted, and approval can be retried.
let deliveries = 0;
const failDelivery = new MockRecovery({secret,now:()=>now,cooldownMs:0,delivery:()=>{ deliveries++; return {ok:false}; }});
failDelivery.request({traineeId:'tf',coachId:'cf',requestId:'rf'});
const failed = failDelivery.approve({requestId:'rf',authenticatedCoachId:'cf'});
assert.equal(failed.delivery,'FAILED');
assert.equal(failed.retryable,true);
assert.equal(failDelivery.requests.get('rf').state,STATES.APPROVED);
assert.equal(failDelivery.requests.get('rf').codeDigest,null);
assert.equal(failDelivery.mockMessages.length,0);
assert.throws(()=>failDelivery.verify({requestId:'rf',traineeId:'tf',code:'0000'}),/Invalid state/);
failDelivery.delivery = () => ({ok:true});
const retryDelivery = failDelivery.approve({requestId:'rf',authenticatedCoachId:'cf'});
assert.equal(retryDelivery.delivery,'MOCK_ONLY');
assert.equal(failDelivery.requests.get('rf').state,STATES.CODE_ISSUED);
assert.equal(failDelivery.mockMessages.length,1);
assert.equal(deliveries,1, 'failed attempt was simulated once');
// Delivery retries are bounded: no unlimited resend loop.
let retryCalls = 0;
const retryLimited = new MockRecovery({secret,now:()=>now,cooldownMs:0,maxDeliveryAttempts:2,delivery:()=>{retryCalls++;return {ok:false};}});
retryLimited.request({traineeId:'tl',coachId:'cl',requestId:'rl'});
assert.equal(retryLimited.approve({requestId:'rl',authenticatedCoachId:'cl'}).delivery,'FAILED');
assert.equal(retryLimited.approve({requestId:'rl',authenticatedCoachId:'cl'}).delivery,'FAILED');
assert.throws(()=>retryLimited.approve({requestId:'rl',authenticatedCoachId:'cl'}),/attempt limit/i);
assert.equal(retryCalls,2);
// Re-entrant approval during delivery is blocked by DELIVERY_PENDING.
let nestedApprovalError = '';
let reentrantSystem;
reentrantSystem = new MockRecovery({secret,now:()=>now,cooldownMs:0,delivery:()=>{
  try { reentrantSystem.approve({requestId:'rr',authenticatedCoachId:'cr'}); }
  catch(e) { nestedApprovalError = e.message; }
  return {ok:true};
}});
reentrantSystem.request({traineeId:'tr',coachId:'cr',requestId:'rr'});
assert.equal(reentrantSystem.approve({requestId:'rr',authenticatedCoachId:'cr'}).state,STATES.CODE_ISSUED);
assert.match(nestedApprovalError,/Invalid state/);
assert.equal(reentrantSystem.mockMessages.length,1);
assert.throws(() => reentrantSystem.request({traineeId:'tr',coachId:'cr',requestId:'rr2'}), /Active recovery request exists/, 'DELIVERY_PENDING must block parallel requests');
// A thrown delivery callback has an ambiguous outcome: fail closed, do not blindly resend.
let throwCalls = 0;
const callbackThrows = new MockRecovery({secret,now:()=>now,cooldownMs:0,delivery:()=>{
  throwCalls++;
  throw new Error('mock provider exception');
}});
callbackThrows.request({traineeId:'tx',coachId:'cx',requestId:'rx'});
const ambiguousDelivery = callbackThrows.approve({requestId:'rx',authenticatedCoachId:'cx'});
assert.equal(ambiguousDelivery.delivery,'UNKNOWN');
assert.equal(ambiguousDelivery.retryable,false);
assert.equal(callbackThrows.requests.get('rx').state,STATES.DELIVERY_UNKNOWN);
assert.throws(()=>callbackThrows.approve({requestId:'rx',authenticatedCoachId:'cx'}),/Invalid state/);
assert.throws(()=>callbackThrows.request({traineeId:'tx',coachId:'cx',requestId:'rx2'}),/Active recovery request exists/);
assert.equal(throwCalls,1,'ambiguous delivery must not trigger a blind resend');
// Stale REQUESTED requests expire and do not permanently block a fresh recovery.
let staleNow = 5000000;
const staleRequests = new MockRecovery({secret,now:()=>staleNow,cooldownMs:0,requestTTLms:1000});
staleRequests.request({traineeId:'ts',coachId:'cs',requestId:'rs'});
staleNow += 1000;
assert.equal(staleRequests.sweepExpired(),1);
assert.equal(staleRequests.requests.get('rs').state,STATES.EXPIRED);
assert.equal(staleRequests.request({traineeId:'ts',coachId:'cs',requestId:'rs2'}).state,STATES.REQUESTED);
// APPROVED after delivery failure also expires and permits a new request.
let staleApprovedNow = 7000000;
const staleApproved = new MockRecovery({secret,now:()=>staleApprovedNow,cooldownMs:0,requestTTLms:1000,delivery:()=>({ok:false})});
staleApproved.request({traineeId:'ta',coachId:'ca',requestId:'ra'});
staleApproved.approve({requestId:'ra',authenticatedCoachId:'ca'});
staleApprovedNow += 1000;
assert.equal(staleApproved.sweepExpired(),1);
assert.equal(staleApproved.requests.get('ra').state,STATES.EXPIRED);
assert.equal(staleApproved.request({traineeId:'ta',coachId:'ca',requestId:'ra2'}).state,STATES.REQUESTED);
// Rate limit total recovery requests per rolling window even after rejection.
let rateNow=9000000;
const rateLimited = new MockRecovery({secret,now:()=>rateNow,cooldownMs:0,maxRequestsPerWindow:2,requestWindowMs:1000});
rateLimited.request({traineeId:'rate',coachId:'coach',requestId:'rate1'});
rateLimited.reject({requestId:'rate1',authenticatedCoachId:'coach'});
rateLimited.request({traineeId:'rate',coachId:'coach',requestId:'rate2'});
rateLimited.reject({requestId:'rate2',authenticatedCoachId:'coach'});
assert.throws(()=>rateLimited.request({traineeId:'rate',coachId:'coach',requestId:'rate3'}),/rate limit/i);
rateNow+=1000;
assert.equal(rateLimited.request({traineeId:'rate',coachId:'coach',requestId:'rate4'}).state,STATES.REQUESTED);
// Expired pending requests cannot be cancelled or rejected after their TTL.
let terminalNow=12000000;
const staleTerminal = new MockRecovery({secret,now:()=>terminalNow,cooldownMs:0,requestTTLms:50});
staleTerminal.request({traineeId:'stc',coachId:'stcc',requestId:'stc1'});
terminalNow+=50;
assert.throws(()=>staleTerminal.cancel({requestId:'stc1',traineeId:'stc'}),/Invalid state/);
assert.equal(staleTerminal.requests.get('stc1').state,STATES.EXPIRED);
staleTerminal.request({traineeId:'str',coachId:'strc',requestId:'str1'});
terminalNow+=50;
assert.throws(()=>staleTerminal.reject({requestId:'str1',authenticatedCoachId:'strc'}),/Invalid state/);
assert.equal(staleTerminal.requests.get('str1').state,STATES.EXPIRED);
const cooldown=sys();
cooldown.request({traineeId:'t5',coachId:'c5',requestId:'r5'});
assert.throws(()=>cooldown.request({traineeId:'t5',coachId:'c5',requestId:'r6'}),/Cooldown/);
assert.equal(safeEqualHex('a'.repeat(64),'a'.repeat(64)),true);
assert.equal(safeEqualHex('a'.repeat(64),'b'.repeat(64)),false);
console.log('All mock recovery engine tests passed.');
