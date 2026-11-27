const fs=require('node:fs');
const assert=require('node:assert/strict');
const vm=require('node:vm');

const html=fs.readFileSync('experiments/anatomy-geometry-inspector.html','utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'inspector must contain its interactive script');
new vm.Script(script,{filename:'anatomy-geometry-inspector.inline.js'});

assert.match(html,/id="exportJson"/,'JSON export control must exist');
assert.match(html,/id="exportCsv"/,'CSV export control must exist');
assert.match(html,/id="exportSvg"/,'vector SVG image export control must exist');
assert.match(html,/id="exportReport"/,'printable geometry review report control must exist');
assert.match(script,/function selectedPathRecords\(\)/,'exports must be built from selected paths only');
assert.match(script,/path_d:target\.getAttribute\('d'\)/,'export must preserve raw SVG path data');
assert.match(script,/function exportSelected\(format\)/,'JSON and CSV export handler must exist');
assert.match(script,/function exportSelectedSvg\(\)/,'selected-path vector image export must exist');
assert.match(script,/new XMLSerializer\(\)\.serializeToString\(clone\)/,'SVG export must serialize a standalone vector image');
assert.match(script,/JSON\.stringify\(payload,null,2\)/,'JSON export must be readable and structured');
assert.match(script,/const csv='\\uFEFF'/,'CSV must start with a UTF-8 BOM');
assert.match(script,/join\('\\r\\n'\)/,'CSV rows must use CRLF delimiters');
assert.match(script,/v\.replace\(/,'CSV cells must escape embedded quotes');
assert.match(script,/URL\.revokeObjectURL\(url\)/,'temporary download URL must be revoked');
assert.match(script,/if\(!records\.length\)/,'export must fail safely when no path is selected');
assert.match(script,/warning_fa:/,'JSON export must warn that geometry is not anatomical validation');
assert.match(script,/تصویر برداری مسیرهای انتخاب‌شده/,'SVG image must include an anatomical-validation disclaimer');
assert.match(script,/copy\.style\.setProperty\('opacity',selected\?'1':'.16'\)/,'SVG image must isolate selected paths visually');
assert.match(script,/image\/svg\+xml/,'SVG image must download with the correct MIME type');
assert.match(script,/function exportReviewReport\(\)/,'printable review report handler must exist');
assert.match(script,/function escapeHtml\(value\)/,'report text must escape dynamic values');
assert.match(script,/@page\{size:A4 landscape/,'report must be formatted for A4 landscape printing');
assert.match(script,/svgMarkup/,'report must embed the selected-path vector illustration');
assert.match(script,/ملاحظات بازبینی متخصص/,'report must provide a specialist review notes area');
assert.match(script,/ذخیره PDF/,'report must offer browser print-to-PDF');
assert.match(script,/text\/html;charset=utf-8/,'report must download as UTF-8 HTML');
assert.match(script,/تأیید مرزها و نام‌گذاری آناتومیک نیازمند مرجع معتبر/,'report must state the anatomy validation limitation');

assert.match(html,/id="multiMode"/,'same-group multi-path review control must exist');
assert.match(script,/let activeKey='',compareKey='',compareMode=false,multiReview=false,reviewKeys=\[\]/,'multi-path review state must be explicit');
assert.match(script,/target\.dataset\.group!==currentGroup/,'multi-path mode must reject mixed muscle groups');
assert.match(script,/reviewKeys\.length>=6/,'multi-path mode must enforce a bounded six-path report');
assert.match(script,/const keys=multiReview\?reviewKeys:/,'exports and selection records must include every selected review path');
assert.match(script,/palette=\['#19130b','#7650a5','#167c80','#b56b22','#315f9b','#a13c54'\]/,'multi-path export must visually distinguish up to six paths');
assert.match(script,/repeat\('+Math\.min\(2,records\.length\)\+/,'multi-path report must use a readable two-column detail layout');
assert.match(script,/رنگ‌ها فقط برای تشخیص مسیرها هستند/,'multi-path mode must explain that colors are identifiers, not anatomy labels');

console.log('PASS: inspector inline JavaScript syntax and selected-path JSON/CSV export safeguards.');
