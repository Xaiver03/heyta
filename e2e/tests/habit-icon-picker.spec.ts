/**
 * 原创习惯图标的真实 Web 验收。
 * 核对 24 枚图片加载、选择前后的实际图片字节、刷新持久化、恢复默认、
 * 列表与选择器一致，以及全部选项的横向边界。
 * 默认图标仍从旧 8 项稳定派生；选择时主动挑不同图片，避免无写入也通过。
 * 浏览器证据不替代移动端与最终安装产物验收。
 */
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

import { addHabit, boxOf, openApp, selectHabit, switchView } from './helpers';

const APP_ZH = '/?lang=zh-CN';

/** 截图落**固定路径**（§6.2 规定一第 2 条）。 */
const SHOT = (name: string) =>
  fileURLToPath(new URL(`../../apps/web/evidence/habit-icon-picker/${name}.png`, import.meta.url));

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  // 🔴 监听在导航之前挂上：挂晚了收不到加载期错误，"控制台无内容"是最误导人的读数。
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));
  return errors;
}

/** Compare the actual decoded artwork, not a selection marker or a fallback glyph. */
const shapeOf = (el: Element): string => {
  const image = el as HTMLImageElement;
  if (!image.complete || image.naturalWidth === 0) throw new Error('习惯插画尚未成功解码');
  return image.currentSrc || image.src;
};

/** 行首那个字形的形状。 */
const rowGlyph = (page: Page, name: string) =>
  page
    .locator('[data-testid^="habit-row-"]')
    .filter({ hasText: name })
    .first()
    .locator('.ht-habit__disc img')
    .evaluate(shapeOf);

/** 先读选项的已解码图片，再点击，避免把异步更新前的行首作为预期值。 */
async function otherGlyphOption(
  page: Page,
  currentShape: string,
): Promise<{ index: number; label: string; shape: string }> {
  const cells = page.locator('.ht-habit__icon-option');
  const n = await cells.count();
  expect(n, '选择器没展开出格子 ⇒ 无从挑一格不同的').toBeGreaterThan(1);
  for (let i = 0; i < n; i += 1) {
    const artwork = cells.nth(i).locator('img');
    if ((await artwork.count()) === 0) continue;
    const shape = await artwork.first().evaluate(shapeOf);
    if (shape && shape !== currentShape) {
      return { index: i, label: (await cells.nth(i).getAttribute('aria-label')) ?? '', shape };
    }
  }
  throw new Error(`选项里没有一格与当前行首字形不同（before=${currentShape.slice(0, 48)}）`);
}

/**
 * 展开选择器（点那颗「图标」按钮）。
 *
 * 🔴 **选定之后必须再展开一次才能读选中态**：`HabitIconPicker` 在 `onChange` 之后
 *    会 `setOpen(false)`（选完就收起来，这是刻意的产品行为），所以那一排选项
 *    **已经从 DOM 里消失**。第一版这四条判据全部红在"等 90 秒超时"或"count 0"上，
 *    看起来像"选中态没写对"，其实是用例在对着一个已经关掉的浮层打分。
 */
async function openPicker(page: Page, name: string): Promise<void> {
  await page
    .getByRole('button', { name: `为「${name}」选图标` })
    .first()
    .click();
  await expect(page.locator('.ht-habit__icon-options')).toBeVisible();
}

