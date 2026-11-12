const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');

// The coach's trainee profile must not contain a shortcut that duplicates
// the dedicated nutrition-plan section in the main navigation.
assert.doesNotMatch(html, /onclick="openClientMealPlan\\(\\)">🍽️ برنامه غذایی این شاگرد/,
  'the meal-plan shortcut must be removed from the trainee profile');

// The effective coach save handler is the later saveCoachProfile override,
// not the legacy global saveProfile function. Test the handler that actually
// receives clicks from the coach profile.
const coachStart = html.indexOf('async function saveCoachProfile(){');
assert.notEqual(coachStart, -1, 'effective coach save handler is missing');
const coachEnd = html.indexOf('\n  window.saveProfile = async function(){', coachStart);
assert.ok(coachEnd > coachStart, 'could not locate end of effective coach save handler');
const coachBlock = html.slice(coachStart, coachEnd);

assert.match(coachBlock, /await window\\.loadClients\\(\\)/, 'coach save must reload the trainee record');
assert.match(coachBlock, /const visibleFields\\s*=|const fieldsToRefresh\\s*=/,
  'coach save must explicitly refresh visible profile fields');
for (const id of ['pn', 'pweight', 'pheight', 'page', 'pbirth', 'pgoal', 'plevel', 'ptype', 'pequipment']) {
  assert.match(coachBlock, new RegExp('\\\\[\\'' + id + '\\''),
    'coach profile field is not synchronized: ' + id);
}
assert.match(coachBlock, /currentClient\\s*=\\s*updated/, 'current trainee record must be replaced after save');
assert.match(coachBlock, /renderClients/, 'coach trainee list must refresh after save');
assert.match(coachBlock, /jalaliToISODate/, 'coach save must persist the birth date field');
assert.match(coachBlock, /isoToJalaliDate/, 'coach save must display the saved birth date');

console.log('PASS: the effective coach save handler refreshes every visible profile field, including birth date.');
