import { expect, test } from '@playwright/test';

/**
 * 搜索的**居中浮层**形态（goal-layout-audit.md 页 6）
 * =================================================
 *
 * 2026-09-30 产品负责人（附滴答截图）：「搜索页面就是这种弹窗就行」——
 * §11.5 的规律：次级表面是**浮层**，下层视图透出；不是把内容区换掉的一路由。
 *
 * 🔴 判据是**存在性 + 几何**：
 *   · 浮层是非模态 dialog（`aria-modal=false`）；
 *   · **下层任务列表仍在 DOM**（替换式路由会让它消失）；
 *   · 卡片宽度钉在 `--ht-layout-modal-max`（40rem = 640px）——
 *     铺满内容区的"浮层"就是假浮层，两侧必须有透出下层的空隙。
 *
 * 🔴 截图是硬性要求（AGENTS §6.2 规定一），落固定路径，人必须看。
 */

test('搜索：居中浮层透出下层视图，Esc 关掉回到原视图', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  // 先真建一条任务（回车确认）—— 下层"看得见"得有东西可看，
  // 否则 EmptyState 也会让"下层可见"假绿。
  const composer = page.locator('input[placeholder^="添加任务"]');
  await composer.fill('搜索浮层判据的锚点任务');
  await composer.press('Enter');
  await expect(page.locator('[data-testid="task-list"]'), '任务先建出来').toBeVisible();

  // 开搜索（rail tab）。
  await page.getByRole('tab', { name: '搜索' }).click();

  // ① 浮层开了，且是非模态 dialog。
  const surface = page.getByTestId('search-overlay-surface');
  await expect(surface, '搜索应当作为居中浮层出现').toBeVisible();
  await expect(surface).toHaveAttribute('aria-modal', 'false');

  // ② 🔴 判据本体：下层任务列表仍在 DOM 里（浮层盖在上面，不是替换）。
  await expect(page.locator('[data-testid="task-list"]')).toBeAttached();

  // ③ 几何：卡片宽度钉在 modal-max（640px + 2px 容差），且**在内容区内**水平居中。
  //    ⚠️ 量的是**卡片**（overlay 的子元素），不是 scrim 本身 ——
  //    scrim 是 inset:0 撑满内容区的，量它永远"超宽"（第一版就栽在这）。
  //    ⚠️ 居中的基准是 `.ht-content`（浮层只盖主列，rail/侧栏照常透出 ——
  //    §1.3"主列③浮层、侧栏②透出"），不是整个视口：对视口居中会差出
  //    rail 宽度的一半（88px），那才是错的。
  const card = page.locator('[data-testid="search-overlay-surface"] > *').first();
  const box = await card.boundingBox();
  expect(box, '浮层卡片有几何').not.toBeNull();
  expect(box!.width, '卡片宽度不得超过 modal-max（铺满就是假浮层）').toBeLessThanOrEqual(642);
  const contentBox = await page.locator('.ht-content').boundingBox();
  expect(contentBox, '内容区有几何').not.toBeNull();
  const centeredDelta = Math.abs(
    box!.x + box!.width / 2 - (contentBox!.x + contentBox!.width / 2),
  );
  expect(centeredDelta, '卡片必须在内容区内水平居中').toBeLessThanOrEqual(8);

  await page.screenshot({ path: 'test-results/search-overlay.png', fullPage: false });

  // ④ Esc 关掉 → 浮层消失，下层（任务视图）继续在。
  await page.keyboard.press('Escape');
  await expect(surface).toHaveCount(0);
  await expect(page.locator('[data-testid="task-list"]'), 'Esc 后回到下层视图').toBeVisible();
});
