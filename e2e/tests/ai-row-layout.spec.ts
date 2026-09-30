import { expect, test } from '@playwright/test';

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
 * 🔴 截图落固定路径，人必须看（AGENTS §6.2 规定一）。
 */

const WIDE = { width: 1280, height: 800 };
const NARROW = { width: 660, height: 800 };

async function boxes(page: import('@playwright/test').Page): Promise<{
  run: { y: number; height: number };
  composer: { y: number; height: number };
  ai: { y: number; height: number };
}> {
  const run = await page.getByTestId('ai-tool-run-button').boundingBox();
  const composer = await page.locator('input[placeholder^="添加任务"]').boundingBox();
  const ai = await page.getByTestId('ai-tool-run').boundingBox();
  expect(run, '「运行」按钮在').not.toBeNull();
  expect(composer, '采集输入框在').not.toBeNull();
  expect(ai, 'AI 工具行在').not.toBeNull();
  return { run: run!, composer: composer!, ai: ai! };
}

async function assertLayout(page: import('@playwright/test').Page, label: string): Promise<void> {
  const { run, composer, ai } = await boxes(page);

  // 「运行」是单行文字：高度不应超过两行文字的高度（竖折后会 ≈ 翻倍）。
  expect(
    run.height,
    `${label}：「运行」按钮必须是单行（竖折 = 排版事故）`,
  ).toBeLessThan(56);

  // 🔴 不交叉：AI 工具行的顶部不得高过采集条的底部（重叠 = 截图里的缺陷）。
  expect(
    ai.y,
    `${label}：AI 工具行不得与采集条交叉重叠`,
  ).toBeGreaterThanOrEqual(composer.y + composer.height - 2);
}

test('常规宽度：AI 工具行单行、不与采集条重叠', async ({ page }) => {
  await page.setViewportSize(WIDE);
  await page.goto('/');
  await expect(page.getByTestId('ai-tool-run')).toBeVisible();
  await assertLayout(page, '常规宽');
  await page.screenshot({ path: 'test-results/ai-row-wide.png', fullPage: false });
});

test('窄窗：按钮换行而不是折断，仍不重叠', async ({ page }) => {
  await page.setViewportSize(NARROW);
  await page.goto('/');
  await expect(page.getByTestId('ai-tool-run')).toBeVisible();
  await assertLayout(page, '窄窗');
  await page.screenshot({ path: 'test-results/ai-row-narrow.png', fullPage: false });
});
