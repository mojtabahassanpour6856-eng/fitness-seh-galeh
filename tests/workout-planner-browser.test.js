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
      await page.locator('#bulk').fill('');
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
    await check('selected bank movements can be grouped into a triset with plus preview', async () => {
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
      await page.getByRole('button', { name: 'ذخیره در همین مرورگر' }).click();
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
    await check('women template selection updates explanatory hint', async () => {
      await page.locator('#gender').selectOption('women');
      assert.ok((await page.locator('#templateHint').innerText()).includes('قالب خانم‌ها'));
    });
  } finally {
    await browser.close();
  }
  if (failures.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
