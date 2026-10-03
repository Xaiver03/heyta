/**
 * 键盘光标的真浏览器判据（工单 W1b）
 * =================================
 *
 * jsdom 那一份（`apps/web/tests/keyboard-cursor.spec.tsx`）量的是接线的规则；
 * **只有这里能证的**是：真键盘事件穿过 react-native-web 的输入框之后，
 * 眼睛看到的高亮确实落在"按下去的那一行"上。
 *
 * 高亮的读法刻意**不看内部状态**：`TaskRow` 的 active 落成
 * `backgroundColor: color.primary-subtle`（`TaskRow.tsx:239`），
 * 所以"哪一行被选中"这件事在 DOM 上就是**有且只有一行带背景色**。
 * 顺序也不假设 —— 直接从渲染出来的行读，因为这条判据钉的正是
 * "光标走的是渲染顺序"。
 *
 * ⚠️ 截图路径按本文件位置解析（相对路径在 linked worktree 里会写进主检出）。
 */
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

import { addTask, openApp, openSettingsView, parkCursor, switchView } from './helpers';

const SHOT = (name: string) =>
  fileURLToPath(new URL(`../../apps/web/evidence/keyboard-cursor/${name}.png`, import.meta.url));

const ROWS = '[data-testid^="task-item-"]';

/**
 * 每行的 `{id, 标题, 是否高亮}`，按**文档序**。
 *
 * 🔴 跨投影比对用 `id`（就写在 `data-testid="task-item-<id>"` 里，是界面自己渲染出来的），
 * **不用 `textContent`**：列表那一行的文字里还带着清单 chip / 备注 / 「离开」这些插槽，
 * 而四象限那一行只有标题 —— 第一版拿文本比，报的是
 * "列表选中「投影对照二收集箱备注离开」，四象限却是「投影对照二」"，
 * 看着像"两个投影各答一遍选中"，实际是**两种行版式**。（真缺陷会被这种假缺陷盖掉。）
 */
function readRows(page: Page) {
  return page.locator(ROWS).evaluateAll((els) =>
    els.map((el) => {
      const cs = getComputedStyle(el);
      const transparent =
        cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent';
      return {
        id: (el.getAttribute('data-testid') ?? '').replace(/^task-item-/, ''),
        title: (el.textContent ?? '').trim().slice(0, 12),
        highlighted: !transparent,
      };
    }),
  );
}

/** 断言"有且只有一行高亮"，返回它的下标与标题。 */
async function onlyHighlighted(page: Page, label: string): Promise<{ at: number; title: string }> {
  const rows = await readRows(page);
  expect(rows.length, `${label}：列表里没有行（数据没灌进去，这条判据量不到东西）`).toBeGreaterThan(0);
  const on = rows.map((r, i) => (r.highlighted ? i : -1)).filter((i) => i >= 0);
  // 数量与位置一起报：只报"不是 1"看不出是 0（光标没落上）还是 3（高亮漏给了整组）。
  expect(on, `${label}：应恰好一行带高亮，实际下标 ${JSON.stringify(on)} / 全部 ${JSON.stringify(rows)}`).toHaveLength(1);
  const at = on[0] as number;
  const row = rows[at] as { id: string; title: string };
  return { at, id: row.id, title: row.title };
}

async function press(page: Page, key: 'ArrowUp' | 'ArrowDown'): Promise<void> {
  await page.locator('body').press(key);
}

/**
 * 把焦点从"当前那个控件"交回页面 = 用户点一下列表空白处之后的状态。
 *
 * ⚠️ 为什么这一条要存在（不是测试技巧，是产品的既有设计）：关掉设置/搜索浮层时
 * `closeSecondarySurface` 按设计**把焦点还给触发器**（`App.tsx:473-479`），
 * 而 `press()` 里 Playwright 对 `<body>` 调 `focus()` 是**空操作**（body 不可聚焦）
 * —— 所以不显式 blur 的话，那一次 ↓ 落在头像上，归的是头像（K5 钉的就是那一档）。
 */
async function releaseFocus(page: Page): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
}

