/**
 * 倒数日出现在**日历**上（批次二 W6 的界面判据，真浏览器）
 * ======================================================
 *
 * ## 为什么这条要在真浏览器里跑一遍
 *
 * W6 给共享 `CalendarBoard` 加的是**两个默认值等于原行为的可选 prop**
 * （`events?` / `eventLabels?`）。这种形状最阴的假绿是：
 *
 * > 共享层测试全绿（它**支持**了），宿主一行没接 ⇒ 界面上一个倒数日都没有，
 * > 而没有任何一层会失败。
 *
 * `packages/ui` 与 `apps/web` 那两层各有一条同族判据，但都跑在 node/jsdom 里；
 * 这一条要的是**真人那条路**：在倒数日页真点一次日期、真写一条、切到日历、
 * 月份真翻过去，看那一格里是不是真的多出一行 —— 并且**截图、人打开看过**。
 *
 * ## 判据为什么长成这样
 *
 * · **那一天没有任何任务条**是夹具前提，不是巧合：`-bar` 计数为 0 时，
 *   那一格里出现的任何一行都只可能来自第二个源。缺了这条，"日历只有一个源"
 *   会被"任务条画出来了"读成通过。
 * · 行里必须同时出现**标题**与**「还有 N 天」**：只出现标题 = 共享层画了
 *   而宿主没注入词表（`calendarEventBarTitle` 的默认分支）。
 * · 第二条用例钉**刷新之后还在** —— 那条倒数日是走 op-log 落库的，
 *   不是某个组件的内存态。
 */

import { expect, test } from '@playwright/test';

import { openApp, switchView } from './helpers';
import { addCountdownEvent, collectErrors, nextMonthFirst, TAB } from './countdown-events';

const BOARD = '[data-testid="calendar-board"]';
/** 档位下拉（web 外壳那一颗）。四档共用它，所以"切档"在浏览器里就是换它的值。 */
const VIEW_SELECT = '[data-testid="calendar-view-select"]';
/**
 * 证据落在**受版本控制**的目录里（照 `calendar-view-options.spec.ts` 那条既有纪律）：
 * `e2e/test-results/` 每一趟都会被清掉，而"截图且人看过"要的是那张图还在。
 */
const SHOT = (name: string): string => `../apps/web/evidence/countdown-calendar/${name}.png`;

/** 下一月 1 号的 ISO 串（`addCountdownEvent` 用的就是那一天，两处不许各算一遍口径）。 */
function nextMonthFirstIso(): string {
  const now = new Date();
  const target = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1));
  const month = String(target.getUTCMonth() + 1).padStart(2, '0');
  return `${String(target.getUTCFullYear())}-${month}-01`;
}

async function openCalendarOnNextMonth(page: import('@playwright/test').Page): Promise<string> {
  await switchView(page, '日历');
  await expect(page.locator(BOARD), '没渲染出日历板').toBeVisible();
  // 页头那个 › 是唯一入口（工具栏搬出去了 ⇒ 整份文档只有一个，见 calendar-cells.spec）。
  await page.getByTestId('calendar-toolbar-next').click();
  return nextMonthFirstIso();
}

test('🔴 真点一条倒数日 ⇒ 日历那一格里真的多出一行（含「还有 N 天」）', async ({ page }) => {
  const errors = await collectErrors(page);
  await openApp(page);

  await switchView(page, TAB);
  const target = nextMonthFirst();
  await addCountdownEvent(page, '上线那天', target.label, 1);

  const iso = await openCalendarOnNextMonth(page);

  // 先截图再断言（失败时也要有图）。固定名，`pnpm check` 之后可以直接打开看。
  await page.screenshot({ path: SHOT('month-cell'), fullPage: false });

  // 夹具前提：那一天**一条任务都没有** ⇒ 出现的那一行只可能来自第二个源。
  await expect(
    page.locator(`[data-testid="calendar-cell-${iso}-bar"]`),
    '夹具前提不成立：那天有任务条，这一行就证明不了第二个源',
  ).toHaveCount(0);

  const row = page.locator(`[data-testid="calendar-cell-${iso}-event"]`);
  await expect(row, `那一格里没有倒数日行（${iso}）`).toHaveCount(1);
  await expect(
    page.locator(`[data-testid="calendar-cell-${iso}-event-title"]`),
  ).toContainText('上线那天');
  await expect(
    page.locator(`[data-testid="calendar-cell-${iso}-event-title"]`),
    '只有标题 = 宿主没把词表注入进来',
  ).toContainText(`还有 ${String(target.days)} 天`);

  expect(errors, `控制台不该有 error，但有：\n${errors.join('\n')}`).toEqual([]);
});

