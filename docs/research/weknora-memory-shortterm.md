# WeKnora 会话内记忆：历史组装、Token 预算与上下文压缩

> 状态：**调研记录**（归档层；结论有变时新增勘误、不改原文）
> 调研日期：**2026-11-26**（CST）。基线：`weknora` 仓库分支 `integrate/aidenwlf-20261124-001102`，HEAD `b6ee40476`（基于上游 v0.9.0）。
> 方法：只读静态阅读产品文档（WeKnora 产品文档《Agent 引擎》第 4 节，`07-agent.md`）+ 代码点查；未跑长会话实测，数值取自文档与常量。
> 范围：**一轮之内与轮与轮之间**的上下文管理；跨会话长期记忆见 [长期记忆](weknora-memory-longterm.md)。

---

## 0. 一句话结论

**它把「会话历史」当成一个每轮重建的**流式窗口**：从数据库按 Token 预算倒着装轮次，装不下就交给压缩器摘要成一条带标记的 user 消息，并把压缩点写回被覆盖的那一轮；下一轮直接从压缩点之后加载。整个过程没有任何内存缓存，数据库是唯一事实源。**

四个值得抄的设计：

1. **按 Token 装载，不按轮数**（Agent 模式下 `history_turns` 不生效）。
2. **压缩点（checkpoint）落库**，避免同一段历史每轮重复摘要。
3. **历史里的检索结果默认脱敏成一行**，强制模型对可能变化的知识库重新检索。
4. **压缩失败要留痕（degraded）并写回**，否则下一轮会原样再失败一次。

---

## 1. 历史如何组装（`LoadAgentHistory`）

| 规则 | 内容 | 证据 |
|---|---|---|
| 来源 | 只从 `messages` 表重建；**无 Redis / 内存缓存** | `07-agent.md` 第 4.3 节 |
| 预算 | 整个上下文窗口 `agent.HistoryTokenBudget`，**刻意大于压缩阈值** | 同上 |
| 读取顺序 | 按 `(created_at, id)` 从新到旧分页（每页 200 行，单次最多 5000 行） | 同上 |
| 配对 | 按 `RequestID` 配 user / assistant；只保留 `IsCompleted` 的完整轮 | 同上 |
| 停止条件 | 读到压缩点或预算装满即停；长会话不整段读出 | 同上 |
| 缺题处理 | 未读到会话开头、且最旧一行不是 user 时，该轮缺原始问题，**整轮舍弃** | 同上 |
| 溢出一轮 | 最新一轮即使单独超预算也保留，交给压缩切分 | 同上 |
| 压缩点后的加载 | 取最新压缩点：它所在轮及更早的轮由一条摘要消息代替，之后原样重放 | 同上 |

### 1.1 一轮展开成什么

```
user 消息（含图片 caption 与附件 prompt）
  → 每个含工具调用的 AgentStep 展开为 assistant(tool_calls) + 若干 tool 消息
  → 末尾一条规范化最终答案 assistant 消息（剥离 <think> 块）
```

- 历史中的 tool 消息用 `CompactToolOutputForHistory` 压缩：带 `display_type` 的大载荷换成一行摘要（如 `Knowledge search returned N result(s) (details omitted from history)`）；`shell_exec` / `read_file` 等按原结构重建。
- 进入引擎后再做一次**历史 KB 结果脱敏**：除非 Agent 开启 `RetainRetrievalHistory`，历史轮次里的 KB 类工具结果一律替换成 `"[Previous retrieval result omitted — knowledge base may have changed. Please perform a fresh search.]"`。

> 这条是「记忆的诚实性」设计：**不把旧检索结果当成仍然有效的事实**。复刻时若原样回放旧结果，用户会遇到「知识库已更新，但 AI 还在引用旧内容」。

---

## 2. Token 估算

| 项 | 值 | 证据 |
|---|---|---|
| 默认窗口 | `DefaultMaxContextTokens = 200000`；`MaxContextTokens` 未设时兜底 | `07-agent.md` 第 4.1 节 |
| 编码器 | tiktoken **cl100k_base** | 同上 |
| 固定开销 | `perMessageOverhead = 3`，`perConversationTail = 3` | 同上 |
| 编码失败兜底 | `len(s)/4` | 同上 |
| 权威值 | 优先用模型 API 返回的 `Usage`；增量只估新增消息 | 同上 |
| 校准系数 | `Estimator.SetScale`，限制 0.5–1.5；只乘文本，不乘固定开销/图片估值 | 同上 |
| 校准方法 | 用同一轮相邻两次请求的 prompt token 增量 ÷ 新增消息估算；样本不足 256 token、比值 <0.3 或 >3、含图片、发生过压缩/裁剪时不计 | 同上 |
| 系数持久化 | 随本轮 usage 存为 `context_token_scale`；下一轮取最近一条带系数的消息 | 同上 |

