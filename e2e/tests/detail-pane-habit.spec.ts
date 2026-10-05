/**
 * 习惯面单落进详情列（工单 §8.133 / C1 拍板 #1 的第二格内容）
 * ==========================================================
 *
 * 拍板 #1 是"选中某条 = **同一格**换成该实体的面单，不另开第三处"。
 * 便签那一格（§8.130）之后，习惯是第二格 —— 而它是**形状不同的那一格**：
 * 习惯这一面本来就是「列表 + 窗格」两列（产品负责人 2026-10-01 定的），
 * 所以这一单动的是"窗格落在哪一栏"，不是"新增一块面单"。
 *
 * 🔴 为什么这一层不能省（`habits-detail-card.spec.tsx` 已经把落点规则量过了）：
 * jsdom 那 11 条量的是"开关对不对 + 组件画不画得出来"，量不到三件事：
 *   ① 那一栏被 CSS 藏掉时面单**回不回得来**（`display:none` 里的板子 = 界面不说、模型已变）；
 *   ② 面单搬走之后，`.ht-habit` 那根 5fr 轨道有没有**留成一整块空白**（布局只在浏览器里成立）；
 *   ③ 90 天热力图压在 22rem 的栏里**会不会溢出**（板子原来在宽度有余的中间列）。
 * 所以 H4/H1/H5 各挡一件，且每台配了臂（见 `mutate-detail-pane-habit-e2e.mjs`）。
 *
 * ⚠️ 载体是 `vite preview` + `apps/web/dist`（见 `playwright.detail-pane.config.ts` 文件头），
 *    改完 `apps/web/src/**` **必须先重打**，否则量的是旧产物（§7 第 27 条那一族）。
 *
 * ⚠️ 与 `habits-pane.spec.ts` 的分工：那份量的是"列表 + 窗格"这套版式自己的四件事
 *    （两列、塌缩方向、点位颜色、暗色对比度），它落在**回落那一支**；
 *    这一份量的是"窗格换到那一栏之后"的后果。两份都得绿，缺一份就是只验了一支。
 */
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';

import { addHabit, openApp, parkCursor, switchView } from './helpers';

const SHOT = (name: string) =>
  fileURLToPath(new URL(`../../apps/web/evidence/detail-pane-habit/${name}.png`, import.meta.url));

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
 * **整机计数**用的探针 —— 限定到某一个容器就只是"这一支有没有"，
 * 而"两支同时渲染"（最坏的那一份实现）在两个局部读数上都是 1。
 */
const boardEverywhere = (page: Page): Locator => page.getByTestId('habit-board');
const paneEverywhere = (page: Page): Locator => page.getByTestId('habit-pane');
const paneInColumn = (page: Page): Locator => page.getByTestId('detail-column').getByTestId('habit-pane');
const paneInMain = (page: Page): Locator => page.locator('.ht-main').getByTestId('habit-pane');

/** 加一条习惯并把焦点交回页面（新建输入框带着焦点时，方向键归它 —— K2/K6 同一条闸门）。 */
async function addHabitAndRelease(page: Page, name: string): Promise<void> {
  await addHabit(page, name);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
}

/** 按 `aria-current` 找那一行的**行名**（不假设列表顺序）。 */
async function nameOfMarkedRow(page: Page): Promise<string> {
  return page
    .locator('[data-testid^="habit-row-"][aria-current="true"] .ht-habit__name')
    .textContent()
    .then((t) => (t ?? '').trim());
}

/** 元素**真实画得出来**吗（`toBeVisible` 的等价量，顺带把尺寸拿回来做几何判据）。 */
async function paintedBox(page: Page, locator: Locator) {
  await expect(locator, '界面上找不到这个元素').toBeVisible();
  const box = await locator.boundingBox();
  expect(box, '元素"可见"却量不到 boundingBox').not.toBeNull();
  return box as { x: number; y: number; width: number; height: number };
}

/**
 * `.ht-habit` 这一趟**实际用了几根列轨道**（计算值，不是源码里那行声明）。
 *
 * 🔴 为什么不能只读源码：CSSOM 报的是** resolved 值**，`grid-template-columns`
 * 在源码里可以写着两条而实际算出一条（塌缩块覆盖了它）。而这一单最怕的恰好是
 * "面单搬走了、5fr 那根轨道还留着"—— 那在 DOM 上什么都不缺，只有一块空白。
 */
async function gridTrackCount(page: Page): Promise<number> {
  const value = await page
    .locator('.ht-habit')
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns);
  return value.split(' ').filter(Boolean).length;
}

