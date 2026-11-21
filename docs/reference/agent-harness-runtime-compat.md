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

## 4. 「撤销这次 AI 操作」（本地写入路径）

产品裁决 D1「不做 Action Plan，删除/归档/移动给 AI 靠版本回溯」——本地写入路径的撤销入口已具备：

1. AI 运行**前**：`const seq = await engine.currentLocalSeq()`。
2. 运行（经 `requestAssistantTurn` 等本地工具路径，写入过 op-log）。
3. 用户点"撤销这次 AI 操作"：`await engine.undoSince(seq)` —— 逆序对该段内的**本地 op**应用应用时算好的反向意图；被别的设备改过的条目进 `unsupported`（不硬撤、不假装成功）。返回 `applied | partial | stale | empty`。

判据：`packages/op-log/tests/undo-run.spec.ts`（`undoSince` 两条 + `undoOperations` 五条）。

⚠️ **云端工具路径的写入发生在服务端**（`/api/agent/tools`），其"撤销这次 AI 操作"属于服务端版本历史，不在本地 `undoSince` 范围；需服务端实现（见 `agent-tools-api.md`）。两条路径不要混用。

## 5. 两种工具传输（同一契约，壳按需注入）

| 传输 | 工具在哪执行 | 何时用 |
|---|---|---|
| `createHttpCloudToolTransport({baseUrl,getToken})` | heyta 云端 `/api/agent/tools` | 托管/跨端、需服务端权威与版本历史 |
| `createLocalToolTransport(runnerDeps)` | 设备本地 app 数据（`runSelectedTool`），不碰 OS | 本地优先、离线、只用 app 自己的数据 |

两者都实现 `CloudToolTransport`，可直接喂 `runCloudAgentTurn` / `requestCloudAssistantTurn`，也可作 PI 内核 `toCloudAgentTools` 的传输。**本地传输只让只读工具通过；写操作返回 `write-needs-confirm`，必须走助手既有"提案→确认→自动执行"（唯一落库点）。** 判据：`ai-local-tools.spec.ts`。

## 6. 壳接入（一个函数）

```ts
const { turn, seqBefore } = await runAiTurnWithUndo(userText, {
  routing, consents,
  transport: createLocalToolTransport(runnerDeps), // 或 createHttpCloudToolTransport(...)
  grants,
  undo: { getSeq: () => engine.currentLocalSeq(), undoSince: (s) => engine.undoSince(s) },
});
// 用户点“撤销这次 AI 操作”：
await undoLastAiTurn({ undo }, seqBefore);
```

- `runAiTurnWithUndo` 自动：取 `seqBefore` → 跑 `requestCloudAssistantTurn`（带稳定 `runId`，兼作幂等键前缀）→ 返回 `{turn, seqBefore, runId}`。
- `undoLastAiTurn` = `engine.undoSince(seqBefore)`；仅覆盖**本地写入**；云端工具写入的撤销在服务端。
- 判据：`ai-turn-orchestrator.spec.ts`。

## 7. Web 壳接入点（已就绪）

`apps/web/src/features/ai/cloud-harness.ts`：
- `runWebCloudTurn(userText, { routing, consents, grants })` —— 用 `createAiToolHost()`（Web 真实 dispatch）+ `createLocalToolTransport` + `runAiTurnWithUndo`（撤销绑定来自 `requireEngine().currentLocalSeq/undoSince`）。
- `undoWebCloudTurn(seqBefore)` —— 撤销这次 AI 操作的本地写入。
- 类型检查通过（`apps/web` `tsc -p tsconfig.spec.json` 0 错）。面板 `AssistantPanel` 已有 `routing/consents` props，接入只需改为调 `runWebCloudTurn`（UI 切换待排，避免与并发改动冲突）。

## 8. 移动端接入点（已就绪）

`apps/mobile/src/ai/cloud-harness.ts`：
- `runMobileCloudTurn(host, userText, { routing, consents, grants })` —— 用本机 `AppHost`（`host.engine/dispatch/getState`）建 `createLocalApiHost` + `createLocalToolTransport`，跑 `runAiTurnWithUndo`（撤销绑定 `host.engine.currentLocalSeq/undoSince`）。
- `undoMobileCloudTurn(host, seqBefore)` —— 撤销这次 AI 操作的本地写入。
- **`apps/mobile` `tsc` 全量 0 错**（新增文件不影响既有）。独立新文件，未触碰 `AssistantScreen.tsx`/`WelcomeScreen.tsx`（后者正被另一会话改）。

## 9. 文本流式（已支持）

`createRoutedModelCall({ onTextDelta })` → 传入 `invokeRouted` 的 `deps.onDelta`，只转发 `type:'text'` 片段（思考片段不算答案）。`requestCloudAssistantTurn`/`runAiTurnWithUndo` 透传 `onTextDelta`。**宿主无 `TextDecoder`（Hermes）时 `invokeRouted` 自动退回非流式**——移动端整段返回，Web/node 逐字。这是"切面板默认不牺牲流式"的前置能力（切换本身仍待产品决策+验收）。
