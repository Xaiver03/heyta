# WeKnora Agent 输出协议：事件流 · 消息模型 · 渲染管线

> 状态：**调研记录**（归档层；结论有变时新增勘误、不改原文）
> 调研日期：**2026-11-26**（CST）。基线：`weknora` 仓库分支 `integrate/aidenwlf-20261124-001102`，HEAD `b6ee40476`（fork 自腾讯 WeKnora，合到上游 v0.9.0）。
> 方法：**只读静态阅读** + 逐点 `grep -n`，未运行应用、未截图；凡推测标「推测」，凡未读到实现标「未验证」。
> ⚠️ 文中 `file:line` 以**被调研仓库** `~/Desktop/All in one Data/01_PROJECTS/weknora` 为准，不是本仓库；一次改动即偏移。
> 范围：**一条 Agent 回答从服务端到像素**的协议与管线。页面结构见 [会话页 IA](weknora-agent-chat-ia.md)，逐值样式见 [视觉规范](weknora-agent-visual-spec.md)，记忆见 [短期](weknora-memory-shortterm.md) / [长期](weknora-memory-longterm.md)。

---

## 0. 一句话结论

**WeKnora 的「输出方式」不是一段 markdown，而是一条带类型的 SSE 事件流：每个事件同时是「渲染指令」和「持久化步骤」，前端按 `response_type` 分派、按 `tool_call_id` 配对、按 `event_id` 做段级替换；一轮回答的最终形态由「assistant 消息行 + agent_steps」重放出来，流只是它的增量投影。**

四件事决定了它能做出 WeKnora 那种「过程可见、可审批、可回滚」的界面，缺一不可：

1. **单一通道**：所有东西（答案、思考、工具、进度、审批、挂起、压缩、steer、子 Agent）都在同一条 SSE 上，靠 `response_type` 分派，不存在第二套 WebSocket / 轮询通道。
2. **事件带身份**：`assistant_message_id` 标识这一轮，`tool_call_id` 标识一次调用，`event_id` 标识一段可替换文本。前端不需要靠顺序猜。
3. **终态明确**：`complete` / `stop` / `error` 是终止事件；`run_suspended` 先于 `complete` 表示「这一轮没结束，在等人」；断线后用 `GET continue-stream` 按已持久化的 `assistant_message_id` 续接。
4. **步骤即事实**：`agent_steps` 随消息落库，审批、思考、工具结果都能在刷新后原样重放（`AgentStepRecord`，`frontend/src/api/chat/streamTypes.ts:44-51`）。

---

## 1. 通道、帧与生命周期

### 1.1 两条入口

| 入口 | 方法/路径 | 用途 | 证据 |
|---|---|---|---|
| 新的一轮 | `POST /api/v1/agent-chat/:session_id` | 发送 query，建立 SSE | `frontend/src/api/chat/streame.ts:122-141` |
| 续接 | `GET /api/v1/sessions/continue-stream/:session_id?message_id=<assistant_id>` | 断线/重启后接回**已持久化**的那条回答 | 同上 `:122-126`、`:380-386` |

- 续接**绝不重发 POST**：`canReconnect()` 要求 `receivedAssistantId && !receivedTerminal`，且只在 agent-chat / continue-stream 两条路径上成立（`streame.ts:118-121`）。重发 POST 会造出第二条用户消息。
- `Accept: text/event-stream` 由 `@microsoft/fetch-event-source` 发；`response_type` 是唯一分派键，**没有 event name**（所有帧都是 `message`）。

### 1.2 请求头（复刻时必须带上）

| 头 | 作用 | 证据 |
|---|---|---|
| `Authorization: Bearer <token>` / `Embed <embedToken>` | 用户或嵌入访客 | `streame.ts:307-311` |
| `Accept-Language` | 后端按语言生成标题/建议 | `:312` |
| `X-Request-ID` | 端到端 TTFB 日志关联 | `:313`、`:104-110` |
| `X-Tenant-ID` | 跨空间；缺了会落到 home 空间返回 404 | `:96-110` |
| `X-Embed-Session` / `X-Embed-Visitor` | 嵌入态身份 | `:315-316` |

### 1.3 心跳、超时与重连

