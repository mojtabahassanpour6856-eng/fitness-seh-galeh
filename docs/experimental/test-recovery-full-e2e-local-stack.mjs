import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import fs from 'node:fs';
import { Pool } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { createRecoveryCandidateHandler } from './recovery-candidate-handler.mjs';
import { FakeRecoverySmsProvider, processOneRecoveryOutboxItem } from './recovery-outbox-worker-mock.mjs';

const url=process.env.SUPABASE_URL, anonKey=process.env.SUPABASE_ANON_KEY;
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY, dbUrl=process.env.SUPABASE_DB_URL;
assert.ok(url && new URL(url).hostname==='127.0.0.1','E2E must use loopback Supabase only');
assert.ok(anonKey && serviceKey && dbUrl,'local Supabase credentials required');
assert.ok(['127.0.0.1','localhost'].includes(new URL(dbUrl).hostname),'database must be loopback only');
const pool=new Pool({connectionString:dbUrl,max:6});
const opts={auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}};
const admin=createClient(url,serviceKey,opts);
const makeAnon=()=>createClient(url,anonKey,opts);
const coachEmail='recovery-coach-'+randomUUID()+'@example.test';
const traineeEmail='recovery-trainee-'+randomUUID()+'@example.test';
const oldPassword='Disposable-Old-Password-123!';
const newPassword='Disposable-New-Password-456!';
const phone='+989123456789';
const hmacSecret=randomBytes(32).toString('hex');
const deliveryKey=randomBytes(32).toString('base64');
const env={
 RECOVERY_HMAC_KEYS:JSON.stringify({k1:hmacSecret}),RECOVERY_HMAC_KEY_VERSION:'k1',
 RECOVERY_DELIVERY_KEYS:JSON.stringify({k1:deliveryKey}),RECOVERY_DELIVERY_KEY_VERSION:'k1',
 RECOVERY_ALLOWED_ORIGINS:'https://fitness-seh-galeh.invalid'
};
let coachId,traineeAuthId,traineeId,recoveryRequestId,server;
const provider=new FakeRecoverySmsProvider([{kind:'accepted',messageId:'e2e-fake-sms-accepted'}]);
const expectNoError=(r,label)=>{assert.equal(r.error,null,label);return r.data;};
async function post(base,body,token){
 const response=await fetch(base,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
 const payload=await response.json(); return {status:response.status,body:payload};
}
async function main(){
 await pool.query(`
 CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text NOT NULL);
 CREATE TABLE public.trainees(
  id uuid PRIMARY KEY,coach_user_id uuid NOT NULL REFERENCES public.profiles(id),
  auth_user_id uuid NOT NULL,approval_status text NOT NULL,
  phone_normalized text NOT NULL,archived_at timestamptz,full_name text NOT NULL
 );
 CREATE TABLE public.trainee_password_recovery_requests(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainee_id uuid NOT NULL REFERENCES public.trainees(id),
  phone_normalized text NOT NULL,status text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id),token_hash text,token_expires_at timestamptz,
  token_attempts smallint NOT NULL DEFAULT 0,completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recovery_state_check CHECK (
   ((status IN ('pending','rejected')) AND token_hash IS NULL AND token_expires_at IS NULL)
   OR ((status IN ('approved','processing')) AND token_hash IS NOT NULL AND token_expires_at IS NOT NULL)
   OR status IN ('completed','expired')
  ),
  CONSTRAINT recovery_attempts_check CHECK(token_attempts BETWEEN 0 AND 10),
  CONSTRAINT recovery_status_check CHECK(status IN ('pending','approved','processing','rejected','completed','expired'))
 );
 CREATE UNIQUE INDEX trainee_password_recovery_one_open_request_per_trainee
 ON public.trainee_password_recovery_requests(trainee_id) WHERE status IN ('pending','approved');
 `);
 for(const path of [
  'docs/experimental/migrations/20261122_recovery_atomic_rpc_candidate.sql',
  'docs/experimental/migrations/20261122_recovery_outbox_worker_candidate.sql',
  'docs/experimental/migrations/20261122_recovery_encrypted_delivery_payload_candidate.sql'
 ]) {
  const sql = fs.readFileSync(path,'utf8');
  try {
    await pool.query(sql);
  } catch (error) {
    const position = Number(error.position || 0);
    console.error('Recovery migration failed:', path);
    console.error('PostgreSQL error:', error.code, error.message, 'position:', error.position);
    if (position > 0) console.error('SQL context:', sql.slice(Math.max(0, position - 180), Math.min(sql.length, position + 180)));
    throw error;
  }
 }
 await pool.query("NOTIFY pgrst, 'reload schema'");
 const coach=expectNoError(await admin.auth.admin.createUser({email:coachEmail,password:oldPassword,email_confirm:true}),'create coach');
 coachId=coach.user.id;
 const trainee=expectNoError(await admin.auth.admin.createUser({email:traineeEmail,password:oldPassword,email_confirm:true}),'create trainee');
 traineeAuthId=trainee.user.id;
 traineeId=randomUUID();
 await pool.query('INSERT INTO public.profiles(id,role) VALUES($1,\'coach\')',[coachId]);
 await pool.query(`INSERT INTO public.trainees(id,coach_user_id,auth_user_id,approval_status,phone_normalized,full_name)
 VALUES($1,$2,$3,'active',$4,'Disposable E2E Trainee')`,[traineeId,coachId,traineeAuthId,phone]);
 const coachLogin=await makeAnon().auth.signInWithPassword({email:coachEmail,password:oldPassword});
 assert.equal(coachLogin.error,null,'coach must authenticate against local Auth');
 const coachToken=coachLogin.data.session.access_token;
 const handler=createRecoveryCandidateHandler({
  env,admin,
  createUserClient:(authorization)=>createClient(url,anonKey,{...opts,global:{headers:{Authorization:authorization}}})
 });
 server=createServer(async(req,res)=>{
  try{
   const chunks=[]; for await(const chunk of req) chunks.push(chunk);
   const body=Buffer.concat(chunks);
   const request=new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers,body:body.length?body:undefined,duplex:'half'});
   const response=await handler(request);
   res.writeHead(response.status,Object.fromEntries(response.headers.entries()));
   res.end(await response.text());
  }catch{res.writeHead(500);res.end('{}');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port+'/recovery';
 const submitted=await post(base,{action:'request',phone});
 assert.equal(submitted.status,202,'request endpoint should return generic accepted response');
 const listed=await post(base,{action:'list'},coachToken);
 assert.equal(listed.status,200,'real local Auth coach must list assigned trainee request');
 assert.equal(listed.body.requests.length,1);
 recoveryRequestId=listed.body.requests[0].id;
 const approved=await post(base,{action:'review',request_id:recoveryRequestId,decision:'approve'},coachToken);
 assert.equal(approved.status,202,'coach approval should enqueue encrypted delivery');
 assert.equal(approved.body.delivery_status,'queued');
 const processed=await processOneRecoveryOutboxItem({admin,workerId:randomUUID(),deliveryKeys:{k1:deliveryKey},provider});
 assert.equal(processed.status,'sent','fake Outbox worker should deliver one queued item');
 assert.equal(provider.calls.length,1,'exactly one fake provider call expected');
 const code=provider.calls[0].code;
 assert.match(code,/^\d{4}$/,'captured fake SMS code must be four digits');
 const wrong=await post(base,{action:'reset',phone,code:'0000'===code?'0001':'0000',new_password:newPassword});
 assert.equal(wrong.status,400,'wrong code must be rejected');
 const reset=await post(base,{action:'reset',phone,code,new_password:newPassword});
 assert.equal(reset.status,200,'correct code should update password through local Auth Admin');
 const oldLogin=await makeAnon().auth.signInWithPassword({email:traineeEmail,password:oldPassword});
 assert.ok(oldLogin.error,'old password must fail after successful recovery');
 const newLogin=await makeAnon().auth.signInWithPassword({email:traineeEmail,password:newPassword});
 assert.equal(newLogin.error,null,'new password must authenticate after recovery');
 const replay=await post(base,{action:'reset',phone,code,new_password:'Another-Password-789!'});
 assert.equal(replay.status,400,'replayed code must be rejected');
 const state=await pool.query(`SELECT status,delivery_outcome,auth_outcome,token_hash,delivery_payload
 FROM public.trainee_password_recovery_requests WHERE id=$1`,[recoveryRequestId]);
 assert.equal(state.rowCount,1);
 assert.equal(state.rows[0].status,'completed');
 assert.equal(state.rows[0].delivery_outcome,'sent');
 assert.equal(state.rows[0].auth_outcome,'completed');
 assert.equal(state.rows[0].token_hash,null,'consumed HMAC token must be cleared');
 assert.equal(state.rows[0].delivery_payload,null,'request ciphertext must be cleared');
 const outbox=await pool.query('SELECT status,delivery_payload FROM public.trainee_password_recovery_outbox WHERE recovery_request_id=$1',[recoveryRequestId]);
 assert.equal(outbox.rows[0].status,'sent');
 assert.equal(outbox.rows[0].delivery_payload,null,'Outbox ciphertext must be cleared after delivery');
 console.log('PASS: one disposable Supabase stack completed trainee request → real coach Auth/list/approval → encrypted Outbox → FakeRecoverySmsProvider → HTTP code redemption → local Auth password update.');
 console.log('PASS: wrong code rejected; old password rejected; new password accepted; replay rejected; terminal ciphertext and token hash cleared.');
}
try{await main();}
finally{
 if(server) await new Promise(resolve=>server.close(resolve));
 // Remove every synthetic database fixture before deleting its Auth identities.
 // The disposable local stack is the only permitted target for this cleanup.
 try{
  if(recoveryRequestId){
   await pool.query('DELETE FROM public.trainee_password_recovery_outbox WHERE recovery_request_id=$1',[recoveryRequestId]);
   await pool.query('DELETE FROM public.trainee_password_recovery_requests WHERE id=$1',[recoveryRequestId]);
  }
 }catch{}
 try{if(traineeId) await pool.query('DELETE FROM public.trainees WHERE id=$1',[traineeId]);}catch{}
 try{if(coachId) await pool.query('DELETE FROM public.profiles WHERE id=$1',[coachId]);}catch{}
 try{if(traineeAuthId) await admin.auth.admin.deleteUser(traineeAuthId);}catch{}
 try{if(coachId) await admin.auth.admin.deleteUser(coachId);}catch{}
 await pool.end();
}
