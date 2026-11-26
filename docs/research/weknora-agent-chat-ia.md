# WeKnora Agent 会话页：信息架构与交互规范

> 状态：**调研记录**（归档层；结论有变时新增勘误、不改原文）
> 调研日期：**2026-11-26**（CST）。基线：`weknora` 仓库分支 `integrate/aidenwlf-20261124-001102`，HEAD `b6ee40476`（fork 自腾讯 WeKnora，合到上游 v0.9.0）。
> 方法：**只读静态阅读** + 逐点 `grep -n`，未运行应用、未截图；凡推测标「推测」，凡未读到实现标「未验证」。
> ⚠️ 文中 `file:line` 以**被调研仓库** `~/Desktop/All in one Data/01_PROJECTS/weknora` 为准，不是本仓库；一次改动即偏移。
> 范围：页面分区、组件清单（93 个）、状态矩阵、交互、composer、Agent 页与助手面板、响应式与键盘。协议与视觉分别在 [输出协议](weknora-agent-output-protocol.md) 与 [视觉规范](weknora-agent-visual-spec.md)。

---

## 关于「Her 页面」的对位（先说清楚，避免查错对象）

在被调研仓库里**不存在**以 `Her` 命名的页面、路由或组件。取数与结果：

```bash
grep -rn '"Her"\|Her页面\|her-page\|/her' frontend/src docs website-docs   # 0 命中（只有 node_modules 里的 hermes-*）
ls frontend/src/views                                                     # 无 her/ 目录
grep -n 'path:' frontend/src/router/index.ts                              # 无 /her 路由
```

因此本报告覆盖的是**仓库里实际存在的全部 Agent 相关页面**，按「最可能被叫作 Her 页面」的顺序排列：

| 候选 | 入口 | 本文位置 |
|---|---|---|
| **Agent 会话页**（回答、时间线、审批、composer） | `/platform/chat/:chatid` | §②–§⑥ |
| **助手面板**（全局唯一、跨路由保留、页面上下文桥） | Logo 旁 / 右侧 launcher / ⌘K | §7.4 |
| **Agent 列表与编辑器**（创建、配置、分享） | `/platform/agents` | §7.1–§7.2 |
| **HITL 审批与反问**（工具审批、安全表单、挂起/恢复） | 会话内联卡 + composer dock | §④ 状态矩阵、§⑤.3 |

> 若「Her」是某个内部代号、另一份仓库或产品里的叫法，给出路径即可增补勘误；本报告不替它猜内容。

---

## ① 一页结论

1. **这是一个「会话流 + 常驻 composer」的三段式页面，不是「消息列表 + 输入框」的聊天框。**
   垂直结构固定为：`顶栏(ChatHeader) → 子智能体 tab 条 → 滚动消息区 → 独立 composer（不是滚动区的一部分）`，
   两个右侧面板（参考来源 420px、沙箱 320–1200px 可拖拽）靠 **给 `.chat` 加 `padding-right`** 让位，而不是覆盖（`index.vue:2068-2101`）。

2. **页面本身几乎不画 UI，UI 全在子组件里。**
   `index.vue` 的模板只有 232 行，负责：状态编排、composer 高度测量、面板让位，以及 6 个 provide（子智能体 tab 上下文/查询、审批 dock、参考来源抽屉、附件预览抽屉、沙箱面板）。
   真正的「一条 assistant 消息」由 `botmsg.vue` 分派成两条完全不同的渲染路径：
   - **Agent 管道**（`session.isAgentMode`）→ `AgentStreamDisplay.vue`（182KB，单文件模板含两套重复的事件渲染分支）
   - **快答/RAG 管道** → `RagPipelineProgress` + `docInfo` + markdown + `deepThink`
   （`botmsg.vue:19-45`）

3. **审批不是一个弹窗，而是一个「dock（底部常驻）+ inline（时间线内联）」的双呈现模型。**
   同一个 `pending_id` 会同时存在于时间线（`variant="inline"`）和 composer 上方的 `PendingPromptDock`（`variant="dock"`）；
   内联卡片上有按钮把焦点跳到 dock（`AskUserCard.vue:68`、`ToolApprovalCard.vue:77`）。
   dock 的可见集合由 `pendingPrompts(messages)` 纯函数从消息事件流里算出来（`usePromptDock.ts:25-64`），**不是独立状态**。

4. **没有「赞/踩」反馈，也没有「编辑重发」。**
   全仓 `api/` 无 thumbs/vote/feedback 端点；`views/chat` 无 `editMessage/resend` 实现。
   答案工具条实际只有：分叉、回滚、复制、存知识库、产物、请求信息（`AgentStreamDisplay.vue:527-595`）。
   唯一带「反馈」语义的是追问建议的 impression 事件（`FollowUpSuggestions.vue:42`）。

5. **右栏是「一个面板三个 tab」，不是三个面板。**
   `SandboxSidePanel` 的 tab 固定为 `artifacts | terminal | desktop`，产物只是第一个 tab；
   「记忆」「协作任务」「后台任务」**不在右栏**，它们分别在时间线（`ChatMemoryStep` / `CollaborationTasks`）和 composer 的 `BackgroundWorkChip` 里。
   （`useChatSandboxPanel.ts:3`、`SandboxSidePanel.vue:15-31`）

6. **embed 是完全独立的一套应用（另一个 HTML 入口），不是同一个页面的 props 分支。**
   `embed.html` + `src/embed-main.ts`，路由 `/embed/:channelId` → `EmbedPage.vue` → `EmbedChatView.vue` → `EmbedChatCore.vue`（自建消息渲染，不复用 botmsg）。
   小程序是第三套：微信原生 `miniprogram/pages/chat`，只有「一个 textarea + 一个按钮 + 一段答案」。

---

## ② 页面线框（文字版分区图）

