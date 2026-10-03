import { defineConfig, devices } from '@playwright/test';

/**
 * 自托管整套的独立配置：真容器 + 真浏览器，**不启任何本地 dev server**。
 * ============================================================================
 *
 * 分工与 `playwright.live-site.config.ts` 同形：那一份打公网域名（验部署），
 * 这一份打**由 `server/docker-compose.yml` 拉起来的本地栈**（验"一条 compose 起全套"这句话）。
 *
 * ## 🔴 为什么它刻意**不**在 `pnpm check` 里
 *
 * 它要 `docker build` + 起栈，`check` 的定位是"每次提交都跑得动"。
 * 入口是 `pnpm verify:selfhost-stack`（它会自己打包、起栈、 teardown）。
 *
 * ## 产物目录
 *
 * 与线上那份同一个理由：Playwright 每次运行会删并重建 `outputDir`，
 * 用共享的 `test-results/` 会吃掉别的套件还没看的截图证据。
 */

const BASE = process.env['HEYTA_SELFHOST_BASE'] ?? 'http://127.0.0.1:1900/app/';

export default defineConfig({
  testDir: './selfhost-stack',
  outputDir: './selfhost-stack-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  // 自托管栈是本地容器，抖动只可能是**真的坏了**；重试会把"起不来"洗成"通过"。
  retries: 0,
  reporter: [['list']],
  timeout: 180_000,
  expect: { timeout: 30_000 },

  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
