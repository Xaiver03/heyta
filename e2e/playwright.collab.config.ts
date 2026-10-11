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
 *
 * 🔴 `outputDir` **不许**落在共享的 `test-results/` 树里：Playwright 每次运行
 * 开始会删除并重建 outputDir，而别的 config（含并行会话在跑的主套件）默认也指
 * `test-results/` ⇒ 协作旅程的证据图会被它们**整树清掉**（2026-10-10 实测：
 * 跑完看图，目录没了）。同一条坑的先例与解法见 `playwright.landing.config.ts`
 * 的注释；这里搬到独立的 `collab-journey-results/`（证据路径与 verify 脚本同改）。
 */
export default defineConfig({
  testDir: './tests',
  // 双账号 vault 建立（浏览器内 Argon2）+ 等待信封轮询 + vite dev 冷启动都算在
  // 内 —— 共享构建机上 120s 不够（首跑实测），180s 是旅程级预算不是单断言预算。
  timeout: 180_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env['HEYTA_COLLAB_WEB_URL'] ?? 'http://127.0.0.1:4327',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  outputDir: './collab-journey-results',
});
