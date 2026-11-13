'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

const html = fs.readFileSync('index.html', 'utf8');
const sdkPath = 'vendor/supabase-2.119.0.js';
const sdk = fs.readFileSync(sdkPath);
const version = fs.readFileSync('vendor/SUPABASE-SDK-VERSION.txt', 'utf8');
const checksumLine = fs.readFileSync(sdkPath + '.sha256', 'utf8').trim();
const actualHash = crypto.createHash('sha256').update(sdk).digest('hex');

assert.match(version, /@supabase\/supabase-js/);
assert.match(version, /Version: 2\.119\.0/);
assert.ok(checksumLine.startsWith(actualHash + '  ' + sdkPath), 'vendored SDK must match its recorded SHA-256');
assert.ok(sdk.length > 100000, 'vendored UMD bundle must be present and non-empty');
assert.match(sdk.toString('utf8').slice(0, 200), /^var supabase=/, 'vendor file must be the browser UMD bundle');

assert.ok(html.includes('<link rel="preload" as="script" href="./vendor/supabase-2.119.0.js">'), 'same-origin SDK should be preloaded');
assert.ok(html.includes('<script id="seh-supabase-sdk" src="./vendor/supabase-2.119.0.js"'), 'app must load the SDK from the same origin');
assert.ok(!html.includes('cdn.jsdelivr.net/npm/@supabase/supabase-js'), 'Supabase SDK must not depend on jsDelivr');
assert.ok(!html.includes('unpkg.com/@supabase/supabase-js'), 'Supabase SDK must not depend on unpkg');
assert.ok(html.includes('Supabase SDK unavailable; application startup stopped safely'), 'app startup must stop safely if local SDK is missing');
assert.ok(html.includes('window.AUTH_SUPABASE=window.supabase.createClient'), 'existing client initialization must remain intact');
assert.ok(html.includes('localStorage'), 'existing auth storage configuration must remain present');

const marker = html.indexOf('/* SEH_SUPABASE_SDK_LOADER');
assert.notEqual(marker, -1, 'local SDK load-state helper must exist');
const scriptStart = html.lastIndexOf('<script>', marker);
const scriptEnd = html.indexOf('</script>', marker);
assert.ok(scriptStart !== -1 && scriptEnd > marker, 'load-state helper must be inside a complete inline script');
const loader = html.slice(scriptStart + '<script>'.length, scriptEnd);
assert.ok(!loader.includes('document.write('), 'load-state helper must not use parser-time document.write fallback');

function harness(){
  const box = {style:{}, textContent:''};
  const window = {};
  const document = {getElementById(id){return id==='authError'?box:null;}};
  vm.runInNewContext(loader, {window, document});
  return {window, box};
}
const success = harness();
success.window.supabase = {createClient(){}};
success.window.__sehSupabaseSdkLoaded();
assert.equal(success.window.__sehSupabaseSdkReady, true);
assert.equal(success.window.__sehSupabaseSdkLoadFailed, false);

const failure = harness();
failure.window.__sehSupabaseSdkFailed();
assert.equal(failure.window.__sehSupabaseSdkLoadFailed, true);
assert.ok(failure.box.textContent.includes('فایل داخلی برنامه'));

console.log('PASS: same-origin pinned Supabase SDK, SHA-256 integrity, load success and failure handling');
