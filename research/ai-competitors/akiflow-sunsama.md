# Akiflow vs Sunsama — AI 竞品调研（截至 2026-09-25）

> 调研范围：两款「日历 + 任务」型日规划应用在 2024–2026 的 AI 能力、交互形态、自动排程、定价、模型供应商、用户口碑与定位。
> 所有事实性断言均附实际抓取到的 URL。抓取日期：**2026-09-25**（除个别页面明确标注自身日期外）。
> 标注约定：**已上线（shipped）/ 测试版（beta）/ 已宣布未上线（announced）/ 已停止（discontinued）**，能查到日期的一律给日期。
> 凡经真实检索仍无法确认的，写 **未找到公开信息**。

---

## 0. 一页速览

| 维度 | Akiflow | Sunsama |
|---|---|---|
| AI 品牌名 | **Aki**（"AI executive assistant"）+ MCP Connector + Meeting Assistant | **Sunny**（AI assistant）+ AI planned time/channel + AI-Assisted Daily Highlights + **Autoplan（beta）** |
| AI 是否单独收费 | Aki + MCP **含在 Pro 内**；Meeting Assistant **$19/月加购** | **全部含在 Pro 内**，无 AI 加购项 |
| 自动排程 | **有，但强用户触发**：Optimize schedule / ASAP，官方明说「不会未经你选择自动运行」 | **有，且明确以「用户显式动作」为边界**；2026 新增 **Autoplan（beta）** 规则化自动规划 |
| 对自动化的公开立场 | 官网主打 "Time-block your day **automatically**"；但帮助文档承认 Aki「只在你要求时行动」 | 创始人长文公开质疑全自动 AI 排程；官网 /compare 页点名 Motion 是「像老板一样告诉你做什么」 |
| 定价（2026-09-25 观察） | $34/月（月付）· $19/月（年付，$228/年）· 7 天试用需绑卡 · 无免费版 | $22/月（月付）· $17/月（年付，$204/年）· 14 天试用免绑卡 · 无免费版 |
| 模型供应商 | **公开列明**：Anthropic / OpenAI / Google / Groq（推理），ElevenLabs（语音），Recall.ai（会议录制），Vellum（编排） | 官方仅说「自托管的开源模型」+「第三方 LLM 与推理供应商」，**未点名具体厂商** |

---

# 第一部分：Akiflow

## 1. AI 功能（可溯源的确切功能名）

### 1.1 Aki — AI 执行助理

