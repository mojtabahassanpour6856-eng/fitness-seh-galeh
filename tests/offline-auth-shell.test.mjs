import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync('index.html','utf8');
const SAFE_KEY='seh.offline-safe-shell.v1';

function scriptById(id){
  const escaped=id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const match=html.match(new RegExp('<script[^>]*id="'+escaped+'"[^>]*>([\\s\\S]*?)<\\/script>'));
  assert.ok(match,'production script must exist: '+id);
  return match[1];
}
function createHarness({online=false,marker=true,session=true,sessionError=null}={}){
  const values=new Map();
  if(marker)values.set(SAFE_KEY,JSON.stringify({version:1,view:'home'}));
  const storage={
    getItem:key=>values.has(key)?values.get(key):null,
    setItem:(key,value)=>values.set(key,String(value)),
    removeItem:key=>values.delete(key)
  };
  const bodyClasses=new Set(['locked']);
  const listeners={};
  const docListeners={};
  const timers=[];
  const elements={
    authScreen:{style:{display:'block'}},
    authUserBar:{style:{display:'none'}},
    authUserText:{textContent:''}
  };
  const notice={id:'sehOfflineShellNotice',removed:false,setAttribute(){},remove(){this.removed=true;delete elements.sehOfflineShellNotice;}};
  const hero={insertAdjacentElement(position,node){assert.equal(position,'afterend');elements.sehOfflineShellNotice=node;}};
  const page={querySelector:selector=>selector==='.hero'?hero:null};
  const document={
    readyState:'complete',hidden:false,
    body:{classList:{
      contains:name=>bodyClasses.has(name),
      add:name=>bodyClasses.add(name),
      remove:name=>bodyClasses.delete(name)
    }},
    getElementById:id=>elements[id]||null,
    querySelector:selector=>selector==='.page'?page:null,
    createElement:tag=>({tagName:tag,style:{},setAttribute(name,value){this[name]=value;},remove(){this.removed=true;delete elements[this.id];}}),
    addEventListener:(name,fn)=>{(docListeners[name]??=[]).push(fn);}
  };
  const navigator={onLine:online};
  let sessionReads=0,finishCalls=0;
  const user=session?{id:'coach-1'}:null;
  const window={
    localStorage:storage,
    AUTH_SUPABASE:{auth:{getSession:async()=>{sessionReads++;if(sessionError)throw sessionError;return {data:{session:user?{user}:null},error:null};}}},
    addEventListener:(name,fn)=>{(listeners[name]??=[]).push(fn);},
    finishLogin:async()=>{
      finishCalls++;
      elements.authScreen.style.display='none';
      elements.authUserBar.style.display='block';
      elements.authUserText.textContent='Coach | مربی';
      bodyClasses.delete('locked');
    }
  };
  const context={window,document,navigator,Promise,Date,console:{warn(){},error(){}},
    setTimeout:(fn,delay=0)=>{const timer={fn,delay,active:true};timers.push(timer);return timer;},
    clearTimeout:timer=>{const found=timers.find(t=>t===timer);if(found)found.active=false;}
  };
  function runTimers(delay){const batch=timers.filter(t=>t.active&&t.delay===delay);for(const t of batch)t.active=false;for(const t of batch)t.fn();return batch.length;}
  return {context,window,document,navigator,storage,bodyClasses,listeners,docListeners,elements,timers,runTimers,get sessionReads(){return sessionReads;},get finishCalls(){return finishCalls;}};
}
async function flush(){for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));}

test('offline startup with a prior safe marker shows only the restricted shell without contacting Supabase',async()=>{
  const h=createHarness({online:false,marker:true,session:true});
  vm.runInNewContext(scriptById('seh-auth-session-restore-watchdog-v1'),h.context);
  assert.equal(h.runTimers(900),1);
  await flush();
  assert.equal(h.bodyClasses.has('locked'),false);
  assert.equal(h.bodyClasses.has('seh-offline-shell'),true);
  assert.equal(h.elements.authScreen.style.display,'none');
  assert.equal(h.elements.authUserBar.style.display,'none');
  assert.ok(h.elements.sehOfflineShellNotice);
  assert.equal(h.sessionReads,0,'offline startup must not make a session/profile network attempt');
  assert.equal(h.finishCalls,0,'offline marker must never call finishLogin');
});

