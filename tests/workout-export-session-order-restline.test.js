const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('index.html', 'utf8');

assert(
  html.includes("doc.querySelectorAll('.session-grid .session-cell').forEach((el,index)=>{"),
  'PNG export must explicitly place every session instead of relying on RTL grid auto-placement.'
);
assert(
  html.includes("setImportant(el,'grid-column',index%2===0?'1':'2');"),
  'Session 1/3/5 must be in the right-hand column and session 2/4/6 in the left-hand column.'
);
assert(
  html.includes("setImportant(el,'grid-row',String(Math.floor(index/2)+1));"),
  'Sessions must stay in their numbered rows: 1/2, 3/4, 5/6.'
);
assert(
  html.includes('let next=current*1.25;') &&
  html.includes("next=Math.max(next,current+2);"),
  'PNG export must retain the established text enlargement for readable exercise names and prescriptions.'
);
console.log('Workout PNG session-order and readable-font regression checks passed.');