**为什么要校准**：cl100k 不是各家模型的分词器。中文在 cl100k 下约 1 token/字，Qwen/DeepSeek 约 0.6，英文与 JSON 基本一致。不校准会让中文会话过早压缩或过晚溢出。

---

## 3. 上下文压缩

### 3.1 触发

| 项 | 值 |
|---|---|
| 调用点 | 每轮 Think 前（`manageContextWindow` → `compaction.Compactor`） |
| 窗口来源 | Agent 配置 → 模型 `parameters.context_window` → 200000 |
| 阈值 | 窗口 − reserve |
| reserve | `max(completion 预算 + 4096, 16384)`，至少 16384 |
| 保留尾部 | 默认 `KeepRecentTokens = 20000`；小窗口压到可用窗口的 1/4 |
| 放弃条件 | 无可压缩内容，或释放空间 < **5%**；记录当前消息数，避免同一大小反复花模型调用 |

### 3.2 摘要怎么生成

- 切点**不拆开** assistant 工具调用与其 tool 结果。
- 长 ReAct 会话可在**当前轮内部**切分；切分轮的前半段单独总结，用来解释保留的后半段。
- 旧摘要参与更新；较老历史生成**结构化摘要**；结果以带标记的 user 消息放在 system 与保留尾部之间。
- 摘要预算由 reserve、模型输出上限和保留预算共同决定，**不再固定 2000**。
- 摘要调用走流式接口，只设**停顿超时**（默认 120s 无输出才取消）；总时长交给传输层。
- 每次最多 **2 次**尝试；本轮已取消则不重试；失败则回退**原始文本归档**并标 `degraded`。
- 原始归档同样受摘要预算约束：从最新消息往前保留，并注明省略了多少条。

### 3.3 压缩点（checkpoint）

| 规则 | 内容 |
|---|---|
| 何时写 | 摘要覆盖的历史部分**恰好结束在某个已落库轮次的末尾** |
| 写在哪 | 该轮 assistant 消息的 `messages.context_checkpoint` |
| 何时不写 | 切点落在轮次内部；摘要只覆盖当前轮；切分轮前半段的摘要 |
| 失败时 | 原始归档**仍然写**并标 `degraded`；否则下一轮重复失败 |
| 释放不足 5% 而放弃 | 上下文不变，但只要历史部分有压缩点**照样写**，避免重复摘要 |
| 写入失败 | 只记日志，不影响本轮 |
| 索引 | `idx_messages_session_created_id (session_id, created_at DESC, id DESC)`，`CREATE INDEX CONCURRENTLY` |
| 与分叉/回滚 | 压缩点存在被覆盖的那一轮上：分叉复制该轮会一起复制；回滚/删除该轮则失效 |

### 3.4 溢出恢复

- 提供商报告上下文超限（错误或响应截断判据）时，**强制压缩并重试一次**。
- 仅因生成耗尽 completion 预算的截断，**不得**误判为上下文超限。
- 压缩后仍超预算，最后才裁短工具结果：预算 = 窗口 20%，限制在 **8192–32768** token。

---

## 4. 与本项目的对照

| 维度 | WeKnora | heyta 现状 | 结论 |
|---|---|---|---|
| 历史事实源 | DB（messages） | op-log + 本地持久化（`ASSISTANT_TURN` 实体） | 同构，可借鉴「按 token 装载」 |
| 压缩 | 摘要 + checkpoint 落库 + degraded 回退 | 未读到上下文压缩实现 | **缺**；长会话会撞窗口 |
| 工具结果入历史 | 压成一行 + KB 结果脱敏 | 工具结果不进历史（当前只拼 user/assistant 文本） | 需补，但**先补脱敏**再补回放 |
| 历史 KB 脱敏 | 有 | 无（也没有检索工具） | 未来做检索时必须有 |
| rewind / fork | 有；压缩点随轮复制/失效 | 无（会话是线性的） | 需要时再设计，别先抄复杂度 |

> 对「记住偏好」的直接含义：**偏好块不是历史摘要**。WeKnora 把「会话摘要」归上下文压缩、把「一句话偏好」归长期记忆，两者不混。我们的设计也应保持这一刀（见 [`preference-memory.md`](../plans/preference-memory.md)）。

---

## 5. 证据索引

| 事实 | 位置（被调研仓库） |
|---|---|
| Token 预算、估算器、校准系数 | `07-agent.md` 第 4.1 节 |
| 压缩触发、reserve、保留尾部、摘要、checkpoint、溢出 | 同上，第 4.2 节 |
| 历史组装、配对、脱敏、压缩点加载 | 同上，第 4.3 节 |
| `context_compacted` 事件 | `internal/types/chat.go:323`；前端 `AgentStreamDisplay.vue:50,385` |

### 未验证

- 上述数值来自产品文档与常量，**未跑长会话实测**；`KeepRecentTokens` 在小窗口下的动态压缩比只按文档描述。
- 摘要质量、成本、压缩后任务完成率：仓库无公开评测数据。
