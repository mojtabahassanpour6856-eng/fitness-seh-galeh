const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const production = fs.readFileSync('index.html', 'utf8');
const experiment = fs.readFileSync('experiments/production-derived-index.html', 'utf8');

function normalizeForComparison(source) {
  source = source.replace(
    'let currentWorkoutPlanId=null;\\nlet workoutExercisesCache=[];\\nlet currentWorkoutPlanBaseline=null;\\nlet workoutPlanSaveBusy=false;',
    'let currentWorkoutPlanId=null;\\nlet workoutExercisesCache=[];'
  );
  const start = source.indexOf('async function loadWorkoutForClient()');
  const end = source.indexOf('async function saveProgress()', start);
  assert.ok(start >= 0 && end > start, 'workout editor section boundaries must exist');
  return source.slice(0, start) + '__WORKOUT_EDITOR_SECTION__' + source.slice(end);
}

assert.equal(
  normalizeForComparison(experiment),
  normalizeForComparison(production),
  'outside the explicitly replaced coach workout editor section, the experiment must remain byte-for-byte identical to production'
);
console.log('PASS: all HTML and JavaScript outside the isolated coach workout editor section is identical to production');

const saveStart = experiment.indexOf('async function saveWorkoutPlan()');
const addStart = experiment.indexOf('async function addWorkoutExercise()', saveStart);
const progressStart = experiment.indexOf('async function saveProgress()', addStart);
assert.ok(saveStart >= 0 && addStart > saveStart && progressStart > addStart);
const save = experiment.slice(saveStart, addStart);
const addDelete = experiment.slice(addStart, progressStart);

assert.match(save, /sbWrite\\('\/rpc\/save_trainee_workout_plan_transaction','POST',payload\\)/);
assert.match(save, /p_expected_snapshot:planId\?baseline:null/);
assert.match(save, /currentWorkoutPlanBaseline/);
assert.doesNotMatch(save, /sbWrite\(['"`]\/trainee_workout_plans/);
assert.doesNotMatch(save, /sbWrite\(['"`]\/trainee_workout_exercises/);
assert.match(addDelete, /workoutExercisesCache\.push\(/);
assert.match(addDelete, /workoutExercisesCache=workoutExercisesCache\.filter/);
assert.doesNotMatch(addDelete, /sbWrite\(/);
console.log('PASS: save uses only the atomic RPC; add/delete stage changes locally without legacy table writes');

const baseline = experiment.indexOf('currentWorkoutPlanBaseline=buildWorkoutPlanSnapshot(p,rows)');
assert.ok(baseline >= 0, 'baseline snapshot must be captured from loaded plan and exercise rows');
assert.match(experiment.slice(experiment.indexOf('async function loadWorkoutForClient()'), experiment.indexOf('function buildWorkoutPlanSnapshot')),
  /currentWorkoutPlanBaseline=null/);
console.log('PASS: baseline snapshot is captured on load and cleared for a trainee without a plan');

const scriptBlocks = [...experiment.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
let parsed = 0;
for (const match of scriptBlocks) {
  const attrs = match[1] || '';
  const body = match[2] || '';
  if (/\bsrc\s*=/.test(attrs) || /application\/(ld\+json|json)/i.test(attrs) || !body.trim()) continue;
  new vm.Script(body, { filename: 'production-derived-index.html:inline-script-' + (++parsed) });
}
assert.ok(parsed > 0, 'at least one inline JavaScript block must be parsed');
console.log('PASS: all inline JavaScript blocks parse without syntax errors (' + parsed + ' blocks)');
