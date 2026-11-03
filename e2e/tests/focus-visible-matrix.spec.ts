/**
 * 全局键盘焦点矩阵：焦点必须与 hover、pressed、selected 分离。
 *
 * 🔴 本文件是「设计系统 §10.2 状态矩阵」的真实浏览器判据。它故意用键盘 Tab
 * 取得 `:focus-visible`，不用 locator.focus()，否则测到的是程序化聚焦，而不是
 * 用户按下 Tab 后浏览器实际采用的焦点表现。
 */

import { expect, test, type Page } from '@playwright/test';

import { expectFocusRing, ringBandPaddingPx, visibleFocusRing, type FocusRingReading } from './focus-ring';
import { openApp, parkCursor, switchTheme, switchView } from './helpers';

const APP_ZH = '/?lang=zh-CN';
const EVIDENCE_DIR = '../apps/web/evidence/focus-visible-matrix';

function watchConsole(page: Page): string[] {
  const lines: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') lines.push(`[console.error] ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    lines.push(`[pageerror] ${error.message}`);
  });
  return lines;
}

/**
 * 读焦点态。`outline*` / `boxShadow` / `ringColor` 一并读回来交给
 * `./focus-ring` 那一份共用判据 —— 环画在哪个属性上是实现细节，
 * 判据只认"画面上有没有一圈环"（理由见那个文件头注释）。
 */
function readFocusState(page: Page, selector: string) {
  return page.evaluate((target) => {
    const el = document.querySelector<HTMLElement>(target);
    if (!el) throw new Error(`找不到焦点探针目标：${target}`);
    const style = getComputedStyle(el);
    const ringProbe = document.createElement('span');
    ringProbe.style.cssText = 'position:absolute;visibility:hidden;color:var(--ht-color-ring)';
    document.body.appendChild(ringProbe);
    const ringColor = getComputedStyle(ringProbe).color;
    ringProbe.remove();
    return {
      isFocused: document.activeElement === el,
      focusVisible: el.matches(':focus-visible'),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      outlineOffset: style.outlineOffset,
      boxShadow: style.boxShadow,
      backgroundColor: style.backgroundColor,
      color: style.color,
      ringColor,
    };
  }, selector);
}

async function tabUntilSelected(page: Page): Promise<void> {
  const selected = page.getByRole('tab', { selected: true }).first();
  await expect(selected).toBeVisible();
  const identity = await selected.evaluate((el) => {
    el.setAttribute('data-focus-probe', 'selected-tab');
    return '[data-focus-probe="selected-tab"]';
  });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if ((await readFocusState(page, identity)).isFocused) return;
    await page.keyboard.press('Tab');
  }

  throw new Error('连续 Tab 80 次仍未聚焦当前选中的 rail tab，焦点矩阵探针没有测到目标');
}

/**
 * 🔴 用**真键盘 Tab**走到目标控件，不许用 `locator.focus()`。
 *
 * 两个理由，第二个是踩过的：
 *   1. 程序化 `el.focus()` **不保证**触发 `:focus-visible`，量到的是假的未聚焦读数
 *      （本仓 `rail-roving.spec.ts` 记着这条实测）。
 *   2. 第一版这里写的是「聚焦 `calendar-toolbar-prev` 再 Shift+Tab 回上一枚」——
 *      它把**某一种页头排布**当成了不变量。375 档页头那一行会重排，
 *      `calendar-toolbar-prev` 根本不在开关的下一位，于是证据腿超时。
 *      从文档开头连续 Tab 才是两端都成立的路径。
 */
async function tabUntilTestId(page: Page, testId: string): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
  });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const focused = await page.evaluate(
      (id) => document.activeElement?.getAttribute('data-testid') === id,
      testId,
    );
    if (focused) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`连续 Tab 80 次仍未走到 [data-testid="${testId}"]，焦点探针没有测到目标`);
}

