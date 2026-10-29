const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const plannerStart = html.indexOf('<script id="seh-six-session-workout-planner">');
assert.notEqual(plannerStart, -1, 'six-session planner script must exist');
const plannerEnd = html.indexOf('</script>', plannerStart);
const planner = html.slice(plannerStart, plannerEnd);

const saveStart = planner.indexOf('async function validateAndSaveSession(){');
const saveEnd = planner.indexOf(' function install(){', saveStart);
assert.ok(saveStart >= 0 && saveEnd > saveStart, 'session save function must be present');
const save = planner.slice(saveStart, saveEnd);

assert.match(planner, /saveInFlight=false/, 'a shared in-flight lock must exist');
assert.match(planner, /if\(saveInFlight\)return;/, 'session switching must be blocked during a save');
assert.match(planner, /if\(saveInFlight\)\{alert\(/, 'a second save tap must be rejected while the first save is running');
assert.match(planner, /saveInFlight=true;[\s\S]*?button\.disabled=true/, 'the save lock and disabled button must be set synchronously');
assert.match(planner, /finally\{[\s\S]*?saveInFlight=false;[\s\S]*?button\.disabled=false/, 'the lock and button must be restored after success or failure');
assert.match(save, /const sessionIndex=active;\s*const sessionName=names\[sessionIndex\]/, 'save must snapshot the chosen session before awaiting');
assert.doesNotMatch(save, /names\[active\]/, 'save must not read a mutable active-session index after awaiting');
assert.match(save, /workout_plan_id:planId/, 'new rows must target the snapshotted plan id');
assert.match(save, /active!==sessionIndex/, 'save must abort if the active session changes');
assert.match(save, /verified\.length!==expectedCount/, 'save must verify the stored movement count');
assert.ok(save.indexOf('const verifiedBeforeCleanup=await sbGet') >= 0, 'desired rows must be read back before cleanup');
assert.ok(save.indexOf('if(missingExpected)throw new Error') < save.indexOf('for(const old of stale)'), 'stale rows must not be deleted unless every desired row is verified');
assert.match(save, /const expectedRows=wanted\\.flatMap/, 'verification must cover every selected exercise, including grouped movements');

console.log('PASS: workout session save is serialized, session-scoped, and count-verified.');
