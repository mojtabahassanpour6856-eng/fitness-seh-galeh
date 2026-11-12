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


// The final runtime override handles the trainee's own profile. Check the last
// assignment because earlier legacy wrappers are intentionally superseded.
const traineeSaveStart = html.lastIndexOf("window.saveProfile = async function(){");
assert.notEqual(traineeSaveStart, -1, 'final saveProfile override is missing');
const traineeSaveEnd = html.indexOf("\n  };\n\n  function init(){", traineeSaveStart);
assert.ok(traineeSaveEnd > traineeSaveStart, 'could not locate final trainee save handler');
const traineeBlock = html.slice(traineeSaveStart, traineeSaveEnd);

assert.ok(traineeBlock.includes("profile.trainee_id"), 'trainee save must remain bound to the authenticated trainee id');
assert.ok(traineeBlock.includes("toAsciiDigits"), 'trainee numeric inputs must normalize Persian and Arabic digits');
assert.ok(traineeBlock.includes("parsePositiveNumber"), 'trainee numeric inputs must be validated before saving');
assert.ok(traineeBlock.includes("if(age.present)"), 'blank age must not overwrite an existing saved age');
assert.ok(traineeBlock.includes("if(weight.present)"), 'blank weight must not overwrite an existing saved weight');
assert.ok(traineeBlock.includes("if(height.present)"), 'blank height must not overwrite an existing saved height');
assert.ok(traineeBlock.includes("payload.birth_date = birthISO"), 'trainee birth date must be converted and persisted when provided');
assert.ok(traineeBlock.includes("saved.birth_date"), 'trainee birth date must be verified from the database');
assert.ok(traineeBlock.includes("numericFields = ['age','current_weight','height','weekly_sessions']"), 'numeric profile fields must be verified after read-back');
assert.ok(traineeBlock.includes("currentClient = updated"), 'trainee in-memory profile must refresh from the saved database row');
assert.ok(traineeBlock.includes("document.querySelectorAll('#traineeDashboard .seh-profile-birth, .seh-profile-wrap .seh-profile-birth')"), 'birth date caption beside the trainee avatar must be selected for immediate refresh');
assert.ok(traineeBlock.includes("node.textContent = birthCaption ? '🎂 ' + birthCaption : '🎂 تاریخ تولد ثبت نشده'"), 'birth date beside avatar must update immediately without a page refresh');
for (const id of ['pn','page','pbirth','pweight','pheight','pgender','traineeProfileGender']) {
  assert.ok(traineeBlock.includes("setField('" + id + "'"), 'trainee visible profile field is not synchronized: ' + id);
}
assert.ok(html.includes('function sehOwnTraineeProfileId()'), 'photo actions must validate the authenticated trainee profile');
assert.ok(html.includes('originalTraineePhotoCommit.apply(this,arguments)'), 'photo crop commit must use the ownership guard');

console.log('PASS: the effective trainee self-profile save validates and verifies fields, preserves blanks, and refreshes the UI.');
