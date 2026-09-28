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

  /**
   * 🔴 **本地与 CI 用同一个重试次数**（都是 1），理由如下。
   *
   * 在此之前是 `process.env['CI'] ? 1 : 0` —— 本地 0、CI 1。这个差异制造了一类
   * 最坏的"本地红、CI 绿"：真浏览器里有**负载型 flake**（同一条用例单跑必过、
   * 整套跑时因为前一族把它拖慢而偶发超时；`ai-duration:36` 就是这样被定位的），
   * 于是同一份代码在本地 `pnpm check` 报红、在 CI 上绿 ——
   * 而两边跑的是同一个门禁，**门禁的口径必须是同一个**。
   *
   * ⚠️ 重试**不掩盖**问题：Playwright 会把重试后通过的用例标成 `flaky`
   * （列表与 GitHub reporter 都看得见），所以"它是不是真的稳"仍然可查；
   * 而被重试救回来的用例不会让整个套件退出非零。
   * 这与仓库对门禁的一贯要求一致：**判据要么真的通过，要么响亮地失败** ——
   * "因为跑在哪个环境而给出不同结论"不属于这两种。
   */
  retries: 1,
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