/** 进日历视图。🔴 必须走 `switchView`：≤768 档渲染的是 compact rail 的普通 button，`role="tab"` 不存在。 */
async function openCalendar(page: Page): Promise<void> {
  await switchView(page, '日历');
  await expect(page.locator('.ht-header__title')).toContainText('日历');
}

test('正对照臂：文本输入必须始终有可见焦点环', async ({ page }) => {
  const consoleLines = watchConsole(page);
  await openApp(page, APP_ZH);

  const composer = page.locator('input[placeholder^="添加任务"]');
  await composer.click();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(composer).toBeFocused();

  /*
   * 🔴 2026-11-03 改判据（**不是放宽**）：原来量 `outline-style !== 'none'`。
   * 输入类控件的环同一天从 `outline` 换成了 `box-shadow` —— 理由是 WebKit 的
   * `outline` 不跟随 `border-radius`，产品负责人看着对话输入框问「为什么这个对话框
   * 还是没有圆角」。环还在画面上（`e2e/test-results/focus-visible-matrix-正对照臂…/
   * test-failed-1.png` 那圈蓝环清楚可见且跟着圆角走），只是不再画在 `outline` 上。
   * 所以这里改成共用判据 `visibleFocusRing()`：`outline` 形态与 `box-shadow` 形态
   * 都算，且 `box-shadow` 那一支要求 0 偏移 / 0 模糊 / spread > 0 / 颜色 = `--ht-color-ring`
   * —— 装饰投影不会被认成焦点环（牙齿在这里）。
   */
  const focusVisible = await composer.evaluate((el) => el.matches(':focus-visible'));
  await page.screenshot({ path: 'test-results/focus-positive-input.png' });

  expect(focusVisible, '正对照臂没有进入 :focus-visible，探针通路失效').toBe(true);
  const ring = await expectFocusRing(composer, { minWidthPx: 1, message: '文本输入焦点环不见了' });
  expect(ring.widthPx, `文本输入焦点环只有 ${String(ring.widthPx)}px`).toBeGreaterThanOrEqual(1);
  expect(consoleLines, `焦点探针期间出现控制台错误：${consoleLines.join('\n')}`).toEqual([]);
});

test('🔴 当前已选中的 rail tab 聚焦时必须有独立焦点环，且不得靠换底色表达焦点', async ({ page }) => {
  const consoleLines = watchConsole(page);
  await openApp(page, APP_ZH);

  const selected = page.getByRole('tab', { selected: true }).first();
  const before = await selected.evaluate((el) => {
    const style = getComputedStyle(el);
    el.setAttribute('data-focus-probe', 'selected-tab');
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      selector: '[data-focus-probe="selected-tab"]',
    };
  });

  await tabUntilSelected(page);
  await page.screenshot({ path: 'test-results/focus-selected-tab.png' });

  const after = await readFocusState(page, before.selector);
  expect(after.isFocused, 'selected rail tab 没有真的获得焦点').toBe(true);
  expect(after.focusVisible, '键盘 Tab 后浏览器未采用 :focus-visible，焦点探针通路失效').toBe(true);
  // 这一枚是 `role="tab"`（不是输入类），环仍走 `outline` 那一支 —— 共用判据两边都认，
  // 所以这里不需要知道它画在哪个属性上，只量"有没有一圈 ≥ 2px 的环"。
  const ring = visibleFocusRing(after);
  expect(
    ring,
    `已选中控件的键盘焦点环不见了：判据接受 outline 与 box-shadow 两种形态，读数 ${JSON.stringify(after)}`,
  ).not.toBeNull();
  expect(ring!.widthPx, `已选中控件焦点环只有 ${String(ring!.widthPx)}px，不足 2px`).toBeGreaterThanOrEqual(2);
  expect(after.backgroundColor, '键盘焦点不得改变控件底色；焦点与选中态必须分离').toBe(before.backgroundColor);
  expect(consoleLines, `焦点矩阵期间出现控制台错误：${consoleLines.join('\n')}`).toEqual([]);
});

