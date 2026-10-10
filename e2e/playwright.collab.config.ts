import { defineConfig } from '@playwright/test';

/**
 * `verify:collab-journey` 的 Playwright 配置（ADR-0062 / 计划 §4）。
 *
 * 与主配置（`playwright.config.ts`）的两点差别：
 * 1. **不起 webServer** —— 真实服务端（TEST_MODE）与 vite 都由
 *    `scripts/verify-collab-journey.mjs` 起好再拉起 Playwright（同一套
 *    生命周期，失败时读数齐全）。
 * 2. **baseURL 来自环境** `HEYTA_COLLAB_WEB_URL`（vite dev 端口由脚本分配，
 *    不写死 —— 与 e2e 专用端口 4318/4319 那族互不干扰，check:ai-e2e 的
 *    preflight 清的是它自己的端口，这里别撞上）。
 *
 * 🔴 截图/trace/video 关（秘密纪律）：共享旅程里有 vault 口令与一次性邀请
 * token，不进任何自动产物；证据截图由用例**显式**拍、落固定路径（§6.2 规定一）。
 */
export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env['HEYTA_COLLAB_WEB_URL'] ?? 'http://127.0.0.1:4327',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  outputDir: './test-results/collab-journey',
});
