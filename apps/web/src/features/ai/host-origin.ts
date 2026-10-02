/**
 * 宿主自己的来源（Origin）—— 单一读取点
 *
 * 🔴 为什么单独一个文件：`diagnoseNetworkFailure()` 需要"我自己住在哪个来源"，
 * 而**读 `window` 这件事不许散进纯函数模块**（`packages/ai` 要在 node-host 与测试里跑）。
 * 所以浏览器侧的这一次读取集中在这里，其余各层只接一个 `string | undefined`。
 *
 * ⚠️ 原生壳里它同样有值但形状不同（macOS 是 `heyta-local://app`、
 * Windows 是 `https://heyta.local`）—— 那**正是要报给用户的值**，
 * 因为端点白名单要比对的就是请求头里那个串。所以这里不做任何"归一化"。
 *
 * `undefined` 只有一种情况：没有 `window`（node-host、jsdom 之外的 SSR）。
 * 此时诊断会退回 `transient-network` —— 宁可不给提示，也不猜一个来源给用户去加白名单。
 */
export function currentHostOrigin(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const origin = window.location?.origin;
  // jsdom 在某些夹具下给 'null'（file:// 或 about:blank）—— 那不是能加进白名单的值。
  return typeof origin === 'string' && origin !== '' && origin !== 'null' ? origin : undefined;
}
