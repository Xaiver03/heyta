import { defineConfig, devices } from '@playwright/test';

/**
 * 链 2 的上线判据：注册面板上那两条条款链接，**在真浏览器里点得开**。
 * ================================================================
 *
 * 为什么必须真浏览器（AGENTS §6.2 规定一）：这一轮要回答的是
 * "用户点下去之后到了哪"，而 jsdom 里**没有导航** ——
 * `target="_blank"` 在 jsdom 中什么都不发生，`<label>` 嵌套切换勾选的
 * 真实语义、新标签的地址、服务端返回的状态码，全部观测不到。
 *
 * ## 两种 baseUrl 各跑一次（按 D-09 的分流，这是验收的本体）
 *
 * - **官方托管域** ⇒ 打开的是落地页 `/legal/*`（那份必然是 heyta 的）；
 * - **别人的 / 自建的 server** ⇒ 打开的是 `<baseUrl>/privacy.html`，
 *   而那台没配 `PRIVACY_*` 时**必须是 404**，不许悄悄退回落地页
 *   （替别人实例代发 heyta 的政策 = 让部署者拿到一份署名错误的文本）。
 *
 * ## 官方域那一侧的内容仍由**本地构建产物**顶替 —— 但理由换了（2026-10-01）
 *
 * `context.route()` 把 `heyta.waytofuture.cn/**` 转发到本地
 * `vite preview` 的落地页构建。转发的只有"服务器返回哪些字节"这一件事，
 * **链接是产品代码算出来的、点击是真点击、导航是真导航**。
 *
 * 原来写这条转发的理由是「线上还没发布，直连会拿到 nginx 兜底的首页」——
 * 那个缺口（`docs/plans/legal-compliance-before-filing.md` 的 **G-25**）**已闭合**。
 * 转发**保留**，换成另一条理由：这条套件判的是**产品代码把点击带到哪**，
 * 它必须离线、必须与线上部署状态解耦（本套件自己起 4330/4332 两个本地服务，
 * 绑上公网之后，CDN 抖动或断网都会把"分流对不对"染成红 —— 而那是两类不同的事）。
 *
 * 🔴 **线上真实字节由另一条套件直连真服务器验**：`e2e/live-site/live-legal.spec.ts`。
 * 那份用 `--host-resolver-rules` + `--no-proxy-server` 把域名钉到真实 IP ——
 * 这台开发机的 DNS 走本地代理（fake-ip），不加那两参数验的就是代理而不是服务器。
 * 两边分工不重叠：这里红了是**代码坏**，那里红了是**部署没跟上**。
 *
 * 自建那一侧**零转发**：`heyta.finlaw.cloud` 是一台真在跑的服务端，
 * 那个 404 是它自己答的。
 *
 * ## 端口
 *
 * 4330（web 应用）/ 4332（落地页预览）。避开 4318（离线套件）、4320
 * （落地页套件）、4321、4328、4329 —— 撞上会让 `reuseExistingServer`
 * 把**别人的应用**当成被测对象，症状是"全绿但测的是另一个网站"。
 * `--host 127.0.0.1` 与 `url` 用同一个名字（macOS 上 `localhost` 常先解析到
 * `::1`，混用表现为"服务起了却等 120 秒超时"）。
 */
const WEB_PORT = 4330;
const LANDING_PORT = 4332;

export default defineConfig({
  testDir: './legal-links',
  // 🔴 独立产物目录：Playwright 每次运行开始会删除并重建 outputDir，
  //    与别的套件共用 `test-results/` 会把人还没看的截图整个删掉。
  outputDir: './legal-links-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  // 不重试：每条用例都要真的点开一个页面，重试会让"哪一次点击算数"最难解释。
  retries: 0,
  reporter: process.env['CI'] ? [['list'], ['github']] : [['list']],
  timeout: 120_000,
  expect: { timeout: 30_000 },

  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    // 截图由 spec 自己**先于断言**落到固定路径（§6.2 规定一第 1、2 条）。
    screenshot: 'off',
    video: 'off',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      // 🔴 `build` 不能省：preview 只看 `dist/` 里已有的东西，不带 build 跑的是
      //    上一轮的产物（AGENTS §7 第 27 条同一个失效形态）。
      command: `pnpm --filter @heyta/landing build && pnpm --filter @heyta/landing exec vite preview --host 127.0.0.1 --port ${String(LANDING_PORT)} --strictPort`,
      cwd: '..',
      url: `http://127.0.0.1:${String(LANDING_PORT)}/legal/terms/`,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 300_000,
    },
    {
      command: `pnpm --filter @heyta/web exec vite --host 127.0.0.1 --port ${String(WEB_PORT)} --strictPort`,
      cwd: '..',
      url: `http://127.0.0.1:${String(WEB_PORT)}`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
