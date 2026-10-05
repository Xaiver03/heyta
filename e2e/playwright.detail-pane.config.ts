import { defineConfig, devices } from '@playwright/test';

/**
 * 「详情面」这一族判据的真浏览器载体（工单 W2 / W3 / W4 / W7 / W1b）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 **载体是 `vite preview` + `apps/web/dist`，不是 dev server** —— 这决定了
 * 任何改 `apps/web/src/**` 的**变异臂都必须先重打 `apps/web`**，否则量的是旧产物。
 * W1b 的第一趟就是这么"存活"的（改源码没重建 ⇒ 被测的那一份里根本没有变异 ⇒
 * 判据被读成"没有牙"）。变异脚本因此加了一条前置：构建后 `dist/` 的目录摘要
 * 必须与干净态不同，不同才允许判红/存活。
 *
 * ## 为什么这一族要单独一份配置
 *
 * 它们的判据全是**几何**（`boundingBox()` 的右边缘、列宽、视口高度边界）。
 * `vite dev` 载体在 linked worktree 里**结构性起不来**：vite 默认 `fs.allow` 只有
 * worktree 根，而 `node_modules` 是指向主检出的软链，`@sqlite.org/sqlite-wasm`
 * 的 wasm 走 `/@fs` 会被拒（原文读数记在 `docs/plans/detail-pane-alignment.md` §8 的
 * W1 行）。症状是"三条全红、红在找不到输入框"，长得像产品坏了而其实是载体。
 * ⇒ 这一族在生产构建上跑：`vite build` 的产物 + `vite preview`。
 *
 * ## ⚠️ 端口是 4371，不是 4358
 *
 * 4358 以前用过，但本机现在**躺着一条别人的 preview 占在那儿**
 * （现量：`lsof -nP -iTCP:4358 -sTCP:LISTEN` 有 PID，进程串里只有 `--port 4358`，
 * 看不出来它 serve 的是哪一棵树的 `dist`）。判据读的是产物，
 * 而产物是谁的那一份**量不出来** ⇒ 宁可用一个新端口自己打自己那份。
 * `--strictPort` 是这条纪律的一部分：抢不到就响亮地失败，不许悄悄换一个端口，
 * 那等于换了被测对象。
 *
 * ## 🔴 `testMatch` 不能省
 *
 * `testDir` 是整个 `tests/`，少了这一条会把**别人那一族**的用例一起跑在这份构建上
 * （`playwright.privacy-consent.config.ts` 记着同一形状的事故：那些红与本单无关，
 * 却会被读成"这单弄坏了别的"）。
 */
const APP_PORT = 4371;

/**
 * 🔴 `DP_SWEEP=1` 把 `testMatch` 放开到整个 `tests/`。
 * 这个旋钮存在的理由不是"方便"，而是**这一族判据之外的回归面**：
 * W4 往页头加了一颗按钮，而 `calendar-cells.spec.ts:107` 那条钉的正是
 * "页头这一排不许横向溢出"（`.ht-header__actions` 是 `flex: 0 0 auto`，
 * 加一格就可能把最右边顶出视口）。主配置（dev 载体）在 linked worktree 里起不来
 * （§8 W1 行记着那条 403），所以那一面在这棵树上**只有走生产载体才量得到**。
 * ⚠️ 放开之后会连带跑别人那一族的用例 —— 读结果时要按文件归因，
 *      不要把与本单无关的红读成"这单弄坏了别的"（`playwright.privacy-consent.config.ts`
 *      记着同一形状的事故）。
 * ⚠️🔴 本配置**不起假端点**（`stub-provider.mjs` 要占 4319，而那是别人 `check:ai-e2e`
 *      的端口 —— 见 §7 第 87 条"前置 SIGKILL 别人的 dev 服务"那一族）。
 *      所以 `DP_SWEEP` 只适合跑**不依赖 AI 端点**的那些用例（页头溢出、塌缩、菜单、
 *      覆盖层这一类）。要打 AI 的用例在这里会红在"点了没反应"上，
 *      **那是载体缺件，不是产品坏了** —— 那种红不许记进任何一单的判据。
 */
const SWEEP = process.env['DP_SWEEP'] === '1';

export default defineConfig({
  testDir: './tests',
  testMatch: SWEEP
    ? /\.spec\.ts$/
    : /(detail-(column-slot|pane-overlay|pane-collapse|pane-habit|pane-note-editor|pane-task)|focus-detail-pane|keyboard-cursor|selection-projections|habit-month-stats|habits-two-column)\.spec\.ts/,
  fullyParallel: false,
  // 🔴 0 重试：这一族量的是边界值（480 vs 479）与"轨道归零"，
  // 一次红就是要人看的读数；重试会把"边界写错"洗成"偶发"。
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // 固定路径，跑完可以直接打开那张图看（§6.2 规定一第 2 条）。
  outputDir: '/tmp/heyta-detail-pane-results',
  use: {
    baseURL: `http://127.0.0.1:${String(APP_PORT)}`,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [
    {
      name: 'chromium',
      // `locale` 必须在设备展开**之后**覆盖，否则 `devices['Desktop Chrome']`
      // 自带的 `en-US` 会把根 `use` 盖掉。
      use: { ...devices['Desktop Chrome'], locale: 'zh-CN' },
    },
  ],
  webServer: {
    // 不走 pnpm：本仓库在 linked worktree 里刻意只用本地 `node_modules/.bin`。
    command: `./node_modules/.bin/vite preview --outDir dist --host 127.0.0.1 --port ${String(
      APP_PORT,
    )} --strictPort`,
    cwd: '../apps/web',
    url: `http://127.0.0.1:${String(APP_PORT)}`,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 60_000,
  },
});
