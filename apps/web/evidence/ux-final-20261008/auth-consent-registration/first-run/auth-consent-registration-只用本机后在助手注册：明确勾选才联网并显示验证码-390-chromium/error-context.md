# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth-consent-registration.spec.ts >> 只用本机后在助手注册：明确勾选才联网并显示验证码 390
- Location: tests/auth-consent-registration.spec.ts:68:3

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('[role="dialog"][aria-label="登录 / 注册"]').getByTestId('auth-form-terms')
Expected substring: "联网"
Received string:    "我同意该服务端提供的服务条款与隐私政策"
Timeout: 15000ms

Call log:
  - Expect "toContainText" locator('[role="dialog"][aria-label="登录 / 注册"]').getByTestId('auth-form-terms') with timeout 15000ms
  - waiting for locator('[role="dialog"][aria-label="登录 / 注册"]').getByTestId('auth-form-terms')
    34 × locator resolved to <div tabindex="0" role="checkbox" aria-checked="false" data-testid="auth-form-terms" class="css-view-g5y9jx r-cursor-1loqt21 r-touchAction-1otgn73 r-alignItems-1habvwh r-flexDirection-18u37iz r-gap-1cmwbt1">…</div>
       - unexpected value "我同意该服务端提供的服务条款与隐私政策"

