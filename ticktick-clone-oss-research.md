# 滴答清单（TickTick）替代品：GitHub 开源模块调研报告

> **核实日期**：2026-09-25（CST）
> **核实方式**：本机 `api.github.com` 不可用、`web_fetch` 抓 `github.com` 会被拒（域名解析到非公网 IP），因此全部改用 `curl` 直取 `github.com` 仓库页 HTML + `commits/<branch>.atom` / `releases.atom` 提要 + `raw.githubusercontent.com` 的 LICENSE 原文 + `img.shields.io`（语言占比，镜像 linguist 数据）+ `pub.dev` / `registry.npmjs.org` 的包元数据。
> 自建脚本：`research/ghinfo.py`（用法 `python3 research/ghinfo.py owner/repo [...]`，输出 TSV：stars / forks / license / archived / default branch / last commit / latest release / top language / description / topics）。
> **数据口径**：本报告中所有 Star 数、License、最后提交时间、最新 Release 均为 **2026-09-25 实测值**；凡 GitHub 标签为 `NOASSERTION` / `Other` / `NA` 的，均另行读取 LICENSE 原文确认后才写入 SPDX；无法核实的字段一律写「未核实」，不做推测。
> **证据分级**：`【实测】`= 本次 curl 一手核实；`【文档】`= 只读到官方文档/官网/README（未读源码）；`【未核实】`= 仅搜索线索，未经核实。

---

## 0. 结论速览：每个模块的首选与许可风险

| # | 功能模块 | 首选（许可 / 可商用？） | 备选 | 一句话结论 |
|---|---|---|---|---|
| 1 | 习惯打卡 | **FriesI23/mhabit**（Apache-2.0 ✅可商用，Flutter 跨端 + WebDAV 同步） | beaverhabits（BSD-3-Clause）、Loop Habit Tracker（GPL-3.0）、Habitica（GPL-3.0 + 素材 CC-BY-NC-SA ⚠️） | 开源生态**很成熟**；Apache-2.0 的 mhabit 是唯一能直接当商业产品骨架的 |
| 2 | 番茄钟 / 专注 | **johannesjo/super-productivity**（MIT ✅，任务+番茄+Flowmodoro+时间追踪一体，最佳参考实现） | Pomotroid / Pomatez / TomatoBar（均 MIT）、Goodtime / Tomato（GPL-3.0）、ActivityWatch（MPL-2.0，自动时间追踪） | 计时器本身不难，**难点是「番茄钟 ↔ 任务」的数据绑定**，Super Productivity 是唯一把这条打通的 |
| 3 | 四象限 / 艾森豪威尔 | 见 **§4**：**没有可复用的开源组件库，必须自研**（拖拽用 dnd-kit 17,667★ MIT） | gsd-task-manager（26★ MIT，样板）、todoist-matrix（2★ MIT，架构范式）、Einsen（919★ Apache-2.0，停更） | 开源生态**最薄弱**：前 20 名全是个人练手项目，55% 已归档或 2 年无提交 |
| 4 | 日历 + CalDAV | 服务端 **Radicale**（GPL-3.0，独立部署无冲突）/ **sabre/dav**（BSD-3-Clause ✅可嵌入）；客户端库 **dav4jvm**（MPL-2.0 ✅，Android/JVM）、**tsdav**（MIT ✅，JS/RN）、**python-caldav**（Apache-2.0 ✅） | Baikal、Xandikos、Nextcloud Tasks、Tasks.org、jtx Board、DAVx⁵ | 用 CalDAV 当同步层是**最省事的互操作方案**；注意 GPL 客户端 App 只能做参考实现，不能链接进闭源产品 |
| 5 | 自然语言日期解析 | **wanasit/chrono**（MIT ✅，JS/TS，**自带中文 locale**）+ 中文长尾 **JioNLP**（Apache-2.0 ✅） | dateparser（BSD-3 ✅，Python）、duckling（BSD-3 ✅，多语种服务）、olebedev/when（Apache-2.0，Go） | 高频中文表达现成库够用；长尾必须自研规则 + LLM 兜底 |
| 6 | 重复任务 RRULE | **jkbrzt/rrule（rrule.js）**（BSD-3-Clause ✅）+ **python-dateutil**（Apache-2.0 或 BSD-3 双许可 ✅） | lib-recur（Apache-2.0，Java/Android）、rrule-go（MIT）、rust-rrule（Apache-2.0）、Dart rrule（Apache-2.0） | 每个语言都有成熟实现，**直接用，不要自研** |
| 7 | 本地优先同步引擎 | 见 §7（完全开源可商用 / copyleft / 商业授权三档差异极大） | Yjs、Automerge、Loro（MIT）、ElectricSQL（Apache-2.0）、RxDB（Apache-2.0）、WatermelonDB（MIT） | **同步引擎是选型风险最高的一块**，必须逐个读 license 原文 |
| 8 | 小组件 / 跨端 | 见 §8（Flutter + `home_widget`；Android 原生 Glance；RN + `react-native-android-widget`；Tauri 只能做桌面） | Tasks.org（Compose Multiplatform，Android+macOS）、mhabit（Flutter，全平台） | 小组件是**唯一无法完全跨端复用**的部分，必须每端写原生代码 |

---

## 1. 核实方法与证据分级（可复核性说明）

1. **环境限制**（如实记录，便于复核）：
   - `api.github.com` 本机不可用（DNS 指向 fake-IP 段 `198.18.x.x`），本报告**未使用任何 GitHub API 数据**。
   - `web_fetch` 工具对 `github.com` 直接报错 `URL hostname "github.com" resolves to a non-public IP address`；`curl` 走系统代理可正常访问（实测 HTTP 200）。
   - 因此 GitHub 侧数据全部来自**网页 HTML + atom feed**：star/fork 取仓库页内嵌 JSON 的 `stargazerCount` / `forksCount`；license 取 `"license":{"spdxId":...}`；最后提交时间取 `commits.atom` 的 `<updated>`；最新 release 取 `releases.atom`。
2. **许可核实规则**：凡 GitHub 识别不出标准许可证（显示 `NOASSERTION (Other)` 或 `NA`）的，一律 `curl` 读 `raw.githubusercontent.com/.../LICENSE|LICENCE|LICENSE.md|COPYING` 原文；本报告中这类项目包括 Habitica、dateutil、rrule.js、libical、php-rrule、vdirsyncer、joplin、focalboard、planka 等，均已在正文注明原文结论。
3. **语言占比**来自 `img.shields.io/github/languages/top/<repo>`（镜像 GitHub linguist 结果），仓库页内的 Languages 区块是 JS 骨架加载的，服务端 HTML 拿不到。
4. **本报告的三档证据标注**：`【实测】` / `【文档】` / `【未核实】`。
5. 并行调研产出（同目录）：`research/module5-nlp-dates.md`（自然语言解析完整明细）、`research/module3-eisenhower.md`、`research/module7-sync-engines.md`、`research/module8-crossplatform-legal.md`。

---

## 2. 模块 1：习惯打卡（Habit Tracker）

