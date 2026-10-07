import { test, expect } from '@playwright/test';

for (const width of [390, 1024, 1440]) {
  for (const theme of ['light', 'dark']) {
    test(`SSOS docs layout ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : width === 1024 ? 768 : 900 });
      await page.goto('/docs/first-run/');
      if (theme === 'dark') await page.getByRole('button', { name: '切换到暗色主题' }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.getByRole('searchbox')).toHaveCount(1);
      const homeLink = page.locator('.lp-docs-topnav__home');
      await expect(homeLink).toHaveText('返回首页');
      expect(new URL(await homeLink.getAttribute('href') ?? '', page.url()).pathname).toBe('/');
      const docsLinkStyles = await page.locator('.lp-docs-site a').evaluateAll((links) =>
        links.map((link) => getComputedStyle(link).textDecorationLine),
      );
      expect(docsLinkStyles.every((decoration) => !decoration.includes('underline'))).toBe(true);
      const typeScale = await page.evaluate(() => {
        const group = document.querySelector('.lp-docs__group-title, .lp-docs__group-link');
        const item = document.querySelector('.lp-docs__link');
        return {
          group: group ? [getComputedStyle(group).fontSize, getComputedStyle(group).fontWeight] : null,
          item: item ? [getComputedStyle(item).fontSize, getComputedStyle(item).fontWeight] : null,
        };
      });
      expect(typeScale).toEqual({ group: ['16px', '600'], item: ['14px', '400'] });
      const layout = await page.evaluate(() => {
        const body = document.querySelector('.lp-docs__body')!.getBoundingClientRect();
        const heading = document.querySelector('h1')!.getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth > innerWidth + 1,
          headingInside: heading.left >= body.left && heading.right <= body.right + 1 };
      });
      expect(layout).toEqual({ overflow: false, headingInside: true });
      if (width === 390) {
        await expect(page.locator('.lp-docs > .lp-docs__nav')).toBeHidden();
        await page.getByRole('button', { name: '打开文档目录' }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await dialog.press('Shift+Tab');
        await expect(dialog.getByRole('link').last()).toBeFocused();
        await dialog.press('Tab');
        await expect(dialog.getByRole('button', { name: '关闭文档目录' })).toBeFocused();
        await dialog.press('Escape');
        await expect(page.getByRole('button', { name: '打开文档目录' })).toBeFocused();
      } else {
        await expect(page.locator('.lp-docs > .lp-docs__nav')).toBeVisible();
      }
      await page.screenshot({ path: `landing-results/docs-layout-${width}-${theme}.png` });
    });
  }
}
