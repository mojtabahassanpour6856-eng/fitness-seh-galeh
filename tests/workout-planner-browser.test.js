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
    await check('custom template can be saved and loaded', async () => {
      await page.locator('#customName').fill('تست مرورگر');
      await page.getByRole('button', { name: 'ذخیره در همین مرورگر' }).click();
      assert.equal(await page.locator('#savedTemplates').inputValue(), 'تست مرورگر');
      await page.locator('#bulk').fill('حرکت موقت\t1\tعادی\t—\t3\t10\t60');
      await page.getByRole('button', { name: 'بارگذاری', exact: true }).click();
      assert.ok((await page.locator('#bulk').inputValue()).includes('پرس سینه دمبل'));
    });
    await check('JSON export downloads a file', async () => {
      await page.getByRole('button', { name: 'اعتبارسنجی و پیش‌نمایش' }).click();
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'دانلود داده‌های آزمایشی JSON' }).click();
      const download = await downloadPromise;
      assert.match(download.suggestedFilename(), /\.json$/);
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