| 项目 | 仓库 | Star（2026-09-25 实测） | License（精确） | 技术栈 | 活跃度 | 解决滴答哪个功能点 | 集成方式 |
|---|---|---|---|---|---|---|---|
| **mhabit（Table Habit）** | https://github.com/FriesI23/mhabit | **1596** | **Apache-2.0** ✅可商用 | Flutter / Dart 97.6% | 极活跃：last commit 2026-09-23，v1.27.9（2026-09-20） | 习惯打卡 + 评分算法 + 热力图 + **WebDAV 同步** + 本地优先；Android/iOS/Windows/macOS/Linux 全平台 | **参考实现（首选）**：Apache-2.0 允许直接 fork/改写进闭源产品 |
| beaverhabits | https://github.com/daya0576/beaverhabits | 1842 | **BSD-3-Clause**（原文核实） ✅ | Python 97.2%（自托管 Web） | 活跃：2026-09-17，v0.10.0（2026-07-30） | 自托管习惯追踪（无目标值，纯 streak） | 参考实现 / 可自托管服务 |
| Loop Habit Tracker | https://github.com/iSoron/uhabits | **10275** | **GPL-3.0** ⚠️ copyleft | Kotlin 83.3%（Android 原生） | 活跃但节奏慢：2026-07-21，v2.3.1（2025-08-14） | 习惯打卡事实标准：streak 计算、热力图、提醒、小组件 | **参考实现**（GPL：不可链接进闭源 App；算法/交互可学习） |
| Habitica（Web/服务端） | https://github.com/HabitRPG/habitica | **14172** | 代码 **GPL-3.0** + **素材 CC-BY-NC-SA 3.0**（LICENSE 原文明确区分）⚠️ | JS/Node/Vue/MongoDB | 极活跃：2026-09-24，v5.50.6 | 游戏化习惯（Karma/金币/装备/组队） | 参考实现；**注意：美术素材是 NC（非商业）授权，不可用于商业产品** |
| Habitica Android | https://github.com/HabitRPG/habitica-android | 1821 | GPL-3.0 ⚠️ | Kotlin 90.3% | 活跃：2026-09-24，4.10.5 | 移动端游戏化习惯交互 | 参考实现 |
| Habitica iOS | https://github.com/HabitRPG/habitica-ios | 854 | GPL-3.0 ⚠️ | Swift 99.9% | 活跃：2026-09-24 | 同上 | 参考实现 |
| OpenHabitTracker | https://github.com/Jinjinov/OpenHabitTracker | 286 | **GPL-3.0** ⚠️ | C# / .NET 10 / Blazor + MAUI | 活跃：2026-09-19，1.2.4.1（2026-08-12） | 习惯 + 任务 + 笔记一体，跨 Web/Windows/Linux/Android/iOS/macOS | 参考实现（跨端架构可借鉴） |
| Habo | https://github.com/xpavle00/Habo | 1511 | **GPL-3.0** ⚠️ | Flutter / Dart 95.8% | 中等：2026-05-06，v4.0.0（2026-05-10） | 隐私优先习惯追踪 + **E2EE 同步 + 自托管后端** | 参考实现（同步架构值得读） |
| HabitTrove | https://github.com/dohsimpson/HabitTrove | 683 | **AGPL-3.0** ⚠️ | TypeScript / Next.js | 中低：2026-03-07，v0.2.31 | 游戏化习惯（金币兑换奖励）+ 热力图，自托管 PWA | 参考实现（AGPL：网络服务有源码义务） |
| zackha/habit | https://github.com/zackha/habit | 249 | **MIT** ✅ | Vue/Nuxt/Drizzle/SQLite | 中低：2025-10-21，v6.1.22 | 轻量 Web 习惯追踪 | 库/参考实现（MIT 最宽松） |
| cal-heatmap | https://github.com/wa0x6e/cal-heatmap | 3136 | **MIT** ✅ | TypeScript + d3 | **维护放缓**：2024-03-03（4.3.0-beta.4） | 日历热力图组件（习惯/统计视图） | **库**：直接嵌 Web 端 |
| react-activity-calendar | https://github.com/grubersjoe/react-activity-calendar | 597 | **MIT** ✅ | React / TypeScript | 活跃：2026-09-24 | GitHub 风格贡献热力图组件 | **库**（React 端首选热力图） |

**要点**
- 习惯模块是开源生态最成熟的模块之一，但**许可证两极分化**：Apache-2.0（mhabit）和 BSD-3-Clause（beaverhabits）可直接商用；Loop Habit Tracker / Habitica / Habo / OpenHabitTracker 都是 GPL 系，只能当参考实现或独立进程使用。
- Habitica 的 **素材许可（CC-BY-NC-SA 3.0）与代码许可（GPL-3.0）分离**，是「游戏化习惯」最容易踩的坑：代码开源不等于美术资源可商用。【实测：读 LICENSE 原文】
- 若目标产品是**移动端 + 桌面端 + 小组件**，`mhabit`（Flutter，Apache-2.0，自带 WebDAV 同步与本地优先存储）是唯一能当骨架用的候选。

---

## 3. 模块 2：番茄钟 / 专注计时（含白噪音与专注统计）

| 项目 | 仓库 | Star（2026-09-25 实测） | License（精确） | 技术栈 | 活跃度 | 解决滴答哪个功能点 | 集成方式 |
|---|---|---|---|---|---|---|---|
| **Super Productivity** | https://github.com/johannesjo/super-productivity | **22240** | **MIT** ✅ | TypeScript/Angular/Electron 90.4% | 极活跃：2026-09-24，v19.1.0（2026-09-19） | **任务 + 番茄钟 + Flowmodoro/Flowtime + 时间盒 + 时间追踪 + 习惯**，topics 含 `pomodoro`/`flowmodoro`/`habit-tracker`/`local-first` | **参考实现（最佳）**：唯一把「番茄钟 ↔ 具体任务 ↔ 时间统计」完整打通的 MIT 项目 |
| Pomotroid | https://github.com/Splode/pomotroid | 5517 | **MIT** ✅ | Rust + Tauri + Svelte 53.4% | 活跃：2026-06-19，v1.7.1（2026-05-11） | 桌面番茄钟 UI/通知/托盘 | 参考实现 / 可 fork（Tauri 桌面端样板） |
| Pomatez | https://github.com/roldanjr/pomatez | 4901 | **MIT** ✅ | TypeScript/Electron 91.4% | 活跃：2026-05-19，v1.11.0 | 桌面番茄钟（Electron 路线对照） | 参考实现 |
| TomatoBar | https://github.com/ivoronin/TomatoBar | 3542 | **MIT** ✅ | Swift 91.5%（macOS 菜单栏） | 活跃：2026-05-29 | macOS 菜单栏常驻计时器（系统集成体验参考） | 参考实现（仅 macOS） |
| Goodtime | https://github.com/goodtime-productivity/Goodtime | 1905 | **GPL-3.0** ⚠️ | Kotlin 96.5%（Android） | 活跃：2026-08-02，3.2.6 | Android 番茄钟 + Flow 技术，F-Droid 可装 | 参考实现（GPL） |
| Tomato | https://github.com/nsh07/Tomato | 1467 | **GPL-3.0** ⚠️ | Kotlin Multiplatform（Android + Desktop） | 活跃：2026-09-19，v2.0.1 | Material 3 Expressive 计时器 + 专注统计 + **小组件** | 参考实现（KMP 跨端 + 小组件的好样本） |
| gnome-pomodoro | https://github.com/gnome-pomodoro/gnome-pomodoro | 2258 | **GPL-3.0** ⚠️ | Vala/GTK 98.3% | 活跃：2026-09-20，1.1.5 | 桌面系统级集成（DND/通知/统计） | 参考实现 |
| ActivityWatch | https://github.com/ActivityWatch/activitywatch | 18978 | **MPL-2.0** ✅（文件级 copyleft） | Python 92.8% | 极活跃：2026-09-19，v0.14.0b9（2026-09-24） | **自动时间追踪 / 专注统计报表**（滴答「专注统计」） | 可作为独立服务集成；MPL 允许闭源调用，仅修改其文件需开源 |
| Traggo | https://github.com/traggo/server | 1633 | **GPL-3.0** ⚠️ | Go 50.1%（自托管） | 活跃：2026-07-31，v0.8.3 | 标签式手动时间追踪 | 参考实现 / 自托管服务 |
| pomolectron | https://github.com/amitmerchant1990/pomolectron | 638 | MIT ✅ | Electron/JS | **停滞**：last commit 2025-01-28，release 停在 2018 | 老式菜单栏番茄钟 | 不建议新项目 |
| **Moodist** | https://github.com/remvze/moodist | 3847 | **MIT** ✅ | Astro + React + TS 74.3% | 活跃：2026-09-06，v3.0.0 | **白噪音/环境音**（滴答「专注白噪音」） | **库/可直接嵌 Web**：MIT 最宽松，84 种环境音，可自托管 |
| Blanket | https://github.com/rafaelmardojai/blanket | 2131 | **GPL-3.0** ⚠️ | Python/GTK4 85.1% | 活跃：2026-09-04，0.8.0（2025-07-27） | 桌面环境音 | 参考实现（Linux 桌面） |
| Flowmodoro（小项目） | https://github.com/cod-md/Flowmodoro | 1 | **未核实**（仓库无 LICENSE 文件） | HTML | 停更：2025-06-13 | Flowmodoro 计时器概念验证 | 不建议依赖 |
| flowmodor | https://github.com/game-geek/flowmodor | 0 | AGPL-3.0 ⚠️ | TypeScript | 停更：2024-01-15 | Flowtime 技术 Web 实现 | 参考实现 |

**要点**
- **番茄钟本身没有技术壁垒**，真正的工程价值在「计时会话 ↔ 任务 ↔ 统计」的数据模型；`Super Productivity`（MIT）是唯一开源且完整覆盖这条链路的项目，建议作为**首要参考实现**。
- 滴答清单的「专注 + 白噪音」在开源侧由 `Moodist`（MIT）覆盖得最好；`Blanket` 是桌面 GTK 方案。
- **Focus To-Do、Pomofocus、Forest、Session 均非开源**（见 §11），不能复用代码，只能参考交互。
- 若产品闭源：计时器逻辑自研（1–2 人日量级），统计报表可参考 ActivityWatch（MPL-2.0，注意文件级 copyleft）。

---

## 4. 模块 3：四象限 / 艾森豪威尔矩阵视图

> 完整明细（22 个专用应用 + 其他视图库 + 许可雷区清单）见 `research/module3-eisenhower.md`；本节为结论浓缩版。

### 4.1 核心结论：四象限必须自研

