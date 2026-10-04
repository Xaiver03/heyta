import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

/**
 * AI 工具行的**排版几何**（goal-layout-audit.md 页 2）
 * ====================================================
 *
 * 2026-09-29 产品负责人截图实测：窄窗下「运行」两个字**竖着折断**成两行，
 * 且工具行与上方的采集条**交叉重叠**。根因：`.ht-ai__actions` 没有
 * `flex-wrap`、按钮没有 `nowrap`、输入框不会收缩 —— 空间一紧全部硬挤。
 *
 * 🔴 判据是**几何**的（"元素可见"证明不了这些）：
 *   · 「运行」按钮高度 = 单行（竖折后高度翻倍）；
 *   · 工具行与采集条**包围盒不相交**；
 *   · 两种窗口宽度下都成立（1280 常规 / 660 窄窗）。
 * 把 `.ht-ai__actions` 的 `flex-wrap` 拿掉、或按钮 `nowrap` 删掉，
 * 对应断言当场红。
 *
 * 🔴 2026-10-04 追加第三条判据（同一对窗口宽度）：**AI 面在哪一栏**。
 * 产品负责人把 AI 面搬进最右那一栏，而那一栏 ≤1023px 是不出现的 ——
 * 搬家最容易犯的错就是"跟着那一栏一起消失"。所以宽窗必须在右栏内、
 * 窄窗必须回到中间列，两条一起才算搬完。
 *
 * 🔴 截图落固定路径，人必须看（AGENTS §6.2 规定一）。
 */

const WIDE = { width: 1280, height: 800 };
const NARROW = { width: 660, height: 800 };

async function boxes(page: import('@playwright/test').Page): Promise<{
  run: { y: number; height: number };
  composer: { x: number; y: number; width: number; height: number };
  ai: { x: number; y: number; width: number; height: number };
}> {
  const run = await page.getByTestId('ai-tool-run-button').boundingBox();
  const composer = await page.locator('input[placeholder^="添加任务"]').boundingBox();
  const ai = await page.getByTestId('ai-tool-run').boundingBox();
  expect(run, '「运行」按钮在').not.toBeNull();
  expect(composer, '采集输入框在').not.toBeNull();
  expect(ai, 'AI 工具行在').not.toBeNull();
  return { run: run!, composer: composer!, ai: ai! };
}

/** 两个盒子在平面上有没有交集（允许 2px 的测量误差）。 */
function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width - 2 &&
    b.x < a.x + a.width - 2 &&
    a.y < b.y + b.height - 2 &&
    b.y < a.y + a.height - 2
  );
}

async function assertLayout(page: import('@playwright/test').Page, label: string): Promise<void> {
  const { run, composer, ai } = await boxes(page);

  // 「运行」是单行文字：高度不应超过两行文字的高度（竖折后会 ≈ 翻倍）。
  expect(
    run.height,
    `${label}：「运行」按钮必须是单行（竖折 = 排版事故）`,
  ).toBeLessThan(56);

  // 🔴 不重叠。这里原来写的是"AI 行的顶部不得高过采集条的底部"（只看 y）——
  // 那是当时那个缺陷（两条都在中间列、上下堆叠）的**代理判据**。
  // 2026-10-04 AI 面搬进右栏后，宽窗里两者变成**左右**关系，只看 y 会把正确的
  // 布局读成缺陷；真正的缺陷从来是"两个盒子的像素区域相交"，所以判据换成它本身
  // —— 比原来更宽（两种摆放都成立）也更严（x 方向相交同样会红）。
  expect(
    intersects(ai, composer),
    `${label}：AI 工具行与采集条的包围盒相交（截图里的重叠缺陷就是这个形状）`,
  ).toBe(false);
}

/**
 * AI 面**在哪一栏**（2026-10-04 产品负责人：「把那个 AI 的功能移到右边那个区」）。
 *
 * 🔴 这一条是"搬家"这件事唯一的界面判据，且两档都必须量：
 * 只量宽窗，就等于允许"窄屏那一栏不出现时 AI 跟着消失"—— 而那正是搬家的
 * 第一种坏法（右栏 ≤1023px 是 `display: none`，账算在 `narrow.css`）。
 */
async function assertColumn(page: import('@playwright/test').Page, wide: boolean): Promise<void> {
  const ai = await page.getByTestId('ai-tool-run').boundingBox();
  expect(ai, 'AI 工具行量不到 boundingBox').not.toBeNull();
  const box = ai as { x: number; y: number; width: number; height: number };

  if (wide) {
    const detail = await page.getByTestId('detail-column').boundingBox();
    expect(detail, '宽窗里右栏量不到 boundingBox').not.toBeNull();
    const d = detail as { x: number; y: number; width: number; height: number };
    expect(box.x, `宽窗：AI 面应当在右栏里（ai.x=${String(box.x)} / 右栏 x=${String(d.x)}）`).toBeGreaterThanOrEqual(
      d.x,
    );
    expect(
      box.x + box.width,
      `宽窗：AI 面应当整块落在右栏内（右边越界 = 贴到窗口边缘或被裁）`,
    ).toBeLessThanOrEqual(d.x + d.width + 1);
    return;
  }

  // 窄档：右栏不出现（`display: none`），AI 面必须**退回中间列**而不是消失。
  await expect(page.getByTestId('detail-column'), '窄档里右栏本就不该出现').toBeHidden();
  const main = await page.locator('.ht-main').boundingBox();
  expect(main, '窄档里量不到中间列').not.toBeNull();
  const m = main as { x: number; y: number; width: number; height: number };
  expect(
    box.x >= m.x && box.x + box.width <= m.x + m.width + 1,
    `窄档：AI 面必须退回中间列（ai=${String(box.x)}+${String(box.width)} / main=${String(m.x)}+${String(m.width)}）`,
  ).toBe(true);
}


test('常规宽度：AI 工具行单行、不与采集条重叠', async ({ page }) => {
  await page.setViewportSize(WIDE);
  await openApp(page);
  await expect(page.getByTestId('ai-tool-run')).toBeVisible();
  await assertLayout(page, '常规宽');
  await assertColumn(page, true);
  await page.screenshot({ path: 'test-results/ai-row-wide.png', fullPage: false });
});

test('窄窗：按钮换行而不是折断，仍不重叠，且 AI 面退回中间列', async ({ page }) => {
  await page.setViewportSize(NARROW);
  await openApp(page);
  await expect(page.getByTestId('ai-tool-run')).toBeVisible();
  await assertLayout(page, '窄窗');
  await assertColumn(page, false);
  await page.screenshot({ path: 'test-results/ai-row-narrow.png', fullPage: false });
});
