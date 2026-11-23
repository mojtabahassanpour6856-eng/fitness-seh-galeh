import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'recovery_ci',
  max: 4,
});
const root = 'docs/experimental/migrations/';
const atomic = fs.readFileSync(root + '20261123_supabase_mirror_compatible_atomic_recovery_candidate.sql','utf8');
const outbox = fs.readFileSync(root + '20261122_recovery_outbox_worker_candidate.sql','utf8');
const encrypted = fs.readFileSync(root + '20261122_recovery_encrypted_delivery_payload_candidate.sql','utf8');
const coach='10000000-0000-4000-8000-000000000001';
const trainee='20000000-0000-4000-8000-000000000001';
const request='30000000-0000-4000-8000-000000000001';
const payload={v:1,alg:'A256GCM',kid:'key-v1',iv:'AAAAAAAAAAAAAAAA',ct:'AAAAAAAAAAAAAAAAAAAAAAAAAAA='};

async function setup(){
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $$;
    DROP SCHEMA IF EXISTS recovery_private CASCADE;
    DROP TABLE IF EXISTS public.trainee_password_recovery_outbox CASCADE;
    DROP TABLE IF EXISTS public.trainee_password_recovery_requests CASCADE;
    DROP TABLE IF EXISTS public.trainees CASCADE;
    DROP TABLE IF EXISTS public.profiles CASCADE;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, role text);
    CREATE TABLE public.trainees(
      id uuid PRIMARY KEY, coach_user_id uuid, auth_user_id uuid,
      approval_status text NOT NULL, phone_normalized text, archived_at timestamptz
    );
    CREATE TABLE public.trainee_password_recovery_requests(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      trainee_id uuid NOT NULL REFERENCES public.trainees(id) ON DELETE CASCADE,
      phone_normalized text NOT NULL, status text NOT NULL,
      requested_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz,
      reviewed_by uuid REFERENCES public.profiles(id), token_hash text,
      token_expires_at timestamptz, token_attempts smallint NOT NULL DEFAULT 0,
      completed_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
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
    ALTER TABLE public.trainee_password_recovery_requests ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.trainee_password_recovery_requests FROM PUBLIC,anon,authenticated;
    GRANT SELECT,INSERT,UPDATE,DELETE ON public.trainee_password_recovery_requests TO service_role;
    INSERT INTO public.profiles(id,role) VALUES ('${coach}','coach');
    INSERT INTO public.trainees(id,coach_user_id,auth_user_id,approval_status,phone_normalized)
      VALUES ('${trainee}','${coach}','40000000-0000-4000-8000-000000000001','active','+989123456789');
    INSERT INTO public.trainee_password_recovery_requests(id,trainee_id,phone_normalized,status)
      VALUES ('${request}','${trainee}','+989123456789','expired');
  `);
}

async function main(){
  try {
    await setup();
    await pool.query(atomic);
    console.log('PASS: Supabase-shaped atomic migration applies cleanly to mirror-like baseline');
    const cols=await pool.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='trainee_password_recovery_requests'`);
    for(const name of ['request_coach_user_id','delivery_payload','delivery_outcome','operation_id','auth_outcome'])
      assert(cols.rows.some(r=>r.column_name===name),`atomic migration must add ${name}`);
    const coachBinding=await pool.query('SELECT request_coach_user_id FROM public.trainee_password_recovery_requests WHERE id=$1',[request]);
    assert.equal(coachBinding.rows[0].request_coach_user_id,coach,'terminal history must backfill coach binding');

    await pool.query(outbox);
    console.log('PASS: Outbox migration applies after Supabase-shaped atomic migration');
    const badOp='50000000-0000-4000-8000-000000000001';
    await assert.rejects(pool.query(`UPDATE public.trainee_password_recovery_requests
      SET status='approved', reviewed_by=$2, reviewed_at=now(), token_hash=repeat('a',64),
          token_expires_at=now()+interval '10 minutes', delivery_operation_id=$3,
          delivery_outcome='pending' WHERE id=$1`,[request,coach,badOp]),
      /encrypted recovery delivery payload is required/i,
      'pre-encryption approval must fail closed');

    await pool.query(encrypted);
    console.log('PASS: encrypted payload migration applies after Outbox migration');
    const functionCheck=await pool.query(`SELECT to_regprocedure('public.recovery_coach_review_encrypted(uuid,uuid,text,text,timestamp with time zone,text,uuid,jsonb)') AS fn`);
    assert.ok(functionCheck.rows[0].fn,'encrypted coach review RPC wrapper must exist');
    const invalids=[
      null,
      [],
      {v:1,alg:'A256GCM',kid:'key-v1',iv:'AAAAAAAAAAAAAAAA',ct:'AAAAAAAAAAAAAAAAAAAAAAAAAAA=',extra:true},
      {v:1,alg:'A256GCM',kid:'key-v1',iv:'bad',ct:'AAAAAAAAAAAAAAAAAAAAAAAAAAA='},
      {v:1,alg:'A256GCM',kid:'key-v1',iv:'AAAAAAAAAAAAAAAA',ct:'short'},
    ];
    for(const bad of invalids){
      await assert.rejects(pool.query('UPDATE public.trainee_password_recovery_requests SET delivery_payload=$2 WHERE id=$1',[request,bad===null?null:JSON.stringify(bad)]),
        undefined,'malformed envelope must not be accepted by the database constraint');
    }
    // Valid encrypted envelope approval must atomically enqueue exactly one matching Outbox row.
    const op='50000000-0000-4000-8000-000000000002';
    const approved=await pool.query(
      'SELECT public.recovery_coach_review_encrypted($1,$2,$3,$4,$5,$6,$7,$8) AS result',
      [request,coach,'approve','a'.repeat(64),new Date(Date.now()+600000).toISOString(),'k1',op,JSON.stringify(payload)]
    );
    assert.equal(approved.rows[0].result.ok,true,JSON.stringify(approved.rows[0].result));
    const rows=await pool.query('SELECT delivery_operation_id,delivery_payload,status FROM public.trainee_password_recovery_outbox WHERE recovery_request_id=$1',[request]);
    assert.equal(rows.rowCount,1,'one approval creates exactly one Outbox item');
    assert.equal(rows.rows[0].delivery_operation_id,op);
    assert.deepEqual(rows.rows[0].delivery_payload,payload);
    await pool.query('UPDATE public.trainee_password_recovery_requests SET delivery_payload=$2 WHERE id=$1',[request,JSON.stringify(payload)]);
    assert.equal((await pool.query('SELECT count(*)::int n FROM public.trainee_password_recovery_outbox WHERE recovery_request_id=$1',[request])).rows[0].n,1,
      'repeated same-state updates must not duplicate Outbox rows');
    console.log('PASS: encrypted approval atomically enqueues one ciphertext row; duplicate update is idempotent');

    // Terminal request outcomes and Outbox outcomes must erase ciphertext.
    for(const [outcome,status] of [['sent','sent'],['confirmed_failure','failed'],['unknown','unknown']]){
      const id='60000000-0000-4000-8000-'+String(['sent','confirmed_failure','unknown'].indexOf(outcome)+1).padStart(12,'0');
      const reqId='70000000-0000-4000-8000-'+String(['sent','confirmed_failure','unknown'].indexOf(outcome)+1).padStart(12,'0');
      await pool.query('INSERT INTO public.trainee_password_recovery_requests(id,trainee_id,phone_normalized,status,request_coach_user_id,delivery_payload,delivery_outcome) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [reqId,trainee,'+989123456789','expired',coach,JSON.stringify(payload),outcome]);
      // Terminal cleanup trigger is installed on UPDATE; seed outbox terminal row using a pending row.
      const opId=id;
      await pool.query('INSERT INTO public.trainee_password_recovery_outbox(recovery_request_id,delivery_operation_id,provider_idempotency_key,delivery_payload) VALUES($1,$2,$3,$4)',
        [reqId,opId,'terminal-test:'+opId,JSON.stringify(payload)]);
      await pool.query('UPDATE public.trainee_password_recovery_outbox SET status=$2 WHERE delivery_operation_id=$1',[opId,status]);
      const cleared=await pool.query('SELECT delivery_payload FROM public.trainee_password_recovery_outbox WHERE delivery_operation_id=$1',[opId]);
      assert.equal(cleared.rows[0].delivery_payload,null,`Outbox payload must clear for ${status}`);
    }
    const acl=await pool.query(`SELECT has_function_privilege('service_role','public.recovery_outbox_claim(uuid,integer)','EXECUTE') service_claim,
      has_function_privilege('anon','public.recovery_outbox_claim(uuid,integer)','EXECUTE') anon_claim,
      has_table_privilege('anon','public.trainee_password_recovery_outbox','SELECT') anon_read`);
    assert.deepEqual(acl.rows[0],{service_claim:true,anon_claim:false,anon_read:false});
    console.log('PASS: terminal Outbox cleanup and service-role-only access controls');
    console.log('PASS: all three Supabase-shaped recovery migrations executed in order on disposable PostgreSQL');
  } finally { await pool.end(); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
