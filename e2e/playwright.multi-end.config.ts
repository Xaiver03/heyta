import { defineConfig, devices } from '@playwright/test';

/**
 * 三端（Web ↔ 服务端 ↔ 笔记本）验收的**独立**配置。
 * ==================================================
 *
 * 🔴 **为什么不能塞进 `playwright.config.ts`**
 *
 * 那一份是**刻意离线**的：它只起一个假模型端点 + vite，被测对象自带 IndexedDB，
 * 不依赖本机的 3000 端口。这是它能进 `pnpm check` 的前提 ——
 * 一个"要先手动把服务端跑起来"的门禁，会在别人机器上莫名其妙地红，
 * 而红的原因和被测代码毫无关系。
 *
 * 所以这里：
 * - `testDir: './multi-end'` —— 与离线套件的 `./tests` **物理隔开**，
 *   `playwright.config.ts` 永远不会扫到这里的用例；
 * - **不注册进 `pnpm check`**，只挂在 `pnpm verify:multi-end` 上按需跑；
 * - 需要 `HEYTA_SYNC_SERVER` / `HEYTA_SYNC_TOKEN` / `HEYTA_SYNC_PASSWORD`
 *   三个环境变量，并**在前置断言里检查它们非空** ——
 *   缺凭据时要当场说清，不能静默跑出一个"什么都没发生"的绿。
 *
 * ## 端口
 *
 * 4328：避开离线套件的 4318（撞上会让 `reuseExistingServer` 之类把**别人的
 * 应用**当成被测对象，症状是"全绿但测的是另一个网站"）与 E2E 服务端的 3000。
 * `--strictPort` 也是为这个：起不来就报错，而不是悄悄换端口。
 *
 * ## 超时
 *
 * 比离线套件宽得多：这是**真同步**。首次同步要在浏览器里对**每个新 salt**
 * 跑一次 Argon2id，还要真的过网络、真的等 IndexedDB。
 */
const PORT = 4328;

export default defineConfig({
  testDir: './multi-end',
  fullyParallel: false,
  workers: 1,

  // 🔴 不许 `.only` 混进来：它会让整个套件悄悄退化成"只跑一条"。
  forbidOnly: !!process.env['CI'],
  // ⚠️ **不重试。** 离线套件重试是合理的（真浏览器偶发竞态）；
  // 但这里每一次重试都会往**同一个账号**里再写一份数据，
  // 而"上一次跑到一半"正是最难解释的失败来源。
  retries: 0,
  reporter: [['list']],
  timeout: 240_000,
  expect: { timeout: 120_000 },

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      // 🔴 `--host 127.0.0.1` 不能省：vite 默认绑 `localhost`，macOS 上
      // 常常先解析到 `::1`，于是服务起来了但没监听 127.0.0.1，
      // 而 Playwright 轮询的是 IPv4 —— 表现为"等 120 秒超时"。
      command:
        `pnpm --filter @heyta/web exec vite --host 127.0.0.1 --port ${String(PORT)} --strictPort`,
      cwd: '..',
      url: `http://127.0.0.1:${String(PORT)}`,
      // ⚠️ 保持 `false`：本脚本会**分两次**调用 playwright（中间插入笔记本的写入），
      // 复用上一次的进程看着更省事，但"复用到一个别的东西"是很安静的假绿。
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});