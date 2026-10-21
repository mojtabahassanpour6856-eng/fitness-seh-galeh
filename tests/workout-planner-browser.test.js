const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ acceptDownloads: true });
  const failures = [];
  async function check(name, fn) {
    try { await fn(); console.log('PASS: ' + name); }
    catch (e) { failures.push(name + ': ' + e.message); console.error('FAIL: ' + name + '\n' + e.message); }
  }
  try {
    await page.goto('http://127.0.0.1:4173/experiments/workout-template-planner.html');
    await check('guided workflow navigates to settings, movement entry, and full preview', async () => {
      await page.locator('[data-step="planSetup"]').click();
      assert.equal(await page.locator('#planSetup').count(), 1);
      await page.locator('[data-step="planMoves"]').click();
      assert.equal(await page.locator('#planMoves').count(), 1);
      await page.locator('[data-step="planPreview"]').click();
      assert.ok((await page.locator('#workflowStatus').innerText()).includes('پیش‌نمایش کل برنامه'));
      assert.ok((await page.locator('#sessions').innerText()).includes('پرس سینه دمبل'), 'full workout preview should be rendered');
    });
    await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
    await check('default sample passes validation', async () => {
      assert.match(await page.locator('#status').innerText(), /بررسی اولیه موفق بود/);
    });
    await check('Ctrl+Enter validates and previews from the bulk movement editor', async () => {
      await page.locator('#bulk').focus();
      await page.keyboard.press('Control+Enter');
      assert.match(await page.locator('#status').innerText(), /بررسی اولیه موفق بود/);
      assert.ok((await page.locator('#sessions').innerText()).includes('پرس سینه دمبل'));
    });
    await check('triset renders all three movements with plus separators', async () => {
      const texts = await page.locator('.session').allInnerTexts();
      assert.ok(texts.some(t => t.includes('قایقی + فیس‌پول + پول‌اور سیم‌کش')), 'Three-movement group was not rendered together');
    });
    await check('preset loads and keeps two-session chest plan', async () => {
      await page.locator('#preset').selectOption('chest');
      await page.getByRole('button', { name: 'بارگذاری قالب آماده' }).click();
      assert.equal(await page.locator('#count').inputValue(), '2');
      assert.ok((await page.locator('#sessions').innerText()).includes('پرس سینه دمبل + قفسه سیم‌کش'));
    });
    await check('quick entry appends a valid movement without manual tab formatting', async () => {
      await page.locator('#bulk').evaluate(el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.locator('#count').selectOption('3');
      await page.locator('#quickSession').selectOption('2');
      await page.locator('#quickName').fill('پرس سینه آزمایشی');
      await page.locator('#quickSystem').selectOption('عادی');
      await page.locator('#quickSets').fill('4');
      await page.locator('#quickReps').fill('10');
      await page.locator('#quickRest').fill('75');
      await page.getByRole('button', { name: 'افزودن به فهرست' }).click();
      assert.equal(await page.locator('#bulk').inputValue(), ['پرس سینه آزمایشی', '2', 'عادی', '—', '4', '10', '75'].join('\t'));
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      assert.match(await page.locator('#status').innerText(), /بررسی اولیه موفق بود/);
      assert.ok((await page.locator('#sessions').innerText()).includes('پرس سینه آزمایشی'));
    });
    await check('Enter in quick movement name adds the movement without clicking the button', async () => {
      await page.locator('#bulk').evaluate(el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.locator('#count').selectOption('2');
      await page.locator('#quickName').fill('پرس پا با میانبر');
      await page.locator('#quickSession').selectOption('1');
      await page.locator('#quickName').press('Enter');
      assert.ok((await page.locator('#bulk').inputValue()).includes('پرس پا با میانبر'));
      assert.match(await page.locator('#quickStatus').innerText(), /اضافه شد/);
      assert.equal(await page.locator('#quickName').inputValue(), '', 'quick entry should clear the name for the next movement');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'quickName', 'quick entry should refocus the movement name field');
    });
    await check('invalid quick movement details do not change the existing plan', async () => {
      const before = await page.locator('#bulk').inputValue();
      await page.locator('#quickName').fill('حرکت با مقدار نامعتبر');
      await page.locator('#quickSets').fill('0');
      await page.getByRole('button', { name: 'افزودن به فهرست' }).click();
      assert.equal(await page.locator('#bulk').inputValue(), before, 'invalid input must not append or replace any movement');
      assert.match(await page.locator('#quickStatus').innerText(), /ست و تکرار باید عدد مثبت/);
      await page.locator('#quickSets').fill('3');
    });
    await check('quick session choices follow the selected number of workout sessions', async () => {
      await page.locator('#count').selectOption('2');
      assert.equal(await page.locator('#quickSession option[value="3"]').isDisabled(), true, 'session 3 should be unavailable for a two-session plan');
      await page.locator('#count').selectOption('4');
      assert.equal(await page.locator('#quickSession option[value="3"]').isDisabled(), false, 'session 3 should become available when the plan has four sessions');
    });
    await check('movements can be reordered and preview updates to match', async () => {
      await page.locator('#count').selectOption('2');
      await page.locator('#bulk').fill('حرکت اول\t1\tعادی\t—\t3\t10\t60\nحرکت دوم\t1\tعادی\t—\t3\t12\t60');
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      await page.locator('#moveManager').getByRole('button', { name: 'انتقال حرکت به پایین' }).first().waitFor({ state: 'visible' });
      assert.ok((await page.locator('#sessions').innerText()).indexOf('حرکت اول') < (await page.locator('#sessions').innerText()).indexOf('حرکت دوم'));
      await page.locator('[data-move-down="0"]').click();
      const rows = (await page.locator('#bulk').inputValue()).split('\n');
      assert.ok(rows[0].startsWith('حرکت دوم'), 'second movement should move to the first position');
      const preview = await page.locator('#sessions').innerText();
      assert.ok(preview.indexOf('حرکت دوم') < preview.indexOf('حرکت اول'), 'preview order should follow the movement list');
      await page.locator('[data-move-up="1"]').click();
      assert.ok((await page.locator('#bulk').inputValue()).startsWith('حرکت اول'), 'movement should move back up');
    });
    await check('quick movement entry supports consecutive Enter-key additions', async () => {
      await page.locator('#bulk').fill('');
      await page.locator('#count').selectOption('2');
      await page.locator('#quickSystem').selectOption('عادی');
      await page.locator('#quickSession').selectOption('1');
      await page.locator('#quickName').fill('پرس سینه سریع');
      await page.locator('#quickName').press('Enter');
      assert.equal(await page.locator('#quickName').inputValue(), '');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'quickName', 'focus should return to the name field');
      await page.locator('#quickName').fill('لت سریع');
      await page.locator('#quickName').press('Enter');
      const rows = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10));
      assert.equal(rows.length, 2, 'each Enter should add exactly one movement');
      assert.equal(rows[0].split(String.fromCharCode(9))[0], 'پرس سینه سریع');
      assert.equal(rows[1].split(String.fromCharCode(9))[0], 'لت سریع');
    });
    await check('select all visible movements respects the session filter for bulk edits', async () => {
      await page.locator('#count').selectOption('2');
      await page.locator('#bulk').fill([
        ['حرکت جلسه یک', '1', 'عادی', '—', '3', '10', '60'].join(String.fromCharCode(9)),
        ['حرکت جلسه دو الف', '2', 'عادی', '—', '4', '12', '75'].join(String.fromCharCode(9)),
        ['حرکت جلسه دو ب', '2', 'عادی', '—', '2', '15', '45'].join(String.fromCharCode(9))
      ].join(String.fromCharCode(10)));
      await page.locator('#managerSessionFilter').selectOption('2');
      await page.locator('#selectVisibleMoves').click();
      assert.equal(await page.locator('#selectedMoveCount').innerText(), 'انتخاب‌شده: 2');
      await page.locator('#bulkEditReps').fill('9');
      await page.locator('#applyBulkMovementEdits').click();
      let rows = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).map(line => line.split(String.fromCharCode(9)));
      assert.equal(rows[0][5], '10', 'movement outside the visible session must remain unchanged');
      assert.equal(rows[1][5], '9');
      assert.equal(rows[2][5], '9');
      await page.locator('#deselectVisibleMoves').click();
      assert.equal(await page.locator('#selectedMoveCount').innerText(), 'انتخاب‌شده: 0');
      await page.locator('#showAllManagedMoves').click(); // Restore shared test-page state for following tests.
    });
    await check('bulk edits update only selected movements and preserve their other details', async () => {
      await page.locator('#count').selectOption('2');
      await page.locator('#bulk').fill([
        ['حرکت گروهی الف', '1', 'عادی', '—', '3', '10', '60'].join(String.fromCharCode(9)),
        ['حرکت گروهی ب', '2', 'عادی', '—', '4', '12', '75'].join(String.fromCharCode(9)),
        ['حرکت بدون تغییر', '2', 'عادی', '—', '2', '15', '45'].join(String.fromCharCode(9))
      ].join(String.fromCharCode(10)));
      await page.locator('#moveManager').getByRole('checkbox', { name: 'انتخاب حرکت حرکت گروهی الف' }).check();
      await page.locator('#moveManager').getByRole('checkbox', { name: 'انتخاب حرکت حرکت گروهی ب' }).check();
      await page.locator('#bulkEditSets').fill('5');
      await page.locator('#bulkEditReps').fill('8');
      await page.locator('#bulkEditRest').fill('90');
      await page.locator('#applyBulkMovementEdits').click();
      const rows = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).map(line => line.split(String.fromCharCode(9)));
      assert.deepEqual(rows[0], ['حرکت گروهی الف', '1', 'عادی', '—', '5', '8', '90']);
      assert.deepEqual(rows[1], ['حرکت گروهی ب', '2', 'عادی', '—', '5', '8', '90']);
      assert.deepEqual(rows[2], ['حرکت بدون تغییر', '2', 'عادی', '—', '2', '15', '45'], 'unselected movement must remain unchanged');
      assert.match(await page.locator('#quickStatus').innerText(), /مشخصات 2 حرکت انتخاب‌شده به‌روزرسانی شد/);
    });
    await check('movements can be edited and deleted from the manager list', async () => {
      await page.locator('#bulk').fill('');
      await page.locator('#count').selectOption('3');
      await page.locator('#quickName').fill('حرکت اول');
      await page.locator('#quickSession').selectOption('1');
      await page.locator('#quickSystem').selectOption('عادی');
      await page.getByRole('button', { name: 'افزودن به فهرست' }).click();
      await page.locator('#quickName').fill('حرکت دوم');
      await page.getByRole('button', { name: 'افزودن به فهرست' }).click();
      await page.getByRole('button', { name: 'ویرایش' }).first().click();
      await page.locator('#quickName').fill('حرکت اول ویرایش‌شده');
      await page.getByRole('button', { name: 'ذخیره ویرایش' }).click();
      assert.ok((await page.locator('#bulk').inputValue()).includes('حرکت اول ویرایش‌شده'));
      await page.locator('#moveManager').getByRole('button', { name: 'حذف', exact: true }).last().click();
      assert.ok(!(await page.locator('#bulk').inputValue()).includes('حرکت دوم'));
      assert.equal(await page.locator('#moveManager .move').count(), 1);
    });
    await check('movement can be duplicated safely with its training details', async () => {
      await page.locator('#bulk').fill('');
      await page.locator('#count').selectOption('2');
      await page.locator('#quickName').fill('پرس دمبل');
      await page.locator('#quickSession').selectOption('2');
      await page.locator('#quickSystem').selectOption('عادی');
      await page.locator('#quickSets').fill('4');
      await page.locator('#quickReps').fill('10');
      await page.locator('#quickRest').fill('75');
      await page.getByRole('button', { name: 'افزودن به فهرست' }).click();
      await page.getByRole('button', { name: 'کپی حرکت پرس دمبل' }).click();
      const lines = (await page.locator('#bulk').inputValue()).split('\n');
      assert.equal(lines.length, 2);
      assert.deepEqual(lines[1].split('\t'), ['پرس دمبل', '2', 'عادی', '—', '4', '10', '75']);
      assert.equal(await page.locator('#moveManager .move').count(), 2);
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      assert.ok((await page.locator('#sessions').innerText()).includes('پرس دمبل'));
      const summary = await page.locator('#programSummary').innerText();
      assert.ok(summary.includes('تعداد حرکات') && summary.includes('2'), 'summary should report the total movement count');
      assert.ok(summary.includes('جلسه 2: 2 حرکت'), 'summary should report the session movement count');
    });
    await check('a complete session can be copied into the next session with movement details preserved', async () => {
      await page.locator('#count').selectOption('2');
      await page.locator('#split').selectOption('manual');
      await page.locator('#bulk').fill([
        ['پرس جلسه یک', '1', 'عادی', '—', '4', '10', '75'].join(String.fromCharCode(9)),
        ['قفسه جلسه یک', '1', 'سوپرست', 'A', '3', '12', '60'].join(String.fromCharCode(9)),
        ['حرکت جلسه دو', '2', 'عادی', '—', '3', '15', '45'].join(String.fromCharCode(9))
      ].join(String.fromCharCode(10)));
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      await page.getByRole('button', { name: 'کپی جلسه 1' }).click();
      assert.equal(await page.locator('#count').inputValue(), '3');
      const rows = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).map(line => line.split(String.fromCharCode(9)));
      const copied = rows.filter(row => row[1] === '3');
      assert.equal(copied.length, 2, 'both movements from session one should be copied');
      assert.deepEqual(copied[0], ['پرس جلسه یک', '3', 'عادی', '—', '4', '10', '75']);
      assert.deepEqual(copied[1], ['قفسه جلسه یک', '3', 'سوپرست', 'A', '3', '12', '60']);
      assert.ok((await page.locator('#sessions').innerText()).includes('جلسه 3'));
      assert.match(await page.locator('#quickStatus').innerText(), /به‌صورت جلسه 3 کپی شد/);
    });
    await check('session editing shortcut filters the manager and edits only the selected session movement', async () => {
      await page.locator('#count').selectOption('3');
      await page.locator('#split').selectOption('manual');
      await page.locator('#bulk').fill([
        ['حرکت جلسه یک', '1', 'عادی', '—', '3', '10', '60'].join(String.fromCharCode(9)),
        ['حرکت جلسه دو', '2', 'عادی', '—', '4', '12', '75'].join(String.fromCharCode(9)),
        ['حرکت جلسه سه', '3', 'عادی', '—', '3', '15', '45'].join(String.fromCharCode(9))
      ].join(String.fromCharCode(10)));
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      await page.getByRole('button', { name: 'ویرایش حرکات جلسه 2' }).click();
      assert.equal(await page.locator('#managerSessionFilter').inputValue(), '2');
      assert.equal(await page.locator('#moveManager .move').count(), 1);
      assert.ok((await page.locator('#moveManager').innerText()).includes('حرکت جلسه دو'));
      await page.locator('#moveManager').getByRole('button', { name: 'ویرایش' }).click();
      await page.locator('#quickName').fill('حرکت جلسه دو اصلاح‌شده');
      await page.getByRole('button', { name: 'ذخیره ویرایش' }).click();
      assert.ok((await page.locator('#bulk').inputValue()).includes('حرکت جلسه دو اصلاح‌شده'));
      assert.ok((await page.locator('#bulk').inputValue()).includes('حرکت جلسه یک'));
      await page.getByRole('button', { name: 'نمایش همه حرکات' }).click();
      assert.equal(await page.locator('#moveManager .move').count(), 3);
    });
    await check('copy session is blocked at the six-session limit', async () => {
      await page.locator('#count').selectOption('6');
      await page.locator('#bulk').fill('حرکت نمونه\t1\tعادی\t—\t3\t10\t60');
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      await page.getByRole('button', { name: 'کپی جلسه 1' }).click();
      assert.equal(await page.locator('#count').inputValue(), '6');
      assert.match(await page.locator('#quickStatus').innerText(), /سقف ۶/);
      assert.equal((await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).length, 1);
    });
    await check('quick group builder creates a named superset and previews its movements together', async () => {
      await page.locator('#bulk').fill('');
      await page.locator('#count').selectOption('3');
      await page.locator('#quickSystem').selectOption('عادی');
      await page.getByRole('button', { name: 'ساخت گروه جدید' }).click();
      assert.equal(await page.locator('#quickSystem').inputValue(), 'سوپرست');
      assert.equal(await page.locator('#quickGroup').inputValue(), 'A');
      await page.locator('#quickName').fill('پرس سینه گروهی');
      await page.getByRole('button', { name: 'افزودن به فهرست' }).click();
      await page.locator('#quickName').fill('قفسه گروهی');
      await page.getByRole('button', { name: 'افزودن به فهرست' }).click();
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      assert.match(await page.locator('#status').innerText(), /بررسی اولیه موفق بود/);
      assert.ok((await page.locator('#sessions').innerText()).includes('پرس سینه گروهی + قفسه گروهی'));
    });
    await check('quick group builder chooses an unused label instead of joining an existing group', async () => {
      await page.locator('#bulk').fill([
        ['حرکت گروه A', '1', 'سوپرست', 'A', '3', '10', '60'].join(String.fromCharCode(9)),
        ['حرکت گروه B', '1', 'سوپرست', 'B', '3', '10', '60'].join(String.fromCharCode(9))
      ].join(String.fromCharCode(10)));
      await page.locator('#quickSession').selectOption('1');
      await page.locator('#quickSystem').selectOption('عادی');
      await page.getByRole('button', { name: 'ساخت گروه جدید' }).click();
      assert.equal(await page.locator('#quickSystem').inputValue(), 'سوپرست');
      assert.equal(await page.locator('#quickGroup').inputValue(), 'C', 'new group should not reuse A or B from existing movements');
    });
    await check('new group labels are scoped to the selected session and system', async () => {
      await page.locator('#bulk').fill([
        ['سوپرست جلسه یک', '1', 'سوپرست', 'A', '3', '10', '60'].join(String.fromCharCode(9)),
        ['تری‌ست جلسه دو', '2', 'تری‌ست', 'A', '3', '10', '60'].join(String.fromCharCode(9))
      ].join(String.fromCharCode(10)));
      await page.locator('#quickSession').selectOption('2');
      await page.locator('#quickSystem').selectOption('عادی');
      await page.getByRole('button', { name: 'ساخت گروه جدید' }).click();
      assert.equal(await page.locator('#quickSystem').inputValue(), 'سوپرست');
      assert.equal(await page.locator('#quickGroup').inputValue(), 'A', 'a label used in another session or system should be reusable here');
    });
    await check('new group labels account for existing semicolon-delimited movement rows', async () => {
      await page.locator('#bulk').fill('حرکت موجود;1;سوپرست;A;3;10;60');
      await page.locator('#count').selectOption('2');
      await page.locator('#quickSession').selectOption('1');
      await page.locator('#quickSystem').selectOption('سوپرست');
      await page.getByRole('button', { name: 'ساخت گروه جدید' }).click();
      assert.equal(await page.locator('#quickGroup').inputValue(), 'B', 'the existing group A must not be reused');
    });
    await check('group selection is preserved across bank category filters', async () => {
      await page.locator('#clearSelectedExercises').click();
      await page.locator('#bulk').fill('');
      await page.locator('#count').selectOption('2');
      await page.locator('#bankCategory').selectOption('سینه');
      await page.getByRole('checkbox', { name: 'گروه‌بندی پرس سینه هالتر' }).check();
      await page.locator('#bankCategory').selectOption('پا');
      await page.getByRole('checkbox', { name: 'گروه‌بندی اسکوات جام' }).check();
      await page.locator('#quickSystem').selectOption('سوپرست');
      await page.locator('#quickSession').selectOption('1');
      await page.locator('#groupSelectedExercises').click();
      const rows = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).map(line => line.split(String.fromCharCode(9)));
      const chest = rows.find(row => row[0] === 'پرس سینه هالتر');
      const squat = rows.find(row => row[0] === 'اسکوات جام');
      assert.ok(chest && squat, 'both selected movements should be added even after filtering');
      assert.equal(chest[2], 'سوپرست');
      assert.equal(squat[2], 'سوپرست');
      assert.equal(chest[3], squat[3], 'both movements should share the same group');
      assert.match(await page.locator('#bankStatus').innerText(), /2 حرکت به‌صورت سوپرست/);
      await page.locator('#preview').click();
      assert.match(await page.locator('#status').innerText(), /بررسی اولیه موفق بود/);
      assert.ok((await page.locator('#sessions').innerText()).includes('پرس سینه هالتر + اسکوات جام'), 'preview should show selected movements together in selection order with a plus separator');
    });
    await check('quick bank grouping rejects the wrong number of selected movements without changing the plan', async () => {
      await page.locator('#clearSelectedExercises').click();
      await page.locator('#bulk').fill('برنامه باید حفظ شود\\t1\\tعادی\\t—\\t3\\t10\\t60');
      await page.locator('#bankCategory').selectOption('سینه');
      await page.getByRole('checkbox', { name: 'گروه‌بندی پرس سینه هالتر' }).check();
      await page.getByRole('checkbox', { name: 'گروه‌بندی پرس سینه دمبل' }).check();
      await page.locator('#quickSystem').selectOption('تری‌ست');
      await page.locator('#quickSession').selectOption('1');
      const before = await page.locator('#bulk').inputValue();
      await page.locator('#groupSelectedExercises').click();
      assert.equal(await page.locator('#bulk').inputValue(), before, 'invalid selection count must not alter the movement list');
      assert.match(await page.locator('#bankStatus').innerText(), /برای تری‌ست دقیقاً 3 حرکت انتخاب کن؛ اکنون 2 حرکت انتخاب شده/);
    });
    await check('groups with the same label in different sessions are validated separately', async () => {
      await page.locator('#count').selectOption('2');
      await page.locator('#bulk').fill([
        ['حرکت یک', '1', 'سوپرست', 'A', '3', '12', '60'].join(String.fromCharCode(9)),
        ['حرکت دو', '2', 'سوپرست', 'A', '3', '12', '60'].join(String.fromCharCode(9))
      ].join(String.fromCharCode(10)));
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      const status = await page.locator('#status').innerText();
      assert.match(status, /جلسه 1/);
      assert.match(status, /جلسه 2/);
      assert.match(status, /حداقل 2 حرکت لازم دارد/);
    });
    await check('exercise bank filters by muscle group and fills quick-entry name', async () => {
      await page.locator('#bankCategory').selectOption('پا');
      assert.ok((await page.locator('#exerciseBank').innerText()).includes('اسکوات هالتر'));
      await page.locator('#bankCategory').selectOption('همه');
      await page.locator('#bankSearch').fill('هیپ');
      assert.ok((await page.locator('#exerciseBank').innerText()).includes('هیپ تراست'));
      await page.getByRole('button', { name: 'انتخاب حرکت هیپ تراست' }).click();
      assert.equal(await page.locator('#quickName').inputValue(), 'هیپ تراست');
      await page.locator('#bankSearch').fill('ناموجود');
      assert.match(await page.locator('#exerciseBank').innerText(), /حرکتی پیدا نشد/);
    });
    await check('select-visible bank shortcut selects only current filtered results for bulk addition', async () => {
      await page.locator('#bulk').fill('');
      await page.locator('#count').selectOption('2');
      await page.locator('#bankCategory').selectOption('سینه');
      await page.locator('#bankSearch').fill('پرس سینه هالتر');
      const visibleNames = await page.locator('.bankAddMoveCheck').evaluateAll(items => items.map(item => item.value));
      assert.deepEqual(visibleNames, ['پرس سینه هالتر'], 'search should limit the visible selection scope');
      await page.locator('#selectVisibleBankForAdd').click();
      assert.equal(await page.locator('.bankAddMoveCheck:checked').count(), 1);
      await page.locator('#bankBulkSession').selectOption('2');
      await page.locator('#addSelectedBankExercises').click();
      const rows = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).map(line => line.split(String.fromCharCode(9)));
      assert.equal(rows.length, 1);
      assert.equal(rows[0][0], 'پرس سینه هالتر');
      assert.equal(rows[0][1], '2');
      assert.match(await page.locator('#bankStatus').innerText(), /1 حرکت به جلسه 2 اضافه شد/);
    });
    await check('multiple bank movements can be added to a selected session with shared sets reps and rest', async () => {
      await page.locator('#bulk').fill('');
      await page.locator('#count').selectOption('2');
      await page.locator('#bankCategory').selectOption('سینه');
      await page.locator('#bankSearch').fill('پرس سینه');
      await page.locator('input.bankAddMoveCheck[aria-label="افزودن گروهی پرس سینه هالتر"]').check();
      await page.locator('input.bankAddMoveCheck[aria-label="افزودن گروهی پرس سینه دمبل"]').check();
      await page.locator('#bankBulkSession').selectOption('2');
      await page.locator('#quickSets').fill('4');
      await page.locator('#quickReps').fill('15');
      await page.locator('#quickRest').fill('45');
      await page.locator('#addSelectedBankExercises').click();
      const rows=(await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).map(line=>line.split(String.fromCharCode(9)));
      for (const name of ['پرس سینه هالتر','پرس سینه دمبل']) {
        const row=rows.find(item=>item[0]===name);
        assert.ok(row, name+' should be added');
        assert.equal(row[1],'2');
        assert.deepEqual(row.slice(4,7),['4','15','45']);
      }
      assert.match(await page.locator('#bankStatus').innerText(),/2 حرکت به جلسه 2 اضافه شد/);
    });
    await check('bank bulk add rejects invalid settings without changing the workout', async () => {
      await page.locator('#bulk').fill([
        ['حرکت موجود', '1', 'عادی', '—', '3', '12', '60'].join(String.fromCharCode(9))
      ].join(String.fromCharCode(10)));
      await page.locator('#bankCategory').selectOption('سینه');
      await page.locator('#bankSearch').fill('پرس سینه');
      await page.locator('input.bankAddMoveCheck[aria-label="افزودن گروهی پرس سینه هالتر"]').check();
      await page.locator('#bankBulkSession').selectOption('2');
      await page.locator('#quickSets').fill('0');
      const before = await page.locator('#bulk').inputValue();
      await page.locator('#addSelectedBankExercises').click();
      assert.equal(await page.locator('#bulk').inputValue(), before, 'invalid sets must not mutate the workout');
      assert.match(await page.locator('#bankStatus').innerText(), /ست و تکرار باید عدد مثبت/);
      await page.locator('#quickSets').fill('3');
      await page.locator('#clearSelectedExercises').click();
    });
    await check('bank bulk add avoids duplicates in the same session but allows the same movement in another session', async () => {
      await page.locator('#count').selectOption('2');
      await page.locator('#bulk').fill([
        ['پرس سینه هالتر', '1', 'عادی', '—', '3', '12', '60'].join(String.fromCharCode(9))
      ].join(String.fromCharCode(10)));
      await page.locator('#bankCategory').selectOption('سینه');
      await page.locator('#bankSearch').fill('پرس سینه هالتر');
      await page.locator('input.bankAddMoveCheck[aria-label="افزودن گروهی پرس سینه هالتر"]').check();
      await page.locator('#bankBulkSession').selectOption('1');
      await page.locator('#addSelectedBankExercises').click();
      let rows = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10));
      assert.equal(rows.length, 1, 'same movement and same session should not be duplicated');
      assert.match(await page.locator('#bankStatus').innerText(), /از قبل در همین جلسه وجود داشتند/);
      await page.locator('input.bankAddMoveCheck[aria-label="افزودن گروهی پرس سینه هالتر"]').check();
      await page.locator('#bankBulkSession').selectOption('2');
      await page.locator('#addSelectedBankExercises').click();
      rows = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10));
      assert.equal(rows.length, 2, 'the same movement may be prescribed in a different session');
      assert.equal(rows[1].split(String.fromCharCode(9))[1], '2');
    });
    await check('selected bank movements can be grouped into a triset with plus preview', async () => {
      await page.locator('#clearSelectedExercises').click();
      await page.locator('#bulk').fill('');
      await page.locator('#count').selectOption('3');
      await page.locator('#quickSession').selectOption('1');
      await page.locator('#quickSystem').selectOption('تری‌ست');
      await page.locator('#bankSearch').fill('');
      await page.locator('#bankCategory').selectOption('سینه');
      await page.locator('.bankMoveCheck').nth(0).check();
      await page.locator('.bankMoveCheck').nth(1).check();
      await page.locator('.bankMoveCheck').nth(2).check();
      await page.getByRole('button', { name: 'گروه‌بندی حرکات انتخاب‌شده' }).click();
      assert.match(await page.locator('#bankStatus').innerText(), /(?:۳|3) حرکت به‌صورت تری‌ست گروه/);
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      assert.match(await page.locator('#status').innerText(), /بررسی اولیه موفق بود/);
      assert.ok((await page.locator('#sessions').innerText()).includes('پرس سینه هالتر + پرس سینه دمبل + پرس بالاسینه دمبل'));
      assert.equal(await page.locator('#moveManager .move').count(), 3);
    });
    await check('muscle-aware split recognizes exercise-bank movements and groups them into consistent sessions', async () => {
      await page.locator('#count').selectOption('3');
      await page.locator('#split').selectOption('manual');
      await page.locator('#bulk').fill([
        ['پرس سینه هالتر', '3', 'عادی', '—', '3', '12', '60'].join(String.fromCharCode(9)),
        ['لت سیم‌کش از جلو', '3', 'عادی', '—', '3', '12', '60'].join(String.fromCharCode(9)),
        ['اسکوات هالتر', '1', 'عادی', '—', '4', '10', '90'].join(String.fromCharCode(9)),
        ['جلو بازو دمبل تناوبی', '1', 'عادی', '—', '3', '12', '60'].join(String.fromCharCode(9)),
        ['حرکت ناشناخته', '3', 'عادی', '—', '3', '10', '60'].join(String.fromCharCode(9))
      ].join(String.fromCharCode(10)));
      await page.locator('#split').selectOption('muscle');
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      const trial = await page.evaluate(() => window.__trial);
      const sessionOf = name => trial.moves.find(move => move.name === name).session;
      assert.equal(sessionOf('پرس سینه هالتر'), 1, 'chest exercises should map to the chest slot');
      assert.equal(sessionOf('لت سیم‌کش از جلو'), 2, 'back exercises should map to the back slot');
      assert.equal(sessionOf('اسکوات هالتر'), 3, 'leg exercises should map to the leg slot');
      assert.equal(sessionOf('جلو بازو دمبل تناوبی'), 2, 'arm exercises should follow the category-to-session rotation');
      assert.equal(sessionOf('حرکت ناشناخته'), 3, 'unclassified movements should retain their manually assigned session');
      assert.equal(trial.sessions, 3);
    });
    await check('multiple selected movements can be transferred to one destination session', async () => {
      await page.locator('#count').selectOption('3');
      await page.locator('#split').selectOption('manual');
      await page.locator('#bulk').fill([
        ['پرس سینه', '1', 'عادی', '—', '3', '12', '60'].join(String.fromCharCode(9)),
        ['لت سیم‌کش', '1', 'عادی', '—', '3', '10', '60'].join(String.fromCharCode(9)),
        ['اسکوات', '2', 'عادی', '—', '4', '10', '90'].join(String.fromCharCode(9))
      ].join(String.fromCharCode(10)));
      await page.getByRole('checkbox', { name: 'انتخاب حرکت پرس سینه' }).check();
      await page.getByRole('checkbox', { name: 'انتخاب حرکت لت سیم‌کش' }).check();
      await page.locator('#bulkTargetSession').selectOption('3');
      await page.getByRole('button', { name: 'انتقال انتخاب‌شده‌ها' }).click();
      const rows = (await page.locator('#bulk').inputValue()).split(/\r?\n/).map(line => line.split(String.fromCharCode(9)));
      assert.equal(rows.find(row => row[0] === 'پرس سینه')[1], '3');
      assert.equal(rows.find(row => row[0] === 'لت سیم‌کش')[1], '3');
      assert.equal(rows.find(row => row[0] === 'اسکوات')[1], '2', 'unselected movement must remain in its original session');
      assert.match(await page.locator('#quickStatus').innerText(), /2 حرکت به جلسه 3 منتقل شد/);
      assert.equal(await page.locator('#selectedMoveCount').innerText(), 'انتخاب‌شده: 0');
    });
    await check('moving one grouped movement transfers the whole superset and preserves details', async () => {
      await page.locator('#count').selectOption('2');
      await page.locator('#split').selectOption('manual');
      await page.locator('#bulk').fill([
        ['پرس گروهی الف', '1', 'سوپرست', 'A', '4', '10', '60'].join(String.fromCharCode(9)),
        ['پرس گروهی ب', '1', 'سوپرست', 'A', '3', '12', '75'].join(String.fromCharCode(9)),
        ['حرکت عادی', '1', 'عادی', '—', '2', '15', '45'].join(String.fromCharCode(9))
      ].join(String.fromCharCode(10)));
      await page.getByRole('checkbox', { name: 'انتخاب حرکت پرس گروهی الف' }).check();
      await page.locator('#bulkTargetSession').selectOption('2');
      await page.locator('#moveSelectedToSession').click();
      const rows = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).map(line => line.split(String.fromCharCode(9)));
      assert.deepEqual(rows[0], ['پرس گروهی الف', '2', 'سوپرست', 'A', '4', '10', '60']);
      assert.deepEqual(rows[1], ['پرس گروهی ب', '2', 'سوپرست', 'A', '3', '12', '75'], 'the other member of the superset should move with the selected movement');
      assert.deepEqual(rows[2], ['حرکت عادی', '1', 'عادی', '—', '2', '15', '45'], 'unrelated movement should stay in its original session');
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      assert.ok((await page.locator('#sessions').innerText()).includes('پرس گروهی الف + پرس گروهی ب'), 'superset should still render together after moving');
      assert.match(await page.locator('#quickStatus').innerText(), /اعضای گروه تمرینی هم همراه آن منتقل شدند/);
    });
    await check('moving one triset or giant-set movement transfers the complete group and preserves details', async () => {
      const cases = [
        { system: 'تری‌ست', names: ['تری‌ست الف', 'تری‌ست ب', 'تری‌ست ج'], expectedSize: 3 },
        { system: 'جاینت‌ست', names: ['جاینت الف', 'جاینت ب', 'جاینت ج', 'جاینت د'], expectedSize: 4 }
      ];
      for (const item of cases) {
        await page.locator('#count').selectOption('2');
        await page.locator('#split').selectOption('manual');
        const rows = item.names.map((name, i) => [
          name, '1', item.system, 'گروه X', String(2 + i), String(10 + i), String(45 + i * 5)
        ]);
        rows.push(['حرکت مستقل', '1', 'عادی', '—', '3', '15', '60']);
        await page.locator('#bulk').fill(rows.map(row => row.join(String.fromCharCode(9))).join(String.fromCharCode(10)));
        await page.getByRole('checkbox', { name: 'انتخاب حرکت ' + item.names[0] }).check();
        await page.locator('#bulkTargetSession').selectOption('2');
        await page.locator('#moveSelectedToSession').click();
        const movedRows = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).map(line => line.split(String.fromCharCode(9)));
        for (let i = 0; i < item.expectedSize; i++) {
          assert.equal(movedRows[i][1], '2', item.system + ' member ' + item.names[i] + ' should move with the selected member');
          assert.equal(movedRows[i][2], item.system);
          assert.equal(movedRows[i][3], 'گروه X');
          assert.equal(movedRows[i][4], String(2 + i), 'sets should be preserved');
          assert.equal(movedRows[i][5], String(10 + i), 'reps should be preserved');
          assert.equal(movedRows[i][6], String(45 + i * 5), 'rest should be preserved');
        }
        assert.equal(movedRows[item.expectedSize][1], '1', 'unrelated normal movement should stay in the original session');
        assert.match(await page.locator('#quickStatus').innerText(), new RegExp(item.expectedSize + ' حرکت به جلسه 2 منتقل شد'));
        assert.match(await page.locator('#quickStatus').innerText(), /اعضای گروه تمرینی هم همراه آن منتقل شدند/);
      }
    });
    await check('group transfer stays within the same source session and system', async () => {
      await page.locator('#count').selectOption('3');
      await page.locator('#split').selectOption('manual');
      const rows = [
        ['سوپرست اصلی الف', '1', 'سوپرست', 'A', '3', '12', '60'],
        ['سوپرست اصلی ب', '1', 'سوپرست', 'A', '4', '10', '75'],
        ['سوپرست جلسه دیگر', '2', 'سوپرست', 'A', '2', '15', '45'],
        ['تری‌ست با همان نام', '1', 'تری‌ست', 'A', '3', '12', '60'],
        ['حرکت عادی', '1', 'عادی', '—', '2', '15', '45']
      ];
      await page.locator('#bulk').fill(rows.map(row => row.join(String.fromCharCode(9))).join(String.fromCharCode(10)));
      await page.getByRole('checkbox', { name: 'انتخاب حرکت سوپرست اصلی الف' }).check();
      await page.locator('#bulkTargetSession').selectOption('3');
      await page.locator('#moveSelectedToSession').click();
      const movedRows = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).map(line => line.split(String.fromCharCode(9)));
      assert.equal(movedRows[0][1], '3');
      assert.equal(movedRows[1][1], '3', 'same-session members of the selected superset should move together');
      assert.equal(movedRows[2][1], '2', 'same group label in another session must remain there');
      assert.equal(movedRows[3][1], '1', 'same group label but a different system must not be included');
      assert.equal(movedRows[4][1], '1', 'normal movement must remain in its original session');
      assert.match(await page.locator('#quickStatus').innerText(), /2 حرکت به جلسه 3 منتقل شد/);
    });
    await check('movement can be edited directly from the full workout preview', async () => {
      await page.locator('#count').selectOption('2');
      await page.locator('#split').selectOption('manual');
      await page.locator('#bulk').fill([
        ['پرس سینه', '1', 'عادی', '—', '3', '12', '60'].join(String.fromCharCode(9)),
        ['لت سیم‌کش', '2', 'عادی', '—', '3', '10', '60'].join(String.fromCharCode(9))
      ].join(String.fromCharCode(10)));
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      await page.getByRole('button', { name: 'ویرایش از پیش‌نمایش پرس سینه' }).click();
      assert.equal(await page.locator('#quickName').inputValue(), 'پرس سینه');
      assert.equal(await page.locator('#quickSession').inputValue(), '1');
      await page.locator('#quickName').fill('پرس سینه دستگاه');
      await page.getByRole('button', { name: 'ذخیره ویرایش' }).click();
      assert.ok((await page.locator('#bulk').inputValue()).includes('پرس سینه دستگاه'));
      assert.ok((await page.locator('#bulk').inputValue()).includes('لت سیم‌کش'));
      assert.equal(await page.evaluate(() => window.__trial.errors.length), 0);
    });
    await check('movements can be moved between sessions and deleted directly from preview', async () => {
      await page.locator('#count').selectOption('2');
      await page.locator('#split').selectOption('manual');
      await page.locator('#bulk').fill([
        ['پرس سینه', '1', 'عادی', '—', '3', '12', '60'].join(String.fromCharCode(9)),
        ['لت سیم‌کش', '1', 'عادی', '—', '3', '10', '60'].join(String.fromCharCode(9))
      ].join(String.fromCharCode(10)));
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      await page.getByLabel('جلسه مقصد برای پرس سینه').selectOption('2');
      await page.getByRole('button', { name: 'انتقال از پیش‌نمایش پرس سینه' }).click();
      let trial = await page.evaluate(() => window.__trial);
      assert.equal(trial.moves.find(move => move.name === 'پرس سینه').session, 2);
      assert.equal(trial.moves.find(move => move.name === 'لت سیم‌کش').session, 1);
      await page.getByRole('button', { name: 'حذف از پیش‌نمایش لت سیم‌کش' }).click();
      trial = await page.evaluate(() => window.__trial);
      assert.ok(trial.moves.some(move => move.name === 'پرس سینه'));
      assert.ok(!trial.moves.some(move => move.name === 'لت سیم‌کش'));
      assert.ok((await page.locator('#bulk').inputValue()).includes('پرس سینه'));
      assert.ok(!(await page.locator('#bulk').inputValue()).includes('لت سیم‌کش'));
    });
    await check('deleting a repeated exercise name removes only the movement in the selected session', async () => {
      await page.locator('#count').selectOption('2');
      await page.locator('#split').selectOption('manual');
      await page.locator('#bulk').fill([
        ['پرس تکراری', '1', 'عادی', '—', '3', '12', '60'],
        ['پرس تکراری', '2', 'عادی', '—', '4', '10', '75']
      ].map(row => row.join(String.fromCharCode(9))).join(String.fromCharCode(10)));
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      await page.locator('#sessions .session').nth(1).getByRole('button', { name: 'حذف از پیش‌نمایش پرس تکراری' }).click();
      const rows = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).map(line => line.split(String.fromCharCode(9)));
      assert.equal(rows.length, 1, 'only the selected-session movement should be removed');
      assert.deepEqual(rows[0], ['پرس تکراری', '1', 'عادی', '—', '3', '12', '60']);
    });
    await check('moving a grouped movement from preview transfers only its full matching group', async () => {
      await page.locator('#count').selectOption('3');
      await page.locator('#split').selectOption('manual');
      await page.locator('#bulk').fill([
        ['پرس گروهی الف', '1', 'سوپرست', 'A', '3', '12', '60'],
        ['قفسه گروهی الف', '1', 'سوپرست', 'A', '3', '10', '60'],
        ['پرس گروهی جلسه دو', '2', 'سوپرست', 'A', '4', '10', '75'],
        ['قفسه گروهی جلسه دو', '2', 'سوپرست', 'A', '4', '12', '75'],
        ['تری‌ست الف', '1', 'تری‌ست', 'A', '3', '12', '45'],
        ['تری‌ست ب', '1', 'تری‌ست', 'A', '3', '10', '45'],
        ['تری‌ست ج', '1', 'تری‌ست', 'A', '3', '8', '45'],
        ['حرکت عادی', '1', 'عادی', '—', '2', '15', '30']
      ].map(row => row.join(String.fromCharCode(9))).join(String.fromCharCode(10)));
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      await page.getByLabel('جلسه مقصد برای پرس گروهی الف').selectOption('3');
      await page.getByRole('button', { name: 'انتقال از پیش‌نمایش پرس گروهی الف' }).click();
      const trial = await page.evaluate(() => window.__trial);
      const sessionOf = name => trial.moves.find(move => move.name === name).session;
      assert.equal(sessionOf('پرس گروهی الف'), 3);
      assert.equal(sessionOf('قفسه گروهی الف'), 3, 'the paired movement should move with the selected movement');
      assert.equal(sessionOf('پرس گروهی جلسه دو'), 2, 'same group label in another session must stay put');
      assert.equal(sessionOf('قفسه گروهی جلسه دو'), 2);
      assert.equal(sessionOf('تری‌ست الف'), 1, 'a different system with the same label must stay put');
      assert.equal(sessionOf('تری‌ست ب'), 1);
      assert.equal(sessionOf('تری‌ست ج'), 1);
      assert.equal(sessionOf('حرکت عادی'), 1, 'unrelated normal movement must stay put');
      assert.match(await page.locator('#quickStatus').innerText(), /اعضای گروه هم همراه آن منتقل شدند/);
    });
    await check('selected movements can have sets reps and rest edited in bulk', async () => {
      await page.locator('#count').selectOption('2');
      await page.locator('#split').selectOption('manual');
      await page.locator('#bulk').fill([
        ['پرس سینه', '1', 'عادی', '—', '3', '12', '60'].join(String.fromCharCode(9)),
        ['لت سیم‌کش', '1', 'عادی', '—', '3', '10', '60'].join(String.fromCharCode(9)),
        ['اسکوات', '2', 'عادی', '—', '4', '8', '90'].join(String.fromCharCode(9))
      ].join(String.fromCharCode(10)));
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      await page.locator('input[type="checkbox"][aria-label="انتخاب حرکت پرس سینه"]').check();
      await page.locator('input[type="checkbox"][aria-label="انتخاب حرکت لت سیم‌کش"]').check();
      await page.locator('#bulkEditSets').fill('4');
      await page.locator('#bulkEditReps').fill('10');
      await page.locator('#bulkEditRest').fill('45');
      await page.locator('#applyBulkMovementEdits').click();
      const rows = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).map(line => line.split(String.fromCharCode(9)));
      const chest = rows.find(row => row[0] === 'پرس سینه');
      const lat = rows.find(row => row[0] === 'لت سیم‌کش');
      const squat = rows.find(row => row[0] === 'اسکوات');
      assert.deepEqual(chest.slice(4, 7), ['4', '10', '45']);
      assert.deepEqual(lat.slice(4, 7), ['4', '10', '45']);
      assert.deepEqual(squat.slice(4, 7), ['4', '8', '90']);
      assert.ok((await page.locator('#quickStatus').innerText()).includes('2 حرکت'));
    });
    await check('bulk movement editing changes only filled fields and rejects invalid values without modifying exercises', async () => {
      await page.locator('#count').selectOption('2');
      await page.locator('#split').selectOption('manual');
      await page.locator('#bulk').fill([
        ['حرکت انتخابی', '1', 'عادی', '—', '3', '12', '60'].join(String.fromCharCode(9)),
        ['حرکت دست‌نخورده', '2', 'عادی', '—', '4', '8', '90'].join(String.fromCharCode(9))
      ].join(String.fromCharCode(10)));
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      await page.locator('input[type="checkbox"][aria-label="انتخاب حرکت حرکت انتخابی"]').check();
      await page.locator('#bulkEditSets').fill('5');
      await page.locator('#bulkEditReps').fill('');
      await page.locator('#bulkEditRest').fill('');
      await page.locator('#applyBulkMovementEdits').click();
      let rows = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).map(line => line.split(String.fromCharCode(9)));
      assert.deepEqual(rows[0].slice(4, 7), ['5', '12', '60'], 'blank fields should preserve their existing values');
      assert.deepEqual(rows[1].slice(4, 7), ['4', '8', '90'], 'unselected exercise should remain unchanged');
      await page.locator('#bulkEditSets').fill('0');
      await page.locator('#applyBulkMovementEdits').click();
      rows = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).map(line => line.split(String.fromCharCode(9)));
      assert.deepEqual(rows[0].slice(4, 7), ['5', '12', '60'], 'invalid input must not partially change selected exercise');
      assert.match(await page.locator('#quickStatus').innerText(), /حداقل ۱|حداقل 1/);
    });
    await check('all ready-made templates use supported session counts and pass validation', async () => {
      const expected = { chest: 2, back: 2, legs: 2, shoulders: 2, four: 4, five: 5 };
      for (const [preset, sessions] of Object.entries(expected)) {
        await page.locator('#preset').selectOption(preset);
        await page.getByRole('button', { name: 'بارگذاری قالب آماده' }).click();
        assert.equal(await page.locator('#count').inputValue(), String(sessions), preset + ' session count');
        assert.match(await page.locator('#status').innerText(), /بررسی اولیه موفق بود/, preset + ' should validate');
        assert.equal(await page.locator('.session').count(), sessions, preset + ' rendered sessions');
      }
    });
    await check('session selector supports three and six sessions', async () => {
      for (const count of ['3', '6']) {
        await page.locator('#count').selectOption(count);
        assert.equal(await page.locator('.session').count(), Number(count));
        assert.equal(await page.evaluate(() => window.__trial.sessions), Number(count));
      }
    });
    await check('custom template can be saved and loaded', async () => {
      await page.locator('#customName').fill('تست مرورگر');
      const originalBulk = await page.locator('#bulk').inputValue();
      await page.getByRole('button', { name: 'ذخیره با نام دلخواه' }).click();
      assert.equal(await page.locator('#savedTemplates').inputValue(), 'تست مرورگر');
      await page.locator('#bulk').fill('حرکت موقت\t1\tعادی\t—\t3\t10\t60');
      await page.getByRole('button', { name: 'بارگذاری', exact: true }).click();
      assert.equal(await page.locator('#bulk').inputValue(), originalBulk, 'loaded template should restore exact saved content');
      await page.locator('#deleteTemplate').click();
      assert.equal(await page.locator('#savedTemplates option').count(), 1, 'deleted template should disappear');
    });
    await check('JSON export downloads a file', async () => {
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'دانلود داده‌های آزمایشی JSON' }).click();
      const download = await downloadPromise;
      assert.match(download.suggestedFilename(), /\.json$/);
      const stream = await download.createReadStream();
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.deepEqual(data.errors, []);
      assert.ok(Array.isArray(data.moves) && data.moves.length > 0, 'JSON should include movements');
      assert.equal(data.sessions, Number(await page.locator('#count').inputValue()));
    });
    await check('gender-specific starter templates load the matching session count and movements', async () => {
      await page.locator('#preset').selectOption('womenBase');
      await page.getByRole('button', { name: 'بارگذاری قالب آماده' }).click();
      assert.equal(await page.locator('#gender').inputValue(),'women');
      assert.equal(await page.locator('#count').inputValue(),'3');
      assert.ok((await page.locator('#bulk').inputValue()).includes('هیپ تراست'));
      await page.locator('#preset').selectOption('menBase');
      await page.getByRole('button', { name: 'بارگذاری قالب آماده' }).click();
      assert.equal(await page.locator('#gender').inputValue(),'men');
      assert.equal(await page.locator('#count').inputValue(),'4');
      assert.ok((await page.locator('#bulk').inputValue()).includes('پرس سینه هالتر'));
    });
    await check('goal-based starter templates load editable movements and correct gender', async () => {
      const cases = [
        ['womenFatLoss','women','3','اسکوات جام'],
        ['womenMuscle','women','4','هیپ تراست'],
        ['menFatLoss','men','3','لانج'],
        ['menMuscle','men','4','پرس سینه هالتر'],
        ['beginner','men','2','نشستن و برخاستن از نیمکت']
      ];
      for (const [preset, gender, sessions, movement] of cases) {
        await page.locator('#preset').selectOption(preset);
        await page.getByRole('button', { name: 'بارگذاری قالب آماده' }).click();
        assert.equal(await page.locator('#gender').inputValue(), gender);
        assert.equal(await page.locator('#count').inputValue(), sessions);
        assert.ok((await page.locator('#bulk').inputValue()).includes(movement));
      }
    });
    await check('save current workout as a reusable template in one click', async () => {
      await page.locator('#gender').selectOption('women');
      await page.locator('#count').selectOption('3');
      await page.locator('#bulk').fill('هیپ تراست\t1\tعادی\t—\t3\t12\t60');
      await page.locator('#customName').fill('قالب آزمایش ذخیره سریع');
      await page.locator('#saveCurrentAsTemplate').click();
      assert.equal(await page.locator('#savedTemplates').inputValue(), 'قالب آزمایش ذخیره سریع');
      assert.ok((await page.locator('#templateStatus').innerText()).includes('ذخیره شد'));
      await page.locator('#bulk').fill('حرکت تغییر یافته\t1\tعادی\t—\t2\t10\t60');
      await page.locator('#loadTemplate').click();
      assert.ok((await page.locator('#bulk').inputValue()).includes('هیپ تراست'));
      assert.equal(await page.locator('#gender').inputValue(), 'women');
      await page.locator('#saveCurrentAsTemplate').click();
      assert.equal(await page.locator('#savedTemplates').inputValue(), 'قالب آزمایش ذخیره سریع (2)');
    });
    await check('saved templates can be searched and filtered by gender', async () => {
      await page.locator('#gender').selectOption('women');
      await page.locator('#customName').fill('بانوان حجم');
      await page.locator('#saveTemplate').click();
      await page.locator('#gender').selectOption('men');
      await page.locator('#customName').fill('آقایان مبتدی');
      await page.locator('#saveTemplate').click();
      await page.locator('#templateGenderFilter').selectOption('women');
      let options = await page.locator('#savedTemplates option').allTextContents();
      assert.ok(options.some(x => x.includes('بانوان حجم')));
      assert.ok(!options.some(x => x.includes('آقایان مبتدی')));
      await page.locator('#templateGenderFilter').selectOption('all');
      await page.locator('#templateSearch').fill('مبتدی');
      options = await page.locator('#savedTemplates option').allTextContents();
      assert.ok(options.some(x => x.includes('آقایان مبتدی')));
      assert.ok(!options.some(x => x.includes('بانوان حجم')));
    });
    await check('saved templates filter by goal, level, and session count', async () => {
      await page.locator('#templateSearch').fill('');
      await page.locator('#templateGenderFilter').selectOption('all');
      await page.locator('#templateGoalFilter').selectOption('all');
      await page.locator('#templateLevelFilter').selectOption('all');
      await page.locator('#templateSessionFilter').selectOption('all');
      await page.locator('#gender').selectOption('women');
      await page.locator('#count').selectOption('3');
      await page.locator('#templateGoal').selectOption('fatloss');
      await page.locator('#templateLevel').selectOption('intermediate');
      await page.locator('#customName').fill('بانوان کاهش وزن متوسط');
      await page.locator('#saveTemplate').click();
      await page.locator('#gender').selectOption('men');
      await page.locator('#count').selectOption('4');
      await page.locator('#templateGoal').selectOption('muscle');
      await page.locator('#templateLevel').selectOption('advanced');
      await page.locator('#customName').fill('آقایان حجم پیشرفته');
      await page.locator('#saveTemplate').click();
      await page.locator('#templateGenderFilter').selectOption('all');
      await page.locator('#templateGoalFilter').selectOption('fatloss');
      await page.locator('#templateLevelFilter').selectOption('intermediate');
      await page.locator('#templateSessionFilter').selectOption('3');
      let options = await page.locator('#savedTemplates option').allTextContents();
      assert.ok(options.some(x => x.includes('بانوان کاهش وزن متوسط')));
      assert.ok(!options.some(x => x.includes('آقایان حجم پیشرفته')));
      await page.locator('#templateGoalFilter').selectOption('all');
      await page.locator('#templateLevelFilter').selectOption('all');
      await page.locator('#templateSessionFilter').selectOption('4');
      options = await page.locator('#savedTemplates option').allTextContents();
      assert.ok(options.some(x => x.includes('آقایان حجم پیشرفته')));
      assert.ok(!options.some(x => x.includes('بانوان کاهش وزن متوسط')));
    });
    await check('saved workout templates import without overwriting and export as JSON', async () => {
      await page.locator('#templateSearch').fill('');
      await page.locator('#templateGenderFilter').selectOption('all');
      await page.locator('#templateGoalFilter').selectOption('all');
      await page.locator('#templateLevelFilter').selectOption('all');
      await page.locator('#templateSessionFilter').selectOption('all');
      const payload = { format: 'fitness-seh-galeh-templates', version: 1, templates: {
        'قالب انتقالی': { gender: 'women', count: '3', split: 'manual', bulk: 'اسکوات\t1\tعادی\t—\t3\t12\t60', goal: 'muscle', level: 'intermediate' }
      }};
      await page.locator('#customName').fill('قالب انتقالی');
      await page.locator('#gender').selectOption('men');
      await page.locator('#count').selectOption('4');
      await page.locator('#saveTemplate').click();
      await page.locator('#templateImportFile').setInputFiles({ name: 'templates.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) });
      await page.waitForFunction(() => document.getElementById('templateStatus').textContent.includes('قالب وارد شد'), { timeout: 3000 });
      const names = await page.locator('#savedTemplates option').allTextContents();
      assert.ok(names.some(x => x.includes('قالب انتقالی (2)')), 'same-name import should preserve old template and add a unique name; status=' + await page.locator('#templateStatus').innerText() + '; options=' + JSON.stringify(names));
      const downloadPromise = page.waitForEvent('download');
      await page.locator('#exportTemplates').click();
      const download = await downloadPromise;
      assert.match(download.suggestedFilename(), /fitness-seh-galeh-templates\.json$/);
      const stream = await download.createReadStream();
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.equal(exported.format, 'fitness-seh-galeh-templates');
      assert.ok(exported.templates['قالب انتقالی']);
      assert.ok(exported.templates['قالب انتقالی (2)']);
      assert.equal(exported.templates['قالب انتقالی (2)'].goal, 'muscle');
      assert.equal(exported.templates['قالب انتقالی (2)'].level, 'intermediate');
    });
    await check('a new workout can be started from a previously exported workout JSON', async () => {
      const previous = { gender: 'women', sessions: 2, moves: [
        { name: 'هیپ تراست', session: 1, system: 'سوپرست', group: 'A', sets: 4, reps: 10, rest: 60 },
        { name: 'ابداکتور دستگاه', session: 1, system: 'سوپرست', group: 'A', sets: 4, reps: 12, rest: 45 },
        { name: 'لت سیم‌کش', session: 2, system: 'عادی', group: '—', sets: 3, reps: 12, rest: 60 }
      ]};
      await page.locator('#bulk').fill('برنامه قبلی فعلی\t1\tعادی\t—\t3\t10\t60');
      await page.locator('#previousWorkoutFile').setInputFiles({ name: 'previous-workout.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(previous)) });
      await page.waitForFunction(() => document.getElementById('previousWorkoutStatus').textContent.includes('برنامه قبلی بارگذاری شد'), { timeout: 3000 });
      assert.equal(await page.locator('#gender').inputValue(), 'women');
      assert.equal(await page.locator('#count').inputValue(), '2');
      const rows = (await page.locator('#bulk').inputValue()).split('\n');
      assert.equal(rows.length, 3);
      assert.deepEqual(rows.map(row => row.split('\t')), [
        ['هیپ تراست', '1', 'سوپرست', 'A', '4', '10', '60'],
        ['ابداکتور دستگاه', '1', 'سوپرست', 'A', '4', '12', '45'],
        ['لت سیم‌کش', '2', 'عادی', '—', '3', '12', '60']
      ]);
      assert.ok((await page.locator('#sessions').innerText()).includes('هیپ تراست + ابداکتور دستگاه'));
    });
    await check('invalid previous workout JSON does not replace the current plan', async () => {
      const before = await page.locator('#bulk').inputValue();
      await page.locator('#previousWorkoutFile').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ gender: 'men', sessions: 99, moves: [] })) });
      await page.waitForFunction(() => document.getElementById('previousWorkoutStatus').textContent.includes('فایل بارگذاری نشد'), { timeout: 3000 });
      assert.equal(await page.locator('#bulk').inputValue(), before);
    });
    await check('end-to-end three-session workout can be built, batch-edited, previewed, and downloaded as PNG', async () => {
      await page.locator('#bulk').fill('');
      await page.locator('#gender').selectOption('men');
      await page.locator('#count').selectOption('3');
      await page.locator('#split').selectOption('manual');
      const moves = [
        { name: 'پرس سینه مرحله نهایی', session: '1' },
        { name: 'لت سیم‌کش مرحله نهایی', session: '2' },
        { name: 'اسکوات مرحله نهایی', session: '3' }
      ];
      for (const move of moves) {
        await page.locator('#quickSession').selectOption(move.session);
        await page.locator('#quickSystem').selectOption('عادی');
        await page.locator('#quickName').fill(move.name);
        await page.locator('#quickName').press('Enter');
      }
      let rows = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).map(line => line.split(String.fromCharCode(9)));
      assert.equal(rows.length, 3, 'all three movements should be entered');
      assert.deepEqual(rows.map(row => row[1]), ['1', '2', '3'], 'each movement should be assigned to its intended session');
      await page.getByRole('checkbox', { name: 'انتخاب حرکت پرس سینه مرحله نهایی' }).check();
      await page.getByRole('checkbox', { name: 'انتخاب حرکت لت سیم‌کش مرحله نهایی' }).check();
      await page.locator('#bulkEditSets').fill('4');
      await page.locator('#bulkEditReps').fill('10');
      await page.locator('#bulkEditRest').fill('75');
      await page.locator('#applyBulkMovementEdits').click();
      rows = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).map(line => line.split(String.fromCharCode(9)));
      assert.deepEqual(rows[0].slice(4, 7), ['4', '10', '75']);
      assert.deepEqual(rows[1].slice(4, 7), ['4', '10', '75']);
      assert.deepEqual(rows[2].slice(4, 7), ['3', '12', '60'], 'unselected movement details should be preserved');
      await page.locator('#preview').click();
      const preview = await page.locator('#sessions').innerText();
      for (const move of moves) assert.ok(preview.includes(move.name), move.name + ' should appear in the full preview');
      assert.equal(await page.locator('#sessions .session').count(), 3, 'all three sessions should be rendered');
      assert.match(await page.locator('#programSummary').innerText(), /3/);
      await page.evaluate(() => {
        window.__exportCapture = null;
        window.html2canvas = async stage => {
          window.__exportCapture = {
            text: stage.innerText,
            style: stage.style.cssText,
            sessions: stage.querySelectorAll('.session').length,
            controls: stage.querySelectorAll('.session button').length,
            editActionDisplay: getComputedStyle(stage.querySelector('.move>div:nth-child(3)')).display
          };
          return { toBlob: callback => callback(new Blob(['test-png'], { type: 'image/png' })) };
        };
      });
      const downloadPromise = page.waitForEvent('download');
      await page.locator('#downloadWorkoutImageButton').click();
      const download = await downloadPromise;
      assert.equal(download.suggestedFilename(), 'fitness-seh-galeh-workout.png');
      assert.match(await page.locator('#status').innerText(), /عکس برنامه با موفقیت آماده شد/);
      assert.ok((await page.locator('#sessions').innerText()).includes('اسکوات مرحله نهایی'), 'the final session must remain present in the exported image');
      const exported = await page.evaluate(() => window.__exportCapture);
      assert.equal(exported.sessions, 3, 'the PNG composition should include all three sessions');
      assert.equal(exported.controls, 0, 'edit and transfer controls should not appear in the PNG composition');
      assert.match(exported.text, /فیتنس سه‌قلعه/);
      assert.match(exported.text, /ویژه آقایان · 3 جلسه/);
      assert.equal(exported.editActionDisplay, 'none', 'edit and transfer controls must be hidden in the PNG composition');
      assert.match(exported.text, /مربی: مجتبی/);
      assert.match(exported.text, /FITNESS SEH GALEH/);
      assert.match(exported.text, /اسکوات مرحله نهایی/);
      assert.match(exported.style, /width:\s*1000px/);
      assert.match(exported.style, /direction:\s*rtl/);
    });
    await check('PNG export replaces the removed PDF print button and keeps all workout sessions visible', async () => {
      assert.equal(await page.locator('#downloadWorkoutImageButton').count(), 1, 'PNG download button should be present');
      assert.equal(await page.locator('#printWorkoutButton').count(), 0, 'the old PDF/print button should be removed');
      const printCss = await page.locator('style').first().innerText();
      assert.match(printCss, /@media print/);
      assert.ok(printCss.includes('#downloadWorkoutImageButton,.no-print{display:none!important}'), 'the PNG button should not appear if the page is printed');
      assert.ok((await page.locator('#sessions').innerText()).trim().length > 0, 'all workout sessions should remain rendered');
    });
    await check('workout versions can be saved locally and compared with the current plan', async () => {
      await page.locator('#count').selectOption('2');
      await page.locator('#bulk').fill([
        ['پرس سینه', '1', 'عادی', '—', '3', '12', '60'].join(String.fromCharCode(9)),
        ['لت سیم‌کش', '2', 'عادی', '—', '3', '10', '60'].join(String.fromCharCode(9))
      ].join(String.fromCharCode(10)));
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      await page.locator('#workoutVersionName').fill('نسخه پایه آزمایشی');
      await page.locator('#saveWorkoutVersion').click();
      assert.match(await page.locator('#workoutVersionStatus').innerText(), /ذخیره شد/);
      assert.equal(await page.locator('#workoutVersionSelect option').count(), 2);
      await page.locator('#bulk').fill([
        ['پرس سینه', '1', 'عادی', '—', '4', '10', '45'].join(String.fromCharCode(9)),
        ['اسکوات', '2', 'عادی', '—', '3', '8', '90'].join(String.fromCharCode(9))
      ].join(String.fromCharCode(10)));
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      await page.locator('#compareWorkoutVersion').click();
      const comparison = await page.locator('#workoutVersionComparison').innerText();
      assert.match(comparison, /اضافه‌شده: 1/);
      assert.match(comparison, /حذف‌شده: 1/);
      assert.match(comparison, /تغییرکرده: 1/);
      assert.match(comparison, /اسکوات/);
      assert.match(comparison, /لت سیم‌کش/);
    });
    await check('loading a saved workout version restores its plan without deleting saved versions', async () => {
      await page.locator('#workoutVersionSelect').selectOption(await page.locator('#workoutVersionSelect option').nth(1).getAttribute('value'));
      await page.locator('#loadWorkoutVersion').click();
      const rows = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).map(line => line.split(String.fromCharCode(9)));
      assert.ok(rows.some(row => row[0] === 'پرس سینه' && row[4] === '3' && row[5] === '12' && row[6] === '60'));
      assert.ok(rows.some(row => row[0] === 'لت سیم‌کش'));
      assert.equal(await page.locator('#workoutVersionSelect option').count(), 2, 'loading a version should preserve the saved version list');
      assert.match(await page.locator('#workoutVersionStatus').innerText(), /بارگذاری شد/);
    });
    await check('deleting a selected workout version requires confirmation and preserves other versions', async () => {
      await page.locator('#workoutVersionSelect').selectOption(await page.locator('#workoutVersionSelect option').nth(1).getAttribute('value'));
      await page.evaluate(() => { window.confirm = () => false; });
      await page.locator('#deleteWorkoutVersion').click();
      assert.equal(await page.locator('#workoutVersionSelect option').count(), 2, 'cancel should preserve saved versions');
      await page.evaluate(() => { window.confirm = () => true; });
      await page.locator('#deleteWorkoutVersion').click();
      assert.equal(await page.locator('#workoutVersionSelect option').count(), 1, 'confirmed deletion should remove only selected version');
      assert.match(await page.locator('#workoutVersionStatus').innerText(), /حذف شد/);
    });
    await check('workout version history can be exported and imported without overwriting existing versions', async () => {
      const downloadPromise = page.waitForEvent('download');
      await page.locator('#exportWorkoutVersions').click();
      const download = await downloadPromise;
      assert.equal(download.suggestedFilename(), 'fitness-seh-galeh-workout-versions.json');
      const payload = { format: 'fitness-seh-galeh-workout-versions', version: 1, versions: [{ id: 'external-1', name: 'نسخه وارداتی', createdAt: Date.now(), gender: 'men', sessions: 2, moves: [{ name: 'پرس پا', session: 1, system: 'عادی', group: '—', sets: 3, reps: 12, rest: 60 }] }] };
      await page.evaluate(async payload => {
        const input = document.querySelector('#workoutVersionsFile');
        const transfer = new DataTransfer();
        transfer.items.add(new File([JSON.stringify(payload)], 'versions.json', { type: 'application/json' }));
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, payload);
      await page.waitForFunction(() => document.querySelector('#workoutVersionStatus').textContent.includes('نسخه وارد شد') || document.querySelector('#workoutVersionStatus').textContent.includes('معتبر'));
      assert.match(await page.locator('#workoutVersionStatus').innerText(), /1 نسخه وارد شد/);
      assert.equal(await page.locator('#workoutVersionSelect option').count(), 2, 'import should preserve existing versions and add the imported one');
      assert.ok((await page.locator('#workoutVersionSelect').innerText()).includes('نسخه وارداتی'));
      await page.evaluate(async () => {
        const input = document.querySelector('#workoutVersionsFile');
        const transfer = new DataTransfer();
        transfer.items.add(new File(['{"bad":true}'], 'invalid.json', { type: 'application/json' }));
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.waitForFunction(() => document.querySelector('#workoutVersionStatus').textContent.includes('ساختار فایل نسخه‌ها معتبر نیست'));
      assert.match(await page.locator('#workoutVersionStatus').innerText(), /ساختار فایل نسخه‌ها معتبر نیست/);
      assert.equal(await page.locator('#workoutVersionSelect option').count(), 2, 'invalid import should not change saved versions');
    });
    await check('mobile exercise picker auto-adds the exact movement count for normal, superset, triset, and giant-set', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      const cases = [
        { system: 'عادی', names: ['پرس سینه دمبل'] },
        { system: 'سوپرست', names: ['پرس سینه دمبل', 'پرس بالاسینه دمبل'] },
        { system: 'تری‌ست', names: ['پرس سینه دمبل', 'پرس بالاسینه دمبل', 'قفسه سیم‌کش'] },
        { system: 'جاینت‌ست', names: ['پرس سینه دمبل', 'پرس بالاسینه دمبل', 'قفسه سیم‌کش', 'قفسه دمبل'] }
      ];
      for (const item of cases) {
        await page.goto('http://127.0.0.1:4173/experiments/workout-template-planner.html');
        await page.locator('#bulk').evaluate(el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
        const row = page.locator('#mobileMoveRows .mobile-move-row').first();
        await row.locator('select[id^="mobile_system_"]').selectOption(item.system);
        await row.locator('summary.mobile-exercise-summary').click();
        for (const name of item.names) {
          await row.locator('.mobile-exercise-search').fill(name);
          const option = row.locator('.mobile-exercise-option').filter({ hasText: name }).first();
          if (item.system === 'عادی') {
            await option.locator('span').click();
          } else {
            // Trigger the real checkbox change handler deterministically in Chromium's mobile viewport.
            await option.locator('input.mobile-exercise-check').evaluate(el => {
              el.checked = true;
              el.dispatchEvent(new Event('change', { bubbles: true }));
            });
          }
        }
        const raw = await page.locator('#bulk').evaluate(el => el.value);
        const lines = raw.split(String.fromCharCode(10)).filter(Boolean).map(line => line.split(String.fromCharCode(9)));
        assert.equal(lines.length, item.names.length, item.system + ' should auto-add exactly the required number of movements');
        assert.deepEqual(lines.map(line => line[0]), item.names, item.system + ' should preserve selected movement order');
        assert.ok(lines.every(line => line[2] === item.system), item.system + ' should be stored on every selected movement');
        if (item.system === 'عادی') {
          assert.ok(lines.every(line => line[3] === '—'), 'normal movement should not receive a combination group');
        } else {
          assert.ok(lines.every(line => line[3] === 'A'), item.system + ' movements should share one automatically assigned group');
        }
        assert.ok((await row.locator('summary.mobile-exercise-summary').innerText()).includes(item.names[item.names.length - 1]), 'picker summary should keep the last added exercise name');
        assert.equal(await row.locator('.mobile-exercise-check:checked').count(), 0, 'checkboxes should reset after auto-add');
        assert.equal(await row.locator('details.mobile-exercise-picker').evaluate(el => el.open), false, 'picker should close after auto-add');
      }
      await page.setViewportSize({ width: 1280, height: 900 });
    });
    await check('mobile picker hides checkboxes for normal training and reveals them for combination systems', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('http://127.0.0.1:4173/experiments/workout-template-planner.html');
      await page.locator('#bulk').evaluate(el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
      const row = page.locator('#mobileMoveRows .mobile-move-row').first();
      const firstOption = row.locator('.mobile-exercise-option').filter({ hasText: 'پرس سینه دمبل' }).first();
      await row.locator('summary.mobile-exercise-summary').click();
      await row.locator('.mobile-exercise-search').fill('پرس سینه دمبل');
      assert.equal(await firstOption.locator('.mobile-exercise-check').evaluate(el => getComputedStyle(el).display), 'none', 'normal mode should not show checkbox controls');
      await firstOption.locator('span').click();
      let lines = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).filter(Boolean);
      assert.equal(lines.length, 1, 'tapping the exercise name in normal mode should add it immediately');
      assert.equal(lines[0].split(String.fromCharCode(9))[3], '—', 'normal movement should not receive a combination label');
      await row.locator('select[id^="mobile_system_"]').selectOption('سوپرست');
      await row.locator('summary.mobile-exercise-summary').click();
      await row.locator('.mobile-exercise-search').fill('پرس سینه دمبل');
      const comboOption = row.locator('.mobile-exercise-option').filter({ hasText: 'پرس سینه دمبل' }).first();
      assert.notEqual(await comboOption.locator('.mobile-exercise-check').evaluate(el => getComputedStyle(el).display), 'none', 'combination mode should show checkboxes');
      await page.setViewportSize({ width: 1280, height: 900 });
    });
    await check('mobile search filters exercises and selected session plus sets reps and rest are saved exactly', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('http://127.0.0.1:4173/experiments/workout-template-planner.html');
      await page.locator('#count').selectOption('2');
      await page.locator('#bulk').evaluate(el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
      const row = page.locator('#mobileMoveRows .mobile-move-row').first();
      await row.locator('select[id^="mobile_sets_"]').selectOption('4');
      await row.locator('select[id^="mobile_reps_"]').selectOption('15');
      await row.locator('select[id^="mobile_rest_"]').selectOption('75');
      await page.locator('#mobileTargetSession').selectOption('2');
      await row.locator('summary.mobile-exercise-summary').click();
      await row.locator('.mobile-exercise-search').fill('پرس سینه دمبل');
      const target = row.locator('.mobile-exercise-option').filter({ hasText: 'پرس سینه دمبل' }).first();
      assert.equal(await target.isVisible(), true, 'search should show the matching movement');
      assert.equal(await row.locator('.mobile-exercise-option[data-name="اسکوات هالتر"]').evaluate(el => el.hidden), true, 'search should hide unrelated movements');
      await target.locator('span').click();
      const lines = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).filter(Boolean).map(line => line.split(String.fromCharCode(9)));
      assert.equal(lines.length, 1, 'one normal movement should be appended');
      assert.deepEqual(lines[0].slice(0, 7), ['پرس سینه دمبل', '2', 'عادی', '—', '4', '15', '75'], 'session and movement settings should be stored in the row');
      await page.setViewportSize({ width: 1280, height: 900 });
    });
    await check('mobile search clear restores exercise options and settings stay independent by row', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('http://127.0.0.1:4173/experiments/workout-template-planner.html');
      await page.locator('#count').selectOption('3');
      await page.locator('#bulk').evaluate(el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
      const rows = page.locator('#mobileMoveRows .mobile-move-row');
      const first = rows.nth(0), second = rows.nth(1);
      await first.locator('select[id^="mobile_sets_"]').selectOption('5');
      await first.locator('select[id^="mobile_reps_"]').selectOption('20');
      await second.locator('select[id^="mobile_sets_"]').selectOption('2');
      await second.locator('select[id^="mobile_reps_"]').selectOption('8');
      await first.locator('summary.mobile-exercise-summary').click();
      const search = first.locator('.mobile-exercise-search');
      await search.fill('پرس سینه دمبل');
      assert.equal(await first.locator('.mobile-exercise-option[data-name="اسکوات هالتر"]').evaluate(el => el.hidden), true, 'nonmatching movement should be hidden while searching');
      await search.fill('');
      assert.equal(await first.locator('.mobile-exercise-option[data-name="اسکوات هالتر"]').evaluate(el => el.hidden), false, 'clearing search should restore all movements');
      await first.locator('.mobile-exercise-search').fill('پرس سینه دمبل');
      await first.locator('.mobile-exercise-option[data-name="پرس سینه دمبل"] span').click();
      await second.locator('summary.mobile-exercise-summary').click();
      await second.locator('.mobile-exercise-search').fill('اسکوات هالتر');
      await second.locator('.mobile-exercise-option[data-name="اسکوات هالتر"] span').click();
      const lines = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).filter(Boolean).map(line => line.split(String.fromCharCode(9)));
      assert.equal(lines.length, 2, 'both row choices should be added');
      assert.deepEqual(lines.map(line => line[0]), ['پرس سینه دمبل', 'اسکوات هالتر'], 'each row should keep its own selected movement');
      assert.deepEqual(lines.map(line => line[4]), ['5', '2'], 'sets should remain independent between rows');
      assert.deepEqual(lines.map(line => line[5]), ['20', '8'], 'repetitions should remain independent between rows');
      await page.setViewportSize({ width: 1280, height: 900 });
    });
    await check('mobile composer blocks a session number that exceeds the configured workout sessions', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('http://127.0.0.1:4173/experiments/workout-template-planner.html');
      await page.locator('#count').selectOption('2');
      await page.locator('#bulk').evaluate(el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.locator('#mobileTargetSession').selectOption('6');
      const row = page.locator('#mobileMoveRows .mobile-move-row').first();
      await row.locator('summary.mobile-exercise-summary').click();
      await row.locator('.mobile-exercise-search').fill('پرس سینه دمبل');
      await row.locator('.mobile-exercise-option').filter({ hasText: 'پرس سینه دمبل' }).first().locator('span').click();
      assert.equal(await page.locator('#bulk').inputValue(), '', 'invalid session should not append a movement');
      assert.ok((await page.locator('#mobileComposerStatus').innerText()).includes('تعداد جلسات برنامه'), 'the coach should be told to increase the configured session count');
      await page.setViewportSize({ width: 1280, height: 900 });
    });
    await check('gender-specific base, fat-loss, and muscle-building presets load the correct gender and session count', async () => {
      const presets = [
        { id: 'womenBase', gender: 'women', sessions: '3', move: 'هیپ تراست' },
        { id: 'womenFatLoss', gender: 'women', sessions: '3', move: 'استپ‌آپ' },
        { id: 'womenMuscle', gender: 'women', sessions: '4', move: 'هیپ تراست' },
        { id: 'menBase', gender: 'men', sessions: '4', move: 'پرس سینه هالتر' },
        { id: 'menFatLoss', gender: 'men', sessions: '3', move: 'لانج' },
        { id: 'menMuscle', gender: 'men', sessions: '4', move: 'پرس بالا سینه دمبل' }
      ];
      for (const preset of presets) {
        await page.locator('#preset').selectOption(preset.id);
        await page.locator('#applyPreset').click();
        assert.equal(await page.locator('#gender').inputValue(), preset.gender, preset.id + ' should set the matching gender');
        assert.equal(await page.locator('#count').inputValue(), preset.sessions, preset.id + ' should set the intended session count');
        assert.ok((await page.locator('#bulk').inputValue()).includes(preset.move), preset.id + ' should load its intended movement template');
        assert.equal(await page.locator('#sessions .session').count(), Number(preset.sessions), preset.id + ' should render every session');
      }
    });
    await check('coach end-to-end workflow builds a three-session plan with superset and triset and exports the same grouped workout as PNG', async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.locator('#gender').selectOption('women');
      await page.locator('#count').selectOption('3');
      await page.locator('#split').selectOption('manual');
      await page.locator('#bulk').fill('');
      async function addMovement(session, system, name, group) {
        await page.locator('#quickSession').selectOption(String(session));
        await page.locator('#quickSystem').selectOption(system);
        if (group !== undefined && system !== 'عادی') await page.locator('#quickGroup').fill(group);
        await page.locator('#quickName').fill(name);
        await page.getByRole('button', { name: 'افزودن به فهرست' }).click();
      }
      await page.locator('#quickSession').selectOption('1');
      await page.locator('#quickSystem').selectOption('عادی');
      await page.getByRole('button', { name: 'ساخت گروه جدید' }).click();
      const supersetGroup = await page.locator('#quickGroup').inputValue();
      await addMovement(1, 'سوپرست', 'پرس سینه دستگاه بانوان', supersetGroup);
      await addMovement(1, 'سوپرست', 'قفسه دمبل بانوان', supersetGroup);
      await addMovement(2, 'تری‌ست', 'اسکوات جام بانوان', 'A');
      await addMovement(2, 'تری‌ست', 'لانج بانوان', 'A');
      await addMovement(2, 'تری‌ست', 'پل باسن بانوان', 'A');
      await addMovement(3, 'عادی', 'پرس سرشانه بانوان');
      const inputRows = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).map(line => line.split(String.fromCharCode(9)));
      assert.equal(inputRows.length, 6, 'all six movements should be entered');
      assert.ok(inputRows.every(row => row[1] >= '1' && row[1] <= '3'), 'every movement should belong to one of the configured sessions');
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      assert.match(await page.locator('#status').innerText(), /بررسی اولیه موفق بود/);
      const preview = await page.locator('#sessions').innerText();
      for (const name of ['پرس سینه دستگاه بانوان', 'قفسه دمبل بانوان', 'اسکوات جام بانوان', 'لانج بانوان', 'پل باسن بانوان', 'پرس سرشانه بانوان']) {
        assert.ok(preview.includes(name), name + ' should appear in preview');
      }
      assert.ok(preview.includes('پرس سینه دستگاه بانوان + قفسه دمبل بانوان'), 'superset should be displayed as one plus-separated group');
      assert.ok(preview.includes('اسکوات جام بانوان + لانج بانوان + پل باسن بانوان'), 'triset should be displayed as one plus-separated group');
      assert.equal(await page.locator('#sessions .session').count(), 3, 'all three configured sessions should render');
      await page.evaluate(() => {
        window.__fullFlowExport = null;
        window.html2canvas = async stage => {
          window.__fullFlowExport = {
            text: stage.innerText,
            sessions: stage.querySelectorAll('.session').length,
            controls: stage.querySelectorAll('.session button').length,
            movements: [...stage.querySelectorAll('.move')].map(el => el.innerText)
          };
          return { toBlob: callback => callback(new Blob(['test-png'], { type: 'image/png' })) };
        };
      });
      const downloadPromise = page.waitForEvent('download');
      await page.locator('#downloadWorkoutImageButton').click();
      const download = await downloadPromise;
      assert.equal(download.suggestedFilename(), 'fitness-seh-galeh-workout.png');
      const exported = await page.evaluate(() => window.__fullFlowExport);
      assert.equal(exported.sessions, 3, 'PNG should contain all three sessions');
      assert.equal(exported.controls, 0, 'PNG should not include editing controls');
      assert.ok(exported.text.includes('ویژه بانوان · 3 جلسه'), 'PNG should preserve the selected women template');
      assert.ok(exported.text.includes('پرس سینه دستگاه بانوان + قفسه دمبل بانوان'), 'PNG should preserve plus-separated superset formatting');
      assert.ok(exported.text.includes('اسکوات جام بانوان + لانج بانوان + پل باسن بانوان'), 'PNG should preserve plus-separated triset formatting');
      for (const name of ['پرس سینه دستگاه بانوان', 'قفسه دمبل بانوان', 'اسکوات جام بانوان', 'لانج بانوان', 'پل باسن بانوان', 'پرس سرشانه بانوان']) {
        assert.ok(exported.text.includes(name), 'PNG should contain ' + name);
      }
    });
    await check('plans with 2 through 6 sessions render every session and export every movement without clipping the final session', async () => {
      await page.evaluate(() => {
        window.html2canvas = async stage => {
          window.__exportCapture = {
            sessions: stage.querySelectorAll('.session').length,
            text: stage.innerText,
            width: stage.getBoundingClientRect().width,
            height: stage.getBoundingClientRect().height,
            allMoves: [...stage.querySelectorAll('.move')].map(el => el.innerText)
          };
          return { width: 2000, height: 1600, toBlob: callback => callback(new Blob(['test-png'], { type: 'image/png' })) };
        };
      });
      for (const count of [2, 3, 4, 5, 6]) {
        await page.locator('#count').selectOption(String(count));
        await page.locator('#split').selectOption('manual');
        const rows = Array.from({ length: count }, (_, index) =>
          ['حرکت آزمایشی جلسه ' + (index + 1), String(index + 1), 'عادی', '—', '3', '12', '60'].join(String.fromCharCode(9))
        );
        await page.locator('#bulk').fill(rows.join(String.fromCharCode(10)));
        await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
        assert.equal(await page.locator('#sessions .session').count(), count, count + '-session plan should render every session');
        const downloadPromise = page.waitForEvent('download');
        await page.locator('#downloadWorkoutImageButton').click();
        const download = await downloadPromise;
        assert.equal(download.suggestedFilename(), 'fitness-seh-galeh-workout.png');
        const exported = await page.evaluate(() => window.__exportCapture);
        assert.equal(exported.sessions, count, count + '-session PNG should include all session cards');
        assert.equal(exported.allMoves.length, count, count + '-session PNG should contain every movement');
        assert.ok(exported.text.includes('جلسه ' + count), count + '-session PNG should contain the final session heading');
        for (let session = 1; session <= count; session++) {
          assert.ok(exported.text.includes('حرکت آزمایشی جلسه ' + session), 'PNG should contain the movement assigned to session ' + session);
        }
        assert.equal(exported.width, 1000, 'export composition should retain its fixed 1000px layout');
        assert.ok(exported.height > 0, 'export composition should have a measurable full height');
      }
    });
    await check('invalid incomplete combination groups are rejected before preview and image export', async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.locator('#count').selectOption('2');
      await page.locator('#bulk').fill([
        ['پرس سینه دمبل', '1', 'سوپرست', 'A', '3', '12', '60'].join(String.fromCharCode(9))
      ].join(String.fromCharCode(10)));
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      assert.ok((await page.locator('#status').innerText()).includes('حداقل 2 حرکت لازم دارد'), 'preview validation should explain that the superset is incomplete');
      await page.evaluate(() => {
        window.html2canvas = async () => { throw new Error('html2canvas must not run for invalid plans'); };
      });
      await page.locator('#downloadWorkoutImageButton').click();
      assert.ok((await page.locator('#status').innerText()).includes('ابتدا خطاهای برنامه را اصلاح کن'), 'invalid plan should be blocked from PNG export');
    });
    await check('mobile picker automatically advances combo group labels and preserves plus-separated groups', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('http://127.0.0.1:4173/experiments/workout-template-planner.html');
      await page.locator('#count').selectOption('2');
      await page.locator('#bulk').evaluate(el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
      const rows = page.locator('#mobileMoveRows .mobile-move-row');
      async function addCombo(rowIndex, system, names) {
        const row = rows.nth(rowIndex);
        await row.locator('select[id^="mobile_system_"]').selectOption(system);
        await row.locator('summary.mobile-exercise-summary').click();
        for (const name of names) {
          await row.locator('.mobile-exercise-search').fill(name);
          const option = row.locator('.mobile-exercise-option').filter({ hasText: name }).first();
          await option.locator('input.mobile-exercise-check').evaluate(el => {
            el.checked = true;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          });
        }
      }
      await addCombo(0, 'سوپرست', ['پرس سینه دمبل', 'پرس بالاسینه دمبل']);
      await addCombo(1, 'سوپرست', ['قفسه سیم‌کش', 'قفسه دمبل']);
      const lines = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).filter(Boolean).map(line => line.split(String.fromCharCode(9)));
      assert.equal(lines.length, 4, 'two completed supersets should append exactly four movements');
      assert.ok(lines.slice(0, 2).every(line => line[3] === 'A'), 'first superset should use group A');
      assert.ok(lines.slice(2, 4).every(line => line[3] === 'B'), 'second superset in the same session should use group B');
      await page.locator('#mobilePreviewButton').click();
      const preview = await page.locator('#sessions').innerText();
      assert.ok(preview.includes('پرس سینه دمبل + پرس بالاسینه دمبل'), 'first superset should render on one plus-separated line');
      assert.ok(preview.includes('قفسه سیم‌کش + قفسه دمبل'), 'second superset should render on one plus-separated line');
      await page.setViewportSize({ width: 1280, height: 900 });
    });
    await check('mobile combo labels restart per system and session for triset and giant-set', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('http://127.0.0.1:4173/experiments/workout-template-planner.html');
      await page.locator('#count').selectOption('2');
      await page.locator('#bulk').evaluate(el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
      const rows = page.locator('#mobileMoveRows .mobile-move-row');
      async function addCombo(rowIndex, system, names) {
        const row = rows.nth(rowIndex);
        await row.locator('select[id^="mobile_system_"]').selectOption(system);
        await row.locator('summary.mobile-exercise-summary').click();
        for (const name of names) {
          await row.locator('.mobile-exercise-search').fill(name);
          const option = row.locator('.mobile-exercise-option').filter({ hasText: name }).first();
          await option.locator('input.mobile-exercise-check').evaluate(el => {
            el.checked = true;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          });
        }
      }
      await addCombo(0, 'تری‌ست', ['پرس سینه هالتر', 'پرس سینه دمبل', 'پرس بالاسینه دمبل']);
      await addCombo(1, 'جاینت‌ست', ['اسکوات هالتر', 'پرس پا', 'جلو پا دستگاه', 'پشت پا خوابیده']);
      await page.locator('#mobileTargetSession').selectOption('2');
      await addCombo(2, 'سوپرست', ['قفسه سیم‌کش', 'قفسه دمبل']);
      const lines = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).filter(Boolean).map(line => line.split(String.fromCharCode(9)));
      assert.equal(lines.length, 9, 'triset, giant-set, and second-session superset should add nine movements');
      assert.ok(lines.slice(0, 3).every(line => line[2] === 'تری‌ست' && line[3] === 'A' && line[1] === '1'), 'triset should start with group A in session 1');
      assert.ok(lines.slice(3, 7).every(line => line[2] === 'جاینت‌ست' && line[3] === 'A' && line[1] === '1'), 'giant-set should independently start with group A in session 1');
      assert.ok(lines.slice(7, 9).every(line => line[2] === 'سوپرست' && line[3] === 'A' && line[1] === '2'), 'superset labels should restart at A in session 2');
      await page.locator('#mobilePreviewButton').click();
      const preview = await page.locator('#sessions').innerText();
      assert.ok(preview.includes('پرس سینه هالتر + پرس سینه دمبل + پرس بالاسینه دمبل'), 'triset should preview as one plus-separated group');
      assert.ok(preview.includes('اسکوات هالتر + پرس پا + جلو پا دستگاه + پشت پا خوابیده'), 'giant-set should preview as one plus-separated group');
      await page.setViewportSize({ width: 1280, height: 900 });
    });
    await check('bank bulk-add uses shared set, rep, and rest values and avoids duplicates in the same session', async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('http://127.0.0.1:4173/experiments/workout-template-planner.html');
      await page.locator('#count').selectOption('3');
      await page.locator('#bulk').evaluate(el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.locator('#bankSearch').fill('پرس سینه دمبل');
      await page.locator('.bankAddMoveCheck').first().check();
      await page.locator('#bankSearch').fill('قفسه سیم‌کش');
      await page.locator('.bankAddMoveCheck').first().check();
      await page.locator('#bankBulkSession').selectOption('2');
      await page.locator('#quickSets').fill('4');
      await page.locator('#quickReps').fill('10');
      await page.locator('#quickRest').fill('75');
      await page.locator('#addSelectedBankExercises').click();
      let lines = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).filter(Boolean).map(line => line.split(String.fromCharCode(9)));
      assert.equal(lines.length, 2, 'two selected bank exercises should be added');
      assert.ok(lines.every(line => line[1] === '2' && line[2] === 'عادی' && line[4] === '4' && line[5] === '10' && line[6] === '75'), 'all added movements should share the chosen session and settings');
      await page.locator('#bankSearch').fill('پرس سینه دمبل');
      await page.locator('.bankAddMoveCheck').first().check();
      await page.locator('#addSelectedBankExercises').click();
      lines = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).filter(Boolean);
      assert.equal(lines.length, 2, 'adding a movement already in the same session should not duplicate it');
    });
    await check('bank bulk-add rejects a destination session beyond the configured workout length', async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('http://127.0.0.1:4173/experiments/workout-template-planner.html');
      await page.locator('#count').selectOption('2');
      await page.locator('#bulk').evaluate(el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.locator('#bankSearch').fill('پرس سینه دمبل');
      await page.locator('.bankAddMoveCheck').first().check();
      await page.locator('#bankBulkSession').selectOption('3');
      await page.locator('#addSelectedBankExercises').click();
      assert.equal((await page.locator('#bulk').inputValue()).trim(), '', 'invalid destination must not add any movement');
      assert.ok((await page.locator('#bankStatus').innerText()).includes('بیشتر'), 'coach should receive a clear destination-session warning');
    });
    await check('exercise-bank grouping validates exact combo size and preserves selection order', async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('http://127.0.0.1:4173/experiments/workout-template-planner.html');
      await page.locator('#count').selectOption('2');
      await page.locator('#bulk').evaluate(el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.locator('#quickSystem').selectOption('سوپرست');
      await page.locator('#bankSearch').fill('پرس سینه دمبل');
      await page.locator('.bankMoveCheck').first().check();
      await page.locator('#groupSelectedExercises').click();
      assert.equal((await page.locator('#bulk').inputValue()).trim(), '', 'a single movement must not be accepted as a superset');
      assert.ok((await page.locator('#bankStatus').innerText()).includes('دقیقاً 2'), 'incomplete combo should explain the exact required count');
      await page.locator('#bankSearch').fill('پرس بالاسینه دمبل');
      await page.locator('.bankMoveCheck').first().check();
      await page.locator('#groupSelectedExercises').click();
      const lines = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).filter(Boolean).map(line => line.split(String.fromCharCode(9)));
      assert.equal(lines.length, 2, 'exactly two selected exercises should create one superset');
      assert.deepEqual(lines.map(line => line[0]), ['پرس سینه دمبل', 'پرس بالاسینه دمبل'], 'combo ordering should follow selection order');
      assert.ok(lines.every(line => line[2] === 'سوپرست' && line[3] === 'A'), 'the pair should share one new superset label');
    });
    await check('gender template hint changes without rewriting movements or workout settings', async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('http://127.0.0.1:4173/experiments/workout-template-planner.html');
      await page.locator('#bulk').evaluate(el => { el.value = 'اسکوات\t1\tعادی\t—\t4\t10\t75'; el.dispatchEvent(new Event('input', { bubbles: true })); });
      const before = await page.locator('#bulk').inputValue();
      await page.locator('#gender').selectOption('women');
      assert.ok((await page.locator('#templateHint').innerText()).includes('قالب خانم‌ها'), 'women template should show its own guidance');
      assert.equal(await page.locator('#bulk').inputValue(), before, 'changing the template label must not silently rewrite exercises');
      await page.locator('#gender').selectOption('men');
      assert.ok((await page.locator('#templateHint').innerText()).includes('قالب آقایان'), 'men template should show its own guidance');
      assert.equal(await page.locator('#bulk').inputValue(), before, 'switching back must preserve the workout rows');
    });
    await check('movement ordering controls reorder the workout and preview in the same order', async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('http://127.0.0.1:4173/experiments/workout-template-planner.html');
      await page.locator('#count').selectOption('2');
      await page.locator('#bulk').fill([
        ['پرس سینه', '1', 'عادی', '—', '3', '12', '60'],
        ['لت سیم‌کش', '1', 'عادی', '—', '3', '10', '60'],
        ['اسکوات', '1', 'عادی', '—', '4', '8', '90']
      ].map(row => row.join(String.fromCharCode(9))).join(String.fromCharCode(10)));
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      await page.locator('#moveManager .move').nth(2).getByRole('button', { name: 'انتقال حرکت به بالا' }).click();
      let names = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).map(line => line.split(String.fromCharCode(9))[0]);
      assert.deepEqual(names, ['پرس سینه', 'اسکوات', 'لت سیم‌کش'], 'move-up should change the stored row order');
      await page.locator('#moveManager .move').nth(0).getByRole('button', { name: 'انتقال حرکت به پایین' }).click();
      names = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).map(line => line.split(String.fromCharCode(9))[0]);
      assert.deepEqual(names, ['اسکوات', 'پرس سینه', 'لت سیم‌کش'], 'move-down should reorder the stored rows');
      const preview = await page.locator('#sessions .session').first().innerText();
      assert.ok(preview.indexOf('اسکوات') < preview.indexOf('پرس سینه'), 'preview should reflect the reordered workout');
      assert.ok((await page.locator('#quickStatus').innerText()).includes('ترتیب حرکت تغییر کرد'));
    });
    await check('copying a grouped movement creates a separate normal movement without altering the original group', async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('http://127.0.0.1:4173/experiments/workout-template-planner.html');
      await page.locator('#count').selectOption('2');
      await page.locator('#bulk').fill([
        ['پرس گروهی', '1', 'سوپرست', 'A', '3', '12', '60'],
        ['قفسه گروهی', '1', 'سوپرست', 'A', '3', '10', '60']
      ].map(row => row.join(String.fromCharCode(9))).join(String.fromCharCode(10)));
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      await page.locator('#moveManager .move').first().getByRole('button', { name: 'کپی حرکت پرس گروهی' }).click();
      const rows = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).map(line => line.split(String.fromCharCode(9)));
      assert.equal(rows.length, 3, 'copy should add exactly one row');
      assert.deepEqual(rows[1], ['پرس گروهی', '1', 'عادی', '—', '3', '12', '60'], 'the duplicate should be normal so it does not silently join the original superset');
      assert.deepEqual(rows[0], ['پرس گروهی', '1', 'سوپرست', 'A', '3', '12', '60'], 'the original movement should stay unchanged');
      assert.deepEqual(rows[2], ['قفسه گروهی', '1', 'سوپرست', 'A', '3', '10', '60'], 'the paired movement should stay unchanged');
      assert.equal(await page.evaluate(() => window.__trial.errors.length), 0, 'the copied workout should remain valid');
    });
    await check('bulk selection moves only selected normal movements and leaves other sessions unchanged', async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('http://127.0.0.1:4173/experiments/workout-template-planner.html');
      await page.locator('#count').selectOption('3');
      await page.locator('#bulk').fill([
        ['حرکت الف', '1', 'عادی', '—', '3', '12', '60'],
        ['حرکت ب', '1', 'عادی', '—', '3', '10', '60'],
        ['حرکت ج', '2', 'عادی', '—', '4', '8', '90']
      ].map(row => row.join(String.fromCharCode(9))).join(String.fromCharCode(10)));
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      await page.locator('input[type="checkbox"][aria-label="انتخاب حرکت حرکت الف"]').check();
      await page.locator('#bulkTargetSession').selectOption('3');
      await page.locator('#moveSelectedToSession').click();
      const trial = await page.evaluate(() => window.__trial);
      const sessionOf = name => trial.moves.find(move => move.name === name).session;
      assert.equal(sessionOf('حرکت الف'), 3, 'selected movement should move to the chosen session');
      assert.equal(sessionOf('حرکت ب'), 1, 'unselected movement in the same session should not move');
      assert.equal(sessionOf('حرکت ج'), 2, 'movement in another session should not change');
      assert.match(await page.locator('#quickStatus').innerText(), /1 حرکت به جلسه 3 منتقل شد/);
    });
    await check('responsive layout fits narrow phones, standard phones, tablets, and laptops without horizontal page overflow', async () => {
      for (const viewport of [
        { width: 320, height: 740, mobile: true },
        { width: 360, height: 800, mobile: true },
        { width: 390, height: 844, mobile: true },
        { width: 768, height: 1024, mobile: false },
        { width: 1280, height: 900, mobile: false }
      ]) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto('http://127.0.0.1:4173/experiments/workout-template-planner.html');
        const layout = await page.evaluate(() => ({
          viewport: document.documentElement.clientWidth,
          document: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
          mobileComposer: getComputedStyle(document.querySelector('#mobileComposer')).display,
          desktopMovementEntry: getComputedStyle(document.querySelector('#planMoves')).display,
          setupVisible: document.querySelector('#planSetup').getBoundingClientRect().width > 0
        }));
        assert.ok(layout.document <= layout.viewport + 1, viewport.width + 'px layout should not overflow horizontally: ' + JSON.stringify(layout));
        assert.ok(layout.body <= layout.viewport + 1, viewport.width + 'px body should not overflow horizontally: ' + JSON.stringify(layout));
        assert.equal(layout.mobileComposer === 'block', viewport.mobile, viewport.width + 'px should show mobile composer only on phone breakpoints');
        assert.ok(layout.setupVisible, viewport.width + 'px should keep program setup visible');
      }
      await page.setViewportSize({ width: 1280, height: 900 });
    });
    await check('desktop bank selection can be added with Enter without clicking the add button', async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('http://127.0.0.1:4173/experiments/workout-template-planner.html');
      await page.locator('#bulk').evaluate(el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.getByRole('button', { name: 'انتخاب حرکت پرس سینه دمبل' }).click();
      assert.equal(await page.locator('#quickName').inputValue(), 'پرس سینه دمبل');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'quickName', 'bank selection should focus the quick-entry field');
      await page.locator('#quickName').press('Enter');
      assert.ok((await page.locator('#bulk').inputValue()).includes('پرس سینه دمبل'), 'Enter should add the selected bank movement');
      assert.equal(await page.locator('#quickName').inputValue(), '', 'quick-entry field should be ready for the next movement');
    });
    await check('desktop keyboard workflow adds a movement with Enter and clears the name field for the next movement', async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('http://127.0.0.1:4173/experiments/workout-template-planner.html');
      await page.locator('#bulk').evaluate(el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.locator('#quickName').fill('پرس سینه تست کیبورد');
      await page.locator('#quickName').press('Enter');
      assert.ok((await page.locator('#bulk').inputValue()).includes('پرس سینه تست کیبورد'), 'Enter should add the movement from the name field');
      assert.equal(await page.locator('#quickName').inputValue(), '', 'name field should clear after adding');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'quickName', 'focus should return to the name field for rapid entry');
      await page.locator('#quickName').fill('لت سیم‌کش تست کیبورد');
      await page.locator('#quickName').press('Enter');
      const lines = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).filter(Boolean);
      assert.equal(lines.length, 2, 'two Enter presses should add two movements');
      assert.ok(lines[1].includes('لت سیم‌کش تست کیبورد'), 'second movement should be retained');
    });
    await check('switching between phone and laptop widths preserves the workout and movement settings', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('http://127.0.0.1:4173/experiments/workout-template-planner.html');
      await page.locator('#count').selectOption('3');
      await page.locator('#gender').selectOption('women');
      await page.locator('#bulk').evaluate(el => {
        el.value = ['هیپ تراست حفظ‌شده\t1\tعادی\t—\t4\t12\t75','ابداکتور حفظ‌شده\t2\tعادی\t—\t3\t15\t45'].join(String.fromCharCode(10));
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const before = await page.locator('#bulk').inputValue();
      await page.setViewportSize({ width: 1280, height: 900 });
      assert.equal(await page.locator('#bulk').inputValue(), before, 'resizing to laptop should not alter movement rows');
      assert.equal(await page.locator('#count').inputValue(), '3', 'session count should survive resizing');
      assert.equal(await page.locator('#gender').inputValue(), 'women', 'selected gender template should survive resizing');
      await page.setViewportSize({ width: 360, height: 800 });
      assert.equal(await page.locator('#bulk').inputValue(), before, 'resizing back to phone should preserve every movement setting');
      await page.getByRole('button', { name: 'بازبینی خروجی برنامه' }).click();
      const preview = await page.locator('#sessions').innerText();
      assert.ok(preview.includes('هیپ تراست حفظ‌شده') && preview.includes('ابداکتور حفظ‌شده'), 'preview should retain both movements after switching device widths');
    });
    await check('narrow-phone workflow can select a movement, add it to a session, and preview the result', async () => {
      await page.setViewportSize({ width: 320, height: 740 });
      await page.goto('http://127.0.0.1:4173/experiments/workout-template-planner.html');
      await page.locator('#count').selectOption('2');
      await page.locator('#bulk').evaluate(el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
      const row = page.locator('#mobileMoveRows .mobile-move-row').first();
      await row.locator('select[id^="mobile_system_"]').selectOption('عادی');
      await row.locator('summary.mobile-exercise-summary').click();
      await row.locator('.mobile-exercise-search').fill('پرس سینه دمبل');
      await row.locator('.mobile-exercise-option[data-name="پرس سینه دمبل"] span').click();
      await page.locator('#mobileAddToSession').click();
      assert.ok((await page.locator('#bulk').inputValue()).includes('پرس سینه دمبل'), 'selected movement should be added from the phone composer');
      await page.locator('#mobilePreviewButton').click();
      assert.ok((await page.locator('#sessions').innerText()).includes('پرس سینه دمبل'), 'the phone workflow should render the added movement in the preview');
      const buttons = await page.locator('#mobileComposer button:visible').evaluateAll(els => els.map(el => {
        const r = el.getBoundingClientRect();
        return { text: el.innerText, left: r.left, right: r.right, width: r.width };
      }));
      assert.ok(buttons.every(b => b.left >= -1 && b.right <= 321), 'mobile composer buttons should remain inside the 320px viewport: ' + JSON.stringify(buttons));
      await page.setViewportSize({ width: 1280, height: 900 });
    });
    await check('saved workout version round-trip preserves gender, session assignments, and grouped exercise metadata', async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.locator('#gender').selectOption('women');
      await page.locator('#count').selectOption('3');
      await page.locator('#split').selectOption('manual');
      await page.locator('#bulk').fill([
        ['پرس سینه نسخه‌دار', '1', 'سوپرست', 'A', '4', '12', '60'],
        ['قفسه نسخه‌دار', '1', 'سوپرست', 'A', '4', '10', '60'],
        ['اسکوات نسخه‌دار', '3', 'عادی', '—', '3', '8', '90']
      ].map(row => row.join(String.fromCharCode(9))).join(String.fromCharCode(10)));
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      await page.locator('#workoutVersionName').fill('گردش کامل متادیتا');
      await page.locator('#saveWorkoutVersion').click();
      assert.match(await page.locator('#workoutVersionStatus').innerText(), /ذخیره شد/, 'saving should succeed before testing the saved version list: ' + await page.locator('#workoutVersionStatus').innerText());
      const optionValue = await page.locator('#workoutVersionSelect option').evaluateAll(options => options.find(option => option.textContent.includes('گردش کامل متادیتا'))?.value || '');
      assert.ok(optionValue, 'the newly saved version should appear in the version selector');
      await page.locator('#gender').selectOption('men');
      await page.locator('#count').selectOption('2');
      await page.locator('#bulk').fill('حرکت موقت\t1\tعادی\t—\t3\t10\t60');
      await page.locator('#workoutVersionSelect').selectOption(optionValue);
      await page.locator('#loadWorkoutVersion').click();
      assert.equal(await page.locator('#gender').inputValue(), 'women', 'saved gender template should be restored');
      assert.equal(await page.locator('#count').inputValue(), '3', 'saved session count should be restored');
      const rows = (await page.locator('#bulk').inputValue()).split(String.fromCharCode(10)).map(line => line.split(String.fromCharCode(9)));
      assert.deepEqual(rows, [
        ['پرس سینه نسخه‌دار', '1', 'سوپرست', 'A', '4', '12', '60'],
        ['قفسه نسخه‌دار', '1', 'سوپرست', 'A', '4', '10', '60'],
        ['اسکوات نسخه‌دار', '3', 'عادی', '—', '3', '8', '90']
      ], 'system, group labels, workout parameters, and session assignments should survive save/load');
      assert.ok((await page.locator('#sessions').innerText()).includes('اسکوات نسخه‌دار'), 'restored plan should render the last-session movement');
    });
    await check('PNG export after reordering reflects the final movement order and grouped plus-separated labels', async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.evaluate(() => {
        window.html2canvas = async stage => {
          window.__orderedExportCapture = {
            text: stage.innerText,
            sessions: stage.querySelectorAll('.session').length,
            moves: [...stage.querySelectorAll('.move')].map(el => el.innerText)
          };
          return { width: 2000, height: 1600, toBlob: callback => callback(new Blob(['test-png'], { type: 'image/png' })) };
        };
      });
      await page.locator('#gender').selectOption('men');
      await page.locator('#count').selectOption('2');
      await page.locator('#bulk').fill([
        ['حرکت ابتدا', '1', 'عادی', '—', '3', '12', '60'],
        ['حرکت انتها', '1', 'عادی', '—', '3', '10', '60'],
        ['سوپرست الف', '2', 'سوپرست', 'A', '4', '10', '60'],
        ['سوپرست ب', '2', 'سوپرست', 'A', '4', '8', '60']
      ].map(row => row.join(String.fromCharCode(9))).join(String.fromCharCode(10)));
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      await page.locator('#moveManager .move').nth(1).getByRole('button', { name: 'انتقال حرکت به بالا' }).click();
      const preview = await page.locator('#sessions').innerText();
      assert.ok(preview.indexOf('حرکت انتها') < preview.indexOf('حرکت ابتدا'), 'preview should show the reordered movement order');
      const downloadPromise = page.waitForEvent('download');
      await page.locator('#downloadWorkoutImageButton').click();
      const download = await downloadPromise;
      assert.equal(download.suggestedFilename(), 'fitness-seh-galeh-workout.png');
      const capture = await page.evaluate(() => window.__orderedExportCapture);
      assert.equal(capture.sessions, 2, 'PNG should retain both session cards');
      assert.ok(capture.text.indexOf('حرکت انتها') < capture.text.indexOf('حرکت ابتدا'), 'PNG composition should use the reordered preview');
      assert.ok(capture.text.includes('سوپرست الف + سوپرست ب'), 'PNG composition should keep the superset joined with plus separators');
      assert.ok(capture.text.includes('مربی: مجتبی'), 'PNG composition should retain the coach footer');
    });
    await check('saved workout versions survive a full page reload and remain loadable', async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.locator('#count').selectOption('2');
      await page.locator('#gender').selectOption('men');
      await page.locator('#bulk').fill([
        ['نسخه پایدار پرس پا', '1', 'عادی', '—', '4', '12', '75'],
        ['نسخه پایدار لت', '2', 'عادی', '—', '3', '10', '60']
      ].map(row => row.join(String.fromCharCode(9))).join(String.fromCharCode(10)));
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      await page.locator('#workoutVersionName').fill('پایداری پس از بارگذاری');
      await page.locator('#saveWorkoutVersion').click();
      assert.match(await page.locator('#workoutVersionStatus').innerText(), /ذخیره شد/);
      await page.reload();
      const persistedValue = await page.locator('#workoutVersionSelect option').evaluateAll(options => options.find(option => option.textContent.includes('پایداری پس از بارگذاری'))?.value || '');
      assert.ok(persistedValue, 'saved version should remain available after reloading the page');
      await page.locator('#workoutVersionSelect').selectOption(persistedValue);
      await page.locator('#loadWorkoutVersion').click();
      assert.equal(await page.locator('#count').inputValue(), '2');
      assert.equal(await page.locator('#gender').inputValue(), 'men');
      assert.ok((await page.locator('#bulk').inputValue()).includes('نسخه پایدار پرس پا'));
      assert.ok((await page.locator('#bulk').inputValue()).includes('نسخه پایدار لت'));
      assert.ok((await page.locator('#sessions').innerText()).includes('نسخه پایدار لت'), 'persisted version should restore its second-session preview');
    });
    await check('import rejects invalid session bounds and keeps the existing version library intact', async () => {
      const before = await page.locator('#workoutVersionSelect option').count();
      const invalidPayload = {
        format: 'fitness-seh-galeh-workout-versions',
        version: 1,
        versions: [{
          id: 'invalid-session-bound',
          name: 'نسخه با جلسه نامعتبر',
          createdAt: Date.now(),
          gender: 'men',
          sessions: 7,
          moves: [{ name: 'حرکت نامعتبر', session: 7, system: 'عادی', group: '—', sets: 3, reps: 12, rest: 60 }]
        }]
      };
      await page.evaluate(async payload => {
        const input = document.querySelector('#workoutVersionsFile');
        const transfer = new DataTransfer();
        transfer.items.add(new File([JSON.stringify(payload)], 'invalid-session-bound.json', { type: 'application/json' }));
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, invalidPayload);
      await page.waitForFunction(() => document.querySelector('#workoutVersionStatus').textContent.includes('نسخه معتبر'));
      assert.match(await page.locator('#workoutVersionStatus').innerText(), /نسخه معتبر و قابل واردکردنی پیدا نشد/);
      assert.equal(await page.locator('#workoutVersionSelect option').count(), before, 'invalid import should not delete or add any saved version');
      assert.equal(await page.locator('#workoutVersionSelect option').evaluateAll(options => options.some(option => option.textContent.includes('نسخه با جلسه نامعتبر'))), false);
    });
    await check('blank workout version names are rejected without modifying saved versions', async () => {
      const before = await page.locator('#workoutVersionSelect option').count();
      await page.locator('#workoutVersionName').fill('   ');
      await page.locator('#saveWorkoutVersion').click();
      assert.match(await page.locator('#workoutVersionStatus').innerText(), /برای نسخه یک نام وارد کن/);
      assert.equal(await page.locator('#workoutVersionSelect option').count(), before, 'blank name should not create a saved version');
    });
    await check('imported workout version with a duplicate name receives a new name without overwriting the original', async () => {
      await page.locator('#count').selectOption('2');
      await page.locator('#bulk').fill('حرکت اصلی نسخه تکراری\t1\tعادی\t—\t3\t10\t60');
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      await page.locator('#workoutVersionName').fill('نام نسخه تکراری');
      await page.locator('#saveWorkoutVersion').click();
      const originalId = await page.locator('#workoutVersionSelect option').evaluateAll(options => options.find(option => option.textContent.includes('نام نسخه تکراری'))?.value || '');
      assert.ok(originalId, 'original named version should exist');
      const payload = {
        format: 'fitness-seh-galeh-workout-versions', version: 1,
        versions: [{ id: 'duplicate-import-id', name: 'نام نسخه تکراری', createdAt: Date.now(), gender: 'men', sessions: 2,
          moves: [{ name: 'حرکت وارداتی', session: 2, system: 'عادی', group: '—', sets: 4, reps: 8, rest: 90 }] }]
      };
      await page.evaluate(async payload => {
        const input = document.querySelector('#workoutVersionsFile');
        const transfer = new DataTransfer();
        transfer.items.add(new File([JSON.stringify(payload)], 'duplicate-version.json', { type: 'application/json' }));
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, payload);
      await page.waitForFunction(() => document.querySelector('#workoutVersionStatus').textContent.includes('1 نسخه وارد شد'));
      const options = await page.locator('#workoutVersionSelect option').evaluateAll(els => els.map(o => ({ value: o.value, text: o.textContent })));
      assert.ok(options.some(o => o.value === originalId), 'original version identifier should be preserved');
      assert.ok(options.some(o => o.text.includes('نام نسخه تکراری (2)')), 'imported duplicate should be renamed rather than overwriting');
      assert.equal(options.filter(o => o.text.includes('نام نسخه تکراری')).length, 2, 'both original and imported versions should remain available');
    });
    await check('custom template names are rendered as text rather than interpreted as HTML', async () => {
      await page.locator('#gender').selectOption('men');
      await page.locator('#count').selectOption('2');
      await page.locator('#bulk').fill('حرکت قالب امن\t1\tعادی\t—\t3\t10\t60');
      await page.locator('#customName').fill('<img src=x onerror=alert(1)> قالب امن');
      await page.getByRole('button', { name: 'ذخیره با نام دلخواه' }).click();
      assert.equal(await page.locator('#savedTemplates option').filter({ hasText: '<img src=x onerror=alert(1)> قالب امن' }).count(), 1, 'custom label should be visible as literal text');
      assert.equal(await page.locator('#savedTemplates img').count(), 0, 'template label must not create an image element');
      assert.equal(await page.locator('img[src="x"]').count(), 0, 'template label must not inject HTML into the document');
    });
    await check('women template selection updates explanatory hint', async () => {
      await page.locator('#gender').selectOption('women');
      assert.ok((await page.locator('#templateHint').innerText()).includes('قالب خانم‌ها'));
    });
  } finally {
    await browser.close();
  }
  if (failures.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
