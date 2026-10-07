import { expect, test } from '@playwright/test';
import { addTask, openApp, switchTheme, switchView } from './helpers';

const EVIDENCE = '../apps/web/evidence/growth-ux';

async function waitForHeatmapLatest(page: import('@playwright/test').Page): Promise<void> {
  const scroll = page.getByTestId('growth-heatmap-scroll');
  const maxScroll = await scroll.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(maxScroll, '热力图在窄屏必须确实产生横向可滚距离').toBeGreaterThan(0);
  await expect
    .poll(async () => scroll.evaluate((el) => el.scrollLeft))
    .toBeGreaterThanOrEqual(maxScroll - 1);
}

test('Growth 真实空态与 seed 数据在亮暗、桌面与窄屏可读', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  await switchView(page, '成长');

  // 每条旅程从真正的空库开始：只做用户会做的导航，不写 localStorage 或实体。
  await expect(page.getByTestId('growth-board')).toBeVisible();
  await expect(page.getByTestId('growth-week')).toBeVisible();
  await expect(page.getByTestId('growth-heatmap')).toBeVisible();
  await expect(page.getByTestId('growth-milestones')).toBeVisible();
  await expect(page.getByTestId('growth-tags')).toBeVisible();
  await expect(page.getByTestId('category-report')).toBeVisible();
  await expect(page.getByTestId('category-report-empty')).toBeVisible();

  // 首次布局直接在窄屏完成：这是唯一一次应自动定位到最近日期的时机。
  await waitForHeatmapLatest(page);

  for (const [width, height] of [
    [1440, 900],
    [1024, 600],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({
      path: `${EVIDENCE}/growth-empty-${String(width)}x${String(height)}-light.png`,
      fullPage: true,
    });
  }

  // 再用真实 UI 造数据：任务完成数来自任务 op，专注记录来自真实计时器。
  // 浏览器时钟只把 25 分钟的等待压缩掉，不伪造持久化状态。
  await page.clock.install({ time: new Date(2026, 8, 24, 20, 0, 0) });
  await page.clock.resume();
  await switchView(page, '任务');
  await addTask(page, '整理本周计划');
  await addTask(page, '完成一次复盘');
  await page.getByRole('checkbox', { name: '完成：完成一次复盘' }).click();

  await switchView(page, '番茄钟');
  const focusTask = page.locator('select').filter({ has: page.locator('option', { hasText: '整理本周计划' }) });
  await focusTask.selectOption({ label: '整理本周计划' });
  await page.getByRole('button', { name: '开始专注' }).click();
  await expect(page.getByRole('button', { name: '暂停' })).toBeVisible();
  await page.clock.fastForward('26:00');

  await switchView(page, '成长');
  await expect(page.getByTestId('category-report-empty')).toHaveCount(0);
  await expect(page.getByTestId('category-unassigned')).toContainText('25 分钟');
  await expect(page.getByTestId('growth-heatmap-scroll-hint')).toHaveText('左右滑动查看最近日期。');

  const heatmap = page.getByTestId('growth-heatmap-scroll');
  const selected = page.getByTestId('growth-heatmap-selection');
  await page.getByTestId('activity-cell-2026-09-24').click();
  await expect(selected).toContainText('2026-09-24');
  await expect(page.locator('[data-testid^="activity-cell-"][tabindex="0"]')).toHaveCount(0);
  await expect(heatmap).toHaveAttribute('tabindex', '0');
  await heatmap.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(selected).toContainText('2026-09-17');
  await page.keyboard.press('ArrowUp');
  await expect(selected).toContainText('2026-09-16');

  // 真正手动横滚后，resize 不应把用户的位置重新吸回最右端。
  await page.setViewportSize({ width: 390, height: 844 });
  const manuallyScrolled = await heatmap.evaluate((el) => {
    const max = el.scrollWidth - el.clientWidth;
    const target = Math.floor(max / 2);
    el.scrollLeft = target;
    // RN Web nests the horizontal scroller; dispatch the same wheel signal that
    // a user gesture sends so the component records manual navigation.
    el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaX: 1 }));
    return el.scrollLeft;
  });
  const maxBeforeResize = await heatmap.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(manuallyScrolled, '手动横滚必须真的改变热力图位置').toBeGreaterThan(0);
  expect(manuallyScrolled, '手动横滚位置必须仍在滚动范围内').toBeLessThan(maxBeforeResize);
  await page.setViewportSize({ width: 500, height: 844 });
  await expect.poll(async () => heatmap.evaluate((el) => el.scrollLeft)).toBe(manuallyScrolled);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByTestId('growth-heatmap-scroll-hint')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('growth-heatmap-scroll-hint')).toBeVisible();

  for (const [width, height] of [
    [1440, 900],
    [1024, 600],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({
      path: `${EVIDENCE}/growth-${String(width)}x${String(height)}-light.png`,
      fullPage: true,
    });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId('growth-milestones').scrollIntoViewIfNeeded();
  // Move away from the rail so the desktop tooltip cannot pollute the evidence frame.
  await page.mouse.move(800, 450);
  await page.screenshot({
    path: `${EVIDENCE}/growth-1440x900-light-bottom.png`,
    fullPage: false,
  });

  await switchTheme(page, 'dark');
  for (const [width, height] of [
    [1440, 900],
    [1024, 600],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({
      path: `${EVIDENCE}/growth-${String(width)}x${String(height)}-dark.png`,
      fullPage: true,
    });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId('growth-milestones').scrollIntoViewIfNeeded();
  await page.mouse.move(800, 450);
  await page.screenshot({
    path: `${EVIDENCE}/growth-1440x900-dark-bottom.png`,
    fullPage: false,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => ({
    documentScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    heatmapScrollWidth: document.querySelector<HTMLElement>('[data-testid="growth-heatmap-scroll"]')?.scrollWidth ?? 0,
    heatmapClientWidth: document.querySelector<HTMLElement>('[data-testid="growth-heatmap-scroll"]')?.clientWidth ?? 0,
    heatmapScrollLeft: document.querySelector<HTMLElement>('[data-testid="growth-heatmap-scroll"]')?.scrollLeft ?? 0,
  }));
  expect(overflow.documentScrollWidth, '成长页不得把整个文档撑出横向溢出').toBeLessThanOrEqual(
    overflow.viewportWidth,
  );
  expect(overflow.heatmapScrollWidth, '热力图事实宽度应被收进自身滚动容器').toBeGreaterThanOrEqual(
    overflow.heatmapClientWidth,
  );
  expect(overflow.heatmapScrollLeft, '横向滚动位置必须保持在滚动范围内').toBeGreaterThanOrEqual(0);
  expect(overflow.heatmapScrollLeft, '横向滚动位置不能超过滚动范围').toBeLessThanOrEqual(
    overflow.heatmapScrollWidth - overflow.heatmapClientWidth,
  );

  const mobileLayout = await page.evaluate(() => {
    const week = document.querySelector<HTMLElement>('[data-testid="growth-week"]');
    const stats = document.querySelector<HTMLElement>('[data-testid="growth-week-stats"]');
    return {
      weekHeight: week?.getBoundingClientRect().height ?? 0,
      statsScrollWidth: stats?.scrollWidth ?? 0,
      statsClientWidth: stats?.clientWidth ?? 0,
    };
  });
  expect(mobileLayout.weekHeight, '390px 周报不应被三列指标撑成高卡片').toBeLessThan(220);
  expect(mobileLayout.statsScrollWidth, '周报指标不能在窄屏横向溢出').toBeLessThanOrEqual(
    mobileLayout.statsClientWidth,
  );

  await switchView(page, '设置');
  await page.getByTestId('language-option-en').click();
  await page.getByTestId('settings-sheet-close').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  const valueRows = page.locator('[data-testid^="growth-week-stat-"]');
  expect(await valueRows.count()).toBe(3);
  for (const row of await valueRows.all()) {
    expect(await row.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  }
  for (const label of await page.getByTestId('growth-heatmap-month').all()) {
    expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await label.evaluate((el) => el.clientHeight <= parseFloat(getComputedStyle(el).lineHeight) + 1)).toBe(true);
  }
  await page.screenshot({ path: `${EVIDENCE}/growth-390x844-dark-en.png` });
});
