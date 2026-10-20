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
        ['حرکت یک', '1', 'سوپرست', 'A', '3', '12', '60'].join('\\t'),
        ['حرکت دو', '2', 'سوپرست', 'A', '3', '12', '60'].join('\\t')
      ].join('\\n'));
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      const status = await page.locator('#status').innerText();
      assert.match(status, /جلسه 1/);
      assert.match(status, /جلسه 2/);
      assert.match(status, /حداقل 2 حرکت لازم دارد/);
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
    await check('women template selection updates explanatory hint', async () => {
      await page.locator('#gender').selectOption('women');
      assert.ok((await page.locator('#templateHint').innerText()).includes('قالب خانم‌ها'));
    });
  } finally {
    await browser.close();
  }
  if (failures.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
