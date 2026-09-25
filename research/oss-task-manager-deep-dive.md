# 开源任务管理项目深度调研（滴答清单替代底座选型）

> 核实时间：**2026-09-25**（CST）
> 核实方式：`curl` 直取 github.com 仓库页 / `commits/<branch>.atom` 提交流 / `raw.githubusercontent.com` 的 LICENSE 与包清单原始文件；辅以 web 搜索交叉验证。**所有 star 数、License、最近提交时间均为当日从 GitHub 页面/原始文件实测**，未凭记忆。
> 本机 `web_fetch` 对 github.com 报 "non-public IP"（fake-IP DNS），故改走 `curl`（系统代理 127.0.0.1:7890）；`api.github.com` 不可用，全部通过网页与原始文件核实。
> 凡未核实项一律标注「未核实」，不做推测填充。

---

## 0. 总览表（全部数据 2026-09-25 实测）

| 项目 | GitHub 仓库（精确路径） | Stars | License（精确） | 最近提交 | 是否活跃 |
|---|---|---|---|---|---|
| **Vikunja** | `go-vikunja/vikunja` | 约 5.5k（5,503） | **AGPL-3.0-or-later**；`desktop/` 为 GPL-3.0-or-later | 2026-09-24 | ✅ 活跃 |
| **Super Productivity** | `super-productivity/super-productivity` | 约 22k（22,240） | **MIT** | 2026-09-24 | ✅ 活跃 |
| **Tududi** | `chrisvel/tududi` | 约 3.4k（3,385） | **MIT** | 2026-09-25 | ✅ 活跃 |
| **Plane** | `makeplane/plane` | 约 60k（59,855） | **AGPL-3.0-only**（仓库根 `COPYRIGHT.txt` 明确 SPDX: AGPL-3.0-only） | 2026-09-24 | ✅ 活跃 |
| **Huly** | `hcengineering/platform`（默认分支 `develop`） | 约 28k（27,774） | **EPL-2.0**（全部 LICENSE 逐字节一致，允许商用） | 仓库**已冻结**（末次提交信息即 "Frozen maintenance"）；接续仓库 `Platform-Collective/platform`（34★，2026-09-25 有推送），官方托管已停服 | ⚠️ 主线冻结 |
| **Focalboard** | `mattermost/focalboard` → 301 重定向至 `mattermost-community/focalboard` | 约 26k（26,486） | **混合/非标准**：Mattermost 编译版 MIT；**源码 AGPL-3.0 + 例外条款，或向 Mattermost 购买商业许可**；Admin Tools/配置目录 Apache-2.0（`LICENSE.txt` 明文） | 2025-06-11 | ❌ **README 明示"currently not maintained"** |
| **Leantime** | `Leantime/leantime` | 约 12k（11,655） | **AGPL-3.0-only**（结构性 open-core：`app/Plugins` 为私有 submodule；重复任务/番茄钟等为付费插件） | 2026-09-24 | ✅ 活跃 |
| **OpenProject** | `opf/openproject` | 约 16k（16,202） | **GPL-3.0**（Community Edition） | 2026-09-25 | ✅ 活跃 |
| **Tracks (GTD)** | `TracksApp/tracks` | 约 1.2k（1,239） | **GPL-2.0** | 2026-08-03（最新 release v2.7.1，2024-07-25） | ⚠️ 低频维护 |
| **WeKan** | `wekan/wekan` | 约 21k（21,094） | **MIT**（`LICENSE` 为纯 MIT 21 行） | 2026-09-25 | ✅ 高频发版，但单点巴士因子 |
| **AppFlowy** | `AppFlowy-IO/AppFlowy` | 约 77k（76,916） | 客户端 **AGPL-3.0**；**自建服务端已转商业闭源**（见下） | 2026-06-26 | ⚠️ 主仓节奏放缓；自建转商业 |
| **Nextcloud Tasks** | `nextcloud/tasks` | 约 0.7k（707） | **AGPL-3.0** | 2026-09-24 | ✅ 活跃 |
| **Nextcloud Deck** | `nextcloud/deck` | 约 1.4k（1,423） | **AGPL-3.0**（`package.json` 写 `agpl`） | 2026-09-24 | ✅ 活跃 |
| **Lunatask** | `lunatask/lunatask` | 约 0.12k（123） | **闭源专有**（仓库仅放 release 产物，README 自述 "holds releases"） | 2025-11-06 | ❌ 非开源 |
| **Docmost** | `docmost/docmost` | 约 22k（21,784） | **AGPL-3.0 核心 + EE 专有**（`packages/ee`、`apps/{server,client}/src/ee` 为 Docmost Enterprise License） | 2026-09-20 | ✅ 活跃 |
| **AFFiNE** | `toeverything/AFFiNE` | 约 73k（72,951） | **MIT（客户端/外层）+ 后端 EE 专有**：`packages/backend/server/LICENSE` = AFFiNE Enterprise Edition License，**生产环境须购买订阅** | 2026-09-22 | ✅ 活跃 |

补充参考（笔记型）：

| 项目 | 仓库 | Stars | License | 最近提交 |
|---|---|---|---|---|
| SiYuan | `siyuan-note/siyuan` | 约 46k（46,493） | AGPL-3.0 | 2026-09-22 |
| Joplin | `laurent22/joplin` | 约 56k（56,479） | AGPL-3.0-or-later，但 `packages/server` 为 **Joplin Server Personal Use License**（专有） | 2026-09-25 |
| Memos | `usememos/memos` | 约 63k（63,321） | MIT | 2026-09-23 |
| Logseq | `logseq/logseq` | 约 45k（45,053） | AGPL-3.0 | 2026-09-24 |

---

## 0.1 滴答清单六大差异化能力对照（本次选型的核心判据）

