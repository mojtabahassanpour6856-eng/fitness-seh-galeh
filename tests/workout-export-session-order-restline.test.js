const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('index.html', 'utf8');

assert(
  html.includes("setImportant(el,'grid-column',index%2===0?'1':'2');"),
  'PNG sessions must place odd-numbered sessions in RTL grid column 1 (right) and even-numbered sessions in column 2 (left).'
);
assert(
  html.includes('class="rx rx-21"'),
  'The special 21-rep prescription must have a dedicated compact class.'
);
assert(
  html.includes("clonedDoc.querySelectorAll('.exercise-details:has(.rx-21)')"),
  'PNG clone must keep the 21-rep prescription and rest-time label on the same line.'
);
assert(
  html.includes("clonedDoc.querySelectorAll('.exercise-details:has(.rx-21) .rest')"),
  'The rest-time label next to a 21-rep prescription must receive explicit no-wrap sizing.'
);

console.log('Workout PNG session-order and 21-rep rest-line regression checks passed.');