/**
 * 🔴 「计算值有环」≠「画面上看得见环」—— 这一条量的是**渲染结果**。
 *
 * 环带 = 盒子外扩"环的外沿"：`outline` 是 `outline-offset + outline-width`（offset 为负
 * 就是内缩），`box-shadow` 是 spread（环画在盒子内侧时外扩 0）。见 `./focus-ring`
 * 的 `ringBandPaddingPx()` —— 两种形态各算各的外沿，判据只有一份。
 *
 * 判据不写"有没有环"，写"**四条边都落在能画出来的区域里**"：
 * 既要落在视口里，也要落在**每一个裁剪祖先**里 —— 向外的焦点环会被
 * `overflow` 非 `visible` 的祖先裁掉（`outline` 与 `box-shadow` 都一样：
 * 阴影是画在盒子外面的，滚动容器照样切）。只量视口的话，这一格会假绿。
 */
function measureRingBand(page: Page, selector: string | null) {
  return page.evaluate((target) => {
    const el = target === null
      ? document.activeElement as HTMLElement | null
      : document.querySelector<HTMLElement>(target);
    if (!el) throw new Error(`找不到焦点环测量目标：${String(target ?? 'activeElement')}`);
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const ringProbe = document.createElement('span');
    ringProbe.style.cssText = 'position:absolute;visibility:hidden;color:var(--ht-color-ring)';
    document.body.appendChild(ringProbe);
    const ringColor = getComputedStyle(ringProbe).color;
    ringProbe.remove();
    const clips: { name: string; top: number; left: number; right: number; bottom: number }[] = [];
    let node = el.parentElement;
    while (node !== null) {
      const nodeStyle = getComputedStyle(node);
      if (nodeStyle.overflowX !== 'visible' || nodeStyle.overflowY !== 'visible') {
        const rect = node.getBoundingClientRect();
        clips.push({
          name: `${node.tagName.toLowerCase()}.${node.className}`.slice(0, 60),
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
        });
      }
      node = node.parentElement;
    }
    return {
      box: {
        top: Math.round(box.top),
        left: Math.round(box.left),
        right: Math.round(box.right),
        bottom: Math.round(box.bottom),
      },
      reading: {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor,
        outlineOffset: style.outlineOffset,
        boxShadow: style.boxShadow,
        backgroundColor: style.backgroundColor,
        ringColor,
      },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      clips,
    };
  }, selector);
}

/** 环带四边（盒子外扩 `ringBandPaddingPx()` 那么多）。 */
function ringBand(reading: { box: { top: number; left: number; right: number; bottom: number }; reading: FocusRingReading }) {
  const pad = Math.round(ringBandPaddingPx(reading.reading));
  return {
    top: reading.box.top - pad,
    left: reading.box.left - pad,
    right: reading.box.right + pad,
    bottom: reading.box.bottom + pad,
  };
}

function ringEdgesOutside(
  reading: Awaited<ReturnType<typeof measureRingBand>>,
): string[] {
  const band = ringBand(reading);
  const { viewport, clips } = reading;
  const bounds = [{
    name: '视口',
    top: 0,
    left: 0,
    right: viewport.width,
    bottom: viewport.height,
  }, ...clips];
  const problems: string[] = [];
  for (const bound of bounds) {
    if (band.top < bound.top) problems.push(`上边 ${band.top} < ${bound.name} ${bound.top}`);
    if (band.left < bound.left) problems.push(`左边 ${band.left} < ${bound.name} ${bound.left}`);
    if (band.right > bound.right) problems.push(`右边 ${band.right} > ${bound.name} ${bound.right}`);
    if (band.bottom > bound.bottom) problems.push(`下边 ${band.bottom} > ${bound.name} ${bound.bottom}`);
  }
  return [...new Set(problems)];
}

