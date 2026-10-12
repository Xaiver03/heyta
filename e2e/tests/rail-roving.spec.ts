import { existsSync, rmSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { openApp } from './helpers';

/**
 * rail 与通知面板的键盘漫游焦点（§8.2 第 13 条）—— **真浏览器**判据
 * ================================================================
 *
 * jsdom 那一半在 `apps/web/tests/tab-roving.spec.tsx`（19 条 + 五臂变异）。
 * 这一份只钉**只有真浏览器才现形**的四格，它们各自对应一条已知的"单测看不见"的成因：
 *
 * 1. **整段导航真的只有一个 Tab 停靠点**。判据走的是真 `Tab` 键序列，不是读 `tabindex` 属性 ——
 *    `tabindex` 可以被 CSS/其它属性（`disabled`、contenteditable）推翻，
 *    而"按 Tab 会走到哪"是浏览器算出来的，只有它算的那个数才算数。
 * 2. **方向键移动焦点但不切换视图**。漫游若"顺手激活"，顺着方向键走一遍就等于把六个视图
 *    各打开一次（每次都要重算数据）。
 * 3. **焦点环真的画得出来**（`:focus-visible` 的 outline 不是 `none`）。
 *    AGENTS §5 把"不许 `outline: none`"写成硬规则，但那条规则管的是**样式源码**；
 *    这一格管的是**渲染结果** —— 漫游焦点落上去却看不见，等于键盘用户不知道自己在哪。
 * 4. 🔴 **与 dnd-kit 的 `KeyboardSensor` 共存**：焦点在 rail 按钮上按 Space 会**进入拖拽模式**，
 *    此后方向键归它（移动那一枚标签），不该同时把焦点甩走。
 *    jsdom 那一半是用一个"自己 preventDefault 的 handler"**模拟**传感器让位的；
 *    这里跑的是真传感器 —— 它到底让没让位，只有真事件能回答。
 *
 * ⚠️ 这条不与 `smoke.spec.ts` 的 rail tab 计数对打：它数的是 `[role="tab"]`，
 * 而「帮助」「铃铛」是普通 button（故意不给 `role="tab"`，见 `InboxBell.tsx` 文件头）。
 *
 * 截图走固定路径，采集前清掉同名旧图（§6.2 第 2 条）。
 */

const RAIL_TABS = 'nav.ht-rail [role="tab"]';
const SHOTS = ['rail-roving-1-focus-ring.png', 'rail-roving-2-inbox-panel.png'];

test.beforeEach(() => {
  for (const name of SHOTS) {
    const p = `test-results/${name}`;
    if (existsSync(p)) rmSync(p);
  }
});

/** 当前焦点元素的身份：testid 优先，退回类名，用于"焦点在哪一枚"的逐条断言。 */
const activeId = (page: import('@playwright/test').Page): Promise<string | null> =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (el === null) return null;
    return el.dataset.testid ?? `${el.tagName}.${el.className}`;
  });

const railTabIds = (page: import('@playwright/test').Page): Promise<string[]> =>
  page.$$eval(RAIL_TABS, (tabs) =>
    tabs.map((t) => (t as HTMLElement).dataset.testid ?? `${(t as HTMLElement).className}`),
  );

