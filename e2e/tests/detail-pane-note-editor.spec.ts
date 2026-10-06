/**
 * 便签编辑卡落进详情列（工单 §8.130 / C1 拍板 #1 的第一格内容）
 * ============================================================
 *
 * 拍板 #1 是"选中某条 = **同一格**换成该实体的面单，不另开第三处"。
 * 这一份验的就是那句话在**真实布局里**成立 —— 而不是只在 jsdom 里成立。
 *
 * 🔴 为什么这一层不能省（`note-editor-placement.spec.tsx` 已经把规则量过了）：
 * 那一层量的是"开关对不对"，这一层量的是"开关接上的那支**画不画得出来**"。
 * 两者唯一的差集是一条 CSS 规则 —— 把详情列里的编辑器藏掉（`display:none`），
 * jsdom 十二层判据**一条都不会红**（它不加载应用的 CSS bundle，也不跑布局），
 * 而用户看到的是"点了便签，右边那一栏什么都没有"。
 * 所以本文件配了一臂专门改 CSS（`mutate-detail-pane-note-editor-e2e.mjs`），
 * 它的存在就是为了证明这一层不是装饰。
 *
 * 🔴 承重的两条是 N4：
 * ① 栏放不下时编辑器**回到板子上方**，而不是留在被 CSS 藏住的那一栏里 ——
 *    后者是"界面不说、数据已进模型"的形状（选中态真的进了 store，用户看不见）；
 * ② 回到宽屏 + 未收起时它又回到栏里 —— 少了这一条，N4 只是"恒走板子上方那支"的恒真读数。
 *
 * ⚠️ 载体是 `vite preview` + `apps/web/dist`（见 `playwright.detail-pane.config.ts` 文件头），
 *    所以改完 `apps/web/src/**` **必须先重打**，否则量的是旧产物（§7 第 27 条那一族）。
 */
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { addNote, openApp, parkCursor, switchView } from './helpers';

const SHOT = (name: string) =>
  fileURLToPath(new URL(`../../apps/web/evidence/detail-pane-note-editor/${name}.png`, import.meta.url));

/** 控制台错误进断言（§6.2 规定一第 3 条），监听必须在导航之前挂上。 */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));
  return errors;
}

/**
 * 编辑器**整机计数** —— 这是本文件的承重探针。
 *
 * 🔴 用 `page.getByTestId` 而不是某个容器里的：判据要问的是"整个界面有几枚编辑器"，
 * 限定到 `.ht-main` 或 `detail-column` 就只是"这一支有没有"，
 * 而"两支同时渲染"（最坏的那一份实现）在两个局部读数上都是 1。
 */
const editorEverywhere = (page: Page): Locator => page.getByTestId('notes-editor');
const editorInColumn = (page: Page): Locator =>
  page.getByTestId('detail-column').getByTestId('notes-editor');
const editorInMain = (page: Page): Locator => page.locator('.ht-main').getByTestId('notes-editor');
const editorInput = (page: Page): Locator => page.getByTestId('notes-editor-input');

/** 打开第 `i` 张便签（点它自己的摘要，真点击 ⇒ 真 `selection.select`）。返回那条便签的 id。 */
async function openNthNote(page: Page, i: number): Promise<string> {
  const target = page.locator('[data-testid^="note-edit-"]').nth(i);
  const testId = await target.getAttribute('data-testid');
  expect(testId, '便签板上没有那一张卡（数据没灌进去）').not.toBeNull();
  const id = (testId as string).replace(/^note-edit-/, '');
  await target.click();
  await expect(editorEverywhere(page), `点了第 ${String(i + 1)} 张却没开面单`).toHaveCount(1);
  return id;
}

/** 元素**真实画得出来**吗（`toBeVisible` 的等价量，但顺带把尺寸拿回来做几何判据）。 */
async function paintedBox(page: Page, locator: Locator) {
  await expect(locator, '界面上找不到这个元素').toBeVisible();
  const box = await locator.boundingBox();
  expect(box, '元素"可见"却量不到 boundingBox').not.toBeNull();
  return box as { x: number; y: number; width: number; height: number };
}

