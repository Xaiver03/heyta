import { expect, test, type Page } from '@playwright/test';

import { addTask, openApp, openRowTail } from './helpers';

/**
 * chip 分型的真实浏览器读数（全局 UX 线 P7）
 * =========================================
 *
 * 源码那一侧的尺（`pnpm check:chip-typing`）能判"类名贴没贴对"，判不到
 * **"浏览器算出来的那一格高到底是多少"** —— 而 P7 的判据恰好是两格高度：
 *
 *   · 可点的那一档（`<summary>` / `<button>` 上的截止·备注·子任务·提醒）要够到
 *     触控下限 `--ht-touch-target-min`（44px）；
 *   · 只读的徽标（"这一行写过东西"那颗 `<span>`）**不许**跟着长高 ——
 *     计划 §P7 明写"不能把所有 chip 都撑成 44px"，因为徽标一长高，每一行都被一个
 *     不能点的东西撑开。
 *
 * 🔴 期望值**不抄 44**：从同一页把 `--ht-touch-target-min` 算成 px 再比。
 * 抄进来的数会变成第三份口径（§5 那条老账），而 token 改了这条也不会跟着红。
 * 两半各带一枚对照臂：只有"动作档 ≥ 下限"与"徽标 < 下限"同时成立，
 * 才排掉"整排一起长高"和"整排都没长高"这两种一起绿。
 */

const EVIDENCE = '../apps/web/evidence/chip-typing';
const TITLE = '分型判据甲';

/** 把 CSS 自定义属性算成真像素（同一枚探针理由见 `control-semantics.spec.ts`）。 */
async function tokenPx(page: Page, varName: string): Promise<number> {
  return page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.setProperty('inline-size', `var(${name})`);
    document.body.append(probe);
    const px = Number.parseFloat(getComputedStyle(probe).width);
    probe.remove();
    return px;
  }, varName);
}

test('行尾那一排：可点 chip 够到触控下限（只读徽标那一半见文末的未判定登记）', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openApp(page, '/?lang=zh-CN');
  await addTask(page, TITLE);
  // ⚠️ 不再 `switchView(page,'收件箱')`：刚添加完人就站在收件箱上，而"收件箱"是 rail
  //    上的常驻项、不在 More 菜单里 —— 走那条路只会等一枚不存在的 menuitem 把超时用完。
  const row = page.locator('[data-testid^="task-item-"]').filter({ hasText: TITLE });
  await expect(row, `列表里没有刚加的「${TITLE}」`).toBeVisible();
  await openRowTail(page, row);

  const floor = await tokenPx(page, '--ht-touch-target-min');
  expect(floor, '下限 token 算不出来（这条会空转）').toBeGreaterThan(0);

  const actions = row.locator('.ht-chip--action');
  const actionCount = await actions.count();
  expect(actionCount, '行尾一枚可点 chip 都没有 ⇒ 这一条量不到东西').toBeGreaterThanOrEqual(3);
  for (let i = 0; i < actionCount; i += 1) {
    const box = await actions.nth(i).boundingBox();
    expect(box, `第 ${String(i + 1)} 枚可点 chip 量不到框`).not.toBeNull();
    expect(box!.height, `可点 chip 没够到触控下限（下限=${String(floor)}px）`).toBeGreaterThanOrEqual(floor);
  }

  /*
   * 🔴 只读徽标那一半**仍然没有浏览器读数**，登记为未判定 —— 但这一次把"为什么够不到"
   * 量清楚了（2026-10-28 两发探针 dump）：
   *
   *   · 只读徽标 `NoteBadge` 只在 `taskPaneInColumn` 时挂（`App.tsx:1523`：栏里画着
   *     就换成一枚只读徽标，否则那一格就是编辑器本身）；
   *   · 默认流（开行尾 → 写备注 → 失焦 → 点行）量到的状态是：
   *     `detail-column` 在、`task-pane` **不在**、`task-note-badge-*` 0 枚、
   *     页面上唯一带 `ht-chip` 的 4 枚全是 `--action` 的 `<summary>`；
   *   · 改成按 `task-row-*`（标题那一格）去选中时，`locator.click` 直接 60s 超时 ——
   *     那条路要按 `detail-pane-task.spec.ts` 的写法先 `parkCursor`、并在行尾面板
   *     收起之后才点得到。
   *
   * ⇒ 下一趟要量它，照 `e2e/tests/detail-pane-task.spec.ts` 起一条 **detail-pane 配置**
   *   的用例（`playwright.detail-pane.config.ts`，载体是 `vite preview`），选中之后取
   *   `[data-testid^="task-note-badge-"]` 的高断 `< 下限`。
   *   今天这一半**有**源码侧的尺（`check:chip-typing` 的 C2 与它的自测臂 ③：
   *   只读元素带 `--action` ⇒ 红），缺的只是那一次几何读数。
   */

  await page.screenshot({ path: `${EVIDENCE}/row-chips-1280.png` });
});
