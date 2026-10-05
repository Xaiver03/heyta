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

import { addHabit, addNote, addTask, openApp, openSettingsView, parkCursor, switchView } from './helpers';

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
      /**
       * `near` = 往上最近的带 `data-testid` 的祖先（四象限是 `quadrant-board`）。
       * 它不是断言，是**失败读数的一部分**：并行跑的时候这一条红过一次"高亮行数 = 2"，
       * 而单独跑三次都绿 —— 那种"只有并发时才红"的现场，错误消息里不带容器就永远查不下去
       * （`test-results` 每次重跑会被清掉，快照不是可留存的证据）。
       */
      const host = el.closest('[data-testid]') === el ? el.parentElement?.closest('[data-testid]') : el.closest('[data-testid]');
      return {
        id: (el.getAttribute('data-testid') ?? '').replace(/^task-item-/, ''),
        title: (el.textContent ?? '').trim().slice(0, 12),
        highlighted: !transparent,
        bg: cs.backgroundColor,
        near: host?.getAttribute('data-testid') ?? '(none)',
      };
    }),
  );
}

/**
 * 断言"有且只有一行高亮"，返回它的下标、`id` 与标题。
 *
 * 🔴 返回类型里**必须带 `id`**：跨投影那条判据（K4）比的就是两行 `task-item-<id>`
 * 里的 `<id>`（用标题比会被行尾插槽骗到，见上面 `readRows` 的注释）。
 * 之前这里声明的是 `{at, title}` 而 `return` 里塞着 `id` —— **类型在说谎**，
 * 调用方只能靠 `as` 硬掰。e2e 以前没有类型检查载体，所以没人看见；
 * 现在有了（`e2e/tsconfig.detail-pane.json`），第一趟就把它报出来了。
 */
