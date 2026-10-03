/**
 * 「按时间看」那一族的**第三条路**（R11 批五下半 · §9.3 差异化第 3 条）
 * =====================================================================
 *
 * jsdom 那一份（`apps/web/tests/calendar-view-family.spec.tsx`）钉的是形状：
 * 点了能走、`'timeline'` 没被写进日历 store、模块关掉时这一档不出现。
 * **这一份钉的是"画出来了"**（AGENTS §6.2 规定一：界面结论只有截图算证据）。
 *
 * 走的顺序就是用户的手序：进日历 → 页头那个下拉选「时间线」→
 * 屏幕上**变成时间线** → 从 rail 回日历 → 档位还是原来那一档。
 * 最后那一步不是仪式：反方向没有第二个下拉（回日历只有 rail），
 * 所以"回得去"必须在真浏览器里量一次，而不是想当然。
 */

import { expect, test, type Page } from '@playwright/test';

import { openApp } from './helpers';

const APP_ZH = '/?lang=zh-CN';
const BOARD = '[data-testid="calendar-board"]';
const TIMELINE = '[data-testid="timeline-view"]';
const VIEW_SELECT = '[data-testid="calendar-view-select"]';

function watchConsole(page: Page): string[] {
  const lines: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') lines.push(`[console.error] ${msg.text()}`);
  });
  page.on('pageerror', (err) => lines.push(`[pageerror] ${err.message}`));
  return lines;
}

async function gotoCalendar(page: Page): Promise<void> {
  await page.getByRole('tab', { name: '日历' }).click();
  await expect(page.locator(BOARD)).toBeVisible();
}

/**
 * 在**任务页**播一条带截止的任务（走真实输入框 ⇒ 真 op 落库）。
 *
 * 🔴 必须在进日历**之前**做：捕获输入框住在任务页，进了日历就没有它了
 * （`calendar-week.spec.ts` 里那条顺序约束抄过来的）。
 * ⚠️ 刻意**不写时刻**（`明天16:00` 那种）：`parseCapture` 只认日历日，
 *   实测 `明天16:00 X` 的标题是「16:00 X」—— 时刻没被吃掉，而是留在标题里。
 *   这里要的是"标题正好等于我写的"，所以只用被支持的写法。
 * 为什么要播一条：空时间线的证据只到"这一屏换掉了"，
 * 而"换过去之后**排得出东西**"才是这一档存在的理由（§6.2 规定一）。
 */
async function seedDatedTask(page: Page, stamp: string): Promise<void> {
  const composer = page.locator('input[placeholder^="添加任务"]');
  await composer.fill(`明天 家族档-${stamp}`);
  await composer.press('Enter');
  await expect(
    page.getByRole('checkbox', { name: `完成：家族档-${stamp}` }),
  ).toBeVisible();
}

test('🔴 下拉里选「时间线」⇒ 这一屏真的换成时间线，而 rail 回得来', async ({ page }) => {
  const errors = watchConsole(page);
  const stamp = Date.now().toString().slice(-6);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openApp(page, APP_ZH);
  await seedDatedTask(page, stamp);
  await gotoCalendar(page);

  await page.selectOption(VIEW_SELECT, 'timeline');
  await expect(page.locator(TIMELINE)).toBeVisible();
  // 🔴 月历**整块换掉**，不是叠在下面：两屏同时挂在 DOM 里意味着
  //    内容区没按视图分叉，那"切过去"只是盖了一层。
  await expect(page.locator(BOARD)).toHaveCount(0);
  // 切过去之后**排得出东西**（不是只换了个空壳）。
  await expect(page.locator('[data-testid^="timeline-point-"]').first()).toBeVisible();
  // 页头标题跟着走（R9 那一类"标题是上一个视图的残留"在这里会现形）。
  await expect(page.locator('.ht-header__title')).toHaveText('时间线');
  // 🔴 截图前把指针从 rail 上挪开，并**等那个淡出走完**：rail 的名字气泡
  //    （`.ht-rail__label`，`position: fixed` + `opacity` 过渡）正好落在内容区
  //    左上，会盖住时间线第一行的日期。实测第一版没等 ⇒ 气泡半透明地压在图上。
  //    ⚠️ 它 `pointer-events: none`，挡不住点击，所以不是功能缺陷 —— 但证据图要能读。
  await page.mouse.move(900, 600);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/calendar-family-timeline.png', fullPage: false });

  await gotoCalendar(page);
  await expect(page.locator(BOARD)).toBeVisible();
  expect(await page.locator(VIEW_SELECT).inputValue(), '回来时档位被那次跳转改掉了').toBe('month');
  expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
});
