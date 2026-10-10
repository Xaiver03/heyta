import { expect, test } from '@playwright/test';
import { LEGAL_DOCUMENTS, legalDocumentPresentation } from '../../packages/legal/dist/index.js';

for (const viewport of [{ width: 1440, height: 900 }, { width: 320, height: 740 }]) {
  for (const locale of ['zh-CN', 'en'] as const) {
    test(`九份协议统一长文格式 ${locale} ${viewport.width}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      // 深色和英文组合、亮色和中文组合均验；测试不同主题实际token，不做反相。
      await page.addInitScript((theme) => localStorage.setItem('heyta.theme', theme), locale === 'en' ? 'dark' : 'light');
      for (const source of LEGAL_DOCUMENTS) {
        const document = legalDocumentPresentation(source);
        await page.goto(`${locale === 'en' ? '/en' : ''}/legal/${document.id}/`);
        const article = page.locator('.lp-legal');
        await expect(article.locator('h1')).toHaveText(document.title[locale]);
        await expect(page.locator('h1')).toHaveCount(1);
        await expect(article.locator('details')).not.toHaveAttribute('open');
        await expect(article).not.toContainText(/[❌✅🔴⚠📌⏸]/u);
        await expect(article.locator('h2')).toHaveCount(document.sections[locale].length);
        for (const section of document.sections[locale]) {
          await expect(article.locator(`section[id="${section.id}"]`).locator('h2').first()).toHaveText(section.title);
        }
        const width = await page.evaluate(() => ({
          body: document.documentElement.scrollWidth,
          viewport: window.innerWidth,
        }));
        expect(width.body).toBeLessThanOrEqual(width.viewport);
        const footerColumns = await page.locator('.lp-footer__grid').evaluate((element) =>
          getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length,
        );
        expect(footerColumns).toBe(viewport.width <= 640 ? 1 : 4);
        // 目录可打开并导航；不是靠编号摆放的一串不可操作文本。
        await article.locator('summary').click();
        await article.locator('nav a').first().click();
        await expect(article.locator('h2').first()).toBeInViewport();
        if (document.id === 'terms') await page.screenshot({ path: testInfo.outputPath(`terms-${locale}-${viewport.width}.png`) });
      }
    });
  }
}

for (const viewport of [{ width: 768, height: 900 }, { width: 1024, height: 900 }]) {
  test(`法律页页脚在窄视口保持多列且不溢出 ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/legal/terms/');
    const footer = page.locator('.lp-footer');
    const columns = await footer.locator('.lp-footer__grid').evaluate((element) =>
      getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length,
    );
    expect(columns).toBe(2);
    const width = await page.evaluate(() => ({
      body: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(width.body).toBeLessThanOrEqual(width.viewport);
  });
}
