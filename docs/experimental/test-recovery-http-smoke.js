'use strict';

// Non-mutating HTTP smoke checks. Sends OPTIONS and GET only; never sends recovery POSTs.
// RECOVERY_TEST_FUNCTION_URL=https://<test-ref>.supabase.co/functions/v1/trainee-password-recovery
// RECOVERY_ALLOWED_ORIGIN=https://<actual-test-app-origin>
// node docs/experimental/test-recovery-http-smoke.js

const baseUrl = process.env.RECOVERY_TEST_FUNCTION_URL;
const allowedOrigin = process.env.RECOVERY_ALLOWED_ORIGIN;
if (!baseUrl || !allowedOrigin) {
  console.error('Set RECOVERY_TEST_FUNCTION_URL and RECOVERY_ALLOWED_ORIGIN for the isolated Test deployment.');
  process.exit(2);
}
const url = new URL(baseUrl);
if (!url.hostname.endsWith('.supabase.co') || !url.pathname.endsWith('/functions/v1/trainee-password-recovery')) {
  throw new Error('Refusing to run: URL must target the expected Supabase Edge Function path.');
}
const approved = new URL(allowedOrigin);
if (!/^https?:$/.test(approved.protocol) || approved.origin !== allowedOrigin) {
  throw new Error('RECOVERY_ALLOWED_ORIGIN must be a single normalized http(s) origin.');
}

async function preflight(origin) {
  return fetch(url, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, apikey, content-type'
    }
  });
}

async function main() {
  const allowed = await preflight(approved.origin);
  const allowedHeader = allowed.headers.get('access-control-allow-origin');
  const methods = (allowed.headers.get('access-control-allow-methods') || '').toUpperCase();
  const headers = (allowed.headers.get('access-control-allow-headers') || '').toLowerCase();
  if (allowed.status < 200 || allowed.status >= 300) {
    throw new Error(`Allowed-origin OPTIONS returned HTTP ${allowed.status}`);
  }
  if (allowedHeader !== approved.origin) {
    throw new Error(`Expected exact configured allow-origin ${approved.origin}; received ${String(allowedHeader)}`);
  }
  if (!methods.includes('POST')) throw new Error('CORS preflight does not allow POST.');
  for (const name of ['authorization', 'apikey', 'content-type']) {
    if (!headers.includes(name)) throw new Error(`CORS preflight omits required header ${name}`);
  }

  const forbiddenOrigin = 'https://not-allowlisted.invalid';
  const forbidden = await preflight(forbiddenOrigin);
  const forbiddenHeader = forbidden.headers.get('access-control-allow-origin');
  if (forbiddenHeader === '*' || forbiddenHeader === forbiddenOrigin) {
    throw new Error('FAIL: an unapproved Origin was granted CORS access.');
  }

  const methodProbe = await fetch(url, { method: 'GET', headers: { Origin: approved.origin } });
  if (methodProbe.status !== 405) {
    throw new Error(`Expected GET to be rejected with 405, received ${methodProbe.status}`);
  }

  console.log('PASS: configured app origin receives the exact CORS allow-origin.');
  console.log('PASS: unapproved origin is not granted CORS access.');
  console.log('PASS: GET is rejected with HTTP 405.');
  console.log('Safety: no POST action was sent; no recovery row, password, or SMS was touched.');
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
