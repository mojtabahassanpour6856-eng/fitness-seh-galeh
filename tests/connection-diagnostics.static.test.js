'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('experiments/connection-diagnostics.html', 'utf8');

assert.match(html, /<!doctype html>/i, 'diagnostics page must be a valid HTML document');
assert.match(html, /<html lang="fa" dir="rtl">/, 'page must preserve Persian RTL layout');
assert.match(html, /auth\/v1\/health/, 'must probe Supabase Auth health');
for (const host of [
  'mojtabahassanpour6856-eng.github.io',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com'
]) assert.ok(html.includes(host), 'missing network probe host: ' + host);

assert.match(html, /new AbortController\(\)/, 'each probe must be abortable');
assert.match(html, /setTimeout\(\(\)=>controller\.abort\(\),10000\)/, 'probe must have a bounded 10s timeout');
assert.match(html, /credentials:'omit'/, 'requests must not send cookies or credentials');
assert.match(html, /mode:'cors'/, 'cross-origin probes must use CORS mode');
assert.match(html, /cache:'no-store'/, 'probe responses must not be cached');

for (const forbidden of [/localStorage/, /sessionStorage/, /document\.cookie/, /Authorization\s*:/i, /apikey\s*:/i]) {
  assert.doesNotMatch(html, forbidden, 'diagnostics must not access or transmit private session data: ' + forbidden);
}
assert.match(html, /navigator\.onLine/, 'report should include browser online state');
assert.match(html, /serviceWorker\.getRegistrations/, 'report should include service worker registration state');
assert.match(html, /navigator\.clipboard\.writeText/, 'user must explicitly copy report');
console.log('PASS: connection diagnostics static safety checks');
