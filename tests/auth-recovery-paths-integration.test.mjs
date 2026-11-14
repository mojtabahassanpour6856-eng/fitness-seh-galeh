import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync('index.html','utf8');
function script(id){
  const escaped=id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const match=html.match(new RegExp('<script id="'+escaped+'">([\\s\\S]*?)<\\/script>'));
  assert.ok(match,'required production script must exist: '+id);
  return match[1];
}

const timers=[];
const windowListeners={};
const bodyClasses=new Set(['locked']);
const traineeRows=[];
const elements={
  authUserText:{textContent:''},
  authScreen:{style:{display:'block'}},
  authUserBar:{style:{display:'none'}}
};
const document={
  readyState:'complete',
  body:{classList:{
    contains:name=>bodyClasses.has(name),
    remove:name=>bodyClasses.delete(name),
    add:name=>bodyClasses.add(name)
  }},
  getElementById:id=>elements[id]||null,
  querySelectorAll:selector=>selector==='#coachMobileCards .coach-name-cell[data-trainee-id]'?traineeRows:[],
  addEventListener(){}
};
let sessionReads=0,profileReads=0,finishCalls=0,loadCalls=0;
let releaseFinish;
const finishGate=new Promise(resolve=>{releaseFinish=resolve;});
const coach={id:'coach-1',email:'coach@example.test'};
const window={
  authProfile:null,
  AUTH_SUPABASE:{
    auth:{getSession:async()=>{sessionReads++;return {data:{session:{user:coach}},error:null};}},
    from:table=>{
      assert.equal(table,'profiles');
      return {select:()=>({eq:()=>({maybeSingle:async()=>{
        profileReads++;
        return {data:{id:coach.id,role:'coach',full_name:'Coach'},error:null};
      }})})};
    }
  },
  finishLogin:async user=>{
    finishCalls++;
    assert.equal(user.id,coach.id);
    await finishGate;
    window.authProfile={role:'coach'};
    elements.authUserText.textContent='Coach | مربی';
    elements.authScreen.style.display='none';
    elements.authUserBar.style.display='block';
    bodyClasses.delete('locked');
  },
  loadClients:async()=>{loadCalls++;traineeRows.push({});},
  updateStats:async()=>{}
};
window.addEventListener=(name,fn)=>{(windowListeners[name]??=[]).push(fn);};
const context={
  window,document,Promise,String,console:{warn(){},error(){}},
  setTimeout:(fn,delay=0)=>{const timer={fn,delay};timers.push(timer);return timer;},
  clearTimeout:timer=>{const i=timers.indexOf(timer);if(i>=0)timers.splice(i,1);}
};

vm.runInNewContext(script('seh-auth-session-singleflight-v1'),context);
vm.runInNewContext(script('seh-coach-dashboard-session-recovery-20261016'),context);
vm.runInNewContext(script('seh-auth-session-restore-watchdog-v1'),context);
vm.runInNewContext(script('seh-auth-finish-login-singleflight-v1'),context);

async function flush(){for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));}
function fire(delay){
  const batch=timers.filter(t=>t.delay===delay);
  for(const t of batch){const i=timers.indexOf(t);if(i>=0)timers.splice(i,1);}
  for(const t of batch)t.fn();
  return batch.length;
}

assert.equal(fire(350),1,'dashboard recovery schedules its first attempt');
await flush();
assert.equal(finishCalls,1,'dashboard recovery starts the first login pipeline');
assert.equal(fire(900),1,'auth watchdog schedules its restoration attempt');
await flush();
assert.equal(finishCalls,1,'watchdog joins the in-flight finishLogin promise instead of starting a second pipeline');
assert.equal(sessionReads,1,'startup recovery paths share one session read even when their timers are staggered');
releaseFinish();
await flush();
assert.equal(bodyClasses.has('locked'),false,'successful login unlocks the app shell');
assert.equal(profileReads,1,'only the dashboard recovery performs coach profile verification');
assert.equal(loadCalls,1,'the coach trainee list is loaded once after authentication');
assert.equal(traineeRows.length,1,'the trainee list becomes populated');
assert.equal(windowListeners.pageshow.length,2,'both dashboard recovery and auth watchdog install their pageshow listeners');

console.log('PASS: dashboard recovery and auth watchdog overlap safely; finishLogin single-flight prevents duplicate login pipeline and trainee list loads once.');
