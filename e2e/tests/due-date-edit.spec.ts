/**
 * 截止日期的事后编辑——**真浏览器**验收（批一判据 ②）
 * =====================================================
 *
 * op 形状（点日子 ⇒ 恰好一条只带 dueDate 的 UPD）由 jsdom 出口判据钉死：
 * `apps/web/tests/due-date-edit.spec.tsx`。本文件管 jsdom 管不了的三件事：
 *   1. **App 真的把截止那一格挂出来了**（jsdom 直接渲染组件，App 漏挂它看不见
 *      —— 变异的另一半靶子）；
 *   2. 那张月历在**真布局**里真的画得出来、那一格真的点得到（jsdom 没有布局）；
 *   3. 选日 → 行上的元信息条（`task-meta`）写明 → **刷新后仍在**
 *      （本地优先：重放 op，不是内存态）。
 *
 * 🔴 2026-11 换落点：行尾那一排**行内字段编辑器整排被删了**（产品负责人：
 * 「把所有这种铺开式组件全都删掉，全都收拢进来」）。截止的编辑本体只住在
 * `TaskDetailCard` 里，两个落点：宽档 = 详情列（`detail-column` 里的 `task-pane`），
 * 窄档（宽 < 1024）= **点行弹出的对话框**（`task-detail-dialog`，里面也有 `task-pane`）。
 * 所以本文件问的仍然是那三件事，只是载体从"行尾那颗 `<summary>` 展开的 Portal 面板"
 * 换成了"面单里的那张月历"：旧行尾触发器（`due-editor-summary`）实测整页 **0** 枚。
 * 宽档那一格由 `detail-pane-task.spec.ts` 的 T12 负责，这里跑窄档。
 *
 * §6.2 规定一：先截图再断言、固定路径、失败也要有图；console/pageerror
 * 监听在窗口一创建就挂。
 */

import { expect, test, type Page } from '@playwright/test';

import { closeTaskDetailIfOpen, openNarrowTaskPane } from './task-detail-entry.js';

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