### 2.1 应用外壳（`views/platform/index.vue:1-24`）

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Menu 侧栏 (aside_box，可折叠 uiStore.sidebarCollapsed，宽度 --sidebar-width) │
│  ├ logo / ⌘K 提示                                                          │
│  ├ 菜单项（creatChat / knowledge-bases / artifacts / agents / automations…）│
│  ├ 会话列表区：scope filter + 时间桶分组（今天/昨天/更早）+ 批量模式         │
│  └ menu_bottom                                                             │
├───────────────────────────────────────────────────────────────────────────┤
│ .platform-route-outlet (flex column, min-height:0, overflow:hidden)         │
│   └ RouterView  →  会话页 / Agent 列表 / creatChat                          │
├───────────────────────────────────────────────────────────────────────────┤
│ AssistantPanel（dock 挤压 / floating 浮层，无遮罩，跨页保留会话）            │
│ AssistantLauncher（右侧边缘竖条按钮，仅 entry=launcher 时出现）              │
│ AssistantPageBridge（SelectionBubble + PageFillNotice，无可见 UI）          │
│ Settings / GlobalCommandPalette(⌘K) / UploadTasksPanel / NewUserGuide      │
└───────────────────────────────────────────────────────────────────────────┘
```

### 2.2 会话页本体（`views/chat/index.vue:1-232`）

```
.chat  (flex column, min-width:400px, --chat-content-inset:20px)
│       面板让位：padding-right = references(420) | sandbox(320-1200) | 两者相加(≥1400px)
│
├─ .chat-topbar                                        ← v-if !embeddedMode  (10)
│   ├─ ChatHeader
│   │   ├ h1 标题（双击进入改名 input，Esc/blur 提交）  ChatHeader.vue:19-32
│   │   ├ pin 图钉 / automation 链接 / workspace 标签
│   │   └ ⋯ 菜单：改名 · 授权管理(grants) · 复制 Markdown · 删除会话   ChatHeader.vue:74-92
│   └─ 沙箱面板开关按钮（面板已开时隐藏）              (11-27)
│
├─ ChildAgentTabBar                                    ← 有子智能体任务时   (28-29)
│   ├ [主对话]  ← 有待审批时显示 attention 圆点
│   └ [子任务A ×] [子任务B ×] …   role=tablist，←/→ 导航
│
├─ .chat_thread  (v-show 无激活子 tab)                                  (30)
│   ├─ .chat_scroll_box  @scroll=handleScroll                           (31)
│   │   └─ .chat_scroll_content
│   │       └─ .msg_list
│   │           ├ [骨架屏] historyLoading && 无消息                     (35-50)
│   │           ├ [推荐问题卡片] 无消息 && 有 session && 非 automation    (51-98)
│   │           │   标题+刷新按钮 + 6 格卡片（FAQ 角标）
│   │           ├ v-for 消息（key=session.id）                          (106-149)
│   │           │   ├ MessageTimestamp（按时间间隔条件显示）
│   │           │   ├ role=user  → usermsg（含 @标签 / 图片 / 附件 / fork / rewind / steer 失败）
│   │           │   └ role=assistant → botmsg
│   │           │        └ AgentStreamDisplay | (RagPipelineProgress + docInfo + markdown + deepThink)
│   │           │        └ FollowUpSuggestions（渲染完成后，可刷新/关闭）
│   │           └ [全局思考指示器] role=status，仅「本轮在跑但没有任何可见 pending 步骤」时  (153-156)
│   │
│   └─ .chat_composer  (测量高度 → --chat-composer-height)              (160)
│       ├ HostApprovalCard 列表（Lite 宿主命令审批，独立于 dock）        (161-172)
│       ├ [回到底部按钮] userHasScrolledUp && 距底 >80px                (173-177)
│       ├ PendingPromptDock（审批 dock，可折叠/翻页）                    (178)
│       ├ [automation 会话提示条] role=note                             (179-182)
│       ├ InputField（compact）                                          (183-201)
│       │   #chips / #background-work / #controls 三个插槽
│       └ .chat_overlays
│           ├ BrowserTaskPreview（浏览器任务画中画）
│           └ ChatQuestionMinimap（右侧问题刻度条，悬停出预览）
│
├─ .chat-child-detail × N  (v-show 选中的子智能体) role=tabpanel         (212-214)
│   └ ChildAgentStream
│
└─ 页面级浮层（都在 .chat 之外）
    ├ KnowledgeBaseEditorModal（新建知识库，@ 里点「新建」时弹）           (216-218)
    ├ ChatReferencesDrawer（右栏 420px / 查看原文时变宽）                 (219)
    ├ ChatAttachmentPreviewDrawer（附件预览）                             (220)
    ├ SandboxSidePanel（右栏，artifacts|terminal|desktop）                (221-227)
    └ t-dialog 后台任务输出（720px）                                      (228-231)
