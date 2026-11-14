import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync('index.html','utf8');
const match=html.match(/<script id="seh-coach-dashboard-session-recovery-20261016">([\\s\\S]*?)<\\/script>/);
assert.ok(match,'the real coach dashboard recovery block must exist in index.html');

const timers=[];
const windowListeners={};
const documentListeners={};
const bodyClasses=new Set();
let sessionReads=0,profileReads=0,finishCalls=0,loadCalls=0,statsCalls=0;
let releaseSession;
const sessionGate=new Promise(resolve=>{releaseSession=resolve;});
const traineeNodes=[];
const authUserText={textContent:''};
const authScreen={style:{display:'block'}};
const document={
  readyState:'complete',
  getElementById:id=>id==='authUserText'?authUserText:id==='authScreen'?authScreen:null,
  querySelectorAll:selector=>selector==='#coachMobileCards .coach-name-cell[data-trainee-id]'?traineeNodes:[],
  addEventListener:(name,fn)=>{(documentListeners[name]??=[]).push(fn);}
};
const window={
  authProfile:null,
  AUTH_SUPABASE:{
    auth:{getSession:async()=>{sessionReads++;await sessionGate;return {data:{session:{user:{id:'coach-1'}}},error:null};}},
    from:table=>{assert.equal(table,'profiles');return {select:()=>({eq:()=>({maybeSingle:async()=>{profileReads++;return {data:{id:'coach-1',role:'coach',full_name:'Coach'},error:null};}})})};}
  },
  finishLogin:async user=>{finishCalls++;assert.equal(user.id,'coach-1');window.authProfile={role:'coach'};authUserText.textContent='Coach | مربی';authScreen.style.display='none';},
  loadClients:async()=>{loadCalls++;traineeNodes.push({});},
  updateStats:async()=>{statsCalls++;}
};
window.addEventListener=(name,fn)=>{(windowListeners[name]??=[]).push(fn);};
const context={window,document,console:{warn(){}},setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length;},clearTimeout:()=>{},Promise};
vm.runInNewContext(match[1],context);

function fire(delay){
  const batch=timers.filter(t=>t.delay===delay);
  for(const t of batch){const i=timers.indexOf(t);if(i>=0)timers.splice(i,1);}
  for(const t of batch)t.fn();
  return batch.length;
}
assert.equal(fire(350),1,'initial dashboard recovery is scheduled');
assert.equal(windowListeners.pageshow.length,1,'pageshow listener is installed');
windowListeners.pageshow[0]();
assert.equal(fire(350),1,'pageshow schedules a recovery while the trainee list is empty');
await Promise.resolve();
assert.equal(sessionReads,1,'overlapping recovery attempts are blocked by the running lock');
releaseSession();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(profileReads,1,'coach role is verified from the profiles table');
assert.equal(finishCalls,1,'coach login is finalized once');
assert.equal(loadCalls,1,'empty trainee list triggers one list load');
assert.equal(statsCalls,0,'stats-only refresh is skipped when list was empty');
assert.equal(traineeNodes.length,1,'the list renderer has populated a trainee row');

windowListeners.pageshow[0]();
assert.equal(fire(350),0,'pageshow does not restart recovery after the list is populated');
assert.equal(sessionReads,1,'no redundant session read after list population');
assert.equal(finishCalls,1,'no redundant finishLogin after list population');
console.log('PASS: real coach dashboard recovery verifies coach role, deduplicates overlapping pageshow recovery, and loads the empty trainee list once.');
