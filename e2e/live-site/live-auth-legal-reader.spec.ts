/**
 * 线上验收：**读条款不丢登录状态**（central 模式修订版）
 * =====================================================
 *
 * 2026-10-23 修订。原判据的形状（local 时代）：
 *
 *   `goto /app/?signin=1` → 点 `privacy-consent-local-only`（只用本机）
 *   → 本地邮箱表单 → 填邮箱 → 点表单里的条款/隐私链接 → 阅读浮层
 *   → 关闭 → **邮箱值还在**。
 *
 * 它在官方站**从 central 模式上线起就不再可达**，两个原因各自都足以判红：
 *
 *   ① 官方站的认证能力由中央 OIDC 提供 —— `server/docs/authentication.md`
 *      「任何故障不得降级本地认证」，服务端启动约束就是 official ⇒ oidc。
 *      accept 隐私后渲染的是 central-auth-panel，**本地邮箱表单在官方站不出现**
 *      （`auth-form-email` 在整个官方站流程里不存在，2026-10-23 线上实测）。
 *   ② local-only（只用本机）= 不同意联网 ⇒ `consentFetch` 一个字节都不放行
 *      ⇒ 中央配置读不到 ⇒ centralBlocked 面板（fail-closed，既定设计）。
 *
 * 所以判据按**同一条用户意图**改写，强度不降：
 *
 *   · 「读条款」：central 面板里的条款/隐私按钮（`central-auth-terms/privacy`）
 *     打开的是**同一个** LegalDocumentSheet（testID `auth-legal-document`，
 *     与 local 时代那条判据逐字同一个组件）—— 文本、无 markdown 残留、可关闭；
 *   · 「表单返回」（原判据的核心：关掉阅读器，正在填的东西不许丢）：
 *     central 时代的等价物是 **central 面板仍在 + 条款同意仍未勾选**。
 *     阅读条款这个动作本身**不构成同意** —— 关掉浮层如果"顺手"把勾选器点了，
 *     那是把"我读过"偷换成"我同意"，正是这条判据要挡的；
 *   · 阅读期间**零 POST /auth/**：读条款是纯本地渲染，不该有任何请求出门
 *     （原判据同一条，`authRequests` 收集器原样保留）；
 *   · 控制台零 pageerror。
 *
 * 两个视口（390 / 1440）各跑一遍：窄屏下中央面板与阅读浮层的布局是另一条路。
 */

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
    // 官方站 central 模式：先做隐私决定（同意联网，中央配置才读得到），
    // 落到中央登录面板 —— 条款同意勾选器就在那上面。
    await page.goto('/app/?signin=1&lang=zh-CN');
    await page.getByTestId('privacy-consent-accept').click();
    const panel = page.getByTestId('central-auth-panel');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    const consentBox = page.getByTestId('central-auth-consent');
    await expect(consentBox).toBeVisible();
    await expect(consentBox).not.toBeChecked();

    for (const kind of ['terms', 'privacy']) {
      await page.getByTestId(`central-auth-${kind}`).click();
      const reader = page.getByTestId('auth-legal-document');
      await expect(reader).toBeVisible();
      await expect(reader).toContainText(kind === 'terms' ? 'heyta 服务条款' : '隐私政策');
      await expect(reader).not.toContainText('**');
      await page.screenshot({ path: testInfo.outputPath(`live-${kind}-${width}.png`) });
      await page.getByTestId('auth-legal-document-close').click();
      await expect(reader).toBeHidden();
      // 「表单返回」：面板还在，且**同意勾选没有被顺手点上**。
      await expect(panel).toBeVisible();
      await expect(consentBox).not.toBeChecked();
    }
    expect(errors).toEqual([]);
    expect(authRequests).toEqual([]);
  });
}
