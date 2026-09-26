# AI 竞品调研：Google Tasks / Google Calendar + Gemini、Any.do、Amazing Marvin、Routine

- **调研日期**：2026-09-25
- **覆盖范围**：产品现状至 2026 年，重点 2024–2026 更新
- **工具说明**：`web_search` 工具损坏（Tavily HTTP 432），未使用。检索经 `anysearch` CLI（search + extract）完成，配额耗尽后改用 `web_fetch`。
- **证据规则**：每条事实后紧跟 `[来源: URL]`。凡经实际检索仍无法确认者，一律写 `未找到公开信息`，不做推测性补全。
- **来源分级**：本文区分 **一方来源**（厂商自己的站点 / 帮助中心 / 官方博客）与 **三方来源**（媒体、评测站、商店页面、社区）。三方来源在文中显式标注。Reddit 在本次调研中**被反爬拦截**（HTTP 403），因此凡引用 Reddit 之处均为**检索结果摘要**而非正文抓取，已逐条标注。

---

## 0. 一页速览

| 维度 | Google Tasks / Calendar + Gemini | Any.do | Amazing Marvin | Routine |
|---|---|---|---|---|
| 是否已上 AI | ✅ 是，且是平台级（Gemini） | ✅ 是（Voice Mode / AI 建议 / Plan My Day） | ❌ 否，无内置 AI | ✅ 是，AI 是其 2026 主线 |
| AI 交互形态 | 聊天助手 + 建议 + 语音 + 会议自动记录 | 语音 + 建议 + 聊天（ChatGPT GPT） | 无 | 聊天助手 + 语音 + 自动执行（agents/automations） |
| AI 自动排程 | ❌ 无。只有"建议时段"（Gmail Help me schedule）+ 手动 time blocking | ❌ 明确不做"精巧的 AI 排程引擎" | ❌ 无。只有规则式 auto-schedule 策略 | ❌ 未找到具名 AI 自动排程功能（time blocking 为手动拖拽） |
| 定价（个人） | Tasks 免费；Gemini 走 Workspace / Google AI 订阅 | Premium $4.99/mo（年付）· $7.99/mo（月付） | $8/mo（年付 $96/年）· 无免费档 | Personal $5/mo · Professional $10/mo（年付） |
| 模型厂商 | Google Gemini（一方明确） | ChatGPT/OpenAI（一方明确，但仅指 ChatGPT 集成） | N/A | 未披露 |
| 云 / 端侧 | 云 | 云 | N/A | 云（含离线模式） |
| 最强口碑 | 与 Gmail/Calendar 的零摩擦集成、免费 | 界面干净易用 | 可定制性最强（100+ strategies） | 一站式、快、可定制 |
| 最大抱怨 | 被长期忽视、功能基础、无共享列表 | 团队/项目能力弱 | 学习曲线陡、移动端薄 | 移动端落后于桌面（官方自认） |

---

## 1. Google Tasks / Google Calendar + Gemini

### 1.1 AI 功能（精确名称与状态）

**平台级品牌："Gemini in Google Workspace"** — 一方定价页把 Gemini 能力直接列为各档套餐内容：Starter 含 "Gemini AI assistant in Gmail"；Standard 含 "Gemini AI assistant in Gmail, Docs, Meet, and more" 与 "Gemini Notebook with expanded access to features" `[来源: https://workspace.google.com/pricing]`。**状态：已上线（shipped）**，且已下探到最低档 Starter。

**Gemini 应用 ↔ Google Tasks 的连接**（这是"Gemini 读 Tasks"的确切形态）：
- 一方产品页 FAQ 原文："The Gemini app can access Workspace apps like Google Tasks to help you manage your day. Ask the Gemini app to add, edit, and show your tasks and reminders from Google Tasks. You can even take a picture of a handwritten note in the Gemini app, and Gemini will help to log it in Google Tasks." `[来源: https://workspace.google.com/products/tasks/]` **状态：已上线。**
- 帮助中心《Capture your tasks & reminders with Gemini Apps》给出确切前置条件与能力边界：需登录 Gemini 应用、需开启 Keep Activity、**且必须把 Google Workspace 连接到 Gemini Apps**；可用 `@Google Tasks` 显式指定目标；支持 add / show / update（改期、改名、标记完成、删除）；也支持 Samsung Reminder `[来源: https://support.google.com/gemini/answer/15230285?hl=en&co=GENIE.Platform%3DDesktop]` **状态：已上线。**

**"Help me schedule"** — Gemini 驱动的会议时间协调：
- 一方公告原文：Gmail with Gemini 会在你于邮件中协调时间时**浮现一个 "Help me schedule" 按钮**；点击后 Gemini **自动建议理想时段**（依据 Google Calendar 与邮件上下文，例如"下周 30 分钟会议"）；可增删候选时段后直接插入邮件；对方选定后**自动为双方创建 Calendar 邀请**。`[来源: https://workspaceupdates.googleblog.com/2025/10/help-me-schedule-meeting-gmail-calendar.html]`
- **状态：2025-10-14 发布（Rapid Release 标签）** `[来源: https://workspaceupdates.googleblog.com/2025/10/help-me-schedule-meeting-gmail-calendar.html]`。Google 官方博客同日同步 `[来源: https://blog.google/products-and-platforms/products/workspace/help-me-schedule-gmail-gemini/]`。

**Gemini side panel in Google Calendar** — 一方未找到 2025-03 的原始公告页（猜测的 `workspaceupdates` URL 返回 404）。三方媒体记载：2025-03-07 Google 为 Calendar 加入 Gemini 侧栏，可对话式查看日程、创建事件、查询事件详情 `[来源: https://techcrunch.com/2025/03/07/google-adds-a-gemini-panel-to-calendar-to-help-you-manage-your-schedule/]` `[来源: https://9to5google.com/2025/03/07/google-calendar-gemini-side-panel/]`。**状态：2025-03 已上线（三方来源）。** 另有一方记录显示 Gemini 侧栏在 2025-03-18 起支持四种新增语言 `[来源: https://workspaceupdates.googleblog.com/2025/03/four-additional-languages-supported-in-gemini-side-panel.html]`。

**"Take notes for me"（Google Meet，别名 "Take notes with Gemini"）**：
- 一方帮助中心 `[来源: https://support.google.com/meet/answer/14754931?hl=en&co=GENIE.Platform%3DDesktop]`；一方方案页："Ask Gemini to 'Take notes for me' and Gemini analyzes the conversation and extracts major talking points, including suggested next steps" `[来源: https://workspace.google.com/solutions/ai/ai-note-taking/]`
- **2026-08-13 扩展到线下（in-person）会议** `[来源: https://workspaceupdates.googleblog.com/2026/08/take-notes-with-me-for-in-person-meetings-is-now-available.html]`。**状态：已上线，且 2026 年仍在扩展。**

