# 竞品调研：Superlist 与 Notion 的任务能力（截至 2026-09-25）

> 调研日期：**2026-09-25**。所有价格与功能状态均以该日抓取的页面为准。
> 每条事实后紧跟 `[来源: URL]`。检索工具：anysearch CLI（当日配额耗尽后改用 `web_fetch` / `curl` 直取官方 URL）。
> **重要限制**：Reddit 对自动抓取返回 "Prove your humanity" 拦截页，因此 Reddit 引文来自搜索结果摘要（snippet）而非页面正文；已逐条标注。
> 未找到公开信息的一律写作 **未找到公开信息**，不做推测。

---

## 0. 执行摘要（决策相关）

| 维度 | Superlist | Notion |
|---|---|---|
| AI 定位 | 会议记录 → 任务、语音建任务、列表内容生成 | Agent 自主执行 + 企业搜索 + 会议记录 |
| AI 是否捆绑 | 分层：Free 无 AI / Basic 仅 Voice AI / Super 才有会议笔记与 AI Chat | **捆绑进 Business $20/人/月**，Free/Plus 只有试用额度 |
| AI 单独加价 | 无独立 AI 加价，靠 Super 层 | 2025-05-13 起**取消 $8–10 独立 AI 加购**，改为捆绑 |
| 自动排期 | **未找到公开信息**（AI 只抽 due date，不做时间块排布） | **没有 AI 自动排期**；Notion Calendar 只把有时间的数据库项显示为事件 |
| 模型厂商 | **未找到公开信息**（不公开点名 LLM/转写供应商） | **公开点名**：OpenAI + Anthropic，且模型无关可切换（含 Google Gemini、Kimi、DeepSeek、GLM、Grok） |
| 邮件产品 | 无自有邮件客户端，靠 Gmail 集成 + AI 摘要 | **Notion Mail 已于 2026-09-22 关停**（今天已关停 3 天） |
| 主要负面 | 涨价 + "没人要的 AI"、免费额度收紧 | AI 质量 vs 价格、"AI 是硬贴上去的"、Agent 积分计费 |

---

# 一、Superlist（superlist.com）

## 1.1 产品与版本脉络（2024–2026）

| 时间 | 版本 | 内容 |
|---|---|---|
| 2025-05-08 | 1.31.0 | **Meeting Notes 首发**，同时上线 **AI Chat with Meetings** |
| 2025-07-30 | 1.37.0 | **定价重构**：推出 Basic 层，原 Pro 变成 legacy |
| 2026-05-05 | 1.54.0 | **Superlist MCP** 上线；Talk 增加自动语言检测与保存前预览 |
| 2026-05-21 | 1.55.0 | Activity Heatmap、任务跨列表移动 |
| 2026-06-27 | 1.56.0 | 多选批量操作；**Meeting Notes 登陆 iOS/Android** |
| 2026-08-14 | 1.57.0 | Activity Log、精确重复任务（指定周几） |

- Meeting Notes 1.31.0 发布内容与原始额度：`[来源: https://www.superlist.com/updates/ai-meeting-notes]`
- 1.37.0 定价重构原文："We've reworked our pricing! The new **Basic** plan gives you unlimited private and shared lists, sublists, and access to all integrations. All at a lower price point." `[来源: https://www.superlist.com/updates/pricing-updates]`
- 1.54.0–1.57.0 changelog：`[来源: https://www.superlist.com/updates]`

---

## 1.2 问题 1：AI 功能的确切名称

| 确切名称 | 状态 | 说明与来源 |
|---|---|---|
| **Meeting Notes**（营销页写作 "AI Meeting Notes"） | **shipped**，2025-05-08 | 转写 + 摘要 + 行动项，**无会议机器人**；"no bots" |
| **AI Chat with Meetings** | **shipped**，2025-05-08 | 针对会议逐字稿提问，生成高管摘要、澄清决策 |
| **Talk**（AI 语音助手） | **shipped**（2024 起为 beta，2025 正式） | 语音直接生成任务、子任务、截止日期、笔记 |
| **Make AI** | **shipped** | 列表 / 任务详情内的 AI 内容生成：从零建列表、生成项目 brief、即时研究、扩写项目计划 |
| **Email + Slack task summarization** | **shipped**（Super 层） | 把 Gmail / Slack 消息摘要成任务 |
| **Superlist MCP** | **shipped**，2026-05-05 | 通过 Model Context Protocol 让 Claude / ChatGPT 等读写 Superlist 任务 |

来源逐条：

- Meeting Notes："Superlist acts as an AI meeting note-taker, turning every conversation into clear, structured notes — complete with summaries, action items, and due dates. And no bots." `[来源: https://www.superlist.com/feature-meeting-notes]`
- 行动项细节（自动指派人 + 截止日期、多语言自动检测、会中实时提问）：`[来源: https://www.superlist.com/feature-meeting-notes]`
- AI Chat with Meetings："Dive deeper into your meetings with AI Chat. Ask questions directly about your meeting transcript" `[来源: https://www.superlist.com/updates/ai-meeting-notes]`
- Talk 确切命名与能力："**Talk** is our brand-new AI voice assistant integrated into Superlist." 可产出 Single Tasks / Multi Tasks / Audio Notes；支持 "Enrich Tasks" 与 "Use AI to Generate Content for Tasks" `[来源: https://help.superlist.com/en/articles/74945-talk-superlist-s-ai-voice-assistant-for-hands-free-tasks]`
- Make AI："With Superlist's AI Assistant **Make**, you can create lists from scratch, generate project briefs, do on-the-fly research or expand a project plan in seconds." `[来源: https://www.superlist.com/feature-lists]`
- Email + Slack 摘要与 Make AI 均列在 Super 层：`[来源: https://www.superlist.com/pricing]`
- MCP："The new **Superlist MCP** lets you connect Superlist to Claude and other tools that support the Model Context Protocol" `[来源: https://www.superlist.com/updates]`；MCP 端点 `https://app.superlist.com/mcp` `[来源: https://help.superlist.com/en/articles/658028-superlist-mcp-server]`

### 关于"AI note-to-task extraction"
- **没有**一个叫 "note-to-task extraction" 的独立功能名。该能力存在于两处：(a) 首页描述 "AI to turn voice recordings into action items" `[来源: https://www.superlist.com/]`；(b) Meeting Notes 的 "Action items with auto assignees and due dates" `[来源: https://www.superlist.com/feature-meeting-notes]`。
- 1.37.0 定价更新文案里提到 "advanced AI features like email summarization and **transcript-based task extraction**" `[来源: https://www.superlist.com/updates/pricing-updates]` —— 这是官方出现过的最近似表述，但**不是产品内的功能名**。

