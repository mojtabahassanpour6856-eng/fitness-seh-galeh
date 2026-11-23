'use strict';
// Disposable PostgreSQL CI only: verifies request RPC grants, atomic submission, migration preflight, delivery and Auth states.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'postgres',
  max: 10,
});
const coach1='10000000-0000-4000-8000-000000000001';
const coach2='10000000-0000-4000-8000-000000000002';
const trainee='20000000-0000-4000-8000-000000000001';
const trainee2='20000000-0000-4000-8000-000000000002';
const trainee3='20000000-0000-4000-8000-000000000003';
const trainee4='20000000-0000-4000-8000-000000000004';
const trainee5='20000000-0000-4000-8000-000000000005';
const trainee6='20000000-0000-4000-8000-000000000006';
const req1='30000000-0000-4000-8000-000000000001';
const req2='30000000-0000-4000-8000-000000000002';
const req3='30000000-0000-4000-8000-000000000003';
const req4='30000000-0000-4000-8000-000000000004';
const req5='30000000-0000-4000-8000-000000000005';
const digest='a'.repeat(64);
const digest2='b'.repeat(64);

async function callAsService(sql, params) {
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE service_role');
    const r=await c.query(sql,params);
    await c.query('COMMIT');
    return r;
  } catch(e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); }
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function main() {
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $$;
    DROP SCHEMA IF EXISTS recovery_private CASCADE;
    DROP FUNCTION IF EXISTS public.consume_registration_rate_limit(text,integer,integer);
    CREATE FUNCTION public.consume_registration_rate_limit(
      p_key_hash text, p_window_seconds integer DEFAULT 3600, p_max_requests integer DEFAULT 5
    ) RETURNS boolean LANGUAGE sql AS 'SELECT false';
    DROP TABLE IF EXISTS public.trainee_password_recovery_requests CASCADE;
    DROP TABLE IF EXISTS public.trainees CASCADE;
    DROP TABLE IF EXISTS public.profiles CASCADE;
    CREATE TABLE public.profiles(id uuid primary key, role text);
    CREATE TABLE public.trainees(
      id uuid primary key, coach_user_id uuid, auth_user_id uuid,
      approval_status text not null, phone_normalized text, archived_at timestamptz
    );
    CREATE TABLE public.trainee_password_recovery_requests(
      id uuid primary key DEFAULT gen_random_uuid(), trainee_id uuid not null references public.trainees(id),
      phone_normalized text not null, status text not null,
      requested_at timestamptz not null default now(),
      reviewed_at timestamptz, reviewed_by uuid references public.profiles(id),
      token_hash text, token_expires_at timestamptz,
      token_attempts smallint not null default 0,
      completed_at timestamptz, updated_at timestamptz not null default now(),
      CONSTRAINT recovery_state_check CHECK (
        ((status IN ('pending','rejected')) AND token_hash IS NULL AND token_expires_at IS NULL)
        OR ((status IN ('approved','processing')) AND token_hash IS NOT NULL AND token_expires_at IS NOT NULL)
        OR status IN ('completed','expired')
      ),
      CONSTRAINT recovery_attempts_check CHECK (token_attempts BETWEEN 0 AND 10),
      CONSTRAINT recovery_status_check CHECK (status IN ('pending','approved','processing','rejected','completed','expired'))
    );
    CREATE UNIQUE INDEX trainee_password_recovery_one_open_request_per_trainee
      ON public.trainee_password_recovery_requests(trainee_id)
      WHERE status IN ('pending','approved');
    INSERT INTO public.profiles(id,role) VALUES
      ('10000000-0000-4000-8000-000000000001','coach'),
      ('10000000-0000-4000-8000-000000000002','coach'),
      ('10000000-0000-4000-8000-000000000003','trainee');
    INSERT INTO public.trainees(id,coach_user_id,auth_user_id,approval_status,phone_normalized)
    VALUES
      ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','active','+989123456789'),
      ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','active','+989123456789'),
      ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','active','+989123456789'),
      ('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','active','+989123456789'),
      ('20000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','active','+989123450000'),
       ('20000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','active','+989123450001');
    INSERT INTO public.trainee_password_recovery_requests(id,trainee_id,phone_normalized,status)
    VALUES
      ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','+989123456789','pending'),
      ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','+989123456789','pending'),
      ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','+989123456789','pending');
    INSERT INTO public.trainee_password_recovery_requests(id,trainee_id,phone_normalized,status,token_hash,token_expires_at)
    VALUES ('30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000004','+989123456789','approved',repeat('a',64),now()+interval '15 minutes');
    INSERT INTO public.trainee_password_recovery_requests(id,trainee_id,phone_normalized,status)
    VALUES ('30000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000006','+989123450001','pending');
  `);

  const migration=fs.readFileSync('docs/experimental/migrations/20261122_recovery_atomic_rpc_candidate.sql','utf8');
  const preflightClient=await pool.connect();
  try {
    await preflightClient.query(migration);
    assert.fail('candidate migration must refuse a legacy approved request');
  } catch(e) {
    assert.match(e.message,/Legacy approved\/processing requests/);
    await preflightClient.query('ROLLBACK');
  } finally { preflightClient.release(); }
  await pool.query('DELETE FROM public.trainee_password_recovery_requests WHERE id=$1',[req4]);
  await pool.query(migration);
  console.log('PASS: candidate migration refuses to silently strand legacy approved/processing requests');

  const registrationLimiter=await pool.query(`
    SELECT pg_get_functiondef('public.consume_registration_rate_limit(text,integer,integer)'::regprocedure) AS definition
  `);
  assert.match(registrationLimiter.rows[0].definition,/SELECT false/,
    'recovery migration must preserve the pre-existing registration rate limiter');
  assert.doesNotMatch(registrationLimiter.rows[0].definition,/recovery_private/,
    'registration limiter must not be rebound to recovery state');
  console.log('PASS: recovery migration leaves the existing registration limiter unchanged');

  const acl=await pool.query(`
    SELECT
      has_schema_privilege('service_role','recovery_private','USAGE') AS service_usage,
      has_schema_privilege('anon','recovery_private','USAGE') AS anon_usage,
      has_function_privilege('service_role','public.recovery_claim_reset(uuid,text,uuid)','EXECUTE') AS service_execute,
      has_function_privilege('anon','public.recovery_claim_reset(uuid,text,uuid)','EXECUTE') AS anon_execute,
      has_function_privilege('service_role','public.recovery_submit_request(text)','EXECUTE') AS service_request_execute,
      has_function_privilege('anon','public.recovery_submit_request(text)','EXECUTE') AS anon_request_execute,
      has_function_privilege('service_role','public.recovery_submit_request(text)','EXECUTE') AS public_service_request_execute,
      has_function_privilege('anon','public.recovery_coach_review(uuid,uuid,text,text,timestamptz,text)','EXECUTE') AS anon_public_review_execute,
       has_function_privilege('service_role','public.recovery_consume_request_rate_limit(text,integer,integer)','EXECUTE') AS service_rate_execute,
       has_function_privilege('anon','public.recovery_consume_request_rate_limit(text,integer,integer)','EXECUTE') AS anon_rate_execute
  `);
  assert.deepEqual(acl.rows[0],{service_usage:true,anon_usage:false,service_execute:true,anon_execute:false,service_request_execute:true,anon_request_execute:false,public_service_request_execute:true,anon_public_review_execute:false,service_rate_execute:true,anon_rate_execute:false});
  console.log('PASS: recovery RPC schema and execute privileges are restricted to service_role');

  const rateKey='a'.repeat(64);
  const rateOne=await callAsService('SELECT public.recovery_consume_request_rate_limit($1,3600,2) AS allowed',[rateKey]);
  const rateTwo=await callAsService('SELECT public.recovery_consume_request_rate_limit($1,3600,2) AS allowed',[rateKey]);
  const rateThree=await callAsService('SELECT public.recovery_consume_request_rate_limit($1,3600,2) AS allowed',[rateKey]);
  assert.equal(rateOne.rows[0].allowed,true);
  assert.equal(rateTwo.rows[0].allowed,true);
  assert.equal(rateThree.rows[0].allowed,false,'third request must be blocked within the fixed window');
  const badRate=await callAsService('SELECT public.recovery_consume_request_rate_limit($1,3600,2) AS allowed',['not-a-hash']);
  assert.equal(badRate.rows[0].allowed,false,'malformed pseudonymous key must fail closed');
  const anonClient=await pool.connect();
  try {
    await anonClient.query('SET ROLE anon');
    await assert.rejects(anonClient.query('SELECT public.recovery_consume_request_rate_limit($1,3600,2)',[rateKey]),/permission denied/);
  } finally {
    await anonClient.query('RESET ROLE');
    anonClient.release();
  }
  const concurrentRate=await Promise.all(Array.from({length:10},()=>callAsService(
    'SELECT public.recovery_consume_request_rate_limit($1,3600,3) AS allowed',['b'.repeat(64)]
  )));
  assert.equal(concurrentRate.filter(x=>x.rows[0].allowed===true).length,3,
    'concurrent requests must atomically admit exactly the configured maximum');
  await pool.query("UPDATE recovery_private.recovery_request_rate_limits SET window_started_at=now()-interval '2 seconds' WHERE key_hash=$1",['a'.repeat(64)]);
  const afterWindow=await callAsService('SELECT public.recovery_consume_request_rate_limit($1,1,2) AS allowed',['a'.repeat(64)]);
  assert.equal(afterWindow.rows[0].allowed,true,'expired fixed window must reset the counter');
  const serviceTableClient=await pool.connect();
  try {
    await serviceTableClient.query('SET ROLE service_role');
    await assert.rejects(serviceTableClient.query('SELECT * FROM recovery_private.recovery_request_rate_limits'),/permission denied/);
  } finally {
    await serviceTableClient.query('RESET ROLE');
    serviceTableClient.release();
  }
  console.log('PASS: atomic fixed-window rate limiter enforces cap, validates hashed keys, and is service-role-only');


  let r;
  const submits=await Promise.all(Array.from({length:8},()=>callAsService(
    'SELECT public.recovery_submit_request($1) AS inserted',['+989123450000']
  )));
  assert.equal(submits.filter(x=>x.rows[0].inserted===true).length,1);
  let submitted=await pool.query("SELECT count(*)::int AS n FROM public.trainee_password_recovery_requests WHERE trainee_id=$1 AND status='pending'",[trainee5]);
  assert.equal(submitted.rows[0].n,1);
  r=await callAsService('SELECT public.recovery_submit_request($1) AS inserted',['+989123456789']);
  assert.equal(r.rows[0].inserted,false,'ambiguous duplicate phone records must not select an account');
  r=await callAsService('SELECT public.recovery_submit_request($1) AS inserted',['+989999999999']);
  assert.equal(r.rows[0].inserted,false,'unknown phone must not create a request');
  console.log('PASS: concurrent request submissions create one row; ambiguous/unknown phones create none');

  r=await callAsService(
    'SELECT public.recovery_coach_review($1,$2,$3,$4,$5,$6) AS result',
    [req1,coach2,'approve',digest,new Date(Date.now()+15*60_000).toISOString(),'k1']
  );
  assert.equal(r.rows[0].result.ok,false);
  assert.equal(r.rows[0].result.reason,'not_authorized');
  let state=await pool.query('SELECT status FROM public.trainee_password_recovery_requests WHERE id=$1',[req1]);
  assert.equal(state.rows[0].status,'pending');

  // Race: old coach attempts approval while another transaction reassigns the trainee.
  const reassign=await pool.connect();
  try {
    await reassign.query('BEGIN');
    await reassign.query('UPDATE public.trainees SET coach_user_id=$1 WHERE id=$2',[coach2,trainee2]);
    const pending=callAsService(
      'SELECT public.recovery_coach_review($1,$2,$3,$4,$5,$6) AS result',
      [req2,coach1,'approve',digest,new Date(Date.now()+15*60_000).toISOString(),'k1']
    );
    await pause(120);
    await reassign.query('COMMIT');
    r=await pending;
    assert.equal(r.rows[0].result.ok,false);
    assert.equal(r.rows[0].result.reason,'not_authorized');
  } finally { try { await reassign.query('ROLLBACK'); } catch {} reassign.release(); }
  console.log('PASS: reassignment wins the row-lock race; former coach cannot approve');

  r=await callAsService(
    'SELECT public.recovery_coach_review($1,$2,$3,$4,$5,$6) AS result',
    [req2,coach2,'approve',digest,new Date(Date.now()+15*60_000).toISOString(),'k1']
  );
  assert.equal(r.rows[0].result.ok,true);
  assert.equal(r.rows[0].result.status,'approved');
  assert.equal(Object.hasOwn(r.rows[0].result,'phone_normalized'),false);
  const deliveryOp2=r.rows[0].result.delivery_operation_id;
  r=await callAsService('SELECT public.recovery_begin_delivery($1,$2) AS started',[req2,deliveryOp2]);
  assert.equal(r.rows[0].started,true);
  r=await callAsService('SELECT public.recovery_finish_delivery($1,$2,$3) AS changed',[req2,deliveryOp2,'sent']);
  assert.equal(r.rows[0].changed,true);

  const attempts=await Promise.all(Array.from({length:9},()=>callAsService(
    'SELECT public.recovery_record_wrong_attempt($1,$2) AS result',[req2,digest2]
  )));
  assert.equal(attempts.filter(x=>x.rows[0].result.incremented).length,5);

  // The RPC has no caller-controlled maximum-attempt parameter: an attempted
  // third argument must fail at function resolution, not alter the SQL policy.
  await assert.rejects(callAsService(
    'SELECT public.recovery_record_wrong_attempt($1,$2,$3) AS result',[req2,digest2,1]
  ), /does not exist/i);

  // A sixth wrong attempt must be rejected without incrementing or changing state.
  r=await callAsService(
    'SELECT public.recovery_record_wrong_attempt($1,$2) AS result',[req2,digest2]
  );
  assert.equal(r.rows[0].result.incremented,false,'sixth wrong attempt must be rejected');
  state=await pool.query('SELECT status,token_attempts,token_hash,token_expires_at FROM public.trainee_password_recovery_requests WHERE id=$1',[req2]);
  assert.equal(state.rows[0].status,'expired');
  assert.equal(state.rows[0].token_attempts,5);
  assert.equal(state.rows[0].token_hash,null);
  assert.equal(state.rows[0].token_expires_at,null);
  console.log('PASS: concurrent wrong-code attempts stop atomically at five and expire the token');

  // Approve the third request and verify only one simultaneous claim wins.
  r=await callAsService(
    'SELECT public.recovery_coach_review($1,$2,$3,$4,$5,$6) AS result',
    [req3,coach2,'approve',digest,new Date(Date.now()+15*60_000).toISOString(),'k1']
  );
  assert.equal(r.rows[0].result.ok,true);
  const deliveryOp3=r.rows[0].result.delivery_operation_id;
  r=await callAsService('SELECT public.recovery_begin_delivery($1,$2) AS started',[req3,deliveryOp3]);
  assert.equal(r.rows[0].started,true);
  r=await callAsService('SELECT public.recovery_begin_delivery($1,$2) AS started',[req3,deliveryOp3]);
  assert.equal(r.rows[0].started,false);
  // A distinct request proves an unknown delivery cannot be overwritten by a retry.
  await pool.query(`INSERT INTO public.trainee_password_recovery_requests(id,trainee_id,phone_normalized,status)
    VALUES ($1,$2,'+989123456789','pending')`,[req4,trainee4]);
  r=await callAsService(
    'SELECT public.recovery_coach_review($1,$2,$3,$4,$5,$6) AS result',
    [req4,coach2,'approve',digest,new Date(Date.now()+15*60_000).toISOString(),'k1']
  );
  assert.equal(r.rows[0].result.ok,true);
  const deliveryOp4=r.rows[0].result.delivery_operation_id;
  await callAsService('SELECT public.recovery_begin_delivery($1,$2)',[req4,deliveryOp4]);
  r=await callAsService('SELECT public.recovery_finish_delivery($1,$2,$3) AS changed',[req4,deliveryOp4,'unknown']);
  assert.equal(r.rows[0].changed,true);
  let blocked=await callAsService('SELECT public.recovery_claim_reset($1,$2,$3) AS result',[req4,digest,'40000000-0000-4000-8000-000000000009']);
  assert.equal(blocked.rows[0].result.claimed,false,'unknown SMS delivery must not permit code redemption');
  r=await callAsService('SELECT public.recovery_finish_delivery($1,$2,$3) AS changed',[req4,deliveryOp4,'sent']);
  assert.equal(r.rows[0].changed,false,'unknown delivery cannot be overwritten without a dedicated authoritative reconciliation path');
  r=await callAsService('SELECT public.recovery_finish_delivery($1,$2,$3) AS changed',[req3,deliveryOp3,'sent']);
  assert.equal(r.rows[0].changed,true,'confirmed provider acceptance should make the code redeemable');
  const opA='40000000-0000-4000-8000-000000000001';
  const opB='40000000-0000-4000-8000-000000000002';
  const claims=await Promise.all([opA,opB].map(op=>callAsService(
    'SELECT public.recovery_claim_reset($1,$2,$3) AS result',[req3,digest,op]
  )));
  assert.equal(claims.filter(x=>x.rows[0].result.claimed).length,1);
  const winner=claims.find(x=>x.rows[0].result.claimed).rows[0].result;
  assert.equal(winner.auth_user_id,'10000000-0000-4000-8000-000000000003');
  await assert.rejects(
    pool.query(`INSERT INTO public.trainee_password_recovery_requests(id,trainee_id,phone_normalized,status)
      VALUES ('30000000-0000-4000-8000-000000000004',$1,'+989123456789','pending')`,[trainee3]),
    e=>e && e.code==='23505'
  );
  console.log('PASS: delivery is single-attempt; unknown delivery blocks redemption until authoritative sent reconciliation');
  console.log('PASS: one reset claim wins; processing remains covered by the active-request unique index');

  r=await callAsService(
    'SELECT public.recovery_begin_auth_update($1,$2) AS started',[req3,winner.operation_id]
  );
  assert.equal(r.rows[0].started,true);
  r=await callAsService(
    'SELECT public.recovery_begin_auth_update($1,$2) AS started',[req3,winner.operation_id]
  );
  assert.equal(r.rows[0].started,false);

  r=await callAsService(
    'SELECT public.recovery_finish_auth_update($1,$2,$3,$4) AS changed',
    [req3,winner.operation_id,'unknown','network_timeout']
  );
  assert.equal(r.rows[0].changed,true);
  state=await pool.query('SELECT status,auth_outcome FROM public.trainee_password_recovery_requests WHERE id=$1',[req3]);
  assert.deepEqual(state.rows[0],{status:'processing',auth_outcome:'unknown'});

  // A second finish call cannot reinterpret an ambiguous Auth result as success/no-change.
  r=await callAsService(
    'SELECT public.recovery_finish_auth_update($1,$2,$3,$4) AS changed',
    [req3,winner.operation_id,'confirmed_no_change','auth_confirmed_unchanged']
  );
  assert.equal(r.rows[0].changed,false,'unknown Auth outcome must remain locked for out-of-band authoritative reconciliation');
  state=await pool.query('SELECT status,auth_outcome FROM public.trainee_password_recovery_requests WHERE id=$1',[req3]);
  assert.deepEqual(state.rows[0],{status:'processing',auth_outcome:'unknown'});
  console.log('PASS: unknown Auth outcome cannot be reopened by retry or ambiguous follow-up');

  const opC='40000000-0000-4000-8000-000000000003';
  const opD='40000000-0000-4000-8000-000000000004';
  // req1 was safely returned to pending after a provider-confirmed non-delivery.
  r=await callAsService(
    'SELECT public.recovery_coach_review($1,$2,$3,$4,$5,$6) AS result',
    [req1,coach1,'approve',digest,new Date(Date.now()+15*60_000).toISOString(),'k1']
  );
  assert.equal(r.rows[0].result.ok,true);
  const deliveryOp1b=r.rows[0].result.delivery_operation_id;
  await callAsService('SELECT public.recovery_begin_delivery($1,$2)',[req1,deliveryOp1b]);
  await callAsService('SELECT public.recovery_finish_delivery($1,$2,$3)',[req1,deliveryOp1b,'sent']);
  r=await callAsService('SELECT public.recovery_claim_reset($1,$2,$3) AS result',[req1,digest,opC]);
  assert.equal(r.rows[0].result.claimed,true);
  await callAsService('SELECT public.recovery_begin_auth_update($1,$2)',[req1,opC]);
  r=await callAsService(
    'SELECT public.recovery_finish_auth_update($1,$2,$3,$4) AS changed',
    [req1,opC,'confirmed_no_change','auth_confirmed_unchanged']
  );
  assert.equal(r.rows[0].changed,true);
  state=await pool.query('SELECT status,auth_outcome FROM public.trainee_password_recovery_requests WHERE id=$1',[req1]);
  assert.deepEqual(state.rows[0],{status:'approved',auth_outcome:'confirmed_no_change'});

  r=await callAsService('SELECT public.recovery_claim_reset($1,$2,$3) AS result',[req1,digest,opD]);
  assert.equal(r.rows[0].result.claimed,true);
  await callAsService('SELECT public.recovery_begin_auth_update($1,$2)',[req1,opD]);
  r=await callAsService(
    'SELECT public.recovery_finish_auth_update($1,$2,$3,$4) AS changed',
    [req1,opD,'completed',null]
  );
  assert.equal(r.rows[0].changed,true);
  state=await pool.query('SELECT status,token_hash,token_expires_at,auth_outcome FROM public.trainee_password_recovery_requests WHERE id=$1',[req1]);
  assert.deepEqual(state.rows[0],{status:'completed',token_hash:null,token_expires_at:null,auth_outcome:'completed'});
  const replay=await callAsService(
    'SELECT public.recovery_claim_reset($1,$2,$3) AS result',
    [req1,digest,'40000000-0000-4000-8000-000000000005']
  );
  assert.equal(replay.rows[0].result.claimed,false,
    'a successfully consumed recovery code must never be reusable');
  console.log('PASS: known no-change can reopen only from an active attempt; confirmed success consumes code and rejects replay');

  // A provider-confirmed non-delivery safely invalidates that code and returns to coach review.
  r=await callAsService('SELECT public.recovery_coach_review($1,$2,$3,$4,$5,$6) AS result',
    [req5,coach2,'approve',digest,new Date(Date.now()+15*60_000).toISOString(),'k1']);
  assert.equal(r.rows[0].result.ok,true);
  const deliveryOp1=r.rows[0].result.delivery_operation_id;
  await callAsService('SELECT public.recovery_begin_delivery($1,$2)',[req5,deliveryOp1]);
  r=await callAsService('SELECT public.recovery_finish_delivery($1,$2,$3) AS changed',[req5,deliveryOp1,'confirmed_failure']);
  assert.equal(r.rows[0].changed,true);
  state=await pool.query('SELECT status,token_hash,token_expires_at,delivery_outcome FROM public.trainee_password_recovery_requests WHERE id=$1',[req5]);
  assert.deepEqual(state.rows[0],{status:'pending',token_hash:null,token_expires_at:null,delivery_outcome:'confirmed_failure'});
  console.log('PASS: confirmed delivery failure clears code and returns request to pending safely');

  // Null decisions and invalid Auth outcomes must not silently fall through.
  const nullDecision=await callAsService(
    'SELECT public.recovery_coach_review($1,$2,$3,$4,$5,$6) AS result',
    [req1,coach1,null,digest,new Date(Date.now()+15*60_000).toISOString(),'k1']
  );
  assert.equal(nullDecision.rows[0].result.ok,false);
  await assert.rejects(callAsService(
    'SELECT public.recovery_finish_auth_update($1,$2,$3,$4)',
    [req3,opC,null,null]
  ));
  console.log('PASS: null/invalid state transitions fail closed');

  console.log('All candidate atomic recovery RPC tests passed on disposable PostgreSQL.');
}

main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>pool.end());