**"Add to calendar"（Gmail 移动端）** — Gemini 自动侦测邮件中的日历相关内容并浮现 "Add to calendar" 按钮，2025-08 上线 `[来源: https://workspaceupdates.googleblog.com/2025/08/add-events-gmail-calendar-gemini-mobile.html]`。

**Gemini Apps 创建/管理 Calendar 事件** `[来源: https://support.google.com/gemini/answer/15305236?hl=en&co=GENIE.Platform%3DAndroid]`

**Keep reminders → Tasks 迁移**（影响 Tasks 的输入面）：2024-04-25 宣布"未来一年内 Keep reminders 将自动保存为 Google Tasks" `[来源: https://blog.google/products-and-platforms/products/workspace/google-keep-reminders-tasks-update/]`；**2025-10-14 实际落地**："Keep reminders will be automatically saved to Tasks"，用户可在 Calendar 与 Tasks 中查看 `[来源: https://workspaceupdates.googleblog.com/2025/10/google-keep-reminders-now-saved-to-tasks.html]`；一方帮助中心确认"2025 年下半年迁移" `[来源: https://support.google.com/calendar/answer/16540694?hl=en]`。**状态：已上线（2025-10-14）。**

> **未找到公开信息**：Google 一方从未把上述任何功能命名为"Gemini 自动排程"或"AI 任务排程"。检索到的 Gemini 侧栏/Help me schedule 均为**建议**与**创建**，不是自动排入空闲时段。

### 1.2 交互形态

四种并存：
1. **聊天助手** — Gemini 应用（gemini.google.com）与 Workspace 侧栏 `[来源: https://workspace.google.com/products/tasks/]` `[来源: https://techcrunch.com/2025/03/07/google-adds-a-gemini-panel-to-calendar-to-help-you-manage-your-schedule/]`
2. **建议（suggestion）** — Help me schedule 给出候选时段，由人挑选后才插入邮件 `[来源: https://workspaceupdates.googleblog.com/2025/10/help-me-schedule-meeting-gmail-calendar.html]`
3. **语音** — Gemini Live 可创建任务/提醒（帮助中心明确提示："If you created an action with Gemini Live on in the background, Gemini can't undo the action"）`[来源: https://support.google.com/gemini/answer/15230285?hl=en&co=GENIE.Platform%3DDesktop]`
4. **自动执行（仅会议场景）** — "Take notes for me" 在 Meet 中自动记录并抽取行动项 `[来源: https://workspace.google.com/solutions/ai/ai-note-taking/]`

对 **Tasks 本身**：Gemini 只做增删改查与"拍照转任务"，**不自动执行**——帮助中心说明可点 **Undo** 撤销，即动作需用户确认 `[来源: https://support.google.com/gemini/answer/15230285?hl=en&co=GENIE.Platform%3DDesktop]`。

### 1.3 自动排程

- **Tasks：没有 AI 自动排程。** 一方产品页把时间安排描述为手动动作："**Schedule time for your to-dos** — Block off time to work on a task directly from your calendar. You can also customize visibility and mute notifications or auto-decline meetings" `[来源: https://workspace.google.com/products/tasks/]`。这是**手动 time blocking**，非 AI。
- **Calendar：只有"建议时段"，不是自动排程。** Help me schedule 由人点按钮触发、人挑时段、人插入邮件 `[来源: https://workspaceupdates.googleblog.com/2025/10/help-me-schedule-meeting-gmail-calendar.html]`。
- **"Time insights"**：本次调研**未能在 Google 一方站点检索到 2026 年仍存在的 "Time insights" AI 排程功能**。→ **未找到公开信息**（不对其当前状态作任何断言）。

### 1.4 定价（精确数字，含日期）

**Google Workspace（年付，每用户/月，不含税）** — 检索到的页面状态（含明确档期）`[来源: https://workspace.google.com/pricing]`：

| 套餐 | 标准价 | 促销价（2026-10-09 – 2027-01-09，20% off，面向所有用户） |
|---|---|---|
| Business Starter | **$7.00** | $5.60 |
| Business Standard | **$14.00** | $11.20 |
| Business Plus | **$22.00** | $17.60 |

- 页面标注："Annual (Save 16% with 1 year commitment)"、"Price is per user/month and does not include tax"、14 天免费 `[来源: https://workspace.google.com/pricing]`
- 存储：Starter 30 GB pooled/人；Standard 2 TB；Plus 与 Enterprise Plus 5 TB `[来源: https://workspace.google.com/pricing]`
- **Gemini 已打包进所有档位**：Starter 即含 "Gemini AI assistant in Gmail"；Standard 起含 "Gemini AI assistant in Gmail, Docs, Meet, and more" `[来源: https://workspace.google.com/pricing]`
- ⚠️ 三方来源称 Workspace 涨价到 $8/$18/$28 `[来源: https://leadsmonky.com/google-workspace-price-hike-save-guide/]`，与官方页面当前显示的 $7/$14/$22 **冲突**。**以官方页面为准**；三方数字不采信。

**消费端 Google AI 订阅** — 一方页面列出三档名称与存储，但价格由前端渲染，抓取结果中**未含美元数字** `[来源: https://one.google.com/intl/en_us/about/google-ai-plans/]`：
- **Google AI Plus** — 400 GB 存储，"2x access to Gemini"
- **Google AI Pro** — 5 TB 存储，"4x access to Gemini"
- **Google AI Ultra** — 自 20 TB 起

价格（三方，2026-06-09）：**AI Plus $4.99/mo、AI Pro $19.99/mo、AI Ultra 自 $99.99/mo 起** `[来源: https://9to5google.com/2026/06/09/google-one-best-subscription-value-ai/]`。
Google I/O 2026（2026-05-19）一方博客称把顶档 AI Ultra 月费**从 $250 调降至 $200**，并提及 "Gemini Spark (AI Ultra $100 and $200; U.S. only)" `[来源: https://blog.google/products-and-platforms/products/google-one/google-ai-subscriptions/]`。→ **AI Ultra 的具体档位与价格在本次检索中存在冲突，未能从一方页面确证**；此处照录两个来源，不做取舍。

**改名事实（一方确证）**："Google AI Pro (previously called Google One AI Premium)" `[来源: https://gemini.google/release-notes/]`。→ **Google One AI Premium 已更名为 Google AI Pro**。**确切更名日期：未找到公开信息**（一方未给出日期；三方称 2026-04-11，来源质量低，不采信）。

**Google Tasks 本身**：**免费，无付费档**，包含在任意 Google 账号与 Workspace 套餐内 `[来源: https://tasksboard.com/blog/google-tasks-review]`（三方评测）。

### 1.5 模型厂商与云/端侧

- **厂商：Google Gemini**（一方，自研）。定价页直接以 "Gemini" 命名能力 `[来源: https://workspace.google.com/pricing]`；Gemini 应用发布说明记录模型演进至 Gemini 3.6 Flash（2026-07-21）与 Gemini 3.1 Pro `[来源: https://gemini.google/release-notes/]`。
- **云 vs 端侧：云。** 所有能力均描述为 Gemini 应用/服务端行为，并强调需登录、需开启 Keep Activity、需连接 Workspace `[来源: https://support.google.com/gemini/answer/15230285?hl=en&co=GENIE.Platform%3DDesktop]`。
- **Tasks 是否存在端侧模型：未找到公开信息。**

