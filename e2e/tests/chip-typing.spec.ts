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
   * 🔴 只读徽标那一半**这一趟没量到**，登记为未判定，不写成"已验收"：
   *   试过两条落点都不出现 `.ht-chip:not(.ht-chip--action)` ——
   *     · 在**这一行**里找（`NoteEditor` 那颗 `task-note-badge-*` 不在行内）；
   *     · 退到**整页**找（写完备注 + 失焦之后仍然 0 枚 ⇒ 徽标画在面单那一侧，
   *       而这一趟从没把面单打开）。
   *   下一趟要量它：先按 `e2e/tests/detail-pane-*.spec.ts` 的走法把面单打开，
   *   再取 `page.getByTestId(`task-note-badge-${id}`)` 的高，断 `< 下限`。
   *   这一格今天**有**源码那一侧的尺：`check:chip-typing` 的 C2（带 self-test 臂 ③
   *   "只读徽标带 --action ⇒ 红"），缺的只是浏览器里那一次读数。
   */
  await page.screenshot({ path: `${EVIDENCE}/row-chips-1280.png` });
});