### 共享列表 / 任务里的 AI
- **未找到公开信息**：没有检索到"在共享列表中针对他人任务运行 AI"这类功能的一手描述。MCP 连接器可以代表你创建、编辑、完成、删除、共享和整理任务与列表（含共享列表协作者名），这是目前最接近"AI 作用于共享任务"的官方说明 `[来源: https://www.superlist.com/privacy-policy]`（该页 419–429 行 "AI assistants and connectors (Model Context Protocol)" 段）。

---

## 1.3 问题 2：交互形态

| 形态 | 对应功能 | 依据 |
|---|---|---|
| **自动执行（生成后需人确认）** | Meeting Notes：会议结束数秒后自动出摘要 + 行动项 + 截止日期 + 指派人 | "Superlist delivers accurate, AI-generated notes with next actions instantly, seconds after your meeting ends." `[来源: https://www.superlist.com/feature-meeting-notes]` |
| **语音捕获 → 自动建任务** | Talk | "Simply speak into your phone, and let AI seamlessly turn your thoughts into tasks complete with due dates and details."（Reddit 转发官方文案，snippet）`[来源: https://www.reddit.com/r/todoist/comments/1g0l3f1/new_superlist_feature_talk_your_tasks_with_ai/]`；一手能力见 `[来源: https://help.superlist.com/en/articles/74945-talk-superlist-s-ai-voice-assistant-for-hands-free-tasks]` |
| **对话式助手（限定语料）** | AI Chat with Meetings —— 只能对会议逐字稿提问 | `[来源: https://www.superlist.com/updates/ai-meeting-notes]` |
| **内联生成** | Make AI 在列表 / 任务详情里生成内容 | `[来源: https://www.superlist.com/feature-lists]` |
| **保存前预览（人工把关）** | 1.54.0 Talk："Preview before you save. You'll now see exactly which tasks will be created and which list they'll land in. Remove any you don't want" | `[来源: https://www.superlist.com/updates]` |

**结论**：Superlist 的 AI 形态是「**捕获/记录 → 自动生成结构化任务 → 用户预览或事后编辑**」，不是常驻聊天助手，也不是无人值守的后台自动化。

---

## 1.4 问题 3：是否有自动排期？

**结论：未找到公开信息表明 Superlist 的 AI 会把任务自动放到时间线上。**

- 首页确有 "Plan your day — **Schedule** tasks, reminders and habits so you're ready for the day ahead." `[来源: https://www.superlist.com/]` —— 但这是**手动排期**的产品描述，没有任何 "AI 自动排期 / 时间块" 的表述。
- 唯一与"自动决定时间"相关的 AI 行为是 Meeting Notes 抽取 **due dates**（截止日期），不是日历时间块：`[来源: https://www.superlist.com/feature-meeting-notes]`
- 在 Superlist 的 pricing / feature / updates 三类页面中，均未出现 "auto-schedule"、"time blocking"、"AI planner" 之类功能名。→ **未找到公开信息**。

---

## 1.5 问题 4：价格（确切数字）

### 官方定价页（抓取于 2026-09-25）
`[来源: https://www.superlist.com/pricing]`

| 层 | 页面显示价 | 年付价 | 关键内容 |
|---|---|---|---|
| **Free** | **$0** /person/month | free forever | 最多 5 个私有 + 共享列表；共享列表最多 5 人；无限任务与笔记；macOS/iOS/Android/Web；25MB 单文件上传 & 500MB 存储 |
| **Basic** | **$5** /person/month | **$59 yearly** | Free 全部 + 无限列表/子列表/共享列表（含团队与访客）、全部集成、无限团队成员、**Talk your tasks with Voice AI**、100MB 上传 & 25GB 存储 |
| **Super** | **$21** /person/month | **$249 yearly** | Basic 全部 + **Unlimited AI Meeting Notes**、**Unlimited AI Chat messages**、**AI generation with Make AI**、**Email + Slack task summarization** |

页面带 `Monthly` / `Yearly - 20%` 切换器 `[来源: https://www.superlist.com/pricing]`。

### 官方帮助中心定价文章（Written by Marcel, 2026-05-20）
`[来源: https://help.superlist.com/en/articles/310866-superlist-pricing-free-basic-and-super-plans-compared]`

- **Free Account — $0**：最多 5 个私有列表 / 5 个共享列表；无限任务与笔记；25MB 单文件、500MB 总存储；重复任务与提醒；任务内消息协作；iOS/Android/Web/macOS
- **Basic Account — $6/month 或 $59/year**：无限私有/子/共享列表（每列表最多 25 名成员）；100MB 单文件、25GB 总存储；集成 Gmail、Google Calendar、Slack、Linear、Email Forwarding、GitHub；**Talk AI voice input**
- **Super Account — $25/month 或 $249/year**：无限 AI 会议笔记与摘要；无限 AI chat with meeting notes；基于 AI 的邮件与 Slack 消息摘要生成任务；列表与任务详情内的 Make AI 内容生成
- **Legacy Plan: Pro Account — $15/month 或 $149/year**："This plan is no longer available to purchase, but if you purchased it at an earlier point you still have access to it." 含：AI email summarization、Talk AI voice input、Make AI（文本输入生成任务与内容）、**AI 会议笔记（每月最多 30 场会议或 15 小时音频）**、**AI chat with meeting notes（每天最多 15 条消息）**
- 团队价与个人价相同：5 人团队月付 Basic = 5 × $6 `[来源: https://help.superlist.com/en/articles/310866-superlist-pricing-free-basic-and-super-plans-compared]`

### 价格数字的两处不一致（必须标注，不能取平均）
1. **月付 vs 年付口径**：帮助中心给的是月付挂牌价 **$6 / $25**；定价页显示 **$5 / $21** 并注明 "That's $59 yearly" / "That's $249 yearly"。$59÷12≈$4.92、$249÷12≈$20.75，与 $5 / $21 吻合 → **$5 / $21 是年付折算的等效月价**，$6 / $25 是真实月付价。
2. **营销页仍在用旧命名**：`/ai-task-management` 写 "Upgrade to **Pro** for **$5/month** to unlock AI meeting notes, voice assistant, and unlimited smart lists"，且称免费版 "basic AI features included" `[来源: https://www.superlist.com/ai-task-management]`。这与定价页（Free 不含 AI、Basic 仅 Voice AI、Super 才有会议笔记）**矛盾**，属于未清理的旧文案。