### 1.6 用户口碑

**最有价值的赞誉**
- 与 Gmail/Calendar 的集成被评为同类最佳：三方 2026 评测给出 **7.1/10**，其中 "Gmail / Calendar integration **10**"、"Ease of use **9**"、"Value for money **10**"；理由为"捕获摩擦几乎为零"（drag an email to Tasks）、跨设备同步可靠、界面干净快 `[来源: https://tasksboard.com/blog/google-tasks-review]`
- NYT Wirecutter 将其列为推荐，"Google Tasks pairs wonderfully with Google Calendar" `[来源: https://www.nytimes.com/wirecutter/reviews/best-to-do-list-app/]`
- Google Play：**4.6 星 / 约 607K 条评价** `[来源: https://play.google.com/store/apps/details?id=com.google.android.apps.tasks&hl=en_US]`

**最常见的抱怨（含"被忽视/基础"这一长期抱怨）**
- 三方评测量化了短板：**Collaboration 3/10**（无原生列表共享）、**Visual workflow 4/10**（仅列表，无看板）、**Power features 4/10**（无标签、筛选、优先级、模板）、**Reminders 6/10**（无位置提醒、无 snooze 堆栈）、子任务**仅一层**、备注为纯文本、无附件与自定义字段，且"**Easy to neglect**"——因为 Tasks 只是侧栏，列表会超出可视区域 `[来源: https://tasksboard.com/blog/google-tasks-review]`
- 长期"被忽视"抱怨（Reddit，**经检索摘要获取，正文被 403 拦截**）：
  - r/GoogleTasks《Why does Google refuse to improve Tasks?》摘要原文："Google Tasks is utterly underdeveloped. There are so many features they could add, but they haven't for years. * Tags could be added instead of lists…" `[来源: https://www.reddit.com/r/GoogleTasks/comments/1m8x1qd/why_does_google_refuse_to_improve_tasks/]`
  - r/GoogleTasks《Google Tasks drives me mad — here's a rough mockup of a fix》：摘要含 "Feels like sticky notes, not built for teams" `[来源: https://www.reddit.com/r/GoogleTasks/comments/1np9bow/google_tasks_drives_me_mad_heres_a_rough_mockup/]`
  - r/GoogleTasks《Have Google Tasks' flaws made you rely less on Google?》 `[来源: https://www.reddit.com/r/GoogleTasks/comments/1jiwmwl/have_google_tasks_flaws_made_you_rely_less_on/]`
  - r/GoogleTasks《Google Tasks improvements.》诉求含"rich text formatting"、"durations of the task like events" `[来源: https://www.reddit.com/r/GoogleTasks/comments/1mb60ze/google_tasks_improvements/]`
- 三方评测结论亦同调："It loses points on sharing, visual workflow, reminders flexibility, and power features" `[来源: https://tasksboard.com/blog/google-tasks-review]`；另一三方评测指出两大问题是"limited feature set"与"lack of collaborative features" `[来源: https://crm.org/news/google-tasks-review]`

**"Gemini 对 Tasks 的集成很薄"——这一判断有一方证据支撑**
- Gemini 对 Tasks 的能力面**仅限**：add / show / update（改期、改名、标完成、删除）+ 拍照转任务 `[来源: https://support.google.com/gemini/answer/15230285?hl=en&co=GENIE.Platform%3DDesktop]` `[来源: https://workspace.google.com/products/tasks/]`
- Gemini **不参与** Tasks 的规划、排序、优先级或排程——Tasks 侧的时间安排仍被描述为手动拖拽 blocking `[来源: https://workspace.google.com/products/tasks/]`
- 社区亦持此观感：r/GoogleTasks《Google Tasks + Gemini》摘要原文："Google seems to be constantly adding Gemini to their services but the obvious candidates are missing? Google Calendar + Google Tasks offer …" `[来源: https://www.reddit.com/r/GoogleTasks/comments/1jzz7qk/google_tasks_gemini/]`
- 与之对照，有评测认为 Gemini 的价值来自"读其他工具"（Docs/Keep/Sheets/Slides）而非 Tasks 本身 `[来源: https://www.xda-developers.com/thought-google-tasks-was-basic-then-paired-it-with-gemini/]`

---

## 2. Any.do

### 2.1 AI 功能（精确名称与状态）

**"Any.do Voice Mode: Capture Tasks Instantly with AI"** — 一方帮助中心，文档日期 **2026-04-27** `[来源: https://support.any.do/en/articles/14775167-any-do-voice-mode-capture-tasks-instantly-with-ai]`
- 机制（一方原文）："Voice Mode uses **AI-based natural language processing** to understand what you say and turn it into useful task details."
- 覆盖：创建任务与提醒、设置截止日期、brain dump、会话中编辑任务、多语言
- **限额（一方明确）**："limited to **20 sessions per day** (1 session = 1 launch/1 launch until muted)"
- 档位：**Free 不可用**；Premium / Family / Workspace **可用但"being gradually released"（渐进放量）**
- 平台：**iOS 渐进放量；Web/Desktop 渐进放量；Android "Coming soon to beta users"**
- **状态：已上线但处于渐进放量（gradual rollout），Android 未上线。**

**"Any.do AI"（AI suggestions）** — 一方帮助中心《Create Lists, Tasks, and Boards with Any.do AI》，文档日期 **2026-04-27** `[来源: https://support.any.do/en/articles/8637385-create-lists-tasks-and-boards-with-any-do-ai]`
确切子功能名：
- **AI suggestions for personal lists**
- **AI suggestions for subtasks**
- **Create a board with AI**（Workspace only）
- **AI suggestions inside board-tasks (checklists)**
- 一方定位原文："Any.do AI never replaces your planning. It simply gives you a helpful starting point that you can edit before saving."
- 档位：**Premium** = 个人列表与任务的 AI 建议；**Family** = Premium + boards 内 AI 建议；**Workspace** = boards 内 AI 建议 + Workspace 专属 AI board creation
- 平台：列表/任务建议 = Web/Desktop/iOS/Android；boards 内建议 = Web/Desktop/iOS；AI board creation = Web/Desktop
- **状态：已上线。**

**"Plan My Day"** — 一方博客称其为 Any.do 日程规划体验的"centerpiece"，每早提示你回顾任务列表与日历 `[来源: https://www.any.do/blog/the-best-ai-daily-planner-app-in-2026-why-any-do-stands-out/]`。一方帮助中心有 "My day" 入门文档（2025-09-16），描述为"accept Smart Suggestions"、手动加关键任务 `[来源: https://support.any.do/en/articles/8609724-getting-started-with-my-day]`。**状态：已上线。**