- **「拿来即用的四象限组件库」在开源世界里基本不存在**：GitHub topic `eisenhower-matrix` 全量扫描后，star 最高的是 **919★ 的 Android 原生 App**（`Spikeysanju/Einsen`，Apache-2.0，但 2022 年后停更），第 2 名是 **243★ 的 Flutter App**（`Appaxaap/Focus`，GPL-3.0）；前 20 名**没有一个是可复用的 Web 组件库**。npm 搜 `eisenhower` / `priority-matrix` / `quadrant` 也没有可用组件包。
- **整机任务系统里没有「原生四象限」**：Vikunja / Planka / Focalboard / Kanboard / WeKan / Plane / Huly 只有看板 + 甘特 + 列表。`Super Productivity` 官网原话是 *"supports the Eisenhower Matrix through its customizable boards feature"*，即**通用看板配 4 列**，不是原生象限视图（此点已在 `research/module3-eisenhower.md` 中纠正了搜索摘要的说法）。
- **建议**：只自研「布局 + 象限归属规则 + 持久化」三层，拖拽交互直接用成熟库。

### 4.2 可复用清单（全部 2026-09-25 实测）

| 项目 | 仓库 | Star | License | 技术栈 | 活跃度 | 用途 |
|---|---|---|---|---|---|---|
| **dnd-kit** | https://github.com/clauderic/dnd-kit | **17667** | MIT ✅ | TS，React/Vue/Svelte | 活跃：2026-09-12 | **四象限拖拽底座首选**，配 CSS Grid 约 200–400 行跑通 |
| SortableJS | https://github.com/SortableJS/Sortable | 31183 | MIT ✅ | 原生 JS | 活跃 | 轻量拖拽替代方案 |
| **gsd-task-manager** | https://github.com/vscarpenter/gsd-task-manager | 26 | MIT ✅ | Next.js + TypeScript（含 MCP server） | **当天有提交**（2026-09-25） | 唯一「Web 栈 + MIT + 活跃 + 四象限原生」样板，可抄交互与数据模型 |
| todoist-matrix | https://github.com/harin/todoist-matrix | 2 | MIT ✅ | JavaScript | 停更（2018） | **架构范式最贴合**：给已有任务系统加「矩阵视图层」，不改数据层 |
| Einsen | https://github.com/Spikeysanju/Einsen | 919 | **Apache-2.0** ✅ | Kotlin / Jetpack Compose | 停更（2022-01） | Android 象限 UI 信息架构参考 |
| Focus | https://github.com/Appaxaap/Focus | 243 | **GPL-3.0** ⚠️ | Flutter / Dart | 活跃：2026-08-23，v2.2.8 | 离线优先四象限（GPL：只可读不可抄） |
| Zen. | https://github.com/jesusantguerrero/zen | 40 | GPL-3.0 ⚠️ | Vue 3 + Firebase | 2026-04-18 | 四象限 + 番茄钟 + GTD 整合的产品形态参考 |
| jarvis-ai-calendar | https://github.com/jilmiy/jarvis-ai-calendar | 19 | **未核实（根目录无 LICENSE 文件）** | Electron/JS | 2026-07-05 | 中文桌面日历 + 待办 + 四象限 + 倒计时 + AI 周报，**产品形态最接近滴答**（代码不可用） |
| FullCalendar | https://github.com/fullcalendar/fullcalendar | 20653 | MIT ✅ | JS | 活跃 | 日历视图（可复用） |
| schedule-x | https://github.com/schedule-x/schedule-x | 2585 | MIT ✅ | JS/TS | 活跃 | 现代日历视图替代 |
| frappe-gantt | https://github.com/frappe/gantt | 6127 | MIT ✅ | SVG/JS | 活跃 | 甘特图首选 |
| xpyjs/gantt | https://github.com/xpyjs/gantt | 351 | MIT ✅ | Canvas | 活跃 | 大数据量甘特 |
| Kaneo | https://github.com/kaneo-app/kaneo | 9186 | MIT ✅ | React + Hono | 活跃 | 现代技术栈看板（可参考多视图架构） |
| vis-timeline | https://github.com/visjs/vis-timeline | 2559 | **Apache-2.0 OR MIT 双许可**（原文核实）✅ | JS | 活跃 | 时间轴/时间盒视图 |

**许可雷区（务必回避）**：Planka（自定义 PLANKA Community License，禁止对第三方商业托管）、Focalboard（README 明写 "currently not maintained"，且源码 AGPL-3.0 / 商业许可双轨）、TaskView（Source-Available，禁止 SaaS 与竞品）、以及 6 个**根目录完全没有 LICENSE 文件**的四象限小项目（`jarvis-ai-calendar`、`erictherobot/eisenhower-matrix`、`DGSConsulting/priority-matrix-builder`、`kubarium/eisenhower-box`、`padey/Prioritize-Like-Ike`、`qshaiya/time-matrix-app`）——无授权＝默认保留全部权利，**一行都不能抄**。

---

## 5. 模块 4：日历 + CalDAV 同步

### 5.1 服务端（可自托管）

| 项目 | 仓库 | Star（2026-09-25 实测） | License（精确） | 技术栈 | 活跃度 | 说明 |
|---|---|---|---|---|---|---|
| Radicale | https://github.com/Kozea/Radicale | **5044** | **GPL-3.0** ⚠️（作为独立服务部署，不与闭源 App 链接） | Python 87.8% | 极活跃：2026-09-24，3.8.1（2026-09-25） | 最轻量 CalDAV/CardDAV 服务端，纯文件存储 |
| Baikal | https://github.com/sabre-io/Baikal | 3320 | **GPL-3.0** ⚠️ | PHP 87.1% | 活跃：2026-08-13，0.12.1 | 自带 Web 管理界面的 CalDAV/CardDAV 服务端 |
| sabre/dav | https://github.com/sabre-io/dav | 1723 | **BSD-3-Clause** ✅可嵌入 | PHP 99.0% | 活跃：2026-08-02，4.7.1 | CalDAV/CardDAV/WebDAV 框架（Baikal 的底座），BSD 允许闭源集成 |
| Xandikos | https://github.com/jelmer/xandikos | 607 | **GPL-3.0** ⚠️ | Python 98.6% | 活跃：2026-09-20，v0.4.7 | Git 后端 CalDAV/CardDAV |
| Nextcloud Tasks | https://github.com/nextcloud/tasks | 707 | **AGPL-3.0** ⚠️ | JS 82.1% | 极活跃：2026-09-24，v0.18.1 | Nextcloud 的 VTODO 应用（Web UI 参考） |
| Nextcloud Calendar | https://github.com/nextcloud/calendar | 1189 | **AGPL-3.0** ⚠️ | JS 72.1% | 极活跃：2026-09-25，v6.6.1 | 日历 Web UI 参考（RFC 5545/CalDAV） |
| DAViCal | https://gitlab.com/davical-project/davical | **未核实**（GitLab 页面实测 HTTP 200，未抓取 star/commit） | GPL（来源：官网/Wikipedia，**未读仓库 LICENSE 原文**）【未核实】 | PHP + PostgreSQL | 未核实 | 老牌 CalDAV 服务端，支持委派/空闲忙碌 |

### 5.2 客户端 App（参考实现）

| 项目 | 仓库 | Star | License | 技术栈 | 活跃度 | 说明 |
|---|---|---|---|---|---|---|
| Tasks.org | https://github.com/tasks/tasks | **5601** | **GPL-3.0** ⚠️ | Kotlin 96.0%（Compose Multiplatform，Android + macOS） | 极活跃：2026-09-24，15.12（2026-09-15） | 开源待办 App 事实标准；官方文档实测列出第三方同步：Google Tasks / Microsoft To Do / **DAVx⁵ / CalDAV** / EteSync / DecSync CC【文档：tasks.org/docs/sync】 |
| DAVx⁵ | https://github.com/bitfireAT/davx5-ose | 2897 | **GPL-3.0** ⚠️ | Kotlin 97.9% | 极活跃：2026-09-24，v4.5.20-beta.2-ose | Android 的 CalDAV/CardDAV/WebDAV 同步适配器（生态枢纽） |
| jtx Board | https://github.com/TechbeeAT/jtxBoard | 687 | **GPL-3.0** ⚠️ | Kotlin 100%（Jetpack Compose + **Glance 小组件**） | 活跃：2026-09-11，v2.17.03-beta01 | VTODO/VJOURNAL/VNOTE + DAVx⁵ 集成；**Android 小组件实现范本** |
| Fossify Calendar | https://github.com/FossifyOrg/Calendar | 2176 | **GPL-3.0** ⚠️ | Kotlin 98.7% | 极活跃：2026-09-24，1.11.0 | 带可定制小组件的 Android 日历 |
| Etar Calendar | https://github.com/Etar-Group/Etar-Calendar | 2603 | **GPL-3.0** ⚠️ | Java 95.5% | 活跃：2026-08-01，v1.0.57 | 经典开源 Android 日历 |
| EteSync Web | https://github.com/etesync/etesync-web | 266 | **AGPL-3.0** ⚠️ | TypeScript 97.4% | 低：2025-12-28 | 端到端加密的 CalDAV 风格同步客户端 | 
| Vikunja | https://github.com/go-vikunja/vikunja | 5503 | **AGPL-3.0** ⚠️ | Go 66.3% + Vue | 极活跃：2026-09-24，v2.6.0 | 任务系统自带 **CalDAV VTODO**（官方文档实测：early alpha，支持 SUMMARY/DUE/PRIORITY/RRULE(仅服务端→客户端)/VALARM 等）【文档：vikunja.io/help/caldav】 |

