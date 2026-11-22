'use strict';

// Safe HTTP smoke checks only. This script sends OPTIONS and GET requests;
// it never submits a recovery request, approves/rejects a request, or resets a password.
// Run only against the isolated Supabase Test function:
// RECOVERY_TEST_FUNCTION_URL=https://<test-project-ref>.supabase.co/functions/v1/trainee-password-recovery node docs/experimental/test-recovery-http-smoke.js

const baseUrl = process.env.RECOVERY_TEST_FUNCTION_URL;
if (!baseUrl) {
  console.error('Set RECOVERY_TEST_FUNCTION_URL to the isolated Test function URL.');
  process.exit(2);
}
const url = new URL(baseUrl);
if (!url.hostname.endsWith('.supabase.co') || !url.pathname.endsWith('/functions/v1/trainee-password-recovery')) {
  throw new Error('Refusing to run: URL must target the expected Supabase Edge Function path.');
}

async function main() {
  const origin = 'https://recovery-smoke.invalid';
  const preflight = await fetch(url, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, apikey, content-type'
    }
  });
  const allowOrigin = preflight.headers.get('access-control-allow-origin');
  const allowMethods = (preflight.headers.get('access-control-allow-methods') || '').toUpperCase();
  const allowHeaders = (preflight.headers.get('access-control-allow-headers') || '').toLowerCase();

  if (preflight.status < 200 || preflight.status >= 300) {
    throw new Error(`OPTIONS preflight returned HTTP ${preflight.status}`);
  }
  if (allowOrigin === '*') {
    throw new Error('FAIL: wildcard CORS is still enabled; configure an explicit app-origin allowlist.');
  }
  if (allowOrigin !== origin) {
    throw new Error(`FAIL: expected explicit CORS echo for test Origin; received ${String(allowOrigin)}`);
  }
  if (!allowMethods.includes('POST')) {
    throw new Error('FAIL: CORS preflight does not allow POST.');
  }
  for (const header of ['authorization', 'apikey', 'content-type']) {
    if (!allowHeaders.includes(header)) throw new Error(`FAIL: CORS preflight omits required header ${header}`);
  }

  // GET is intentionally used as a non-mutating method rejection probe.
  const methodProbe = await fetch(url, { method: 'GET', headers: { Origin: origin } });
  if (methodProbe.status !== 405) {
    throw new Error(`Expected GET to be rejected with 405, received ${methodProbe.status}`);
  }

  console.log('PASS: OPTIONS preflight accepted with explicit CORS allowlist.');
  console.log('PASS: GET method rejected with HTTP 405.');
  console.log('Safety: no POST action was sent; no database row, password, or SMS was touched.');
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