- **Aki** 是 Akiflow 的 AI 助理品牌，官网定位为 "Your Executive Assistant beyond human limits"，并称其为 "the first intelligence that unlocks multiple calendar management" [来源: https://akiflow.com/aki]。
- 定价页把 Aki 描述为 "the AI executive assistant"，并明确 **Aki 与 Akiflow MCP Connector 均包含在 Pro 计划内** [来源: https://akiflow.com/pricing]。
- **上线时间：2025-03-06，Release 2.47，状态 beta**，标题为 "Aki in app ✨ Your Personal AI Executive Assistant (beta)"。该版本说明 Aki 从 WhatsApp 扩展到「应用内」（移动端 footer、桌面端右下角），并进入 **AI Center Settings** 页面 [来源: https://product.akiflow.com/changelog/aki-in-app-sparkles-your-personal-ai-executive-assistant-beta]。
- 同一版本列出 Aki 的**自动化（automations）**能力：每日天气播报、检查日历冲突、比特币价格监控、日程每日总览、按天气安排晨跑等；可把 Aki 的既有能力设为周期性自动运行。原文补充："The only thing automations can't do is create other automations." [来源: https://product.akiflow.com/changelog/aki-in-app-sparkles-your-personal-ai-executive-assistant-beta]

### 1.2 Aki 的接入渠道

官方帮助文档《Meet Aki: Your Personal Assistant》列出四种入口 [来源: https://product.akiflow.com/help/articles/9441910-meet-aki-your-personal-assistant]：

| 渠道 | 细节 |
|---|---|
| 应用内聊天 | 按 `A` 呼出；桌面端右下角图标；移动端在 Daily Dashboard 或新建任务/事件/时间段时的麦克风图标 |
| 邮件 | 把邮件转发到 `aki@akiflow.com`；仅在 Aki 为**主收件人（To）**时处理，CC/BCC 不处理 |
| WhatsApp | Settings → AI Center → Aki on WhatsApp，绑定手机号 + 激活码 |
| Siri | "Hey Siri, create a task in Akiflow"；文档注明**目前仅支持英文**，且建议用两步指令（先说 "Use Akiflow"） |

- **语音输入规格**：文字支持 **50+ 语言**，语音支持 **30+ 语言**并转写 [来源: https://product.akiflow.com/help/articles/9441910-meet-aki-your-personal-assistant]。
- 移动端语音捕获：**按住主 `+` 按钮录音，松手后点 Send**，Aki 处理期间可继续使用 Akiflow [来源: https://product.akiflow.com/help/articles/9441910-meet-aki-your-personal-assistant]；Release 2.81（2026-09-10）把这条列为移动端新功能 "Tap to record on mobile" [来源: https://product.akiflow.com/changelog]。
- 更早的移动端语音优化：2026-01-12 "🚀 New Mobile Navigation + Faster Audio Capture"，原文 "Capturing tasks via voice is now smoother and faster. We reduced friction so you can talk to Aki instantly" [来源: https://product.akiflow.com/changelog/rocket-new-mobile-navigation-faster-audio-capture]。

### 1.3 Meeting Assistant（AI 会议助理）

- 功能：自动加入 Zoom / Google Meet / Microsoft Teams 会议并录制转写（含说话人识别）、生成 AI 摘要、自动识别 action items 并可一键建任务、AI 起草跟进邮件、音频回放 [来源: https://product.akiflow.com/help/articles/9068850-meeting-assistant]。
- **它是唯一单独收费的 AI 功能**：定价页 FAQ 原文 "The AI Meeting Assistant for recording, transcripts, summaries, and action items is an optional $19-per-month add-on." [来源: https://akiflow.com/pricing]
- 在设置中位于 **Settings → AI Center → Meeting Assistant** [来源: https://product.akiflow.com/help/articles/9068850-meeting-assistant]。
- 2026-07-22 Release 2.78 "🤖 Meeting Assistant Everywhere"：action items 主动推送、Aki bot 可按需加入任意会议 [来源: https://product.akiflow.com/changelog]。

### 1.4 Schedule Optimizer（含 Optimize schedule 与 ASAP）

- **上线：2026-06-25，Release 2.76「Akiflow Summer Release」**，官方称 "This is our biggest release of the year"，其中一项即 "can auto-optimize schedule for you" [来源: https://product.akiflow.com/changelog/sunny-akiflow-summer-release]。
- 两个子能力 [来源: https://product.akiflow.com/en/help/articles/3161671-schedule-optimizer]：
  - **Optimize schedule** — 当你 resize / 移动任务造成重叠或空档后，日历上出现该按钮，点击后重排「受影响点之后」的任务；确认 toast 提供 **Undo**。
  - **ASAP** — 把单个任务放进「今天下一个可用时段」，入口在任务的 Plan / Replan 菜单，显示具体时间（如 "ASAP 2:30 PM"）；同样有 **Undo**。

### 1.5 MCP Connector

- **上线：2026-06-25（Release 2.76）**，托管 MCP server，URL `https://mcp.akiflow.com/mcp`，连接 Claude、ChatGPT、Cursor 等 MCP 客户端 [来源: https://product.akiflow.com/changelog/sunny-akiflow-summer-release] [来源: https://product.akiflow.com/articles/4302815-akiflow-mcp]。
- 能力清单（官方文档）：查看/过滤日程、建任务与子任务、把任务 plan 到日/周/月、读写 Inbox / Someday、建改 time slots、改优先级/项目/时长/完成状态、建改取消日历事件、回复会议邀请（Google/Outlook，**iCloud 不支持 RSVP**）、读取 Meeting Assistant 转写 [来源: https://product.akiflow.com/articles/4302815-akiflow-mcp]。
- 连接使用 **OAuth**，"so you stay in control of what your AI can access" [来源: https://product.akiflow.com/changelog/sunny-akiflow-summer-release]。
- Akiflow 自家博客（2026-06-26，2026-09-23 更新）称该 MCP server 有 **19 个 action**，跨 tasks / calendar / time slots，**2026-06-30 起上线** [来源: https://akiflow.com/blog/akiflow-vs-sunsama-comparison]。
  - ⚠️ 注意此处官方两处日期不一致：Summer Release changelog 写 2026-06-25 发布，该博客写 "live since 30 June 2026"。两者都保留。

### 1.6 Work with AI

- **Release 2.80（2026-08-19）** 新增：在桌面端打开任意 task / event / time slot，选 "Work with AI"，然后选 Claude 或 ChatGPT（或复制 prompt），带着该条目的上下文跳转到对应 AI [来源: https://product.akiflow.com/changelog]。
- Akiflow 官方 LinkedIn 帖（约 2026-09 中）描述为 "Work with AI puts that context to work. Open any of them in Akiflow and continue straight into Claude or ChatGPT, with the item's context…" [来源: https://www.linkedin.com/posts/akiflow_akiflow-recently-launched-work-with-ai-activity-7505644019624857600-OMUh]
- Release 2.81 补充 "Added Claude and ChatGPT logos to the Work with AI menu" [来源: https://product.akiflow.com/changelog]。

### 1.7 Daily Dashboard（AI 简报）

- **Release 2.76（2026-06-25）** 新增，官方描述 "A new home for your day on mobile, **powered by AI**"：Morning Brief / Midday Brief / end-of-day Wrap-up 三段简报、Live Activity、**Aki Feed**；每段简报可单独开关并调整时间（在桌面端 Workflows 设置）[来源: https://product.akiflow.com/changelog/sunny-akiflow-summer-release]。

### 1.8 已宣布但未上线（announced）

akiflow.com/aki 页面把以下内容标为 **"Coming soon"** [来源: https://akiflow.com/aki]：

- **A proactive productivity coach** — 示例文案 "You have a 30-minute free slot now. Wanna review your inbox?"
- **Memory layer** — 描述为 "Your limitless second brain — 3000+ Integrations, Memory Layer, 2-Way Sync"
- **Aki can talk to people on your behalf** — "It can handle entire conversations over phone, text and emails"

> 这些在抓取日（2026-09-25）仍为 announced，未见 shipped 证据。

---

## 2. 交互形态

Akiflow 的 AI 交互是**多种形态并存**，但核心设计是「按需触发」：

| 形态 | 证据 |
|---|---|
| **聊天助手** | Aki 应用内聊天（按 `A`）、Command Bar 输入 "Text Aki"、WhatsApp、邮件 [来源: https://product.akiflow.com/help/articles/9441910-meet-aki-your-personal-assistant] |
| **语音捕获** | 移动端按住 `+` 录音；Command Bar 按 Tab 说话；30+ 语音语言 [来源: https://product.akiflow.com/help/articles/9441910-meet-aki-your-personal-assistant] |
| **自动执行（定时）** | Aki automations：可把任务/事件/天气/汇率等设为周期性自动运行，例如「每天 7:30 查巴塞罗那明天天气，好就把晨跑加进日历并提醒」 [来源: https://product.akiflow.com/changelog/aki-in-app-sparkles-your-personal-ai-executive-assistant-beta] |
| **建议（用户确认后执行）** | Optimize schedule 按钮出现 → 用户点击才重排；不点则几秒后消失，手动改动保留 [来源: https://product.akiflow.com/en/help/articles/3161671-schedule-optimizer] |
| **外部 agent 驱动** | MCP Connector 让 Claude/ChatGPT/Cursor 直接读写日程与任务 [来源: https://product.akiflow.com/articles/4302815-akiflow-mcp] |
| **上下文交接（非 agent）** | Work with AI 把条目上下文带进 Claude/ChatGPT [来源: https://product.akiflow.com/changelog] |

**关键官方表述**：Akiflow 自己的帮助文档在对比 Motion 时写道：

> "Motion decides and acts automatically for you, while Aki acts only when you ask it to. Both can make real changes to your schedule and tasks, but with Aki, **nothing happens without your request**, giving you full visibility and c[ontrol]"
> [来源: https://product.akiflow.com/help/articles/6292194-switching-from-motion-to-akiflow]

---

## 3. 自动排程：存在，但边界被官方写死

### 3.1 存在什么

- **Optimize schedule**：重排受影响点之后的任务，保持相对顺序；**不会移动**日历事件、time slots、重复任务实例、被改任务之前的任务、已完成任务；**不会把任务挪到另一天**；不按优先级/项目/截止日重排；**不拆长任务**；**不支持移动端** [来源: https://product.akiflow.com/en/help/articles/3161671-schedule-optimizer]。
- **ASAP**：单任务放进今天下一个可用时段；考虑任务时长（无时长则用默认时长）、工作时长、已排任务、日历事件与 time slots 作为固定块；若菜单里显示的时间在你点击前失效，会重新计算 [来源: https://product.akiflow.com/en/help/articles/3161671-schedule-optimizer]。

### 3.2 用户保留多少控制权（官方原文）

帮助文档专门有一节 **"What Schedule Optimizer does not do"**，逐条排除：

> "Schedule Optimizer is intentionally focused on quick, **user-approved** schedule adjustments. It does not:
> - **Run automatically without you choosing it.**
> - Plan multiple selected tasks with ASAP.
> - Plan all Inbox tasks at once.
> - Move affected tasks into another calendar day.
> - Split long tasks into smaller blocks.
> - Reorder tasks by priority, project, or deadline.
> - Move calendar events or time slots.
> - Work on mobile."
> [来源: https://product.akiflow.com/en/help/articles/3161671-schedule-optimizer]

控制手段：
- **Undo**：Optimize schedule 与 ASAP 都从确认 toast 提供 Undo [来源: https://product.akiflow.com/en/help/articles/3161671-schedule-optimizer]
- **忽略**：什么都不做 → 按钮几秒后自动消失，手动改动保留 [来源: https://product.akiflow.com/en/help/articles/3161671-schedule-optimizer]
- **手动拖拽**：官方对比文档把 "Akiflow Time Blocking" 定义为 "you drag tasks directly onto your calendar. This gives you **full control** over your schedule" [来源: https://product.akiflow.com/help/articles/6292194-switching-from-motion-to-akiflow]
- **Time Slots** 作为受保护时间块，可把任务 plan 进去 [来源: https://product.akiflow.com/help/articles/6292194-switching-from-motion-to-akiflow]

### 3.3 营销口径 vs 文档口径的落差

- 官网首页大量使用自动化措辞：**"Time-block your day automatically"**、**"Schedules for you. In one click."**、**"Team scheduling on autopilot"**、**"Plan your day, week, automatically"**、**"Stay goal-aligned with AI nudges"** [来源: https://akiflow.com/]
- 但产品文档把自动排程限定为**单任务、同日、用户点击触发** [来源: https://product.akiflow.com/en/help/articles/3161671-schedule-optimizer]
- 第三方评测也读到了这个落差：
  - Morgen（2026-05-06）："It **lacks advanced AI scheduling features**" [来源: https://www.morgen.so/blog-posts/akiflow-pricing]
  - Saner.AI 的 pros/cons 表把 "**AI doesn't auto-schedule your day**" 列在 Cons [来源: https://www.saner.ai/blogs/akiflow-reviews]
- Akiflow 自己的 feature request 板上仍有 "Auto-Schedule Tasks onto Calendar with **Dynamic Rescheduling**" 的需求帖，说明动态重排尚未成为产品能力 [来源: https://product.akiflow.com/p/auto-schedule-tasks-onto-calendar-with-dynamic-rescheduling]

---

## 4. 定价（观察日期：2026-09-25）

全部数字来自当日抓取的 https://akiflow.com/pricing：

| 项目 | 数字 |
|---|---|
| **Pro Monthly** | **$34** / 月 / 用户（按月计费） |
| **Pro Yearly** | **$19** / 月（按年计费，**$228 一次性/年**），页面标 "Save 44% yearly"，并带 "PROMO" 标签 |
| **免费试用** | **7 天**完整功能试用；**需要绑卡**；未取消则试用后自动开始订阅 |
| **免费版** | **无**。定价页 FAQ 原文 "No. Akiflow has no free plan." |
| **Believer（长期承诺）** | **$357.60 / 两年（$14.90/月）** 或 **$699 / 五年**；官方强调这不是功能受限的独立计划，只是更长的 Pro 承诺 |
| **AI 是否额外收费** | **Aki + MCP Connector 含在 Pro 内**；**Meeting Assistant 是 $19/月的可选加购** |
| **Pro 包含** | tasks、subtasks、calendar planning、integrations、power features、Aki、hosted MCP Connector、**免费 1:1 onboarding call** |
| **学生/研究者** | 学术邮箱验证后 **Pro Yearly 终身 40% off**；Believer 亦可适用，需邮件 support@akiflow.com |
| **团队定价** | **不走自助按席定价**，需联系销售 |
| **地区差异** | 可能在部分国家/地区适用购买力平价（PPP）定价，以结账页显示为准 |

[来源: https://akiflow.com/pricing]

补充：
- 官方对比博客（2026-09-23 更新）复述同一组数字：$34/月月付、$19/月年付（$228/年）、7 天试用需绑卡、无免费版 [来源: https://akiflow.com/blog/akiflow-vs-sunsama-comparison]
- Meeting Assistant 的 $19/月加购亦见于第三方：Morgen 称 "Meeting Assistant costs an additional $19/month … monthly spend from $19 to $38" [来源: https://www.morgen.so/blog-posts/akiflow-pricing]

---

## 5. 模型供应商与云/端侧

### 5.1 官方 AI 子处理者名单（Akiflow 公开列明）

**这是本次调研中 Akiflow 最有价值的一手材料。** https://akiflow.com/sub-processors-for-ai/ 逐条列出：

| 供应商 | 处理内容（官方原文） |
|---|---|
| **Anthropic PBC** | text-analysis and inference |
| **OpenAI**（OpenAI Ireland Limited / OpenAI OpCo, LLC） | text-analysis and inference |
| **Google LLC** | text-analysis and inference |
| **Groq, Inc.** | text-analysis and inference |
| **Eleven Labs Ltd.** | text to speech & AI voice generator |
| **GetStream.io, Inc.** | real-time chat |
| **Hyperdoc Inc.**（联系邮箱为 recall.ai） | video/audio recordings and transcripts generation |
| **Vellum, Inc.** | orchestrating and monitoring AI-features |

[来源: https://akiflow.com/sub-processors-for-ai/]

→ **结论：多供应商云端推理（Anthropic + OpenAI + Google + Groq），不是单一厂商，也不是端侧。**

### 5.2 数据与训练声明

- Akiflow 有专门的 **Privacy Policy Addendum for AI Features**，AI 功能为 **opt-in**："If you choose not to enable these features, we will not access or process any user-generated content or other data beyond what is specified in the main Privacy Policy." [来源: https://akiflow.com/privacy-policy-ai-addendum]
- 训练声明原文："This content is **never used to train or fine-tune general-purpose AI models** beyond your organization. All processing is limited to real-time or short-term use and remains strictly confined within your account environment." [来源: https://akiflow.com/privacy-policy-ai-addendum]
- 用户可随时在账户设置中关闭 AI 功能 [来源: https://akiflow.com/privacy-policy-ai-addendum]
- **Meeting Assistant 的额外披露**：使用第三方（官方举例 **Recall.ai**）捕获、处理、临时存储音视频；**Media Files 保留最长 60 天**后自动永久删除；**Derived Content（转写、摘要）作为持久用户数据保留**至账户删除或用户主动删除；用户需自行负责取得其他参会者的录音同意 [来源: https://akiflow.com/privacy-policy-ai-addendum]
- MCP 连接走 OAuth [来源: https://product.akiflow.com/changelog/sunny-akiflow-summer-release]

### 5.3 端侧

未找到公开信息 — Akiflow 所有已披露的 AI 处理路径均为云端第三方子处理者，官方文档未出现任何 on-device / 本地推理的表述。

---

## 6. 用户口碑

### 6.1 评分（第三方聚合）

| 平台 | 评分 | 评论数 | 来源 |
|---|---|---|---|
| G2 | **4.8 / 5** | 95 | [来源: https://hirekai.ai/blog/akiflow-pricing] |
| Capterra | **4.7 / 5** | 106 | [来源: https://www.capterra.com/p/232035/Akiflow/] |
| SoftwareAdvice | 4.7 / 5 | 106 | [来源: https://www.softwareadvice.com/scheduling/akiflow-profile/reviews/] |
| Trustpilot | **4.4 / 5** | 233 | [来源: https://www.trustpilot.com/review/akiflow.com] |
| Google Play | **3.7 / 5** | 338 | [来源: https://play.google.com/store/apps/details?id=com.akiflow.mobile] |

> 注意 **G2 4.8 与 Trustpilot 4.4 / Play 3.7 的落差**：高分集中在桌面生产力体验，低分集中在计费与移动端。

### 6.2 最有价值的称赞

1. **Universal Inbox 真正消灭重复录入** — 官方 review 页原文 "I no longer have to jump between 5 different tabs just to see what's on my plate, which instantly eliminated context switching" [来源: https://akiflow.com/reviews]
2. **键盘优先的录入与重排速度** — "I really appreciate Akiflow for its speed in entering tasks and moving them around. The flow is much faster compared to other products, where you have to click a lot more" [来源: https://akiflow.com/reviews]
3. **Time blocking 的实际效果** — "This is where Akiflow beats my attempts to time-block using Todoist. I spend far less time managing the tool and more time actually working." [来源: https://akiflow.com/reviews]
4. **客服质量被反复点名** — 多位用户点名 Cecile / Peache / Jayrich / John："the customer support is excellent. Fast, helpful, and very human — no annoying bot replies." [来源: https://akiflow.com/reviews]
5. **AI 的「主动提醒」被正面评价** — "I really like the integrated AI because it checks up on me, reminds me of things I forget, and helps me structure meetings super quick and easy." [来源: https://akiflow.com/reviews]

### 6.3 最常见的抱怨

#### (a) 计费与取消 —— 最响的抱怨

- Trustpilot 页面摘要：**"Some reviewers were not happy with unexpected charges occurring right after trial periods and experienced difficulties … billing disputes and account access"** [来源: https://www.trustpilot.com/review/akiflow.com]
- 有用户在 Trustpilot 写道："On Oct 27, 2024, I was charged $228 for an annual subscription renewal that I was not aware of. Unlike other legitimate subscription services which send reminder and confirmation emails, I received zero notice from Akiflow." [来源: https://www.saner.ai/blogs/akiflow-reviews]（该页引用了 Trustpilot 原文并附链接）
- 取消后仍被扣款的个例："I've now been charged $500+ for a subscription I cancelled. I have the cancellation email. Support keeps telling me to wait." [来源: https://hirekai.ai/blog/akiflow-pricing]（引用自 https://www.reddit.com/r/Akiflow/comments/1qhy697/yet_another_charged_cancellation/）
- Reddit 上出现 "Akiflow is a predatory business" 一类帖子标题 [来源: https://www.reddit.com/r/ProductivityApps/comments/1qkvuls/akiflow_is_a_predatory_business/]
- 7 天试用被认为过短：有帖子标题即 "The trap behind Akiflow's 7-day free trial — charged…" [来源: https://www.reddit.com/r/ProductivityApps/comments/1qn9ppw/the_trap_behind_akiflows_7day_free_trial_charged/]
- 第三方总结："Billing is the loudest complaint on Trustpilot and Reddit." [来源: https://www.saner.ai/blogs/akiflow-reviews]

#### (b) 价格

- 第三方汇总的用户评价："Reddit users regularly describe the monthly rate as **'really high'** and **'outrageously priced'** compared to what competitors charge, and there's no free plan to test before committing." [来源: https://www.saner.ai/blogs/akiflow-reviews]
- Saner.AI 给出分项评分：**Value for Money 3.2 / 5**，Overall 3.4 / 5 [来源: https://www.saner.ai/blogs/akiflow-reviews]
- alfred 的评测："At $34/month with only a 7-day trial, Akiflow is an expensive experiment." [来源: https://get-alfred.ai/blog/is-akiflow-worth-it]
- 连 Akiflow 自己的对比博客都承认："We are not the cheap option here" / "there is no free plan, the trial is 7 days and asks for a card" [来源: https://akiflow.com/blog/akiflow-vs-sunsama-comparison]

#### (c) AI 可靠性

- Reddit 差评（标题 "My unfiltered review of Akiflow"）摘要：**"Akiflow is a massive scam. The AI is garbage, it can't even tell you when a specific event is. It can't create recurring events."** [来源: https://www.reddit.com/r/ProductivityApps/comments/1md184r/my_unfiltered_review_of_akiflow/]
- Saner.AI 给出 **AI Capabilities 2.8 / 5**，并把 "AI doesn't auto-schedule your day" 列入 Cons [来源: https://www.saner.ai/blogs/akiflow-reviews]
- 另一处同源总结："What it won't do is plan your day for you." [来源: https://www.saner.ai/blogs/akiflow-reviews]
- Akiflow 自己的 changelog 也承认 Aki 出过问题，例如 "Improved startup failure handling and recovery of Aki chat notifications after a session expires"、"Fixed Aki email processing for previously connected Outlook accounts" [来源: https://product.akiflow.com/changelog]

#### (d) 移动端

- Saner.AI："The mobile app is unreliable and considered by many users as an afterthought, not a real product"，Mobile Experience 仅 **2.5 / 5** [来源: https://www.saner.ai/blogs/akiflow-reviews]
- Reddit："The ios app is still horrible and I'm just thinking of not continuing with akiflow because of this. (nevertheless no watch or iPad support)" [来源: https://www.reddit.com/r/ProductivityApps/comments/1b3jmu7/definitive_answer_akiflow_is_the_best_todo_list/]
- 另一条："iOS app seems not functional, no alerts, issues in syncing, repeating tasks can't be changed sometimes" [来源: https://www.reddit.com/r/ProductivityApps/comments/1g35bex/akiflow_vs_sunsama/]

#### (e) 其他

- 无数据导出："My biggest complaint is that the app doesn't support any kind of export for tasks. I lost access to my account last week and it was really stressful not having my tasks." [来源: https://www.saner.ai/blogs/akiflow-reviews]
- 无 Apple Calendar / iCloud / CalDAV 支持 [来源: https://www.saner.ai/blogs/akiflow-reviews]（注：MCP 文档亦确认 iCloud 不支持 RSVP [来源: https://product.akiflow.com/articles/4302815-akiflow-mcp]）

---

# 第二部分：Sunsama

## 1. AI 功能（可溯源的确切功能名）

### 1.1 AI planned time + channel recommendations

- 官网功能页：创建任务时，Sunsama 自动为该任务**打上正确的 channel 并给出时间估算**，依据是「你之前在 Sunsama 里做过的同类工作」；用得越久越准 [来源: https://www.sunsama.com/features/ai]
- 官方 changelog 条目名：**"AI planned time and #channel recommendations"** — "When creating a new task, Sunsama can automatically suggest and assign a 'planned time' for the task as well as the 'channel' the task belongs in." [来源: https://roadmap.sunsama.com/changelog/ai-planned-time-and-channel-recommendations]
- 2026-06-19 扩展：**导入的日历事件也开始自动获得 AI channel 推荐** [来源: https://roadmap.sunsama.com/changelog/weekly-product-changelog-june-19-2026]

### 1.2 AI-Assisted Daily Highlights

- 官方功能页标题 **"AI-Assisted Daily Highlights"**，副标题 "End-of-day highlights, filled in automatically"；工作清单由 AI 基于你在各工作工具中的活动**自动生成并摘要**，可编辑、可分享到 Slack / Teams / email [来源: https://www.sunsama.com/features/daily-highlights]
- 帮助文档：highlights 部分由排序算法自动纳入，**AI 生成的摘要可编辑或隐藏**；可从 Settings 关闭自动生成 AI 摘要 [来源: https://help.sunsama.com/docs/usage-guides/daily-highlights/]
- 官方关闭入口：Settings > AI 可禁用任何自动生成的 AI 摘要 [来源: https://roadmap.sunsama.com/improvements/p/option-to-disable-ai-summarizer-in-daily-highlights]
- **上线时间**：官方 changelog 原文 "We're excited to officially launch Daily Highlights. **This was our big project of 2024**, and it's now available to everyone." [来源: https://roadmap.sunsama.com/changelog/daily-highlights]
  - ⚠️ 该 changelog 条目本身未标注日期；「2024 年的大项目」是官方自述，故可定位到 2024 年内立项、其后正式发布。另有官方博客《Why we built it: Daily Highlights》标注 **2025-01-14** [来源: https://www.sunsama.com/blog/why-we-built-it-daily-highlights]

### 1.3 Sunny the AI Assistant

- 官方帮助文档标题即 **"Sunny the AI Assistant"**；描述 "Sunny is Sunsama's built-in AI assistant. You can chat with Sunny to create and manage tasks, plan your day, organize your backlog, review your work, and do just about anything you'd normally do in Sunsama" [来源: https://help.sunsama.com/docs/usage-guides/sunny/]
- **启用位置：Settings → Integrations → AI Assistant**；启用后点右下角 **sparkle 按钮（✦）** 打开聊天面板 [来源: https://help.sunsama.com/docs/usage-guides/sunny/]
- Sunny 的权限范围（官方原文 "Sunny has full access to your tasks, calendar, backlog, objectives, and settings"）[来源: https://help.sunsama.com/docs/usage-guides/sunny/]：
  - **Manage tasks** — 增删改移任务、完成/取消完成、加子任务、设时间估算、启停计时器、分配到 channel、对齐 weekly objective、timebox 到日历、管理重复任务
  - **Plan your day** — 审视日程、重排任务列表、把日历事件拉成任务、接受/拒绝会议邀请
  - **Work with your backlog** — 审视未排任务、分配 folder、移到指定日期
  - **Review your work over time** — 任意时间范围（上周/上月/指定区间）的工作总结
  - **Adjust settings** — 设置 shutdown time、更新日历导入偏好
- **语音**：点麦克风按钮或按 `Y` 切换语音助手 [来源: https://help.sunsama.com/docs/usage-guides/sunny/]
- **Braindump**：Sunny 面板里的 Braindump 按钮打开 backlog，可粘贴或口述一串任务，Sunny 会整理 [来源: https://help.sunsama.com/docs/usage-guides/sunny/]
- **对话历史**：自动保存，可 New chat / History / Close；会话按首条消息命名 [来源: https://help.sunsama.com/docs/usage-guides/sunny/]
- 2026-06-05：**Sunny reasoning** — "Sunny now shows its thinking process as a collapsible summary while it works" [来源: https://roadmap.sunsama.com/changelog/weekly-product-changelog-june-5-2026]
- 2026-09-23：Sunny 可总结任意日期区间的工作（可按 channel 收窄）；聊天面板可拖宽、每个会话保留自己的草稿；**Sunny 的语音功能只在打开语音时加载，其他页面不碰麦克风** [来源: https://roadmap.sunsama.com/changelog]
- **状态变更**：**2026-09-01，Sunny 与 MCP 正式脱离 Beta**（"Sunny and MCP are now fully available; no more 'Beta' badges."），但官方同时注明 **"Voice mode is still labeled experimental since it's flakier than chat."** [来源: https://roadmap.sunsama.com/changelog]

### 1.4 MCP server

- 官方文档：远程托管 MCP server，URL **`https://api.sunsama.com/mcp`**，使用 **OAuth** 认证 [来源: https://help.sunsama.com/docs/integrations/mcp/]
- 已给出一手配置步骤的客户端：**ChatGPT**（内置 plugin 目录，管理员可全工作区安装）、**Claude（Pro/Team）**、**Claude Desktop**、**Cursor**、**Claude Code**、**Notion（付费）**，以及任意 MCP 客户端 [来源: https://help.sunsama.com/docs/integrations/mcp/]
- 能力演进：
  - 2026-08-21：支持 channel 管理；粘贴 17 种服务的链接会生成带预览和深链的真实任务 [来源: https://roadmap.sunsama.com/changelog/weekly-product-changelog-august-21-2026]
  - 2026-06-19：支持 `edit_task_notes` / `append_task_notes` [来源: https://roadmap.sunsama.com/changelog/weekly-product-changelog-june-19-2026]
  - 2026-09-23：AI 应用可读写任务评论；连接不再 30 天过期；授权页会说明访问去向并警告「应用名和 logo 可能是伪造的」 [来源: https://roadmap.sunsama.com/changelog]

### 1.5 Autoplan（beta）— 2026 年最重要的新变化

- **官方 changelog（2026-09-23）**，条目名 "Autoplan beta" [来源: https://roadmap.sunsama.com/changelog]：
  - "Autoplan rules now have their own page, where you can **view, edit, create, pause, and delete** them."
  - "When you save a rule while chatting with Sunny, you get a link straight to it."
  - "Sunny now opens beside the **Autoplan review** with a briefing of the run. From there it can **undo any change** or start a fresh run."
  - "An Autoplan run with nothing to sort now finishes with a review instead of disappearing…"
- 更早的痕迹：2026-07-24 changelog 提到 "Tasks and subtasks created via **Autoplan** or MCP with a linked Gmail thread now open the correct email" [来源: https://roadmap.sunsama.com/changelog/weekly-product-changelog-july-24-2026]
- 用户侧说明其开关位置：Reddit 评论 "It's called **'Autoplan'** and can be turned on in **Settings > Beta**." [来源: https://www.reddit.com/r/todoist/comments/1va8mpv/i_have_tasks_that_are_not_scheduled_yet_they_are/]
- **状态判定：beta**（官方在 2026-09-23 明确以 "Autoplan beta" 为标题；未见其进入正式版的证据）。
- 官方未发布独立的 Autoplan 帮助文档页（尝试 https://help.sunsama.com/docs/usage-guides/autoplan/ 会回落到帮助首页 [来源: https://help.sunsama.com/docs/usage-guides/autoplan/]）——**Autoplan 的完整规则语义与数据来源：未找到公开信息。**

### 1.6 其他 AI 相关

- 官方博客《How AI Can Revolutionize Your Productivity》（2025-03-11）把 Daily Highlights 作为 Sunsama 的 AI 代表功能 [来源: https://www.sunsama.com/blog/how-ai-can-revolutionize-your-productivity-the-ultimate-guide-for-modern-professionals]
- 官方博客（2025-04-25）提到正在构建 **"a highly experimental Voice AI that can update your Sunsama while you're walking or driving"** [来源: https://www.sunsama.com/blog/when-less-is-more-building-thoughtful-products-in-the-age-of-ai] → 与后来的 Sunny voice mode 对应，官方在 2026-09-01 仍标注 voice 为 experimental [来源: https://roadmap.sunsama.com/changelog]

---

## 2. 交互形态

| 形态 | 证据 |
|---|---|
| **聊天助手** | Sunny 面板（sparkle ✦），带对话历史与多会话 [来源: https://help.sunsama.com/docs/usage-guides/sunny/] |
| **语音捕获** | 麦克风按钮 / `Y` 键；官方标注 **experimental、"flakier than chat"** [来源: https://help.sunsama.com/docs/usage-guides/sunny/] [来源: https://roadmap.sunsama.com/changelog] |
| **Braindump（口述/粘贴成批任务）** | Sunny 面板 Braindump 按钮 [来源: https://help.sunsama.com/docs/usage-guides/sunny/] |
| **建议** | planned time 与 channel 的自动推荐，用户可改 [来源: https://www.sunsama.com/features/ai] |
| **自动生成内容** | Daily Highlights 的工作清单与摘要由 AI 自动生成（可编辑/隐藏/全局关闭）[来源: https://www.sunsama.com/features/daily-highlights] |
| **规则化自动执行** | **Autoplan（beta）** 规则可 create/pause/delete，每次运行有 review 页与 undo [来源: https://roadmap.sunsama.com/changelog] |
| **外部 agent 驱动** | MCP server，Sunny 之外的 Claude / ChatGPT / Cursor 等可直接操作任务与日程 [来源: https://help.sunsama.com/docs/integrations/mcp/] |

---

## 3. 自动排程：Sunsama 的立场与事实（本节是本次调研最重要的对比）

### 3.1 先纠正一个常见误解：Sunsama **有**自动排程，且已存在多年

- 帮助文档有独立页面 **"Auto-scheduling"**：悬停任务按 `X`，或右键选 "Add to calendar"，Sunsama 会找位置放进日历 [来源: https://help.sunsama.com/docs/usage-guides/timeboxing/timeboxing-auto-scheduling/]
- 规则细节（官方）[来源: https://help.sunsama.com/docs/usage-guides/timeboxing/timeboxing-auto-scheduling/]：
  - **Settings > Schedules** 可设默认工作时间和**按 channel 的独立日程**；"Sunsama will **not** schedule tasks outside of your schedules unless you tell it to."
  - 不与日历事件重叠；必要时**把任务拆成多段**（≤1 小时只在必要时拆；>1 小时会主动拆；`Shift+X` 禁止拆分）
  - 不考虑已拒绝的会议，也不考虑标记为 "available"/"free" 的事件
  - 无空位时给三个选项：**Schedule anyway**（无视日程设置尽快排）/ **Schedule another day** / **Defer**（移到明天但不排）
  - 重复任务若设了 "at roughly" 时间，会尽量排到该时间附近，且**不使用过去的时间**
- 官方 changelog **Timeboxing 2.0** 明确写着 "🧠 **Autoscheduling** — Hover over any task, hit 'X' and Sunsama will find the best time for that task in today's schedule. **Let Sunsama take care of playing calendar Tetris.**" 同时引入 per-channel schedules、跨多天的 working sessions、**完成时自动清理未来的 working sessions**、以及双向日历同步 [来源: https://roadmap.sunsama.com/changelog/timeboxing-20]
- 更早的 **"Smart auto schedule"** changelog："Sunsama now does a better job of finding open spaces on your calendar to place tasks… ✨ And like magic, Sunsama will find a nice empty spot for it on your calendar ✨" [来源: https://roadmap.sunsama.com/changelog/smart-auto-schedule]

### 3.2 但 Sunsama 的自动排程被限定为「用户显式动作触发」

官方 /compare 页的原文（**这是他们自己划的边界，非常关键**）：

> "Sunsama's daily planning helps you build a playlist of all your tasks for today. **You can choose which ones get auto-scheduled to the calendar.**"
> "If you want predictable automatic adjustments — **Sunsama only auto-adjusts tasks when you take explicit actions in the app and never makes a mess of your meetings/calendar.**"
> [来源: https://www.sunsama.com/compare]

同一页对 Motion 的定性：

> "**Motion's auto-scheduling is like a boss that tells you what to do and when** so you don't need to think about it."
> [来源: https://www.sunsama.com/compare]

### 3.3 用户保留的控制权

| 控制手段 | 证据 |
|---|---|
| **手动拖拽** | "The simplest method is to **drag and drop** a task onto the calendar at the desired time." [来源: https://help.sunsama.com/docs/usage-guides/timeboxing/] |
| **pin / 手动固定** | Auto-sort 明确尊重 "**Your manual pins** — if you've manually dragged a task against priority order (e.g. a no-priority task above an urgent one), Sunsama assumes that's intentional and **won't move it**"；运行中的计时器任务固定在顶部 [来源: https://help.sunsama.com/docs/usage-guides/tasks/auto-sort/] |
| **一键开关** | "Go to **Settings → General → Auto-sort tasks** to enable or disable auto-sort entirely."；关闭后新任务按 "New task position"（Top/Bottom）落位，且优先级/计划时间变化不再触发重排 [来源: https://help.sunsama.com/docs/usage-guides/tasks/auto-sort/] |
| **单次覆盖** | 新建任务时用 `Cmd + Shift + Up` / `Cmd + Shift + Down` 强制置顶/置底，绕过 auto-sort [来源: https://help.sunsama.com/docs/usage-guides/tasks/auto-sort/] |
| **禁止拆分** | 自动排程时按住 `Shift+X` 阻止把任务拆成多段 [来源: https://help.sunsama.com/docs/usage-guides/timeboxing/timeboxing-auto-scheduling/] |
| **Autoplan 的 undo** | "Sunny now opens beside the Autoplan review with a briefing of the run. From there it can **undo any change** or start a fresh run." [来源: https://roadmap.sunsama.com/changelog] |
| **日程边界** | 不在 schedules 之外排程；不覆盖日历事件 [来源: https://help.sunsama.com/docs/usage-guides/timeboxing/timeboxing-auto-scheduling/] |

### 3.4 他们自己的公开立场：反「全自动 AI 排程」，但不是反 AI

创始人 **Ashutosh Priyadarshy** 2025-04-25 的长文《When Less is More: Building Thoughtful Products in the Age of AI》是最直接的官方表态 [来源: https://www.sunsama.com/blog/when-less-is-more-building-thoughtful-products-in-the-age-of-ai]。原文关键句：

> "Sunsama was just named the best AI scheduling tool by *The New York Times' Wirecutter*. I was tickled by the title since **the word "AI" isn't even on our homepage!**"
>
> "It's not that we're anti-AI… It's just that there's an unquestioned assumption that the solution to all of our problems is **more AI, in more places, to do more stuff**. I feel this pressure when I look at our competitors. **Our biggest competitor spends millions blasting ads about their fully-automated AI scheduler that just tells you what to do.** Our wisest investor strongly suggested we pivot to a fully-AI daily planner a couple years ago."
>
> "A couple years ago when our favorite investor pushed us to go full AI, we kicked the tires on the idea. **We could not convince ourselves that an exclusively AI solution could do a good enough job. Until there's an AI that's a functional simulation of your entire consciousness, memory, personality, and preferences, the AI can't be an arbiter of your intentions and what a good day feels like.**"
>
> "The AI here isn't telling you what to do, it's simply **prompting you to think more deeply than you could on your own**."
>
> "we'll keep building ways to help you get to a daily plan that reflects your intentions with less effort (real or perceived). **And yes, we'll probably use AI to do that, but only if it serves you** and supercharges your ability to live and work thoughtfully."
> [来源: https://www.sunsama.com/blog/when-less-is-more-building-thoughtful-products-in-the-age-of-ai]

他把这个产品哲学命名为 **"forced thoughtfulness"**，并引用 Wirecutter 对 Sunsama 的定义："a to-do list app **that forces you to think through your daily tasks**." [来源: https://www.sunsama.com/blog/when-less-is-more-building-thoughtful-products-in-the-age-of-ai]

同一作者 2025-05-06 的路线图文章进一步说明 Timeboxing 2.0 的方向（注意：这与「完全手动」的流行说法矛盾）：

> "we've been using and working on a new version of Timeboxing internally that **automatically fills in your day with tasks and adjusts to your schedule in real-time without you ever needing to timebox a single task manually or automatically.**"
> [来源: https://www.sunsama.com/blog/sunsama-2025-task-manager-roadmap]

### 3.5 立场的时间线（重要）

| 时间 | 事件 |
|---|---|
| 2024 | Daily Highlights 立项（官方称 "our big project of 2024"）[来源: https://roadmap.sunsama.com/changelog/daily-highlights] |
| 2025-04-25 | 创始人公开质疑全自动 AI 排程，称首页没有 "AI" 字样 [来源: https://www.sunsama.com/blog/when-less-is-more-building-thoughtful-products-in-the-age-of-ai] |
| 2025-05-06 | 路线图宣布 Timeboxing 2.0 将「自动填满你的一天并实时调整」 [来源: https://www.sunsama.com/blog/sunsama-2025-task-manager-roadmap] |
| 2026-06-19 | AI channel 推荐扩展到导入的日历事件 [来源: https://roadmap.sunsama.com/changelog/weekly-product-changelog-june-19-2026] |
| 2026-09-01 | Sunny + MCP 正式脱离 Beta（voice 仍 experimental）[来源: https://roadmap.sunsama.com/changelog] |
| 2026-09-23 | **Autoplan（beta）** 上线：规则可增删改暂停，运行有 review 页 + undo [来源: https://roadmap.sunsama.com/changelog] |

> **判断**：Sunsama 在 2025 年公开以「不做全自动」为差异化，但到 2026 年已通过 Autoplan（beta）引入了**规则驱动的自动规划**。其对外表述的护栏始终是「用户定义规则 + 运行前 review + 可 undo」，而非 Motion 式的「算法直接决定」。这个转变是 2024–2026 期间 Sunsama 定位上最重要的位移。

---

## 4. 定价（观察日期：2026-09-25）

来自当日抓取的 https://www.sunsama.com/pricing：

| 项目 | 数字 |
|---|---|
| **Pro — 年付** | **$17 / 月**（billed yearly，USD） |
| **Pro — 月付** | **$22 / 月** |
| **免费试用** | **14 天**，**无需信用卡**，全功能无限制 |
| **免费版** | **无**。定价页明示无 free forever plan 且不打算有 |
| **AI 是否额外收费** | **不额外收费**。Pro 计划特性栏直接列出 **"AI + MCP + Zapier"** |
| **Enterprise** | 需联系销售；含 **SSO & SAML、SCIM + Audit Logs、自定义隐私与数据要求** |

[来源: https://www.sunsama.com/pricing]

官方帮助文档《Billing Overview and FAQs》给出更精确的计费口径 [来源: https://help.sunsama.com/docs/billing/overview/]：

- 月付 **$22 / user / month**；年付 **$17 / user / month**，即 **$204 / user / year** 一次性扣款
- 14 天试用，**不会自动扣费**；试用到期后失去工作区访问权，需主动升级
- 试用版与付费 Pro **功能无差异**
- 工作区共享：一个 admin 为所有账号付费，**无法分别计费**
- 只能用银行卡支付
- **非营利组织**有优惠计划（联系 support@sunsama.com）
- **学生折扣**：需用有效学生邮箱（如美国 .edu）且**当前在读**；发邮件给 support@sunsama.com 说明预计毕业年月；折扣有效期至毕业或申请后 4 年（以先到者为准），**不可追溯**

官方 Pricing Manifesto 的定价原则 [来源: https://help.sunsama.com/docs/billing/pricing-manifesto/]：

- 年付 **20% off**
- **不做免费永久版**："Sunsama doesn't have a free forever plan and doesn't plan to."
- **整数定价**（不用 $21.99 这种心理定价）："No psychological trickery"
- **不做终身买断**："No lifetime deals"
- **不做假促销**："We don't do special deals for Black Friday or Cyber Monday."
- **取消要容易**：取消时只问原因，随即给取消按钮
- 价格锚点自述为 **~$1 / 工作日**

### 4.1 价格变动（第三方报道，非一手）

- Morgen（2026-04-06）："Sunsama **raised its price in 2026** for the first time in five years. The Pro plan now costs $20/month (annual) or $25/month (monthly), up from $16/month and $20/month, respectively" [来源: https://www.morgen.so/blog-posts/sunsama-pricing]
  - ⚠️ Morgen 给的 $20/$25 与 Sunsama 官网当日显示的 $17/$22 **不一致**，疑为 Morgen 观察时点较早或口径不同。
- usecarly（2026-06-30）："Yes. In early 2026 Sunsama raised prices for the first time in about five years, confirmed in its own pricing manifesto." [来源: https://www.usecarly.com/blog/did-sunsama-raise-prices/]
- **在 2026-09-25 抓取到的 Pricing Manifesto 正文中，未出现 "In 2026, after 5 years…" 这类涨价声明** [来源: https://help.sunsama.com/docs/billing/pricing-manifesto/] → 涨价表述是否为官方原文，**未找到公开信息（一手）**；仅能确认第三方报道存在。

---

## 5. 模型供应商与云/端侧

### 5.1 官方一手表述（有内部张力，需并列呈现）

**Sunsama 帮助文档《Integrations and Privacy》** [来源: https://help.sunsama.com/docs/security/privacy-notes/]：

- **AI Predictions（planned time, channels）**：
  > "We use an **open-source AI model hosted securely in our cloud environment** to find similar tasks in order to estimate planned time and channels. Your data is processed privately and is never used to train external systems. This setup ensures full control, accountability, and the highest standards of privacy and security."
- **AI Summaries**：
  > "We use an **open-source AI model hosted securely in the cloud** to write concise summaries of your activity in other tools that day… no data about inference invocations is ever retained."
- 加密与保留：传输中加密；摘要相关快照在自家数据库最多保留 **30 天**后自动删除
- **退出机制**："You can **opt out of AI features at any time from your settings page.**"；摘要可按集成逐个关闭（例如关掉邮件、保留 Asana）

**Sunsama 隐私政策** [来源: https://www.sunsama.com/privacy]：

- 服务商章节把 AI 归类为：**"AI services: Third-party LLMs and inference providers for powering our AI features (such as summaries and predictions)"**
- 并加限定："**For AI services specifically:** We require that AI service providers do not use your data to train their general models and that they process your information solely to provide the AI features you've requested."
- 更醒目的加粗声明：**"Our Commitment: We Never Train Models on Your Data."** — "Your personal tasks, calendar information, notes, and usage patterns are never used to train AI models - not ours, not third-party providers', not anyone's."
- 托管：**Google Cloud Platform (GCP) 与 AWS**；支付 Stripe；分析 HyperDX；客服 Intercom；安全/防机器人 Cloudflare

### 5.2 结论与不确定性

- **云 vs 端侧**：**明确是云端**。官方两处都写 "hosted securely in our cloud environment" / "hosted securely in the cloud" [来源: https://help.sunsama.com/docs/security/privacy-notes/]。**未找到任何 on-device / 本地推理的官方表述。**
- **具体模型厂商名称**：Sunsama 官方页面只写 "open-source AI model"（自托管）与 "third-party LLMs and inference providers"，**未点名任何厂商**。
  - 关于 "OpenAI / Anthropic" 的说法，出现在 *The New York Times / Wirecutter* 的《The Best AI Scheduling App Makes You Do the Hard Work》（2026-05-18）摘要中：**"Its AI chat is powered by third-party providers, including OpenAI and Anthropic, but Sunsama says it does not let…"** [来源: https://www.nytimes.com/wirecutter/reviews/best-ai-scheduling-apps/]
  - ⚠️ 该文为付费墙内容，本次**仅取得检索摘要、未能抓取全文**。因此「Sunny 聊天由 OpenAI 与 Anthropic 驱动」这一条**应视为未充分核实的第三方说法**。
- **MCP**：远程托管、OAuth 认证 [来源: https://help.sunsama.com/docs/integrations/mcp/]
- **明确的厂商名（一手）**：**未找到公开信息**。

### 5.3 可验证的 AI 可靠性线索（官方自述）

- "Voice mode is still labeled **experimental since it's flakier than chat**." [来源: https://roadmap.sunsama.com/changelog]
- "Sunny no longer replies **'Got it'** to questions you actually wanted answered, and no longer shows **a wall of red error text** when Sunsama updates while your tab is open." [来源: https://roadmap.sunsama.com/changelog]
- "If you stop Sunny mid-answer and send a new message, the work Sunny had already done is no longer erased." [来源: https://roadmap.sunsama.com/changelog]

---

## 6. 用户口碑

### 6.1 评分（第三方聚合）

| 平台 | 评分 | 评论数 | 来源 |
|---|---|---|---|
| Capterra | **4.7 / 5** | 27 | [来源: https://www.capterra.com/p/145616/Sunsama/reviews/] |
| SoftwareAdvice | 4.7 / 5 | 27 | [来源: https://www.softwareadvice.com/scheduling/sunsama-profile/reviews/] |
| Trustpilot | **4.0 / 5** | 4 | [来源: https://www.trustpilot.com/review/sunsama.com] |
| G2 | 评论页存在但本次未取得独立抓取结果 | — | [来源: https://www.g2.com/products/sunsama/reviews] |

> Trustpilot 仅 4 条评论，样本极小，不宜作为结论依据。

### 6.2 最有价值的称赞

1. **引导式日规划的仪式感本身即价值** — 官方自述与第三方一致："Sunsama's strongest praise centers on rituals, time estimates, and shutdown reviews." [来源: https://checkthat.ai/brands/sunsama/reviews]
2. **「被迫思考」带来的减负** — "They praise the outcomes of **manual planning, such as reduced overwhelm and better boundaries**" [来源: https://checkthat.ai/brands/sunsama/reviews]
3. **对工作量的现实感** — "Sunsama is great at creating a list of actionable daily tasks." / "It actively helps me to maximize efficiency without overloading my day." [来源: https://www.softwareadvice.com/scheduling/sunsama-profile/reviews/]
4. **日历集成与时间追踪** — "Sunsama has a lot of other unique features (time tracking, integrations, etc.) that in my opinion justify the price" [来源: https://www.reddit.com/r/Sunsama/comments/1dmlmsc/anyone_using_sunsama_for_personal_life/]
5. **被 Wirecutter 评为最佳 AI 排程工具**（2025 年）— 由 Sunsama 官方博客自述并链接至 NYT [来源: https://www.sunsama.com/blog/when-less-is-more-building-thoughtful-products-in-the-age-of-ai]
6. **社区「Love」页**：官方收集的用户原话包括 "Sunsama has an absolutely beautiful UI and is so well thought out. Very impressive for a small team of engineers." [来源: https://www.sunsama.com/love]

### 6.3 最常见的抱怨

#### (a) 价格 —— 最普遍

- r/productivity 高赞帖原文：**"I like Sunsama, but I really don't think it's worth $200/year. That is orders of magnitude more expensive than any other todo and organisation app on the planet. I've gone to pay twice now and just cancelled."** [来源: https://www.reddit.com/r/productivity/comments/x6357l/sunsama_price_worth_it/]
- "What does sunsama do thats woth 20 dollars monthly? … i cannot see any feature that would be worth 20 US dollars monthly!" [来源: https://www.reddit.com/r/ProductivityApps/comments/1s70ida/what_does_sunsama_do_thats_woth_20_dollars_monthly/]
- 第三方汇总："Reddit discussions echo the same concern, with some users saying they like Sunsama but cannot justify the cost. **The absence of a free tier matters** because competitors offer free plans, including Reclaim.ai's free Lite plan and Routine's free tier alongside lower-cost paid plans." [来源: https://checkthat.ai/brands/sunsama/reviews]
- Saner.AI 的 Cons 首条：**"$25/month with zero free plan — expensive for what it does"** [来源: https://www.saner.ai/blogs/sunsama-reviews]
- ⚠️ 注意 Sunsama 自己的立场是**刻意**不给免费版："Free forever plans create bad incentives, and aren't sustainable" [来源: https://help.sunsama.com/docs/billing/pricing-manifesto/] —— 也就是说这条抱怨是产品哲学的必然代价，不是疏漏。

#### (b) 「手动」需要自律

- "Sunsama doesn't automatically schedule or prioritize your tasks for you, **YOU need to do that each day**, so if you forget or it falls to the…" [来源: https://efficient.app/apps/sunsama]
- "Sunsama assumes you can show up every day to plan; **it rewards that discipline handsomely, but it does not create it**." [来源: https://skedul.ai/blog/sunsama-vs-motion-vs-reclaim]
- "Sunsama's guided daily planning is beautiful but **takes 10-15 minutes**." [来源: https://locu.app/alternative/sunsama]

#### (c) AI 能力被评「保守 / 单薄」

- CheckThat.ai 的小标题即 **"Modest AI Implementation"**，并指出评论者 "praise the outcomes of manual planning … **without crediting or critiquing the AI components by name**" [来源: https://checkthat.ai/brands/sunsama/reviews]
- Saner.AI（2026-03-01）Cons 第二条：**"No meaningful AI features — everything is manual"** [来源: https://www.saner.ai/blogs/sunsama-reviews]
- 有第三方（ellieplanner，2026）直接断言 "Sunsama has no AI at all" [来源: https://ellieplanner.com/comparisons/sunsama-vs-akiflow] —— 该断言与 Sunsama 官网 AI 功能页存在明显冲突 [来源: https://www.sunsama.com/features/ai]，说明**市场对其 AI 的认知严重落后于产品实际**。
- Softcrit（2026-09-25）Cons 列 "AI features…"（被截断）以及 **"No automatic task rescheduling — you are the planner, not the passenger"** [来源: https://softcrit.com/best-task-tools/]

#### (d) AI 可靠性

- **Sunsama 自己的 changelog 是最好的证据来源**：
  - "Voice mode is still labeled **experimental since it's flakier than chat**." [来源: https://roadmap.sunsama.com/changelog]
  - "Sunny no longer replies 'Got it' to questions you actually wanted answered, and no longer shows **a wall of red error text**…" [来源: https://roadmap.sunsama.com/changelog]
  - "Fixed a bug where an unrecognized Google Calendar permission could **freeze your whole workspace on a loading spinner**." [来源: https://roadmap.sunsama.com/changelog]
  - "A summary that fails to load no longer spins forever." [来源: https://roadmap.sunsama.com/changelog]

#### (e) 移动端与同步

- "The iOS app is **embarrassingly bad** for such an expensive product." [来源: https://www.reddit.com/r/Sunsama/comments/1dmlmsc/anyone_using_sunsama_for_personal_life/]
- "Sunsama's app is not reliable, tasks even don't get synced sometimes. It also has no functional iOS widgets." [来源: https://www.reddit.com/r/todoist/comments/1dy8a4c/my_current_todoist_workflow_with_sunsama/]
- "Windows and Android clients lag the Mac app in features and polish" [来源: https://softcrit.com/best-task-tools/]
- 第三方汇总的抱怨聚类："The complaints cluster around **price, mobile limitations, and thin project tracking**." [来源: https://yespress.io/products/sunsama]

#### (f) 大局项目管理偏弱

- "Sunsama is great at creating a list of actionable daily tasks. **Where it lacks is its ability to plan projects on a larger scale.**" [来源: https://www.softwareadvice.com/scheduling/sunsama-profile/reviews/]
- "Sunsama is deliberately weak at big-picture project planning — most of its users keep Trello or Asana running alongside it." [来源: https://softcrit.com/best-task-tools/]

---

# 第三部分：定位对比 —— Akiflow「AI-first」 vs Sunsama「反自动化 / 反 AI 炒作」

## Akiflow 的 AI-first 定位（自家措辞）

- 首页主标题结构即为 **"One app for tasks & calendars / powered by AI"**，副标题 "Save hours every week with your calendars, tasks, and assistant. All in one place." [来源: https://akiflow.com/]
- 首页宣称 "Time-block your day **automatically**"、"Schedules for you. **In one click.**"、"Team scheduling **on autopilot**"、"Plan your day, week, **automatically**"、"Stay goal-aligned with **AI nudges**" [来源: https://akiflow.com/]
- 产品页把 Aki 称为 "Your **Executive Assistant beyond human limits**"、"The first intelligence that unlocks multiple calendar management" [来源: https://akiflow.com/aki]
- 把 MCP 定位为让已有 AI（Claude / ChatGPT / Cursor）直接操作 Akiflow：Akiflow 自家博客称其为 "**Agents can drive it**" [来源: https://akiflow.com/blog/akiflow-vs-sunsama-comparison]
- 与 Sunsama 的对比中，Akiflow 把自己描述为速度与捕获广度的一方，并把 Sunsama 概括为「仪式感优先、刻意缓慢」："Sunsama guides you through a daily planning ritual and a weekly review, and is **deliberately calm and slow**." [来源: https://akiflow.com/blog/akiflow-vs-sunsama-comparison]

## Sunsama 的反自动化 / 反 AI 炒作立场（自家措辞）

- 创始人 2025-04-25 长文是最完整的表态，已在 §3.4 全文引用。核心三句：
  1. "**the word 'AI' isn't even on our homepage!**"
  2. "**Our biggest competitor spends millions blasting ads about their fully-automated AI scheduler that just tells you what to do.**"
  3. "**We could not convince ourselves that an exclusively AI solution could do a good enough job.** … the AI can't be an arbiter of your intentions and what a good day feels like."
  [来源: https://www.sunsama.com/blog/when-less-is-more-building-thoughtful-products-in-the-age-of-ai]
- 官方 /compare 页用**客户原话**强化反自动排程立场：
  - 关于 Motion："At first, I really liked the auto-populating of tasks in Motion. **After a few days it felt like a big mess.** I found the intentional daily planning in Sunsama helped a lot." — Kim H.
  - 关于 Reclaim："Reclaim had some good points and features but **the AI drove me insane after a while**. I am planning to remain on Sunsama for good" — Brad H.
  [来源: https://www.sunsama.com/compare]
- 官方 /compare 页把自己的自动调整定义为「可预期」："**Sunsama only auto-adjusts tasks when you take explicit actions in the app and never makes a mess of your meetings/calendar.**" [来源: https://www.sunsama.com/compare]

## 两边措辞的**共同点**（容易被忽略）

**两家都明确否认「AI 替你决定一切」**：

- Akiflow："Motion decides and acts automatically for you, while **Aki acts only when you ask it to** … with Aki, **nothing happens without your request**" [来源: https://product.akiflow.com/help/articles/6292194-switching-from-motion-to-akiflow]
- Sunsama："**Sunsama only auto-adjusts tasks when you take explicit actions in the app**" [来源: https://www.sunsama.com/compare]

→ 真正与两家都形成对比的是 **Motion / Reclaim 式的全自动排程**，而不是 Akiflow 与 Sunsama 之间。二者的差异更多在于**表面积与语气**（Akiflow 用 "automatically / autopilot" 做营销，Sunsama 用 "forced thoughtfulness" 做营销），而非「有无自动排程」这一二元事实。

## 立场位移提醒

Sunsama 2025 年公开以「不做全自动」为差异化，但 **2026-09-23 上线了 Autoplan（beta）**，官方允许规则被 create / pause / delete，并有运行 review 与 undo [来源: https://roadmap.sunsama.com/changelog]。同时首页导航与产品线已明确出现 AI 功能页 [来源: https://www.sunsama.com/features/ai]。**"Sunsama 没有 AI / 不做自动化" 这类说法在 2026 年已不准确。**

---

# 附录 A：未找到公开信息的事项

| 事项 | 状态 |
|---|---|
| Akiflow 任何端侧 / on-device AI 推理 | **未找到公开信息** |
| Akiflow Aki 的「Memory layer」「proactive coach」「代打电话/短信/邮件」的实际上线时间 | **未找到公开信息**（官网截至 2026-09-25 仍标 "Coming soon"）[来源: https://akiflow.com/aki] |
| Sunsama 点名的具体 LLM 厂商（一手） | **未找到公开信息**；官方仅写 "open-source AI model" 与 "third-party LLMs and inference providers" [来源: https://help.sunsama.com/docs/security/privacy-notes/] [来源: https://www.sunsama.com/privacy] |
| Sunsama Autoplan 的规则语义、触发条件、可作用范围（独立帮助文档） | **未找到公开信息**；仅能从 changelog 与用户评论确认其存在与开关位置 [来源: https://roadmap.sunsama.com/changelog] [来源: https://www.reddit.com/r/todoist/comments/1va8mpv/i_have_tasks_that_are_not_scheduled_yet_they_are/] |
| Sunsama Pricing Manifesto 中「2026 年涨价」的官方原文 | **未找到公开信息**（2026-09-25 抓取版本无此句）；涨价仅见于第三方报道 [来源: https://www.morgen.so/blog-posts/sunsama-pricing] [来源: https://www.usecarly.com/blog/did-sunsama-raise-prices/] |
| Akiflow MCP 上线的确切日期 | **官方两处不一致**：changelog 写 2026-06-25（Release 2.76）[来源: https://product.akiflow.com/changelog/sunny-akiflow-summer-release]，官方博客写 "live since 30 June 2026" [来源: https://akiflow.com/blog/akiflow-vs-sunsama-comparison] |
| Sunsama Daily Highlights 的正式 GA 日期 | changelog 条目**未标注日期**，仅自述为 "our big project of 2024" [来源: https://roadmap.sunsama.com/changelog/daily-highlights]；配套博客标注 2025-01-14 [来源: https://www.sunsama.com/blog/why-we-built-it-daily-highlights] |

# 附录 B：方法论与限制

- 检索工具：`anysearch` CLI（`search` / `batch_search` / `extract`），共执行 **40+ 次查询**，覆盖 akiflow.com、product.akiflow.com（帮助中心 + changelog）、akiflow.com/blog、help.sunsama.com、sunsama.com（features/pricing/blog/compare/privacy）、roadmap.sunsama.com（changelog）、以及第三方评测与聚合站点。`web_search` 工具不可用（Tavily HTTP 432），未使用。
- **Reddit 正文无法抓取**：reddit.com 返回人机验证页，old.reddit.com 要求登录，`.json` 端点 extract 失败。因此所有 Reddit 证据均来自**检索结果中的摘要文本**（含引号原文），并附对应帖子 URL。这些引用**未逐条打开原帖核实上下文**，阅读时请保留这一不确定性。
- **NYT Wirecutter 为付费墙**，仅取得检索摘要，未取得全文；已在 §5.2 明确标注。
- **G2 与 Trustpilot 正文未直接抓取**（G2 有反爬，Trustpilot 仅取得页面摘要）；相关评分数字来自抓取到的第三方汇总页并已注明出处。
- 所有价格为 **2026-09-25** 观察值，两家均无免费版，且都有地区/学生/非营利差异，落地价以结账页为准。