| 机制 | 值 | 证据 |
|---|---|---|
| 心跳帧 | `{"response_type":"heartbeat"}`，前端**直接丢弃** | `internal/handler/session/stream.go:199,404`；`streame.ts:333` |
| 空闲超时 | **30s** 无任何帧 → abort + 重连 | `streame.ts:296-305` |
| 重连退避 | 1s、2s、4s、5s…，**最多 8 次** | `:368-380` |
| 可重连条件 | 已拿到 `assistant_message_id`、未到终态、非 embed | `:118-121` |
| 401 | 刷新 token 后**重放一次**；其它非 2xx 直接失败 | `:269-272`、`:348-357` |
| 首帧前失败 | UI 还是 loading，重放对用户不可见 | `:263-266` |

### 1.4 终态与错误

| 情况 | 表现 | 证据 |
|---|---|---|
| 正常结束 | `complete`（`data` 可带 `files`、`total_duration_ms`） | `internal/types/chat.go:270`；`AgentStreamDisplay.vue:1906` |
| 用户停止 | `stop`（handler 直接发的裸类型，**不在 `ResponseType` 枚举里**） | `internal/handler/session/stream.go:444`；前端 `wasUserStopped` 判 `type==='stop'` |
| 失败 | `error`，`data.error` / `data.stage`；`stage==='message_persistence'` 时不覆盖答案正文，只挂 `persistence_error` | `useChatStreamHandler.ts:1347-1416`、`:1642-1647` |
| 模型中途断流 | `finish_reason=incomplete`，**不得当作完成轮** | `chat.go:335-343` |
| 单次输出截断 | 消息带 `truncated`，答案工具条出提示图标 | `botmsg.vue:110-120` |
| 降级回答 | 消息带 `is_fallback`，工具条出提示图标 | 同上 |

> ⚠️ **别把 `stop` 当异常**：它是用户在界面点「停止」的正常终态，前端据此保留已产出内容并禁用分叉/回滚的某些组合（`rewindView.ts`）。

---

## 2. 事件全表

`ResponseType` 枚举共 **31** 个（`internal/types/chat.go:235-332`），加上不在枚举里的 `stop`、`heartbeat`、`collaboration_status`（前端流类型 `streamTypes.ts:24-33`），前端实际会分派 **34** 种。

### 2.1 生命周期

| response_type | 时机 | 关键字段 | 语义 |
|---|---|---|---|
| `agent_query` | 一轮开始 | `assistant_message_id`、`session_id` | 后端已接收；前端据此建 assistant 占位行，并记住「这一轮的 id」 |
| `complete` | 正常结束 | `data.files`、`data.total_duration_ms`、`usage` | 终态；此后不再有内容事件 |
| `stop` | 用户停止 | — | 终态；非枚举类型 |
| `error` | 失败 | `data.error`、`data.stage`、`content` | 终态；`stage` 区分持久化失败 |
| `heartbeat` | 每 N 秒 | — | 只用于保活，前端丢弃 |
| `session_title` | 首轮之后 | `content` | 会话标题生成，侧栏更新 |

### 2.2 答案与过程

| response_type | 关键字段 | 语义 / 渲染 |
|---|---|---|
| `answer` | `content`、`done`、`event_id`、`replace`、`truncated`、`is_fallback`、`superseded` | 正文增量。`event_id` 相同即同一段；`replace=true` 表示**整段替换**该 event；`superseded` 的段在时间线里不显示（`AgentStreamDisplay.vue:1897,1932`） |
| `thinking` | `content`、`done`、`event_id` | 思考过程，单独一段；`done` 后自动折叠（`deepThink.vue` 的规则） |
| `reflection` | `content` | 反思（Agent 自评），时间线里一行 |
| `progress` | `content`、`done`、`data.event_id`、`data.iteration` | **累积型**可见进度文本，可直接重放；`<details>` 折叠，只显示最新一条（`ProgressUpdates.vue`） |
| `references` | `knowledge_references[]` | 检索来源；驱动 `docInfo` 与右栏 420px 抽屉 |
| `memory_recalled` | `data.memories[]` | 本轮注入的记忆；时间线首行 `ChatMemoryStep`，可逐条「遗忘」 |
| `context_compacted` | `data`（前后 token/消息数、reason、split_turn、degraded） | 「上下文被压缩」的可解释行（`AgentStreamDisplay.vue:50,385`） |

