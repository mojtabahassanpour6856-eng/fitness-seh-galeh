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
const guard = handler.lastIndexOf('window.__workoutAddBusy=true');
const batchWrite = handler.indexOf("inserted=await sbWrite('/trainee_workout_exercises','POST',payloads)");

assert.ok(payload >= 0, 'selected exercises should be converted into a row payload');
assert.ok(guard > payload, 'save lock should be enabled after payload preparation');
assert.ok(batchWrite > guard, 'one batch write should be sent after the save lock');
const groupValidation = handler.indexOf("if((system==='triset'||system==='giant')&&chosen.length!==3)");
const planSave = handler.indexOf('await window.saveWorkoutPlan()');
const firstLock = handler.indexOf('window.__workoutAddBusy=true');
assert.ok(groupValidation >= 0 && groupValidation < planSave, 'invalid group selection must be rejected before creating/saving a plan');
assert.ok(firstLock >= 0 && firstLock < planSave, 'save lock must be enabled before awaiting plan creation to prevent duplicate taps');
const planSaveCatch = handler.slice(handler.indexOf('catch(saveError)'), handler.indexOf('const planId=currentWorkoutPlanId'));
assert.ok(planSaveCatch.includes('window.__workoutAddBusy=false') && planSaveCatch.includes("alert('ذخیره برنامه پیش از افزودن حرکات انجام نشد."), 'unexpected plan-save errors must release the busy lock and stop safely');
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


assert.ok(handler.indexOf("if(!same(currentTraineeId(),traineeId)||!same(currentWorkoutPlanId,planId))") < batchWrite, 'must cancel the insert if the selected trainee or plan changes before the write');
assert.ok(handler.includes("inserted.some(row=>!same(row.workout_plan_id,planId))"), 'must reject rows returned for a different workout plan');

const loadStart = html.lastIndexOf('window.loadWorkoutForClient=async function(){');
const loadEnd = html.indexOf('window.saveWorkoutPlan=async function(){', loadStart);
assert.ok(loadStart >= 0 && loadEnd > loadStart, 'could not find guarded workout loader');
const loadHandler = html.slice(loadStart, loadEnd);
assert.ok(loadHandler.includes('trainee_id=eq.\u0024{encodeURIComponent(traineeId)}'), 'workout plans must be queried only for the selected trainee');
assert.ok(loadHandler.includes('requestId!==workoutRequestSeq||!same(currentTraineeId(),traineeId)'), 'stale loads must not repaint a different trainee');

console.log('PASS: mobile batch handler guards and validates saves; migration aligns sequences and restores ID defaults safely.');