### 免费层 AI 限制
- **Free 层：定价页未列出任何 AI 能力** `[来源: https://www.superlist.com/pricing]`；帮助中心 Free 清单同样不含 AI `[来源: https://help.superlist.com/en/articles/310866-superlist-pricing-free-basic-and-super-plans-compared]`。
- Basic 层：仅 **Talk AI voice input**（会议笔记不在 Basic）`[来源: https://www.superlist.com/pricing]`
- **历史额度（legacy Pro，2025-05-08 首发时）**：每月 **30 场会议录制或 15 小时**；**每天 15 条 chat 消息** `[来源: https://www.superlist.com/updates/ai-meeting-notes]`
- Super 层：会议笔记与 AI chat **无限** `[来源: https://www.superlist.com/pricing]`

---

## 1.6 问题 5：模型厂商 + 云端 / 端侧

**模型厂商：未找到公开信息。**

- Superlist 的定价页、功能页、changelog、帮助中心均**未点名**任何 LLM 或转写模型供应商（未出现 OpenAI / Anthropic / Google / Whisper / Deepgram 等字样）。
- 隐私政策对 MCP 连接器只说 "the connector transmits to the AI provider the data needed to fulfil your request"，**不点名 provider**，并明确 "Data sent to an AI provider through a connector is processed under that provider's own terms and privacy policy." `[来源: https://www.superlist.com/privacy-policy]`
- 隐私政策中唯一被点名的第三方是 Google（Google Play、Google SSO、Firebase），属分发/认证/分析，**不是 AI 模型供应商** `[来源: https://www.superlist.com/privacy-policy]`

**云端 vs 端侧：无端侧声明。**
- 帮助中心隐私条目原文："Your content is private. **We never store audio files or transcripts without your consent.** Your data is not shared or used for training purposes."（Written by Niklas Jansen, 2024-11-20）`[来源: https://help.superlist.com/en/articles/227395-privacy]`
- 该表述暗示音频/逐字稿会经过 Superlist 的服务端处理（否则无从"存储"），但**没有任何一手文档声明是纯端侧推理**。因此：**未找到公开信息**确认端侧处理；可确认的是"未经同意不存储音频与逐字稿"。
- Meeting Notes 在 macOS 上要求 **macOS 14 (Sonoma) 或更新**，或使用 Superlist iOS App `[来源: https://help.superlist.com/en/articles/310871-ai-meeting-notes-in-superlist-summaries-and-next-actions-automatically]`（这条是系统版本要求，与端侧推理无关）。

---

## 1.7 问题 6：用户口碑

> ⚠️ Reddit 直取被 "Prove your humanity" 拦截页挡住，以下 Reddit 引文来自**搜索结果摘要**，非页面正文，已标注。

### 最有价值的称赞
1. **任务 + 笔记融合、设计出色、上手快**
   - 官方定价页收录的 App Store 评价："The seamless fusion of notes and task is its greatest strength." / "This could be best overall app for managing tasks with a simple to do list. It takes the best of Notion and offers it in a clean, elegant and user-friendly UI." `[来源: https://www.superlist.com/pricing]`
2. **免费层慷慨**
   - r/superlist："It is good and has many more quality features. I cannot complain anything and they even have generous free tier."（snippet）`[来源: https://www.reddit.com/r/superlist/]`
3. **迭代速度快**
   - 官方收录评价："the new features that are being added (seemingly monthly) are incredibly helpful" `[来源: https://www.superlist.com/pricing]`

### 最常见的抱怨
1. **涨价 + "没人要的 AI"**
   - r/superlist 帖 "New 'improvements' and subscription prices"：摘要为 "Today I got an email where they announced new improvements — basically, like every company these days, **AI features that no one asked for**."（snippet）`[来源: https://www.reddit.com/r/superlist/comments/1khy5m0/new_improvements_and_subscription_prices/]`
2. **免费层被收紧**
   - r/superlist 帖 "Superlist might have given their free users the middle finger..."（snippet）`[来源: https://www.reddit.com/r/superlist/comments/1mf6dr9/superlist_might_have_given_their_free_users_the/]`
3. **AI 能力薄弱 / 团队功能半成品**
   - r/todoist："Feels like they aren't on top of new iOS features eg focus filters or live activities. **Half baked attempt at enterprise or teams. Limited AI**"（snippet）`[来源: https://www.reddit.com/r/todoist/comments/1i8y79q/anyone_thinking_of_moving_to_superlist/]`
4. **UX 拖慢工作流**
   - r/superlist："The UX is bad. I have the feeling it was designed around looking light and nice, but **not accelerating workflows and productivity**."（snippet）`[来源: https://www.reddit.com/r/superlist/comments/1aqk4ho/share_your_thoughts_on_superlist/]`
5. **不稳定 / 协作不可靠 / 升级弹窗泛滥**（第三方评测，非 Reddit）
   - "Superlist feels fun to use with its thoughtful design and satisfying noises, but **it's buggy and collaboration is unreliable**, while Todoist works reliably" `[来源: https://efficient.app/compare/superlist-vs-todoist]`
   - "The upgrade prompts show up everywhere" `[来源: https://efficient.app/apps/superlist]`
6. **免费版可用性事故**
   - r/superlist："The free version has become unusable. As of today none of the lists are even showing up."（snippet）`[来源: https://www.reddit.com/r/superlist/comments/1c23tpe/continued_updates_are_making_this_so_damn_good/]`

---

# 二、Notion（Notion AI + Notion Calendar + Notion Mail，聚焦任务能力）

## 2.1 2024–2026 关键时间线

| 日期 | 事件 | 来源 |
|---|---|---|
| 2023-11-14 | **Q&A** beta 发布（Notion AI 早期形态） | `[来源: https://www.notion.com/blog/introducing-q-and-a]` |
| 2025-04-15 | **Notion Mail 正式发布** | `[来源: https://www.notion.com/blog/introducing-notion-mail]` |
| **2025-05-13** | **Notion 2.51**：AI Meeting Notes + Enterprise Search + Research Mode + 模型直聊；**Business/Enterprise 改为捆绑无限 AI**（取消独立 AI 加购） | `[来源: https://www.notion.com/releases/2025-05-13]` |
| **2025-09-18** | **Notion 3.0：Agents** —— Notion AI 重建为 Agent；Custom Agents 预告；数据库行级权限；AI connectors；MCP 扩展；内置 Claude Sonnet 4 与 GPT-5 可选 | `[来源: https://www.notion.com/releases/2025-09-18]` |
| 2026-05-03 / 05-04 | Custom Agents 免费期结束，**开始消耗 Notion credits** | `[来源: https://www.notion.com/product/ai]` |
| 2026-06-25 | **宣布 Notion Mail 关停** | `[来源: https://techcrunch.com/2026/06/25/notion-mail-shuts-down-amid-agent-takeover/]` |
| **2026-09-09** | **Model controls**：workspace owner 可分别控制 Notion Agent 与 Custom Agents 可用模型并设默认 | `[来源: https://www.notion.com/releases/2026-09-09]` |
| **2026-09-15** | **Notion 3.7**：Agent skills（可导出 `SKILL.md` 到 Claude Code/Codex/Cursor/Gemini/Grok）、Custom Agent 子代理、会后自动处理 | `[来源: https://www.notion.com/releases/2026-09-15]` |
| **2026-09-22** | **Notion Mail inbox 正式关停（web / desktop / iOS）** | `[来源: https://www.notion.com/help/notion-mail-inbox-is-going-away-what-to-do-next]`、`[来源: https://techcrunch.com/2026/06/25/notion-mail-shuts-down-amid-agent-takeover/]` |