test.describe('习惯图标选择器（H3，web 端）', () => {
  test('I1 展开后24枚原创插画都在，且有「默认」那一格', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, APP_ZH);
    await switchView(page, '习惯');
    await addHabit(page, '喝水');

    await selectHabit(page, '喝水');
    await openPicker(page, '喝水');
    // 本轮产品要求 24 枚原创素材；用固定验收数量避免源数据漏项也一起变绿。
    const closedSet = await page
      .locator('.ht-habit__icon-option')
      .filter({ has: page.locator('img') })
      .count();
    expect(closedSet, `闭集插画不是 24 个（实际 ${String(closedSet)}）`).toBe(24);
    await expect(
      page.getByRole('button', { name: '「喝水」用默认图标' }),
      '少了「默认」那一格 —— 挑过就退不回去',
    ).toBeVisible();
    await page.screenshot({ path: SHOT('picker-open') });
    expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
  });

  test('I2 点一格 ⇒ 清单那一行的字形真的换了', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, APP_ZH);
    await switchView(page, '习惯');
    await addHabit(page, '晨跑');

    await selectHabit(page, '晨跑');
    const before = await rowGlyph(page, '晨跑');
    await openPicker(page, '晨跑');
    const pick = await otherGlyphOption(page, before);
    await page.locator('.ht-habit__icon-option').nth(pick.index).click();

    // 🔴 比的是**形状**：只看"某个按钮按下了"挡不住"state 换了而 svg 没换"。
    // 🔴 而且要等于**点下去的那一格**，不是只"与之前不同" —— 后者在"点月亮画出水杯"
    //    时照样绿。这一句在改之前是 `!== before`，那是 `otherGlyphOption` 之前的形状：
    //    当时没有"点之前先从那一格取形状"这个动作，也就没有可用的基准。
    await expect
      .poll(async () => await rowGlyph(page, '晨跑'), {
        message: `点了「${pick.label}」，行首画的不是那一格的形状`,
      })
      .toBe(pick.shape);
    // 选完那一排就收起来了（见 `openPicker` 那条注释），要读选中态得再展开一次。
    await openPicker(page, '晨跑');
    // 选中之外的格子不许同时按下（`aria-pressed` 是单源）。
    await expect(page.locator('.ht-habit__icon-option[aria-pressed="true"]')).toHaveCount(1);
    await page.screenshot({ path: SHOT('icon-changed') });
    expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
  });

  test('I3 🔴 刷新之后仍然是它（落盘判据）', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, APP_ZH);
    await switchView(page, '习惯');
    await addHabit(page, '记账');

    await selectHabit(page, '记账');
    await openPicker(page, '记账');
    // 🔴 基准**在点之前**取（从那一格自己取形状）：点完立刻读行首会读到点击前那一个，
    //    于是这条落盘判据报成"字形回到旧值"，而那与产品无关（第一版就红在这里）。
    // 🔴 而且**点的那一格必须与派生默认不同**：写死一格名字时，1/8 的运行里那一格
    //    恰好就是派生默认，于是"行首等于它"在**没有任何写入**的情况下也成立 ——
    //    这条落盘判据会静默地退化成"什么都没做也对"。成因与现量见 `otherGlyphOption`。
    const derived = await rowGlyph(page, '记账');
    const pick = await otherGlyphOption(page, derived);
    await page.locator('.ht-habit__icon-option').nth(pick.index).click();
    // 先确认当场就画对了 —— 否则"刷新后仍在"会退化成"刷新后仍是旧值"，两边都看不出来。
    await expect
      .poll(async () => await rowGlyph(page, '记账'), {
        message: '点完那一格，行首当场就没换',
      })
      .toBe(pick.shape);

    await page.reload();
    await switchView(page, '习惯');
    // 刷新后行首的字形必须**逐字节等于**挑完那一个 —— 这才叫"写进了日志"。
    await expect
      .poll(async () => await rowGlyph(page, '记账'), {
        message: '刷新之后字形回到旧值（没落盘，或落盘了没读回来）',
      })
      .toBe(pick.shape);

    // 而且选择器里认得它：按下的那一格就是「书写」。
    // ⚠️ 刷新会把**选中态**清掉（窗格没有回落选中，见 `selectHabit` 那条注释），
    //    所以这里要再点一次那一行 —— 少这一步，下面的 `openPicker` 会红在超时上，
    //    而那与"字形有没有落盘"毫无关系。
    await selectHabit(page, '记账');
    await openPicker(page, '记账');
    await expect(page.locator('.ht-habit__icon-option[aria-pressed="true"]').first()).toHaveAttribute(
      'aria-label',
      pick.label,
    );
    await expect(
      page.getByRole('button', { name: '「记账」用默认图标' }),
      '刷新后「默认」那一格仍按下 ⇒ 磁盘上的选择没读回来',
    ).not.toHaveAttribute('aria-pressed', 'true');
    expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
  });

  test('I4 再点同一个 ⇒ 退回派生，「默认」那一格按下', async ({ page }) => {
    await openApp(page, APP_ZH);
    await switchView(page, '习惯');
    await addHabit(page, '拉伸');

    await selectHabit(page, '拉伸');
    /* 🔴 派生默认先取下来，并且**点的那一格必须与它不同**（为什么不能写死名字，
       见 `otherGlyphOption` 那段：写死就有 1/8 的运行里这条判据在数学上不可能过）。
       这里比 `I2` 多钉一格：退回派生之后行首必须**等于最初那个派生形状**，
       而不是只"和显式选的那个不一样" —— 后者在"退回了第三个字形"时也会绿。 */
    const derived = await rowGlyph(page, '拉伸');
    await openPicker(page, '拉伸');
    const pick = await otherGlyphOption(page, derived);
    const cells = page.locator('.ht-habit__icon-option');
    await cells.nth(pick.index).click();
    await expect
      .poll(() => rowGlyph(page, '拉伸'), { message: `点了「${pick.label}」，行首没换成它的形状` })
      .toBe(pick.shape);

    await openPicker(page, '拉伸');
    await cells.nth(pick.index).click();
    await expect
      .poll(() => rowGlyph(page, '拉伸'), { message: '再点同一个字形没有退回派生' })
      .toBe(derived);
    // 再展开一次读「默认」那一格（选完就收起了）。
    await openPicker(page, '拉伸');
    await expect(
      page.getByRole('button', { name: '「拉伸」用默认图标' }),
      '退回派生后「默认」那一格没按下',
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('I5 选择器里亮着的那一格与行首画的是同一个字形', async ({ page }) => {
    await openApp(page, APP_ZH);
    await switchView(page, '习惯');
    await addHabit(page, '背单词');

    await selectHabit(page, '背单词');
    await openPicker(page, '背单词');
    // 🔴 顺序：先取那一格的形状 → 点 → 等行首换成它 → 再展开比"按下的那一格"。
    //    第一版是"点 → 立刻读行首"，读到的是点击前那一个（写入是异步的），
    //    于是这条一致性判据报成"两处画得不一样"，而实际是拿错了时刻。
    //    与 `I2`/`I3`/`I4` 同一条：点的那一格要**挑**一个与派生默认不同的，
    //    否则"行首换成了它"这一步有 1/8 的运行是白过的（见 `otherGlyphOption`）。
    const derived = await rowGlyph(page, '背单词');
    const pick = await otherGlyphOption(page, derived);
    await page.locator('.ht-habit__icon-option').nth(pick.index).click();
    await expect
      .poll(async () => await rowGlyph(page, '背单词'), {
        message: `点了「${pick.label}」，行首没换成那一格的形状`,
      })
      .toBe(pick.shape);

    // 选完就收起了，再展开才能读"按下的那一格"自己。
    await openPicker(page, '背单词');
    const pressed = await page
      .locator('.ht-habit__icon-option[aria-pressed="true"] img')
      .first()
      .evaluate(shapeOf);
    // 🔴 同一个判断，两处画得一样：行首字形与选择器里那一格必须逐字节相同。
    //    它是"宿主里再抄一张表"最直接的可见症状（清单水滴、选择器月亮）。
    expect(pressed, '按下的那一格与点之前那一格画的不是同一个字形').toBe(pick.shape);
  });

  test('I6 🔴 展开的每一格都在视口内（`toBeVisible()` 挡不住"被推到视口外"）', async ({ page }) => {
    await openApp(page, APP_ZH);
    await switchView(page, '习惯');
    await addHabit(page, '冥想');

    await selectHabit(page, '冥想');
    await openPicker(page, '冥想');

    const viewport = page.viewportSize();
    expect(viewport, '量不到视口宽度 ⇒ 这一条没有基准').not.toBeNull();
    const pane = await boxOf(page, page.getByTestId('habit-pane'), '详情窗格');
    const boxes = await page
      .locator('.ht-habit__icon-option')
      .evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, right: r.right, label: el.getAttribute('aria-label') ?? '' };
        }),
      );
    // 25 = 24 枚插画 + 「默认」那一格。少一格就是有一格被排到看不见的地方去了。
    expect(boxes, '展开的格子数不是 24 + 默认').toHaveLength(25);
    for (const b of boxes) {
      expect(
        b.right,
        `「${b.label}」的右边缘在 ${String(Math.round(b.right))}px，超出视口宽 ${String(
          Math.round(viewport?.width ?? 0),
        )}px —— 看不见的那一格等于没有那一格`,
      ).toBeLessThanOrEqual((viewport?.width ?? 0) - 1);
      expect(
        b.x,
        `「${b.label}」被推到视口左边外面`,
      ).toBeGreaterThanOrEqual(0);
      // 还要落在窗格里：这一排属于那条习惯，不该飘到别的栏去。
      // 🔴 这一句原先只对右边界 —— 与 §7 第 347 条那个洞同形：容器放不下时浏览器会把整排
      // **向左**挤出自己的栏（频次那一排实测从 x=983 落到 x≈128），而"不该飘到别的栏去"
      // 恰好是左边界要管的事。左边界补齐，注释里承诺的那件事才真的在被证。
      expect(
        b.x,
        `「${b.label}」左边缘 ${String(Math.round(b.x))}px 退到窗格左边界 ${String(
          Math.round(pane.x),
        )}px 之外 —— 飘到别的栏里的那一格，没人知道它是哪一条习惯的`,
      ).toBeGreaterThanOrEqual(pane.x - 1);
      expect(b.right, `「${b.label}」超出窗格右边界`).toBeLessThanOrEqual(pane.x + pane.width + 1);
    }
    await page.screenshot({ path: SHOT('picker-in-viewport') });
  });

  test('I7 暗色主题展开 picker 的真实画面可见', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('heyta.theme', 'dark');
    });
    await openApp(page, APP_ZH);
    await switchView(page, '习惯');
    await addHabit(page, '暗色图标');

    await selectHabit(page, '暗色图标');
    await openPicker(page, '暗色图标');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.ht-habit__icon-options')).toBeVisible();
    await expect(page.locator('.ht-habit__icon-option')).toHaveCount(25);
    await page.screenshot({ path: SHOT('picker-open-dark') });
  });
});

