import type {Page} from '@playwright/test';
// 🔴 判据本体不在这里 —— 单一所有者是 `scripts/screenshots/head-reveal.mjs`。
import {waitHeadRevealed as revealed} from '../../scripts/screenshots/head-reveal.mjs';

/**
 * 🔴 等页头那一次"遮罩揭示"**真的落位**，再截图。
 *
 * 为什么这里只剩一层壳：这条判据有**两个消费者**，而它们不在同一个语言里 ——
 * `e2e/landing/*.spec.ts`（TS，Playwright 跑）与 `scripts/screenshots/capture.mjs`
 * （纯 Node，`pnpm screenshot:capture` 跑）。判据写两遍就是下一次漂移的来源
 * （审计文档 §8.110 那批"四张空白页头"的证据图，两个消费者当时各等各的）。
 * 所以本体搬到 `.mjs`（Node 与 Playwright 都能原生加载），这里只保留**类型壳**
 * 与调用点需要的报错语境。
 *
 * ⚠️ 两个失效形态（详见 `.mjs` 头部）：不等待 ⇒ 图顶整块空白；
 * 以为 `screenshot({animations: 'disabled'})` 就够了 ⇒ **不够**，那个参数管不到
 * framer-motion 走 WAAPI 的 transform。
 */
export async function waitHeadRevealed(page: Page): Promise<void> {
  await revealed(page);
}