| 项目 | 四象限视图 | 番茄钟/专注 | 习惯打卡 | 自然语言日期 | 跨端原生 App | 日历双向同步 |
|---|---|---|---|---|---|---|
| **Super Productivity** | ✅ 内置 EISENHOWER_MATRIX 板 | ✅ `focus-mode` | ✅ `pages/habit-page` | ✅ Chrono | ✅ 全平台官方（Electron + Capacitor 套壳） | ✅ CalDAV VTODO 可配 pull/push/both + Google/Outlook（时间块可写回 Google） |
| **Tududi** | ✅ `EisenhowerMatrix.tsx` | ✅ `PomodoroTimer.tsx` | ✅ `modules/habits` | ❌ / 未核实（仅动作词识别） | ❌ 仅 PWA | ✅ CalDAV 双向（Nextcloud/Baikal/Apple/Thunderbird）；Google/Outlook 单向 |
| **Vikunja** | ❌ | ❌ | ❌ | ✅ Quick Add Magic | ⚠️ Android 官方 alpha；**iOS 无官方** | ⚠️ CalDAV VTODO **early alpha**；iOS CalDAV 不可用；无 Google/Outlook |
| **Plane** | ❌ | ❌ | ❌ | ❌ | ✅ iOS/Android 官方（连自建需 **Commercial Edition** v1.12+） | ❌ |
| **Huly** | ❌ / 未核实 | ❌ | ❌ | 未核实 | ❌ 无移动 App；有 Electron 桌面 | ⚠️ 有 iCal/日历集成 |
| **Focalboard** | ❌ | ❌ | ❌ | ❌ | ❌ 无移动，仅桌面/Web | ❌（仅 ICS 订阅） |
| **Leantime** | ❌ | ❌ | ❌ | ❌ | ⚠️ Mobile Beta（iOS TestFlight / Android Play） | ⚠️ 依赖 `sabre/dav`，程度未核实 |
| **OpenProject** | ❌ | ❌ | ❌ | ❌ | ⚠️ Mobile Beta iOS/Android | 未核实 |
| **Tracks** | ❌ | ❌ | ❌ | ❌ | ❌ 仅 Web | ❌（仅 ICS 导出） |
| **WeKan** | ❌ | ❌ | ❌ | ❌ | ⚠️ PWA 教程 / 第三方商业 vKan | ❌ |
| **AppFlowy** | ❌ | ❌ | ❌ | ❌ | ✅ 全平台 | 未核实（文档化路径是 Zapier） |
| **Nextcloud Tasks** | ❌ | ❌ | ❌ | ❌ | ✅ 借 CalDAV 生态（Apple Reminders/tasks.org 等） | ✅ CalDAV 双向（本命能力） |
| **Nextcloud Deck** | ❌ | ❌ | ❌ | ❌ | ⚠️ 第三方 Android/iOS | ❌ |
| **Lunatask** | 未核实（官网口径为自动优先级） | ⚠️ 任务绑定计时器，非经典番茄钟 | ✅ | 未核实 | ✅ 桌面 + 移动 | 未核实 |
| **Docmost** | ❌ | ❌ | ❌ | ❌ | ❌ 仅 Web | ❌ |
| **AFFiNE** | ⚠️ 仅有四象限模板 | ❌ | ❌ | ❌ | ✅ 全平台 | 未核实 |

---

## 1. Vikunja

- **仓库**：https://github.com/go-vikunja/vikunja （分支 `main`）
- **Stars**：约 5.5k（5,503，2026-09-25）
- **License**：**AGPL-3.0-or-later**；`desktop/` 目录为 GPL-3.0-or-later（README 第 58–62 行）。核心仓库内还有商业版 "Vikunja Pro" 的许可开关。
- **技术栈**：Go 1.27 后端（`go.mod` 实测）＋ Vue 3 前端（`frontend/package.json` v2.6.0）＋ SQLite（默认）/ MySQL / PostgreSQL；Electron 桌面壳（`desktop/`）；移动端为独立仓库 `go-vikunja/app`（Flutter）。
- **活跃维护**：✅ 最近提交 2026-09-24（atom 实测）。
- **客户端覆盖**：Web（官方 SPA/PWA）、Windows/macOS/Linux（官方 Electron）；Android 官方 App 仍属 alpha/beta（Google Play `io.vikunja.app`）；**iOS 无官方 App**（App Store 上的 "Vikunja" 为非官方第三方，另有 Kuna、mDone 等第三方客户端）。**非离线优先**：Service Worker 对 `/api/v1/*` 走 `NetworkOnly`。
- **已具备**：清单/项目、优先级、标签、重复任务、看板、甘特图、表格视图、子任务、协作与团队、提醒、注释、附件；**CalDAV（仅 VTODO，官方标注 early alpha，iOS CalDAV 同步不可用）**；REST API v1（Swagger）+ v2（OpenAPI 3.1）；Webhooks；Yaegi 运行时插件（v2.3.0+）；快速添加自然语言（"tomorrow at 5pm"、"every 2 weeks"、`*label`、`!3`）。
- **缺失**：**无日历视图**（官方视图仅 List/Gantt/Kanban/Table）、**无四象限视图**、**无番茄钟**、**无习惯打卡**；Google/Outlook 无原生双向日历同步。
- **复用难度**：技术栈现代、API 干净、Docker 自建一流，fork 无技术障碍；**主要障碍是 AGPL-3.0-or-later 的网络传染性**——若做对外提供的闭源/收费服务，需向使用者开放修改后的完整源码；且 Pro 商业功能与开源代码同仓，需逐一甄别授权范围。

---

## 2. Super Productivity

