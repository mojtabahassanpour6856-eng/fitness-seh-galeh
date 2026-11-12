const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');

// The coach's trainee profile must not contain a shortcut that duplicates
// the dedicated nutrition-plan section in the main navigation.
assert.doesNotMatch(html, /onclick="openClientMealPlan\(\)">🍽️ برنامه غذایی این شاگرد/,
  'the meal-plan shortcut must be removed from the trainee profile');

// The coach profile save path must reload the saved record and immediately
// synchronize the visible profile fields without requiring a page refresh.
const saveStart = html.indexOf('async function saveProfile(){');
assert.notEqual(saveStart, -1, 'coach saveProfile implementation is missing');
const saveEnd = html.indexOf('async function saveProfileExtras', saveStart);
assert.ok(saveEnd > saveStart, 'could not locate end of coach saveProfile implementation');
const saveBlock = html.slice(saveStart, saveEnd);
assert.match(saveBlock, /await loadClients\(\)/, 'save must reload the current trainee record');
assert.match(saveBlock, /Immediately synchronize the visible profile/, 'immediate UI synchronization hook is missing');
for (const id of ['pn', 'pweight', 'pheight', 'page', 'pbirth', 'pgoal', 'plevel', 'ptype', 'pequipment']) {
  assert.match(saveBlock, new RegExp('\\["' + id + '"'), 'profile field is not synchronized: ' + id);
}
assert.match(saveBlock, /renderTraineeProfileHeader/, 'profile header refresh hook is missing');

console.log('PASS: profile saves synchronize visible fields immediately and the profile meal shortcut is absent.');
