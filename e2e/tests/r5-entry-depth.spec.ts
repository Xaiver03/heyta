/**
 * R5「从主界面到改一条任务 ≤ 3 层」的**现量读数**（真浏览器）
 * ==========================================================
 *
 * ## 这一份补的是哪一个缺口
 *
 * `docs/plans/r14-entry-table.md` §8 第 1 行到今天为止写的是「**未测**：仓里没有那条 e2e」。
 * 取证文档 [`ticktick-ux-ia-and-entry-paths`](../../docs/research/ticktick-ux-ia-and-entry-paths.md) §7 R5
 * 给的判据原文是：
 *
 * > e2e 里每点一次记录可见浮层数（`[role="dialog"],[role="menu"],[data-overlay]` 中
 * > `display !== none` 的层数），走完最短路径后断言 `maxDepth ≤ 3`。
 *
 * 这一份就是那条 e2e。但**口径必须写死**，否则它只是一串看起来像证据的数字：
 *
 * | 名词 | 本文件的定义 | 为什么这么定 |
 * |---|---|---|
 * | **点击** | 一次真实的 `pointerdown`（页面级监听计数），**键入不算** | 与取证 §4「一次指针按下并抬起；键入不算点击」一致。`<select>` 的原生下拉由 Playwright 的 `selectOption` 驱动、**不产生 pointerdown** —— 这是本文件已知的**少计**，见每条链路的 `note` |
 * | **层（深度）** | **1 + 同屏可见的可交互表面数**（主界面本身算第 1 层） | 与取证 §4「从主界面出发、动作经过的可交互表面层数（主界面本身算第 1 层）」一致 |
 * | **表面** | `[role="dialog"]` / `[role="menu"]` / `[data-overlay]`（R5 原文那三个）；**外加**详情列（`[data-testid="detail-column"]`，它是取证 §4.2 里被计作一层的「详情」） | R5 原文那三个选择器**看不见详情列**（它是 `<aside>` 不是浮层），而取证 §4.2 明确把「详情」算一层。两个口径的差就写在这一行 |
 *
 * ## 与取证口径**已知的两处差**（不藏）
 *
 * 1. **`<select>` 那一步不计点击。** 取证把「选一档」算 1 次点击；heyta 的优先级 / 子任务
 *    都是原生 `<select>`，Playwright 的 `selectOption` 不发指针事件 ⇒ 我们的读数在同一条
 *    链路上比取证**少 1 次**。这一点逐条写进 `note`，不靠读者自己推。
 * 2. **取证数的是"控件清单推导"，我们数的是"真跑一遍的事件数"。** 同一件事的两种口径，
 *    我们的数**偏低**（推导会把"可能要点两下"的地方按 2 算），所以"我们量到 ≤3"不是
 *    "比取证严"，而是"同一档"。
 *
 * ## 🔴 判据怎么才会红
 *
 * `assertDepth` 对每条链路断言 `depth <= 3`。**仪器自检**那一块证明这把尺子读得到 4
 * （合成三层 `role="dialog"` 叠在主界面上 ⇒ 读数必须是 4），所以"全是 2/3"不是尺子坏了。
 */

import { expect, test, type Page } from '@playwright/test';

import { addTask, openApp, openSettingsView, parkCursor, selectSettingsSection } from './helpers';

const SHOT = (name: string): string => `../apps/web/evidence/r5-entry-depth/${name}.png`;

/** 指针按下计数（`pointerdown` 捕获阶段）。 */
declare global {
  interface Window {
    __r5clicks?: number;
  }
}

async function installClickCounter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__r5clicks = 0;
    document.addEventListener(
      'pointerdown',
      () => {
        window.__r5clicks = (window.__r5clicks ?? 0) + 1;
      },
      true,
    );
  });
}

const resetClicks = (page: Page): Promise<void> =>
  page.evaluate(() => {
    window.__r5clicks = 0;
  });

const readClicks = (page: Page): Promise<number> =>
  page.evaluate(() => window.__r5clicks ?? 0);

