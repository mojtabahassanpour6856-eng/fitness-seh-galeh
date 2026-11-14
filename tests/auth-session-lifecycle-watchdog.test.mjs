import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync('index.html','utf8');
const match=html.match(/<script id="seh-auth-session-restore-watchdog-v1">([\s\S]*?)<\/script>/);
assert.ok(match,'the real session-restore watchdog must exist in index.html');

const listeners={};
const timers=[];
const bodyClasses=new Set(['locked']);
const document={
  readyState:'complete',
  hidden:false,
  body:{classList:{
    contains:name=>bodyClasses.has(name),
    remove:name=>bodyClasses.delete(name),
    add:name=>bodyClasses.add(name)
  }},
  addEventListener:(name,fn)=>{(listeners['document:'+name]??=[]).push(fn);}
};
const windowListeners={};
let sessionReads=0,loginCalls=0,releaseSession;
const sessionGate=new Promise(resolve=>{releaseSession=resolve;});
const window={
  AUTH_SUPABASE:{auth:{getSession:async()=>{sessionReads++;await sessionGate;return {data:{session:{user:{id:'coach-1'}}},error:null};}}},
  finishLogin:async user=>{loginCalls++;assert.equal(user.id,'coach-1');bodyClasses.delete('locked');}
};
window.addEventListener=(name,fn)=>{(windowListeners[name]??=[]).push(fn);};
const context={
  window,document,console:{warn(){}},
  setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length;},
  clearTimeout:()=>{},
  Promise
};
const coordinator=html.match(/<script id="seh-auth-session-singleflight-v1">([\\s\\S]*?)<\\/script>/);
assert.ok(coordinator,'shared session coordinator must exist');
vm.runInNewContext(coordinator[1],context);
vm.runInNewContext(match[1],context);

function fireScheduled(delay){
  const batch=timers.filter(t=>t.delay===delay);
  for(const t of batch){const i=timers.indexOf(t);if(i>=0)timers.splice(i,1);}
  for(const t of batch)t.fn();
  return batch.length;
}
assert.equal(windowListeners.pageshow.length,1,'pageshow recovery listener is installed');
assert.equal(listeners['document:visibilitychange'].length,1,'visibility recovery listener is installed');

windowListeners.pageshow[0]();
listeners['document:visibilitychange'][0]();
assert.equal(fireScheduled(250),2,'both lifecycle callbacks are scheduled');
await Promise.resolve();
assert.equal(sessionReads,1,'concurrent lifecycle signals share the watchdog running lock');

releaseSession();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(loginCalls,1,'the session is finalized once');
assert.equal(bodyClasses.has('locked'),false,'successful login unlocks the app');

windowListeners.pageshow[0]();
assert.equal(fireScheduled(250),1);
await Promise.resolve();
assert.equal(sessionReads,1,'an already-unlocked app is not restored again');
assert.equal(loginCalls,1,'finishLogin is not called again after successful restoration');

console.log('PASS: real session watchdog deduplicates concurrent pageshow/visibility restores and stays idle after unlock.');
