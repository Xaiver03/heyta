/**
 * 邮箱验证码登录 + 记住密码：真浏览器验收（2026-10-10）。
 *
 * 应用由 Vite 真启动，store / 共享表单 / 壳存储全是真代码；三个认证接口只在
 * 浏览器请求层拦截（与 auth-registration-otp.spec 同一条理由：不发真邮件）。
 * 🔴 截图按 §6.2 规定一落**固定路径**，人必须打开看：模块加载时先清旧图，
 * 采集失败不会沿用旧图（Playwright 截图抛错会让用例红）。
 */

import { expect, test, type Page } from '@playwright/test';
import { existsSync, rmSync } from 'node:fs';

import { openApp, openAuthPanel } from '../auth-journey/helpers.js';

const SHOTS = [
  'test-results/auth-login-code-1-form.png',
  'test-results/auth-login-code-2-challenge.png',
  'test-results/auth-login-code-3-signed-in.png',
  'test-results/auth-remember-1-form.png',
  'test-results/auth-remember-2-prefilled.png',
] as const;

test.beforeAll(() => {
  for (const shot of SHOTS) {
    if (existsSync(shot)) rmSync(shot);
  }
});

const SESSION = {
  token: 'login-code-session-token',
  user: { id: 1, email: 'me@example.com', locale: 'zh-CN' },
};

function futureChallenge(id: string): { challengeId: string; expiresAt: number; resendAvailableAt: number; emailDelivered: true } {
  return {
    challengeId: id,
    expiresAt: Date.now() + 10 * 60 * 1000,
    resendAvailableAt: Date.now() + 60_000,
    emailDelivered: true,
  };
}

async function installLoginCodeRoutes(page: Page): Promise<{ requests: unknown[]; verifies: unknown[] }> {
  const seen: { requests: unknown[]; verifies: unknown[] } = { requests: [], verifies: [] };
  await page.route('**/api/login/email-code/request', async (route) => {
    seen.requests.push(route.request().postDataJSON() ?? {});
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(futureChallenge('login-code-challenge-1')),
    });
  });
  await page.route('**/api/login/email-code/verify', async (route) => {
    seen.verifies.push(route.request().postDataJSON() ?? {});
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) });
  });
  return seen;
}

async function installPasswordLoginRoute(page: Page): Promise<{ calls: unknown[] }> {
  const calls: unknown[] = [];
  await page.route('**/api/login/email-password', async (route) => {
    calls.push(route.request().postDataJSON() ?? {});
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) });
  });
  return { calls };
}

async function expandOtherWays(dialog: ReturnType<Page['getByTestId']>): Promise<void> {
  const toggle = dialog.getByTestId('auth-form-other-ways-toggle');
  if (await toggle.count()) await toggle.click();
}

test.describe('邮箱验证码登录', () => {
  test('桌面端：入口 → 挑战视图 → 换会话（截图固定路径）', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const seen = await installLoginCodeRoutes(page);
    await openApp(page, '/', 'accepted');
    const dialog = await openAuthPanel(page);
    await dialog.getByTestId('auth-form-email').fill('me@example.com');
    await expandOtherWays(dialog);

    // 入口只在登录档出现（这是登录路，不是注册路）。
    await expect(dialog.getByTestId('auth-form-login-code-trigger')).toBeVisible();
    await page.screenshot({ path: SHOTS[0]!, fullPage: false });

    await dialog.getByTestId('auth-form-login-code-trigger').click();
    await expect(dialog.getByTestId('auth-form-login-code-stage')).toBeVisible();
    await expect(dialog.getByTestId('auth-form-login-code')).toBeVisible();
    await page.screenshot({ path: SHOTS[1]!, fullPage: false });

    // 未输满 6 位不许提交（与注册码同一纪律）。
    await dialog.getByTestId('auth-form-login-code').fill('12345');
    await expect(dialog.getByTestId('auth-form-login-code-submit')).toBeDisabled();
    await dialog.getByTestId('auth-form-login-code').fill('123456');
    await dialog.getByTestId('auth-form-login-code-submit').click();

    await expect.poll(() => seen.verifies.length).toBe(1);
    expect(seen.verifies[0]).toMatchObject({ challengeId: 'login-code-challenge-1', code: '123456' });

    // 成功复用统一会话入口：面板关闭、头像菜单带出身份。
    await expect(dialog).toBeHidden();
    await page.getByTestId('account-menu-avatar').click();
    await expect(page.getByTestId('account-menu-email')).toContainText('me@example.com');
    await page.screenshot({ path: SHOTS[2]!, fullPage: false });

    // 会话令牌与验证码不许出现在可见文字里。
    await expect(page.locator('body')).not.toContainText('login-code-session-token');
    await expect(page.locator('body')).not.toContainText('123456');
  });

  test('诱饵响应（无 emailDelivered）也进挑战视图 —— 反枚举的客户端半边', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route('**/api/login/email-code/request', async (route) => {
      // 诱饵：同形状、无 emailDelivered 字段。
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ challengeId: 'decoy', expiresAt: Date.now() + 600_000, resendAvailableAt: Date.now() + 60_000 }),
      });
    });
    await openApp(page, '/', 'accepted');
    const dialog = await openAuthPanel(page);
    await dialog.getByTestId('auth-form-email').fill('me@example.com');
    await expandOtherWays(dialog);
    await dialog.getByTestId('auth-form-login-code-trigger').click();
    await expect(dialog.getByTestId('auth-form-login-code-stage')).toBeVisible();
    await expect(dialog.getByTestId('auth-form-status')).toContainText('验证码已发送');
  });
});

