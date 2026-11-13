'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
assert.match(html,/window\.__sehLoadHtml2Canvas=function\(targetWindow,targetDocument\)/);
assert.equal((html.match(/__sehLoadHtml2Canvas\(/g)||[]).length,4,'all four export paths must use the shared loader');
assert.doesNotMatch(html,/script\.src='https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/html2canvas/, 'unbounded one-off html2canvas loaders must be removed');
const match=html.match(/(\/\* SEH_HTML2CANVAS_LOADER[\s\S]*?\n\};)/);
assert.ok(match,'shared loader body must be extractable');
function harness(){
 const scripts=[],timers=[];
 const win={};
 const doc={head:{appendChild(s){scripts.push(s);s.parentNode=this;},removeChild(s){s.parentNode=null;}},createElement(){return {parentNode:null};}};
 const ctx={window:win,Promise,Error,setTimeout(fn,ms){const t={fn,ms,cleared:false};timers.push(t);return t;},clearTimeout(t){if(t)t.cleared=true;}};
 vm.runInNewContext(match[1],ctx);
 return {win,doc,scripts,timers};
}
(async()=>{
 const success=harness();
 const p=success.win.__sehLoadHtml2Canvas(success.win,success.doc);
 assert.equal(success.scripts.length,1);
 assert.equal(success.timers[0].ms,10000);
 success.win.html2canvas=function(){};
 success.scripts[0].onload();
 await p;
 assert.equal(success.scripts[0].src,'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');

 const fallback=harness();
 const fp=fallback.win.__sehLoadHtml2Canvas(fallback.win,fallback.doc);
 fallback.scripts[0].onerror();
 assert.equal(fallback.scripts.length,2);
 assert.equal(fallback.scripts[1].src,'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
 fallback.win.html2canvas=function(){};
 fallback.scripts[1].onload();
 await fp;

 const timeout=harness();
 const tp=timeout.win.__sehLoadHtml2Canvas(timeout.win,timeout.doc);
 timeout.timers[0].fn();
 assert.equal(timeout.scripts.length,2,'primary timeout must start exactly one fallback');
 timeout.timers[1].fn();
 await assert.rejects(tp,/دو منبع/);

 const cached=harness();
 const cp1=cached.win.__sehLoadHtml2Canvas(cached.win,cached.doc);
 const cp2=cached.win.__sehLoadHtml2Canvas(cached.win,cached.doc);
 assert.equal(cp1,cp2,'concurrent exports must share one loader promise');
 cached.win.html2canvas=function(){};
 cached.scripts[0].onload();
 await cp1;
 console.log('PASS: html2canvas loader success, fallback, timeout, failure and concurrent-call tests');
})().catch(error=>{console.error(error);process.exitCode=1;});