### 5.3 客户端库（可直接进产品）

| 项目 | 仓库 | Star | License | 技术栈 | 活跃度 | 集成方式 |
|---|---|---|---|---|---|---|
| **dav4jvm** | https://github.com/bitfireAT/dav4jvm | 104 | **MPL-2.0** ✅（文件级 copyleft，可进闭源 App） | Kotlin 100%（JVM/Android） | 极活跃：2026-09-24，4.1.0 | **Android/Kotlin 侧首选 CalDAV/WebDAV 库** |
| **tsdav** | https://github.com/natelindev/tsdav | 355 | **MIT** ✅ | TypeScript 99.6% | 极活跃：2026-09-19，v2.3.4（npm 实测 MIT） | Web / Node / React Native CalDAV+CardDAV 客户端 |
| ts-caldav | https://github.com/KlautNet/ts-caldav | 29 | **MIT** ✅（npm `ts-caldav` 元数据实测） | TypeScript 99.7% | 活跃：2026-08-23，v0.4.2 | 明确标注支持 React Native 的 CalDAV 客户端 |
| python-caldav | https://github.com/python-caldav/caldav | 412 | **Apache-2.0** ✅ | Python 96.4% | 极活跃：2026-09-21，v3.3.1 | 服务端/桌面端 Python 集成 |
| vdirsyncer | https://github.com/pimutils/vdirsyncer | 1880 | **BSD-3-Clause**（原文核实） ✅ | Python 98.6% | 活跃：2026-09-03，v0.21.0 | 日历/联系人双向同步 CLI |
| khal | https://github.com/pimutils/khal | 3056 | **MIT** ✅ | Python 99.8% | 活跃：2026-09-23，v0.14.1 | CLI 日历（参考） |
| todoman | https://github.com/pimutils/todoman | 597 | **ISC** ✅ | Python 99.5% | 中：2026-05-25，v4.7.0 | 标准 VTODO CLI 客户端（参考） |
| cdav-library | https://github.com/nextcloud/cdav-library | 73 | **AGPL-3.0** ⚠️ | JavaScript 99.3% | 活跃：2026-09-22，v2.8.0 | Nextcloud 的 CalDAV JS 库（AGPL 注意） |
| ical.js | https://github.com/kewisch/ical.js | 1179 | **MPL-2.0** ✅ | JavaScript 98.3% | 活跃：2026-09-17，v2.2.1 | RFC 5545 / RFC 6350 解析器（含 recurrence 迭代器） |
| libical | https://github.com/libical/libical | 366 | **MPL-2.0 或 LGPL-2.1 双许可**（LICENSE.txt 原文核实） | C 71.5% | 极活跃：2026-09-24，v4.0.5 | C/C++ 项目 |
| ical4j | https://github.com/ical4j/ical4j | 837 | **BSD-3-Clause** ✅ | Java 86.2% | 极活跃：2026-09-25，4.3.0 | JVM 侧 iCalendar 模型库 |

### 5.4 集成架构建议（CalDAV 路线）

- **协议是开放的**：CalDAV = **RFC 4791**、iCalendar = **RFC 5545**、CardDAV = **RFC 6352**、CalDAV 调度扩展 = **RFC 6638**、集合同步 = **RFC 6578**、服务发现 = **RFC 6764**、新属性 = **RFC 7986**（均已用 rfc-editor.org 原文核对编号与年份）。
- 推荐分层：**自研后端存任务（VTODO 语义）** + 暴露 CalDAV 端点（可用 `sabre/dav` 框架，BSD-3-Clause，可闭源集成）→ 移动端用 `dav4jvm`（Android）或 `tsdav`/`ts-caldav`（RN/Web）直连 → 桌面端用 `python-caldav` 或自研 WebDAV 客户端。
- **许可红线**：`Tasks.org`、`DAVx⁵`、`jtx Board`、`Radicale`、`Baikal`、`Nextcloud Tasks` 都是 GPL/AGPL，**不能把它们的代码链接进闭源 App**；作为独立服务部署（服务端）或作为参考实现（客户端）没有此问题。`sabre/dav`（BSD-3）、`dav4jvm`（MPL-2.0）、`tsdav`（MIT）、`python-caldav`（Apache-2.0）、`ical.js`（MPL-2.0）、`ical4j`（BSD-3）可以进闭源产品。
- **互操作红利**：走 CalDAV 可直接对接 Apple 日历/提醒事项、Thunderbird、Nextcloud、Fastmail、Radicale 自托管等，是替代品最现实的「生态入口」。

---

## 6. 模块 5：自然语言日期解析（NLP Dates）

> 完整明细（含每个仓库的实测行、中文支持证据、源码路径）见 `research/module5-nlp-dates.md`；本节为结论浓缩版。

### 6.1 分语言首选

| 语言/生态 | 首选 | Star（实测） | License | 活跃度 | 中文支持 |
|---|---|---|---|---|---|
| JS/TS | **wanasit/chrono（chrono-node）** | **5287** | MIT ✅ | 极活跃：2026-09-22，v2.10.1 | **有**：源码 `src/locales/zh/hans`（`ZHHansCasualDateParser` / `ZHHansTimeExpressionParser` / `ZHHansWeekdayParser`） |
| Python | **scrapinghub/dateparser** | 2862 | BSD-3-Clause ✅ | 极活跃：2026-09-23，1.4.3 | 官方文档列出 `zh` / `zh-Hans` / `zh-Hant` |
| Python（中文长尾） | **dongrixinyu/JioNLP** | 3870 | Apache-2.0 ✅ | 活跃：2026-07-29 | 最强：`jio.parse_time` 覆盖农历/节日/节气/模糊时间代词 |
| Go | **olebedev/when** | 1461 | Apache-2.0 ✅ | 活跃：2026-08-10 | **无中文**（规则包 en/common/ru） |
| Go（中文） | bububa/TimeNLP | 12 | Apache-2.0 ✅ | 2025-03-06 | 有（Time-NLP 的 Go 移植，star 极少需自测） |
| Java/Kotlin | **natty-parser/natty**（维护版） | 15 | MIT ✅ | 活跃：2026-09-15，1.1.4 | 无中文（原版 `joestelmach/natty` 529★ 已停更 2017） |
| Rust | **stevedonovan/chrono-english** | 60 | MIT ✅ | 活跃：2026-08-26，v0.2.1 | 无中文 |
| 多语种服务 | **facebook/duckling** | 4324 | **BSD-3-Clause**（LICENSE + cabal 原文核实）✅ | 半活跃：2026-03-15；release 停在 2021 | **有**：cabal 模块含 `Duckling.Time.ZH.CN/HK/MO/TW` |
| Ruby | mojombo/chronic | 3252 | MIT ✅ | 停更（2013 起无 release） | 无中文 |

### 6.2 中文专项结论

- **license 干净且仍在维护的中文方案只有两个**：`chrono` 的 zh locale（MIT）与 `JioNLP`（Apache-2.0）。
- **Time-NLP 系列有法律风险**：`zhanzecheng/Time_NLP`（521★，python3 版，停更 2020）与 `shinyke/Time-NLP`（660★，Java 原版，停更 2017）**仓库内均无 LICENSE 文件**（raw 404 已核实）→ 无授权即默认保留全部权利，**不可直接进商用产品**，只能当参考实现；`NagiYan/TimeNLP` 是 GPL-3.0（传染）。
- **系统原生能力有限**：iOS `NSDataDetector` 是系统能力（免费）但对「明天下午三点」这类相对表达通常解析不出；**Android 没有官方 NL 日期解析**（`android.text.format.DateUtils` 只做格式化/相对时间显示）。
- **是否必须接 LLM**：高频表达（明天/下周一/下午三点/每晚八点/in 2 hours）现成库可覆盖大部分，不必上 LLM；中文的先天难点是「上下文决定语义」与「时间基点不确定」，规则库无法根治。建议架构：**规则库（chrono / JioNLP）→ 未命中或低置信度 → LLM function-calling 出结构化 JSON（datetime + tz + rrule）→ 允许用户纠正**。
- **与 RRULE 的组合**：chrono 出 `DTSTART`、`rrule.js` 出 `RRULE`；生产级参考实现是 `Super Productivity`（MIT，`package.json` 实测依赖 `chrono-node`）。

---

## 7. 模块 6：重复任务 RRULE 引擎