---

## 2.2 问题 1：AI 功能的确切名称

`[来源: https://www.notion.com/product/ai]`、`[来源: https://www.notion.com/pricing]`

| 确切名称 | 状态 | 任务相关说明 |
|---|---|---|
| **Notion Agent**（个人 Agent） | **shipped**（2025-09-18 随 3.0 重建） | 多步执行：建页面/数据库、拆任务、指派、写文档；"capable of over 20 minutes of multi-step actions" |
| **Custom Agents** | **shipped**（3.0 预告，后正式）；**2026-05-04 起计费** | 按 trigger 或 **schedule** 自主运行；可调用子代理（3.7）；可做会后处理 |
| **AI Meeting Notes** | **shipped**，2025-05-13（2.51） | 转写 + 摘要 + 行动项；`/meet` 块；上传音频支持 AAC/M4A/MP3/WAV |
| **Enterprise Search** | **Beta** | 跨 workspace + 已连接应用检索，带引用 |
| **Notion AI Connectors** | **shipped**（Jira 为 beta） | Slack、Microsoft Teams、Google Drive、GitHub、Linear、Gmail、Microsoft Outlook、SharePoint/OneDrive、Google Calendar、Jira(beta) |
| **Research Mode** | **Beta** | 深度推理生成报告 |
| **AI blocks** | **shipped** | 页面内联写作/生成 |
| **Autofill** | **shipped** | 数据库属性自动填充 |
| **AI formulas** | **shipped**（3.0） | 自然语言生成公式 |
| **Notion MCP** | **shipped** | 外部工具读写 Notion |
| **Agent skills** | **shipped**，2026-09-15 | 可复用指令，导出为 `SKILL.md` |
| **Model controls** | **shipped**，2026-09-09 | 控制 Agent 可用模型 |
| **Notion Agents iOS app** | **shipped** | 移动端 Agent |
| **Notion credits / Workers** | Workers 为 **Beta** | Custom Agents 与 Workers 消耗 credits |

- 官方功能清单原文（含 Q&A、Autofill、AI blocks 等）：`[来源: https://www.notion.com/product/ai]`
- AI Meeting Notes 细节（权限、版本、转写行为、speaker labels）：`[来源: https://www.notion.com/help/ai-meeting-notes]`
- Custom Agents 定义："Set a trigger or schedule, and the agent handles it from there—24/7" `[来源: https://www.notion.com/product/ai]`

### Notion Calendar 的任务处理
- "Notion Calendar allows you to view your **Notion database items** alongside your Google Calendar events. This offers a streamlined way to see **project timelines and task due dates** alongside other scheduled events. However, **importing Google Calendar events directly into a Notion database is not yet possible**." `[来源: https://www.notion.com/product/calendar]`
- "**Notion Calendar automatically populates your calendar with dated events in databases you've connected.** If no start and end time is specified, your items will…" `[来源: https://www.notion.com/help/guides/getting-started-with-notion-calendar]`
- 兼容日历源：Google Calendar、Outlook Calendars、Apple iCloud `[来源: https://www.notion.com/product/calendar]`
- **Notion Calendar 自带 scheduling（可分享可约时间）** `[来源: https://www.notion.com/blog/introducing-notion-mail]`（Mail 发布文中提到 "Built-in scheduling: Share your upcoming availability and let others quickly book a time through a native integration with Notion Calendar"）
- AI Meeting Notes 与日历联动："if you use Notion Calendar, you can have **AI meeting notes added automatically to every meeting**" `[来源: https://www.notion.com/releases/2025-05-13]`

### Notion Mail 的 AI 功能（**已 discontinued**）
- 状态：**discontinued**。宣布日 2026-06-25，关停日 **2026-09-22**（今天 2026-09-25，已关停）。
- 关停理由（官方 X 转述 + TechCrunch）："more than half of Notion Mail users manage emails without ever opening their inbox. So, we're going all in on using agents to run your inbox." `[来源: https://techcrunch.com/2026/06/25/notion-mail-shuts-down-amid-agent-takeover/]`
- 历史 AI 功能（发布时）：
  - **Auto-label**："Ask Notion AI for help, and it will **auto-label incoming emails** based on what's important to you." `[来源: https://www.notion.com/blog/introducing-notion-mail]`
  - **Custom views**：自建过滤/排序视图 `[来源: https://www.notion.com/blog/introducing-notion-mail]`
  - **AI 写作/编辑（AI drafts）**："Your personal editor: Need help writing an intro or response? Just ask Notion AI, your new editor-in-chief" `[来源: https://www.notion.com/blog/introducing-notion-mail]`
  - **One-click snippets**、**Built-in scheduling**（对接 Notion Calendar）、`/` 命令块编辑 `[来源: https://www.notion.com/blog/introducing-notion-mail]`
- 关停后的数据处置：Gmail 里的邮件留在 Gmail；**drafts、scheduled emails、snippets、auto-label 规则需要自行导出**；"Notion's email-based agents will keep working post-Notion Mail shutdown" `[来源: https://techcrunch.com/2026/06/25/notion-mail-shuts-down-amid-agent-takeover/]`
- 官方帮助页标题即 "Notion Mail inbox is going away: what to do next" —— "The Notion Mail inbox is shutting down on September 22, 2026." `[来源: https://www.notion.com/help/notion-mail-inbox-is-going-away-what-to-do-next]`（该 URL 目前渲染为帮助中心首页，标题与日期取自搜索索引与 en-gb 版本 `[来源: https://www.notion.com/en-gb/help/notion-mail-inbox-is-going-away-what-to-do-next]`）

