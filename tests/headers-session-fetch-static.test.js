const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('// Copy headers without passing a Headers object.');
assert.notEqual(start, -1, 'the safe header-copying patch should exist');
const end = html.indexOf('let authProfile=null;', start);
assert.notEqual(end, -1, 'the fetch wrapper should end before authProfile');
const wrapper = html.slice(start, end);

assert.match(wrapper, /const headers=new Headers\(\);/, 'construct an empty Headers object');
assert.match(wrapper, /sourceHeaders\.entries\(\)/, 'copy Headers through entries rather than the callback-based constructor');
assert.match(wrapper, /headers\.set\("apikey",SUPABASE_KEY\)/, 'retain the Supabase API key');
assert.match(wrapper, /headers\.set\("Authorization","Bearer "\+\(session\?\.access_token\|\|SUPABASE_KEY\)\)/, 'retain session authorization fallback');
assert.doesNotMatch(wrapper, /new Headers\(init\.headers/, 'do not pass potentially cross-context Headers into the constructor');

console.log('PASS: fetch wrapper copies headers without invoking the problematic Headers.forEach path.');
