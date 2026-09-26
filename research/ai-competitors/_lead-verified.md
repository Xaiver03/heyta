# Lead 一手核实的事实（用于最终报告，勿直接发布）

> 核实时间：2026-09-25（本地 CST）。以下每条都在当天实际抓取了页面。
> 这些是**我本人**通过 anysearch extract / web_fetch 拿到的原文，用于交叉验证子 agent 的结论。

## Todoist

- 「Todoist Assist」官方定义：AI 工具套件，包含 **Email Assist / Filter Assist / Task Assist** 三个功能。原文：*"Todoist Assist is our AI-powered suite of tools designed to work intelligently behind the scenes… automate task creation from emails and build complex filters using natural language."* [来源: https://www.todoist.com/help/todoist/todoist-and-ai/introduction-to-todoist-assist-KgPP22q5O]
- **Task Assist** 是浏览器扩展，能做 4 件事：为目标建议任务、生成完成任务的小贴士、重写任务使其可执行、把复杂任务拆成子任务。默认不开，需手动安装。 [来源: 同上]
- **Email Assist**：转发邮件 → 自动抽取 due date / notes 变成任务。这是唯一能全局开关的 Assist 功能。 [来源: 同上]
- **Filter Assist**：自然语言生成过滤器（原文："describe what you want to see in plain language, and Filter Assist will suggest the appropriate filter"）。**目前仅英语和西班牙语**。 [来源: 同上]
- **模型与数据**：原文 *"We do not send your data directly to OpenAI. All processing flows through Todoist's secure infrastructure."* 模型来自 **AWS Bedrock 与 Google Cloud Vertex AI**；供应商承诺不用这些数据训练模型。 [来源: 同上]
- 权限分层（原文）：*"Some Todoist Assist features are available to all customers. **Pro Legacy** subscribers have access to **Filter Assist only**. **Pro** and **Business** subscribers have access to **Filter Assist**, **Task Assist**, and **Email Assist**."* [来源: 同上]
- **Ramble**（AI 语音捕获）是独立于 Assist 的第 4 个 AI 功能：语音 → 结构化任务（含日期、优先级、项目、assignee）。 [来源: https://www.todoist.com/help/todoist/todoist-and-ai/dictate-to-add-tasks-with-ramble-P1Raq7vVF]
- Ramble 发布：2026-01-21 前后（Yahoo Finance 转载官方新闻稿，标题 "Introducing Todoist Ramble: AI That Turns Natural Speech…"）。 [来源: https://finance.yahoo.com/news/introducing-todoist-ramble-ai-turns-120000959.html]
- **定价（2026-09-25 实测）**：Beginner $0；**Pro $5/user/月（年付 $60）或 $7/月（月付）**；**Business $8/user/月（年付 $96）或 $10/月（月付）**。Pro 有 7 天试用。 [来源: https://www.todoist.com/pricing] [来源: https://www.todoist.com/help/account-and-billing/plans/todoist-plans-pricing-and-billing-faq-Vq2z0HWL6]
- Business 涨价：Reddit 官方账号帖称 Business 从 $8/月或 $72/年 涨到 $10/月或 $96/年。另有用户称其订阅"从 $28.99/user/年 变成 $96/user/年"（legacy 折扣被取消）。 [来源: https://www.reddit.com/r/todoist/comments/1otieep/todoist_pricing_update_addressing_your_questions/] [来源: https://www.reddit.com/r/todoist/comments/1opy6fl/todoist_business_price_increase/]
- Ramble 在免费版就有，但**有次数限制**（pricing 对比表：Beginner = Limited sessions，Pro/Business = Unlimited sessions）。 [来源: https://www.todoist.com/pricing]
- **Automations（Beta）**：自然语言描述 → 生成可在后台定时运行的确定性工作流。官方页面原文 *"A workflow doing exactly what you told it to, not AI guessing on your behalf"*，强调「先连一次工具 / 每条自动化是可预测的预定义工作流」。示例：每晚 0 点把逾期任务改到今天、Gmail 星标→任务、收据→Google Sheet、Notion 日期→日历+Slack。页面顶部是 **Join the waitlist**（Typeform），**官方页面未公布价格**。 [来源: https://www.todoist.com/automations]
- Automations 定价：唯一来源是 YouTube 评测标题《Todoist's New $10 Automations: Worth It Or Skip It?》，描述称 "$10/month on top of your existing Todoist subscription"。**官方定价未找到公开信息**（页面仅 waitlist）。 [来源: https://www.youtube.com/watch?v=i02n4YQpLaQ]
- 官方 help 导航里已有 Automations 独立分区（create a todoist automation / triggers / templates）。 [来源: https://www.todoist.com/help]

## Motion

- 定价（2026-09-25 实测官方页）：**Pro AI $19/seat/月、Business AI $29/seat/月（均为年付，页面写 "Pay annually (Save 33%)"）**；两档均含 **AI 额度**：Pro AI **7,500 credits/seat/月**、Business AI **15,000 credits/seat/月**；超额 **Pro 25 cents/100 credits、Business 19 cents/100 credits**。 [来源: https://www.usemotion.com/pricing]
- Motion 自列的 AI 功能名（官网 pricing 功能清单原文）：**AI Chat、AI Projects & Tasks、AI Calendar & Meetings、AI Docs/Wiki/& Notes、AI Task Planner、AI Writer & Editor**。 [来源: 同上]
- 营销口径："Finish 137% more work."（官网原文，无出处，属营销声明）。 [来源: 同上]
- 融资与估值：2025-09 官方博客宣布累计融资 **$60M（Series B + C + C2）**，累计 **$75M**，**最新估值 $550M**。 [来源: https://www.usemotion.com/blog/motion-raises-60m-to-build-the-agentic-work-suite-for-businesses.html] [来源: https://www.businesswire.com/news/home/20250905188051/en/Motion-Raises-%2460M-at-%24550M-Valuation-to-Build-the-Agentic-Work-Suite-for-Businesses]
- 用户对自动改期的真实反馈（r/productivity）："I like that motion automatically moves the unfinished tasks to the next day if I don't complete them. But what I don't like, is that if I further move the task myself, the task turns into the 'fixed' one, and this automatic move gets disabled" —— 即**手动拖动会把任务变成"固定"，从此不再自动排**，用户希望可改。 [来源: https://www.reddit.com/r/productivity/comments/1amldmk/motion_app_does_it_work_is_it_good/]

## Reclaim.ai

- 被 Dropbox 收购：**2024-08-20 前后**，官方博客《Reclaim is joining Dropbox》称 **"no planned changes to pricing or customer support anytime soon"**。 [来源: https://reclaim.ai/blog/dropbox-acquires-reclaim]
- TechCrunch（2024-08-22）：Dropbox **未披露交易条款**；Reclaim 当时有个人免费档，付费 **$8/person/月**。 [来源: https://techcrunch.com/2024/08/22/dropbox-acquires-index-ventures-backed-ai-scheduling-tool-reclaim-ai/]
- Reclaim 有**锁（locks）**机制：官方帮助中心《How to stop Reclaim events from moving using locks》——"Reclaim enables you to prevent events from automatically rescheduling or changing, even when overbooked."（页面更新日期 2026-08-05） [来源: https://help.reclaim.ai/en/articles/6473767-how-to-stop-reclaim-events-from-moving-using-locks]

## Notion（2026-09-25 实测官方 pricing 页）

- 档位：**Free $0 / Plus $10 / Business $20 / Enterprise 定制**（per member/month）。
- **AI 已不再是 add-on**：Free 与 Plus 只有 **"Trial of Notion AI"**（"Limited Trial"），正式 AI 能力在 **Business $20** 档：**Notion Agent**（"Completes complex, multi-step tasks using context from Notion, your connected apps, and the web"）、**AI Meeting Notes**、**Enterprise Search（Beta）**、**Research mode（Beta）**。
- **新增 credit 计费**：**Custom Agents** —— "AI agents handle repetitive tasks autonomously… **Free to try, then $10 per 1,000 monthly Notion credits**"，标注 **Requires Notion credits**；**Workers（Beta）** 同样 Requires Notion credits。
- 数据保留：Free/Plus/Business = **30 天保留**（with LLM providers）；**Enterprise = zero data retention with LLM providers**。
- [来源: https://www.notion.com/pricing]
- 历史：Notion AI 曾是 $8–10/user/月 的 add-on；2025-05 起改为并入 Business 档（Business $20 起），2025-08-13 生效。 [来源: https://www.eesel.ai/blog/notion-pricing] [来源: https://plaky.com/learn/plaky/notion-pricing/]

## Apple

- **iOS 26（2025-09-15 前后）**：官方支持文档《Use Apple Intelligence to suggest reminders from any app in iOS 26》——"Get suggested reminders even when you don't have the Reminders app open." 这是 Apple 在「提醒事项」上最直接的 AI 功能：**从任意 app 内容里建议提醒**。 [来源: https://support.apple.com/en-us/124025]
- **iOS 27 / Siri AI**：Apple Newsroom 2026-09 发布《Siri AI, a profoundly more capable and personal assistant, is here》，强调 personal context understanding。 [来源: https://www.apple.com/newsroom/2026/09/siri-ai-a-profoundly-more-capable-and-personal-assistant-is-here/]
- Apple Foundation Models：**第三代**（2026-06-08 发布），包含 **3 个跑在 Private Cloud Compute 上的服务端模型**，加上端侧模型；开发者文档称 Foundation Models framework 可访问 "any large language model, like the on-device and Private Cloud Compute models"。 [来源: https://machinelearning.apple.com/research/introducing-third-generation-of-apple-foundation-models] [来源: https://developer.apple.com/documentation/foundationmodels]
- 端侧模型规模：2024 年分析（Trail of Bits）为 **~3B 参数**端侧模型用于摘要 / Writing Tools，另有更大的服务端模型。 [来源: https://blog.trailofbits.com/2024/06/14/understanding-apples-on-device-and-server-foundations-model-release/]
- **关键缺口**：Apple 没有 auto-scheduling；AI 在「提醒事项」上主要是**建议**，不是自动执行。

## Google

- Gemini app 与 Google Tasks 的集成**曾经存在但不可靠/已失效**：r/GoogleTasks 帖《Android Gemini App Lost Integration with Google Tasks》，原帖吐槽 *"Google, a company worth billions of dollars, is unable to integrate its own AI with its own Tasks app in a way that makes it reliable to use."*（约 7 个月前，即 2026-02 前后） [来源: https://www.reddit.com/r/GoogleTasks/comments/1r8r35s/android_gemini_app_lost_integration_with_google/]
- Google Workspace + Gemini 官方能力清单（最后更新 2026-09-18）。 [来源: https://knowledge.workspace.google.com/admin/generative-ai/workspace-with-gemini/google-workspace-with-gemini]
- Google Assistant 将从 2026-09-04 起从移动设备上被移除（被 Gemini 取代）。 [来源: https://mlq.ai/news/google-assistant-starts-disappearing-september-4-heres-what-android-users-need-to-know/]
- Gemini Nano：通过 Android **AICore** 系统服务分发，第三方访问在扩大中。 [来源: https://www.linkedin.com/pulse/mobile-ai-2026-what-actually-works-on-device-doesnt-where-muazu-abu-0uoie]

## 横向关键证据：AI 排程的成与败

- **Clockwise 死亡**：官网首页公告原文 *"Clockwise will be going away. Our product will no longer be available starting on March 27, 2026."* —— 团队被 Salesforce acquihire（收购的是人，不是产品）。 [来源: https://getclockwise.com/]
- 第三方复盘：Clockwise 关停于 2026-03-27，约 **40,000 个组织**（含 Uber 等）受影响，通知期约一周；定性为 acquihire 而非产品收购。 [来源: https://www.hetk.io/compare/clockwise/] [来源: https://www.usecarly.com/blog/clockwise-shut-down/]
- **Reclaim 被 Dropbox 收购**（2024-08），交易条款未披露。 [来源: https://techcrunch.com/2024/08/22/dropbox-acquires-index-ventures-backed-ai-scheduling-tool-reclaim-ai/]
- **Motion 逆势融到 $550M 估值**（2025-09）。 [来源: https://www.businesswire.com/news/home/20250905188051/en/Motion-Raises-%2460M-at-%24550M-Valuation-to-Build-the-Agentic-Work-Suite-for-Businesses]
- **Todoist 的官方措辞本身就是证据**：Automations 页面强调 "**not AI guessing on your behalf**"、"a predictable, pre-defined workflow you can count on, every time" —— 头部厂商把「不靠 AI 猜」当成卖点。 [来源: https://www.todoist.com/automations]
- 用户侧对「让 AI 排我的一天」的抵触（r/iosapps 帖标题）: "I don't want AI to 'schedule my day' does anyone actually…" [来源: https://www.reddit.com/r/iosapps/comments/1mj8i6y/i_dont_want_ai_to_schedule_my_day_does_anyone/]
- r/ProductivityApps（2026-08 前后）："Part of me feels like manually writing out my plan gives me a sense of ownership…" [来源: https://www.reddit.com/r/ProductivityApps/comments/1va5o6z/should_i_plan_my_day_myself_or_let_an_ai_tool/]
- Sunsama 的 AI 页面（官方）：**Sunny the AI Assistant** 可对话管理任务、规划一天、整理 backlog；另有「新建任务时自动打 channel 标签、按历史估时」。 [来源: https://www.sunsama.com/features/ai] [来源: https://help.sunsama.com/docs/usage-guides/sunny/]