| 项目 | 仓库 | Star（2026-09-25 实测） | License（精确） | 语言 | 活跃度 | 备注 |
|---|---|---|---|---|---|---|
| **rrule.js** | https://github.com/jkbrzt/rrule | **3744** | **BSD-3-Clause**（`package.json` + `LICENCE` 原文核实；GitHub 标签为 Other）✅ | TypeScript | **维护放缓**：2023-11-10，v2.7.2（2023-02-10） | JS/TS 事实标准；支持 RRuleSet/RDATE/EXDATE/EXRULE，`RRule.fromText()` 仅英文 |
| **python-dateutil** | https://github.com/dateutil/dateutil | 2636 | **Apache-2.0 或 BSD-3-Clause 双许可**（LICENSE 原文核实）✅ | Python | 活跃：2026-05-19，2.9.0（2024-03-01） | `dateutil.rrule` 是 Python 侧标准实现 |
| lib-recur | https://github.com/dmfs/lib-recur | 220 | **Apache-2.0** ✅ | Java 100% | **低频**：2024-04-07，0.17.1 | Android/JVM 的 recurrence 处理器（DAVx⁵ 生态在用） |
| rrule-go | https://github.com/teambition/rrule-go | 382 | **MIT** ✅ | Go 100% | 停更：2023-04-01，v1.8.2 | Go 侧标准实现 |
| rust-rrule | https://github.com/fmeringdal/rust-rrule | 95 | **Apache-2.0** ✅ | Rust 99.5% | 低频：2025-04-20，v0.10.0（2022-08-15） | Rust crate `rrule` |
| rrule（Dart/Flutter） | https://github.com/JonasWanke/rrule | 58 | **Apache-2.0** ✅ | Dart 99.8% | 活跃：2026-01-06，v0.2.18（pub.dev `rrule` 0.2.18） | Flutter 侧可用；pub.dev 元数据实测 |
| php-rrule | https://github.com/rlanvin/php-rrule | 711 | **MIT**（LICENSE 原文核实；GitHub 标签 Other）✅ | PHP 100% | 活跃：2026-07-29，v3.0.0 | PHP 侧（若后端用 PHP/sabre/dav） |
| ical.js（内含 recurrence） | https://github.com/kewisch/ical.js | 1179 | **MPL-2.0** ✅ | JavaScript | 活跃：2026-09-17，v2.2.1 | 解析 ICS 时顺带处理 RRULE，可与 rrule.js 二选一 |
| ical4j（内含 RRULE） | https://github.com/ical4j/ical4j | 837 | **BSD-3-Clause** ✅ | Java | 极活跃：2026-09-25，4.3.0 | JVM 全功能 iCalendar 模型 |
| rSchedule | https://github.com/jorroll/rschedule | 44 | **Unlicense** ✅（canonical 仓库在 GitLab，GitHub 为镜像） | TypeScript | 停更：2023-07-19，v1.2.3 | 时区友好的替代实现（Date/Moment/luxon/dayjs 无关设计） |
| ICAL.NET | https://github.com/rianjs/ical.net | 975 | **未核实**（GitHub 标签 `NOASSERTION (Other)`，本次未在仓库根找到标准 LICENSE 文件） | C# 100% | 活跃：2026-09-16，v5.2.3 | .NET 侧 iCalendar（含 recurrence） |

**要点**
- RRULE 是**标准化程度最高**的模块（RFC 5545 §3.3.10 / §3.8.5），各语言都有成熟实现，**强烈建议直接依赖，不要自研**。
- 选型时唯一要留意的是**时区与 DST 语义**（`RRuleSet` / `tzid` 处理）：JS 侧 `rrule.js` 官方文档明确提示时区需要自行结合 `Intl`/`luxon`；若产品强依赖跨时区重复，`ical.js`（MPL-2.0）或 `rSchedule`（Unlicense）值得做对照测试。
- 与模块 5 的衔接：自然语言解析产出 `DTSTART` + 人类可读重复描述，再由本模块产出 `RRULE` 字符串入库，实现「说人话建重复任务」。

---

## 8. 模块 7：跨端框架与本地优先同步引擎

> 完整明细（40+ 项目、逐条 license 原文摘录、证据分级）见 `research/module7-sync-engines.md`；本节为结论浓缩版。所有 Star 为 2026-09-25 实测，License 均读 LICENSE 原文确认。

### 8.1 三类归因（决策视图）

#### A 类：完全开源可商用，可直接嵌入闭源商业产品

| 项目 | 仓库 | Star | License | 定位 | 关键事实 |
|---|---|---|---|---|---|
| **Yjs** | https://github.com/yjs/yjs | 22842 | **MIT**（原文；GitHub 显示 NOASSERTION 属解析误报）✅ | CRDT 引擎（最成熟生态） | 2026-09-23 v13.6.33，极活跃 |
| **Loro** | https://github.com/loro-dev/loro | 6167 | **MIT** ✅ | 高性能 CRDT（Rust 核心 + WASM/Swift/Kotlin 绑定） | 2026-09-21，活跃 |
| **Automerge** | https://github.com/automerge/automerge | 6615 | **MIT** ✅ | JSON-like CRDT（历史/分支模型强） | 2026-09-24，活跃 |
| **Hocuspocus** | https://github.com/ueberdosis/hocuspocus | 2600 | **MIT** ✅ | 生产级 Yjs WebSocket 后端（持久化/Redis/Webhook/S3） | 2026-09-22 v4.7.0；**自托管免费商用**，只有 Tiptap 协作云才收费 |
| y-websocket / y-indexeddb / y-protocols / y-prosemirror | https://github.com/yjs/y-websocket 等 | 714 / 281 / 163 / 467 | **MIT** ✅ | Yjs 配套连接器与持久化 | 均活跃（y-leveldb 已归档） |
| **Electric** | https://github.com/electric-sql/electric | 10370 | **Apache-2.0** ✅ | Postgres **只读下行**同步（Shapes + HTTP API） | ⚠️ **不是双向 CRDT**，写路径需自研；「license 随版本变化」的说法**未获证实**（新旧仓库均为 Apache-2.0 全文） |
| **Zero / Replicache（rocicorp/mono）** | https://github.com/rocicorp/mono | 3392 | **Apache-2.0** ✅ | 双向同步引擎 + zero-cache 服务端 | Zero 仍为 canary（v1.11.0-canary.13）；Replicache 已并入同仓、官方宣布**不再收费 + 维护模式** |
| **Evolu** | https://github.com/evoluhq/evolu | 1899 | **MIT** ✅ | E2EE + SQLite + CRDT | 活跃 |
| **cr-sqlite** | https://github.com/vlcn-io/cr-sqlite | 3800 | **MIT** ✅ | 收敛型复制 SQLite 扩展 | 提交活跃但 release 停在 2024-01 |
| **SQLSync** | https://github.com/orbitinghail/sqlsync | 2915 | **Apache-2.0** ✅ | SQLite 协作/离线封装（Rust+WASM） | ⚠️ 最后提交 2025-11-19，需观察 |
| **LiveStore** | https://github.com/livestorejs/livestore | 3715 | **Apache-2.0** ✅ | 响应式 SQLite + 内置同步 | ⚠️ 版本仍 0.5.0-dev |
| **TinyBase** | https://github.com/tinyplex/tinybase | 5177 | **MIT** ✅ | 响应式 store + 可接 Yjs/Automerge | 无自家付费云 |
| **InstantDB** | https://github.com/instantdb/instant | 10522 | **Apache-2.0** ✅ | 全栈后端 + 实时同步（可自托管） | 官方云为付费托管 |
| **Jazz** | https://github.com/garden-co/jazz | 196 | **MIT** ✅（仅官网字体例外） | local-first 关系库 | 2.0 alpha |
| **WatermelonDB** | https://github.com/Nozbe/WatermelonDB | 11786 | **MIT** ✅ | RN 高性能本地库 | ⚠️ **本身不含同步**，需自建协议 |
| **RxDB** | https://github.com/pubkey/rxdb | 23391 | **Apache-2.0（核心）+ Premium 插件商业许可** ⚠️ | local-first DB + 复制协议 | 核心免费；性能/加密/存储插件在付费墙后，**授权到期不得继续用** |
| **PouchDB + Apache CouchDB** | https://github.com/pouchdb/pouchdb / https://github.com/apache/couchdb | 17615 / 6963 | **Apache-2.0** ✅ | 经典主从复制组合 | 成熟稳定 |
| **Kinto** | https://github.com/Kinto/kinto | 4418 | **Apache-2.0** ✅ | 通用 JSON 文档存储 + 客户端同步（Mozilla） | 活跃 |
| Realm Core / realm-swift | https://github.com/realm/realm-core / realm-swift | 1052 / 16612 | **Apache-2.0** ✅ | 端侧数据库 | ⚠️ **Atlas Device Sync 已于 2025-09-30 EOL**，只剩本地存储 |
| PowerSync **客户端 SDK**（JS/Swift/.NET） | https://github.com/powersync-ja/powersync-js 等 | 724 / 62 / 51 | **Apache-2.0** ✅ | 客户端库 | ⚠️ 仅客户端；服务端另有条款；**Kotlin SDK 无 LICENSE 文件**（见下） |
| TanStack DB | https://github.com/tanstack/db | 3917 | MIT ✅ | 响应式客户端 store | 存储层，非同步引擎 |

#### B 类：copyleft / 需隔离

