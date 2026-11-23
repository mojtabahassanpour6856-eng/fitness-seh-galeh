'use strict';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('./migrations/20261123_supabase_mirror_compatible_atomic_recovery_candidate.sql', import.meta.url), 'utf8');
assert.match(sql, /LOCK TABLE public\.trainee_password_recovery_requests IN SHARE ROW EXCLUSIVE MODE/);
assert.match(sql, /status IN \('pending','approved','processing'\)/);
assert.match(sql, /Historical recovery rows lack verified request-time coach binding/);
assert.match(sql, /WHERE request_coach_user_id IS NULL/);
// Never infer the historical approving coach from the trainee's current coach assignment.
assert.doesNotMatch(sql, /UPDATE public\.trainee_password_recovery_requests\s+r[\s\S]{0,500}FROM public\.trainees\s+t/i);
assert.match(sql, /ALTER COLUMN request_coach_user_id SET NOT NULL/);
assert.match(sql, /CREATE UNIQUE INDEX trainee_password_recovery_one_open_request_per_trainee/);
console.log('PASS: migration preflight locks the target table, rejects active legacy requests, and refuses to invent historical coach ownership.');
