const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const failures = [];
  try {
    await page.goto('http://127.0.0.1:4173/experiments/workout-template-planner.html');
    for (const width of [320, 360, 390, 430, 560]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(50);
      const state = await page.evaluate(() => ({
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        composerDisplay: getComputedStyle(document.querySelector('#mobileComposer')).display,
        legacyEditorDisplay: getComputedStyle(document.querySelector('#planMoves')).display,
        previewDisplay: getComputedStyle(document.querySelector('#planPreview')).display
      }));
      try {
        assert.equal(state.composerDisplay, 'block', 'phone composer should be visible');
        assert.equal(state.legacyEditorDisplay, 'none', 'desktop/group editor should remain hidden on phone');
        assert.ok(state.documentWidth <= state.viewport + 1,
          `horizontal overflow at ${width}px: document=${state.documentWidth}px`);
        assert.notEqual(state.previewDisplay, 'none', 'program preview should remain available');
        console.log(`PASS: mobile layout at ${width}px`);
      } catch (error) {
        failures.push(`${width}px: ${error.message}`);
        console.error(`FAIL: mobile layout at ${width}px\n${error.message}`);
      }
    }

    // Exercise validation and a multi-session save/reload/restore round trip on a narrow phone.
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto('http://127.0.0.1:4173/experiments/workout-template-planner.html');
    await page.evaluate(() => localStorage.removeItem('fitnessSehGalehWorkoutVersions'));
    await page.locator('#count').selectOption('2');
    await page.locator('#bulk').evaluate(el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
    const row = page.locator('#mobileMoveRows .mobile-move-row').first();

    await row.locator('select[id^="mobile_system_"]').selectOption('عادی');
    await row.locator('summary.mobile-exercise-summary').click();
    await row.locator('.mobile-exercise-search').fill('پرس سینه دمبل');
    await row.locator('.mobile-exercise-option[data-name="پرس سینه دمبل"] span').click();
    await page.locator('#mobileAddToSession').click();

    await page.locator('#mobileTargetSession').selectOption('2');
    const secondRow = page.locator('#mobileMoveRows .mobile-move-row').nth(1);
    await secondRow.locator('summary.mobile-exercise-summary').click();
    await secondRow.locator('.mobile-exercise-search').fill('قایقی سیم‌کش');
    await secondRow.locator('.mobile-exercise-option[data-name="قایقی سیم‌کش"] span').click();
    await page.locator('#mobileAddToSession').click();

    await page.locator('#mobilePreviewButton').click();
    const beforeSave = await page.locator('#sessions').innerText();
    assert.ok(beforeSave.includes('پرس سینه دمبل'), 'first movement should appear in the preview');
    assert.ok(beforeSave.includes('قایقی سیم‌کش'), 'second movement should appear in the preview');
    assert.match(beforeSave, /جلسه\s*[۱1]/, 'preview should show session 1');
    assert.match(beforeSave, /جلسه\s*[۲2]/, 'preview should show session 2');

    await page.locator('#mobileSaveVersion').click();
    assert.match(await page.locator('#mobileVersionStatus').innerText(), /نام|ذخیره/,
      'blank version names should produce a helpful validation message');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('fitnessSehGalehWorkoutVersions') || '[]').length), 0,
      'blank version name must not create a saved version');

    await page.locator('#mobileVersionName').fill('تست ذخیره موبایل چندجلسه‌ای');
    await page.locator('#mobileSaveVersion').click();
    assert.match(await page.locator('#mobileVersionStatus').innerText(), /ذخیره شد/,
      'saving a named plan from a 320px viewport should succeed');
    await page.reload();

    const savedOption = page.locator('#mobileVersionSelect option').filter({ hasText: 'تست ذخیره موبایل چندجلسه‌ای' }).first();
    await savedOption.waitFor({ state: 'attached' });
    const savedValue = await savedOption.getAttribute('value');
    assert.ok(savedValue, 'saved phone workout should remain in local storage after reload');
    await page.locator('#mobileVersionSelect').selectOption(savedValue);
    await page.locator('#mobileLoadVersion').click();
    await page.locator('#mobilePreviewButton').click();

    const restoredPreview = await page.locator('#sessions').innerText();
    assert.ok(restoredPreview.includes('پرس سینه دمبل'), 'first movement should restore after a full reload');
    assert.ok(restoredPreview.includes('قایقی سیم‌کش'), 'second movement should restore after a full reload');
    assert.match(restoredPreview, /جلسه\s*[۱1]/, 'restored preview should show session 1');
    assert.match(restoredPreview, /جلسه\s*[۲2]/, 'restored preview should show session 2');
    const restoredBulk = await page.locator('#bulk').inputValue();
    assert.match(restoredBulk, /پرس سینه دمبل\t1\tعادی\t—\t3\t12\t60/);
    assert.match(restoredBulk, /قایقی سیم‌کش\t2\tعادی\t—\t3\t12\t60/);
    console.log('PASS: 320px phone workflow validates blank names and saves/reloads/restores a multi-session workout');
  } finally {
    await browser.close();
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
})().catch(error => { console.error(error); process.exit(1); });