test('🔴 刷新之后那一格还有它（落的是 op-log，不是某个组件的内存态）', async ({ page }) => {
  const errors = await collectErrors(page);
  await openApp(page);

  await switchView(page, TAB);
  const target = nextMonthFirst();
  await addCountdownEvent(page, '重启还在的日子', target.label, 1);

  const iso = await openCalendarOnNextMonth(page);
  await expect(page.locator(`[data-testid="calendar-cell-${iso}-event"]`)).toHaveCount(1);

  await page.reload();
  await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();

  const again = await openCalendarOnNextMonth(page);
  expect(again, '翻回去的月份不该变').toBe(iso);
  await page.screenshot({ path: SHOT('after-reload'), fullPage: false });
  await expect(
    page.locator(`[data-testid="calendar-cell-${iso}-event-title"]`),
    '刷新后日历上少了那一行 —— 说明它原先只活在内存里',
  ).toContainText('重启还在的日子');

  expect(errors, `控制台不该有 error，但有：\n${errors.join('\n')}`).toEqual([]);
});

/*
  🔴 **四个档位逐个走一遍**（同一条倒数日、同一次真点击）。
  jsdom 那三条各钉了一屏，但"切档之后还在"这件事只有真布局能证 ——
  年档那张卡在窄视口里会不会把点挤没、日档那条全天带会不会因为
  `ScrollView` 的测量差异不画行，jsdom 里所有 rect 都是 0，量不到。
  四张图各是一档的证据，人要逐张打开看过。
*/
test('🔴 四个档位都认得这一天：月格 / 当天清单 / 日档全天带 / 年档那个点', async ({ page }) => {
  const errors = await collectErrors(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openApp(page);

  await switchView(page, TAB);
  const target = nextMonthFirst();
  await addCountdownEvent(page, '四档同一天', target.label, 1);

  const iso = await openCalendarOnNextMonth(page);

  // 点进那一天 ⇒ 下面的清单里有这一行，而且不再说"这天没有安排"。
  await page.locator(`[data-testid="calendar-cell-${iso}"]`).click();
  const dayRow = page.locator('[data-testid^="calendar-board-day-event-"][data-testid$="-title"]');
  await expect(dayRow, '格子里有它，点进去的清单里没有 —— 同一屏两份当天的账').toHaveCount(1);
  await expect(dayRow).toContainText('四档同一天');
  await expect(dayRow).toContainText(`还有 ${String(target.days)} 天`);
  await expect(
    page.locator('[data-testid="calendar-board-day-empty"]'),
    '有倒数日的那一天还被当成"没有安排"',
  ).toHaveCount(0);
  await page.screenshot({ path: SHOT('day-list'), fullPage: false });

  // 日档：那一天摊开成全天带，倒数日在那一带里。
  await page.selectOption(VIEW_SELECT, 'day');
  await expect(page.locator('[data-testid="calendar-board-day"]'), '日档没渲染').toBeVisible();
  const allDayRow = page.locator(
    '[data-testid^="calendar-board-day-all-day-event-"][data-testid$="-title"]',
  );
  await expect(allDayRow, '切到日视图，那条纪念日就凭空消失了').toHaveCount(1);
  await expect(allDayRow).toContainText('四档同一天');
  await page.screenshot({ path: SHOT('day-band'), fullPage: false });

  // 年档：12 张月卡里那一天有一个点。
  await page.selectOption(VIEW_SELECT, 'year');
  await expect(page.locator('[data-testid="calendar-board-year"]'), '年档没渲染').toBeVisible();
  const yearDot = page.locator(`[data-testid="calendar-board-year-day-${iso}-dot"]`);
  await expect(yearDot, `切到年视图，整年的纪念日一个点都不画（${iso}）`).toHaveCount(1);
  /*
    🔴 截图前必须把那颗点**滚进视口**，而且要**量**它进去了。
    第一趟这里就是拍的整屏：11 月那张卡在视口外，图里一个点都没有，
    而断言是查 DOM 的 ⇒ 照样全绿。"截图且人看过"要的是**图里有那个东西**，
    不是"这一趟跑过并且绿了"（AGENTS §6.2 规定一，与"fullPage 拍不进滚动容器"同族）。
  */
  await yearDot.scrollIntoViewIfNeeded();
  const dotBox = await yearDot.boundingBox();
  const viewport = page.viewportSize();
  expect(dotBox, '那颗点量不到位置（说明它压根没渲染出来）').not.toBeNull();
  expect(
    dotBox!.y >= 0 && dotBox!.y + dotBox!.height <= (viewport?.height ?? 0),
    `点不在视口里（y=${String(Math.round(dotBox!.y))}，视口高 ${String(viewport?.height)}）⇒ 这张图证不了它`,
  ).toBe(true);
  await page.screenshot({ path: SHOT('year-dot'), fullPage: false });

  expect(errors, `控制台不该有 error，但有：\n${errors.join('\n')}`).toEqual([]);
});
