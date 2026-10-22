const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
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
assert.match(handler, /inserted\.length!==payloads\.length/, 'must validate returned row count');
assert.match(handler, /same\(row\.workout_plan_id,planId\)/, 'must validate returned plan ownership');
assert.match(handler, /expectedIds\.some\(\(id,i\)=>id!==returnedIds\[i\]\)/, 'must validate returned exercise IDs');
assert.match(handler, /window\.__workoutAddBusy=false/, 'must release save lock');
assert.match(handler, /training_day\|is_completed/i, 'must retain optional-column compatibility fallback');

console.log('PASS: latest app handler submits the selected group as one multi-row REST insert and validates the response.');
