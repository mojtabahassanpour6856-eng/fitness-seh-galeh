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
  } finally {
    await browser.close();
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
})().catch(error => { console.error(error); process.exit(1); });
