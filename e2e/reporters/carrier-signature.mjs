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
 * @param {string} message 测试失败的 error.message（或 stack 的第一段）
 * @returns {CarrierVerdict | null} 命中回判定，没命中回 `null`（**默认不是载体问题**）
 */
export function carrierFailureReason(message) {
  if (typeof message !== 'string' || message.length === 0) return null;
  for (const sig of CARRIER_SIGNATURES) {
    if (message.includes(sig.needle)) {
      return { kind: 'carrier-down', reason: `${sig.needle} —— ${sig.reason}` };
    }
  }
  return null;
}