test.describe('记住密码', () => {
  test('勾选并成功登录 ⇒ 落 localStorage；重开面板预填；不勾再登 ⇒ 清除', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { calls } = await installPasswordLoginRoute(page);
    await openApp(page, '/', 'accepted');
    const dialog = await openAuthPanel(page);

    // 默认登录档就有勾选框（web 壳接了存储才有 labels —— 这里是共享表单的判定）。
    await expect(dialog.getByTestId('auth-form-remember-password')).toBeVisible();
    // 等弹窗淡入动画走完再拍 —— 半透明的截图不是合格的证据（§6.2 是给人看的）。
    await dialog.getByTestId('auth-form').waitFor({ state: 'visible' });
    await page.waitForTimeout(600);
    await page.screenshot({ path: SHOTS[3]!, fullPage: false });
    await dialog.getByTestId('auth-form-remember-password').click();
    await expect(dialog.getByTestId('auth-form-remember-password')).toHaveAttribute('aria-checked', 'true');
    await dialog.getByTestId('auth-form-email').fill('me@example.com');
    await dialog.getByTestId('auth-form-password').fill('correct horse battery');
    await dialog.getByTestId('auth-form-submit').click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => calls.length).toBe(1);

    const stored = await page.evaluate(() => window.localStorage.getItem('heyta.auth.remembered.v1'));
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored ?? '{}')).toMatchObject({ email: 'me@example.com', password: 'correct horse battery' });

    // 先退出登录（登录着的人没有登录入口），再重开面板验证预填。
    // 🔴 「记住密码」**刻意**活过退出登录 —— 它的价值恰恰是登出后不用重打。
    await page.getByTestId('account-menu-avatar').click();
    await page.getByTestId('account-menu-signout').click();
    await expect(page.getByTestId('account-menu-signout')).toBeHidden();
    await page.reload();
    // 退出后是未登录壳：没有任务输入框可等（openApp 会超时），直接开认证面板。
    const dialog2 = await openAuthPanel(page);
    await expect(dialog2.getByTestId('auth-form-email')).toHaveValue('me@example.com');
    await expect(dialog2.getByTestId('auth-form-password')).toHaveValue('correct horse battery');
    await expect(dialog2.getByTestId('auth-form-remember-password')).toHaveAttribute('aria-checked', 'true');
    await page.screenshot({ path: SHOTS[4]!, fullPage: false });

    // 不勾再登 ⇒ 存储清掉（明示才存，反面同样明示）。
    await dialog2.getByTestId('auth-form-remember-password').click();
    await expect(dialog2.getByTestId('auth-form-remember-password')).toHaveAttribute('aria-checked', 'false');
    await dialog2.getByTestId('auth-form-submit').click();
    await expect(dialog2).toBeHidden();
    await expect.poll(() => calls.length).toBe(2);
    const cleared = await page.evaluate(() => window.localStorage.getItem('heyta.auth.remembered.v1'));
    expect(cleared).toBeNull();
  });
});
