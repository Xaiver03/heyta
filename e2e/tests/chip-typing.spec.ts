import { expect, test, type Page } from '@playwright/test';

import { addTask, openApp, openRowTail, parkCursor, switchView } from './helpers';

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

test('行尾那一排：可点 chip 够到触控下限（只读徽标那一半在同目录第二条）', async ({ page }) => {
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
   * 只读徽标那一半的浏览器读数在**下面第二条**用例里（`只读徽标：…`）。
   * 它没并到这一条里，是因为徽标只在"栏里画着面单"时才挂（`taskPaneInColumn`），
   * 需要先选中一行、且鼠标不能压在行上 —— 与这一条"行尾面板展开"的前置互相挡路。
   * 源码那一侧的尺一直在守（`check:chip-typing` 的 C2 与自测臂 ③：只读元素带 `--action` ⇒ 红）。
   */

  await page.screenshot({ path: `${EVIDENCE}/row-chips-1280.png` });
});

test('只读徽标：出现它的那一行不许被抬高，它自己也不许长得像能点', async ({ page }) => {
  /*
   * P7 那一格的另一半判据是**两句几何**：
   *   ① 只读徽标不许把行抬高（徽标一长高，每一行都被一个不能点的东西撑开）；
   *   ② 它自己够不到触控下限（够到了就等于整排在给一个不可点的控件让位）。
   * 源码尺量不到这两句 —— 它只能判类名，判不到"算出来的那一格高"。
   *
   * 走到那一屏的真实路径（不是后门）：宽档 + 选中一行 ⇒ 备注的编辑权在栏里；
   * 写一段备注并 Tab 离开 ⇒ 行尾那一格从"可点的编辑器 chip"换成**只读徽标**。
   * ⚠️ 全程 `parkCursor` 过：行尾面板展开时鼠标压在行上会让点击被拦（在册教训）。
   */
  await page.setViewportSize({ width: 1280, height: 900 });
  await openApp(page, '/?lang=zh-CN');
  await switchView(page, '任务');
  await addTask(page, TITLE);
  const row = page.locator('[data-testid^="task-item-"]').filter({ hasText: TITLE });
  await expect(row, `列表里没有刚加的「${TITLE}」`).toBeVisible();

  const floor = await tokenPx(page, '--ht-touch-target-min');
  expect(floor, '下限 token 算不出来（这条会空转）').toBeGreaterThan(0);

  /*
   * 🔴 基线要在**行尾面板展开**之后取：徽标住在那一格里，面板收起时它是 `hidden`
   * （第一版就红在这里 —— 读数 `Received: hidden`，而两句几何判据当时**假绿**：
   * `boundingBox()` 对未布局的元素读回 null ⇒ 高度按 0 算 ⇒ "没抬高"与"够不到下限"同时成立）。
   * 展开之后，前后两量都在同一档面板状态里，比的才只有"徽标出现"这一件事。
   */
  await parkCursor(page);
  await openRowTail(page, row);
  const heightBefore = (await row.boundingBox())?.height ?? 0;
  expect(heightBefore, '写备注之前行高度量为 0 ⇒ 这把尺会空转').toBeGreaterThan(0);

  await page.keyboard.press('ArrowDown');
  const pane = page.getByTestId('detail-column').getByTestId('task-pane');
  await expect(pane, '↓ 没选中第一条 ⇒ 拿不到栏里的备注框，后面那半句判据无从谈起').toHaveCount(1);
  const note = pane.getByTestId('task-note-input');
  await note.fill('徽标那一格的第一段');
  await note.press('Tab');

  const badge = page.locator('[data-testid^="task-note-badge-"]');
  await expect(badge, '写了备注之后行尾没出现只读徽标').toHaveCount(1);
  // 先留帧再判：判据红了也要看得见那一屏长什么样（AGENTS §6.2 规定一）。
  await page.screenshot({ path: `${EVIDENCE}/row-badge-1280.png` });
  /*
   * 🔴 先钉"它真的被画出来了"，再量它多高。少了这一句，`display:none` 或未布局的元素
   * 会让 `boundingBox()` 读回 null ⇒ 高度按 0 算 ⇒ "够不到下限"与"没抬高行"两句**同时假绿**。
   * 第一版就假绿在这里（看图照出来：截图那一行根本没有徽标，而两条判据都绿）。
   */
  await expect(badge, '徽标在 DOM 里但没画出来 ⇒ 下面两句几何判据量的是空气').toBeVisible();
  const badgeBox = await badge.boundingBox();
  expect(badgeBox, '徽标没有可量的盒子').not.toBeNull();
  const badgeHeight = badgeBox!.height;
  expect(badgeHeight, '徽标高度为 0 ⇒ 这把尺量的是空气').toBeGreaterThan(0);

  const heightAfter = (await row.boundingBox())?.height ?? 0;
  expect(
    Math.abs(heightAfter - heightBefore),
    `只读徽标把行抬高了（前 ${String(heightBefore)}px / 后 ${String(heightAfter)}px）`,
  ).toBeLessThanOrEqual(0.5);

  expect(badgeHeight, `只读徽标够到了触控下限（${String(badgeHeight)}px ≥ ${String(floor)}px）`).toBeLessThan(floor);

  const look = await badge.evaluate((el) => {
    const cs = getComputedStyle(el as HTMLElement);
    return { cursor: cs.cursor, cls: (el as HTMLElement).className };
  });
  expect(look.cls, '只读徽标被贴上了动作档的类').not.toContain('ht-chip--action');
  expect(look.cursor, '只读徽标画出了可点的手形').not.toBe('pointer');

});
