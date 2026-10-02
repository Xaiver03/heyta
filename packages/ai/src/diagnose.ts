/**
 * 跨源失败诊断
 * =============
 *
 * 🔴 **这里新增的是一个"诊断"，不是一个新的失败原因。** 区别是承重的那一条：
 * `AiFailureReason` 描述的是**传输层知道**的事，而这件事传输层**不知道** ——
 * 所以它只能住在传输层上面一层。往那个封闭词表里加值，就是把"猜出来的结论"
 * 伪装成"观测到的事实"。
 *
 * ## 为什么需要它（实测，2026-10-02，Ollama 0.23.2）
 *
 * heyta 的两个内置端点预设都是**回环地址**（Ollama `localhost:11434`、
 * LM Studio `127.0.0.1:1234`）。而应用本体挂在 HTTPS 域名下（生产 Web 壳）、
 * 或自定义 scheme / `heyta.local` 下（两个原生壳）。浏览器发请求时带的是
 * **宿主自己的 Origin**，于是：
 *
 * | 探针 | 结果 |
 * |---|---|
 * | 无 `Origin`（非浏览器） | 200 |
 * | `Origin: http://127.0.0.1:4321` | 200，且 `Access-Control-Allow-Origin` **回显该来源** + `Vary: Origin` |
 * | `Origin: https://heyta.waytofuture.cn` | **403，`Content-Length: 0`，完全没有 `ACAO`** |
 * | 该来源下的 `OPTIONS` 预检 | **403，无 `ACAO`** |
 *
 * 🔴 **关键推论：JS 永远看不到那个 403。** 403 不带 `ACAO` ⇒ 浏览器把它拦成
 * `TypeError: Failed to fetch` ⇒ `routing.ts` 的 catch 分支只能归成 `'network'`，
 * 而**不是** `'http-error'`。所以"从状态码区分"这条路**技术上不成立**，
 * 能用的只有**配置推导**：端点是不是回环、宿主来源是不是回环。
 *
 * ## 这条推导为什么是保守的
 *
 * 只有在**两个条件同时成立**时才说"多半是来源被拒"：
 * 端点是回环地址，**且**宿主自身来源不是回环。任一未知（`undefined`）都退回
 * `transient-network` —— 因为 `transient-network` 的文案是"检查网络"，
 * 它不会把一个没配好的东西说成配好了；而反过来（把网络抖动说成来源被拒）
 * 会让用户去改一个**根本不需要改**的白名单。
 *
 * ⚠️ **它永远不试图自动修**。改用户机器上 Ollama 的 `OLLAMA_ORIGINS` 不是
 * heyta 该做的事 —— 那是**别人机器上的服务**，而且放宽白名单是一个**由用户做出的
 * 安全决定**。本产品能给的全部，是把**该加的那个值原样打出来** + 指一条手册。
 *
 * ## 为什么至今没人发现这件事
 *
 * 回环来源是被放行的（上表第二行）⇒ **只有开发机上的 localhost 页面能用本机端点**。
 * 所有人都在 localhost 上测，所以它在开发阶段**结构上不可能被看见**。
 * 同理，`e2e/stub-provider.mjs` 无条件回 `ACAO: *` 且不读 `Origin` ——
 * 它的文件头把这类症状的误导性写得极准，却只测了**放行那一侧**。
 *
 * 依据：[ADR-0045](../../../docs/adr/0045-conversational-assistant-split-authorization-from-catalog.md) §4、
 * [`docs/plans/ai-assistant-closure.md`](../../../docs/plans/ai-assistant-closure.md) W1。
 */

import type { AiFailureReason } from './provider.js';
import { isLoopbackEndpoint } from './supply.js';

/** 一次 `network` 失败的两条可能成因。 */
export type NetworkFailureDiagnosis =
  /**
   * 端点在本机、而宿主自己不住在本机 ⇒ 请求多半在跨源那一层就被拦下了。
   * 修复动作在**用户那一侧**（把宿主 Origin 加进端点白名单）。
   */
  | 'origin-likely-rejected'
  /** 真的连不上 / 超时 / 端点没起来。修复动作是"再试一次、检查网络与地址"。 */
  | 'transient-network';

export interface NetworkFailureSignal {
  /** 传输层给出的原因码。**只有 `'network'` 才值得诊断**，其余一律退回暂时性。 */
  readonly reason: AiFailureReason | undefined;
  /**
   * 这次**实际打到的**端点 URL。由 `routing.ts` 在失败分支上带出来 ——
   * 不是"配置里的第一个端点"，那在多端点路由下会说错。
   */
  readonly endpointUrl: string | undefined;
  /**
   * 宿主自身的来源（浏览器是 `location.origin`；原生壳是自定义 scheme 或
   * `https://heyta.local`）。**由调用方注入，不在这里读 `window`** ——
   * 这个模块要能在 node-host 与测试里跑，而"在纯函数里偷偷读全局对象"
   * 正是本仓库判过无数次的那类缺陷。
   */
  readonly hostOrigin: string | undefined;
}

/**
 * 判断一次 `network` 失败**更像**哪一条成因。
 *
 * 纯函数、不猜未知量。见文件头"为什么这条推导是保守的"。
 */
export function diagnoseNetworkFailure(
  signal: NetworkFailureSignal,
): NetworkFailureDiagnosis {
  if (signal.reason !== 'network') return 'transient-network';
  const { endpointUrl, hostOrigin } = signal;
  if (endpointUrl === undefined || hostOrigin === undefined) return 'transient-network';
  if (!isLoopbackEndpoint(endpointUrl)) return 'transient-network';
  // 端点是回环的，而宿主自己也是回环的 ⇒ 同源同段，跨源解释不了这次失败。
  if (isLoopbackEndpoint(hostOrigin)) return 'transient-network';
  return 'origin-likely-rejected';
}

/**
 * 该往端点白名单里加的那个值。
 *
 * 🔴 它就是宿主 Origin 本身，**不做任何加工** —— 端点比对的是请求头里的
 * `Origin`，多一个斜杠、少一个端口都对不上。所以这里既不去尾斜杠也不转小写：
 * 用户复制的必须是他机器上**真的会发出去**的那个串。
 */
export function originToWhitelist(hostOrigin: string | undefined): string | undefined {
  return hostOrigin === undefined || hostOrigin === '' ? undefined : hostOrigin;
}
