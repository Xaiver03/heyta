import { expect, test } from '@playwright/test';

import { waitHeadRevealed } from './head-reveal';

async function assertNoHorizontalOverflow(page: import('@playwright/test').Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - window.innerWidth,
    body: document.body.scrollWidth - window.innerWidth,
  }));

  expect(overflow.document, '首页 document 不应横向溢出').toBeLessThanOrEqual(1);
  expect(overflow.body, '首页 body 不应横向溢出').toBeLessThanOrEqual(1);
}

test('首页在 375 与 1440 视口都保留完整产品路径且没有横向溢出', async ({ page }) => {
  for (const theme of ['light', 'dark'] as const) {
    for (const viewport of [
      { name: '375', width: 375, height: 812 },
      { name: '768', width: 768, height: 900 },
      { name: '1440', width: 1440, height: 900 },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');
      await page.locator('.lp-hero').waitFor();
      const currentTheme = await page.locator('html').getAttribute('data-theme');
      if (currentTheme !== theme) {
        const targetLabel = theme === 'dark' ? '暗色主题' : '亮色主题';
        await page.locator(`button[aria-label*="${targetLabel}"]`).click();
      }
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await waitHeadRevealed(page);
      await page.screenshot({
        path: `landing-results/landing-home-${theme}-${viewport.name}.png`,
        fullPage: false,
      });

      await assertNoHorizontalOverflow(page);
      await expect(page.locator('.lp-hero__card')).toBeVisible();
      await expect(page.locator('#showcase')).toBeVisible();
      await expect(page.locator('#pricing')).toBeVisible();
    }
  }
});

test('首页减少动效时隐私演示直接显示设备明文与服务端密文', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const viewport of [
    { name: '375', width: 375, height: 812 },
    { name: '768', width: 768, height: 900 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');
    await page.locator('#privacy').waitFor();
    await page.locator('#privacy').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `landing-results/landing-home-reduced-motion-${viewport.name}.png`,
      fullPage: false,
    });

    const privacy = page.locator('#privacy');
    await expect(privacy.locator('.lp-privacy__note').last()).toContainText('静态对照');
    await expect(privacy.locator('.lp-privacy__panel--server .lp-privacy__char--locked')).toHaveCount(
      await privacy.locator('.lp-privacy__text--cipher .lp-privacy__char').count(),
    );
  }
});