test('🔴 已选中 rail tab 的焦点环四条边都必须真的画得出来（不被视口与裁剪祖先切掉）', async ({ page }) => {
  const consoleLines = watchConsole(page);
  await openApp(page, APP_ZH);

  const selected = page.getByRole('tab', { selected: true }).first();
  await expect(selected).toBeVisible();
  await tabUntilSelected(page);
  await parkCursor(page);
  await page.screenshot({ path: 'test-results/focus-selected-tab-ring-band.png' });

  const reading = await measureRingBand(page, '[data-focus-probe="selected-tab"]');
  expect(
    visibleFocusRing(reading.reading),
    `焦点环被抹掉了，后面的可见性判定没有意义：读数 ${JSON.stringify(reading.reading)}`,
  ).not.toBeNull();
  expect(
    ringEdgesOutside(reading),
    `🔴 焦点环有边被裁掉 ⇒ 图上只看得见一条线，用户读到的是"这里多了条线"而不是"焦点进来了"。`
      + `读数 ${JSON.stringify(reading)}`,
  ).toEqual([]);
  expect(consoleLines, `焦点环可见性期间出现控制台错误：${consoleLines.join('\n')}`).toEqual([]);
});

/**
 * 🔴 同类缺陷要一次找全，不是修眼前这一枚。
 *
 * 「环被裁剪容器切掉」的成因是**容器**（`overflow` 非 visible）与**控件贴边**，
 * 而本仓有一整族这样的容器（rail、`.ht-viewtabs`、侧栏列表、塌缩档底部导航）。
 * 逐条手写用例永远追不上，所以这里把判据下成一句全称命题：
 * **键盘能走到的每一枚控件，焦点环的四条边都必须画得出来。**
 *
 * ⚠️ 它只量"画得出来"，不判"好不好看"；也不替代上面那三条定点判据
 *    （那三条钉的是选中态与焦点分离、以及全局规则不被局部重画）。
 */
/** 扫一遍某个视图：键盘走到的每一枚控件，环带四边都要画得出来。 */
async function sweepView(
  page: Page,
  view: string,
  maxStops: number,
): Promise<{ offenders: string[]; stops: number }> {
  const offenders: string[] = [];
  const visited = new Set<string>();
  await switchView(page, view);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
  });

  for (let step = 0; step < maxStops; step += 1) {
    await page.keyboard.press('Tab');
    const identity = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.outerHTML.slice(0, 120) ?? null,
    );
    if (identity === null) break;
    // 走出文档时 activeElement 会落回 `body` —— 它不是控件，量它只会造出假告。
    if (/^<(body|html)[\s>]/.test(identity)) continue;
    if (visited.has(identity)) break;
    visited.add(identity);

    const label = await page.evaluate(
      () => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return null;
        return [
          el.tagName.toLowerCase(),
          el.getAttribute('data-testid') ?? null,
          el.getAttribute('role') ?? null,
          el.className ? `.${String(el.className).split(/\s+/)[0]}` : null,
        ].filter((part) => part !== null).join(' ');
      },
    );
    const reading = await measureRingBand(page, null);
    const problems = ringEdgesOutside(reading);
    const ring = visibleFocusRing(reading.reading);
    if (ring === null) {
      offenders.push(`${label}：没有焦点环（outline 与 box-shadow 两种形态都没量到）`);
    } else if (problems.length > 0) {
      offenders.push(`${label}：${problems.join('；')}（环画在 ${ring.source} 上，外扩 ${String(ring.widthPx)}px）`);
    }
  }
  return { offenders, stops: visited.size };
}