/**
 * 一张快照：现在屏幕上**同屏可见**的可交互表面。
 *
 * `visible` 用的是 `getClientRects().length > 0` 而不是 Playwright 的 `toBeVisible()`：
 * 这一条要在 `evaluate` 里一次量完（多次往返之间界面会变），而 R5 原文的口径就是
 * "`display !== none` 的层数"。
 */
interface Surfaces {
  /** 命中的表面名（按选择器顺序，去重）。 */
  readonly names: readonly string[];
  /** 深度 = 1（主界面）+ 命中数。 */
  readonly depth: number;
}

async function surfacesNow(page: Page): Promise<Surfaces> {
  const names = await page.evaluate(() => {
    const probes: readonly (readonly [string, string])[] = [
      ['dialog', '[role="dialog"]'],
      ['menu', '[role="menu"]'],
      ['overlay', '[data-overlay]'],
      // 取证 §4.2 把「详情」算一层；R5 原文那三个选择器看不见它（它是 <aside>）。
      ['detail-column', '[data-testid="detail-column"]'],
    ];
    const found: string[] = [];
    for (const [kind, selector] of probes) {
      /*
        🔴 **逐个元素数，不是"每个选择器最多算一个"。**
        第一版写的是"命中就 break"，于是三层合成 `role="dialog"` 只读到 1 层
        （仪器自检当场红了：期望 4、读到 3）。R5 原文说的是"可见浮层**的层数**"，
        叠三层就是三层 —— 这正是"叠着开"与"换着开"的区别，也正是越线的形状。
      */
      for (const el of Array.from(document.querySelectorAll(selector))) {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        // 详情列判"它正在当详情面用"：`TaskDetailCard` 只在选中一条任务时渲染，
        // 它的 `task-detail-*` 标记就是那个证据。⚠️ 不能用"里面有 input"来判 ——
        // 空白主界面上那一栏也含有输入框（实测基线读成 2 层，把每条链路都抬了一层）。
        if (kind === 'detail-column' && el.querySelector('[data-testid^="task-detail"]') === null) {
          continue;
        }
        if (el.getClientRects().length === 0) continue;
        const testId = el.getAttribute('data-testid');
        found.push(`${kind}${testId === null ? '' : `:${testId}`}`);
      }
    }
    return found;
  });
  return { names, depth: 1 + names.length };
}

/**
 * 阈值本身：R5 的线是 **≤ 3 层**。
 *
 * 🔴 抽成一个函数**不是为了好看**：仪器自检要能证明"4 层会被判越线"，
 * 而办法只有两个 —— 让某条用例真的红（那就得留一条永远红的用例，不行），
 * 或者**对同一个阈值函数**喂一个 4，断言它拒绝。后者既证明了判据活着，
 * 又不会在仓库里留一条假红。
 */
const withinLayerLimit = (depth: number): boolean => depth <= 3;

/**
 * 每条链路一条读数 + 一条断言。
 *
 * ⚠️ 断言与打印**成对**存在：只断言不打印，红了看不出差多少；只打印不断言，
 * 那就不是判据（§7 元规则 2：一条永远通过的判据比没有判据更糟）。
 */
function assertDepth(label: string, surfaces: Surfaces): void {
  // eslint-disable-next-line no-console
  console.info(
    `[R5] ${label}：深度 ${String(surfaces.depth)} 层（主界面 1 + [${surfaces.names.join(', ')}]）`,
  );
  expect(
    withinLayerLimit(surfaces.depth),
    `${label} 的深度是 ${String(surfaces.depth)} 层（${surfaces.names.join(' / ')}）⇒ 超过 3 层就是"藏起来"（取证 §7 R5）`,
  ).toBe(true);
}

