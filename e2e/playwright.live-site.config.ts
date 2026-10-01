import { defineConfig, devices } from '@playwright/test';

/**
 * **线上站点**验收的独立配置：真浏览器 + 真域名 + 真 TLS + 真服务端。
 * ==================================================================
 *
 * ## 它与另三份配置的分工
 *
 * - `playwright.config.ts`（`./tests`）—— **刻意离线**：假 AI 端点 + 本地 vite；
 * - `playwright.multi-end.config.ts`（`./multi-end`）—— 真服务端，但跑在本机；
 * - `playwright.auth-journey.config.ts`（`./auth-journey`）—— 真 WebAuthn，本机；
 * - **这一份**（`./live-site`）—— 不启任何本地服务，直接打**公网域名**。
 *   验的是"部署这件事本身"：解析、证书、nginx 路由、产物里烘焙的域名。
 *
 * 前三份都验不到部署。`curl` 只看得到状态码，看不到
 * 「按钮点了会去哪」「换域名后卡片还印着谁」—— 那正是本仓库
 * 在 2026-09-27 那次迁移里靠真浏览器才抓到的东西（见 `docs/runbooks/deployment.md` §3.7.1）。
 *
 * ## 🔴 为什么把域名**钉死**在 IP 上
 *
 * 这台开发机的 DNS 走本地代理（fake-ip：`heyta.waytofuture.cn` 解析成
 * `198.18.0.7`）。浏览器如果走系统解析，验的就是**代理**而不是服务器，
 * 而且代理一关，这条验收就从"真"变成"假绿"。
 *
 * 所以用 Chromium 的 `--host-resolver-rules` 把域名映射到真实 IP：
 * **SNI、Host 头、证书校验、WebAuthn RP ID 全都还是真域名的**
 * （这些都不看解析结果），只有"去哪个 IP"被钉死。
 * DNS 本身另用 DoH 与 DNSPod API 单独核实 —— 两件事分开验，各自有据。
 *
 * ## 端口
 *
 * 没有 `webServer`，但 `HEYTA_LIVE_ORIGIN` 决定打哪个域名，默认线上正式域名。
 */

const LIVE_ORIGIN = process.env['HEYTA_LIVE_ORIGIN'] ?? 'https://heyta.waytofuture.cn';

/** 线上服务器的公网 IP。与 `--host-resolver-rules` 一起用，理由见上。 */
const LIVE_IP = process.env['HEYTA_LIVE_IP'] ?? '124.223.13.226';

export default defineConfig({
  testDir: './live-site',
  // 🔴 独立产物目录，**不是**默认的 `test-results/`。
  //    `live-domain.spec.ts` 把自己那批固定路径截图（`test-results/live-*.png`）写进共享目录，
  //    而 Playwright 每次运行开始会**删除并重建 outputDir** —— 于是默认的
  //    `test-results/` 既会被这条套件的每一次运行吃掉别的套件还没看的证据，
  //    两条会话同时跑线上验收时还会互相删掉对方的 trace，症状是
  //    `browserContext.close: ENOENT …/.playwright-artifacts-*/…trace`
  //    （断言其实全过了，用例却判红 —— 2026-10-01 实测吃过一次）。
  outputDir: './live-site-results',
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env['CI'],
  // 线上验收**不重试**：它打的是真实公网，重试会把"网络抖动"洗成"通过"，
  // 而我们恰恰想知道站点是不是真的稳。
  retries: 0,
  reporter: [['list']],
  timeout: 120_000,
  expect: { timeout: 30_000 },

  use: {
    baseURL: LIVE_ORIGIN,
    // 证书是真 Let's Encrypt 签的，**必须**严格校验 —— 忽略它就等于
    // 放弃了"证书对得上这个域名"这条判据，而那正是本次迁移要验的东西之一。
    ignoreHTTPSErrors: false,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // `--no-proxy-server` 同样不能省：本机 `HTTPS_PROXY` 指向本地代理，
          // Chromium 会默认走它 —— 那就变成"验代理"而不是"验服务器"，
          // 且代理一关这条验收静默变成另一种东西。
          args: [`--host-resolver-rules=MAP heyta.waytofuture.cn ${LIVE_IP}`, '--no-proxy-server'],
        },
      },
    },
  ],
});