**ChatGPT 集成** — 一方博客 **2024-09-16**，宣称能力为 Natural Language Task Input、Smart Scheduling、Automated Prioritization、Contextual Reminders、Collaborative Features `[来源: https://www.any.do/blog/any-do-chatgpt-integration/]`。**状态：2024-09 宣布/上线（以 ChatGPT GPT 形式，链接指向 chatgpt.com/g/g-knLe7c9Zk-any-do）。**

### 2.2 交互形态

- **语音** — Voice Mode `[来源: https://support.any.do/en/articles/14775167-any-do-voice-mode-capture-tasks-instantly-with-ai]`
- **建议（suggestion）** — Any.do AI 的 "Suggest" → 用户 "Agree" 后才写入 `[来源: https://support.any.do/en/articles/8637385-create-lists-tasks-and-boards-with-any-do-ai]`
- **聊天助手** — 通过 ChatGPT 集成 `[来源: https://www.any.do/blog/any-do-chatgpt-integration/]`
- **无自动执行**：一方强调 AI "never replaces your planning"，产出需用户确认 `[来源: https://support.any.do/en/articles/8637385-create-lists-tasks-and-boards-with-any-do-ai]`

### 2.3 自动排程

**明确不做 AI 自动排程。** Any.do 一方 2026 年博客原文："Instead of building an **elaborate AI scheduling engine** that requires significant setup and ongoing maintenance, Any.do focuses on what human productivity research consistently shows works best: a simple daily planning ritual, paired with smart AI assistance that reduces friction rather than adding it." `[来源: https://www.any.do/blog/the-best-ai-daily-planner-app-in-2026-why-any-do-stands-out/]`

⚠️ 冲突提示：其 2024 年 ChatGPT 集成博客曾宣称 "**Smart Scheduling** — ChatGPT can suggest optimal times for your tasks based on your schedule" `[来源: https://www.any.do/blog/any-do-chatgpt-integration/]`。这是**通过 ChatGPT GPT 的"建议"**，且与 2026 年"不做 AI 排程引擎"的表态并存。**结论：Any.do 无自动排程；仅有建议式/对话式辅助。**

### 2.4 定价（精确数字）

一方定价页 `[来源: https://www.any.do/pricing]`（页面提供 Yearly / Monthly 切换）：

| 套餐 | 年付 | 月付 |
|---|---|---|
| **Personal（Free）** | **$0**，"Free Forever. No credit card." | — |
| **Premium** | **$4.99** /月（billed annually） | **$7.99** /月 |
| **Family**（含 4 名成员） | **$8.33** /月（billed annually） | **$9.99** /月 |
| **Teams** | **$4.99** /月 / member（billed annually） | **$7.99** /月 / member |

- Free 含：Tasks & lists、Reminders、Calendar、Daily planner、Sync across devices `[来源: https://www.any.do/pricing]`
- Premium 含：Everything in Personal + Recurring tasks、Whatsapp reminders、**AI-Powered features**、Color tags、Location reminders `[来源: https://www.any.do/pricing]`
- Teams 试用：14 天 `[来源: https://www.any.do/pricing]`
- 一方帮助中心（2026-08-16）确认四种套餐：Free / Premium / Family（最多 4 人）/ Workspace `[来源: https://support.any.do/en/articles/8635977-any-do-subscription-plans-explained-free-premium-family-and-workspace]`
- **关键：AI 功能在 Free 档不可用**（Voice Mode 一方明确 "Free: Not available"）`[来源: https://support.any.do/en/articles/14775167-any-do-voice-mode-capture-tasks-instantly-with-ai]`

### 2.5 模型厂商与云/端侧

- **厂商：OpenAI / ChatGPT** — 一方博客把集成对象明确写为 "ChatGPT ... developed by **OpenAI**"，并称 "Both Any.do and **OpenAI** employ robust security measures"，步骤要求"Sign In to Your OpenAI Account" `[来源: https://www.any.do/blog/any-do-chatgpt-integration/]`
- ⚠️ **边界**：这仅证明 **ChatGPT 集成** 由 OpenAI 驱动。**App 内 "Any.do AI" 建议与 Voice Mode 的 NLP 由谁提供，一方页面未披露** → **未找到公开信息**。
- **云 vs 端侧：云。** 一方称 "All data is encrypted in transit and at rest"，为服务端处理 `[来源: https://www.any.do/blog/any-do-chatgpt-integration/]`。端侧：未找到公开信息。

### 2.6 用户口碑

**赞誉**
- G2："Users consistently praise the clean interface and ease of use of Any.do, highlighting how it simplifies task management and enhances productivity. The ability to integrate with calendars and share tasks with others is also frequently mentioned as a valuable feature." `[来源: https://www.g2.com/products/any-do/reviews]`
- Capterra：1,119 条已验证评价 `[来源: https://www.capterra.com/p/173614/Any-do/reviews/]`
- App Store 评价（一方商店页）点名 "Plan My Day"："The 'Plan My Day' feature is so helpful. It requires me to re prioritize each task and resets the reminders. This is a huge time saver…" `[来源: https://apps.apple.com/us/app/any-do-to-do-list-planner/id497328576?see-all=reviews&platform=ipad]`
- 一方定价页展示 4.8 / 462,158 评分（App Store 口径）`[来源: https://www.any.do/pricing]`

**抱怨**
- 三方评测：Any.do "is great for small-scale and personal use. However, you'll need the paid Teams version when it comes to managing teams and projects long term. Even then, Any.do can't match up to the…" `[来源: https://www.cloudwards.net/any-do-review/]`
- 一方自认的 AI 限制（可视为体验短板）：Voice Mode **20 会话/日**上限、**Android 尚未上线**、付费档也仅"渐进放量" `[来源: https://support.any.do/en/articles/14775167-any-do-voice-mode-capture-tasks-instantly-with-ai]`
- **Reddit 口碑：未找到公开信息**（r/productivity、r/ProductivityApps 相关帖均被反爬拦截，无法取得正文）。

---

## 3. Amazing Marvin

### 3.1 AI 功能

**结论：截至本次检索，Amazing Marvin 没有任何已发布的 AI 功能。**

- 一方完整功能清单页（`/features/all/`）枚举 **49 features**，按 Planning / Organization 等分类（Day Planner、Week Planning、Calendar、Calendar Sync、Due Dates、Do Dates、Start/Defer Dates、Duration Estimates、Time Targets、Agenda/Timeline、Smart Lists…），**通篇无任何 AI 条目** `[来源: https://amazingmarvin.com/features/all/]`
- 一方定价页卖点是 "All 100+ amazing features"，**未提及 AI** `[来源: https://amazingmarvin.com/pricing/]`
- 一方博客首页（Productivity / Procrastination / Marvin How To / Dear Marvin 四个栏目）最新可见文章均为生产力心理学与习惯类，**无 AI 主题** `[来源: https://amazingmarvin.com/blog/]`
- 三方 2026 评测："It has **no built-in AI**. What Marvin calls 'strategies' are **rule-based toggles** you switch on and off yourself, not an assistant that plans your…" `[来源: https://www.saner.ai/blogs/amazing-marvin-review]`
- 三方 2026 对比："Amazing Marvin can suggest priorities and has smart scheduling rules, but it **doesn't use AI** to analyze your energy patterns and automatically…" `[来源: https://lifestack.ai/blog/amazing-marvin-alternative]`

