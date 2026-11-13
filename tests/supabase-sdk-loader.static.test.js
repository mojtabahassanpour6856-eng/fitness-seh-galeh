'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const pinned = '@supabase/supabase-js@2.119.0';
assert.ok(html.includes('https://cdn.jsdelivr.net/npm/' + pinned));
assert.ok(html.includes('https://unpkg.com/' + pinned));
assert.doesNotMatch(html, /@supabase\\/supabase-js@2(?:["'/?]|$)/);
assert.match(html, /<script id="seh-supabase-sdk"/);
assert.match(html, /document\\.write\\('<script src="'\\+fallback/);
assert.match(html, /Supabase SDK unavailable; application startup stopped safely/);
assert.match(html, /window\\.AUTH_SUPABASE=window\\.supabase\\.createClient/);

const loaderMatch = html.match(/<script>\\s*(\\/\\* SEH_SUPABASE_SDK_LOADER[\\s\\S]*?)<\\/script>\\s*<script id="seh-supabase-sdk"/);
assert.ok(loaderMatch, 'loader must appear immediately before parser-blocking SDK script');
const loader = loaderMatch[1];
assert.doesNotMatch(loader, /setTimeout|setInterval/, 'parser-blocking SDK loader must not claim a JS timeout can interrupt parser blocking');

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
assert.match(failedPrimary.written,/https:\\/\\/unpkg\\.com\\/@supabase\\/supabase-js@2\\.119\\.0/,'primary failure must parser-write the exact pinned fallback');
assert.match(failedPrimary.written,/onload="window\\.__sehSupabaseSdkLoaded\\(\\)"/);
assert.match(failedPrimary.written,/onerror="window\\.__sehSupabaseSdkFallbackFailed\\(\\)"/);

const fallbackSuccess = harness();
fallbackSuccess.window.supabase={createClient(){}};
fallbackSuccess.window.__sehSupabaseSdkLoaded();
assert.equal(fallbackSuccess.window.__sehSupabaseSdkReady,true);
assert.equal(fallbackSuccess.window.__sehSupabaseSdkLoadFailed,false);

const fallbackFailure = harness();
fallbackFailure.window.__sehSupabaseSdkFallbackFailed();
assert.equal(fallbackFailure.window.__sehSupabaseSdkLoadFailed,true);
assert.match(fallbackFailure.box.textContent,/دو منبع/);

const lateFailure = harness();
lateFailure.document.readyState='complete';
lateFailure.window.__sehSupabaseSdkFailed();
assert.equal(lateFailure.window.__sehSupabaseSdkLoadFailed,true);
assert.match(lateFailure.box.textContent,/دو منبع/);

console.log('PASS: parser-ordered Supabase fallback, success and terminal failure paths');
