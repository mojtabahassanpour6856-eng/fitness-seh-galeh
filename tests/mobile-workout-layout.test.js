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

    // Exercise the full phone workflow, including local save/reload, at the narrowest supported width.
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
    await page.locator('#mobilePreviewButton').click();
    assert.ok((await page.locator('#sessions').innerText()).includes('پرس سینه دمبل'),
      'phone-added movement should appear in the preview before saving');
    await page.locator('#workoutVersionName').fill('تست ذخیره موبایل');
    await page.locator('#saveWorkoutVersion').click();
    assert.match(await page.locator('#workoutVersionStatus').innerText(), /ذخیره شد/,
      'saving a plan from a 320px viewport should succeed');
    await page.reload();
    const savedOption = page.locator('#workoutVersionSelect option').filter({ hasText: 'تست ذخیره موبایل' }).first();
    await savedOption.waitFor({ state: 'attached' });
    const savedValue = await savedOption.getAttribute('value');
    assert.ok(savedValue, 'saved phone workout should remain in local storage after reload');
    await page.locator('#workoutVersionSelect').selectOption(savedValue);
    await page.locator('#loadWorkoutVersion').click();
    await page.locator('#mobilePreviewButton').click();
    assert.ok((await page.locator('#sessions').innerText()).includes('پرس سینه دمبل'),
      'the saved phone workout should load and preview after a full reload');
    console.log('PASS: 320px phone workflow adds, saves, reloads, and restores a workout');
  } finally {
    await browser.close();
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
})().catch(error => { console.error(error); process.exit(1); });
