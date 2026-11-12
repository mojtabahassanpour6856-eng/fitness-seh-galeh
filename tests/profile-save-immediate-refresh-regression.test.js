const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');

// The coach's trainee profile must not contain a duplicate nutrition shortcut.
assert.doesNotMatch(html, /onclick="openClientMealPlan\(\)">🍽️ برنامه غذایی این شاگرد/,
  'the meal-plan shortcut must be removed from the trainee profile');

// Verify the effective handler used for coach accounts. The legacy function
// is overridden later in the page, so testing it alone gives a false positive.
const coachStart = html.indexOf('async function saveCoachProfile(){');
assert.notEqual(coachStart, -1, 'effective coach save handler is missing');
const coachEnd = html.indexOf('\n  window.saveProfile = async function(){', coachStart);
assert.ok(coachEnd > coachStart, 'could not locate end of effective coach save handler');
const coachBlock = html.slice(coachStart, coachEnd);

assert.ok(coachBlock.includes('await window.loadClients()'), 'coach save must reload the trainee record');
assert.ok(coachBlock.includes('const visibleFields = ['), 'coach save must explicitly refresh visible profile fields');
for (const id of ['pn', 'pweight', 'pheight', 'page', 'pbirth', 'pgoal', 'plevel', 'ptype', 'pequipment']) {
  assert.ok(coachBlock.includes("['" + id + "'"), 'coach profile field is not synchronized: ' + id);
}
assert.ok(coachBlock.includes('currentClient = updated'), 'current trainee record must be replaced after save');
assert.ok(coachBlock.includes('window.renderClients'), 'coach trainee list must refresh after save');
assert.ok(coachBlock.includes('jalaliToISODate'), 'coach save must persist the birth date field');
assert.ok(coachBlock.includes('isoToJalaliDate'), 'coach save must display the saved birth date');

console.log('PASS: the effective coach save handler refreshes every visible profile field, including birth date.');