⚠️ **重要同名陷阱（必须避免误采信）**：搜索 "Marvin AI" 会大量命中 **HeyMarvin（heymarvin.com）**——那是一个**用户研究/访谈平台**，其 "Ask AI"（`help.heymarvin.com/en/articles/10130400-how-do-i-use-ask-ai`）与 "AI moderated Interviewer"（`heymarvin.com/product/ai-moderated-interviewer`）**与 Amazing Marvin 完全无关**。本文不采用任何来自 heymarvin.com 的事实。

### 3.2 交互形态

**不适用（N/A）——无 AI。** 产品的"智能"来自用户自行开关的规则式 **strategies**，而非助手 `[来源: https://www.saner.ai/blogs/amazing-marvin-review]`。

### 3.3 自动排程

**有规则式自动排程，但不是 AI 驱动。**

- 一方帮助中心存在策略 **"Auto-schedule due Tasks"**（文档更新于 **2025-06-24**）：在策略设置里设定天数，把到期项自动安排进来 `[来源: http://help.amazingmarvin.com/en/articles/1950195-auto-schedule-due-tasks]`
- 一方路线图把 **"Smart autoscheduling"** 列在 **"Things that are coming up"**（即将到来，**未发布**）`[来源: https://community.amazingmarvin.com/roadmap]`。社区在 4 个月前仍在问其时间表 `[来源: https://www.reddit.com/r/amazingmarvin/comments/1t94fms/smart_autoscheduling/]`
- **Marvin 官方对"这算不算 AI"的立场**（r/amazingmarvin 讨论串，**经检索摘要获取，正文被 403 拦截**）："Auto scheduling (where Marvin makes a schedule for you) is another feature we are working on that some consider 'AI' but it is **still 'regular'**…" `[来源: https://www.reddit.com/r/amazingmarvin/comments/1d83yil/is_am_implementing_any_ai_feature_in_the_future/]`

**→ 明确回答：Amazing Marvin 没有 AI 排程。** 现有 auto-schedule 是规则式；"Smart autoscheduling" 仍在路线图未发布区。

### 3.4 定价（精确数字）

一方定价页 `[来源: https://amazingmarvin.com/pricing/]`：

- **Marvin Pro：$8/month，billed as $96/year**；"One plan. Everything included. No feature gates or upsells."
- **14-day free trial，无需信用卡**
- **无免费档**（FAQ 原文："Is there a free plan? **Not currently**, but if cost is a barrier, please reach out."）
- 含：All 100+ amazing features、Unlimited tasks & projects、Custom workflows & views、Analytics & insights、Web/Mac/Windows/iOS/Android、Personal email support
- 折扣：**Students get 50% off**；另有 "Pay what you can" 弹性方案
- 月付与年付可切换（FAQ："Can I switch between monthly and annual? Yes!"）`[来源: https://amazingmarvin.com/pricing/]`
- 月付价（三方，AppSumo 商品页）："It's **$8/month if paid yearly or $12/month if paid monthly**. There is also a **$300 lifetime account**." `[来源: https://appsumo.com/products/amazing-marvin/]`

**Lifetime（终身）档——必须精确表述：**
- **一方定价页当前不列出 lifetime 档** `[来源: https://amazingmarvin.com/pricing/]`
- 但**一方服务条款仍写**："Subscriptions are available on monthly, annual, or **lifetime** plans." `[来源: https://amazingmarvin.com/terms/]`
- 一方帮助中心确有 lifetime 相关条目，但**文档日期为 2019-10-24**，仅说明"从订阅转终身需付全价" `[来源: http://help.amazingmarvin.com/en/articles/2073120-if-i-have-a-subscription-plan-and-then-decide-to-buy-the-lifetime-deal-do-i-have-to-pay-the-full-price]`
- **停售公告（社区，经检索摘要获取）**：r/amazingmarvin《We are discontinuing our Lifetime Plan!》摘要原文："We are **discontinuing our lifetime membership offer**. But you can still get it **until November 15th**. Pay once and get all updates forever!" `[来源: https://www.reddit.com/r/amazingmarvin/comments/17f7d8g/we_are_discontinuing_our_lifetime_plan/]`（该帖约 2023 年 10 月发布，故 cutoff 为 **2023-11-15**）
- 三方 2026 复核："**No lifetime deal anymore** (there once was one for **$300**, but it's gone now). You're committed to a subscription." `[来源: https://toolguide.io/en/tool/amazing-marvin/]`

**→ 结论**：$300 终身档是**历史产品**；官方已于 2023 年宣布停售（cutoff 2023-11-15），当前官方定价页不提供。**当前是否仍可购买：未找到公开信息**（ToS 仍提及 lifetime，但定价页无入口，两者不一致）。本报告**不把 $300 作为当前可购价格**。

### 3.5 模型厂商与云/端侧

**不适用（N/A）——无 AI。** → **未找到公开信息**。

### 3.6 用户口碑

**赞誉**
- 可定制性被一致评为最强："Amazing Marvin is the most customizable to-do app we have tested, and the only one built explicitly for brains that fight back." `[来源: https://makerstack.co/reviews/amazing-marvin-review/]`
- "Amazing Marvin's **100+ toggleable 'strategies'** make it the deepest personal task manager we've tested" `[来源: https://www.saner.ai/blogs/amazing-marvin-review]`
- G2 有独立产品页 `[来源: https://www.g2.com/products/amazing-marvin/reviews]`

**抱怨**
- 学习曲线："multiple reviewers describe the first…"（配置成本高）`[来源: https://www.saner.ai/blogs/amazing-marvin-review]`
- **移动端薄（最常见抱怨）**："The desktop apps are the strongest and where Marvin shines; the **mobile apps are capable but noticeably thinner, which is the most common complaint we found in user reviews**." `[来源: https://makerstack.co/reviews/amazing-marvin-review/]`
- 无免费档、无协作 `[来源: https://www.saner.ai/blogs/amazing-marvin-review]`
- 选项过载（AppSumo 用户评价）："Now, Amazing Marvin is pleasant, but it also has **a lot** of options, and this **overwhelms** me." `[来源: https://appsumo.com/products/amazing-marvin/reviews/is-this-just-not-for-me-59325/]`
- 稳定性/维护速度（终身会员，社区，经检索摘要获取）："I became a lifetime member to support them… but since that time, I've found Marvin to be **buggy** as all…" `[来源: https://www.reddit.com/r/amazingmarvin/comments/1nhodp7/amazing_marvins_wasted_potential/]`

### 3.7 附加：Amazing Marvin 对 AI 的公开立场（引用）

