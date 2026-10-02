/* 探针：DueEditor 面板到底画在哪、多大。只取证，不改代码。 */
const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e)));
  await page.goto('http://127.0.0.1:4322/?lang=zh-CN', { waitUntil: 'networkidle' }).catch(async () => {
    // webServer 由 playwright config 管理的场景外，这里直接试 5173/4318 都可能没起 —— 报告即可
    console.log('GOTO-FAILED');
  });
  const later = page.getByRole('button', { name: /以后再说|Decide later/ });
  if (await later.count()) await later.click();
  await page.waitForSelector('[data-testid="task-list"]', { timeout: 30000 });

  const composer = page.locator('input[placeholder^="添加任务"]');
  await composer.fill('probe-due');
  await composer.press('Enter');
  await page.waitForTimeout(800);

  const summary = page.locator('[data-testid="due-editor-summary"]').first();
  console.log('SUMMARY-COUNT', await summary.count());
  await summary.click();
  await page.waitForTimeout(800);

  const picker = page.locator('[data-testid="date-picker"]').first();
  console.log('PICKER-COUNT', await picker.count());
  console.log('PICKER-BOX', JSON.stringify(await picker.boundingBox()));
  const cell = page.locator('[role="button"][aria-label$="日"]').first();
  console.log('CELL-COUNT', await cell.count());
  console.log('CELL-BOX', JSON.stringify(await cell.boundingBox()));
  const details = page.locator('details:has([data-testid="due-editor-summary"])').first();
  console.log('DETAILS-OPEN', await details.getAttribute('open'));
  // 面板（.ht-material）的几何与父链
  const panelInfo = await page.evaluate(() => {
    const summary = document.querySelector('[data-testid="due-editor-summary"]');
    const details = summary?.closest('details');
    const panel = details?.querySelector('.ht-material');
    if (!panel) return 'NO-PANEL';
    const r = panel.getBoundingClientRect();
    const cs = getComputedStyle(panel);
    const parent = panel.offsetParent;
    return {
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      display: cs.display,
      overflow: cs.overflow,
      position: cs.position,
      offsetParent: parent ? parent.tagName + '.' + (parent.className || '') : 'null',
      childCount: panel.childElementCount,
    };
  });
  console.log('PANEL-INFO', JSON.stringify(panelInfo));
  await page.screenshot({ path: 'test-results/due-probe.png', fullPage: true });
  await browser.close();
})();
