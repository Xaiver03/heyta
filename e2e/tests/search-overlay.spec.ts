import { expect, test } from '@playwright/test';

/**
 * 搜索的**聚焦搜索（Spotlight）形态** —— 只有真浏览器能证的那一半
 * =================================================================
 *
 * ## 为什么这个文件存在（而 jsdom 那两组不够）
 *
 * §7 第 80 条：react-native-web 的 `TextInput` 在自己的 keydown 处理器里
 * **无条件 `stopPropagation()`**，而面板的输入框是 `autoFocus` —— 焦点常态就在里面。
 * 于是"挂在**冒泡**阶段的 Esc / ⌘K / ↑↓ / ↵"在真浏览器里**从来没被按通过**，
 * 而 jsdom 全绿（jsdom 里 `window.dispatchEvent` 直接在 window 上起事件，
 * 根本不走"输入框 → 冒泡 → window"那条被吞的路）。
 *
 * ⇒ 这里每一条都**把焦点放在输入框里**再用真按键（`page.keyboard`），
 * 证的是宿主挂**捕获阶段**才赢得上游那场拦截。jsdom 里那几条只钉接线在不在。
 *
 * ## 形态判据（2026-10-01 产品负责人改成聚焦搜索式，附 macOS 聚焦截图）
 *
 * · **贴顶**（`align-items: flex-start`），不是垂直居中 —— 居中的话结果少时
 *   卡片悬在半屏中间，与"输入法"这个用途不符；
 * · 宽度钉在 `--ht-layout-modal-max`（40rem = 640px），铺满内容区就是假浮层；
 * · **高与宽成比例**（16:9），不是"高度跟着内容伸缩"的薄片（同日追加："不仅仅是一条"）；
 * · **玻璃材质分两半**：半透明底色在共享层（`material.chrome-tint`）、背景模糊在宿主
 *   CSS（`backdrop-filter` 只在 CSS 里合法）。所以判据也是**两条** —— 只查一半
 *   就会放走另一半的回归（去掉 blur 或换回实色，卡片都还"看起来像卡片"）；
 * · **非模态**：下层任务列表仍在 DOM（替换式路由会让它消失）；
 * · 一个应用**只有一个搜索入口**：顶栏那个内联框已删，面板里也**没有 ✕**
 *  （那个位置放关闭按钮，与"这一行就是打字的地方"抢注意力），
 *   出口只有 Esc、点 scrim、⌘K 三条。
 *
 * 🔴 截图是硬性要求（AGENTS §6.2 规定一），落固定路径，人必须看。
 */

/**
 * 🔴 进应用必须带 `?lang=zh-CN`。
 *
 * 2026-10-01 语言解析链新增第 3 层 = `navigator.language`，而 Playwright 拉起来的
 * Chromium 报 `en-US` ⇒ 无头浏览器里整个界面是**英文**（`tab "Tasks"`、
 * `button "Inbox"`）。这一组的判据里有靠中文文本定位的（rail 那个「搜索」tab、
 * composer 的 placeholder），语言一翻就全红 —— 而红的是**探针**，不是产品。
 * （jsdom 那侧由 `apps/web/tests/setup.ts` 钉住 `zh-CN`，浏览器侧没有等价物。）
 *
 * `?lang=` 在链上排在系统语言**之前**（`apps/web/src/lib/locale.ts`），且首启
 * 只激活不落盘 ⇒ 它是"把语言钉住"最轻的手段，不改动任何产品代码。
 */
const APP_URL = '/?lang=zh-CN';

/** 建一条任务（走收集箱上方的 composer，真回车 ⇒ 真 op）。 */
async function addTask(page: import('@playwright/test').Page, title: string): Promise<void> {
  // 🔴 用 testid 而不是 placeholder：后者是**文案**，跟着语言走。
  //    语言已经由 APP_URL 钉住，但探针不该再多绑一根会变的弦。
  const composer = page.getByTestId('capture-input');
  await composer.fill(title);
  await composer.press('Enter');
}

