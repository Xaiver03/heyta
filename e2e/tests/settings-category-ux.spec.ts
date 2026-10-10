import { expect, test } from '@playwright/test';
import { openApp } from './helpers';
for (const width of [1440, 375]) {
  test(`设置分类与深浅主题 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openApp(page, '/?lang=zh-CN');
    await page.getByTestId('account-menu-avatar').click();
    await page.getByTestId('account-menu-settings').click();
    const sheet = page.getByTestId('settings-sheet');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      for (const id of ['appearance', 'profile', 'sync', 'ai', 'data', 'account', 'help']) {
        const button = sheet.locator(`[aria-controls="settings-group-${id}"]`);
        await button.click();
        await expect(button).toHaveAttribute('aria-current', 'page');
        await expect(sheet.locator('.ht-settings__group:visible')).toHaveCount(1);
        await expect(sheet.locator(`#settings-group-${id}`)).toBeVisible();
        const bounds = await sheet.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
        expect(bounds.scroll).toBeLessThanOrEqual(bounds.client + 1);
        if (['appearance', 'sync', 'data', 'ai', 'account'].includes(id)) await page.screenshot({path:`../apps/web/evidence/settings-finish/settings-${width}-${theme}-${id}.png`});
      }
    }
    await page.keyboard.press('Escape');
    await expect(sheet).not.toBeVisible();
  });
}