```

```yaml
- checkbox "我同意该服务端提供的服务条款与隐私政策"
```

# Test source

```ts
  1   | /**
  2   |  * 回归：只用本机 → 展开助手 → 登录/注册。
  3   |  *
  4   |  * 真应用、真表单与真隐私闸门；仅截获 HTTP 响应，不发邮件、不连接真实账号。
  5   |  * OTP 原旅程从已同意联网开始，这里专测之前漏掉的设备同意边界。
  6   |  */
  7   | import { expect, test, type Locator, type Page } from '@playwright/test';
  8   | import { openApp } from './helpers';
  9   | import { openAuthPanel } from '../auth-journey/helpers.js';
  10  | 
  11  | const EMAIL = 'consent-journey@example.com';
  12  | const PASSWORD = 'a private and deliberate plan';
  13  | 
  14  | type RegistrationRequest = {
  15  |   email?: string;
  16  |   password?: string;
  17  |   termsAccepted?: boolean;
  18  | };
  19  | 
  20  | async function interceptAuth(page: Page): Promise<{
  21  |   registrations: RegistrationRequest[];
  22  |   logins: unknown[];
  23  | }> {
  24  |   const registrations: RegistrationRequest[] = [];
  25  |   const logins: unknown[] = [];
  26  |   // 所有 API 都留在本次浏览器测试，接受联网后也不会访问真实服务。
  27  |   await page.route('**/api/**', (route) => route.fulfill({
  28  |     status: 200,
  29  |     contentType: 'application/json',
  30  |     body: '{}',
  31  |   }));
  32  |   await page.route('**/api/register/email-password/request', async (route) => {
  33  |     registrations.push(route.request().postDataJSON() as RegistrationRequest);
  34  |     await route.fulfill({
  35  |       status: 201,
  36  |       contentType: 'application/json',
  37  |       body: JSON.stringify({
  38  |         challengeId: 'consent-registration-challenge',
  39  |         expiresAt: Date.now() + 600_000,
  40  |         resendAvailableAt: Date.now() + 60_000,
  41  |         emailDelivered: true,
  42  |       }),
  43  |     });
  44  |   });
  45  |   await page.route('**/api/login/email-password', async (route) => {
  46  |     logins.push(route.request().postDataJSON());
  47  |     await route.fulfill({
  48  |       status: 401,
  49  |       contentType: 'application/json',
  50  |       body: JSON.stringify({ error: 'Invalid credentials', code: 'invalid_credentials' }),
  51  |     });
  52  |   });
  53  |   return { registrations, logins };
  54  | }
  55  | 
  56  | async function openFromAssistant(page: Page): Promise<Locator> {
  57  |   await openApp(page, '/?lang=zh-CN', 'local-only');
  58  |   await page.getByTestId('rail-assistant').click();
  59  |   await expect(page.locator('.ht-app[data-assistant-workspace]')).toHaveCount(1);
  60  |   await expect(page.locator('.ht-main')).toBeHidden();
  61  |   return openAuthPanel(page);
  62  | }
  63  | 
  64  | for (const viewport of [
  65  |   { width: 1440, height: 900 },
  66  |   { width: 390, height: 844 },
  67  | ]) {
  68  |   test(`只用本机后在助手注册：明确勾选才联网并显示验证码 ${viewport.width}`, async ({ page }) => {
  69  |     await page.setViewportSize(viewport);
  70  |     const requests = await interceptAuth(page);
  71  |     const auth = await openFromAssistant(page);
  72  |     await auth.getByTestId('auth-form-switch-mode').click();
  73  |     await auth.getByTestId('auth-form-email').fill(EMAIL);
  74  |     await auth.getByTestId('auth-form-password').fill(PASSWORD);
  75  |     await auth.getByTestId('auth-form-password-confirmation').fill(PASSWORD);
  76  | 
  77  |     const agreement = auth.getByTestId('auth-form-terms');
> 78  |     await expect(agreement).toContainText('联网');
      |                             ^ Error: expect(locator).toContainText(expected) failed
  79  |     await auth.getByTestId('auth-form-submit').click();
  80  |     await expect(auth.getByTestId('auth-form-registration-code-stage')).toHaveCount(0);
  81  |     expect(requests.registrations).toEqual([]);
  82  |     expect(requests.logins).toEqual([]);
  83  |     expect(await page.evaluate(() => localStorage.getItem('privacy.consent'))).toContain('local-only');
  84  | 
  85  |     await agreement.click();
  86  |     await auth.getByTestId('auth-form-submit').click();
  87  |     await expect(auth.getByTestId('auth-form-registration-code-stage')).toBeVisible();
  88  |     expect(requests.registrations).toHaveLength(1);
  89  |     expect(requests.registrations[0]).toMatchObject({ email: EMAIL, password: PASSWORD, termsAccepted: true });
  90  |     expect(requests.logins).toEqual([]);
  91  |     expect(await page.evaluate(() => localStorage.getItem('privacy.consent'))).toContain('accepted');
  92  |     await expect(page.locator('body')).not.toContainText('common.auth.error.consentRequired');
  93  |     await expect(page.getByTestId('privacy-consent-dialog')).toBeHidden();
  94  |     await expect(page.locator('.ht-app[data-assistant-workspace]')).toHaveCount(1);
  95  |   });
  96  | 
  97  |   test(`助手中登录被隐私闸门拦下时面板可见，同意不自动重发 ${viewport.width}`, async ({ page }) => {
  98  |     await page.setViewportSize(viewport);
  99  |     const requests = await interceptAuth(page);
  100 |     const auth = await openFromAssistant(page);
  101 |     await auth.getByTestId('auth-form-email').fill(EMAIL);
  102 |     await auth.getByTestId('auth-form-password').fill(PASSWORD);
  103 |     await auth.getByTestId('auth-form-submit').click();
  104 | 
  105 |     const privacy = page.getByTestId('privacy-consent-dialog');
  106 |     await expect(privacy).toBeVisible();
  107 |     // 真点击证明弹层没有藏在 display:none 的主列里，也不被认证遮罩拦住。
  108 |     await privacy.getByTestId('privacy-consent-accept').click();
  109 |     await expect(privacy).toBeHidden();
  110 |     await expect(auth.getByTestId('auth-form-password')).toHaveValue(PASSWORD);
  111 |     expect(requests.logins).toEqual([]);
  112 |     expect(requests.registrations).toEqual([]);
  113 |     await expect(page.locator('body')).not.toContainText('common.auth.error.consentRequired');
  114 | 
  115 |     // 手动再次提交才允许唯一一次登录请求，防止隐式重复用户意图。
  116 |     await auth.getByTestId('auth-form-submit').click();
  117 |     await expect.poll(() => requests.logins.length).toBe(1);
  118 |     expect(requests.logins[0]).toEqual({ email: EMAIL, password: PASSWORD });
  119 |     await expect(page.locator('.ht-app[data-assistant-workspace]')).toHaveCount(1);
  120 |   });
  121 | }
  122 | 
```