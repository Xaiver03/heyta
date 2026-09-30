import { defineConfig, devices } from '@playwright/test';

/**
 * 认证旅程验收的**独立**配置：真浏览器 + 真服务端 + 真 WebAuthn。
 * ================================================================
 *
 * ## 它与另两份配置的分工
 *
 * - `playwright.config.ts`（`./tests`）—— **刻意离线**：假 AI 端点 + vite，
 *   没有服务端，所以**验不到注册/登录/同步**；
 * - `playwright.multi-end.config.ts`（`./multi-end`）—— 有真服务端，
 *   但凭据是 shell 用 `/api/test/create-user` 建好后**注入**的，
 *   界面上的注册/登录入口一次都没被点过；
 * - **这一份**（`./auth-journey`）—— 从「未登录冷启动」出发，把
 *   **注册 → 登录 → 同步 → 新设备恢复 → 退出登录**整条链在真浏览器里走完。
 *   通行密钥那一步系统弹窗由 CDP 的**虚拟认证器**真实应答
 *   （`navigator.credentials.create/get` 是真的在跑，不是 stub）。
 *
 * ## 前置
 *
 * 必须由 `scripts/verify-web-auth-journey.mjs` 启动（它负责建库、迁移、
 * 以 TEST_MODE 拉起服务端，并设好 `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN`）。
 * 服务端地址经 `HEYTA_AUTH_JOURNEY_SERVER` 传入，用例内**显式检查非空** ——
 * 缺了就当场报错，不许静默跑出一个"什么都没发生"的绿。
 *
 * ## 端口
 *
 * 4329：避开离线套件的 4318 与三端验收的 4328（撞上会让 `reuseExistingServer`
 * 把别人的应用当成被测对象）。`--strictPort`：起不来就报错，不悄悄换端口。
 */
const PORT = 4329;

export default defineConfig({
  testDir: './auth-journey',
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env['CI'],
  // ⚠️ **不重试**，与 multi-end 同一理由：每一条用例都往同一个新注册的账号里
  // 写数据，"上一次跑到一半"重试出来的状态最难解释。失败要当场响。
  retries: 0,
  reporter: [['list']],
  // 真同步 + 每个"新 salt"一次 Argon2id，比离线套件慢得多 —— 对齐 multi-end 的宽度。
  timeout: 240_000,
  expect: { timeout: 120_000 },

  use: {
    // 🔴 **必须是 `localhost`，不能是 `127.0.0.1`**（2026-09-30）：WebAuthn 的 RP ID
    // 必须是 origin 的**域名后缀**，而 Chromium **拒收 IP 字面量**做 RP ID
    // ⇒ 页面跑在 `127.0.0.1` 上时那条旅程根本走不到注册成功。
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      // 🔴 **`--host localhost` 与下面的 `url` 必须用同一个名字。**
      //    2026-09-29 踩过的是**混用**：vite 绑 `localhost`（macOS 上常先解析到 `::1`），
      //    而 Playwright 轮询 IPv4 `127.0.0.1` ⇒ "服务起了却等 120 秒超时"。
      //    现在两侧都是 `localhost`：解析结果一致，谁也不会等谁。
      command:
        `pnpm --filter @heyta/web exec vite --host localhost --port ${String(PORT)} --strictPort`,
      cwd: '..',
      url: `http://localhost:${String(PORT)}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
