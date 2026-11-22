'use strict';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const adapterPath = new URL('./trainee-password-recovery-edge-candidate.ts', import.meta.url);
const handlerPath = new URL('./recovery-candidate-handler.mjs', import.meta.url);
const adapter = await readFile(adapterPath, 'utf8');
const handler = await readFile(handlerPath, 'utf8');

assert.match(adapter, /docs\/experimental/);
assert.match(adapter, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(adapter, /SUPABASE_ANON_KEY/);
assert.match(adapter, /Deno\.serve\(handler\)/);
assert.match(adapter, /Intentionally no deliveryAdapter/);
assert.doesNotMatch(adapter, /deploy_edge_function|supabase\/functions/);
assert.doesNotMatch(adapter, /MEDIANA|api\.mediana|fetch\(/i);
assert.match(handler, /recovery_submit_request/);
assert.match(handler, /recovery_coach_review/);
assert.match(handler, /recovery_claim_reset/);
assert.match(handler, /recovery_begin_auth_update/);
assert.match(handler, /recovery_finish_auth_update/);
assert.match(handler, /deliveryAdapter/);
assert.match(handler, /p_outcome: 'unknown'/);
assert.doesNotMatch(handler, /console\.(log|error)/);
assert.doesNotMatch(handler, /fetch\(/i);

console.log('PASS: Edge adapter remains outside deploy path, has no provider/network sender, and wires only the reviewed candidate handler.');