### 邮件 → 任务（Mail 关停后）
- **未找到公开信息**表明 Notion Mail 曾有一个官方命名的"把邮件变成任务"按钮。发布文只描述了 auto-label / custom views / snippets / scheduling / AI 写作，**未提及任务转换** `[来源: https://www.notion.com/blog/introducing-notion-mail]`。
- 现存官方路径是 **Gmail AI Connector + Notion Agent**：个人 Gmail 连接器 "works on any plan"，Notion AI 可读取全部邮件并回答/检索 `[来源: https://www.notion.com/help/notion-mail-ai-connector]`；连接器支持 Slack、Gmail、Google Calendar 等，Agent 可对其执行动作 `[来源: https://www.notion.com/help/notion-ai-connectors]`。但**"由邮件自动生成任务"没有官方功能名** → **未找到公开信息**。

---

## 2.3 问题 2：交互形态

| 形态 | 对应功能 | 依据 |
|---|---|---|
| **对话式助手** | Notion Agent（侧栏 / Home 搜索框） | `[来源: https://www.notion.com/product/ai]` |
| **自动执行（多步、可无人值守）** | Notion Agent + Custom Agents（trigger/schedule，24/7） | "Does work for you. Completes complex, multi-step tasks using context from Notion, your connected apps, and the web." `[来源: https://www.notion.com/pricing]`；"Set a trigger or schedule, and the agent handles it from there—24/7, whether you're online or not." `[来源: https://www.notion.com/product/ai]` |
| **内联** | AI blocks 在页面内写作；Autofill 在数据库属性 | `[来源: https://www.notion.com/product/ai]` |
| **建议（人在环）** | "Ask your agent to suggest edits"（2026-08-28 release）；MCP 写入需确认 | `[来源: https://www.notion.com/releases]`；"Confirmations keep you in control, so nothing changes in a connected tool until you approve it." `[来源: https://www.notion.com/releases/2026-09-15]` |
| **自动转写 + 自动摘要** | AI Meeting Notes | `[来源: https://www.notion.com/help/ai-meeting-notes]` |

---

## 2.4 问题 3：是否有自动排期？

**结论：没有 AI 自动排期。** 需要明确区分三件事：

1. **Notion Calendar 会把"有时间日期"的数据库项显示为日历事件** —— 这是**渲染/同步**，不是排期决策。
   - "Notion Calendar **automatically populates** your calendar with dated events in databases you've connected." `[来源: https://www.notion.com/help/guides/getting-started-with-notion-calendar]`
   - "Events will appear in your calendar for items in connected databases **which have a time and date**." `[来源: https://www.notion.com/help/guides/getting-started-with-notion-calendar]`
2. **Notion Calendar 有 scheduling（约会议）**，那是**共享可用时间给人预约**，不是 AI 给任务排时间块。
   - "Built-in scheduling: Share your upcoming availability and let others quickly book a time through a native integration with Notion Calendar" `[来源: https://www.notion.com/blog/introducing-notion-mail]`
3. **没有找到任何"AI 把任务自动排进日历 / 自动时间块"的官方功能。**
   - 第三方明确："If you're trying to block time for tasks on your calendar, **Notion won't help you do that automatically.** You have to decide when to work on…" `[来源: https://akiflow.com/blog/notion-calendar-integration-smarter-scheduling]`
   - 用户也在问同一件事："Why Notion Calendar still doesn't support Natural Language in 2026?"（snippet）`[来源: https://www.reddit.com/r/Notion/comments/1tyt771/why_notion_calendar_still_doesnt_support_natural/]`
   - 用户需要外部工具补足："I've been exploring tools like **Motion or Sunsama** that take your task list and build a daily schedule for you"（snippet）`[来源: https://www.reddit.com/r/Notion/comments/1ar6kfr/best_ai_scheduling_tool_to_layer_on_top_of_notion/]`
   - **未找到公开信息**表明 Notion AI 或 Notion Calendar 提供 AI 自动排期。

> 对 heyta 的含义：竞品在这一格是空的。若做 AI 自动排期，是差异化点而非跟随。

---

## 2.5 问题 4：价格（确切数字）

### 官方定价页（抓取于 2026-09-25）
`[来源: https://www.notion.com/pricing]`

| 层 | 官方页价格 | AI 权益 |
|---|---|---|
| **Free** | **$0** /member/month | "Trial of Notion AI"（限量试用） |
| **Plus** | **$10** /member/month | "Trial of Notion AI"（限量试用） |
| **Business**（Recommended） | **$20** /member/month | **Notion Agent**、**AI Meeting Notes**、**Enterprise Search (Beta)**、SAML SSO、Granular database permissions、Private teamspaces、Premium connections |
| **Enterprise** | Custom pricing | Business 全部 + **Zero data retention with LLM providers**、SCIM、audit log、DLM/SIEM、custom data retention、AI Meeting Notes transcript deletion |
| **Custom Agents**（加购） | **Free to try, then $10 per 1,000 monthly Notion credits** | AI agents 自主处理重复工作 |
| **Workers**（Beta） | 需要 Notion credits | 自定义代码扩展 agent |

- 页面顶部标注 "**Save up to 20% with yearly**"，且价格单位写 "Price in USD"，因此页面上的 $10 / $20 是**年付价** `[来源: https://www.notion.com/pricing]`
- 功能表明确 "**Notion AI is included with Notion's Business and Enterprise plans**, with core features like Notion Agent, AI Meeting Notes, and Enterprise Search. Workspaces on other plans get a limited amount of trial usage to try it out." `[来源: https://www.notion.com/product/ai]`
- 数据保留在功能表中的差异：Free/Plus/Business 为 **30 day retention**，Enterprise 为 **Zero data retention** `[来源: https://www.notion.com/pricing]`
- Custom Agents 计费时点："**Now through May 3, 2026**: Custom Agents are free to use on Business and Enterprise plans… **Starting May 4, 2026**: Custom Agents will start using Notion credits when they run. …if credits are insufficient, agents will automatically pause until more are added." `[来源: https://www.notion.com/product/ai]`

### 月付价（官方页只给年付；月付为二手来源，逐条标注）
- "Plus at $10 per user per month billed annually (**$12 month-to-month**), and $20 per user per month for Business billed annually (**$24 month-to-month**)" `[来源: https://costbench.com/software/project-management/notion/]`（二手，2026-08-24）
- "Plus at $10/user/month billed annually ($12 monthly) and Business at $20/user/month billed annually ($24 monthly)" `[来源: https://automationatlas.io/answers/notion-pricing-explained-2026/]`（二手，2026-08-18）
- "Notion Plus is $10 per member per month billed yearly ($12 monthly) and Business is $20 yearly ($24 monthly)" `[来源: https://www.spotsaas.com/blog/notion-vs-clickup]`（二手）
- **注意**：官方定价页本身未渲染出 $12 / $24 月付数字（`Monthly` 切换后的值未出现在抓取内容中），因此月付价**仅有二手来源**。

