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

assert(
  html.includes("clonedDoc.querySelectorAll('.exercise-details').forEach(el=>"),
  'All system types must receive compact single-row PNG layout, not only 21-rep.'
);
assert(
  html.includes("clonedDoc.querySelectorAll('.exercise-details .rx').forEach(el=>"),
  'Prescription badges for every system must be compacted in the PNG clone.'
);
assert(
  html.includes("clonedDoc.querySelectorAll('.exercise-details .sys').forEach(el=>"),
  'System labels such as FST-7 and drop-set must use a compact single-line style.'
);
assert(
  html.includes("el.style.setProperty('flex-wrap','nowrap','important');") &&
  html.includes("el.style.setProperty('max-width','100%','important');"),
  'Exercise details must stay on one row within the available width without clipping text.'
);

console.log('Workout PNG session-order and compact all-systems regression checks passed.');
