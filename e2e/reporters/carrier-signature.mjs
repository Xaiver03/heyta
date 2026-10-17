/**
 * 「载体是否还活着」的签名表 —— 单一所有者。
 *
 * 为什么单独一枚文件：它同时被两边走，而这两边的依赖不同。
 * - `e2e/reporters/carrier-health.mjs`（Playwright 报告器）能引 `@playwright/test`；
 * - 仓库根的门禁 `scripts/check-e2e-carrier.mjs` **不能**（`e2e/` 刻意不在 pnpm 工作区内）。
 * 所以纯函数住这里：零 import、零依赖，谁都能拿。
 *
 * 要抓的形状只有一个：**传输层根本没走到被测应用**。这类失败不回答"产品对不对"，
 * 它回答"载体在不在"，而 Playwright 默认会把它们逐条报成产品失败、一路跑到尾。
 */

/** @typedef {{ kind: 'carrier-down', reason: string }} CarrierVerdict */

/** 只列**已经实测出现过**的签名；不猜没见过的。 */
export const CARRIER_SIGNATURES = [
  {
    needle: 'net::ERR_CONNECTION_REFUSED',
    reason: 'dev server / 假端点已经不在那个端口上（连接被拒）',
  },
  {
    needle: 'net::ERR_EMPTY_RESPONSE',
    reason: '端口有人听着但不回话（进程正在死 / 已经僵住）',
  },
  {
    needle: 'ECONNREFUSED',
    reason: '宿主侧 connect 直接被拒（载体没起来或中途退出）',
  },
  {
    needle: 'ECONNRESET',
    reason: '连接被重置（载体在请求途中退出）',
  },
];

/**
 * 从一段错误文本里认载体签名。
 *
 * 🔴 `mainPorts` 是**主载体的端口**（app + 假端点；调用方注入，见
 * `carrier-health.mjs`）。给了它之后，判定多一道**归因**：
 *
 *   消息里点名了 `host:port`，而那些端口**一个都不在主载体里** ⇒ 回 `null`
 *   （不是载体死了，是**这个用例自己的**某个辅助端口没人应答）。
 *
 * 为什么非要这一道（2026-10-17 实测）：`auth-simple-ux.spec.ts` 自带一套
 * 4341/4342（它有自己的 `playwright.auth-simple.config.ts`），而它被主配置收着；
 * 那条用例的 `connect ECONNREFUSED 127.0.0.1:4342` 命中了下面的 `ECONNREFUSED`
 * ⇒ 报告器判"载体死了"⇒ **整轮 393 条当场作废（退出码 160）**，
 * 跑了几十分钟的读数全丢。加了归因之后，那只剩"这一条用例红"。
 *
 * ⚠️ 不给 `mainPorts` 时保持旧口径（任何签名都算）—— 既有调用方与自检臂
 * 不用改；但**真实运行的那条路必须给**。
 *
 * @param {string} message 测试失败的 error.message（或 stack 的第一段）
 * @param {number[] | null} [mainPorts] 主载体端口；缺省 = 不做归因
 * @returns {CarrierVerdict | null} 命中回判定，没命中回 `null`（**默认不是载体问题**）
 */
export function carrierFailureReason(message, mainPorts = null) {
  if (typeof message !== 'string' || message.length === 0) return null;
  for (const sig of CARRIER_SIGNATURES) {
    if (!message.includes(sig.needle)) continue;
    if (Array.isArray(mainPorts) && mainPorts.length > 0) {
      const mentioned = [...message.matchAll(/(?:127\.0\.0\.1|localhost|\[::1\]):(\d+)/g)].map((m) =>
        Number(m[1]),
      );
      // 点名了别的端口、且主载体端口一个都没出现 ⇒ 归因给那个用例自己的端口，不判载体。
      if (mentioned.length > 0 && !mentioned.some((port) => mainPorts.includes(port))) return null;
    }
    return { kind: 'carrier-down', reason: `${sig.needle} —— ${sig.reason}` };
  }
  return null;
}