### Notion AI 是否仍是独立加购？（历史 $8–10 的加购已取消）
- **已取消，改为捆绑进 Business/Enterprise。**
- 官方 2025-05-13 发布说明原文："**New plans with all-in-one AI pricing** — We've simplified Notion's pricing plans. **The Business Plan & Enterprise Plan now include unlimited usage of Notion AI**, including enterprise search, research mode, and AI meeting notes." `[来源: https://www.notion.com/releases/2025-05-13]`
- 二手对"取消 $8–10 加购"的具体表述："Notion eliminated the standalone AI add-on on **May 13, 2025**. The roughly **$8–10/month per-member AI add-on** that you could attach to any plan went…" `[来源: https://www.usecarly.com/blog/notion-ai-pricing-change/]`（二手）
- 同期社区讨论："Notion has announced pricing and feature changes that take effect starting **May 13, 2025**, Notion AI is now exclusive to Business and Enterprise…"（snippet）`[来源: https://www.reddit.com/r/Notion/comments/1kmjd30/notion_pricing_changes/]`
- 涨价幅度（二手）："Going from $10/month (Plus + old AI add-on) to $20/month (Business with AI included) is a 100% increase." `[来源: https://www.techvaultai.com/ai-tools/notion-ai-2026-review-business-plan-upgrade]`

### 免费层 AI 限制
- Free 与 Plus 均为 "**Trial of Notion AI**" / "**Limited Trial**"（生成文档、Autofill 数据库、Meeting notes、Research mode 均为 Limited Trial）`[来源: https://www.notion.com/pricing]`
- 官方 FAQ："Workspaces on other plans get a **limited amount of trial usage** to try it out." 且 "your access to AI features can be **temporarily reduced depending on your usage**" `[来源: https://www.notion.com/product/ai]`
- **确切的试用额度数字：未找到公开信息**（官方页只写 "Limited Trial" / "Trial"）。

---

## 2.6 问题 5：模型厂商 + 云端 / 端侧

### 官方点名的供应商
- "Notion currently utilizes various large language models (LLMs) **hosted by Notion as well as by organizations such as Anthropic and OpenAI**. We continuously evaluate LLM providers and their models…" `[来源: https://www.notion.com/help/notion-ai-security-practices]`
- **Embeddings 明确用 OpenAI**："For each page in your workspace, we generate an embedding by using an **OpenAI zero-retention embeddings API**." `[来源: https://www.notion.com/help/notion-ai-security-practices]`
- **向量库**："We store embeddings with vector databases like **Turbopuffer**."（且 Turbopuffer 通过 SOC 2 Type 2）`[来源: https://www.notion.com/help/notion-ai-security-practices]`
- **Enterprise Search 文档提到具体模型**："Notion AI generates answers using LLMs like **GPT-5 and Claude**."；模型切换可选 "**OpenAI's GPT, Anthropic's Claude, and Google's Gemini**" `[来源: https://www.notion.com/help/enterprise-search]`
- **Subprocessor 列表**（官方）：`[来源: https://notion.notion.site/Notion-s-List-of-Subprocessors-268fa5bcfa0f46b6bc29436b21676734]`

### 模型无关路由（model-agnostic routing）—— 官方原话
- "**Model agnostic.** Switch any workflow to a different model or provider, without losing any context. [Learn how we evaluate AI models →]" `[来源: https://www.notion.com/product/ai]`
- 3.0 发布："The best AI models, built in. AI models evolve quickly. With Notion, **you don't pay extra for every model**. The latest—like **Claude Sonnet 4 and GPT-5**—are already built in. **Just pick the model you want** for your Agent…" `[来源: https://www.notion.com/releases/2025-09-18]`
- 3.7 发布："**You get access to all the latest frontier models in Notion, including Opus 5, GPT-5.6 Sol, and Kimi K3.** The new model picker is redesigned to help you choose the best model for your work, with indicators for speed, intelligence, and costs." `[来源: https://www.notion.com/releases]`
- 2026-09-09：workspace owner 可分别控制 Notion Agent 与 Custom Agents 的可用模型并设默认 `[来源: https://www.notion.com/releases/2026-09-09]`

### 官方模型评估（Knowledge Board）—— 已评估的模型清单
`[来源: https://labs.notion.com/knowledge-board]`

官方列出的实验模型：**DeepSeek V4 Pro、Gemini 3.7 Flash、GLM-5.2、GPT-5.4、GPT-5.5、GPT-5.6-Luna、GPT-5.6-Sol、GPT-5.6-Terra、Grok 4.5、Kimi K2.7 Code、Kimi K3、Opus 4.7、Opus 4.8、Opus 5、Sonnet 4.6、Sonnet 5**。

关键方法论声明：
- "This is **not a traditional benchmark**… Our Knowledge Board is a live, ongoing measurement of how well models in Notion do that work." `[来源: https://labs.notion.com/knowledge-board]`
- "**Models that did not pass our Zero Data Retention requirements, including Fable, were excluded.**" `[来源: https://labs.notion.com/knowledge-board]`
- "**No customer data was retained during this experiment.** The resolution score and product metrics were calculated online, and only the 0/1 flag was saved. Users could also **opt out** of the experiment at any time…" `[来源: https://labs.notion.com/knowledge-board]`
- 官方刻意不做排行榜："Many of the differences we measure are smaller than their confidence intervals, so we've **deliberately avoided creating a leaderboard**." `[来源: https://labs.notion.com/knowledge-board]`
- 成本维度确实公开（$/task），例如 Opus 5 $0.87/task、Kimi K3 $0.45/task、Sonnet 5 $0.34/task、GLM-5.2 $0.17/task、GPT-5.6-Luna $0.02/task `[来源: https://labs.notion.com/knowledge-board]`

### 云端 vs 端侧
- **全部为云端。** 没有任何官方声明提到端侧/on-device 推理；官方描述的处理链路是「请求 → LLM/AI Models → 向量库（Turbopuffer）→ LLM 生成响应」，且明确 "When we send your Customer Data to third parties, it is encrypted in-transit using **TLS 1.2 or greater**." `[来源: https://www.notion.com/help/notion-ai-security-practices]`
- 本地端只有客户端行为（如 desktop app 采集 system audio 用于会议转写），**不是模型端侧推理**：AI Meeting Notes 需 "access to your system audio and screen recording permissions" `[来源: https://www.notion.com/help/ai-meeting-notes]`

---

## 2.7 问题 6：用户口碑

> ⚠️ 同上：Reddit 直取被拦截，引文来自搜索结果摘要。

