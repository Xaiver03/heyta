/**
 * 任务面单落进详情列那一格（工单 §8.138 / C1 拍板 #1 的任务那一格）
 * ==================================================================
 *
 * 拍板 #1 是"选中某条 = **同一格**换成该实体的面单，不另开第三处"。便签（§8.130）
 * 与习惯（§8.133）之后，任务是本应用**主对象**的那一格 —— 而它此前是空的，
 * 于是那条裁决在它最该成立的地方不成立。§8.130 记下的那道二选一（"行内展开编辑 vs
 * 栏里编辑"）在本单裁成**栏里编辑**，理由与推翻代价写在工单那一节。
 *
 * 🔴 这一层量的是 jsdom 那 7 条**量不到**的四件事：
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

    /* 前提（这一档是**裁决的一部分**，不是漏做）：宽档 + 未选中时栏里没有面单，
       而整页也**没有**备注输入框 —— 行尾那颗 chip 已经让位。用户要写备注就得先选中一条，
       这与滴答/Todoist 的"点一条任务才开 task view"同形。 */
    await expect(paneInColumn(page), '没选中却画了面单').toHaveCount(0);
    await expect(fieldEverywhere(page), '未选中时行尾那颗 chip 还在，两处会同时可编辑').toHaveCount(0);

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
});
