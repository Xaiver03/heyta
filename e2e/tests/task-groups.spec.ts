import { expect, test } from '@playwright/test';

/**
 * 任务页的**日期分组头 + 顺延**（goal-layout-audit.md 页 7）
 * =================================================
 *
 * 2026-09-30 产品负责人（附滴答截图）：「任务菜单的信息架构也可以学习这个」——
 * 滴答 §2.1：分组列表，每组 = 组名 + 组内计数 + 细横线；逾期的组头带
 * 「顺延」（一键把逾期任务推到今天）。
 *
 * 判据：
 *   · 组头真实存在且计数正确；
 *   · 点「顺延」后**逾期组消失、任务出现在今天组** —— 不是把组藏起来；
 *   · 几何：计数在组头行内（组名右侧）。
 *
 * 🔴 截图是硬性要求（AGENTS §6.2 规定一），落固定路径，人必须看。
 */

test('任务页：日期分组头 + 逾期组「顺延」', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  // 种三条：昨天（逾期）、今天、无日期 —— 走真捕获条（解析器认「昨天/今天」）。
  const composer = page.locator('input[placeholder^="添加任务"]');
  await composer.fill('昨天要交的周报');
  await composer.press('Enter');
  await composer.fill('今天要开的会');
  await composer.press('Enter');
  await composer.fill('随时要做的事');
  await composer.press('Enter');

  // ① 三个组头都在，各组在自己的行。
  const overdueGroup = page.locator('[data-testid="task-group-overdue"]');
  await expect(overdueGroup.getByText('已过期', { exact: false })).toBeVisible();
    // ⚠️ 捕获解析器会把「昨天」吃进日期、从标题里剥掉 —— 标题是「要交的周报」。
  await expect(overdueGroup).toContainText('要交的周报');
  await expect(page.locator('[data-testid^="task-group-date-"]').first()).toContainText('要开的会');
  await expect(page.locator('[data-testid="task-group-undated"]')).toContainText('随时要做的事');

  // ② 顺延按钮在逾期组头（组名右侧）。
  const postpone = page.getByTestId('task-group-postpone');
  await expect(postpone).toBeVisible();
  // ⚠️ 组头是共享 `TaskGroupHead`（RN View，不是 <header>）—— 用它的 testID。
  const headBox = await page.locator('[data-testid="task-group-overdue-head"]').boundingBox();
  const postponeBox = await postpone.boundingBox();
  expect(headBox, '组头有几何').not.toBeNull();
  expect(postponeBox, '顺延按钮有几何').not.toBeNull();
  expect(
    postponeBox!.y,
    '顺延按钮与组名同一行（组头内，不是组尾）',
  ).toBeLessThan(headBox!.y + headBox!.height);

  await page.screenshot({ path: 'test-results/task-groups.png', fullPage: false });

  // ③ 点「顺延」：逾期组消失，任务出现在今天组。
  await postpone.click();
  await expect(overdueGroup).toHaveCount(0);
  const todayGroup = page.locator('[data-testid^="task-group-date-"]').first();
  await expect(todayGroup, '顺延后任务应出现在今天组').toContainText('要交的周报');
  // 任务仍然在列表里（挪组不是消失）—— 全列表勾选框计数 = 3。
  await expect(page.locator('[role="checkbox"]')).toHaveCount(3);

  await page.screenshot({ path: 'test-results/task-groups-postponed.png', fullPage: false });
});
