import { defineConfig, devices } from '@playwright/test';

/**
 * 真实浏览器验收的配置。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 两个服务，都是确定性/离线的
 *
 * 1. **假端点**（`stub-provider.mjs`）—— 门禁绝不允许依赖真模型，
 *    理由见那个文件的头注释。
 * 2. **真 web 应用**（vite dev）—— 被测对象是**真的**：真的 DOM、
 *    真的 IndexedDB/op-log、真的 `fetch`。只有"模型的回应"是假的。
 *
 * ## 🔴 端口刻意避开默认值
 *
 * 用 4318/4319 而不是 5173/3000：本机很可能同时开着别的项目，
 * 端口撞上会让 `reuseExistingServer` 把**别人的应用**当成被测对象，
 * 症状是"测试全绿但测的是另一个网站"。`strictPort` 也是为这个 ——
 * 起不来就报错，而不是悄悄换一个端口。
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,

  // 🔴 不许 `.only` 混进主分支：它会让整个套件悄悄退化成"只跑一条"。
  forbidOnly: !!process.env['CI'],

  // CI 上一次重试：真浏览器偶发竞态比 jsdom 多，但**不掩盖** ——
  // 重试过的用例会被 Playwright 标记为 flaky，仍然看得见。
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,

  reporter: process.env['CI'] ? [['list'], ['github']] : [['list']],

  // 真浏览器比 jsdom 慢，但单条用例不该超过这个数。
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: 'http://127.0.0.1:4318',
    // 失败时留下可复查的证据，而不是只给一行报错。
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: 'node stub-provider.mjs',
      url: 'http://127.0.0.1:4319/__requests',
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 30_000,
    },
    {
      // 🔴 `--host 127.0.0.1` 不能省。vite 默认绑 `localhost`，而在 macOS 上
      // `localhost` 常常先解析到 `::1`（IPv6）—— 于是服务确实起来了，
      // 但它**没在监听 127.0.0.1**，而 Playwright 轮询的是 IPv4 那个地址，
      // 结果表现为"命令没问题、却等 120 秒超时"。绑死 IPv4 消除这个歧义。
      command:
        'pnpm --filter @heyta/web exec vite --host 127.0.0.1 --port 4318 --strictPort',
      cwd: '..',
      url: 'http://127.0.0.1:4318',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
