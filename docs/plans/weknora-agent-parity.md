# WeKnora Agent 输出移植计划：从「纯文本回答」到「可读的过程」

> 状态：**规划中**（2026-11-26 立）
> 依据：[输出协议](../research/weknora-agent-output-protocol.md) · [会话页 IA](../research/weknora-agent-chat-ia.md) · [视觉规范](../research/weknora-agent-visual-spec.md) · 我方现状（本轮只读盘点，摘录见 §2；原始笔记在 `.local/`，不入库）
> 目标：把 WeKnora 的**输出形态**（过程可见、引用可点、工具可展开、失败可解释）移植到 heyta 的助手，**不是**照抄它的 Vue 组件或 TDesign。

---

## 0. 一句话结论

**heyta 缺的不是「聊天框」，是「回答的结构」：web 端至今把模型输出当纯文本 `pre-wrap` 渲染（`ai-chat-direction-a.css:85-91`），而 WeKnora 把一轮回答拆成「思考 / 工具 / 进度 / 引用 / 答案」五类可独立折叠的段。** 移植的靶心是这套**段模型**，不是它的皮肤。

三件事按顺序做：

1. **先把 web 的 Markdown 补齐**（现在只有 mobile 有）。这是最低成本、最高感知的一步。
2. **再把「过程」做成可折叠的行**（工具、思考、进度），复用 heyta 已有的 `TraceRow` / `ChatSteps`。
3. **最后才是重协议**（审批、挂起、引用、续传）—— 它们各自要动 `packages/ai` 与 `app-host`，必须单独排期。

---

## 1. 学什么、不学什么

| 学 | 不学 |
|---|---|
| **段模型**：思考 / 工具 / 进度 / 引用 / 答案 / 错误各自成段，段可折叠、可替换 | 93 个组件的全量清单（多数是 WeKnora 业务专属：知识库、Wiki、沙箱、嵌入渠道） |
| **过程可读**：工具调用显示「做了什么 + 结果摘要」，不是一行 JSON | TDesign 组件库与 `--td-*` 令牌（heyta 有自己的 `--ht-*` 与门禁） |
| **引用与来源**：角标 → 浮层 → 右栏原文 | 服务端多租户 / 空间 / 共享 Agent 的模型 |
| **HITL 双呈现**：时间线内联卡 + composer dock，同一 `pending_id` 派生 | 审批的 12 种 resolve reason（heyta 先做 approve/reject 两态） |
| **答案工具条**：复制 / 重试 / 分叉 / 回滚按需出现 | 分叉/回滚的完整实现（heyta 会话是线性的，见 §6） |
| **记忆行**：这一轮用了哪些记忆，可逐条遗忘 | 5 类记忆 × 4 状态的完整体系（见 [`preference-memory.md`](preference-memory.md)） |
| **错误的可解释**：截断 / 降级 / 持久化失败各有标记 | 它的 `!important` 与 160 处圆角字面量 |

> 🔴 **一个必须先说清的判断**：WeKnora 的「好看」很大一部分来自 TDesign 的成熟组件（气泡、抽屉、弹窗、骨架）。heyta 移植时**不能**把这些组件搬过来，只能用 `packages/ui` 现有原语重画；否则会同时违反设计令牌门禁与双端一致性。

---

## 2. 现状差距（只列已核过的）

| 能力 | heyta 现状 | 证据 | 差距 |
|---|---|---|---|
| Web Markdown | **纯文本** `pre-wrap`，无 markdown-it | `apps/web/src/features/ai/ai-chat-direction-a.css:85-91` | 🔴 最大 |
| Mobile Markdown | 有 `MarkdownMessage` | `apps/mobile/src/ai/MarkdownMessage.tsx:1-25` | 已具备 |
| 流式协议 | 3 类分片（text/reasoning/tool-call）+ 4 类轮事件 | `packages/ai/src/stream.ts:42-51`、`app-host/src/ai-assistant.ts:231-242` | 缺 citation / memory / approval / suspend |
| 工具呈现 | `TraceRow` / `ChatSteps` / `ReasoningRow` | `apps/web/src/features/ai/AssistantPanel.tsx:1329,1542,1461` | 形态已有，信息密度低 |
| 引用 | 全 AI 侧 0 命中 | 盘点 §1.3 | 🔴 缺 |
| 思考落盘 | 不落盘 | `assistant-live.ts:51` | 刷新即丢 |
| 附件进历史 | 不进 `ChatItem` | `AssistantPanel.tsx:432` | 刷新即丢 |
| 审批 | 提案卡（确认执行），无运行中暂停/恢复 | `ProposalCard` | 形态不同 |
| 会话内记忆 | 无 | 盘点 §2.2 | 缺 |
| 错误 | 有 `ChatFailure` | `AssistantPanel.tsx:1754` | 可用 |