test.describe('键盘光标（↑↓ 移动选中）', () => {
  test('K1 ↓ 从"没选中"进列表，逐项走到底，端点上**停住不环绕**', async ({ page }) => {
    await openApp(page, '/?lang=zh-CN');
    await addTask(page, '光标甲');
    await addTask(page, '光标乙');
    await addTask(page, '光标丙');

    const before = await readRows(page);
    expect(
      before.filter((r) => r.highlighted).length,
      '刚建完三条就有高亮：光标还没按，选中不该存在',
    ).toBe(0);
    const order = before.map((r) => r.title);

    await press(page, 'ArrowDown');
    const first = await onlyHighlighted(page, '第一次 ↓');
    expect(first.at, `↓ 没落在渲染顺序第一行（顺序 ${JSON.stringify(order)}）`).toBe(0);

    await press(page, 'ArrowDown');
    expect((await onlyHighlighted(page, '第二次 ↓')).at).toBe(1);

    await press(page, 'ArrowUp');
    expect((await onlyHighlighted(page, '再 ↑')).at).toBe(0);

    // 顶上来一下：夹住，不跳到最后一行。
    await press(page, 'ArrowUp');
    const clamped = await onlyHighlighted(page, '顶端再 ↑');
    expect(clamped.at, '到顶后 ↑ 环绕到了底部（长列表里这是最容易迷失的一刻）').toBe(0);

    await parkCursor(page);
    await page.screenshot({ path: SHOT('k1-first-row-highlighted') });
  });

  test('K2 🔴 焦点在捕获框里时不抢方向键（正在打字优先）', async ({ page }) => {
    await openApp(page, '/?lang=zh-CN');
    await addTask(page, '甲乙丙丁');
    await addTask(page, '另一个任务名');
    await addTask(page, '第三条任务');
    await press(page, 'ArrowDown');
    await press(page, 'ArrowDown');
    const at = (await onlyHighlighted(page, '进光标')).at;
    /**
     * 🔴 场景前提：光标必须停在**中间**那一行。端点上"再按一次什么也不动"是产品行为
     * （W1b 的夹住规则），所以拿端点那一行当"闸门在起作用"的证据必然假绿 ——
     * C5 头两趟就是这么存活的：第一版按的是 ↓ 再 ↑（两发互相抵消），
     * 第二版补了正向对照却仍停在第 0 行（↑ 在第 0 行本来就走不动）。
     */
    expect(at, '光标没停在中间那一行 ⇒ 下面两句"没挪走"可能是端点夹住而非闸门在挡').toBe(1);

    const composer = page.locator('input[placeholder^="添加任务"]');
    await composer.click();
    await composer.type('正在打字');

    // 🔴 **一发按键配一句断言**，不许两发按完再读一次（那正是抵消的来源）。
    await press(page, 'ArrowDown');
    expect(
      (await onlyHighlighted(page, '打字时按 ↓')).at,
      '焦点在输入框里，↓ 却把底下的选中挪走了',
    ).toBe(at);
    await press(page, 'ArrowUp');
    expect(
      (await onlyHighlighted(page, '打字时按 ↑')).at,
      '焦点在输入框里，↑ 却把底下的选中挪走了',
    ).toBe(at);
    // 正向对照①：字确实进了输入框（否则"没挪走"可能只是因为按键根本没发出去）。
    await expect(composer).toHaveValue('正在打字');

    // 图证停在"还在打字、那一行还没被挪走"这一刻（正向对照会把它挪走，拍了就不是这件事了）。
    await parkCursor(page);
    await page.screenshot({ path: SHOT('k2-typing-row-unchanged') });

    /**
     * 🔴 正向对照②：同一趟里把焦点交回页面再按 ↓，**必须真的挪一格**。
     * 只断言"没发生"的判据必须配一条"同样这一下、条件成立时确实会发生"。
     */
    await releaseFocus(page);
    await press(page, 'ArrowDown');
    expect(
      (await onlyHighlighted(page, '正向对照：焦点交回页面后同一发 ↓')).at,
      `正向对照失效：焦点不在输入框时 ↓ 也没把选中从 ${at} 挪走 ⇒ 上面那两句"没挪走"是恒真`,
    ).toBe(at + 1);
  });

  test('K3 🔴 设置浮层开着时不抢（底下那一栏还挂着，偷偷换选中=界面说谎）', async ({ page }) => {
    await openApp(page, '/?lang=zh-CN');
    await addTask(page, '浮层下的甲');
    await addTask(page, '浮层下的乙');
    await press(page, 'ArrowDown');
    const at = (await onlyHighlighted(page, '进光标')).at;

    await openSettingsView(page);
    await press(page, 'ArrowDown');
    await press(page, 'ArrowDown');
    expect(
      (await onlyHighlighted(page, '浮层里按方向键')).at,
      '设置浮层底下，选中被偷偷挪了两格',
    ).toBe(at);

    // 关掉浮层后光标必须**回来**。⚠️ "回来"有一个前提要先满足：Esc 之后焦点按既有设计
    // 回到头像（见 `releaseFocus` 的说明），而 ↓ 在头像上归的是头像 —— 所以这里先把
    // 焦点交回页面，再验光标本身。"焦点在头像上时那一发归谁"由 **K5** 单独钉。
    await page.keyboard.press('Escape');
    await releaseFocus(page);
    await press(page, 'ArrowDown');
    const back = await onlyHighlighted(page, '关掉浮层再按');
    expect(back.at).toBe(at + 1);

    /**
     * ⚠️ 这里**只有一张"关掉之后"的图**，不是遗漏：`.ht-sheet` 的底色是
     * `color-mix(in srgb, var(--ht-color-background) 95%, transparent)`
     * （`apps/web/src/styles/app/sheets.css:27`；那里写明"下层可见"的判据是
     * **DOM 里下层标记仍在**，视觉上只退成隐约一层）。95% 浓度下"底下那一行没动"
     * 在像素上量不出来 —— 硬拍一张只会拍到 sheet。
     * 所以"浮层里按方向键不偷偷换选中"这条**由断言证**（读的是底下那一行的
     * 计算样式，不看像素），图证给的是它配套的那一半：**关掉之后光标还在、还能走**。
     */
    await parkCursor(page);
    await page.screenshot({ path: SHOT('k3-cursor-back-after-closing-sheet') });
  });

  /**
   * 🔴 这一条是**看图看出来的**（不是先想出来再验的）：`k3` 那张图的第一版里
   * 账号菜单是开着的 —— 因为 Esc 把焦点还给头像，而头像那颗按钮自己把 ↓ 用作
   * "打开菜单"（`AccountMenu.tsx:299`），同一次按键**既弹菜单又挪底下的选中**。
   *
   * 判据刻意写成**两条腿**：菜单必须真的弹出来（否则"选中没动"可以靠"光标整个死了"
   * 蒙过去）+ 选中必须还在原来那一行。
   */
  test('K5 🔴 焦点在头像上时 ↓ 归头像（弹菜单），底下那一栏的选中不许跟着动', async ({ page }) => {
    await openApp(page, '/?lang=zh-CN');
    await addTask(page, '归属甲');
    await addTask(page, '归属乙');
    await press(page, 'ArrowDown');
    const at = (await onlyHighlighted(page, '进光标')).at;

    await openSettingsView(page);
    await page.keyboard.press('Escape');
    // 场景前提（不是装饰）：`closeSecondarySurface` 确实把焦点还给了头像。
    expect(
      await page.evaluate(() => document.activeElement?.getAttribute('data-testid')),
      '焦点没回到头像 ⇒ 这条判据量的不是"↓ 落在带子菜单的触发器上"那个场景',
    ).toBe('account-menu-avatar');

    await press(page, 'ArrowDown');
    await expect(
      page.getByTestId('account-menu-panel'),
      '↓ 在头像上是"打开账号菜单"（`AccountMenu.tsx:299` 的既有键盘入口），它必须仍然成立',
    ).toBeVisible();
    expect(
      (await onlyHighlighted(page, '头像上的 ↓')).at,
      '同一次 ↓ 既弹了菜单又把底下那栏的选中挪走 = 两个控件抢同一个键',
    ).toBe(at);

    await parkCursor(page);
    await page.screenshot({ path: SHOT('k5-avatar-owns-arrow') });
  });

  test('K4 🔴 跨投影同一个选中：列表里 ↓ 选中的那条，切到四象限还是它', async ({ page }) => {
    await openApp(page, '/?lang=zh-CN');
    await addTask(page, '投影对照一');
    await addTask(page, '投影对照二');
    await press(page, 'ArrowDown');
    await press(page, 'ArrowDown');
    const picked = await onlyHighlighted(page, '列表里选中第二条');

    await switchView(page, '四象限');
    const rows = await readRows(page);
    expect(rows.length, '四象限里没有任务行（投影没接上）').toBeGreaterThan(0);
    const on = rows.map((r, i) => (r.highlighted ? i : -1)).filter((i) => i >= 0);
    expect(on.length, '切到四象限后高亮行数不是 1（选中没跟着过来）').toBe(1);
    const got = rows[on[0] as number] as { id: string; title: string };
    expect(
      got.id,
      `列表里选中「${picked.title}」(${picked.id})，四象限高亮的是「${got.title}」(${got.id})` +
        ' = 两个投影各答一遍选中',
    ).toBe(picked.id);

    await parkCursor(page);
    await page.screenshot({ path: SHOT('k4-quadrant-same-selection') });
  });
});