test('搜索：贴顶浮层透出下层视图 + 顶栏没有第二个框 + 面板里没有 ✕', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(APP_URL);
  await addTask(page, '搜索浮层判据的锚点任务');
  await expect(page.locator('[data-testid="task-list"]'), '任务先建出来').toBeVisible();

  // ① 🔴 同屏不许有两个能打字的搜索框：顶栏那个已删（rail 按钮 / ⌘K 是唯一入口）。
  await expect(page.locator('.ht-header input'), '顶栏里不该再有输入框').toHaveCount(0);

  await page.getByRole('tab', { name: '搜索' }).click();
  const surface = page.getByTestId('search-overlay-surface');
  await expect(surface, '搜索应当作为浮层出现').toBeVisible();
  await expect(surface).toHaveAttribute('aria-modal', 'false');

  // ② 🔴 判据本体：下层任务列表仍在 DOM 里（浮层盖在上面，不是替换）。
  await expect(page.locator('[data-testid="task-list"]')).toBeAttached();

  // ③ 出口只有三条：面板里**没有**关闭按钮。
  await expect(
    surface.locator('[data-testid*="close"], [aria-label*="关闭"]'),
    '聚焦搜索形态没有 ✕ —— Esc / 点 scrim / ⌘K 才是它的三条出口',
  ).toHaveCount(0);

  const card = surface.locator('> *').first();
  const box = await card.boundingBox();
  expect(box, '浮层卡片有几何').not.toBeNull();
  const contentBox = await page.locator('.ht-content').boundingBox();
  expect(contentBox, '内容区有几何').not.toBeNull();

  // ④ 宽度：不得超过 modal-max（640px + 2px 容差）。
  expect(box!.width, '卡片宽度不得超过 modal-max（铺满就是假浮层）').toBeLessThanOrEqual(642);
  // ⑤ 水平居中基准是**内容区**（rail/侧栏照常透出），不是视口 —— 对视口会差出 rail 宽的一半。
  const centeredDelta = Math.abs(box!.x + box!.width / 2 - (contentBox!.x + contentBox!.width / 2));
  expect(centeredDelta, '卡片必须在内容区内水平居中').toBeLessThanOrEqual(8);

  // ⑥ 🔴 贴顶。**三条各自独立、且都与卡片的高度无关** ——
  //    第一版把"上隙 < 卡片高"当非空洞化界，结果 `aspect-ratio` 一拿掉它就先红，
  //    比例那条判据根本没被执行到（变异验证把这件事照出来了）。
  const topGap = box!.y - contentBox!.y;
  const bottomGap = contentBox!.y + contentBox!.height - (box!.y + box!.height);
  const padTop = await surface.evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));
  const surfaceBox = await surface.boundingBox();
  expect(surfaceBox, '浮层有几何').not.toBeNull();
  // ⅰ 那条 padding 本身不能把卡片推离顶部（阈值从**浮层自己的高度**推，不看卡片）
  expect(
    padTop,
    `浮层的 padding-top ${padTop} 已吃掉浮层高 ${surfaceBox!.height} 的四分之一以上 —— 上面那不是余量，是悬空`,
  ).toBeLessThanOrEqual(surfaceBox!.height * 0.25);
  // ⅱ 🔴 "贴顶"的正定义：卡片上方**只由浮层那条 padding 决定**，
  //     从同一个元素的活计算样式推导，所以 `--ht-space-16` 改了它不会假红，
  //     而改回 `align-items: center` 会多出一截居中余量 ⇒ 红。
  //     ⚠️ 基准是**浮层自己的上沿**而不是 `.ht-content`：内容区带 `padding: space-6`，
  //     浮层嵌在这层 padding 里 ⇒ 拿内容区外沿对 padding-top 会恒差一个 padding
  //     （第一版栽在这里，报出 136 vs 128 这种"看起来像回归"的红）。
  const gapToOverlay = box!.y - surfaceBox!.y;
  expect(
    Math.abs(gapToOverlay - padTop),
    `卡片上方只该剩浮层那条 padding（padding-top ${padTop} / 实测上隙 ${gapToOverlay}）`,
  ).toBeLessThanOrEqual(2);
  // ⅲ 方向兜底：上隙必须明显小于下隙
  expect(topGap, `卡片必须贴顶（上隙 ${topGap} / 下隙 ${bottomGap}）`).toBeLessThan(bottomGap);

  // ⑦ 🔴 高与宽**成比例**（16:9），不是"高度由内容决定"的薄片。
  //    2026-10-01 产品负责人："不仅仅是一条" —— 空态时旧卡片只剩一条输入行高。
  //    判据从被约束的常量推导（9/16），不是抄一个量出来的数：
  //    改回 `height: auto` ⇒ 空态 ratio ≈ 0.2 ⇒ 这条红。
  const ratio = box!.height / box!.width;
  expect(ratio, `卡片高宽比应约为 16:9（实测 ${box!.height}×${box!.width} = ${ratio.toFixed(3)}）`)
    .toBeGreaterThan(0.5);
  expect(ratio, `比例过头说明它不再是"跟着宽度的面"：${ratio.toFixed(3)}`).toBeLessThan(0.66);

  // ⑧ 🔴 玻璃材质是**两半**：半透明底色（共享层的 token）+ 背景模糊（宿主 CSS）。
  //    只查其中一半会漏掉另一半的回归 —— 去掉 blur 或把底色换成实色，界面都还"像卡片"。
  const material = await card.evaluate((el) => {
    const s = getComputedStyle(el);
    return { backdrop: s.backdropFilter || s.webkitBackdropFilter || 'none', bg: s.backgroundColor };
  });
  expect(material.backdrop, `卡片必须有背景模糊：${material.backdrop}`).toContain('blur(');
  const alpha = Number(/rgba?\([^)]*?,\s*([\d.]+)\)/.exec(material.bg)?.[1] ?? '1');
  expect(alpha, `卡片底色必须半透明（玻璃）：${material.bg}`).toBeLessThan(1);

  await page.screenshot({ path: 'test-results/search-spotlight-empty.png', fullPage: false });

  // ⑨ 有结果的样子（截图给人看，判据不靠它）。
  await page.keyboard.type('锚点');
  await expect(
    surface.locator('[data-testid="search-panel-tasks"] [data-testid^="task-item-"]'),
    '打字后面板里应当出现命中的任务',
  ).toHaveCount(1);
  await page.screenshot({ path: 'test-results/search-spotlight-results.png', fullPage: false });

  // ⑩ 🔴 Esc **从输入框里**按 —— §7 第 80 条那个被上游吞掉的按键。
  await page.keyboard.press('Escape');
  await expect(surface, '焦点在输入框里时 Esc 必须能关掉浮层').toHaveCount(0);
  await expect(page.locator('[data-testid="task-list"]'), 'Esc 后回到下层视图').toBeVisible();
});

