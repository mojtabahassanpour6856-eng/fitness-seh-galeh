import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync('index.html','utf8');
const match=html.match(/<script id="seh-auth-finish-login-singleflight-v1">([\s\S]*?)<\/script>/);
assert.ok(match,'auth guard must exist in real app HTML');
function setup(original, visible=false){
 const elements={authScreen:{style:{display:visible?'none':'block'}},authUserBar:{style:{display:visible?'block':'none'}}};
 const document={body:{classList:{contains:()=>!visible}},getElementById:id=>elements[id]||null};
 const warnings=[];
 const window={finishLogin:original};
 vm.runInNewContext(match[1],{window,document,Promise,String,console:{warn:(...x)=>warnings.push(x)}});
 return {window,warnings};
}
let calls=0,release;
const gate=new Promise(resolve=>release=resolve);
const a=setup(async u=>{calls++;await gate;return u.id;});
const p1=a.window.finishLogin({id:'same'}),p2=a.window.finishLogin({id:'same'});
assert.equal(p1,p2,'same-user concurrent calls share a promise');
await Promise.resolve();assert.equal(calls,1);
let blocked=false;try{await a.window.finishLogin({id:'other'});}catch(e){blocked=/در حال انجام/.test(e.message);}
assert.ok(blocked,'different account cannot race active login');
release();assert.equal(await p1,'same');
assert.equal(await a.window.finishLogin({id:'same'}),'same');assert.equal(calls,2);
const visible=setup(async()=>{throw new Error('optional widget failed');},true);
await assert.rejects(visible.window.finishLogin({id:'logged-in'}),/optional widget failed/,'post-login failures must remain observable to callers');
assert.equal(visible.warnings.length,0);
assert.match(html,/Post-login initialization failed after the authenticated shell became visible/,'post-login failures must be logged rather than silently swallowed');
const locked=setup(async()=>{throw new Error('profile permission denied');},false);
await assert.rejects(locked.window.finishLogin({id:'not-ready'}),/profile permission denied/,'core failure must remain visible when app shell is locked');
const failing=setup(async()=>{throw new Error('retry me');},false);
await assert.rejects(failing.window.finishLogin({id:'retry'}),/retry me/);
await assert.rejects(failing.window.finishLogin({id:'retry'}),/retry me/);

assert.match(html,/function showAuthError\(msg\)\s*\{[\s\S]*?sehStartupStatus/,'post-login errors must be surfaced inside the authenticated dashboard, not hidden on the login screen');
assert.match(html,/ورود انجام شده، اما بارگذاری یکی از بخش‌های تکمیلی کامل نشد/,'optional post-login wrapper failures must be visible and must not discard the session');
console.log('PASS: single-flight, cross-account race protection, post-login optional failure isolation, core failure visibility, retry release.');