- **仓库**：https://github.com/super-productivity/super-productivity （分支 `master`）
- **Stars**：约 22k（22,240，2026-09-25）
- **License**：**MIT**（`LICENSE` 实测，Copyright (c) 2018 Johannes Millan）
- **技术栈**：Angular + NgRx（TypeScript）前端；Electron 桌面壳；Capacitor 打包 Android/iOS；本地存储 IndexedDB；可选自建同步服务 `packages/super-sync-server`。
- **活跃维护**：✅ 最近提交 2026-09-24。
- **客户端覆盖**：**官方覆盖最全**——Web PWA、Windows、macOS、Linux、Android（Play / F-Droid）、iOS（App Store）。**离线优先**：数据本地为主副本，支持 WebDAV / Dropbox / Nextcloud / 自有 SuperSync（可自建，E2E 加密）同步。
- **已具备**：任务/项目/标签/子任务、优先级、重复任务、Schedule + Planner 视图（时间盒，等同日历）、看板（`features/boards`）、**四象限/艾森豪威尔矩阵**（内置 EISENHOWER_MATRIX 板）、**番茄钟/专注模式**（`features/focus-mode`）、**习惯打卡**（源码实测有 `pages/habit-page`）、提醒；自然语言日期（Chrono，如 `@4pm`、`@every 2 weeks`）；**CalDAV VTODO 可配置 pull/push/both**；Google Calendar / Outlook 365 集成（时间块可写回 Google 日历）。
- **缺失**：**无真正的服务端多用户协作/团队能力**（仅可选 Plainspace 共享空间，属其自有服务）；Android/iOS 是 Capacitor 套壳非原生；本地 REST API 仅桌面端且默认关闭；跨设备实时协同弱于滴答清单；未核实是否有 webhook。
- **复用难度**：MIT 无任何商用/闭源/换皮限制，功能面最贴近滴答清单；**主要障碍是体量——约百万行级 TypeScript，围绕操作日志（op-log）/同步引擎深度耦合的单体，二次开发上手成本高**。

---

## 3. Tududi

- **仓库**：https://github.com/chrisvel/tududi （分支 `main`）
- **Stars**：约 3.4k（3,385，2026-09-25）
- **License**：**MIT**（`LICENSE` 实测）
- **技术栈**：Node.js + Express 后端，Sequelize ORM；React + TypeScript（webpack）前端；SQLite（默认，单文件）或 PostgreSQL；Docker 部署。
- **活跃维护**：✅ 最近提交 2026-09-25（本批最活跃之一）。
- **客户端覆盖**：**仅 Web + 可安装 PWA**（Android/iOS/桌面浏览器添加到主屏）；**无任何原生或商店 App**；Telegram bot 只是消息通道不是客户端。离线能力为"部分"：PWA 缓存可读，写操作排队待联网回放。
- **已具备**：层级化 任务/项目/领域/笔记/标签、子任务、优先级、重复任务（含完成日触发、父子关联）、**看板**、**日/周/月日历视图**、**四象限/艾森豪威尔矩阵**（源码有 `EisenhowerMatrix.tsx`）、**番茄钟**（`PomodoroTimer.tsx`）、**习惯打卡**（`backend/modules/habits` + 连续 streak）、项目协作/角色/分组、OIDC/SSO、多语言（25 种）、Telegram 集成、**CalDAV 双向同步**（Nextcloud、Baikal、tasks.org、Apple Reminders、Thunderbird，支持 RRULE 与冲突检测）；REST `/api/v1` + Swagger + 个人 API Key；MCP server（stdio/HTTP）。
- **缺失**：**无原生跨端 App**（只有 PWA）；**自然语言日期解析基本没有**（收件箱只做动作词/标签识别，未核实有完整 NLP）；Google/Outlook 仅单向 iCal 订阅导入，无 API 写回；**无任务 webhook、无插件系统**。
- **复用难度**：MIT 无限制，代码量在本清单里偏小（Express + React），架构直观、上手快；**主要障碍是单维护者、缺乏插件/扩展接缝，fork 后基本等于自己接手维护整个应用**。

---

## 4. Plane

- **仓库**：https://github.com/makeplane/plane （**默认分支为 `preview`**，`master` 仍存在）
- **Stars**：约 60k（59,855，2026-09-25）
- **License**：**AGPL-3.0-only**。仓库根 `COPYRIGHT.txt` 实测：`SPDX-License-Identifier: AGPL-3.0-only`；`LICENSE.txt` 为标准 AGPLv3 全文。**该仓库内不含任何商业/企业版代码**：全仓扫描未发现 `ee/`、`enterprise/`、SAML/OIDC/audit 代码，`apps/api/plane/license` 模块本身也是 AGPL-3.0-only，其 `InstanceEdition` 枚举只有 `PLANE_COMMUNITY`。**付费的 Plane Commercial Edition / Cloud 是独立产品线**（Cloud Free / Pro $6 / Business $13 / Enterprise Grid 面谈，按席位/月年付）。
- **技术栈**：后端 Django 5.2 + DRF（`requirements/base.txt` 实测）、Celery、PostgreSQL、Redis；前端 React（`apps/web` 使用 react-router，非 Next.js）；仓库结构 `apps/{web,admin,space,live,proxy,api}` + `packages/*`，pnpm/turbo 单仓。
- **活跃维护**：✅ 最近提交 2026-09-24。
- **客户端覆盖**：Web + **官方 iOS / Android App**；另有 Mac/Windows 桌面下载。**注意**：官方文档写明移动 App 连接自建实例需 **self-hosted Commercial Edition（v1.12.0 起）**，免费版自建走移动端受限（官方 Download 渠道与自建支持范围以其文档为准）。
- **已具备**：工作项（Issue）、项目、周期（Cycles）、模块、Epics/Initiatives、看板与多视图、Wiki、评论/协作、通知、导入器；REST API。
- **缺失**：**无四象限视图、无番茄钟、无习惯打卡、无自然语言日期解析**；定位是团队项目管理，不面向个人 GTD；移动端对自建免费版的支持有版本/授权门槛。
- **复用难度**：体量大（Django + React 多应用单仓）、面向团队协作，架构复杂度高；**AGPL-3.0-only + 自建移动端需商业版**是双重障碍，不适合作为"个人滴答清单"的底座。

---

## 5. Huly

