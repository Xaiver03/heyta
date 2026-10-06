/**
 * 规范端口被别人占着时，几何这一族用的并行载体（4418 / 4419）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 为什么需要它
 *
 * `playwright.config.ts` 把 4318/4319 写死、`--strictPort`、没有环境变量旋钮
 * （现量：`grep -c 4318 e2e/playwright.config.ts` 有命中，而 `process.env` 里没有端口）。
 * `--strictPort` 是对的 —— 抢不到就响亮地失败，不许悄悄换一个端口（那等于换被测对象）。
 * 但它的另一面是：**同一台机器上两个会话不能同时跑真浏览器验收**，
 * 后起的那一个只会得到 "Port 4318 is already used"。
 * 2026-10-06 工单 H11 就是撞在这一档上：另一会话的批量验收（11 份 spec）在跑，
 * 而 H11 的界面改动**必须**有真浏览器截图（§6.2 规定一）。
 *
 * 这一份配置做的是同一件事的**另一个端口**：同一台 vite dev、同一份 `stub-provider.mjs`
 * （它本来就认 `STUB_PORT`）、同一套判据文本。换的是载体，不是尺子。
 *
 * ## 🔴 射程：只给**不碰假端点**的族用
 *
 * `tests/helpers.ts` 里的 `STUB_ORIGIN` 是**写死的** `http://127.0.0.1:4319`
 * （它没有跟着这份配置挪）。所以任何调用 `resetStub` / `stubLog` / `expectStubCount` /
 * `configureEndpoint` 的用例都不能在这一份上跑 —— 它们会去读**别人那一棵树的**假端点，
 * 症状是"计数永远 0"或"读到不相干的请求日志"，比报错更糟。
 * 要覆盖那一批，得先把 `STUB_ORIGIN` 一起参数化（那是另一单，见
 * `docs/plans/goal-layout-audit.md` §9.15 的登记）。
 *
 * 跑法（仓库根）：
 *   `cd e2e && npx playwright test -c playwright.parallel.config.ts tests/shell-no-document-scroll.spec.ts`
 */

import { defineConfig } from '@playwright/test';
import main from './playwright.config';

const WEB_PORT = 4418;
const STUB_PORT = 4419;
const WEB_ORIGIN = `http://127.0.0.1:${String(WEB_PORT)}`;

const [stub, web] = main.webServer as Array<Record<string, unknown>>;

export default defineConfig({
  ...main,
  use: {
    ...main.use,
    baseURL: WEB_ORIGIN,
  },
  webServer: [
    {
      ...stub,
      command: 'node stub-provider.mjs',
      env: { ...(stub.env as Record<string, string>), STUB_PORT: String(STUB_PORT) },
      url: `${'http://127.0.0.1:'}${String(STUB_PORT)}/__requests`,
    },
    {
      ...web,
      command: `pnpm --filter @heyta/web exec vite --host 127.0.0.1 --port ${String(WEB_PORT)} --strictPort`,
      url: WEB_ORIGIN,
    },
  ],
});