### 2.3 工具调用

| response_type | 关键字段 | 语义 |
|---|---|---|
| `tool_call` | `tool_name`、`tool_call_id`、`arguments`（流式时**增量合并**）、`pending`、`data` | 调用开始/参数更新。`pending=true` 时卡片带微光 |
| `tool_result` | `success`、`output`、`display_type`、`tool_call_id`、`data` | 调用结束。`display_type` 决定用 27 个叶子渲染器中的哪一个 |
| `command_output` | `data.inner.response_type`、`data.inner.data.tool_call_id` | 更新**未完成**的工具卡（如 shell 输出），不结束调用 |
| `javascript_progress` | 嵌套调用信息 | `run_javascript` 内部的单次调用进度 |
| `install_output` | 安装器输出 | 技能安装进度，不结束工具 |
| `install_prompt` | 安装指令 | 只出现在技能安装 transcript，且**第一条** |

**配对规则**：`tool_call` 与 `tool_result` 靠 `tool_call_id` 配对；`tool_call` 的 `arguments` 可能是多次增量，前端用 `mergeToolCallArguments()` 合并（`useChatStreamHandler.ts:66-78`）。**参数是对象合并，不是字符串拼接** —— 复刻时不要按文本 append。

### 2.4 人工介入（HITL）

| response_type | 关键字段 | 语义 |
|---|---|---|
| `tool_approval_required` | `pending_id`、`tool_name`、`service_name`、`description`、`args_json`、`grant_scope`、`timeout_seconds`、`requested_at` | MCP/危险工具需批准；时间线内联卡 + composer 上方 dock 双呈现 |
| `tool_approval_resolved` | `pending_id`、`approved`、`resolve_reason` | 批准/拒绝/超时；界面回放为只读结论 |
| `agent_prompt_required` | `pending_id`、`kind`（`ask_user` / `secure_form`）、`request`、`expires_at`、`suspendable` | 反问或安全表单；`defer_tool_approvals` 时先出卡 |
| `agent_prompt_resolved` | `pending_id`、`response`、`resolve_reason` | 已回答/拒绝/超时/取消 |
| `mcp_oauth_required` | `service_id`、`service_name`、`mcp_tool_name`、`timeout_seconds` | 需要 OAuth 授权，Agent 暂停 |
| `mcp_oauth_resolved` | 同上 + 结果 | 授权完成/超时/取消 |
| `run_suspended` | `pending_id` | **先于 `complete`**：这一轮挂起等人，消息保持未完成 |
| `run_resumed` | — | 挂起恢复的新流开始；**不重放挂起前的步骤**，客户端保留已显示的 |

> 关键设计：审批的「真值」是事件流里的 `pending_id`，dock 与 inline 都从消息派生，**没有第二份审批 store**（`usePromptDock.ts:25-64`）。这是它不会两处状态漂移的原因。

### 2.5 运行时控制

| response_type | 方向 | 语义 |
|---|---|---|
| `steer` | 客户端 POST，**不上用户可见流** | 运行中插入一条新要求；引擎在下一轮边界取出（`chat.go:311-317`） |
| `user_message_injected` | 服务端 → 用户可见流 | steer 被接受：已落库 user 行、已拼进消息列表；前端把排队消息从 composer 移进 transcript |
| `artifacts_pending` | 服务端 | 答案已流完、产物还在拷贝；工具条先占位，`complete` 再给文件清单 |
| `work_started` / `work_event` / `work_finished` | 服务端 | 后台任务（非本轮阻塞）的共享事件，前端 composer 的 `BackgroundWorkChip` 消费 |
| `collaboration_status` | 服务端 | 多智能体任务组状态（`group_id`、`revision`、`tasks[]`），驱动子 Agent tab 条与行内任务卡 |

### 2.6 事件顺序（实测推断，非文档承诺）

```
agent_query
  ├─ (thinking | answer | progress | memory_recalled | references)*
  ├─ tool_call → (command_output | javascript_progress | install_output)* → tool_result   (可重复)
  ├─ tool_approval_required → tool_approval_resolved        (可重复)
  ├─ agent_prompt_required → agent_prompt_resolved          (可重复)
  ├─ run_suspended                                          (若在等人)
  └─ artifacts_pending? → complete | stop | error
```

