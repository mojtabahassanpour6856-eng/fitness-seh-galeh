'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {Pool}=require('pg');
const pool=new Pool({host:process.env.PGHOST||'127.0.0.1',port:Number(process.env.PGPORT||5432),user:process.env.PGUSER||'postgres',password:process.env.PGPASSWORD||'postgres',database:process.env.PGDATABASE||'recovery_ci',max:8});
const workerA='50000000-0000-4000-8000-000000000001';
const workerB='50000000-0000-4000-8000-000000000002';
async function asService(sql,args=[]){
 const c=await pool.connect();
 try{await c.query('BEGIN');await c.query('SET LOCAL ROLE service_role');const r=await c.query(sql,args);await c.query('COMMIT');return r;}
 catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
async function main(){
 const migration=fs.readFileSync('docs/experimental/migrations/20261122_recovery_outbox_worker_candidate.sql','utf8');
 const beginFn=migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION recovery_private.begin_recovery_outbox_send'),migration.indexOf('CREATE OR REPLACE FUNCTION recovery_private.finish_recovery_outbox'));
 const finishFn=migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION recovery_private.finish_recovery_outbox'),migration.indexOf('CREATE OR REPLACE FUNCTION recovery_private.reconcile_expired_recovery_outbox'));
 assert.match(beginFn,/RAISE EXCEPTION 'outbox send-start state changed'/,'begin-send must rollback both row updates if Outbox update fails');
 assert.match(finishFn,/RAISE EXCEPTION 'outbox completion state changed'/,'finish must rollback both row updates if Outbox update fails');
 await pool.query(migration);

 // The real coach-review RPC must atomically create exactly one Outbox row.
 const reviewRequest='30000000-0000-4000-8000-000000000005';
 const coach='10000000-0000-4000-8000-000000000002';
 const initialRequest=await pool.query('SELECT status,delivery_operation_id FROM public.trainee_password_recovery_requests WHERE id=$1',[reviewRequest]);
 const initialDeliveryOperationId=initialRequest.rows[0].delivery_operation_id;
 const tx=await pool.connect();
 try {
   await tx.query('BEGIN');
   await tx.query('SET LOCAL ROLE service_role');
   const rolled=await tx.query(
     'SELECT public.recovery_coach_review($1,$2,$3,$4,$5,$6) AS result',
     [reviewRequest,coach,'approve','c'.repeat(64),new Date(Date.now()+10*60_000).toISOString(),'k1']
   );
   assert.equal(rolled.rows[0].result.ok,true);
   const inside=await tx.query('SELECT count(*)::int AS n FROM public.trainee_password_recovery_outbox WHERE recovery_request_id=$1',[reviewRequest]);
   assert.equal(inside.rows[0].n,1,'Outbox row must exist inside the approval transaction');
   await tx.query('ROLLBACK');
 } finally { tx.release(); }
 let rolledBack=await pool.query('SELECT status,delivery_operation_id FROM public.trainee_password_recovery_requests WHERE id=$1',[reviewRequest]);
 assert.equal(rolledBack.rows[0].status,'pending');
 assert.equal(rolledBack.rows[0].delivery_operation_id,initialDeliveryOperationId,'rollback must restore the exact pre-approval request state');
 let noOutbox=await pool.query('SELECT count(*)::int AS n FROM public.trainee_password_recovery_outbox WHERE recovery_request_id=$1',[reviewRequest]);
 assert.equal(noOutbox.rows[0].n,0,'rollback must remove the outbox insert with the approval');
 const approved=await asService(
   'SELECT public.recovery_coach_review($1,$2,$3,$4,$5,$6) AS result',
   [reviewRequest,coach,'approve','c'.repeat(64),new Date(Date.now()+10*60_000).toISOString(),'k1']
 );
 assert.equal(approved.rows[0].result.ok,true);
 const deliveryOp=approved.rows[0].result.delivery_operation_id;
 const linked=await pool.query('SELECT recovery_request_id,delivery_operation_id,provider_idempotency_key,status FROM public.trainee_password_recovery_outbox WHERE recovery_request_id=$1',[reviewRequest]);
 assert.equal(linked.rows.length,1);
 assert.equal(linked.rows[0].delivery_operation_id,deliveryOp);
 assert.equal(linked.rows[0].provider_idempotency_key,'trainee-recovery:'+deliveryOp);
 const duplicateReview=await asService(
   'SELECT public.recovery_coach_review($1,$2,$3,$4,$5,$6) AS result',
   [reviewRequest,coach,'approve','c'.repeat(64),new Date(Date.now()+10*60_000).toISOString(),'k1']
 );
 assert.equal(duplicateReview.rows[0].result.ok,false);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM public.trainee_password_recovery_outbox WHERE recovery_request_id=$1',[reviewRequest])).rows[0].n,1);
 console.log('PASS: coach approval atomically enqueues one Outbox row; rollback and duplicate approval are safe');

 const reqA=reviewRequest;
 const firstOutbox=await pool.query('SELECT id FROM public.trainee_password_recovery_outbox WHERE recovery_request_id=$1',[reqA]);
 assert.equal(firstOutbox.rows.length,1);
 const ids=[firstOutbox.rows[0].id];
 // Two independent PostgreSQL sessions race to claim one pending row.
 const race=await Promise.all([workerA,workerB].map(w=>asService(
 "SELECT * FROM recovery_private.claim_recovery_outbox($1,30)",[w]
 )));
 assert.equal(race.reduce((n,r)=>n+r.rowCount,0),1,'only one worker may claim the same Outbox item');
 const lease=race.find(r=>r.rowCount===1).rows[0];
 assert.equal(Number(lease.lease_generation),1);
 console.log('PASS: two independent sessions; exactly one atomic Outbox claim');
 // Before send-start, expired lease may be reclaimed with a higher generation.
 await pool.query("UPDATE public.trainee_password_recovery_outbox SET locked_until=now()-interval '1 second' WHERE id=$1",[lease.outbox_id]);
 const reclaim=await asService("SELECT * FROM recovery_private.claim_recovery_outbox($1,30)",[workerB]);
 assert.equal(reclaim.rowCount,1);
 const newer=reclaim.rows[0];
 assert.equal(Number(newer.lease_generation),2);
 assert.equal(await asService("SELECT recovery_private.heartbeat_recovery_outbox($1,$2,$3,30) AS ok",[lease.outbox_id,workerA,lease.lease_generation]).then(r=>r.rows[0].ok),false);
 assert.equal(await asService("SELECT recovery_private.begin_recovery_outbox_send($1,$2,$3) AS ok",[lease.outbox_id,workerA,lease.lease_generation]).then(r=>r.rows[0].ok),false);
 assert.equal(await asService("SELECT recovery_private.begin_recovery_outbox_send($1,$2,$3) AS ok",[lease.outbox_id,workerB,newer.lease_generation]).then(r=>r.rows[0].ok),true);
 const attempting=await pool.query("SELECT delivery_outcome FROM public.trainee_password_recovery_requests WHERE id=$1",[lease.recovery_request_id]);
 assert.equal(attempting.rows[0].delivery_outcome,'attempting','send-start and request state must commit atomically');
 assert.equal(await asService("SELECT recovery_private.finish_recovery_outbox($1,$2,$3,'sent','stale-id',NULL) AS ok",[lease.outbox_id,workerA,lease.lease_generation]).then(r=>r.rows[0].ok),false);
 console.log('PASS: lease generation fences stale heartbeat, send-start, and completion');
 // Once send-start is durable, an expired lease must not be claimed by another worker.
 await pool.query("UPDATE public.trainee_password_recovery_outbox SET locked_until=now()-interval '1 second' WHERE id=$1",[lease.outbox_id]);
 assert.equal(await asService("SELECT recovery_private.finish_recovery_outbox($1,$2,$3,'sent','late-before-reconcile',NULL) AS ok",[lease.outbox_id,workerB,newer.lease_generation]).then(r=>r.rows[0].ok),false,'expired lease owner cannot finalize even before reconciliation');
 const blocked=await asService("SELECT * FROM recovery_private.claim_recovery_outbox($1,30)",[workerA]);
 assert.equal(blocked.rowCount,0,'send-started message must not be automatically re-claimed');
 const reconciled=await asService("SELECT recovery_private.reconcile_expired_recovery_outbox() AS n");
 assert.ok(Number(reconciled.rows[0].n)>=1);
 const row=await pool.query("SELECT status,attempt_count,lease_generation FROM public.trainee_password_recovery_outbox WHERE id=$1",[lease.outbox_id]);
 assert.equal(row.rows[0].status,'unknown');
 assert.equal(row.rows[0].attempt_count,1);
 const requestUnknown=await pool.query("SELECT delivery_outcome FROM public.trainee_password_recovery_requests WHERE id=$1",[lease.recovery_request_id]);
 assert.equal(requestUnknown.rows[0].delivery_outcome,'unknown','expired send lease must reconcile both records to unknown');
 assert.equal(await asService("SELECT recovery_private.finish_recovery_outbox($1,$2,$3,'sent','late',NULL) AS ok",[lease.outbox_id,workerB,newer.lease_generation]).then(r=>r.rows[0].ok),false);
 console.log('PASS: expired lease after durable send-start becomes unknown; no second claim or stale finalization');
 // Create the second approved request only now, so the concurrent claim race above
 // has exactly one eligible Outbox row (two workers competing for that same row).
 const secondRequest='30000000-0000-4000-8000-000000000006';
 await pool.query(`INSERT INTO public.trainees(id,coach_user_id,auth_user_id,approval_status,phone_normalized)
   VALUES ('20000000-0000-4000-8000-000000000007',$1,'10000000-0000-4000-8000-000000000003','active','+989123450002')`,[coach]);
 await pool.query(`INSERT INTO public.trainee_password_recovery_requests(id,trainee_id,phone_normalized,status)
   VALUES ($1,'20000000-0000-4000-8000-000000000007','+989123450002','pending')`,[secondRequest]);
 const secondApproval=await asService(
   'SELECT public.recovery_coach_review($1,$2,$3,$4,$5,$6) AS result',
   [secondRequest,coach,'approve','d'.repeat(64),new Date(Date.now()+10*60_000).toISOString(),'k1']
 );
 assert.equal(secondApproval.rows[0].result.ok,true);
 const secondOutbox=await pool.query('SELECT id FROM public.trainee_password_recovery_outbox WHERE recovery_request_id=$1',[secondRequest]);
 assert.equal(secondOutbox.rows.length,1);
 const secondOutboxId=secondOutbox.rows[0].id;
 // Non-service roles cannot execute privileged RPCs or read the table.
 const acl=await pool.query(`SELECT
   has_function_privilege('anon','recovery_private.claim_recovery_outbox(uuid,integer)','EXECUTE') AS anon_private_claim,
   has_function_privilege('authenticated','recovery_private.finish_recovery_outbox(uuid,uuid,bigint,text,text,text)','EXECUTE') AS auth_private_finish,
   has_function_privilege('anon','public.recovery_outbox_claim(uuid,integer)','EXECUTE') AS anon_public_claim,
   has_function_privilege('authenticated','public.recovery_outbox_finish(uuid,uuid,bigint,text,text,text)','EXECUTE') AS auth_public_finish,
   has_function_privilege('service_role','public.recovery_outbox_claim(uuid,integer)','EXECUTE') AS service_public_claim,
   has_table_privilege('anon','public.trainee_password_recovery_outbox','SELECT') AS anon_read,
   has_table_privilege('service_role','public.trainee_password_recovery_outbox','INSERT') AS service_direct_insert`);
 assert.deepEqual(acl.rows[0],{
   anon_private_claim:false,auth_private_finish:false,anon_public_claim:false,
   auth_public_finish:false,service_public_claim:true,anon_read:false,service_direct_insert:false
 });
 console.log('PASS: anonymous/authenticated roles cannot execute worker RPCs or read Outbox');
 // Add a second independent pending item only after the first item has been fenced and reconciled.
 // Second synthetic item: heartbeat extends a live lease and accepted send finalizes once.
 const live=await asService("SELECT * FROM recovery_private.claim_recovery_outbox($1,30)",[workerA]);
 assert.equal(live.rowCount,1);
 const l=live.rows[0];
 assert.equal(l.outbox_id,secondOutboxId,'the second approved request must supply the next pending Outbox item');
 assert.equal(await asService("SELECT recovery_private.heartbeat_recovery_outbox($1,$2,$3,45) AS ok",[l.outbox_id,workerA,l.lease_generation]).then(r=>r.rows[0].ok),true);
 assert.equal(await asService("SELECT recovery_private.begin_recovery_outbox_send($1,$2,$3) AS ok",[l.outbox_id,workerA,l.lease_generation]).then(r=>r.rows[0].ok),true);
 assert.equal(await asService("SELECT recovery_private.finish_recovery_outbox($1,$2,$3,'sent','mock-provider-id',NULL) AS ok",[l.outbox_id,workerA,l.lease_generation]).then(r=>r.rows[0].ok),true);
 assert.equal(await asService("SELECT recovery_private.finish_recovery_outbox($1,$2,$3,'sent','duplicate',NULL) AS ok",[l.outbox_id,workerA,l.lease_generation]).then(r=>r.rows[0].ok),false);
 const delivered=await pool.query("SELECT delivery_outcome,status FROM public.trainee_password_recovery_requests WHERE id=$1",[secondRequest]);
 assert.equal(delivered.rows[0].delivery_outcome,'sent');
 assert.equal(delivered.rows[0].status,'approved');
 const outboxSent=await pool.query("SELECT status FROM public.trainee_password_recovery_outbox WHERE id=$1",[l.outbox_id]);
 assert.equal(outboxSent.rows[0].status,'sent');
 console.log('PASS: live lease heartbeat and atomic one-time successful completion');

 // Reuse the synthetic fixture with a fresh operation to exercise definite failure
 // and ambiguous provider outcome without creating another auth identity.
 await pool.query(`UPDATE public.trainee_password_recovery_requests
   SET status='pending',delivery_outcome=NULL,delivery_operation_id=NULL,
       token_hash=NULL,token_expires_at=NULL,reviewed_at=NULL,reviewed_by=NULL,
       token_attempts=0,updated_at=now() WHERE id=$1`,[secondRequest]);
 const failApproval=await asService(
   'SELECT public.recovery_coach_review($1,$2,$3,$4,$5,$6) AS result',
   [secondRequest,coach,'approve','e'.repeat(64),new Date(Date.now()+10*60_000).toISOString(),'k1']
 );
 assert.equal(failApproval.rows[0].result.ok,true);
 const failLease=await asService("SELECT * FROM recovery_private.claim_recovery_outbox($1,30)",[workerA]);
 assert.equal(failLease.rowCount,1);
 const fl=failLease.rows[0];
 assert.equal(await asService("SELECT recovery_private.begin_recovery_outbox_send($1,$2,$3) AS ok",[fl.outbox_id,workerA,fl.lease_generation]).then(r=>r.rows[0].ok),true);
 assert.equal(await asService("SELECT recovery_private.finish_recovery_outbox($1,$2,$3,'failed',NULL,'provider_rejected') AS ok",[fl.outbox_id,workerA,fl.lease_generation]).then(r=>r.rows[0].ok),true);
 const failedRequest=await pool.query("SELECT status,delivery_outcome,token_hash,token_expires_at FROM public.trainee_password_recovery_requests WHERE id=$1",[secondRequest]);
 assert.equal(failedRequest.rows[0].status,'pending');
 assert.equal(failedRequest.rows[0].delivery_outcome,'confirmed_failure');
 assert.equal(failedRequest.rows[0].token_hash,null);
 assert.equal(failedRequest.rows[0].token_expires_at,null);
 const failedOutbox=await pool.query("SELECT status,last_safe_error_code FROM public.trainee_password_recovery_outbox WHERE id=$1",[fl.outbox_id]);
 assert.equal(failedOutbox.rows[0].status,'failed');
 assert.equal(failedOutbox.rows[0].last_safe_error_code,'provider_rejected');
 console.log('PASS: definite delivery failure atomically clears token and returns request for coach review');

 // A fresh approval operation can be attempted; ambiguous delivery must remain unknown.
 const unknownApproval=await asService(
   'SELECT public.recovery_coach_review($1,$2,$3,$4,$5,$6) AS result',
   [secondRequest,coach,'approve','f'.repeat(64),new Date(Date.now()+10*60_000).toISOString(),'k1']
 );
 assert.equal(unknownApproval.rows[0].result.ok,true);
 const unknownLease=await asService("SELECT * FROM recovery_private.claim_recovery_outbox($1,30)",[workerB]);
 assert.equal(unknownLease.rowCount,1);
 const ul=unknownLease.rows[0];
 assert.equal(await asService("SELECT recovery_private.begin_recovery_outbox_send($1,$2,$3) AS ok",[ul.outbox_id,workerB,ul.lease_generation]).then(r=>r.rows[0].ok),true);
 assert.equal(await asService("SELECT recovery_private.finish_recovery_outbox($1,$2,$3,'unknown',NULL,'provider_timeout') AS ok",[ul.outbox_id,workerB,ul.lease_generation]).then(r=>r.rows[0].ok),true);
 const ambiguousRequest=await pool.query("SELECT status,delivery_outcome FROM public.trainee_password_recovery_requests WHERE id=$1",[secondRequest]);
 assert.equal(ambiguousRequest.rows[0].status,'approved');
 assert.equal(ambiguousRequest.rows[0].delivery_outcome,'unknown');
 const ambiguousOutbox=await pool.query("SELECT status FROM public.trainee_password_recovery_outbox WHERE id=$1",[ul.outbox_id]);
 assert.equal(ambiguousOutbox.rows[0].status,'unknown');
 assert.equal((await asService("SELECT * FROM recovery_private.claim_recovery_outbox($1,30)",[workerA])).rowCount,0,
   'ambiguous provider result must never be automatically resent');
 console.log('PASS: ambiguous delivery outcome stays unknown and is never automatically retried');
 console.log('All disposable PostgreSQL Outbox/Worker integration checks passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>pool.end());
