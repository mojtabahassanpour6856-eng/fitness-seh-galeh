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
 await pool.query(migration);
 const requests=await pool.query("SELECT id FROM public.trainee_password_recovery_requests ORDER BY id LIMIT 2");
 assert.equal(requests.rows.length,2,'requires two synthetic recovery request fixtures from preceding disposable CI job');
 const [reqA,reqB]=requests.rows.map(x=>x.id);
 const ids=['60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000002'];
 await pool.query("INSERT INTO public.trainee_password_recovery_outbox(id,recovery_request_id,provider_idempotency_key) VALUES ($1,$2,$3)",
 [ids[0],reqA,'recovery-outbox:'+ids[0]]);
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
 assert.equal(await asService("SELECT recovery_private.finish_recovery_outbox($1,$2,$3,'sent','stale-id',NULL) AS ok",[lease.outbox_id,workerA,lease.lease_generation]).then(r=>r.rows[0].ok),false);
 console.log('PASS: lease generation fences stale heartbeat, send-start, and completion');
 // Once send-start is durable, an expired lease must not be claimed by another worker.
 await pool.query("UPDATE public.trainee_password_recovery_outbox SET locked_until=now()-interval '1 second' WHERE id=$1",[lease.outbox_id]);
 const blocked=await asService("SELECT * FROM recovery_private.claim_recovery_outbox($1,30)",[workerA]);
 assert.equal(blocked.rowCount,0,'send-started message must not be automatically re-claimed');
 const reconciled=await asService("SELECT recovery_private.reconcile_expired_recovery_outbox() AS n");
 assert.ok(Number(reconciled.rows[0].n)>=1);
 const row=await pool.query("SELECT status,attempt_count,lease_generation FROM public.trainee_password_recovery_outbox WHERE id=$1",[lease.outbox_id]);
 assert.equal(row.rows[0].status,'unknown');
 assert.equal(row.rows[0].attempt_count,1);
 assert.equal(await asService("SELECT recovery_private.finish_recovery_outbox($1,$2,$3,'sent','late',NULL) AS ok",[lease.outbox_id,workerB,newer.lease_generation]).then(r=>r.rows[0].ok),false);
 console.log('PASS: expired lease after durable send-start becomes unknown; no second claim or stale finalization');
 // Non-service roles cannot execute privileged RPCs or read the table.
 const acl=await pool.query("SELECT has_function_privilege('anon','recovery_private.claim_recovery_outbox(uuid,integer)','EXECUTE') AS anon_claim, has_function_privilege('authenticated','recovery_private.finish_recovery_outbox(uuid,uuid,bigint,text,text,text)','EXECUTE') AS auth_finish, has_table_privilege('anon','public.trainee_password_recovery_outbox','SELECT') AS anon_read");
 assert.deepEqual(acl.rows[0],{anon_claim:false,auth_finish:false,anon_read:false});
 console.log('PASS: anonymous/authenticated roles cannot execute worker RPCs or read Outbox');
 // Add a second independent pending item only after the first item has been fenced and reconciled.
 await pool.query("INSERT INTO public.trainee_password_recovery_outbox(id,recovery_request_id,provider_idempotency_key) VALUES ($1,$2,$3)",
 [ids[1],reqB,'recovery-outbox:'+ids[1]]);
 // Second synthetic item: heartbeat extends a live lease and accepted send finalizes once.
 const live=await asService("SELECT * FROM recovery_private.claim_recovery_outbox($1,30)",[workerA]);
 assert.equal(live.rowCount,1);
 const l=live.rows[0];
 assert.equal(await asService("SELECT recovery_private.heartbeat_recovery_outbox($1,$2,$3,45) AS ok",[l.outbox_id,workerA,l.lease_generation]).then(r=>r.rows[0].ok),true);
 assert.equal(await asService("SELECT recovery_private.begin_recovery_outbox_send($1,$2,$3) AS ok",[l.outbox_id,workerA,l.lease_generation]).then(r=>r.rows[0].ok),true);
 assert.equal(await asService("SELECT recovery_private.finish_recovery_outbox($1,$2,$3,'sent','mock-provider-id',NULL) AS ok",[l.outbox_id,workerA,l.lease_generation]).then(r=>r.rows[0].ok),true);
 assert.equal(await asService("SELECT recovery_private.finish_recovery_outbox($1,$2,$3,'sent','duplicate',NULL) AS ok",[l.outbox_id,workerA,l.lease_generation]).then(r=>r.rows[0].ok),false);
 console.log('PASS: live lease heartbeat and one-time successful completion');
 console.log('All disposable PostgreSQL Outbox/Worker integration checks passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>pool.end());