/**
 * 🔴 键盘全流程，焦点**始终**在面板输入框里（宿主挂捕获阶段才可能全部成立）。
 *
 * 为什么要 31 条任务：↵ 打开任务后宿主会把**列表里**那一行滚进视野
 *（2026-09-30 之前它只 `setView('tasks')` 就把 id 丢了，症状是"点了没反应"）。
 * 库里只有一两条时那行本来就在屏幕上，"滚没滚"这条判据永远成立 ——
 * 那正是"一条永远通过的判据比没有判据更糟"。所以先把目标行挤到屏幕外。
 */
test('🔴 真键盘：⌘K 开 → 输入 → ↓ 高亮并滚进视野 → ↵ 打开并把列表里那行滚进来 → ⌘K 关', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(APP_URL);

  for (let i = 0; i < 30; i += 1) await addTask(page, `填充任务 ${i + 1}`);
  await addTask(page, '搜索滚动锚点 甲');
  await addTask(page, '搜索滚动锚点 乙');

  // ① ⌘K 不移动鼠标也能开（此刻焦点在顶栏 composer 上，浮层的输入框 autoFocus 会接管）。
  await page.keyboard.press('Meta+k');
  const surface = page.getByTestId('search-overlay-surface');
  await expect(surface, '⌘K 必须能打开搜索').toBeVisible();

  // ② 🔴 前提确实成立：焦点**真的**在面板输入框里。不先验这条，后面所有按键
  //    都可能是在测"焦点在别处"的另一条路（§7 元规则 2：判据要断言自己的前提）。
  await expect(
    page.getByTestId('search-panel-input'),
    '面板输入框必须自动拿到焦点，否则这套键盘判据测的不是 §7 第 80 条那条路',
  ).toBeFocused();

  await page.keyboard.type('搜索滚动锚点');
  const rows = surface.locator('[data-testid="search-panel-tasks"] [data-testid^="task-item-"]');
  // 两条命中：第一条 = 列表里的第 31 行（在屏幕外），第二条用来做"高亮 vs 没高亮"的对照。
  await expect(rows, '两条命中都该在面板里').toHaveCount(2);

  // ③ ↵ 在**没有光标**时什么都不做（光标还在输入框里 = 想接着打字）。
  await page.keyboard.press('Enter');
  await expect(surface, '光标在输入框里时回车不该关掉浮层').toBeVisible();

  // ④ ↓ 一次：光标落到第一条。高亮只有底色（`TaskRow.active`），所以判据是
  //    "第一条与第二条底色不一样"，而不是去比 token 的 rgb 字面量。
  await page.keyboard.press('ArrowDown');
  const bgOf = (index: number) =>
    rows.nth(index).evaluate((el) => getComputedStyle(el).backgroundColor);
  const firstBg = await bgOf(0);
  const secondBg = await bgOf(1);
  expect(firstBg, `↓ 之后第一条必须有高亮底色：${firstBg} vs ${secondBg}`).not.toBe(secondBg);
  await page.screenshot({ path: 'test-results/search-spotlight-cursor.png', fullPage: false });

  // ⑤ 🔴 目标行此刻在**下面那一屏**的屏幕外（31 条任务，视口 900px）。
  //    ⚠️ 必须把面板子树排除掉：浮层是非模态的，面板里那条与列表里那条
  //    **共用同一个** `data-testid="task-item-<id>"`，裸定位器会撞 strict mode，
  //    更糟的是"命中面板那条"会让这条判据量错对象。
  const targetId = (await rows.first().getAttribute('data-testid'))!.replace('task-item-', '');
  const listRow = page.locator(
    `xpath=//*[@data-testid="task-item-${targetId}"][not(ancestor::*[@data-testid="search-panel"])]`,
  );
  await expect(listRow, '列表里应当有那一行（切到「全部」之前它在筛选外）').toHaveCount(1);
  const before = await listRow.boundingBox();
  expect(before, '列表里那一行有几何').not.toBeNull();
  expect(before!.y > 900 || before!.y < 0, `前提：目标行本来在视口外（y=${before!.y}）`).toBe(true);

  // ⑥ ↵ 打开：浮层关掉 + 列表里那一行被滚进视野。
  await page.keyboard.press('Enter');
  await expect(surface, '↵ 应当打开高亮那条并关掉浮层').toHaveCount(0);
  await expect(
    page.locator(`[data-testid="task-item-${targetId}"]`),
    '↵ 之后列表里那一行必须真的在屏幕上（"点了没反应"的反面）',
  ).toBeInViewport();

  // ⑦ ⌘K 再开：此刻浮层已关、焦点回到列表 —— 证明它**不挂在 `view === 'search'` 上**，
  //    任何一屏都能按（关掉后焦点归位的断言在 `app-mount.spec.tsx` 那组）。
  await page.keyboard.press('Meta+k');
  await expect(surface, '⌘K 也能再打开').toBeVisible();
  await expect(page.getByTestId('search-panel-input')).toBeFocused();
  await page.keyboard.press('Meta+k');
  await expect(surface, '⌘K 关（与 Esc 同一个出口）').toHaveCount(0);
  await page.screenshot({ path: 'test-results/search-spotlight-after.png', fullPage: false });
});
