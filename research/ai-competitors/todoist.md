# Todoist (Doist) — AI 竞品深度调研

- **调研日期（所有"当前状态"与价格的观察日）：2026-09-25**
- **覆盖范围：产品现状至 2026 年，重点 2024–2026 更新**
- **方法论：仅使用实际取回的页面。第一方优先（todoist.com/help、/pricing、doist.com/privacy、trustcenter.doist.com），第三方用于情绪与旁证（TechCrunch、XDA、Product Hunt、G2、Trustpilot 搜索摘要）。**
- **工具说明：`web_search`（Tavily）本次不可用；anysearch CLI 在调研中途用尽当日配额。后半程改用 `web_fetch` / `curl` 直接取页面。任何无法取回的页面都在文中显式标注。**

---

## 0. 一句话结论

Todoist 的 AI 是**"捕获端 AI"**，不是"调度端 AI"。2024–2026 年它把全部力气压在**把混乱输入变成结构化任务**（Ramble 语音、Task Capture 图文/文件、Email Assist、Filter Assist），并另起一个独立产品 **Todoist Automations（Beta）**做"用自然语言写工作流"。**它至今没有自动排程器** —— 排程仍是手动的 time-blocking，第三方（Reclaim / Morgen / Trevor）在官方集成目录里替它做自动排程。AI 全部**云端**处理，**无端上推理**。

---

## 1. AI 功能 —— 确切名称与各自做什么

### 1.1 品牌层：`Todoist Assist`（总称）