**有，且可引用。** Marvin 团队在 r/amazingmarvin 官方回应帖《Is AM implementing any AI feature in the future?》中给出两点（**经检索摘要获取，Reddit 正文 403**）：

1. 对"AI"一词的怀疑：
   > "I want to mention that many **'AI' features in apps are not truly AI from a programming perspective**. This word is sometimes used to describe any feature where the program seems to showcase some form of intelligent assistance or automation."
   > `[来源: https://www.reddit.com/r/amazingmarvin/comments/1d83yil/is_am_implementing_any_ai_feature_in_the_future/]`

2. 把已有能力归为"非 AI"，并把排程归为常规功能：
   > "In that sense, there are some 'AI features' already, such as **'suggested task'**, where Marvin figures out which task makes most sense to do next…"
   > "Auto scheduling (where Marvin makes a schedule for you) is another feature we are working on that **some consider 'AI' but it is still 'regular'**…"
   > `[来源: https://www.reddit.com/r/amazingmarvin/comments/1d83yil/is_am_implementing_any_ai_feature_in_the_future/]`

**解读（谨慎）**：这是一份**怀疑 AI 标签、但未彻底否定 AI 方向**的立场——团队否认把规则式能力包装成 AI，同时承认在"排程"上继续投入。**Marvin 是否曾发布过明确的"我们不做 AI"政策声明：未找到公开信息**（一方博客与帮助中心均无此类文章）`[来源: https://amazingmarvin.com/blog/]`。

---

## 4. Routine

### 4.1 Routine 是否仍在运营？——**是，仍在运营，且在活跃发版**

**判定：ALIVE。** 证据（均为本次实际检索）：

| 证据 | 内容 | 来源 |
|---|---|---|
| 官网在线 | "All your work in one place, powered by AI"；"Watch our **Routine 2.0** film"；"Loved by **100k+** ambitious professionals and teams worldwide" | `[来源: https://routine.co/]` |
| **最新发版（决定性）** | Changelog 条目日期 **September 8th, 2026** — "**Routine 2.3** is mostly about improving the mobile experience." | `[来源: https://feedback.routine.co/changelog]` |
| 定价页在线 | 5 档完整定价（Free / Personal / Professional / Business / Enterprise） | `[来源: https://routine.co/pricing]` |
| YC 公司页 | "Founded in **2020** by **Quentin Hocquet and Julien Quintard**, Routine has **6 employees** based in **Paris, France**." | `[来源: https://www.ycombinator.com/companies/routine]` |
| 融资记录（三方） | "Routine has raised a total funding of **$2.82M over 2 rounds**. Its latest funding round was a **Seed round on 2021**." | `[来源: https://tracxn.com/d/companies/routine/__BA49KAsbb-1Yt5ESM7LxqiQhyV1A2qFUapgahQBC2Zk]` |
| 官方支持门户在线 | feedback.routine.co（changelog + help center） | `[来源: https://feedback.routine.co/changelog]` |

**无停运、无收购公告** → **未找到公开信息**（检索"shutdown / acquired / notice"仅得到无关的通用运维模板页，不构成任何证据）。

**域名核实（重要）**：
- **正确域名是 `routine.co`**（生产力/工作任务操作系统）`[来源: https://routine.co/]`
- **`routine.com` 不是这家公司** —— 它是一个**街头服饰品牌**："Routine is a **streetwear brand** inspired by baseball… **Turnstyle Brands, LLC**" `[来源: https://routine.com/pages/contact-us]`；该域名由 **Pro Athlete 于 2020-11 收购** `[来源: https://jamesnames.com/2020/11/pro-athlete-acquires-routine-com-upgrades-from-routinebaseball-com/]`
- Trustpilot 页面标题本身就带消歧："**Routine (not the hair company) Reviews**" `[来源: https://www.trustpilot.com/review/routine.co]`
- ⚠️ 另有大量同名产品（Routine Planner/Habit Tracker 移动 App、Routine 护发品牌 routinecos.com、yourroutine.com），**均非 routine.co**，本文不采用其数据。

### 4.2 Q1 — AI 功能（精确名称）

一方官网与定价页给出的确切功能名 `[来源: https://routine.co/]` `[来源: https://routine.co/pricing]`：

- **AI assistant** — 定价页 Free 档即含 `[来源: https://routine.co/pricing]`
- **AI voice assistant**（官网）/ **AI voice commands**（定价页）— 官网："Delegate remembering or organizing through voice, in particular when you are on the go." `[来源: https://routine.co/]`
- **AI meeting notes** — 官网："Summarize meetings and **automatically turn action items into tasks** to ensure nothing falls through the cracks. **Works on all platforms, without any meeting bot!**" `[来源: https://routine.co/]`
- **AI agents** — 官网："Add specialized AI agents to your workforce"；定价页列在 Professional 档 `[来源: https://routine.co/]` `[来源: https://routine.co/pricing]`
- **AI automations** — 官网："automate complex processes and focus on taking key decisions"；定价页列在 Professional 档 `[来源: https://routine.co/]` `[来源: https://routine.co/pricing]`
- **AI credits**（计量单位）— Free **250**、Personal **500**、Professional **7,000**、Business **10,000/seat** `[来源: https://routine.co/pricing]`
- 相关非 AI 功能：**Quick capture**、**Contextual capture**（Professional）、**Universal inbox**、**Time blocking**、**Planner**、**Recurrences**、**Databases**、**Views** `[来源: https://routine.co/]` `[来源: https://routine.co/pricing]`

**AI Assistant 的形态描述（一方 changelog）**："The AI Assistant brings a **ChatGPT- or Claude-like experience** directly inside Routine. Ask any question, research the web, or let it **operate Routine on your**…" `[来源: https://feedback.routine.co/changelog]`

**2026-09-08 的语音重建（Routine 2.3，一方）** `[来源: https://feedback.routine.co/changelog]`：
- "Routine's voice has been **rebuilt from the ground up**"
- 遵循用户在 Web/desktop 设置里的偏好
- **能通过集成执行动作**（例：发到 Slack 频道），且"**staging each action as a card for you to approve**"
- 能口述写入第三方可写表（例：Notion 数据库）
- 能回答问题（例："Who won the FIFA world cup in 2026?"）
- 缺信息时会**主动追问**

**状态标签**：AI assistant / AI voice / AI meeting notes / AI agents / AI automations 均标注为**已上线（shipped）**——它们直接出现在在线定价页的套餐权益中 `[来源: https://routine.co/pricing]`，且 2026-09-08 changelog 记录其持续迭代 `[来源: https://feedback.routine.co/changelog]`。

### 4.3 Q2 — 交互形态

四种全占，是四个产品中最"重 AI"的：
- **聊天助手** — AI assistant，可"operate Routine" `[来源: https://feedback.routine.co/changelog]`
- **语音** — 重建后的 voice assistant，可执行集成动作、口述写表、追问 `[来源: https://feedback.routine.co/changelog]`
- **自动执行** — AI automations + AI agents `[来源: https://routine.co/]`；语音动作虽可执行，但一方明确**先暂存为卡片待你批准**（human-in-the-loop）`[来源: https://feedback.routine.co/changelog]`
- **建议** — 语音/助手在动作前给出可批准卡片 `[来源: https://feedback.routine.co/changelog]`

