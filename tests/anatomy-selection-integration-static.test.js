const fs=require('node:fs');
const assert=require('node:assert/strict');
const controller=fs.readFileSync('experiments/anatomy-selection-integration.js','utf8');
const adapter=fs.readFileSync('experiments/anatomy-exercise-adapter.js','utf8');
const html=fs.readFileSync('experiments/anatomy-smart-prototype.html','utf8');
assert.match(controller,/pairing_status==='reviewed'/,'bilateral selection must require completed anatomy review');
assert.doesNotMatch(controller,/pairing_status==='candidate_pending_anatomical_review'/,'candidate status must not enable bilateral selection');
assert.match(controller,/left\.length===1&&right\.length===1/,'both side geometries must be unique');
assert.match(controller,/setExercises\(rows\)/,'host app must explicitly supply authenticated trainer exercises');
assert.match(controller,/clearExercises\(\)/,'host app must be able to clear exercise data on logout');
assert.doesNotMatch(controller,/supabase|service_role|anon_key/i,'prototype must not embed backend credentials or fetch database directly');
assert.match(html,/anatomy-exercise-adapter\.js/,'prototype must load exercise adapter');
assert.match(html,/anatomy-selection-integration\.js/,'prototype must load selection controller');
assert.match(adapter,/role:null/,'main/assisting role must remain unset until sourced');
console.log('PASS: paired-selection safety gate, authenticated host handoff, no direct DB credentials, and script wiring.');

assert.match(controller,/keyFor\(p,index\)===key/,'SVG path lookup must use stable data-key, not child order');
assert.match(controller,/function escapeHtml/,'dynamic labels and exercise identifiers must be HTML-escaped');

assert.match(controller,/const countNode=document\.getElementById\('count'\)/,'controller must use explicit count DOM reference');
assert.match(controller,/selectedNode\.innerHTML/,'controller must use explicit selected-list DOM reference');
assert.doesNotMatch(controller,/(?<![A-Za-z])count\.textContent/,'controller must not rely on implicit window ID globals');
assert.doesNotMatch(controller,/(?<![A-Za-z])selected\.innerHTML/,'controller must not rely on implicit window ID globals');
