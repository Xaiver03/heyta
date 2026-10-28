import { expect, test, type Page } from '@playwright/test';

import { addTask, openApp } from './helpers';

/**
 * 任务详情面的**渐进披露策略**（全局 UX 线 P8）
 * ===========================================
 *
 * 这一格以前只有散文（`TaskDetailCard.tsx:350-362` 记着"栏里要的只是编辑本体、
 * 没有 `<details>`"，§8.146 那条裁决），**没有任何东西会在有人改掉它时红**。
 * 判据只问两件事：
 *
 *   1. **进阶项默认收起**：详情面里只许有一处折叠（重复规则里的「高级」），且它是关着的。
 *      多出一处默认收起的折叠，说明有个核心字段被藏起来了 —— 那正是渐进披露的反面。
 *   2. **核心编辑项默认可见**：截止的日历**摊开在面上**是 §8.146 的裁决，不是遗漏
 *      （理由：栏就是来编辑的地方，多一次点击换不来什么）。这一条**把它钉成契约**：
 *      哪天有人给这一格加回 `<details>`，这里先红，逼一次显式决定而不是静默改形状。
 *
 * 🔴 读数先打印再断言：红的时侯直接看得出"面里有几处折叠、各自开着没"。
 */

const EVIDENCE = '../apps/web/evidence/detail-disclosure';

async function openPane(page: Page): Promise<{ details: { summary: string; open: boolean }[]; dateCells: number }> {
  await addTask(page, '披露判据甲');
  await page.locator('[data-testid^="task-row-"]').first().click();
  const pane = page.getByTestId('detail-column').getByTestId('task-pane');
  await expect(pane, '点行之后面单没开').toHaveCount(1);
  return pane.evaluate((el) => ({
    details: Array.from(el.querySelectorAll('details')).map((d) => ({
      summary: (d.querySelector('summary')?.textContent ?? '').trim().slice(0, 12),
      open: (d as HTMLDetailsElement).open,
    })),
    /* 日历格：`DatePicker` 的日号按钮带 `aria-label`，这里按"面里出现 ≥28 个日期按钮"认。
       不用 testid 是因为那批 id 由共享 `DatePicker` 生成，本判据不该依赖它的命名。 */
    dateCells: Array.from(el.querySelectorAll('button')).filter((b) => /^\d{1,2}月\d{1,2}日/u.test(b.getAttribute('aria-label') ?? '')).length,
  }));
}

test('详情面：进阶项默认收起（只有一处折叠且是关的），核心编辑项默认可见', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openApp(page, '/?lang=zh-CN');
  const reading = await openPane(page);
  console.log('[详情面披露]', JSON.stringify(reading));

  // 1. 进阶项：只有一处折叠（重复规则里的「高级」），且默认关着。
  expect(reading.details.length, `详情面里出现了不止一处折叠：${JSON.stringify(reading.details)}`).toBe(1);
  expect(reading.details[0]?.open, `那处折叠默认是开的：${JSON.stringify(reading.details[0])}`).toBe(false);

  // 2. 核心编辑项：截止的日历摊开在面上（§8.146 的裁决，钉成契约）。
  expect(
    reading.dateCells,
    '详情面里没有摊开的日历 ⇒ 要么这一格被收进折叠，要么选择器变了（两种都要一次显式决定）',
  ).toBeGreaterThanOrEqual(28);

  await page.screenshot({ path: `${EVIDENCE}/task-pane-1440-light.png` });
});