- **仓库**：https://github.com/hcengineering/platform （**默认分支为 `develop`**）
- **Stars**：约 28k（27,774，2026-09-25）
- **License**：**EPL-2.0**。根 LICENSE 与全部 `foundations/*/LICENSE` 经比对为**逐字节一致的 EPL-2.0**，全仓无第二许可、无商业目录。EPL-2.0 允许商业使用与再分发，但**对商业分发者附加赔偿条款**（§4），并非使用禁令。
- **停维护/迁移状态（关键，原文已核实）**：README 顶部实测 **"This repository is frozen and is no longer actively maintained."**，并写明开发已迁至 **`Platform-Collective/platform`**；同时 **"Hosted Huly has shut down."**（官方托管停服）。最后一次提交 2026-09-25，提交信息即 `"Frozen maintenance (#11045)"`。旁证：`app.huly.io` → HTTP 522，`huly.io` 只剩 404 外壳。接续仓库 `Platform-Collective/platform` 实测 **仅 34★ / 6 fork**，README 自述为"由社区独立发展的 Huly Platform 分支"。
- **技术栈**：TypeScript "Rush" 单仓；前端 Svelte；后端 30+ Node 微服务（`transactor/account/workspace/datalake/fulltext/collaborator/hulypulse` 等，见 `ARCHITECTURE_OVERVIEW.md`）；存储 **MongoDB + Elasticsearch + MinIO + Redpanda**；Electron 桌面（`desktop/`）；自建最低要求 **2 vCPU / 8GB RAM，推荐 4 vCPU / 16GB**（huly-selfhost README 实测）。
- **客户端覆盖**：Web + Electron 桌面（Win/macOS/Linux）；**无官方移动 App**（官方文档称移动端用浏览器 + Telegram bot，App 仍在设计中）。
- **已具备**：项目管理（Issues）、看板、文档、聊天、CRM、HRM 等模块；iCal/日历集成；API Client。
- **缺失**：四象限、番茄钟、习惯打卡、自然语言日期（未核实）；移动原生端缺失。
- **复用难度**：**部署极重（最低 2 vCPU/8GB，推荐 4 vCPU/16GB）、微服务 30+ 个、学习曲线陡**；叠加"主仓冻结 + 接续仓仅 34★ + 托管停服"，作为长期底座风险很高。仅自托管部署可参考 `hcengineering/huly-selfhost`（约 3.5k★，最近提交 2026-07-22，同 EPL-2.0）。

---

## 6. Focalboard

- **仓库**：https://github.com/mattermost/focalboard （已 301 重定向至 **`mattermost-community/focalboard`**，两路径同指一仓）
- **Stars**：约 26k（26,486，2026-09-25）
- **License（务必注意）**：**非标准混合许可**。`LICENSE.txt` 实测：Mattermost 自己编译的发行版按 **MIT** 授权；**用源码自行编译**则要么按 **AGPL-3.0（附例外条款）**，要么向 Mattermost 购买**商业许可**；`webapp/html-templates/`、`app-config.json`、`server/model/`、`plugin/` 等 Admin Tools/配置目录按 **Apache-2.0**。GitHub 识别为 `NOASSERTION`。
- **维护状态（关键）**：**已停止维护**。README 顶部实测警告 "This repository is currently not maintained."；最后一次提交 **2025-06-11**（dependabot；最后一次人工提交为 2025-06-09/10，此前自 2024-09-27 起长期停滞），最新 release **v8.0.0（约 2024-06）**。团队版能力并入 `mattermost/mattermost-plugin-boards`：该 Boards 插件自 **2023-09-15** 起转为"完全社区支持（不再加功能/修 bug）"，并于 **2023-09-28 从 Mattermost Cloud 下架**。
- **技术栈**：Go 服务端（`server/go.mod`，Go 1.21）＋ React/Redux webapp；SQLite / PostgreSQL / MySQL；Windows(WPF)/macOS/Linux 桌面版（个人桌面版为单用户、本地 SQLite）。
- **客户端覆盖**：Web、Windows、macOS、Linux 桌面；**无移动 App**；离线能力未核实（桌面版本地 SQLite 可单机用）。
- **已具备**：看板、表格、日历视图、卡片属性/多视图、评论、复选框（子任务语义）、ICS 订阅；REST API + Swagger。
- **缺失**：优先级/重复任务/提醒体系薄弱，无四象限、番茄钟、习惯打卡、自然语言日期；协作依赖 Mattermost 生态。
- **复用难度**：**已停维护 + 混合许可（源码默认 AGPL 或买商业许可）是硬伤**；技术栈本身不算重，但接手一个 dead repo 不划算，仅适合作为"看板数据模型"参考。

---

## 7. Leantime