/**
 * 面单与板子的**堆叠方向**（回落那一支的可见形状）。
 *
 * 🔴 为什么需要它：`editorInMain` 那条只回答"在不在中间那一列里"，答不出"在板子的哪一边"。
 * 实测（N5 那张图）收起详情列之后，面单落到了板子**右边**而不是上方 —— 计数判据全绿，
 * 而"回到板子上方"这句 DoD 已经不成立。断言只验"有什么"，不验"少了什么 / 位置对不对"，
 * 就会漏掉这一类（与工单 §8.125 记的 W5 那条"15 条断言全绿但少了一行日期"同族）。
 */
async function stackDiagnostics(page: Page): Promise<{
  editor: { x: number; y: number; width: number; height: number };
  board: { x: number; y: number; width: number; height: number };
  text: string;
}> {
  const editor = await paintedBox(page, page.getByTestId('notes-editor'));
  const board = await paintedBox(page, page.getByTestId('notes-board'));
  const chain = await page
    .getByTestId('notes-editor')
    .evaluate((el) => {
      const parts: string[] = [];
      let node: HTMLElement | null = el as HTMLElement;
      while (node !== null && parts.length < 6) {
        parts.push(`${node.tagName.toLowerCase()}.${node.className}`);
        node = node.parentElement;
      }
      return parts.join(' < ');
    });
  return {
    editor,
    board,
    text: `editor=${JSON.stringify(editor)} board=${JSON.stringify(board)} 祖先链=${chain}`,
  };
}

/** 那一栏**被 CSS 藏住了**吗（N4 的前提自检，见下面用法处的注释）。 */
async function columnDisplay(page: Page): Promise<string> {
  const value = await page
    .getByTestId('detail-column')
    .evaluate((el) => getComputedStyle(el).display);
  return value;
}

/**
 * 把某个 CSS 变量的**实际像素值**量出来（不抄 rem→px 字面量）。
 *
 * 🔴 沿用 `detail-column-slot.spec.ts` 的同一做法：阈值要从被约束的常量推导（§7 元规则 2）。
 * 这里要它是因为"面单里的控件离列边留了多少"的合格线就是 `--ht-space-4` 本身 ——
 * 抄一个 `8` 进来，改 token 的人不会被告知这里有一条判据在等他对齐。
 */
async function pxOfCssVar(page: Page, name: string): Promise<number> {
  return page.evaluate((varName) => {
    const probe = document.createElement('div');
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.inlineSize = `var(${varName})`;
    document.body.appendChild(probe);
    const px = probe.getBoundingClientRect().width;
    probe.remove();
    return px;
  }, name);
}

