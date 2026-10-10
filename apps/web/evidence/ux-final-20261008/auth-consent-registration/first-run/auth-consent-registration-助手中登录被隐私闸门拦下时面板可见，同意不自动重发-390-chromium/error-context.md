# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth-consent-registration.spec.ts >> 助手中登录被隐私闸门拦下时面板可见，同意不自动重发 390
- Location: tests/auth-consent-registration.spec.ts:96:3

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.click: Test timeout of 60000ms exceeded.
Call log:
  - waiting for getByTestId('privacy-consent-dialog').getByTestId('privacy-consent-accept')
    - locator resolved to <button type="button" class="ht-btn ht-btn--primary" data-testid="privacy-consent-accept">同意并联网</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <div class="css-view-g5y9jx r-gap-9aw3ui">…</div> from <nav class="ht-rail" aria-label="主导航">…</nav> subtree intercepts pointer events
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <div class="css-view-g5y9jx r-gap-9aw3ui">…</div> from <nav class="ht-rail" aria-label="主导航">…</nav> subtree intercepts pointer events
    - retrying click action
      - waiting 100ms
    53 × waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - <div class="css-view-g5y9jx r-gap-9aw3ui">…</div> from <nav class="ht-rail" aria-label="主导航">…</nav> subtree intercepts pointer events
     - retrying click action
       - waiting 500ms
    - waiting for element to be visible, enabled and stable
  - element was detached from the DOM, retrying
    - locator resolved to <button type="button" class="ht-btn ht-btn--primary" data-testid="privacy-consent-accept">同意并联网</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <div class="css-view-g5y9jx r-gap-9aw3ui">…</div> from <nav class="ht-rail" aria-label="主导航">…</nav> subtree intercepts pointer events
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <div class="css-view-g5y9jx r-gap-9aw3ui">…</div> from <nav class="ht-rail" aria-label="主导航">…</nav> subtree intercepts pointer events
    - retrying click action
      - waiting 100ms
    58 × waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - <div class="css-view-g5y9jx r-gap-9aw3ui">…</div> from <nav class="ht-rail" aria-label="主导航">…</nav> subtree intercepts pointer events
     - retrying click action
       - waiting 500ms

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - navigation "主导航" [ref=e4]:
    - status [ref=e5]
    - tab "回收站" [ref=e6] [cursor=pointer]
    - button "通知" [ref=e10] [cursor=pointer]
    - button "帮助" [ref=e14] [cursor=pointer]
    - generic [ref=e18]:
      - button "同步，当前状态：登录以同步" [ref=e19] [cursor=pointer]:
        - generic [aria-hidden]: 登录以同步
      - status [ref=e26]: 登录以同步
    - dialog "登录 / 注册" [ref=e27]:
      - generic [ref=e28]:
        - complementary [aria-hidden] [ref=e29]:
          - heading [level=2] [ref=e31]: 开始自己的自律计划
        - region "登录 / 注册" [ref=e33]:
          - generic [ref=e34]:
            - heading "登录 / 注册" [level=1] [ref=e35]
            - button "关闭" [ref=e36] [cursor=pointer]
          - generic [ref=e40]:
            - generic [ref=e41]: 邮箱
            - textbox "邮箱" [ref=e42]:
              - /placeholder: 你的邮箱地址
            - generic [ref=e43]: 登录密码
            - generic [ref=e44]:
              - textbox "登录密码" [ref=e45]
              - button "显示密码" [ref=e46] [cursor=pointer]
            - button "登录" [ref=e50] [cursor=pointer]
            - button "还没有这个邮箱的账号？创建一个" [ref=e52] [cursor=pointer]
            - button "忘记密码？" [ref=e54] [cursor=pointer]
          - button "其他登录方式" [ref=e57] [cursor=pointer]
  - main [ref=e59]:
    - generic [ref=e60]:
      - button "当前视图的范围" [ref=e61] [cursor=pointer]
      - heading "收集箱" [level=1] [ref=e64]
      - button "对话助手" [ref=e66] [cursor=pointer]
    - generic [ref=e71]:
      - generic [ref=e73]:
        - textbox "新任务标题" [ref=e74]:
          - /placeholder: 添加任务，回车确认（可写「明天」「下周三」「!1」）
        - button "添加" [disabled]
      - generic [ref=e78]:
        - paragraph [ref=e82]: 收集箱是空的
        - paragraph [ref=e83]: 在上面输入框添加第一个任务
  - dialog [active] [ref=e84]:
    - generic [ref=e85]:
      - generic [ref=e90]:
        - heading "在使用联网功能之前" [level=2] [ref=e91]
        - paragraph [ref=e92]: 刚才那一步需要与服务器通信，而还没有同意隐私规则，所以 heyta 一个请求都没有发。
      - button "以后再说" [ref=e93] [cursor=pointer]
    - paragraph [ref=e97]: heyta 是本地优先的：你的任务、清单、笔记与历史先写在这台设备上。这个选择只决定一件事 —— 这台设备能不能与服务器通信。
    - list [ref=e98]:
      - listitem [ref=e99]: 选「只用本机」时，所有功能照常可用：新建、编辑、日历、四象限、番茄钟、习惯、导出，一个都不少。不会同步、不会登录，也不会接收服务器推送；移动端本地提醒仍可在授予系统通知权限后使用。
      - listitem [ref=e100]: 选「同意并联网」后，可以登录 heyta 并跨设备同步。任务数据经端到端加密后才上传，服务器看不到任务明文。
    - generic [ref=e101]:
      - generic [ref=e102]: 作出选择前，可以先读完整文本：
      - link "服务条款" [ref=e103] [cursor=pointer]:
        - /url: https://heyta.waytofuture.cn/legal/terms/
      - link "隐私政策" [ref=e104] [cursor=pointer]:
        - /url: https://heyta.waytofuture.cn/legal/privacy/
    - generic [ref=e105]:
      - button "同意并联网" [ref=e106] [cursor=pointer]
      - button "只用本机" [ref=e107] [cursor=pointer]
```

# Test source

```ts
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
  78  |     await expect(agreement).toContainText('联网');
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
> 107 |     // 真点击证明弹层没有藏在 display:none 的主列里，也不被认证遮罩拦住。
      |                                                         ^ Error: locator.click: Test timeout of 60000ms exceeded.
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