import { expect, test } from '@playwright/test';

/**
 * 页 8 逐页排版扫描（goal-layout-audit.md 页 8）
 * =================================================
 *
 * 习惯 / 时间线 / 专注 / 成长 / 便签 / 回收站 / 通知 / 账号区 / 设置 ——
 * 每页一张截图（固定路径），**人看**。排版缺陷（重叠/挤压/裸缝）靠图找，
 * 断言只负责"页面真的渲染出来了"（每页锚一个该页特有的标记）。
 *
 * 🔴 专注 / 成长 / 便签默认关（模块开关）—— 用 localStorage 显式覆盖打开
 * （`features/shell/modules.ts`：存的是 `{focus: true}` 这种**覆盖**）。
 * 这是验收环境的选择，不是改产品默认。
 */

const MODULES_ON = JSON.stringify({ focus: true, growth: true, notes: true });

async function open(page: import('@playwright/test').Page, tabName: string): Promise<void> {
  await page.getByRole('tab', { name: tabName }).click();
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
    await page.addInitScript((modules) => {
      localStorage.setItem('heyta.shell.modules', modules);
    }, MODULES_ON);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await open(page, tab);
    // 每页一个锚：能切过去且内容区标题对上，就说明渲染完成。
    // 标题锚：回收站/便签/番茄钟等标题跟着 tab 走（`VIEW_TITLED_BY_TAB`）。
    await expect(page.locator('.ht-header__title')).toContainText(tab);
    await page.screenshot({ path: `test-results/${file}.png`, fullPage: false });
  });
}

test('页8 扫描：设置浮层', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
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
  await page.goto('/');
  await page.getByTestId('account-menu-avatar').click();
  await expect(page.getByTestId('account-menu-panel')).toBeVisible();
  await page.screenshot({ path: 'test-results/sweep-account.png', fullPage: false });
  // 关掉账号菜单再开通知 —— 两张图不互相压。
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '通知' }).click();
  await expect(page.getByTestId('inbox-panel')).toBeVisible();
  await page.screenshot({ path: 'test-results/sweep-inbox.png', fullPage: false });
});