> "Todoist Assist is the name for our growing suite of AI-powered features designed to work behind the scenes to enhance your Todoist experience."
> [来源: https://www.todoist.com/todoist-assist]

> "Todoist Assist is our AI-powered suite of tools designed to work intelligently behind the scenes to enhance your productivity."
> [来源: https://www.todoist.com/help/todoist/todoist-and-ai/introduction-to-todoist-assist-KgPP22q5O]

官方产品页把 Assist 拆成 4 个具名能力 [来源: https://www.todoist.com/todoist-assist]：

| 名称 | 官方一句话描述 |
|---|---|
| **Ramble** | "lets you add tasks by speaking. Just talk and it turns your words into structured tasks, complete with any details you mention." |
| **Task Assist** | "generates task and sub-task suggestions, breaks down complex work, and helps you get unstuck when progress stalls." |
| **Email Assist** | "instantly turns your forwarded emails into organized tasks, extracting all the important details" |
| **Filter Assist** | "creates powerful filters using plain language." |

### 1.2 `Ramble` —— 语音转任务（旗舰功能，已 GA）

**状态与日期：**
- **Beta（Experimental）：2025-11-19** — "Capture tasks at the speed of thought - Ramble (Beta)" [来源: https://www.todoist.com/help/todoist/product-updates/capture-tasks-at-the-speed-of-thought-ramble-beta-nov-19-2025-r6701hY0t]
- **公开发布（shipped / GA）：2026-01-21** — "Turn your scattered thoughts into clear tasks - Ramble: Jan 21, 2026" [来源: https://www.todoist.com/help/todoist/product-updates/turn-your-scattered-thoughts-into-clear-tasks-ramble-jan-21-2026-HhmP8ue8R]
- **Wear OS 版：Beta，2026-03-23** — "Just talk to your wrist – Ramble on Wear OS (Beta)" [来源: https://www.todoist.com/help/todoist/product-updates/just-talk-to-your-wrist-ramble-on-wear-os-beta-mar-23-2026-Kskv3T9JF]

**它做什么（第一方）：**
- 实时转写并**边说边生成任务**，不是说完再处理：*"Ramble captures your tasks in real-time as you talk, not after you finish. It's a quick capture tool rather than a conversational assistant"* [来源: https://www.todoist.com/help/todoist/todoist-and-ai/dictate-to-add-tasks-with-ramble-P1Raq7vVF]
- 支持在说话过程中纠错：说 "Actually, I meant…" 改任务，"Remove that" 删任务，说 "that's all" 结束 [来源: 同上]
- 语言数：**40+ 种**（官方帮助文档）[来源: 同上]；TechCrunch 发布时写 **38 种** [来源: https://techcrunch.com/2026/01/21/todoists-app-now-lets-you-add-tasks-to-your-to-do-list-by-speaking-to-its-ai/]。官方 `/ramble` FAQ 亦写 40 种 [来源: https://www.todoist.com/ramble]。**注意 38 vs 40+ 的口径差异，官方文档更新更晚。**
- 可提取的属性（支持）：task name、description、date and time、project、section、priority、label、deadline（付费功能）、duration（付费功能）
  不可提取：**sub-task、custom reminder、urgent reminder**
  [来源: https://www.todoist.com/help/todoist/todoist-and-ai/dictate-to-add-tasks-with-ramble-P1Raq7vVF]
- 免费版**只取 name / date / priority**（Wear OS beta 限制）+ 免费版说 deadline/duration 会被忽略 [来源: 同上]
- 明确不是对话式助手：*"Ramble isn't optimized for assistance requests such as 'Can you plan my trip to Japan?'"* [来源: 同上]
- **离线不可用**：*"Ramble only works with an internet connection."* [来源: 同上]
- **浏览器扩展不支持 Ramble**（麦克风权限限制）[来源: 同上]
- **无法关闭 Ramble**：*"There's currently no option to turn off or disable Ramble"* [来源: 同上]

**发布时披露的采用数据（Doist 自述，经 TechCrunch）：** 发布前在约 15 万 Experimental 用户中测试，前 3 周约 7.6 万测试者跑了约 29 万次 Ramble 会话；任务创建成功率从 2025 年 10 月的约 40% 升到 12 月的约 62%；入门计划新用户升级率约为使用 Ramble 前的 5 倍 [来源: https://techcrunch.com/2026/01/21/todoists-app-now-lets-you-add-tasks-to-your-to-do-list-by-speaking-to-its-ai/]。XDA 独立复述了同一组数字 [来源: https://www.xda-developers.com/todoist-ramble/]。

### 1.3 `Task Assist` —— 浏览器扩展（不是聊天助手）

**形态：扩展（extension）**，不是内嵌聊天。**仅 Web / 桌面可用，iOS 与 Android 不支持。**
> "The Task Assist extension isn't available on Todoist for iOS or Android."
> [来源: https://www.todoist.com/help/todoist/todoist-and-ai/use-the-task-assist-extension-with-todoist-ZgldtcPeT]

四个具体动作 [来源: 同上]：
1. **Suggest tasks** —— 输入一个目标，生成任务清单，逐条勾选后 Add
2. **Give tips for completing task** —— 为已有任务生成"下一步可执行动作"，可 "Add as comment"
3. **Make task more actionable** —— 重写任务名
4. **Break task down** —— 拆成子任务列表，可取消勾选不需要的，再 Add sub-tasks

**默认不启用**，需手动安装：Settings → Integrations → Browse → Task Assist → Add → Confirm [来源: 同上]。

### 1.4 `Email Assist` —— 转发邮件转任务

- 把转发到项目专属邮箱的邮件内容（due dates、notes、action items）转成任务 [来源: https://www.todoist.com/help/todoist/todoist-and-ai/introduction-to-todoist-assist-KgPP22q5O]
- 入口：Settings → General → **Advanced** 区打开；然后项目内 三点菜单 → **"Email tasks to this project"** → Copy email → 转发邮件到该地址 [来源: 同上]
- **它是 Todoist Assist 中唯一可以开关的功能**：*"Email Assist is the only Todoist Assist feature that you can turn on or off for your account."* [来源: 同上；亦见 https://www.todoist.com/todoist-assist]

### 1.5 `Filter Assist` —— 自然语言生成 filter 查询

- 用自然语言描述要看什么任务，自动生成 Todoist filter 语法 [来源: https://www.todoist.com/help/todoist/features/introduction-to-filters-V98wIH]
- **仅支持英语和西班牙语**：*"Filter Assist is currently only available in English and Spanish."* [来源: https://www.todoist.com/help/todoist/todoist-and-ai/introduction-to-todoist-assist-KgPP22q5O]
- 入口：Filters & Labels → Filters 旁的 add icon → 顶部 **Filter Assist banner** 里的 "Try it" → 在 Filter request 字段描述 → Send → Add filter [来源: https://www.todoist.com/help/todoist/features/introduction-to-filters-V98wIH]
- **这是唯一对免费用户开放的 Assist 能力**（见 §4）
- 2023 年的 changelog 里就已经在修 Filter Assist 的预览 bug，说明它 2023 年即存在 [来源: https://www.todoist.com/help/todoist/product-updates/changelog-entries-from-2023-xGqFeBr0m]
- 2026 年 changelog 记录过一次**线上故障与恢复**：*"Witold restored Filter Assist, which had stopped generating filters from natural language descriptions; it's now back"*（Web/桌面）以及 Android 侧 *"Prateek also brought Filter Assist back to life – it's working again after a brief hiatus."* [来源: https://www.todoist.com/help/todoist/product-updates/2026-changelog-HD3jJAtLd]

### 1.6 `Task Capture` / `Task Capture Assist` —— 文本/图片/文件 → 任务（Beta）

这是 2026 年 Todoist 第二条 AI 主线，经历了三代实验形态：

| 阶段 | 日期 | 状态 | 能力与入口 |
|---|---|---|---|
| 第一代：Capture tasks from text and images | 页面标注 "February 5"，**页面未显示年份** | experimental，仅限**付费 Experimentalists**，web/desktop v9747+ | Quick Add 里新增 **text / image 图标**（在 Ramble 图标旁），粘贴文本或上传图片 → 预览 [来源: https://www.todoist.com/help/todoist/product-updates/capture-tasks-from-text-and-images-february-5-0W88IbvvW] |
| 第二代：Task Capture (Beta) | **2026-04-21** | Beta，公开 | "Scan notes, photos, and files for tasks"；图片（白板照片、手写笔记、打印文档，JPEG/PNG/WebP ≤10MB）、文件（PDF、Markdown、纯文本）[来源: https://www.todoist.com/help/todoist/product-updates/scan-notes-photos-and-files-for-tasks-task-capture-beta-apr-21-2026-S5GOh7A0e] |
| 第三代：Task Capture Assist（合并流程 + 指令 + 复核） | 页面标注 "September 2"，版本号 web v11357+ / iOS v26.8.21+ / Android v12260+ | experimental，**付费 Experimentalists** | Quick Add → **+（More actions）→ Extract tasks…**；可"文件 + 指令"组合，例如 *"Only pull out the action items assigned to me"*；**确认前不写入任何数据** [来源: https://www.todoist.com/help/todoist/product-updates/tell-todoist-exactly-what-to-pull-from-your-notes-september-2-LGHUDJ26u] |

> 关于 "February 5" 与 "September 2" 的年份：两页均**未在页面正文写出年份**。September 2 一页给出的版本号（web v11357 / iOS 26.8.21 / Android v12260）低于 2026-09-03 changelog 的（web v11422 / iOS 26.8.26 / Android v12266），故可判定为 **2026-09-02**。February 5 一页正文引用 "the Ramble icon"，而 Ramble beta 始于 2025-11-19，故不早于 2026 年 —— **这是推断，不是页面明示**。

**当前（2026-09-25）的官方状态与规格** [来源: https://www.todoist.com/help/todoist/todoist-and-ai/capture-tasks-from-text-images-and-documents-cAflh0WKe]：
- 状态原文：*"Task Capture Assist is in beta: available to everyone without opting in, but it may still change."*
- 文本输入：**单次最多 25,000 字符**
- 图片：JPEG / PNG / WebP，**≤10MB 且 ≤4000×4000px**
- 文档：PDF / MD / TXT，**≤10MB，一次一个文件**
- 支持提取：task name、description、date and time、project、priority、section、label、deadline、duration、**assignee**
- 不支持提取：sub-task、custom reminder
- **明确不处理"信息型"输入**：*"URLs, receipts, and objects normally produce no tasks, because they show information rather than ask you to do something."*（需配合指令才行）

### 1.7 `Todoist Automations`（Beta）—— 自然语言写工作流

**这是一个独立产品**（独立域名 `automations.todoist.com`、独立帮助中心 `/help/automations`、独立侧边栏）。

**状态：Beta。** 官方页面原文：*"Todoist Automations is still in beta. Expect a few quirks."* [来源: https://www.todoist.com/automations]

**公布时间：2026-04-01**（Todoist 官方 newsletter）：
> "Yes, we know it's April 1st. No, this isn't a prank. … **Todoist Automations** lets you describe what you want to automate in plain language with zero complicated setup, and it just… builds and does it. … **500+ people have already tried the Automations alpha.**"
> [来源: https://todoist.substack.com/p/april-triage]

**它做什么** [来源: https://www.todoist.com/help/automations/get-started/create-a-todoist-automation-VqMgUKhug]：
- **对话式搭建**：在 Automation chat 里用自然语言描述（例："Every morning, reschedule my overdue tasks to today"），AI 生成 **Automation preview**，可继续用对话调整，确认后自动上线
- **模板**：从 Templates 侧边栏按 app（Todoist / Gmail / GitHub）浏览，两种模式 —— `Install now`（一键装上并启用）或 `Set up in chat`
- **Connections 模型**：每个 app 有两种连接类型 —— *Connection for actions*（执行动作，如建任务/发消息）与 *Connection for updates*（监听变化，如新邮件/新日程）
- **管理**：All Automations 页面，可按 All / Enabled / Disabled 过滤；可开关、按需运行、改、复制、修连接、看 run history、删除
- 官方给的样例工作流：逾期任务每天午夜改到今天、Gmail 加星 → 建任务、收据 → Google Sheet、Notion 日期 → Calendar + Slack、每周重排 inbox 优先级、退订 30 天未打开的营销邮件、表格行 → Canva 海报
  [来源: https://www.todoist.com/automations]
- 官方强调连接是 *"a single secure handshake per tool"*，且 *"Each automation runs as a predictable, pre-defined workflow you can count on, every time."* [来源: https://www.todoist.com/automations]

### 1.8 `Quick Add` 的自然语言解析（**不是** AI 品牌功能）

Todoist 的经典 NLP 早于生成式 AI，官方叫 **smart Quick Add / smart date recognition**：
> "The smart Quick Add will automatically recognize the date, highlight it, and add it when you save the task. Use natural language to describe almost any date – a simple *tomorrow at 4 pm* to a super specific recurring date like *every 3rd Tuesday starting Aug 29 ending in 6 months*. Dates can go up to 150 characters long."
> [来源: https://www.todoist.com/help/todoist/features/schedule-a-date-and-time-for-your-todoist-tasks-q7VobO]

- 可**整体关闭**：官方有专门文章 "Turn smart date recognition on or off" [来源: https://www.todoist.com/help/todoist/features/turn-smart-date-recognition-on-or-off-63WfIr]
- 误识别可**逐词取消高亮** [来源: https://www.todoist.com/help/todoist/features/schedule-a-date-and-time-for-your-todoist-tasks-q7VobO]
- 局限：**捷克语和土耳其语的日期不支持**；scheduler 的 Time 字段**不识别军用时间**（`1300` 需写 `13:00`）[来源: 同上]
- 第三方评测把它当核心卖点：G2 2026-08-24 评论称 *"Zero-Friction Entry is exceptional, allowing tasks like 'Review monthly budget every 1st at 9am #Finance p1' to immediately schedule a recurring event, categorize it into a project, and set top priority without clicking any menus."* [来源: https://www.g2.com/products/todoist/reviews]

### 1.9 `AI Assistant`（2023 旧名）→ 现为 `Task Assist`

2023-02-16 的第三方记录称 Todoist 发布了 "AI-Assistant extension"，能力为"suggest tasks to do in order to accomplish a certain goal, give you tips on how to complete complex tasks, break large tasks down into smaller tasks" [来源: https://www.stiernholm.com/en/blog/todoist-releases-ai-assistant]。

这与今天 `Task Assist` 扩展的四项能力中的三项**逐项对应** [来源: https://www.todoist.com/help/todoist/todoist-and-ai/use-the-task-assist-extension-with-todoist-ZgldtcPeT]。**结论（推断，非官方明示）**：2023 年的 "AI Assistant" 就是今天 Task Assist 扩展的前身/旧名；"AI Assistant" 这个名字已不出现在 2026 年的任何第一方页面中。

**未找到公开信息**：Todoist 第一方从未发布的 2023 年 "AI Assistant" 原始公告页（todoist.com 域名下）——本次调研未取回。

### 1.10 官方"AI connections"（把 Todoist 接进别人的 AI）

不是 Todoist 自己的 AI，但属 2026 年的 AI 版图，帮助中心有独立分类 [来源: https://www.todoist.com/help/todoist/todoist-and-ai]：
- Use Todoist in Claude / Claude Code / ChatGPT / Codex / Gemini Spark
- Connect Todoist to an AI assistant

---

## 2. 交互形态 —— 聊天？自动执行？建议？行内补全？

**答案：四种形态并存，但没有任何一种是"通用聊天助手"。**

| 形态 | 功能 | 入口（UI 位置） |
|---|---|---|
| **实时语音捕获**（非聊天） | Ramble | ① Quick Add 里的**波形图标**；② 侧边栏波形图标；③ 桌面 macOS 菜单栏图标 / Windows+Linux 托盘图标；④ 快捷键 `⇧ Shift + Q`（应用内）；⑤ **全局**快捷键 macOS `⌥ ⇧ R` / Windows `⇧ Alt ⇧ R`（可在 Settings > Desktop 改）；⑥ iOS 主屏/锁屏 widget、iOS Control、Action Button；⑦ iOS Shortcuts + Siri（"Hey Siri, open Ramble"）；⑧ Android 主屏 widget、quick settings tile；⑨ Wear OS 手表上的 Ramble 按钮；⑩ 2026-09-17 changelog：Android 主屏 widget 新增 Ramble 快捷键 [来源: https://www.todoist.com/help/todoist/todoist-and-ai/dictate-to-add-tasks-with-ramble-P1Raq7vVF] [来源: https://www.todoist.com/help/todoist/product-updates/2026-changelog-HD3jJAtLd] |
| **模态建议 / 生成**（生成后人工确认） | Task Assist 扩展的 4 个动作 | ① 项目内 三点菜单 → "Suggest tasks with Task Assist"；② 任务视图 三点菜单 → Task Assist → "Give tips for completing task" / "Make task more actionable" / "Break task down"。全部有 `Try again` 与 `Cancel`，且**必须点 Add / Rewrite task / Add sub-tasks / Add as comment 才落地** [来源: https://www.todoist.com/help/todoist/todoist-and-ai/use-the-task-assist-extension-with-todoist-ZgldtcPeT] |
| **行内生成 + 人工确认**（最接近"行内补全"） | Filter Assist | Filters & Labels → add icon → Filter Assist banner 的 "Try it" → 输入框 → Send → **Add filter** [来源: https://www.todoist.com/help/todoist/features/introduction-to-filters-V98wIH] |
| **后台自动执行** | Email Assist（收到转发邮件即自动转任务）、Todoist Automations（按日程/触发器后台跑） | Email Assist 需先在 Settings > General > Advanced 打开；Automations 有独立 app 与 Automation chat [来源: https://www.todoist.com/help/todoist/todoist-and-ai/introduction-to-todoist-assist-KgPP22q5O] [来源: https://www.todoist.com/help/automations/get-started/create-a-todoist-automation-VqMgUKhug] |
| **文件/文本提取 + 预览复核** | Task Capture Assist | Quick Add → **+**（More actions）→ **Extract tasks…** → 粘贴/上传 → 预览可编辑 → **Add task(s)**。原文：*"Nothing is added to Todoist until you confirm."* [来源: https://www.todoist.com/help/todoist/todoist-and-ai/capture-tasks-from-text-images-and-documents-cAflh0WKe] |

**关键否定结论：**
- **没有通用聊天助手界面。** Ramble 帮助文档明确：*"It's a quick capture tool rather than a conversational assistant."* [来源: https://www.todoist.com/help/todoist/todoist-and-ai/dictate-to-add-tasks-with-ramble-P1Raq7vVF]
- **唯一有"chat"UI 的地方是 Todoist Automations 的 Automation chat**（用来搭建/修改自动化，不是日常问答）[来源: https://www.todoist.com/help/automations/get-started/create-a-todoist-automation-VqMgUKhug]
- **没有"每日/每周 AI 摘要"这类功能。** 在 2026 年 product-updates 索引、2026 changelog、Todoist & AI 帮助中心分类中均**未找到** AI 生成的日/周回顾或摘要功能。官方 `Project Insights`（2025-10-27）与 Teams 的 insights 是**统计可视化**，不是 AI 摘要 [来源: https://www.todoist.com/help/todoist/product-updates] [来源: https://www.todoist.com/help/todoist/todoist-and-ai]
  - 注：Automations 的模板生态里能**自己搭**"每天早上把当天会议摘要发我邮箱"这类自动化 [来源: https://www.todoist.com/automations]，但那是用户自定义工作流，不是内置 AI 摘要功能。

---

## 3. 自动排程？—— **没有。明确没有。**

### 3.1 当前状态：无内置自动排程器

- Todoist 的排程是**手动 time-blocking**：给任务加 date + time + duration，然后在 calendar layout 里拖拽。
  > "Plan and time-block tasks with ease in Todoist. To start time-blocking, add a date, time, and duration to your task."
  > [来源: https://www.todoist.com/help/todoist/get-started/time-blocking-in-todoist-d6Pf1uTpc]
- 用户在官方建议里被明确引导去用**第三方 AI 排程器**：Todoist 的集成目录里挂着 **Reclaim.ai**（*"Use AI scheduling at Reclaim to automatically defend time for your Todoist tasks in Google Calendar or Outlook Calendar"*）[来源: https://www.todoist.com/integrations/apps/reclaim]。另有 Morgen、Trevor AI 等第三方（均为非第一方页面）[来源: https://www.trevorai.com/integrations/todoist] [来源: https://www.morgen.so/google-calendar-todoist-integration]
- 用户侧明确把"AI 排程器"当作**缺失功能**在提：Product Hunt 上一条 2026 年的评论写 *"The logical next step for their Todoist Assist feature would be to roll out an AI scheduler which automatically schedules your highest priority tasks into your calendar."* [来源: https://www.producthunt.com/products/todoist/reviews]

### 3.2 历史：`Smart Schedule`（2016 发布，**已 discontinued**）

- **announced / shipped：2016-11-16** — MacStories: *"Smart Schedule is a complementary scheduling feature that works with overdue tasks and tasks that haven't been scheduled yet."* 且当时就有接受/拒绝/修改机制：*"Every task analyzed by Smart Schedule is given a suggested due date and time; you can always accept, reject, or update Smart Schedule's [suggestion]"* [来源: https://www.macstories.net/news/todoist-launches-smart-schedule-an-ai-based-feature-to-reschedule-overdue-tasks/]
- Fast Company 同期报道：*"Todoist's new 'Smart Schedule' feature automatically suggests due dates based on users' habits, workloads, and the nature of the job."* [来源: https://www.fastcompany.com/3065714/todoists-ai-task-scheduler-could-help-you-procrastinate-less/]
- **discontinued**：r/todoist 存在明确讨论帖 *"A plugin or substitute for the discontinued Smart Schedule?"*，发帖人自述 *"I've been using Todoist since 2017 and I remember the Smart Schedule feature which was discontinued."* [来源: https://www.reddit.com/r/todoist/comments/1izqjad/a_plugin_or_substitute_for_the_discontinued_smart/]
  - **诚实标注**：该帖正文本次**未能取回**（Reddit 返回人机验证页），仅取回搜索摘要。**Todoist 第一方从未发布的"Smart Schedule 下线公告"= 未找到公开信息。**

### 3.3 唯一沾到"自动改期"的现役能力：Automations（Beta，规则式，非 AI 优化）

官方头号示例自动化就是逾期改期，但它是**用户写死的规则**，不是 AI 求解排程：
> "Every night at midnight, it finds all your overdue Todoist tasks and reschedules them to today — so you always wake up to a clean, up-to-date task list."
> Run conditions: "Runs every day at 00:00"
> [来源: https://www.todoist.com/automations]

### 3.4 用户控制权（明确可查的部分）

| 维度 | 现状 | 依据 |
|---|---|---|
| 日期/时间/时长 | **100% 手动**，无任何自动写入 | [来源: https://www.todoist.com/help/todoist/features/schedule-a-date-and-time-for-your-todoist-tasks-q7VobO] |
| lock / pin（锁定不被自动移动） | **不存在**，因为根本没有自动移动 | 未找到公开信息（Todoist 帮助中心无 lock/pin 排程概念） |
| override / drag back（拖回） | 支持：calendar layout 里直接拖拽改期；changelog 明确修过拖拽落点 *"dragging a task to a new day in Today or Upcoming sometimes dropped it in the wrong spot; it now drops exactly where you release it"* | [来源: https://www.todoist.com/help/todoist/product-updates/2026-changelog-HD3jJAtLd] |
| Automations 的自动化 | 可**禁用/启用**、**Run now**（不等日程）、**改**、**删**、看 run history；余额不足时 run 变 **Skipped**（不是失败），并有 **Paused until you top up** 横幅 | [来源: https://www.todoist.com/help/automations/get-started/create-a-todoist-automation-VqMgUKhug] [来源: https://www.todoist.com/help/automations/get-started/manage-your-todoist-automations-compute-and-usage-XgozgXrGS] |

> **对 heyta 的启示**：Todoist 把"AI"用在**捕获**而非**调度**，把"自动改期"降级为**用户可写规则**而非 AI 决策 —— 这恰好绕开了"自动排程会静默改掉用户意图"这个最难的产品问题。这是一个可借鉴的取舍。

---

## 4. 定价 —— 确切数字（**观察日 2026-09-25**）

### 4.1 订阅档位（USD）

| 档位 | 月付 | 年付 | 折合月 | 试用 |
|---|---|---|---|---|
| **Beginner** | **$0** | — | — | 不适用 |
| **Pro** | **$7 / 月** | **$60 / 年** | **$5 / 月**（按年计） | **7 天免费试用** |
| **Business** | **$10 / user / 月** | **$8 / user / 月**（即 **$96 / user / 年**） | — | **14 天免费试用** |

来源（第一方，两处互相印证）：
- [来源: https://www.todoist.com/help/account-and-billing/plans/todoist-plans-pricing-and-billing-faq-Vq2z0HWL6] —— 原文："**Price** Free | $7/month or $60/year | $10/user/month or $8/user/month billed yearly"；"How much does Todoist Pro cost? - $7/month, or - $60/year ($5/month billed yearly)"；"How much does Todoist Business cost? - $10/user/month, or - $8/user/month billed yearly ($96/user/year)"
- [来源: https://www.todoist.com/pricing] —— 页面文案："Beginner US$0"；"Pro US$5 per user/month $60 billed yearly"；"Business US$8 per user/month, $96 billed yearly"（注：`/pricing` 页面的 $5/$8 是**年付折合价**，月付价 $7/$10 只在 FAQ 与 billing cycle 切换后显示。第三方站点常把这两组数字混写。）

**Business 额外说明**：`plus local tax` [来源: https://www.todoist.com/pricing]

### 4.2 2025-12-10 涨价（重要的定价史）

> "Starting **December 10, 2025**, the **Todoist Pro plan** costs: Monthly **$5 USD → $7 USD per month**; Yearly **$4 USD/month ($48/year) → $5 USD/month ($60/year)**"
> [来源: https://www.todoist.com/help/account-and-billing/plans/todoist-pro-pricing-update-in-2025-bxBvHZuJZ]

同页给出完整货币表（USD $7/$60、EUR €7/€60、GBP £7/£60、JPY ¥894/¥8064、AUD A$12/A$108、CAD C$10/C$84、DKK kr60/kr540、SEK kr90/kr840、NOK kr90/kr840、PLN zł24/zł228、CHF CHF7/CHF60、CZK Kč132/Kč1,268、INR ₹330/₹3,165），并说明巴西、墨西哥、印度、土耳其、波兰、南非、日本、捷克有**本地化定价** [来源: 同上]

同页给出涨价的官方理由，**明确把 AI 列为投入方向**：
> "We're also working on features such as **Ramble**, which lets you capture tasks using your voice, and continuing to explore new ways to help automate your daily work. This price update helps us keep investing in Todoist sustainably"
> [来源: 同上]

**App Store 例外（重要）**：通过 App Store 订阅的用户**不会自动涨价**，留在 "Pro Legacy plan" 原价：
> "**App Store:** Due to App Store policies, your subscription price will not automatically increase. You will remain on what will be called the 'Pro Legacy plan' at your current price."
> 判定条件：*"You have been continuously subscribed to the Pro plan since before June 2022. Or, you subscribed to the Pro plan via the App Store, regardless of your original subscription date or price."*
> [来源: 同上]

Business 涨价另有专页（`todoist-business-plan-pricing-update-dF5in65YM`），本次未取回正文，**具体 Business 涨价生效日 = 未找到公开信息**（FAQ 引用了该页 [来源: https://www.todoist.com/help/account-and-billing/plans/todoist-plans-pricing-and-billing-faq-Vq2z0HWL6]）。

### 4.3 AI 是**包含在订阅里**，还是**单独卖**？—— 两者都有

**(a) Todoist Assist 系（Ramble / Task Assist / Email Assist / Filter Assist / Task Capture）：包含在订阅内，不单独收费。**

官方 FAQ 的 "AI features" 对照表（第一方，观察日 2026-09-25）：

| 功能 | Beginner | Pro | Business |
|---|---|---|---|
| **Ramble（voice-to-tasks）** | **Up to 10 sessions per month** | **Unlimited**（rate limits may apply） | **Unlimited**（rate limits may apply） |
| **Todoist Assist（busywork automations）** | ❌ | ✅ | ✅ |
| **Email Assist（forward emails to create tasks）** | ❌ | ✅ | ✅ |
| **Capture tasks from text, images, and documents** | ❌ | ✅ | ✅ |

[来源: https://www.todoist.com/help/account-and-billing/plans/todoist-plans-pricing-and-billing-faq-Vq2z0HWL6]

`/pricing` 的 Todoist Assist 区块另列 **Filter Assist** 三档**全绿**（Beginner / Pro / Business 都 ✅）[来源: https://www.todoist.com/pricing]。

**免费版 AI 用量上限（确切）**：
> "Folks on the free or Beginner plan (as well as those on the Pro Legacy plan) can use Ramble with **up to 10 sessions per month, which reset automatically on the 1st of each month (UTC)**. Each dictation counts as one session, even if you decide not to add the tasks to Todoist. … Your monthly Ramble count is **shared across all devices**. Whether you use Ramble on the web, desktop, mobile, or Wear OS, every session adds to the same total for your Todoist account."
> [来源: https://www.todoist.com/help/todoist/todoist-and-ai/dictate-to-add-tasks-with-ramble-P1Raq7vVF]

**Pro Legacy 的特殊限制（容易被忽略的坑）**：
> "**Pro Legacy subscribers** have access to **Filter Assist only**."
> [来源: https://www.todoist.com/help/todoist/todoist-and-ai/introduction-to-todoist-assist-KgPP22q5O]
> 且 Pro Legacy 的 Ramble 只有 10 sessions/month [来源: https://www.todoist.com/help/todoist/todoist-and-ai/dictate-to-add-tasks-with-ramble-P1Raq7vVF]

**(b) Todoist Automations：独立计费 —— 不是包月费，而是"compute 充值"。**

> "Automations use compute you buy, **instead of a fixed monthly fee**. This powers the parts of Automations that use AI models."
> [来源: https://www.todoist.com/help/automations/get-started/manage-your-todoist-automations-compute-and-usage-XgozgXrGS]

- 充值档位：**$5 / $10 / $20**，或自定义金额，**最低 $5**；适用销售税在结账时加 [来源: 同上]
- 官方给的档位估算：**$5** ≈ 轻度使用、几次 chat 会话 + 持续运行的自动化；**$10** ≈ 通常够 4–5 个每日运行的自动化；**$20** ≈ 够 10–15 个持续运行的自动化 [来源: 同上]
- **必须有活跃的 Pro 计划**：*"Automations is billed alongside your Todoist subscription, so topping up needs an active Pro plan. If you're on the Beginner plan, the Top up page will show **An active Pro plan is required**"* [来源: 同上]
- 余额性质（重要限制）：*"Your balance is for running Todoist Automations. It can't be applied to anything else, including your Todoist subscription. **It isn't money, has no cash value, and can't be refunded or transferred.**"* [来源: 同上]
- 用量分两类计量：**Messages**（创建/编辑/询问自动化的 chat 消息）与 **Automation runs**（按日程或触发器运行、且用到 AI 的那些）[来源: 同上]
- 余额不足时：run 被 **Skipped**（中性徽章，**不算失败**），自动化显示 **Paused until you top up**，充值后可点 **Run now** [来源: 同上]

> ⚠️ **需要纠正的一个流传说法**：YouTube 上有视频标题称 "Todoist's New **$10 Automations**"、描述为 "it costs ten dollars a month on top of your existing Todoist subscription" [来源: https://www.youtube.com/watch?v=i02n4YQpLaQ]。**第一方文档不支持"$10/月固定加购"这个说法** —— 官方是 compute 按量充值，$10 只是三个预设充值档之一。以第一方为准。

**(c) 其余免费版限额（非 AI，但影响"免费能用多少"）** [来源: https://www.todoist.com/help/account-and-billing/plans/todoist-plans-pricing-and-billing-faq-Vq2z0HWL6]：
- 活跃个人项目：Beginner **5** / Pro **300** / Business 每成员 300
- 自定义 filter 视图：Beginner **3** / Pro **150** / Business 每成员 150
- 活动历史：Beginner **7 天** / Pro & Business **完整**
- 文件上传：Beginner **5 MB** / Pro **25 MB** / Business **100 MB**
- 每日自动备份：Beginner ❌ / Pro ✅ / Business ✅
- Calendar layout、Task durations、Time-blocking、Deadlines：**仅 Pro/Business**
- 自定义提醒 / 基于时间的提醒 / 基于位置的提醒 / 重复提醒：**仅 Pro/Business**
  （注：`/pricing` 页把 "Task reminders" 列为 Beginner 已有 [来源: https://www.todoist.com/pricing]，而 FAQ 说自定义提醒是 Pro —— 口径差异，可能是"自动提醒 vs 自定义提醒"之别，FAQ 措辞更细）
- 退款：**年付 30 天内可退**（Pro 可自助申请；Business 需先取消 team 再联系）；**月付不可退** [来源: https://www.todoist.com/help/account-and-billing/plans/todoist-plans-pricing-and-billing-faq-Vq2z0HWL6]

**未找到公开信息**：Todoist Assist 系任何功能的"AI 点数 / token 配额"式上限 —— 除 Ramble 的会话数与 Automations 的 compute 余额外，官方未公布其他 AI 用量上限。

---

## 5. 模型供应商 + 云端 vs 端上

### 5.1 云端还是端上：**100% 云端。未找到任何端上推理的证据。**

> "Todoist runs all AI functionality on secure infrastructure to ensure customer data stays protected within our environment."
> [来源: https://www.todoist.com/help/todoist/todoist-and-ai/introduction-to-todoist-assist-KgPP22q5O]

> "We run all of Todoist's AI functionality on our secure infrastructure to ensure your data stays protected within our environment."
> [来源: https://www.todoist.com/todoist-assist]

- Ramble 明确**需要联网**：*"Ramble only works with an internet connection."* [来源: https://www.todoist.com/help/todoist/todoist-and-ai/dictate-to-add-tasks-with-ramble-P1Raq7vVF] —— 这本身就排除了端上推理。
- **未找到公开信息**：Todoist 任何关于 on-device / 本地模型推理的声明。

### 5.2 供应商：**多家，且按功能分流。第一方最权威的清单是 subprocessors 页。**

**(a) 官方 subprocessors 页（观察日 2026-09-25）** [来源: https://trustcenter.doist.com/subprocessors]

| 供应商 | 角色 | 模型 | 数据保留（官方原文摘要） |
|---|---|---|---|
| **Amazon Bedrock** | AI provider | **Claude family models (Anthropic) & Nova family models (Amazon)** | **AI Data Retention: Not stored** |
| **Gemini Enterprise Agent Platform, formerly Vertex AI Studio (Google LLC)** | AI Provider | **Gemini family models (Google) with Grounding Search and Grounding Maps & Claude family models (Anthropic) with Web Search** | **Ramble session data, including audio, is cached by Google for up to 24 hours** to support pausing and resuming sessions, under its session-resumption policy. Separately, **Google may log and retain prompts for up to 90 days when suspicious activity requires investigation**, under its abuse-monitoring policy. "This does not mean every voice recording is routinely stored for 90 days" \| **Automations Search Steps for 30 days** |
| **OpenRouter** | AI Routing Service | **"Todoist uses OpenRouter as a subprocessor to route Automations AI requests to the providers listed below, which run DeepSeek V4 Flash 0731."** | **"Zero-data-retention routing enforced account-wide. OpenRouter does not store prompt content."** |
| **Google Cloud Platform (Google LLC)** | Ramble session resumption | — | Data elements: **Session audio data** |
| **Grounding Maps / Grounding Search (Google LLC)** | Location/map 与实时网页 grounding | — | Query text、geolocation context、contextual metadata |

**OpenRouter 下游的"approved model providers"（全部为 DeepSeek V4 Flash 0731）** [来源: https://trustcenter.doist.com/subprocessors]：
Atlas Cloud AI Inc.（US）、BaseTen Labs, Inc.（US）、CoreWeave, Inc.（US）、DeepInfra, Inc.（US）、Fireworks.ai, Inc.（US）、**Inceptron AB（Sweden, EU/EEA-only processing）**、Novita AI（US）、Parasail, Inc.（US）、Siliconflow Labs Pte. Ltd.（Singapore）、Together Computer, Inc.（US）、Venice.ai, Inc.（US）

**(b) Ramble 的具体模型 —— 官方对媒体的明确说法（TechCrunch 引 Doist）：**
> "Ramble is built on large language models (LLMs) as part of a set of AI features that the company calls **Todoist Assist**, which runs on **Google's Gemini 2.5 Flash Live model via Vertex AI** for real‑time speech understanding. As the audio streams to the back end, the model transcribes your speech and identifies the tasks, dates, and other details you mention to generate your tasks."
> "The audio isn't stored or used for AI training, and the app is SOC2 Type II certified, the company, Doist, says."
> [来源: https://techcrunch.com/2026/01/21/todoists-app-now-lets-you-add-tasks-to-your-to-do-list-by-speaking-to-its-ai/]

XDA 独立复述同一说法：*"It runs on Todoist Assist and **Google's Gemini 2.5 Flash Live model**"* [来源: https://www.xda-developers.com/todoist-ramble/]

**(c) 官方对"是否直连 OpenAI"的明确否认（帮助中心原文）：**
> "**We do not send your data directly to OpenAI. All processing flows through Todoist's secure infrastructure.**"
> "We work with AI providers that maintain strict data handling practices aligned with our privacy commitments. **This includes models from top AI providers available via AWS Bedrock and Google Cloud Vertex AI.**"
> "These providers have committed that data processed through their services will **not** be used to train their AI models."
> [来源: https://www.todoist.com/help/todoist/todoist-and-ai/introduction-to-todoist-assist-KgPP22q5O]

**(d) ⚠️ 一处内部不一致，值得注意（Task Assist 扩展的 FAQ）：**
> "Whilst we ourselves have no control over this, this will likely improve in the future through **OpenAI's** development of better models."
> "With this integration, **Todoist does not give OpenAI access to any of your Todoist data. However, OpenAI may use user input (queries) to improve their models.**"
> [来源: https://www.todoist.com/help/todoist/todoist-and-ai/use-the-task-assist-extension-with-todoist-ZgldtcPeT]

这段 FAQ **点名 OpenAI**，且**承认"OpenAI 可能用用户输入改进其模型"** —— 与 (a) 当前 subprocessors 清单（只有 Bedrock / Vertex / OpenRouter，**没有 OpenAI**）以及 §6 的"不用于训练"承诺**不一致**。合理解释是该 FAQ 是 2023 年 Task Assist 上线时写的旧文案、未随架构迁移更新。**这是本次调研发现的一个可操作的观察点：Todoist 自己的 AI 隐私文案存在跨页面不一致。**

### 5.3 汇总一句话

**供应商：Google（Gemini，含 Gemini 2.5 Flash Live via Vertex AI）+ Anthropic（Claude，经 AWS Bedrock 与 Vertex）+ Amazon（Nova，经 Bedrock）+ DeepSeek（DeepSeek V4 Flash 0731，经 OpenRouter，仅用于 Automations）。全部云端。官方对"具体哪个功能用哪个模型"只在 Ramble 上给过明确说法（Gemini 2.5 Flash Live）。**

---

## 6. 用户情绪

### 6.1 最有价值的一条赞扬：**Ramble**

**XDA（2026-02-02，独立评测，最完整的一段正面论证）：**
> "Todoist's newly released feature, Ramble, works because **it removes friction at the exact moment tasks are born**: when thoughts are half-formed, messy, and easy to lose."
> 实测："I tested this during a particularly chaotic morning: 'Remind me to email the design mockups to James by Wednesday, send the invoice to the client today, and book that dentist appointment for sometime next week, maybe Tuesday afternoon.' **Ramble parsed all three, assigned dates, dropped the work tasks into my Work project, kept the personal task separate, and I never touched my keyboard.**"
> 抗噪："I tested it while walking, with background noise, mid-thought interruptions, and it still parsed everything correctly."
> [来源: https://www.xda-developers.com/todoist-ramble/]

**Product Hunt（创始人评论，2026 年）：**
> "I used to be a big Todoist user then dropped off for a bit. **Ramble hooked me back in** and it's never been easier to add Todos to my list."
> "It's just simple, fast, and really responsive. **The ability to 'Ramble' and then have it connected to my AI assistant was what really won me over.**"
> [来源: https://www.producthunt.com/products/todoist/reviews]

**Product Hunt 平台自身的 AI 摘要（2026）：**
> "Reviewers mostly see Todoist as a dependable, lightweight task manager that wins on simplicity, speed, and ease of use. Repeated praise centers on **natural language task entry**, recurring tasks, cross-device consistency, calendar and app integrations…"
> [来源: https://www.producthunt.com/products/todoist/reviews]

**G2（2026-08-24，5/5，AI engineer）：**
> "Todoist excels as a rapid-capture, no-friction operational engine… I appreciate its **Natural Language Recognition (NLR)** which transforms task capture from a multi-tap form into a quick, fluid sentence. **The Zero-Friction Entry is exceptional**…"
> [来源: https://www.g2.com/products/todoist/reviews]

> **判定**：**"捕获端零摩擦"是 Todoist AI 唯一被独立验证过的强项**，且集中在 Ramble + Quick Add NLP。注意所有赞扬都落在**输入侧**，没有一条赞扬它的排程或自动化智能。

### 6.2 最常见的三类抱怨

**(1) 定价与付费墙（最高频、最具体）**

G2，2026-08-24，5/5 好评里的 dislike 段：
> "**Basic Features Behind Paywalls**: Critical tools for basic task management—specifically location-based or time-based reminders, extended activity history, and duration tracking—are **locked behind the paid Pro tier**. For basic users, a task app that cannot ping a reminder without a paid subscription is a major friction point."
> [来源: https://www.g2.com/products/todoist/reviews]

G2，2026-08-27：
> "I find that some of the more advanced features, like project templates or automated reminders, are **locked behind the premium subscription**. While the free version is quite powerful, those premium tools would be very beneficial for power users."
> [来源: https://www.g2.com/products/todoist/reviews]

Product Hunt cons 标签（聚合计数）：**"expensive premium version (2)"**、**"limited customization (2)"**；一条评论：
> "I get the need for paid tiers but **some functionalities like tagging are free on other apps**."
> [来源: https://www.producthunt.com/products/todoist/reviews]

Product Hunt 摘要亦点名：*"**some pricing friction**, and a sense that **AI and automation are lagging**."* [来源: 同上]

第三方评测对 2025-12-10 涨价的评价：
> "the **December 2025 price increase** made an already-paywalled feature set (calendar view, reminders) a bit harder to justify without comparison shopping."
> [来源: https://nathanojaokomo.com/blog/todoist-review]

Trustpilot 上亦以"僵化/过结构化"为主要负面口径（**该页面被人机验证拦截，仅取回搜索摘要，评级数字为搜索摘要值，未从页面直接确认**）：AU 站 **3.2 / 83 条** [来源: https://au.trustpilot.com/review/todoist.com]；全球站第 4 页显示 **3.0 / 84 条** [来源: https://www.trustpilot.com/review/todoist.com?page=4]。摘要引用的评论：*"It felt rigid and over-structured for how I think and work. I ended up building my own tool."*

**(2) AI 深度不够 / 自动化落后**

Product Hunt 上一条明确的功能缺失诉求：
> "The logical next step for their Todoist Assist feature would be to roll out **an AI scheduler which automatically schedules your highest priority tasks into your calendar**."
> [来源: https://www.producthunt.com/products/todoist/reviews]

Product Hunt 摘要：*"a sense that **AI and automation are lagging**"* [来源: 同上]

r/todoist 有标题为 **"Leave AI in the past"** 的帖子，摘要片段显示社区内部对此**严重分裂**：*"Ramble is the best new feature in Todoist in a long time. Love it and use the heck out of it. Some of the other AI features (especially on …)"* [来源: https://www.reddit.com/r/todoist/comments/1v1ar50/leave_ai_in_the_past/]
> ⚠️ **诚实标注**：Reddit 返回人机验证页，**该帖正文与完整评论未能取回**，仅取回搜索摘要。**该帖的具体反对理由 = 未找到公开信息（本次未取回）。**

另一条 r/todoist 帖（"Genuine question: is anyone using these new features like Ramble or Todoist Assist?"）摘要显示正面为主：*"I tried it and pretty amazed by the speech natural pattern. It split the task into two and I asked said no no it's one task one and it corrected…"* 与 *"I have extensively used Ramble. It's very nice to be able to have it up and listening and add tasks while scrolling through emails, texts…"* [来源: https://www.reddit.com/r/todoist/comments/1oq6nxw/genuine_question_is_anyone_using_these_new/]
> ⚠️ 同上，Reddit 正文未取回，仅摘要。

**(3) AI 隐私**

Privacy Guides 论坛，2023-08-17，标题 **"Todoist is sending user's PII to Google"**：
> "I've just found out through a direct employee of Todoist that the company is sending the PII of their users to Google. They've confirmed that they're sending **Todo task titles, descriptions, and etc along with your login details and location details (IP)** after interacting with the application. … Their Privacy Policy is pretty vague around this… I'm in the progress of migrating off of Todoist."
> 版主 ph00lt0 回复："The privacy policy is quite clear about this."
> [来源: https://discuss.privacyguides.net/t/todoist-is-sending-users-pii-to-google/13654]

**这条 2023 年的抱怨在 2026 年仍然有现实对应**：当前 subprocessors 页**主动披露**了 Ramble 音频被 Google 缓存最多 24 小时、以及 Google 在"可疑活动调查"下最多保留 prompt 90 天 [来源: https://trustcenter.doist.com/subprocessors]。这与营销页 "your recording stays completely private" / "audio isn't stored" 的口径存在**张力** —— 是本次调研认为对 heyta 最有价值的隐私竞争点。

**AI 输出质量的抱怨**：
- 官方自己承认的精度问题：Ramble 发布时成功率仅约 62%（2025-12）[来源: https://techcrunch.com/2026/01/21/todoists-app-now-lets-you-add-tasks-to-your-to-do-list-by-speaking-to-its-ai/]
- 官方自承的输出安全限制（Task Assist）：*"it may output harmful content when prompted. … we've implemented a warning message"* [来源: https://www.todoist.com/help/todoist/todoist-and-ai/use-the-task-assist-extension-with-todoist-ZgldtcPeT]
- 官方自承的手写识别限制：*"Handwriting recognition for images is still evolving."* [来源: https://www.todoist.com/help/todoist/product-updates/capture-tasks-from-text-and-images-february-5-0W88IbvvW]
- 竞品博客（**厂商软文，可信度低，仅作线索**）称 Ramble 的问题是 *"Every rambled item still needs manual cleanup"* [来源: https://www.saner.ai/blogs/todoist-ramble-alternatives]
- 一次真实的线上质量事故：Filter Assist 曾在 Web/桌面与 Android 上**停止工作**，后恢复 [来源: https://www.todoist.com/help/todoist/product-updates/2026-changelog-HD3jJAtLd]

---

## 7. Doist 对 AI 隐私/数据使用的公开立场

### 7.1 明确承诺：**不用用户数据训练通用模型**

**隐私政策（第一方，Effective Date: August 27th, 2026）原文：**
> "Todoist may use third-party vendors from time to time, including artificial intelligence tools, to capture, translate and/or record information about users' interaction with the Service to help us better improve our Services for you. **However, we do not use information we collect from you, including via artificial intelligence tools, to develop, improve, or train generalized/non-personalized artificial intelligence or machine learning models.**"
> [来源: https://doist.com/privacy]

注意措辞精确性：禁止的是训练 **generalized/non-personalized** 模型；同一段前面保留了"用 AI 工具采集/翻译/记录用户交互信息以改进我们自己的服务"的权利。

**产品页（`/todoist-assist`）原文：**
> "**No peeking, auditing, or training on your data.**"
> "we only partner with providers who maintain strict data handling practices, and who have **explicitly committed that data processed through their services will not be used to train their models.**"
> "Currently, Todoist Assist capabilities are **completely optional**"
> [来源: https://www.todoist.com/todoist-assist]

**帮助中心原文：**
> "**We do not send your data directly to OpenAI. All processing flows through Todoist's secure infrastructure.**"
> "These providers have committed that data processed through their services will **not** be used to train their AI models."
> [来源: https://www.todoist.com/help/todoist/todoist-and-ai/introduction-to-todoist-assist-KgPP22q5O]

**Ramble 专项（`/ramble` FAQ）：**
> "When using Ramble, your input is processed securely and **is not shared with third parties or used for training AI models**. **We may temporarily store usage data on our own secure servers to debug and improve the product.** Todoist is SOC2 Type II certified, with enterprise-grade security and privacy controls."
> [来源: https://www.todoist.com/ramble]

**Task Capture 专项（帮助中心）：**
> "This feature runs on Todoist Assist. When using text and file capture, your input is processed securely and **is not shared with third parties or used for training AI models**. We may temporarily store usage data on our own secure servers to debug and improve the product."
> [来源: https://www.todoist.com/help/todoist/todoist-and-ai/capture-tasks-from-text-images-and-documents-cAflh0WKe]

**认证：** SOC 2 Type II [来源: https://www.todoist.com/todoist-assist] [来源: https://www.todoist.com/pricing]

### 7.2 但公开披露里有三处**实质性保留**（这是本节最重要的部分）

Subprocessors 页（第一方，观察日 2026-09-25）[来源: https://trustcenter.doist.com/subprocessors]：

1. **Ramble 音频会被 Google 缓存最多 24 小时**
   > "**Ramble session data, including audio, is cached by Google for up to 24 hours** to support pausing and resuming sessions, under its session-resumption policy."
   对应 Google Cloud Platform 条目也单列了 *Data elements: **Session audio data*** / *Ramble session resumption*。

2. **Google 可能保留 prompt 最多 90 天**
   > "Separately, **Google may log and retain prompts for up to 90 days when suspicious activity requires investigation**, under its abuse-monitoring policy. This does not mean every voice recording is routinely stored for 90 days."
   （官方加了限定语，但保留了这条可能性。）

3. **Automations 的 search steps 保留 30 天**
   > "Automations Search Steps for 30 days"

此外，**Task Assist 扩展的 FAQ 仍写着 OpenAI 可能用用户输入改进模型**（见 §5.2(d)），与上述承诺不一致 [来源: https://www.todoist.com/help/todoist/todoist-and-ai/use-the-task-assist-extension-with-todoist-ZgldtcPeT]。

### 7.3 结论式判断

Doist **确实发布了"不用用户数据训练模型"的书面承诺**，而且写得比较明确（隐私政策 + 产品页 + 帮助中心 + 每个 AI 功能页各写一遍）。但**"不训练" ≠ "不存储"**：它自己公开披露了 24 小时音频缓存、90 天可疑活动日志、30 天 Automations search steps。**对 heyta（本地优先 + E2EE）而言，这是最清晰的差异化切口：heyta 的架构可以让"服务端看不到明文"成为结构性事实，而 Todoist 只能靠供应商合同与承诺。**

---

## 8. 时间线速览（2024–2026）

| 日期 | 事件 | 状态 | 来源 |
|---|---|---|---|
| 2023-02-16 | "AI-Assistant" 扩展（≈今 Task Assist） | shipped（第三方记录） | https://www.stiernholm.com/en/blog/todoist-releases-ai-assistant |
| 2024 全年 | "The year of the calendar"：Calendar layout、time-blocking、Google Calendar 双向同步、Team workspaces、Templates 改版 | shipped | https://www.todoist.com/help/todoist/product-updates/whats-new-january-december-2024-cueCuXy76 |
| 2025-01-07 | Add deadlines to tasks | shipped | https://www.todoist.com/help/todoist/product-updates |
| 2025-04-16 / 04-23 | 团队项目排序 / 团队工作视图 | shipped | 同上 |
| 2025-06-05 | Outlook Calendar 集成 | shipped | 同上 |
| 2025-06-30 | 重复任务新可视化界面 | shipped | 同上 |
| 2025-09-03 | Wear OS 重新设计 | shipped | 同上 |
| 2025-10-27 | Project Insights（团队进度） | shipped | 同上 |
| 2025-10-29 | Teams：自定义视图、team defaults、SOC 2 | shipped | 同上 |
| 2025-11-19 | **Ramble (Beta)** | beta | https://www.todoist.com/help/todoist/product-updates/capture-tasks-at-the-speed-of-thought-ramble-beta-nov-19-2025-r6701hY0t |
| 2025-12-10 | **Pro 涨价**：$5→$7/月，$48→$60/年 | shipped | https://www.todoist.com/help/account-and-billing/plans/todoist-pro-pricing-update-in-2025-bxBvHZuJZ |
| 2025-12-16 | Teams：共享 filters、insights、移动端快捷入口 | shipped | https://www.todoist.com/help/todoist/product-updates |
| 2026-01-21 | **Ramble 公开发布**（iOS/Android/桌面/Web，38–40+ 语言） | **shipped** | https://techcrunch.com/2026/01/21/todoists-app-now-lets-you-add-tasks-to-your-to-do-list-by-speaking-to-its-ai/ |
| 2026-03-23 | **Ramble on Wear OS (Beta)** | beta | https://www.todoist.com/help/todoist/product-updates/just-talk-to-your-wrist-ramble-on-wear-os-beta-mar-23-2026-Kskv3T9JF |
| 2026-04-01 | **Todoist Automations 公布**（alpha 已 500+ 人） | announced | https://todoist.substack.com/p/april-triage |
| 2026-04-21 | **Task Capture (Beta)**：扫描笔记/照片/文件 | beta | https://www.todoist.com/help/todoist/product-updates/scan-notes-photos-and-files-for-tasks-task-capture-beta-apr-21-2026-S5GOh7A0e |
| 2026-04-23 | 团队工作视图改进 | shipped | https://www.todoist.com/help/todoist/product-updates |
| 2026-09-02 | **Task Capture Assist**：合并流程 + 指令 + 复核 | experimental（付费 Experimentalists） | https://www.todoist.com/help/todoist/product-updates/tell-todoist-exactly-what-to-pull-from-your-notes-september-2-LGHUDJ26u |
| 2026-09-14 | Task Capture 帮助文档更新（beta，无需 opt-in，所有人可用） | beta | https://www.todoist.com/help/todoist/todoist-and-ai/capture-tasks-from-text-images-and-documents-cAflh0WKe |
| 2026-09-17 | Android 主屏 widget 新增 Ramble 快捷键 | shipped | https://www.todoist.com/help/todoist/product-updates/2026-changelog-HD3jJAtLd |
| 2026-09-18 | Ramble 帮助文档更新（40+ 语言，免费 10 sessions/月） | shipped | https://www.todoist.com/help/todoist/todoist-and-ai/dictate-to-add-tasks-with-ramble-P1Raq7vVF |
| 2026-08-27 | 隐私政策最新生效日 | shipped | https://doist.com/privacy |
| 未知（已 retired） | **Goals (Beta): Retired** | **discontinued** | https://www.todoist.com/help/todoist/product-updates/goals-beta-retired-VKe2PuGn5 |
| 未知（≤2025-02） | **Smart Schedule** 已 discontinued | **discontinued** | https://www.reddit.com/r/todoist/comments/1izqjad/a_plugin_or_substitute_for_the_discontinued_smart/ |

---

## 9. 明确标注为「未找到公开信息」的条目

1. Todoist 第一方发布的 2023 年 "AI Assistant" 原始公告页（todoist.com 域名下）。
2. Todoist 第一方发布的 **Smart Schedule 下线公告**及其下线日期。
3. Todoist 任何 **on-device / 本地模型推理** 的声明 —— 未找到，且证据（Ramble 需联网）指向纯云端。
4. **Business 计划的涨价生效日**（FAQ 引用了 `todoist-business-plan-pricing-update-dF5in65YM`，本次未取回正文）。
5. 内置的 **AI 每日/每周摘要**功能 —— 在 product-updates、2026 changelog、Todoist & AI 帮助中心分类中均未找到。
6. Todoist Assist 系功能除 Ramble 会话数以外的**任何 AI 点数/token 配额上限**。
7. 排程的 **lock / pin（锁定不被自动移动）** 概念 —— 帮助中心无此概念（因无自动排程）。
8. r/todoist 帖子 **"Leave AI in the past"** 与 **"Todoist Automations Beta - my impressions"** 的正文与评论（Reddit 人机验证拦截，仅取回搜索摘要）。
9. Trustpilot 页面正文（人机验证拦截）—— 评级数字来自搜索摘要，非页面直接确认。
10. "Capture tasks from text and images – February 5" 一页的**明确年份**（页面未写；本文的 2026 年判断为基于版本号与 Ramble 存在时间的推断）。

---

## 10. 对 heyta 的五条可操作结论

1. **Todoist 的 AI 全在"输入侧"，不在"决策侧"。** Ramble / Task Capture / Email Assist / Filter Assist 都是"把混乱变结构化"；**至今没有自动排程器**，Smart Schedule（2016）已下线，AI 排程被让给第三方（Reclaim / Morgen / Trevor）。heyta 若要做 AI，**"捕获"是已被验证的需求，"调度"是尚未被第一梯队解决的空位**。
2. **AI 已被计入订阅、且是涨价的官方理由之一**（2025-12-10 Pro $5→$7/月，官方明说为了 Ramble 与自动化投入）。独立加购的是 **Automations**，且是 **compute 按量充值（$5/$10/$20，最低 $5，需先有 Pro）**，不是固定月费 —— 这个"AI 按量计费 + 需基础订阅"的结构值得直接参考。
3. **免费档的 AI 配额设计得很克制且精确**：Ramble **10 sessions/月，UTC 每月 1 日重置，跨设备共享**；Filter Assist 全档免费；Task Assist / Email Assist / Task Capture 是 Pro 门槛。这是一个可直接对标的免费/付费切分线。
4. **"不训练"是行业标配话术，真正的差异点在"存不存"。** Doist 有明确书面承诺（隐私政策 2026-08-27 版 + 各功能页），但自己的 subprocessors 页披露了 **Ramble 音频 Google 缓存 ≤24h、可疑活动 prompt 保留 ≤90 天、Automations search steps 30 天**。heyta 的 E2EE 能让"服务端看不到明文"成为**架构事实**而非**供应商承诺** —— 这是最强的一句话差异化。
5. **AI 隐私文案会漂移，且会自相矛盾。** Todoist 的 Task Assist FAQ 至今写着"OpenAI 可能用用户输入改进其模型"，而当前 subprocessors 清单里根本没有 OpenAI。**这是竞品的可信度缺口，也提醒 heyta：AI 数据流的对外声明必须由一处事实源生成，否则必然腐烂。**

---

*本文件所有事实性陈述后均附实际取回的 URL。凡标注"推断"或"搜索摘要"处，均已在正文中显式说明证据强度。*
