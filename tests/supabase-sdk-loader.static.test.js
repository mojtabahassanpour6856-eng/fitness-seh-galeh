'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const pinned = '@supabase/supabase-js@2.119.0';
assert.ok(html.includes('https://cdn.jsdelivr.net/npm/' + pinned), 'jsDelivr must use the exact tested SDK version');
assert.ok(html.includes('https://unpkg.com/' + pinned), 'fallback CDN must use the same exact SDK version');
assert.doesNotMatch(html, /@supabase\/supabase-js@2(?:["'/?]|$)/, 'floating major-version aliases must not remain');
assert.match(html, /<link rel="preload" as="script" href="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.119\.0"/);
assert.match(html, /<script id="seh-supabase-sdk"/, 'SDK script must have a stable identifier');
assert.match(html, /window\.AUTH_SUPABASE=window\.supabase\.createClient/, 'existing client initialization must remain intact');
assert.match(html, /credentials|localStorage/, 'existing app auth configuration must remain present');

const loaderMatch = html.match(/<script>\s*(\/\* SEH_SUPABASE_SDK_LOADER[\s\S]*?)<\/script>\s*<script id="seh-supabase-sdk"/);
assert.ok(loaderMatch, 'bounded loader must appear immediately before SDK script');
const loader = loaderMatch[1];

function makeHarness(){
  const timers = [];
  const box = {style:{},textContent:''};
  const tag = {dataset:{},src:'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0'};
  const window = {};
  const document = {getElementById(id){return id==='seh-supabase-sdk'?tag:id==='authError'?box:null;}};
  const context = {
    window, document,
    setTimeout(fn, ms){const t={fn,ms,cleared:false};timers.push(t);return t;},
    clearTimeout(t){if(t)t.cleared=true;}
  };
  vm.runInNewContext(loader, context);
  return {window,document,tag,box,timers};
}
const fallbackCase = makeHarness();
assert.equal(fallbackCase.timers[0].ms, 10000, 'primary attempt must have a 10s timeout');
fallbackCase.window.__sehSupabaseSdkFailed();
assert.equal(fallbackCase.tag.src, 'https://unpkg.com/@supabase/supabase-js@2.119.0', 'primary failure must switch to pinned fallback');
assert.equal(fallbackCase.tag.dataset.fallbackTried, '1', 'fallback must be attempted only once');
assert.equal(fallbackCase.timers.at(-1).ms, 10000, 'fallback attempt must also have a 10s timeout');
fallbackCase.window.__sehSupabaseSdkFailed();
assert.equal(fallbackCase.window.__sehSupabaseSdkLoadFailed, true, 'two failures must set a clear failure state');
assert.match(fallbackCase.box.textContent, /پس از دو تلاش/, 'two failures must show a Persian user-facing error');

const timeoutCase = makeHarness();
timeoutCase.timers[0].fn();
assert.equal(timeoutCase.tag.src, 'https://unpkg.com/@supabase/supabase-js@2.119.0', 'primary timeout must trigger fallback');

const successCase = makeHarness();
successCase.window.supabase = {createClient(){}};
successCase.window.__sehSupabaseSdkLoaded();
assert.equal(successCase.window.__sehSupabaseSdkReady, true, 'successful SDK load must be recorded');
assert.equal(successCase.window.__sehSupabaseSdkLoadFailed, false, 'successful SDK load must clear failure state');

console.log('PASS: pinned Supabase SDK, fallback, timeout and auth initialization checks');
