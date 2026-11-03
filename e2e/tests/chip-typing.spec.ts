import { expect, test, type Page } from '@playwright/test';

import { addTask, openApp, openRowTail, parkCursor, rowFor, switchView } from './helpers';
import { openTaskPane } from './task-detail-entry.js';

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
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 2026-11（行操作 UX 重设计）：**第一条的旧前提整个消失了**
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 它原来量的是"行尾那一排**可点 chip**（`.ht-chip--action`：截止 / 备注 / 子任务 /
 * 提醒 / AI）够不够到触控下限"，并带一枚分母臂（`count ≥ 3`）。
 * 产品负责人那句「把所有这种铺开式组件全都删掉，全都收拢进来」之后：
 *
 *   · 行尾**只剩只读徽标**（`task-note-badge-*` / `task-subtask-badge-*` /
 *     `task-chip-repeat` / `task-reminder-badge-*` / `TagChips`），一枚都不可点；
 *   · 字段编辑器全搬进 `TaskDetailCard`（宽档在详情列、窄档在点行的对话框），
 *     面单里**没有一枚 `.ht-chip`**。
 *
 * 实测（2026-11，1280×900）：行尾容器 `[data-testid^="task-trailing-"]` 里
 * `.ht-chip--action` **0 枚**、`.ht-compose-actions` **0 枚**；面单里
 * `.ht-chip--action` **0 枚**；整行高 62px。
 *
 * ⇒ 判据的**主体跟着编辑器搬家**：动作档现在是面单里那几枚承接它的控件
 *（`AI 拆解` / `AI 估时` / `提醒` —— 实测都是 44px），行尾这一半改成
 * "一枚可点 chip 都不许回来"。守的仍是同一件事：**能点的东西要够到触控下限，
 * 且不许有不可点的东西混进动作那一档**。
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

test('行尾只剩只读徽标：一枚可点 chip 都不许回来，动作档搬进面单后仍够到触控下限', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openApp(page, '/?lang=zh-CN');
  await switchView(page, '任务');
  await addTask(page, TITLE);
  const row = rowFor(page, TITLE);
  await expect(row, `列表里没有刚加的「${TITLE}」`).toBeVisible();
  await parkCursor(page);
  // 守卫：这一行真的在列表里，且行尾没有（也不许再有）折叠动作区。见 `openRowTail` 注释。
  await openRowTail(page, row);

  const floor = await tokenPx(page, '--ht-touch-target-min');
  expect(floor, '下限 token 算不出来（这条会空转）').toBeGreaterThan(0);

  const actions = row.locator('.ht-chip--action');
  const actionCount = await actions.count();
  /*
   * 🔴 旧判据是"`actionCount ≥ 3` 且每一枚 ≥ 下限" —— 那一排已经不存在了（文件头那段
   * 现量：行尾 0 枚）。现在这一半守的是**反向**那件事：行尾**一枚可点 chip 都不许回来**。
   * 有它，`NoteBadge` / `SubtaskBadge` / `RepeatChip` / `ReminderBadge` / `TagChips`
   * 里任何一枚被贴上动作档（`ht-chip--action`，即 `min-block-size: 44px` + `cursor:pointer`）
   * 都会当场红 —— 那正是"只读徽标长得像能点"的另一种形状。
   */
  expect(
    actionCount,
    `行尾又出现了 ${String(actionCount)} 枚可点 chip（\`.ht-chip--action\`）—— 行内字段编辑器` +
      '整排已被撤掉、编辑权搬进面单（`TaskDetailCard`），行尾只许剩只读徽标',
  ).toBe(0);

  /*
   * 动作档那一半搬到**编辑器所在的那一格**：面单里承接原行尾动作的几枚控件
   *（AI 拆解 / AI 估时 / 提醒）仍要够到触控下限 —— 编辑器搬家用的是同一批 token，
   * "搬家把 44px 弄丢了"是这条真正会抓到的回退。
   * 分母臂（`paneActionCount ≥ 3`）留着：这三枚一个都不在时，下面的循环会空转而全绿。
   */
  const pane = await openTaskPane(page, TITLE);
  await expect(pane, '宽档下面单应当落在详情列里').toBeVisible();
  await parkCursor(page);
  const paneActions = pane.locator('button.ht-btn, [data-testid="reminder-add-absolute"]');
  const paneActionCount = await paneActions.count();
  expect(
    paneActionCount,
    '面单里一枚动作控件都没量到（AI 拆解 / AI 估时 / 提醒）⇒ 这一半量的是空气',
  ).toBeGreaterThanOrEqual(3);
  for (let i = 0; i < paneActionCount; i += 1) {
    const box = await paneActions.nth(i).boundingBox();
    expect(box, `面单里第 ${String(i + 1)} 枚动作控件量不到框`).not.toBeNull();
    expect(
      box!.height,
      `面单里第 ${String(i + 1)} 枚动作控件没够到触控下限（下限=${String(floor)}px）`,
    ).toBeGreaterThanOrEqual(floor);
  }

  /*
   * 只读徽标那两句几何在**下面第二条**用例里（`只读徽标：…`）：它需要"写完备注之后
   * 徽标出现"那一档，与这一条"面单里量动作控件"的前置互相挡路（那一条要把鼠标挪开、
   * 这一条要在行上量）。
   */
  await page.screenshot({ path: `${EVIDENCE}/row-tail-readonly-1280.png` });
});

