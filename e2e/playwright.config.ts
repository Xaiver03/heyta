import { defineConfig, devices } from '@playwright/test';

import { APP_ORIGIN, APP_PORT, STUB_ORIGIN, STUB_PORT } from './ports';

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
 *
 * 🔴 但这两个号**不是常量**，是 `./ports` 给的一个可以挪开的槽（默认值逐字不变）：
 * 同一台机上还有兄弟检出（`…/heyta` 与 `…/heyta-wt-merge`），2026-10-06 实测两棵树共用同一对
 * 固定端口时，跑到一半端口换人 ⇒ 后半程连的是别人那棵树的应用（traps #358）。
 * 要窗口：`HEYTA_E2E_APP_PORT=… HEYTA_E2E_STUB_PORT=… pnpm check:ai-e2e`。
 */
export default defineConfig({
  testDir: './tests',
  // 🔴 这一支**不能**在主配置里跑：它测的是"同意之前不注册 Service Worker"，
  // 而 `register.ts` 在 `!import.meta.env.PROD` 时直接 return ——
  // 在 `vite dev`（本配置起的 4318）下那条正向对照永远拿不到非零，
  // 于是整套"零出站"会变成**恒真的判据**（§7 元规则 2）。
  // 它需要生产构建，跑法：`npx playwright test -c playwright.privacy-consent.config.ts`。
  //
  // 🔴 第二条 2026-10-17 补：`auth-simple-ux.spec.ts` **有自己的配置**
  // （`playwright.auth-simple.config.ts`：web 4341 + stub 4342，文件头写了理由）。
  // 而它同时被本配置收进来 ⇒ 两条后果，都是本轮实测的：
  //   ① 它那两条用例在本配置下**必红**（本配置的 stub 在 4319，4342 上什么都没有，
  //      `apiRequestContext.get: connect ECONNREFUSED 127.0.0.1:4342`）；
  //   ② 🔴 更贵的一条：那个 `ECONNREFUSED` 会被**载体健康报告器**认成"载体死了"，
  //      于是整轮 393 条**当场作废**（退出码 160），跑了几十分钟的读数全丢
  //      （本轮实测：`NON_AI2_RC=160`，停在 49/393）。
  //      ⇒ 报告器那一侧也一起修了（`carrier-signature.mjs` 现在按**主载体端口**判，
  //      不是"任何 ECONNREFUSED 都算"），这里是第二道：这一支就不该进本配置。
  // ⚠️ 它自己的配置**目前没有任何消费者**（`grep -rn auth-simple package.json scripts/`
  //    回 0 处）⇒ 它那两条用例当前**谁都不跑**，且在本机用自己那份配置复跑也是红
  //    （2 failed / 1 passed，卡在 `waiting for locator('.ht-sheet__auth')`）。
  //    这一格已登记进 `BLOCKED.md`（孤儿配置 + 两条真红），接线是一次独立决定。
  // 🔴 第三条 2026-10-17 补：`collab-journey.spec.ts` 要**真实例**（`HEYTA_COLLAB_BASE`，
  // 默认 `http://127.0.0.1:3217` 的 `/api/test/create-user`、`/api/shares`），而本配置只起
  // 「假端点 4319 + vite 4318」⇒ 在本配置下它**必然红**：`TypeError: fetch failed`
  //（本轮冻结副本整轮里也量到同一形状）。
  // 它属于**自己那套 rig**：`pnpm verify:collab-journey`
  //（`scripts/verify-collab-journey.mjs`，用 `playwright.collab.config.ts`，自带真服务端与 4327 的 web）。
  // ⇒ 与本文件开头 `privacy-consent` / `auth-simple-ux` 同一条理由：**它不该进本配置**。
  // ⚠️ 同 `auth-simple-ux`：那套 rig **不在 `pnpm check` 链里**（已登记 `BLOCKED.md`），
  //    所以这一支的覆盖在链上是空的 —— 摘出本配置只是让**本套件的读数不再说谎**。
  testIgnore: [
    /privacy-consent-zero-egress\.spec\.ts/,
    // 🔴 2026-10-25 加：`ai-tool-run.spec.ts`（三条）测的是**单步工具面板**，
    //    而那个面板在 2026-10-10 的外壳重写里被**有意**并进了助手面
    //    （理由逐字在 `apps/web/src/styles/app/ai-panels.css:799-802`：「工具执行属于对话中的
    //    过程状态，不再与聊天并列成两个需要用户选择的入口」）。⇒ 那三条**没有被测物**，
    //    在本配置下必然红，而"一直红"最容易被读成环境问题。
    //    能力没有丢：零出境 / 披露后出境 / 写工具只提案这三条在现存面上由
    //    `ai-assistant.spec.ts` 与 `ai-assistant-atomic-tools.spec.ts` 守着。
    //    ⚠️ 这是**退役**不是删除：文件与它的判据都留着，登记在 `BLOCKED.md` B226 ——
    //    要么哪天把单步入口接回来（改这一行即可），要么把那三条的能力断言正式迁进助手那条链。
    /ai-tool-run\.spec\.ts/,
    // 🔴 2026-10-25 加：`reminder-permission-final.spec.ts` 有**自己的配置**
    //    （`playwright.reminder-permission.config.ts`：Web 固定在 4355，且要用 CDP 改
    //    站点权限）。在本配置下它必然红 —— 4318 上没有任何东西在 4355 听，报出来的是
    //    `page.goto: net::ERR_CONNECTION_REFUSED http://127.0.0.1:4355/`，
    //    看着像"应用起不来"。
    //    ⇒ 它现在有**自己的门禁**：`pnpm check:reminder-permission`（已进 `pnpm check` 链）。
    //    本条目只是把它从"会被这一套跑、且必红"的集合里摘出去。
    /reminder-permission-final\.spec\.ts/,
    /auth-simple-ux\.spec\.ts/,
    /collab-journey\.spec\.ts/,
  ],
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

  // 🔴 第三份是**载体健康**报告器：dev server 中途死了要立刻响亮停下，
  //    而不是把剩下 190 条 `ERR_CONNECTION_REFUSED` 逐条报成产品失败。
  //    三份进链的配置都必须带上它，由 `check:e2e-carrier` 逐份盯着。
  reporter: [
    ['list'],
    ...(process.env['CI'] ? [['github'] as const] : []),
    ['./reporters/carrier-health.mjs'],
  ],

  // 真浏览器比 jsdom 慢，但单条用例不该超过这个数。
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: APP_ORIGIN,
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
      command: `STUB_PORT=${String(STUB_PORT)} node stub-provider.mjs`,
      url: `${STUB_ORIGIN}/__requests`,
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
      command: `pnpm --filter @heyta/web exec vite --host 127.0.0.1 --port ${String(APP_PORT)} --strictPort`,
      cwd: '..',
      url: APP_ORIGIN,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
