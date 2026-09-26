# AI 任务管理：哪些 AI 功能真的被验证，以及 AI 自动排程的成败账

> 调研日期：2026-09-25
> 调研范围：Motion / Reclaim.ai / Clockwise / Sunsama / SkedPal / Timehero / Trevor AI / Structured / Sorted³ / Akiflow / Moria / Morgen / FlowSavvy / Llama Life / Amie / Todoist / Google Calendar
> 工具限制（必须声明）：本次调研期间 `web_search`（Tavily 432）不可用；anysearch 的 API key 在调研中途**当日免费额度耗尽**，因此后半程只能改用 `web_fetch` 抓取**已知 URL**。Reddit / Trustpilot / G2 / Product Hunt 对两者都返回反爬页面（403 / "Prove your humanity"），**这些来源的内容只能通过搜索索引返回的片段获得**。

## 证据强度标注（全文通用）

| 标记 | 含义 |
|---|---|
| ✅ | 我**亲自抓取了页面全文**并读到该内容（`web_fetch` HTTP 200 或 anysearch extract 成功） |
| ⚠️ | **仅通过搜索索引返回的片段**获得。片段是搜索引擎从该 URL 抓到的真实文本，但我**无法打开原页复核上下文**（Reddit / Trustpilot / G2 等反爬） |
| ❌ | **未找到公开信息** |

**本报告不编造任何引语、数字或产品结局。** 凡 ⚠️ 的引语，请按"搜索索引片段"的可靠性使用，不要当成我读过的全文。

---

## 1. AI 场景验证矩阵

