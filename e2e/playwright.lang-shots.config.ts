import { defineConfig, devices } from '@playwright/test';

/**
 * 顶栏语言控件的**取证 + 判据**配置（独立私有端口）。
 * ==================================================
 *
 * ## 为什么不复用 `playwright.config.ts`
 *
 * 那一份的 `webServer` 钉在 4318/4319，而 `pnpm check:ai-e2e` 的预检
 * （`scripts/check-ai-e2e-preflight.mjs:83`）会对这两个端口上的进程**下 SIGKILL**。
 * 本机现在有并行会话在跑重活 —— 抢它们的端口 = 互相踢，而"被踢掉的那一轮"报的红
 * 根本不是被测产品的红。所以这里用 **4327 + `strictPort`**：端口被占就直接失败，
 * 不降级、不换端口、不杀别人。
 *
 * ## 跑哪些用例（`testDir: '.'` + `testMatch` 白名单）
 *
 * 除了 `./lang-shots` 自己的取证用例，这一支**还带上 `./tests` 里那两条会被本工单
 * 动到的判据**：
 *
 *   · `tests/language-first-launch.spec.ts` —— 它用 `language-option-*` 的**可见性**
 *     当"顶栏渲染完了"的锚点，形态一改它就得跟着改定位方式（判据本体不许动）；
 *   · `tests/theme-switch-contrast.spec.ts` —— 它拿页头那颗语言控件当对比度载体
 *     （`LANG_OPTION` 常量），形态一改它量的就不再是那个控件；
 *   · `tests/narrow-sweep.spec.ts` —— 660 塌缩态逐页扫描，钉住"页头变宽之后
 *     八个视图还切得过去、底部导航还在视口里"。
 *
 * 这四条都只碰顶栏与主题，一次模型请求都不发，所以这一支**不**启
 * `stub-provider.mjs` —— 少一个会和并行会话撞上的 4319 进程。
 *
 * ## 产物目录 ≠ 截图目录（两个目录，理由不同）
 *
 * - `outputDir: ./lang-shots-results`：与 `playwright.live-site.config.ts` 同一个理由 ——
 *   写进共享的 `test-results/` 会被别的会话的运行吃掉。
 * - 🔴 **截图落在 `./lang-shots-evidence/`，不在 outputDir 里**：Playwright 每次运行
 *   开始会**删除并重建 `outputDir`**，而这次的证据是"改前 / 改后"**两批**图 ——
 *   放进 outputDir 等于跑第二趟时把第一趟（改前长什么样）自动删掉，
 *   而那正是本次改动的唯一动机。
 */
export default defineConfig({
  testDir: '.',
  testMatch: [
    'lang-shots/**/*.spec.ts',
    'tests/language-first-launch.spec.ts',
    'tests/theme-switch-contrast.spec.ts',
    // 🔴 塌缩态逐页扫描：语言分组比原来宽 ~65px（多了可见标签），而 660 那一档
    //   是页头最挤的地方 —— 这条是"变宽会不会把页头顶爆"的现成载体（8 个视图）。
    'tests/narrow-sweep.spec.ts',
  ],
  outputDir: './lang-shots-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  // 🔴 不重试：视觉取证重试一次就是把"偶发的坏"洗成"看起来一直好"。
  retries: 0,
  reporter: [['list']],
  timeout: 90_000,
  expect: { timeout: 20_000 },

  use: {
    baseURL: 'http://127.0.0.1:4327',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // 后台跑：Chromium 由 Playwright 以独立进程启动，不 activate、不 bringToFront。
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    // `--host 127.0.0.1` 不能省（macOS 上 `localhost` 常先解析到 ::1，
    // 于是"服务起了但没监听 IPv4"，表现为无声超时）—— 与主配置同一条理由。
    command: 'pnpm --filter @heyta/web exec vite --host 127.0.0.1 --port 4327 --strictPort',
    cwd: '..',
    url: 'http://127.0.0.1:4327',
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
