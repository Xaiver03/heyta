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
 *   ① 那一栏**不画**的档（窄窗口）里，字段编辑权**还有没有落点**
 *      （`display:none` 里藏一只编辑器 = 界面不说、模型已变，§8.130 那条同一个形状；
 *      2026-11 行操作重设计之后这个落点是**点行弹出的面单对话框**，不是行尾那颗 chip）—— T4；
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
import { closeTaskDetailIfOpen, openNarrowTaskPane } from './task-detail-entry.js';

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
       🔴 2026-11 行操作 UX 重设计之后，"未选中"这一半的判据**换向了**：
       旧写法钉的是"输入框数 == 任务行数" —— 那时每一行行尾都挂着一颗「备注」chip
       （`<details>` 收着 textarea）接住编辑权，于是"行行有一只输入框"是对的。
       那条模型整个被删掉了（产品负责人：「把所有这种铺开式组件全都删掉，全都收拢进来」）：
       行尾只剩**只读徽标**，字段编辑器只有一处所有者 —— 面单。⇒ 未选中时
       "没有任何人接编辑权"成了**正确状态**，实测（1280×720、一条任务、未选中）
       `task-note-input` = **0**。同一件事的反面照旧要挡，而且现在更严：
       谁再往行里塞第二个编辑器，这条计数立刻不是 0。
       不变量还是那一条：**任何时刻不许两处同时可编辑** —— 只是形状从
       "输入框数 == 行数"变成了"整页最多一只，且它在面单里"。 */
    await expect(paneInColumn(page), '没选中却画了面单').toHaveCount(0);
    await expect(
      page.getByTestId('detail-column').getByTestId('task-note-input'),
      '栏里没画面单，却藏着一只备注框（那正是"编辑权没人接"的反面）',
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid^="task-item-"]:visible'),
      '前提：这一屏只该有一条任务（下面那两条计数说的是"整页"）',
    ).toHaveCount(1);
    await expect(
      fieldEverywhere(page),
      '未选中时整页出现了备注编辑器 —— 行尾又长回第二个所有者了',
    ).toHaveCount(0);

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

  test('🔴 T4 窄档（栏不出现）⇒ 点行弹出面单对话框，备注编辑器在里面且真画得出来', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await addTaskAndRelease(page, '窄档回落甲');
    await page.setViewportSize({ width: 900, height: 600 });

    // 栏这一支整个不画（`taskPaneInColumn` 为假），而未选中时**整页零个编辑器**。
    await expect(paneEverywhere(page), '窄档还在往不存在的栏里画面单').toHaveCount(0);
    await expect(
      fieldEverywhere(page),
      '未选中时行里又出现了备注编辑器 ⇒ 行尾长回了第二个所有者',
    ).toHaveCount(0);

    /* 🔴 判据换向（2026-11 行操作重设计）：**旧前提整个消失了**。
       旧写法问的是"行尾那颗 chip 回来了没有"（`openRowTail` + `.ht-note > summary`
       点开那个 `<details>`），因为那一刀之前编辑权确实是行尾接的。
       现在行尾只有只读徽标，窄档的落点是 `openTask` 弹出的面单对话框
       （`WebModalShell` + `task-pane`）—— 于是同一件事改问：**点行 ⇒ 对话框开 ⇒
       备注编辑器在面单里、且真实画得出来**。
       几何判据按面单宽度兜底，不抄字面量：实测（900×600）面单 590 宽、备注框 558 宽
       = 95%，所以 60% 这条线只有"控件被挤扁"才会踩到。 */
    const pane = await openNarrowTaskPane(page, '窄档回落甲');
    const paneBox = await paintedBox(page, pane);
    const field = pane.getByTestId('task-note-input');
    const box = await paintedBox(page, field);
    expect(
      box.width,
      `面单里那只备注框只有 ${String(box.width)}px 宽（面单 ${String(paneBox.width)}px）—— 画不出来`,
    ).toBeGreaterThan(paneBox.width * 0.6);

    await field.fill('窄档也写得进去');
    await releaseFocus(page);
    await expect(field).toHaveValue('窄档也写得进去');

    await parkCursor(page);
    await page.screenshot({ path: SHOT('t4-narrow-note-in-dialog') });

    /* 承重：那一笔要真落成 op。两件事各量一次 ——
       ① 关掉对话框之后行上的**只读徽标**写着刚才那段（列表要能扫一眼看出写过东西，
          与 T1 后半同一个口径）；
       ② 刷新之后重新打开面单，正文还在（本地优先：重放 op，不是内存态）。 */
    await closeTaskDetailIfOpen(page);
    await expect(
      fieldEverywhere(page),
      '关掉面单之后整页仍有备注编辑器 ⇒ 又有一处没被收拢的编辑权',
    ).toHaveCount(0);
    const badge = page.locator('[data-testid^="task-note-badge-"]');
    await expect(badge, '行尾没有备注徽标 ⇒ 列表看不出哪条任务写过备注').toHaveCount(1);
    await expect(badge).toContainText('窄档也写得进去');
    await expect(badge.locator('textarea'), '徽标里长出正文框（那是第二个编辑器）').toHaveCount(0);

    await page.reload();
    await openApp(page);
    await switchView(page, '任务');
    const paneAfter = await openNarrowTaskPane(page, '窄档回落甲');
    await expect(
      paneAfter.getByTestId('task-note-input'),
      '刷新后备注没了 —— 说明那一格写的是本地态，不是 op',
    ).toHaveValue('窄档也写得进去');

    await parkCursor(page);
    await page.screenshot({ path: SHOT('t4-narrow-note-after-reload') });
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
/**
 * 打开「重复」里的**高级**（原始 RRULE 输入框那一格）。
 *
 * 🔴 W6（审计 §4.6）把它收进了 `<details data-testid="task-repeat-advanced">`，
 * **默认折叠** —— 节点在 DOM 里、但画不出来。所以"填得进去"这条判据必须先走
 * 用户真会走的那一步（点开「高级」），不能直接 `fill`：
 * 第一版没点，`fill` 一直在等 "visible, enabled and editable"，报出来的
 * 是 60 秒超时（像"输入框坏了"，其实是"它还没展开"）。
 */
async function openRepeatAdvanced(page: import('@playwright/test').Page): Promise<void> {
  const advanced = page.getByTestId('task-repeat-advanced').first();
  const summary = advanced.locator('summary').first();
  if (await summary.isVisible().catch(() => false)) {
    const open = await advanced.evaluate((el) => (el as HTMLDetailsElement).open).catch(() => false);
    if (!open) await summary.click();
  }
}

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
    await openRepeatAdvanced(page);
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

  test('T7 窄档：那一栏整个不在，重复的编辑入口在点行弹出的面单对话框里', async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 900, height: 600 });
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await addTaskAndRelease(page, '窄档重复甲');

    await expect(paneEverywhere(page), '窄档不该画面单').toHaveCount(0);
    /* 🔴 判据换向（2026-11 行操作重设计）：**旧前提整个消失了**。
       旧写法问"行尾那颗 `task-repeat-summary` 浮层回来了没有"，
       而那颗 `<summary>` 与它所在的 `<details>` 是**行内编辑器时代**的落点
       （`RepeatField` 的注释至今写着"一份实现两个落点"，那两个落点是
       "行尾浮层"与"栏里"—— 前者已被删掉，实测整页 `task-repeat-summary` = 0）。
       同一件事现在是：**点行 ⇒ 对话框开 ⇒ 重复的编辑本体在面单里、真画得出来**。
       实测（900×600）：面单 590 宽，自定义 RRULE 那只框 558×44。 */
    const pane = await openNarrowTaskPane(page, '窄档重复甲');
    const paneBox = await paintedBox(page, pane);
    await expect(pane.getByTestId('task-repeat-custom-input'), '面单里没有重复的编辑本体').toHaveCount(1);
    // ⚠️ 原始 RRULE 框收在「高级」里（W6），默认折叠 ⇒ 判"写不写得进去"必须先展开。
    await openRepeatAdvanced(page);
    const field = pane.getByTestId('task-repeat-custom-input');
    const box = await paintedBox(page, field);
    expect(
      box.width,
      `面单里那只 RRULE 框只有 ${String(box.width)}px 宽（面单 ${String(paneBox.width)}px）—— 画不出来`,
    ).toBeGreaterThan(paneBox.width * 0.6);
    await field.fill('FREQ=MONTHLY;BYMONTHDAY=15');
    await field.press('Enter');

    await closeTaskDetailIfOpen(page);
    const chip = page.getByTestId('task-chip-repeat');
    await expect(chip, '面单里设了重复而行上没有痕迹').toHaveCount(1);
    await expect(chip).toContainText('FREQ=MONTHLY;BYMONTHDAY=15');

    await page.reload();
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await expect(
      page.getByTestId('task-chip-repeat').first(),
      '窄档设的重复规则没落成（刷新后行上没有痕迹）',
    ).toContainText('FREQ=MONTHLY;BYMONTHDAY=15');
    await expect(
      page.getByTestId('task-chip-repeat').first().locator('input, textarea, select, details'),
      '行上那枚重复 chip 里长出可编辑控件（那是第二个编辑器）',
    ).toHaveCount(0);

    // 🔴 截图前把被量的那一行滚进视口：900×600 下 AI 那几块把列表推到首屏之外，
    //   不滚的话这张图里**没有判据量的那一格** —— 而 §6.2 规定一要的是"人看图"，
    //   一张看不见被量对象的图不构成证据（本轮第一版 t7 就是这样，读数绿、图没用）。
    await page.getByTestId('task-chip-repeat').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: SHOT('t7-narrow-repeat-chip-on-row') });
    // 再补一张面单里的那一格（判据量的是"它在面单里"，行上那张图看不见它）。
    await openNarrowTaskPane(page, '窄档重复甲');
    await openRepeatAdvanced(page);
    await page.screenshot({ path: SHOT('t7-narrow-repeat-in-dialog') });
    await parkCursor(page);
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
  /*
   * 🔴 2026-10-17 改**定位精度**（不是改判据）：原来按 `hasText` 找整行，
   * 而这一族里"行里含某个标题"会**过匹配** —— 窄档行尾那颗 `<select>` 会把
   * **别的任务的标题**写进自己的 `option`（`selection-projections.spec.ts` 文件头第 1 条
   * 与 T9 的注释都记着这件事），于是 `.first()` 可能落在**另一行**上；
   * 症状是"窄档行尾没有整理入口"（`task-organize-summary` 数到 **0**），
   * 读起来像"回落坏了"，其实是判据找错了行。
   * ⇒ 改锚到**这一行自己的完成框**（`完成：<title>`，每行唯一、不会被他行的 option 污染）；
   * 断言的对象、阈值、本义全不动。
   */
  const rowItemOf = (page: Page, title: string): Locator =>
    page
      .locator('[data-testid^="task-item-"]')
      .filter({ has: page.getByRole('checkbox', { name: `完成：${title}` }) })
      .first();

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

  test('T9 窄档：那一栏整个不在，子任务的编辑入口在点行弹出的面单对话框里', async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 900, height: 600 });
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await addTask(page, '窄档子任务父');
    await addTaskAndRelease(page, '窄档子任务子');

    await expect(paneEverywhere(page), '窄档不该画面单').toHaveCount(0);
    /* 🔴 判据换向（2026-11 行操作重设计）：**旧前提整个消失了**。
       旧写法走行尾那枚 `<summary>`（`aria-label` = 「把「…」移到别的任务下面」，
       `subtask-trigger-*`）—— 它是行内编辑器时代的入口，实测整页现在数到 **0**。
       旧注释里那一整段"定位要走可访问名、不能 `task-item-*` + `hasText`"的顾虑
       也一起消失：那颗 chip 的 `<select>` 会把**别的任务的标题**写进 `option`，
       而那颗 chip 已经不存在了（`option` 污染源随之消失）。
       同一件事现在是：**点行 ⇒ 对话框开 ⇒ 那只 `<select>` 在面单里、真画得出来**。
       实测（900×600）：面单 590 宽，那只 select 558×44，候选是
       `["（顶级任务）","窄档子任务父"]`。 */
    const pane = await openNarrowTaskPane(page, '窄档子任务子');
    const paneBox = await paintedBox(page, pane);
    const select = pane.locator('[data-testid^="subtask-select-"]').first();
    const box = await paintedBox(page, select);
    expect(
      box.width,
      `面单里那只父任务下拉只有 ${String(box.width)}px 宽（面单 ${String(paneBox.width)}px）—— 画不出来`,
    ).toBeGreaterThan(paneBox.width * 0.6);
    await expect(
      page.locator('[data-testid^="subtask-select-"]'),
      '窄档出现了不止一份子任务下拉 ⇒ 又有一处没被收拢的编辑权',
    ).toHaveCount(1);
    const optionTexts = await select.locator('option').allTextContents();
    expect(optionTexts, '自己出现在候选里').not.toContain('窄档子任务子');
    expect(optionTexts, '合法父没进候选 ⇒ 这一格根本改不了').toContain('窄档子任务父');
    await select.selectOption({ label: '窄档子任务父' });

    await closeTaskDetailIfOpen(page);
    await page.reload();
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    const badge = page.locator('[data-testid^="task-subtask-badge-"]');
    await expect(badge, '窄档那次改父没落成（刷新后行上没有"挂在谁下面"的徽标）').toHaveCount(1);
    await expect(badge).toContainText('窄档子任务父');
    await expect(
      badge.locator('select, details, input, textarea, button'),
      '徽标里长出可编辑控件（那是第二个编辑器）',
    ).toHaveCount(0);

    await badge.scrollIntoViewIfNeeded();
    await page.screenshot({ path: SHOT('t9-narrow-subtask-chip-on-row') });
    const paneAfter = await openNarrowTaskPane(page, '窄档子任务子');
    await expect(
      paneAfter.locator('[data-testid^="subtask-select-"]').first().locator('option:checked'),
      '刷新后面单里选中的不是那个父任务（这一格读回来是空的）',
    ).toHaveText('窄档子任务父');
    await page.screenshot({ path: SHOT('t9-narrow-subtask-in-dialog') });
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

  test('T11 窄档：那一栏整个不在，提醒的编辑入口在点行弹出的面单对话框里', async ({ page }) => {
    const errors = watchErrors(page);
    /* ⚠️ 窄档这里仍用 900×600（与 T7/T9 同档）—— 宽 < 1024 ⇒ 栏不画，见
       `detail-pane-visible.ts` 的 `DETAIL_FITS_QUERY`。旧版用 900×**900** 是因为
       行尾那颗 chip 的面板朝下开、600 高时伸到视口外；那个面板**已经不存在了**
       （见下面那段判据换向），所以高度不必再为它让路。 */
    await page.setViewportSize({ width: 900, height: 600 });
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await addTaskAndRelease(page, '窄档提醒乙');

    await expect(paneEverywhere(page), '窄档不该画面单').toHaveCount(0);
    /* 🔴 判据换向（2026-11 行操作重设计）：**旧前提整个消失了**。
       旧写法走行尾那颗 chip（`aria-label` = 「「窄档提醒乙」的提醒」，
       `details.ht-compose--popover` + `.ht-compose-panel.ht-material`），
       并为此写了一整段几何取证：那颗面板**朝下开**（`position:absolute`），
       900×600 时被一个只有 **90px 高**的分组滚动容器裁掉
       （实测 2026-10-05：容器 top 546 / bottom 636，面板 top 586 / bottom 751，
       按钮 top 664 —— 整颗在容器外，`elementFromPoint` 命中 `.ht-content`），
       所以那一族只能读"入口在不在、写没写进去"，不能读"面板整块看得见"。
       ⇒ 那套几何**在面单里不适用**：面单是对话框里的**流内**内容（实测
       `.ht-material` / `details.ht-compose--popover` 整页都数到 **0**），
       没有朝下开、没有 90px 容器、没有 Portal。那段被裁的截图判据随之删掉。
       保留下来的三条实质判据一条没改口径：**入口在不在、值写没写进去、刷新后行上读得到**。
       实测（900×600）：面单 590 宽，「1 小时后提醒」那枚按钮 111×44。 */
    const pane = await openNarrowTaskPane(page, '窄档提醒乙');
    await expect(
      pane.locator('[data-testid^="reminder-list-"]').first(),
      '面单里没有提醒列表 ⇒ 这一档建不了提醒',
    ).toBeVisible();
    await expect(
      page.locator('details.ht-compose--popover'),
      '行尾又出现了那颗提醒浮层（那会把提醒变成两处可编辑）',
    ).toHaveCount(0);
    const button = pane.getByTestId('reminder-add-absolute');
    const box = await paintedBox(page, button);
    expect(box.width, `面单里那枚「1 小时后提醒」按钮只有 ${String(box.width)}px 宽`).toBeGreaterThan(20);
    // 控件高度一档（AGENTS §5 / ux-principles）：实测 44，与同一栏里其余控件同档。
    expect(box.height, `那枚按钮只有 ${String(box.height)}px 高 —— 低于控件高度那一档`).toBeGreaterThanOrEqual(
      40,
    );
    // 🔴 假绿前提：点**之前**行上不该有提醒徽标（零条提醒时 `ReminderBadge` 不占位）。
    //    少了这一条，"点完长出了徽标"在"它本来就在"的情况下也通过。
    await expect(
      page.locator('[data-testid^="task-reminder-badge-"]'),
      '起始态行上就有提醒徽标 ⇒ 后面那条"长出了"读不出因果',
    ).toHaveCount(0);
    await page.screenshot({ path: SHOT('t11-narrow-reminder-in-dialog') });
    await button.click();

    const badge = page.locator('[data-testid^="task-reminder-badge-"]');
    await expect(badge, '面单里点了「1 小时后提醒」而行上没有痕迹').toHaveCount(1);
    await expect(badge, '行上那枚只读徽标没写条数').toHaveText('1');
    await expect(
      badge.locator('button, details, [data-testid^="reminder-"]'),
      '徽标里长出可编辑控件（那是第二个编辑器）',
    ).toHaveCount(0);

    await closeTaskDetailIfOpen(page);
    await page.reload();
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    const badgeAfter = page.locator('[data-testid^="task-reminder-badge-"]');
    await expect(badgeAfter, '窄档那次点击没落成（刷新后行上没有提醒徽标）').toHaveCount(1);
    await expect(badgeAfter, '刷新后徽标上的条数不对').toHaveText('1');

    await badgeAfter.scrollIntoViewIfNeeded();
    await page.screenshot({ path: SHOT('t11-narrow-reminder-badge-after-reload') });
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

  test('T13 窄档：那一栏整个不在，截止的编辑入口在点行弹出的面单对话框里', async ({ page }) => {
    const errors = watchErrors(page);
    // 900×600 与 T7/T9 同档（宽 < 1024 ⇒ 栏不画）。
    await page.setViewportSize({ width: 900, height: 600 });
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await addTaskAndRelease(page, '窄档截止乙');

    await expect(paneEverywhere(page), '窄档不该画面单').toHaveCount(0);
    /* 🔴 判据换向（2026-11 行操作重设计）：**旧前提整个消失了**。
       旧写法走行尾那颗 `<summary data-testid="due-editor-summary">`
       （`aria-label` = 「设置任务「…」的截止日期」），点开的是一个 Portal + fixed 的
       行尾面板 —— 那两件都是"行尾那一支在哪儿画"的细节，而那一支已被删掉
       （实测整页 `due-editor-summary` = **0**）。
       同一件事现在是：**点行 ⇒ 对话框开 ⇒ 月历在面单里、真画得出来 ⇒ 点一格**。
       面单里的月历是流内内容（与 T12 宽档同一份 `DatePicker`），没有 Portal、不会"一滚就关"。
       实测（900×600）：面单 590 宽，月历 558×487。 */
    const pane = await openNarrowTaskPane(page, '窄档截止乙');
    const paneBox = await paintedBox(page, pane);
    const picker = pane.getByTestId('date-picker');
    await expect(picker, '面单里没有月历 ⇒ 这一档改不了截止').toHaveCount(1);
    const pickBox = await paintedBox(page, picker);
    expect(
      pickBox.width,
      `面单里那张月历只有 ${String(pickBox.width)}px 宽（面单 ${String(paneBox.width)}px）—— 画不出来`,
    ).toBeGreaterThan(paneBox.width * 0.6);
    await expect(
      page.locator('[data-testid="date-picker"]'),
      '窄档整页出现了不止一张月历 ⇒ 又有一处没被收拢的编辑权',
    ).toHaveCount(1);

    const cell = picker.locator('[role="button"][aria-label$="18日"]').first();
    await expect(cell, '窄档面单里应有某月 18 日这格').toBeVisible();
    const dayLabel = (await cell.getAttribute('aria-label'))!;
    const md = /(\d+)月(\d+)日/.exec(dayLabel)!;
    const compact = `${md[1]!.padStart(2, '0')}-${md[2]!.padStart(2, '0')}`;
    await cell.click();
    await expect(
      rowOf(page, '窄档截止乙').getByTestId('task-meta'),
      `窄档点了 ${dayLabel} 而行上没写着 ${compact}`,
    ).toContainText(compact);
    /* 🔴 拍之前把那一行**滚进视野中间**：这一趟没有行尾面板需要收起，但 900×600 下
       列表可能被 AI 那几块推到首屏之外，图里就没有被量的那一行（T7 同一条）。
       不用 `scrollIntoViewIfNeeded()` —— 它只在"完全看不见"时才滚，露出半个什么都不做。 */
    await closeTaskDetailIfOpen(page);
    await rowOf(page, '窄档截止乙').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: SHOT('t13-narrow-due-on-row') });

    await page.reload();
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    /* 🔴 承重判据的载体换了，问的仍是同一件事：**那一笔落成 op 了没有**。
       旧写法读的是"刷新后行尾触发器上没写日期"（`due-editor-summary` 的文本），
       而那颗触发器已经不存在了 —— 截止的**显示**一直在共享元信息条 `task-meta` 上
       （`TaskDetailCard` 与 `DueEditor` 文件头那张表的第三行），刷新后从那里读同一件事。 */
    await expect(
      rowOf(page, '窄档截止乙').getByTestId('task-meta'),
      '窄档那次点击没落成 op（刷新后行上读不到日期）',
    ).toContainText(compact);
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
    await sidebar.locator('#ht-category-create-name').fill(list);
    await sidebar.getByRole('button', { name: '创建清单' }).click();
    await expect(sidebar.locator(`[data-testid^="project-"][data-testid$="-row"]`), `侧栏里没有那条清单「${list}」`).toHaveCount(1);
    await sidebar.getByLabel('新建标签').click();
    await sidebar.locator('#ht-category-create-name').fill(tag);
    await sidebar.getByRole('button', { name: '创建标签' }).click();
    await expect(sidebar.locator(`[data-testid^="tag-"][data-testid$="-row"]`), `侧栏里没有那枚标签「${tag}」`).toHaveCount(1);
  }

  test('T14 宽档：整理的编辑本体在栏里那一格，行尾只剩只读 chip（§8.147）', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await addTaskAndRelease(page, '整理甲');
    await seedListAndTag(page, '整理清单一', '整理标签一');

    /*
     * 🔴 2026-10-17 补一步（**建立前提**，不是修产品）：`seedListAndTag` 会**新建一个清单**，
     * 而新建清单会让侧栏选中它 ⇒ 当前视图被筛到那个**空清单**上。
     * 真浏览器探针（900×600，与 T15 同视口）实测：
     *   `afterSeedList.rowCount = 0`、`afterSeedList.allRows = 0`（一条任务都不在屏上）；
     *   切回「任务」之后 `rowCount = 1` —— 那时判据才问得到那个入口。
     * 也就是说产品这一侧没问题 —— 是判据**在被问到一条不在屏上的行**，
     * 于是 `toHaveCount(1)` 读成 0，消息却说"窄档行尾没有整理入口"（把它读成产品坏了）。
     * ⚠️ 2026-11：那个入口已随行内编辑器整排撤掉、从行尾搬进面单（宽档 = 详情列，
     * 窄档 = 点行弹出的对话框），但"先切回任务视图"这一步仍然必要 ——
     * 它建立的是"那一行在屏上"这个前提，与入口住哪儿无关。
     */
    await switchView(page, '任务');

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

  test('T15 窄档：那一栏整个不在，整理的编辑入口在点行弹出的面单对话框里', async ({ page }) => {
    const errors = watchErrors(page);
    // 🔴 900 宽恒窄档（`DETAIL_FITS_QUERY` 要 ≥1024）：这一档量的是"落在对话框里"，不是栏。
    await page.setViewportSize({ width: 900, height: 600 });
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await addTaskAndRelease(page, '整理窄档乙');
    await seedListAndTag(page, '整理清单乙', '整理标签乙');

    /*
     * 🔴 2026-10-17 补一步（**建立前提**，不是修产品）：`seedListAndTag` 会**新建一个清单**，
     * 而新建清单会让侧栏选中它 ⇒ 当前视图被筛到那个**空清单**上。
     * 真浏览器探针（900×600，与 T15 同视口）实测：
     *   `afterSeedList.rowCount = 0`、`afterSeedList.allRows = 0`（一条任务都不在屏上）；
     *   切回「任务」之后 `rowCount = 1` —— 那时判据才问得到那个入口。
     * 也就是说产品这一侧没问题 —— 是判据**在被问到一条不在屏上的行**，
     * 于是 `toHaveCount(1)` 读成 0，消息却说"窄档行尾没有整理入口"（把它读成产品坏了）。
     * ⚠️ 2026-11：那个入口已随行内编辑器整排撤掉、从行尾搬进面单（宽档 = 详情列，
     * 窄档 = 点行弹出的对话框），但"先切回任务视图"这一步仍然必要 ——
     * 它建立的是"那一行在屏上"这个前提，与入口住哪儿无关。
     */
    await switchView(page, '任务');

    await expect(paneInColumn(page), '窄档却画出了详情栏').toHaveCount(0);
    /* 🔴 判据换向（2026-11 行操作重设计）：**旧前提整个消失了**。
       旧写法走行尾那颗 `task-organize-summary`（一个 `<details>` 的 summary），
       并为它专门写了一段"阈值从触发器自己画的那枚图标推导"的几何（实测 16.9375px）。
       那颗触发器与它所在的 `<details>` 是**行内编辑器时代**的落点，现已删掉
       （实测整页 `task-organize-summary` = **0**）。
       同一件事现在是：**点行 ⇒ 对话框开 ⇒ 清单下拉与标签勾选框在面单里、真画得出来**。
       实测（900×600）：面单 590 宽，清单下拉 558×44。 */
    const pane = await openNarrowTaskPane(page, '整理窄档乙');
    const paneBox = await paintedBox(page, pane);
    const select = pane.getByTestId('organize-project-select');
    await expect(select, '面单里没有清单下拉 ⇒ 这一档归不了类').toHaveCount(1);
    const box = await paintedBox(page, select);
    expect(
      box.width,
      `面单里那只清单下拉只有 ${String(box.width)}px 宽（面单 ${String(paneBox.width)}px）—— 画不出来`,
    ).toBeGreaterThan(paneBox.width * 0.6);
    // 🔴 窄档整页也只许一份编辑本体（只量"面单里有"会把"两处都能编辑"读成对）。
    await expect(
      page.getByTestId('organize-project-select'),
      '窄档出现了两份清单下拉（行尾 + 面单）',
    ).toHaveCount(1);

    // ── 承重 ①：在面单里选清单 ⇒ **行的元信息槽**写着那条清单 ──────────────
    await expect(
      rowOf(page, '整理窄档乙').getByTestId('task-meta'),
      '起始态就带着清单名 ⇒ 后面的断言永真',
    ).not.toContainText('整理清单乙');
    await select.selectOption({ label: '整理清单乙' });
    await expect(
      rowOf(page, '整理窄档乙').getByTestId('task-meta'),
      '窄档选了清单而行上没写',
    ).toContainText('整理清单乙');

    // ── 承重 ②：在面单里勾标签 ⇒ **行上长出那枚只读 chip** ────────────────
    await expect(
      rowItemOf(page, '整理窄档乙').getByTestId('task-chip-tag'),
      '起始态行上就有标签 chip ⇒ 后面那条"长出了"读不出因果',
    ).toHaveCount(0);
    // 🔴 用 `click()` 不用 `check()`：受控复选框 + async `dispatchIntent`
    //    ⇒ Playwright 会报 `Clicking the checkbox did not change its state`（假红，op 已派发）。
    //    判据看的是**结果**（行上真长出了 chip），不是控件此刻的勾选态。
    await pane
      .getByRole('checkbox', { name: '给任务「整理窄档乙」加上或去掉标签「整理标签乙」' })
      .click();
    const chips = rowItemOf(page, '整理窄档乙').getByTestId('task-chip-tag');
    await expect(chips, '窄档勾了标签而 chip 没画出来').toHaveCount(1);
    await expect(chips, 'chip 上没写标签名').toContainText('整理标签乙');
    await expect(chips.locator('select, input, details'), '行上那枚 chip 里长出了控件').toHaveCount(0);

    await page.screenshot({ path: SHOT('t15-narrow-organizer-in-dialog') });

    await closeTaskDetailIfOpen(page);
    await rowItemOf(page, '整理窄档乙').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: SHOT('t15-narrow-organizer-on-row') });

    await page.reload();
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '任务');
    await expect(
      rowOf(page, '整理窄档乙').getByTestId('task-meta'),
      '窄档那次选择没落成（刷新后行上读不到归属）',
    ).toContainText('整理清单乙');
    await expect(
      rowItemOf(page, '整理窄档乙').getByTestId('task-chip-tag'),
      '刷新后标签 chip 没了 ⇒ 面单里那次勾选没落成 op',
    ).toHaveCount(1);
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });
});
