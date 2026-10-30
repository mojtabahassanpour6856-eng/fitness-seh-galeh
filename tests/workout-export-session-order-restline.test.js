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
  html.includes('const ordinal={اولین:1,اول:1,دوم:2,سوم:3,چهارم:4') &&
  html.includes("const m=text.match(/(?:جلسه|روز)\\s*(?:ی\\s*)?(اولین|اول|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم|[۰-۹0-9]+)/);"),
  'Export ordering must understand Persian ordinal session names such as جلسه اول and جلسه دوم, not fall back to sort_order.'
);
assert(
  html.includes("setImportant(el,'font-size','20px');") &&
  html.includes("setImportant(el,'font-size','23px');") &&
  html.includes('let next=current*1.25;'),
  'PNG export must preserve readable exercise text while using the compact prescription and rest sizes.'
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
assert(
  html.includes('const scanScale=Math.min(1,800/Math.max(sourceW,sourceH));') &&
  html.includes('scanCtx.getImageData(0,0,scanW,scanH)'),
  'PNG whitespace detection must scan a downscaled thumbnail to limit mobile memory and CPU use.'
);
assert(
  html.includes("link.download=imageFile.name;") && html.includes("link.click();link.remove();"),
  'PNG download must create and click a named download link.'
);
assert(
  html.includes('const footerHeight=170;') &&
  html.includes("ctx.fillText('باشگاه فیتنس سه‌قلعه | مربی من'") &&
  html.includes("ctx.fillText('FITNESS SEH GALEH'") &&
  html.includes('ctx.moveTo(90,footerTop+18)'),
  'Every workout PNG must draw the horizontal divider, Persian gym branding, and small English brand text on the final A4 canvas.'
);
assert(
  html.includes("if(coachFooter.lastElementChild)coachFooter.lastElementChild.style.setProperty('display','none','important');"),
  'The old HTML branding must be hidden during capture to prevent duplicate footer branding; coach notes remain in the content.'
);
console.log('Workout PNG session-order, font-size, set-label, and rest-format regression checks passed.');
