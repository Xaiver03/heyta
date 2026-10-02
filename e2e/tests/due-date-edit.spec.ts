/**
 * 截止日期的事后编辑——**真浏览器**验收（批一判据 ②）
 * =====================================================
 *
 * op 形状（点日子 ⇒ 恰好一条只带 dueDate 的 UPD）由 jsdom 出口判据钉死：
 * `apps/web/tests/due-date-edit.spec.tsx`。本文件管 jsdom 管不了的三件事：
 *   1. **App 真的把 DueEditor 挂上了行尾**（jsdom 直接渲染组件，App 漏挂它看不见
 *      —— 变异的另一半靶子）；
 *   2. `<details>` 的 summary **点击展开**在真浏览器里真的通（jsdom 不实现）；
 *   3. 选日 → DueBadge 变化 → **刷新后仍在**（本地优先：重放 op，不是内存态）。
 *
 * §6.2 规定一：先截图再断言、固定路径、失败也要有图；console/pageerror
 * 监听在窗口一创建就挂。
 */

import { expect, test, type Page } from '@playwright/test';

const SHOT = (name: string): string => `test-results/due-date-edit-${name}.png`;

/** 桌面载荷的统一入口：清理首启面板，落到任务页。 */
async function openApp(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?lang=zh-CN', { waitUntil: 'networkidle' });
  await dismissConsentIfPresent(page);
  await page.waitForSelector('[data-testid="task-list"]', { timeout: 30_000 });
  return void errors; // 失败时由各用例打印
}

async function addTaskViaComposer(page: Page, text: string): Promise<void> {
  const composer = page.locator('input[placeholder^="添加任务"]');
  await composer.fill(text);
  await composer.press('Enter');
  await page.waitForTimeout(600);
}

/** 「在使用联网功能之前」面板：未做选择时**每次加载**都会出现（含 reload）。 */
async function dismissConsentIfPresent(page: Page): Promise<void> {
  const later = page.getByRole('button', { name: /以后再说|Decide later/ });
  if (await later.count()) {
    await later.click();
    await page.waitForTimeout(500);
  }
}

test('行尾「截止」：点开 → 选日 → DueBadge 变化 → 刷新后仍在', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  await openApp(page);
  const title = `due-e2e-${Date.now() % 100000}`;
  await addTaskViaComposer(page, title);

  const row = page.locator('[data-testid^="task-item-"]', { hasText: title }).first();
  await expect(row).toBeVisible();

  // 🔴 先截图再断言：失败时也要有图。
  await page.screenshot({ path: SHOT('1-row'), fullPage: false });

  // ① App 真的挂上了触发器（jsdom 变异的另一半靶子）。
  const summary = row.locator('[data-testid="due-editor-summary"]');
  await expect(summary).toBeVisible();

  // ② summary 点击展开在真浏览器里真的通。
  await summary.click();
  // 面板 Portal 到 body（逃出带 transform 的滚动容器），所以页面级定位 +
  // `:visible`（其它行的在流面板被关闭的 details 原生隐藏，不算可见）。
  const picker = page.locator('[data-testid="date-picker"]:visible');
  await expect(picker).toBeVisible();
  await picker.locator('[role="button"]').first().waitFor({ state: 'visible' });
  await page.waitForTimeout(300); // RNW 的 Yoga 布局落地后再拍，证据图里要有真日历
  await page.screenshot({ path: SHOT('2-open'), fullPage: false });

  // ③ 选一个日子（无障碍名 = 完整日期）。取当月 18 日；不在当月就翻下月。
  let cell = picker.locator('[role="button"][aria-label$="18日"]');
  if ((await cell.count()) === 0) {
    await picker.getByRole('button', { name: '下个月' }).click();
    await page.waitForTimeout(200);
    cell = picker.locator('[role="button"][aria-label$="18日"]');
  }
  expect(await cell.count(), '翻页后应有某月 18 日这格').toBeGreaterThan(0);
  const dayLabel = (await cell.first().getAttribute('aria-label'))!;
  // 徽章（date 模式）的文案是 `formatCompactDate` 的 `MM-DD`，从格子名解出来。
  const md = dayLabel.match(/(\d+)月(\d+)日/)!;
  const compact = `${md[1]!.padStart(2, '0')}-${md[2]!.padStart(2, '0')}`;
  await cell.first().click();
  await page.waitForTimeout(600);

  // ④ 触发器反映当前值 + DueBadge 出现在行元信息里。
  await page.screenshot({ path: SHOT('3-picked'), fullPage: false });
  await expect(summary).toContainText(dayLabel);
  await expect(row.getByTestId('task-meta')).toContainText(compact);

  // ⑤ 刷新后仍在（本地优先：重放 op，字段还在）。
  await page.reload({ waitUntil: 'networkidle' });
  await dismissConsentIfPresent(page); // 同意面板未做选择时每次加载都回来，先关掉再取证
  const rowAfter = page.locator('[data-testid^="task-item-"]', { hasText: title }).first();
  await expect(rowAfter).toBeVisible();
  await page.screenshot({ path: SHOT('4-after-reload'), fullPage: false });
  await expect(rowAfter.getByTestId('task-meta')).toContainText(compact);

  if (errors.length > 0) {
    console.log('控制台/页面错误:', errors);
  }
  expect(errors, '控制台与页面不应有错误').toEqual([]);
});
