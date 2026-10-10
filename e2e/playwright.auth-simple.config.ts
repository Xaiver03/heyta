import { defineConfig, devices } from '@playwright/test';

/**
 * 精简认证与 AI 行为验收的隔离配置。
 *
 * 4341 是本套件专用 Web 端口，4342 是同一轮使用的确定性 stub provider；
 * 这样不会复用其它验收正在运行的 4318/4319，也不会把别的页面误当成被测对象。
 */
const WEB_PORT = 4341;
const STUB_PORT = 4342;

export default defineConfig({
  testDir: './tests',
  testMatch: /auth-simple-ux\.spec\.ts/,
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
  webServer: [
    {
      command: `STUB_PORT=${String(STUB_PORT)} node stub-provider.mjs`,
      url: `http://127.0.0.1:${String(STUB_PORT)}/__requests`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `pnpm --filter @heyta/web exec vite --host 127.0.0.1 --port ${String(WEB_PORT)} --strictPort`,
      cwd: '..',
      url: `http://127.0.0.1:${String(WEB_PORT)}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
