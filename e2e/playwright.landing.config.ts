import { defineConfig, devices } from '@playwright/test';

/**
 * 落地页 / 文档中心的真浏览器验收配置。
 *
 * ## 🔴 为什么被测对象是 **build 产物** 而不是 dev server
 *
 * 这一套判据要看的是**访客真的会拿到的那份 HTML**：多入口静态文件
 * （`help/how/index.html` 等 29 份，由 `scripts/gen-entries.mjs` 从注册表生成、
 * 签进仓库）加上 hydration 之后的 React 树。dev server 会现场重拼 HTML，
 * 于是"生成物与磁盘上的文件不一致"这类问题（`check:entries` 管的那一类）
 * 在浏览器里**看不出来** —— 而它恰恰是本轮新增 12 份入口时最可能出的错。
 *
 * ## 🔴 为什么 `webServer` 里带一次 build
 *
 * `preview` 只看 `dist/` 里**已有的**东西。不带 build，跑的就是上一轮的产物 ——
 * 这与 AGENTS §7 第 27 条（APK 里打进旧 JS bundle）、第 82 条（Windows 段装的是
 * 旧树而判据全绿）是同一个失效形态：**结论看起来全绿，测的是旧字节**。
 * 所以命令是 `build && preview`，每次都是当前源码。
 *
 * ## 端口
 *
 * 4320，且 `strictPort`。理由与主套件用 4173/5173 之外的端口一样：
 * 撞上别的项目时，`reuseExistingServer` 会把**别人的站点**当成被测对象，
 * 症状是"测试全绿但测的是另一个网站"。
 */
const PORT = 4320;

export default defineConfig({
  testDir: './landing',
  /**
   * 🔴 **独立的产物目录，不跟其它套件共用 `test-results/`。**
   *
   * Playwright 在**每次运行开始时**删除并重建 `outputDir`。默认值是按 config 目录算的
   * （`e2e/test-results`），于是 `playwright.auth-journey.config.ts` 这些套件跑一轮，
   * 就把本套件**人还没看的那几张图**整个删掉 ——
   * 本轮实测就撞上了：6 条全过、`test-results/` 里只剩另一套件的 `auth-journey-*.png`，
   * 于是 §6.2 规定一第 4 条（人必须看图）根本没有图可看。
   *
   * 这不是假设的风险：这个 checkout 上**同时有多个会话在干活**（工作树里同时躺着
   * 别人的 `apps/web` 认证改动与 `verify-email-web-chain` 证据），
   * 任何人跑一次主套件就会清掉这里的证据。
   *
   * ⚠️ **只解决了本套件自己这一份。** e2e 下六个 config 的 `outputDir` 默认值**全都相同**，
   * 它们的固定路径截图仍然会互相覆盖 —— 那是一次独立的改动，不顺手做在这里。
   *
   * ⚠️ 配套：spec 里 `page.screenshot({ path })` 的相对路径必须落在**同一个目录**，
   * 否则图写进共享的 `test-results/` 而只有 trace 进了这里，等于没解决问题。
   */
  outputDir: './landing-results',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: 1,
  workers: 1,
  reporter: process.env['CI'] ? [['list'], ['github']] : [['list']],
  timeout: 90_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    // 🔴 这里的 `off` 是有意的：本套件的截图**先于断言**落固定路径
    // （AGENTS §6.2 规定一第 1、2 条），失败时"顺便"再拍一张不解决问题 ——
    // 需要的是那一张一直在那里、名字不变的证据。
    screenshot: 'off',
    video: 'off',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: `pnpm --filter @heyta/landing build && pnpm --filter @heyta/landing exec vite preview --host 127.0.0.1 --port ${String(PORT)} --strictPort`,
    cwd: '..',
    url: `http://127.0.0.1:${String(PORT)}/`,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 240_000,
  },
});
