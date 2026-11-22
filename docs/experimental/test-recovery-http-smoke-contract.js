'use strict';

// Static safety checks for the live HTTP smoke harness.
// These checks do not contact Supabase and prove the harness cannot submit recovery mutations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('docs/experimental/test-recovery-http-smoke.js', 'utf8');

assert.match(source, /method:\s*'OPTIONS'/, 'harness must include a preflight-only probe');
assert.match(source, /method:\s*'GET'/, 'harness must include a non-mutating method probe');
assert.match(source, /status !== 405/, 'GET probe must require HTTP 405');
assert.match(source, /RECOVERY_ALLOWED_ORIGIN/, 'the allowed app origin must be explicit');
assert.match(source, /not-allowlisted\.invalid/, 'an unapproved synthetic origin must be tested');
assert.match(source, /allow-origin.*approved\.origin|allow-origin/i, 'harness must inspect CORS allow-origin');
assert.doesNotMatch(source, /method:\s*'POST'/i, 'harness must never issue a POST');
assert.doesNotMatch(source, /method:\s*\"POST\"/i, 'harness must never issue a POST');
assert.doesNotMatch(source, /new_password|action:\s*['\"]reset|action:\s*['\"]request|action:\s*['\"]review/i,
  'harness must not contain recovery action payloads');
assert.match(source, /endsWith\('\.supabase\.co'\)/, 'harness must refuse non-Supabase hosts');
assert.match(source, /functions\/v1\/trainee-password-recovery/, 'harness must pin the expected function path');

console.log('PASS: HTTP smoke harness is constrained to OPTIONS/GET and has no recovery mutation payload.');
