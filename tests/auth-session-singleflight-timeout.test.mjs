import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync('index.html','utf8');
const start=html.indexOf('/* SEH_AUTH_SESSION_SINGLEFLIGHT_V1_START */');
const end=html.indexOf('/* SEH_AUTH_SESSION_SINGLEFLIGHT_V1_END */',start);
assert.ok(start>=0&&end>start,'shared session coordinator must exist');
const coordinator=html.slice(start,end+'/* SEH_AUTH_SESSION_SINGLEFLIGHT_V1_END */'.length);

const timers=new Map();
let nextTimer=1;
const setTimeoutFake=(fn,delay)=>{const id=nextTimer++;timers.set(id,{fn,delay});return id;};
const clearTimeoutFake=id=>timers.delete(id);
let calls=0,releaseHung,shownNotice='',authStateListener=null;
const window={
  showAuthError:message=>{shownNotice=message;},
  AUTH_SUPABASE:{auth:{
    onAuthStateChange(callback){authStateListener=callback;return {data:{subscription:{unsubscribe(){}}}};},
    getSession(){
      calls++;
      return new Promise(resolve=>{releaseHung=resolve;});
    }
  }}
};
vm.runInNewContext(coordinator,{window,Promise,setTimeout:setTimeoutFake,clearTimeout:clearTimeoutFake});

const stalled=window.__sehGetSessionSingleFlight();
assert.equal(calls,1,'one underlying request starts');
const timeout=[...timers.entries()][0];
assert.ok(timeout,'a bounded timeout is installed');
assert.equal(timeout[1].delay,12000,'session restoration has a 12-second upper wait');
timers.delete(timeout[0]);
timeout[1].fn();
await assert.rejects(stalled,/۱۲ ثانیه/,'a stalled request must reject with a retryable timeout');
assert.match(shownNotice,/نشست ذخیره‌شده پاک نشده است/,'the user is told the saved session was not cleared and a retry is possible');
assert.equal(timers.size,0,'the timeout is cleaned up');

window.AUTH_SUPABASE.auth.getSession=async()=>{
  calls++;
  return {data:{session:{user:{id:'coach-1'}}},error:null};
};
const retry=window.__sehGetSessionSingleFlight();
const joined=window.__sehGetSessionSingleFlight();
assert.equal(retry,joined,'concurrent callers share the same in-flight request');
const [resultA,resultB]=await Promise.all([retry,joined]);
assert.equal(calls,2,'a fresh request can start after the timed-out wait');
assert.equal(resultA,resultB,'joined callers receive the same result');
const cached=await window.__sehGetSessionSingleFlight();
assert.equal(cached,resultA,'a very short successful-session cache prevents staggered startup recovery from rereading the same session');
assert.equal(calls,2,'the cached startup result avoids an extra request');
assert.equal(typeof authStateListener,'function','the coordinator subscribes to auth lifecycle changes');

let nextSession={user:{id:'coach-2'}};
window.AUTH_SUPABASE.auth.getSession=async()=>{
  calls++;
  return {data:{session:nextSession},error:null};
};
authStateListener('SIGNED_OUT');
const afterSignOut=await window.__sehGetSessionSingleFlight();
assert.equal(afterSignOut.data.session,nextSession,'SIGNED_OUT invalidates the short-lived cached session');
assert.equal(calls,3,'a new session read occurs after SIGNED_OUT');

nextSession={user:{id:'coach-3',token:'refreshed'}};
authStateListener('TOKEN_REFRESHED');
const afterRefresh=await window.__sehGetSessionSingleFlight();
assert.equal(afterRefresh.data.session,nextSession,'TOKEN_REFRESHED invalidates the cached token/session result');
assert.equal(calls,4,'a fresh session read occurs after TOKEN_REFRESHED');

if(releaseHung)releaseHung({data:{session:null},error:null});

const sessionReadMatches=[...html.matchAll(/\.auth\.getSession\s*\(/g)];
assert.equal(sessionReadMatches.length,5,
  'only the coordinator implementation and four post-setSession verification reads may call auth.getSession directly');
const coordinatorCall=sessionReadMatches.findIndex(match=>match.index>=start&&match.index<end);
assert.notEqual(coordinatorCall,-1,'the coordinator must own the shared direct session read');

const chatStart=html.indexOf('<script id="FITNESS_COACH_CHAT_V1">');
const chatEnd=html.indexOf('</script>',chatStart);
assert.ok(chatStart>=0&&chatEnd>chatStart,'coach/trainee chat module must exist');
const chatSource=html.slice(chatStart,chatEnd);
assert.match(chatSource,/__sehGetSessionSingleFlight/,
  'chat session recovery must use the shared session coordinator');
assert.doesNotMatch(chatSource,/auth\.getSession\s*\(/,
  'chat must not bypass session deduplication');

const apiHeadersStart=html.indexOf('async function sbApiHeaders');
const apiHeadersEnd=html.indexOf('async function sbGet',apiHeadersStart);
assert.ok(apiHeadersStart>=0&&apiHeadersEnd>apiHeadersStart,'shared REST API header helper must exist');
const apiHeaders=html.slice(apiHeadersStart,apiHeadersEnd);
assert.match(apiHeaders,/__sehGetSessionSingleFlight/,
  'REST API authorization headers must use the shared session coordinator');
assert.doesNotMatch(apiHeaders,/\.auth\.getSession\s*\(/,
  'REST API header construction must not bypass session deduplication');

console.log('PASS: session coordinator deduplicates concurrent and staggered startup reads, times out stalled waits, and permits retry without clearing auth storage.');