---

## 3. 移植映射（WeKnora → heyta 落点）

| WeKnora | 职责 | heyta 落点 | 性质 |
|---|---|---|---|
| `botmsg.vue` 分派（Agent / RAG 两路） | 一条回答按模式分派 | `AssistantPanel` 的消息渲染分支 | 改造 |
| `AgentStreamDisplay` 的段模型 | 思考/工具/进度/答案分段 | `ChatSteps` + `TraceRow` 扩展为 `AssistantSegment` 列表 | 重构 |
| `ChatMemoryStep` | 「用了 N 条记忆」 | 新 `MemoryRow`（见记忆计划） | 新增 |
| `ProgressUpdates` | 进度累积 + 折叠 | `TraceRow` 的 `progress` 变体 | 新增 |
| `docInfo` / `ChatReferencesDrawer` | 来源分组 + 右栏原文 | 新 `Citations` 段 + `SourceDrawer`（web）/ 全屏页（mobile） | 新增 |
| `ToolResultRenderer` 27 个叶子 | 按 `display_type` 分派 | 先做 5 个：文本 / 列表 / 文件 / 检索 / 错误 | 分期 |
| `ToolApprovalCard` + dock | 审批双呈现 | `ProposalCard` 升级为 `ApprovalCard` + composer dock | 改造 |
| `AskUserCard` | 反问 | 暂不做（heyta 助手不做多轮澄清） | 不做 |
| 答案工具条 | 复制/重试/产物 | `MessageActions`（复制/重试已有，补「继续问」） | 改造 |
| 流式尾字渐隐 | 流式光标 | `StreamCaret`（已有） | 复用 |
| 代码块 / 表格 / 引用样式 | Markdown 输出 | `packages/ui/src/markdown` 新建（双端共用） | 新增 |

**为什么 Markdown 要放 `packages/ui`**：web 与 mobile 各写一份必然漂移（仓库已吃过「五份手抄披露」的亏，`packages/ui/src/ai/model.ts` 文件头）。Markdown 渲染器只做「AST → 原语」，样式全走 token。

---

## 4. 分期与验收

### P0 · Web Markdown（最小可感知）

| 项 | 内容 |
|---|---|
| 做什么 | `packages/ui/src/markdown`：解析（marked 或自研，**先查许可证与 2021 后维护**）→ 渲染标题/段落/列表/代码/表格/引用/链接；web 接入；mobile 复用同一套 token 映射 |
| 不做什么 | 不用 `dangerouslySetInnerHTML` 直出未消毒 HTML；不引入 TDesign |
| 验收（能失败） | ① 一段包含标题/列表/表格/代码/链接的回答在 web 与 mobile 上渲染结构一致（截图 + 断言）；② 代码块有语言标与复制；③ 表格横向溢出可滚；④ `check:ui-language` 不新增硬编码文案；⑤ 无裸值（`pnpm check:design`） |
| 估 | 2–3 天 |

### P1 · 段模型（过程可读）

| 项 | 内容 |
|---|---|
| 做什么 | 把一轮回答拆成 `AssistantSegment[]`：`reasoning` / `tool` / `progress` / `answer` / `error`；思考与工具默认折叠为一行摘要，展开看细节；工具行显示「名称 + 一句话结果」；进度折叠 |
| 数据 | 复用现有 `AssistantTurnEvent`（4 类）+ `local-api` 工具结果；**先不改流协议**，只改呈现层 |
| 验收 | ① 一次含 3 次工具调用的回答，折叠态只占 3 行；展开逐条可见；② 刷新后工具行仍在（需要把步骤落进 `AssistantTurnEvent` 持久化）；③ 失败行可展开看原因；④ 折叠/展开有 `aria-expanded` 与键盘可达 |
| 估 | 3–5 天 |

### P2 · 引用与来源

