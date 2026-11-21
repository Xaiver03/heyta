# Agent Harness 运行时兼容（四端可移植性）

> 状态：**已定（基于源码判据 + 运行环境事实）**。日期：2026-11-22。
> 关联：设计 [v3](../plans/2026-11-21-agent-tool-calling-audit-and-pi-harness-design.md)、审计 [agent-harness-audit](../plans/2026-11-21-agent-harness-audit.md)、调研 [mobile-agent-tool-calling-landscape](../research/mobile-agent-tool-calling-landscape.md)。

## 0. 结论

**"四端可用"由 heyta 原生引擎保证，不依赖 PI 内核**：
- 原生引擎（`requestCloudAssistantTurn` = `runCloudAgentTurn` + `createRoutedModelCall` + `CloudToolTransport`）是**纯 TypeScript**，只用 `fetch().json()`，**零 Node 内置依赖** ⇒ 桌面 / 手机(iOS/Android, Hermes) / 平板 / Web **都能跑**。
- **PI 内核（`@earendil-works/pi-agent-core`）是桌面增强**：同一 `CloudAgentTool` 契约下，桌面走 PI SDK 拿更强的循环/会话能力；移动端不内嵌 PI（Hermes 无 WASM、`pi-agent-core` 的 RN 可移植性未经真机验证 = 审计 U5）。这就是"两引擎、一契约"。

## 1. 四个运行时 vs 原生引擎

| 运行时 | 能跑原生引擎？ | 依据 |
|---|---|---|
| Node（`apps/node-host` / Electron） | ✅ | 纯 JS + 全局 `fetch`（Node 18+ 自带） |
| 浏览器（`apps/web`） | ✅ | 纯 JS + `fetch` |
| React Native / Hermes（`apps/mobile`） | ✅（形状层面） | 无 Node 依赖；`fetch().json()` RN 支持；**不用** `response.body` 流 / `ReadableStream` / WASM |
| 原生桌面壳 | ✅（经 WebView 共享 UI / node-host） | 同 Web / Node |

判据：`packages/app-host/tests/agent-portability.spec.ts`（扫描源码禁止项，违反即红）。

## 2. 已知边界（诚实标注）

- **不流式**：`createHttpCloudToolTransport` 用 `response.json()`（整份），所以工具结果是整份到的。模型是否流式取决于 `invokeRouted` 的 `onDelta`（宿主需 `TextDecoder`；移动端当前流式通道**未接线/停用**，见 P0-1）。⇒ 移动端 AI 助手当前**非逐字**；这是既有约束，不是本引擎新增。
- **PI 内核移动端未验证**：`pi-agent-core` 的 RN/Hermes 真机可移植性仍是未知（审计 U5）。若将来真机验证通过，可把引擎切到 PI 内核而**不改契约**。
- 性能：多步循环在 Hermes 的实时性/内存需真机量化（调研 U1），本轮为形状证明，不是性能结论。

## 3. 为什么这样分

- 移动端的瓶颈是运行时能力（无 Node/WASM、fetch 无 body 流），不是"要不要 PI"。
- 原生引擎把这些都绕开了：工具 = `fetch().json()`，模型 = `invokeRouted`（fetch），循环 = 纯函数。
- 于是**同一份 `requestCloudAssistantTurn` 在四端都能调**；桌面若想用 PI 内核，只是换 `callModel`/循环的引擎实现，`CloudAgentTool` 与 `CloudToolTransport` 不变。
