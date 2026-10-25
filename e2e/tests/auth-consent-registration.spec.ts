/**
 * 回归：只用本机 → 展开助手 → 登录/注册。
 *
 * 真应用、真表单与真隐私闸门；仅截获 HTTP 响应，不发邮件、不连接真实账号。
 * OTP 原旅程从已同意联网开始，这里专测之前漏掉的设备同意边界。
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openApp } from './helpers';
import { openAuthPanel } from '../auth-journey/helpers.js';

const EMAIL = 'consent-journey@example.com';
const PASSWORD = 'a private and deliberate plan';

type RegistrationRequest = {
  email?: string;
  password?: string;
  termsAccepted?: boolean;
};

async function interceptAuth(page: Page): Promise<{
  registrations: RegistrationRequest[];
  logins: unknown[];
}> {
  const registrations: RegistrationRequest[] = [];
  const logins: unknown[] = [];
  // 所有 API 都留在本次浏览器测试，接受联网后也不会访问真实服务。
  await page.route('**/api/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{}',
  }));
  /*
    🔴 中央身份**配置**必须给一个**能用的**形状，否则面板根本长不出表单。
    2026-10-25 之前这里是 `{}`（兜底那一支的产物）—— 而应用现在的行为是：
    拿到畸形/缺失的配置就画「登录暂时不可用」，**并且明确不退回本地表单**
    （`AuthPanel` 的 `centralBlocked` 分支，那是产品决定，不是缺陷）。
    于是这四条用例红在"等一个永远不会出现的输入框"。

    这里回 `mode:'local'`：它说的正是"这套部署用本地表单登录"，
    与这组用例要验的东西（隐私闸门 → 勾选 → 表单 → 验证码）一致。
    ⚠️ 不要改成 `{}` 或删掉这一支 —— 那会让四条用例变回"等 60 秒超时"。
  */
  await page.route('**/api/auth/central/config', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      mode: 'local',
      loginPath: '/api/auth/oidc/start',
      documentVersion: null,
    }),
  }));
  await page.route('**/api/register/email-password/request', async (route) => {
    registrations.push(route.request().postDataJSON() as RegistrationRequest);
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        challengeId: 'consent-registration-challenge',
        expiresAt: Date.now() + 600_000,
        resendAvailableAt: Date.now() + 60_000,
        emailDelivered: true,
      }),
    });
  });
  await page.route('**/api/login/email-password', async (route) => {
    logins.push(route.request().postDataJSON());
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Invalid credentials', code: 'invalid_credentials' }),
    });
  });
  return { registrations, logins };
}

