'use strict';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const adapterPath = new URL('./trainee-password-recovery-edge-candidate.ts', import.meta.url);
const handlerPath = new URL('./recovery-candidate-handler.mjs', import.meta.url);
const adapter = await readFile(adapterPath, 'utf8');
const handler = await readFile(handlerPath, 'utf8');
const sdkVersionPath = new URL('../../vendor/SUPABASE-SDK-VERSION.txt', import.meta.url);
const sdkVersionMarker = await readFile(sdkVersionPath, 'utf8');
const candidateSdkVersion = adapter.match(/@supabase\/supabase-js@(\d+\.\d+\.\d+)/)?.[1];
const appSdkVersion = sdkVersionMarker.match(/Version:\s*(\d+\.\d+\.\d+)/)?.[1];
assert.ok(candidateSdkVersion, 'candidate must pin an exact Supabase JS version');
assert.equal(candidateSdkVersion, appSdkVersion, 'candidate Auth adapter must use the same SDK version pinned by the app');

assert.match(adapterPath.pathname, /\/docs\/experimental\//);
assert.match(adapter, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(adapter, /SUPABASE_ANON_KEY/);
assert.match(adapter, /RECOVERY_HMAC_KEYS: Deno\.env\.get\("RECOVERY_HMAC_KEYS"\)/);
assert.match(adapter, /RECOVERY_DELIVERY_KEYS: Deno\.env\.get\("RECOVERY_DELIVERY_KEYS"\)/);
assert.match(adapter, /RECOVERY_DELIVERY_KEY_VERSION: Deno\.env\.get\("RECOVERY_DELIVERY_KEY_VERSION"\)/);
assert.doesNotMatch(adapter, /RECOVERY_HMAC_SECRET/);

assert.match(adapter, /Deno\.serve\(handler\)/);
assert.match(adapter, /Intentionally no deliveryAdapter/);
assert.doesNotMatch(adapter, /deploy_edge_function/);
assert.doesNotMatch(adapter, /MEDIANA|api\.mediana|fetch\(/i);
assert.match(handler, /recovery_submit_request/);
assert.match(handler, /recovery_coach_review/);
assert.match(handler, /delivery_status: 'queued'/);
assert.match(handler, /هنوز ارسال پیامک تأیید نشده است/);
assert.match(handler, /recovery_claim_reset/);
assert.match(handler, /recovery_begin_auth_update/);
assert.match(handler, /recovery_finish_auth_update/);
assert.doesNotMatch(handler, /deliveryAdapter|recovery_begin_delivery|recovery_finish_delivery/);
assert.match(handler, /p_outcome: 'unknown'/);
assert.doesNotMatch(handler, /console\.(log|error)/);
assert.doesNotMatch(handler, /fetch\(/i);

console.log('PASS: Edge adapter remains outside deploy path, has no provider/network sender, and wires only the reviewed candidate handler.');
