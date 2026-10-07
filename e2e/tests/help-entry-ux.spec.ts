import { expect, test } from '@playwright/test';
import { openApp, switchTheme } from './helpers';

for (const width of [375, 1440]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`Help browser entries ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 });
      await openApp(page, '/?lang=zh-CN');
      if (theme === 'dark') await switchTheme(page, 'dark');
      await page.getByRole('button', { name: '帮助', exact: true }).click();
      const panel = page.getByTestId('about-panel');
      await expect(panel).toBeVisible();
      await expect(page.getByTestId('settings-sheet').getByRole('heading')).toHaveCount(1);
      await expect(page.getByTestId('detail-pane-toggle')).toHaveCount(0);
      const links = page.getByTestId('about-links').getByRole('link');
      await expect(links).toHaveCount(3);
      for (const [index, path] of ['/docs', '/changelog', '/pricing'].entries()) {
        const link = links.nth(index);
        await expect(link).toHaveAttribute('href', `https://heyta.waytofuture.cn${path}`);
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        const box = await link.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        await expect(link).not.toHaveCSS('text-decoration-line', 'underline');
      }
      await expect(panel).not.toContainText('搜索引擎');
      await expect(panel).not.toContainText('PWA');
      await expect(page.getByTestId('settings-sheet-close')).toBeVisible();
      await page.screenshot({ path: `../apps/web/evidence/help-entry/help-${width}-${theme}.png` });
      await page.getByTestId('settings-sheet-close').click();
      await expect(page.getByTestId('settings-sheet')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: '收集箱', exact: true })).toBeVisible();
    });
  }
}