async function openFromAssistant(page: Page): Promise<Locator> {
  await openApp(page, '/?lang=zh-CN', 'local-only');
  await page.getByTestId('rail-assistant').click();
  await expect(page.locator('.ht-app[data-assistant-workspace]')).toHaveCount(1);
  await expect(page.locator('.ht-main')).toBeHidden();
  return openAuthPanel(page);
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`只用本机后在助手注册：明确勾选才联网并显示验证码 ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const requests = await interceptAuth(page);
    const auth = await openFromAssistant(page);
    await auth.getByTestId('auth-form-switch-mode').click();
    await auth.getByTestId('auth-form-email').fill(EMAIL);
    await auth.getByTestId('auth-form-password').fill(PASSWORD);
    await auth.getByTestId('auth-form-password-confirmation').fill(PASSWORD);

    const agreement = auth.getByTestId('auth-form-terms');
    await expect(agreement).toContainText('联网');
    await auth.getByTestId('auth-form-submit').click();
    await expect(auth.getByTestId('auth-form-registration-code-stage')).toHaveCount(0);
    expect(requests.registrations).toEqual([]);
    expect(requests.logins).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem('privacy.consent'))).toContain('local-only');

    await agreement.click();
    await auth.getByTestId('auth-form-submit').click();
    await expect(auth.getByTestId('auth-form-registration-code-stage')).toBeVisible();
    expect(requests.registrations).toHaveLength(1);
    expect(requests.registrations[0]).toMatchObject({ email: EMAIL, password: PASSWORD, termsAccepted: true });
    expect(requests.logins).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem('privacy.consent'))).toContain('accepted');
    await expect(page.locator('body')).not.toContainText('common.auth.error.consentRequired');
    await expect(page.getByTestId('privacy-consent-dialog')).toBeHidden();
    await expect(page.locator('.ht-app[data-assistant-workspace]')).toHaveCount(1);
  });

  test(`助手中登录被隐私闸门拦下时面板可见，同意不自动重发 ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const requests = await interceptAuth(page);
    const auth = await openFromAssistant(page);
    await auth.getByTestId('auth-form-email').fill(EMAIL);
    await auth.getByTestId('auth-form-password').fill(PASSWORD);
    await auth.getByTestId('auth-form-submit').click();

    const privacy = page.getByTestId('privacy-consent-dialog');
    await expect(privacy).toBeVisible();
    // 真点击证明弹层没有藏在 display:none 的主列里，也不被认证遮罩拦住。
    await privacy.getByTestId('privacy-consent-accept').click();
    await expect(privacy).toBeHidden();
    await expect(auth.getByTestId('auth-form-password')).toHaveValue(PASSWORD);
    expect(requests.logins).toEqual([]);
    expect(requests.registrations).toEqual([]);
    await expect(page.locator('body')).not.toContainText('common.auth.error.consentRequired');

    // 手动再次提交才允许唯一一次登录请求，防止隐式重复用户意图。
    await auth.getByTestId('auth-form-submit').click();
    await expect.poll(() => requests.logins.length).toBe(1);
    expect(requests.logins[0]).toEqual({ email: EMAIL, password: PASSWORD });
    await expect(page.locator('.ht-app[data-assistant-workspace]')).toHaveCount(1);
  });

  test(`官方协议弹窗及文内引用可阅读，返回保留注册信息 ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const requests = await interceptAuth(page);
    const auth = await openFromAssistant(page);
    await auth.getByTestId('auth-form-switch-mode').click();
    await auth.getByTestId('auth-form-email').fill(EMAIL);
    await auth.getByTestId('auth-form-password').fill(PASSWORD);
    await auth.getByTestId('auth-form-password-confirmation').fill(PASSWORD);
    const agreement = auth.getByTestId('auth-form-terms');
    await agreement.click();

    for (const kind of ['terms', 'privacy'] as const) {
      await auth.getByTestId(`auth-form-legal-${kind}`).click();
      const reader = page.getByTestId('auth-legal-document');
      await expect(reader).toBeVisible();
      await expect(reader).toContainText(kind === 'terms' ? 'heyta 服务条款' : '隐私政策');
      await expect(reader).toContainText('尚未对用户生效');
      await page.screenshot({ path: testInfo.outputPath(`legal-${kind}.png`) });
      if (kind === 'terms') {
        // 点击真正的正文引用，Playwright 会先把底部引用滚进视口。
        await reader.getByTestId('auth-legal-document-ref-privacy').first().click();
        await expect(reader).toContainText('隐私政策');
        // 切换文档应从正文开头读起，不能继承前一份文档的底部滚动位置。
        //
        // 🔴 2026-10-17：这里原来是 `{ exact: true }`，而**产品给顶层小节加了序号**
        // （现量 `LegalDocumentSheet.tsx:341` 渲出的是 `1. 这份政策管什么、不管什么`，
        // 序号按 depth/索引生成）。`exact: true` 要求"元素整段文本**逐字相等**"，
        // 于是一个都匹配不到 —— 报 `element(s) not found`，读起来像"文档没切过去"，
        // 其实判据把"小节标题"钉成了"不带序号的标题"。
        // ⇒ 改成子串匹配。**不**把序号抄进判据：序号是生成物，抄进来等于把下标当承诺。
        await expect(
          reader.getByText('这份政策管什么、不管什么', { exact: false }),
          '切到隐私政策后第一小节应当已经滚进视口（而不是停在上一份文档的底部）',
        ).toBeInViewport();
      }
      await reader.getByTestId('auth-legal-document-close').click();
      await expect(reader).toBeHidden();
      await expect(auth.getByTestId('auth-form-email')).toHaveValue(EMAIL);
      await expect(auth.getByTestId('auth-form-password')).toHaveValue(PASSWORD);
      await expect(auth.getByTestId('auth-form-password-confirmation')).toHaveValue(PASSWORD);
      await expect(agreement).toHaveAttribute('aria-checked', 'true');
      expect(requests.registrations).toEqual([]);
      expect(requests.logins).toEqual([]);
      expect(page.context().pages()).toHaveLength(1);
      expect(await page.evaluate(() => localStorage.getItem('privacy.consent'))).toContain('local-only');
    }
  });
}
