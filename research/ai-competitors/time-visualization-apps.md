# 时间可视化（Time Visualization）竞品调研

> **范围声明（重要）**：本调研的对象是**纯时间可视化 / 倒计时 / 进度条视图**，**不是 AI**。
> 除个别条目被明确标注「含 AI」外，下面所有产品都是**确定性视图渲染**：把「剩余时间 / 已用时间」画成格子、圆环、进度条或大数字。
> 没有任何一个「Time Left」类产品是靠 AI 做核心价值的。
> 唯一被排除的是 `com.countdownlifeapp`（含 "AI analysis" 与 "AI health coach"）与 `Deadline Dash - AI ToDo, Goals`（标题即含 AI）—— 它们不属于本调研的「纯可视化」范畴。
> 同理，TickTick 现在有独立的 AI 功能模块，但**本文讨论的 countdown mode 本身不是 AI 功能**。

**调研日期**：2026-09-25
**数据来源限制（必须知悉）**：本次会话中 `web_search`（Tavily）返回 HTTP 432 不可用；anysearch CLI 在调研中途耗尽当日免费配额；`apps.apple.com` 与 `play.google.com` 对本机 IP 做地域重定向（App Store 跳转到 `/cn/`），因此**无法直接抓取 App Store 列表页原文**。
可用的权威替代是 **iTunes Lookup / Search API**（`https://itunes.apple.com/lookup?id=...&country=us`）与 **App Store 用户评论 RSS**（`https://itunes.apple.com/us/rss/customerreviews/id=.../sortBy=mostRecent/json`）—— 本文中所有评分、评分人数、价格档位（免费）、版本号、上架/更新时间、以及**逐条用户评论原文**都来自这两个接口的实测返回。Reddit 与 PubMed 在本次会话中被反爬拦截，相关条目只标注为「检索到的摘要」，并会明确标注。

---

## 1. 「Time Left」到底是哪个产品（逐个消歧）

叫 "Time Left" 的产品**至少 10 个**，且分属完全不同的品类。以下按 App Store / Google Play 实际条目逐个消歧。

### 1.1 `Time Left • Be Present`（旧名 `Time Left • Final Countdown`）— **最可能是「Time Left 作为品牌」所指的那个**

| 字段 | 值 |
|---|---|
| App Store ID | `id1534791123` |
| 开发者 | **Julien Lacroix**（个人开发者，非公司） |
| Bundle ID | `com.lacroix.dev.Life` |
| 官网 | https://gettimeleft.app/ |
| 品类 | Productivity / Lifestyle |
| 评分（美区） | **4.56 / 5，234 个评分** |
| 价格 | **免费下载**，含内购 `TIME LEFT PRO` |
| 版本 / 上架 / 最近更新 | `2026.20` / 2020-10-20 / **2026-09-16**（活跃维护） |
| 最低系统 | iOS 17.0 |

**它可视化什么**（App Store 描述原文）：

