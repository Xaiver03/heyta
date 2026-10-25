import { expect, test } from '@playwright/test';
import { openApp, switchView } from './helpers';

/**
 * 页 8 逐页排版扫描（goal-layout-audit.md 页 8）
 * =================================================
 *
 * 习惯 / 时间线 / 专注 / 成长 / 便签 / 回收站 / 通知 / 账号区 / 设置 ——
 * 每页一张截图（固定路径），**人看**。排版缺陷（重叠/挤压/裸缝）靠图找，
 * 断言只负责"页面真的渲染出来了"（每页锚一个该页特有的标记）。
 *
 * 🔴 模块开关 / 中文偏好 / 首启隐私同意**全部由 `openApp` 做完**：
 * 这一组判据的定位符（tab 名、`.ht-header__title` 的中文页名、`通知` 按钮名）
 * 在英文界面上一个都找不到，而整屏遮罩会让 `click()` 卡到超时。
 * 以前这里自己 `addInitScript` 写 `heyta.shell.modules`（只开 3 个模块的一份抄件），
 * 现在走共享层那一份（6 个全开 = 它的超集）—— 抄件一定会漂。
 */

/**
 * 🔴 切视图走 `switchView`（helpers 里那一处收口），不要自己 `getByRole('tab')`：
 * W1（2026-10-06）把 rail 收成「主段 ≤4 + 更多」之后，低频目的地（时间线 / 番茄钟 /
 * 成长 / 便签）**不在 tablist 里** —— 它们在「更多」菜单（宽档 `role="menuitem"`、
 * 塌缩档 `#compact-rail-destinations` 面板）里。这一组 4 条就是这么红的：
 * `waiting for getByRole('tab', { name: '便签' })`，看着像"视图打不开"。
 */
async function open(page: import('@playwright/test').Page, tabName: Parameters<typeof switchView>[1]): Promise<void> {
  await switchView(page, tabName);
}

// ⚠️ rail 上那个 tab 的措辞是「番茄钟」（`web.shell.views.focus`），不是「专注」。
for (const [tab, file] of [
  ['习惯', 'sweep-habits'],
  ['时间线', 'sweep-timeline'],
  ['番茄钟', 'sweep-focus'],
  ['成长', 'sweep-growth'],
  ['便签', 'sweep-notes'],
  ['回收站', 'sweep-trash'],
] as const) {
  test(`页8 扫描：${tab}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openApp(page);
    await open(page, tab);
    // 每页一个锚：能切过去且内容区标题对上，就说明渲染完成。
    // 标题锚：回收站/便签/番茄钟等标题跟着 tab 走（`VIEW_TITLED_BY_TAB`）。
    await expect(page.locator('.ht-header__title')).toContainText(tab);
    await page.screenshot({ path: `test-results/${file}.png`, fullPage: false });
  });
}

test('页8 扫描：设置浮层', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  await page.getByTestId('account-menu-avatar').click();
  await page.getByTestId('account-menu-settings').click();
  await expect(page.getByTestId('settings-sheet')).toBeVisible();
  // 🔴 等 `ht-sheet-in` 入场动画走完再截 —— 动画中途 sheet 还半透明，
  //    下层文字会以可读浓度透上来（第一版截图实测），那是动画的中间态，
  //    不是排版缺陷。真实用户静止时看到的是动画结束后的样子。
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/sweep-settings.png', fullPage: false });
});

test('页8 扫描：账号菜单与通知面板', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  await page.getByTestId('account-menu-avatar').click();
  await expect(page.getByTestId('account-menu-panel')).toBeVisible();
  await page.screenshot({ path: 'test-results/sweep-account.png', fullPage: false });
  // 关掉账号菜单再开通知 —— 两张图不互相压。
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '通知' }).click();
  await expect(page.getByTestId('inbox-panel')).toBeVisible();
  await page.screenshot({ path: 'test-results/sweep-inbox.png', fullPage: false });
});