### 最有价值的称赞
1. **知识库 / 文档能力最强，评分高**
   - "Notion earns its **4.6/5 G2 rating** and 100M users for one reason: nobody builds knowledge bases better." `[来源: https://www.eesel.ai/blog/notion-review]`
2. **写作与摘要是最强的 AI 能力**
   - "Writing and summarization are the strongest features. Q&A, search, and database automation are solid but inconsistent. Performance degrades…" `[来源: https://www.saner.ai/blogs/notion-ai-review]`
3. **模型可选本身被用户认可**
   - r/Notion："I've found Claude to be much faster, and better integrated with Notion's databases, where it follows instructions better and more consistently."（帖名 "Claude Sonnet 4.5 feels way better than GPT-5 in Notion"，snippet）`[来源: https://www.reddit.com/r/Notion/comments/1otr8pe/claude_sonnet_45_feels_way_better_than_gpt5_in/]`
4. **跨工具上下文（Enterprise Search / Connectors）价值被认可**
   - Affirm 案例（官方引用）："We replaced our stand-alone search with Notion AI because answers belong where people work." `[来源: https://www.notion.com/releases/2025-09-18]`

### 最常见的抱怨

**(a) 质量 vs 成本**
- "**AI is now $24**"（r/Notion）："it makes a ton of mistakes and has even **deleted important stuff** for me. **$24 now is absolutely absurd** to be honest."（snippet）`[来源: https://www.reddit.com/r/Notion/comments/1qfysfi/ai_is_now_24/]`
- "**150% price increase**"（r/Notion）："The price increase does suck, especially since I don't need all the bells and whistles of the business plan."（snippet）`[来源: https://www.reddit.com/r/Notion/comments/1wnd3w5/150_price_increase/]`
- **Custom Agents 积分计费被强烈反对**："the new Custom Agents credits pricing and **no-rollover policy** makes even a simple daily agent cost about **$30/month**"（snippet）`[来源: https://www.reddit.com/r/Notion/comments/1rdd3av/petition_the_new_pricing_of_notion_custom_agents/]`
- "Notion AI is a nice party trick, but **not really worth the money** imo" `[来源: https://www.linkedin.com/posts/matthiasfrankprofile_notion-ai-is-a-nice-party-trick-but-not-activity-7387402736616513539-byrT]`
- 价格对比（二手）："The pricing jump is aggressive. Going from $10/month (Plus + old AI add-on) to $20/month (Business with AI included) is a **100% increase**." `[来源: https://www.techvaultai.com/ai-tools/notion-ai-2026-review-business-plan-upgrade]`

**(b) "AI 是硬贴上去的" / bolted-on 批评**
- "**Notion is Turning Into a Bloated MESS**"："Notion's core product was and remains a good tool, but it's become so **bloated and overrun with AI** and continuing privacy concerns that I just…" `[来源: https://medium.com/@michaelswengel/notion-is-turning-into-a-bloated-mess-2240d0e4be1f]`
- "its **May 2025 AI paywall locks meaningful AI behind the Business tier** ($20/user/month)" `[来源: https://www.taskade.com/blog/notion-review]`
- "What used to be a pretty reasonable **$8 to $10 add-on for any plan is now locked behind the Business plan**, which costs $20 per user per month." `[来源: https://www.eesel.ai/blog/notion-pricing]`
- "AI features are becoming an excuse to raise prices… Notion just announced that AI is now bundled into its Business and Enterprise tiers. The official message: **AI isn't a $10 add-on anymore.**" `[来源: https://www.linkedin.com/posts/ryanneu_ai-features-are-becoming-an-excuse-to-raise-activity-7378431215281840128-tP8N]`

**(c) AI 能力本身不达标**
- "**Let's be honest about Notion AI**"（r/Notion）："It sucks. It's **using subpar models** and it's unable to fulfill tasks such as **identifying stuff inside specific databases** when asked to."（snippet）`[来源: https://www.reddit.com/r/Notion/comments/1g7gx3h/lets_be_honest_about_notion_ai/]`
- "**AI Agent kinda not that good?**"（r/Notion）—— 帖题本身即抱怨 `[来源: https://www.reddit.com/r/Notion/comments/1nrrp97/ai_agent_kinda_not_that_good/]`
- AI Meeting Notes 被批只是记录器不是助手："The biggest issue is its **lack of detail**. It hears audio and turns it into words, but that's…" `[来源: https://www.eesel.ai/blog/notion-ai-meeting-notes]`
- Agent 产出需要人在环验证："AI automations in production is human validation, validation feature of what the automations changed, a kind of **human-in-the-loop interface**."（snippet）`[来源: https://www.reddit.com/r/Notion/comments/1rfkr7x/i_spent_an_hour_testing_notion_agents_for/]`
- **价格/条款变动的社区反弹**（2026-05）："New Notion Terms May 4th... Are they charging for non-agent AI now?"（snippet）`[来源: https://www.reddit.com/r/Notion/comments/1saqxux/new_notion_terms_may_4th_are_they_charging_for/]`

---

# 三、Notion 的 AI 隐私立场（官方口径）

**主来源：`https://www.notion.com/help/notion-ai-security-practices`**

### 是否用客户数据训练？
- **默认不训练。**"**By default, Notion and its AI Subprocessors do not use Customer Data to train any models.** We specifically have contractual agreements in place with our AI Subprocessors that prohibit the use of Customer Data to train their models." `[来源: https://www.notion.com/help/notion-ai-security-practices]`
- "Your use of Notion AI **does not grant Notion any right or license** to your Customer Data to train our machine learning models." `[来源: https://www.notion.com/help/notion-ai-security-practices]`
- 定价页 FAQ 补充了 opt-in 例外："Notion AI **will not use your data to train our models unless you opt in** to a request to share your data." `[来源: https://www.notion.com/pricing]`、`[来源: https://www.notion.com/product/ai]`
- 产品页营销表述："**No training on your data** — We have contractual agreements with our AI subprocessors that prohibit the use of customer data to train their models." `[来源: https://www.notion.com/product/ai]`

### Subprocessors
- 官方 subprocessor 列表页：`[来源: https://notion.notion.site/Notion-s-List-of-Subprocessors-268fa5bcfa0f46b6bc29436b21676734]`
- "Any information used to power Notion AI will be shared with AI subprocessors **for the sole purpose of providing you with the Notion AI features**." `[来源: https://www.notion.com/pricing]`
- 新增 subprocessor 的提前通知机制：客户可发邮件至 `team@makenotion.com`（主题 "Subscribe to New Subprocessors"），Notion 会在授权新 subprocessor 处理客户数据**之前**通知 `[来源: https://www.notion.com/help/notion-ai-security-practices]`
- 供应商尽调："All Subprocessors are monitored and reviewed **at least annually**… reviewing documents such as attestation reports, penetration tests…" `[来源: https://www.notion.com/help/notion-ai-security-practices]`

