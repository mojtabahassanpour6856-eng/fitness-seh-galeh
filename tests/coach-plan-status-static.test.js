const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const statsStart = html.lastIndexOf('window.updateStats=async function(){');
assert.notEqual(statsStart, -1, 'could not find the latest coach dashboard stats function');

const refreshGuard = html.indexOf('if(window.__sehPlanStatusRenderRefreshInProgress)return;', statsStart);
assert.ok(refreshGuard > statsStart, 'nested updateStats call must be suppressed during the status-ready rerender');

const refreshStart = html.indexOf('window.__sehPlanStatusRenderRefreshInProgress=true;', statsStart);
const renderCall = html.indexOf('window.renderClients();', refreshStart);
const refreshReset = html.indexOf('window.__sehPlanStatusRenderRefreshInProgress=false;', renderCall);
assert.ok(refreshStart > statsStart && renderCall > refreshStart && refreshReset > renderCall,
  'status-ready rerender must set the guard before rendering and reset it in finally');

const classifierStart = html.indexOf('const dateAgeDays=value=>', statsStart);
const classifierEnd = html.indexOf('const newestWorkoutByTrainee', classifierStart);
assert.ok(classifierStart > statsStart && classifierEnd > classifierStart, 'could not find plan status classifiers');
const classifierSource = html.slice(classifierStart, classifierEnd);
const sandbox = { todayMs: Date.parse('2026-10-27T00:00:00Z') };
vm.runInNewContext(classifierSource + '\nthis.classifyWorkoutPlan=classifyWorkoutPlan; this.classifyNutritionPlan=classifyNutritionPlan;', sandbox);

const workout = sandbox.classifyWorkoutPlan;
const nutrition = sandbox.classifyNutritionPlan;
assert.equal(workout(null), 'missing');
assert.equal(workout({ plan_date: '2026-10-03' }), 'active', '24-day workout should remain active');
assert.equal(workout({ plan_date: '2026-10-02' }), 'due', '25-day workout should be due');
assert.equal(workout({ plan_date: '2026-09-29' }), 'missing', '28-day workout should be expired');
assert.equal(workout({}), 'unknown', 'workout with no usable date should not be falsely marked active');
assert.equal(nutrition({ end_date: '2026-10-30', start_date: '2026-10-01' }), 'due', 'nutrition ending in three days should be due');
assert.equal(nutrition({ end_date: '2026-10-26' }), 'missing', 'expired nutrition should be missing');
assert.equal(nutrition({ is_active: false }), 'missing', 'inactive nutrition should be missing');
assert.equal(nutrition({}), 'unknown', 'nutrition with no usable dates should not be falsely marked active');

for (const filter of ['no-workout', 'no-nutrition', 'none', 'due']) {
  assert.ok(html.includes(`data-pf="${filter}"`), `missing coach plan filter: ${filter}`);
}
console.log('PASS: coach plan statuses, date boundaries, missing-date safety, filters, and refresh-loop guard.');
