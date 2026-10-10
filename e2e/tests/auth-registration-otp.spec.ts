/**
 * 邮箱 + 密码注册验证码：真实浏览器验收。
 *
 * 验证 UI 的真实输入、渐进注册阶段、验证码过滤、重发冷却、改邮箱和会话落点。
 * 三个认证接口只在浏览器请求层拦截，避免发送真实邮件；应用本身仍由 Vite 真启动，
 * 表单状态、store、会话 UI 和关闭面板行为都是真实代码。
 */

import { expect, test, type Page } from '@playwright/test';

import { openApp, openAuthPanel } from '../auth-journey/helpers.js';

type RegistrationRequest = {
  email?: string;
  password?: string;
  termsAccepted?: boolean;
};

type Challenge = {
  challengeId: string;
  expiresAt: number;
  resendAvailableAt: number;
  emailDelivered: true;
};

type OtpRoutes = {
  readonly requests: RegistrationRequest[];
  readonly verifies: { challengeId?: string; code?: string }[];
  readonly resends: { challengeId?: string }[];
};

function futureChallenge(id: string, resendAvailableAt = Date.now()): Challenge {
  return {
    challengeId: id,
    expiresAt: Date.now() + 10 * 60 * 1000,
    resendAvailableAt,
    emailDelivered: true,
  };
}

async function installOtpRoutes(page: Page): Promise<OtpRoutes> {
  const routes: OtpRoutes = { requests: [], verifies: [], resends: [] };
  let requestNumber = 0;

  await page.route('**/api/register/email-password/request', async (route) => {
    routes.requests.push((route.request().postDataJSON() ?? {}) as RegistrationRequest);
    requestNumber += 1;
    // 第一封信有 60 秒冷却，第二封信立即允许重发，分别覆盖两种状态。
    const challenge = requestNumber === 1
      ? futureChallenge('otp-challenge-1', Date.now() + 60_000)
      : futureChallenge(`otp-challenge-${String(requestNumber)}`);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(challenge),
    });
  });

  await page.route('**/api/register/email-password/verify', async (route) => {
    routes.verifies.push((route.request().postDataJSON() ?? {}) as { challengeId?: string; code?: string });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        token: 'otp-session-token',
        user: { id: 7, email: 'me@example.com' },
      }),
    });
  });

  await page.route('**/api/register/email-password/resend', async (route) => {
    routes.resends.push((route.request().postDataJSON() ?? {}) as { challengeId?: string });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(futureChallenge('otp-challenge-resend')),
    });
  });

  return routes;
}

async function runRegistrationJourney(page: Page): Promise<void> {
  const routes = await installOtpRoutes(page);
  await openApp(page, '/', 'accepted');
  const dialog = await openAuthPanel(page);

  await dialog.getByTestId('auth-form-switch-mode').click();
  await expect(dialog.getByTestId('auth-form-terms')).toBeVisible();
  await dialog.getByTestId('auth-form-email').fill('me@example.com');
  await dialog.getByTestId('auth-form-password').fill('correct horse battery');
  await expect(dialog.getByTestId('auth-form-password')).toHaveAttribute('type', 'password');
  await dialog.getByTestId('auth-form-password-confirmation').fill('different password');
  await dialog.getByTestId('auth-form-terms').click();

  // 确认密码不一致时，提交不应离开设备。
  await dialog.getByTestId('auth-form-submit').click();
  await expect(dialog.getByTestId('auth-form-registration-code-stage')).toHaveCount(0);
  expect(routes.requests).toHaveLength(0);

  await dialog.getByTestId('auth-form-password-confirmation').fill('correct horse battery');
  await dialog.getByTestId('auth-form-submit').click();
  await expect(dialog.getByTestId('auth-form-registration-code-stage')).toBeVisible();
  expect(routes.requests).toHaveLength(1);
  expect(routes.requests[0]).toMatchObject({
    email: 'me@example.com',
    password: 'correct horse battery',
    termsAccepted: true,
  });

  const code = dialog.getByTestId('auth-form-registration-code');
  // 组件按数字过滤并限制为 6 位；这覆盖了用户从邮件复制带杂字符的验证码。
  await code.fill('12a3456');
  await expect(code).toHaveValue('123456');

  // 冷却期内重发按钮不应触发网络请求，并且界面展示倒计时。
  await dialog.getByTestId('auth-form-registration-code-resend').click();
  expect(routes.resends).toHaveLength(0);
  await expect(dialog.getByTestId('auth-form-registration-code-resend')).toContainText('秒');

  // 改邮箱返回密码注册阶段，并保留已填写的邮箱。
  await dialog.getByTestId('auth-form-registration-code-change-email').click();
  await expect(dialog.getByTestId('auth-form-registration-code-stage')).toHaveCount(0);
  await expect(dialog.getByTestId('auth-form-email')).toHaveValue('me@example.com');

  // 再次申请验证码，第二次响应允许立即重发，验证重发端点的真实接线。
  await dialog.getByTestId('auth-form-submit').click();
  await expect(dialog.getByTestId('auth-form-registration-code-stage')).toBeVisible();
  await expect.poll(() => routes.requests.length).toBe(2);
  await expect(dialog.getByTestId('auth-form-registration-code-resend')).toHaveText('重新发送验证码');
  await dialog.getByTestId('auth-form-registration-code-resend').click();
  await expect.poll(() => routes.resends.length).toBe(1);
  expect(routes.resends[0]).toMatchObject({ challengeId: 'otp-challenge-2' });
  await expect(dialog.getByTestId('auth-form-busy')).toHaveCount(0);

  await code.fill('12a3456');
  await dialog.getByTestId('auth-form-registration-code-submit').click();
  await expect.poll(() => routes.verifies.length).toBe(1);
  expect(routes.verifies[0]).toEqual({ challengeId: 'otp-challenge-resend', code: '123456' });

  // 成功复用统一会话入口：认证面板关闭，头像菜单显示账号身份。
  await expect(dialog).toBeHidden();
  await page.getByTestId('account-menu-avatar').click();
  await expect(page.getByTestId('account-menu-email')).toContainText('me@example.com');

  // 密码、验证码和令牌不能出现在页面可见文字中；密码输入本身也应是 password 类型。
  await expect(page.locator('body')).not.toContainText('correct horse battery');
  await expect(page.locator('body')).not.toContainText('123456');
  await expect(page.locator('body')).not.toContainText('otp-session-token');
}

test.describe('邮箱密码注册 OTP', () => {
  test('桌面端完整注册旅程', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await runRegistrationJourney(page);
  });

  test('移动端视口完整注册旅程', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await runRegistrationJourney(page);
  });
});
