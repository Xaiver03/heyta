# Motion (usemotion.com) vs. Reclaim.ai — 竞品调研

**调研日期（观察日）：2026-09-25**
**覆盖范围：产品截至 2026 年的状态，重点为 2024–2026 的更新。**

> **方法论与可信度声明**
> - 每条事实后紧跟 `[来源: URL]`。没有实际检索到的 URL，就不写该事实。
> - 检索过程中，`web_search`（Tavily）返回 HTTP 432 不可用；`anysearch` CLI 在本次调研后半段触发了当日免费额度上限（"You've reached your API key's total free quota for today"）。后半段改用 `web_fetch` 直取已知 URL。
> - **Reddit、Trustpilot、G2 页面在本次调研中被反爬拦截**（Reddit 返回 "Prove your humanity"、Trustpilot 返回 HTTP 403、G2 需登录）。因此这些平台的**原文**未能直接抓取，只能引用**检索结果元数据中的评分/摘要**，以及**第三方评测站点中被明确署名并给出评论 permalink 的引文**。凡属此类，均已标注。
> - 无法找到的信息一律写 `未找到公开信息`。

---

## 目录

- [第一部分：Motion](#第一部分motion)
- [第二部分：Reclaim.ai](#第二部分reclaimai)
- [第三部分：横向对比](#第三部分横向对比)
- [第四部分：对 heyta 的产品启示](#第四部分对-heyta-的产品启示)

---

# 第一部分：Motion

## 1.1 概览

Motion 自称是「AI 时代的 #1 生产力平台」，把日历、任务、项目、文档、会议助手整合为单一产品。其核心卖点自始至终是 **auto-scheduling（自动排程）**：把任务自动铺进日历。

Motion 官方 llms.txt 自述：Y Combinator 背景，「over 1 million users」「100,000+ paying users across 30+ countries」「over 10 million hours saved」。[来源: https://www.usemotion.com/llms.txt]

---

## 1.2 问题 1：AI 功能的确切名称

### 1.2.1 定价页列出的能力分组（第一方，2026-09-25 观察）

Pro AI / Business AI 计划的功能清单中出现以下**确切名称**：
- **AI Chat**
- **AI Projects & Tasks**
- **AI Calendar & Meetings**
- **AI Docs, Wiki, & Notes**
- **AI Task Planner**
- **AI Writer & Editor**

[来源: https://www.usemotion.com/pricing]

### 1.2.2 官网导航列出的产品级功能页（第一方，2026-09-25 观察）

- **AI Project Manager** — `Plan and manage projects automatically` → /features/ai-project-manager
- **AI Gantt Chart** — `Visualize projects over time with auto-scheduling` → /features/ai-gantt-chart
- **AI Workflows** — `Automate repeatable projects and SOPs` → /features/ai-workflows
- **AI Task Manager** — `Organize and prioritize your tasks` → /features/ai-task-manager
- **AI Calendar** — `Auto-plan your day with smart scheduling` → /features/ai-calendar
- **AI Meeting Assistant** — `Simplify meeting scheduling and booking links` → /features/ai-meeting-assistant
- **AI Chat** → /features/ai-chat
- **AI Meeting Notetaker** — `Auto-capture meeting notes and summaries` → /features/ai-meeting-notetaker
- **AI Docs Assistant** — `Help writing and organizing docs faster` → /features/ai-docs-assistant

[来源: https://www.usemotion.com/pricing]

### 1.2.3 帮助中心中的独立功能文档（第一方）

- **AI Chat** — 有完整的 How-to、Reference、Concept 三个层级文档 [来源: https://www.usemotion.com/help/llms.txt]
- **AI Notetaker** — 同上三层文档 [来源: https://www.usemotion.com/help/llms.txt]
- **AI Agenda** — `AI Agenda gives you a daily command center where tasks, deadlines, and meetings come together in one place.` [来源: https://www.usemotion.com/help/getting-started/navigation-basics/navigating-motion-features/navigating-ai-features.md]
- **Auto-scheduling** — 核心功能，有独立的 How-to / Reference / Concept 文档树 [来源: https://www.usemotion.com/help/llms.txt]

### 1.2.4 首页宣称的 AI Project Manager 指标（第一方营销口径）

- 「Describe your project and add relevant docs. Motion instantly builds the entire project — tasks with deadlines and assignees, project stages, and more. **Motion is over 90% accurate out of the box.**」
- 「**Projects in Motion get done 32% faster** by eliminating idle time between tasks.」
- 「Motion analyzes your team's work — tasks, projects, deadlines, assignees, priorities, dependencies, and more. Motion auto-updates the plan with every change — like missed deadlines or new priorities.」
- 定价页底部标语：**「Finish 137% more work.」**

[来源: https://www.usemotion.com/]

### 1.2.5 「AI Employees」（2025 时期的功能，2026 已不在官方定价页）

第三方资料记录 Motion 在 2025 年推出过名为 **AI Employees** 的一组虚拟助理（被描述为有 Alfred、Suki 之类的名字，处理邮件草稿、会议准备等），并称其为「higher-tier add-on, priced well above the base plan」。[来源: https://www.saner.ai/blogs/motion-reviews]

定价史研究站点描述：「Motion started in 2021 as a flat $19/mo calendar extension, repackaged repeatedly through task management and AI auto-scheduling, **briefly tested a multi-tier 'AI Employees' credit grid in late 2025**, then settled on the current Pro AI / Business AI structure.」[来源: https://www.usagepricing.com/blueprint/motion]

**状态判定**：`discontinued / 已并入其他命名`（截至 2026-09-25，Motion 官方定价页与帮助中心的功能清单中均未再出现 "AI Employees" 这一名称；官方页面上取而代之的是 AI Chat / AI Project Manager / AI Notetaker 等）。[来源: https://www.usemotion.com/pricing]

另有一篇 2025-10-14 的第三方评测标题即为「Motion AI Employees Review 2025」，称「Motion operates on a tiered pricing structure that has been significantly updated in 2025, with dramatic increases in credit allocations」。[来源: https://max-productive.ai/blog/motion-ai-employees-review-2025/]

---

## 1.3 问题 2：交互形态

Motion 同时存在三种形态，官方文档对各自的边界写得很明确：

| 形态 | 对应功能 | 第一方依据 |
|---|---|---|
| **自动执行** | auto-scheduling | 「Instead of you manually dragging tasks around your calendar, Motion's AI does the heavy lifting, placing tasks in the best possible time slots」[来源: https://www.usemotion.com/help/time-management/auto-scheduling] |
| **聊天助手** | AI Chat | 「AI Chat is where you interact directly with Motion's AI... Use `@` to reference specific docs, projects, or tasks.」[来源: https://www.usemotion.com/help/getting-started/navigation-basics/navigating-motion-features/navigating-ai-features.md] |
| **建议（需用户确认）** | AI Chat 的所有写操作 | 「**No silent actions** → Drafts, suggestions, or insights appear in AI Chat first; they only become real tasks, projects, or docs if you choose to create or insert them.」[来源: https://www.usemotion.com/help/knowledge-management/ai-chat/reference-ai-chat.md] |

AI Chat 的 Reference 页把控制权边界写得很细：
- 「**Limitations** → AI Chat cannot publish, delete, or make system-level changes without explicit user action.」
- 「**Safety & Control** → Suggestions only; actions require user approval. AI Chat respects workspace RBAC.」
- 「**Reversible workflow** → Any AI-generated draft can be edited or discarded before being committed to your workspace.」
- 「**Transparency** → When an AI-generated suggestion references workspace data, the source (Doc, Task, Project) is displayed so you know where the context came from.」

[来源: https://www.usemotion.com/help/knowledge-management/ai-chat/reference-ai-chat.md]

**值得注意**：AI Chat 明确**不能**做的事包括 —— 不能编辑文档正文/标题、不能创建或更新日历事件、不能发送邮件、**不能安排会议或设置 Motion 任务以外的提醒**、不能在没有你触发的情况下跑周期性/自动化动作、不支持语音。[来源: https://www.usemotion.com/help/knowledge-management/ai-chat/reference-ai-chat.md]

**结论**：**排程是「自动执行」，AI Chat 是「建议 + 需确认」。** 二者不是同一条链路。

---

## 1.4 问题 3：自动排程机制（核心问题）

### 1.4.1 输入参数（官方「What Auto-Scheduling considers」全表）

Motion 的 auto-scheduling 明确评估以下参数：

| 参数 | 官方说明 |
|---|---|
| **Start date** | 任务最早可开始的日期。「Tasks will not be scheduled before this point, even if time is available.」 |
| **Duration** | 总预计时长。「You can set duration into chunks, Auto-Scheduling will schedule each chunk into multiple scheduled sessions」 |
| **Deadline** | 最晚完成时间。「Auto-Scheduling prioritizes tasks with sooner deadlines.」 |
| **Priority** | 相对重要性。「Higher-priority tasks are placed earlier or in better time slots.」ASAP 最高，其次 High/Medium/Low |
| **Chunking** | 长任务切成小块塞进日历空隙，同时尊重总时长与 effort；可设最小分块 |
| **Schedules & breaks** | 遵守用户自定义工作时段与内置休息 |
| **Calendar events** | 「Fixed meetings, personal events, and custom time blocks are treated as unavailable time **if set as a 'Busy' event** and bypassed by Auto-Scheduling.」 |
| **Recurring** | 决定一次性还是重复；重复任务「can be pushed within their recurrence window but must follow repeat rules」 |

[来源: https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling/what-auto-scheduling-considers.md]

**关键细节**：外部日历事件只有在被标记为 **Busy** 时才会排斥排程。官方 Troubleshooting 明确：「**Task doesn't respect personal events** → The event is not on your My Calendar..., or it's **not marked as 'busy'**」。[来源: https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling/how-auto-scheduling-works-behind-the-scenes.md]

### 1.4.2 排程优先级层级（官方 scheduling hierarchy）

官方主文档给出的顺序：

1. **ASAP** — 「a special task state that overrides all other scheduling parameters. When a task is marked ASAP, Motion ignores other ordering signals like priority level or due date and schedules the task before everything else.」
   - 辅助细节：设置为 ASAP 后 **deadline 字段会变灰**，因为「you are telling Motion you want this task to be completed immediately」[来源: https://www.usemotion.com/help/time-management/auto-scheduling]
2. **Hard deadlines** — 「Motion ensures tasks with strict deadlines are completed on time. 🔒 **If no time is available within your normal schedule (e.g. 9–5), Motion will schedule the task outside those hours to meet the deadline.**」
   - 官方举例：正常 9–5，任务「Submit report」（High priority, Hard deadline today），9–5 已满 → **Motion 把它排到当天 18:00**。[来源: https://www.usemotion.com/help/time-management/auto-scheduling]
3. **Soft / flexible deadlines** — 按到期日排序，越早越先。[来源: https://www.usemotion.com/help/time-management/auto-scheduling]
4. **Priority** — High > Medium > Low；ASAP 永远第一。[来源: https://www.usemotion.com/help/time-management/auto-scheduling]
5. **Duration / chunking** — 长任务分块。[来源: https://www.usemotion.com/help/time-management/auto-scheduling]
6. **例外** — 「Recurring tasks (like daily routines) may be scheduled first if they are the only ones that fit into available time slots, **even if a one-off task has a higher priority**.」[来源: https://www.usemotion.com/help/time-management/auto-scheduling]

官方同时声明：「Motion's auto-scheduling **doesn't follow a single linear rule** — it balances priority, deadlines, and availability together.」[来源: https://www.usemotion.com/help/time-management/auto-scheduling]

### 1.4.3 引擎行为（Behind the Scenes）

1. **Inputs** → 任务参数（duration, start date, deadline, priority, **effort**）+ 用户 schedules + 既有日历事件
2. **Logic** → 扫描空闲时间块并按最有效顺序放置：先截止日与高优先级 → 必要时拆分长任务 → 尊重休息、工作时段与外部事件
3. **Output** → 任务以日历块形式出现，并带 **ETA**

[来源: https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling/how-auto-scheduling-works-behind-the-scenes.md]

**ETA 机制**：「Every task has an ETA (Estimated Time of Arrival) showing when it will be completed. ETAs act as 'beacons,' warning you if tasks are likely to miss their deadlines.」[来源: https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling/how-auto-scheduling-works-behind-the-scenes.md]

**跨项目排程**：「Auto-Scheduling weighs tasks **across all projects in the workspace**. Higher-priority or sooner-deadline tasks across projects are given scheduling precedence.」[来源: https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling/how-auto-scheduling-works-behind-the-scenes.md]

### 1.4.4 不会排程的情形（Edge Cases 官方表）

| 情形 | 官方行为 |
|---|---|
| 没有 duration 的任务 | **无法排程**。「A duration must be provided before Motion can place the task.」 |
| 既无 deadline 也无 priority 的任务 | **不会被排程**。「Motion will not place it on your calendar」 |
| start date 在未来 | **不会提前排**。「Motion will not schedule them until the start date arrives, even if earlier time is free.」 |
| chunking 下限 | 拆分尊重 **minimum block size**，不会切成没意义的小块 |
| 约束互相冲突 | 标记为 unschedulable（State = Could not fit） |
| **任务一直动** | 「Motion automatically reschedules tasks if higher-priority work or new events appear, **which can make some tasks shift multiple times.**」 |
| 外部日历冲突 | 「Events from connected calendars **always override** task blocks.」 |
| 跨 workspace 任务 | 不能在 workspace 之间排程 |

[来源: https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling/how-auto-scheduling-works-behind-the-scenes.md]

### 1.4.5 用户保留多少控制权（关键）

#### (a) 手动拖到日历 = 固定（fixed / pinned）

- 官方 Task Scheduling FAQ（通过 GitBook `?ask=` 动态问答获得的第一方回答）：
  > 「To stop Motion from auto-rescheduling a task, you need to make it **fixed / locked** (a **fixed-time** task).
  > 1. In **Calendar view**, **click and drag** over the exact time block to create a **fixed-time task** — or
  > 2. Take an existing task and **drag it directly onto the calendar** at the time you want.
  > A pinned task is **placed on your calendar exactly where you set it** and Motion won't move it dynamically.」

[来源: https://www.usemotion.com/help/project-management/task/task-scheduling-faq.md]

#### (b) 但「固定」不是绝对的 —— **60 分钟规则**

> 「However, **if the task is not completed within 60 minutes of its scheduled time slot for completion, Motion may reschedule it.** The task will show a **🔒 lock** when it's in this fixed state.」

[来源: https://www.usemotion.com/help/project-management/task/task-scheduling-faq.md]

**这是本次调研中对 heyta 最有价值的一条机制细节**：Motion 的「锁」带有超时自动解锁的语义 —— 用户可以钉住一个时间，但如果到点后 60 分钟内未动作，Motion 仍会把它挪走。

#### (c) 手动排程 vs 自动排程的官方定位

官方 Manual vs Auto Scheduling 页：
- 「Manual scheduling means placing tasks directly onto your calendar by dragging and dropping them into time slots. **Motion treats these placements as fixed tasks; the system won't automatically move them unless you manually reschedule.**」
- 官方对人工排程的措辞是**负面**的：Static ❌ / Time-consuming ❌ / Less predictive ❌ / Error-prone ❌，「Motion's optimization engine is bypassed, so deadlines, priorities, and ETAs are not recalculated dynamically.」
- 官方承认人工排程唯一胜出的场景是 **Fixed-time scheduling**（固定时刻）。
- 建议的人工排程场景：「Fixed commitments → When a task truly must happen at a specific time (e.g., client call prep at 8:30 AM)」以及「High-control scenarios: Critical tasks (e.g., finalizing notes before a board meeting)」

[来源: https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling/manual-vs-auto-scheduling.md]

#### (d) Pause auto-scheduling（逐任务暂停）

- 「**Pause auto-scheduling**: Temporarily prevent Motion from placing this task on your calendar. When paused, the task won't appear in your schedule until you turn auto-scheduling back on.」

[来源: https://www.usemotion.com/help/time-management/auto-scheduling/auto-scheduling-how-to-guide]

#### (e) 多套 Schedule + 每任务指定

- 可创建多套 schedule（如 Work / Personal / Weekend），逐任务在右侧栏的 **Schedule** 字段选择。
- 但硬约束会被打破：「When Hard Deadline is enabled, Motion could auto schedule the tasks **outside of the assigned schedule** so that you avoid missing the tasks' deadline.」
- 重复任务可设 **Custom schedule** + **ideal start time**。

[来源: https://www.usemotion.com/help/time-management/auto-scheduling/auto-scheduling-how-to-guide]

#### (f) 官方给「任务一直动」的处方

Troubleshooting 表：
> 「**Task keeps moving** | New meetings or higher-priority tasks are rescheduled ahead of it. | Adjust task priority or deadline, **or lock the task manually if the time is critical.**」

[来源: https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling/how-auto-scheduling-works-behind-the-scenes.md]

**控制权小结**：用户**可以**固定/钉住到具体时间、可以拖拽手动排、可以逐任务暂停 auto-scheduling、可以多套 schedule 约束、可以对重复任务设 custom schedule + ideal start time。但 —— (1) 固定会被 60 分钟超时规则打破；(2) Hard Deadline 会突破用户指定的 schedule；(3) 官方文档整体把「人工控制」定位为降级路径（「optimization engine is bypassed」）。

### 1.4.6 漏做 / 逾期任务的处理

| 状态 | 官方定义与行为 |
|---|---|
| **On Time** | 按 deadline 排程、无问题。灰色实线边框 + status ring |
| **Actively Working** | 已开始或有活动。与日历上的黑色时间条重叠 |
| **Past Due** | 「tasks that are either scheduled for a time slot **beyond their original deadline in the future** or have a deadline that has already passed. **Motion will notify you about any tasks that fall into this category**」红色 ❗ |
| **Can't Fit** | 「Motion's AI could not find a feasible time slot to schedule this task into your calendar **for the next 31 days (or 92 days for Motion teams)**」钉在日历顶部 + 红色 ❗；重复任务额外显示 🔄 |
| **Ghost** | 属于项目 workflow 但所属 stage 尚未激活（通常因前一 stage 未完成），尚未排程。可用 Display Options 隐藏 |
| **Reminder** | **duration ≤ 4 分钟**的任务，「pinned at the top of your calendar to nudge you..., **but they aren't scheduled directly on your calendar**」 |

[来源: https://www.usemotion.com/help/project-management/task/reference-tasks/task-states-and-task-types]

**过期后的动作**：「When a task is past due → **Motion reschedules the task into the next available slot.** Past-due tasks are surfaced visually (e.g., overdue indicator) so they aren't overlooked.」[来源: https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling/how-auto-scheduling-works-behind-the-scenes.md]

**注意 Can't Fit 的判定窗口是硬编码的 31 天（团队 92 天）** —— 这是一个很具体、可借鉴的产品常量。[来源: https://www.usemotion.com/help/project-management/task/reference-tasks/task-states-and-task-types]

### 1.4.7 其他相关机制

- **Chunked 任务**：用时间追踪器时，「it will automatically split the task based on the amount of time you plan to spend on it versus the entire task duration」，并以 ½、1/2、2/2 这类分数标注。[来源: https://www.usemotion.com/help/project-management/task/reference-tasks/task-states-and-task-types]
- **重复任务的漏做**：「Missed instances of a recurring task may either go past due if the task has a more spread-out cadence, or **may not be scheduled at all if it is a daily recurring task, as two instances of the same task cannot be scheduled on the same day.**」[来源: https://www.usemotion.com/help/project-management/task/reference-tasks/task-states-and-task-types]
- **去重/来源标记**：Siri / 邮件创建的任务标 ✨。[来源: https://www.usemotion.com/help/project-management/task/reference-tasks/task-states-and-task-types]
- **Free vs Busy 语义**：只有 Busy 事件会排斥排程（见 1.4.1）；独立文档 `free-vs-busy-tasks-in-motion` 存在。[来源: https://www.usemotion.com/help/llms.txt]
- **2023-12-05 的一次排程语义变更**：「Auto-schedule is decoupled from Statuses: you can move a task to any status AND have it be auto-scheduled at the same time.」[来源: https://www.usemotion.com/blog/understanding-auto-scheduled-updates.html]
- **Calendar 重置**：Calendar 上点某天的 ⏰ 图标 → 弹出层底部选 **Reset hours**。[来源: https://www.usemotion.com/help/time-management/auto-scheduling]

---

## 1.5 问题 4：定价（含精确数字与观察日期）

### 1.5.1 当前定价（**观察日 2026-09-25**）

官方定价页结构：**Individuals | Teams** 两个轨道 × **Pay monthly | Pay annually (Save 33%)** 两个计费周期。

**默认渲染态（Teams 轨道 + Pay annually）**：

| 计划 | 价格 | 含 AI credits | 超额单价（每 100 credits） |
|---|---|---|---|
| **Pro AI** | **$19 /seat/mo** | **7,500 credits/seat/month** | **25 cents / 100 credits** |
| **Business AI** | **$29 /seat/mo** | **15,000 credits/seat/month** | **19 cents / 100 credits** |

[来源: https://www.usemotion.com/pricing]

Business AI 相对 Pro AI 的增量：「Team Capacity Planning、Advanced Dashboards & Reports、Timeline & Gantt Charts、Time Tracking、Permissions & Access Control、Central Billing、Priority Support、Priority Business Support、White Glove Onboarding and Support」。[来源: https://www.usemotion.com/pricing]

**Individuals 轨道**：官方定价页的 Individuals 面板由 JS 渲染，本次抓取的 HTML 中未落地该面板数字（页面同时显示 "This plan is not available"，说明抓取时停留在 Teams 态）。以下数字来自**两个独立第三方来源，且互相一致**：

| 计划 | 月付 | 年付 | 含 credits |
|---|---|---|---|
| Pro AI (Individuals) | **$49/mo** | **$29/mo** | 7,500/month |
| Business AI (Individuals) | **$69/mo** | **$39/mo** | 15,000/month |
| Pro AI (Teams) | **$29/seat/mo** | **$19/seat/mo** | 7,500/seat/month |
| Business AI (Teams) | **$49/seat/mo** | **$29/seat/mo** | 15,000/seat/month |

[来源: https://www.morgen.so/blog-posts/motion-pricing （文章日期 April 30, 2026）]
[来源: https://www.usagepricing.com/blueprint/motion （页面标注 "Prices captured from usemotion.com/pricing on 2026-06-08"）]

**超额单价完整表**（usagepricing，2026-06-08 抓取）：

| 计划 / 轨道 | 计费 | 含 credits/mo | 超额 / 100 credits |
|---|---|---|---|
| Pro AI — Teams | Annual | 7,500 | 25¢ |
| Business AI — Teams | Annual | 15,000 | 19¢ |
| Pro AI — Teams | Monthly | 7,500 | 39¢ |
| Business AI — Teams | Monthly | 15,000 | 33¢ |
| Pro AI — Individuals | Annual | 7,500 | 39¢ |
| Business AI — Individuals | Annual | 15,000 | 26¢ |
| Pro AI — Individuals | Monthly | 7,500 | 65¢ |
| Business AI — Individuals | Monthly | 15,000 | 46¢ |

[来源: https://www.usagepricing.com/blueprint/motion]

**结论（对 heyta 重要）**：**同样的两个计划，Individuals 与 Teams 轨道的价格差约 50%，且超额单价随席位价浮动** —— credits 在席位最便宜的地方也最便宜。[来源: https://www.usagepricing.com/blueprint/motion]

### 1.5.2 免费层与试用

- **没有永久免费层。** 官方定价页只写「Start your free trial. Risk free. Cancel anytime.」[来源: https://www.usemotion.com/pricing]
- **试用 = 7 天，且需要先填信用卡。**「Motion offers a 7-day free trial, but you must enter your card details to start.」[来源: https://www.morgen.so/blog-posts/motion-pricing]
- 多方独立评测一致：「There is **no free plan** — only a 7-day free trial that requires a credit card up front.」[来源: https://www.usecarly.com/blog/motion-pricing/]
- 也有评测写「7-day free trial with no credit card required」，与上条冲突；以官方页面 + morgen 的描述为准 → **7 天试用，是否强制绑卡存在来源冲突，未找到公开信息可裁决**。[来源: https://ellieplanner.com/comparisons/motion-app-review]
- 无 Enterprise / contact-sales 层；所有价格、credits、超额费率均公开列出。[来源: https://www.usagepricing.com/blueprint/motion]

### 1.5.3 历史高价与 2024–2026 的价格变化（重点）

**历史轨迹（第三方定价史站点）**：
- **2021 年起步**：「Motion started in 2021 as **a flat $19/mo calendar extension**」[来源: https://www.usagepricing.com/blueprint/motion]
- **2025 年 9 月**：宣布融资时产品定位转向「agentic work suite」。[来源: https://www.usemotion.com/blog/motion-raises-60m-to-build-the-agentic-work-suite-for-businesses.html]
- **2025 年秋**：「repackaged repeatedly through task management and AI auto-scheduling, **briefly tested a multi-tier 'AI Employees' credit grid in late 2025**」[来源: https://www.usagepricing.com/blueprint/motion]
- **2025-11 前后爆发老用户涨价争议**：r/UseMotion 帖标题为 **"(BEWARE) Motion is charging existing customers 3x more ..."**（检索结果元数据，帖子约 10 个月前发布）；同页摘要显示「They finally added (somewhat) reasonable pricing again. 'Pro AI' plan - **$49/month for solo professionals**. 'Business AI' at **$69/month**.」[来源: https://www.reddit.com/r/UseMotion/comments/1p94uxr/beware_motion_is_charging_existing_customers_3x/]
- **2026 年**：「Motion **dropped the 'AI Employees' grid and returned to Pro AI ($19/seat/mo) and Business AI ($29/seat/mo)**, now with explicit AI credit pools」[来源: https://www.usagepricing.com/blueprint/motion]

**是否有更便宜的档位？**
- **没有新增低价档。** 2026 年观察到的最低价仍是 Teams 轨道的 Pro AI 年付 $19/seat/mo。[来源: https://www.usemotion.com/pricing]
- 第三方评测明确指出：「Motion **has no free tier** — only a risk-free trial」[来源: https://www.usagepricing.com/blueprint/motion]；「Motion is **not the right fit for teams that need a free permanent tier**: Reclaim.ai offers a free Lite plan and Clockwise has a free tier, while Motion requires a paid commitment after the 7-day trial」[来源: https://theaiagentindex.com/agents/motion]
- 相反方向的变化是**变贵**：引入 AI credits 计量层 + 2025 年的 AI Employees 档位。「**AI credits increase the real Motion cost**: Beyond the subscription, advanced AI features use monthly credits, and heavy usage adds overage charges on top of your base plan」[来源: https://www.morgen.so/blog-posts/motion-pricing]

**「Motion 历史上价格偏高」的量化对照**：
- 2025-11-11 的评测记录当时为「$34 per month on a monthly plan, or $19 per month when billed annually ($228 per year)」—— 即**个人轨道月付历史高点约 $34/mo**。[来源: https://ucals.com/articles/is-motion-app-worth-it-2026]
- 2026 年个人轨道月付为 **$49/mo**（morgen + usagepricing 一致）。[来源: https://www.morgen.so/blog-posts/motion-pricing]

### 1.5.4 计费单位与结构性风险

- 计费绑定在 **workspace**，不是个人：每个 workspace 独立订阅、独立 billing owner、独立席位分配。Full Access（Owner / Admin / Member）各占一个 seat。[来源: https://www.usemotion.com/help/project-management/workspaces/reference-workspaces/billing-and-plans.md]
- **AI credits 是独立于席位的用量层**，会让人均实际成本高于标价。[来源: https://www.usagepricing.com/blueprint/motion]

---

## 1.6 问题 5：模型供应商与云/端侧

### 1.6.1 官方披露的供应商

Motion 的 **Subprocessors** 页面（Last updated: April 29, 2025）明确列出一家 AI 平台供应商：

| 实体 | 处理目的 | 位置 |
|---|---|---|
| **OpenAI** | **AI Platform** | United States |
| Google Cloud Platform | Compute platform | United States |
| Bright Data | Web scraping vendor for **AI Employees** | United States |
| Crunchy Data | Encrypted database | United States |
| Cloudflare | Content delivery network | United States |
| Snowflake / FiveTran / Amplitude / DataDog | 分析类 | United States |
| Temporal / Hatchet / Kurrent | 异步与流处理 | United States |
| Exa / 其他 | — |（未在本次抓取中出现）|

[来源: https://www.usemotion.com/legal/subprocessors]

**唯一被点名的 AI 平台供应商是 OpenAI。** 其余（Google Cloud Platform）是计算平台而非模型供应商。Bright Data 被明确标注为 **AI Employees** 的网页抓取供应商（与 1.2.5 中 AI Employees 的存在互相印证）。

### 1.6.2 具体模型版本

**未找到公开信息** —— Motion 官方帮助中心与 Subprocessors 页面均**未指名具体模型版本**（如 GPT-5.x / Claude / Gemini 等）。

官方 AI Chat Reference 只使用泛称：「Generate coherent and contextually relevant text using **large language models (LLMs)**」「Conduct internet research using **grounding-enabled models**」。[来源: https://www.usemotion.com/help/knowledge-management/ai-chat/reference-ai-chat.md]

### 1.6.3 云 vs 端侧

**全部在云端（US），无端侧 AI 的任何官方记载。** 依据：
- 所有 AI 供应商位置均为 United States [来源: https://www.usemotion.com/legal/subprocessors]
- AI Chat 的功能描述涉及服务端检索、JSONPath 查询、外部搜索、人物背景调查 —— 均为服务端能力 [来源: https://www.usemotion.com/help/knowledge-management/ai-chat/reference-ai-chat.md]
- 官方文档没有任何 on-device / local model 的表述。
- **端侧：未找到公开信息。**

### 1.6.4 安全与合规信号

官网 footer 展示 **GDPR compliant** 徽章与 **AICPA SOC 2 Type II** 徽章。[来源: https://www.usemotion.com/legal/subprocessors]

---

## 1.7 问题 6：用户情绪

### 1.7.1 评分（来自检索结果元数据；平台页面本身被反爬拦截）

| 平台 | 评分 | 评论数 | 备注 |
|---|---|---|---|
| Trustpilot | **3.7 / 5** | **577–578** | 页面本身返回 403，评分为检索结果元数据 |
| G2 | 未获取到总结评分 | — | 需登录；仅拿到被第三方引用的单条评论 permalink |

[来源: https://www.trustpilot.com/review/www.usemotion.com （评级与评论数来自检索结果元数据，2026-09-25）]

### 1.7.2 最有价值的正面评价

- **auto-scheduling 真的有用**：「Motion's auto-scheduling is genuinely good. If your calendar is chaos, it's worth trying.」（该评测将 Motion 的 AI scheduling 单项评为 **9/10**）[来源: https://www.saner.ai/blogs/motion-reviews]
- 「**I sit down on Monday morning and my calendar is set up for me, ready to go.**」— G2 评论，经第三方转引 [来源: https://www.saner.ai/blogs/motion-reviews（转引 G2 reviews）]
- 「I used Motion to sync my apple, google, work and personal calendars all in one spot. This allows me to check one calendar for conflicts instead of 5.」— Capterra 评论，经第三方转引 [来源: https://www.saner.ai/blogs/motion-reviews（转引 Capterra）]
- 「Motion's meeting booking pages save me a ton of back-and-forth.」[来源: https://www.saner.ai/blogs/motion-reviews]
- 「The AI Notetaker actually pulled the right action items and put them straight on my calendar.」[来源: https://www.saner.ai/blogs/motion-reviews]
- **承认自动化本身是对的，但周边差**：r/UseMotion「Why does Motion kinda suck?」帖摘要：「I need to preface this by saying that **the main core of this app functions really well. The AI generated scheduling is awesome.** I'm currently using the ...」[来源: https://www.reddit.com/r/UseMotion/comments/1iy5ux3/why_does_motion_kinda_suck/ （摘要来自检索结果；页面被反爬拦截）]

### 1.7.3 最常见的抱怨

**A. AI 挪动了用户不想被挪的东西（本问题的核心）**

- r/UseMotion **「Lack of Manual Scheduling will likely force me to quit ...」**：「I've been using Motion for **2.5 years** and have found it pretty helpful. But I feel like I'm reaching a **breaking point with the way scheduling works.**」[来源: https://www.reddit.com/r/UseMotion/comments/1jdjrzr/lack_of_manual_scheduling_will_likely_force_me_to/ （摘要来自检索结果；页面被反爬拦截）]
- r/UseMotion「Manually scheduling a task on the calendar?」：「Is it possible to manually schedule a task onto the calendar **before** it is auto scheduled? I know if it's already on the calendar I can move it around.」[来源: https://www.reddit.com/r/UseMotion/comments/1cqax7u/manually_scheduling_a_task_on_the_calendar/ （摘要来自检索结果）]
- r/UseMotion **「Over Motion and the Support」**：「The scheduling is **constantly glitching out and creates random blocks where tasks won't schedule.** Even the help option is buggy and won't work ...」[来源: https://www.reddit.com/r/UseMotion/comments/1m4dpme/over_motion_and_the_support/ （摘要来自检索结果）]
- 第三方评测转述：「Motion scheduled my day **so tightly that I had no breathing room**. ... Some users report that Motion packs their day too tightly, leaving no room for the unplanned work that inevitably shows up. The algorithm optimizes for fitting everything in, which can create a schedule that feels oppressive rather than helpful」[来源: https://www.saner.ai/blogs/motion-reviews（转引 The Business Dive）]
- **官方文档自己承认了这一点**（见 1.4.4 / 1.4.5f）：「Tasks keep moving → Motion automatically reschedules tasks if higher-priority work or new events appear, **which can make some tasks shift multiple times.**」官方给用户的处方是「lock the task manually if the time is critical」。[来源: https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling/how-auto-scheduling-works-behind-the-scenes.md]

**B. 价格持续上涨 + 试用自动转付费**

- 「The tool is very useful, but **pricing has increased a few times.** I wish there were a discount for students or military...」— Trustpilot 评论，经第三方转引 [来源: https://www.saner.ai/blogs/motion-reviews]
- 「**Free trial was automatically changed to a year membership.** Tried to message them straight after, but was impossible...」— Trustpilot 评论，经第三方转引 [来源: https://www.saner.ai/blogs/motion-reviews]
- 该评测总结：「Auto-converting short trials to annual subscriptions with limited cancellation windows is a pattern that shows up across multiple reviews.」[来源: https://www.saner.ai/blogs/motion-reviews]
- Reddit 帖标题本身即为涨价控诉（见 1.5.3）。[来源: https://www.reddit.com/r/UseMotion/comments/1p94uxr/beware_motion_is_charging_existing_customers_3x/]

**C. UI / 产品演进停滞 / 移动端弱**

- 「We've been using Motion for about **2 years** now and it's seemed to **hardly evolve** during our time using it. The AI calendar was the main draw, and works awesome, but the **project management side** of things...」— Trustpilot 评论，经第三方转引 [来源: https://www.saner.ai/blogs/motion-reviews]
- 「The product's **aimless development over the last year, leading to terrible bloat**. The UI is still just as **janky/crusty/clunky** as it was when I signed up two years ago. Instead of polishing their product, the team went to **chase trends** instead.」— G2 评论，经第三方转引 [来源: https://www.saner.ai/blogs/motion-reviews]
- 「The mobile app feels like a **stripped-down afterthought** compared to the desktop.」[来源: https://www.saner.ai/blogs/motion-reviews]
- 「The **unusable mobile app** also makes me use Motion less」[来源: https://www.saner.ai/blogs/motion-reviews]
- 该评测的分类评分：AI scheduling **9/10**，Ease of use/onboarding **5/10**，Project management **5/10**，Mobile **5/10**，Pricing/value **5/10**，Knowledge management **2/10**，Overall **6/10**。[来源: https://www.saner.ai/blogs/motion-reviews]

---

## 1.8 补充：公司规模 / 融资 / 估值 / 「AI」营销强度

### 1.8.1 融资与估值

| 事件 | 时间 | 金额 | 估值 | 来源 |
|---|---|---|---|---|
| Series B | — | **$30M**，Inovia 领投，Threshold Ventures 与既有投资人 Headline 参投 | — | [来源: https://motionapp.com/blog/motion-30-million-series-b-funding-announcement]（检索结果元数据） |
| Series B + C + C2 合计 | **2025-09** | **$60M** | **$550M** | [来源: https://www.usemotion.com/blog/motion-raises-60m-to-build-the-agentic-work-suite-for-businesses.html] |
| 累计融资 | 2025-09 | **$75M** | — | 同上 |
| Series A | 2022 | **$13M**（SignalFire） | — | [来源: https://www.usagepricing.com/blueprint/motion] |
| 累计（另一口径） | 2026-08 | **$102M / 5 轮**（1 Seed、3 Early-Stage、1 Late-Stage） | — | [来源: https://tracxn.com/d/companies/motion/__t276T9f6sM7Cc0NH9QDfuWXRiprodhRUT6iEBA0SbhU/funding-and-investors]（检索结果元数据） |

**注意口径冲突**：Motion 官方 2025-09 口径是「累计 $75M」，Tracxn 2026-08 口径是「累计 $102M / 5 轮」。两者不一致，可能因后续轮次或统计口径差异 —— **未能裁决，未找到公开信息**。

融资新闻稿另称：「Motion has raised a total of $60M across Series B, Series C, and Series C2, bringing its total raised to $75M and a latest valuation of $550M」，并称资金用于「expand its engineering and product teams to further develop its AI-driven solutions for **SMBs**」。[来源: https://www.reworked.co/the-wire/motion-raises-60m-at-550m-valuation-to-build-the-agentic-work-suite-for-businesses/]

创始人：**Harry Qi**。[来源: https://www.linkedin.com/posts/harryqi_today-motion-raised-60m-at-a-550m-valuation-activity-7370834354857709568-P5Xc （检索结果元数据）]

### 1.8.2 规模

- 「over **1 million users**」「**100,000+ paying users** across **30+ countries**」「over **10 million hours saved**」（官方自述）[来源: https://www.usemotion.com/llms.txt]
- 「serving over **100,000 customers**」（第三方）[来源: https://www.usagepricing.com/blueprint/motion]

### 1.8.3 「AI」营销的强度（客观描述）

Motion 的营销把「AI」前置到了产品架构层面，具体表现：

1. **命名全面 AI 化**：官网导航栏把每个功能都冠以 "AI" 前缀 —— AI Project Manager / AI Gantt Chart / AI Workflows / AI Task Manager / AI Calendar / AI Meeting Assistant / AI Chat / AI Meeting Notetaker / AI Docs Assistant。**连甘特图都叫 "AI Gantt Chart"**。[来源: https://www.usemotion.com/pricing]
2. **定价档位直接叫 AI**：计划名不是 Pro/Business，而是 **Pro AI / Business AI**。[来源: https://www.usemotion.com/pricing]
3. **计费单位也叫 AI**：**AI credits**，7,500 / 15,000 credits/seat/month。[来源: https://www.usemotion.com/pricing]
4. **2025 年的组织性押注**：融资稿自称 build「**the agentic work suite** for businesses」。[来源: https://www.usemotion.com/blog/motion-raises-60m-to-build-the-agentic-work-suite-for-businesses.html]
5. **量化的夸张承诺**：首页「**Finish 137% more work**」「Projects in Motion get done **32% faster**」「**over 90% accurate out of the box**」。[来源: https://www.usemotion.com/]（**注意：这三个数字均无方法论披露**）
6. **对比页直接点名竞品**：/compare/wrike-vs-motion、/compare/asana-vs-motion、/compare/clickup-vs-motion、/compare/monday-vs-motion。[来源: https://www.usemotion.com/legal/subprocessors （footer 链接）]
7. **定位叙事**：首页标题 **「Stop using tech from the pre-AI era」**。[来源: https://www.usemotion.com/]

**一个反讽性观察**：尽管营销全面 AI 化，其**真正被用户称赞的（见 1.7.2）仍然是 2021 年就存在的 auto-scheduling 排程引擎**，而 2025 年的 AI Employees 冲刺反而被用户批评为「chase trends」导致「terrible bloat」。[来源: https://www.saner.ai/blogs/motion-reviews]

---

# 第二部分：Reclaim.ai

## 2.1 概览

Reclaim.ai 是构建在既有日历之上（Google Calendar / Outlook）的 AI 排程层，核心是 **保护 focus time、自动排 tasks / habits / buffers / meetings**。官方 slogan：「Reclaim is an AI-powered app that creates **40% more time** for teams — auto-schedule tasks, habits, meeting & breaks — free on Google Calendar & Outlook」[来源: https://reclaim.ai/]

自称「**#1 AI calendar for work. 4.8 stars on G2**」[来源: https://reclaim.ai/]

**2026 年是产品分水岭**：Reclaim 2.0 发布，引入 AI Assistant 与「AI Agents」体系，把 1.0 的 Focus Time / Habits / Buffer Time / Smart Meetings 重新包装为 **agents**。[来源: https://help.reclaim.ai/en/articles/14846468-reclaim-ai-2-0-overview]

**重要文档状态**：Reclaim 帮助中心**目前 1.0 与 2.0 文档并存**。核心排程机制文档明确标注「**This article refers to Reclaim 1.0 features and workflows**」，并指引用户到 2.0 文档集合。2.0 文档则说「*Still on Reclaim 1.0?* Contact support@reclaim.ai **to request early access to Reclaim 2.0**.」→ **说明截至 2026-09-25，Reclaim 2.0 处于「已发布但需申请早期访问」的过渡态。**[来源: https://help.reclaim.ai/en/articles/6207587-how-reclaim-manages-your-schedule-automatically] [来源: https://help.reclaim.ai/en/articles/14846468-reclaim-ai-2-0-overview]

---

## 2.2 Dropbox 收购（含日期、价格、收购后变化、现状）

### 2.2.1 日期

- **2024-08-20**：Reclaim 官方博客发布《Reclaim is joining Dropbox (and a note from our founders)》，文章日期标注 **August 20, 2024**。[来源: https://reclaim.ai/blog/dropbox-acquires-reclaim]
- **2024-08-20**：产品更新公告《Reclaim is now a part of Dropbox》同日发布。[来源: https://updates.reclaim.ai/announcements/reclaim-is-now-a-part-of-dropbox]
- **2024-08-20**：Hacker News 讨论帖发布，24 条评论。[来源: https://news.ycombinator.com/item?id=41302030]
- **2024-08-22**：TechCrunch 与 SiliconANGLE 报道。[来源: https://techcrunch.com/2024/08/22/dropbox-acquires-index-ventures-backed-ai-scheduling-tool-reclaim-ai/]

### 2.2.2 价格

**未找到公开信息。**

TechCrunch 明确写道：「**Dropbox hasn't disclosed the terms of the deal.**」[来源: https://techcrunch.com/2024/08/22/dropbox-acquires-index-ventures-backed-ai-scheduling-tool-reclaim-ai/]

可查到的相关财务背景：Reclaim 在被收购前累计融资 **$9.5M**（Sequoia 系报道为 "more than $9.5 million"），投资方包括 **Calendly**、**Index Ventures**、**Yummy Ventures**、**Gradient**。[来源: https://siliconangle.com/2024/08/22/dropbox-acquires-ai-powered-calendar-app-reclaim-ai/]

另一来源口径为「raised a total funding of **$9.5M over 2 rounds**. Its first funding round was on **May 26, 2021**.」[来源: https://tracxn.com/d/companies/reclaim/__UQxSBpS1WumnBpGCwPhGX75bxV8H0k-tKgBUsvmCBc4]

### 2.2.3 Dropbox 说了什么 / 收购后承诺

Reclaim 官方公告的核心承诺（原文）：

> 「As part of the Dropbox team, we're going to continue investing in the Reclaim you know and love. Expect to continue seeing new features and updates that further enhance the product experience, **with no planned changes to pricing or customer support anytime soon.**」
>
> 「The biggest difference you'll see? We now have even more resources and expertise at our side...」

[来源: https://reclaim.ai/blog/dropbox-acquires-reclaim]

公告还引用了 Dropbox CEO **Drew Houston** 2018 年 3 月的一封信（"a letter from our founders"）来描述战略契合：

> 「Imagine getting to work in the morning to find your calendar reorganized so you have a three-hour block of time to actually focus. Imagine starting your day and seeing the perfect to-do list—one based on a deep understanding of your priorities and your team's priorities.」

[来源: https://reclaim.ai/blog/dropbox-acquires-reclaim]

公告中透露的**收购后近期 roadmap**（原文）：「Our key priorities over the next few months include **launching Outlook support for all our users**, migrating users to t...」（后文在抓取中被截断）[来源: https://reclaim.ai/blog/dropbox-acquires-reclaim]

**Dropbox 官方 newsroom 公告：未找到公开信息。** 本次调研未能检索到 Dropbox 官方 blog / newsroom 上关于此收购的独立页面；仅有 Reclaim 侧公告、Dropbox CEO 的既有旧信引用，以及第三方报道。

### 2.2.4 收购后实际发生了什么（可验证的）

| 时间 | 事件 | 来源 |
|---|---|---|
| 2024-08-20 | 收购公布；承诺「no planned changes to pricing」 | [来源: https://reclaim.ai/blog/dropbox-acquires-reclaim] |
| 2024-08-20 | 联合创始人在 HN 回应质疑：「unlike many tech acquisitions, **we were able to keep the entire team and product intact** while continuing to invest in and pursue the long term vision we've had for Reclaim.」 | [来源: https://news.ycombinator.com/item?id=41302030] |
| 2025-05-16 | 商业媒体报道「Reclaim.ai **grows after Dropbox deal, launches Microsoft Outlook tool**」，并称这是「the **first big update** since the company was acquired **nine months ago**」 | [来源: https://www.bizjournals.com/portland/inno/stories/news/2025/05/16/reclaim-ai-dropbox-outlook-calendar-tool.html] |
| 2025-08 前后 | 完整 Outlook Calendar 支持上线（Focus Time、Habits、Tasks、Smart Meetings、Scheduling Links、Buffer Time） | [来源: https://www.saner.ai/blogs/reclaim-ai-reviews] |
| 2026 | 品牌出现 **"Reclaim.ai from Dropbox"** 的表述 | [来源: https://leadiq.com/c/reclaimai-from-dropbox/5da89818408f0cc3d9262e10] |
| 2026-05-29 | 《Reclaim AI Disclosure》更新，明确 LLM 由 Dropbox 环境私有托管 | [来源: https://help.reclaim.ai/en/articles/13178785-reclaim-ai-disclosure] |
| 2026 年 | 推出 Reclaim 2.0（AI Assistant + AI Agents + Preview Mode + MCP） | [来源: https://help.reclaim.ai/en/articles/14846468-reclaim-ai-2-0-overview] |

### 2.2.5 当前状态：是否仍独立运营？是否被并入 Dropbox？

**结论：仍以独立产品形态运营，但已归入 Dropbox 品牌体系；没有证据显示被"并入/关闭"。**

- 独立运营的证据：**独立域名 reclaim.ai**、**独立定价页**、**独立 app.reclaim.ai**、**独立帮助中心 help.reclaim.ai**、**独立博客**、**独立 Slack Marketplace 上架**（截至 2026-09-25 全部在线）。[来源: https://reclaim.ai/pricing] [来源: https://slack.com/marketplace/ARSJUP4R0-reclaimai]
- 品牌归属的证据：第三方公司数据库条目名称为 **"Reclaim.ai from Dropbox"**。[来源: https://leadiq.com/c/reclaimai-from-dropbox/5da89818408f0cc3d9262e10]
- 第三方在 2026 年的总结：「As of 2026, **Reclaim.ai is still operating normally under Dropbox, with unchanged pricing and its original team still working on the product**」[来源: https://blog.archcalendar.com/6-best-reclaim-ai-alternatives-in-2026-now-that-dropbox-owns-it/]
- 也有专门辟谣「Reclaim 是否要关停」的文章：「Did Dropbox buy Reclaim? Yes. Dropbox acquired Reclaim.ai in August 2024 and **kept the product running**, as announced in Reclaim's own update.」[来源: https://www.usecarly.com/blog/is-reclaim-shutting-down/]
- 收购时 HN 上的社区情绪偏负面/担忧：一条高赞评论写道「I don't see this as a good thing. **HelloSign was acquired by DropBox and is basically a stagnant has-been**...」；另一位长期用户写道「Reclaim.ai has been an incredibly valuable tool for me and my work. I'll admit to feeling like **this will be the beginning of the end** for me.」[来源: https://news.ycombinator.com/item?id=41302030]

### 2.2.6 收购后定价是否变化？

**未找到第一方证据显示发生了价格变化。**

- 收购公告承诺「no planned changes to pricing or customer support anytime soon」（2024-08-20）。[来源: https://reclaim.ai/blog/dropbox-acquires-reclaim]
- GeekWire 报道同日转述：「Reclaim said it is **not changing its product pricing or customer support 'anytime soon.'**」[来源: https://www.geekwire.com/2024/dropbox-acquires-reclaim-a-calendar-app-that-uses-ai-scheduling-to-boost-productivity/]
- 2026 年第三方独立总结：「**unchanged pricing**」[来源: https://blog.archcalendar.com/6-best-reclaim-ai-alternatives-in-2026-now-that-dropbox-owns-it/]
- **Reclaim 2.0 发布后档位与数字未变**：Lite / Starter $10 / Business $15 / Enterprise $22（年付）仍然是当前官方定价。[来源: https://reclaim.ai/pricing]
- **收购前（2024 年 8 月之前）的第一方价格快照：未找到公开信息。** 尝试通过 Wayback Machine 获取 `reclaim.ai/pricing` 的 2024-11 快照，archive.org 返回 **HTTP 429 Too Many Requests**；2024-07 的 `available` API 返回空快照。因此**无法用第一方快照对比收购前后价格**。

**第三方关于历史价格的口径存在冲突，仅供参考、不可作为事实**：
- 一种口径（saner.ai, 2026-04）：Starter **$8**/user/mo 年付 / $10 月付；Business **$12**/$15；Enterprise **$18**。[来源: https://www.saner.ai/blogs/reclaim-ai-reviews]
- 另一种口径（morgen.so, 2026-05-07）与官方当前页一致：Starter **$10** / Business **$15** / Enterprise **$22**（年付）。[来源: https://www.morgen.so/blog-posts/reclaim-pricing]
- 官方 2026-09-25 页面以 $10 / $15 / $22 为准。[来源: https://reclaim.ai/pricing]

---

## 2.3 问题 1：AI 功能的确切名称

### 2.3.1 官方导航中的产品级名称（第一方，2026-09-25 观察）

官方页脚与产品导航列出的**确切名称**：

- **AI Focus Time** — `Set a Focus Time goal, and let AI defend time to get stuff done.`
- **AI Scheduling Links** — `Share your availability using smart meeting controls.`
- **AI Buffer Time** — `Auto-schedule breaks & travel across your meetings & work sessions.`
- **AI Habits** — `Find the best times for your recurring routines.`
- **AI Smart Meetings** — `Find the best time to meet across all attendees' schedules.`
- **AI Time Tracking** — `Analyze your time across meetings, tasks, & work-life balance metrics.`
- **AI Tasks** — `Flexibly schedule your tasks in your calendar.`
- **AI Calendar Sync** — `Automatically defend time for events across all of your schedules.`
- **AI Planner** — `Automate the perfect daily plan & manage your smart events.`
- **Team OOO Calendar**
- **AI Assistant** — `Chat with your AI Assistant to plan, prioritize, and optimize your schedule.`
- **Workforce Analytics**
- **AI Hours** — /features/working-hours
- **AI Agent Library** — reclaim.ai/ai-agent-library

[来源: https://reclaim.ai/pricing （侧边/页脚产品导航）]

### 2.3.2 Reclaim 2.0 引入的新命名（第一方，帮助中心）

**Reclaim.ai 2.0** 的核心新构件：

1. **AI Assistant（Schedule Assistant）** — 「The Schedule Assistant acts as your control center. It highlights what needs attention and suggests what to do next.」
2. **Planner & Preview Mode** — 「a calendar sandbox that lets you safely test changes, understand what will move, and apply updates only when you're ready.」
3. **AI Agents** — 官方列出的五类：
   - **Focus Time** — `Protects time for deep work`
   - **Habits** — `Keep recurring work on track`
   - **Buffers** — `Add prep and recovery time around meetings`
   - **Smart Meetings** — `Auto-schedule time for recurring meetings`
   - **Meeting quality** — `Flag meetings that may need attention`
4. **MCPs & Integrations** — Google Calendar、Outlook、Todoist、ClickUp、Jira、Asana、Linear、Slack，以及 **MCP (Model Context Protocol)**

[来源: https://help.reclaim.ai/en/articles/14846468-reclaim-ai-2-0-overview]

**2.0 的自然语言交互示例**（官方原文）：
- 「Help me get my week back on track」
- 「Cancel my meetings today」
- 「What should I work on next?」
- 「Create an agenda for this meeting」

[来源: https://help.reclaim.ai/en/articles/14846468-reclaim-ai-2-0-overview]

### 2.3.3 其他被官方命名的 AI 能力

- **AI Memories** — 「Create AI Memories that store, recall, and utilize your personal preferences to maintain context for future optimizations.」（计划功能表中存在此条目）[来源: https://reclaim.ai/pricing]
- **Meeting Quality Agents**（具体子项）：「**RSVP Reminder Agent**」「**Video Link Check Agent**」「**Attendee Availability Agent**」「**Room & Resource Decline Alert Agent**」[来源: https://reclaim.ai/pricing]
- **Auto-Rescheduling** — 在功能对比表中作为独立能力行出现，Lite 为 `Limited`，付费档为完整版 [来源: https://reclaim.ai/pricing]
- **Auto-rescheduling recommendations** — 「Resolve scheduling conflicts in one click with AI-powered recommendations」[来源: https://reclaim.ai/pricing]
- **Proactive / Reactive Focus Time mode** — Proactive:「Automatically defend Focus Time on your calendar using your weekly goal target」；Reactive:「Only defend Focus Time when my week gets too full using a daily and/or weekly minimum」[来源: https://reclaim.ai/pricing]
- **AI meeting agenda creation / follow-up email / transcript sync** — 均在功能表中 [来源: https://reclaim.ai/pricing]
- **ChatGPT / Claude / Microsoft Copilot 集成** — 「Connect Reclaim to ChatGPT to automatically manage, optimize, and analyze your time right from ChatGPT」；「Claude/Claude Code MCP」；「Microsoft Copilot / Copilot Cowork MCP」[来源: https://reclaim.ai/pricing]
- 帮助中心另有 Reclaim 2.0 + ChatGPT integration 与 Reclaim 2.0 + Claude integration 的独立文档。[来源: https://help.reclaim.ai/en/articles/13178785-reclaim-ai-disclosure （Related Articles）]

### 2.3.4 计划功能表中存在的功能名（完整对照）

「Tasks time-blocking」「Tasks time tracking & timers」「Task recommendations from meetings」「Google Tasks / Todoist / Asana / ClickUp / Jira / Linear integration」「Slack Status Sync」「Raycast extension」「Zoom meetings & transcripts integration」「Google Calendar & Gmail Add-on」「Microsoft Teams support」「Weekly productivity reports」「Productivity stats / time tracking」「Team analytics stats」「Workforce Analytics」「Team OOO Calendar」「Delegated Access」「No-Meeting Days」「Daily digests (conflict recommendation & agenda)」「Smart Color-Coding」「Time Blocking Customization」「Custom Hours Settings」「Habit templates」「Lunch Habit」「Smart Travel Time」「Travel Time Buffers」「Airport Travel Time Buffers」「Smart Meeting Breaks」「Meeting conflict notifications」「High-priority links」「Flexible durations」「Booking pages / link groups」「Round-robin links」「Automatically Convert 1:1s」。[来源: https://reclaim.ai/pricing]

---

## 2.4 问题 2：交互形态

Reclaim 同时具备三种形态，且 2.0 明确把「预览后再应用」作为设计原则：

| 形态 | 对应功能 | 第一方依据 |
|---|---|---|
| **自动执行** | AI Agents（Focus Time / Habits / Buffers / Smart Meetings / Meeting quality） | 「These run in the background, adapting your schedule as things change.」[来源: https://help.reclaim.ai/en/articles/14846468-reclaim-ai-2-0-overview] |
| **聊天助手** | AI Assistant（LLM chat） | 「The Schedule Assistant acts as your control center... You can also interact with Reclaim using natural language」[来源: https://help.reclaim.ai/en/articles/14846468-reclaim-ai-2-0-overview] |
| **建议 + 预览模式** | Planner & Preview Mode、Auto-rescheduling recommendations | 「**Preview Mode** is a new experience, offering a calendar sandbox that lets you **safely test changes, understand what will move, and apply updates only when you're ready.**」[来源: https://help.reclaim.ai/en/articles/14846468-reclaim-ai-2-0-overview] |

**关键**：Reclaim 的 Preview Mode 是一个**明确的"先看后应用"安全阀**——这一点与 Motion 的「自动执行 + 事后手动锁」形成鲜明对比。

1.0 侧的「建议」形态体现为 **Auto-rescheduling recommendations**：「Resolve scheduling conflicts in one click with **AI-powered recommendations**」[来源: https://reclaim.ai/pricing]

---

## 2.5 问题 3：自动排程机制（核心问题）

### 2.5.1 优先级体系（P1–P4）

官方表述：「Reclaim allows you to assign priority levels to **both smart Reclaim events *and* non-Reclaim events** (like meetings created in Google Calendar or Outlook Calendar)」

| 等级 | 官方定义 |
|---|---|
| **Critical (P1)** | 「Reclaim will schedule Critical items **before any other events**, and can **overbook** lower-priority items as your calendar books up.」 |
| **High priority (P2)** | 「prioritized before medium and low priority events, and can be overbooked by critical events.」 |
| **Medium priority (P3)** | 「prioritized before low priority events, and can be overbooked by medium-critical priority events.」 |
| **Low priority (P4)** | 「prioritized last, around your availability, and can be overbooked by higher-priority items.」 |

[来源: https://help.reclaim.ai/en/articles/6207587-how-reclaim-manages-your-schedule-automatically]

**核心排序规则（官方原文）**：
> 「Your Critical Smart Meetings and Habits will always take top billing, and Reclaim auto-schedules the rest of your events by **weighing priority and due dates** in the case of Tasks」
>
> 「For example, a **High priority Task with a due date that is further out might end up scheduling after a Medium priority Task that is due sooner.**」

[来源: https://help.reclaim.ai/en/articles/6207587-how-reclaim-manages-your-schedule-automatically]

**同优先级时的类型序**：
> 「If smart events have the same priority level — Reclaim will prioritize auto-scheduling your **Smart Meetings first, Habits second, and Tasks third**, based on your availability. **Tasks with the same priority level will schedule according to the soonest due date.**」

[来源: https://help.reclaim.ai/en/articles/6207587-how-reclaim-manages-your-schedule-automatically]

### 2.5.2 排程输入参数（scheduling rules）

创建 smart event（Habits / Tasks / Smart Meetings）时可设置：

- **Priority** — 防御等级
- **Duration** — 时长
- **Frequency** — 频率
- **Hours** — 在哪些 Scheduling Hours 内排
- **Starting** — 从何时开始排
- **Due date** — 任务必须在此前完成

> 「Reclaim will follow these rules when scheduling your smart events, and will automatically update events if you change these scheduling rules for existing Habits, Tasks, or Smart Meetings.」

[来源: https://help.reclaim.ai/en/articles/6207587-how-reclaim-manages-your-schedule-automatically]

**可用性来源**：
> 「Reclaim uses your Priorities to book events on the calendar **around your availability and your already scheduled higher-priority events**.」
>
> 「Additionally, Reclaim's AI scheduler will also consider your **customized Scheduling Hours** when booking events to ensure that your Personal, Working, and Meeting events are booked when you want them to be.」

[来源: https://help.reclaim.ai/en/articles/6207587-how-reclaim-manages-your-schedule-automatically]

**任务拆分**：创建 Task 时「Fill out the total Duration, and choose **Split Up** if it's a larger task and you would like to have it broken into multiple time slots on your calendar. Then choose the **min and max duration** of those time slots, add the Due Date」。[来源: https://help.reclaim.ai/en/articles/12304458-carve-out-time-for-work-with-tasks]

### 2.5.3 自动重排（auto-reschedule）的触发条件

- **更高优先级的会议压过来**：Scheduling Links「Depending on the priority you set for your individual Scheduling Links, Reclaim will offer up availability by showing *lower-priority* Habits, Tasks, Smart Meetings, and non-Reclaim events as open time slots to others.」
- 「If a higher-priority meeting is booked over a scheduled Habit, Task, or Smart Meeting — Reclaim will **automatically reschedule the overbooked event to the next best time** around your preferences.」
- **Smart Meetings**：「If you cannot make the meeting at the time it was scheduled, either the organizer and invitee of the Smart Meeting can '**Reschedule**' or '**Skip**' the event instance and Reclaim will automatically find the next best time across both calendars.」
- **非 Reclaim 事件可被降级**：「you can also adjust the priority level of the *non-Reclaim created events* on your calendar. **Turning down the priority of non-Reclaim calendar events** will allow those ti...」（原文截断）

[来源: https://help.reclaim.ai/en/articles/6207587-how-reclaim-manages-your-schedule-automatically]

### 2.5.4 用户保留多少控制权（关键）

#### (a) 手动拖拽 = 锁定（lock）

官方 Tasks 帮助文档：
> 「**Move the Task:** You can simply **drag-and-drop** a Task on the Planner to reschedule it. **Once you have manually moved it, it will lock into place and NOT auto reschedule again.**」
>
> 「**Move a Task:** You can simply drag-and-drop a Task on your Google or Outlook calendar to reschedule it. **Once you have manually moved it, it will lock into place and not auto reschedule again.**」

[来源: https://help.reclaim.ai/en/articles/12304458-carve-out-time-for-work-with-tasks]

#### (b) 直接在 Planner 上点/拖创建 = 永久锁定

> 「**Tip:** You can also schedule a Task (or Habit) directly on the Planner by **clicking or dragging anywhere in the future**, just as you would in Google or Outlook. Note, **these events will stay locked where you create them.**」

[来源: https://help.reclaim.ai/en/articles/12304458-carve-out-time-for-work-with-tasks]

#### (c) 三种「重排」路径的锁定语义不同（重要）

| 操作 | 是否锁定 |
|---|---|
| **拖拽移动**（Planner 或 Google/Outlook 日历） | ✅ **锁定**，不再自动重排 |
| **Reschedule**（Ctrl/Control-click → **Snooze**） | ❌ **不锁定** ——「Reclaim will give you future options, and **not lock the Task at the rescheduled time**」 |
| **在原生日历上删除** Task | ❌ **不锁定** ——「Reclaim will find the next available time for you, and **not lock the Task at the rescheduled time**」 |

[来源: https://help.reclaim.ai/en/articles/12304458-carve-out-time-for-work-with-tasks]

**这是一组非常细致、可直接借鉴的语义设计**：同样是「我不想现在做」，用户有三种不同意图的操作，系统给出三种不同的持久化语义。

#### (d) 手动改动的存活期

官方 2.0 的 Preview Mode 是对这个问题的正面回应：「Preview Mode is a new experience, offering a calendar sandbox that lets you **safely test changes, understand what will move, and apply updates only when you're ready.** You can reorganize your day, resolve conflicts, or create space for focus time **without immediately impacting others**.」[来源: https://help.reclaim.ai/en/articles/14846468-reclaim-ai-2-0-overview]

即：1.0 的模型是「改了就被系统吸收」，2.0 引入「先预览、确认后再落地」。

#### (e) 没有找到的机制

- **「do not reschedule」开关 / 全局不重排**：官方帮助文档中**未找到**名为 "do not reschedule" 或等价全局开关的机制 → **未找到公开信息**。
- **忽略提案（ignore proposals）**：2.0 的 Preview Mode 允许不应用，但没有独立的 "ignore / dismiss proposal" 语义 → **未找到公开信息**。

### 2.5.5 漏做 / 未完成任务的处理（官方有两种模式）

**默认模式：Start Habits & Tasks when scheduled**
> 「Reclaim will **automatically start burning down time** on a Habit or Task event when it's scheduled and **mark it complete once the event is over**. You can still reschedule it by deleting the event from the calendar or using the **Reschedule** action, but you will have to do so manually.」

**替代模式：Start Habits & Tasks manually**
> 「Reclaim will consider a Task or Habit event as **not started** throughout its duration until you manually hit **Start**. So for example, if an event is scheduled for a Habit from 1pm to 2pm, and at 1:30pm you hit Start, it will move the start time for the event to 1:30pm. **If you do not hit Start, then once the event ends it will reschedule automatically to the next best time later in the day.**」

[来源: https://help.reclaim.ai/en/articles/6937489-auto-rescheduling-settings-for-tasks-and-habits]

**「done scheduling」状态的处理（三选一）**：
> 「By default, Tasks that are done scheduling are considered 'open' until you either manually add more time to the Task, or mark it as done. In other words — Reclaim has finished scheduling the time you said you needed to complete it, but is waiting for you to confirm if it got done or not.」

用户可在 Settings 选择：
1. **Nothing** — 保持 `Done scheduling` 状态
2. **Add it back to my calendar for me until I mark it done** — 「Reclaim reopens Task after set amount of days... and automatically reschedules **the entire original Task time** back onto your calendar.」例：3 小时任务未标记完成 → 重新占 3 小时
3. **Mark it done for me** — 等待期后自动标记完成

并需设置 **wait duration（等待天数）**；该自动化设置「will apply to **both existing and future** Tasks」。[来源: https://help.reclaim.ai/en/articles/6937489-auto-rescheduling-settings-for-tasks-and-habits]

**注意**：选择「Start Habits & Tasks manually」后，上述 done-scheduling 设置**不可见/不适用**。[来源: https://help.reclaim.ai/en/articles/6937489-auto-rescheduling-settings-for-tasks-and-habits]

### 2.5.6 「Free / Busy」与同事可见性

> 「Some users want to maximize their open times for meetings and don't want Tasks to block their availability when they get defended as 'busy.' This can be accomplished by **scheduling Reclaim Tasks onto a sub-calendar** in your Google calendar. By doing this Reclaim will still schedule Tasks around your meetings, but **your colleagues won't see the task or any blocked times.**」

[来源: https://help.reclaim.ai/en/articles/12304458-carve-out-time-for-work-with-tasks]

Focus Time 的同类语义：「The feature shows as **'free'** on your calendar when space exists, but **converts to 'busy' as meetings encroach**, so colleagues still see availability until you genuinely can't accommodate more.」[来源: https://www.saner.ai/blogs/reclaim-ai-reviews]

### 2.5.7 排程范围限制（Scheduling Range）

| 档位 | Scheduling Range（不含 Scheduling Links） |
|---|---|
| Lite | **1 week** |
| Starter | **8 weeks** |
| Business | **12 weeks** |
| Enterprise | **12 weeks** |

官方对该字段的解释：「**Future time range for automated scheduling optimizations.**」[来源: https://reclaim.ai/pricing]

Calendar Syncs 有独立的 12 个月排程范围说明：「Calendar Syncs (**12 month scheduling range**)」[来源: https://reclaim.ai/pricing]

### 2.5.8 技术自述

官方称其自动排程使用「**patent-pending intelligence**」：「Learn how Reclaim uses **patent-pending intelligence** to automatically schedule and reschedule events based on your priorities.」[来源: https://help.reclaim.ai/en/articles/6207587-how-reclaim-manages-your-schedule-automatically]

### 2.5.9 已知的排程缺陷（官方/评测共同承认）

- **错过截止不会升级告警**：「**Missed tasks or deadlines don't always surface with strong alerts.** It's possible to overlook a task without it creating enough friction or escalation.」（G2 评论，经第三方转引）[来源: https://www.saner.ai/blogs/reclaim-ai-reviews]
- **无法感知精力状态**：「the AI Agent rescheduling is genuinely good... Reclaim schedules your focus time in available calendar slots, but **it has no signal about whether that 3pm slot is actually a peak cognitive hour or your biological low point.**」[来源: https://lifestack.ai/blog/reclaim-ai-review]
- **日历同步有延迟**：「It works okay, but the **syncing with calendars can lag**. The idea is great, but it still needs refinement to fully deliver.」（Product Hunt 评论，经第三方转引）[来源: https://www.saner.ai/blogs/reclaim-ai-reviews]

---

## 2.6 问题 4：定价（含精确数字与观察日期）

### 2.6.1 当前定价（**观察日 2026-09-25**）

官方定价页顶部有两个 tab：**「Yearly - SAVE 20%」**（默认）与 **「Monthly」**。

#### 年付（默认 tab）

| 档位 | 价格 | AI Agents/seat | 席位上限 | Scheduling Range | Calendar Syncs | Scheduling Links |
|---|---|---|---|---|---|---|
| **Lite** | **Free / Free forever** | **5** | **1 user team** | **1 week** | **1** | **1** |
| **Starter** | **$10 / seat / month** | **10** | **Up to 10 seats** | **8 weeks** | **3** | **3** |
| **Business**（Most Popular） | **$15 / seat / month** | **100** | **Up to 100 seats** | **12 weeks** | **Unlimited** | **Unlimited** |
| **Enterprise** | **$22 / seat / month** | **Unlimited** | **Over 100 seats** | **12 weeks** | **Unlimited** | **Unlimited** |

[来源: https://reclaim.ai/pricing]

#### 月付 tab

| 档位 | 价格 |
|---|---|
| Lite | Free forever |
| **Starter** | **$12 / seat / month** |
| **Business** | **$18 / seat / month** |
| **Enterprise** | **「Unavailable on monthly plans」** |

[来源: https://reclaim.ai/pricing]

#### 各档独有功能

- **Lite（免费）**：Focus Time、Habits、Buffer Time、Smart Meetings、Meeting Quality；**Limited integrations**；**Task recommendations**；**Auto-Rescheduling: Limited**；Time Blocking Customization: **Default settings only**
- **Starter**：`Unlimited integrations`、`3 Calendar Syncs`、`3 Scheduling Links`、`No-Meeting Days`、`Daily digests`、`Full customization` of time blocking
- **Business**：`Unlimited Calendar Syncs`、`Unlimited Scheduling Links`、**Team OOO Calendar**、**Delegated Access (for EAs/admins)**、`Unlimited integrations + webhooks support`、`Team analytics stats`
- **Enterprise**：**SSO & SCIM user provisioning**、**Org-chart aware scheduling intelligence**、`Unlimited AI Agents/seat`、`Over 100 seats`、`Dedicated support`、`Security reviews`、`Company onboarding`、`Domain capture`、`Workforce Analytics (org-mapping) exports`、`Benchmarks`

[来源: https://reclaim.ai/pricing]

#### Free Lite 层的完整边界（官方原文）

> 「**Free features**: 5 AI Agents、Focus Time、Habits、Buffer Time、Smart Meetings、Meeting Quality
> Plus: **1 user team**、**1 week scheduling range (exc. Scheduling Links)**、**1 Calendar Sync**、**1 Scheduling Link**、**Limited integrations**、**Task recommendations**」

[来源: https://reclaim.ai/pricing]

**注意**：Reclaim 的 Lite 层在功能名上**包含了 Habits 和 Smart Meetings**（不像某些第三方评测称"仅 1 个 habit / 1 个 smart meeting"）。第三方（morgen.so, 2026-05-07）写「caps you at **1 habit, 1 scheduling link, and a 1-week scheduling range**」[来源: https://www.morgen.so/blog-posts/reclaim-pricing]，与官方「5 AI Agents」口径不同 —— 这可能是 **1.0 与 2.0 的计数口径差异**（1.0 按 habit 个数计，2.0 按 AI Agents 计）。**以官方 2026-09-25 页面的「5 AI Agents」为准。**

### 2.6.2 免费层与试用

- **免费层存在且永久免费**：「Lite — For calendar basics. **Free. Free forever.**」[来源: https://reclaim.ai/pricing]
- 官方 homepage FAQ：「**100% free forever plan**」[来源: https://reclaim.ai/]
- **不需要信用卡**：「Individuals can enjoy our amazing free Lite plan forever - **no credit card required.**」[来源: https://reclaim.ai/ （FAQ 检索结果）]
- **试用 = 14 天 Business 计划**：「All users get a **free 14-day trial of our Business plan** to explore unlimited ...」[来源: https://reclaim.ai/]
- 导航条与资源区也反复出现「**Explore a free 14-day trial**」[来源: https://reclaim.ai/pricing]

### 2.6.3 附加项（Attendee Users，AU）定价

官方定价页有专门的 AU 说明：

> 「**LAUNCH PROMO: Attendee Users (AUs) are 100% free through July 31st.**
> AUs are attendees **without a paid Reclaim seat for Smart Meetings with 3+ people** (2-person meetings do not require AUs), and are **cumulative for a team account**.」

年付 tab 的加购价：
- Additional 3 AUs in Starter: **$8/month**（各 +3 档：$8 / $16 / $24 / $32）
- Additional 6 AUs in Business: **$12/month**（$12 / $24 / $36 / $48）
- Additional 10 AUs in Enterprise: **$18/month**（$18 / $36 / $54 / $72）

月付 tab 的加购价更高（Starter +3: $10 / $20 / $30 / $40；Business +6: $15 / $30 / $45 / $60）。

> 「Each additional 3-pack of AUs you purchase includes a **free Starter seat** you can assign to a member of your team.」（Business 对应 6-pack → free Business seat；Enterprise 10-pack → free Enterprise seat）

[来源: https://reclaim.ai/pricing]

### 2.6.4 折扣

| 折扣 | 幅度 | 期限 |
|---|---|---|
| **Student** | **50% Off** | 12 months（students, educators, faculty） |
| **Nonprofit** | **20% Off** | 3 years |
| **Startup** | **20% Off** | 3 years |
| **Switching Providers**（从 Clockwise、**Motion**、Calendly 迁入） | **20% Off** | 6 months |

[来源: https://reclaim.ai/pricing]

**注意**：Reclaim 有**专门针对 Motion 用户的迁移折扣**（20% off 6 months）。[来源: https://reclaim.ai/pricing]

### 2.6.5 官方定价页内部的口径不一致（值得记录的信号）

- Tab 标签写 **「Yearly - SAVE 20%」**，但年付 vs 月付的实际差额是 Starter $10 vs $12（**省 16.7%**）、Business $15 vs $18（**省 16.7%**）。[来源: https://reclaim.ai/pricing]
- 同页 FAQ 却写：「We offer a **29% discount for annual billing vs. monthly.**」[来源: https://reclaim.ai/pricing]

**三个数字（20% / 16.7% / 29%）互相矛盾。** 这是一个可复用的教训：**定价页上的折扣文案与表格数字很容易漂移**。

### 2.6.6 其他定价机制

- **按月计费不含 Enterprise**：「Enterprise ... **Unavailable on monthly plans**」[来源: https://reclaim.ai/pricing]
- **官方提供机器可读定价**：定价页明确有一行「**Are you an AI agent? View our machine-readable pricing.**」并链接到 `cdn.prod.website-files.com/.../pricing.md`。[来源: https://reclaim.ai/pricing] —— 这是本次调研中发现的**对 AI 友好的定价分发实践**，对 heyta 有直接参考价值。
- **Analytics-only seats** 与 **Enterprise pilot** 作为 add-on：「Analytics-only seats — Unblock barriers to work across the org with powerful, employee-friendly analytics.」[来源: https://reclaim.ai/pricing]
- 付费方式：接受主要信用卡；其他方式需联系 hello@reclaim.ai，「Some payment methods may require a minimum purchase.」[来源: https://reclaim.ai/pricing]
- Max users across domain：Lite/Starter/Business = **100**；Enterprise = **Unlimited**。[来源: https://reclaim.ai/pricing]

### 2.6.7 定价页上的 ROI 计算器（官方宣称数字）

官方定价页内嵌的 ROI calculator 展示样例数字（默认 5 人？）：Hours saved **45,900**、Time cost reclaimed **$1,987,519**、Reclaim cost **$22,500**、Annual time cost savings **$1,965,019**；并标注「**5.7 more productive hours/week**」「**2.3 fewer unnecessary meetings**」「**49% less time waste**」「**12.1% better capacity planning**」「**41.1% better prioritization**」「**4.1 hours/week saved managing time**」。[来源: https://reclaim.ai/pricing]

（这些是交互式计算器的默认输出，**无方法论披露**，不可作为事实。）

---

## 2.7 问题 5：模型供应商与云/端侧

### 2.7.1 官方 AI Disclosure（第一方，2026-05-29 更新）

这是 Reclaim 最重要的第一方披露，原文：

> 「Reclaim.ai uses a combination of technologies to help manage calendars, optimize time, and enhance productivity. Today, these capabilities rely on **both classic machine-learning models and privately hosted large language models (LLMs) operated entirely within Dropbox's secure environment.** Generative AI models will not be built using customer content without consent.」
>
> 「Reclaim.ai includes additional features that leverage LLMs provided and hosted by **contracted third-party AI service providers**. Any such features will run on the external provider's infrastructure **only if explicitly enabled with end-user opt-in consent** and will be governed by contractual terms. AI subprocessor services are subject to **Zero Data Retention** contractual terms and commitments that providers will **not** use customer data to train or improve their models.」
>
> 「**Reclaim Chat and MCP integrations use third-party AI services** under agreements that enforce appropriate privacy, security, and compliance standards for customer data.」

[来源: https://help.reclaim.ai/en/articles/13178785-reclaim-ai-disclosure]

**关键结论**：
1. **双轨制**：核心排程 AI = **自有/私有托管的经典 ML + LLM，跑在 Dropbox 环境内**；聊天类（Reclaim Chat）与 MCP = **第三方 LLM**，需**用户显式 opt-in**。
2. **不是端侧**：LLM 是"privately hosted"（Dropbox 环境内私有托管），不是 on-device。

### 2.7.2 具体模型供应商（第一方间接披露）

**Slack Marketplace 的 App 安全披露页**（由 Reclaim 自己填写）明确写出：

> **App/service uses large language models (LLM)**: yes
> **LLM model(s) used**: **OpenAI chatgpt-5.5, chatgpt-5.4-mini, and other similar**
> **LLM retention settings**: 「Our use of OpenAI includes their **Zero Data Retention** policy」
> **LLM data tenancy policy**: 「**OpenAI operates a multi-tenant service**」
> **Data hosting details**: 「**Cloud - AWS us-east-2 region**」
> **Data hosting company**: 「**AWS**」
> **Data center location(s)**: 「United States」

[来源: https://slack.com/marketplace/ARSJUP4R0-reclaimai]

**结论**：Reclaim 的对话式 AI 使用 **OpenAI** 的模型（披露时列出 `chatgpt-5.5`、`chatgpt-5.4-mini`），**云端（AWS us-east-2）**，非端侧。核心排程引擎的模型供应商**未指名** → 官方仅称"privately hosted LLMs within Dropbox's secure environment"。

### 2.7.3 云 vs 端侧

**全部云端，无端侧 AI。**
- 官方披露 LLM 在 Dropbox 环境或第三方云基础设施上运行。[来源: https://help.reclaim.ai/en/articles/13178785-reclaim-ai-disclosure]
- Slack 披露数据托管在 AWS us-east-2。[来源: https://slack.com/marketplace/ARSJUP4R0-reclaimai]
- **端侧：未找到公开信息。**

### 2.7.4 子处理商

官方有独立的子处理商页面：`https://reclaim.ai/subprocessors`（在 AI Disclosure 中被引用）。[来源: https://help.reclaim.ai/en/articles/13178785-reclaim-ai-disclosure]

---

## 2.8 问题 6：用户情绪

### 2.8.1 评分（来自检索结果元数据；平台页面被反爬拦截）

| 平台 | 评分 | 评论数 | 备注 |
|---|---|---|---|
| **G2** | **4.8 / 5** | **143** | G2 需登录，评分为检索结果元数据；Reclaim 官网也自称「4.8 stars on G2」 |
| **Trustpilot** | **2.2 / 5** | **23** | 页面返回 403；评分为检索结果元数据 |

[来源: https://www.g2.com/products/reclaim-ai/reviews （评级与评论数来自检索结果元数据，2026-09-25）]
[来源: https://www.trustpilot.com/review/reclaim.ai （评级与评论数来自检索结果元数据，2026-09-25）]
[来源: https://reclaim.ai/ （「#1 AI calendar for work. 4.8 stars on G2」）]

**⚠️ 巨大落差**：**G2 4.8 vs Trustpilot 2.2**。G2 的评论者多为产品选型者/团队采购者，Trustpilot 的评论者多为自助注册的个人用户，且 Trustpilot 样本量仅 23。第三方评测给的综合分是 **3.7 / 5**。[来源: https://www.saner.ai/blogs/reclaim-ai-reviews]

### 2.8.2 最有价值的正面评价

- **自动重排确实解决了真实痛点**：「The auto-rescheduling of events. It was such a burden to start the day with a to-do list, only to have to reprioritize and reshuffle the list by 10:00 AM. I especially appreciate that **uncompleted work is auto-populated on my calendar for the following day, according to my rules.** These consistent, automated calendar appointments allow me to meet my goals and resolutions while also flexing as I need when life gives me lemons. **I can count on Reclaim to reschedule my work tasks, prioritize the meeting and still ensure I get all of my work completed by the pre-set due dates.**」— G2 评论，经第三方转引 [来源: https://www.g2.com/products/reclaim-ai/reviews]
- **优先级体系直观**：「The interface, aesthetics, and the idea of recurring tasks, habits, and focus time that are dynamically rescheduled by AI — I found **the multiple priority levels concept for automated rescheduling to be immediately intuitive.**」— G2 review 11710449，经第三方转引 [来源: https://www.saner.ai/blogs/reclaim-ai-reviews]
- **保护 focus time**：「Reclaim.ai is particularly valuable for **protecting focus time in crowded calendars**. Its ability to automatically prioritize and reschedule tasks and routines based on my real availability makes time management much more intentional and easier, **without requiring constant manual adjustments on my end.**」— G2 review 12219692，经第三方转引 [来源: https://www.saner.ai/blogs/reclaim-ai-reviews]
- **团队调度**：「The smart scheduling feature that **works among multiple team members** is great... It helps me with scheduling links and automatically handles team scheduling, allowing other team members to adjust meetings easily.」— G2，经第三方转引 [来源: https://www.g2.com/products/reclaim-ai/reviews]
- **Smart 1:1**：「Smart 1:1 meetings are awesome. I nearly cried when I saw the '**detect**' 1:1 meetings feature.」— Product Hunt，经第三方转引 [来源: https://www.saner.ai/blogs/reclaim-ai-reviews]
- **解决多重日历冲突**：「Managing multiple calendars has been a long-time issue for me. I was constantly double booking, missing key events. **Reclaim was the exact solution I needed.**」— G2，经第三方转引 [来源: https://www.saner.ai/blogs/reclaim-ai-reviews]
- **工作满意度提升**：「My day is considerably more productive now. **Reclaim really helps me focus on what needs to get done, when it needs to get done.**」— G2，经第三方转引 [来源: https://www.saner.ai/blogs/reclaim-ai-reviews]

**第三方对 1.0 重排质量的正面评价**：
> 「The AI Agent rescheduling is genuinely good. When a meeting moves, Reclaim **does not just remove the old block and leave the gap open.** It...」
[来源: https://lifestack.ai/blog/reclaim-ai-review]

### 2.8.3 最常见的抱怨

**A. AI 挪动了用户明确指定时间的会议（最核心、最常被引用的单条抱怨）**

> 「**I put the time of my meeting because I need it to happen at an exact time — and it automatically reschedules it.** So now I have to go to my Google Calendar to set it up manually or move it back. **It's just useless duplicate work.**」

— Trustpilot 评论（permalink: `/reviews/68f899090b4c7fd7d71171ab`），经第三方转引
[来源: https://www.trustpilot.com/review/reclaim.ai] [来源: https://www.saner.ai/blogs/reclaim-ai-reviews]

> 「One Trustpilot reviewer put it bluntly: they set a meeting at an exact time, **Reclaim moved it, and they ended up doing duplicate work in Google Calendar.**」
[来源: https://hackceleration.com/labs/review/reclaim]

**注意**：从官方机制看（见 2.5.4），**拖拽移动会锁定**，所以这条抱怨更可能来自 1.0 中通过其他路径（Reschedule / 删除）产生的重排，或来自 Schedule Link / Smart Meeting 被更高优先级覆盖。**机制存在，但用户的心智模型与系统语义不匹配** —— 这本身是最有价值的发现。

**B. 重排风暴与通知轰炸**

> 「**If I need to do something in the next two hours that was not on my schedule, Reclaim would spend those entire two hours reshuffling my schedule and I will keep getting notified about it from my calendar.**」

— G2 review 12345709，经第三方转引
[来源: https://www.saner.ai/blogs/reclaim-ai-reviews]

第三方总结同类问题：「**Calendar notifications can get overwhelming during reshuffling**」[来源: https://www.saner.ai/blogs/reclaim-ai-reviews]

**C. 免费层被削减**

> 「At first, the company offered a free account with **3 connected calendars and 16 habits**. Then, **mid-year of use, they trimmed it down to 1 calendar.** Reclaim uses the typical SaaS tactic of **downgrading free users to an unusable state** with a discount offer to win them back.」

— Trustpilot 评论，经第三方转引
[来源: https://www.saner.ai/blogs/reclaim-ai-reviews]

**注意**：官方当前（2026-09-25）Lite 层为 **1 Calendar Sync / 5 AI Agents / 1 week range**。[来源: https://reclaim.ai/pricing]

**D. 手动改动难以保持**

> 「**Rigid once set up:** As Yori I. noted, **tasks do not always follow manual changes easily, especially when trying to enforce specific times**」— G2 review 12274328，经第三方转引
[来源: https://www.morgen.so/blog-posts/reclaim-pricing]

**E. 无原生移动 App（跨平台最一致的抱怨）**

> 「**No native mobile app is the single most-complained-about limitation across review platforms**」
>
> 「As of early 2026, there is **no native iOS or Android app**. You can view Reclaim-scheduled events on your phone through your calendar app, but you **can't add tasks, adjust priorities, or change settings** without opening a browser on desktop.」

[来源: https://www.saner.ai/blogs/reclaim-ai-reviews]

- 「The **complete lack of a native mobile app** is a major failing in 2025. This is the single biggest complaint I found in user reviews, and my own testing confirmed this frustration.」[来源: https://bestaiprojecthub.com/planning-scheduling/reclaim-ai-review-ai-calendar （经第三方转引）]
- 「Being able to select colors for certain tasks, and **having a phone app would be useful.**」— Trustpilot，经第三方转引 [来源: https://www.saner.ai/blogs/reclaim-ai-reviews]

**F. 其他高频抱怨**

| 抱怨 | 依据 |
|---|---|
| **错过截止不升级告警** | 「Missed tasks or deadlines don't always surface with strong alerts. It's possible to overlook a task without it creating enough friction or escalation.」[来源: https://www.saner.ai/blogs/reclaim-ai-reviews] |
| **重排会让人无所适从（尤其 ADHD 用户）** | 「**Autopilot can feel overwhelming:** The lack of hands-on planning may not suit users (especially those with ADHD) who prefer to actively structure their day」[来源: https://www.morgen.so/blog-posts/reclaim-pricing] |
| **无法感知精力状态** | 「it has **no signal about whether that 3pm slot is actually a peak cognitive hour or your biological low point**」[来源: https://lifestack.ai/blog/reclaim-ai-review] |
| **日历同步有延迟** | 「the **syncing with calendars can lag**」[来源: https://www.saner.ai/blogs/reclaim-ai-reviews] |
| **不支持 iCloud Calendar** | 「iCloud Calendar **not supported natively**」[来源: https://www.saner.ai/blogs/reclaim-ai-reviews] |
| **非 HIPAA 合规** | 「**Not HIPAA compliant** — unsuitable for healthcare organizations」[来源: https://www.saner.ai/blogs/reclaim-ai-reviews] |
| **未通过 ISO 27001** | 「**Not ISO 27001 certified**」（有 SOC 2 Type II）[来源: https://www.saner.ai/blogs/reclaim-ai-reviews] |
| **功能范围窄** | 「Narrow scope — no email management, note-taking, or knowledge features」[来源: https://www.saner.ai/blogs/reclaim-ai-reviews] |
| **G2 上「无法在创建页直接指定任务时间」** | 「I dislike that I **cannot set a 'task' to a certain time from the 'create' page.**」— G2 评论，经转引 [来源: https://www.g2.com/products/reclaim-ai/reviews] |

### 2.8.4 评测分类评分（第三方，2026-04）

| 维度 | 分数 |
|---|---|
| Ease of use | **4.2 / 5** |
| Features | **3.8 / 5** |
| **Mobile experience** | **2.5 / 5** |
| Integrations | **4.0 / 5** |
| Value for money | **3.7 / 5** |
| Customer support | **4.0 / 5** |
| **Overall** | **3.7 / 5** |

[来源: https://www.saner.ai/blogs/reclaim-ai-reviews]

---

# 第三部分：横向对比

| 维度 | **Motion** | **Reclaim.ai** |
|---|---|---|
| **自动排程核心输入** | duration、start date、deadline、priority（含 ASAP）、effort、chunking、用户自定义 schedule、Busy 日历事件 | priority（P1–P4）、duration、frequency、Scheduling Hours、Starting、Due date、可用性 |
| **优先级模型** | ASAP > Hard deadline > 软截止日 > High/Medium/Low | Critical P1 > High P2 > Medium P3 > Low P4；同优先级时 Smart Meetings > Habits > Tasks，同优先级 Task 按最早 due date |
| **硬截止会突破工作时段？** | ✅ 会。官方举例：9–5 全满 → 排到 18:00（🔒 标记） | 未找到等价明文 → **未找到公开信息** |
| **用户锁定机制** | 拖到日历 = fixed；但 **未在 60 分钟内动作则可能被重排**；显示 🔒 | 拖拽 = **锁定，不再自动重排**；Reschedule(Snooze) / 删除 = **不锁定** |
| **逐任务关闭自动化** | ✅ **Pause auto-scheduling** | ❌ 未找到逐任务关闭开关 → **未找到公开信息** |
| **"先预览后应用"** | ❌ 无（AI Chat 有"需确认"，但排程本身是直接执行） | ✅ **Preview Mode**（2.0）— 日历沙盒，确认后才落地 |
| **漏做任务** | Past Due 状态 + 通知；重排到下一个可用时段；重复任务可能干脆不排 | 默认自动"烧完"并标记完成；可切手动模式 → 事件结束后自动重排到当天更晚的最佳时段；done-scheduling 可设 auto-reopen / auto-close |
| **排不下的处理** | **Can't Fit** 状态，窗口 **31 天（团队 92 天）** | 未找到等价状态 → **未找到公开信息** |
| **无 duration / 无 deadline 的任务** | **不会被排程**（明文） | 未找到明文 → **未找到公开信息** |
| **免费层** | ❌ **无**，仅 7 天试用 | ✅ **Lite 永久免费**（1 Calendar Sync / 1 week range / 1 Scheduling Link） |
| **最低付费（年付）** | **$19/seat/mo**（Teams Pro AI） | **$10/seat/mo**（Starter） |
| **最高公开档（年付）** | **$29/seat/mo**（Teams Business AI）；个人轨道 $39/mo | **$22/seat/mo**（Enterprise） |
| **月付 vs 年付** | Save 33%；月付约高 50% | Tab 写 Save 20%，实际约 16.7%，FAQ 却写 29%（**三处矛盾**） |
| **配额/用量层** | ✅ **AI credits**（7,500 / 15,000，超额 19¢–65¢/100） | ❌ 无用量计费；用 **AI Agents 数量** 分档（5 / 10 / 100 / 无限） |
| **席位上限** | 未在定价页声明 → **未找到公开信息** | Lite 1 / Starter 10 / Business 100 / Enterprise 100+ |
| **模型供应商** | **OpenAI**（Subprocessors 唯一 AI 平台）；具体版本未披露 | 核心排程：自有私有托管 LLM（Dropbox 环境）+ 经典 ML；Chat/MCP：**OpenAI**（Slack 披露为 `chatgpt-5.5` / `chatgpt-5.4-mini`） |
| **云 / 端侧** | 全部云端（US） | 全部云端（Dropbox 环境 / AWS us-east-2） |
| **移动端** | ✅ 有 iOS / Android / Desktop（但被大量吐槽） | ❌ **无原生移动 App**（最大抱怨） |
| **用户评分** | Trustpilot **3.7**（~578）；第三方综合 **6/10** | G2 **4.8**（143）vs Trustpilot **2.2**（23）；第三方综合 **3.7/5** |
| **公司状态** | 独立；2025-09 $60M / $550M 估值；累计 $75M（官方口径） | 2024-08-20 被 **Dropbox** 收购（金额未披露）；品牌为 "Reclaim.ai from Dropbox"，仍独立运营 |

---

# 第四部分：对 heyta 的产品启示

> 以下为基于上述**已检索事实**的推论，非事实陈述。

1. **「锁定」需要一个明确的持久化契约，而不是一个布尔值。** Reclaim 用三种操作映射三种语义（拖拽=永久锁 / Snooze=不锁 / 删除=不锁），Motion 用「fixed + 60 分钟超时自动解锁」。heyta 的 op-log 模型天然适合把这个表达成一个显式字段（例如 `schedulingLock: 'none' | 'untilStart' | 'permanent'`），而不是散落在 UI 行为里 —— 否则回放/同步时会漂移。

2. **两家最一致的抱怨不是「AI 不准」，而是「AI 动了我不想动的东西」。** Motion 的官方文档直接承认「tasks shift multiple times」并让用户自己 lock；Reclaim 的 Trustpilot 首要差评是「我指定了确切时间，它却挪走了」。**这指向一个产品机会：把「重排理由」和「重排范围」显式暴露给用户**（而不是让用户在日历变化的噪音里自己反推）。Reclaim 2.0 的 Preview Mode 是对此的正面回应，值得作为 heyta 的参照。

3. **拒排的边界条件应该写死并公开。** Motion 明文规定：无 duration 不排、无 deadline 且无 priority 不排、start date 在未来不提前排、31/92 天窗口内塞不下就标记 Can't Fit。这些是**可测试的产品契约**，不是实现细节。heyta 若做排程，应先把这套边界固化成测试用例。

4. **定价页的折扣文案会漂移。** Reclaim 同一页面上同时写着「SAVE 20%」「实际约 16.7%」「FAQ: 29%」。heyta 的定价数字若有多个消费点（定价页、FAQ、结账页、营销页），必须来自**单一事实源** —— 这与仓库里 design token 的「唯一事实源」原则是同一种病。

5. **`llms.txt` / `.md` 后缀 / 机器可读定价是 2026 年的竞品基础设施。** Motion 的帮助中心提供 `llms.txt` 全套索引 + `.md` 后缀 + GitBook `?ask=` 动态问答；Reclaim 在定价页明确给出「Are you an AI agent? View our machine-readable pricing」。**两者都把"被 AI 读取"当成一等产品面**。heyta 的 `docs/` 与 OpenAPI 契约可以考虑同样的暴露方式。

6. **「AI 命名通胀」不等于产品价值。** Motion 把甘特图叫 "AI Gantt Chart"、把计费单位叫 "AI credits"、把套餐叫 "Pro AI"；但用户称赞的仍是 2021 年的排程引擎，而 2025 年的 AI Employees 被用户批评为"chase trends 导致 bloat"。heyta 的差异化应落在**可验证的机制**（本地优先、E2EE、op-log 可回放）而不是命名。

---

## 附录 A：本次调研未能验证的条目（诚实清单）

| 条目 | 状态 |
|---|---|
| Motion Individuals 轨道的官方第一方网页数字 | **未找到公开信息**（页面 JS 渲染，抓取时停留在 Teams 态；采信两个一致的第三方来源） |
| Motion 7 天试用是否强制绑卡 | **来源冲突**（morgen 称需绑卡；ellieplanner 称无需绑卡）→ 无法裁决 |
| Motion 具体 LLM 版本 | **未找到公开信息**（仅披露 OpenAI 为 AI Platform subprocessor） |
| Motion 席位上限 / 最低席位数 | **未找到公开信息**（定价页未声明） |
| Motion 累计融资额 | **口径冲突**：官方 2025-09 称 $75M；Tracxn 2026-08 称 $102M / 5 轮 |
| Reclaim 被 Dropbox 收购的价格 | **未找到公开信息**（Dropbox 未披露交易条款） |
| Dropbox 官方 newsroom 的收购公告页面 | **未找到公开信息** |
| Reclaim 收购前（2024-08 之前）的第一方价格快照 | **未找到公开信息**（Wayback Machine 返回 HTTP 429；2024-07 无快照） |
| Reclaim 是否有全局「do not reschedule」开关 | **未找到公开信息** |
| Reclaim 是否有「忽略提案」的显式语义 | **未找到公开信息** |
| Reclaim 硬截止是否会突破用户指定的 Scheduling Hours | **未找到公开信息** |
| Reclaim 排不下的等价状态（对应 Motion 的 Can't Fit） | **未找到公开信息** |
| Reclaim 核心排程引擎的具体 LLM 供应商/版本 | **未找到公开信息**（仅称"privately hosted LLMs within Dropbox's secure environment"） |
| Reclaim 免费 Lite 层是「3 habits」还是「5 AI Agents」 | **口径冲突**（1.0 文档按 habit 数，2.0 定价页按 AI Agents 数） |
| 两家产品的端侧（on-device）AI | **未找到公开信息**（两家均为纯云端） |
| Reddit / Trustpilot / G2 页面原文 | **被反爬拦截**；引用均来自检索结果元数据或第三方署名转引 |

---

## 附录 B：本次调研实际检索到的关键 URL 清单

**Motion（第一方）**
- https://www.usemotion.com/pricing
- https://www.usemotion.com/
- https://www.usemotion.com/llms.txt
- https://www.usemotion.com/legal/subprocessors
- https://www.usemotion.com/help/llms.txt
- https://www.usemotion.com/help/time-management/auto-scheduling
- https://www.usemotion.com/help/time-management/auto-scheduling/auto-scheduling-how-to-guide
- https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling/what-auto-scheduling-considers.md
- https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling/how-auto-scheduling-works-behind-the-scenes.md
- https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling/manual-vs-auto-scheduling.md
- https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling/status-indicators.md
- https://www.usemotion.com/help/project-management/task/reference-tasks/task-states-and-task-types
- https://www.usemotion.com/help/project-management/task/task-scheduling-faq.md
- https://www.usemotion.com/help/project-management/workspaces/reference-workspaces/billing-and-plans.md
- https://www.usemotion.com/help/knowledge-management/ai-chat/reference-ai-chat.md
- https://www.usemotion.com/help/getting-started/navigation-basics/navigating-motion-features/navigating-ai-features.md
- https://www.usemotion.com/blog/motion-raises-60m-to-build-the-agentic-work-suite-for-businesses.html
- https://www.usemotion.com/blog/understanding-auto-scheduled-updates.html

**Reclaim（第一方）**
- https://reclaim.ai/pricing
- https://reclaim.ai/
- https://reclaim.ai/blog/dropbox-acquires-reclaim
- https://help.reclaim.ai/en/articles/6207587-how-reclaim-manages-your-schedule-automatically
- https://help.reclaim.ai/en/articles/14846468-reclaim-ai-2-0-overview
- https://help.reclaim.ai/en/articles/12304458-carve-out-time-for-work-with-tasks
- https://help.reclaim.ai/en/articles/6937489-auto-rescheduling-settings-for-tasks-and-habits
- https://help.reclaim.ai/en/articles/13178785-reclaim-ai-disclosure
- https://updates.reclaim.ai/announcements/reclaim-is-now-a-part-of-dropbox

**第三方 / 社区**
- https://techcrunch.com/2024/08/22/dropbox-acquires-index-ventures-backed-ai-scheduling-tool-reclaim-ai/
- https://siliconangle.com/2024/08/22/dropbox-acquires-ai-powered-calendar-app-reclaim-ai/
- https://www.geekwire.com/2024/dropbox-acquires-reclaim-a-calendar-app-that-uses-ai-scheduling-to-boost-productivity/
- https://www.bizjournals.com/portland/inno/stories/news/2025/05/16/reclaim-ai-dropbox-outlook-calendar-tool.html
- https://news.ycombinator.com/item?id=41302030
- https://slack.com/marketplace/ARSJUP4R0-reclaimai
- https://www.usagepricing.com/blueprint/motion
- https://www.morgen.so/blog-posts/motion-pricing
- https://www.morgen.so/blog-posts/reclaim-pricing
- https://www.saner.ai/blogs/motion-reviews
- https://www.saner.ai/blogs/reclaim-ai-reviews
- https://lifestack.ai/blog/reclaim-ai-review
- https://hackceleration.com/labs/review/reclaim
- https://blog.archcalendar.com/6-best-reclaim-ai-alternatives-in-2026-now-that-dropbox-owns-it/
- https://www.usecarly.com/blog/is-reclaim-shutting-down/
- https://www.usecarly.com/blog/motion-pricing/
- https://leadiq.com/c/reclaimai-from-dropbox/5da89818408f0cc3d9262e10
- https://max-productive.ai/blog/motion-ai-employees-review-2025/
- https://ucals.com/articles/is-motion-app-worth-it-2026
- https://www.reddit.com/r/UseMotion/comments/1jdjrzr/lack_of_manual_scheduling_will_likely_force_me_to/
- https://www.reddit.com/r/UseMotion/comments/1iy5ux3/why_does_motion_kinda_suck/
- https://www.reddit.com/r/UseMotion/comments/1p94uxr/beware_motion_is_charging_existing_customers_3x/
- https://www.reddit.com/r/UseMotion/comments/1m4dpme/over_motion_and_the_support/
- https://www.reddit.com/r/UseMotion/comments/1cqax7u/manually_scheduling_a_task_on_the_calendar/
- https://www.trustpilot.com/review/www.usemotion.com
- https://www.trustpilot.com/review/reclaim.ai
- https://www.g2.com/products/reclaim-ai/reviews