test.describe('窄详情栏截图', () => {
  // 保持桌面双栏（大于移动端单列断点），同时让详情 pane 进入窄容器布局。
  test.use({ viewport: { width: 800, height: 900 } });

  test('I8 窄详情栏展开 picker 的真实画面可见', async ({ page }) => {
    await openApp(page, APP_ZH);
    await switchView(page, '习惯');
    await addHabit(page, '窄栏图标');

    await selectHabit(page, '窄栏图标');
    await openPicker(page, '窄栏图标');
    await expect(page.getByTestId('habit-pane')).toBeVisible();
    await expect(page.locator('.ht-habit__icon-options')).toBeVisible();
    await expect(page.locator('.ht-habit__icon-option')).toHaveCount(25);

    const pane = await boxOf(page, page.getByTestId('habit-pane'), '详情窗格');
    const boxes = await page.locator('.ht-habit__icon-option').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, right: r.right, top: r.top, bottom: r.bottom };
      }),
    );
    for (const b of boxes) {
      expect(b.x, '窄详情栏选项左边缘不能跑出窗格').toBeGreaterThanOrEqual(pane.x - 1);
      expect(b.right, '窄详情栏选项右边缘不能跑出窗格').toBeLessThanOrEqual(pane.x + pane.width + 1);
      expect(b.top, '窄详情栏选项必须有实际高度').toBeLessThan(b.bottom);
    }
    await page.screenshot({ path: SHOT('picker-open-narrow') });
  });
});