| # | 场景 | 判定 | 关键证据（URL） | 关键限制 |
|---|---|---|---|---|
| 1 | **自然语言 / 语音快速捕获** | **真需求**（但增量不在"NLP"） | ✅ TidBITS 作者自述日常用法："which I do with Reminders by telling Siri to 'Remind me to call the car repair shop tomorrow at 9 AM.'" [来源: https://tidbits.com/2025/06/25/appbits-sorted-seems-moribund/] · ✅ Todoist Ramble（2026-01 上线，语音→结构化任务）[来源: https://techcrunch.com/2026/01/21/todoists-app-now-lets-you-add-tasks-to-your-to-do-list-by-speaking-to-its-ai/] · ✅ XDA 实测标题："Talking to my to-do list felt ridiculous — until Todoist Ramble made it click" [来源: https://www.xda-developers.com/todoist-ramble/] | NLP 日期解析**不是 AI 带来的新东西**：Todoist Smart Add 早已存在，且用户长期抱怨语法难记 ⚠️ "as great as the natural language is for setting dates and times in Todoist, it can leave a lot of users scratching their heads on the appropriate syntax" [来源: https://www.reddit.com/r/todoist/comments/grmj3r/handy_reference_webpage_natural_language_dates/]。AI 的真实增量是**从一段啰嗦口语里抽出多个字段**，不是"解析 tomorrow 5pm"。Motion 的 App Store 差评反而把缺 NLP 列为缺点 ⚠️ [来源: https://apps.apple.com/us/app/motion-tasks-ai-scheduling/id1580440623?see-all=reviews&platform=iphone] |
| 2 | **会议转录 → 待办抽取** | **有用但有条件**（信任问题未被证据支持为已解决） | ⚠️ Reddit r/AiNoteTaker 专帖 "Do you actually trust AI to take your meeting notes?"（帖子本身的存在即信号）[来源: https://www.reddit.com/r/AiNoteTaker/comments/1v3ls2p/do_you_actually_trust_ai_to_take_your_meeting/] · 市场侧信号：Amie **放弃日历、转向 AI 会议笔记** ⚠️ "Amie have switched focus to AI meeting notes which is so disappointing because their calendar is the best I've used." [来源: https://www.reddit.com/r/ProductivityApps/comments/1j542oj/looking_for_a_new_calendar_app_already_tried_amie/] · Motion 把 AI Meeting Notetaker 列为独立产品面 ✅ [来源: https://www.usemotion.com/] | ❌ **未找到"抽取出的待办真的被完成"的任何量化数据**（完成率、留存）。抽取准确率有单点说法但无法复核：⚠️ "It seems to be able to accurately extract the correct task from an actionable email on about 9 out of 10 occasions. Saves me lots of time" [来源: https://www.reddit.com/r/todoist/comments/1oq6nxw/genuine_question_is_anyone_using_these_new/] |
| 3 | **AI 日/周计划摘要**（"这是你今天的样子"） | **有用但有条件 / 接近噱头** | 仅找到厂商侧实现：Morgen "AI Daily Planner" ✅ [来源: https://www.morgen.so/]；Motion "AI Calendar / Auto-plan your day" ✅ [来源: https://www.usemotion.com/]。用户侧 ⚠️ r/AIAssisted "What's the best AI daily planner app?" [来源: https://www.reddit.com/r/AIAssisted/comments/1pvvm2c/whats_the_best_ai_daily_planner_app/] | ❌ 未找到任何留存/使用率数据。注意这与"自动排程"高度重叠——摘要只是排程结果的叙述层，**单独存在时没有独立价值证据** |
| 4 | **AI 优先级 / "我现在该做什么"** | **有用但有条件** | Motion G2 页摘要 ⚠️ "Users consistently praise the automatic scheduling and task prioritization features of Motion, which help streamline their daily workflows and reduce decision ..."（G2 4.1 / 157 条）[来源: https://www.g2.com/products/motionapp/reviews] · Reclaim 把 "AI priority levels" 作为**差异化功能**列出 ✅ [来源: https://help.reclaim.ai/en/articles/11123801-switching-from-clockwise-to-reclaim-ai] | 存在直接的**怀疑论**：⚠️ "If AI can prioritize your work better than you can you need a lot more help than some app can give you" [来源: https://www.reddit.com/r/productivity/comments/1qy9u6i/ai_for_task_prioritization_and_productivity/]。真正被验证的是**"用户自己设优先级、AI 只按它排"**，不是"AI 替你决定什么重要" |
| 5 | **AI 任务拆解** | **真需求（小样本、ADHD 人群尤其）** | ⚠️ Todoist 上线 suggested subtasks 时的用户反应："I think it will be very useful for my ADHD to be able to easily break down bug tasks into smaller, more manageable tasks (analysis paralysis...)" [来源: https://www.reddit.com/r/todoist/comments/1kn56g3/todoist_added_the_ability_to_add_suggested/] | 证据几乎全部来自**单一人群（ADHD / 拖延）**。❌ 未找到"拆解后的子任务被实际执行"的追踪数据。Goblin Tools 这类拆解工具被反复提名 ⚠️ [来源: https://ticnote.com/en/blog/ai-task-breakdown-tools] |
| 6 | **AI 自动排程（时间块）** | **有用但有条件——条件极其苛刻，见 §2/§3** | 见 §2、§3。最强正面：✅ HN "Hacking ADHD" 帖下 "I can't recommend reclaim.ai highly enough... It's absolutely a game-changer for me. My whole life is scheduled in my calendar... It's really been a life-saver for the past couple of years." [来源: https://news.ycombinator.com/item?id=38281535] | 最强负面不是用户骂，而是**竞品创始人自己说的**：✅ Sunsama 联创 Travis Meyer："we consistently heard feedback from folks who had tried Motion that Motion felt too opinionated and proactive when it came to scheduling things, and they ended up spending more time correcting automated scheduling decisions as a result." [来源: https://roadmap.sunsama.com/improvements/p/automatically-schedule-tasks-to-calendar] |
| 7 | **AI 搜索 / 对自有任务笔记问答**（"我说过要做 X 是啥时候"） | **demo 噱头（就目前证据而言）** | 只有厂商宣传：Motion "AI Chat — The fastest way to go from question to done" ✅ [来源: https://www.usemotion.com/]；Reclaim "AI Assistant — Chat with your AI Assistant to plan, prioritize, and optimize your schedule" ✅ [来源: https://reclaim.ai/blog/dropbox-acquires-reclaim] | ❌ **未找到任何真实用户在用这个场景的证词**。这是本次调研中**证据最空的一个场景**。厂商自己在功能页里给的用途是"plan, prioritize, optimize"——又绕回排程，不是"检索我自己的历史承诺" |
| 8 | **AI 邮件 / 消息 → 任务** | **有用但有条件** | Todoist Assist 官方定位 ✅ [来源: https://www.todoist.com/help/todoist/todoist-and-ai/introduction-to-todoist-assist-KgPP22q5O] · 单点好评 ⚠️ "9 out of 10 occasions. Saves me lots of time"（同上 Reddit） | 该好评同时是对 Ramble/Todoist Assist 的**单条**评价，n=1，且是截断片段。❌ 无规模数据 |
| 9 | **AI 习惯 / 连续打卡教练与推送** | **demo 噱头（当前形态）** | 反证来自长期实测：⚠️ "The myth says you need AI coaching, mood tracking, and achievement badges to build habits. I spent 5 years and hundreds of dollars testing every tracker while most died within days." [来源: https://medium.com/activated-thinker/i-tried-every-habit-tracker-for-5-years-one-survived-9bfd41ac9d24] · 习惯 App 讨论帖 ⚠️ [来源: https://www.redditmedia.com/r/HabitHelp/comments/1ix6zxr/what_do_you_guys_dislike_the_most_about_all_of/] | 厂商文案**自己承认了失败模式**：Nudge 官网 ✅ "not just sending you another ignored notification" [来源: https://gonudgeid.com/] ——即"AI 推送被忽略"是行业默认现状。❌ 未找到任何 nudge 提升完成率的量化研究 |

---

## 2. AI 排程的成败案例（逐个产品 + 时间线 + 实际结局）

### 2.1 已确证的三种"退出形态"

调研最重要的发现：**没有任何一个自动排程产品是"因为功能被用户嫌弃所以下线这个功能"的**。实际退出形态是另外三种。

| 形态 | 案例 |
|---|---|
| **A. 整体关停 + 团队被吸收（acquihire）** | Clockwise |
| **B. 被大厂收购后继续运营，但用户预期崩了** | Reclaim.ai（Dropbox） |
| **C. 主动拒绝做全自动（"我们不做"也是结局）** | Sunsama |

> ❌ **未找到"某产品明确移除/下线 auto-scheduling 功能"的公开案例。** 最接近的是 Sunsama **从未构建**"一键把所有任务排进日历"，以及 Amie 从日历**转向** AI 会议笔记。请不要把"没有产品移除"误读为"这个功能很成功"——它同时意味着**这个功能是产品的全部，做不好就只能关停**。

### 2.2 Clockwise —— 唯一有硬数字的"死亡案例"

| 时间 | 事件 | 来源 |
|---|---|---|
| 2016 | Matt Martin 创立；此前 2014–2016 在 Salesforce 做工程师 | ✅ [来源: https://www.salesforceben.com/salesforce-secure-team-behind-calendar-app-clockwise-for-agentforce/] |
| 2019–2023 | Series C，累计融资 **$76M+**（Bain、Coatue、Greylock、Accel、Atlassian、Slack Fund） | ✅ HN 招聘帖 [来源: https://news.ycombinator.com/item?id=36958199] |
| 2026-03-20 前后 | CEO 在 LinkedIn 宣布团队加入 Salesforce Agentforce | ✅ [来源: https://www.salesforceben.com/salesforce-secure-team-behind-calendar-app-clockwise-for-agentforce/] |
| **2026-03-27** | **产品彻底下线**。Salesforce 对 The Register 明确：**"this is not an acquisition"、"is not acquiring Clockwise or its technology"** | ✅ 同上；✅ [来源: https://getclockwise.com/] |
| 下线时的自报成绩 | **40,000 家组织**；**8M 小时** Focus Time；**23M 次**会议被重排 | ✅ 官网告别页 [来源: https://getclockwise.com/] |

**"是成功还是失败？"的诚实回答：两者都是。**
- 作为**产品**：拿到了 40,000 组织、2300 万次重排，却**在 2026 年 3 月被整体关停**，用户连账单历史都拿不到 ✅ "You won't even be able to access your billing history after March 27 and there will be no support available after that date." [来源: https://news.ycombinator.com/item?id=47443310]。
- 作为**团队**：全员被 Salesforce 接收（HN 上前员工："I'm happy that many employees got to get a job at Salesforce"）✅ [来源: https://news.ycombinator.com/item?id=47447867]。
- **对本次调研最有价值的一条**：HN 上前员工承认 Clockwise 的迁移路径指向**竞争对手** Reclaim ✅ "I'm sure it was tough to swallow some pride and recommend Reclaim, who was our strongest competitor in the space... Reclaim was acquired by Dropbox a while ago, although Dropbox wanted them to continue to run and develop the product there." [来源: https://news.ycombinator.com/item?id=47447867]
- 行业侧评论（未经证实、仅作氛围）：HN 上有人认为护城河极浅 ✅ "there was never a compelling product or a moat they could build with in the space. It was trivial for Google or anyone else to just implement similar enhancements." [来源: https://news.ycombinator.com/item?id=47443310]

### 2.3 Reclaim.ai —— Dropbox 收购是成功还是"认输"？

| 时间 | 事件 | 来源 |
|---|---|---|
| 2019 | Henry Shapiro + Patrick Lightbody 创立 | ✅ [来源: https://techcrunch.com/2024/08/22/dropbox-acquires-index-ventures-backed-ai-scheduling-tool-reclaim-ai/] |
| **2024-08-20/22** | **被 Dropbox 收购**，条款未披露；**全部 22 人**加入 | ✅ 官方公告 [来源: https://reclaim.ai/blog/dropbox-acquires-reclaim]；✅ TechCrunch [来源: https://techcrunch.com/2024/08/22/dropbox-acquires-index-ventures-backed-ai-scheduling-tool-reclaim-ai/] |
| 2026 | **仍在运营**，且已到 **Reclaim 2.0**；2026-06-12 发布 Clockwise 迁移指南，承诺**100% 价格匹配**、优先支持、每日迁移 webinar | ✅ [来源: https://help.reclaim.ai/en/articles/11123801-switching-from-clockwise-to-reclaim-ai] |

**"成功还是认输"——证据指向：财务上是成功退出，产品上命运未定，用户情绪上是悲观。**
- 创始人自述保留完整团队与产品 ✅ "unlike many tech acquisitions, we were able to keep the entire team and product intact while continuing to invest in and pursue the long term vision" [来源: https://news.ycombinator.com/item?id=41302030]
- 但 HN 上最高赞的情绪是**预期衰退** ✅ "I'll admit to feeling like this will be the beginning of the end for me. I love Reclaim right now, it serves its purpose very well and stays completely out of the way whilst doing it, but I don't have any love for Dropbox" [来源: https://news.ycombinator.com/item?id=41302726]
- Dropbox 的收购履历被公开质疑 ✅ "Out of Dropbox's long history of acquisitions, very few of the products from said acquisitions have survived." [来源: https://news.ycombinator.com/item?id=41302030]；另一位用户以 HelloSign 为例 ✅ "HelloSign was acquired by DropBox and is basically a stagnant has-been" [来源: https://news.ycombinator.com/item?id=41302030]
- **反例（说明 Dropbox 这次确实在投入）**：Reclaim 2026 年仍在吸收 Clockwise 的存量客户并给出价格匹配与迁移工具 ✅（见上表迁移指南）。

**可量化的用户信号（样本都很小，请谨慎）**
- Trustpilot：**2.2 / 5，仅 23 条** ⚠️ [来源: https://www.trustpilot.com/review/reclaim.ai]
- Google Workspace Marketplace：**4.0 / 5，238 条** ⚠️ [来源: https://workspace.google.com/marketplace/app/ai_for_google_calendar_reclaimai/950518663892]
- 一条具体的灾难性差评（同时是 §3 "日历污染"的核心证据）⚠️ "I have 300 tasks that reclaim.ai created and now I cannot delete them in google calendar nor in reclaim.ai, it is a mess!!!"（2025-10-17）[来源: https://workspace.google.com/marketplace/app/ai_for_google_calendar_reclaimai/950518663892]
- ❌ **Reclaim 的 ARR / 用户数 / 留存：未找到公开信息。** 搜索到的"Reclaim.ai Productivity Trends Report 2025"只提供了行业数据（知识工作者每周 46.6 小时中仅 10.6 小时专注），**不是 Reclaim 自己的商业指标** ⚠️ [来源: https://www.bliro.io/en/blog/revenue-operations-revops-in-mid-sized-companies-why-conversation-data-is-the-missing-piece]

### 2.4 Motion —— 商业上最成功的自动排程产品，用户评价最分裂

| 时间 | 事件 | 来源 |
|---|---|---|
| 2025-09-08 | 宣布 **$60M**（Series B+C+C2），**累计 $75M**，估值 **$550M** | ✅ 官方博客（本次已亲自抓取全文）[来源: https://www.usemotion.com/blog/motion-raises-60m-to-build-the-agentic-work-suite-for-businesses.html] |
| 同文披露的硬数字 | **mid-8-figure ARR**；**10,000+ B2B 客户**；**50+ 员工**；"AI Employees" 这条线**3 个月从 $0 到 8 位数 ARR** | ✅ 同上 |
| 战略转向 | 从"AI 日历"转向 **"agentic work suite"**（AI SDR / AI Project Manager / AI Marketer / 文档 / 表格 / BI） | ✅ 同上 |

**评级（全部来自搜索索引片段，且口径互不相同）**
| 平台 | 分数 | 样本 |
|---|---|---|
| G2 | 4.1 | 157 ⚠️ [来源: https://www.g2.com/products/motionapp/reviews] |
| Capterra | 4.3 | 89 ⚠️ [来源: https://www.capterra.com/p/214264/Motion/] |
| Trustpilot | 3.7 | 578 ⚠️ [来源: https://www.trustpilot.com/review/www.usemotion.com] |
| App Store | 4.1 | 1.9K ⚠️ [来源: https://apps.apple.com/us/app/motion-tasks-ai-scheduling/id1580440623?see-all=reviews&platform=iphone] |

**⚠️ 一个重要更正：搜索索引里的 Motion 收入数字互相矛盾。**
- 官方（一手）：**mid-8-figure ARR**（即 $50M 量级）✅
- Sacra：2025-08 达到 **$50M ARR** ⚠️ [来源: https://sacra.com/c/motion/]
- getlatka：**$10M ARR** ⚠️ [来源: https://getlatka.com/companies/motion]
- 三者不可调和。**以官方博客的 "mid-8-figure ARR" 为准，其余第三方数字不可用。**

**"我为什么退订 Motion"——已确证存在的帖子（标题层面）**
- ⚠️ "Canceled my subscription and I'm disappointed" — "I've been a Motion user for three or four years now and I've finally canceled my recurring annual subscription."（2025-09-03）[来源: https://www.reddit.com/r/UseMotion/comments/1n7os7e/canceled_my_subscription_and_im_disappointed/]
- ⚠️ "Why I'm considering to leave Motion" — 更新里写 "I have cancelled my account and switched to Reclaim AI which actually focuses on task scheduling and auto time blocking and not on this AI nonsense." [来源: https://www.reddit.com/r/UseMotion/comments/1ofnc7a/why_im_considering_to_leave_motion/]
- ⚠️ "Motion After 2 Years" — "The problem with this is that ClickUp now offers the same calendar unification, task unification, and auto-scheduling capabilities that made ..." [来源: https://www.reddit.com/r/UseMotion/comments/1q4dic0/motion_after_2_years/]
- ⚠️ 融资帖下的反应："$20M ARR wasn't enough. So they chased the money instead of improving on a product that worked ..." [来源: https://www.reddit.com/r/UseMotion/comments/1nde5s7/motion_raises_60_million_at_550m_valuation/]
- ⚠️ 计费/取消争议（**与排程质量无关，但构成负面信号的大头**）："UseMotion charged me over 1000 AUD despite cancelling" [来源: https://www.reddit.com/r/UseMotion/comments/1p6tvqy/usemotion_charged_me_over_1000_aud_despite/]；"Motion got rid of monthly pay option" — "My subscription just went up too, and because the payment bounced, they said I would no longer be able to do monthly." [来源: https://www.reddit.com/r/UseMotion/comments/1mchg4b/motion_got_rid_of_monthly_pay_option/]；r/productivity "they just charged me over $200" [来源: https://www.reddit.com/r/productivity/comments/1bf0mkb/motion_app_cancellation/]

**排程质量本身的具体差评**
- ⚠️ "The system prioritizes my tasks incorrectly and I spend extra time reshifting them in my calendar after the app has already set the schedule." [来源: https://www.reddit.com/r/productivity/comments/m7nlgo/has_anyone_tried_motion_thoughts/]
- ⚠️ "I found the auto-scheduling in Motion to be pretty time-intensive only to end up with a less-than-desirable result." [来源: https://www.reddit.com/r/ProductivityApps/comments/1b3jmu7/definitive_answer_akiflow_is_the_best_todo_list/]
- ⚠️ "The AI makes autonomous scheduling decisions based on its algorithms, and while usually ..."；"People with highly unpredictable schedules... may find Motion's scheduling unhelpful since it becomes outdated ..." [来源: https://ellieplanner.com/comparisons/motion-app-review]
- ⚠️ App Store 长篇差评（同时是最有力的"AI 之外的基本功才是真痛点"证据）："No widgets... Lacklustre Siri integration... Lack of notifications... the lack of NLP that makes adding events and tasks take longer than it should" [来源: https://apps.apple.com/us/app/motion-tasks-ai-scheduling/id1580440623?see-all=reviews&platform=iphone]

**正面证据（说明它确实对一部分人有效）**
- ✅ HN："Motion's (not to be confused with Notion) algorithm is pretty good." 并详细描述了 urgency / time estimate / schedule / chunking / minimum chunk duration 的机制 [来源: https://news.ycombinator.com/item?id=39032816]
- 厂商客户证言（**营销材料，不可当独立证据**）："Motion's AI Project Manager cut our project delivery time by 30%." ✅ [来源: https://www.usemotion.com/blog/motion-raises-60m-to-build-the-agentic-work-suite-for-businesses.html]

### 2.5 Sunsama —— "拒绝"本身是一个有据可查的产品决策

**这是本次调研中信息质量最高的一手材料。** Sunsama 联创 Travis Meyer 在公开 roadmap 上完整解释了为什么不做全自动：

- ✅ **用户先抱怨"这不算自动"**："I'm coming over from Motion and what is considered 'auto-scheduling' on Sunsama isn't fully auto-scheduling because I still have to press a button or drag and drop each individual task into the calendar in the order of priority... it feels like one more platform I now have to manage manually." [来源: https://roadmap.sunsama.com/improvements/p/automatically-schedule-tasks-to-calendar]
- ✅ **联创的回答（本报告最重要的一段引语）**："We opted to take a lighter touch than Motion does when it comes to automatically scheduling things on your calendar. If what you want is full automation just like Motion, it's likely Sunsama won't be the right fit. **When designing our own version of auto-scheduling, we consistently heard feedback from folks who had tried Motion that Motion felt too opinionated and proactive when it came to scheduling things, and they ended up spending more time correcting automated scheduling decisions as a result.** We likely won't try and make fuzzy inferences like auto-rescheduling a task if it's 30 minutes after it's scheduled completion time (maybe you did actually finish it but just haven't had time to check it off in Sunsama yet). **We also value being intentional with your time, and think leaning too hard into automation takes away from that.** We likely won't add a 'automatically schedule all tasks to calendar' button with this in mind." [来源: https://roadmap.sunsama.com/improvements/p/automatically-schedule-tasks-to-calendar]
- ⚠️ 第三方印证："Sunsama does not have any AI auto scheduling features and explicitly states that it will not build automatic scheduling into the app." [来源: https://efficient.app/compare/sunsama-vs-routine]（措辞过强——Sunsama 其实**有**单任务 auto-schedule 与 auto-reschedule，只是拒绝"全量自动"）
- ✅ Sunsama 实际提供的能力边界（帮助文档）：按 `X` 单任务排入；Settings > Schedules 定义可排程时段；不与日历事件重叠；任务超 1 小时会**被主动拆分**填充空隙；Shift+X 可禁止拆分；超额时给三个选项 [来源: https://help.sunsama.com/docs/usage-guides/timeboxing/timeboxing-auto-scheduling/]

### 2.6 其余产品的实际结局（按证据强度排序）

| 产品 | 实际结局 / 定位 | 证据 |
|---|---|---|
| **Sorted³** | **事实上已死**（2025-06 时点） | ✅ TidBITS 实测：客服站点因欠费被停用；Mac 版 2 年未更新、iOS 版 8 个月未更新；Slack 邀请链接失效；官方社媒最后更新停在 2023；联创在 LinkedIn 上把 Sorted 列为 2016-01 至 **2024-01** 的工作。作者结论："I think Sorted is an ex-parrot." [来源: https://tidbits.com/2025/06/25/appbits-sorted-seems-moribund/] |
| **Amie** | **从日历转向 AI 会议笔记** | ⚠️ 用户抱怨 "Amie have switched focus to AI meeting notes which is so disappointing because their calendar is the best I've used." [来源: https://www.reddit.com/r/ProductivityApps/comments/1j542oj/looking_for_a_new_calendar_app_already_tried_amie/]；官网已改为 "Amie - AI Note Taker / Turn meeting notes into automated workflows" ✅ [来源: https://amie.so/] |
| **Structured** | 仍存在，但**用户明确嫌"估时负担"** | ✅ TidBITS："The problem with Structured was that it required me to specify when I would start each task and how long it would take to complete. That's more meta-work than I want to do... articles always seem to take longer than I expect." [来源: https://tidbits.com/2025/06/25/appbits-sorted-seems-moribund/] |
| **SkedPal** | 仍存在，**核心失败模式是"看不懂为什么这样排"** | ⚠️ "Steep learning curve. Skedpal users repeatedly report that even after months of use, it's still hard to fully understand why tasks are scheduled..." [来源: https://www.morgen.so/blog-posts/skedpal-alternatives]；⚠️ "many users report still feeling confused months after signing up. The mobile app lags behind the desktop..." [来源: https://www.saner.ai/blogs/skedpal-reviews] |
| **Akiflow** | **明确不做自动排程**，靠手动拖拽 | ⚠️ "Akiflow doesn't auto-schedule - you have to manually place every task." [来源: https://www.saner.ai/blogs/akiflow-reviews]；⚠️ "Motion auto-schedules tasks into available time slots. Akiflow gives you manual control." [来源: https://get-alfred.ai/blog/is-akiflow-worth-it] |
| **Trevor AI** | 仍存在，定位"辅助而非接管" | ⚠️ "I was using Trevor AI and liked it a lot, but doesn't auto re-schedule" [来源: https://www.reddit.com/r/productivity/comments/1apa25m/tools_that_calendar_your_todos_besides_motion/]；⚠️ "It doesn't take over your schedule; it ..." [来源: https://skywork.ai/skypage/en/Trevor-AI-vs.-Motion.../1974527791922737152] |
| **Morgen** | 有 AI Planner 自动排程，定位"哲学上不同于 Motion" | ✅ [来源: https://www.morgen.so/]；⚠️ "This is philosophically different from Motion, which automatically schedules tasks into your calendar. Some users prefer automation; others find it intrusive." [来源: https://ellieplanner.com/comparisons/morgen-calendar-review] |
| **FlowSavvy** | 低价（$7/月）"Motion 平替"，质量被质疑 | ⚠️ App Store 差评："It's more of an automated scheduling algorithm based on user inputs. The widgets are very low quality and poorly designed. refresh very inconsistently" [来源: https://apps.apple.com/us/app/flowsavvy-ai-schedule-planner/id1620112581?see-all=reviews&platform=iphone]；⚠️ "great Motion alternative" [来源: https://skywork.ai/skypage/en/Mastering-FlowSavvy.../1976129601345875968] |
| **Llama Life** | **不是自动排程产品**（番茄钟 + 单任务清单），仍活着，ADHD 定位 | ⚠️ App Store 2026 年评价："Llama Life in early 2026 is a half-finished app with distracting quirks." [来源: https://apps.apple.com/us/app/6454469750?see-all=reviews&platform=iphone]；Google Play **3.8 / 145** ⚠️ [来源: https://play.google.com/store/apps/details?id=com.llamaapp]；官网自述作者因成年后确诊 ADHD 而做 [来源: https://llamalife.co/about] |
| **Routine** | 拖拽式排程，非全自动 | ⚠️ "The app features a drag-and-drop interface that lets you schedule tasks directly onto your calendar." [来源: https://ellieplanner.com/comparisons/routine-app-review] |
| **Timehero** | 仍运营 | 官网 ✅ [来源: https://www.timehero.com/]；⚠️ 老帖担忧（2022）"I have been testing it and really like it but am very concerned that it doesn't ..." [来源: https://www.reddit.com/r/productivity/comments/yg967n/any_timehero_users/]；❌ **商业指标与留存：未找到公开信息** |
| **Google Calendar "Help me schedule"** | 2025-10 上线，Gemini 在 Gmail 里**建议会议时间**——是**会议排期**，不是任务自动排程 | ✅ [来源: https://workspaceupdates.googleblog.com/2025/10/help-me-schedule-meeting-gmail-calendar.html]；✅ CNET [来源: https://www.cnet.com/tech/services-and-software/googles-ai-assistant-is-ready-to-take-over-your-calendar-and-schedule-your-meetings/] |
| **Calendly** | ❌ **未找到公开信息**（本次未做有效调研） | — |

**⚠️ 一个容易被误读的宏观信号**：Reclaim 把"Clockwise 的 3 周排程窗口"作为自己的优势（"Schedule up to 12 weeks ahead compared to Clockwise's 3-week window"）✅ [来源: https://help.reclaim.ai/en/articles/11123801-switching-from-clockwise-to-reclaim-ai] ——说明**排程视野长度**是这类产品的真实竞争维度，而不只是"准不准"。

---

## 3. 用户为什么不信任 AI 排时间

按"证据强度 × 复现频次"排序。**第 1、2 条是本报告最有价值的两条**，因为它们同时来自用户和竞品创始人的一手材料。

### 3.1 「我花在纠正它的时间比自己规划还多」——**最强、最可复现**

- ✅ **竞品创始人转述的 Motion 流失原因**（同 §2.5）："they ended up spending more time correcting automated scheduling decisions as a result." [来源: https://roadmap.sunsama.com/improvements/p/automatically-schedule-tasks-to-calendar]
- ⚠️ 用户原话："The system prioritizes my tasks incorrectly and I spend extra time reshifting them in my calendar after the app has already set the schedule." [来源: https://www.reddit.com/r/productivity/comments/m7nlgo/has_anyone_tried_motion_thoughts/]
- ⚠️ "I found the auto-scheduling in Motion to be pretty time-intensive only to end up with a less-than-desirable result." [来源: https://www.reddit.com/r/ProductivityApps/comments/1b3jmu7/definitive_answer_akiflow_is_the_best_todo_list/]

### 3.2 「它不等我问就动了我的安排」

- ✅ Sunsama 帮助文档承认这是设计难点：**任务会被主动拆分**去填空隙（"Tasks of more than 1 hour will be readily split to fill available time blocks"），需要按 Shift+X 才能阻止 [来源: https://help.sunsama.com/docs/usage-guides/timeboxing/timeboxing-auto-scheduling/]
- ✅ 用户原话（Sunsama pin 请求帖）："those tasks will get pulled forward into time openings when I get ahead of schedule. It would be fantastic if there was a way to pin an item to where I place it on the calendar" [来源: https://roadmap.sunsama.com/improvements/p/pin-tasks-to-prevent-auto-rescheduling]
- ✅ "Calendar automation doesn't recognise that certain tasks need to happen at a certain time. we need the ability to lock start/end time in calendar, so that the automation won't move them around if earlier tasks take longer than expected." [来源: https://roadmap.sunsama.com/improvements/p/pin-tasks-to-prevent-auto-rescheduling]
- ✅ 最尖锐的一句（说明用户**因此干脆不用自动排程**）："I don't really use the auto-scheduler currently because I have tasks that need to be 'pinned' like this" [来源: https://roadmap.sunsama.com/improvements/p/pin-tasks-to-prevent-auto-rescheduling]
- ⚠️ "I would really like to be able to move a task to a particular time and then close the task and have it stay where I put it instead of it ..." [来源: https://www.reddit.com/r/UseMotion/comments/1ezqzxv/nice_to_have_ability_to_move_completed_tasks/]

### 3.3 「它不知道这个任务要 3 小时，不是 30 分钟」+ 估时本身就是元工作

- ✅ **根因是规划谬误**（不是 AI 的 bug）："a phenomenon in which predictions about how much time will be needed to complete a future task display an optimism bias and underestimate the time needed." [来源: https://en.wikipedia.org/wiki/Planning_fallacy]
- ✅ 用户原话（针对 Structured）："required me to specify when I would start each task and how long it would take to complete. That's more meta-work than I want to do, especially when some tasks might take minutes and others an unknown number of hours... articles always seem to take longer than I expect." [来源: https://tidbits.com/2025/06/25/appbits-sorted-seems-moribund/]
- 这正是 §3.1 的机制来源：**输入估时不准 → 排程必错 → 用户必须纠正**。任何"AI 自动排程"产品都继承了用户自己的估时误差。

### 3.4 「它把时间排在午休 / 专注块里」

- ✅ Reclaim 把 Lunch / Buffer Time / Travel Time / No-Meeting Days 做成**独立产品功能**——这本身就证明"AI 会占用这些时段"是默认失败模式 [来源: https://reclaim.ai/blog/dropbox-acquires-reclaim]
- ✅ Sunsama 的处理："Sunsama will not schedule tasks outside of your schedules unless you tell it to."；"Auto-scheduling does not consider declined meetings or events marked as 'available' or 'free'." [来源: https://help.sunsama.com/docs/usage-guides/timeboxing/timeboxing-auto-scheduling/]
- ❌ 未找到"AI 把任务排在午休导致我弃用"的**直接用户引语**。

### 3.5 「它无视我的精力曲线」

- ⚠️ Reddit 帖子标题即结论："Anyone else notice time-blocking ignores the most important variable?" 片段提到 "draws your predicted energy curve over your day. I often don't really ..." [来源: https://www.reddit.com/r/ProductivityApps/comments/1umndnq/anyone_else_notice_timeblocking_ignores_the_most/]
- 第三方把"匹配任务与真实精力模式"列为时间块失败的头号原因 ⚠️ [来源: https://timeblockingtool.com/common-time-blocking-mistakes-and-how-to-fix-them/]
- ❌ 未找到任何自动排程产品**声称**已解决精力建模。

### 3.6 「到早上 10 点计划就过期了」

- ⚠️ "People with highly unpredictable schedules—where even an hour's notice might change everything—may find Motion's scheduling unhelpful since it becomes outdated ..." [来源: https://ellieplanner.com/comparisons/motion-app-review]
- ⚠️ 对立面（这是 Reclaim 的卖点，说明问题真实存在）："Real-time rescheduling — Adjusts your schedule within seconds when conflicts occur, keeping your calendar optimized without waiting for daily recalculations." [来源: https://help.reclaim.ai/en/articles/11123801-switching-from-clockwise-to-reclaim-ai]

### 3.7 「一次糟糕的重排就毁掉信任」+ 无法解释

- ❌ **未找到"因为一次错误重排就卸载"的直接用户引语。**
- 但有强力的**间接证据**，说明厂商自己知道这个风险：
  - ✅ Sunsama 明确拒绝"超时 30 分钟就自动重排"，理由是**它无法区分"做完了没打勾"和"没做完"**："maybe you did actually finish it but just haven't had time to check it off in Sunsama yet" [来源: https://roadmap.sunsama.com/improvements/p/automatically-schedule-tasks-to-calendar]
  - ⚠️ SkedPal 的失败模式正是**不可解释**："even after months of use, it's still hard to fully understand why tasks are scheduled..." [来源: https://www.morgen.so/blog-posts/skedpal-alternatives]
- 结论：**"一次坏重排毁信任"在本次调研中只有机制层面的支持，没有直接引语。**

### 3.8 「日历被 AI 灌满了垃圾」

- ⚠️ Reclaim 差评："I have 300 tasks that reclaim.ai created and now I cannot delete them in google calendar nor in reclaim.ai, it is a mess!!!" [来源: https://workspace.google.com/marketplace/app/ai_for_google_calendar_reclaimai/950518663892]
- ⚠️ 专属子版里的同类诉求："How to keep tasks from showing up in Google Calendar? I'd love it if my tasks stayed on Reclaim, keeping my Google calendar for scheduled time." [来源: https://www.reddit.com/r/reclaim_ai/]
- ⚠️ 第三方评述也点到这点："This Reddit reviewer complains about tasks created in Reclaim cluttering their Google Calendar" [来源: https://www.morgen.so/blog-posts/reclaim-pricing]

### 3.9 ADHD 用户的特殊需求：**要批量控制权，不要代理权**

- ⚠️ ADHD 用户的原话（精确命中"要什么"）："Sunsama has a 'replanning' feature that's kind of usable for this, but it makes decisions for you automatically. True multi-select where the ..." [来源: https://www.reddit.com/r/ADHD/comments/1ldlnt3/best_time_blocking_app_youve_found_so_far/]
- ✅ **同一条引语里既有反对也有支持**（本报告最重要的平衡证据）：⚠️ "Automatic schedulers give up significance for comfort in your schedule. No matter how you turn it, an auto scheduler will always make less significant decisions than you. **Personally the main reason why I'm sticking to autoscheduling is that it's the only way for me to stick to timeblocking.**" [来源: https://www.reddit.com/r/productivity/comments/woh1w9/what_are_your_thoughts_on_automatic_schedulers/]
- ⚠️ ADHD 用户的正面用法："If you're looking for a good personal auto-scheduling / time-blocking app, I highly recommend giving FlowSavvy a try." [来源: https://www.reddit.com/r/ProductivityApps/comments/1g3h4m6/best_timeblocking_app_i_have_found/]
- ⚠️ Llama Life 的 ADHD 差评说明**"App 本身有摩擦"会直接击穿这个人群**："Llama Life in early 2026 is a half-finished app with distracting quirks. And we all know how ADHDers love a distraction." [来源: https://apps.apple.com/us/app/6454469750?see-all=reviews&platform=iphone]

### 3.10 「计划必须是我自己的，我才会有所有权感」

- ✅ Sunsama 联创的立场陈述（把"意图性"当作产品哲学）："We also value being intentional with your time, and think leaning too hard into automation takes away from that." [来源: https://roadmap.sunsama.com/improvements/p/automatically-schedule-tasks-to-calendar]
- ✅ Sunsama 用户 Marjorie MacIntosh 反驳"自动会损害意图性"：她认为既然自己已经用规则配置好了 schedule，批量排程并不损害意图性 —— "I have intentionally set up schedules with rules that allow the auto-schedule to plan things with intention." [来源: https://roadmap.sunsama.com/improvements/p/automatically-schedule-tasks-to-calendar]
- ⚠️ 一个更朴素的表述：长期任务管理用户最终回到"轻量 + 手动排序"，因为**计划本身是一种思考**："I want something sufficiently lightweight that managing my daily schedule doesn't require blocking out extra time to do so."（TidBITS 作者）✅ [来源: https://tidbits.com/2025/06/25/appbits-sorted-seems-moribund/]

### 3.11 反证：说自动排程"改变了我的人生"的用户

**这部分证据同样真实，不能只收集差评。**

| 用户 | 原话 | 来源 |
|---|---|---|
| HN `WraithM`（ADHD 帖） | ✅ "I can't recommend reclaim.ai highly enough, which the article mentions. It's absolutely a game-changer for me. My whole life is scheduled in my calendar... It's really been a life-saver for the past couple of years. They're also always improving the product." | [来源: https://news.ycombinator.com/item?id=38281535] |
| HN `madrox` | ✅ "Everyone at my new job uses Clockwise, which will rearrange calendars across the org to maximize focus time for everyone (also address double-booking). This is my first time in 10 years since becoming an EM where I don't have to spend time managing my calendar every day to get focus time. The jump to my productivity is huge. Can't recommend focus time (and Clockwise!) enough. If I could buy stock in them, I would." | [来源: https://news.ycombinator.com/item?id=32442902] |
| HN `bjterry`（管理者视角） | ✅ "I use Clockwise for managing my calendar. It's quite convenient if you are a manager because it can handle all your flexible meetings (aka 1:1s) even without everyone on board at your company using it. Definitely recommend it." | [来源: https://news.ycombinator.com/item?id=26061475] |
| HN `jonny-bravo`（机制描述） | ✅ "It's not 'AI', but Motion's algorithm is pretty good. When you add a task, you specify an urgency, time estimate, and what 'schedule' it belongs to... You can also specify whether to use chunking, which lets the algorithm break a task into multiple events based on the 'minimum chunk duration' you set" | [来源: https://news.ycombinator.com/item?id=39032816] |
| Reddit（ADHD 视角） | ⚠️ "the only way for me to stick to timeblocking" | [来源: https://www.reddit.com/r/productivity/comments/woh1w9/what_are_your_thoughts_on_automatic_schedulers/] |
| Reddit（Reclaim 长期用户） | ⚠️ "Absolutely love Reclaim.ai! This is my third year subscribing and as a solopreneur and mum, it has helped me sync family commitments as well as work" | [来源: https://www.trustpilot.com/review/reclaim.ai] |

**注意人群差异**：正面证据集中在**两类人**——(a) ADHD / 时间盲人群（自动排程是"能开始"的前提）；(b) **管理者 / 团队场景**（排的是别人的会，不是自己的深度工作）。负面证据集中在**个人贡献者的深度工作**场景。这可能是本报告最有商业价值的一条分界线。

---

## 4. 反过来：什么设计能赢回信任（含已存在的先例）

以下每一条都对应 §3 的一个具体失败模式，且**有产品已经这样做**。

| # | 设计模式 | 对应失败模式 | 已存在的先例（可引用） |
|---|---|---|---|
| 1 | **预览 / 逐条确认，不做全局一键应用** | 3.1 纠正成本、3.2 擅自动 | ✅ Sunsama 只做"按 `X` 单任务排入"，并**公开拒绝**"auto-schedule all tasks"按钮 [来源: https://roadmap.sunsama.com/improvements/p/automatically-schedule-tasks-to-calendar] |
| 2 | **Lock / Pin：用户放下的位置不可被动** | 3.2 擅自动 | ✅ Sunsama roadmap 上该请求已有 **53+ 投票者**，且合并了 4 条重复请求（"Lock tasks"、"Disable auto scheduling for some tasks"、"Add ability to pin items to calendar timeslot"、"Lock tasks in Calendar"）[来源: https://roadmap.sunsama.com/improvements/p/pin-tasks-to-prevent-auto-rescheduling] |
| 3 | **用户改动优先于系统决策（系统适配人，不是人适配系统）** | 3.2 + 3.7 信任崩塌 | ✅ Reclaim 明确承诺："**Manual calendar controls** — Move, resize, or delete Reclaim events anytime — **the system adapts to your changes instead of overriding them.**" [来源: https://help.reclaim.ai/en/articles/11123801-switching-from-clockwise-to-reclaim-ai] |
| 4 | **可排程窗口 / 规则（默认不排到工作时间外）** | 3.4 排到午休 | ✅ Sunsama "Settings > Schedules"，"will not schedule tasks outside of your schedules unless you tell it to" [来源: https://help.sunsama.com/docs/usage-guides/timeboxing/timeboxing-auto-scheduling/]；✅ Reclaim Working / Meeting / Personal Hours + Proactive/Reactive 模式 + min/max 时长 + 自定义时段 [来源: https://help.reclaim.ai/en/articles/11123801-switching-from-clockwise-to-reclaim-ai] |
| 5 | **把"人的需求"做成可保护的一等对象**（午餐、缓冲、通勤、无会日） | 3.4 | ✅ Reclaim 把 Lunch Habit / Buffer Time / Travel Time / No-Meeting Days 做成独立功能 [来源: https://reclaim.ai/blog/dropbox-acquires-reclaim] |
| 6 | **不要静默拆分长任务；给出显式开关** | 3.2 + 3.3 | ✅ Sunsama：≤1 小时"仅在必要时"拆分，>1 小时"会被积极拆分"，`Shift`+`X` 可禁止拆分 [来源: https://help.sunsama.com/docs/usage-guides/timeboxing/timeboxing-auto-scheduling/]；✅ Motion 有 chunking 与 "minimum chunk duration" 可配 ✅ [来源: https://news.ycombinator.com/item?id=39032816] |
| 7 | **超额时提问，而不是替用户决定** | 3.1 + 3.10 所有权 | ✅ Sunsama 给三个明确选项："Schedule anyway / Schedule another day / Defer" [来源: https://help.sunsama.com/docs/usage-guides/timeboxing/timeboxing-auto-scheduling/] |
| 8 | **优先级由用户设定，AI 只按它决定"谁让位"** | 3.1 + 3.10 | ✅ Reclaim："**AI priority levels** — Assign priorities to meetings, tasks, and routines so Reclaim intelligently decides **what moves and what stays protected**" [来源: https://help.reclaim.ai/en/articles/11123801-switching-from-clockwise-to-reclaim-ai] |
| 9 | **可解释性（为什么排在这里）** | 3.7 不可解释 | ✅ 反向先例：SkedPal 因**不可解释**被持续吐槽 ⚠️ [来源: https://www.morgen.so/blog-posts/skedpal-alternatives]。❌ 未找到任何产品公开的"排程解释"UI 设计文档 |
| 10 | **不碰不是它创建的东西** | 3.4 + 3.7 | ✅ Sunsama："Auto-scheduling does not consider declined meetings or events marked as 'available' or 'free'." [来源: https://help.sunsama.com/docs/usage-guides/timeboxing/timeboxing-auto-scheduling/] |
| 11 | **不把 AI 产物灌进用户的日历** | 3.8 日历污染 | ⚠️ 用户诉求明确（"I'd love it if my tasks stayed on Reclaim, keeping my Google calendar for scheduled time"）[来源: https://www.reddit.com/r/reclaim_ai/]，但 ❌ **未找到任何产品实现了"任务留在 App 内、只有时间块进日历"** —— 这是一个**公开的、未被满足的需求** |
| 12 | **把"重排视野"当一等参数** | 3.6 计划过期 | ✅ Reclaim 用 12 周 vs Clockwise 3 周作为卖点 [来源: https://help.reclaim.ai/en/articles/11123801-switching-from-clockwise-to-reclaim-ai] |

**❌ 未找到先例的两条**（可能是空白机会）：
1. **Undo / 撤销自动重排**：没有任何产品公开文档描述"一键撤销上一次自动重排"。最接近的只有 Reclaim 的"系统适配你的手动改动"。
2. **排程解释 UI**：没有任何产品公开"为什么这个任务排在这个时段"的可读解释。

---

## 5. 未找到公开信息 / 无法量化的部分（诚实清单）

### 5.1 完全未找到公开信息（❌）

1. **"抽取出的会议待办实际完成率"** —— 没有任何 AI 笔记产品公开"抽出的 action item 被真正完成的百分比"。
2. **"AI 习惯 nudge 提升完成率"的量化研究** —— 无 A/B、无留存数据。厂商文案只承诺"不是又一条被忽略的通知"，即承认默认失败。
3. **"AI 搜索/问答自有任务"的真实用户使用证据** —— 只有厂商功能页；**未找到任何真实用户证词**。
4. **Reclaim.ai 的 ARR / 用户数 / 留存** —— 收购金额也未披露。
5. **Timehero 的商业指标与留存** —— 只有官网与 n=1 的评分。
6. **Calendly 的 AI 排程** —— 本次未做有效调研。
7. **"某产品明确移除/下线 auto-scheduling 功能"的案例** —— 见 §2.1；实际退出形态是关停 / acquihire / 主动不做。
8. **"一次糟糕重排就毁掉信任"的直接用户引语** —— 只有机制层面的间接证据。
9. **"AI 把任务排在午休导致我弃用"的直接用户引语**。
10. **Undo 自动重排、排程解释 UI 的产品先例**。
11. **Motion 的流失率 / churn rate** —— 只有退订帖标题与计费争议，无比例数据。

### 5.2 有数字但样本太小、不足以支撑结论（⚠️ 使用需注明 n）

| 指标 | 数值 | 样本量 | 来源 |
|---|---|---|---|
| Reclaim Trustpilot | 2.2 / 5 | **n=23** | ⚠️ https://www.trustpilot.com/review/reclaim.ai |
| Reclaim Google Workspace | 4.0 / 5 | n=238 | ⚠️ https://workspace.google.com/marketplace/app/ai_for_google_calendar_reclaimai/950518663892 |
| Motion G2 | 4.1 / 5 | n=157 | ⚠️ https://www.g2.com/products/motionapp/reviews |
| Motion Capterra | 4.3 / 5 | n=89 | ⚠️ https://www.capterra.com/p/214264/Motion/ |
| Motion Trustpilot | 3.7 / 5 | n=578 | ⚠️ https://www.trustpilot.com/review/www.usemotion.com |
| Motion App Store | 4.1 / 5 | n=1.9K | ⚠️ https://apps.apple.com/us/app/motion-tasks-ai-scheduling/id1580440623 |
| Llama Life Google Play | 3.8 / 5 | n=145 | ⚠️ https://play.google.com/store/apps/details?id=com.llamaapp |
| Timehero (research.com) | 4.6 / 5 | **n=1** | ⚠️ https://research.com/software/reviews/timehero |

**注意**：这些平台的分数**跨平台不可比**（口径、样本自选择、评分者构成都不同）。Reclaim 的 2.2 vs Motion 的 3.7 不能直接推出"Reclaim 更差"。

### 5.3 一手数字中互相矛盾、必须取官方口径的

**Motion 的 ARR**：
- 官方一手 ✅ **mid-8-figure ARR**（[来源](https://www.usemotion.com/blog/motion-raises-60m-to-build-the-agentic-work-suite-for-businesses.html)）
- Sacra ⚠️ $50M（[来源](https://sacra.com/c/motion/)）
- getlatka ⚠️ $10M（[来源](https://getlatka.com/companies/motion)）
- **结论：以官方 mid-8-figure 为准；两个第三方数字至少有一个是错的，本报告不采用。**

### 5.4 方法论限制（影响结论强度，必须声明）

1. **Reddit / Trustpilot / G2 / Product Hunt 全部反爬**。所有 ⚠️ 标记的引语来自搜索索引片段，**我无法复核上下文**（例如一条差评可能是 3 年前、可能是竞品水军、可能上下文中还有反转）。
2. **anysearch 当日额度在中途耗尽**，后半程只能用 `web_fetch` 抓已知 URL —— 这意味着**发现新线索的能力在后期下降**，可能有重要来源未被覆盖。
3. **`web_search`（Tavily）全程 432 不可用。**
4. **没有拿到任何一份真实的产品留存曲线或队列数据。** 所有"成功/失败"判断都建立在：关停公告、融资公告、评分聚合、以及用户自述之上。**没有一个结论建立在留存数据上。**
5. **本报告没有做付费墙后的 G2/Capterra 全文调研**，只有公开聚合分数与片段。

---

## 附：给 heyta 的 5 条可执行推论（基于上述证据，非新事实）

1. **不要做"全自动排程"作为核心卖点。** 最强的一手证据是竞品创始人承认 Motion 用户"花更多时间纠正"（✅ Sunsama roadmap），以及三个自动排程产品以关停/收购/放弃收场（Clockwise / Reclaim 被吞并 / Amie 转向）。这是一个**已证明极难做对的赛道**。
2. **如果要做，先做"锁"和"预览"，而不是"自动"。** Sunsama 的 pin 请求有 53+ 票且合并 4 条重复请求（✅）——这是**已证实的、未被满足的需求**，且实现成本远低于排程算法。
3. **"任务留在 App 内、只有时间块进日历"是一个公开的空白。** 用户明确诉求（⚠️ r/reclaim_ai）但未找到任何产品实现。对本地优先的 heyta 而言，这天然契合。
4. **真需求排序（按证据强度）：自然语言/语音捕获 > 任务拆解（ADHD）> 优先级（用户设定、AI 执行）> 自动排程（有条件）> 会议转录（信任未解决）> AI 摘要/问答/习惯教练（噱头）。**
5. **正面与负面证据的人群分界是真实的**：ADHD / 时间盲人群与团队管理者从自动排程获益（✅ HN WraithM、madrox、bjterry），个人贡献者的深度工作受损（✅ Sunsama 联创转述、⚠️ Reddit）。**如果 heyta 要做排程，人群定位比算法精度更重要。**