| 项目 | License | 风险点 |
|---|---|---|
| Triplit | **AGPL-3.0-only** ⚠️ | 嵌入闭源 SaaS 触发网络条款源码披露义务；且最后提交 2025-09-11（疑似停滞） |
| Nextcloud Server / Radicale | AGPL-3.0 / GPL-3.0 ⚠️ | 自托管自用可以；**修改后对外提供网络服务须开源修改** |
| Liveblocks 服务端组件 | **AGPL-3.0-or-later**（客户端 Apache-2.0）⚠️ | 服务端必须隔离或不用 |
| ObjectBox | 绑定 Apache-2.0，**native 引擎是 ObjectBox Binary Licence**，Gradle 插件 GPL-3.0 ⚠️ | 真正跑数据的引擎是二进制专有许可 |
| AFFiNE | 前端 MIT，`packages/backend` 为 **EE License**（生产须订阅）⚠️ | 自建其后端绕过订阅有法律风险 |
| Couchbase Lite iOS 3.x | Apache-2.0（但 **4.x core 是 BSL 1.1**）⚠️ | 必须锁版本核对依赖树 |

#### C 类：商业授权 / source-available（不适合作为闭源商业产品核心依赖）

| 项目 | License | 关键限制（原文摘录要点） |
|---|---|---|
| **PowerSync Service** | **FSL-1.1-ALv2** ❌ | 禁止 **"Competing Use"**（提供替代或实质相似功能的产品/服务）；发布满 **2 年**后才自动转 Apache-2.0 |
| **Couchbase Lite Core 4.x** | **BSL 1.1** ❌ | 禁止商用衍生物与 "as-a-service" 托管；**Change Date 2029-05-01** 才转 Apache-2.0 |
| **sqlite-sync（SQLite Cloud）** | **Elastic License 2.0 修改版** ❌ | **禁止修改/替换/自实现 Network Layer**，禁止向第三方提供 managed service；非开源项目商用需商业授权 |
| **Ditto** | **Ditto Binary License**（专有）❌ | 纯专有二进制，禁止反向工程，**无开源核心** |
| **ObjectBox Sync** | 商业订阅 ❌ | 自托管也需付费授权 |
| PowerSync **Kotlin SDK** | **无 LICENSE 文件** ❓ | 无授权声明＝默认保留全部权利；同厂商 Swift/.NET 均为 Apache-2.0（疑遗漏），但**法律上必须书面确认** |
| MongoDB Atlas Device Sync | 已 EOL ❌ | 2025-09-30 停止服务 |

### 8.2 给本项目的选型建议

1. **最干净的路线（推荐）**：**Yjs 或 Loro + 自建 Hocuspocus/y-websocket**。全链路 MIT，可闭源商用、可自建、可托管给用户；冲突合并由 CRDT 天然解决。代价：自研任务实体的 CRDT schema、服务端鉴权/配额/快照压缩。
2. **次选**：**Electric（Apache-2.0，只读下行）+ 自研写路径**，或 **Zero（Apache-2.0，双向）**——后者 API 仍是 canary，需 4–8 周 PoC 验证离线重放与冲突收敛。
3. **另一条务实路线**：**CalDAV 作为同步层**（见 §5），把「多端同步」问题转化为「标准协议 + 服务端」问题，规避自研 CRDT 的复杂度（代价是冲突语义弱于 CRDT）。
4. **明确规避**：`sqlite-sync`、`Couchbase Lite 4.x`、`Triplit`（AGPL）作为闭源 SaaS 核心；`Ditto`/`ObjectBox Sync`/`PowerSync 商业版`（持续付费且条款随厂商变动）。
5. **注意**：`PowerSync` 若使用，客户端 SDK（Apache-2.0）可放心，但**服务端 FSL 的 "Competing Use" 定义可能正好覆盖「给用户提供一个滴答清单 SaaS」这件事本身**——需法务判定。
6. **反直觉但重要**：CRDT 不是唯一答案。滴答清单这类「单人为主 + 少量共享清单」的场景，**服务端权威 + LWW（最后写入胜出）+ 操作日志**往往比 CRDT 更简单可靠；CRDT 的价值在「离线长周期编辑 + 复杂协作」。

---

## 9. 模块 8：小组件 / 原生移动端 / 跨端框架

### 9.1 跨端框架本体（2026-09-25 实测）

| 框架 | 仓库 | Star | License（精确） | 技术栈 | 说明 |
|---|---|---|---|---|---|
| Flutter | https://github.com/flutter/flutter | **179081** | **BSD-3-Clause** ✅ | Dart 74.9% | 一套代码 → Android/iOS/Windows/macOS/Linux/Web；**小组件需插件 + 原生代码** |
| React Native | https://github.com/facebook/react-native | **126724** | **MIT** ✅ | C++/JS | JS/TS → 原生控件；生态最大；**小组件需原生扩展** |
| Tauri | https://github.com/tauri-apps/tauri | **111382** | **Apache-2.0 OR MIT 双许可**（`Cargo.toml` 原文 `license = "Apache-2.0 OR MIT"`，LICENSE-MIT + LICENSE-APACHE-2.0 均存在）✅ | Rust 81.4% | 桌面体积小；2.0 起支持移动端 |
| Capacitor | https://github.com/ionic-team/capacitor | 16724 | **MIT** ✅ | TypeScript | Web 应用包装为原生 App（Super Productivity 移动端走这条路） |
| Jetpack Compose / androidx | https://github.com/androidx/androidx | 6100 | **Apache-2.0** ✅ | Kotlin 69.6% | Android 原生（**Glance 小组件**所在仓库） |

### 9.2 小组件能力（跨端框架无法覆盖的「税收」）

| 平台 | 方案 | 仓库 / 类型 | Star | License | 说明 |
|---|---|---|---|---|---|
| Android | **Glance（Jetpack）** | https://github.com/androidx/androidx（`glance` 模块） | 6100（整仓） | **Apache-2.0** ✅ | 用 Compose 风格写 AppWidget，官方推荐 |
| Android | **react-native-android-widget** | https://github.com/sAleksovski/react-native-android-widget | 897 | **MIT** ✅ | 用 React Native 写 Android 小组件 |
| Flutter | **home_widget** | https://github.com/ABausG/home_widget | 975 | **BSD-3-Clause** ✅（LICENSE 位于 `packages/home_widget/LICENSE`，原文核实：三条款 BSD） | Flutter ↔ 原生小组件桥（Android/iOS） |
| iOS / Expo | expo-apple-targets（`@bacons/apple-targets`） | https://github.com/EvanBacon/expo-apple-targets | 1389 | **未核实：仓库根目录无 LICENSE 文件**（`LICENSE`/`.md`/`.txt` 均 404） | Config Plugin 生成 Apple target（Widget/Live Activity/Watch/Safari 扩展） |
| iOS / macOS | **WidgetKit + SwiftUI** | 系统能力（Apple SDK） | — | 随 SDK | 小组件必须写 Swift，无跨端替代 |
| 桌面 | 托盘/菜单栏（Tauri / Electron 原生 API） | 案例：Pomotroid（Tauri）、Tomatez（Electron）、TomatoBar（Swift） | — | — | 桌面「小组件」等价物是菜单栏/托盘 |

### 9.3 待办 / 习惯类真实案例（技术选型证据）

| 项目 | 仓库 | Star | License | 技术栈 | 覆盖平台 | 借鉴点 |
|---|---|---|---|---|---|---|
| **Tasks.org** | https://github.com/tasks/tasks | 5601 | GPL-3.0 ⚠️ | Kotlin + **Compose Multiplatform** | Android + macOS | **同一套 Compose 代码出 Android + 桌面**；CalDAV 同步 |
| **mhabit** | https://github.com/FriesI23/mhabit | 1596 | **Apache-2.0** ✅ | Flutter / Dart | Android/iOS/Windows/macOS/Linux | **全平台 + WebDAV 同步 + 小组件**，许可最宽松 |
| jtx Board | https://github.com/TechbeeAT/jtxBoard | 687 | GPL-3.0 ⚠️ | Kotlin/Compose + **Glance** | Android | Glance 小组件 + CalDAV VTODO 实战 |
| Tomato | https://github.com/nsh07/Tomato | 1467 | GPL-3.0 ⚠️ | **Kotlin Multiplatform** | Android + Desktop | KMP + Material 3 + 小组件 + 专注统计 |
| AppFlowy | https://github.com/AppFlowy-IO/AppFlowy | 76916 | AGPL-3.0 ⚠️ | Flutter + Rust | 全平台 | Flutter 实现看板/日历/网格多视图 |
| Notesnook | https://github.com/streetwriters/notesnook | 14636 | GPL-3.0 ⚠️ | React Native + Electron | 全平台 | RN 移动 + Electron 桌面同构 + E2EE |
| Joplin | https://github.com/laurent22/joplin | 56479 | AGPL-3.0（server 专有）⚠️ | React Native + Electron | 全平台 | 多后端同步（WebDAV/S3/Nextcloud）实践 |
| **Super Productivity** | https://github.com/johannesjo/super-productivity | 22240 | **MIT** ✅ | Angular + Electron + **Capacitor** | 桌面 + 移动 | 一套 Web 代码 + Capacitor 上移动端 |
| Pomotroid | https://github.com/Splode/pomotroid | 5517 | MIT ✅ | Rust + **Tauri** | 桌面 | Tauri 桌面样板 |
| Pomatez | https://github.com/roldanjr/pomatez | 4901 | MIT ✅ | Electron | 桌面 | Electron 样板 |
| Habitica Android | https://github.com/HabitRPG/habitica-android | 1821 | GPL-3.0 ⚠️ | Kotlin | Android + **Wear OS**（topics 含 `wearos`） | 手表端实践（开源侧少见） |

