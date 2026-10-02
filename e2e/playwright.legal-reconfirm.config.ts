import { defineConfig, devices } from '@playwright/test';

/**
 * 真浏览器版「条款改版后要重新确认才准同步」（G-27 的界面取证半边）
 * ==============================================================
 *
 * 形状照 `playwright.privacy-consent.config.ts`（链 5 那一支），三条理由在那里都成立：
 *
 * 1. **必须生产构建**。dev 下不注册 SW，而这一支要数的出站请求里 `/api/*` 与实时通道
 *    的行为都和构建形态有关；对着 dev 数出来的"零"不是同一条判据。
 * 2. **端口独立**（4323）。主配置那两条 webServer 会在 4318/4319 上先杀再占，
 *    而那是共享工作树里**别的会话**的 vite（§7 第 87 条）。这里只读不抢。
 * 3. **`testMatch` 必须写死**，否则会把别人的 103 条用例一起跑在这份产物上。
 *
 * 🔴 这一支依赖 `apps/web/dist` 是**当前源码**打出来的（§7 第 27/82 条：
 * "测试全绿 ≠ 这是当前产物"）。跑之前先 `pnpm --filter @heyta/web build`，
 * 否则截图拍到的是改动前的界面，而"看见了面板"这个结论无效。
 */
const APP_PORT = 4323;

export default defineConfig({
  testDir: './tests',
  testMatch: /legal-reconfirm-gate\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: '/tmp/heyta-legal-reconfirm-results',
  use: {
    baseURL: `http://127.0.0.1:${String(APP_PORT)}`,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [
    {
      name: 'chromium',
      // 根 `use.locale` 会被 `devices['Desktop Chrome']` 自带的 `en-US` 盖掉 ⇒ 在展开之后覆盖。
      use: { ...devices['Desktop Chrome'], locale: 'zh-CN' },
    },
  ],
  webServer: {
    command: `pnpm --filter @heyta/web exec vite preview --host 127.0.0.1 --port ${String(
      APP_PORT,
    )} --strictPort`,
    // `cwd: '..'`：e2e 刻意不在根工作区内，在 e2e 目录跑 `--filter @heyta/web` 会
    // 得到 "No projects matched the filters"，症状是 webServer 秒退。
    cwd: '..',
    url: `http://127.0.0.1:${String(APP_PORT)}`,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 60_000,
  },
});