test.describe('便签面单落进详情列', () => {
  test('N1 宽屏：面单在那一栏里、画得出来，且整机只有这一枚', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '便签');
    await addNote(page, '落点甲');
    await addNote(page, '落点乙');

    // 前提：选中还没发生 ⇒ 哪儿都不该有面单（不是一枚空面板占着栏位）。
    await expect(
      editorEverywhere(page),
      '刚进便签视图就有编辑器：选中还没发生',
    ).toHaveCount(0);

    await openNthNote(page, 0);

    // ── 落点：那一栏里 ────────────────────────────────────────────
    await expect(editorInColumn(page), '详情列里没有面单').toHaveCount(1);
    await expect(editorInMain(page), '板子上方那枚没让位（两处都有 = 第三处）').toHaveCount(0);
    await expect(editorEverywhere(page), '整机不止一枚编辑器').toHaveCount(1);

    // ── 真实几何：它在那一栏的矩形里，且那一栏在右边 ─────────────────
    const column = await paintedBox(page, page.getByTestId('detail-column'));
    const editor = await paintedBox(page, editorInColumn(page));
    expect(editor.x, '编辑器不在详情列的横向范围内').toBeGreaterThanOrEqual(column.x - 1);
    expect(editor.x + editor.width).toBeLessThanOrEqual(column.x + column.width + 1);
    // 分母自检：量出来的是一枚**有尺寸的**编辑器，不是 0×0 的被压扁的盒子。
    expect(editor.width, '编辑器宽为 0 量级 —— 栏里的面单被挤没了').toBeGreaterThan(100);
    expect(editor.height).toBeGreaterThan(40);

    /* 🔴 面单里的**每一格控件**都要带着栏内间距落在这栏内（看图时照出来的：保存按钮的右半边
       被窗口边缘切掉了 —— 断言全绿，因为前面只量了外层容器）。
       这一条钉的是"装进详情列"这件事的**内容侧后果**：共享 `NoteEditor` 原来只出现在
       中间那一列（宽度有余），换进 22rem 的栏里就顶到了栏边。
       只断外层容器在栏内 = 只证明"盒子在那儿"，不证明"里面的东西点得到、看得全"。 */
    const inset = await pxOfCssVar(page, '--ht-space-4');
    expect(inset, '栏内间距 token 量为 0，下面的判据会退化成"只要不出栏就算对"').toBeGreaterThan(0);
    for (const testId of ['notes-editor-input', 'notes-editor-save', 'notes-editor-cancel']) {
      const part = await paintedBox(page, page.getByTestId(testId));
      expect(
        part.x + part.width,
        `${testId} 的右边缘 ${String(part.x + part.width)} 离列右边缘 ${String(
          column.x + column.width,
        )} 不足 ${String(inset)}px —— 它贴住了窗口边，圆角被切`,
      ).toBeLessThanOrEqual(column.x + column.width - inset + 1);
      expect(
        part.x,
        `${testId} 的左边缘 ${String(part.x)} 没留出栏内间距（列左边缘 ${String(column.x)}）`,
      ).toBeGreaterThanOrEqual(column.x + inset - 1);
    }

    await parkCursor(page);
    await page.screenshot({ path: SHOT('n1-wide-in-column') });
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });

  test('N2 用的还是 W2 那根列，不是新铸一个槽位', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '便签');
    await addNote(page, '槽位唯一甲');

    // 槽位计数：**未选中**时就是 1 枚。少了这一步，下面那句"选中后仍是 1 枚"
    // 挡不住"原来有 2 枚、选中时藏掉一枚"。
    expect(await page.locator('.ht-app__detail').count(), '壳里不止一根详情列').toBe(1);

    await openNthNote(page, 0);
    expect(await page.locator('.ht-app__detail').count(), '打开面单时多出一根详情列').toBe(1);

    // 面单挂在那唯一一根里（`closest` 比的是**同一个节点**，不是"都有这个类名"）。
    const sameNode = await page
      .getByTestId('notes-editor')
      .evaluate((el) => el.closest('.ht-app__detail') === document.querySelector('.ht-app__detail'));
    expect(sameNode, '面单不在 W2 交付的那根列里').toBe(true);

    // 结构身份：那一栏仍是 `.ht-app` 的直接子项（搬进 `.ht-content` 就变成"中间一坨再分栏"，
    // 这是 W2 的右边缘判据，面单落地不该把它弄坏）。
    const parentClass = await page
      .getByTestId('detail-column')
      .evaluate((el) => el.parentElement?.className ?? '');
    expect(parentClass, '详情列不是 .ht-app 的直接子项').toContain('ht-app');

    // 关掉面单（取消 = 真点界面，不是往 store 里塞值）后槽位还在、面单为零。
    await page.getByTestId('notes-editor-cancel').click();
    await expect(editorEverywhere(page), '取消后面单没收').toHaveCount(0);
    /* 🔴 工单 H10 第一刀改了**这里的形状**，没改它判的那件事。
       收掉面单之后那一格没东西可画 ⇒ 按新决定轨道归零、`display:none`（产品负责人
       2026-10-06 第 5 条「数据侧边栏和那个侧边栏，哪有这么排版的？」）。
       所以"槽位还在"不能再由 `toBeVisible()` 回答 —— 它今天为假，而且**应该**为假。
       替代它的是两条更强的：节点计数仍为 1，且再选一张便签时面单回到**同一个节点**
       （"新铸一根列、把旧的藏起来"这个坏形状在可见性上完全看不出来）。 */
    await expect(page.getByTestId('detail-column'), '收掉面单后那一格不再占位（H10 的决定）').toBeHidden();
    expect(await page.locator('.ht-app__detail').count(), '收掉面单后多出/少了一根列').toBe(1);

    await openNthNote(page, 0);
    expect(await page.locator('.ht-app__detail').count(), '重开面单时多出/少了一根列').toBe(1);
    const backSameNode = await page
      .getByTestId('notes-editor')
      .evaluate((el) => el.closest('.ht-app__detail') === document.querySelector('.ht-app__detail'));
    expect(backSameNode, '面单回来时不住在原来那根列里（= 新铸了槽位）').toBe(true);

    await parkCursor(page);
    await page.screenshot({ path: SHOT('n2-same-slot') });
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });

  test('N3 ↑↓ 换选中时，栏里的面单跟着换（W1b 第 2 条腿的浏览器半边）', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '便签');
    await addNote(page, '跟随甲');
    await addNote(page, '跟随乙');

    /* 🔴 期望值**从被点那一张自己的摘要读**，不写"第 i 张 = 第 i 个建的"。
       第一版这里写的就是后者，它红了：`note-edit-` 的第 0 张里是「跟随乙」。
       便签板按自己的规则排序（不是添加顺序），所以"第几张"是一个探针自己造的假设，
       不是界面给的事实（§7 元规则 1）。K8 早就是读行自己的摘要，这里同一口径。 */
    const excerptAt = async (i: number): Promise<string> => {
      const text = await page.locator('[data-testid^="note-edit-"]').nth(i).textContent();
      return (text ?? '').replace(/…$/, '').trim();
    };
    expect(
      await page.locator('[data-testid^="note-edit-"]').count(),
      '便签板没渲染出两张卡（数据没灌进去，这条判据量不到东西）',
    ).toBe(2);
    // 🔴 期望值**先取成字符串**再用：第一版直接把 `excerptAt(0)`（一个 Promise）交给
    // `startsWith`，它被 coerce 成 `"[object Promise]"` ⇒ 恒 false，而错误信息里我把同一个
    // 值 `await` 了再打印，读起来像"两边明明一样"（§7 那一族"空/怪读数先怀疑探针"）。
    const ex0 = await excerptAt(0);
    const ex1 = await excerptAt(1);
    expect(
      ex0 !== ex1 && ex0.length > 0 && ex1.length > 0,
      `两张卡的摘要相同或为空，↓ 的判据分不开它们：${JSON.stringify([ex0, ex1])}`,
    ).toBe(true);

    await openNthNote(page, 0);
    // 焦点交回页面（同 K7：不 blur 的话 ↓ 落在编辑器自己的光标上）。
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    const first = await editorInput(page).inputValue();
    expect(
      first.startsWith(ex0),
      `面单不是被点那一张（面单 ${JSON.stringify(first)} / 第 0 张 ${JSON.stringify(ex0)}）`,
    ).toBe(true);

    await page.locator('body').press('ArrowDown');
    const second = await editorInput(page).inputValue();
    expect(
      second !== first && second.startsWith(ex1),
      `↓ 之后栏里的面单没跟着换到下一张（${JSON.stringify(first)} → ${JSON.stringify(second)} / 第 1 张 ${JSON.stringify(ex1)}）`,
    ).toBe(true);
    // 🔴 换的是**内容**，不是"多开一枚"：落点与计数都不许变。
    await expect(editorInColumn(page), '换选中后面单不在栏里了').toHaveCount(1);
    await expect(editorEverywhere(page), '换选中时多出一枚编辑器').toHaveCount(1);

    await page.locator('body').press('ArrowUp');
    expect(await editorInput(page).inputValue(), '↑ 之后面单没回到上一张').toBe(first);

    await parkCursor(page);
    await page.screenshot({ path: SHOT('n3-follows-cursor') });
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });

  test('N4 栏放不下时回到板子上方 —— 不是留在被 CSS 藏住的那一栏里', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '便签');
    await addNote(page, '回落甲');
    await addNote(page, '回落乙');

    // ── 腿 ①：窄的那一档（900px 宽 ⇒ 详情列本来就不出现）───────────────
    await page.setViewportSize({ width: 900, height: 800 });
    await expect(page.getByTestId('detail-column'), '900px 档里详情列仍在').toBeHidden();
    // 🔴 前提自检：这一档必须是**CSS 藏住**（display:none）而不是"根本没渲染"。
    // 不是的话，下面那句"面单不在栏里"就只是"栏目里什么都没有"的恒真读数 ——
    // 而这正是本条要抓的那一份错误实现（编辑器挂在一根看不见的栏里）。
    expect(await columnDisplay(page), '900px 档的详情列不是 display:none，前提变了').toBe('none');

    await openNthNote(page, 0);
    await expect(editorInColumn(page), '面单挂在了那栏里 —— 900px 档它是 CSS 藏着的，用户看不见').toHaveCount(
      0,
    );
    await expect(editorInMain(page), '面单没回到板子上方').toHaveCount(1);
    await expect(editorEverywhere(page), '回落时不止一枚编辑器').toHaveCount(1);
    // 真画得出来（`toBeVisible` 会因 display:none / 0 尺寸而红 —— 这就是"藏在 CSS 里"的抓法）。
    const fallback = await paintedBox(page, editorInMain(page));
    expect(fallback.width, '板子上方的面单宽为 0 量级').toBeGreaterThan(100);
    {
      const s = await stackDiagnostics(page);
      expect(
        s.editor.y + s.editor.height,
        `900px 档回落后面单不在板子上方：${s.text}`,
      ).toBeLessThanOrEqual(s.board.y + 1);
    }
    await parkCursor(page);
    await page.screenshot({ path: SHOT('n4-narrow-above-board') });

    // ── 腿 ②：回到宽屏，面单必须又回栏里（正向对照）────────────────────
    // 🔴 少了这一条，上面那三条只是"恒走板子上方"的恒真读数。
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByTestId('detail-column'), '回到宽屏后详情列没回来').toBeVisible();
    await expect(editorInColumn(page), '回到宽屏后面单没跟着回栏里').toHaveCount(1);
    await expect(editorInMain(page), '回到宽屏后板子上方还留着一枚').toHaveCount(0);

    await parkCursor(page);
    await page.screenshot({ path: SHOT('n4-back-to-column') });
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });

  test('N5 用户主动收起那一栏 ⇒ 面单也回板子上方（收起是另一个输入，不是几何）', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '便签');
    await addNote(page, '收起甲');

    await openNthNote(page, 0);
    await expect(editorInColumn(page), '宽屏时面单不在栏里（前提不成立，下面那句没有对照）').toHaveCount(1);

    await page.getByTestId('detail-pane-toggle').click();
    await expect(page.getByTestId('detail-column'), '点了收起但那一栏还在').toBeHidden();
    // 收起之后**不是**"面单跟着消失"：选中还在，面单必须换个地方继续看得见。
    await expect(editorInColumn(page), '收起后面单仍留在被藏住的栏里').toHaveCount(0);
    await expect(editorInMain(page), '收起后面单没回板子上方（选中被吞了）').toHaveCount(1);
    const shown = await editorInput(page).inputValue();
    expect(shown, '回落后面单是空的（正文丢了）').toContain('收起甲');
    {
      const s = await stackDiagnostics(page);
      expect(
        s.editor.y + s.editor.height,
        `收起那一栏后面单不在板子上方：${s.text}`,
      ).toBeLessThanOrEqual(s.board.y + 1);
    }
    /* 🔴 截图**就在这一帧**拍。第一版把它留在用例末尾（"再展开"之后），于是
       `n5-collapsed-above-board.png` 里装的是**展开态**：名字说的是收起，画的是栏还在。
       人看图时读到的是"面单怎么跑到右边去了"—— 而那是一个文件名造成的误读，
       不是界面缺陷（探针的标签与它采的那一帧必须对上，同 §7 那一族"先怀疑探针"）。 */
    await parkCursor(page);
    await page.screenshot({ path: SHOT('n5-collapsed-above-board') });

    await page.getByTestId('detail-pane-toggle').click();
    await expect(editorInColumn(page), '再展开后面单没回栏里').toHaveCount(1);
    await expect(editorInMain(page), '再展开后板子上方还留着一枚').toHaveCount(0);

    await parkCursor(page);
    await page.screenshot({ path: SHOT('n5-reexpanded-in-column') });
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });
});
