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
  html.includes("setImportant(el,'font-size','22px');") &&
  html.includes("setImportant(el,'font-size','27px');") &&
  html.includes('let next=current*1.25;'),
  'PNG export must use larger exercise, prescription, and rest text.'
);
assert(
  html.includes("'<span class=\"rest\">'+esc(x.rest_seconds??0)+' S</span>'") &&
  html.includes("'<span class=\"rest\">'+esc(first.rest_seconds??0)+' S</span>'"),
  'PNG rest display must show only the seconds value followed by S, without the word rest.'
);
assert(
  html.includes("return '<span class=\"rx\">'+esc(base.reps)+' × '+esc(base.sets)+'</span>';") &&
  !html.includes("'+esc(base.sets)+' ست</span>"),
  'Workout prescription output must omit the Persian word ست.'
);
console.log('Workout PNG session-order, font-size, set-label, and rest-format regression checks passed.');