test('只读徽标：出现它的那一行不许被抬高，它自己也不许长得像能点', async ({ page }) => {
  /*
   * P7 那一格的另一半判据是**两句几何**：
   *   ① 只读徽标不许把行抬高（徽标一长高，每一行都被一个不能点的东西撑开）；
   *   ② 它自己够不到触控下限（够到了就等于整排在给一个不可点的控件让位）。
   * 源码尺量不到这两句 —— 它只能判类名，判不到"算出来的那一格高"。
   *
   * 走到那一屏的真实路径（不是后门）：宽档 + 点行 ⇒ 面单在详情列里（备注编辑器在那儿）；
   * 写一段备注并 Tab 离开 ⇒ 行尾那一格出现**只读徽标**（2026-11 之后行尾只画只读徽标，
   * 备注的可点 chip 已随整排行内编辑器一起撤掉 —— 见文件头那段现量）。
   * ⚠️ 全程 `parkCursor` 过：鼠标压在行上会改变 hover 态（在册教训）。
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
   * 🔴 基线要在**行尾那一格已经落位**之后取：徽标挂在 `[data-testid^="task-trailing-"]`
   * 那一格里（`App.tsx` 的 `renderTaskTrailing`）。旧形状里那一格是可折叠的
   * （`opacity: 0`），现在它常驻可见 —— 但"先取基线再动"这条纪律不变：
   * 前后两量必须在同一档布局里，比的才只有"徽标出现"这一件事。
   * ⚠️ 第一版红在这里时读数 `Received: hidden`，而那两句几何判据当时是**假绿**的：
   * `boundingBox()` 对未布局的元素读回 null ⇒ 高度按 0 算 ⇒ "没抬高"与
   * "够不到下限"同时成立。所以下面还有一句"徽标必须真的画出来"。
   */
  await parkCursor(page);
  /*
   * 🔴 2026-11：这里原来先 `openRowTail` 再按 `ArrowDown` 选中第一行。行尾折叠区没了，
   * 而"点行 ⇒ 面单"就是现在**界面上唯一看得见**的那条入口（`App.tsx` 的 `openTask`），
   * 所以改成走真实路径：点行体。**基线必须在选中之后取** —— 详情列一出现行会变窄，
   * 行高可能换行变高；先取基线再点行，就把"换行"与"徽标出现"混成一格了。
   */
  await openTaskPane(page, TITLE);
  await parkCursor(page);
  const heightBefore = (await row.boundingBox())?.height ?? 0;
  expect(heightBefore, '写备注之前行高度量为 0 ⇒ 这把尺会空转').toBeGreaterThan(0);

  const pane = page.getByTestId('detail-column').getByTestId('task-pane');
  await expect(pane, '点行体没在详情列里给出面单 ⇒ 拿不到栏里的备注框，后面那半句判据无从谈起').toHaveCount(1);
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
