import { defineConfig } from '@playwright/test';

/**
 * Windows 桌面壳里的真应用 —— 认证旅程验收（Playwright over CDP → WebView2）
 * ======================================================================
 *
 * ## 它与另外三份配置的分工
 *
 * - `playwright.config.ts`（`./tests`）—— 刻意离线：假 AI 端点 + vite，没有服务端；
 * - `playwright.multi-end.config.ts`（`./multi-end`）—— 有真服务端，但凭据是
 *   注入的，界面上的注册/登录入口一次都没被点过；
 * - `playwright.auth-journey.config.ts`（`./auth-journey`）—— 真浏览器 + 真服务端，
 *   但它测的是 **vite 上的 web**，不是桌面端；
 * - **这一份**（`./windows-shell`）—— 被测界面是 **Windows 机器上真壳里的真应用**
 *   （`apps/desktop-windows` 的 WinUI 3 壳，WebView2 里加载 `apps/web/dist`），
 *   经 CDP 远程附着上去驱动。它回答的是
 *   `check-journey-coverage.mjs` 里 **windows 那一格**的缺口：
 *   「注册/登录之后的链路」在桌面端到底成不成立。
 *
 * ## 🔴 为什么没有 `webServer`，也没有 project 的 `browser`
 *
 * 被测的东西**不是本进程起得来的**：
 *   - 应用在另一台机器（`windows-pc`）的 WebView2 里，由
 *     `scripts/windows/launch-winui-shell-cdp.ps1` 在交互式桌面会话里启动；
 *   - 浏览器**不是 Playwright 下载的 chromium**，而是 WebView2（Edge 内核）。
 *
 * 所以这里不声明 `webServer`，也不声明任何会使用内置 `browser` / `page`
 * fixture 的东西 —— 本套件的用例只用 `shell` 这个自定义 fixture
 *（见 `windows-shell/helpers.ts`）。没人请求内置 browser fixture，
 * Playwright 就不会去启动一个**本地的**浏览器；否则会出现最坏的那种假绿：
 * 「测试全过」而测的是另一台机器上另一个浏览器里的另一个界面。
 *
 * ## 前置
 *
 * 必须由 `scripts/verify-windows-shell-journey.mjs`（`pnpm verify:windows-auth`）
 * 启动：它负责同步源码、在 Windows 上发布并**在交互式会话里**启动壳、
 * 开好 CDP 隧道与**反向**的 3211 隧道、并以 TEST_MODE 拉起本机服务端。
 * 单独 `playwright test -c` 跑会在身份闸门处当场报错，而不是静默跑出一个空绿。
 */
export default defineConfig({
  testDir: './windows-shell',
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env['CI'],
  // ⚠️ **不重试**，与 auth-journey / multi-end 同一理由：每条用例都往同一个
  // 新注册的账号里写数据，而壳是**常驻进程**（状态跨用例留存），
  // "上一次跑到一半"重试出来的状态最难解释。失败要当场响。
  retries: 0,
  reporter: [['list']],
  // 真同步 + 每个"新 salt"一次 Argon2id，再加"每条用例前重置设备 + 重新加载壳"，
  // 比 web 那条慢 —— 给足宽度。
  timeout: 300_000,
  expect: { timeout: 120_000 },

  use: {
    // 壳里的 origin（`SetVirtualHostNameToFolderMapping` 映射出来的虚拟主机）。
    baseURL: 'https://heyta.local',
    /**
     * 🔴 **动作超时必须有限。**
     *
     * Playwright 的 `actionTimeout` 默认是 **0 = 不超时**：一个点不到的元素会
     * 一直重试到**整个用例超时**（这里 300s），而报错只说
     * 「Test timeout of 300000ms exceeded」—— **不告诉你是哪一步卡住的**。
     * 2026-09-30 实测就吃了这个亏：W4 挂了 5 分钟，只留下一句总超时。
     *
     * 给一个明确的上限之后，同一次失败会变成
     * 「locator.click: Timeout 30000ms exceeded … waiting for …」，
     * 直接点名是哪个元素、被什么挡住。
     */
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    // ⚠️ 刻意**不**设 trace / video：它们挂在 Playwright 自己创建的 context 上，
    //    而这里的 context 是**附着**来的（壳的 WebView2 user-data-dir）。
    //    证据靠套件里**固定路径**的 `page.screenshot()`
    //    （AGENTS.md §6.2 规定一：截图 + 人真的看）。
  },
});
