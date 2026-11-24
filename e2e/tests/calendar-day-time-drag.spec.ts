/**
 * 日历「日档拖拽改时刻」—— 真浏览器验收
 * =====================================
 *
 * 钉一件事：**把全天带里的一条任务拖到小时轴上某一小时，它真的挂到那一小时**（= 截止时刻变了）。
 *
 * 🔴 只能在真浏览器里量：拖拽是指针手势 + dnd-kit 几何命中，jsdom 里 rect 全是 0，
 *    任何"拖到了"的判据都会恒真（§7 元规则 2）。业务语义（落点 → 时刻）由
 *    `packages/domain/tests/calendar-drop.spec.ts` 的 `planCalendarTimeDrop` 组钉死，这里只验接线。
 *
 * 判据：拖之前它在 `全天带`；拖之后它在 `calendar-board-day-timed-<hour>`，且全天带里没有了。
 */

import { expect, test, type Page } from '@playwright/test';

import { openApp, switchView } from './helpers';

const APP_ZH = '/?lang=zh-CN';
const DAY_BOARD = '[data-testid="calendar-board-day"]';
const VIEW_SELECT = '[data-testid="calendar-view-select"]';
const ALL_DAY = '[data-testid="calendar-board-day-all-day"]';
const STAMP = Date.now().toString().slice(-6);
const TITLE = `日档拖拽-${STAMP}`;
/** 拖到 04:00 那一行（视口内可见；小时轴可滚，选低小时免得落点在折叠区外）。 */
const HOUR = 4;

function timedList(hour: number): string {
  return `[data-testid="calendar-board-day-timed-${String(hour).padStart(2, '0')}"]`;
}

async function dragRowToHour(page: Page, fromLocatorCb: () => ReturnType<Page['locator']>, hour: number): Promise<void> {
  const src = await fromLocatorCb().boundingBox();
  const dst = await page.locator(`[data-testid="calendar-board-day-hour-${String(hour).padStart(2, '0')}"]`).boundingBox();
  if (src === null || dst === null) throw new Error('拿不到 src/dst 的 boundingBox');
  const sx = src.x + src.width / 2;
  const sy = src.y + src.height / 2;
  const dx = dst.x + Math.min(dst.width - 10, 120);
  const dy = dst.y + Math.min(dst.height / 2, 20);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 12, sy + 12, { steps: 5 });
  await page.mouse.move(dx, dy, { steps: 20 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(400);
}

test('🔴 把全天带的任务拖到小时轴某一行 ⇒ 它挂到那一小时（dueDate 的时刻真的改了）', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openApp(page, APP_ZH);

  // 播一条截止到今天的全天任务。
  const composer = page.locator('input[placeholder^="添加任务"]');
  await composer.fill(`今天 ${TITLE}`);
  await composer.press('Enter');
  await expect(page.getByRole('checkbox', { name: `完成：${TITLE}` })).toBeVisible();

  // 进日视图。
  await switchView(page, '日历');
  await page.selectOption(VIEW_SELECT, 'day');
  await expect(page.locator(DAY_BOARD)).toBeVisible();

  // 前提：拖之前它在全天带里。
  const inAllDay = page.locator(ALL_DAY).getByRole('checkbox', { name: `完成：${TITLE}` });
  await expect(inAllDay, '开始前它不在全天带里，后面没东西可拖').toBeVisible();

  await page.screenshot({ path: 'test-results/calendar-day-time-drag-before.png' });
  await dragRowToHour(page, () => inAllDay, HOUR);
  await page.screenshot({ path: 'test-results/calendar-day-time-drag-after.png' });

  // 主判据：它出现在第 HOUR 小时的任务列表里。
  await expect(
    page.locator(timedList(HOUR)).getByRole('checkbox', { name: `完成：${TITLE}` }),
    '拖完之后它没有挂到那一小时 —— 日档拖拽没生效',
  ).toBeVisible();
  // 反向判据：全天带里不再有它（改的是时刻，不是复制一条）。
  await expect(
    page.locator(ALL_DAY).getByRole('checkbox', { name: `完成：${TITLE}` }),
    '拖完之后全天带里还有它 —— 像是复制而不是改时刻',
  ).toHaveCount(0);
});