⚠️ 顺序**没有协议级保证**（代码里是并发事件总线），前端因此不假设「answer 一定在 references 之后」；它按 `event_id` / `tool_call_id` 归并。复刻时若做「严格顺序」的渲染器，会在这类并发事件上错位。

---

## 3. 消息模型与持久化

### 3.1 一条 assistant 消息是什么

| 层 | 形状 | 证据 |
|---|---|---|
| 消息行 | `id / session_id / role / content / created_at / is_completed / run_state / knowledge_references / agent_steps / used_memories / status / truncated / is_fallback` | `internal/types/message.go`（字段名以 API 返回为准）；前端 `ChatMessage` 是 `Record<string, unknown> & {...}`（`streamTypes.ts:52-55`） |
| 步骤 | `agent_steps[]`，每条含 `iteration / thought / reasoning_content / progress / progress_event_id / tool_call_id / tool_name / arguments / result / display_type / success` | `AgentStepRecord`（`streamTypes.ts:44-51`）；`SanitizeAgentStepsForStorage` 剥离 LLM-only 大载荷 |
| 审批 | `prompts[]`（持久化后由 `pendingPromptEvents()` 还原成事件） | `useChatStreamHandler.ts:87-140` |
| 记忆 | `used_memories[]` | `botmsg.vue:30-33` |

**粒度**：一条 assistant 消息 = 一轮（一个 request_id）。工具调用不是独立消息，而是这轮的 steps；这决定了「分叉/回滚」以轮为单位，不是以工具为单位。

### 3.2 重放与增量是同构的

- 刷新会话时，历史接口返回消息 + `agent_steps`；`AgentStreamDisplay` 用与实时流**同一套**事件分支渲染（只是数据源不同）。
- 因此 `agent_steps` 里必须存够「渲染所需的最小事实」：工具名、参数、结果摘要、`display_type`、成功与否。大载荷（KB 全文）在入库前就被压缩（`CompactToolOutputForHistory`），并在重放时以占位行出现。

### 3.3 挂起/恢复的持久化

- `run_state = awaiting_input` 时消息**未完成**；恢复后 `run_resumed` 开新流，历史里挂起前的步骤不会重发（`run_resumed` 注释）。
- 审批的 `expires_at`、`status`（`pending/suspended/answered/declined/expired/canceled`）、`close_reason` 都落库，所以刷新后卡片状态一致。

---

## 4. 前端消费链路

```
streame.ts (fetch-event-source)
  └─ JSON.parse → response_type 分派
      └─ useChatStreamHandler.ts  (~1.8k 行)
          ├─ 建/找 assistant 消息（agent_query）
          ├─ answer/thinking：按 event_id 找段、append 或 replace
          ├─ tool_call/result：按 tool_call_id 建/更新 step
          ├─ 审批：建 pending 事件，写入消息事件流
          ├─ progress：累加 history
          └─ 终态：is_completed=true、落盘、滚动跟随
```

| 规则 | 实现 | 证据 |
|---|---|---|
| 段替换 | `answer.replace=true` 时用新内容**替换**该 `event_id` 段，不追加 | `AgentStreamDisplay.vue:1890-1900` |
| 段隐藏 | `answer.superseded=true` 不参与渲染 | 同上 `:1897` |
| 参数合并 | 对象浅合并 | `useChatStreamHandler.ts:66-78` |
| 错误不覆盖正文 | `stage==='message_persistence'` 时只挂 `persistence_error` | `:1643-1647` |
| 流式渲染节流 | 缓冲 + 定时刷（`chunkInterval`） | `streame.ts:74-78` |
| 滚动跟随 | 用户在底部才贴底；上滚超过 80px 进入阅读态 | `useChatScrollFollow.ts:18-46`；`index.vue:801-813` |

---

## 5. 渲染分派：一条消息的两条路径

`botmsg.vue` 只做一件事：**按 `session.isAgentMode` 分派**。

| 模式 | 组成 | 证据 |
|---|---|---|
| Agent（智能推理） | `AgentStreamDisplay`（时间线 + 最终答案 + 工具条） | `botmsg.vue:19-25` |
| 快答 / RAG | `RagPipelineProgress` + `docInfo`（来源）+ markdown 正文 + `deepThink` | `botmsg.vue:17-45` |

