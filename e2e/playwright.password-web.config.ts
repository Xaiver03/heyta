import { defineConfig, devices } from '@playwright/test';

/**
 * 邮箱 + 口令那条旅程的**真浏览器**配置（`pnpm verify:password-web`）。
 * ================================================================
 *
 * ## 它和另外几份配置怎么分工
 *
 * - `playwright.config.ts`（`./tests`）—— **刻意离线**：没有服务端，判不了注册/登录；
 * - `playwright.auth-journey.config.ts`（`./auth-journey`）—— 有真服务端，但走的是
 *   **通行密钥**，且服务端开 TEST_MODE（邮箱自动验证、不发真信）；
 * - **这一份**（`./password-web`）—— 服务端 **TEST_MODE 关**：口令注册 ⇒ 真的发出
 *   那一封信 ⇒ 真的在浏览器里点开它 ⇒ 确认页跳 `/app/` ⇒ 再用口令登录一次。
 *
 * ## 🔴 为什么这里**没有** `webServer`
 *
 * 被测拓扑是**同源反代**（应用与 API 同一个 origin），由
 * `scripts/verify-password-web-journey.mjs` 起。vite dev server 起不了这个作用：
 * 确认页成功后跳的是 `/app/`，而那一格在生产上是反代给的（`verify:multi-end`
 * 与 `verify-email-web-chain.mjs` 记录过同一条理由）。用 `vite --base` 复刻
 * 只会让这条验收测到 vite 的配置而不是产品的导航。
 *
 * 所以**必须**由那个驱动脚本启动。直接 `playwright test --config=` 跑这里会在
 * 第一条用例就抛「缺环境变量 HEYTA_AUTH_JOURNEY_SERVER」—— 那是故意的：
 * 一个"什么都没连上但全绿"的运行比红更坏。
 *
 * ## 端口
 *
 * 4401：避开离线套件 4318、落地页 4320、三端 4328、认证旅程 4329、条款链接
 * 4330/4332。撞上别人的端口 = 反代把**别人的应用**当被测对象（全绿，测的是别的网站）。
 * 服务端 API 用 3233（`verify:password-chain` 那类脚本各占一个端口，互不踩）。
 *
 * ## 截图
 *
 * `screenshot: 'off'` —— 由 spec 自己**先于断言**落到固定路径
 * （AGENTS §6.2 规定一第 1、2 条：失败时也要有图，且路径不随测试名变化）。
 * 独立 `outputDir`：Playwright 每次运行会重建它，共用 `test-results/` 会删掉
 * 别的套件**还没被人看过**的截图。
 */
const WEB_PORT = 4401;

export default defineConfig({
  testDir: './password-web',
  outputDir: './password-web-results',
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env['CI'],
  // 不重试：这条旅程的每一轮都在真库里建**一个新账号**并真的发一封信。
  // 重试会让"哪一次点击与哪一封信算数"变成最难解释的那类红。
  retries: 0,
  reporter: [['list']],
  // 每个新盐一次真 Argon2id + 真发信 + 真导航，比离线套件慢得多 —— 对齐 auth-journey。
  timeout: 240_000,
  expect: { timeout: 120_000 },

  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'off',
    video: 'off',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