async function onlyHighlighted(
  page: Page,
  label: string,
): Promise<{ at: number; id: string; title: string }> {
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
    expect(on.length, `切到四象限后高亮行数不是 1（选中没跟着过来）；全部行读数 ${JSON.stringify(rows)}`).toBe(1);
    const got = rows[on[0] as number] as { id: string; title: string };
    expect(
      got.id,
      `列表里选中「${picked.title}」(${picked.id})，四象限高亮的是「${got.title}」(${got.id})` +
        ' = 两个投影各答一遍选中',
    ).toBe(picked.id);

    await parkCursor(page);
    await page.screenshot({ path: SHOT('k4-quadrant-same-selection') });
  });

  /**
   * K6 习惯面（工单 W1「跨视图通用」的第二条腿，真界面载体）
   * -----------------------------------------------------
   *
   * 这一条存在理由：`CURSOR_VIEWS` 里 `habits` 那一行在 jsdom 里只对着**插出来的**
   * DOM 跑过，在真浏览器里一直没走过真数据。
   *
   * 🔴 读数与任务面**同形**（2026-10-05 起；工单 §8.131）：习惯行的选中态**只**由共享选中态决定。
   * 旧形状里它由 `HabitsView` 的派生回落 `?? rows[0]` 决定 —— 没选中时右窗格也永远有内容，
   * `aria-current` 挂的是那枚回落行，于是"第一次 ↓"在界面上**不可见**（回落行 = 光标进入的第一行），
   * 而旧版这条判据只能退而证"之后每一步跟着走"。回落撤掉之后：
   *   · 没按键时**零行**带痕迹、窗格说的是「选一条习惯」；
   *   · **第一次按键就看得见**（下面 after1 那一格是旧形状做不到的覆盖）。
   * 并且继续钉住"两种线索说同一件事"：`aria-current` 那一行必等于带底色那一行。
   */
  test('K6 🔴 习惯面走同一套光标：没按键时零痕迹，第一次按键就看得见，↑↓ 逐格跟', async ({ page }) => {
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '习惯');
    await addHabit(page, '光标甲');
    await addHabit(page, '光标乙');
    await addHabit(page, '光标丙');

    /**
     * 每行读 `{id, aria-current, 底色}`。
     *
     * 🔴 为什么不是"底色非透明就算选中"（第一版就是这么写的，红在这里）：
     * `.ht-habit__row` 自己是 `<button>`，**未选中也有底色**（现量三行全是非透明），
     * 选中态只是**换成另一层浅底**（`habits.css:100` 的 `[aria-current='true']`）。
     * 所以"哪一行被选中"在 DOM 上不是"有没有颜色"，而是"**哪一行的颜色和别的行不一样**"。
     * 这里刻意**不硬编码那个颜色值** —— 它由设计 token 决定，抄进测试就是一份会漂的副本；
     * 判据问的是"少数派那一行 = `aria-current` 那一行"。
     */
    const read = async () => {
      const rows = await page.locator('[data-testid^="habit-row-"]').evaluateAll((els) =>
        els.map((el) => ({
          id: (el.getAttribute('data-testid') ?? '').replace(/^habit-row-/, ''),
          current: el.getAttribute('aria-current') === 'true',
          bg: getComputedStyle(el).backgroundColor,
        })),
      );
      const others = new Set(rows.filter((r) => !r.current).map((r) => r.bg));
      expect(others.size, `未选中的行自己有 ${others.size} 种底色，无法定义"少数派"：${JSON.stringify(rows)}`).toBe(1);
      const base = [...others][0] as string;
      return {
        ids: rows.map((r) => r.id),
        current: rows.map((r, i) => (r.current ? i : -1)).filter((i) => i >= 0),
        painted: rows.map((r, i) => (r.bg !== base ? i : -1)).filter((i) => i >= 0),
      };
    };

    const rows0 = await read();
    expect(rows0.ids.length, '习惯列表里没有行（数据没灌进去，这条判据量不到东西）').toBe(3);
    // 🔴 没人点过时**零行**带痕迹，且**零行**是被少数派底色标出来的那一行 ——
    // 两种线索同时为空，才叫"这一面没有回落"。（旧形状这里读的是"恰好一个"，钉的是猜位置。）
    expect(
      rows0.current,
      `没按键时不该有任何一行带 aria-current（习惯面没有"回落第一行"）：${JSON.stringify(rows0)}`,
    ).toHaveLength(0);
    expect(
      rows0.painted,
      `没按键时却有行带选中底色，而共享选中态是空的：${JSON.stringify(rows0)}`,
    ).toHaveLength(0);
    // 窗格在"有习惯但没选中"时说的那句措辞（不是"还没有习惯"，也不是某条习惯的数据）。
    await expect(page.locator('.ht-habit__pane')).toContainText('选一条习惯');
    // 🔴 先截图，再断言（§6.2 规定一第 1 条）：这一帧是本单**唯一**画着"未选中"那一格的图，
    //    后面的步骤会把窗格切成某条习惯，就再也回不到这个状态了。
    await page.screenshot({ path: SHOT('k6-habits-unselected-pane') });

    // 焦点交回页面：`addHabit` 之后光标还留在**新建输入框**里，那时第①道闸门
    // （正在打字）本来就该吃掉方向键 —— 不复位焦点的话这条判据量的是闸门，不是光标。
    await releaseFocus(page);
    await press(page, 'ArrowDown');
    const after1 = await read();
    // 🔴 这一格是旧形状**量不到**的：第一次按键必须看得见。
    expect(
      after1.current.length === 1 && after1.current[0] === 0,
      `第一次 ↓ 之后 aria-current 没落在第一行：${JSON.stringify(after1)}`,
    ).toBe(true);
    expect(
      after1.painted,
      `第一次 ↓ 之后浅底与 aria-current 分叉：${JSON.stringify(after1)}`,
    ).toEqual(after1.current);
    // 窗格跟着换人，而且说的是**那一行**的名字（痕迹与内容同源）。
    await expect(page.locator('.ht-habit__pane')).not.toContainText('选一条习惯');

    await press(page, 'ArrowDown');
    const step = await read();
    expect(
      step.painted,
      `再按一次 ↓ 之后浅底没跟着走：${JSON.stringify(after1)} → ${JSON.stringify(step)}`,
    ).toEqual(step.current);
    expect(
      step.current.length === 1 && (step.current[0] as number) > (after1.current[0] as number),
      `↓ 之后 aria-current 没往前走（${JSON.stringify(after1.current)} → ${JSON.stringify(step.current)}）`,
    ).toBe(true);

    await press(page, 'ArrowUp');
    const back = await read();
    expect(
      back.painted,
      `↑ 之后两种线索又分叉了：${JSON.stringify(back)}`,
    ).toEqual(back.current);
    expect(
      back.current.length === 1 && (back.current[0] as number) < (step.current[0] as number),
      '↑ 没往回走',
    ).toBe(true);

    await press(page, 'ArrowUp');
    await press(page, 'ArrowUp');
    const top = await read();
    expect(
      top.current.length === 1 && (top.current[0] as number) === 0,
      `到顶端 ↑ 应当**夹住**不环绕，实际 ${JSON.stringify(top)}`,
    ).toBe(true);
    expect(top.painted, `夹住之后浅底和 aria-current 不在同一行：${JSON.stringify(top)}`).toEqual(
      top.current,
    );

    await parkCursor(page);
    await page.screenshot({ path: SHOT('k6-habits-cursor-aria-current') });
  });

  /**
   * K7 便签面（第三条腿，也是这一轮**照出行为差别**的一条）
   * -----------------------------------------------------
   *
   * 便签的选中不是"高亮一行"，而是**打开编辑器面板**：`NotesView.tsx:99` 用
   * `useSelected('note')` 决定编辑器开不开、开哪条。于是这里要问的是：
   * 光标每按一次，界面跟着换的是**内容**而不是底色。
   *
   * 🔴 关键前提（现量，不是假设）：编辑器 `NoteEditor` 是**普通 View**
   * —— 既没有 `role="dialog"`，也没有裸 `.ht-sheet` 类（`packages/ui/src/notes/NoteEditor.tsx:162`）。
   * 所以第②道"浮层开着就不响应"的闸门**不拦它**，连按 ↓ 会继续换编辑器内容。
   * 这条判据钉的就是这件事真的成立（第一版我猜的是"打开编辑器后光标会被浮层闸门挡住" ——
   * 现量否证，正是 §8.9 那条"先怀疑自己的假设"的又一次应用）。
   */
  test('K7 🔴 便签面：↓ 换的是编辑器内容，且编辑器不算浮层（闸门不挡它）', async ({ page }) => {
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '便签');
    await addNote(page, '便签光标甲');
    await addNote(page, '便签光标乙');

    const editor = page.getByTestId('notes-editor-input');
    await expect(
      page.getByTestId('notes-editor'),
      '刚进便签视图编辑器就开着：选中还没发生',
    ).toHaveCount(0);

    // 同 K6：`addNote` 之后焦点在便签输入框里，先交回页面再按。
    await releaseFocus(page);
    await press(page, 'ArrowDown');
    await expect(editor, '第一次 ↓ 没把选中落到某一条便签（编辑器没开）').toBeVisible();
    const first = await editor.inputValue();

    // 前提：这上面确实**没有**浮层闸门要的两种形状，否则下面那句连按会被闸门吃掉。
    expect(
      await page.evaluate(
        () => document.querySelectorAll('[role="dialog"], .ht-sheet').length,
      ),
      '便签编辑器带了浮层形状 ⇒ 这条判据的前提变了',
    ).toBe(0);

    await press(page, 'ArrowDown');
    const second = await editor.inputValue();
    expect(
      second !== first && second.length > 0,
      `第二次 ↓ 之后编辑器内容没换（${JSON.stringify(first)} → ${JSON.stringify(second)}）`,
    ).toBe(true);

    await press(page, 'ArrowUp');
    expect(
      await editor.inputValue(),
      '↑ 之后编辑器没回到上一条',
    ).toBe(first);

    await parkCursor(page);
    await page.screenshot({ path: SHOT('k7-notes-editor-follows-cursor') });
  });

  /**
   * K8 便签面的**可见痕迹**（工单 W1c，看图照出来的那条）
   * ------------------------------------------------
   *
   * K7 证的是"编辑器内容跟着光标走"，而它顺手照出另一件事：**列表里那一行没有任何痕迹** ——
   * 任务面有浅底（`TaskRow.rowActive`）、习惯面有 `aria-current` + 浅底，便签面两样都没有。
   * 也就是说同一个一等状态在三张面上有三种可见性。K8 钉补齐之后的形状：
   *
   * ① 按键**之前**一行都不亮（与习惯面刻意不同：那边有"派生回落第一行"，
   *    便签没有回落 —— 没选中就是没选中，这正是 §8.20 那张全枚举表记的口径差别）；
   * ② 按键之后 `aria-current` 与浅底**始终同一行**，且那一行的摘要就是编辑器里正在编辑的正文；
   * ③ ↑↓ 逐格跟，夹住不环绕。
   *
   * 🔴 判据不写死那个颜色值（同 K6 的理由：抄 token 就是造第二份事实源）。
   */
  test('K8 🔴 便签面的选中看得见：aria-current、浅底、编辑器内容三者同一行', async ({ page }) => {
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '便签');
    await addNote(page, '便签痕迹甲');
    await addNote(page, '便签痕迹乙');
    await addNote(page, '便签痕迹丙');

    const read = async () => {
      const rows = await page.locator('[data-testid^="note-row-"]').evaluateAll((els) =>
        els.map((el) => {
          const id = (el.getAttribute('data-testid') ?? '').replace(/^note-row-/, '');
          const excerpt = el.querySelector(`[data-testid="note-edit-${id}"]`);
          return {
            id,
            current: el.getAttribute('aria-current') === 'true',
            bg: getComputedStyle(el).backgroundColor,
            excerpt: (excerpt?.textContent ?? '').replace(/…$/, ''),
          };
        }),
      );
      const others = new Set(rows.filter((r) => !r.current).map((r) => r.bg));
      expect(
        others.size,
        `未选中的行有 ${others.size} 种底色，无法定义"少数派"：${JSON.stringify(rows)}`,
      ).toBe(1);
      const base = [...others][0] as string;
      return {
        count: rows.length,
        current: rows.map((r, i) => (r.current ? i : -1)).filter((i) => i >= 0),
        painted: rows.map((r, i) => (r.bg !== base ? i : -1)).filter((i) => i >= 0),
        excerptOf: (i: number): string => (rows[i]?.excerpt ?? ''),
      };
    };

    const rows0 = await read();
    expect(rows0.count, '便签列表没渲染出三行（数据没灌进去，这条判据量不到东西）').toBe(3);
    expect(
      rows0.current,
      `没按键时不该有任何一行带 aria-current（便签没有"回落第一行"）：${JSON.stringify(rows0)}`,
    ).toEqual([]);
    expect(rows0.painted, '没按键时就有行被画了底色').toEqual([]);

    const editor = page.getByTestId('notes-editor-input');
    await releaseFocus(page);

    await press(page, 'ArrowDown');
    const one = await read();
    expect(
      one.current.length === 1,
      `一次 ↓ 之后 aria-current 应恰好一个，实际 ${JSON.stringify(one)}`,
    ).toBe(true);
    expect(
      one.painted,
      `浅底与 aria-current 不在同一行：${JSON.stringify(one)}`,
    ).toEqual(one.current);
    // 🔴 第三种线索：编辑器开的必须就是那一行。三处一致才叫"同一套选中"。
    await expect(editor, '↓ 之后编辑器没开').toBeVisible();
    const shown = await editor.inputValue();
    expect(
      shown.startsWith(one.excerptOf(one.current[0] as number)),
      `编辑器内容与被选中那行对不上：编辑器 ${JSON.stringify(shown)} / 行 ${JSON.stringify(one)}`,
    ).toBe(true);

    await press(page, 'ArrowDown');
    await press(page, 'ArrowDown');
    const bottom = await read();
    expect(
      bottom.current.length === 1 && (bottom.current[0] as number) === 2,
      `两次 ↓ 之后光标没走到第三行：${JSON.stringify(bottom)}`,
    ).toBe(true);
    expect(bottom.painted, '到底之后两种线索分叉').toEqual(bottom.current);

    await press(page, 'ArrowDown');
    const clamped = await read();
    expect(
      clamped.current,
      `越界之后应夹住不环绕，实际 ${JSON.stringify(clamped)}`,
    ).toEqual([2]);

    await press(page, 'ArrowUp');
    const back = await read();
    expect(
      back.current.length === 1 && (back.current[0] as number) === 1,
      `↑ 没往回走一格：${JSON.stringify(back)}`,
    ).toBe(true);
    expect(back.painted, '↑ 之后浅底没跟着走').toEqual(back.current);

    await parkCursor(page);
    await page.screenshot({ path: SHOT('k8-notes-selection-visible') });
  });
});
