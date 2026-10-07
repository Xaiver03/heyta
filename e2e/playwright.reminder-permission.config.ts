import { defineConfig, devices } from '@playwright/test';

/**
 * 真 Chromium 的通知权限专项验收。
 *
 * 这份配置只起 Vite dev（不触碰共享 dist），并把 Web 端固定在 4355，
 * 避免误复用另一轮验收的页面。权限状态由 Chromium CDP 的
 * Browser.setPermission 设置；unsupported/error 两条用例在测试文件中明确
 * 标成能力边界模拟，不把它们冒充成操作系统权限证据。
 */
const WEB_PORT = 4355;

export default defineConfig({
  testDir: './tests',
  testMatch: /reminder-permission-final\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: '/tmp/heyta-reminder-permission-final/playwright',
  use: {
    baseURL: `http://127.0.0.1:${String(WEB_PORT)}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // Chromium headless forces Notification.permission to denied even after
      // Browser.setPermission. A visible browser is required for real prompt
      // semantics and is available on this macOS QA host.
      use: { ...devices['Desktop Chrome'], locale: 'zh-CN', headless: false },
    },
  ],
  webServer: {
    command: `pnpm --filter @heyta/web exec vite --host 127.0.0.1 --port ${String(WEB_PORT)} --strictPort`,
    cwd: '..',
    url: `http://127.0.0.1:${String(WEB_PORT)}`,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 120_000,
  },
});
