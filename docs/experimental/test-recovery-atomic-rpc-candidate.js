'use strict';
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
const req1='30000000-0000-4000-8000-000000000001';
const req2='30000000-0000-4000-8000-000000000002';
const req3='30000000-0000-4000-8000-000000000003';
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
    DROP TABLE IF EXISTS public.trainee_password_recovery_requests CASCADE;
    DROP TABLE IF EXISTS public.trainees CASCADE;
    DROP TABLE IF EXISTS public.profiles CASCADE;
    CREATE TABLE public.profiles(id uuid primary key, role text);
    CREATE TABLE public.trainees(
      id uuid primary key, coach_user_id uuid, auth_user_id uuid,
      approval_status text not null, phone_normalized text
    );
    CREATE TABLE public.trainee_password_recovery_requests(
      id uuid primary key, trainee_id uuid not null references public.trainees(id),
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
    VALUES ('20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000003',
      'active','+989123456789');
    INSERT INTO public.trainee_password_recovery_requests(id,trainee_id,phone_normalized,status)
    VALUES
      ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','+989123456789','pending'),
      ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','+989123456789','pending'),
      ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','+989123456789','pending');
  `);

  const migration=fs.readFileSync('docs/experimental/migrations/20261122_recovery_atomic_rpc_candidate.sql','utf8');
  await pool.query(migration);

  const acl=await pool.query(`
    SELECT
      has_schema_privilege('service_role','recovery_private','USAGE') AS service_usage,
      has_schema_privilege('anon','recovery_private','USAGE') AS anon_usage,
      has_function_privilege('service_role','recovery_private.claim_recovery_reset(uuid,text,uuid)','EXECUTE') AS service_execute,
      has_function_privilege('anon','recovery_private.claim_recovery_reset(uuid,text,uuid)','EXECUTE') AS anon_execute
  `);
  assert.deepEqual(acl.rows[0],{service_usage:true,anon_usage:false,service_execute:true,anon_execute:false});
  console.log('PASS: recovery RPC schema and execute privileges are restricted to service_role');

  let r=await callAsService(
    'SELECT recovery_private.coach_review_recovery_request($1,$2,$3,$4,$5,$6) AS result',
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
    await reassign.query('UPDATE public.trainees SET coach_user_id=$1 WHERE id=$2',[coach2,trainee]);
    const pending=callAsService(
      'SELECT recovery_private.coach_review_recovery_request($1,$2,$3,$4,$5,$6) AS result',
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
    'SELECT recovery_private.coach_review_recovery_request($1,$2,$3,$4,$5,$6) AS result',
    [req2,coach2,'approve',digest,new Date(Date.now()+15*60_000).toISOString(),'k1']
  );
  assert.equal(r.rows[0].result.ok,true);
  assert.equal(r.rows[0].result.phone_normalized,'+989123456789');

  const attempts=await Promise.all(Array.from({length:9},()=>callAsService(
    'SELECT recovery_private.record_recovery_wrong_attempt($1,$2,5) AS result',[req2,digest2]
  )));
  assert.equal(attempts.filter(x=>x.rows[0].result.incremented).length,5);
  state=await pool.query('SELECT status,token_attempts,token_hash,token_expires_at FROM public.trainee_password_recovery_requests WHERE id=$1',[req2]);
  assert.equal(state.rows[0].status,'expired');
  assert.equal(state.rows[0].token_attempts,5);
  assert.equal(state.rows[0].token_hash,null);
  assert.equal(state.rows[0].token_expires_at,null);
  console.log('PASS: concurrent wrong-code attempts stop atomically at five and expire the token');

  // Approve the third request and verify only one simultaneous claim wins.
  r=await callAsService(
    'SELECT recovery_private.coach_review_recovery_request($1,$2,$3,$4,$5,$6) AS result',
    [req3,coach2,'approve',digest,new Date(Date.now()+15*60_000).toISOString(),'k1']
  );
  assert.equal(r.rows[0].result.ok,true);
  const opA='40000000-0000-4000-8000-000000000001';
  const opB='40000000-0000-4000-8000-000000000002';
  const claims=await Promise.all([opA,opB].map(op=>callAsService(
    'SELECT recovery_private.claim_recovery_reset($1,$2,$3) AS result',[req3,digest,op]
  )));
  assert.equal(claims.filter(x=>x.rows[0].result.claimed).length,1);
  const winner=claims.find(x=>x.rows[0].result.claimed).rows[0].result;
  assert.equal(winner.auth_user_id,'10000000-0000-4000-8000-000000000003');
  await assert.rejects(
    pool.query(`INSERT INTO public.trainee_password_recovery_requests(id,trainee_id,phone_normalized,status)
      VALUES ('30000000-0000-4000-8000-000000000004',$1,'+989123456789','pending')`,[trainee]),
    e=>e && e.code==='23505'
  );
  console.log('PASS: one reset claim wins; processing remains covered by the active-request unique index');

  r=await callAsService(
    'SELECT recovery_private.begin_recovery_auth_update($1,$2) AS started',[req3,winner.operation_id]
  );
  assert.equal(r.rows[0].started,true);
  r=await callAsService(
    'SELECT recovery_private.begin_recovery_auth_update($1,$2) AS started',[req3,winner.operation_id]
  );
  assert.equal(r.rows[0].started,false);

  r=await callAsService(
    'SELECT recovery_private.finish_recovery_auth_update($1,$2,$3,$4) AS changed',
    [req3,winner.operation_id,'unknown','network_timeout']
  );
  assert.equal(r.rows[0].changed,true);
  state=await pool.query('SELECT status,auth_outcome FROM public.trainee_password_recovery_requests WHERE id=$1',[req3]);
  assert.deepEqual(state.rows[0],{status:'processing',auth_outcome:'unknown'});

  // Only an authoritative reconciliation result may unlock the ambiguous operation.
  r=await callAsService(
    'SELECT recovery_private.finish_recovery_auth_update($1,$2,$3,$4) AS changed',
    [req3,winner.operation_id,'confirmed_no_change','auth_confirmed_unchanged']
  );
  assert.equal(r.rows[0].changed,true);
  state=await pool.query('SELECT status,auth_outcome FROM public.trainee_password_recovery_requests WHERE id=$1',[req3]);
  assert.deepEqual(state.rows[0],{status:'approved',auth_outcome:'confirmed_no_change'});

  const opC='40000000-0000-4000-8000-000000000003';
  r=await callAsService('SELECT recovery_private.claim_recovery_reset($1,$2,$3) AS result',[req3,digest,opC]);
  assert.equal(r.rows[0].result.claimed,true);
  await callAsService('SELECT recovery_private.begin_recovery_auth_update($1,$2)',[req3,opC]);
  r=await callAsService(
    'SELECT recovery_private.finish_recovery_auth_update($1,$2,$3,$4) AS changed',
    [req3,opC,'completed',null]
  );
  assert.equal(r.rows[0].changed,true);
  state=await pool.query('SELECT status,token_hash,token_expires_at,auth_outcome FROM public.trainee_password_recovery_requests WHERE id=$1',[req3]);
  assert.deepEqual(state.rows[0],{status:'completed',token_hash:null,token_expires_at:null,auth_outcome:'completed'});
  console.log('PASS: Auth ambiguity remains locked; authoritative no-change can reopen; confirmed success consumes code');

  // Null decisions and invalid Auth outcomes must not silently fall through.
  const nullDecision=await callAsService(
    'SELECT recovery_private.coach_review_recovery_request($1,$2,$3,$4,$5,$6) AS result',
    [req1,coach2,null,digest,new Date(Date.now()+15*60_000).toISOString(),'k1']
  );
  assert.equal(nullDecision.rows[0].result.ok,false);
  await assert.rejects(callAsService(
    'SELECT recovery_private.finish_recovery_auth_update($1,$2,$3,$4)',
    [req3,opC,null,null]
  ));
  console.log('PASS: null/invalid state transitions fail closed');

  console.log('All candidate atomic recovery RPC tests passed on disposable PostgreSQL.');
}

main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>pool.end());
