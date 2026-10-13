/**
 * e2e 的**端口槽**是这里唯一的所有者。
 *
 * 为什么要有这个文件（不是"整洁"，是一条实测过的事故）：
 * 本机同时有 `…/01_PROJECTS/heyta` 与 `…/heyta-wt-merge` 这样的兄弟检出，而两棵树按设计
 * 用**同一对固定端口**（4318 / 4319）。2026-10-06 实测的后果不是"起跑失败"这么简单 ——
 * 主检出那轮跑到一半，本树的 vite 被它的跑前清场 SIGKILL，后半程本树的用例连的是
 * **别人那棵树**的 dev server：`strictPort` 与 `reuseExistingServer:false` 只判起跑那一刻，
 * 对"端口换人"零覆盖。最坏的一格是 6 张证据图采集成功、内容全是真界面，
 * 而它们**不是这棵树**的（traps #358）。
 *
 * ⇒ 端口必须是**一个可以挪开的槽**，而不是散在 8 个文件里的字面量。
 * 默认值逐字不变（不设环境变量时行为与今天完全一致），需要窗口时设这两个：
 *
 * ```sh
 * HEYTA_E2E_APP_PORT=4418 HEYTA_E2E_STUB_PORT=4419 pnpm check:ai-e2e
 * ```
 *
 * ⚠️ 只覆盖主套件那一族（app + 假端点）。`landing` / `privacy-consent` 等段各有自己的端口，
 * 它们与别的树**不同号**、本轮没发生撞车，所以没在这里一起改（改动面要对着证据来，不是对着"顺手"）。
 */

/** 解析并校验一个端口旋钮：未设 ⇒ 默认值；设了必须是合法的用户端口。 */
function portFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1024 || value > 65_535) {
    throw new Error(`${name}=${String(raw)} 不是一个合法端口（要 1024–65535 的整数）`);
  }
  return value;
}

/** 被测应用的 dev server（`vite --port`）。 */
export const APP_PORT: number = portFromEnv('HEYTA_E2E_APP_PORT', 4318);

/** 假端点 `stub-provider.mjs`（模型出口 + `/__requests` 计数 + `/api/admin` 对端）。 */
export const STUB_PORT: number = portFromEnv('HEYTA_E2E_STUB_PORT', 4319);

export const APP_ORIGIN: string = `http://127.0.0.1:${String(APP_PORT)}`;

export const STUB_ORIGIN: string = `http://127.0.0.1:${String(STUB_PORT)}`;