```

**尺寸行为（关键）**

| 区域 | 尺寸/行为 | 证据 |
|---|---|---|
| `.chat` | `min-width:400px`，水平 padding 为 0（让滚动条贴右缘），内容左右留白用 `--chat-content-inset:20px` | `index.vue:2043-2056` |
| 参考来源面板 | 固定默认 `420px`，`查看原文` 态变宽；打开时 `.chat` 加 `padding-right`，并带 `--app-motion-slow` 过渡（仅 ≥960px） | `useChatReferencesDrawer.ts:17,48`；`index.vue:2072-2081` |
| 沙箱面板 | `320–1200`，默认 `420`，可拖拽，宽度持久化到 `localStorage.sandbox_panel_width`；上限再受 `window.innerWidth-480` 夹取 | `useChatSandboxPanel.ts:15-34` |
| 两面板同开 | ≥1400px 时 padding 为两者相加；960–1399.98px 时只让沙箱（参考来源覆盖其上） | `index.vue:2085-2101` |
| composer | 不参与滚动，高度实时测量写进 CSS 变量，供消息列对齐 | `index.vue:785-799` |
| 嵌入模式 | `min-width:100%`、无顶栏、无 overlays、无内嵌编辑弹窗、限制若干控件 | `index.vue:2060-2066, 10, 206-210` |

### 2.3 embed 线框（`views/embed/EmbedPage.vue:1-80`）

```
.embed-page
├ [loadError] 文案 + 重试按钮
├ header（有 sessionId 才显示）
│   ├ 徽标(avatar|icon) + 标题 + 副标题
│   ├ 历史按钮 → t-drawer 320px（列表 / 当前项禁用 / 清空需 popconfirm）
│   └ 新会话按钮（无消息或忙时 disabled）
├ t-alert（历史读取失败）
└ EmbedChatView → EmbedChatCore（自建消息渲染 + EmbedInputField + 复用 PendingPromptDock/FollowUpSuggestions/ChatReferencesDrawer）
```

---

## ③ 组件清单表

> 计数口径（单个 `.vue` 文件计一次，页面本身计一次；不含纯 `.ts` 工具）：
> **会话页组件树 = 45** = 页面 1 + `views/chat/components` 32 + `components/chat` 4 + 跨页共享 8；
> `tool-results` 叶子 27 → 72；embed 专属 5 → 77；Agent/创建页 3 → 80；助手面板 13 → **合计 93**。
> 复现命令：`ls src/views/chat/components/*.vue | wc -l`（32）、`ls src/views/chat/components/tool-results/*.vue | wc -l`（27）、`ls src/components/chat/*.vue | wc -l`（4）、`ls src/components/assistant/*.vue | wc -l`（13）。

### 3.1 页面与消息骨架

| 组件 | 职责 | 关键 props | 事件 |
|---|---|---|---|
| `views/chat/index.vue` | 页面编排：会话加载、流式接入、面板让位、composer 高度、分叉/回滚、steer 队列、后台任务轮询 | `session_id, agentId, embeddedMode, initialQuery, hostScope, modelId, defaultModelId` | `update:modelId` |
| `botmsg.vue` (30KB) | 一条 assistant 消息的分派与收尾：`isAgentMode ? AgentStreamDisplay : (RAG 三件套 + markdown)`；答案工具条；嵌入态产物抽屉 | `content, session, userQuery, isFirstEnter, embeddedMode, sessionId, followUpLoading, canFork, canRewind, canAskAssistant` | `scroll-bottom, render-complete-change, fork, rewind, ask-assistant` |
| `usermsg.vue` (15KB) | 一条 user 消息：@标签、图片缩略、附件卡、时间戳、复制/分叉/回滚、steer 失败重试/移除 | `content, mentioned_items, images, attachments, channel, embeddedMode, sessionId, messageId, createdAt, canFork, canRewind, steerFailed` | `retry-steer, remove-steer, fork, rewind` |
| `deepThink.vue` | 快答模式的 thinking 折叠块（thinking 由 true→false 自动折叠） | `deepSession` | — |
| `docInfo.vue` | 快答模式的知识引用/网页引用分组折叠；点「查看全部」优先开右栏抽屉，无 refs 时退化为内联折叠 | `content, session, embeddedMode, timelineMode, contentOnly` | — |

### 3.2 Agent 时间线（`AgentStreamDisplay.vue`，182KB，核心中的核心）

| 组件 | 职责 | 关键 props | 事件 |
|---|---|---|---|
| `AgentStreamDisplay.vue` | Agent 一轮回答的完整时间线：收起的步骤树 / 展开的流式事件流 / 最终答案 / 记忆行 / 生命周期指示器 / 答案工具条 / 内联审批卡 / citation 浮层 / wiki 抽屉 / 产物抽屉 | `session, sessionId, userQuery, embeddedMode, artifactsInDrawer, embedChannelId/Token/SessionSig/VisitorId, ragMode, followUpLoading, canFork, canRewind, deferToolApprovals` | `render-complete-change, fork, rewind` |
| `ChatMemoryStep.vue` | 「使用了 N 条记忆」折叠行，展开显示 kind+content+遗忘按钮；`variant: step|root` 决定是否画树杈 | `memories, expanded, variant, isLast, forgettingId` | `toggle, forget` |
| `ProgressUpdates.vue` | 进度更新的折叠披露（`<details>`）：收起显示最新一条，展开按时间序 | `content, history` | — |
| `CollaborationTasks.vue` | 一个子智能体任务行（名字 + 状态/工具相位 + 箭头），点击打开子 tab | `task, disabled, motionPaused, toolLabel` | `open` |
| `ChildAgentTabBar.vue` | 顶部子智能体 tab 条：主对话 + 子任务，关闭按钮，attention 圆点，`role=tablist` + 方向键 | `tabs, activeId, attention, headerMode` | `select, close` |
| `ChildAgentStream.vue` | 子智能体自己的对话流（独立 session/run） | `task, active` | — |
| `RagPipelineProgress.vue` | 快答/RAG 管道进度（检索→重排→生成），也接管 `memoryOnly` 变体 | `session, embeddedMode, memoryOnly` | — |
| `AskUserCard.vue` (15KB) | Agent 反问卡：选项 listbox（支持多选/数字快捷键）、动态字段（number/multiselect/select/text）、自由文本、倒计时、挂起态 | `pendingId, variant(dock|inline), request, timeoutSeconds, hotWaitSeconds, suspendable, suspended, expiresAt, requestedAt, resolved, answered, response, resolveReason, timedOut, canceled, abandoned, embeddedMode, embed*` | （内部 emit 提交，通过 stream 回写） |
| `SecureFormCard.vue` | 安全表单卡：域名披露、登录态可用密码库、username/password/自定义字段、保存到库 vs 只用一次 | 同上（`request` 为 `SecureFormRequest`） | 同上 |
| `ToolApprovalCard.vue` (20KB) | 工具调用审批：问题文案、委派任务、描述分段折叠、参数 JSON 可编辑（带脏/非法态）、会话内授权 checkbox、倒计时 | `pendingId, delegatedTask, variant, serviceName, mcpToolName, description, argsJson, grantScope, grantLapsed, timeoutSeconds, requestedAt, resolved, approved, canceled, resolveReason, suspendable, hotWaitSeconds, suspended, expiresAt, abandoned, embed*` | 同上 |
| `McpOAuthCard.vue` | MCP 服务 OAuth 授权卡 | `pendingId, variant, serviceId, serviceName, mcpToolName, timeoutSeconds, requestedAt, resolved, authorized, resolveReason, timedOut, canceled, embed*` | 同上 |
| `HostApprovalCard.vue` | Lite 宿主命令/文件写审批：command / skill / env / stdin / script / 路径 / 写预览 / read-write 权限收窄 / 拒绝片段 | `pendingId, host, timeoutSeconds, requestedAt, resolved, approved, resolveReason, resolveScope` | 同上 |
| `HostReviewRecord.vue` | 已由模型自审完成的 host 记录（只读回放） | `host, resolved, approved, resolveReason` | — |
| `PendingPromptDock.vue` | composer 上方审批 dock：标题+图标、多卡翻页、折叠、`Enter` 提交当前卡 | `embeddedMode, embed*` | 内部 |
| `OpenPageCard.vue` | 「打开了某页面」卡片 | `link: AssistantPageLink` | — |
| `PageEditCard.vue` | 「填了某表单/改了页面字段」卡片，可撤销 | `fill: PageFillResult, toolCallId` | — |
| `ToolResultRenderer.vue` | 按 `displayType` 分派 27 个结果渲染器 | `success, displayType, toolData, output, arguments, fileAccess, filesReady` | — |
| `ArtifactFileIcon.vue` | 按文件名给图标 | `fileName` | — |

### 3.3 产物 / 沙箱 / 后台任务

| 组件 | 职责 | 关键 props | 事件 |
|---|---|---|---|
| `ChatArtifactsPanel.vue` (20KB) | 右栏产物 tab：范围切换（全部/本消息）、搜索、列表、预览、下载 / 存知识库 / 存为技能 / 删除 | `sessionId, items, collecting, active` | `deleted{messageId,index}` |
| `ChatArtifactsDrawer.vue` (24KB) | 嵌入态/单消息的产物抽屉，`previewIndex` 可直接开某文件预览 | `visible, sessionId, messageId, artifacts, previewIndex, allowAddToKnowledge` | `update:visible` |
| `AddArtifactToKnowledgeDialog.vue` | 产物存入知识库的目标选择 | `visible, sessionId, messageId, artifactIndex, fileName` | `update:visible, added` |
| `SandboxTerminal.vue` (15KB) | 沙箱终端（xterm 类） | `sessionId, agentId, agentSourceTenantId` | — |
| `SandboxDesktop.vue` | 沙箱桌面（VNC 类） | `sessionId, agentId, agentSourceTenantId` | — |
| `BrowserTaskPreview.vue` (15KB) | 浏览器任务画中画（右下角悬浮） | `sessionId` | — |
| `BrowserToolDetails.vue` / `JavaScriptToolDetails.vue` | 浏览器/JS 工具详情专用渲染 | `event` | — |
| `BackgroundWorkChip.vue` | composer 里的后台任务胶囊：`运行中 N` + popup 列表（标题/时长/停止） | `items, cancelWork` | `view(workId)` |
| `BackgroundWorkResults.vue` | 后台任务输出弹窗内容 | `sessionId, workId` | — |

### 3.4 时间线叶子渲染器（`tool-results/`，27 个）

`SearchResults / ChunkDetail / RelatedChunks / KnowledgeBaseList / KnowledgeChunksList / DocumentInfo / DocMarkdown / GraphQueryResults / ThinkingDisplay / PlanDisplay / DatabaseQuery / WebSearchResults / WebFetchResults / GrepResults / ShellExecResult / SandboxFilesResult / WriteSandboxFileResult / ReadSkillResult / McpToolResult / WikiEditResult / OperationsResult / WeKnoraDocResult / CatalogValue / ContentPopup / ResultRow / ImageViewResult / ImageGenerationResult`
（`ToolResultRenderer.vue:1-60` 的一串 `v-if` 分派；`McpToolResult` 与 catalog 类型由 `utils/mcpToolDisplay.ts`、`utils/catalogToolDisplay.ts` 决定）

### 3.5 跨页共享（会话页直接依赖）

| 组件 | 职责 | 关键 props / 事件 |
|---|---|---|
| `Input-field.vue` (4696 行) | composer 全部能力（见 ⑥） | 见 ⑥ 表 |
| `ChatHeader.vue` (629 行) | 顶栏：标题双击改名、pin、automation 链接、workspace 标签、⋯ 菜单（改名/授权/复制 MD/删除） | `session` |
| `ChatReferencesDrawer.vue` | 右栏参考来源：分组列表、片段展开、开原文、跳文档 | 由 `useChatReferencesDrawer` provide |
| `ChatAttachmentPreviewDrawer.vue` | 附件预览抽屉 | 同上 |
| `AgentSelector.vue` | Agent 选择器：内置组 / 自定义组 / 共享组 + 详情侧面板（能力标签、就绪状态） | `visible, anchorEl, currentAgentId, agents, all-models`；`close, select, not-ready` |
| `MentionSelector.vue` + `MentionFileBrowser.vue` | @ 选择器：5 组（kb/tag/mcp/skill/file），Tab 进组、Esc 退组、组内浏览知识库文件 | （见 ⑥） |
| `AttachmentUpload.vue` | 附件列表与上传（默认 `max-files=5`，`:3028`） | `max-files`、`ref` 暴露 `clear()` |
| `AgentStreamDisplay` 内部还依赖 | `ChatTimelineIcon`、`ChatActionIcon`、`ChatRequestInfoButton`、`ChatCitationFloat`、`useChatCitationPopover` | — |

### 3.6 状态编排层（无 UI 但决定 IA 的 composable）

| 文件 | 职责 |
|---|---|
| `composables/useChatStreamHandler.ts` | SSE 事件 → 消息模型：`answer/thinking/tool_call/progress/agent_prompt_required/mcp_oauth_required/tool_approval_required/child_task/context_compacted/error`，含 `isAwaitingInput`、`isPromptCard` 判定 |
| `composables/usePromptDock.ts` | 从消息算出「还在等用户」的审批集合、激活 id、折叠、focus |
| `composables/useChatSandboxPanel.ts` | 右栏可见/tab/宽度/聚焦某消息产物 |
| `composables/useChatReferencesDrawer.ts` | 参考来源抽屉可见/列表/高亮/source 视图/宽度 |
| `composables/useChatScrollFollow.ts` | 滚动跟随：`reading` 态、只有「用户在底部且非布局变化」才继续贴底 |
| `composables/useChildAgentTabs.ts` | 子智能体 tab 的创建/选择/关闭/attention |
| `composables/useAssistantPageContext.ts` | 把当前会话上下文（page/chatSessionId/messageId）发布给助手 |
| `stores/assistant.ts` | 助手可见性/会话/布局/宽度/权限层/页面上下文层 |
| `stores/chatResources.ts` | agents / models / 搜索 provider 缓存 |
| `stores/settings.ts` | `selectedAgentId`、`isAgentStreamMode`、`selectedSkills`、`reasoningEffort`、websearch/图片生成/本地浏览器开关 |
| `stores/ui.ts` | 侧栏折叠/宽度、KB 编辑器弹窗状态 |

---

## ④ 状态矩阵

> 「可做什么」只写代码里真实存在的交互。

| 状态 | 触发条件 | 显示什么 | 可做什么 | 证据 |
|---|---|---|---|---|
| **首屏加载** | `historyLoading && messagesList.length===0` | 4 组骨架（2 用户 2 助手，交错宽度） | 无（composer 已可用） | `index.vue:35-50` |
| **空会话（新会话）** | `currentSession && !isAutomationSession && messagesList.length===0 && !loading` | 「推荐问题」标题 + 刷新 + 6 格卡片；加载中显示 6 格骨架；FAQ 有角标 | 点卡片直接发问；点刷新重取 | `index.vue:51-98`、`creatChat.vue:8-44` |
| **流式中（有可见步骤）** | `loading` 且有 pending 事件 | 时间线里最后一条 pending 卡自带微光（shimmer） | 停止生成；Queue 追问（Enter）；steer（⌘/Alt+Enter） | `AgentStreamDisplay.vue:2042-2047` |
| **流式中（无可见步骤）** | 本轮在跑、答案未开始、无 pending、非协作等待 | 底部居中的转圈指示器 `role=status` | 同上 | `index.vue:153-156`、`showGlobalTypingIndicator`=1212-1214 |
| **等待审批** | `pendingPrompts(messages).length>0` | ① 时间线内联卡（可折叠）② composer 上方 dock（可翻页/折叠）③ 子 tab 条 attention 圆点 | 批准/拒绝/填表/授权；`Enter` 提交当前卡；多卡翻页 | `usePromptDock.ts:25-64`、`PendingPromptDock.vue:1-46`、`ChildAgentTabBar.vue:5-7` |
| **已提交但未消费** | 本页答过、stream 还没回写 `resolved` | 该卡从 dock 移除，时间线行显示「已发送的答案摘要」 | 无（等后端） | `usePromptDock.ts:10-24`、`AskUserCard.vue:76-79` |
| **挂起（suspendable）** | `suspended && expires_at`，且未过期 | 卡显示 parked 文案 + 到期时间；已过期则不进 dock | 仍可提交 | `usePromptDock.ts:32-36`、`AskUserCard.vue:46-48` |
| **失败（本轮）** | SSE `response_type==='error'` 或 `data.error` | 消息 `content` 被替换为错误文案；无答案内容的错误进 `MessagePlugin.error` toast | 继续提问；**没有**「重试本条」按钮；错误前的工具输出保留 | `useChatStreamHandler.ts:1347-1416` |
| **持久化失败** | 错误事件 `stage==='message_persistence'` | 消息带 `persistence_error`（不覆盖答案正文） | — | `useChatStreamHandler.ts:1642-1647` |
| **降级/截断** | `session.is_fallback` / `session.truncated` | 答案工具条出现两个只读图标（`fallback-icon-btn`），hover 出 tooltip | 只能看，不能点 | `botmsg.vue:110-120` |
| **被中断（stop）** | 用户点停止 | 流结束；已产出内容保留 | 继续提问；分叉/回滚按规则禁用 | `Input-field.vue:3365-3374` |
| **steer 失败** | `_steerFailed` | 用户消息下出现失败条 + 重试 + 移除 | 重试 / 移除 | `usermsg.vue:74-79` |
| **回滚进行中** | `rewindInFlight` | composer 锁死（`composerLocked`） | 等待 | `index.vue:533-535` |
| **automation 会话** | `currentSession.kind==='automation'` | composer 位置变成提示条 `role=note`，**不显示输入框** | 只读 | `index.vue:179-182` |
| **IM 回复接管中** | `isImRecovering` | 显示等待态而不是报错 | 等待 | `index.vue:751-757`、`showGlobalTypingIndicator` |
| **历史分页** | 滚到顶 | 顶部加载更多；`hasMoreHistory` 由 `historyHasMoreAfterAttempt` 决定 | 继续上滚 | `index.vue:1051,1222-1262` |
| **用户上滚（阅读态）** | `userHasScrolledUp`（距底 >80px） | 右下「回到底部」按钮 | 点回底；新流不抢滚动 | `index.vue:801-813`、`useChatScrollFollow.ts:26-46` |
| **无权限（Agent 未就绪）** | agent `not-ready`（缺模型/知识库不满足） | 选择器条目带红色 error-circle，详情面板列原因；点选不切换 | 去设置修 | `AgentSelector.vue:30-35,113-121` |
| **无权限（知识库被 Agent 限制）** | `isKnowledgeBaseDisabledByAgent` | @ 按钮置灰，tooltip 带「去 Agent 设置」链接 | 跳设置 | `Input-field.vue:3228-3264`、`:1973` |
| **无权限（embed 访客）** | `embedToken` 存在 / `embeddedMode` | 产物抽屉隐藏「存知识库」「存为技能」；协作任务行不可点开 | 只读 | `ChatArtifactsDrawer.vue:70,84`、`botmsg.vue:145`（`!embeddedMode`）、`AgentStreamDisplay.vue:38` |
| **离线（本地浏览器）** | `browserConnection.knownOffline` | 浏览器来源按钮 aria-disabled，tooltip 换成「去设置」链接 | 跳设置 | `Input-field.vue:3088-3100` |
| **页面级离线** | — | **未发现**整页离线横幅/离线队列提示（`未验证`是否有全局网络层接管） | — | — |
| **embed 加载失败** | `loadError` | 错误文案 + 重试按钮 | 重试 bootstrap | `EmbedPage.vue:5-8` |

---

## ⑤ 交互清单

### 5.1 消息级（assistant）

答案工具条只在 `answerFullyRendered && event.done && 有内容` 时出现，且分「常驻」与「悬浮」两态
（`AgentStreamDisplay.vue:526-595`；`answer-toolbar--persistent` 当有产物或产物收集中）。

| 交互 | 呈现 | 规则/反馈 | 证据 |
|---|---|---|---|
| **复制答案** | 工具条 copy 图标 | 复制的是清洗后的纯文本（去空 inline code 等） | `AgentStreamDisplay.vue:1077`、3595 |
| **分叉（fork）** | 工具条 git-branch；确认后跳新会话 | **规则**：本轮仍在流式 → 整个会话所有回答都不能 fork（后端会 409）；user 消息 fork「在本问之前」历史并预填本问，assistant 消息 fork「包含本答」 | `forkPoint.ts:1-48`、`index.vue:615-618` |
| **回滚（rewind）** | 工具条 rollback + popconfirm（标题/正文/确认/取消） | 规则：`rewindableMessageIds` 一次性算出可回滚点；有 outgoing work（isReplying/streaming/recovering）则禁用；成功后本地截断消息并 `MessagePlugin.success`；冲突码映射到不同 i18n；失败有 `reloadFailed` 文案 | `rewindView.ts:17-69`、`index.vue:700-713` |
| **存知识库** | 工具条 bookmark-add | 弹 `AddArtifactToKnowledgeDialog` 选目标库；embed 访客不可用 | `botmsg.vue:97-108`、`AgentStreamDisplay.vue:559` |
| **产物** | 工具条 folder + 计数徽标；收集中显示 loading | 点击开右栏 artifacts 并聚焦本消息；embed 走 `ChatArtifactsDrawer` | `AgentStreamDisplay.vue:563-575`、`botmsg.vue:139` |
| **请求信息/调试** | info-circle（`ChatRequestInfoButton`） | 展示 request id / 原始请求体 | `AgentStreamDisplay.vue:586-588` |
| **来源展开** | `docInfo` 分组（知识/网页/工具）折叠 | 「查看全部」优先打开右栏 420px 抽屉；无 refs 时退化为内联展开 | `docInfo.vue` `referBoxSwitch` |
| **引用跳转** | 答案内 citation 标记 → `ChatCitationFloat` 浮层（hover 进/出有延迟取消） | 点进 → 右栏 `source` 视图（变宽）并高亮 chunk | `AgentStreamDisplay.vue:752`、`useChatCitationPopover.ts`、`useChatReferencesDrawer.ts:27-31` |
| **追问建议** | 答案下方卡片（标题+刷新+关闭 + 按钮列表，`aria-live=polite`） | 只在渲染完成、非 steer 分叉、未被 dismiss 时出现；select / regenerate / impression / dismiss 四事件 | `index.vue:143-149`、`FollowUpSuggestions.vue:1-45` |
| **问助手（about this answer）** | 工具条 `AssistantActionsButton`（`canAskAssistant && !embeddedMode`） | 把 `{page:'chat', chatSessionId, messageId}` 发布为助手页面上下文 | `botmsg.vue:83`、`index.vue:486-492` |
| **复制/移除/Chat 链接** | markdown 内链一律新标签打开 | `chatLinksNewTab.test.mjs` | 测试文件存在（`components/chatLinksNewTab.test.mjs`） |

### 5.2 消息级（user）

| 交互 | 呈现 | 规则 | 证据 |
|---|---|---|---|
| 复制 | hover 出现的小按钮 | — | `usermsg.vue:41-45` |
| 分叉 | 同上 | 同 fork 规则；user 消息 fork 点在本问之前 | `usermsg.vue:46-50` |
| 回滚 | 同上 + popconfirm | 同 rewind 规则 | `usermsg.vue:51-73` |
| steer 失败重试/移除 | 失败条 | 仅 `steerFailed` | `usermsg.vue:74-79` |
| 图片/附件 | 缩略图 / 附件卡（名 + 大小） | 点击开 `ChatAttachmentPreviewDrawer` | `usermsg.vue:16-32` |
| @ 标签 | 标签 chip（kb 分 faq/kb 两色） | 只读回放 | `usermsg.vue:4-14` |

### 5.3 时间线级（Agent 过程）

| 交互 | 说明 | 证据 |
|---|---|---|
| 折叠/展开「中间步骤」树 | 完成后自动折叠为一行「N 步」；展开显示树杈 + 子事件；长跑只保留最近步骤（`isStickyStep` 白名单：pending、child_task、未解决审批、进行中 thinking） | `AgentStreamDisplay.vue:9-24, 2187-2191, 2545-2550` |
| 单事件展开 | 点 action header 切换；`role=button` + `tabindex=0` + `aria-expanded` | `AgentStreamDisplay.vue:348` |
| 工具卡三种展开态 | pending（微光）/ 有结果（摘要 + 可展开详情）/ 仅 output（兜底 pre） | `AgentStreamDisplay.vue:599-720` |
| 摘要直出 | `todo_write` 计划、`run_javascript`、`web_search`、`grep_chunks`、`read_document`、`attachment_parsing` 各有专属一行摘要 | `AgentStreamDisplay.vue:650-702` |
| 页面动作卡 | `OpenPageCard`(打开) / `PageEditCard`(填写) 内联在步骤里；答案里再 pin 一份 | `AgentStreamDisplay.vue:270-271, 520-524` |
| 子智能体 | 行内 `CollaborationTasks` → 点开成 tab → 主对话整体隐藏（`v-show`） | `index.vue:30, 212-214` |
| 记忆 | 时间线首行 `ChatMemoryStep`，可展开看每条 + 遗忘 | `AgentStreamDisplay.vue:327-343` |

---

## ⑥ composer 全字段

`Input-field.vue` props（对象式 `defineProps`，`components/Input-field.vue:650-733`）：
`compact, autoFocus, isReplying, composerLocked, sessionId, assistantMessageId, embeddedMode, modelId, defaultModelId, queuedSteers, canSteer`
emits：`send-msg, steer-msg, promote-steer, remove-steer, retry-steer, stop-generation, stop-confirmed, stop-failed`

### 6.1 结构（自上而下）

```
.answers-input
├ .steer-queue           队列中的追问（time 图标 + 文本 + 立即发送/重试/移除）   2994-3018
├ .image-preview-bar     图片缩略 + 删除                                          3020-3035
├ .mention-chip 行       已选 @ 项（图标 / 组织徽标 / 名称 / ×）                  3036-3055
├ t-textarea             自增高，placeholder = input.placeholder                   3057
└ .control-bar                                                                    3062
  ├ .control-left
  │  ├ Agent 模式按钮（含下拉箭头；normal/agent/custom 三态样式）                  3068-3079
  │  ├ HostApprovalModeSelect（Lite 宿主审批模式）                                 3082
  │  ├ 本地浏览器来源按钮（aria-pressed）                                          3086-3100
  │  ├ 联网搜索按钮                                                               3103-3129
  │  ├ 图片生成按钮                                                               3130-3145
  │  ├ 图片上传按钮                                                               3146-3164
  │  ├ 附件上传按钮（带计数徽标）                                                   3165-3185
  │  ├ 语音输入（按住说话，仅 Agent 开启音频且配了 ASR）                             3187-3216
  │  ├ @ 知识库/文件按钮（data-guide=chat-kb-mention）                             3218-3264
  │  ├ <slot name="background-work">  → BackgroundWorkChip                        3265-3268
  │  ├ <slot name="controls">
  │  ├ 模型选择器（名字 + 「自动」标 + 上下文窗口标）                                3270-3296
  │  └ 思考强度选择器（仅非 embed 且有 reasoningLevels）                            3297-3324
  └ .control-right
     ├ 生成中：停止按钮（steer 可用且有内容时让位给发送）                             3365-3377
     └ 发送按钮（tooltip 带快捷键）→ 也可作为「排队」/「steer」                      3378-3393
```

### 6.2 字段与来源

| 字段 | 状态源 | 落库/请求 | 说明 |
|---|---|---|---|
| `query` | 本地 ref | 发送内容 | textarea 自增高 |
| `uploadedImages[]` | 本地 | 图片文件 | 只允许 Agent 开启图片上传；粘贴图片也走这里（`onPaste`） |
| `uploadedAttachments[]` | `AttachmentUpload` 子组件 | 临时附件 API（`uploadTemporaryAttachment`） | 失败降级为内联附件并 toast |
| `allSelectedItems`（@ 项） | `settingsStore` + 本地 | `mentioned_items` | 5 组：kb / tag / mcp / skill / file（`MentionSelector.vue:365-370`） |
| Agent | `settingsStore.selectedAgentId` | `agent_id` + `agent_source_tenant_id` | 切 Agent 会重置搜索开关、清空不允许的 @MCP/@Skill、强制其模型 |
| 模型 | `modelId` / `defaultModelId` / `settingsStore.selectedModelId` | `model_id` | Agent 指定模型时 composer 变 `agent-controlled`（锁定） |
| 思考强度 | `reasoningLevels` + `displayedReasoningLevel` | `reasoning_effort` | 等级来自 `model.thinking_levels`，回退 `off/auto/low/medium/high`（`utils/reasoningEffort.ts:27`）；embed 下不显示 |
| 技能 | `settingsStore.selectedSkills` | `selected_skills` | 不在 control-bar 常驻，只通过 @ 选（`skill` 组）或 Agent 配置 |
| 联网搜索 | `settingsStore.isWebSearchEnabled` | 请求开关 | 未配置时 tooltip 给「去设置」 |
| 图片生成 | `settingsStore.isImageGenerationEnabled` | 请求开关 | |
| 本地浏览器 | `settingsStore.isLocalBrowserEnabled` + `browserConnection.online` | 请求开关 | 离线时禁用并引导 |
| 后台任务 | `backgroundItems`（轮询 `listBackgroundWork`） | — | 只在有 running 时出现 |
| 排队的 steer | `queuedSteers`（`delivery==='after'`） | `steer` API | 可「立即发送」（promote）/重试/移除 |

### 6.3 快捷键与提交语义（`utils/chatSubmitShortcut.ts:1-13`）

| 键 | 结果 |
|---|---|
| `Enter` | 空闲→发送；生成中且可 steer→**入队（after）** |
| `Cmd/Ctrl+Enter` | 生成中→**steer（inject，打断当前并插入）** |
| `Alt+Enter` | 可 steer→inject；否则不提交 |
| `Shift+Enter` / `Ctrl+Enter` | 换行（不提交） |
| 输入法组合中（`isComposing` / keyCode 229） | 一律不提交 |
| `Backspace`（光标在 0 且输入为空） | 删除最后一个 @ chip |
| @ 面板内 `↑/↓` 移动、`Enter` 确认、`Tab` 进组、`Esc` 退组/关闭 | 面板内导航 |
| 语音：按住热键 | 只在输入框可见且非组合时生效（全局捕获） |
| Dock：`Enter` | 提交当前审批卡（`promptKeys` 里排除文本域） |

### 6.4 草稿与上下文

- **草稿**：composer 内部 `query` 是本地 ref，切换会话即丢失（未发现草稿持久化；`未验证`是否有 watch 存 storage）。
- **首问预填**：`menuStore.firstQuery / firstMentionedItems / firstModelId / firstImageFiles / firstAttachmentFiles / firstQuestionOrigin`，页面挂载时消费一次（`index.vue:345-347`）；分叉落地用 `sessionStorage` 的 `FORK_PREFILL_KEY` 预填（`index.vue:537-544`）。
- **回滚预填**：回滚到 user 消息时把该问原文写回 composer（`rewindPrefillText`）。
- **引用上下文**：embed 每次发送调 `hostScope()` 取 `{knowledgeBaseIds, pageContext}`（`index.vue:352-356`）。

---

## ⑦ Agent 页与助手面板

### 7.1 Agent 列表（`views/agent/AgentList.vue`，1892 行）

- **头部**：标题 + 副标题 + 「新建 Agent」（contributor）+ 「用助手创建」（有 `assistantStore.pageAccess`）+（Lite 有独立分支）（`:5-35`）。
- **筛选条**：`ResourceListToolbar`，scope = `all | mine | favorites | recents | by-org`，带 query 与各 scope 计数（`:38-40`、`:836`）。
- **分组**（可折叠，`role=button` + `aria-expanded`）：
  `内置` / `我的` / `本空间其他成员` / `共享给我·可编辑` / `共享给我·只读`（`:71-156`）。
  `mine` scope 下重排为 `内置/我的/他人`（`:289-333`）。
- **卡片信息**：名称 + ⋯ 菜单（编辑/复制/停用/删除，按角色与归属显隐）、收藏星、描述（空则占位）、
  能力徽标（agent_mode 图标 / 联网 / 知识库 / MCP / 多轮）、来源组织、内置锁标、被停用标（`:157-290`）。
- **共享详情抽屉**：名称 / 来源组织 / 我的权限 / 共享范围（知识库·模型·重排·联网·MCP）+「在对话中使用」（`:659-717`）。
- **空态**：搜索无结果 / all 空 / favorites 空 / recents 空 / mine 空，各不同图标与 CTA（`:574-616`）。
- 路由：`/platform/agents`，`meta.requiredCapability='agents'`（`router/index.ts:153-158`）。

### 7.2 Agent 编辑器（`views/agent/AgentEditorModal.vue`，6944 行）

**不是分步向导，是「左侧分组导航 + 右侧单页分区」的设置壳**：`SettingsModalShell` + `navGroups`（`:3-8`、`:2909-2938`）。

| 分组 | 分区 key |
|---|---|
| 基础 | `basic`（ID/集成状态/运行模式）、`prompts`（系统提示 + 上下文模板）、`model`、`conversation`（多轮/迭代上限/超时/反思）、`suggestions`（开场白 + 追问建议，两个 tab） |
| 知识 | `knowledge`、`retrieval`（阈值滑杆一组）、`websearch` |
| 能力 | `multimodal`（图片/音频/ASR）、`tools`（allowed_tools）、`mcp`（选择模式 + 服务 + OAuth 等待超时）、`skills`（选择模式 + 技能列表） |
| 集成 | `share`（分享/嵌入范围） |

`defaultFormData` 里可见默认值：`agent_mode='smart-reasoning'`、`temperature=0.7`、`thinking=false`、`reasoning_effort='off'`、`citation_enabled=true`、`max_iterations=10`、`llm_call_timeout=120`、`mcp_auth_wait_timeout=600`、`access_level='auto_write'`（`:2934-2975` 起）。
运行模式在 `basic` 顶部先选（`quick-answer` / `smart-reasoning`），内置 Agent 不可改（`:70-82`）。
分享/嵌入的实际配置在「集成中心」，编辑器只显示状态与跳转（`:45-62`）。

### 7.3 新建会话页（`views/creatChat/creatChat.vue`，514 行）

`/platform/creatChat` 与 `/platform/knowledge-bases/:kbId/creatChat` 共用。
内容：标题 + 推荐问题（骨架→6 格，卡片逐个入场动画）+ `create-chat-composer`（composer + 可选「选择项目目录」条）。
发送流程：建会话 → 把首问/首提及/首模型/首图/首附件塞进 `menuStore` → `router.push('/platform/chat/:id')`（`:268-293`）。
失败有两条不同文案（`createFailed` / `createError`）。

### 7.4 助手（Assistant）面板

- **入口**：侧栏 `AssistantButton`（`menu.vue:11,85`）、右侧边缘 `AssistantLauncher`（仅 `entry==='launcher'`）、命令面板（`entry==='palette'`）；entry 三选一存 `localStorage`（`stores/assistant.ts:126,140-147`）。
- **挂载点**：`views/platform/index.vue:9-11`，**全局唯一实例，跨路由保留**。
- **布局**：`docked`（挤压右栏）/ `floating`（浮层，可拖动 header 移动）；宽度 `360–760`，默认 `440`，持久化（`stores/assistant.ts:128-130`）。
- **面板内部**：标题 + 帮助（?）+ 新会话 / 历史 / 布局切换 / 关闭；
  历史列表（可删）、动作建议（starter 按钮）、欢迎态（图标+标题+说明+starter）、composer、上下文 chip（`AssistantContextChip`）。
- **页面上下文桥**：`AssistantPageBridge` 只做两件事——把 `routeTitle` 写进 `pageTitle`；`installPageAwareness` 上报「当前视图」和「选中文本」。
  `pageAccess=false` 时这两项都被清空，助手「看不见页面」（`AssistantPageBridge.vue:15-44`）。
  `useAssistantPageContext` 在各页面里注册分层上下文（chat 页注册 `{page:'chat', chatSessionId, messageId}`）。
- **与普通会话的隔离**：独立 session（`weknora:assistant-session`、按租户+用户做 key）、独立模型、独立 accessLevel（工作区上限裁剪），**不共享 chat 的会话列表**。
- **可执行动作**：`AssistantContextAction` / `AssistantActionsButton`（页面上「让助手做这几件事」）；助手可填表单（模型草稿 `AssistantModelDraft`、MCP 草稿 `AssistantMcpServiceDraft`——**明确不含凭据**）、可打开页面（`OpenPageCard` / `AssistantPageLink`）、可填写页面字段（`PageFillResult` / `PageEditCard` / `PageFillNotice`）。
- **选择面板**：`AssistantAccessPicker`（权限档）、`AssistantContextMenu`、`AssistantSelectionBubble/Chip`（选中文本浮标）。

---

## ⑧ 响应式与快捷键

### 8.1 断点（全站只用了两档）

| 断点 | 作用 | 证据 |
|---|---|---|
| `≥960px` | 右栏打开时 `.chat` 才让位（`padding-right`），带 `--app-motion-slow` 过渡 | `index.vue:2068-2090` |
| `≥1400px` | 允许「参考来源 + 沙箱」双面板并排让位 | `index.vue:2094-2096` |
| `960–1399.98px` | 双面板时只让沙箱，参考来源叠在其上 | `index.vue:2098-2100` |
| `<960px` | 右栏**覆盖**在内容上（不让位）；`.chat` 仍保 `min-width:400px` | 同上逻辑取反 |

无 `prefers-reduced-motion` 之外的其它媒体查询；`index.vue:2429` 与 `Input-field.vue:3498,3972` 有 reduced-motion 降级。

### 8.2 模式差异

| 差异点 | 主应用 | embed | 小程序 |
|---|---|---|---|
| 入口 | SPA `/platform/chat/:id` | 独立 HTML + `/embed/:channelId` | 微信原生三 tab |
| 顶栏 | ChatHeader + 沙箱开关 | 徽标/标题/历史/新会话 | 无（微信导航栏） |
| 会话列表 | 侧栏（时间桶分组 + scope 过滤 + 批量） | 抽屉 320px（列表 + 清空） | 无 |
| 消息渲染 | botmsg → AgentStreamDisplay | `EmbedBotMessage` 自建 | 一段纯文本 |
| 输入 | InputField 全功能 | `EmbedInputField`（只留模型选择 + 受宿主限制的上传/搜索） | textarea + 按钮 |
| 右栏 | 参考来源 + 沙箱（artifacts/terminal/desktop） | 仅 `ChatReferencesDrawer`（embedded） | 无 |
| 审批 | dock + inline 双呈现 | dock（`PendingPromptDock`，带 embed 凭据） | 无 |
| 隐藏项 | — | 顶栏、overlays、KB 编辑器、沙箱面板、思考强度、Agent 选择器、@ 提及（宿主已定 KB，`Input-field.vue:3064-3066`）、已选 chip（`:3036` 对 embed 返回空数组）；`#chips`/`#controls` 插槽留给宿主注入 | — |

移动端：**没有专门的移动布局**。在会话页、侧栏（`menu.vue`）、顶栏（`ChatHeader.vue`）、助手面板（`AssistantPanel.vue`）四处样式中，除 `prefers-reduced-motion` 外没有任何宽度断点；`<960px` 时右栏覆盖内容、composer 控件换行撑高即为唯一降级。`未验证` 是否存在页面之外的移动端判定（如 host 注入的 UA 分支）。

### 8.3 键盘与可达性

| 能力 | 实现 | 证据 |
|---|---|---|
| 提交/steer/换行 | 见 6.3 | `chatSubmitShortcut.ts` |
| @ 面板导航 | ↑↓ / Enter / Tab 进组 / Esc 退组 | `Input-field.vue:2666-2700` |
| 审批 dock | `Enter` 提交当前卡；文本域内不拦截（`isTextEntry`） | `PendingPromptDock.vue:42`、`utils/promptKeys` |
| 审批卡内 | 提交按钮带 `↵` 角标；选项有数字快捷键（`optionKey(index)`） | `AskUserCard.vue:9,54` |
| 子智能体 tab | `role=tablist` / `role=tab` / `aria-selected` / `tabindex` 游标；左右方向键；关闭后焦点回到选中 tab | `ChildAgentTabBar.vue:1-36` |
| 子 tab 内容 | `role=tabpanel` + `aria-label=任务名` | `index.vue:212` |
| 审批 dock 容器 | `tabindex=-1` + `aria-label` + `@keydown` | `PendingPromptDock.vue:4-5` |
| 折叠行 | `role=button` + `tabindex=0` + `aria-expanded`；部分带 `@keydown.enter/space` | `AgentStreamDisplay.vue:348`、`ChatMemoryStep.vue:8-12` |
| 全局等待 | `role=status` + `aria-label=chat.thinkingAlt` | `index.vue:153` |
| 追问建议 | `aria-live=polite` | `FollowUpSuggestions.vue:2` |
| 右栏 | `role=complementary` + `aria-label` | `SandboxSidePanel.vue:8-9`、`ChatReferencesDrawer.vue:9-10` |
| 问题刻度条 | `aria-label` + 预览 `role=dialog` | `ChatQuestionMinimap.vue:7,47` |
| 图标按钮 | 一律 `aria-label` 或 `:aria-label`，装饰性 `aria-hidden=true` | 全量 |
| 开关类 | `aria-pressed` / `aria-expanded` / `aria-checked` 齐全 | `Input-field.vue:119,163,228,303-318` |
| 焦点管理 | dock focus 请求（`promptDock.focus`）、tab 关闭后回落、`autoFocus` 首问 | `usePromptDock.ts:66-90` |
| 全局 ⌘K | 命令面板在 platform 壳层 | `platform/index.vue:18`、`menu.vue:16-23` |
| 语音热键 | 全局捕获 keydown/keyup（capture 阶段） | `Input-field.vue:2158-2159` |

---

## ⑨ 证据索引

### 9.1 路由与入口
| 事实 | 位置 |
|---|---|
| 会话页路由 `/platform/chat/:chatid` | `frontend/src/router/index.ts:188-193` |
| Agent 列表 `/platform/agents`（`requiredCapability:'agents'`） | `router/index.ts:153-158` |
| 创建会话两条路由（全局 / 绑定知识库） | `router/index.ts:176-187` |
| embed 是独立入口（注释明说） | `router/index.ts:58`；`frontend/embed.html:25`；`frontend/src/embed-main.ts:1-40` |
| 应用外壳（侧栏 + RouterView + 助手 + ⌘K） | `views/platform/index.vue:1-24` |

### 9.2 会话页分区
`views/chat/index.vue`
| 区域 | 行 |
|---|---|
| 根节点 class（`is-embedded` / `has-references-panel` / `has-sandbox-panel`）与 CSS 变量 | 2-7 |
| 顶栏 + 沙箱开关 | 10-27 |
| 子 tab 条 | 28-29 |
| 滚动区 / 骨架屏 / 推荐问题 / 消息循环 / 全局等待 | 30-156 |
| composer（宿主审批 + 回底 + dock + automation 提示 + InputField + 插槽） | 160-201 |
| overlays（浏览器画中画 + 问题刻度） | 206-210 |
| 子智能体详情面板 | 212-214 |
| 页面级弹窗/抽屉（KB 编辑器 / 参考来源 / 附件预览 / 沙箱 / 后台任务输出） | 216-232 |
| 尺寸与面板让位样式 | 2043-2101 |
| composer 高度测量 | 785-799 |
| 回到底部阈值 80px | 801-813 |
| `composerLocked` 定义 | 533-535 |
| 分叉落地预填 | 537-544 |
| 回滚流程与四类失败文案 | 665-713 |
| 全局等待判定 | 1212-1214 |
| 历史分页 | 1222-1268 |

### 9.3 组件
| 事实 | 位置 |
|---|---|
| botmsg 双路径分派 | `views/chat/components/botmsg.vue:17-45` |
| botmsg 答案工具条 | 同上 `:56-128` |
| usermsg 元信息与动作 | `views/chat/components/usermsg.vue:33-79` |
| AgentStreamDisplay 收起的步骤树 | `AgentStreamDisplay.vue:9-24` |
| AgentStreamDisplay 事件分派（thinking/progress/tool_call/审批/子任务/compaction） | `:33-330`、`:363-720` |
| 答案工具条（fork/rewind/copy/KB/artifacts/info） | `:526-595` |
| 状态 computed（`isConversationDone` / `isSegmentDone` / `showAgentActivityIndicator`） | `:1917-1921`、`:2042-2047` |
| 折叠策略（`shouldShowCollapsedSteps` / `isStickyStep` / `earlierStepsCount`） | `:2187-2197`、`:2545-2570` |
| `resolveToolDisplayType` 分派 | `:1514-1526` |
| ToolResultRenderer 的 24 个 `v-if` 分支 | `ToolResultRenderer.vue:1-60` |
| 审批卡三态（interactive / inline / 已解决） | `ToolApprovalCard.vue:2-95`、`AskUserCard.vue:2-79`、`SecureFormCard.vue:2-75` |
| dock 的卡片类型与翻页/折叠 | `PendingPromptDock.vue:1-46` |
| dock 的可见集合算法 | `composables/usePromptDock.ts:10-64` |
| 记忆行 | `ChatMemoryStep.vue:1-40` |
| 进度披露 | `ProgressUpdates.vue:1-28` |
| 子任务行 / tab 条 | `CollaborationTasks.vue:1-13`、`ChildAgentTabBar.vue:1-29` |
| 后台任务胶囊 | `BackgroundWorkChip.vue:1-33` |
| 产物面板（范围/搜索/预览/四动作） | `ChatArtifactsPanel.vue:1-210` |
| 右栏 tab 定义与宽度夹取 | `composables/useChatSandboxPanel.ts:3,15-34,52-84` |
| 参考来源抽屉宽度与 source 视图 | `composables/useChatReferencesDrawer.ts:17,27-48` |
| 顶栏菜单四项 | `components/ChatHeader.vue:74-92` |
| 问题刻度条 | `components/chat/ChatQuestionMinimap.vue:1-59` |
| 追问建议四事件 | `components/chat/FollowUpSuggestions.vue:1-45` |

### 9.4 composer
| 事实 | 位置 |
|---|---|
| props/emits 全量 | `components/Input-field.vue:650-733`（props）、`:2276`（emits）、页面绑定 `index.vue:183-201` |
| 队列 / 图片 / chips | `Input-field.vue:2994-3055` |
| control-bar 左组（Agent…思考强度） | `:3062-3324` |
| control-bar 右组（停止/发送） | `:3365-3393` |
| Agent 选择器接线 | `:3082`、`components/AgentSelector.vue:1-180` |
| @ 五组定义 | `components/MentionSelector.vue:365-370` |
| @ 键盘导航 | `Input-field.vue:2666-2700` |
| 提交语义 | `utils/chatSubmitShortcut.ts:1-13` |
| steer 快捷键文案（⌘/Alt+Enter） | `Input-field.vue:2656` |
| 思考等级集合 | `utils/reasoningEffort.ts:13-27` |
| 粘贴图片 / 拖拽文件 | `Input-field.vue:2720-2745` |
| 语音热键全局监听 | `:2158-2159` |

### 9.5 Agent 页与助手
| 事实 | 位置 |
|---|---|
| Agent 列表筛选条与 scope | `views/agent/AgentList.vue:38-40`、`:836` |
| 五个分组头 | `:71-156` |
| 卡片信息（星/菜单/描述/徽标/来源/内置） | `:157-290` |
| 共享详情抽屉 | `:659-717` |
| 五类空态 | `:574-616` |
| 编辑器壳与分组导航 | `views/agent/AgentEditorModal.vue:3-8`、`:2909-2938` |
| 编辑器默认值 | `:2934-2975` |
| 创建会话页结构与跳转 | `views/creatChat/creatChat.vue:1-60`、`:268-293` |
| 助手挂载点 | `views/platform/index.vue:9-11` |
| 助手 store（key/宽度/布局/entry） | `stores/assistant.ts:108-147` |
| 页面上下文桥与 pageAccess | `components/assistant/AssistantPageBridge.vue:15-44` |
| 助手面板结构 | `components/assistant/AssistantPanel.vue:5-151` |
| 助手侧栏入口 | `components/menu.vue:11,85` |
| chat 页发布助手上下文 | `views/chat/index.vue:486-492` |

### 9.6 状态与规则纯函数
| 事实 | 位置 |
|---|---|
| fork 规则（流式中拒绝、user/assistant 语义） | `views/chat/forkPoint.ts:1-48` |
| rewind 规则（outgoing work 阻断、本地截断、冲突码） | `views/chat/rewindView.ts:6-69` |
| stream 错误处理与持久化失败 | `composables/useChatStreamHandler.ts:1347-1416`、`:1642-1647` |
| 滚动跟随（阅读态不抢滚动） | `composables/useChatScrollFollow.ts:18-46` |
| 无「赞踩」API | `grep -rn "thumbs|vote|feedback" api/` 无结果 |
| 无「编辑重发」 | `grep -rn "editMessage|resend" views/chat components/chat` 无结果 |
| 小程序页面（textarea + 按钮） | `miniprogram/pages/chat/chat.wxml:1-16`、`miniprogram/app.json:2-4` |

---

## 附：复刻时最容易搞错的点（提示，不是结论）

1. `.chat` 的面板让位是 **padding-right 挤压**，不是 `position:fixed` 覆盖；`<960px` 才变成覆盖。
2. 审批的「真值」是消息事件流里的 `pending_id`，dock 与 inline 都从它派生——不要另建一份审批 store，否则两处状态会漂。
3. `composer` 是**滚动区的兄弟节点**，高度靠 ResizeObserver 写进 `--chat-composer-height`；把它塞进滚动区会让「回到底部」和「历史加载不跳」全部失效。
