'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const pinned = '@supabase/supabase-js@2.119.0';
assert.ok(html.includes('https://cdn.jsdelivr.net/npm/' + pinned));
assert.ok(html.includes('https://unpkg.com/' + pinned));
assert.ok(!html.includes('@supabase/supabase-js@2"'), 'floating major-version alias must not remain');
assert.ok(html.includes('<script id="seh-supabase-sdk"'));
assert.ok(html.includes("document.write('<script src=\"'+fallback"));
assert.ok(html.includes('Supabase SDK unavailable; application startup stopped safely'));
assert.ok(html.includes('window.AUTH_SUPABASE=window.supabase.createClient'));

const marker = '/* SEH_SUPABASE_SDK_LOADER:';
const start = html.indexOf(marker);
const end = html.indexOf('</script>', start);
assert.ok(start >= 0 && end > start, 'loader script must be present');
const loader = html.slice(start, end);
assert.ok(!loader.includes('setTimeout') && !loader.includes('setInterval'),
  'parser-blocking SDK loader must not claim a JS timer can interrupt parser blocking');

function harness(){
  let written = '';
  const box = {style:{},textContent:''};
  const window = {};
  const document = {
    readyState:'loading',
    getElementById(id){return id==='authError'?box:null;},
    write(value){written += value;}
  };
  vm.runInNewContext(loader,{window,document});
  return {window,document,box,get written(){return written;}};
}
const failedPrimary = harness();
failedPrimary.window.__sehSupabaseSdkFailed();
assert.ok(failedPrimary.written.includes('https://unpkg.com/@supabase/supabase-js@2.119.0'));
assert.ok(failedPrimary.written.includes('onload="window.__sehSupabaseSdkLoaded()"'));
assert.ok(failedPrimary.written.includes('onerror="window.__sehSupabaseSdkFallbackFailed()"'));

const fallbackSuccess = harness();
fallbackSuccess.window.supabase={createClient(){}};
fallbackSuccess.window.__sehSupabaseSdkLoaded();
assert.equal(fallbackSuccess.window.__sehSupabaseSdkReady,true);
assert.equal(fallbackSuccess.window.__sehSupabaseSdkLoadFailed,false);

const fallbackFailure = harness();
fallbackFailure.window.__sehSupabaseSdkFallbackFailed();
assert.equal(fallbackFailure.window.__sehSupabaseSdkLoadFailed,true);
assert.ok(fallbackFailure.box.textContent.includes('دو منبع'));

const lateFailure = harness();
lateFailure.document.readyState='complete';
lateFailure.window.__sehSupabaseSdkFailed();
assert.equal(lateFailure.window.__sehSupabaseSdkLoadFailed,true);
assert.ok(lateFailure.box.textContent.includes('دو منبع'));

console.log('PASS: parser-ordered Supabase fallback, success and terminal failure paths');
