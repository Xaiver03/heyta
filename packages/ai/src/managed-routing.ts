/**
 * 托管档的**端点从哪来**：运行时把"当前同步服务器"合成成一个候选端点。
 *
 * ## 🔴 为什么端点不能写死在设置里
 *
 * 托管档打到的是**我们自己的服务端**（`/api/ai/managed/chat`），而"我们自己的服务端"
 * 对用户来说是**可变的**：自托管的人会填自己的地址，官方托管的人会用官方域名，
 * 换实例、换域名、本地调试都是真实存在的路径。
 *
 * 如果把这个地址作为一条普通端点**存进设置**，就会出现两类错：
 * 1. 用户换了服务器，而 AI 还打向旧地址 —— 表现是"AI 忽然全失败"，没人能定位；
 * 2. 设置里同时存在一条"托管端点"和一条"用户自己的端点"，谁生效取决于路由表 ——
 *    而用户以为自己只是在用托管。
 *
 * 所以端点在**构造路由配置的那一刻**从同步会话派生（`serverUrl` 由宿主给），
 * 不落盘。
 *
 * ## 🔴 它不判断"合不合法"
 *
 * 白名单（境内 + `https`）由 `validateEndpointUrl` / `classifyDestination` 判 ——
 * 这里再判一遍就是第二套判据，而两套判据迟早分叉。本函数只负责**合成形状**：
 * 拿不到地址就**不合成**（于是路由层给 `no-route`），拿得到就合成一条候选，
 * 合法性照样由既有那两层把守。
 *
 * ⚠️ 拿不到 `serverUrl` 时**不合成任何端点**：用户会看到 `no-route` 而不是
 * "托管 AI 不可用"。这是刻意的 —— 那时的事实是"这台设备还没配同步服务器"，
 * 而**"没配服务器"和"服务器没开托管 AI"是两张不同的待办**
 * （后者的精确文案由 `RoutedDeps.managedTransport` 那条路给）。
 */

import type { AiFeature } from './egress.js';
import {
  DEFAULT_FEATURE_CAPABILITIES,
  type AiCapability,
  type AiEndpointConfig,
  type AiRoutingConfig,
} from './routing.js';

/** 合成端点在路由表里的 id。**固定值** —— 换它等于换一份配置形状，会让已落盘的 routes 指空。 */
export const MANAGED_ENDPOINT_ID = 'heyta-managed';

/**
 * 托管端点**能诚实声明**的能力。
 *
 * 🔴 **不含 `tool_calling`**，而且这是**有意的**。注意这条注释在 2026-10-24 更正过
 * 一次：原文写的理由是"服务端不转发 `tools`"，那句**已经不成立了** ——
 * `managed-proxy.routes.ts` 现在把 `tools` / `tool_choice` 照原样转发
 * （`grep -n "tools" server/src/ai/managed-proxy.routes.ts` 有 5 处，含 schema 与透传点）。
 *
 * 所以现在的理由是**另一条**：这一格**还没有做过端到端的验证**（托管上游真的接受
 * 我们转发的这套工具目录、并把 `tool_calls` 回给我们、客户端能把它接回助手循环）。
 * 没验过就声明，等于把一个没跑过的链路写成能力 —— 与"服务端不转发"那种**事实错误**
 * 不同，这次是**不敢声明**。
 *
 * 后果仍然是 `'tool-calling'` 这个功能在托管档上于**解析候选**时以
 * `capability-missing` 被排除（⇒ 用户看到 `no-route`），而**不是**发出去之后
 * 静默降级成一段纯文本回答。要真的支持助手，得先补一条端到端判据，
 * 再把 `'tool_calling'` 加回本表 —— 登记在 `docs/plans/launch-blockers.md` §3.2。
 */
const MANAGED_CAPABILITIES: readonly AiCapability[] = ['structured_output', 'long_context'];

/** 全部功能 —— 从能力表派生，**不手抄一份**（手抄的那份一定会漂）。 */
const ALL_FEATURES = Object.keys(DEFAULT_FEATURE_CAPABILITIES) as readonly AiFeature[];

/**
 * 把同步服务器合成成托管端点，并把**所有功能**都指到它。
 *
 * - `mode !== 'managed'` ⇒ **原样返回**（同一个引用），自备档逐字不受影响；
 * - `serverUrl` 空 / 解析不出 ⇒ 原样返回（⇒ `no-route`，见文件头最后一段）；
 * - 否则：端点表**去掉旧的托管端点再追加一条**（幂等，重复调用不会堆积），
 *   路由表**整份替换**成"每个功能 → 托管端点"。
 *
 * ⚠️ 路由表是**整份替换**而不是合并：用户选的是托管档，
 * 这时他自己的那几条端点不该再有功能指向它们 —— 否则"我以为在用托管、
 * 实际发给了自己配的那台"就是这样来的。
 */
export function withManagedEndpoint(
  routing: AiRoutingConfig,
  serverUrl: string | undefined,
): AiRoutingConfig {
  if (routing.mode !== 'managed') return routing;

  const raw = serverUrl?.trim() ?? '';
  if (raw === '') return routing;

  let origin: string;
  try {
    // 🔴 取 `origin` 而**不是**整串：`serverUrl` 可能带路径（`https://h.cn/api`），
    // 而端点要的是主机那一层 —— 带上路径会让 `managedChatUrl` 拼出
    // `https://h.cn/api/api/ai/managed/chat`。
    origin = new URL(raw).origin;
  } catch {
    return routing;
  }
  if (origin === 'null' || !origin.startsWith('http')) return routing;

  const managed: AiEndpointConfig = {
    id: MANAGED_ENDPOINT_ID,
    label: 'heyta 托管',
    endpoint: origin,
    // 托管档的模型由**服务端**决定（ADR-0021「换模型就是改价」），
    // 这个值对托管路径不参与请求体（见 `buildManagedChatRequestBody`），
    // 只用于界面与预算展示，所以它是一个名字而不是一个模型版本。
    model: 'managed',
    capabilities: MANAGED_CAPABILITIES,
  };

  return {
    ...routing,
    endpoints: [...routing.endpoints.filter((entry) => entry.id !== MANAGED_ENDPOINT_ID), managed],
    routes: Object.fromEntries(
      ALL_FEATURES.map((feature) => [feature, [{ endpointId: MANAGED_ENDPOINT_ID }]]),
    ),
  };
}