test('rail：Tab 只进来一次、方向键只挪焦点不切视图、焦点环看得见', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);

  const tabs = page.locator(RAIL_TABS);
  const tabIds = await railTabIds(page);
  expect(tabIds.length, 'rail 上至少要有一组标签').toBeGreaterThan(2);

  // ① 整段导航**一个停靠点**：DOM 属性层。
  const zeroCount = await tabs.evaluateAll((els) => els.filter((el) => el.getAttribute('tabindex') === '0').length);
  expect(zeroCount, 'rail 的 role=tab 里必须恰好一枚进 Tab 序列').toBe(1);

  // ② 浏览器算出来的那一个：真按 Tab 走进 rail，然后**再按一下 Tab 不许落在另一枚标签上**。
  //    （判"相邻两枚标签之间不隔 Tab"比"数整圈里进几次"稳 —— Chromium 的 Tab 在文档末尾会绕回，
  //    绕回那一次也算"进过 rail"，数次数会把好实现读成红。）
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  let railStop = '';
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate(() => {
      const nav = document.querySelector('nav.ht-rail');
      const active = document.activeElement as HTMLElement | null;
      if (nav === null || active === null || !nav.contains(active)) return null;
      if (active.getAttribute('role') !== 'tab' || active.closest('[role="dialog"]') !== null) return null;
      return active.dataset.testid ?? active.className;
    });
    if (hit !== null) {
      railStop = hit;
      break;
    }
  }
  expect(railStop, `按 Tab 必须能走进 rail 的标签组（实测一枚都没命中）`).not.toBe('');
  const nextAfterTab = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return active?.dataset.testid ?? active?.className ?? '';
  });
  await page.keyboard.press('Tab');
  const oneMore = await page.evaluate(() => {
    const nav = document.querySelector('nav.ht-rail');
    const active = document.activeElement as HTMLElement | null;
    return nav !== null && active !== null && nav.contains(active) && active.getAttribute('role') === 'tab';
  });
  expect(oneMore, 'Tab 不该把六枚标签挨个走一遍 —— 整组只许一个停靠点').toBe(false);

  // ③ 方向键**移动焦点**，且**不切换视图**：主区那块任务界面还在。
  //
  // 🔴 这里必须**先把焦点放回组里**再按方向键。上面那一按已经证明"第二下 Tab 会离开标签组"
  //    —— 那是这一步**要的结论**，但它同时把焦点留在了**组外**（实测落在 `rail-help` 那枚
  //    `role` 为 null 的按钮上）。此时再按 ArrowDown，漫游的守卫
  //    （`onTabRovingKeyDown` 开头那句 `target.getAttribute('role') !== 'tab'` 就 return）
  //    会**正确地**什么都不做 —— 于是这条断言测的是"组外按方向键不动"，而不是
  //    "组内方向键挪焦点"。第一版就是这么写的，它**在正确实现上也会红**。
  const groupTabs = page.locator(RAIL_TABS);
  await groupTabs.first().focus();
  const before = await activeId(page);
  // 主区那块任务界面：漫游**不许**把它换掉。
  const taskInput = page.locator('input[placeholder^="添加任务"]');
  await expect(taskInput, '漫游前主区是任务视图').toBeVisible();
  await page.keyboard.press('ArrowDown');
  const after = await activeId(page);
  expect(after, 'ArrowDown 必须把焦点交给组里的下一枚').not.toBe(before);
  await expect(taskInput, '🔴 漫游不许激活视图：主区不能因为按了一下方向键就换掉').toBeVisible();

  // ④ 走到组尾再按一下是**回绕**，不是掉出组外。
  for (let i = 0; i < tabIds.length + 2; i += 1) await page.keyboard.press('ArrowDown');
  const wrapped = await page.evaluate(() => {
    const nav = document.querySelector('nav.ht-rail');
    const active = document.activeElement;
    return nav !== null && active !== null && nav.contains(active) && active.getAttribute('role') === 'tab';
  });
  expect(wrapped, '方向键走到尽头要回绕，焦点不许掉出标签组').toBe(true);

  // ⑤ 焦点**真的看得见**（渲染结果，不是样式源码）。
  //
  // 🔴 这一格第一版写的是 `expect(outlineStyle).not.toBe('none')` —— **它测错了属性**，
  //    在**正确实现上恒红**。本产品的焦点表达方式是产品负责人 2026-10-07 定的
  //    **无描边交互**（`apps/web/src/styles/app/borderless-controls.css` 文件头）：
  //    描边被显式 `outline: 0 !important` 抹掉，焦点改由**底色 + 字色**表达：
  //
  //    | 通道 | 未聚焦 | 聚焦（落定后） |
  //    |---|---|---|
  //    | outline | `none` / `0px` | `none` / `0px`（**故意**） |
  //    | background-color | `rgba(0,0,0,0)` | `rgb(239,246,255)`（`--ht-color-primary-subtle`） |
  //    | color | `rgb(71,85,105)` | `rgb(37,99,235)`（`--ht-color-primary`） |
  //
  //    正确的判据是「**三个通道里至少有一个真的变了**」——
  //    它同时守住 AGENTS §5 那条"抹掉焦点环是最常见的可访问性回归"的**意图**
  //    （焦点必须可见），而不去规定**用哪个通道**表达。
  //
  // 🔴 **必须等 transition 落定再采样 —— 这一条踩过。**
  //    第一版量的时候我在聚焦后**立刻**读，读到 `rgba(239,246,255,0.118)`：
  //    那是底色从透明过渡到 `#eff6ff` 的**中间帧**。我据此误判成"焦点完全不可见"，
  //    还差点去改产品。`--ht-duration-fast` 之内不许下结论（§7「先怀疑探针」）。
  const RAIL_TAB_CHANNELS = (id: string) =>
    page.evaluate((testid) => {
      const el = document.querySelector(`[data-testid="${testid}"]`);
      if (el === null) return null;
      const c = getComputedStyle(el);
      return { outline: Number.parseFloat(c.outlineWidth), bg: c.backgroundColor, color: c.color };
    }, id);
  /** "至少在**一个**通道上看得出来"——这就是这一格要守的不变量。 */
  const isVisible = (
    base: { outline: number; bg: string; color: string } | null,
    now: { outline: number; bg: string; color: string } | null,
  ): boolean => now !== null && base !== null && (now.outline > 0 || now.bg !== base.bg || now.color !== base.color);

  // 基线必须在**全未聚焦**时取 —— 此刻还没按过 Tab。
  // 🔴 不能"先聚焦、再 blur 取基线、再 focus 回来"：程序化 `el.focus()` **不保证**触发
  //    `:focus-visible`（实测 `PROG_FOCUS` 那一档 `focusVisible === false`，
  //    而真按 Tab 那一档才是 `true`）。那样取到的"聚焦态"会是一份假的未聚焦读数。
  const baselineAll = await page.evaluate(() => {
    const out: Record<string, { outline: number; bg: string; color: string }> = {};
    document.querySelectorAll('nav.ht-rail [role="tab"]').forEach((el) => {
      const h = el as HTMLElement;
      const c = getComputedStyle(h);
      out[h.dataset.testid ?? h.className] = {
        outline: Number.parseFloat(c.outlineWidth),
        bg: c.backgroundColor,
        color: c.color,
      };
    });
    return out;
  });

  // 真键盘走进组里（与 ② 同一套判定），再**等 transition 落定**。
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate(() => {
      const nav = document.querySelector('nav.ht-rail');
      const a = document.activeElement as HTMLElement | null;
      return nav !== null && a !== null && nav.contains(a) && a.getAttribute('role') === 'tab';
    });
    if (hit) break;
  }
  await page.waitForTimeout(800);
  const focusedId = await page.evaluate(
    () => (document.activeElement as HTMLElement | null)?.dataset?.testid ?? null,
  );
  expect(focusedId, '取不到聚焦那一枚的 testid').not.toBeNull();
  const baseline = baselineAll[focusedId!] ?? null;
  const focused = await RAIL_TAB_CHANNELS(focusedId!);

  expect(baseline, `基线上没有 ${focusedId}`).not.toBeNull();
  expect(
    isVisible(baseline, focused),
    `🔴 焦点必须至少在**一个**通道上看得出来（描边 / 底色 / 字色）。` +
      `实测基线 ${JSON.stringify(baseline)} vs 聚焦 ${JSON.stringify(focused)}`,
  ).toBe(true);
  // 描边那一档单独留一条**否定**断言：本产品是刻意的无描边，
  // 哪天有人把 `borderless-controls.css` 那条 `outline: 0 !important` 去掉，
  // 这里会红 —— 那是产品决定的变更，该由改动者连判据一起改，不该悄悄发生。
  expect(
    focused!.outline,
    '本产品刻意无描边（borderless-controls.css 文件头，产品负责人 2026-10-07）；描边回来了说明那条决定被单方面改掉',
  ).toBe(0);

  // 截图必须在断言之**前**落盘（失败时也要有图，§6.2 第 1 条）。
  await page.screenshot({ path: `test-results/${SHOTS[0]}` });

  // 🔴 两头对照：**把三个通道一起按回基线**，同一把尺必须读到"不可见"，撤掉又变回来。
  //    不注入就永远读不到"它本来能不能红"—— 一条在任何情况下都绿的判据比没有判据更糟。
  //
  // ⚠️ 注入的值必须**逐字取自基线**，不能写 `color: inherit` —— 第一版就是这么写的，
  //    结果 `inherit` 从父元素继承来一个**新的**颜色（≠ 基线色），于是"抹掉"反而把
  //    颜色通道**打开了**，两头对照读到"可见"而红。这是"变异没进被测判据"那一族的变体：
  //    变异的意图是"关掉"，实际效果是"改成了另一个值"。
  const blind = await page.evaluate(
    async ({ testid, bg, color }) => {
      const el = document.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;
      if (el === null) return null;
      const style = document.createElement('style');
      // ⚠️ 选择器必须带上 `[role='tab']` 与 `:focus-visible` —— 单写 `[data-testid=…]`
      //    只有 (0,1,0)，而同为 `!important` 时**特异性高者赢**，被测的那条
      //    `borderless-controls.css` 的 `:is(…):focus-visible` 是 (0,2,0) ⇒ 注入会被它压掉，
      //    两头对照会读到"仍然可见"而假红。这是"变异没进产物"那一族的 CSS 版本。
      //    写成 `[role='tab'][data-testid=…]:focus-visible` = (0,3,0)，稳压它。
      style.textContent =
        `[role='tab'][data-testid="${testid}"]:focus-visible {` +
        ` outline: 0 !important; background-color: ${bg} !important; color: ${color} !important; }`;
      document.head.append(style);
      await new Promise((r) => setTimeout(r, 800));
      const c = getComputedStyle(el);
      const reading = { outline: Number.parseFloat(c.outlineWidth), bg: c.backgroundColor, color: c.color };
      style.remove();
      await new Promise((r) => setTimeout(r, 800));
      return reading;
    },
    { testid: focusedId!, bg: baseline!.bg, color: baseline!.color },
  );
  expect(blind, '取不到"抹掉三通道"后的读数').not.toBeNull();
  expect(
    isVisible(baseline, blind),
    '🔴 把三个通道一起按回基线后，这把尺必须读到"不可见"（否则它是恒真的）',
  ).toBe(false);
  expect(blind!.outline, '连描边都该被注入抹成 0').toBe(0);

  const restored = await RAIL_TAB_CHANNELS(focusedId!);
  expect(
    isVisible(baseline, restored),
    '撤掉注入后必须回到"可见"（证明上面那次"不可见"是注入造成的，不是环境）',
  ).toBe(true);
});

