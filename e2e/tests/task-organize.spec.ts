import { expect, test } from '@playwright/test';

import { addTask, openApp, rowFor } from './helpers.js';

/**
 * 任务整理：清单归属 + 标签（真浏览器，零 mock）
 * ============================================
 *
 * 🔴 为什么必须有这条用例
 *
 * 在它之前，Web 端能**建**清单和标签（侧栏面板），却**没法把它们挂到任务上**：
 * `TaskStore.moveToProject` 一直存在、`ProjectActions` 也一直在，但
 * `moveToProject` 在 Web 里**没有任何调用点**，`tagIds` 更是**全仓库零读写**。
 *
 * 也就是说：侧栏里建出来的清单和标签，**一个都用不上**。
 * 这类空洞没有任何单元测试会报红 —— 每个零件都"通过"了，
 * 只是没有一个被接到界面上。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 🔴 这条用例最关键的判据是「刷新之后还在」
 *
 * 它同时否掉了两种**最像"做完了"的假绿**：
 *
 * 1. **只改了 React 状态**（没有派发 op）—— 刷新后组件重新从 op-log 物化，
 *    假的赋值会当场消失。chip 的断言在第一次渲染时**照样为真**，只有刷新能揭穿。
 * 2. **写进了某个内存 Map** —— 同理会随页面一起没。
 *
 * 所以顺序是刻意的：**先断言 chip 出现 → 再刷新 → 再断言 chip 还在**。
 * 只写前半段的话，这条用例证明不了它自己声称要证明的东西。
 *
 * ## 为什么用原生控件（`select` / `checkbox`）
 *
 * 验收能直接 `selectOption` / `check` —— 那是**真交互**（键盘可达、读屏可达），
 * 不是模拟坐标点击。自造下拉的话这里就只能点坐标，而点坐标会把
 * "控件坏了"和"坐标算错了"混成一个失败。
 */

const STAMP = Date.now().toString().slice(-6);
const TITLE = `organize-${STAMP}`;
const LIST = `list-${STAMP}`;
const TAG = `tag-${STAMP}`;

const SIDEBAR = 'aside[aria-label="清单与标签"]';

