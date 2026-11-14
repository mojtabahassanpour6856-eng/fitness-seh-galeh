import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync('index.html','utf8');
const match=html.match(/<script id="seh-coach-first-load-guard">([\\s\\S]*?)<\\/script>/);
assert.ok(match,'coach first-load guard must exist');
let calls=0,shouldFail=true,nextTimer=1;
const timers=new Map(),listeners={};
const warnings=[];
const window={
  loadClients:async()=>{calls++;if(shouldFail)throw new Error('temporary network failure');return ['trainee'];},
  finishLogin:async()=> 'authenticated',
  addEventListener:(name,fn)=>{listeners[name]=fn;}
};
const document={
  readyState:'loading',
  addEventListener(){},
  getElementById(id){return id==='authUserText'?{textContent:'Coach | مربی'}:null;}
};
const setTimeoutFake=(fn,delay)=>{const id=nextTimer++;timers.set(id,{fn,delay});return id;};
const clearTimeoutFake=id=>timers.delete(id);
vm.runInNewContext(match[1],{window,document,Promise,console:{warn:(...x)=>warnings.push(x),error(){ }},setTimeout:setTimeoutFake,clearTimeout:clearTimeoutFake,setInterval:()=>99,clearInterval(){}});
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