### 9.4 选型结论

1. **小组件是跨端框架的「税收」**：无论选 Flutter 还是 RN，Android 小组件要用 Glance 或 `react-native-android-widget`，iOS 小组件必须写 SwiftUI/WidgetKit。**预算里必须单列原生工作量**（通常 1–3 人周/端）。
2. **若要「一份代码覆盖最多平台 + 小组件」**：`Flutter + home_widget（BSD-3-Clause）` 是现实解，`mhabit`（Apache-2.0）已证明可行。
3. **若团队是 Web 栈**：`React Native`（MIT）+ `react-native-android-widget`（MIT）+ SwiftUI 小组件；桌面复用 `Electron` 或 `Tauri`。
4. **若追求 Android 原生体验与系统集成**：`Kotlin + Compose + Glance`（Tasks.org 路线），代价是 iOS 需另写一套。
5. **桌面优先**：`Tauri`（Apache-2.0 OR MIT，体积小）或 `Electron`（生态成熟）；参考 Pomotroid / Pomatez。
6. **许可提示**：`Tasks.org`、`jtx Board`、`Tomato`、`AppFlowy`、`Notesnook`、`Joplin` 均为 GPL/AGPL，**只能作为参考实现或独立服务**，不可把代码链接进闭源 App；可直接进闭源产品的只有 `mhabit`（Apache-2.0）、`Super Productivity`（MIT）、`home_widget`（BSD-3）、`react-native-android-widget`（MIT）。

---

## 10. 加分项：任务核心与整体参考实现（可少走弯路）

> 这些不是「单点组件」，而是**已经把这些模块组装起来**的项目；做替代品时用来对照数据模型与交互最省时间。全部数据 2026-09-25 实测。

| 项目 | 仓库 | Star | License | 技术栈 | 活跃度 | 借鉴价值 |
|---|---|---|---|---|---|---|
| **Super Productivity** | https://github.com/johannesjo/super-productivity | 22240 | **MIT** ✅ | TypeScript/Angular/Electron | 极活跃：2026-09-24，v19.1.0 | 任务 + 番茄 + Flowmodoro + 时间追踪 + 习惯 + 本地优先，**MIT 许可下最完整的对标物** |
| Vikunja | https://github.com/go-vikunja/vikunja | 5503 | AGPL-3.0 ⚠️ | Go + Vue | 极活跃：2026-09-24，v2.6.0 | 自托管任务系统（清单/标签/优先级/提醒/CalDAV VTODO/看板），后端数据模型参考 |
| AppFlowy | https://github.com/AppFlowy-IO/AppFlowy | 76916 | AGPL-3.0 ⚠️（客户端） | Flutter + Rust | 中等：2026-06-26，v0.14.5（2026-09-25） | Flutter 跨端 + 看板/日历/网格视图的 UI 参考 |
| Logseq | https://github.com/logseq/logseq | 45053 | AGPL-3.0 ⚠️ | Clojure/ClojureScript | 极活跃：2026-09-24 | 大纲式任务 + 本地优先 + 插件生态 |
| Joplin | https://github.com/laurent22/joplin | 56479 | **AGPL-3.0-or-later**，但 `packages/server` 为 **Joplin Server Personal Use License**（专有）（LICENSE 原文核实）⚠️ | TypeScript/Electron/React Native | 极活跃：2026-09-25，v3.7.18 | 跨端同步（WebDAV/Nextcloud/S3）+ 待办（`- [ ]`）实践 |
| SiYuan | https://github.com/siyuan-note/siyuan | 46493 | AGPL-3.0 ⚠️ | TypeScript/Go | 极活跃：2026-09-22 | 本地优先 + 自托管同步 |
| Notesnook | https://github.com/streetwriters/notesnook | 14636 | GPL-3.0 ⚠️ | TypeScript/React Native | 活跃：2026-09-18 | RN + Electron 跨端 + E2EE 同步架构 |
| Taskwarrior | https://github.com/GothenburgBitFactory/taskwarrior | 6086 | **MIT** ✅ | C++ | 极活跃：2026-09-25，v3.5.0 | 任务数据模型/过滤表达式/URGENCY 算法（MIT 可借鉴） |
| topydo | https://github.com/topydo/topydo | 941 | GPL-3.0 ⚠️ | Python | 活跃：2026-09-16，0.16 | todo.txt 语义（`pri:A due:2026-09-30 rec:1w`）与过滤 DSL |
| Kanboard | https://github.com/kanboard/kanboard | 9883 | **MIT** ✅ | PHP | 活跃：2026-09-11，1.2.54 | 看板/泳道/筛选（MIT） |
| WeKan | https://github.com/wekan/wekan | 21094 | **MIT**（LICENSE 原文为纯 MIT）✅ | JavaScript/Meteor | 极活跃：2026-09-25，v12.01 | 看板 + 卡片 + 协作 |
| Planka | https://github.com/plankanban/planka | 12579 | **自定义**：PLANKA Community License 1.1 + 商业许可（LICENSE.md 原文核实）⚠️ | JavaScript | 活跃：2026-09-17，v2.2.1 | 看板 UI；**非标准开源许可，商用前必须读条款** |
| Focalboard | https://github.com/mattermost/focalboard | 26486 | **混合**：Mattermost 编译版 MIT；源码 AGPL-3.0 + 例外，或购买商业许可（LICENSE.txt 原文核实）⚠️ | TypeScript/Go | **已停维护**：2025-06-11，v8.0.0（2024-06-17） | 多视图（看板/表格/日历）设计参考 |
| todo.txt 格式 | https://github.com/todotxt/todo.txt | 3407 | GPL-3.0 ⚠️（文档仓库） | 文档 | 2026-06-28 | 纯文本互操作格式（导入/导出兼容） |

**要点**
- **MIT 许可的完整对标物只有 Super Productivity**；其余成熟任务系统几乎都是 AGPL/GPL，闭源产品只能「参考设计与数据模型」，不能抄代码。
- 如果目标是「自研替代品 + 可商用」，**最稳的组合**是：Super Productivity 的数据模型/交互 + mhabit 的习惯模块 + CalDAV 互操作 + 自研同步层 + 自研 UI。

---

## 11. 非开源但可参考的产品设计

> 说明：本节只做**功能结构与交互模式的描述**，用于产品设计参考；**不涉及复制其素材、图标、文案或代码**。

### 11.1 滴答清单（TickTick）本身

| 维度 | 事实性描述 | 来源 |
|---|---|---|
| 功能矩阵 | 官网列出：持续提醒、重复提醒、**智能识别（自然语言时间识别）**、过滤器（自定义筛选条件）、键盘快捷键/指令菜单、共享协作（共享清单+指派）、导入与关联（订阅日历、关联 Notion 等）、**数据统计（任务完成/专注时长/习惯记录）**、40+ 主题 | 【文档】ticktick.com（中文站首页，2026-09-25 抓取） |
| 平台 | 官方称支持「手机、电脑、平板、手表」全平台实时同步 | 【文档】同上 |
| 中文版 | Chrome 应用商店页面描述：清单分类/优先级/标签、列表模式创建子任务、日历视图安排计划、与家人朋友共享协作 | 【文档】chromewebstore.google.com 滴答清单扩展页 |
| 常见模块划分 | 清单 / 智能清单 / 日历 / 四象限 / 番茄钟（含白噪音）/ 习惯打卡 / Karma / 共享清单 / 专注统计 / 小组件 | 【文档】官网+帮助中心（模块名称为产品公开功能，具体结构以官方为准） |

### 11.2 同类闭源产品（可参考的设计点）

| 产品 | 定位 | 值得参考的设计点 | 开源？ |
|---|---|---|---|
| Todoist | 任务管理 | 行内自然语言输入（"明天下午3点 交报告"）、过滤器 DSL、Karma 游戏化 | 闭源 |
| Things 3 | 个人 GTD | 极简信息层级、日期/清单/区域三段式、动效 | 闭源 |
| OmniFocus | 重度 GTD | 透视（Perspective）自定义视图、审查（Review）机制 | 闭源 |
| Microsoft To Do | 轻量清单 | 「我的一天」（My Day）每日聚焦、步骤（子任务） | 闭源 |
| Apple 提醒事项 | 系统级 | 系统集成、位置/时间提醒、Siri 自然语言、小组件 | 闭源（但可走 CalDAV 互操作） |
| Structured | 时间轴日程 | 时间轴可视化（时间盒） | 闭源 |
| Sunsama | 每日计划 | 每日规划仪式（Daily Planning）+ 任务时间估算 | 闭源 |
| Focus To-Do | 番茄+任务 | 番茄钟与任务列表的强绑定、白噪音、统计 | 闭源（用户常问的开源替代：Goodtime / Tomato / Super Productivity） |
| Forest | 专注 | 游戏化专注（种树）、失败惩罚机制 | 闭源 |
| Pomofocus | Web 番茄钟 | 极简 Web 计时器、任务清单 + 预估番茄数 | 闭源（开源克隆多为玩具级，如 `usmansbk/usman-pomofocus-clone` 104★ 无 LICENSE、`0xrushi/PomoHub` 4★ MIT） |
| Session | 专注 | 专注会话 + 应用屏蔽 + 报表 | 闭源 |
| Obsidian | 笔记 | 插件生态、双向链接（本体闭源） | 闭源（插件生态开源） |