test('offline startup without a marker stays on the public locked entry screen',async()=>{
  const h=createHarness({online:false,marker:false,session:true});
  vm.runInNewContext(scriptById('seh-auth-session-restore-watchdog-v1'),h.context);
  h.runTimers(900);await flush();
  assert.equal(h.bodyClasses.has('locked'),true);
  assert.equal(h.bodyClasses.has('seh-offline-shell'),false);
  assert.equal(h.elements.authScreen.style.display,'block');
  assert.equal(h.sessionReads,0);
});

test('reconnection restores private UI only after the server session and finishLogin succeed',async()=>{
  const h=createHarness({online:false,marker:true,session:true});
  vm.runInNewContext(scriptById('seh-auth-session-restore-watchdog-v1'),h.context);
  h.runTimers(900);await flush();
  h.navigator.onLine=true;
  for(const fn of h.listeners.online||[])fn();
  assert.equal(h.runTimers(250),1);
  await flush();
  assert.equal(h.sessionReads,1);
  assert.equal(h.finishCalls,1);
  assert.equal(h.bodyClasses.has('seh-offline-shell'),false);
  assert.equal(h.elements.sehOfflineShellNotice,undefined);
  assert.equal(h.elements.authUserBar.style.display,'block');
});

test('failed online recovery falls back to restricted shell and preserves marker',async()=>{
  const h=createHarness({online:true,marker:true,session:true,sessionError:new Error('network unavailable')});
  vm.runInNewContext(scriptById('seh-auth-session-restore-watchdog-v1'),h.context);
  h.runTimers(900);await flush();
  assert.equal(h.bodyClasses.has('seh-offline-shell'),true);
  assert.equal(h.bodyClasses.has('locked'),false);
  assert.deepEqual(JSON.parse(h.storage.getItem(SAFE_KEY)),{version:1,view:'home'});
  assert.equal(h.finishCalls,0);
});

test('successful finishLogin stores only a minimal safe-shell marker',async()=>{
  const h=createHarness({online:true,marker:false});
  vm.runInNewContext(scriptById('seh-auth-finish-login-singleflight-v1'),h.context);
  await h.window.finishLogin({id:'coach-1'});
  assert.deepEqual(JSON.parse(h.storage.getItem(SAFE_KEY)),{version:1,view:'home'});
});

test('auth sign-in and sign-out transitions invalidate the previous shell marker',async()=>{
  const h=createHarness({online:true,marker:true,session:true});
  let authListener;
  h.window.AUTH_SUPABASE.auth.onAuthStateChange=callback=>{authListener=callback;return {data:{subscription:{unsubscribe(){}}}};};
  const start=html.indexOf('/* SEH_AUTH_SESSION_SINGLEFLIGHT_V1_START */');
  const end=html.indexOf('/* SEH_AUTH_SESSION_SINGLEFLIGHT_V1_END */',start);
  assert.ok(start>=0&&end>start,'shared session coordinator boundaries must exist');
  vm.runInNewContext(html.slice(start,end+'/* SEH_AUTH_SESSION_SINGLEFLIGHT_V1_END */'.length),h.context);
  await h.window.__sehGetSessionSingleFlight();
  assert.equal(typeof authListener,'function');
  authListener('SIGNED_IN');
  assert.equal(h.storage.getItem(SAFE_KEY),null);
  h.storage.setItem(SAFE_KEY,JSON.stringify({version:1,view:'home'}));
  authListener('SIGNED_OUT');
  assert.equal(h.storage.getItem(SAFE_KEY),null);
});