`AgentStreamDisplay` 自身还有**两套几乎重复的事件渲染分支**（`:33-330` 与 `:363-720`），分别服务「收起的步骤树」与「展开的流式事件流」。复刻时应收敛成一套 —— 这是原文里最明显的技术债（见 [会话页 IA](weknora-agent-chat-ia.md) §3.2）。

---

## 6. 与 heyta 的协议级差距

| 能力 | WeKnora | heyta 现状（`packages/ai/src/stream.ts`、`packages/app-host/src/ai-assistant.ts`） | 结论 |
|---|---|---|---|
| 事件类型 | 34 种，覆盖审批/挂起/压缩/子 Agent | 文本 / 推理 / 工具调用 三类分片 + 四类轮事件 | 差距最大的是 **HITL 与生命周期** |
| 段级替换 | `event_id` + `replace` + `superseded` | 无 | 需要 |
| 工具配对 | `tool_call_id` + 增量参数合并 | 有工具调用，但无 `display_type` 体系 | 部分 |
| 持久化步骤 | `agent_steps` 完整重放 | 思考不落盘、附件不入 `ChatItem` | 需要 |
| 续传 | `continue-stream` + 心跳 + 退避 | 无 | 需要 |
| 审批 | `pending_id` 单一真值，dock + inline | 提案卡（确认执行）但没有运行中暂停/恢复 | 需要（大） |
| 引用 | `references` + citation 浮层 + 右栏 | 无 citation | 需要 |
| 记忆 | `memory_recalled` + 行内可遗忘 | 无 | 需要（见记忆方案） |

> 详细差距与落点见 [`docs/plans/weknora-agent-parity.md`](../plans/weknora-agent-parity.md)。

---

## 7. 复刻检查清单（协议侧）

1. 一条 SSE、一个 `response_type` 分派器；**不要**为审批/工具另开通道。
2. 每个事件至少带：`assistant_message_id`（轮）、`tool_call_id`（调用）、`event_id`（可替换段）。
3. 终态只有三类；`run_suspended` 不是终态。
4. 断线续传按已持久化 id 接回，禁止重发建轮请求。
5. 参数增量按对象合并；答案增量按段拼接/替换。
6. 步骤要能脱离实时流重放；大载荷入库前压缩。
7. 审批状态以事件流为唯一真值，dock 与内联卡都派生。
8. 心跳与空闲超时必须实现，否则长工具调用会被中间层掐断。

---

## 8. 证据索引

| 事实 | 位置（被调研仓库） |
|---|---|
| `ResponseType` 31 个常量与逐条注释 | `internal/types/chat.go:235-332` |
| `StreamResponse` 帧字段 | `internal/types/chat.go:345-357` |
| `stop` 裸事件 | `internal/handler/session/stream.go:444` |
| 心跳 | `internal/handler/session/stream.go:199,404` |
| 前端流客户端（重连/续传/心跳超时/TTFB） | `frontend/src/api/chat/streame.ts:74-391` |
| 协作/进度事件类型 | `frontend/src/api/chat/streamTypes.ts:1-67` |
| 事件消费与合并 | `frontend/src/composables/useChatStreamHandler.ts:66-78, 832-900, 1347-1416, 1642-1647, 1736-1770` |
| 审批从持久化还原 | `frontend/src/composables/useChatStreamHandler.ts:87-140` |
| 答案工具条 / 终态判定 | `frontend/src/views/chat/components/botmsg.vue:56-128`；`AgentStreamDisplay.vue:526-595, 1906-1942` |
| 消息分派 | `frontend/src/views/chat/components/botmsg.vue:17-45` |
| 上下文压缩的用户可见事件 | `07-agent.md` 第 4.2 节 |

### 未验证

- 每个事件 `data` 的**完整字段集**：本文只列渲染要用到的键；后端 `data` 是 `map[string]interface{}`，未逐 handler 穷尽。
- 事件顺序是否在协议层有保证：代码是并发事件总线，本文按前端消费顺序归纳，**未读到显式排序承诺**。
- `stop` 是否也会在其它路径（如超时）发出：只读到用户停止这一处。
- 移动端 / 小程序是否有独立的流协议：小程序只有「textarea + 按钮 + 一段文本」，未见流式（`miniprogram/pages/chat/chat.wxml`）。