test.describe('任务整理：清单归属 + 标签', () => {
  test('建清单与标签 → 挂到任务上 → 刷新后仍在（证明走了 op-log）', async ({ page }) => {
    await openApp(page);
    await addTask(page, TITLE);

    const sidebar = page.locator(SIDEBAR);
    await expect(sidebar).toBeVisible();
    // 建之前，侧栏里不该已经有这两个名字 —— 否则后面的断言可能是因为
    // 上一次跑剩的数据成立，而不是这次真的建出来了。
    await expect(sidebar.getByText(LIST, { exact: true })).toHaveCount(0);
    await expect(sidebar.getByText(TAG, { exact: true })).toHaveCount(0);

    await sidebar.getByLabel('新清单名称').fill(LIST);
    await sidebar.getByLabel('添加清单').click();
    await expect(sidebar.getByText(LIST, { exact: true })).toBeVisible();

    await sidebar.getByLabel('新标签名称').fill(TAG);
    await sidebar.getByLabel('添加标签').click();
    await expect(sidebar.getByText(TAG, { exact: true })).toBeVisible();

    // ── 挂到任务上 ────────────────────────────────────────────────────
    const row = rowFor(page, TITLE);
    await expect(row).toBeVisible();

    // 挂之前两个 chip 都不该在。**这是让后面断言能为假的前提**：
    // 如果 chip 从一开始就渲染，那"挂上了"这条断言永远为真。
    await expect(row.getByTestId('task-chip-project')).toHaveCount(0);
    await expect(row.getByTestId('task-chip-tag')).toHaveCount(0);

    await row.locator('summary').click();

    await row.getByLabel(`任务「${TITLE}」所属清单`).selectOption({ label: LIST });
    await expect(row.getByTestId('task-chip-project')).toHaveText(LIST);

    const checkbox = row.getByRole('checkbox', {
      name: `给任务「${TITLE}」加上或去掉标签「${TAG}」`,
    });
    /**
     * 🔴 **`click()` 而不是 `check()`** —— 这一条踩过一次，写下来免得再犯。
     *
     * `check()` 除了点击，还会**立刻**断言控件自身已变成勾选态。而这里的
     * 复选框是**受控**的，`dispatchIntent` 又是 `async` 的
     * （`lib/oplog.ts`：`await engine.dispatch(intent)` 之后才 `notify()`）——
     * 于是点击那一刻 React 手上还是旧的 `tagIds`，重渲染会把 DOM 勾选态按回去，
     * Playwright 当场报 `Clicking the checkbox did not change its state`。
     *
     * **那是一条假红**：op 已经派出去了，只是"控件此刻的 DOM 状态"不等于
     * "这次操作生效了"。产品的契约是**结果**（任务上真的挂了这个标签），
     * 不是控件在某一帧长什么样。
     *
     * 换成"点击 → 断言 chip 出现"：`expect` 自带重试，而且断言的是**结果**。
     * ⚠️ 前提是 chip 确实会出现 —— 它不出现的话这条断言会真的失败，
     *    不是被放宽了。
     */
    await checkbox.click();
    await expect(row.getByTestId('task-chip-tag')).toHaveText(TAG);

    // ── 🔴 刷新：从 op-log 重新物化 ──────────────────────────────────
    await page.reload();
    await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();

    const afterReload = rowFor(page, TITLE);
    await expect(afterReload).toBeVisible();
    await expect(
      afterReload.getByTestId('task-chip-project'),
      '刷新后清单归属丢了 —— 说明它只改了内存状态，没有派发 op',
    ).toHaveText(LIST);
    await expect(
      afterReload.getByTestId('task-chip-tag'),
      '刷新后标签丢了 —— 同上',
    ).toHaveText(TAG);

    // 展开面板里控件的**状态**也要跟着回来（不只是那几个 chip 好看）。
    await afterReload.locator('summary').click();
    // 直接断言**被选中的那个 option 的文字** —— 比拿 value（清单 id）去比对
    // 更贴近"用户看到的是对的"，也少一次 await。
    await expect(
      afterReload.getByLabel(`任务「${TITLE}」所属清单`).locator('option:checked'),
    ).toHaveText(LIST);
    await expect(
      afterReload.getByRole('checkbox', {
        name: `给任务「${TITLE}」加上或去掉标签「${TAG}」`,
      }),
    ).toBeChecked();
  });

  test('取消归属：标签摘掉、任务回到收集箱，刷新后依然是取消态', async ({ page }) => {
    const title = `${TITLE}-undo`;
    await openApp(page);
    await addTask(page, title);

    const sidebar = page.locator(SIDEBAR);
    await sidebar.getByLabel('新标签名称').fill(TAG);
    await sidebar.getByLabel('添加标签').click();
    await expect(sidebar.getByText(TAG, { exact: true })).toBeVisible();

    const row = rowFor(page, title);
    await row.locator('summary').click();
    const checkbox = row.getByRole('checkbox', {
      name: `给任务「${title}」加上或去掉标签「${TAG}」`,
    });
    // ⚠️ 同样用 `click()` 而不是 `check()` / `uncheck()` —— 理由见第一条用例。
    await checkbox.click();
    await expect(row.getByTestId('task-chip-tag')).toHaveText(TAG);

    /**
     * 🔴 **先刷新一次，证明它真的存下来过。**
     *
     * 不加这一步的话，下面"摘掉之后没有"的两条断言会被**从来没存过**这种
     * 实现白白满足 —— 变异测试实测：把指派改成只写本地 React 状态时，
     * 第一条用例在「刷新后标签丢了」红了，而**这条用例当时是全绿的**。
     * 也就是说它的"刷新后依然是取消态"当时**没有鉴别力**。
     *
     * 所以顺序必须是：打上 → 刷新（还在）→ 摘掉 → 刷新（没了）。
     * "没了"只有在"曾经真的在过"之后才有意义。
     */
    await page.reload();
    await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
    const stillAssigned = rowFor(page, title);
    await expect(
      stillAssigned.getByTestId('task-chip-tag'),
      '打上标签后刷新就丢了 —— 下面"摘掉之后没有"的断言会因此变得毫无意义',
    ).toHaveText(TAG);

    // 摘掉。🔴 这一步验的是"清空写的是 null、物化后字段真的消失"这条链路 ——
    // 写 `[]` 的话 chip 也会消失，但下一次**加**标签的合并结果会不一样
    // （`[]` 是个真值，会在 reducer 的字段合并里继续占位）。
    const row2 = rowFor(page, title);
    await row2.locator('summary').click();
    await row2
      .getByRole('checkbox', {
        name: `给任务「${title}」加上或去掉标签「${TAG}」`,
      })
      .click();
    await expect(row2.getByTestId('task-chip-tag')).toHaveCount(0);

    await page.reload();
    await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
    const afterReload = rowFor(page, title);
    await expect(afterReload.getByTestId('task-chip-tag')).toHaveCount(0);
    await afterReload.locator('summary').click();
    await expect(
      afterReload.getByRole('checkbox', {
        name: `给任务「${title}」加上或去掉标签「${TAG}」`,
      }),
    ).not.toBeChecked();
  });
});