- **仓库**：https://github.com/Leantime/leantime （分支 `master`）
- **Stars**：约 12k（11,655，2026-09-25）
- **License**：**AGPL-3.0-only**（根 `LICENSE` 为标准 AGPLv3，`composer.json` 实测 `"license": "AGPL-3.0-only"`）。**但 open-core 切分是结构性的**：`app/Plugins` 是指向 **私有/不存在的 `Leantime/plugins` 仓库的 git submodule（公开访问 404）**，仓库内为空；README 自带 "LICENSE Exceptions" 条款，允许 `/app/Plugins` 下的插件使用其他许可（含企业许可）。核心代码按付费插件分支（PgmPro / StrategyPro / Copilot / Whiteboardscanvas）。
- **付费点（与滴答清单高度相关）**：官方 FAQ 明确 Strategy / Program Management / AI **不在开源版**；插件市场里 **重复任务 $39、番茄钟 $19**、Notes $29、Whiteboards $39、SAML $39、MCP $29；云端仅 Leantime Pro（$10/用户/月，年付 $8，**无免费 SaaS 档**），开源版为免费自建 Community Edition。
- **技术栈**：PHP `^8.2` + **Laravel `^11.44`**；服务端渲染 Blade + jQuery/htmx/Tailwind（仓库内 **0 个 .vue**）；**MySQL 5.7+/MariaDB 10.2+**；依赖含 `sabre/dav`（CalDAV 能力）、`spatie/icalendar-generator`。
- **活跃维护**：✅ 最近提交 2026-09-24。
- **客户端覆盖**：Web；官方 **Android App** `io.leantime.mobile`（open testing，更新至 2026-07-28）+ **iOS Beta（TestFlight）**（正式上架**未核实**）；无 Windows/Linux 原生端，无 PWA。**无离线优先**：无 Service Worker，移动端仅缓存最近浏览内容（只读缓存）。
- **已具备（开源核心）**：任务/检查清单、无限子任务与依赖、5 级优先级、标签、看板/甘特/表格/列表/**日历**多视图、里程碑、Sprint、评论/@提及/角色权限、时间表、Wiki、Idea Board、Lean Canvas、SWOT、回顾。日历为**单向 iCal**（`/calendar/ical`）+ 只读 Google/iCal 导入；**双向需 CalDAV 插件（未在开源插件列表内）**。
- **缺失（开源版）**：**重复任务（付费插件）、番茄钟（付费插件）**、四象限（未发现）、习惯打卡（未发现）、AI/NL 捕捉（付费 Copilot，开源版 NLP 解析**未核实**）。
- **扩展性**：接口是 **JSON-RPC 2.0 而非 REST**（`/api/jsonrpc`，`x-api-key`）；**无内置 webhook**（只有出站 messenger webhook）。
- **复用难度**：Laravel 生态主流、部署轻（PHP 8.2 + MySQL，Docker 约 293MiB、512MB–1GB 内存）；但**滴答清单的招牌能力几乎全在私有付费插件里**，AGPL 网络传染 + 私有 submodule 是双重障碍，团队 PM 模型与个人任务管理也错位。

---

## 8. OpenProject

- **仓库**：https://github.com/opf/openproject （分支 `dev`）
- **Stars**：约 16k（16,202，2026-09-25）
- **License**：**GPL-3.0**（根 `LICENSE` 为标准 GPLv3；**仓库内无 `LICENSE_EE`、无 `ee/` 目录、无专有声明**，2.4 万文件级扫描确认）。Enterprise 版是同一产品 + 付费 **Enterprise token** 解锁企业插件，官方 FAQ 明确 "all features, also the Enterprise add-ons, are developed under the GPL v3"——即企业插件的代码也是 GPL。定价：Community €0；Basic/Professional/Premium 约 **€5.95 / €10.95 / €15.95** 每用户（最低 25/25/100 席），云版最低 5 席、本地版最低 25 席，14 天试用。当前版本 **v17.8.0（2026-09-02）**。
- **技术栈**：Ruby 4.0.7 + **Rails 8.1.3.1**；前端是**混合式而非纯 Angular**——Angular 22.1.7 负责部分功能域，另有 ViewComponent 4.15 + turbo-rails 2.0 + Stimulus；**仅支持 PostgreSQL 16+**。
- **活跃维护**：✅ 最近提交 2026-09-25。
- **客户端覆盖**：Web；官方 **OpenProject Mobile（Beta）** —— iOS（id6474431879，Beta）与 Android（`org.openproject.app`）；无 Windows/Linux 原生端，macOS 只是 iPad 版缩放，PWA**未核实**。**官方明确不支持离线模式**（docs: "Offline mode is not supported."）。
- **已具备（社区版）**：Work Package（工作包）、优先级、日历、看板/敏捷板与 Backlog、子任务与层级、协作、提醒/日期告警、时间跟踪、甘特图、会议、Wiki、API v3；企业插件（SSO、OneDrive/SharePoint、团队规划、资源/组合管理、LDAP/SCIM 等）**都不是四象限/番茄钟那类个人能力**。日历为**只读单向 iCal，无 CalDAV**；重复任务无（只有重复**会议**）。
- **缺失**：四象限、番茄钟、习惯打卡、自然语言日期（多数未核实/无），checklists/tags 未核实；**定位重型组织级 PM**，对"个人滴答清单"严重过重。
- **复用难度**：庞大的 PostgreSQL-only Rails 单体（约 2.4 万文件，最低 ~4GB 内存/4 核/20GB 磁盘，5 人也要 ≥2 个 web worker），企业工作包模型与个人 GTD 错位；GPL-3.0 允许商用与换皮，但衍生作品必须保持 GPL-3.0。

---

## 9. Tracks (GTD)

- **仓库**：https://github.com/TracksApp/tracks （分支 `master`）
- **Stars**：约 1.2k（1,239，2026-09-25）
- **License**：**GPL-2.0**（`COPYING` 实测 GNU GPL v2）
- **维护状态**：⚠️ **事实性休眠（dormant），未归档**。最新 release **v2.7.1 = 2024-07-25**，已约 26 个月无新版本；最近提交 2026-08-03，但**近期 30 次提交全部是 Dependabot 依赖升级，无任何功能开发**（252 个 open issue）。项目年代久远（GTD 经典老项目）。
- **技术栈**：Ruby on Rails 7.2（`Gemfile` 实测）；SQLite / MySQL / PostgreSQL 三选一。
- **客户端覆盖**：**仅 Web**；无移动/桌面 App（未核实有官方客户端）。
- **已具备**：严格 GTD 模型——Contexts、Projects、Next Actions、Tickler（推迟）、重复待办、星标（唯一的"优先级"表达）、备注、上下文过滤、依赖链接、**ICS 导出**、RSS feed。
- **缺失**：看板、日历视图、四象限、番茄钟、习惯打卡、自然语言日期、协作；**无原生 CalDAV/Google/Outlook 同步（仅 ICS 导出）**；UI 陈旧（Bootstrap 3 + jQuery/ERB）。
- **扩展性**：有文档化的 XML REST API（`/integrations/rest_api`，Basic 认证，todos/contexts/projects/tickler/calendar）。
- **复用难度**：Rails 单体、代码量不大，但**事实休眠 + 技术栈与 UI 明显老旧 + 无 CalDAV/移动端**；仅适合作为 GTD 数据模型与 XML API 的参考。

---

## 10. WeKan

- **仓库**：https://github.com/wekan/wekan （**默认分支为 `main`**；`master` 仍存在）
- **Stars**：约 21k（21,094，2026-09-25）
- **License**：**MIT**（`LICENSE` 实测为纯 MIT，21 行，Copyright (c) Lauri Ojansivu）。注意 WeKan 是注册商标（"WeKan ®"），品牌/素材使用另有商标约束（具体政策文本**未核实**）。
- **维护状态**：✅ 发版非常频繁（最新 tag `v12.01`，2026-09-25 仍有提交），但**近期提交几乎全部由单一维护者 xet7 完成，巴士因子极高**；依赖冷门的 Meteor 生态。
- **技术栈**：**Meteor 3（Node.js）** 全栈 ＋ MongoDB（`package.json` 实测 `meteor.mainModule` 配置）。桌面有 Microsoft Store 版、Ubuntu Touch 版。
- **客户端覆盖**：Web + Docker（`ghcr.io/wekan/wekan`）；当前 README **已不再宣传 Cordova/移动 App**（grep cordova/android/ios 无结果），移动端主要靠 PWA 自定义 Tabs 教程，另有第三方**商业**客户端 vKan（Android/iOS，闭源）；Ubuntu Touch、Windows 桌面。
- **已具备**：看板、列表/泳道、卡片、检查清单、标签、截止日期、自定义字段、成员与权限、附件、活动流、REST API、出站 Webhook、IFTTT 规则。
- **缺失**：日历视图、四象限、番茄钟、习惯打卡、自然语言日期、CalDAV（未核实）；无原生移动端。
- **复用难度**：MIT 无限制、功能面偏纯看板；**主要障碍是 Meteor/MongoDB 技术栈已属冷门且升级困难**，长期维护风险高。

---

## 11. AppFlowy

- **仓库**：https://github.com/AppFlowy-IO/AppFlowy （分支 `main`）
- **Stars**：约 77k（76,916，2026-09-25）
- **License / 自建状态（关键，必须提醒）**：客户端为 **AGPL-3.0**。但 **自建后端已转为商业闭源**：
  - 原 `AppFlowy-IO/AppFlowy-Cloud`（Rust 后端，AGPL-3.0，约 2.0k★）**已归档（archived=true，最近提交 2026-09-11）**，其 README 明说：改用 **`AppFlowy-IO/AppFlowy-SelfHost-Commercial`**，官方 Docker 镜像由**商业代码库**构建。
  - `AppFlowy-SelfHost-Commercial` 的 `SELF_HOST_LICENSE_AGREEMENT.md` 实测为专有协议：**不得复制/修改/分发/转售**，按机器绑定 License Key；免费档仅 **1 个用户席位** + 3 个 guest editor。
- **技术栈**：客户端 Flutter（Dart）＋ Rust（`frontend/appflowy_flutter`、`frontend/rust-lib`）；本地 SQLite；服务端（商业）Rust + PostgreSQL(pgvector) + Redis + MinIO + GoTrue。
- **活跃维护**：主客户端仓最近提交 2026-06-26（节奏放缓）；自建服务端主线已商业闭源。
- **客户端覆盖**：Web、Windows、macOS、Linux、iOS、Android（客户端齐全），**本地优先/离线可用**。
- **已具备**：文档/数据库（**Grid、Kanban、Calendar、Gallery、List、Feed、Chart** 多视图，日历支持多日/周视图与拖拽）、任务、协作、模板。
- **缺失**：**无实时提醒**（官方 issue #8708 明确"AppFlowy lacks the real-time reminder functionality"）、四象限、番茄钟、习惯打卡、自然语言日期；**CalDAV 双向与公开 REST API 未核实**（文档化路径是 Zapier）；任务能力依附于"文档数据库"模型，不是原生任务管理器。
- **复用难度**：**客户端 AGPL + 服务端商业专有许可**是最大障碍——你无法基于它自建一套自己的云同步后端；Flutter + Rust 双栈也抬高开发门槛。仅适合作为跨端 UI/编辑器参考。

---

## 12. Nextcloud Tasks / Deck

两者都不是独立应用，而是 **Nextcloud 的 App**，必须自建 Nextcloud 服务器。

### Nextcloud Tasks
- **仓库**：https://github.com/nextcloud/tasks （分支 `master`）｜Stars 约 0.7k（707）｜**AGPL-3.0**
- **技术栈**：PHP（Nextcloud App 框架，要求 Nextcloud 31–35、PHP 8.2–8.6）＋ Vue 3（`@nextcloud/vue` + Vite）；数据存在 Nextcloud 的 CalDAV/VTODO 日历里（`<backend>caldav</backend>`）。
- **活跃维护**：✅ 2026-09-24；当前版本 0.18.1。
- **已具备**：任务增删改、起止/截止日期、优先级、状态、**子任务（VTODO 层级）**、智能集合（重要/当前/即将）、拖拽到日历或设为子任务、共享、ICS 下载。重复规则与 VALARM 提醒：**未核实**。
- **客户端覆盖**：Nextcloud Web；**真正的跨端能力来自 CalDAV 生态**——Apple Reminders(iOS/macOS)、2Do、tasks.org(Android)、DAVx5、OpenTasks、Outlook CalDAV Synchronizer、Thunderbird、GNOME To Do、KDE Kalendar、planify、jtx Board、NowThis 等（README 列出）。
- **缺失**：看板、日历视图、四象限、番茄钟、习惯打卡、自然语言日期；无独立 App；**无文档化的任务 REST API**（仅有内部 `/api/v1/collections`、`/api/v1/settings`，真正的接口是 CalDAV/WebDAV + ICS）。
- **复用难度**：**强绑定 Nextcloud 平台**，不适合作为独立产品底座；但它的 CalDAV 双向同步验证了"任务即 VTODO"的互操作路线，值得借鉴。

### Nextcloud Deck
- **仓库**：https://github.com/nextcloud/deck （分支 `main`）｜Stars 约 1.4k（1,423）｜**AGPL-3.0**
- **技术栈**：PHP（Nextcloud App，含自有数据表）＋ Vue 前端；`main` 须为 `2.0.0-dev.0`，最新稳定版 v1.19.0。
- **已具备**：看板/栈/卡片、排序、标签、截止日期、附件与 markdown 描述、评论、活动流、用户/组共享、Circles、Trello 导入、`/upcoming` 视图；**有文档化的 REST API v1.0**（Boards/Stacks/Cards/Labels/Attachments/Comments，deck.readthedocs.io）。
- **客户端覆盖**：Nextcloud Web；移动端靠**第三方**客户端——Android `stefan-niedermann/nextcloud-deck`（GPLv3，支持离线）、iOS `holger-dev/nextdeck`；无官方独立 App、无原生桌面端。
- **缺失**：**无优先级字段、无重复任务、无日历视图、无提醒**、四象限/番茄钟/习惯打卡无；无 CalDAV 同步。
- **复用难度**：同样强绑定 Nextcloud；定位纯看板，仅适合作为"看板 + REST API"参考。

---

## 13. Lunatask

- **仓库**：https://github.com/lunatask/lunatask ｜Stars 约 0.12k（123，2026-09-25，仅供参考）
- **License**：**闭源专有商业软件**。README 实测自述 "This repository holds releases of Lunatask"，仓库**只有 `README.md` + `badge.png`，没有源代码**，数据存在其云端，**不可自建**。
- **商业模式**（官网实测）：Free / Premium（$8/月，年付 $6/月）；一次性终身授权 **$300**（移动端与 Mac App Store 不可用），发票渠道终身价 $200（+VAT）/ 英国 £150。
- **客户端**：Windows / macOS / Linux（DMG）/ iOS / Android；**无 Web 客户端**。
- **定位**：all-in-one 加密待办 + 习惯追踪 + 日记 + 生活记录 + 笔记；**默认端到端加密**；含自动优先级、时间块、任务计时器（任务绑定的番茄式计时，非经典番茄钟）、习惯打卡、心情/日记、WIP 限制、Zapier。**四象限能力仅见于第三方来源，官网口径是 "Automatic Prioritization"，未核实。**
- **API**：有公开 API（tasks/notes/habits/journal/people），但**无法读取加密字段，且无 webhook**。
- **对本次选型的意义**：**不是候选**，只能作为功能与交互设计的对标样本（"习惯 + 日记 + 加密 + 优先级自动化"正是滴答清单的差异化方向）。
- **复用难度**：**不可复用**（无源码、无自建、无 License，只有专有二进制 + 付费云）。

---

## 14. Docmost / AFFiNE / 其他笔记型

### Docmost
- **仓库**：https://github.com/docmost/docmost ｜Stars 约 22k（21,784）｜最近提交 2026-09-20
- **License**：**核心 AGPL-3.0 + Enterprise Edition 专有**。README 实测列出 EE 目录：`apps/server/src/ee`、`apps/client/src/ee`、`packages/ee`，适用 Docmost Enterprise License（本地实测 `packages/ee` 下只有 `LICENSE` 文件）。
- **EE 目录内容实测包含**：`base`（Bases/表格与看板）、`api-key`、`ai`、`audit`、`mfa`、`oauth`、`page-permission`、`scim`、`billing` 等。**已在 main tarball 上复核：`packages/ee/` 只有 LICENSE、`apps/server/src/ee/` 为空、`apps/client/src/ee/` 才是真实 EE 代码。**
- **关键点**：**「Bases（Table + Kanban 视图）」是付费功能**——官方文档明确需要有效的 Business/Enterprise 许可，**不在免费 OSS 版内**。即"fork 开源核心也拿不到看板"。
- **技术栈**：NestJS 11 + Fastify + Kysely + **PostgreSQL(pgvector)** + Redis + BullMQ，协作走 Hocuspocus/Yjs；前端 React 19 + TipTap + Vite；`package.json` 实测 nx + pnpm 单仓。
- **客户端**：仅 Web；无原生 App；离线未核实。
- **能力**：Notion 式文档/知识库、实时协作、空间与权限、全文搜索、模板；**无独立任务实体、无提醒/重复任务，任务/看板能力弱且付费**。
- **复用难度**：AGPL 核心可 fork，但看板等能力在 EE 专有目录；定位是 wiki 而非任务管理器。**仅作参考，不作底座。**

### AFFiNE
- **仓库**：https://github.com/toeverything/AFFiNE ｜默认分支为 **`canary`**（`main` 分支无 LICENSE 文件）｜Stars 约 73k（72,951）｜最近提交 2026-09-22
- **License（关键）**：外层/客户端 **MIT**，但 **`packages/backend` 与 `packages/common/native` 适用 `packages/backend/server/LICENSE` = AFFiNE Enterprise Edition (EE) License**——**生产环境使用必须以有效 AFFiNE Enterprise 订阅为前提**，禁止复制/合并/分发/转售。**注意：README 声称"CE 自建免费且 MIT"，与其 LICENSE 文件相矛盾，以 LICENSE 文件为准。**
- **技术栈**：TypeScript 单仓、React + BlockSuite 前端、Node 服务端（`@affine/server`，NestJS + Prisma）、PostgreSQL + Redis；含 Rust 组件。
- **客户端**：Web、Windows、macOS、Linux、iOS、Android；本地优先。
- **能力**：文档/白板/数据库（含 Kanban/表格/日历视图与四象限模板）、AI；任务管理是"数据库视图"级别，不是原生任务模型。
- **复用难度**：**后端 EE 许可直接封死自建路线**；前端 MIT 部分可参考。

### 其他笔记型一句话
- **SiYuan**（46k★, AGPL-3.0）：Go 内核 + TS 前端，可 Docker 自建，本地优先、块级笔记；**无真正任务管理**（块编辑器 + 表格数据库 + 闪卡）。
- **Joplin**（56k★）：客户端 AGPL-3.0，但 **`packages/server` 为 Joplin Server Personal Use License（非 FOSS，个人使用许可）**，自建同步有授权限制；Electron + React Native + Node + SQLite，离线优先，支持 E2EE 同步（WebDAV/S3/OneDrive/Nextcloud/Joplin Cloud）；**待办笔记 + 系统通知闹钟**，但优先级/重复/看板/日历视图等原生能力缺失；有 **Data API + Plugin API**。
- **Memos**（63k★, MIT）：Go(Echo v5 + ConnectRPC) + React/Vite，SQLite/MySQL/PostgreSQL，REST + gRPC；**纯时间线便签，无任务管理**。
- **Logseq**（45k★, AGPL-3.0）：大纲笔记 + TODO，无日历/看板/提醒体系。

---

## 15. 综合排名：如果要做一款自己的滴答清单，最值得作为底座的 TOP 3

### 🥇 TOP 1 — Super Productivity（MIT）
**理由**：本清单中**唯一同时满足「许可证无约束 + 全平台官方客户端 + 本地优先 + 四象限 + 番茄钟 + 习惯打卡 + 自然语言日期 + 看板 + 日历/时间盒」**的项目，功能面与滴答清单重合度最高，MIT 允许闭源商用与换皮，直接消灭了许可证风险。
**风险与对策**：约百万行 TypeScript、围绕 op-log 同步引擎耦合，二次开发门槛高。建议**先 fork 做减法**（收敛到个人场景 UI），再补自建多设备同步（它已有可自建的 `super-sync-server`），不必动核心同步引擎。

### 🥈 TOP 2 — Tududi（MIT）
**理由**：MIT 许可干净，**代码量小、架构直白（Express + React + SQLite）**，且出乎意料地已经具备**四象限 + 番茄钟 + 习惯打卡 + CalDAV 双向同步 + REST API + 多用户协作**——即滴答清单的付费模块它大多已有。适合作为**"自己能完全掌控的小底座"**：fork 后加原生壳（Capacitor/Tauri）即可补齐跨端。
**风险与对策**：仅 Web/PWA、单维护者、无插件体系，且自然语言日期解析基本缺失。对策是把 Super Productivity 的 Chrono 用法（同为 MIT 生态：`chrono` 库）与原生壳补进来。

### 🥉 TOP 3 — Vikunja（AGPL-3.0-or-later，⚠️ 有许可条件）
**理由**：**服务端骨架与 API 设计的标杆**——Go 后端性能好、REST v1/v2 + Webhooks + 插件齐全、Docker 自建体验一流、多用户/团队/共享完整。若你接受 AGPL（项目开源，或以 AGPL 方式提供网络服务），它是**最稳的后端与数据模型参考/底座**。
**风险与对策**：缺日历视图/四象限/番茄钟/习惯打卡，且 **AGPL 的网络传染性**决定了它不适合"闭源收费 SaaS"路线。对策：**只借鉴其 API/数据模型，不 fork 代码**；或整个产品选择开源路线时再直接 fork。

### 明确不推荐作为底座
| 项目 | 不推荐原因 |
|---|---|
| Focalboard | **已停维护（2025-06 起）+ 源码许可默认 AGPL 或需商业授权** |
| Huly | **主仓冻结、接续仓仅 34★、官方托管停服**；30+ 微服务、8–16GB 内存门槛 |
| AppFlowy / AFFiNE | **自建后端均已转商业专有许可**（AppFlowy SelfHost-Commercial / AFFiNE EE License），自建路线被封死 |
| Plane / Leantime / OpenProject / WeKan | 团队 PM / 看板定位，个人任务模型错位；Plane 自建移动端还需商业版；**Leantime 的重复任务($39)与番茄钟($19)是私有付费插件、`app/Plugins` 为不可公开访问的 submodule**；OpenProject 过重且不支持离线；WeKan 技术栈冷门且单一维护者 |
| Nextcloud Tasks / Deck | 强绑定 Nextcloud，非独立产品 |
| Lunatask | **闭源、不可自建、不可复用**（仅设计参考） |
| Tracks / Docmost | 老 GTD Rails / Wiki 定位，任务能力不足 |

---

## 16. 需要回填到 `docs/01-oss-landscape.md` 的勘误

现有草稿里以下数据有误，建议按本文更正：

1. **Super Productivity 仓库路径**应为 `super-productivity/super-productivity`（不是 `johannesjo/...`）；Stars 已约 **22.2k**（不是 21k）；**它有习惯打卡**（源码 `pages/habit-page` 实测），草稿写"完全没有"是错的。
2. **Tududi** 现在约 **3.4k stars**、技术栈是 **Node.js + Express + React + SQLite/PostgreSQL**（草稿写的"约 95 stars、Ruby/Sinatra"错误）；且它已具备四象限、番茄钟、习惯打卡与 CalDAV 双向同步。
3. **Vikunja** Stars 约 **5.5k**（非 5.3k）；并需注明 CalDAV 仅为 alpha、iOS CalDAV 不可用、**无日历视图**。
4. **AppFlowy** 自建服务端已商业闭源（`AppFlowy-Cloud` 归档），"AGPL-3.0 可自建"的说法需要修正。
5. 草稿"是否存在同时具备任务+四象限+番茄钟+习惯打卡+日历的单一开源项目"——**答案是 Super Productivity（全中）与 Tududi（除原生 App 与 NLP 外基本全中）**。
6. **默认分支勘误**：Plane 默认分支已是 **`preview`**（非 `master`）；Huly 默认分支是 **`develop`**（非 `main`）；WeKan 默认分支是 **`main`**（非 `master`）。引用代码路径时不要写死。
7. 草稿把 OpenProject 描述为 "Rails + Angular" 不够准确：实为 Rails 8.1 + **Angular 22 与 ViewComponent/Turbo/Stimulus 混合**，且**仅支持 PostgreSQL 16+、官方不支持离线**。

---

## 17. 本次调研的源文件与局限

同目录下另有三份由并行调研产出的原始报告，可作为交叉印证：

- `research-open-source-task-managers.md` —— Vikunja / Super Productivity / Tududi 深度报告（含源码行数估算）
- `oss-pm-comparison-2026-09-25.md` —— Plane / Huly / Focalboard / Leantime / OpenProject / WeKan
- `research-task-managers-2026-09-25.md` —— Tracks / AppFlowy / Nextcloud Tasks+Deck / Lunatask / Docmost / AFFiNE

**局限与已标记的「未核实」项**：
- GitHub 未认证 REST API 有 60 次/小时限额，且本机 `api.github.com` 不可达，故全部走网页 HTML、`.atom` 提交源与 `raw.githubusercontent.com` 原始文件。
- star 数为 2026-09-25 当日快照，会随时间变化。
- 以下项明确**未核实**：AppFlowy 的公开 REST API/webhooks 与 CalDAV 双向；Nextcloud Tasks 的重复规则与 VALARM 提醒；Plane/Huly/Focalboard/WeKan 的滴答清单式功能细节与离线能力；Lunatask 的四象限（官网仅写自动优先级）；Vikunja 换皮/商标条款；WeKan 商标政策文本。
- 各项目"已具备/缺失"以**官方 README、官网功能页与源码目录实测**为依据；营销页未列出的能力一律标为缺失或未核实，不做乐观推断。

---

*本文件为第一手核实的原始调研产出，star/license/提交时间均以 2026-09-25 实测为准。*
