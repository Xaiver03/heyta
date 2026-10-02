import { defineConfig, devices } from '@playwright/test';

/**
 * 真浏览器版「同意之前一个请求都不发」（链 5 / G-12 的取证半边）。
 *
 * 🔴 **为什么必须用生产构建，不能沿用主配置的 `vite dev`**：
 * `apps/web/src/pwa/register.ts:48` 是 `if (!import.meta.env.PROD) return;` ——
 * dev 下**根本不注册 SW**，于是在 dev 里"没有 /sw.js 请求"这条判据**恒真**，
 * 拿掉整道闸门它照样绿（AGENTS §7 元规则 2：一条永远通过的判据比没有判据更糟）。
 * 只有生产构建里 SW 那条口才活着，而 G-12 点名的恰好就是它
 * （"注册本身就向 scope 发一次请求"）。
 *
 * 端口用 4322：主配置那两条 webServer 会在 4318/4319 上**先杀再占**
 * （共享工作树里那是别的会话的 vite，§7 第 87 条），这里只读不抢。
 */
const APP_PORT = 4322;

export default defineConfig({
  testDir: './tests',
  // 🔴 `testMatch` 不能省：`testDir` 是整个 `tests/`，少了这一条就会把**别人的**
  // 103 条用例一起跑在这一份生产构建上（实测：整套跑起来，`account-menu` 那几条
  // 因为缺 stub-provider 而全红 —— 那些红与本链无关，却会被当成"链 5 弄坏了别的"）。
  testMatch: /privacy-consent-zero-egress\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // 固定路径，跑完可以直接打开那张图看（§6.2 规定一第 2 条）。
  outputDir: '/tmp/heyta-privacy-consent-results',
  use: {
    baseURL: `http://127.0.0.1:${String(APP_PORT)}`,
    trace: 'off',
    video: 'off',
    // 🔴 失败也要有图：先截图再断言，所以截图在用例内部写死路径，这里只关自动截图。
    screenshot: 'off',
  },
  projects: [
    {
      name: 'chromium',
      // `locale` 必须在设备展开**之后**覆盖，否则 `devices['Desktop Chrome']`
      // 自带的 `en-US` 会把根 `use` 盖掉（`playwright.solo4321.config.ts` 同一个坑）。
      use: { ...devices['Desktop Chrome'], locale: 'zh-CN' },
    },
  ],
  webServer: {
    // 复用**已经打好的** `apps/web/dist`（生产构建 ⇒ SW 那条口是活的）。
    // 刻意不在这里重跑 build：`apps/web/dist` 是共享工作树里别人也在用的产物，
    // 由交付流程（§6.1.1 `pnpm reinstall:all`）负责它的新旧，本配置只服务它。
    command: `pnpm --filter @heyta/web exec vite preview --host 127.0.0.1 --port ${String(
      APP_PORT,
    )} --strictPort`,
    // 🔴 `cwd: '..'` 不能省：`e2e/` 刻意不在根 pnpm 工作区内（见它的
    // `pnpm-workspace.yaml`），在 e2e 目录下跑 `--filter @heyta/web` 会得到
    // "No projects matched the filters"，症状是 webServer 秒退、整套用例不跑。
    cwd: '..',
    url: `http://127.0.0.1:${String(APP_PORT)}`,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 60_000,
  },
});
