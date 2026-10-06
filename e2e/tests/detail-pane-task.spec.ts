/**
 * 任务面单落进详情列那一格（工单 §8.138 / C1 拍板 #1 的任务那一格）
 * ==================================================================
 *
 * 拍板 #1 是"选中某条 = **同一格**换成该实体的面单，不另开第三处"。便签（§8.130）
 * 与习惯（§8.133）之后，任务是本应用**主对象**的那一格 —— 而它此前是空的，
 * 于是那条裁决在它最该成立的地方不成立。§8.130 记下的那道二选一（"行内展开编辑 vs
 * 栏里编辑"）在本单裁成**栏里编辑**，理由与推翻代价写在工单那一节。
 *
 * 🔴 这一层量的是 jsdom 那一族**量不到**的四件事：
 *   ① 那一栏被 CSS 藏掉时，备注输入框**回不回得来**（`display:none` 里藏一只编辑器 =
 *      界面不说、模型已变，§8.130 那条同一个形状）—— T4；
 *   ② 用户打进去的备注**真落成了一条 op**（jsdom 只看到 `onBlur` 被调用过）—— T1 的后半；
 *   ③ 面单里的控件**留得出栏内间距**、长标题不许把 22rem 的栏撑破（几何只在浏览器成立）—— T1/T5；
 *   ④ Enter 之后焦点**真的落在那只框里**（`focus()` 在非 form 元素上要真浏览器才算数）—— T3。
 *
 * ⚠️ 载体是 `vite preview` + `apps/web/dist`（见 `playwright.detail-pane.config.ts` 文件头），
 *    改完 `apps/web/src/**` **必须先重打**，否则量的是旧产物（§7 第 27 条那一族）。
 */
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';

import { addTask, openApp, parkCursor, switchView } from './helpers';

const SHOT = (name: string) =>
  fileURLToPath(new URL(`../../apps/web/evidence/detail-pane-task/${name}.png`, import.meta.url));

/** 控制台错误进断言（§6.2 规定一第 3 条），监听必须在导航之前挂上。 */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));
  return errors;
}

/** 整机计数：限定到某一栏就只是"这一支有没有"，"两支同时渲染"在两个局部读数上都是 1。 */
const fieldEverywhere = (page: Page): Locator => page.getByTestId('task-note-input');
const paneEverywhere = (page: Page): Locator => page.getByTestId('task-pane');
const paneInColumn = (page: Page): Locator => page.getByTestId('detail-column').getByTestId('task-pane');

/** 元素**真实画得出来**吗（`toBeVisible` 的等价量，顺带把尺寸拿回来做几何判据）。 */
async function paintedBox(page: Page, locator: Locator) {
  await expect(locator, '界面上找不到这个元素').toBeVisible();
  const box = await locator.boundingBox();
  expect(box, '元素"可见"却量不到 boundingBox').not.toBeNull();
  return box as { x: number; y: number; width: number; height: number };
}

/** 把一个 CSS 变量量成 px（栏内间距的判据要**从 token 推导**，不抄字面量）。 */
async function pxOfCssVar(page: Page, name: string): Promise<number> {
  return page.evaluate((varName) => {
    const probe = document.createElement('div');
    probe.style.width = `var(${varName})`;
    probe.style.position = 'absolute';
    document.body.appendChild(probe);
    const px = probe.getBoundingClientRect().width;
    probe.remove();
    return px;
  }, name);
}

/** 建一条任务并把焦点交回页面（输入框带着焦点时方向键归它 —— K2 同一条闸门）。 */
async function addTaskAndRelease(page: Page, title: string): Promise<void> {
  await addTask(page, title);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
}

/** 当前焦点所在元素**到 body 这条链上**的锚（判 Enter 的落点，不靠截图）。 */
async function activeAnchors(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    let node: Element | null = document.activeElement;
    while (node !== null) {
      const testid = node.getAttribute('data-testid');
      if (testid !== null) out.push(testid);
      const cls = typeof node.className === 'string' ? node.className : '';
      for (const name of cls.split(/\s+/)) {
        if (name.startsWith('ht-')) out.push(name);
      }
      node = node.parentElement;
    }
    return out;
  });
}

/**
 * 把焦点从输入框里交出去。
 *
 * 🔴 不是整洁：光标那一族的第一道闸门是"正在打字 ⇒ 方向键归输入框"（W1b 边界①），
 * 焦点留在正文框里按 ↓ 什么都不会动，而症状长得像"那一格没跟着换"。
 * 这一条在第一趟就把 T2 判红了 —— 红的是探针，不是产品。
 */
async function releaseFocus(page: Page): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
}

