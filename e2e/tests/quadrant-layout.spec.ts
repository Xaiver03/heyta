import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

/**
 * 四象限的**排版几何**（goal-layout-audit.md 页 1）
 * =================================================
 *
 * ## 2026-09-29 产品负责人的两条原话
 *
 * 1. 「四象限要用那个坐标系，就是十字的竖线这样子」—— 2×2 十字网格
 *   （滴答同构：四格之间露出底色的缝隙就是横竖两条"轴线"）。
 * 2. 「不能因为窗口的变化而影响到排版」—— 窄窗优雅降级单列，而不是塌掉。
 *
 * ## 🔴 为什么是**几何断言**而不是"元素可见"
 *
 * 旧实现（`flexWrap` + `minWidth:'50%'`+`gap`）的每一格都"可见"、断言全绿 ——
 * 但 50%+50%+gap > 100%，四格**必然**逐个换行成 4 张通栏卡。
 * "可见"证明不了"排成了 2×2"。所以这里的判据是**坐标**：
 *   · 宽窗：第 1、2 格**同一行**（y 相同）；第 1、3 格**同列**（x 相同）；
 *   · 窄窗（< `layout.two-column-min` = 768px）：格子**纵向堆叠**。
 * 把共享层改回 wrap 写法，宽窗断言当场红（已实测注入）。
 *
 * 🔴 截图是硬性要求（AGENTS §6.2 规定一）：两个宽度各一张，人必须看。
 */

const WIDE = { width: 1280, height: 800 };
const NARROW = { width: 660, height: 800 };

async function openQuadrant(page: import('@playwright/test').Page): Promise<void> {
  await openApp(page);
  // rail 上的「四象限」视图 tab。
  await page.getByRole('tab', { name: '四象限' }).click();
  await expect(page.locator('[data-testid^="quadrant-cell-"]').first()).toBeVisible();
}

test('宽窗：四象限是 2×2 十字网格', async ({ page }) => {
  await page.setViewportSize(WIDE);
  await openQuadrant(page);

  const cells = page.locator('[data-testid^="quadrant-cell-"]');
  await expect(cells).toHaveCount(4);
  const [q1, q2, q3] = await Promise.all([
    cells.nth(0).boundingBox(),
    cells.nth(1).boundingBox(),
    cells.nth(2).boundingBox(),
  ]);
  expect(q1, '四格都有几何尺寸').not.toBeNull();
  expect(q2, '四格都有几何尺寸').not.toBeNull();
  expect(q3, '四格都有几何尺寸').not.toBeNull();

  // 🔴 同一行：第 1、2 格顶边相同（差 < 2px 容差）；不是通栏卡逐个堆叠。
  expect(Math.abs(q1!.y - q2!.y), '第 1、2 格应在同一行（2×2 的上半）').toBeLessThan(2);
  // 同一列：第 1、3 格左边对齐（2×2 的左列）。
  expect(Math.abs(q1!.x - q3!.x), '第 1、3 格应在同一列').toBeLessThan(2);
  // 第 2 格在右侧（不是被挤到下一行）。
  expect(q2!.x, '第 2 格应在第 1 格右侧').toBeGreaterThan(q1!.x + q1!.width / 2);

  await page.screenshot({ path: 'test-results/quadrant-wide.png', fullPage: false });
});

test('窄窗：低于断点优雅降级单列（窗口变化不塌）', async ({ page }) => {
  await page.setViewportSize(NARROW);
  await openQuadrant(page);

  const cells = page.locator('[data-testid^="quadrant-cell-"]');
  await expect(cells).toHaveCount(4);
  const [q1, q2] = await Promise.all([cells.nth(0).boundingBox(), cells.nth(1).boundingBox()]);
  expect(q1).not.toBeNull();
  expect(q2).not.toBeNull();

  // 单列：第 2 格整体在第 1 格下方（顶边 ≥ 第 1 格底边）。
  expect(
    q2!.y,
    '窄窗下第 2 格应堆叠在第 1 格下方',
  ).toBeGreaterThanOrEqual(q1!.y + q1!.height - 2);

  await page.screenshot({ path: 'test-results/quadrant-narrow.png', fullPage: false });
});
