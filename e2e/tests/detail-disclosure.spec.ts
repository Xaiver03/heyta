import { expect, test, type Page } from '@playwright/test';

import { addTask, openApp } from './helpers';

/**
 * 任务详情面的**渐进披露策略**（全局 UX 线 P8）
 * ===========================================
 *
 * 面单重构为**紧凑卡**之后，次级字段（截止 / 提醒 / 重复 / 清单 / 标签 / 子任务）
 * 全部收进顶栏与底栏的**触发器**，点开才长出对应浮层（`task-detail-popover`）；
 * 平铺时代的四枚分组头（`h3[data-testid="task-detail-group"]`）也一起撤掉。
 * 判据只问三件事：
 *
 *   1. **默认收起**：刚打开面单时，浮层 0 个、分组头 0 枚、日历格 0 个 ——
 *      没有任何一个次级字段被静默摊开。
 *   2. **点触发器才摊开**：点顶栏「截止」触发器之后，日期格 ≥ 28（一整月）。
 *   3. **Escape 收起**：浮层回到 0 —— 打开的那一格能收回去，不是钉死在那儿。
 *
 * 🔴 读数先打印再断言：红的时候直接看得出"面里有几个浮层、几枚分组头、几格日历"。
 */

const EVIDENCE = '../apps/web/evidence/detail-disclosure';

type Reading = { popovers: number; groups: number; dateCells: number };

/**
 * 整页读三个计数。
 *
 * ⚠️ 浮层可能是 Portal（挂在 `document.body` 下），所以按 `document` 读而不是
 * 限定在 `pane` 里；1440 档只挂一棵 `task-pane`，不会把别处的日历数进来。
 */
async function readCounts(page: Page): Promise<Reading> {
  return page.evaluate(() => ({
    popovers: document.querySelectorAll('[data-testid="task-detail-popover"]').length,
    groups: document.querySelectorAll('h3[data-testid="task-detail-group"]').length,
    /* 日历格：`DatePicker` 的日号按钮带 `aria-label`，这里按"出现 ≥28 个日期按钮"认。
       不用 testid 是因为那批 id 由共享 `DatePicker` 生成，本判据不该依赖它的命名。 */
    dateCells: Array.from(document.querySelectorAll('button')).filter((b) =>
      /^\d{1,2}月\d{1,2}日/u.test(b.getAttribute('aria-label') ?? ''),
    ).length,
  }));
}

test('详情面：渐进披露（默认收起，点触发器才摊开，Escape 收起）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openApp(page, '/?lang=zh-CN');

  await addTask(page, '披露判据甲');
  await page.locator('[data-testid^="task-row-"]').first().click();
  const pane = page.getByTestId('detail-column').getByTestId('task-pane');
  await expect(pane, '点行之后面单没开').toHaveCount(1);

  // 1. 默认收起：浮层 / 分组头 / 日历格都为 0。
  const collapsed = await readCounts(page);
  console.log('[详情面披露·收起]', JSON.stringify(collapsed));
  expect(collapsed.popovers, `刚打开面单就画了浮层：${JSON.stringify(collapsed)}`).toBe(0);
  expect(collapsed.groups, `紧凑面单又长出了分组头：${JSON.stringify(collapsed)}`).toBe(0);
  expect(collapsed.dateCells, `刚打开面单就摊开了日历：${JSON.stringify(collapsed)}`).toBe(0);

  // 2. 点顶栏「截止」触发器 ⇒ 日历摊开（一整月 ≥ 28 格）。
  await pane.getByTestId('task-detail-due-trigger').click();
  await expect
    .poll(async () => (await readCounts(page)).dateCells, {
      message: '点了截止触发器之后没有摊开的日历',
    })
    .toBeGreaterThanOrEqual(28);

  // 3. Escape ⇒ 浮层收起。
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await readCounts(page)).popovers, {
      message: '按 Escape 之后浮层没有收起',
    })
    .toBe(0);

  await page.screenshot({ path: `${EVIDENCE}/task-pane-1440-light.png` });
});