### 保留期（retention）
- **Enterprise：LLM 供应商零数据保留**（"no data is stored with LLM providers"）`[来源: https://www.notion.com/help/notion-ai-security-practices]`、`[来源: https://www.notion.com/pricing]`
- **非 Enterprise：默认 ≤30 天** —— "by default for all non-Enterprise plan workspaces, LLM providers only retain Customer Data for **30 days or fewer** before deletion." `[来源: https://www.notion.com/help/notion-ai-security-practices]`
- **需要保留数据的 LLM 默认关闭**："there are certain AI-powered features that may require the use of **data-retaining LLMs**; in such cases, Notion will make available Workspace settings to enable administrators to turn on data-retaining LLMs. Otherwise, such data-retaining LLMs will **remain off in your Workspace by default**." `[来源: https://www.notion.com/help/notion-ai-security-practices]`
- **Embeddings**：删除页面/workspace 后 **60 天内**删除向量库中的 embeddings；页面/workspace 删除后 **30 天内**可恢复，超过 30 天不可恢复（含 AI 生成数据与 embeddings）`[来源: https://www.notion.com/help/notion-ai-security-practices]`
- **External Agents 的保留策略不同**（官方另行说明）`[来源: https://www.notion.com/help/notion-ai-security-practices]`

### 权限与隔离
- "**Notion AI honors existing permissions.** The LLMs and AI Models used to generate AI responses for a user cannot see or use any information to which that user does not already have access." `[来源: https://www.notion.com/help/notion-ai-security-practices]`
- "Individual customer accounts are kept separate in our production environment. We do not mix or process data from different customers together during AI processing." `[来源: https://www.notion.com/help/notion-ai-security-practices]`
- 传输加密 TLS 1.2+；embeddings 与 Customer Data 同等保护级别 `[来源: https://www.notion.com/help/notion-ai-security-practices]`

### 合规
- SOC 2 Type 2 + ISO 27001（Notion AI 在范围内）；GDPR & CCPA；HIPAA（Enterprise，走 LLM 零保留 API 处理 PHI）`[来源: https://www.notion.com/help/notion-ai-security-practices]`、`[来源: https://www.notion.com/product/ai]`

### 管理控制
- Workspace owner 可在 `Settings → Notion AI` 调整 web search 开关；模型控制见 `Settings → Notion AI → General → Model controls`（2026-09-09 起）`[来源: https://www.notion.com/help/notion-ai-security-practices]`、`[来源: https://www.notion.com/releases/2026-09-09]`
- Enterprise 可设 **AI Meeting Notes transcript 自动删除计划** `[来源: https://www.notion.com/pricing]`
- 用量可临时限流："your access to AI features can be **temporarily reduced depending on your usage**" `[来源: https://www.notion.com/product/ai]`

### 对照：Superlist 的 AI 隐私口径（较短）
- "Your content is private. We never store audio files or transcripts without your consent. **Your data is not shared or used for training purposes.**" `[来源: https://help.superlist.com/en/articles/227395-privacy]`
- MCP 连接器：仅在用户通过 OAuth 显式授权、且用户主动要求助手操作时才传输数据；传输内容为账号身份（唯一 ID、邮箱、显示名、时区）+ 所访问任务/列表内容（标题、笔记、截止日期、标签、状态、共享列表协作者姓名）；**不收集不存储你与 AI 助手的对话内容**；可随时断开 `[来源: https://www.superlist.com/privacy-policy]`
- 隐私政策最后更新：**2026-06-04** `[来源: https://www.superlist.com/privacy-policy]`

---

# 四、明确"未找到公开信息"的清单

1. Superlist 的 **LLM / 转写模型供应商**（未点名任何一家）。
2. Superlist 是否做**端侧推理**（无一手声明）。
3. Superlist 的 **AI 自动排期 / 时间块**能力。
4. Superlist **共享列表中的 AI 专属功能**（无一手功能名；仅 MCP 连接器可代操作共享任务）。
5. Superlist 当前 **Free / Basic 层的 AI 用量上限数字**（定价页与帮助中心均未给 Free/Basic 的 AI 额度；仅 legacy Pro 的 30 场/15 小时与 15 条/天有明确数字）。
6. Notion **Free / Plus 的 AI 试用额度确切数字**（官方只写 "Limited Trial" / "Trial"）。
7. Notion **月付价 $12 / $24** 的官方页面直证（仅二手来源；官方页只渲染年付 $10 / $20 + "Save up to 20% with yearly"）。
8. Notion Mail 是否存在官方命名的**"邮件转任务"**功能（发布文未提及任务转换）。
9. Notion Calendar 的 **AI 自动排期**能力（明确为不存在，非"未找到"，见 §2.4）。
10. Notion **Notion Mail 关停公告页的正文**（`/help/notion-mail-inbox-is-going-away-what-to-do-next` 目前渲染为帮助中心首页；关停事实由 TechCrunch 与官方 X 帖确认）。

---

# 五、对 heyta 的要点（基于以上事实）

1. **AI 定价策略出现行业分叉**：Notion 用「捆绑进 Business $20 并取消 $8–10 加购」换取 ARPU，代价是大量"AI 是硬贴上去的 / 变相涨价"负面；Superlist 用「Super 层 $25/月（年付 $249）解锁无限 AI」保留分层。两者都把 AI 放在付费墙后。
2. **自动排期是空白格**：Notion 明确不做（Notion Calendar 只渲染已带时间的数据库项），Superlist 未见。这是一个尚未被两大竞品占据的差异化位。
3. **模型透明度差异巨大**：Notion 公开点名 OpenAI/Anthropic/Google，公布模型清单与 $/task 成本、零数据保留要求，甚至公开 opt-out 的实验方法学；Superlist 完全不公开模型供应商。对主打隐私/自建的 heyta，「公开供应商 + 可切换 + 可审计」是可以直接对标的沟通语言。
4. **邮件入口正在被 Agent 取代**：Notion Mail 上线 17 个月即关停，官方理由是"超过一半用户从不打开收件箱，直接把邮件交给 agent"。把"邮件 → 任务"做成 agent 能力而非独立邮件客户端，是被验证过的方向。
5. **Reddit 情绪是本报告最弱的一环**（自动化抓取被拦截），若要用于对外文案，建议人工复核 §1.7 / §2.7 的 Reddit 引文原文。