### 4.4 Q3 — 自动排程

- **Time blocking 是手动拖拽**：一方定价页原文 "Drag your tasks in your calendar to block time." `[来源: https://routine.co/pricing]`
- 另有 **Time boxing**、**Planner**、**Event coloring** `[来源: https://routine.co/pricing]`
- **AI agents / AI automations** 原则上可自动化流程 `[来源: https://routine.co/]`，但**本次检索未找到任何具名的"AI 自动排程 / 自动把任务排入空闲时段"功能** → **未找到公开信息**
- **结论：Routine 未见 AI 自动排程；排程以手动 time blocking 为主。**

### 4.5 Q4 — 定价（精确数字）

一方定价页 `[来源: https://routine.co/pricing]`（页面显示年付折扣百分比，故 $5/$10/$15 为**折后年付价**）：

| 套餐 | 价格 | 关键权益（AI 相关） |
|---|---|---|
| **Free** | **Free** forever | Tasks/calendars/notes、**AI assistant**、**AI voice commands**、Offline mode、3 integrations、3 custom databases、**250 AI credits** |
| **Personal** | **$5 / month**（页面示 38% off） | + Time blocking、Time boxing、Event coloring、Exporting、Unlimited file uploads、10 integrations、10 custom databases、**500 AI credits** |
| **Professional** | **$10 / month**（页面示 17% off） | + **AI meeting notes**、**AI agents**、**AI automations**、Menu bar widget、Time tracking、Contextual capture、Unlimited integrations、Unlimited custom databases、**7,000 AI credits** |
| **Business** | **$15 / seat / month**（页面示 17% off） | + Organization、Workspaces、Access control、Versioning、Consolidated billing、Priority support、**10,000 AI credits/seat** |
| **Enterprise** | Contact us | + Unlimited history、Compliance、Audit logs、Analytics、User provisioning、Success manager |

- 页面有 "cancel anytime" 与 "Compare your stack" 计算器（宣称 50 人公司年省 $98k）`[来源: https://routine.co/pricing]`
- 平台：macOS / Windows / Linux / iOS / Android / Web 全部提供下载 `[来源: https://routine.co/]`
- **注意**：Free 档即含 AI assistant 与 AI voice commands（但 AI credits 仅 250），这是与 Any.do（Free 完全无 AI）和 Marvin（无 AI）的显著差异 `[来源: https://routine.co/pricing]`

### 4.6 Q5 — 模型厂商与云/端侧

- **模型厂商：未披露。** 一方 `routine.co`、`/pricing`、`feedback.routine.co/changelog` 均**未指明** LLM 供应商 `[来源: https://routine.co/]` `[来源: https://routine.co/pricing]` `[来源: https://feedback.routine.co/changelog]`
- ⚠️ changelog 中的 "**ChatGPT- or Claude-like experience**" 是**体验类比**（描述 UI 形态），**不是厂商声明**，不可解读为使用 OpenAI 或 Anthropic `[来源: https://feedback.routine.co/changelog]`
- → **模型厂商：未找到公开信息**
- **云 vs 端侧：云。** 一方提供跨 6 平台 + Web 的同步工作区，同时列出 **Offline mode**（离线模式）为 Free 档权益 `[来源: https://routine.co/pricing]`——即**云为主、带离线缓存**。**端侧模型：未找到公开信息。**

### 4.7 Q6 — 用户口碑

**赞誉**
- Product Hunt：**4.8 / 27 reviews** — "Reviewers largely see Routine as a strong daily planning hub that brings calendar, tasks, and notes into one workflow. They praise the clean design…" `[来源: https://www.producthunt.com/products/routine]`
- 官网客户证言（一方，需打折看待）：多来自 Todoist / Akiflow / Notion / ClickUp / Asana 迁移者，强调"替换了多个专用工具"、"设置没花几小时"、"AI features have changed the game" `[来源: https://routine.co/]`
- 有第三方评测称其免费档"surprisingly generous" `[来源: https://www.youtube.com/watch?v=PacwbSmkrT4]`（视频，未能抓取正文）

**抱怨**
- **官方自认移动端落后（最有力的一条）**："Routine 2.3 is mostly about improving the mobile experience. **The mobile apps are lagging behind but we are now committed to focusing on stability and bringing mobile to par with desktop.**" `[来源: https://feedback.routine.co/changelog]`
- Trustpilot：**3.8 / 仅 2 条评价**——样本量过小，不具统计意义，但可作为"公开评价稀少"的信号 `[来源: https://www.trustpilot.com/review/routine.co]`
- 三方评测站存在但多为 SEO 内容农场（ellieplanner.com、efficient.app、smbguide.com），**本文不采信其数字**，仅记录其存在
- **Reddit / G2 口碑：未找到公开信息**（Reddit 反爬 403；G2 未取得 Routine 页面正文）

---

## 5. 对 heyta 的决策含义（简短）

1. **"AI 排程"在四个竞品里其实都没有真正落地。** Google 只有建议式 Help me schedule；Any.do 一方明确拒绝做排程引擎；Marvin 的 Smart autoscheduling 仍在路线图未发布区；Routine 的 time blocking 是手动拖拽。→ **AI 自动排程目前是空白位**，但也是最容易被"看起来很强"地宣传的位。
2. **Gemini 对 Tasks 的集成确实薄**——能力面就是增删改查 + 拍照转任务，不涉及规划/排序/排程 `[来源: https://support.google.com/gemini/answer/15230285?hl=en&co=GENIE.Platform%3DDesktop]`。这既是竞品弱点，也说明"AI 读任务"本身不足以构成护城河。
3. **定价锚点**：个人向年付区间落在 **$5–$10/月**（Any.do $4.99、Routine Personal $5、Marvin $8）；团队向 **$4.99–$15/席位/月**。Marvin 的 **$300 终身档已停售**（2023-11-15 cutoff），"终身买断"在 2026 年已不是可对标的现价。
4. **免费档的 AI 策略分化明显**：Routine 免费档就给 AI assistant（250 credits）；Any.do 免费档完全不给 AI；Marvin 无免费档。→ 免费档是否给 AI，是一个可主动选择的定位点。
5. **四个产品的 AI 都跑在云上。** 端侧模型在四家中**均未找到公开信息**——如果 heyta 的"本地优先 + E2EE"要落到 AI 上，这是一个尚未被竞品占据的叙事位。

---

## 6. 未能验证的项（诚实清单）

