'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const pinned = '@supabase/supabase-js@2.119.0';
assert.ok(html.includes('https://cdn.jsdelivr.net/npm/' + pinned), 'primary CDN must use the exact SDK version');
assert.ok(html.includes('https://unpkg.com/' + pinned), 'fallback CDN must use the same exact SDK version');
assert.ok(!html.includes('@supabase/supabase-js@2"'), 'floating major-version aliases must not remain');
assert.ok(html.includes('<link rel="preload" as="script" href="https://cdn.jsdelivr.net/npm/' + pinned + '"'), 'preload must match the pinned SDK');
assert.ok(html.includes('window.AUTH_SUPABASE=window.supabase.createClient'), 'existing client initialization must remain intact');
assert.ok(html.includes("if(!window.supabase||typeof window.supabase.createClient!=='function')"), 'startup must stop safely if both SDK loads fail');
assert.ok(html.includes('localStorage'), 'existing auth storage configuration must remain present');

const marker = html.indexOf('/* SEH_SUPABASE_SDK_LOADER');
const loaderStart = html.lastIndexOf('<script>', marker);
const loaderEnd = html.indexOf('</script>', marker);
assert.ok(marker >= 0 && loaderStart >= 0 && loaderEnd > marker, 'loader script boundaries must exist');
const loader = html.slice(marker, loaderEnd);
const primaryTag = html.indexOf('<script id="seh-supabase-sdk"');
const followingInit = html.indexOf('window.AUTH_SUPABASE=window.supabase.createClient', primaryTag);
assert.ok(primaryTag > loaderEnd && followingInit > primaryTag, 'parser-blocking SDK tag must precede app initialization');
assert.ok(loader.includes('document.write('), 'fallback must be inserted synchronously at parser position');
assert.ok(loader.includes('seh-supabase-sdk-fallback'), 'fallback must have a stable script identifier');
assert.ok(loader.includes("document.readyState==='loading'"), 'fallback insertion must be restricted to active HTML parsing');
assert.ok(!loader.includes('setTimeout') && !loader.includes('armTimeout') && !loader.includes('tag.src='), 'no asynchronous src swap or ineffective parser-blocking timeout is allowed');

function makeHarness(){
  const box = {style:{},textContent:''};
  const writes = [];
  const window = {};
  const document = {
    readyState:'loading',
    getElementById(id){return id==='authError'?box:null;},
    write(markup){writes.push(markup);}
  };
  vm.runInNewContext(loader, {window,document});
  return {window,box,writes};
}

const fallbackCase = makeHarness();
fallbackCase.window.__sehSupabaseSdkFailed();
assert.equal(fallbackCase.writes.length, 1, 'primary failure must insert exactly one fallback script');
assert.ok(fallbackCase.writes[0].includes('id="seh-supabase-sdk-fallback"'), 'inserted fallback must have a stable identifier');
assert.ok(fallbackCase.writes[0].includes('https://unpkg.com/' + pinned), 'inserted fallback must use the pinned URL');
assert.ok(fallbackCase.writes[0].includes('onload="window.__sehSupabaseSdkLoaded()"'), 'fallback load must be verified');
assert.ok(fallbackCase.writes[0].includes('onerror="window.__sehSupabaseSdkFallbackFailed()"'), 'fallback failure must be handled separately');
fallbackCase.window.__sehSupabaseSdkFallbackFailed();
assert.equal(fallbackCase.writes.length, 1, 'fallback must never be inserted more than once');
assert.equal(fallbackCase.window.__sehSupabaseSdkLoadFailed, true, 'two failures must set a clear failure state');
assert.ok(fallbackCase.box.textContent.includes('از دو منبع'), 'two failures must show a Persian error');

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

const lateFailureCase = makeHarness();
lateFailureCase.document.readyState = 'complete';
lateFailureCase.window.__sehSupabaseSdkFailed();
assert.equal(lateFailureCase.writes.length, 0, 'fallback must not use document.write after parsing is complete');
assert.equal(lateFailureCase.window.__sehSupabaseSdkLoadFailed, true, 'late failure must be surfaced safely');

console.log('PASS: pinned SDK, parser-ordered fallback, failure/success paths and startup guard');
