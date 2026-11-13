'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const pinned = '@supabase/supabase-js@2.119.0';
const localBundlePath = './vendor/supabase-2.119.0.js';
const localBundle = fs.readFileSync(localBundlePath);
const versionInfo = fs.readFileSync('./vendor/SUPABASE-SDK-VERSION.txt', 'utf8');
const checksumInfo = fs.readFileSync('./vendor/supabase-2.119.0.js.sha256', 'utf8');
const actualSha256 = crypto.createHash('sha256').update(localBundle).digest('hex');
assert.ok(versionInfo.includes('Version: 2.119.0'), 'vendored SDK version metadata must be exact');
assert.ok(checksumInfo.startsWith(actualSha256 + '  vendor/supabase-2.119.0.js'), 'vendored SDK checksum must match the actual bundle');
assert.ok(localBundle.length > 100000, 'vendored browser bundle must not be an empty placeholder');
assert.ok(html.includes('href="' + localBundlePath + '"'), 'preload must use the same-origin vendored SDK');
assert.ok(html.includes('src="' + localBundlePath + '"'), 'primary SDK must be loaded from the same origin');
assert.ok(!html.includes('https://cdn.jsdelivr.net/npm/' + pinned), 'primary SDK must not depend on a third-party CDN');
assert.ok(html.includes('https://unpkg.com/' + pinned), 'fallback CDN must use the same exact pinned SDK');
assert.ok(html.includes('<script id="seh-supabase-sdk"'), 'primary SDK script must have a stable identifier');
assert.ok(html.includes('Supabase SDK unavailable; application startup stopped safely'), 'app startup must stop safely if both SDK sources fail');
assert.ok(html.includes('window.AUTH_SUPABASE=window.supabase.createClient'), 'existing client initialization must remain intact');
assert.ok(html.includes('localStorage'), 'existing auth storage configuration must remain present');

const marker = html.indexOf('/* SEH_SUPABASE_SDK_LOADER');
assert.notEqual(marker, -1, 'loader marker must exist');
const scriptStart = html.lastIndexOf('<script>', marker);
const scriptEnd = html.indexOf('</script>', marker);
assert.ok(scriptStart !== -1 && scriptEnd > marker, 'loader must be inside a complete inline script');
const loader = html.slice(scriptStart + '<script>'.length, scriptEnd);
assert.ok(loader.includes('document.write('), 'primary failure must parser-write a blocking fallback');
assert.ok(!loader.includes('setTimeout') && !loader.includes('setInterval'), 'loader must not claim a JS timer can interrupt parser blocking');

function harness(){
  let written = '';
  const box = {style:{},textContent:''};
  const window = {};
  const document = {
    readyState:'loading',
    getElementById(id){return id==='authError'?box:null;},
    write(value){written += value;}
  };
  vm.runInNewContext(loader, {window, document});
  return {window, document, box, get written(){return written;}};
}

const failedPrimary = harness();
failedPrimary.window.__sehSupabaseSdkFailed();
assert.ok(failedPrimary.written.includes('src="https://unpkg.com/' + pinned + '"'), 'local primary failure must insert the exact pinned fallback script');
assert.ok(failedPrimary.written.includes('onload="window.__sehSupabaseSdkLoaded()"'), 'fallback must report successful load');
assert.ok(failedPrimary.written.includes('onerror="window.__sehSupabaseSdkFallbackFailed()"'), 'fallback must report terminal failure');

const fallbackSuccess = harness();
fallbackSuccess.window.supabase = {createClient(){}};
fallbackSuccess.window.__sehSupabaseSdkLoaded();
assert.equal(fallbackSuccess.window.__sehSupabaseSdkReady, true);
assert.equal(fallbackSuccess.window.__sehSupabaseSdkLoadFailed, false);

const fallbackFailure = harness();
fallbackFailure.window.__sehSupabaseSdkFallbackFailed();
assert.equal(fallbackFailure.window.__sehSupabaseSdkLoadFailed, true);
assert.ok(fallbackFailure.box.textContent.includes('دو منبع'));

const lateFailure = harness();
lateFailure.document.readyState = 'complete';
lateFailure.window.__sehSupabaseSdkFailed();
assert.equal(lateFailure.window.__sehSupabaseSdkLoadFailed, true);
assert.ok(lateFailure.box.textContent.includes('دو منبع'));

console.log('PASS: same-origin pinned Supabase SDK, checksum, parser-ordered fallback and safe terminal failure');