- Google Workspace 是否有**月付**（非年付）确切价格 — 抓取到的页面状态为 Annual 视图 `[来源: https://workspace.google.com/pricing]`
- Google **AI Ultra** 的确切档位数与价格（一方页面价格未渲染；9to5Google 称自 $99.99 起，blog.google 称从 $250 降至 $200，两者冲突）`[来源: https://9to5google.com/2026/06/09/google-one-best-subscription-value-ai/]` `[来源: https://blog.google/products-and-platforms/products/google-one/google-ai-subscriptions/]`
- **Google One AI Premium → Google AI Pro 的确切更名日期**（一方仅确认改名事实，未给日期）`[来源: https://gemini.google/release-notes/]`
- **Google Calendar "Time insights" 的 2026 年现状** — 未找到一方页面
- **Any.do** App 内 AI 建议 / Voice Mode NLP 的**模型供应商** — 一方未披露
- **Routine** 的**模型供应商** — 一方未披露
- **Reddit 口碑正文**（r/GoogleTasks、r/amazingmarvin、r/ProductivityApps）— 全部被 HTTP 403 拦截，仅取得检索摘要
- **G2 上 Routine 的评价正文** — 未取得
- **Any.do 在 Reddit 的口碑** — 未取得
- **Amazing Marvin 是否曾发布正式"不做 AI"政策** — 未找到

---

## 7. 来源清单（按产品）

**Google**
- https://workspace.google.com/products/tasks/
- https://workspace.google.com/pricing
- https://support.google.com/gemini/answer/15230285?hl=en&co=GENIE.Platform%3DDesktop
- https://support.google.com/gemini/answer/15305236?hl=en&co=GENIE.Platform%3DAndroid
- https://workspaceupdates.googleblog.com/2025/10/help-me-schedule-meeting-gmail-calendar.html
- https://workspaceupdates.googleblog.com/2025/08/add-events-gmail-calendar-gemini-mobile.html
- https://workspaceupdates.googleblog.com/2025/10/google-keep-reminders-now-saved-to-tasks.html
- https://workspaceupdates.googleblog.com/2026/08/take-notes-with-me-for-in-person-meetings-is-now-available.html
- https://workspaceupdates.googleblog.com/2025/03/four-additional-languages-supported-in-gemini-side-panel.html
- https://blog.google/products-and-platforms/products/workspace/help-me-schedule-gmail-gemini/
- https://blog.google/products-and-platforms/products/workspace/google-keep-reminders-tasks-update/
- https://blog.google/products-and-platforms/products/google-one/google-ai-subscriptions/
- https://one.google.com/intl/en_us/about/google-ai-plans/
- https://gemini.google/release-notes/
- https://support.google.com/meet/answer/14754931?hl=en&co=GENIE.Platform%3DDesktop
- https://workspace.google.com/solutions/ai/ai-note-taking/
- https://support.google.com/calendar/answer/16540694?hl=en
- https://techcrunch.com/2025/03/07/google-adds-a-gemini-panel-to-calendar-to-help-you-manage-your-schedule/
- https://9to5google.com/2025/03/07/google-calendar-gemini-side-panel/
- https://9to5google.com/2025/10/14/google-keep-tasks-reminders-rolling-out/
- https://9to5google.com/2026/06/09/google-one-best-subscription-value-ai/
- https://tasksboard.com/blog/google-tasks-review
- https://crm.org/news/google-tasks-review
- https://www.nytimes.com/wirecutter/reviews/best-to-do-list-app/
- https://play.google.com/store/apps/details?id=com.google.android.apps.tasks&hl=en_US
- https://www.reddit.com/r/GoogleTasks/comments/1m8x1qd/why_does_google_refuse_to_improve_tasks/
- https://www.reddit.com/r/GoogleTasks/comments/1jzz7qk/google_tasks_gemini/
- https://www.reddit.com/r/GoogleTasks/comments/1np9bow/google_tasks_drives_me_mad_heres_a_rough_mockup/
- https://www.reddit.com/r/GoogleTasks/comments/1mb60ze/google_tasks_improvements/
- https://www.reddit.com/r/GoogleTasks/comments/1jiwmwl/have_google_tasks_flaws_made_you_rely_less_on/
- https://www.xda-developers.com/thought-google-tasks-was-basic-then-paired-it-with-gemini/

**Any.do**
- https://www.any.do/pricing
- https://support.any.do/en/articles/14775167-any-do-voice-mode-capture-tasks-instantly-with-ai
- https://support.any.do/en/articles/8637385-create-lists-tasks-and-boards-with-any-do-ai
- https://support.any.do/en/articles/8635977-any-do-subscription-plans-explained-free-premium-family-and-workspace
- https://support.any.do/en/articles/8609724-getting-started-with-my-day
- https://www.any.do/blog/the-best-ai-daily-planner-app-in-2026-why-any-do-stands-out/
- https://www.any.do/blog/any-do-chatgpt-integration/
- https://www.g2.com/products/any-do/reviews
- https://www.capterra.com/p/173614/Any-do/reviews/
- https://www.cloudwards.net/any-do-review/
- https://apps.apple.com/us/app/any-do-to-do-list-planner/id497328576?see-all=reviews&platform=ipad
- https://zapier.com/blog/anydo-features/

**Amazing Marvin**
- https://amazingmarvin.com/pricing/
- https://amazingmarvin.com/terms/
- https://amazingmarvin.com/features/all/
- https://amazingmarvin.com/blog/
- https://community.amazingmarvin.com/roadmap
- http://help.amazingmarvin.com/en/articles/1950195-auto-schedule-due-tasks
- http://help.amazingmarvin.com/en/articles/2073120-if-i-have-a-subscription-plan-and-then-decide-to-buy-the-lifetime-deal-do-i-have-to-pay-the-full-price
- https://appsumo.com/products/amazing-marvin/
- https://appsumo.com/products/amazing-marvin/reviews/is-this-just-not-for-me-59325/
- https://www.saner.ai/blogs/amazing-marvin-review
- https://makerstack.co/reviews/amazing-marvin-review/
- https://toolguide.io/en/tool/amazing-marvin/
- https://lifestack.ai/blog/amazing-marvin-alternative
- https://www.g2.com/products/amazing-marvin/reviews
- https://www.reddit.com/r/amazingmarvin/comments/1d83yil/is_am_implementing_any_ai_feature_in_the_future/
- https://www.reddit.com/r/amazingmarvin/comments/17f7d8g/we_are_discontinuing_our_lifetime_plan/
- https://www.reddit.com/r/amazingmarvin/comments/1nhodp7/amazing_marvins_wasted_potential/
- https://www.reddit.com/r/amazingmarvin/comments/1t94fms/smart_autoscheduling/

**Routine**
- https://routine.co/
- https://routine.co/pricing
- https://feedback.routine.co/changelog
- https://www.ycombinator.com/companies/routine
- https://tracxn.com/d/companies/routine/__BA49KAsbb-1Yt5ESM7LxqiQhyV1A2qFUapgahQBC2Zk
- https://www.producthunt.com/products/routine
- https://www.trustpilot.com/review/routine.co
- https://routine.com/pages/contact-us
- https://jamesnames.com/2020/11/pro-athlete-acquires-routine-com-upgrades-from-routinebaseball-com/
