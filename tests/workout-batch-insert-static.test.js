const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const migration = fs.readFileSync('supabase/migrations/202610220002_restore_workout_id_defaults.sql', 'utf8');
const start = html.lastIndexOf('const chosen=groupMode');
assert.notEqual(start, -1, 'could not find the latest workout exercise save handler');
const end = html.indexOf('window.deleteWorkoutExercise', start);
assert.notEqual(end, -1, 'could not find end of workout exercise save handler');
const handler = html.slice(start, end);

const payload = handler.indexOf('const payloads=chosen.map');
const guard = handler.indexOf('window.__workoutAddBusy=true');
const batchWrite = handler.indexOf("inserted=await sbWrite('/trainee_workout_exercises','POST',payloads)");

assert.ok(payload >= 0, 'selected exercises should be converted into a row payload');
assert.ok(guard > payload, 'save lock should be enabled after payload preparation');
assert.ok(batchWrite > guard, 'one batch write should be sent after the save lock');
assert.ok(handler.includes('inserted.length!==payloads.length'), 'must validate returned row count');
assert.ok(handler.includes('same(row.workout_plan_id,planId)'), 'must validate returned plan ownership');
assert.ok(handler.includes('expectedIds.some((id,i)=>id!==returnedIds[i])'), 'must validate returned exercise IDs');
assert.ok(handler.includes('window.__workoutAddBusy=false'), 'must release save lock');
assert.ok(handler.includes('training_day|is_completed'), 'must retain optional-column compatibility fallback');

assert.ok(migration.includes("setval(") && migration.includes('trainee_workout_plans_id_seq'), 'must align plan sequence to existing IDs');
assert.ok(migration.includes("setval(") && migration.includes('trainee_workout_exercises_id_seq'), 'must align exercise sequence to existing IDs');
assert.ok(migration.includes('alter column id set default nextval'), 'must restore sequence-backed ID defaults');
assert.ok(migration.includes('exists(select 1 from public.trainee_workout_plans)'), 'empty plan table must reset sequence safely');
assert.ok(migration.includes('exists(select 1 from public.trainee_workout_exercises)'), 'empty exercise table must reset sequence safely');

console.log('PASS: mobile batch handler guards and validates saves; migration aligns sequences and restores ID defaults safely.');
