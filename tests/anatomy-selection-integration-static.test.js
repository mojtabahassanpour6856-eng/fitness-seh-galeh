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
assert.match(controller,/getSelectionSnapshot\(\)/,'host app can read selected muscle groups with their explicit primary/secondary roles');

const capturePage=fs.readFileSync('experiments/anatomy-preview-capture.html','utf8');
const workflow=fs.readFileSync('.github/workflows/anatomy-experiment-checks.yml','utf8');
assert.ok(capturePage.includes('^(male|female)-(front|back)$'),'capture page must validate all four view combinations');
for(const view of ['male-front','male-back','female-front','female-back']){
 assert.ok(workflow.includes('/tmp/anatomy-'+view+'.png'),'workflow must capture '+view);
}
assert.match(capturePage,/contentDocument/,'capture page must select the view inside the same-origin prototype frame');

assert.match(controller,/role:x\.role/,'selection snapshot must preserve the actual selected role');
assert.doesNotMatch(controller,/supabase|service_role|anon_key/i,'prototype must not embed backend credentials or fetch database directly');
assert.match(html,/anatomy-exercise-adapter\.js/,'prototype must load exercise adapter');
assert.match(html,/anatomy-selection-integration\.js/,'prototype must load selection controller');
assert.match(adapter,/role:null/,'main/assisting role must remain unset until sourced');

assert.match(controller,/keyFor\(p,index\)===key/,'SVG path lookup must use stable data-key, not child order');

assert.match(html,/function keyFor\(m,index\)[\s\S]*?Math\.imul/,'SVG path identity must be derived from geometry, not array position');
assert.match(html,/hashB=0x9e3779b9/,'path identity must use a second independent hash lane');
assert.match(html,/Duplicate anatomy geometry identity/,'rendering must fail closed on a geometry-key collision');
assert.doesNotMatch(html,/return \(m\.id\|\|m\.group\)\+"__"\+index/,'legacy ID-plus-index identity must not return');
assert.match(controller,/geometry-derived path keys must be unique/,'browser smoke must guard unique geometry keys');
assert.match(controller,/rendered keys must match stable source geometry keys/,'browser smoke must guard rendered/source key parity');

assert.match(controller,/function escapeHtml/,'dynamic labels and exercise identifiers must be HTML-escaped');
assert.match(controller,/const countNode=document\.getElementById\('count'\)/,'controller must use explicit count DOM reference');
assert.match(controller,/selectedNode\.innerHTML/,'controller must use explicit selected-list DOM reference');
assert.doesNotMatch(controller,/(?<![A-Za-z])count\.textContent/,'controller must not rely on implicit window ID globals');
assert.doesNotMatch(controller,/(?<![A-Za-z])selected\.innerHTML/,'controller must not rely on implicit window ID globals');

assert.match(controller,/const combos=\['male-front','male-back','female-front','female-back'\]/,'browser smoke must cover all four sex/view combinations');
assert.match(controller,/keyboard Enter selects muscle/,'browser smoke must validate keyboard selection');
assert.match(controller,/secondary color updates/,'browser smoke must validate assisting-muscle color');
assert.match(controller,/clear button resets current view/,'browser smoke must validate clear action');
assert.match(controller,/click must not select adjacent muscles/,'browser smoke must ensure a tap affects only the targeted SVG path');
assert.match(controller,/neighboring muscle color remains unchanged/,'browser smoke must ensure adjacent muscle colors remain unchanged');
assert.match(controller,/role conversion must preserve a single selected path/,'browser smoke must validate role conversion without duplicate selection');
assert.match(controller,/clearing front view must preserve back-view selection/,'browser smoke must validate selection isolation between views');
assert.match(controller,/clear button resets only current view/,'browser smoke must validate view-scoped clear behavior');

console.log('PASS: anatomy selection safety gates, four-view capture, keyboard/touch smoke coverage, role snapshots, and secure host handoff.');