| 项 | 内容 |
|---|---|
| 做什么 | 协议加 `citation`（答案内的引用标记 + 来源元数据）；答案渲染角标；点角标开来源抽屉；来源列表按文档分组 |
| 前提 | 助手需要「检索」能力；当前 heyta 助手只有本地数据工具，**没有知识库/网页检索**。若不做检索，引用只能是「任务/清单实体引用」——这仍然有价值（「我说的那件事」可点开） |
| 验收 | ① 回答里的实体引用可点开对应任务；② 引用角标不改变正文换行；③ 来源抽屉可用键盘关闭 |
| 估 | 4–6 天（含协议） |

### P3 · 审批与运行中控制

| 项 | 内容 |
|---|---|
| 做什么 | 低风险写自动执行保持现状；高风险提案升级为「暂停 + 审批卡 + 恢复」；composer 上方 dock；停止/继续 |
| 前提 | 需要 `app-host` 的运行状态机（`run_state`）与持久化；这是**最大的一块**，必须先写 ADR |
| 验收 | ① 审批卡出现在时间线与 dock 两处，状态一致；② 刷新后未审批的卡仍在；③ 拒绝后本轮以「已取消」结束而不是报错；④ 停止后已产出内容保留 |
| 估 | 1–2 周 |

---

## 5. 视觉映射（角色对角色，禁止抄数值）

| 角色 | WeKnora 的做法 | heyta 的落法 |
|---|---|---|
| 回答正文 | 16px / 1.625 | `TEXT_STYLES.body`（现量由 token 决定，不抄 16px） |
| 时间线摘要 | 13px / 灰 | `TEXT_STYLES.caption` + `color.foreground-muted` |
| 代码块 | radius 8 / GitHub 双主题 | `radius.md` + 现有代码高亮主题；暗色跟随 `data-theme` |
| 引用角标 | 药丸 + 品牌淡底 | `color.primary-subtle` + `radius.pill` |
| 工具行图标 | 18×18 / 左 42px | `space` 与 `icon` 档；行高用 `task-row-shape` |
| 分隔与层级 | 1px 线 + 4px 网格 | `border-subtle` + `space` 档 |
| 动效 | 120/150/200/300ms | `duration` 五档 + `spring-physics`（裸 ms 禁止） |

> ⚠️ WeKnora 的「助手无气泡、满宽」在 heyta 上要重新判断：heyta 的助手是侧栏面板，宽度本来就窄；照抄「满宽无气泡」会让长回答更难读。**这一条不移植**，保留现有消息容器。

---

## 6. 明确不做（本轮）

| 不做 | 理由 |
|---|---|
| 分叉 / 回滚 | heyta 的会话是线性落盘（`ASSISTANT_TURN` 一条消息一个实体），做分叉要新增「会话树」概念，成本远超收益 |
| 子 Agent / 多智能体 tab | 当前助手没有子 Agent 能力；先有任务拆解再谈并行 |
| 沙箱 / 终端 / 桌面 | 产品边界外 |
| 小程序 / 嵌入渠道 | 无此形态 |
| 27 个工具结果渲染器 | 先做 5 个高频的；其余按真实工具增长 |
| 赞/踩反馈 | WeKnora 也没有；heyta 已有 `AI_FEEDBACK`，不需要界面重复 |

---

## 7. 待拍板

1. **助手要不要「检索」能力**？没有检索，引用只能引用本地实体（任务/清单/标签）。这决定 P2 是「实体引用」还是「知识引用」。
2. **审批是否值得做运行中暂停**？它要求 `app-host` 有可恢复的运行状态，是一次架构改动（需 ADR）。
3. **过程折叠的默认态**：默认收起（省空间）还是默认展开（可解释）？WeKnora 完成后收起、流式中展开；heyta 面板更窄，建议完成后收起。

---

## 8. 证据

- 协议与事件表：[`weknora-agent-output-protocol.md`](../research/weknora-agent-output-protocol.md)
- 页面与组件（93 个）：[`weknora-agent-chat-ia.md`](../research/weknora-agent-chat-ia.md)
- 逐值样式： [`weknora-agent-visual-spec.md`](../research/weknora-agent-visual-spec.md)
- 我方现状（含 `file:line`）：本轮只读盘点，摘录见 §2；原始笔记在 `.local/weknora-study/07-our-current-state.md`（不入库）
