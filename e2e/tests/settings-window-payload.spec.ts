import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

/**
 * 独立设置窗口的**载荷**判据：`?settings=<section>` 直接开一屏设置。
 *
 * 三个原生壳（macOS WKWebView / Windows WinUI / Electron）都载同一份 `web-dist`，
 * 所以"开一个独立设置窗口"在壳里只是"用这个 URL 再开一个窗口"。这条用例钉的是
 * **那个 URL 真的自足**：不用先点账户菜单、不用登录态之外的任何前置。
 */
test('?settings= 单独就能打开设置，并落在指定分节', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 720 });
  await openApp(page, '/?lang=zh-CN&settings=settings-group-appearance');

  const sheet = page.getByTestId('settings-sheet');
  await expect(sheet).toBeVisible();
  // 落在指定那一节，而不是默认的第一节。
  await expect(sheet.locator('#settings-group-appearance')).toBeVisible();
  await expect(sheet.locator('.ht-settings__group:visible')).toHaveCount(1);
  // 窗口化以后没有"外面那层应用"可点，所以设置自己必须能被关掉或至少不溢出。
  const bounds = await sheet.evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.client + 1);

  await page.screenshot({ path: '../apps/web/evidence/settings-redesign/window-payload-1000.png' });
});
