'use strict';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const base = new URL('.', import.meta.url);
const handler = await readFile(new URL('./recovery-candidate-handler.mjs', base), 'utf8');
const migration = await readFile(new URL('./migrations/20261122_recovery_atomic_rpc_candidate.sql', base), 'utf8');
const cleanup = await readFile(new URL('./migrations/20261122_dispose_expired_legacy_approved_request.sql', base), 'utf8');
const core = await readFile(new URL('./recovery-candidate-core.mjs', base), 'utf8');

const wrappers = [
  'recovery_submit_request',
  'recovery_coach_review',
  'recovery_record_wrong_attempt',
  'recovery_begin_delivery',
  'recovery_finish_delivery',
  'recovery_claim_reset',
  'recovery_begin_auth_update',
  'recovery_finish_auth_update'
];
for (const name of wrappers) {
  assert.match(migration, new RegExp('CREATE OR REPLACE FUNCTION public\\.' + name + '\\s*\\('), name + ' wrapper must exist');
  assert.match(handler, new RegExp("'" + name + "'"), name + ' must be called by handler');
  assert.match(migration, new RegExp('GRANT EXECUTE ON FUNCTION public\\.' + name), name + ' must have explicit grant');
}
for (const column of [
  'operation_id','processing_started_at','auth_outcome','auth_attempted_at',
  'auth_last_error_code','hmac_key_version','delivery_operation_id',
  'delivery_outcome','delivery_attempted_at'
]) {
  assert.match(migration, new RegExp('ADD COLUMN IF NOT EXISTS ' + column + '\\b'));
}
assert.match(handler, /profiles/);
assert.match(handler, /select\('role'\)/);
assert.match(handler, /trainees!inner\(full_name,coach_user_id\)/);
assert.match(handler, /trainees!inner\(phone_normalized,coach_user_id,approval_status,archived_at\)/);
assert.match(migration, /t\.approval_status = 'active'/);
assert.match(migration, /t\.archived_at IS NULL/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.recovery_submit_request\(text\) TO service_role/);
assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.recovery_[a-z_]+\([^;]+ TO anon/);

console.log('PASS: candidate handler RPC names, required migration columns, coach/profile fields, and service-role grants are statically aligned.');