test('通知面板：面板自己是一对横向标签，方向键在它里面走，不与 rail 混成一组', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);

  await page.getByTestId('inbox-trigger').click();
  const panel = page.getByTestId('inbox-panel');
  await expect(panel, '点铃铛要真的把面板挂出来').toBeVisible();

  const panelTabs = panel.locator('[role="tab"]');
  expect(
    await panelTabs.evaluateAll((els) => els.filter((el) => el.getAttribute('tabindex') === '0').length),
    '面板那两枚里恰好一枚进 Tab 序列',
  ).toBe(1);

  const ids = await panelTabs.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.testid ?? ''));
  await panelTabs.first().focus();
  await page.keyboard.press('ArrowRight');
  expect(await activeId(page), '横向组里 ArrowRight 要走到第二枚').toBe(ids[1]);
  await page.keyboard.press('ArrowRight');
  expect(await activeId(page), '走到尽头回绕回首枚').toBe(ids[0]);
  // 轴不共用：纵向键在横向组里不许有事。
  await page.keyboard.press('ArrowDown');
  expect(await activeId(page), '纵向键不该在横向组里移动焦点').toBe(ids[0]);

  await page.screenshot({ path: `test-results/${SHOTS[1]}` });

  // 🔴 面板的标签**不算进 rail 那一组**：rail 里按方向键走到尽头仍回绕在 rail 内。
  const railOnly = await page.$$eval(RAIL_TABS, (els) =>
    els
      .filter((el) => el.closest('[role="dialog"]') === null)
      .map((el) => (el as HTMLElement).dataset.testid ?? String(el.className)),
  );
  await page.locator(`[data-testid="${railOnly[0]}"]`).focus();
  for (let i = 0; i < railOnly.length + 2; i += 1) await page.keyboard.press('ArrowDown');
  expect(
    await page.evaluate(() => (document.activeElement as HTMLElement).closest('[role="dialog"]') === null),
    '从 rail 按方向键不许跳进通知面板（两个焦点圈不能并成一个）',
  ).toBe(true);
});

test('🔴 与 dnd-kit KeyboardSensor 共存：Space 进入拖拽后方向键不再挪焦点', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);

  const tabIds = await railTabIds(page);
  const target = page.locator(`[data-testid="${tabIds[1]}"]`);
  await target.focus();
  const before = await activeId(page);

  await page.keyboard.press('Space');
  await expect
    .poll(() => page.evaluate(() => document.body.classList.contains('rl-Dragging') || document.querySelectorAll('.ht-rail__item--dragging').length > 0), {
      message: '按 Space 要真的进入 dnd-kit 的键盘拖拽模式，否则这一条测的不是共存',
    })
    .toBe(true);

  await page.keyboard.press('ArrowDown');
  const during = await activeId(page);
  expect(during, '拖拽中方向键归 KeyboardSensor，焦点不许被漫游甩走（那是"一边拖一边跳"）').toBe(before);

  // 收场：Esc 取消拖拽（不留状态给后续用例，也验一次能退出）。
  await page.keyboard.press('Escape');
  await expect
    .poll(() => page.evaluate(() => document.querySelectorAll('.ht-rail__item--dragging').length === 0))
    .toBe(true);
});