for (const view of ['任务', '日历', '习惯', '便签', '回收站']) {
  test(`🔴 扫描「${view}」：键盘走到的每一枚控件，焦点环四条边都画得出来`, async ({ page }) => {
    const consoleLines = watchConsole(page);
    const offenders: string[] = [];
    for (const size of [
      { label: '1440', width: 1440, height: 900 },
      { label: '375', width: 375, height: 844 },
    ]) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openApp(page, APP_ZH);
      const found = await sweepView(page, view, 22);
      // 🔴 一条永远绿的扫描比没有扫描更糟 —— 先证明它真的走到了东西。
      expect(found.stops, `[${size.label}]「${view}」键盘只走了 ${found.stops} 站，分母不成立`).toBeGreaterThanOrEqual(4);
      offenders.push(...found.offenders.map((line) => `[${size.label}] ${line}`));
    }
    expect(
      offenders,
      `🔴 「${view}」有 ${offenders.length} 枚控件的焦点环在画面上不完整（环带被视口或裁剪容器切掉，`
        + `或根本没有环）。成因是一族：滚动容器会裁掉画在盒子外面的环 —— \`outline\` 与 `
        + `\`box-shadow\` 一样（阴影同样画在盒子外侧）。修法是那一层把 \`--ht-focus-ring-offset\` `
        + `指成负数（表在 borderless-controls.css），不是在那一层再画一枚环：\n${offenders.join('\n')}`,
    ).toEqual([]);
    expect(consoleLines, `焦点环扫描期间出现控制台错误：${consoleLines.join('\n')}`).toEqual([]);
  });
}

test('🔴 日历侧栏开关自己声明的焦点环不得被全局规则吃掉', async ({ page }) => {
  const consoleLines = watchConsole(page);
  await openApp(page, APP_ZH);
  await openCalendar(page);
  const toggle = page.getByTestId('calendar-sidebar-toggle');
  await expect(toggle).toBeVisible();

  const before = await toggle.evaluate((el) => {
    const style = getComputedStyle(el);
    return { backgroundColor: style.backgroundColor, color: style.color };
  });

  await tabUntilTestId(page, 'calendar-sidebar-toggle');
  await page.screenshot({ path: 'test-results/focus-calendar-toggle.png' });

  const after = await readFocusState(page, '[data-testid="calendar-sidebar-toggle"]');

  expect(after.isFocused, '连续 Tab 未走到日历侧栏开关').toBe(true);
  expect(after.focusVisible, '日历侧栏开关没有进入 :focus-visible，探针通路失效').toBe(true);
  const ring = visibleFocusRing(after);
  expect(
    ring,
    `日历侧栏开关的焦点环被全局规则抹掉了：读数 ${JSON.stringify(after)}`,
  ).not.toBeNull();
  expect(ring!.widthPx, `日历侧栏开关焦点环只有 ${String(ring!.widthPx)}px`).toBeGreaterThanOrEqual(2);
  expect(after.backgroundColor, '日历侧栏开关焦点态不得靠换底色冒充焦点环').toBe(before.backgroundColor);
  expect(consoleLines, `日历开关焦点探针期间出现控制台错误：${consoleLines.join('\n')}`).toEqual([]);
});

/**
 * 🔴 日历侧栏「全部」那一枚：环带被**侧栏自己的滚动容器**切掉三条边。
 *
 * 这一枚是「滚动容器裁掉环带」那一族里**当前还在**的实例，2026-11-03 按
 * `focus-visible-matrix` 的几何扫描（扫满 80 站，不是 22 站）量到：
 *
 *   · 元素 `[data-testid="calendar-scope-all"]`（`button.ht-sidebar__scope-all`）
 *     盒子的左/右/下三条边与 `div.ht-sidebar__calendar-body` 的裁剪边**重合**；
 *   · 环带 = `outline-offset` 1px + `outline-width` 2px = 外扩 3px
 *     ⇒ 左、右、下各出界 3px（读数 `slack=-3`），画面上只剩上边那一条线。
 *
 * 为什么会漏：`.ht-sidebar__calendar-body`（`sidebar.css:316`，`overflow-y: auto`）
 * 是 `.ht-sidebar__body` 的**兄弟**滚动容器 —— 后者已经在
 * `borderless-controls.css` 的"环往内收"名单里，前者没有。这一枚就是那份名单的缺口。
 *
 * ⇒ 判据在这里钉死，修法只有一处（那一层把 `--ht-focus-ring-offset` 指成负数），
 * 不在侧栏里再画一枚环。
 */
