import { expect, test } from '@playwright/test';

import { openApp, openSettingsView } from './helpers';

/**
 * 设置浮层**必须出得去**（2026-09-30 修）
 * ======================================
 *
 * 在这个修复之前，设置浮层没有任何退出口：没 Esc、没 ✕、点空白也不关
 *（`.ht-sheet` 是 `inset: 0` 盖满内容区，点哪儿都是它自己）——
 * 唯一的出路是去点 rail 上另一个视图。对键盘与读屏用户就是"进得去出不来"。
 *
 * 🔴 为什么这条要在**真浏览器**里跑：Esc 的正确性依赖**捕获阶段**监听
 *（RN-web 的 `TextInput` 在自己的 keydown 里无条件 `stopPropagation()`，
 * 冒泡阶段挂在 window 上的监听器收不到 —— 见 `App.tsx` 的那段注释）。
 * jsdom 里 `window.dispatchEvent(keydown)` 绕开了那条被吞的 DOM 路径，
 * **测不到这个坑**；只有真键盘事件走的是那条路。
 *
 * 截图落固定路径（§6.2 规定一），人必须看。
 */

test('设置浮层：✕ 看得见、Esc 关得掉，且关回原来那个视图', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);

  // 先真建一条任务：下层"还在"得有东西可看（空库是 EmptyState）。
  const composer = page.locator('input[placeholder^="添加任务"]');
  await composer.fill('设置浮层退出口判据的锚点任务');
  await composer.press('Enter');
  await expect(page.locator('[data-testid="task-list"]')).toBeVisible();

  // 走真实入口：头像 → 设置（设置不在 rail 上）。
  await openSettingsView(page);
  const sheet = page.getByTestId('settings-sheet');
  await expect(sheet).toBeVisible();

  // ① ✕ 看得见、有可访问名。
  const close = page.getByTestId('settings-sheet-close');
  await expect(close, '浮层必须有一个看得见的关闭按钮').toBeVisible();
  await expect(close).toHaveAttribute('aria-label', '关闭设置');

  await page.screenshot({ path: 'test-results/settings-sheet-close.png' });

  // ② Esc 关掉 —— 真键盘事件（这条是 jsdom 测不到的那条路）。
  await page.keyboard.press('Escape');
  await expect(sheet, 'Esc 之后浮层必须消失').toHaveCount(0);
  // ③ 关回去是**原来那个视图**：任务列表仍在，且不是被换成设置内容。
  await expect(page.locator('[data-testid="task-list"]')).toBeVisible();
  await expect(page.getByTestId('settings-sheet-close')).toHaveCount(0);

  // ④ 再用 ✕ 关一次（两条路都要真的通）。
  await openSettingsView(page);
  await expect(sheet).toBeVisible();
  await page.getByTestId('settings-sheet-close').click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('[data-testid="task-list"]')).toBeVisible();
});
