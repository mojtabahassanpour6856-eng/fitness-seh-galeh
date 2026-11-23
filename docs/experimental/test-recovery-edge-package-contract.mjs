'use strict';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const root = new URL('../../supabase/functions/trainee-password-recovery/', import.meta.url);
const adapter = await readFile(new URL('index.ts', root), 'utf8');
const handler = await readFile(new URL('recovery-candidate-handler.mjs', root), 'utf8');
const core = await readFile(new URL('recovery-candidate-core.mjs', root), 'utf8');
const crypto = await readFile(new URL('recovery-delivery-payload-crypto.mjs', root), 'utf8');
const sdk = await readFile(new URL('../../vendor/SUPABASE-SDK-VERSION.txt', import.meta.url), 'utf8');
assert.match(adapter, /Deno\.serve\(handler\)/);
assert.match(adapter, /@supabase\/supabase-js@2\.119\.0/);
assert.equal(sdk.match(/Version:\s*(\S+)/)?.[1], '2.119.0');
assert.match(adapter, /\.\/recovery-candidate-handler\.mjs/);
assert.match(handler, /\.\/recovery-candidate-core\.mjs/);
assert.match(handler, /\.\/recovery-delivery-payload-crypto\.mjs/);
assert.match(handler, /Intentionally no deliveryAdapter/);
assert.match(handler, /recovery_coach_review_encrypted/);
assert.match(handler, /recovery_outcome_unknown|p_outcome: 'unknown'/);
assert.match(core, /assertRecoverySecrets/);
assert.match(crypto, /AES-GCM/);
assert.doesNotMatch(adapter + handler, /MEDIANA|api\.mediana|deploy_edge_function/i);
for (const file of ['index.ts','recovery-candidate-handler.mjs','recovery-candidate-core.mjs','recovery-delivery-payload-crypto.mjs']) {
  await access(new URL(file, root));
}
console.log('PASS: deployment-shaped package has local module graph, pinned SDK, fail-closed provider boundary, and required crypto/handler primitives.');
