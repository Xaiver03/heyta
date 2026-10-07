import { expect, test } from '@playwright/test';
import { openApp, switchView } from './helpers';

for (const width of [1280, 375]) {
  test(`四象限无需拖拽即可移动并撤销 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openApp(page, '/?lang=zh-CN');
    const input = page.locator('input[placeholder^="添加任务"]');
    await input.fill('用可见入口安排任务');
    await input.press('Enter');
    await switchView(page, '四象限');
    const move = page.getByRole('combobox', { name: '移动「用可见入口安排任务」到其他象限' });
    const original = page.getByTestId('quadrant-cell-4');
    await expect(original.getByRole('combobox')).toBeVisible();
    for (const destination of ['1', '2', '3']) {
      await move.selectOption(destination);
      await expect(page.getByTestId(`quadrant-cell-${destination}`).getByRole('combobox')).toBeVisible();
      await expect(page.getByTestId('quadrant-drop-status')).toBeVisible();
      await page.getByTestId('quadrant-drop-undo').click();
      await expect(original.getByRole('combobox')).toBeVisible();
    }
    await page.screenshot({path:`../apps/web/evidence/settings-finish/quadrant-move-${width}.png`});
  });
}