/** 把某个 CSS 变量的**实际像素值**量出来（阈值从被约束的常量推导，不抄字面量）。 */
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

test.describe('习惯面单落进详情列', () => {
  test.use({ viewport: { width: 1280, height: 820 } });

  test('H1 宽屏：面单在那一栏里、画得出来，而内容列没留一根空轨道', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '习惯');
    await addHabitAndRelease(page, '落点甲');
    await addHabitAndRelease(page, '落点乙');

    /* 前提：**没选中**时那一栏里已经挂着面单（板子始终挂载那条不变量），
       而它说的是"选一条习惯"，不是列表里任何一条的名字。 */
    await expect(boardEverywhere(page), '进习惯视图却没有那块板（白屏检测那条判据会瞎）').toHaveCount(1);
    await expect(paneInColumn(page), '未选中时那一栏里没有面单').toHaveCount(1);
    await expect(paneInMain(page), '两支都在渲染 = 第三处').toHaveCount(0);
    await expect(paneEverywhere(page), '整机不止一枚面单').toHaveCount(1);
    await expect(paneInColumn(page)).toContainText('选一条习惯');

    await page.locator('[data-testid^="habit-row-"]').first().click();
    await expect(paneInColumn(page)).not.toContainText('选一条习惯');

    // ── 真实几何 ────────────────────────────────────────────────
    const column = await paintedBox(page, page.getByTestId('detail-column'));
    const pane = await paintedBox(page, paneInColumn(page));
    expect(pane.x, '面单不在详情列的横向范围内').toBeGreaterThanOrEqual(column.x - 1);
    expect(pane.x + pane.width).toBeLessThanOrEqual(column.x + column.width + 1);
    expect(pane.width, '面单宽为 0 量级 —— 栏里的板子被挤没了').toBeGreaterThan(150);

    // 🔴 内容列不许留那根 5fr 空轨道（面单搬走之后清单要铺满）。
    expect(
      await gridTrackCount(page),
      '`.ht-habit` 算出来不止一根轨道 ⇒ 面单走了、5fr 那一格变成一整块空白',
    ).toBe(1);

    /* 面单里的每一格控件都要带着栏内间距落在这栏内（§8.130 看图照出来的那一类：
       只量外层容器 = 只证明"盒子在那儿"，不证明"里面的东西点得到、看得全"）。
       这里挑的是板子里**最宽的三枚**：打卡按钮、卡片本体、热力图网格。 */
    const inset = await pxOfCssVar(page, '--ht-space-4');
    expect(inset, '栏内间距 token 量为 0，下面的判据会退化成"只要不出栏就算对"').toBeGreaterThan(0);
    const habitId = (await page
      .locator('[data-testid^="habit-row-"]')
      .first()
      .getAttribute('data-testid'))?.replace(/^habit-row-/, '');
    expect(habitId, '行上没有 data-testid，探针拿不到 id').not.toBeUndefined();
    // 热力图那一块**没有 testID**（共享层只给它挂了总述的 accessibilityLabel），
    // 所以这里用板子里实际存在的两枚 testID 当控件样本，格子归 H5 逐枚量。
    for (const testId of [`habit-card-${habitId}`, `habit-checkin-${habitId}`]) {
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
    await page.screenshot({ path: SHOT('h1-wide-in-column') });
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });

  test('H2 用的还是 W2 那根列，不是新铸一个槽位', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '习惯');
    await addHabitAndRelease(page, '槽位唯一甲');

    // 槽位计数：未选中时就是 1 枚；少了这一步，"选中后仍是 1 枚"挡不住
    // "原来有 2 枚、选中时藏掉一枚"。
    expect(await page.locator('.ht-app__detail').count(), '壳里不止一根详情列').toBe(1);

    await page.locator('[data-testid^="habit-row-"]').first().click();
    expect(await page.locator('.ht-app__detail').count(), '打开面单时多出一根详情列').toBe(1);

    // `closest` 比的是**同一个节点**，不是"都有这个类名"。
    const sameNode = await page
      .getByTestId('habit-pane')
      .evaluate((el) => el.closest('.ht-app__detail') === document.querySelector('.ht-app__detail'));
    expect(sameNode, '面单不在 W2 交付的那根列里').toBe(true);

    // 结构身份：那一栏仍是 `.ht-app` 的直接子项（搬进 `.ht-content` 就变成"中间一坨再分栏"）。
    const parentClass = await page
      .getByTestId('detail-column')
      .evaluate((el) => el.parentElement?.className ?? '');
    expect(parentClass, '详情列不是 .ht-app 的直接子项').toContain('ht-app');

    await parkCursor(page);
    await page.screenshot({ path: SHOT('h2-same-slot') });
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });

  test('H3 ↓ 换选中时，栏里那一格跟着换人（W1b 第 2 条腿在习惯面的浏览器半边）', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '习惯');
    await addHabitAndRelease(page, '跟随甲');
    await addHabitAndRelease(page, '跟随乙');

    const rows = page.locator('[data-testid^="habit-row-"]');
    expect(
      await rows.count(),
      '习惯列表没渲染出两行（数据没灌进去，这条判据量不到东西）',
    ).toBe(2);

    await rows.first().click();
    const firstName = await nameOfMarkedRow(page);
    expect(firstName, '点完第一行没有一行带 aria-current').not.toBe('');
    const firstId = (await rows.first().getAttribute('data-testid'))?.replace(/^habit-row-/, '');
    await expect(paneInColumn(page).locator(`[data-testid="habit-card-${firstId}"]`)).toHaveCount(1);
    // 🔴 计数只证明"DOM 里有"，不证明"画得出来"（`display:none` 里 `toHaveCount(1)` 照样成立）。
    // 这条与上面那条各挡一份坏：多渲染一枚 / 栏里那一枚被 CSS 藏掉。
    await expect(paneInColumn(page).locator(`[data-testid="habit-card-${firstId}"]`)).toBeVisible();

    // 焦点交回页面：点行之后焦点在那颗行按钮上，↓ 归它还是归光标要能分得开（K6 同一条闸门）。
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await page.locator('body').press('ArrowDown');
    const secondName = await nameOfMarkedRow(page);
    expect(
      secondName !== '' && secondName !== firstName,
      `按 ↓ 之后痕迹没换行（${firstName} → ${secondName}）`,
    ).toBe(true);

    /* 🔴 判据要的是"栏里那一格画的就是**带痕迹那一行**"，比的是 id 而不是文本：
       两条习惯的名字都同时在 DOM 里（列表那一份 + 面单那一份），只断文本会漏。 */
    const markedId = await page
      .locator('[data-testid^="habit-row-"][aria-current="true"]')
      .getAttribute('data-testid');
    await expect(
      paneInColumn(page).locator(`[data-testid="habit-card-${(markedId ?? '').replace(/^habit-row-/, '')}"]`),
      '痕迹在别的行，栏里画的还是旧那条',
    ).toHaveCount(1);
    await expect(boardEverywhere(page), '换选中时多出一块板').toHaveCount(1);
    await expect(paneEverywhere(page), '换选中时多出一枚面单').toHaveCount(1);

    await parkCursor(page);
    await page.screenshot({ path: SHOT('h3-follows-cursor') });
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });

  test('H4 收起那一栏 ⇒ 面单回到列表右边；再展开 ⇒ 回到栏里（两支都真会走）', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '习惯');
    await addHabitAndRelease(page, '收起甲');
    await page.locator('[data-testid^="habit-row-"]').first().click();

    await page.getByTestId('detail-pane-toggle').click();
    await expect(page.getByTestId('detail-column')).toBeHidden();

    // 栏里为零、列表右边恰好一枚 —— 不是"藏在 display:none 的那一栏里"。
    await expect(paneInColumn(page), '收起之后面单还留在那根被藏住的列里').toHaveCount(0);
    await expect(paneInMain(page), '收起之后界面上一枚面单都没有（选中态已进模型、界面无读数）').toHaveCount(1);
    /* 🔴 回落那一支也得**真画得出来**：`toHaveCount(1)` 对 `display:none` 是成立的，
       而"收起后栏里那枚改由 CSS 藏、DOM 不动"恰好是拍板 #1 反对的那个形状。 */
    await expect(paneInMain(page).locator('[data-testid^="habit-card-"]'), '回落那枚画不出卡片').toHaveCount(1);
    await expect(paneInMain(page).locator('[data-testid^="habit-card-"]')).toBeVisible();
    await expect(boardEverywhere(page), '回落那一支少了一块板').toHaveCount(1);

    // 回落那一支的形状 = 这一单之前那两列（清单在左、面单在右）。
    expect(
      await gridTrackCount(page),
      '回落那一支没恢复成两列 ⇒ 塌缩开关把版式也改了（那是 habits-pane.spec 的量程）',
    ).toBe(2);
    const side = await paintedBox(page, page.locator('.ht-habit__side'));
    const pane = await paintedBox(page, paneInMain(page));
    expect(pane.x, '回落的面单不在清单右边').toBeGreaterThanOrEqual(side.x + side.width - 1);

    await parkCursor(page);
    await page.screenshot({ path: SHOT('h4-collapsed-back-to-pane') });

    // 🔴 反方向那条腿：少了它，整个 H4 只是"恒走回落那一支"的恒真读数。
    await page.getByTestId('detail-pane-toggle').click();
    await expect(page.getByTestId('detail-column')).toBeVisible();
    await expect(paneInColumn(page), '重新展开后面单没回到栏里').toHaveCount(1);
    await expect(paneInColumn(page).locator('[data-testid^="habit-card-"]')).toBeVisible();
    await expect(paneInMain(page), '回到栏里之后列表右边那枚没让位').toHaveCount(0);
    await expect(paneEverywhere(page)).toHaveCount(1);

    await parkCursor(page);
    await page.screenshot({ path: SHOT('h4-reexpanded-in-column') });
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });

  test('H5 90 天热力图压在 22rem 的栏里不溢出（面单原来在宽度有余的中间列）', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '习惯');
    await addHabitAndRelease(page, '热力甲');
    await page.locator('[data-testid^="habit-row-"]').first().click();

    const column = await paintedBox(page, page.getByTestId('detail-column'));
    const pane = paneInColumn(page);
    await expect(pane, '栏里找不到习惯面单').toHaveCount(1);
    await expect(pane, '栏里那枚面单没有画出来').toBeVisible();

    /*
      热力图那块**没有 testID**（共享层只给它挂了总述的 `accessibilityLabel`），
      所以这里量的是**每一枚格子**：取所有 `[data-cell-title]` 里最右的那一条边。
      🔴 逐枚取最大值而不是量外层网格盒子：外层盒子可以被 `min-width:0` 夹住而
      里面的格子照样出栏（这一单要挡的正是"格子被切掉一半"那种观感）。

      🔴 必须**只数画得出来的那些格子**：`display:none` 里的元素 `getBoundingClientRect()`
      全是 0，而 `Math.max(...0 数组) = 0` 会**轻松满足**"右边缘不超过列右缘"——
      一条在"整块板子被藏掉"时反而更容易通过的判据等于没有判据（§7 元规则 2）。
      所以这里先断言"前提确实成立"（有画得出来的格子，且它们的右边缘真的落在列内），
      再拿这个最大值去比上界。
    */
    const cells = await pane.evaluate((el) => {
      const list = Array.from(el.querySelectorAll('[data-cell-title]'));
      const painted = list.filter((c) => {
        const r = c.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      const rights = painted.map((c) => c.getBoundingClientRect().right);
      return {
        total: list.length,
        count: painted.length,
        maxRight: rights.length === 0 ? -1 : Math.max(...rights),
      };
    });
    expect(cells.total, '热力图一枚格子都没渲染').toBeGreaterThan(0);
    expect(
      cells.count,
      `热力图 ${String(cells.total)} 枚格子全都没有尺寸（板子没画出来 ⇒ 后面的判据量的是空集）`,
    ).toBe(cells.total);
    const inset = await pxOfCssVar(page, '--ht-space-4');
    expect(
      cells.maxRight,
      `最右一枚热力图格子的右边缘 ${String(cells.maxRight)} 越过列右边缘减栏内间距 ${String(
        column.x + column.width - inset,
      )}（格子共 ${String(cells.count)} 枚）`,
    ).toBeLessThanOrEqual(column.x + column.width - inset + 1);
    // 前提的另一半：这些格子必须在列的**右边**，否则"没出栏"是被零尺寸满足的。
    expect(cells.maxRight, `格子右边缘 ${String(cells.maxRight)} 还在列左边缘左边`).toBeGreaterThan(
      column.x,
    );

    /* 板子自己不许有横向滚动：`scrollWidth > clientWidth` 在界面上的表现是
       "右边那几周看不见，也不知道还能滚"。这一条与上一条的差别是载体 ——
       上一条量的是**格子**，这一条量的是**滚动容器**（溢出的通常是后者）。 */
    const overflow = await pane.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(
      overflow.scrollWidth,
      `面单横向溢出 ${String(overflow.scrollWidth)} > ${String(overflow.clientWidth)}`,
    ).toBeLessThanOrEqual(overflow.clientWidth + 1);

    await parkCursor(page);
    await page.screenshot({ path: SHOT('h5-heatmap-fits') });
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });
});
