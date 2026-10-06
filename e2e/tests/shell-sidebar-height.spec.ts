/**
 * 侧栏收放不许把主区内容从指针底下挪走（工单 H9 第二刀，web 端）
 * =================================================================
 *
 * 成因、四次探针的原始数字与归因二分全在 `BLOCKED.md` **B94** §3，一句话版本：
 * 侧栏那个"新建清单"的**内联表单在"面板外一次 pointerdown"上整块收起 52px**
 * （收起逻辑在 `ProjectsPanel.tsx` 的捕获监听里，**不是失焦** —— 那边写清了为什么不挂 `blur`），
 * 而这一列以前是**整篇文档最高的那一栏**
 * ⇒ 文档矮 52px ⇒ 浏览器把 `scrollY` 夹到新的最大值 ⇒ 任务行在**静止的指针底下**跳 52px ⇒
 * `mousedown` 与 `mouseup` 落在不同元素上 ⇒ `click` 的 target 变成共同祖先、
 * `<details>` 的 `toggle` 一次都没发生。**用户看到的是"第一下点击没有反应"。**
 *
 * 修法不是给表单加延迟，而是把这一列变成**有界**的（`sidebar.css` 的 `.ht-sidebar`，
 * 形状照日历线已经踩过的 `.ht-sidebar--calendar`）：列自己 `position: sticky` + `max-block-size: 100dvh`，
 * 滚动交给里面那一层 `.ht-sidebar__body`，而右边缘那枚 `SidebarResizer` **留在滚动层外面**
 * （在里面会被 `overflow-x: clip` 裁掉半个命中带 —— 那是日历线写下来的第二条后果）。
 *
 * X1 🔴 **真手势**：内联表单展开着 → 页面滚到底 → 在**最靠下那一行**行尾的整理触发器上按下并松开 →
 *    那一下必须**打开**编辑器。这一条钉的是用户要的结果，不是 CSS 属性。
 *    它另外量/断四件事，缺一条这一条就会变成装饰（第一版臂台就是这么照出来的）：
 *      · 前提一：文档必须比视口高；
 *      · 前提二：`scrollY` 必须停在最大值上 —— 否则文档变矮时夹不到它，那一跳**不会发生**；
 *      · 机制：按下之后、松开之前，`documentElement.scrollHeight` 不许变（这一列不许替整篇文档定高度）；
 *      · 症状：同一瞬间，那一行的 y 不许变。
 *    ⚠️ 快照必须在 down 与 up **之间**取：松开之后编辑器自己会撑高，那时候再比就把两种效应混成一格。
 * X2 拖拽把手的**几何**：它必须在滚动层外面，且中心点反查命中的是它自己
 *    （把它搬进滚动层 ⇒ `overflow-x: clip` 裁掉半个命中带 ⇒ "在那儿、拖不动"）。
 *
 * ⚠️ 载体：默认那份 `playwright.config.ts`（vite **dev**，改 `apps/web/src/**` 不用重打）。
 *    跑法（仓库根）：`cd e2e && npx playwright test tests/shell-sidebar-height.spec.ts`
 */
import { fileURLToPath } from 'node:url';

import { expect, test, type Locator, type Page } from '@playwright/test';

import { addTask, openApp, rowFor } from './helpers';

const SHOT = (name: string) =>
  fileURLToPath(new URL(`../../apps/web/evidence/shell-sidebar-height/${name}.png`, import.meta.url));

test.use({ viewport: { width: 900, height: 600 } });

function rowOf(page: Page, title: string): Locator {
  return rowFor(page, title);
}

/** 视口里**最靠下**的那一行的标题。
 *
 * 为什么要挑它而不是"我最后建的那条"：B94 的症状要 `scrollY` 停在最大值上才会出现
 * （文档矮 52px ⇒ 浏览器把 `scrollY` 夹到新最大值 ⇒ 行在静止的指针底下跳）。
 * 只有最靠下的那一行能保证它。而行序由产品排序决定，不写死。
 */
async function bottomRowTitle(page: Page, titles: readonly string[]): Promise<string> {
  let best = '';
  let bestBottom = Number.NEGATIVE_INFINITY;
  for (const title of titles) {
    const box = await rowOf(page, title).boundingBox();
    if (box && box.y + box.height > bestBottom) {
      bestBottom = box.y + box.height;
      best = title;
    }
  }
  expect(best, `${titles.length} 行任务一行都没量到 ⇒ 主区没画出来，这一条没有基准`).not.toBe('');
  return best;
}