test.describe('任务面单落进那一栏（§8.138）', () => {
  test('T1 选中一条 ⇒ 那一格是它的面单；备注框整页只有一只，且写进去的能刷新回来', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await addTaskAndRelease(page, '面单甲');

    /* 前提（这一档仍是**裁决的一部分**，不是漏做）：宽档 + 未选中时栏里没有面单。
       🔴 而"整机也没有备注输入框"这一半在 2026-10-06 第二刀之后不成立了：那一刀把
       `taskPaneInColumn` 补上"真的选中了一条任务"，于是未选中时编辑权**回到行尾那枚 chip**
       （`<details>` 收着，不是摊开的 textarea）。旧写法是 §8.138 那版的形状 ——
       行尾让位给一个**没在画东西的栏**，两半都不接，用户谁都写不了备注。
       不变量还是那一条：**任何时刻不许两处同时可编辑** ⇒ 输入框数 == 任务行数，
       而栏里那一格零只输入框。 */
    await expect(paneInColumn(page), '没选中却画了面单').toHaveCount(0);
    await expect(
      page.getByTestId('detail-column').getByTestId('task-note-input'),
      '栏里没画面单，却藏着一只备注框（那正是"编辑权没人接"的反面）',
    ).toHaveCount(0);
    await expect(
      fieldEverywhere(page),
      '未选中时行尾没把编辑权接回去 ⇒ 整机没有备注入口',
    ).toHaveCount(await page.locator('[data-testid^="task-item-"]').count());

    await page.keyboard.press('ArrowDown');
    const pane = paneInColumn(page);
    await expect(pane, '↓ 选中了第一条，那一格却没换成它的面单').toHaveCount(1);
    await expect(pane.locator('h2')).toHaveText('面单甲');

    // 🔴 唯一所有者：整机一只正文框，且它就住在栏里。
    await expect(fieldEverywhere(page)).toHaveCount(1);
    await expect(pane.getByTestId('task-note-input')).toHaveCount(1);

    // ── 真实几何 ────────────────────────────────────────────────
    const column = await paintedBox(page, page.getByTestId('detail-column'));
    const inset = await pxOfCssVar(page, '--ht-space-4');
    expect(inset, '栏内间距 token 量为 0，下面的判据会退化成"只要不出栏就算对"').toBeGreaterThan(0);
    for (const [label, part] of [
      ['标题', await paintedBox(page, pane.locator('h2'))],
      ['正文框', await paintedBox(page, pane.getByTestId('task-note-input'))],
    ] as const) {
      expect(
        part.x + part.width,
        `${label} 的右边缘 ${String(part.x + part.width)} 贴住了窗口边（列右边缘 ${String(
          column.x + column.width,
        )}，应留 ${String(inset)}px）`,
      ).toBeLessThanOrEqual(column.x + column.width - inset + 1);
      expect(
        part.x,
        `${label} 的左边缘 ${String(part.x)} 没留出栏内间距（列左边缘 ${String(column.x)}）`,
      ).toBeGreaterThanOrEqual(column.x + inset - 1);
    }

    // ── 写进去的要真落成（jsdom 只看得见 onBlur 被调用过）─────────
    await pane.getByTestId('task-note-input').fill('第一段\n第二段');
    await pane.getByTestId('task-note-input').press('Tab');
    await expect(page.getByTestId('task-note-input')).toHaveValue('第一段\n第二段');
    await page.reload();
    await openApp(page);
    await switchView(page, '任务');
    await page.keyboard.press('ArrowDown');
    await expect(
      paneInColumn(page).getByTestId('task-note-input'),
      '刷新后备注没了 —— 说明那一格写的是本地态，不是 op',
    ).toHaveValue('第一段\n第二段');
    /* 🔴 行尾那枚**只读徽标**：备注的编辑器搬进栏里之后，列表还要能看出"这一行写过东西"
       （第一趟看图照出来的正是少了它 —— 那一行明明写着两段备注，列表里一点痕迹都没有）。
       判据要同时钉住两件事：徽标在，而它**不是**第二个编辑器。 */
    const badge = page.locator('[data-testid^="task-note-badge-"]');
    await expect(badge, '行尾没有备注徽标 ⇒ 列表看不出哪条任务写过备注').toHaveCount(1);
    await expect(badge).toContainText('第一段');
    await expect(badge.locator('textarea')).toHaveCount(0);
    await expect(fieldEverywhere(page), '徽标之外又多出一只正文框').toHaveCount(1);

    await parkCursor(page);
    await page.screenshot({ path: SHOT('t1-wide-in-column') });
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });

  test('T2 ↓ 换选中 ⇒ 那一格跟着换人（标题与正文都比**内容**，不比"有没有"）', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await addTaskAndRelease(page, '跟着换甲');
    await addTaskAndRelease(page, '跟着换乙');

    await page.keyboard.press('ArrowDown');
    await paneInColumn(page).getByTestId('task-note-input').fill('甲的备注');
    await releaseFocus(page);
    await page.keyboard.press('ArrowDown');
    await expect(paneInColumn(page).locator('h2'), '栏里的标题没跟着选中换').toHaveText('跟着换乙');
    await expect(
      paneInColumn(page).getByTestId('task-note-input'),
      '标题换了而正文框还是上一条（`key={task.id}` 没生效）',
    ).toHaveValue('');

    // 🔴 栏里始终只有一枚面单（"跟着换"不等于"又加一枚"）。
    await expect(paneEverywhere(page)).toHaveCount(1);
    await expect(fieldEverywhere(page)).toHaveCount(1);

    await parkCursor(page);
    await page.screenshot({ path: SHOT('t2-pane-follows-cursor') });
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });

  test('🔴 T3 Enter ⇒ 焦点交给那一格的正文框（W1b 第 3 条腿的任务那一面）', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await addTaskAndRelease(page, '回车进正文');

    /* 用**点标题那一格**（而不是整行 `task-item-*`）拿到选中与焦点：整行的中心落在行尾
       那坨常驻控件上（`selection-projections.spec.ts:161` 用的就是 `task-row-*`，
       而它文件头第 1 条记着"按标题找行不能用 task-item-*"那一族）。
       为什么不按 ↓：机制判断"焦点行 == 带痕迹那一行"读的是 `document.activeElement`，
       而 ↓ 只改选中、**不挪 DOM 焦点**（第一趟按 ↓ 之后焦点还在 `body`，Enter 正确地没接管 ——
       红的是探针不是产品）。"纯键盘导航时 Enter 要焦点先在行上"这一档已登记成待办。 */
    const row = page.locator('[data-testid^="task-row-"]').first();
    await row.click();
    await expect(paneInColumn(page)).toHaveCount(1);
    const before = await activeAnchors(page);
    expect(
      before.includes('task-note-input'),
      `前置没成立：按 Enter 之前焦点已经在框里了（${before.join(' ')}），这条判据会空转`,
    ).toBe(false);

    await row.press('Enter');
    const after = await activeAnchors(page);
    expect(
      after.includes('task-note-input'),
      `Enter 之后焦点锚是 ${after.join(' ')}，不是栏里那只正文框`,
    ).toBe(true);
    // Enter 不许顺手写任何东西：正文仍是空的。
    await expect(page.getByTestId('task-note-input')).toHaveValue('');

    await parkCursor(page);
    await page.screenshot({ path: SHOT('t3-enter-focuses-note') });
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });

  test('🔴 T4 窄档（栏不出现）⇒ 备注框**回到行尾那颗 chip**，不许藏在 display:none 里', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await addTaskAndRelease(page, '窄档回落甲');
    await page.setViewportSize({ width: 900, height: 600 });

    // 栏这一支整个不画（`taskPaneInColumn` 为假 ⇒ 行尾那一支的条件反向成立）。
    await expect(paneEverywhere(page), '窄档还在往不存在的栏里画面单').toHaveCount(0);
    await expect(fieldEverywhere(page), '窄档下行尾那颗 chip 没回来 = 这一档根本写不了备注').toHaveCount(1);
    /* 🔴 那颗 chip 是一个 `<details>`：**收起时框在 DOM 里但画不出来**（第一趟就是把这条
       判成"hidden"红的，红的是探针不是产品 —— 判"能写"必须走到用户真会走的那一步）。
       点开它，框才必须真画得出来。 */
    await page.locator('.ht-note > summary').first().click();
    await paintedBox(page, fieldEverywhere(page));
    await fieldEverywhere(page).fill('窄档也写得进去');
    await releaseFocus(page);
    await expect(fieldEverywhere(page)).toHaveValue('窄档也写得进去');

    await parkCursor(page);
    await page.screenshot({ path: SHOT('t4-narrow-falls-back-to-row') });
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });

  test('🔴 T5 长标题不许把 22rem 的栏撑破（overflow-wrap 的靶）', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await addTaskAndRelease(page, 'aVeryLongUnbreakableEnglishTaskTitleThatShouldNotOverflowTheDetailColumn');

    await page.keyboard.press('ArrowDown');
    const column = await paintedBox(page, page.getByTestId('detail-column'));
    const title = await paintedBox(page, paneInColumn(page).locator('h2'));
    expect(
      title.x + title.width,
      `标题右边缘 ${String(title.x + title.width)} 出了列右边缘 ${String(column.x + column.width)}`,
    ).toBeLessThanOrEqual(column.x + column.width + 1);
    expect(
      title.height,
      '标题只有一行却写着超长串 ⇒ 它是被裁了而不是折行了（看图会看不出来）',
    ).toBeGreaterThan(0);
    const overflow = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="detail-column"]');
      return el === null ? null : el.scrollWidth - el.clientWidth;
    });
    expect(overflow, '详情列出现横向溢出（栏里放不下就该折行，不是加滚动条）').not.toBeNull();
    expect(overflow as number).toBeLessThanOrEqual(1);

    await parkCursor(page);
    await page.screenshot({ path: SHOT('t5-long-title-wraps') });
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });
  test('T6 宽档：重复的编辑本体在栏里那一格，行尾只剩只读徽标（§8.141）', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await addTaskAndRelease(page, '重复归栏甲');

    await page.locator('[data-testid^="task-row-"]').first().click();
    const pane = paneInColumn(page);
    await expect(pane, '栏里没画面单').toHaveCount(1);

    // 🔴 编辑本体**整页只有一份**，而且它在栏里：行尾那颗 `<summary>` 必须整个不渲染。
    // "行尾只剩徽标"如果只量"徽标在"，就把"两处都能编辑"读成了对 —— 所以两半都要量。
    await expect(page.getByTestId('task-repeat-custom-input')).toHaveCount(1);
    await expect(pane.getByTestId('task-repeat-custom-input')).toHaveCount(1);
    await expect(
      page.getByTestId('task-repeat-summary'),
      '栏里画着的时候行尾还留着重复浮层的触发器 ⇒ 同一字段两处可编辑',
    ).toHaveCount(0);

    // 打进去的串要真落成一条 op（jsdom 只看得到 onChange/onClick 被调过）。
    await page.getByTestId('task-repeat-custom-input').fill('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU');
    await page.getByTestId('task-repeat-custom-input').press('Enter');
    await page.reload();
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await page.locator('[data-testid^="task-row-"]').first().click();

    const badge = page.getByTestId('task-chip-repeat');
    await expect(badge, '写过重复规则而列表上没有痕迹 ⇒ 搬进栏里把这件事弄丢了').toHaveCount(1);
    await expect(badge).toContainText('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU');
    await expect(
      badge.locator('input, textarea, button'),
      '徽标里长出可编辑控件（那是第二个编辑器）',
    ).toHaveCount(0);
    await expect(page.getByTestId('task-repeat-custom-input')).toHaveCount(1);

    await parkCursor(page);
    await page.screenshot({ path: SHOT('t6-repeat-field-in-column') });
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });

  test('T7 窄档：那一栏整个不在，重复的编辑入口回到行尾那颗浮层', async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 900, height: 600 });
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await addTaskAndRelease(page, '窄档重复甲');

    await expect(paneEverywhere(page), '窄档不该画面单').toHaveCount(0);
    const trigger = page.getByTestId('task-repeat-summary');
    await expect(trigger, '窄档下行尾没有重复入口 ⇒ "设不了重复"').toHaveCount(1);
    await trigger.first().click();

    // ⚠️ `<details>` 收起时面板在 DOM 里但不画得出来（§8.138 T4 同一件事）：
    // 判"写不写得进去"必须量真实渲染，不能只看 `toHaveCount`。
    const field = page.getByTestId('task-repeat-custom-input');
    const box = await paintedBox(page, field.first());
    expect(box.width, '窄档那只在行尾的框被挤成 0 宽').toBeGreaterThan(40);
    await field.first().fill('FREQ=MONTHLY;BYMONTHDAY=15');
    await field.first().press('Enter');

    await page.reload();
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await expect(
      page.getByTestId('task-chip-repeat').first(),
      '窄档设的重复规则没落成（刷新后行上没有痕迹）',
    ).toContainText('FREQ=MONTHLY;BYMONTHDAY=15');

    // 🔴 截图前把被量的那一行滚进视口：900×600 下 AI 那几块把列表推到首屏之外，
    //   不滚的话这张图里**没有判据量的那一格** —— 而 §6.2 规定一要的是"人看图"，
    //   一张看不见被量对象的图不构成证据（本轮第一版 t7 就是这样，读数绿、图没用）。
    await page.getByTestId('task-chip-repeat').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: SHOT('t7-narrow-repeat-falls-back-to-row') });
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });

  /** 行体那一棵（标题 + 元信息；尾部动作是它的兄弟节点，见 `TaskRow.tsx` 的注释）。 */
  const rowOf = (page: Page, title: string): Locator =>
    page.locator('[data-testid^="task-row-"]').filter({ hasText: title }).first();

  /**
   * 🔴 **整行**那一棵（行体 + 尾部动作），T14/T15 用它而不是 `rowOf`。
   *
   * 理由不是便利，是 `packages/ui/src/task-list/TaskRow.tsx:292` 那段注释记着的实测代价：
   * `renderTrailing` 是行体的**兄弟节点**，按 `task-row-*` 定位行尾控件会**全部落空**
   *（那枚触发器、那几枚 chip、`<details>` 里的下拉与复选框都在尾部）。外层 `task-item-*`
   * 就是为这一档补的可寻址名字（同一形状当初砸在 `e2e/tests/task-organize.spec.ts` 上）。
   *
   * ⚠️ **点行选中仍然走 `rowOf`**：外层那棵 `View` 没有 `onPress`，点它不会选中。
   */
  const rowItemOf = (page: Page, title: string): Locator =>
    page.locator('[data-testid^="task-item-"]').filter({ hasText: title }).first();

  test('T8 宽档：子任务的编辑本体在栏里那一格，行尾只剩只读徽标（§8.144）', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await addTask(page, '子任务父甲');
    await addTaskAndRelease(page, '子任务子乙');

    await rowOf(page, '子任务子乙').click();
    const pane = paneInColumn(page);
    await expect(pane, '栏里没画面单').toHaveCount(1);

    // 🔴 整页只有一只 `<select>`，且它在栏里。只量"栏里有"会把"两处都能编辑"读成对。
    const selectEverywhere = page.locator('[data-testid^="subtask-select-"]');
    await expect(selectEverywhere, '子任务的 select 不止一只 ⇒ 两处可编辑（两套写入语义迟早漂）').toHaveCount(1);
    const select = pane.locator('[data-testid^="subtask-select-"]').first();
    await expect(select, '栏里没有那只 select').toBeVisible();
    await expect(
      page.locator('[data-testid^="subtask-trigger-"]'),
      '栏里画着的时候行尾还留着那颗 `<summary>` ⇒ 子任务两处可编辑',
    ).toHaveCount(0);

    // 候选的预过滤在**真渲染**里同样成立：自己的标题不许出现在候选里（选得到就能造环）。
    const optionTexts = await select.locator('option').allTextContents();
    expect(optionTexts, '自己出现在候选里').not.toContain('子任务子乙');
    expect(optionTexts, '合法父没进候选 ⇒ 这一格根本改不了').toContain('子任务父甲');
    expect(optionTexts).toContain('（顶级任务）');

    await select.selectOption({ label: '子任务父甲' });
    await page.reload();
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await rowOf(page, '子任务子乙').click();

    const badge = page.locator('[data-testid^="task-subtask-badge-"]');
    await expect(badge, '改过父而列表上没有痕迹 ⇒ 搬进栏里把这件事弄丢了').toHaveCount(1);
    await expect(badge).toContainText('子任务父甲');
    await expect(
      badge.locator('select, details, input, textarea, button'),
      '徽标里长出可编辑控件（那是第二个编辑器）',
    ).toHaveCount(0);
    await expect(selectEverywhere, '刷新后 select 又不是整页一份').toHaveCount(1);

    /*
      🔴 再换一条选中，量**反向**那一档：乙 现在是 甲 的子，所以 甲 的候选里**不许**再有 乙。
      上面那段只挡得住"自己出现在候选里"（`id !== task.id` 那种土办法恰好能过），
      而"后代"这一类才是环的入口 —— 臂台 S5 就是打在预过滤上的，
      没有这一段，S5 在真浏览器层是盲区（jsdom 有它的用例，浏览器这一层今天也得有）。
    */
    await rowOf(page, '子任务父甲').click();
    const parentOptions = await pane
      .locator('[data-testid^="subtask-select-"]')
      .first()
      .locator('option')
      .allTextContents();
    expect(parentOptions, '自己的标题出现在候选里').not.toContain('子任务父甲');
    expect(parentOptions, '后代出现在候选里 ⇒ 在界面上就能造出环（环 = 树无限递归）').not.toContain(
      '子任务子乙',
    );
    expect(parentOptions).toContain('（顶级任务）');

    await badge.scrollIntoViewIfNeeded();
    await parkCursor(page);
    await page.screenshot({ path: SHOT('t8-subtask-field-in-column') });
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });

  test('T9 窄档：那一栏整个不在，子任务的编辑入口回到行尾那颗 chip', async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 900, height: 600 });
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await addTask(page, '窄档子任务父');
    await addTaskAndRelease(page, '窄档子任务子');

    await expect(paneEverywhere(page), '窄档不该画面单').toHaveCount(0);
    /**
     * 🔴 定位走**可访问名**，不走"行容器里找"。两个理由各挡一种假绿/假红：
     *   ① 尾部动作是行体（`task-row-*`）的**兄弟节点**，不在它里面（`TaskRow.tsx` 的注释），
     *       所以 `rowOf(...).locator('[data-testid^="subtask-trigger-"]')` 恒为 0；
     *   ② 也不能退到 `task-item-*` + `hasText`：窄档那颗 chip 的 `<select>` 把**别的任务标题**
     *       写进了 `option`，于是"含『窄档子任务父』的行"两行都命中
     *       （`selection-projections.spec.ts` 文件头第 1 条记的就是这个）。
     * `aria-label` 是界面自己声明的名字（`web.subtask.trigger.aria` / `…pick.aria`），
     * 只有那一行会带着它。
     */
    const trigger = page.getByLabel('把「窄档子任务子」移到别的任务下面');
    await expect(trigger, '窄档下行尾没有子任务入口 ⇒ "挂不到谁下面"').toHaveCount(1);
    await trigger.click();

    // ⚠️ 与 T7 同一条：`<details>` 收起时那只 select 在 DOM 里但**不画**，
    // 所以必须量真实渲染，`toHaveCount(1)` 不构成"写得进去"。
    const select = page.getByLabel('选一个父任务：窄档子任务子');
    const box = await paintedBox(page, select);
    expect(box.width, '窄档那只在行尾的 select 被挤成 0 宽').toBeGreaterThan(40);
    await select.selectOption({ label: '窄档子任务父' });

    await page.reload();
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await expect(
      page.getByLabel('把「窄档子任务子」移到别的任务下面'),
      '窄档那次改父没落成（刷新后行上的 chip 没写挂在谁下面）',
    ).toContainText('窄档子任务父');

    await page.getByLabel('把「窄档子任务子」移到别的任务下面').scrollIntoViewIfNeeded();
    await page.screenshot({ path: SHOT('t9-narrow-subtask-falls-back-to-row') });
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });

  test('T10 宽档：提醒的编辑本体在栏里那一格，行尾只剩只读徽标（§8.145）', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await addTaskAndRelease(page, '提醒甲');
    /* 🔴 第二条是**没有提醒**的那一条，加它只有一个理由：给臂台 M3（"徽标不判有没有提醒"）
       留一枚牙。T10 原本只有一条任务，而那条本来就该有一枚徽标 ⇒ "record 档变成常驻"
       这种坏在 e2e 层数出来仍是 1，看不见。有了这一条，整机判据 `[data-testid^="task-reminder-badge-"]`
       等于 1 才真的会红（与 §8.144 的 S3 同一档，A5/R3 那两臂当初就是缺这一条而成了盲区）。 */
    await addTaskAndRelease(page, '提醒乙·不挂提醒');

    await rowOf(page, '提醒甲').click();
    const pane = paneInColumn(page);
    await expect(pane, '栏里没画面单').toHaveCount(1);

    // 🔴 整页只有一份提醒列表，且它在栏里。只量"栏里有"会把"两处都能编辑"读成对。
    const listEverywhere = page.locator('[data-testid^="reminder-list-"]');
    await expect(
      listEverywhere,
      '提醒列表不止一份 ⇒ 两处可编辑（两套写入语义迟早漂）',
    ).toHaveCount(1);
    await expect(pane.locator('[data-testid^="reminder-list-"]').first(), '栏里没有那份列表').toBeVisible();

    // 行尾那两层外壳都不许留着：`details.ht-compose--popover` 一没了指的是"入口还在行上"，
    // `.ht-material` 一没了指的是"栏里漂着一块浮层"。两档各挡一种坏形状。
    await expect(
      page.locator('details.ht-compose--popover'),
      '栏里画着的时候行尾还留着那颗提醒 chip ⇒ 提醒两处可编辑',
    ).toHaveCount(0);
    await expect(pane.locator('.ht-material'), '栏里那一格拿到了行尾的玻璃浮层').toHaveCount(0);

    // 「提醒」这一块在栏里只有一处区块头（它由共享 `ReminderList` 自己渲染）。
    await expect(pane.getByText('提醒', { exact: true }), '「提醒」区块头不止一处').toHaveCount(1);

    // 没有截止时间 ⇒ 唯一入口是绝对时刻那颗，而且它建出来的必须是 now + 1 小时
    // （键名里的 `1h` 与文案是同一份契约）。这里量的是**真点下去之后行上留下了什么**。
    await pane.getByTestId('reminder-add-absolute').click();
    const badge = page.locator('[data-testid^="task-reminder-badge-"]');
    await expect(badge, '栏里点了「1 小时后提醒」而行上没有痕迹').toHaveCount(1);
    await expect(badge).toHaveText('1');
    await expect(
      badge.locator('button, details, [data-testid^="reminder-"]'),
      '徽标里长出可编辑控件（那是第二个编辑器）',
    ).toHaveCount(0);

    await page.reload();
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    // ⚠️ 选中态**不跨刷新**，而"行尾只剩只读徽标"这一支从第二刀起还要求**真选中**
    //   （`taskPaneInColumn` 里那半 `selectedTaskId !== null`）。所以"那发 op 落库了没有"
    //   必须先重新选中再量徽标：原来这两句的顺序是"未选中先量徽标"，量到的 0 其实是
    //   "行尾此刻画的是 chip 而不是徽标"，不是"op 没落"。下面那句"整页一份列表"本来
    //   就要求先选中（它自己的注释写着），两件事现在共用同一个前提。
    await rowOf(page, '提醒甲').click();
    await expect(
      page.locator('[data-testid^="task-reminder-badge-"]'),
      '那次点击没落成 op（重新选中之后行上仍没有提醒徽标）',
    ).toHaveCount(1);
    await expect(listEverywhere, '刷新后列表又不是整页一份').toHaveCount(1);

    await badge.scrollIntoViewIfNeeded();
    await parkCursor(page);
    await page.screenshot({ path: SHOT('t10-reminder-field-in-column') });
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });

  test('T11 窄档：那一栏整个不在，提醒的编辑入口回到行尾那颗 chip', async ({ page }) => {
    const errors = watchErrors(page);
    /* 🔴 窄档这里用 **900×900** 而不是 T7/T9 的 900×600，理由只有一条且是实测出来的：
       行尾那颗 chip 的面板**朝下开**（`.ht-compose-panel{position:absolute}`），600 高时
       锚点行下方没有余量 ⇒ 面板伸出视口下沿，图里只露出"提醒"两个字。
       宽度仍是 900（< 1024 ⇒ 栏不画，见 `detail-pane-visible.ts` 的 `DETAIL_FITS_QUERY`），
       所以"窄档"这一档没有因为高度被换掉。 */
    await page.setViewportSize({ width: 900, height: 900 });
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await addTaskAndRelease(page, '窄档提醒乙');

    await expect(paneEverywhere(page), '窄档不该画面单').toHaveCount(0);
    /**
     * 🔴 定位走**可访问名**（`reminder.a11y.list`），与 T9 同一条理由：尾部动作是行体的
     * 兄弟节点，而窄档那颗 chip 的面板会把别的任务正文写进 DOM。
     * ⚠️ 零条提醒时那颗 chip 显示的是「提醒」二字 = **入口**（`record` 档只约束栏里那枚徽标）。
     */
    const trigger = page.getByLabel('「窄档提醒乙」的提醒');
    await expect(trigger, '窄档下行尾没有提醒入口 ⇒ "建不了提醒"').toHaveCount(1);
    // 先把锚点行滚到它所在分组容器的上沿：那一格是 `overflow:hidden auto` 的滚动容器，
    // 面板朝下开，不滚的话整块在容器外（Playwright 的 click 自己也会滚，所以这一步是为了**拍得到**）。
    // ⚠️ 不用 `scrollIntoViewIfNeeded()`：它只在"完全看不见"时才滚，露出半个就什么都不做。
    await trigger.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await trigger.click();

    /* 🔴 那只按钮必须**钉在本行的那颗 chip 上**：`<details>` 收起时子树留在 DOM 里，
       所以列表里有几行就有几枚 `reminder-add-absolute`（实测：垫一条邻居 ⇒ strict mode violation，
       报的是"resolved to 2 elements"而不是"没找到"）。整页 `getByTestId` 在这一族里从来不安全。 */
    const ownChip = page.locator('details:has(> summary[aria-label="「窄档提醒乙」的提醒"])');
    const button = ownChip.getByTestId('reminder-add-absolute');
    const box = await paintedBox(page, button);
    expect(box.width, '窄档那只在行尾的按钮被挤成 0 宽').toBeGreaterThan(20);
    /* 🔴 等**入场动效走完**再拍：`.ht-material` 带 200ms 的 `opacity 0 → 1` 淡入
       （`material.css` 的 `ht-material-in`），而 `toBeVisible()` 不看 opacity ——
       第一趟看图照出来的是"整块面板像被调到了 15% 不透明度"，字都在但读不清。
       那是探针抢跑，不是界面坏；`toHaveCSS('opacity','1')` 会轮询，正好把它等掉。 */
    await expect(ownChip.locator('.ht-compose-panel')).toHaveCSS('opacity', '1');
    /* 🔴 这张图**故意**留着它现在的样子：面板被一个只有 **90px 高**的分组滚动容器裁掉了
       （实测 2026-10-05：容器 top 546 / bottom 636，面板 top 586 / bottom 751，
       那颗按钮 top 664 —— 整颗在容器外，`elementFromPoint` 命中的是 `.ht-content`）。
       同一趟还量到第二档：行包装 div 是 `position:relative; z-index:0`，所以面板的
       `z-index:500` 出不了自己那一行 ⇒ 下面还有行时会被下一行的尾部控件盖住。
       两档都**与 §8.145 无关**（`ReminderPanel` 的 DOM/样式这一单没动），
       登记在待办 #58（行尾下拉面板的可见性）。
       ⚠️ 所以这一族的判据读的是"入口在不在、写没写进去"，**不是**"面板整块看得见"。 */
    await page.screenshot({ path: SHOT('t11-narrow-reminder-panel-open') });
    await button.click();

    await expect(trigger, '窄档点了提醒而 chip 上没写条数').toHaveText('1');
    await page.reload();
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    const chipAfter = page.getByLabel('「窄档提醒乙」的提醒');
    await expect(chipAfter, '窄档那次点击没落成（刷新后行上的 chip 没写条数）').toHaveText('1');

    await chipAfter.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: SHOT('t11-narrow-reminder-falls-back-to-row') });
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });
  test('T12 宽档：截止的编辑本体在栏里那一格，行尾整块不画（§8.146）', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await addTaskAndRelease(page, '截止甲');

    await rowOf(page, '截止甲').click();
    const pane = paneInColumn(page);
    await expect(pane, '栏里没画面单').toHaveCount(1);

    // 🔴 整页只有一份月历，且它在栏里。只量"栏里有"会把"两处都能编辑"读成对。
    // ⚠️ 不用 `toBeContainedIn`：这台套件的**类型**里有那枚匹配器、**跑起来的这份**没有
    //    （`TypeError: expect(...).toBeContainedIn is not a function`，而 `tsc -p
    //    tsconfig.detail-pane.json` 整份 RC=0）。两枚计数合起来就是同一条 containment，
    //    与 T10 数提醒列表那一支同一个形状。
    const picker = page.getByTestId('date-picker');
    await expect(picker, '月历不止一份 ⇒ 截止两处可编辑').toHaveCount(1);
    await expect(pane.locator('[data-testid="date-picker"]'), '栏里没有那份月历').toHaveCount(1);
    // 这一格**要**宿主给区块头（与提醒那一格相反：`ReminderList` 自带，共享 `DatePicker` 不带）。
    await expect(pane.getByText('截止', { exact: true }), '「截止」区块头不止一处，或整个没有').toHaveCount(1);

    // 这一格与前四格**不同形**：宽档行尾不留徽标，整块不画。
    // 截止的显示另有其人（共享行的元信息条 `task-meta`），下面第 ③ 段量的就是它。
    await expect(
      page.locator('[data-testid="due-editor-summary"]'),
      '栏里画着的时候行尾还挂着 `<DueEditor/>` ⇒ 截止两处可编辑',
    ).toHaveCount(0);

    /* ② 🔴 几何：22rem 的一栏里，7 列 × 44px 的日格**不许伸出月历**。
       这条不是"排版好看"：日格内层是固定 44px 的圆（`DatePicker` 文件头那条坑 2），
       外层 `flex: 1` 会被压窄，而**固定尺寸的圆压不窄** —— 一旦栏的可用宽度小于 7×44，
       最右那一列就画到栏外，被 `.ht-app__detail` 的 `overflow-y: auto` 裁掉，
       症状是"周六周日那两列根本点不到"。量的是每个日格的右沿，不是月历自己的框
       （月历的框永远等于容器，看不出溢出）。 */
    const overflow = await picker.evaluate((el) => {
      const host = el.getBoundingClientRect();
      return [...el.querySelectorAll<HTMLElement>('[role="button"]')]
        .map((b) => ({ name: b.getAttribute('aria-label') ?? '?', right: b.getBoundingClientRect().right }))
        .filter((c) => c.right > host.right + 1)
        .map((c) => `${c.name}@right=${String(Math.round(c.right))} > 月历右沿 ${String(Math.round(host.right))}`);
    });
    expect(overflow, '这些日子格伸出月历右边界 ⇒ 那一栏放不下整张月历').toEqual([]);
    const paneBox = await paintedBox(page, pane);
    const pickBox = await paintedBox(page, picker);
    expect(
      pickBox.x + pickBox.width,
      `月历伸出栏的右边界（月历 ${String(Math.round(pickBox.x + pickBox.width))} vs 栏 ${String(Math.round(paneBox.x + paneBox.width))}）`,
    ).toBeLessThanOrEqual(paneBox.x + paneBox.width + 1);

    /* ③ 承重：在栏里点一格 ⇒ **行上仍写着那个日期**。
       这一条是工单 §8.141 第 5 节那条硬约束的现量口径（"截止的显示必须留在行上"）：
       搬走编辑入口之后，行上的显示由共享元信息条 `task-meta` 承担，而不是由行尾那颗
       触发器承担（它今天整块不画）。少了这一段，"搬完了"只证明了我没写坏控件，
       证明不了列表还能扫一眼看出哪天截止。 */
    const cell = picker.locator('[role="button"][aria-label$="18日"]').first();
    await expect(cell, '月历里应有某月 18 日这格').toBeVisible();
    const dayLabel = (await cell.getAttribute('aria-label'))!;
    const md = /(\d+)月(\d+)日/.exec(dayLabel)!;
    const compact = `${md[1]!.padStart(2, '0')}-${md[2]!.padStart(2, '0')}`;
    await cell.click();
    const meta = rowOf(page, '截止甲').getByTestId('task-meta');
    await expect(meta, `栏里点了 ${dayLabel} 而行上没写着 ${compact}`).toContainText(compact);

    await parkCursor(page);
    await page.screenshot({ path: SHOT('t12-due-field-in-column') });

    /* 🔴 换选中 ⇒ 栏里那个月历**不许停在上一条浏览到的那个月**。
       这一段是 `DueField` 那枚 `key` 的牙：共享 `DatePicker` 带本地 state（"正在看哪个月"），
       不换 key 时甲翻到 11 月、选中换到乙，栏里显示的仍是 11 月 —— 而标题已经换了，
       界面在说"这是乙"，日历指着的是甲看的那个月。jsdom 那层同一条坏由
       `apps/web/tests/task-detail-card.spec.tsx` 的"上一条浏览到的那个月"钉，
       但 jsdom 里没有真布局，**翻月这个动作在界面上到不到**只有浏览器知道。 */
    await addTaskAndRelease(page, '截止乙·不选日期');
    await picker.getByRole('button', { name: '下个月' }).click();
    await expect(
      picker.locator(`[role="button"][aria-label="${dayLabel}"]`),
      '翻月没生效：本月 18 日还在格子里',
    ).toHaveCount(0);
    await rowOf(page, '截止乙·不选日期').click();
    await expect(
      pane.locator(`[role="button"][aria-label="${dayLabel}"]`),
      '换选中后栏里还停在上一条浏览到的那个月 ⇒ `DueField` 少了 key',
    ).toHaveCount(1);
    // 换回甲（它自己定在 `dayLabel` 那个月）⇒ 月历落在它自己那个月，不是上一条看的那个月。
    await rowOf(page, '截止甲').click();
    await expect(
      pane.locator(`[role="button"][aria-label="${dayLabel}"]`),
      '换回甲之后月历没落在它自己那个月',
    ).toHaveCount(1);

    await page.reload();
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await expect(
      rowOf(page, '截止甲').getByTestId('task-meta'),
      '那次点击没落成 op（刷新后行上读不到日期）',
    ).toContainText(compact);
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });

  test('T13 窄档：那一栏整个不在，截止的编辑入口回到行尾那颗 chip', async ({ page }) => {
    const errors = watchErrors(page);
    // 900×600 与 T7/T9 同档（宽 < 1024 ⇒ 栏不画）。这里不需要 T11 那 900 高的理由：
    // 截止的面板是 Portal + fixed，本来就画在滚动容器之外。
    await page.setViewportSize({ width: 900, height: 600 });
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await addTaskAndRelease(page, '窄档截止乙');

    await expect(paneEverywhere(page), '窄档不该画面单').toHaveCount(0);
    /* 🔴 定位走**行内**那颗 summary（它带 `aria-label` = 「设置任务「…」的截止日期」），
       与 T9/T11 同一条理由：尾部动作是行体的兄弟节点，而 Portal 出去的面板会把
       **别的**日子写进 DOM。 */
    const summary = page.getByLabel('设置任务「窄档截止乙」的截止日期');
    await expect(summary, '窄档下行尾没有截止入口 ⇒ "改不了截止"').toHaveCount(1);
    const box = await paintedBox(page, summary.first());
    expect(box.width, '窄档那颗行尾触发器被挤成 0 宽').toBeGreaterThan(40);

    await summary.first().click();
    const picker = page.locator('[data-testid="date-picker"]:visible');
    await expect(picker, '点了行尾那颗触发器而面板没开').toBeVisible();
    const cell = picker.locator('[role="button"][aria-label$="18日"]').first();
    await expect(cell, '窄档面板里应有某月 18 日这格').toBeVisible();
    const dayLabel = (await cell.getAttribute('aria-label'))!;
    const md = /(\d+)月(\d+)日/.exec(dayLabel)!;
    const compact = `${md[1]!.padStart(2, '0')}-${md[2]!.padStart(2, '0')}`;
    await cell.click();
    await expect(
      rowOf(page, '窄档截止乙').getByTestId('task-meta'),
      `窄档点了 ${dayLabel} 而行上没写着 ${compact}`,
    ).toContainText(compact);
    /* 🔴 拍之前把那一行**滚进视野中间**：这一趟的行尾面板刚收起，行落在视口下沿，
       第一张图里那一行只有上半截（读得出「截止 10月18日」，但行体被切了一半）。
       不用 `scrollIntoViewIfNeeded()` —— 它只在"完全看不见"时才滚，露出半个什么都不做
       （T11 同一条）。 */
    await rowOf(page, '窄档截止乙').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: SHOT('t13-narrow-due-falls-back-to-row') });

    await page.reload();
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await expect(
      page.getByLabel('设置任务「窄档截止乙」的截止日期'),
      '窄档那次点击没落成（刷新后行尾触发器上没写日期）',
    ).toContainText(dayLabel);
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });

  /*
    T14 / T15 —— 清单 + 标签（工单 §8.147，第六格）。
    这一格的判据形状与前五格同一条，但**留下的那半不一样**：
    截止那一格宽档整块不画（显示另有 `task-meta`），而**标签在共享层没有对应槽**，
    所以行上必须留着 `TagChips` 那两枚 chip —— 于是 T14 同时钉两件事：
    "编辑本体整页只有一份"与"显示仍在行上"。少任何一件，界面都在说谎。
  */
  const SIDEBAR = 'aside[aria-label="清单与标签"]';

  /**
   * 从侧栏建一条清单与一枚标签（走真 UI ⇒ 真 op-log，不塞内存）。
   *
   * ⚠️ 这里的前提检查用**存在性**（`toHaveCount`）而不是 `toBeVisible`：实测这一档
   * `sidebar.getByText(名字, {exact:true})` 解析到行里那只文字 div，它的框量出来是
   * **0×24**（同一行 183×44、行内那只按钮 **0×44**、整个 aside 207×229@80,450）。
   * **成因未定位** —— 本单没动 `apps/web/src/features/projects/ProjectsPanel.tsx`，
   * 也没动 `apps/web/src/styles/app/sidebar.css`，且已用 A/B 否证了"本单弄红的"：
   * 把 `App.tsx` / `TaskOrganizer.tsx` / `TaskDetailCard.tsx` 三个文件换回 HEAD 的产物、
   * 重打 `apps/web/dist`、同一条 `e2e/tests/task-organize.spec.ts:72` **仍然红在同一行**
   * （读数记在工单 §8.147 的闸门①）。
   *
   * 为什么这里只要求"建出来了"：本族量的是**任务行 / 详情栏**，判据（元信息槽写着那条清单、
   * 行上画着那枚 chip）全在行上，不该被侧栏的排版绑住。0 宽那一档单独登记给侧栏那一族。
   */
  async function seedListAndTag(page: Page, list: string, tag: string): Promise<void> {
    const sidebar = page.locator(SIDEBAR);
    await expect(sidebar, '侧栏没开 ⇒ 建不了清单/标签，后面的判据会空转').toBeVisible();
    await sidebar.getByLabel('新建清单').click();
    await sidebar.getByLabel('新清单名称').fill(list);
    await sidebar.getByLabel('添加清单').click();
    await expect(sidebar.locator(`[data-testid^="project-"][data-testid$="-row"]`), `侧栏里没有那条清单「${list}」`).toHaveCount(1);
    await sidebar.getByLabel('新建标签').click();
    await sidebar.getByLabel('新标签名称').fill(tag);
    await sidebar.getByLabel('添加标签').click();
    await expect(sidebar.locator(`[data-testid^="tag-"][data-testid$="-row"]`), `侧栏里没有那枚标签「${tag}」`).toHaveCount(1);
  }

  test('T14 宽档：整理的编辑本体在栏里那一格，行尾只剩只读 chip（§8.147）', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await addTaskAndRelease(page, '整理甲');
    await seedListAndTag(page, '整理清单一', '整理标签一');

    await rowOf(page, '整理甲').click();
    const pane = paneInColumn(page);
    await expect(pane, '栏里没画面单').toHaveCount(1);

    // 🔴 整页只有一份编辑本体，且它在栏里（只量"栏里有"会把"两处都能编辑"读成对）。
    const select = page.getByTestId('organize-project-select');
    await expect(select, '清单下拉不止一份 ⇒ 整理两处可编辑').toHaveCount(1);
    await expect(pane.getByTestId('organize-project-select'), '栏里没有那份清单下拉').toHaveCount(1);
    // 🔴 这一格**自带两个区块头** ⇒ 宿主不许再叠：数的是"那个词出现几次"，
    //    写成"标题在不在"永远抓不到多写（§8.145 的 M2 同一把尺）。
    await expect(pane.getByText('清单', { exact: true }), '「清单」区块头不止一处，或整个没有').toHaveCount(1);
    await expect(pane.getByText('标签', { exact: true }), '「标签」区块头不止一处，或整个没有').toHaveCount(1);
    // 行尾那支整块不画（宽档）：触发器一只都不许有。
    await expect(
      page.getByTestId('task-organize-summary'),
      '栏里画着的时候行尾还挂着 `<TaskOrganizer/>` ⇒ 整理长出第二个编辑器',
    ).toHaveCount(0);

    // ── 承重 ①：在栏里选清单 ⇒ **行的元信息槽**写着那条清单 ──────────────
    await expect(rowOf(page, '整理甲').getByTestId('task-meta'), '起始态就带着清单名 ⇒ 后面的断言永真').not.toContainText(
      '整理清单一',
    );
    await select.selectOption({ label: '整理清单一' });
    await expect(
      rowOf(page, '整理甲').getByTestId('task-meta'),
      '栏里选了清单，行上的元信息槽却没写',
    ).toContainText('整理清单一');

    // ── 承重 ②：在栏里勾标签 ⇒ **行上长出那枚只读 chip** ────────────────
    // 🔴 假绿前提：勾**之前**行上不该有 chip。少了这一条，"长出了那枚 chip"永真 ——
    //    §8.146 学到的那把尺反过来用：判据要能抓住"多画"，也得先证"起始为空"。
    await expect(
      rowItemOf(page, '整理甲').getByTestId('task-chip-tag'),
      '起始态行上就有标签 chip ⇒ 后面那条"长出了"读不出因果',
    ).toHaveCount(0);
    /* 🔴 用 `click()`，不用 `check()` —— 这条坑不是本单新踩的，
       `e2e/tests/task-organize.spec.ts` 早就把它写成了注释：复选框是**受控**的，
       `dispatchIntent` 又是 async（`await engine.dispatch()` 之后才 `notify()`），
       点击那一刻 React 手上仍是旧 `tagIds`，重渲染把 DOM 勾选态按回去 ⇒
       Playwright 报 `Clicking the checkbox did not change its state`（**假红**：op 已派发）。
       判据要看的是**结果**（行上真长出了 chip），不是控件此刻的勾选态。 */
    await pane
      .getByRole('checkbox', { name: '给任务「整理甲」加上或去掉标签「整理标签一」' })
      .click();
    const chips = rowItemOf(page, '整理甲').getByTestId('task-chip-tag');
    await expect(chips, '栏里勾了标签，行上却没画出 chip ⇒ 显示被搬走了').toHaveCount(1);
    await expect(chips, 'chip 上没写标签名').toContainText('整理标签一');
    // 🔴 chip 是显示不是第二个编辑器：chip 那一块里不许长出下拉/复选框/展开机关。
    await expect(chips.locator('select, input, details'), '行上那枚 chip 里长出了控件').toHaveCount(0);

    await select.scrollIntoViewIfNeeded();
    await page.screenshot({ path: SHOT('t14-organizer-field-in-column') });

    // ── 刷新后仍在（证明那两次交互真走了一条 op）────────────────────────
    await page.reload();
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    // ⚠️ 选中态**不跨刷新**：不重新点那一行，栏里什么都没有，"没有第二处"会被读成"没有重复"。
    await rowOf(page, '整理甲').click();
    await expect(
      rowOf(page, '整理甲').getByTestId('task-meta'),
      '刷新后归属没了 ⇒ 栏里那次选择没落成 op',
    ).toContainText('整理清单一');
    await expect(
      rowItemOf(page, '整理甲').getByTestId('task-chip-tag'),
      '刷新后标签 chip 没了 ⇒ 栏里那次勾选没落成 op',
    ).toHaveCount(1);
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });

  test('T15 窄档：那一栏整个不在，整理的编辑入口回到行尾那颗触发器', async ({ page }) => {
    const errors = watchErrors(page);
    // 🔴 900 宽恒窄档（`DETAIL_FITS_QUERY` 要 ≥1024）：这一档量的是回落，不是栏。
    await page.setViewportSize({ width: 900, height: 600 });
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await addTaskAndRelease(page, '整理窄档乙');
    await seedListAndTag(page, '整理清单乙', '整理标签乙');

    await expect(paneInColumn(page), '窄档却画出了详情栏').toHaveCount(0);
    // 🔴 窄档要量的东西**全在行尾**（触发器、`<details>` 里的下拉与复选框、chip），
    //    所以这一档从头到尾用整行 `task-item-*`（见上面 `rowItemOf` 的注释）。
    const row = rowItemOf(page, '整理窄档乙');
    const summary = row.getByTestId('task-organize-summary');
    await expect(summary, '窄档行尾没有整理入口 ⇒ 回落丢了，这一档根本归不了类').toHaveCount(1);
    /* 🔴 阈值从**触发器自己画的那枚图标**推导，不是我挑的字面量。
       `TaskOrganizer` 的 summary 里只有 `<SlidersHorizontal size={TRIGGER_ICON_SIZE}/>`。
       这一档实测触发器的框是 **16.9375px**（行尾并排六格把它挤窄，是既有形状）。
       原来这里写的是 `> 20` —— 那是**我猜的**，于是把"当前形状"读成了"回落坏了"，
       一条猜出来的阈值比没有阈值更容易骗人（它看起来像在量东西）。
       "不许裁掉自己的图标"这条同时有牙：挤到 0 宽时触发器先过不了 `paintedBox`，
       比图标窄时这一行直接红。图标的框由同一个探针当场量，不写死。 */
    const iconBox = await paintedBox(page, summary.locator('svg'));
    const box = await paintedBox(page, summary);
    expect(box.width, '行尾触发器比它自己的图标还窄 ⇒ 图标被裁掉了').toBeGreaterThanOrEqual(
      iconBox.width,
    );

    await summary.click();
    // 🔴 窄档整页也只许一份编辑本体（这一档它是从 `<details>` 里出来的，不是栏里那一份）。
    await expect(
      page.getByTestId('organize-project-select'),
      '窄档出现了两份清单下拉（行尾 + 栏里）',
    ).toHaveCount(1);
    await row.getByLabel('任务「整理窄档乙」所属清单').selectOption({ label: '整理清单乙' });
    await expect(
      row.getByTestId('task-meta'),
      '窄档选了清单而行上没写',
    ).toContainText('整理清单乙');
    await row
      .getByRole('checkbox', { name: '给任务「整理窄档乙」加上或去掉标签「整理标签乙」' })
      .click();
    await expect(row.getByTestId('task-chip-tag'), '窄档勾了标签而 chip 没画出来').toHaveCount(1);

    await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: SHOT('t15-narrow-organizer-falls-back-to-row') });

    await page.reload();
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await expect(
      rowOf(page, '整理窄档乙').getByTestId('task-meta'),
      '窄档那次选择没落成（刷新后行上读不到归属）',
    ).toContainText('整理清单乙');
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });
});
