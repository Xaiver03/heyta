import { expect, test } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`线上注册协议阅读与表单返回 ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    const authRequests: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (request.method() === 'POST' && /\/auth\//.test(request.url())) {
        authRequests.push(request.url());
      }
    });
    await page.goto('/app/?signin=1&lang=zh-CN');
    await page.getByTestId('privacy-consent-local-only').click();
    await page.getByTestId('auth-form-switch-mode').click();
    await page.getByTestId('auth-form-email').fill('draft@example.test');
    await expect(page.getByTestId('auth-form')).not.toContainText('长一句比加符号有用');
    await expect(page.getByTestId('auth-form-submit')).toHaveText('发送验证码');

    for (const kind of ['terms', 'privacy']) {
      await page.getByTestId(`auth-form-legal-${kind}`).click();
      const reader = page.getByTestId('auth-legal-document');
      await expect(reader).toBeVisible();
      await expect(reader).toContainText(kind === 'terms' ? 'heyta 服务条款' : '隐私政策');
      await expect(reader).not.toContainText('**');
      await page.screenshot({ path: testInfo.outputPath(`live-${kind}-${width}.png`) });
      await page.getByTestId('auth-legal-document-close').click();
      await expect(reader).toBeHidden();
      await expect(page.getByTestId('auth-form-email')).toHaveValue('draft@example.test');
    }
    expect(errors).toEqual([]);
    expect(authRequests).toEqual([]);
  });
}
