const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');

const loadStart = html.indexOf('let nutritionLoadGeneration=0;');
assert.notEqual(loadStart, -1, 'nutrition load generation guard is missing');
const loadEnd = html.indexOf('\nasync function sbApiHeaders', loadStart);
assert.ok(loadEnd > loadStart, 'could not locate end of nutrition loader');
const loader = html.slice(loadStart, loadEnd);

assert.ok(loader.includes('const loadGeneration=++nutritionLoadGeneration'), 'each nutrition load must receive a unique generation');
assert.ok(loader.includes('const isCurrentLoad=()=>loadGeneration===nutritionLoadGeneration&&sameTrainee()'), 'stale loads must be discarded after trainee switch or a newer load');
assert.ok(loader.includes('if(!isCurrentLoad())return;'), 'stale requests must not render or report errors');
assert.ok(loader.includes('window.__sehLastNutritionLoadError=diagnostic'), 'persistent failures must remain available for diagnostics');
assert.ok(loader.includes("window.dispatchEvent(new CustomEvent(\"seh:nutrition-load-error\""), 'persistent failures must emit a diagnostic event');
assert.ok(loader.includes('console.error("Nutrition load failed; non-blocking diagnostic:"'), 'persistent failures must be logged');
assert.doesNotMatch(loader, /alert\("دریافت برنامه غذایی از Supabase انجام نشد/, 'background nutrition failures must not interrupt trainees with an alert');

const apiStart = html.indexOf('async function sbGet(path){');
const apiEnd = html.indexOf('\nasync function sbWrite', apiStart);
assert.ok(apiStart >= 0 && apiEnd > apiStart, 'could not locate sbGet');
const sbGet = html.slice(apiStart, apiEnd);
assert.ok(sbGet.includes('transientRetried=false'), 'GET requests must track the transient retry');
assert.ok(sbGet.includes('[408,425,429,500,502,503,504]'), 'common transient HTTP responses must be retried');
assert.ok(sbGet.includes('if(!transientRetried'), 'transient retry must happen at most once');
assert.ok(sbGet.includes('networkRetried=true'), 'network failures must retain the existing one-time retry');
assert.ok(sbGet.includes('authRetried=true'), 'expired sessions must retain the existing refresh-and-retry path');
assert.ok(sbGet.includes('schemaRetried=true'), 'schema-cache failures must retain the existing retry path');

const logoutStart = html.indexOf('async function logoutApp(){');
const logoutEnd = html.indexOf('\nasync function initAuth', logoutStart);
assert.ok(logoutStart >= 0 && logoutEnd > logoutStart, 'could not locate logout handler');
const logout = html.slice(logoutStart, logoutEnd);
assert.ok(logout.includes('nutritionLoadGeneration++'), 'logout must invalidate pending nutrition loads');
assert.ok(logout.includes('currentClient=null;currentPlanId=null;'), 'logout must clear selected trainee and plan references');

assert.ok(html.includes("if(event==='SIGNED_OUT')"), 'auth sign-out events must invalidate pending nutrition reads');
console.log('PASS: nutrition loading retries transient GET failures once, suppresses blocking alerts, logs persistent errors, and discards stale-session responses.');