test('🔴 日历侧栏「全部」那一枚的焦点环四条边都画得出来（不被侧栏滚动容器切掉）', async ({ page }) => {
  const consoleLines = watchConsole(page);
  await openApp(page, APP_ZH);
  await openCalendar(page);
  const scopeAll = page.getByTestId('calendar-scope-all');
  await expect(scopeAll).toBeVisible();

  /*
   * 这一枚在整页 Tab 序里排到第 78 站左右，用 80 次 Tab 去够它既慢又脆。
   * 先按一次 Tab 把浏览器切到"键盘模态"，再程序化聚焦：Chromium 在这种情况下
   * 仍然采用 `:focus-visible` —— 下面第一条断言就是这个前提的**自检**，
   * 前提不成立会当场红，不会静默测到"未聚焦所以没有环"。
   */
  await page.keyboard.press('Tab');
  await scopeAll.focus();
  await parkCursor(page);
  await page.screenshot({ path: 'test-results/focus-calendar-scope-all.png' });

  const reading = await measureRingBand(page, '[data-testid="calendar-scope-all"]');
  const focused = await scopeAll.evaluate((el) => ({
    isFocused: document.activeElement === el,
    focusVisible: el.matches(':focus-visible'),
  }));
  expect(focused.isFocused, '日历侧栏「全部」没有拿到焦点，几何判据没有基准').toBe(true);
  expect(focused.focusVisible, '没有进入 :focus-visible，探针通路失效').toBe(true);
  expect(visibleFocusRing(reading.reading), '这一枚的焦点环不见了').not.toBeNull();
  expect(
    ringEdgesOutside(reading),
    `🔴 这一枚的环带有边被侧栏滚动容器切掉 ⇒ 图上只剩一条线，用户读到的是`
      + `"这里多了条线"而不是"焦点进来了"。读数 ${JSON.stringify(reading)}`,
  ).toEqual([]);
  expect(consoleLines, `日历侧栏焦点探针期间出现控制台错误：${consoleLines.join('\n')}`).toEqual([]);
});

for (const theme of ['light', 'dark'] as const) {
  for (const size of [
    { label: '1440', width: 1440, height: 900 },
    { label: '375', width: 375, height: 844 },
  ]) {
    test(`证据：${size.label} ${theme} 的默认、悬停与键盘焦点`, async ({ page }) => {
      const consoleLines = watchConsole(page);
      await page.setViewportSize({ width: size.width, height: size.height });
      await openApp(page, APP_ZH);
      if (theme === 'dark') await switchTheme(page, 'dark');
      await page.setViewportSize({ width: size.width, height: size.height });

      if (size.width >= 1200) {
        await tabUntilSelected(page);
        await page.screenshot({ path: `${EVIDENCE_DIR}/selected-tab-${size.label}-${theme}.png` });
      }

      await openCalendar(page);
      const toggle = page.getByTestId('calendar-sidebar-toggle');
      await expect(toggle).toBeVisible();
      await parkCursor(page);
      await page.screenshot({ path: `${EVIDENCE_DIR}/calendar-default-${size.label}-${theme}.png` });

      await toggle.hover();
      await page.screenshot({ path: `${EVIDENCE_DIR}/calendar-hover-${size.label}-${theme}.png` });

      await tabUntilTestId(page, 'calendar-sidebar-toggle');
      await expect(toggle).toBeFocused();
      await page.screenshot({ path: `${EVIDENCE_DIR}/calendar-focus-${size.label}-${theme}.png` });

      const state = await readFocusState(page, '[data-testid="calendar-sidebar-toggle"]');
      expect(state.focusVisible).toBe(true);
      const ring = visibleFocusRing(state);
      expect(ring, `证据腿的焦点环不见了：读数 ${JSON.stringify(state)}`).not.toBeNull();
      expect(ring!.widthPx).toBeGreaterThanOrEqual(2);
      expect(consoleLines, `焦点证据期间出现控制台错误：${consoleLines.join('\n')}`).toEqual([]);
    });
  }
}
