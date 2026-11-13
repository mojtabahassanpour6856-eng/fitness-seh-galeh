'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const pinned = '@supabase/supabase-js@2.119.0';
assert.ok(html.includes('https://cdn.jsdelivr.net/npm/' + pinned), 'primary CDN must use the exact SDK version');
assert.ok(html.includes('https://unpkg.com/' + pinned), 'fallback CDN must use the same exact SDK version');
assert.doesNotMatch(html, /@supabase\\/supabase-js@2(?:["'/?]|$)/, 'floating major-version aliases must not remain');
assert.match(html, /<link rel="preload" as="script" href="https:\\/\\/cdn\\.jsdelivr\\.net\\/npm\\/@supabase\\/supabase-js@2\\.119\\.0"/);
assert.match(html, /<script id="seh-supabase-sdk"/, 'primary SDK script must have a stable identifier');
assert.match(html, /window\\.AUTH_SUPABASE=window\\.supabase\\.createClient/, 'existing client initialization must remain intact');
assert.match(html, /localStorage/, 'existing auth storage configuration must remain present');

const loaderMatch = html.match(/<script>\\s*(\\/\\* SEH_SUPABASE_SDK_LOADER[\\s\\S]*?)<\\/script>\\s*<script id="seh-supabase-sdk"/);
assert.ok(loaderMatch, 'parser-blocking loader must appear immediately before SDK script');
const loader = loaderMatch[1];
assert.match(loader, /document\\.write\\(/, 'fallback must be inserted synchronously at the parser position');
assert.match(loader, /seh-supabase-sdk-fallback/, 'fallback must have its own script element');
assert.doesNotMatch(loader, /setTimeout|tag\\.src\\s*=|armTimeout/, 'no asynchronous src swap or ineffective parser-blocking timeout is allowed');

function makeHarness(){
  const box = {style:{},textContent:''};
  const writes = [];
  const window = {};
  const document = {
    getElementById(id){return id==='authError'?box:null;},
    write(markup){writes.push(markup);}
  };
  vm.runInNewContext(loader, {window,document});
  return {window,document,box,writes};
}

const fallbackCase = makeHarness();
fallbackCase.window.__sehSupabaseSdkFailed();
assert.equal(fallbackCase.writes.length, 1, 'primary failure must synchronously insert exactly one fallback script');
assert.ok(fallbackCase.writes[0].includes('https://unpkg.com/' + pinned), 'inserted fallback must use the pinned URL');
assert.ok(fallbackCase.writes[0].includes('onload="window.__sehSupabaseSdkLoaded()"'), 'fallback load must be verified before app initialization');
assert.ok(fallbackCase.writes[0].includes('onerror="window.__sehSupabaseSdkFailed()"'), 'fallback failure must be handled');
fallbackCase.window.__sehSupabaseSdkFailed();
assert.equal(fallbackCase.writes.length, 1, 'fallback must never be inserted more than once');
assert.equal(fallbackCase.window.__sehSupabaseSdkLoadFailed, true, 'two failures must set a clear failure state');
assert.match(fallbackCase.box.textContent, /از دو منبع/, 'two failures must show a Persian user-facing error');

const successCase = makeHarness();
successCase.window.supabase = {createClient(){}};
successCase.window.__sehSupabaseSdkLoaded();
assert.equal(successCase.window.__sehSupabaseSdkReady, true, 'successful primary load must be recorded');
assert.equal(successCase.window.__sehSupabaseSdkLoadFailed, false, 'successful load must clear failure state');

const fallbackSuccessCase = makeHarness();
fallbackSuccessCase.window.__sehSupabaseSdkFailed();
fallbackSuccessCase.window.supabase = {createClient(){}};
fallbackSuccessCase.window.__sehSupabaseSdkLoaded();
assert.equal(fallbackSuccessCase.window.__sehSupabaseSdkReady, true, 'successful fallback load must be recorded');
assert.equal(fallbackSuccessCase.window.__sehSupabaseSdkLoadFailed, false, 'successful fallback must clear failure state');

console.log('PASS: pinned SDK, parser-ordered fallback, single fallback, failure messaging and success paths');
