import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync('index.html','utf8');
const match=html.match(/<script id="seh-coach-first-load-guard">([\s\S]*?)<\/script>/);
assert.ok(match,'coach first-load guard must exist');
let calls=0,shouldFail=true,nextTimer=1;
const timers=new Map(),listeners={};
const warnings=[];
const listBody={textContent:'',innerHTML:''};
const window={
  // Model the real app: loadClients catches the request error, renders an error row,
  // and resolves instead of rejecting. The outer guard must still detect failure.
  loadClients:async()=>{calls++;if(shouldFail){listBody.textContent='دریافت شاگردان ناموفق بود';listBody.innerHTML=listBody.textContent;return;}listBody.textContent='شاگرد';listBody.innerHTML='شاگرد';return ['trainee'];},
  finishLogin:async()=> 'authenticated',
  addEventListener:(name,fn)=>{listeners[name]=fn;}
};
const document={
  readyState:'loading',
  addEventListener(){},
  getElementById(id){if(id==='authUserText')return {textContent:'Coach | مربی'};if(id==='clientTableBody')return listBody;return null;}
};
const setTimeoutFake=(fn,delay)=>{const id=nextTimer++;timers.set(id,{fn,delay});return id;};
const clearTimeoutFake=id=>timers.delete(id);
vm.runInNewContext(match[1],{window,document,Promise,console:{warn:(...x)=>warnings.push(x),error(){}},setTimeout:setTimeoutFake,clearTimeout:clearTimeoutFake,setInterval:()=>99,clearInterval(){}});
assert.equal(typeof window.addEventListener,'function','test window must support recovery listeners');
assert.equal(window.__sehCoachListLoadAttempted,undefined);
const login=await window.finishLogin();
assert.equal(login,'authenticated','temporary list failure must not undo successful authentication');
await new Promise(resolve=>setImmediate(resolve));
assert.equal(calls,1,'first list request is attempted once');
assert.notEqual(window.__sehCoachListLoadAttempted,true,'failed load must not be marked as completed');
assert.ok([...timers.values()].some(t=>t.delay===1500),'first retry is scheduled with backoff');
shouldFail=false;
const retry=[...timers.entries()][0];
assert.ok(retry,'retry timer exists');
timers.delete(retry[0]);
await retry[1].fn();
assert.equal(window.__sehCoachListLoadAttempted,true,'successful retry marks the list ready');
assert.equal(calls,2,'one retry succeeds after the temporary network failure');
assert.equal(timers.size,0,'no further retry remains after success');
assert.equal(typeof listeners.online,'function','network recovery listener is installed');
assert.equal(typeof listeners.pageshow,'function','page restore listener is installed');
console.log('PASS: coach login survives transient list failure; bounded retry succeeds and recovery listeners are installed.');


// Exhaust the bounded retry window, then verify an online event restarts recovery.
let calls2=0,shouldFail2=true,nextTimer2=1;
const timers2=new Map(),listeners2={};
const listBody2={textContent:'',innerHTML:''};
const window2={
  loadClients:async()=>{calls2++;if(shouldFail2){listBody2.textContent='دریافت شاگردان ناموفق بود';listBody2.innerHTML=listBody2.textContent;return;}listBody2.textContent='شاگرد';listBody2.innerHTML='شاگرد';return ['trainee'];},
  finishLogin:async()=> 'authenticated',
  addEventListener:(name,fn)=>{listeners2[name]=fn;}
};
const document2={readyState:'loading',addEventListener(){},getElementById(id){if(id==='authUserText')return {textContent:'Coach | مربی'};if(id==='clientTableBody')return listBody2;return null;}};
const setTimeout2=(fn,delay)=>{const id=nextTimer2++;timers2.set(id,{fn,delay});return id;};
vm.runInNewContext(match[1],{window:window2,document:document2,Promise,console:{warn(){},error(){}},setTimeout:setTimeout2,clearTimeout:id=>timers2.delete(id),setInterval:()=>99,clearInterval(){}});
await window2.finishLogin();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(calls2,1,'second scenario starts with one failed list request');
for(let attempt=0;attempt<4;attempt++){
  const pending=[...timers2.entries()][0];
  assert.ok(pending,'each bounded retry must be scheduled');
  timers2.delete(pending[0]);
  await pending[1].fn();
}
assert.equal(calls2,5,'four bounded retries follow the initial failure');
assert.equal(timers2.size,0,'automatic retries stop after the configured limit');
assert.notEqual(window2.__sehCoachListLoadAttempted,true,'exhausted retries must not mark the list ready');
shouldFail2=false;
listeners2.online();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(calls2,6,'online recovery starts a fresh list request after retry exhaustion');
assert.equal(window2.__sehCoachListLoadAttempted,true,'online recovery marks the list ready after success');
console.log('PASS: online recovery restarts list loading after the bounded retry window is exhausted.');