/** 整篇文档的高度、视口高、当前 `scrollY`，加某一行的视口坐标 —— 这几枚一起看才知道"是谁在替谁撑高度"。 */
async function measure(page: Page, title: string) {
  const box = await rowOf(page, title).boundingBox();
  const geom = await page.evaluate(() => ({
    docH: document.documentElement.scrollHeight,
    vh: window.innerHeight,
    scrollY: Math.round(window.scrollY),
  }));
  return { y: box ? Math.round(box.y) : null, h: box ? Math.round(box.height) : null, ...geom };
}

test.describe('侧栏不许把主区顶得跳起来（H9 第二刀）', () => {
  test('X1 内联表单展开着、页面滚到底时，行尾触发器的**第一下**点击就要打开编辑器', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    await openApp(page, '/?lang=zh-CN');

    /**
     * 🔴 这份夹具必须**同时**满足两件事，否则 X1 会"绿得没有内容"（臂台实测到第一种）：
     *
     *   1. **主区比视口高** ⇒ 修好之后文档仍然要滚（否则下面两条前提在修好的形态里不成立，
     *      这一条会退化成"什么都不量"）；
     *   2. **坏形态里侧栏是那"最高的一栏"** ⇒ 内联表单收起 52px 才会改变整篇文档的高度，
     *      `scrollY` 才会被夹，那一行才会在指针底下跳。
     *
     * 只有几条任务时主区太矮，坏形态里"文档高度由侧栏给"这一半成立、但页面不滚 ⇒ 跳不动；
     * 侧栏内容太少时反过来：修好的形态里文档不滚。所以两边都要**堆够**：
     * 清单行把侧栏撑高（坏形态里它最高），任务行把主区撑过一屏（修好之后它最高）。
     */
    const LIST_COUNT = 8;
    const TASK_COUNT = 8;
    const sidebar = page.locator('aside[aria-label="清单与标签"]');
    await expect(sidebar, '侧栏没画出来 ⇒ 连清单都建不了，这一条没有基准').toBeVisible();
    // 🔴 「新建清单」的表单**建完不收起**（`ProjectsPanel.tsx` 里"连建几条清单是常态"那条注释），
    //   而再点一次「新建清单」是 **toggle**（会把它关掉，`fill` 就解析到 0 个元素而超时）。
    //   所以：只点一次展开，然后连填连提交。
    await sidebar.getByLabel('新建清单').click();
    for (let i = 0; i < LIST_COUNT; i++) {
      await sidebar.getByLabel('新清单名称').fill(`侧栏高度乙清单${String(i)}`);
      await sidebar.getByLabel('添加清单').click();
    }

    const titles: string[] = [];
    for (let i = 0; i < TASK_COUNT; i++) {
      const title = `侧栏高度乙${String(i)}`;
      titles.push(title);
      await addTask(page, title);
    }
    const target = await bottomRowTitle(page, titles);

    // 🔴 触发条件：内联表单必须**还展开着**（收起的触发是"面板外一次 pointerdown"，不是失焦 ——
    //   见 `ProjectsPanel.tsx:107-118` 那段）。不展开的话，下面那一下根本不会收起 52px。
    await expect(
      sidebar.getByLabel('新建清单'),
      '「新建清单」的表单没展开 ⇒ 这一条点下去什么都不会收起，量不到任何东西',
    ).toHaveAttribute('aria-expanded', 'true');

    const trigger = rowOf(page, target).getByTestId('task-organize-summary');

    // 🔴 滚到**最大滚动量**（不是 `scrollIntoViewIfNeeded`：那一行本来就看得见时它一下都不滚，
    //   而 B94 那一跳只在 `scrollY` 停在最大值上才会发生）。人的操作就是这样：先滚到底，再点行尾。
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const before = await measure(page, target);

    /** 🔴 触发条件本身要断言 —— 不许"夹具恰好没把它造出来"悄悄把这条退化成装饰（§7 元规则 2）。 */
    expect(
      before.docH,
      `整篇文档 ${String(before.docH)}px 而视口 ${String(before.vh)}px ⇒ 页面根本不滚，` +
        'B94 那一跳在这份夹具里不可能发生 ⇒ 这一条没在验它声称验的东西',
    ).toBeGreaterThan(before.vh);
    expect(
      before.scrollY,
      `scrollY=${String(before.scrollY)}，离最大值 ${String(before.docH - before.vh)} 还差 ` +
        `${String(before.docH - before.vh - before.scrollY)}px ⇒ 文档变矮时夹不到它，跳不动`,
    ).toBeGreaterThanOrEqual(before.docH - before.vh - 2);

    const box = await trigger.boundingBox();
    expect(box, '量不到行尾触发器 ⇒ 窄档回落没画出来，后面几条没有基准').not.toBeNull();
    expect(
      (box?.y ?? 0) + (box?.height ?? 0),
      `触发器底边在 ${String(Math.round((box?.y ?? 0) + (box?.height ?? 0)))}px，视口只有 ${String(before.vh)}px ⇒ ` +
        '它不在屏幕里，这一条点的是空气',
    ).toBeLessThanOrEqual(before.vh);

    // 🔴 先截图再动手（§6.2 规定一）：这一条坏的时候最需要知道的是"当时那一屏长什么样"。
    await page.screenshot({ path: SHOT('before-first-click') });

    // 真手势：move → down →（量一次）→ up。**不用 `click()`** —— Playwright 会把一次点击重算落点，
    // 而这条要量的恰恰是"按下之后版面自己动了"那一瞬间。
    await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2);
    await page.mouse.down();

    // 🔴 必须在**按下之后、松开之前**取快照：B94 那一跳就发生在这半秒里，而松开之后编辑器自己会撑高，
    //   那时候再比"文档高度没变"就把两种效应混成一格了（探针原始数字见 BLOCKED.md B94 §3 的 AFTERDOWN）。
    const afterDown = await measure(page, target);
    await page.mouse.up();

    await page.screenshot({ path: SHOT('after-first-click') });

    // 存在性判据：编辑器必须**看得见**（不是"在 DOM 里" —— 关着的 `<details>` 里也有它）。
    // 症状排在机制前面：红的时候先看见"点了没反应"，再看见"是谁动了"。
    await expect(
      rowOf(page, target).getByLabel(`任务「${target}」所属清单`),
      '第一下点击没打开整理编辑器 ⇒ 版面在指针底下跳走了（B94 §3）',
    ).toBeVisible();

    expect(
      afterDown.docH,
      `按下那一下整篇文档从 ${String(before.docH)}px 变成 ${String(afterDown.docH)}px ⇒ ` +
        '这一列的高度在替整篇文档定高度（B94 的机制）',
    ).toBe(before.docH);
    expect(
      afterDown.y,
      `按下那一下那一行的 y 从 ${String(before.y)} 变成 ${String(afterDown.y)} ⇒ ` +
        '它在**静止的指针底下**跳了，mouseup 落到别的元素上',
    ).toBe(before.y);

    expect(errors, `界面里有控制台错误：${errors.join(' | ')}`).toEqual([]);
  });

  test('X2 拖拽把手不在侧栏的滚动层里面（在里面会被 overflow-x: clip 裁掉半个命中带）', async ({ page }) => {
    await openApp(page, '/?lang=zh-CN');
    await addTask(page, '侧栏高度丙');

    const handle = page.getByRole('separator');
    await expect(handle, '侧栏右边缘没有把手 ⇒ 这一条没有基准').toHaveCount(1);

    // 结构判据：把手必须是 `.ht-sidebar` 的直接孩子，而**不是**滚动层 `.ht-sidebar__body` 的后代。
    const shape = await handle.evaluate((el) => ({
      parentClass: String(el.parentElement?.className ?? ''),
      insideBody: el.closest('.ht-sidebar__body') !== null,
    }));
    expect(shape.insideBody, '把手被搬进了滚动层 ⇒ 滚一下它就跟着滚走，右边缘没有可拖的地方').toBe(false);
    expect(shape.parentClass, '把手不在 `.ht-sidebar` 那一层').toContain('ht-sidebar');

    // 命中带判据（日历线写下的第二条后果）：把手的框必须**完整**在它那一定位祖先里可见，
    // 不许被祖先的 `overflow` 裁掉。量法：把手中心点反查到的元素就是它自己。
    const hb = await handle.boundingBox();
    expect(hb, '量不到把手').not.toBeNull();
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.classList.contains('ht-sidebar__resizer') ?? false,
      [Math.round((hb?.x ?? 0) + (hb?.width ?? 0) / 2), Math.round((hb?.y ?? 0) + (hb?.height ?? 0) / 2)],
    );
    expect(hit, '把手中心点命中的不是把手 ⇒ 它的命中带被祖先裁掉了（"在那儿、拖不动"）').toBe(true);

    await page.screenshot({ path: SHOT('resizer-hit-box') });
  });
});
