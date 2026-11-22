# Agent 与 OpenAI / Anthropic 工具调用最佳实践的对照（因地制宜）

> 2026-11-22。判据以本仓代码为准（file 行号）。"对齐"= 我们有等价实现；"部分/缺口"= 未做或只在别处做。

## 结论（先）
**核心循环已对齐**（工具schema、tool_choice=auto、多工具调用、有界步数、错误回灌、幂等、副作用确认/可撤销、系统提示）。**尚未全对齐**的有 5 处，多为"上层可加"的增强：
工具选择控制、并行执行、工具调用增量流式、重试/超时、结构化输出。

| 最佳实践 | 状态 | 证据 / 缺口 |
|---|---|---|
| 工具名/描述清晰 + JSON Schema（`additionalProperties:false`） | ✅ | `local-api` 工具目录；`toCloudToolDescriptors` 原样带 `parameters`；`wire.ts` 发 `tools` |
| `tool_choice` 控制（auto/required/none/指定） | ✅ | `wire.ts` `WireToolChoice`（默认 auto 字节兼容）；经 `AiInvocation.toolChoice`→routed model→`CloudAssistantTurnDeps.toolChoice` 透传 |
| 多工具调用（parallel tool calls） | ✅ | `agent-harness.ts` 新增 `parallelSafe`：只读工具（list_/get_/search_/find_/read_）同一步**并发**，写仍串行；双端适配器已按前缀开启 |
| 工具结果体量限制（上下文管理） | ✅（本轮补） | `agent-harness.ts` `maxToolResultChars` 默认 8000，超长截断标注 |
| 错误结果回灌模型 | ✅ | 工具失败写 `tool` 消息"工具执行失败：…"，循环继续 |
| 有界步数 / 防死循环 | ✅ | `maxSteps` 默认 6 |
| 副作用幂等（重试不重复落库） | ✅ | `Idempotency-Key = runId:s<step>:<callId>`；服务端去重 |
| 写操作确认 / 可撤销（安全） | ✅ | 默认提案确认；Harness 模式 auto-write + `undoSince`（D1）；purge 排除 |
| 系统提示（直接执行、少反问、说明拒绝） | ✅ | `CLOUD_ASSISTANT_SYSTEM_PROMPT` |
| 工具调用增量流式（streaming tool_calls） | ⚠️ 缺口 | 仅流式文本（`onTextDelta`）；`tool-call` delta 未回 UI |
| 重试/退避（瞬时错误） | ✅ | `agent-harness.ts` `retryAttempts/retryBackoffMs`：仅对 `isRetryable`（默认=只读）工具**有界重试+线性退避**；写工具不重试。`invokeRouted` 端点回退仍在 |
| 单工具超时 | ✅ | `agent-harness.ts` `toolTimeoutMs`（默认 60s），超时算失败回灌 |
| 结构化输出（JSON mode / strict） | ✅ | `wire.ts` `WireResponseFormat`（`json_schema strict`/`json_object`，仅显式设置时出现）；`app-host` `structuredJson()` 造约束、`parseStructuredOutput()` 解析失败**回退原文**；测试覆盖 |
| 提供商差异化（Anthropic tool_result is_error / OpenAI role:tool） | ✅ 因地制宜 | 我们统一走 OpenAI 兼容线格式（`wire.ts`）；PP 网关即 OpenAI 兼容 |

## 因地制宜原则（不盲目照抄厂商文档）
- **出境闸门 + 境内白名单 + 风险档 + 版本回溯**是本仓的硬约束，优先于"厂商建议的便利"（例如：不因并行提速就放开写并行；不因 strict 模式就跳过确认）。
- **PP 网关是 http 自建上游**：走"网关配置显式放行明文"的受控路径（`gatewayEgressAllowance`），而不是全局放宽 https。
- **移动端用原生引擎**（Hermes 无 WASM），桌面可选 PI 内核——同一 `CloudAgentTool` 契约。

## 建议的下一步（按性价比）
1. 工具调用增量流式：把 `StreamDelta{tool-call}` 接到 harness 事件（UI 可显示"正在准备调用 X"）。
2. 读工具并行执行（写保持串行 + 确认）。
3. harness 层单工具超时 + 一次性重试（瞬时网络）。
4. `toolChoice` 透传（auto/required/none）。
5. 非工具结构化输出用 strict/json 约束。
