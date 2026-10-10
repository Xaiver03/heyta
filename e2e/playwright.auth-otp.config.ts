import { defineConfig, devices } from '@playwright/test';

/**
 * 邮箱密码注册验证码的真实浏览器验收。
 *
 * 4359 是本套件独占端口；服务端三个 OTP 路由由用例通过 page.route 拦截，
 * 所以这条验收不发送真实邮件，也不依赖任何账号或外部服务。
 */
const WEB_PORT = 4359;

export default defineConfig({
  testDir: './tests',
  testMatch: /auth-registration-otp\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://127.0.0.1:${String(WEB_PORT)}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm --filter @heyta/web exec vite --host 127.0.0.1 --port ${String(WEB_PORT)} --strictPort`,
    cwd: '..',
    url: `http://127.0.0.1:${String(WEB_PORT)}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
