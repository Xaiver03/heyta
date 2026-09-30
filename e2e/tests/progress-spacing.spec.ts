import { expect, test } from '@playwright/test';

/**
 * 今日进度卡与采集条之间的**站位**（真浏览器截图契约）。
 *
 * ## 为什么有这条
 *
 * 2026-09-29 产品负责人在 macOS 壳里实测指出：进度卡与采集条**贴死**。
 * 根因不是"token 写小了"，是**没人负责** —— `.ht-content` 是普通块容器
 * （没有 `gap`），共享进度卡是 RN 组件（外间距归宿主），采集条也没有。
 * 修复：`.ht-progress-banner { margin-block-end: var(--ht-space-4) }`
 *（token 一直都在，缺的是"谁声明"）。
 *
 * ## 🔴 截图是硬性要求（AGENTS.md §6.2 规定一）
 *
 * "间距对不对"只有图能证明 —— DOM 断言只能证明两张面**在**，
 * 证明不了它们**离多远**。截图落固定路径，**人必须打开看一眼**。
 */

test('今日进度卡与采集条各自成面，间距可见（截图人看）', async ({ page }) => {
  await page.goto('/');

  // 两张面都在（今天没有任务时进度卡也常驻 —— 它是做事视图的固定站位）。
  await expect(page.getByTestId('today-progress')).toBeVisible();
  const composer = page.locator('input[placeholder^="添加任务"]');
  await expect(composer).toBeVisible();

  // 🔴 先截图再断言其余内容 —— 失败时也要有图可看（规定一）。
  await page.screenshot({ path: 'test-results/progress-spacing.png', fullPage: false });
});