test('面单「截止」：点行开面单 → 选日 → 行上写明 → 刷新后仍在', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  /* 🔴 这一条**跑在窄档**（900×600）：它是"宽档之外还有没有落点"的那一半。
     窄档下详情列不画（`DETAIL_FITS_QUERY` 要 ≥1024），面单只能从**点行弹出的对话框**来
     —— 少了它，'改截止'在窄窗口里会整个消失，而且不报错。
     宽档同一格由 `detail-pane-task.spec.ts` 的 T12 负责（那一档月历在 22rem 的栏里，
     量的是"7×44 的日格伸不伸得出栏"；窄档这一份是流内宽卡，量的是"画不画得出来"。 */
  await page.setViewportSize({ width: 900, height: 600 });
  await openApp(page);
  const title = `due-e2e-${Date.now() % 100000}`;
  await addTaskViaComposer(page, title);

  /*
   * 🔴 2026-10-17 改**定位精度**（不是改判据）：`hasText` 在这一族会命中**不可见的那一份**
   * （同一份行标记在隐藏分支里也有一份）⇒ `.first()` 可能落在它上面，`toBeVisible()` 就红。
   * 改成"只看可见行 + 用本行自己的完成框锚定"。
   */
  const row = page
    .locator('[data-testid^="task-item-"]:visible')
    .filter({ has: page.getByRole('checkbox', { name: `完成：${title}` }) })
    .first();
  await expect(row).toBeVisible();

  /*
   * 🔴 2026-11 换落点（**不是**放宽）：行尾那颗 `<summary data-testid="due-editor-summary">`
   * 与它 Portal 出去的面板是"行内编辑器时代"的入口，随整排编辑器一起被删掉了
   * （实测整页 0 枚）。窄档现在走**点行 ⇒ 面单对话框**，落点由 `openNarrowTaskPane` 建立：
   * 它同时钉住"那个面单真的在对话框里"（否则窄档就没有编辑权了）。
   */
  const pane = await openNarrowTaskPane(page, title);

  // 🔴 先截图再断言：失败时也要有图。
  await page.screenshot({ path: SHOT('1-pane'), fullPage: false });

  // ① App 真的挂出了截止那一格（jsdom 变异的另一半靶子），且整页只有一份月历。
  const picker = pane.getByTestId('date-picker');
  await expect(picker, '面单里没有月历 ⇒ 窄档这一档改不了截止').toHaveCount(1);
  await expect(picker).toBeVisible();
  await expect(
    page.locator('[data-testid="date-picker"]'),
    '整页出现了不止一张月历 ⇒ 同一字段两处可编辑',
  ).toHaveCount(1);

  // ② 🔴 它**真的画得出来**（不是折叠着的 DOM）：jsdom 没有布局，量不到这件事。
  //    实测（900×600）：面单 590 宽，月历 558×487。
  const paneBox = await pane.boundingBox();
  const pickBox = await picker.boundingBox();
  expect(pickBox, '月历"可见"却量不到 boundingBox').not.toBeNull();
  expect(paneBox, '面单"可见"却量不到 boundingBox').not.toBeNull();
  expect(
    pickBox!.width,
    `面单里那张月历只有 ${String(pickBox!.width)}px 宽（面单 ${String(paneBox!.width)}px）—— 画不出来`,
  ).toBeGreaterThan(paneBox!.width * 0.6);
  await page.waitForTimeout(300); // RNW 的 Yoga 布局落地后再拍，证据图里要有真日历
  await page.screenshot({ path: SHOT('2-picker'), fullPage: false });

  /* ②.5 🔴 **要选的那一格点得到**。
     旧判据问的是"面板整块落在视口里" —— 那时面板是 `position: fixed` 且**滚动即关**，
     视口外那些格子用户真的点不到（当时的实测：行在 y≈500、视口 720、面板估高 500
     ⇒ 最后两周在屏幕外，Playwright 重试 113 次"scroll into view"全部失败）。
     ⇒ 那个前提**在面单里不成立**：月历是面单里的**流内**内容，滚动的是对话框自己的
     容器（滚动不会关掉它）。同一件事（"用户点得到那一个日子"）现在由下面这条量：
     **把那一格滚进视口之后它真的在视口里，随后那一次点击真的落成值**（③④）。 */
  const cell = picker.locator('[role="button"][aria-label$="18日"]').first();
  await cell.scrollIntoViewIfNeeded();
  await expect(cell, '要选的那一格滚进视野之后仍然不在视口里 ⇒ 用户在界面上点不到它').toBeInViewport();

  // ③ 选一个日子（无障碍名 = 完整日期）。取当月 18 日；不在当月就翻下月。
  let target = cell;
  if ((await target.count()) === 0) {
    await picker.getByRole('button', { name: '下个月' }).click();
    await page.waitForTimeout(200);
    target = picker.locator('[role="button"][aria-label$="18日"]').first();
  }
  expect(await target.count(), '翻页后应有某月 18 日这格').toBeGreaterThan(0);
  const dayLabel = (await target.getAttribute('aria-label'))!;
  // 行上元信息条（date 模式）的文案是 `formatCompactDate` 的 `MM-DD`，从格子名解出来。
  const md = dayLabel.match(/(\d+)月(\d+)日/)!;
  const compact = `${md[1]!.padStart(2, '0')}-${md[2]!.padStart(2, '0')}`;
  await target.click();
  await page.waitForTimeout(600);

  // ④ 控件反映当前值（月历把那天画成选中态）+ 行上的元信息条写着那一天。
  //    🔴 旧写法读的是"行尾触发器上写着 dayLabel" —— 那颗触发器已经不存在，
  //    控件侧的"值回来了"现在由月历自己的 `aria-selected` 表达（`DatePicker` 那一格
  //    平铺成 `aria-selected` 就是为了判据能直接问，与 T12/日历那一族同一个口径）。
  await page.screenshot({ path: SHOT('3-picked'), fullPage: false });
  await expect(
    picker.locator(`[role="button"][aria-label="${dayLabel}"]`),
    '点完之后月历没把那一天画成选中态 ⇒ 控件没读回自己的值',
  ).toHaveAttribute('aria-selected', 'true');
  await expect(row.getByTestId('task-meta'), `面单里点了 ${dayLabel} 而行上没写着 ${compact}`).toContainText(
    compact,
  );

  // ⑤ 刷新后仍在（本地优先：重放 op，字段还在）。
  await closeTaskDetailIfOpen(page);
  await page.reload({ waitUntil: 'networkidle' });
  await dismissConsentIfPresent(page); // 同意面板未做选择时每次加载都回来，先关掉再取证
  const rowAfter = page
    .locator('[data-testid^="task-item-"]:visible')
    .filter({ has: page.getByRole('checkbox', { name: `完成：${title}` }) })
    .first();
  await expect(rowAfter).toBeVisible();
  await page.screenshot({ path: SHOT('4-after-reload'), fullPage: false });
  await expect(
    rowAfter.getByTestId('task-meta'),
    '刷新后行上读不到那个日期 ⇒ 那次点击没落成 op',
  ).toContainText(compact);

  if (errors.length > 0) {
    console.log('控制台/页面错误:', errors);
  }
  expect(errors, '控制台与页面不应有错误').toEqual([]);
});