test.describe('R5 · 三条基线链路的点击与层数（现量）', () => {
  test('仪器自检：这把尺子读得到 4 层（否则"全是 2 层"不是证据）', async ({ page }) => {
    await installClickCounter(page);
    await openApp(page, '/?lang=zh-CN');
    const base = await surfacesNow(page);
    assertDepth('空主界面', base);

    // 合成三层 `role="dialog"`：尺子必须读到 1 + 3 = 4。
    await page.evaluate(() => {
      for (let i = 0; i < 3; i++) {
        const el = document.createElement('div');
        el.setAttribute('role', 'dialog');
        el.setAttribute('data-testid', `r5-synthetic-${String(i)}`);
        el.style.position = 'fixed';
        el.style.inset = `${String(10 + i * 10)}px`;
        el.style.zIndex = String(9999 + i);
        document.body.append(el);
      }
    });
    const stacked = await surfacesNow(page);
    // eslint-disable-next-line no-console
    console.info(`[R5] 仪器自检：合成三层之后读到 ${String(stacked.depth)} 层`);
    expect(stacked.depth, '合成三层之后仍读到 <= 3 ⇒ 这把尺子读不到层数，全部读数作废').toBe(4);
    /*
      阈值那一半：**同一个函数**喂 4 必须判越线、喂 3 必须放行。
      写成断言而不是"留一条红的用例"—— 后者会让仓库里长期挂着一条假红。
    */
    expect(withinLayerLimit(stacked.depth), '4 层没被判越线 ⇒ R5 的阈值是死的').toBe(false);
    expect(withinLayerLimit(3), '3 层被误判越线 ⇒ 阈值定错了（R5 的线是 ≤3）').toBe(true);
  });

  test('链路① 新建一条任务 + 设日期（收集框里的日期胶囊）', async ({ page }) => {
    await installClickCounter(page);
    await openApp(page, '/?lang=zh-CN');
    await resetClicks(page);

    const input = page.getByTestId('capture-input');
    await input.click(); // 点击 1
    await input.fill('R5 链路①：新建并设日期');
    await page.getByTestId('capture-due-capsule').click(); // 点击 2

    const popover = page.getByTestId('capture-due-popover');
    await expect(popover, '胶囊没打开日期面板 ⇒ 这一条没有第二层可量').toBeVisible();
    await page.waitForTimeout(300); // RNW 的 Yoga 布局落地
    const atPopover = await surfacesNow(page);
    assertDepth('链路① 在日期面板里选一天', atPopover);

    const picker = popover.getByTestId('date-picker');
    await expect(picker, '面板里没有月历').toBeVisible();
    const cell = picker.locator('[role="button"][aria-label$="18日"]').first();
    await cell.click(); // 点击 3
    await page.getByTestId('capture-submit').click(); // 点击 4
    await expect(
      page.locator('[data-testid^="task-item-"]').filter({ hasText: 'R5 链路①' }),
      '任务没建出来 ⇒ 链路没走完',
    ).toHaveCount(1);

    const clicks = await readClicks(page);
    // eslint-disable-next-line no-console
    console.info(`[R5] 链路①：点击 ${String(clicks)} 次（点输入框 1 / 胶囊 1 / 月份格子 1 / 提交 1）`);
    /*
      取证 §4.1 的同一条链路是 6 次点击（macOS 6~7）；
      heyta 的收集框把"日期"收进一枚胶囊 ⇒ 少两次（不需要先点"日期按钮"再"确定"）。
      ⚠️ 判据不设上限（PRD 只规定**层数** ≤3）；这里只登记读数，并为将来"多点两下"
      留一条会响的线：超过 8 次就说明这一格退回了"铺开式控件"那一档。
    */
    expect(clicks, `链路① 需要 ${String(clicks)} 次点击，明显超出收集框该有的步数`).toBeLessThanOrEqual(8);

    await parkCursor(page);
    await page.screenshot({ path: SHOT('path1-new-plus-date') });
  });

  test('链路①b 同一条任务 + 设优先级（字段层，含详情面那一层）', async ({ page }) => {
    await installClickCounter(page);
    await openApp(page, '/?lang=zh-CN');
    await addTask(page, 'R5 链路①b：优先级');
    await resetClicks(page);

    // 从主界面点开这一条 ⇒ 详情面出现（取证 §4.2 把「详情」算一层）。
    await page
      .locator('[data-testid^="task-item-"]')
      .filter({ hasText: 'R5 链路①b' })
      .first()
      .click(); // 点击 1
    const pane = page.locator('[data-testid="detail-column"]');
    await expect(pane, '详情列没出现').toBeVisible();

    const priority = pane.locator('[data-testid^="task-detail-priority"], select').first();
    await expect(priority, '详情面里没有优先级控件').toBeVisible();
    const atPane = await surfacesNow(page);
    assertDepth('链路①b 在详情面里改优先级', atPane);

    // ⚠️ 原生 `<select>`：`selectOption` **不产生 pointerdown** ⇒ 这一次不计入点击读数。
    // 取证把「选一档」算 1 次；差就在这里，逐字写在 note 里。
    const select = pane.locator('select').filter({ hasText: /中|高|低/ }).first();
    if ((await select.count()) > 0) {
      await select.selectOption({ index: 1 });
    }
    const clicks = await readClicks(page);
    // eslint-disable-next-line no-console
    console.info(
      `[R5] 链路①b：点击 ${String(clicks)} 次（点行开详情 1；原生 select 的"选一档"不计 —— `
      + `若按取证 §4 的计数法各算 1，则是 ${String(clicks + 1)} 次）`,
    );
    await parkCursor(page);
    await page.screenshot({ path: SHOT('path1b-priority') });
  });

  test('链路② 打开一条任务的详情，改它的子任务归属', async ({ page }) => {
    await installClickCounter(page);
    await openApp(page, '/?lang=zh-CN');
    await addTask(page, 'R5 链路② 父任务');
    await addTask(page, 'R5 链路② 子任务');
    await resetClicks(page);

    await page
      .locator('[data-testid^="task-item-"]')
      .filter({ hasText: 'R5 链路② 子任务' })
      .first()
      .click(); // 点击 1
    const pane = page.locator('[data-testid="detail-column"]');
    const subtask = pane.locator('[data-testid^="subtask-select-"]').first();
    await expect(subtask, '详情面里没有子任务那一格 ⇒ 链路②没有那个动作').toBeVisible();
    const atPane = await surfacesNow(page);
    assertDepth('链路② 在详情面里改子任务归属', atPane);

    await subtask.selectOption({ label: 'R5 链路② 父任务' });
    const clicks = await readClicks(page);
    // eslint-disable-next-line no-console
    console.info(
      `[R5] 链路②：点击 ${String(clicks)} 次（点行开详情 1；原生 select 不计 —— `
      + `按取证 §4 计数法算上"选一档"是 ${String(clicks + 1)} 次）`,
    );
    await parkCursor(page);
    await page.screenshot({ path: SHOT('path2-detail-subtask') });
  });

  test('链路③ 从主界面进设置，改一个外观项', async ({ page }) => {
    await installClickCounter(page);
    await openApp(page, '/?lang=zh-CN');
    await resetClicks(page);

    /*
      ⚠️ 这里**只调 `openSettingsView`**，不再自己先点一遍头像与设置：
      那样等于把同一段路走两趟，计数会凭空多 2（第一版就是这么读到 6 的，
      而其中 2 次是探针自己重复走的路，不是产品的链路）。
    */
    await openSettingsView(page); // 点击 1（头像）+ 点击 2（菜单里的「设置」）
    await selectSettingsSection(page, 'appearance'); // 点击 3

    const sheet = page.getByTestId('settings-sheet');
    await expect(sheet, '设置浮层没出现').toBeVisible();
    const atSheet = await surfacesNow(page);
    assertDepth('链路③ 在设置里改外观', atSheet);

    const before = await page.locator('html').getAttribute('data-theme');
    await page.getByTestId('theme-toggle').click(); // 点击 4
    await expect(
      page.locator('html'),
      '点了主题开关但 data-theme 没翻 ⇒ 链路的最后一步没落成',
    ).not.toHaveAttribute('data-theme', before ?? '');

    const clicks = await readClicks(page);
    // eslint-disable-next-line no-console
    console.info(
      `[R5] 链路③：点击 ${String(clicks)} 次（头像 1 / 设置 1 / 外观分组 1 / 主题开关 1）`,
    );
    await parkCursor(page);
    await page.screenshot({ path: SHOT('path3-settings-appearance') });
  });
});