**可用替代的开源 UI 底座**：`shadcn/ui`（MIT）、`Radix UI`（MIT）、Material 3 / Jetpack Compose（Apache-2.0）、Flutter Material 3（BSD-3-Clause）、`Ark UI` 等——**自研 UI 时用这些，避免「长得像滴答」**。

---

## 12. 法律与合规提醒（中立事实性说明，**不构成法律意见**）

> 以下仅为可核实的事实与条文/条款摘录，具体案件请咨询执业律师。

### 12.1 商标（Brand / Trademark）

- `TickTick` / `滴答清单` 由 Appest Inc. 运营（官网与 Chrome 扩展页开发者信息均为 ticktick.com）【文档】。
- TickTick 服务条款明确：「These terms do not grant you the right to use any branding or logos used in our Services.」——即**使用其服务不获得任何品牌/Logo 使用授权**（原文摘录，来自 `https://ticktick.com/tos?language=en_us`，2026-09-25 抓取）。
- **本次未核实项**：未在中国商标网（CNIPA）或 USPTO 数据库完成「TickTick / 滴答清单 / Appest」的注册号与类别检索（本机未访问相应检索系统）。**如需结论，必须做正式商标检索**。

### 12.2 界面 / 外观设计（UI Look & Feel）

- 中国自 **2014-05-01** 起对含图形用户界面（GUI）的产品外观设计给予专利保护；但《专利审查指南》坚持「GUI 不得与产品分离」，申请需提交**整体产品外观设计视图**（来源：知识产权实务文章，2026-09-25 抓取）【文档】。
- 实务中曾出现「国内首例 GUI 外观设计专利侵权案」（奇虎诉江民案，北京知识产权法院）：法院认为涉案专利是「电脑产品上的外观设计」，而被告提供的是**软件**，与电脑不属于相同/相近种类产品，故不构成侵权；后续「金山诉萌家案」的裁判思路有所变化（来源：同上文章）【文档】。**结论是：GUI 外观设计的可执行性在中国司法实践中仍有争议，但风险并非为零。**
- 著作权层面：UI 的**具体图标、插画、文案、动效素材**通常受著作权保护；**抽象布局、配色风格、交互范式**一般不受著作权保护。**复制素材/图标/文案的风险远高于「风格相似」。**
- 实操建议（中立描述）：自研 UI、使用开源设计系统、不使用对方图标与文案、不做像素级复刻，是行业常见做法。

### 12.3 服务条款与数据抓取（ToS / Scraping）

- TickTick ToS 原文（2026-09-25 抓取，`https://ticktick.com/tos?language=en_us`）关键条款：
  - 「You may not copy, modify, distribute, sell, or lease any part of our Services or included software, nor may you reverse engineer or attempt to extract the source code of that software, unless laws prohibit those restrictions or you have our written permission.」
  - 「Using our Services does not give you ownership of any intellectual property rights in our Services or the content you access. You may not use content from our Services unless you obtain permission from its owner or are otherwise permitted by law.」
  - **事实性说明**：本次抓取的通用 ToS 中**未出现**显式的 "scrape / crawl / automated access" 禁止条款；但上述「不得复制/修改/分发/逆向」条款与各平台（App Store / Google Play）开发者条款、以及反不正当竞争法的一般规定，仍可能覆盖「批量抓取数据或逆向接口」的行为。**若要做数据迁移，应使用官方导出功能或用户授权，而不是抓取。**
- 同类产品（Todoist、Microsoft、Apple 等）的 ToS 普遍含禁止自动化访问/逆向的条款（本次仅核实了 TickTick 原文，其余未逐条核实）【未核实】。

### 12.4 开源许可证合规（与本报告直接相关）

| 许可类型 | 本报告中的项目 | 事实性说明 |
|---|---|---|
| MIT / BSD-3 / Apache-2.0 / ISC / Unlicense | mhabit、beaverhabits、Super Productivity、rrule.js、dateutil、chrono、duckling、tsdav、python-caldav、lib-recur、rrule-go、rust-rrule、taskwarrior、Kanboard、WeKan、Moodist、ActivityWatch（MPL-2.0）等 | 宽松许可，可闭源商用；需保留版权与许可声明 |
| MPL-2.0 | dav4jvm、ical.js、libical | **文件级** copyleft：可闭源调用，但**修改过的 MPL 文件必须公开源码** |
| GPL-3.0 | Loop Habit Tracker、Habitica（代码）、Tasks.org、DAVx⁵、jtx Board、Goodtime、Tomato、Radicale、Baikal、Xandikos、Planka（自定义）、Joplin（主体 AGPL）等 | 强 copyleft：**链接进闭源 App 通常违反许可**；作为独立进程/服务、或仅作参考实现，一般可行（仍建议法务确认） |
| AGPL-3.0 | Nextcloud Tasks/Calendar、Vikunja、AppFlowy 客户端、Logseq、HabitTrove、cdav-library、EteSync | 比 GPL 更严：**通过网络提供服务**也可能触发「向用户提供源码」义务 |
| 自定义 / 混合 / 专有 | Planka（Community License + 商业版）、Focalboard（MIT 编译版 / AGPL 源码 / 商业许可三轨）、Joplin Server（Personal Use License）、Habitica 素材（CC-BY-NC-SA，**非商业**） | **必须逐条读原文**，不能按「开源」一概而论 |

### 12.5 数据可携带与互操作（事实性条文）

- **GDPR 第 20 条**（数据可携带权，Right to data portability）：数据主体有权以结构化、通用、机器可读格式获取其提供的个人数据并转移至其他控制者（欧盟法规）。
- **中国《个人信息保护法》第 45 条**：个人有权查阅、复制其个人信息；并规定「个人信息处理者应当提供转移的途径」（2021-11-01 施行）。
- **互操作是合规的加分项**：支持 `CalDAV`（RFC 4791）、`iCalendar`（RFC 5545）、`todo.txt`（纯文本）等开放格式的导入导出，既降低用户迁移成本，也对应上述可携带权要求。
- **注意**：以上条文引用为公开法律文本的概括，**未逐字核对最新修订版本**；具体适用需律师判断【文档/未逐字核实】。

---

## 13. 未核实清单（诚实披露）

| 项 | 状态 | 说明 |
|---|---|---|
| TickTick / 滴答清单 商标注册号与类别 | **未核实** | 未访问 CNIPA/USPTO 检索系统；仅核实到 ToS 中「不授予品牌使用授权」的条款原文 |
| DAViCal 的 star / 最后提交 / LICENSE 原文 | **未核实** | 仓库在 GitLab（`gitlab.com/davical-project/davical` 实测 HTTP 200），本次只从官网/Wikipedia 得到「GPL」 |
| ICAL.NET（rianjs/ical.net）的精确 License | **未核实** | GitHub 标签为 `NOASSERTION`，本次未在仓库根定位到标准 LICENSE 文件 |
| EteSync 服务端仓库（`etesync/etesync-server` 等） | **未核实** | 尝试的路径 404；只核实到 `etesync/etesync-web`（AGPL-3.0，266★） |
| SmartDateParser（Android 第三方 NL 解析） | **未核实** | 未核到可靠仓库 |
| `chronotope/chrono`（Rust 基础库）star | **未核实** | 与「NL 解析」不是同一层，未纳入 |
| Pomello、Focus To-Do 的开源状态 | **未核实** | 搜索到 `Pomelloapp/pomello` 路径 404；Focus To-Do 按官网信息为闭源商业产品 |
| HabitTrove 在 GitHub Topics 页显示的 286★ 版本 | **未核实** | Topics 页描述与 `dohsimpson/HabitTrove`（683★）不一致，未定位到该 286★ 仓库的准确 slug |
| 各类 ToS 中「自动化访问/爬取」条款 | **部分核实** | 只逐字核实了 TickTick 通用 ToS；其他产品未逐条核实 |
| 本报告中所有 `【未核实】` 标注项 | — | 均不应作为决策依据，需二次核实 |

---

### 附：本报告使用的自建工具

- `research/ghinfo.py` — GitHub 事实抓取脚本（stars / forks / license / archived / last commit / latest release / top language / description / topics），用法：`python3 research/ghinfo.py owner/repo [owner/repo ...]`。
- 并行调研明细：`research/module5-nlp-dates.md`、`research/module3-eisenhower.md`、`research/module7-sync-engines.md`、`research/module8-crossplatform-legal.md`。