> "Time Left shows you, the days, months, and years you have left and that they are all you have got. Don't be afraid, that means the only appropriate word to describe your time left is "precious"."
> "A special thank you to Wait But Why for this amazing article (https://waitbutwhy.com/2014/05/life-weeks.html). Without their work, this app would not have seen the light of day."
> `TIME LEFT PRO` — "Unlock widgets & skins. Unlimited moments. Live Photos in Life Calendar."
> [来源: https://apps.apple.com/us/app/time-left-be-present/id1534791123]

**关键点：完全不含任务管理。** 描述里没有 task / to-do / deadline / reminder 任何一项；它自称 "No notifications. No ads. No sign-up. Just you and your time."

**注意**：`gettimeleft.app` 这个域名**就是这款 App 的官网**（页面上唯一的下载按钮指向 `https://apps.apple.com/app/id1534791123`），所以「Time Left: Life Calendar & Countdown (gettimeleft.app)」与 `Time Left • Be Present` 是**同一个产品**，不是两个竞品 [来源: https://gettimeleft.app/]。

### 1.2 `Left: Widgets for Time Left` — **功能最全、且唯一把 to-do 挂在倒计时上的那个**

| 字段 | 值 |
|---|---|
| App Store ID | `id6740155884` |
| 开发者 | **Cntxt Limited**（`com.cr.left`，官网署名 "cntxt · Coded in NZ"） |
| 官网 | https://left-time.app/ |
| 品类 | Productivity / Utilities |
| 评分（美区） | **4.56 / 5，399 个评分** |
| 价格 | **免费下载**；官网称 "one-time purchase, no subscriptions"，"pay-what-you-want"，"choose from three prices" |
| 版本 / 上架 / 最近更新 | `2026.9.5` / 2025-01-13 / **2026-09-24**（极活跃） |
| 最低系统 | iOS 26.0 |
| 规模（厂商自述） | 官网首页："**100k+ users around the world**"、"**240k+ special dates tracked**"、"3000+ different widget combinations" |

**它可视化什么**：年份/月/周/日/小时进度、life in weeks 人生周格、倒计时（Ahead dates）、days-since 计数器、习惯与连续天数（streaks）。

**关键点：它确实把 to-do 挂在倒计时上** —— 这是全清单里唯一明确的。App Store 描述原文：

> "New: **every Ahead date now has its own to-do list**, so you can plan the small tasks that make the date happen and check them off as it approaches. Share an Ahead date with a friend, follow it side by side, comment, and add to-dos together on joint dates."
> [来源: https://apps.apple.com/us/app/left-widgets-for-time-left/id6740155884]

但注意其形态：**to-do list 是「倒计时事件的附属清单」，不是「任务本身带一条会缩短的进度条」**。它是「事件 → 子任务」，不是「任务 → 倒计时条」。这一点在第 2、3 节会再展开。

### 1.3 `Time Until: Countdowns, Widget`（Android）

| 字段 | 值 |
|---|---|
| Google Play ID | `com.brunoschalch.timeuntil` |
| 开发者 | **Handcrafted Apps and Games**（商店署名；搜索结果显示开发者个人名为 Bruno Schalch） |
| 价格 | 免费 + 广告 + 内购（含 Google Play Pass） |
| 评分 | **4.6 / 5，50K 条评论** |
| 下载量 | **5M+ Downloads** |
| 品类 | 生活方式（事件倒计时） |

**它可视化什么**（Play 描述原文）：

> "Live countdown to the second: Watch the time tick down in real time, from years and months all the way to seconds."
> "Days since counter: Switch modes to track days since a sobriety date, quitting a habit, starting a relationship, or celebrating a major life achievement."
> [来源: https://play.google.com/store/apps/details?id=com.brunoschalch.timeuntil]

**关键点：纯事件倒计时，无任务管理。** 描述里没有 task / to-do / deadline 概念；「repeating events」是重复提醒，不是任务完成状态。

### 1.4 `Pretty Progress`（iOS/Android/macOS/Watch）

| 字段 | 值 |
|---|---|
| App Store ID | `id1597616326`（`Countdown - Pretty Progress`） |
| Google Play ID | `com.keinois.prettyprogress` |
| 开发者 | **keinois OÜ**（爱沙尼亚公司） |
| 官网 | https://prettyprogress.app/ |
| 评分 | iOS 美区 **4.71 / 5，3,035 个评分**；Play **4.4 / 5，2,286 个评分** |
| 价格 | 免费下载 + `Pretty Progress PRO` 内购（年订阅 / 终身两档） |
| 上架 / 最近更新 | 2021-12-07 / 2026-09-21 |
| 规模（厂商自述） | 官网："**Loved by 2M+ users with 4.8 rating**"、"App of the Day +160 countries" |

**它可视化什么**：倒计时/正计时、"Show the percentage of completion, how much time is left or how much time has past"、年度/月/周百分比、习惯 streak。

**关键点：仍无任务管理。** 它做的是 "Synchronize and import Apple Calendar events and **Reminders**" —— **导入**系统提醒事项，但描述里明确把它当作"事件"处理（"turn them into countdown widgets"），**没有完成状态、没有任务勾选**。
[来源: https://apps.apple.com/us/app/countdown-pretty-progress/id1597616326] [来源: https://prettyprogress.app/]

**价格说明**：检索到的 App Store 列表页文本显示内购档位为 `(Weekly) $4.99`、`Pretty Progress Pro (Annual) $14.99`、`Pretty Progress PRO (Lifetime) $…` [来源: https://apps.apple.com/us/app/countdown-pretty-progress/id1597616326]。**该行来自搜索引擎抓取的列表页文本，本次未能逐项复核**；用户评论侧的独立佐证是终身价约 **$60**（见 5.3）。

### 1.5 其余同名/近名产品（消歧表）

| 名称 | 开发者 | 可视化内容 | 评分 / 评分人数 | 状态 |
|---|---|---|---|---|
| `Time Left - A daily reminder to live well` (`id878704370`) | **Apptly LLC** | 输入年龄/性别/国籍算预期寿命，倒计时或精确日期 + Apple Watch 表盘 | **2.96 / 5，91 人** | **已废弃**：v0.94，2020-04-25 后从未更新（最后更新即 2015-04-25 上架日） |
| `Time Left - LIFE LEFT` (`id6444656317`) | DAIKI YUASA | 人生按月格子、人生 24 小时时钟、倒计时、今年剩余、清醒小时数 | 4.63 / 5，38 人 | 活跃（2026-09-11 更新） |
| `Time Left - Countdown` (`id6752404019`) | George Stupakov | FlipClock 翻转钟倒计时 + 桌面小组件 | 4.0 / 5，**1 人** | 2025-09 上架 |
| `Time left: #1 Counter Widget` (`id6755923528`) | PRABAKARAN RAVICHANDRAN | 倒计时 + 正计时 + 习惯 streak + 假期规划 | **0 人评分** | 2025-12 上架 |
| `RemainingWeeks: Time Left` (`id6785275888`) | Alan Gloria | 4000 周人生格子 + 每周反思笔记 + 倒计时 | **0 人评分** | 2026-07 上架 |
| `Time Left Today: Time Balance` (`id1669854131`) | ZIJIAN CHEN | 日/周/月/年剩余时间（"像看电量百分比一样看时间"） | 5 / 5，**1 人** | 活跃 |
| `Time Left - Quickly create one-time reminders…` (`id885754544`) | Evgeny EGOROV | **钟面式任务管理**：一天做成钟盘，任务是盘上的图标 | 4.5 / 5，**2 人** | **已废弃**：2014-06-09 后从未更新 |
| `TimeLeft: Visualize Your Life`（Play `com.timeleft.life`） | The Tech Basket | 人生周格、年度进度、日进度、自定义目标倒计时、**FIRE 财务独立进度** | 无评分显示 | **仅 1K+ 下载** |
| `Time Left - Life Countdown`（Play `com.countdownlifeapp`） | formerry | 健康问卷估寿命 + 实时倒计时 + 因素拆解 | 无评分显示 | **仅 10+ 下载**；⚠️ **含 AI**（"AI analysis"、"AI health coach"），不属于纯可视化范畴 |
| `Timeleft: Make New Friends IRL` (`id6466442949`) | Timeleft SAS | **完全无关**：线下陌生人聚餐社交 App | 4.63 / 5，8,532 人 | — |

[来源（逐条）: https://itunes.apple.com/lookup?id=878704370&country=us / https://itunes.apple.com/lookup?id=6444656317&country=us / https://itunes.apple.com/lookup?id=6752404019&country=us / https://itunes.apple.com/lookup?id=6755923528&country=us / https://itunes.apple.com/lookup?id=6785275888&country=us / https://itunes.apple.com/lookup?id=1669854131&country=us / https://itunes.apple.com/lookup?id=885754544&country=us / https://play.google.com/store/apps/details?id=com.timeleft.life / https://play.google.com/store/apps/details?id=com.countdownlifeapp / https://itunes.apple.com/lookup?id=6466442949&country=us]

> **消歧结论**：如果上下文是「**to-do app 里的 Time Left**」，那么唯一可能被指的是 **`Left: Widgets for Time Left`**（因为它有 habits + Ahead dates + **每个 Ahead date 自带 to-do list**）。
> 如果上下文是「**Time Left 这个品牌名**」，指的是 **Julien Lacroix 的 `Time Left • Be Present`**（`gettimeleft.app`），它是**纯人生倒计时，零任务管理**。
> 两者是**不同开发者、不同产品**，不能混为一谈。

---

## 2. 产品形态：有没有人把倒计时「挂到任务上」？

**结论：在主流产品里，几乎没有。** 绝大多数是「事件 / 人生 / 年度」倒计时，**任务管理是缺位的**。

| 产品 | 倒计时对象 | 是否含任务管理 | 任务是否带倒计时/进度条 |
|---|---|---|---|
| Time Left • Be Present | 人生剩余天数/月/年 | ❌ 无 | — |
| Left: Widgets for Time Left | 事件、习惯、人生、年/月/周/日 | ✅ 有（习惯 + 事件附属 to-do） | ⚠️ **半是**：to-do 挂在事件下，任务本身无倒计时条 |
| Time Until (Android) | 事件（生日/假期/节日） | ❌ 无 | — |
| Pretty Progress | 事件、习惯、年/月/周百分比 | ❌ 无（只导入系统 Reminders 作为事件） | — |
| Time Left - LIFE LEFT | 人生月格 / 人生时钟 | ❌ 无 | — |
| TimeLeft: Visualize Your Life | 人生周格 + 自定义目标倒计时 + FIRE 进度 | ❌ 无（"Custom Goals: Set a deadline and watch the days count down" 是目标倒计时，非任务） | — |
| Deadline Bar: Time Progress | 任意起止区间（今日/今年/项目/考试） | ❌ 无 | — |
| Countdown (Find Appiness) | 事件 | ❌ 无（只有 notes 和 tags） | — |

**关于「任务带一条会缩短的进度条」—— 真正做到的只有三类产品，且都小众：**

1. **`Deadliner – Time Management`**（`id1539999660`，Zetegy LLC）—— 描述原文：
   > "Deadliner is a visual task tracker designed to increase your productivity and eliminate procrastination. … **Set goals and visualize your progress by instantly seeing the remaining time compared to when you started a given task.** … Key features include: **Visual Countdown**: A novel approach to organization that provides a clear perspective. Gantt-style Charts…"
   > [来源: https://apps.apple.com/us/app/deadliner-time-management/id1539999660]
   第三方评测的描述更直白：「**Each task displays a countdown, as well as a circular progress bar** that shows you how much…」[来源: https://zetegy.com/articles/top-deadline-tracking-apps-ios-mac]
   **成败证据**：2020-12-12 上架，2026-06-26 仍在更新（6 年存活），但美区**只有 2 个评分、均分 3.0** [来源: https://itunes.apple.com/lookup?id=1539999660&country=us]。**存活但没做起来。**

2. **`Time Left - Quickly create one-time reminders…`**（`id885754544`，Evgeny EGOROV）—— **这是一个真正的「钟面式任务管理器」**，描述原文：
   > "You do not need professional task managers, but do you want to complete everything on time and without mistakes? … **Your day is set up like a clock, and your tasks are unique icons on the dial.** One glance is enough to understand what to do and when to do it. Our app makes task management visual and tangible."
   > [来源: https://apps.apple.com/us/app/time-left-quickly-create-one-time-reminders-on-your/id885754544]
   **成败证据**：**2014-06-09 上架后再也没有更新过**（最后更新日 = 上架日），美区 **2 个评分** [来源: https://itunes.apple.com/lookup?id=885754544&country=us]。**已死。** 这是「把时间可视化和任务结合」最早的一次尝试，也是失败案例。

3. **`TickTick` 的 countdown mode** —— 唯一一个**把「X 天后到期」直接印在任务列表上、并且规模验证成功**的。见第 3 节。

**所以对第 2 节的直接回答：**
- 「Time Left」系列（Julien Lacroix 版、Time Until、Pretty Progress、LIFE LEFT）**都是纯事件/人生倒计时，没有任务管理**。
- 唯一带任务的是 **`Left: Widgets for Time Left`**，但形态是「**倒计时事件 → 附属 to-do list**」，**不是「任务 → 递减进度条」**。
- 「任务本身显示递减倒计时/进度条」这个形态，**只有 Deadliner（小众存活）和 TickTick countdown mode（大厂功能）在做**。

---

## 3. 把倒计时/进度条与任务结合的产品及其成败证据

### 3.1 TickTick countdown mode —— **唯一有规模证据的成功案例**

| 字段 | 值 |
|---|---|
| 形态 | 任务列表视图可切换 `Task time` ↔ `Countdown Time`；任务行显示「还剩 N 天/小时」 |
| 平台 | iOS / Android / macOS / Windows / Web |
| 评分（Play） | **4.6 / 5，164,748 条评论** [来源: https://play.google.com/store/apps/details?id=com.ticktick.task] |
| 官方文档 | "Time slips by quietly… Add Countdowns to make sure you never miss those meaningful days again." [来源: https://help.ticktick.com/articles/7322524237753745408] |

**第三方媒体（ZDNET）的实测说明** —— 这是本次调研里**最直接、最可信的「倒计时降低拖延」从业者证据**：

> "There are **two countdown options in TickTick** — one for everyday tasks and a dedicated countdown feature for milestone events like birthdays and anniversaries. **The former, the everyday task countdown, is the one that served as my biggest productivity boost.** The feature debuted last summer, but I didn't discover it until early this year."
> "When you toggle the everyday task countdown on, the feature shows you exactly how many days or hours you have until a task is due, and **an abstract target suddenly becomes very specific. 'Due Wednesday' becomes '2 day…**'"
> 文章标题即结论：**"Why 'countdown mode' is the task manager feature I can't live without"**
> [来源: https://www.zdnet.com/article/ticktick-task-manager-feature-countdown-mode/]

**用户侧佐证**（Reddit r/ticktick，检索到摘要）：
> "You change the view options from **Task time to Countdown Time** and Ticktick shows **how many days left until the task is due**."
> [来源: https://www.reddit.com/r/ticktick/comments/1p37jjy/countdown_feature_is_super_useful_for_paying/]

⚠️ 注意：**TickTick 的倒计时是「视图/渲染层」功能，不是 AI**。它只是把同一个 due date 换一种呈现方式。

### 3.2 `Deadline App`（Elena Maltceva，`id1557048705`）—— 小规模存活

> "This app is perfect for getting stuff done! **Simple list that sorts based on what needs done next with a timer when that deadline is.**"
> 描述原文：`Create deadlines / Set notifications for them / Track the time left`
> [来源: https://apps.apple.com/us/app/deadline-app/id1557048705]
**成败**：4.52 / 5，**仅 63 个评分**；2021-03 上架，最后更新 2025-02 [来源: https://itunes.apple.com/lookup?id=1557048705&country=us]。**长期低量存活。**

### 3.3 `Griply`（`id1556692747`）—— 目标 + 截止日期 + 任务，但用「图表」而非倒计时条

> "Set a measurable goal with **a start value, a target, and a deadline**, then watch your progress fill in as a chart climbs toward the finish line. Break a big goal into smaller subgoals, then break those down into the daily habits and tasks that move them forward."
> [来源: https://apps.apple.com/us/app/daily-planner-goals-griply/id1556692747]
**成败**：4.65 / 5，**197 个评分**（美区）；厂商自述「App of the Day in 200+ countries, 4.7-star average across 620+ ratings worldwide」。2021-04 上架，2026-09-25 仍在更新。**存活、小规模、独立开发。**

### 3.4 `Deadline Bar: Time Progress`（`id6764828980`，双伟 王）—— 纯可视化，无任务，几乎无人使用

> "Track today, this year, your next project, exam, vacation, goal, or personal deadline with **beautiful visual progress bars**. … Choose from clean bars, segmented progress, circular rings, liquid waves, minimal lines, neon pulses, aurora waves, orbit rings, and time grids."
> "**Local-first and private.** Your timelines are saved on your device. No account. No server."
> [来源: https://apps.apple.com/us/app/deadline-bar-time-progress/id6764828980]
**成败**：**0 个评分**，2026-05 上架后**从未更新** [来源: https://itunes.apple.com/lookup?id=6764828980&country=us]。**无任何牵引力证据。**

### 3.5 `Beeminder` —— 用「线」而不是「倒计时」，但是唯一把「可视化进度 + 真实后果」做成生意的

> "It's reminders with a sting! Or, goal-tracking with teeth. Mind anything you can graph — weight, pushups, **to-do tasks completed** — by replying with data when Beeminder prompts you. … **We plot your progress with a Bright Red Line to your goal. Keep all your datapoints on the good side of your red line or (literally) pay the price.**"
> [来源: https://www.beeminder.com/overview]

**成败证据**：第三方估算 **2024 年 ARR 约 $982.8K（2023 年约 $459.8K）**，**5 名员工**，2010 年成立 [来源: https://getlatka.com/companies/beeminder]。⚠️ 这是第三方估算（getlatka），非公司披露。
**形态要点**：Beeminder 的核心可视化是「**累计曲线 + 红线**」（含"黄砖路"改名为"Bright Red Line"的历史 [来源: https://blog.beeminder.com/brl/]），**不是倒计时数字**。它证明了「进度可视化」能撑起一门小生意，但**驱动力来自金钱承诺（commitment device），不是可视化本身**。

### 3.6 其它相邻产品（形态与规模）

| 产品 | 可视化形态 | 含任务管理 | 规模证据 |
|---|---|---|---|
| **Structured** | 一天的**时间轴**（timeline），任务按时间块排布 | ✅ 有 | Play **4.6 / 5，31,445 条评论** [来源: https://play.google.com/store/apps/details?id=io.unorderly.structured] |
| **Habitica** | RPG 血条/经验条（**不是时间**可视化） | ✅ 有 | Play **4.7 / 5，75,554 条评论** [来源: https://play.google.com/store/apps/details?id=com.habitrpg.android.habitica]；第三方称 4M+ 用户、$5.2M 营收 [来源: https://www.helloleads.io/blog/stats-facts/20-amazing-habitica-stats-and-facts/] ⚠️ 第三方聚合站，未复核 |
| **Forest** | 种树计时（番茄钟） | ❌ 无（专注计时） | Play **4.3 / 5，813,389 条评论**；官方称 60,000,000+ 用户 [来源: https://play.google.com/store/apps/details?id=cc.forestapp] |
| **Due**（持久提醒） | **无倒计时条**，靠每 1 分钟重复推送 | ✅ 提醒（非任务状态） | "so persistent you can't forget anything" [来源: https://www.dueapp.com/] |
| **Things 3** | 只有 due date / deadline 字段，**无倒计时可视化** | ✅ 有 | 官方：一次性买断、无订阅 [来源: https://culturedcode.com/things/support/articles/2803552/] |
| **Amazing Marvin** | "Time Targets"/duration estimates（**时间预算**，非倒计时条） | ✅ 有 | 官方帮助文档 [来源: http://help.amazingmarvin.com/en/articles/1950205-duration-estimates] |
| **ProgressBar: Countdowns & More**（macOS 菜单栏） | 日/周/月/年进度条 + 自定义倒计时 | ❌ 无 | **0 个评分** [来源: https://apps.apple.com/us/app/progressbar-countdowns-more/id6755980802] |
| **Rich Life 人生格子**（中文，`id6753065273`） | 人生格子 + 进度条 + 打卡热力图 | ❌ 无 | **5 / 5，2 个评分**；2025-12 上架 [来源: https://itunes.apple.com/lookup?id=6753065273&country=us] |
| **Countdown (Find Appiness)** | 事件倒计时 + 桌面/锁屏小组件 | ❌ 无 | **4.81 / 5，186,570 个评分** —— 本清单里 iOS 侧评分人数最多的纯倒计时 App [来源: https://itunes.apple.com/lookup?id=1403367428&country=us] |
| **Countdown Star** | 事件倒计时 | ❌ 无 | **4.77 / 5，215,672 个评分** [来源: https://itunes.apple.com/lookup?id=576177593&country=us] |
| **Countdown@**（武汉凌谷叮当科技） | 事件倒计时 | ❌ 无 | **4.70 / 5，39,979 个评分** [来源: https://itunes.apple.com/lookup?id=1456997268&country=us] |
| **Death Clock: The Life Lab** | 寿命倒计时 | ❌ 无 | **4.80 / 5，16,752 个评分** [来源: https://itunes.apple.com/lookup?id=6499554412&country=us] |

### 3.7 关于「成功」的判断

**有明确成功证据的，只有 TickTick 的 countdown mode**（164,748 条 Play 评论的成熟产品 + 一个功能级媒体推荐）。
**其余「把倒计时/进度条和任务结合」的产品全部是小众存活或无牵引力**：
- Deadliner：6 年存活，**2 个评分**
- Deadline App：5 年存活，**63 个评分**
- Griply：5 年存活，**197 个评分**
- Deadline Bar：**0 个评分，无更新**
- Time Left (钟面任务版)：**2014 年后废弃**

**没有任何一款「倒计时 + 任务」产品，能提供公开的营收、用户数或 App Store 排名证据。** 见第 6 节。

---

## 4. 为什么时间可视化对拖延有效（研究 + 用户证据，逐条带 URL）

### 4.1 学术研究

**（1）时间折扣（temporal discounting）是拖延的认知机制 —— 有实证**

Zhang 等 2024，*Scientific Reports*：

> "One long-standing hypothesis is that temporal discounting drives procrastination: in a task with a distant future reward, the discounted future reward fails to provide sufficient motivation to initiate work early. However, empirical evidence for this hypothesis has been lacking. Here, we used a long-term real-world task and a novel measure of procrastination… **We found a positive correlation between individuals' degree of future reward discounting and their level of procrastination, suggesting that temporal discounting is a cognitive mechanism underlying procrastination.** … This association … offers empirical support for **targeted interventions that could mitigate procrastination, such as modifying incentive systems to reduce the delay to a reward and lowering discount rates.**"
> [来源: https://www.nature.com/articles/s41598-024-65110-4]

**为什么这条对「时间可视化」重要**：它把拖延归因于「未来奖励被折现」，而**可视化剩余时间 = 把未来的截止点搬到当下感知里**，逻辑上正是「缩短感知到的延迟」。⚠️ 但要诚实：**该研究并没有测试倒计时 UI**，它测的是折扣率与真实拖延的相关性。这是**机制支持，不是产品级因果证据**。

**（2）目标梯度效应（goal-gradient）—— 越接近目标，努力越强**

Kivetz, Urminsky & Zheng 2006, *Journal of Marketing Research*：

> "The goal-gradient hypothesis denotes the classic finding from behaviorism that **animals expend more effort as they approach a reward**."
> [来源: https://journals.sagepub.com/doi/abs/10.1509/jmkr.43.1.39]
> "**The closer users are to completing a task, the faster they work towards reaching it.** Providing artificial progress towards a goal will help to ensure users are more likely to have the motivation to complete that task. **Provide a clear indication of progress in order to motivate users to complete tasks.**"
> [来源: https://lawsofux.com/goal-gradient-effect/]
> 原论文 PDF：**"people's tendency to accelerate toward their first reward produces a greater probability of retention and faster reengagement in the program."**
> [来源: https://home.uchicago.edu/ourminsky/Goal-Gradient_Illusionary_Goal_Progress.pdf]

**（3）禀赋进度效应（endowed progress）—— 人为给的「已完成」也能提升完成率**

Nunes & Drèze 2006, *Journal of Consumer Research*（洗车集点卡实验：8 格需集 8 次 vs 10 格已预填 2 格、实际都需 8 次）：

> "Those provided the endowed progress were **more likely to buy the required eight car washes** (hypothesis 1) and **bought them sooner** than their counterparts."
> [来源: https://www.jstor.org/stable/10.1086/500480]

**为什么这条重要**：它说明**「进度呈现方式」本身就能改变行为，即使真实剩余工作量没变**。这既是对可视化有效性的支持，也是第 5 节「假进度」批评的来源。

**（4）Zeigarnik 效应 —— 未完成任务占据心智**

Nielsen Norman Group（Feifei Liu, 2024-03-27）：

> "The Zeigarnik effect suggests that **unfinished tasks are more memorable than completed ones**. In UX design, we can leverage this effect to **encourage user engagement and task completion**."
> [来源: https://www.nngroup.com/videos/zeigarnik-effect/]
> LawsofUX 版本："She had found that **incomplete tasks are easier to remember than successful ones**."
> [来源: https://lawsofux.com/zeigarnik-effect/]

**（5）截止日期承诺需求真实存在，但「截止日期本身」不一定提高完成率 —— 必须精确表述**

Bisin & Hyndman, NBER Working Paper 19874：

> "We document a **strong demand for commitment, in the form of self-imposed deadlines**, which appear to be associated with students' self-reported psychological characteristics and cost of time. … We find that **present-bias is relatively widespread but that having multiple repeated tasks appears to activate effective internal self-control mechanisms.** Finally, we also document an important form of **partial naïveté** on the part of students in anticipating their ability to self-control when setting deadlines."
> [来源: https://www.nber.org/papers/w19874]
> 期刊版摘要（*Games and Economic Behavior*, 2020）说得更狠："We document a robust demand for commitment, in the form of self-imposed deadlines. **On the other hand, deadlines do not increase completion rates in our experiment.**"
> [来源: https://www.sciencedirect.com/science/article/pii/S0899825619301757]

⚠️ **这是本节最重要的一条反面限定**：人们**想要**截止日期，但**加了截止日期不必然提高完成率**。所以「把截止日期可视化」的价值主张不能被表述为「有 deadline 就能治拖延」。

**（6）ADHD 时间盲（time blindness）与视觉化计时器 —— 有临床综述支持**

Wennberg 等 2017（PMC 全文）：

> "An example of a product **compensating for deficits in time perception was a visual timer**."
> [来源: https://pmc.ncbi.nlm.nih.gov/articles/PMC5852175/]
> 斯坦福 CTL 的建议页："**Visual Timers**: Look for visual timers, analog timers, or digital timer apps that **represent time passing/running out as a shrinking wedge**."
> [来源: https://ctl.stanford.edu/managing-time-blindness]

**（7）时间充裕感（time affluence）—— 更弱的旁证**

Whillans 等 2017, *PNAS*："We provide evidence that **using money to buy time can provide a buffer against this time famine, thereby promoting happiness.**" [来源: https://www.pnas.org/doi/10.1073/pnas.1706541114] ⚠️ 该页本次**未能直接抓取**，仅检索到摘要；且它讲的是「买时间」而非「看时间」，**与倒计时 UI 只有很间接的关系**。
时间充裕感的概念综述：Frontiers in Public Health 2026 [来源: https://www.frontiersin.org/journals/public-health/articles/10.3389/fpubh.2026.1824268/full]。

### 4.2 从业者解释（非学术，但具体可引用）

**ZDNET 记者 Artie Beaty（TickTick countdown mode 实测）**：

> "Seeing an arbitrary date on a calendar, or even 'Due Friday,' **might not convey how pressing the deadline is.**"
> "**an abstract target suddenly becomes very specific.**"
> [来源: https://www.zdnet.com/article/ticktick-task-manager-feature-countdown-mode/]

**Irrational Labs（行为科学咨询公司）对进度条的双向总结**：

> "**Visualizing progress can be a powerful motivator to action.** The goal of including progress bars, checklist, or completion meter in a flow is to keep completion rates high…"
> [来源: https://irrationallabs.com/blog/knowledge-cuts-both-ways-when-progress-bars-backfire/]

### 4.3 真实用户评论（**逐条来自 App Store 评论 RSS 实测返回**）

**`Time Left • Be Present`（`id1534791123`）**
- 5★ **"A Game Changer!"** — "I really love this app. It transformed the way I view time. **I have trouble with procrastination but this changed how I move each day.** I really like the visuals, especially the widgets which I add on my Mac."
- 5★ **"Great idea!"** — "**This app helps me with my time blindness**"
- 5★ **"Great!"** — "Some folks think I'm crazy but **seeing my estimated time left is a motivator!** Gotta go live!"
- 5★ **"Just what i was looking for."** — 但同一批评论里也有人说要「周视图」
- 5★ **"To think & hope"** — "**This forces me to both slow down and push myself a bit.** I love that!"
- 5★ **"Shifting the anxiety paradigm"** — 提到 "this gives a very striking spin to **anxiety/perspective**"
- [来源: https://itunes.apple.com/us/rss/customerreviews/id=1534791123/sortBy=mostRecent/json]

**`Left: Widgets for Time Left`（`id6740155884`）**
- 5★ **"Time finally feels visible with this!"** — "Really love **seeing how much of the day and week I still have left** instead of just jumping between habit apps. Habits, countdowns, and my planner all sit together so the day feels calmer and easier to follow."
- 5★ **"Love the visuals!"** — "**Being able to visualize time is so valuable to keep me oriented in my day-to-day life.**"
- 5★ **"Perfect for tracking goals through time"**
- [来源: https://itunes.apple.com/us/rss/customerreviews/id=6740155884/sortBy=mostRecent/json]

**`Countdown - Pretty Progress`（`id1597616326`）**
- 3★ **"Great idea.. interface is clunky"** —— **本调研里最有价值的一条**：
  > "Love the idea of a set of countdowns to manage my calendar, **something about seeing 3 weeks left motivates me more than a date out on a grid.**"
- 5★ **"Great App."** — "Excellent app to help **reduce stress** with every step of life"
- 5★ **"Count down to retirement"** — "Love the widget on my phone. … **Started at over 600 days and now under 575.** Now to make the dream reality."
- 5★ **"Works great for progress bars as widgets"** — "If you just need a widget listing the time remaining for an important event **without a progress bar**, get the Countdown app."（说明用户明确区分「有进度条」与「只有剩余时间」）
- [来源: https://itunes.apple.com/us/rss/customerreviews/id=1597616326/sortBy=mostRecent/json]

> ⚠️ 注意区分：`left-time.app` 与 `prettyprogress.app` 官网上那些署名推荐语（"– Mark S."、"– Edgar K."）是**厂商自选的营销素材**，**不是** App Store 评论，可信度低，本报告不把它们当作独立证据。

---

## 5. 反面证据与保留意见

### 5.1 进度条会**反向**降低完成率 —— 有 32 个实验的元分析支撑

Irrational Labs（Lisa Zaval, Kristen Berman, 2022-07-29）：

> "**Unfortunately, this doesn't always turn out to be true. We've found that poorly designed progress bars can backfire, delaying or decreasing completion rates.**"
> "Results from a **meta-analysis examining 32 experiments** demonstrated that **survey progress bars backfire when expectations for early progress aren't met.** Researchers found that **progress bars negatively impacted completion when people felt the survey required high early investment.** When visual feedback shows slow initial progress, users will become discouraged from completing the task at hand."
> "The silver lining? The same researchers found that progress bars **did improve completion rates when the speed of the progress *decelerates* across the task**–i.e., users move fast during the first screens and slow down toward the end."
> [来源: https://irrationallabs.com/blog/knowledge-cuts-both-ways-when-progress-bars-backfire/]
> 该文引用的元分析：https://journals.sagepub.com/doi/pdf/10.1177/0894439313497468

**对产品的直接含义**：一条**线性、匀速、从 100% 走到 0%** 的截止日期进度条，恰好是「一开始看起来还剩很多」的形状 —— 也就是元分析里**最容易打击完成意愿**的那一类。这一点对本项目是**结构性风险**，不是细节。

### 5.2 目标梯度效应**不是**普适的 —— 「卡在中间」有学术反例

Bonezzi, Brendl & De Angelis 2011, *Psychological Science*：

> "The classic goal-gradient hypothesis posits that motivation to reach a goal increases monotonically with proximity to the desired end state. **However, we argue that this is not always the case.** In this article, we show that **motivation to engage in goal-consistent behavior can be higher when people are either far from or close to the end state and lower when they are about halfway to the end**…"
> "In particular, we hypothesize that **motivation can decrease about halfway to the end state.**"
> [来源: https://psycnet.apa.org/record/2011-09890-008] [来源: https://journals.sagepub.com/doi/10.1177/0956797611404899]
> 论文 PDF（NYU Stern 镜像）：https://web-docs.stern.nyu.edu/pa/Stuck_in_the_Middle.pdf

**含义**：一个 30 天的任务，在第 15 天时进度条显示 50% —— 按这条研究，那**恰恰是动机最低点**。单纯「显示进度」不解决这个 U 型谷。

### 5.3 「剩余」还是「已完成」的框架会改变动机方向

Koo & Fishbach 2008, *JPSP*：

> "**Two factors increase the motivation to adhere to a goal: goal commitment and lack of goal progress.**"
> "This article investigates **how monitoring one's current goal in terms of remaining actions versus completed actions influences the desire to move up the goal**…"
> [来源: https://pubmed.ncbi.nlm.nih.gov/18211171/] [来源: https://www.researchgate.net/publication/5640927_Dynamics_of_Self-Regulation_How_Unaccomplished_Goal_Actions_Affect_Motivation]

**含义**：倒计时 UI 天然是「**剩余**框架」（remaining）。研究提示这**不总是**最优 —— 有些场景下「已完成」框架更提动机。这是一条需要 A/B 验证的设计岔路，不是可以拍脑袋定的。

### 5.4 「人生周格 / memento mori」类 App 的留存与商业化问题

**（a）同质化严重、且大量产品零牵引力**（全部来自 iTunes Lookup 实测）：
- `RemainingWeeks: Time Left`（`id6785275888`）：**0 个评分**
- `Time left: #1 Counter Widget`（`id6755923528`）：**0 个评分**
- `Time Left Today: Time Balance`（`id1669854131`）：**1 个评分**
- `Time Left - Countdown`（`id6752404019`）：**1 个评分**
- `Time Left - LIFE LEFT`（`id6444656317`）：**38 个评分**
- `Rich Life 人生格子`（`id6753065273`）：**2 个评分**
- [来源: https://itunes.apple.com/lookup?id=6785275888&country=us 等，见 §1.5 逐条 URL]

**（b）明确的下架案例**：
> "**Life Left Countdown Widget** was an overall app developed by Johnathan Mawdsley. **It was removed from Google Play Jun 28, 2026 and is no longer available for…**"
> [来源: https://www.appbrain.com/appstore/life-left-countdown-widget/ios-6757678645]

**（c）明确的废弃案例**：
- `Time Left - A daily reminder to live well`（Apptly LLC）：**2015-04-25 上架后从未更新**，**2.96 / 5，91 个评分** [来源: https://itunes.apple.com/lookup?id=878704370&country=us]
- `Time Left - Quickly create one-time reminders…`（钟面任务管理器）：**2014-06-09 后从未更新**，**2 个评分** [来源: https://itunes.apple.com/lookup?id=885754544&country=us]

**（d）「买了就为看个好看的小组件」—— 用户自述的 novelty 属性**（App Store 评论 RSS 原文）：
- `Left`（`id6740155884`）3★：**"I thought it looked cool, so I bought it, but I don't have any use for it other than the widget looking nice on my lock screen."**
- `Pretty Progress`（`id1597616326`）3★：**"Meh — It did the job of counting down my birthday but it also could have better free options. After tomorrow which is my birthday I'm deleting it's very mah and boring."**
- `Left` 2★：**"Great original concept but now with too much feature bloat"**
- `Time Left • Be Present` 3★：**"Revamp is cool, but why do developers take away stuff when doing an update or revamp? … The whole point of the app is to visualize how much time you have left. Just showing the number of days, weeks, or years doesn't have the same impact."**
- [来源: https://itunes.apple.com/us/rss/customerreviews/id=6740155884/sortBy=mostRecent/json 与 .../id=1597616326/... 与 .../id=1534791123/...]

**（e）付费墙是这一品类最集中的差评主题**（同一批 RSS 评论里反复出现）：
- `Left`：1★ "Pushes in-app purchases way too hard. Can't even use basic features without paying."；1★ "Paywall — You can't do anything with this app unless you pay for the plus. Why have it marked for free on the App Store…"；1★ "scam — I bought pro in early days and the delevoper wants more money to sell us another pro version"；4★ "the discount price as $49.99. The regular new lifetime price is $69.99… math ain't mathing."
- `Pretty Progress`：1★ **"not paying Rent for a countdown timer — … $35 for lifetime access? … EDIT: It's now $60!"**；2★ **"$60?? Too expensive compared to competitors"**；1★ "Deleting — It's not free! You can set up countdowns for free but to make it a widget you have to pay."
- `Time Left • Be Present`：1★ **"Scammy payment system, pay only widget — Asks you to pay $260 a year to use this app."**（⚠️ 单条用户评论，**未获官方定价页面证实**，见 §6）；1★ "Waste — Just one big ad to buy the pro version"
- [来源: 同上的三个 RSS URL]

**（f）用户自述倒计时对他没用（针对「倒计时=治拖延」的直接反例）**：
- r/ADHD（检索到摘要，中文界面）：**"我必须说，整个倒计时的事情对我来说从来没用。我觉得它对我不起作用的原因是，如果我不起来，就没有什么'立刻'会发生的负面后果。"**
- [来源: https://www.reddit.com/r/ADHD/comments/lkn6qy/executive_dysfunction_makes_me_feel_completely/?tl=zh-hans]

**（g）从业者侧对计时器的反向观察**：
- **"For some ADHD brains, a ticking timer triggers time anxiety rather than time awareness. The countdown becomes a source of stress that impairs…"** [来源: https://super-productivity.com/blog/adhd-time-blindness-strategies/] ⚠️ 这是**厂商博客**（Super Productivity 是竞品），权威性低，且该页本次未能抓取，仅检索到摘要。列为**待复核**。
- `Time Left - LIFE LEFT` 的 App Store 描述里开发者自己就写了免责声明：**"Not recommended if you'd rather not hear the clock ticking."** —— 这是**开发者本人承认**该形态对部分用户是负面刺激 [来源: https://apps.apple.com/us/app/time-left-life-left/id6444656317]

### 5.5 通知/提醒的反作用（相邻但不同）

任务中断研究（Ohly 等 2023, PMC）："**Interruptions were found to cause more annoyance and anxiety, increase stress and frustration, and lead to errors in the primary task, less…**" [来源: https://pmc.ncbi.nlm.nih.gov/articles/PMC10244611/]
⚠️ 这是关于**通知打断**，不是关于**倒计时视图**。不能直接用来否定可视化本身，但足以说明「靠更多提醒」这条路有代价。

### 5.6 保留意见小结（给本项目的直接提示）

1. **「倒计时/进度条能治拖延」目前没有产品级因果证据。** 只有机制层研究（时间折扣、目标梯度、禀赋进度）与零散用户自述。**没有找到任何随机对照实验测试「给任务加倒计时条 → 完成率提升」**（见 §6）。
2. **线性递减的进度条在实验里是最容易反噬的形状**（§5.1）。
3. **中点是动机谷**（§5.2），而线性条在中点恰恰最显眼。
4. **「剩余」框架不一定优于「已完成」框架**（§5.3）。
5. **同品类大量产品零评分、零更新、甚至下架**（§5.4），说明「好看的时间可视化」是**易做难留**的品类。
6. **该品类的付费墙差评极其集中**，说明用户对「为一个倒计时订阅付费」的接受度低。

---

## 6. 未找到公开信息的部分

以下项目经真实检索后**未能找到可靠公开来源**，按规则如实标注：

### 6.1 价格 / 内购金额
- **`Time Left • Be Present`（Julien Lacroix）PRO 的官方内购金额**：未找到公开信息。App Store 描述只写 `TIME LEFT PRO` 解锁 widgets & skins、unlimited moments、Live Photos，**未列出任何金额** [来源: https://apps.apple.com/us/app/time-left-be-present/id1534791123]。唯一的金额线索是 1★ 用户评论称 "$260 a year"，**与描述不符且无法证实**，不作为事实采信。
- **`Left: Widgets for Time Left` 三档 pay-what-you-want 的具体金额**：未找到公开信息。官网只说 "choose from three prices" [来源: https://left-time.app/]。用户评论提到 $49.99 / $69.99（终身，折扣前后）与 $3.99，但属用户自述、且随时间变化。
- **`Pretty Progress PRO` 内购的逐项官方金额**：未找到公开信息（**仅检索到列表页文本**：Weekly $4.99 / Annual $14.99 / Lifetime 金额被截断）[来源: https://apps.apple.com/us/app/countdown-pretty-progress/id1597616326]。用户评论独立提到终身价约 $60。
- **`Time Until`（Android）内购金额**：未找到公开信息。Play 页面只标 "Contains ads / In-app purchases" [来源: https://play.google.com/store/apps/details?id=com.brunoschalch.timeuntil]。
- **`Deadliner` / `Deadline App` / `Griply` / `TickTick` 的具体订阅金额**：未找到公开信息（未逐项抓取各自定价页）。

### 6.2 营收 / 用户数 / 排名
- **`Time Left • Be Present`（Julien Lacroix）的营收与用户数**：未找到公开信息。
- **`Left`（Cntxt Limited）的营收与真实用户数**：未找到公开信息。只有厂商自述 "100k+ users"、"240k+ special dates"，**无第三方复核**。
- **`Pretty Progress` 的营收**：未找到公开信息。厂商自述 "2M+ users with 4.8 rating"，**与 App Store 实测的 3,035 个评分明显不匹配**，需谨慎对待。
- **`Deadline Bar` / `Deadliner` / `Deadline App` / `Griply` 的营收、下载量、App Store 排名**：未找到公开信息。
- **`TickTick` 的营收 / 付费用户数**：未找到公开信息。仅有 Play 评分人数（164,748）。
- **`Structured` / `Amie` / `Tiimo` 的营收**：未找到公开信息。仅有 Play 评分人数（Structured 31,445）。
- **`Things 3` / Cultured Code 的营收**：未找到可靠公开信息。检索到的来源互相矛盾（Reddit 用户估算约 $260M/年；RocketReach 写 $192,000 营收、6 名员工），**两者都不可信，不予采信**。
- **`Habitica` 的营收**：仅有第三方聚合站 helloleads 称 "$5.2 million"、4M+ 用户、28 名员工 [来源: https://www.helloleads.io/blog/stats-facts/20-amazing-habitica-stats-and-facts/]。**未获官方或权威来源复核**，仅作弱参考。
- **`Beeminder` 的营收**：仅有 getlatka 估算 2024 年 ARR $982.8K、5 名员工 [来源: https://getlatka.com/companies/beeminder]。**第三方估算，非公司披露**。
- **`Forest` 的营收**：未找到公开信息（官方称 60M+ 用户 [来源: https://play.google.com/store/apps/details?id=cc.forestapp]）。

### 6.3 留存数据
- **任何「人生周格 / memento mori」类 App 的 D1/D7/D30 留存率或流失曲线**：**未找到公开信息**。检索到的只有 App Store 通用留存方法论（如 Apple 官方技术讲座 https://developer.apple.com/videos/play/tech-talks/111386/）与泛化的 App Store 下载下降趋势报道，**均不针对本品类**。
- **「倒计时挂在任务上」的留存对比数据**：未找到公开信息。

### 6.4 缺失的因果实验
- **未找到公开信息**：任何**随机对照实验 / A-B 测试**，直接检验「在任务上显示递减倒计时条或进度条 → 任务完成率/按时完成率提升」。现有研究要么是机制层（时间折扣、目标梯度），要么是**别的场景**（洗车集点卡、问卷进度条、筹款活动）。**这是本调研最大的证据缺口**，也是本项目若要押注该形态时最需要自建实验补上的部分。

### 6.5 中国产品
- **`人生进度条` 系列（小程序 / 网页工具）、`时光序`、`番茄土豆`、`小日常`、`人生总结`（Play `com.tooltoolnam.ttm_life_summary`）的营收、用户量、留存**：**未找到公开信息**。检索到的只有工具页面与知乎介绍文章（如 https://zhuanlan.zhihu.com/p/148658585 、https://iknowabit.com/zh/life-progress 、https://pudone.com/zh/life-countdown ），**均无商业数据**。
- **`Rich Life 人生格子`（`id6753065273`）的 PRO 定价与用户量**：未找到公开信息（只有 2 个评分，2025-12 上架）。
- **`滴答清单`（TickTick 中文版）的倒计时功能是否有中文用户规模数据**：未找到公开信息。

### 6.6 本次会话的技术性缺口（诚实披露）
- **App Store / Google Play 列表页原文未能直接抓取**（地域重定向 / 反爬）。因此 §1.4 中 Pretty Progress 的内购档位、以及 Play 侧部分描述，来自**搜索引擎检索到的页面文本**，而非逐项复核的页面抓取。已在上文逐处标注。
- **Reddit 与 PubMed 页面被反爬拦截**，相关引用为**检索结果摘要**（含标题、URL、时间与摘要句），已逐处标注。
- **anysearch CLI 在调研中途耗尽当日免费配额**，`web_search`（Tavily）全程 HTTP 432 不可用。因此 §4、§5 中的学术来源覆盖**不完整** —— 例如「dopamine 与进度条」「deadline salience 的具体实验」「time affluence 与拖延的直接关系」等子问题**未充分检索**，不应视为「已穷尽」。

---

## 附：一句话结论

**「Time Left」是一堆互相无关的同名产品；其中唯一带任务管理的 `Left: Widgets for Time Left` 也是「事件挂 to-do」，不是「任务挂倒计时条」。真正把倒计时印在任务上并做成的只有 TickTick 的 countdown mode（有 164,748 条 Play 评论的成熟产品 + 一家主流科技媒体的功能级推荐），而专做这件事的小产品（Deadliner、Deadline App、Deadline Bar）全部停在 0–200 个评分区间。心理机制（时间折扣、目标梯度、禀赋进度）支持「让时间可见有用」，但已有实验同时表明线性递减进度条是最容易反噬的形状，且**没有任何产品级因果实验**能证明「任务加倒计时条 → 拖延减少」——这是本调研最大的证据缺口，也是本项目最该自建 A/B 验证的地方。**
