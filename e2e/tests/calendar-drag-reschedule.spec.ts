/**
 * 日历「拖拽改期」—— 真浏览器验收
 * ================================
 *
 * 钉一件事：**把任务条从今天那格拖到另一天，它真的出现在那一天**（= dueDate 变了）。
 *
 * 🔴 为什么这条只能在真浏览器里量：拖拽是 pointer 手势 + dnd-kit 的几何命中，
 *    jsdom 里 rect 全是 0，任何"拖到了"的判据都会恒真（§7 元规则 2）。
 *    业务语义（落点 → dueDate/dueDateLocal）已由 `packages/domain/tests/calendar-drop.spec.ts`
 *    在纯函数层钉死；这里只证明**接线真的接上了**。
 *
 * 判据是**结构性的**（某一天的格子里有没有那条 bar），不是"出现了这个词"：
 *   · 拖之前：`calendar-cell-<今天>-bar` 里有它；
 *   · 拖之后：`calendar-cell-<明天>-bar` 里有它，且 `<今天>` 那格没有了。
 */

import { expect, test, type Page } from '@playwright/test';

import { openApp } from './helpers';

const APP_ZH = '/?lang=zh-CN';
const BOARD = '[data-testid="calendar-board"]';
const STAMP = Date.now().toString().slice(-6);
const TITLE = `拖拽改期-${STAMP}`;

/** 本地日历日（`YYYY-MM-DD`），offset 天。测试进程与浏览器同一时区（Asia/Shanghai）。 */
function localDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 某天格子里那条 bar 的定位器（按标题过滤，避免同日多条时误抓）。 */
function barOnDay(page: Page, date: string): ReturnType<Page['locator']> {
  return page.locator(`[data-testid="calendar-cell-${date}-bar"]`, { hasText: TITLE });
}

/**
 * 用鼠标事件驱动 dnd-kit 的 `PointerSensor`（Chromium 会把 mouse 合成 pointer）。
 * 起手先位移 12px（越过 `activationConstraint.distance = 6`），再分段移到落点。
 */
async function dragBarToDay(page: Page, fromDate: string, toDate: string): Promise<void> {
  const src = barOnDay(page, fromDate);
  await expect(src, '拖拽源（今天的 bar）不在了，后面没东西可拖').toBeVisible();
  const srcBox = await src.boundingBox();
  const dstBox = await page.locator(`[data-testid="calendar-cell-${toDate}"]`).boundingBox();
  if (srcBox === null || dstBox === null) throw new Error('拿不到 src/dst 的 boundingBox');

  const sx = srcBox.x + srcBox.width / 2;
  const sy = srcBox.y + srcBox.height / 2;
  const dx = dstBox.x + dstBox.width / 2;
  const dy = dstBox.y + dstBox.height / 2;

  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 12, sy + 12, { steps: 5 });
  await page.mouse.move(dx, dy, { steps: 20 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(400);
}

test('🔴 把任务条从今天拖到明天 ⇒ 它出现在明天的格子（dueDate 真的改了）', async ({ page }) => {
  await openApp(page, APP_ZH);

  // 建一条截止到今天的任务（「今天 X」捕获成 dueDate=今天）。
  const composer = page.locator('input[placeholder^="添加任务"]');
  await composer.fill(`今天 ${TITLE}`);
  await composer.press('Enter');
  await expect(page.getByRole('checkbox', { name: `完成：${TITLE}` })).toBeVisible();

  // 进日历（默认月档）。
  await page.getByRole('tab', { name: '日历' }).click();
  await expect(page.locator(BOARD)).toBeVisible();

  const today = localDate(0);
  const tomorrow = localDate(1);

  await page.screenshot({ path: 'test-results/calendar-drag-before.png' });
  // 前提：开始前，今天的格子里**确实有**这一条。没有的话下面的断言无意义。
  await expect(barOnDay(page, today), '开始前今天的格子里没有这条 bar').toBeVisible();

  await dragBarToDay(page, today, tomorrow);

  await page.screenshot({ path: 'test-results/calendar-drag-after.png' });

  // 主判据：它跑到明天那一格了。
  await expect(barOnDay(page, tomorrow), '拖完之后明天的格子里没有这条 bar —— 拖拽没生效').toBeVisible();
  // 反向判据：今天那格不再有它（否则就是"复制了一条"而不是"改期"）。
  await expect(barOnDay(page, today), '拖完之后今天那格里还有它 —— 像是复制而不是改期').toHaveCount(0);
});
