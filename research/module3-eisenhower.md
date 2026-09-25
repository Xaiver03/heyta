# 模块 3：四象限 / 艾森豪威尔矩阵视图 + 其他可视化任务视图可复用实现

> 调研日期：**2026-09-25**
> 数据来源与核实方式：
> - Star / forks / license 字段 / archived / 分支 / last commit / latest release / top_lang：全部由 `research/ghinfo.py` 于 2026-09-25 实测。
> - License 精确 SPDX：凡标记 **【原文核实】** 的，均用 `curl -sSL https://raw.githubusercontent.com/OWNER/REPO/BRANCH/LICENSE*` 读取许可证正文确认；标记 **【脚本】** 的为 ghinfo.py 的 GitHub license 探测值，未读原文。
> - 未核实项一律标注「未核实」，不做推断。

---

## 0. 结论先行

1. **「拿来即用的四象限视图组件库」在开源世界里基本不存在。** 这是本次调研最重要的结论。
   - GitHub topic `eisenhower-matrix` 全量扫了一遍（含 `?l=javascript` 过滤），最高 star 的项目是 **919 star 的 Android 原生 App**（Spikeysanju/Einsen），第 2 名是 **243 star 的 Flutter App**。前 20 名里**没有一个是可复用的 Web 组件库**。
   - npm registry 搜索 `eisenhower` / `priority-matrix` / `quadrant` 均未发现可用的四象限组件包（`eisenhower-ui` 是设计系统不是矩阵；`webc-matriz-eisenhower` 是零依赖 Web Component 但极小、无维护信号）。
   - 结论：**四象限视图必须自研**，但只需自研「布局 + 象限归属规则 + 持久化」这三层；拖拽交互层直接用成熟库（见第 3 节）。

2. **整机应用里没有「四象限原生支持」的成熟开源项目。** 唯一接近的是 Super Productivity（22,240 star，MIT），但它的艾森豪威尔能力是**用通用「自定义看板」配出 4 列**，不是原生象限视图 —— 这是厂商自己在官网写的原话，不是第三方推断。其余整机应用（Vikunja / Planka / Focalboard / Kanboard / WeKan / Plane / Huly）都只有看板 + 甘特 + 列表，没有象限概念。

3. **真正值得抄的是三类东西**：
   - **交互底座**：`dnd-kit`（MIT，17,667 star）或 `SortableJS`（MIT，31,183 star）—— 2×2 拖拽矩阵自己写 200~400 行就能跑通。
   - **数据模型参考**：`harin/todoist-matrix`（MIT，把 Todoist 任务映射成优先级矩阵视图）与 `vscarpenter/gsd-task-manager`（MIT，Next.js，四象限 + MCP server）—— 这两个是「给已有任务系统加一个矩阵视图」的最贴近范式。
   - **其他视图**：甘特用 `frappe/gantt`（MIT，6,127 star）或 `xpyjs/gantt`（MIT，Canvas 渲染，性能好）；日历用 `fullcalendar`（MIT，20,653 star）或 `schedule-x`（MIT，2,585 star）；时间轴用 `vis-timeline`（Apache-2.0 OR MIT 双许可）。

4. **许可雷区必须避开**：Planka（自定义社区许可，禁止对第三方商业托管）、Focalboard（源码 AGPL-3.0 / 商业双许可，且 README 明写已停止维护）、TaskView（Source-Available，禁止 SaaS 与竞品）、以及一批**根目录完全没有 LICENSE 文件**的小项目（法律上默认保留所有权利，一行代码都不能抄）。

---

## 1. 专用四象限 / 艾森豪威尔应用与示例（表 A）

按 star 降序。全部为 ghinfo.py 2026-09-25 实测值。

| 项目 | 仓库 | Star（2026-09-25 实测） | License | 技术栈 | 活跃度 | 对应滴答功能点 | 集成方式 |
|---|---|---|---|---|---|---|---|
| Einsen | https://github.com/Spikeysanju/Einsen | **919** | Apache-2.0 【原文核实】 | Kotlin 100%、Jetpack Compose、MVVM、Hilt、Coroutines Flow | last commit 2022-01-03；最新 release v1.0.0-alpha04（2021-11-26）；archived=false（但 4 年无提交，等同停更） | 四象限原生 UI + 任务优先级流转 | **参考实现**。Android 原生，Web 端无法复用；UI 信息架构（象限卡片 / 空态 / 优先级色）值得抄 |
| Focus | https://github.com/Appaxaap/Focus | **243** | GPL-3.0 【原文核实】 | Dart/Flutter 88.8%，Android + Windows 离线优先 | last commit 2026-08-23；最新 release「Focus Android v2.2.8」2026-08-21；archived=false | 离线优先的四象限任务管理、Android/桌面双端 | **参考实现 / 谨慎 fork**。GPL-3.0 强 copyleft，闭源商用产品不能链入 |
| Zen. | https://github.com/jesusantguerrero/zen | **40** | GPL-3.0 【脚本】 | Vue 3 74.5% + Firebase | last commit 2026-04-18；最新 release 2023-09-26；archived=false | 四象限 + 番茄钟 + GTD 流程整合 | 参考实现（GPL 传染，仅可读不可抄） |
| eisenhower-matrix (web app) | https://github.com/antoinechampion/eisenhower-matrix | **33** | MIT 【原文核实】 | Java 59%（后端）+ Web 前端 | last commit 2026-07-09；无 release；archived=false | 独立 Web 四象限应用 | **参考实现**，MIT 可自由借鉴代码 |
| Priority_Matrix | https://github.com/DuskWasHere/Priority_Matrix | **32** | MIT 【脚本】 | JavaScript 99.8%（Obsidian 插件） | last commit 2026-01-25；无 release；archived=false | 无限象限数 + 自定义颜色 + 自定义归入规则 | 参考实现 |
| gsd-task-manager | https://github.com/vscarpenter/gsd-task-manager | **26** | MIT 【脚本】 | TypeScript 77.6%，Next.js，含 MCP server | last commit 2026-09-25（当天）；最新 release mcp-v1.2.8 2026-09-25；archived=false —— **本表最活跃** | 「紧急 / 重要」二维排序 + 全离线 + MCP 接口 | **参考实现 / 可直接 fork**。Web 技术栈与本项目一致，是最佳的象限交互与数据模型样板 |
| Eisen-Matrix | https://github.com/G3root/Eisen-Matrix | **21** | MIT 【脚本】 | TypeScript 99.5%、React Native + Expo + Zustand + Emotion | last commit 2022-02-09；release v1.2.0 2022-02-09；archived=false | 移动端四象限任务流 | 参考实现（已停更 4 年） |
| jarvis-ai-calendar | https://github.com/jilmiy/jarvis-ai-calendar | **19** | **未核实（根目录无 LICENSE 文件）** | JavaScript 76%、Electron 桌面日历 | last commit 2026-07-05；release v1.1.1 2026-07-05；archived=false | 桌面日历 + 待办 + **四象限** + 倒计时 + AI 周报（中文产品，最贴近滴答清单形态） | **不可复用代码**（无许可证＝默认保留所有权利）；仅可作为**产品形态参考** |
| iTasks | https://github.com/alsiam/iTasks | **18** | MIT 【脚本】 | TypeScript 92.8%、Next.js 14 + shadcn/ui | last commit 2024-01-30；无 release | 无登录、纯本地存储的四象限 + 笔记 | 参考实现 |
| schmetzyannick/EisenhowerMatrix | https://github.com/schmetzyannick/EisenhowerMatrix | **12** | MIT 【脚本】 | TypeScript 74.3% | last commit 2023-02-25；release v1.0.0-beta1；**archived=true** | 四象限矩阵 | 参考实现（已归档） |
| eisen-tickets | https://github.com/dat-adi/eisen-tickets | **10** | MIT 【脚本】 | Python 100%、Tkinter + SQLite3 | last commit 2021-05-22；release v1.0.0 2020-08-15 | 四象限 + 工单化 | 参考实现（已停更） |
| eisenlist | https://github.com/adityaketkar/eisenlist | **10** | MIT 【脚本】 | JavaScript 79.5%、React | last commit 2020-06-08；无 release | 浏览器内响应式四象限 | 参考实现（已停更） |
| vitodo | https://github.com/dybdeskarphet/vitodo | **8** | GPL-3.0 【脚本】 | Python 100%、todo.txt 格式、CLI | last commit 2026-01-30；release v0.1.0 2026-01-28；archived=false | **todo.txt → 四象限可视化**（把已有任务文件渲染成矩阵的范式） | 参考实现（GPL） |
| Priorizer | https://github.com/attuo/Priorizer | **6** | MIT 【脚本】 | JavaScript 76.3%、React | last commit 2021-01-31；无 release | 四象限 PoC | 参考实现（已停更） |
| priority-matrix (d3) | https://github.com/uptownnickbrown/priority-matrix | **6** | MIT 【原文核实】（内附 d3 为 BSD-3-Clause） | JavaScript + d3 | last commit 2017-11-28；无 release | 四象限可视化 | 参考实现（很老） |
| Gridflow | https://github.com/maaatheeew/Gridflow | **6** | MIT 【脚本】 | Swift 95.9%、SwiftUI、macOS | last commit 2026-07-23；release 1.0.0 2026-03-23；archived=false | 极简 macOS 四象限规划器 | 参考实现（Apple 平台） |
| priority-matrix-obsidian | https://github.com/dipendave/priority-matrix-obsidian | **6** | MIT 【脚本】 | TypeScript 84.6% | last commit 2026-05-17；release 2.0.3 2026-05-17 | 按紧急度/重要性可视化排序 | 参考实现 |
| prioritymatrix-obsidian | https://github.com/murtazaraza/prioritymatrix-obsidian | **3** | MIT 【脚本】 | TypeScript 92.8% | last commit 2026-05-21；release 1.0.7 2026-05-19 | 从 vault 自动识别任务并分象限 | 参考实现 |
| DoMatrix | https://github.com/BaherTamer/DoMatrix | **2** | MIT 【脚本】 | Swift 100%、SwiftUI + SwiftData | last commit 2023-11-07；**archived=true** | iOS 四象限待办 | 参考实现（已归档） |
| todoist-matrix | https://github.com/harin/todoist-matrix | **2** | MIT 【脚本】 | JavaScript 75.9% | last commit 2018-05-05；无 release | **「优先级矩阵视图」作为 Todoist 之上的视图层** —— 与本项目「给任务系统加矩阵视图」的诉求完全同构 | **参考实现（架构范式首选）**。代码太老，只抄「视图层不改数据层」的设计 |
| Eisenhower NewTab Planner | https://github.com/ShumonX/Eisenhower-NewTab-Planner | **0** | MIT 【脚本】 | CSS 51.4% | last commit 2026-09-21；无 release | 新标签页四象限 | 参考 |
| priority-matrix (单文件) | https://github.com/OmerShubi/priority-matrix | **0** | MIT 【脚本】 | HTML 100%、vanilla JS、localStorage | last commit 2026-07-05；无 release | 单文件零构建四象限 | 参考（最简实现） |
| time-matrix-app | https://github.com/qshaiya/time-matrix-app | **0** | **未核实（根目录无 LICENSE 文件）** | React + Vite + 拖拽，双视图（四象限 / 列表） | last commit 2026-06-19；无 release | **四象限与列表双视图切换** | 仅产品参考，代码不可用 |
| kubarium/eisenhower-box | https://github.com/kubarium/eisenhower-box | **1** | **未核实（根目录无 LICENSE 文件）** | Vue 2 61.1% + Vuex + localStorage | last commit 2018-12-05 | 四象限 | 代码不可用 |
| erictherobot/eisenhower-matrix | https://github.com/erictherobot/eisenhower-matrix | **2** | **未核实（根目录无 LICENSE 文件）** | TypeScript 87.2% | last commit 2023-06-17 | 四象限 | 代码不可用 |
| DGSConsulting/priority-matrix-builder | https://github.com/DGSConsulting/priority-matrix-builder | **2** | **未核实（根目录无 LICENSE 文件）** | HTML 100%、单文件离线 | last commit 2025-09-11 | 面向自由职业者的象限工具 | 代码不可用 |
| Prioritize-Like-Ike | https://github.com/padey/Prioritize-Like-Ike | **0** | **未核实（根目录无 LICENSE 文件）** | HTML 71.7% | last commit 2025-05-09 | 隐私友好的四象限 | 代码不可用 |

### 表 A 关键判读
- **没有一个项目同时满足「Web 技术栈 + MIT/Apache + 活跃维护 + 四象限原生」**。最接近的是 `vscarpenter/gsd-task-manager`（MIT + Next.js + 当天有提交），但只有 26 star，属于个人项目，不能当依赖，只能当样板。
- 头部 star 全部集中在**移动端原生 App**（Einsen 919 / Focus 243），说明「四象限」这个需求在开源社区主要被当作**练手项目题材**，而不是被当作**可复用的基础设施**。
- 存在明显的「一次性项目」特征：22 个候选里 **archived 或超过 2 年无提交的有 12 个**（约 55%）。

---

## 2. 可承载四象限视图的开源任务 / 看板系统（表 B）

这些项目本身没有四象限视图，但可作为「四象限视图的宿主」或后端/数据模型参考。

| 项目 | 仓库 | Star（2026-09-25 实测） | License | 技术栈 | 活跃度 | 对应滴答功能点 | 集成方式 |
|---|---|---|---|---|---|---|---|
| Super Productivity | https://github.com/super-productivity/super-productivity | **22,240** | MIT 【原文核实】 | TypeScript 90.4%、Angular + Electron + Capacitor（全平台） | last commit 2026-09-24；release v19.1.0 2026-09-19；archived=false | **自定义看板可配置成四象限**（Do / Schedule / Delegate / Delete）＋ 时间追踪 ＋ Jira/GitHub 集成。厂商官网原文：*"Super Productivity supports the Eisenhower Matrix through its customizable boards feature"* —— **注意这是「看板 4 列」而非原生象限视图**，是厂商自述，非代码级核实 | **参考实现 / 直接 fork**（MIT）。是整机方案里最值得研究的对象 |
| AppFlowy | https://github.com/AppFlowy-IO/AppFlowy | **76,916** | AGPL-3.0 【脚本】 | Dart 73.6% / Flutter + Rust | last commit 2026-06-26；release v0.14.5 2026-09-25；archived=false | 看板 / 日历 / 网格多视图数据库 | 服务集成或参考；**AGPL-3.0 强 copyleft，闭源 SaaS 不可链入** |
| Plane | https://github.com/makeplane/plane | **59,856** | AGPL-3.0 【脚本】 | TypeScript 69.4%、React + Django | last commit 2026-09-24；release v1.4.2 2026-08-23；archived=false | Kanban + Gantt + 周期视图 | 参考（AGPL） |
| Logseq | https://github.com/logseq/logseq | **45,053** | AGPL-3.0 【脚本】 | ClojureScript 70.4% | last commit 2026-09-24；nightly release 2026-09-24；archived=false | 大纲式任务 + 插件生态 | 参考（AGPL） |
| Huly | https://github.com/hcengineering/platform | **27,775** | EPL-2.0 【脚本】 | TypeScript 61.3% | last commit 2026-09-25；release s0.7.437 2026-08-01；archived=false | 看板 / 甘特 / 时间轴 | **服务集成**（EPL-2.0 是弱 copyleft，链接不传染，可作独立服务调用） |
| Focalboard | https://github.com/mattermost-community/focalboard | **26,486** | **自定义双许可**【原文核实】：Mattermost 编译版为 MIT；源码可用 AGPL-3.0 或商业授权；Admin Tools/配置文件为 Apache-2.0 | TypeScript 54.0% + Go | last commit 2025-06-11；release v8.0.0 2024-06-17；archived=false 但 **README 首行明写 "This repository is currently not maintained"** | 看板（Trello/Notion 替代） | **不建议**。已停止维护 + 许可复杂 |
| Wekan | https://github.com/wekan/wekan | **21,094** | MIT 【脚本】 | JavaScript 78.4%、Meteor | last commit 2026-09-25；release v12.01 2026-09-25；archived=false | 看板 + 泳道 + 实时协作 | **可直接 fork**（MIT）。注意：其 README 声明 GitHub Issues 只面向 FLOSS 开发者，商业支持需付费 |
| OpenProject | https://github.com/opf/openproject | **16,202** | GPL-3.0 【脚本】 | Ruby 78.8% + Angular | last commit 2026-09-25；release 17.8.0 2026-09-02；archived=false | **甘特图 + 看板 + 路线图 + 时间追踪** | 参考（GPL-3.0）；功能最全但极重 |
| Planka | https://github.com/plankanban/planka | **12,579** | **自定义「PLANKA Community License」v1.1**【原文核实】——**非 OSI 开源** | JavaScript 95.2% | last commit 2026-09-17；release v2.2.1 2026-08-10；archived=false | 优雅的自托管看板 | **禁止商用托管**。许可原文：*"operating PLANKA as a hosted service for third parties for any commercial gain whatsoever is prohibited"*；内部使用 / 个人 / 教育可用。做商业产品**不能选** |
| Leantime | https://github.com/leantime/leantime | **11,655** | AGPL-3.0 【脚本】 | PHP 48.2% | last commit 2026-09-24；release v3.10.0 2026-09-24；archived=false | 甘特 + 看板 + 目标 | 参考（AGPL） |
| Kanboard | https://github.com/kanboard/kanboard | **9,883** | MIT 【脚本】 | PHP 97.7% | last commit 2026-09-11；release 1.2.54 2026-08-29；archived=false | 极简看板 + WIP 限制 | **可直接 fork**（MIT）。后端简单，适合做自托管看板 |
| Kaneo | https://github.com/usekaneo/kaneo | **9,186** | MIT 【脚本】 | TypeScript 89.0%、React + Hono | last commit 2026-09-25；release v2.27.0 2026-09-24；archived=false | 现代看板 + MCP | **可直接 fork**（MIT）。技术栈现代（React + TS），是看板视图的优选样板 |
| Vikunja | https://github.com/go-vikunja/vikunja | **5,503** | **AGPL-3.0-or-later**（README 明示；`desktop/` 目录为 **GPL-3.0-or-later**）【原文核实 README】 | Go 66.3% + Vue | last commit 2026-09-24；release v2.6.0 2026-08-31；archived=false | 看板 / 列表 / 表格 / 日历多视图 | 参考（AGPL）。注意仓库地址已从 `vikunja/vikunja` 迁移到 **`go-vikunja/vikunja`**，旧地址返回 404 |
| Taskcafe | https://github.com/JordanKnott/taskcafe | **5,215** | MIT 【脚本】 | TypeScript 83.0% + Go + GraphQL | last commit 2022-09-02；release 0.3.6 2021-09-13；archived=false（**实际已停更 4 年**） | 看板 + My Tasks | 不建议（停更） |
| Kanri | https://github.com/kanriapp/kanri | **2,036** | GPL-3.0 【脚本】 | Vue 92.0% + Nuxt + Tauri | last commit 2026-07-15；release v0.8.2 2025-09-24；archived=false | 离线优先桌面看板 | 参考（GPL） |
| Restyaboard | https://github.com/RestyaPlatform/board | **2,089** | OSL-3.0 【脚本】 | JavaScript 67.3% | last commit 2022-03-12；release v1.7.1 2022-03-16 | 看板 | 不建议（停更 + OSL-3.0 copyleft） |
| Tegon | https://github.com/tegonhq/tegon | **1,912** | AGPL-3.0 【脚本】 | TypeScript 97.9% | last commit 2025-03-30；**archived=true** | 看板 | 不建议（已归档） |
| TaskView | https://github.com/Gimanh/taskview-community | **730** | **自定义「TaskView Source-Available License」v1.0**【原文核实】——**非开源** | TypeScript 67.6% | last commit 2026-09-22；release v1.56.0 2026-09-22 | 看板 + 图形视图 | **禁止**。许可原文明确 *"explicitly prohibiting SaaS / managed hosting of TaskView for third parties"* 与 *"prohibiting competing commercial products"* |
| Taiga Front | https://github.com/taigaio/taiga-front | **378** | AGPL-3.0 【脚本】 | CoffeeScript 52.8% | last commit 2026-09-04；release 6.10.3 2026-05-14 | 看板 + 冲刺 | 参考（AGPL） |

### 表 B 关键判读
- **没有原生四象限**：上述 20 个整机项目里，四象限需要自己用「看板 4 列」模拟，唯一把这件事写进官方文档的是 Super Productivity。
- **MIT 且活跃、技术栈现代、值得抄的**：`usekaneo/kaneo`（React + Hono，9,186 star）、`super-productivity`（Angular，22,240 star）、`wekan`（Meteor，老但活跃）、`kanboard`（PHP，简单）。
- **AGPL 一票否决**：AppFlowy / Plane / Logseq / Vikunja / Leantime / Taiga / Tegon。若产品是闭源 SaaS，AGPL 的网络分发条款会强制开源整个服务端，不能用。
- **伪开源雷区**：Planka、TaskView、Focalboard。三者都不属于 OSI 认可的开源许可。

---

## 3. 其他可视化视图（看板 / 时间轴 / 甘特 / 日历）可复用组件库（表 C）

**这是本模块中真正能「直接拿来用」的部分。**

### 3.1 拖拽交互底座（四象限与看板共用）

| 项目 | 仓库 | Star（2026-09-25 实测） | License | 技术栈 | 活跃度 | 对应滴答功能点 | 集成方式 |
|---|---|---|---|---|---|---|---|
| dnd-kit | https://github.com/clauderic/dnd-kit | **17,667** | MIT 【脚本】 | TypeScript 60.7%，React / Vue / Svelte 多框架 | last commit 2026-09-12；release @dnd-kit/vue@0.5.0 2026-06-11；archived=false | **2×2 象限拖拽 + 看板列拖拽的通用底座**；支持键盘无障碍、虚拟化、跨容器拖拽 | **库（本模块首选）**。四象限只需要它 + CSS Grid，无需引入任何矩阵组件 |
| SortableJS | https://github.com/SortableJS/Sortable | **31,183** | MIT 【脚本】 | JavaScript 95.5%，零框架依赖 | last commit 2026-03-24；release v1.15.7 2026-02-11；archived=false | 轻量拖拽排序，可做象限间移动 | **库**。体积小、无框架绑定，适合非 React 前端 |
| Pragmatic Drag and Drop | https://github.com/atlassian/pragmatic-drag-and-drop | **12,771** | Apache-2.0 【原文核实】 | TypeScript 96.3% | last commit 2026-09-25（当天）；无 release；archived=false | 高性能拖拽底座，Atlassian 官方替代 react-beautiful-dnd | **库**。性能与体积优于 dnd-kit，但 API 更底层，需自己实现排序逻辑 |
| hello-pangea/dnd | https://github.com/hello-pangea/dnd | **4,027** | Apache-2.0 【原文核实】 | TypeScript 98.9%、React | last commit 2026-02-13；release 18.0.1 2025-02-09；archived=false | 列表 / 看板拖拽（react-beautiful-dnd 的社区继任者） | **库**。仅 React，仅列表语义；做四象限需自己拆 4 个 Droppable |
| svelte-dnd-action | https://github.com/isaacHagoel/svelte-dnd-action | **2,125** | MIT 【脚本】 | JavaScript 100%、Svelte | last commit 2026-08-21；无 release；archived=false | Svelte 生态的拖拽（含跨列表） | 库（仅当技术栈是 Svelte） |
| react-beautiful-dnd | https://github.com/atlassian/react-beautiful-dnd | **33,931** | Apache-2.0 【原文核实】 | JavaScript 100%、React | last commit 2025-08-18；release v13.1.1（2022-08-30）；**archived=true** | 看板拖拽 | **不推荐**（官方已归档，Atlassian 转向 pragmatic-drag-and-drop） |
| Vue.Draggable | https://github.com/SortableJS/Vue.Draggable | **20,577** | MIT 【脚本】 | Vue 2 | last commit 2022-10-05；release v2.24.3（2020-10-25）；archived=false（停更） | Vue 2 拖拽 | 不推荐（Vue 2 已 EOL） |

### 3.2 现成看板组件（可直接嵌入）

| 项目 | 仓库 | Star（2026-09-25 实测） | License | 技术栈 | 活跃度 | 对应滴答功能点 | 集成方式 |
|---|---|---|---|---|---|---|---|
| react-trello | https://github.com/rcdexta/react-trello | **2,263** | MIT 【脚本】 | JavaScript 99.6%、React | last commit 2023-03-15；release v2.2.11（2021-06-24）；archived=false（停更） | 可插拔 Trello 风格看板组件 | 参考实现。设计可借鉴，不建议新项目依赖 |
| jKanban | https://github.com/riktar/jkanban | **1,158** | Apache-2.0 【脚本】 | JavaScript 86.8%、vanilla | last commit 2021-12-03；release v1.3.1（2020-12-17）；archived=false（停更） | 零依赖看板插件 | 参考实现（停更 5 年） |
| react-kanban | https://github.com/asseinfo/react-kanban | **648** | MIT 【脚本】 | JavaScript 98.3%、React | last commit 2022-10-08；**archived=true** | 看板组件 | 不推荐（已归档） |
| react-kanban-kit | https://github.com/braiekhazem/react-kanban-kit | **95** | Apache-2.0 【原文核实】 | TypeScript 58.1%、React，基于 Atlassian pragmatic-drag-and-drop | last commit 2026-04-21；release v0.0.2-beta.7；archived=false | 可定制看板 + 列拖拽 + 无限滚动 | 库（beta 阶段，谨慎评估） |
| SVAR React Kanban | https://github.com/svar-widgets/react-kanban | **16** | MIT 【原文核实 license.txt】 | JavaScript 85.9%、React + TS | last commit 2026-06-23；release v2.6.0 2026-06-23；archived=false | 拖拽看板 + 卡片编辑器 + REST 数据源 | 库。**注意：仓库代码 MIT，但 PDF/PNG/Excel 导出、动态加载、撤销重做属付费 PRO 版**，集成时不要误引入 PRO 代码 |

### 3.3 甘特图组件

| 项目 | 仓库 | Star（2026-09-25 实测） | License | 技术栈 | 活跃度 | 对应滴答功能点 | 集成方式 |
|---|---|---|---|---|---|---|---|
| frappe-gantt | https://github.com/frappe/gantt | **6,127** | MIT 【原文核实】 | JavaScript 75.4%、SVG | last commit 2026-03-05；release v1.0.3 2025-02-03；archived=false | 甘特图（任务条拖拽改期、依赖箭头、进度） | **库（甘特首选）**。生态最大，有 React/Vue 封装 |
| gantt-elastic | https://github.com/neuronetio/gantt-elastic | **1,366** | MIT 【脚本】 | Vue 68.3% | last commit 2022-01-04；**archived=true** | 响应式甘特 | 不推荐（已归档） |
| gantt-task-react | https://github.com/MaTeMaTuK/gantt-task-react | **1,098** | MIT 【脚本】 | TypeScript 92.9%、React | last commit 2023-01-09；**archived=true** | React 甘特 | 不推荐（已归档） |
| jsGantt Improved | https://github.com/jsGanttImproved/jsgantt-improved | **525** | **BSD-3-Clause**【原文核实；GitHub 标 NOASSERTION】 | TypeScript 92.7% | last commit 2026-04-14；最近 release 2019-07-17；archived=false | 全功能纯 JS/CSS 甘特，无外部依赖 | 库（BSD-3-Clause 可商用） |
| xpyjs/gantt | https://github.com/xpyjs/gantt | **351** | MIT 【原文核实】 | TypeScript 96.3%、**Canvas 渲染**，支持 Vue/React/vanilla | last commit 2026-08-28；release v0.1.3 2026-08-28；archived=false | 大数据量甘特（Canvas 性能优势） | **库（大数据量首选）**。中文文档 |
| ngx-gantt | https://github.com/worktile/ngx-gantt | **304** | MIT 【原文核实】 | TypeScript 74.8%、Angular | last commit 2026-09-10；release v22.0.0 2026-09-10；archived=false | 甘特（含虚拟滚动、多视图） | 库（仅 Angular） |
| SVAR Svelte Gantt | https://github.com/svar-widgets/gantt | **260** | MIT 【脚本】 | TypeScript 45.1%、Svelte | last commit 2026-09-09；release v2.7.3 2026-09-09；archived=false | 轻量甘特 | 库（Svelte） |
| IBM Gantt Chart | https://github.com/IBM/gantt-chart | **247** | Apache-2.0 【脚本】 | JavaScript 84.0%，vanilla/jQuery/React | last commit 2024-10-17；release v0.5.11（2021-03-02）；archived=false（停更） | 甘特 | 参考（已停更） |
| SVAR React Gantt | https://github.com/svar-widgets/react-gantt | **212** | MIT 【原文核实 license.txt】 | JavaScript 79.2%、React 19 + TS | last commit 2026-09-09；release v2.7.3 2026-09-09；archived=false | 高性能 React 甘特 | 库（**PRO 版收费**，同 react-kanban） |
| vue3-gantt | https://github.com/ddmy/vue3-gantt | **123** | Apache-2.0 【脚本】 | JavaScript 50.3%、Vue 3 | last commit 2023-12-07；release v1.1.8-1（2023-05-17）；archived=false（停更） | Vue3 甘特 + Excel 导出 | 参考（停更） |
| vue-ganttastic | https://github.com/zunnzunn/vue-ganttastic | **718** | **未核实**：`package.json` 声明 `"license": "MIT"`，但**仓库根目录无 LICENSE 文件**（curl 逐一尝试 LICENSE / LICENSE.md / LICENSE.txt / license / COPYING / LICENCE / license.txt 均 404） | TypeScript 49.1%、Vue 3 | last commit 2024-05-19；release v2.3.2 2024-03-30 | Vue3 甘特 | **谨慎**。npm 声明 MIT 但仓库缺许可证文件，法务上存在不确定性 |
| svelte-gantt | https://github.com/ANovokmet/svelte-gantt | **622** | MIT 【脚本】 | Svelte 60.6% | last commit 2025-02-10；无 release；archived=false | 甘特 + 资源预订 | 库（Svelte） |
| react-timeline-gantt | https://github.com/guiqui/react-timeline-gantt | **588** | MIT 【脚本】 | JavaScript 93.9%、React，虚拟渲染 | last commit 2023-10-25；无 release；archived=false（停更） | 时间轴 + 甘特（虚拟滚动） | 参考 |
| planner (bvaughn) | https://github.com/bvaughn/planner | **568** | MIT 【脚本】 | JavaScript 95.6%、HTML Canvas | last commit 2023-04-17；无 release | Canvas 任务时间规划 | 参考实现 |
| Markwhen | https://github.com/mark-when/markwhen | **4,872** | MIT 【脚本】 | HTML 61.4%、JS | last commit 2023-12-11；无 release | **Markdown 文本 → 时间轴 / 甘特 / 日历** | 参考实现。文本驱动视图的思路很适合任务应用 |
| gantt-for-react | https://github.com/hustcc/gantt-for-react | **327** | MIT 【脚本】 | JavaScript 89.3%、React 封装 frappe-gantt | last commit 2019-02-12；无 release | React 甘特封装 | 不推荐（7 年未更新） |

### 3.4 时间轴 / 日历组件

| 项目 | 仓库 | Star（2026-09-25 实测） | License | 技术栈 | 活跃度 | 对应滴答功能点 | 集成方式 |
|---|---|---|---|---|---|---|---|
| React Flow / Svelte Flow (xyflow) | https://github.com/xyflow/xyflow | **38,490** | MIT 【脚本】 | TypeScript 85.5%、React + Svelte | last commit 2026-09-24；release @xyflow/system@0.0.83 2026-09-24；archived=false | 节点式 UI（任务依赖图 / 思维导图视图） | 库 |
| FullCalendar | https://github.com/fullcalendar/fullcalendar | **20,653** | MIT 【脚本】 | TypeScript 82.2% | last commit 2026-09-05；release v7.1.0 2026-09-05；archived=false | 日历视图（拖拽改期、事件、多视图） | **库（日历首选）** |
| tui.calendar | https://github.com/nhn/tui.calendar | **12,697** | MIT 【脚本】 | TypeScript 86.9% | last commit 2023-02-09；**archived=true** | 日历（日/周/月/里程碑） | 不推荐（已归档） |
| react-chrono | https://github.com/prabhuignoto/react-chrono | **4,203** | MIT 【脚本】 | TypeScript 78.2%、React | last commit 2025-12-29；release 3.3.3 2025-12-17；archived=false | 时间轴组件（横向/纵向/幻灯片） | 库 |
| Schedule-X | https://github.com/schedule-x/schedule-x | **2,585** | MIT 【脚本】 | TypeScript 90.0%，React/Vue/Svelte/Angular/vanilla | last commit 2026-09-11；release v4.8.0 2026-09-08；archived=false | 现代日历（FullCalendar 替代） | **库（日历备选）**。多框架支持最全 |
| vis-timeline | https://github.com/visjs/vis-timeline | **2,559** | **Apache-2.0 OR MIT（双许可，可任选）**【原文核实 `LICENSE.md`：`SPDX-License-Identifier: Apache-2.0 OR MIT`】 | JavaScript 93.3% | last commit 2026-08-22；release v8.5.4 2026-08-12；archived=false | 可交互时间轴 + 2D 图（任务条可拖拽/缩放） | **库（时间轴首选）**。双许可对商用最友好 |

---

## 4. Obsidian 插件生态（表 D）

> 前提说明：**Obsidian 本体闭源且非开源软件**，其插件生态只在「交互与数据模型参考」层面有价值，不能作为自研产品的依赖。以下插件均为独立仓库，可单独阅读源码。

| 项目 | 仓库 | Star（2026-09-25 实测） | License | 技术栈 | 活跃度 | 对应滴答功能点 | 集成方式 |
|---|---|---|---|---|---|---|---|
| Obsidian Kanban | https://github.com/obsidian-community/obsidian-kanban | **4,517** | GPL-3.0 【脚本】 | TypeScript 86.9% | last commit 2026-03-06；release 2.0.51（2024-05-31）；archived=false | Markdown 驱动的看板（拖拽改状态即改文件） | 参考实现（GPL） |
| dotpm (Obsidian PM) | https://github.com/dotpm/obsidian-pm | **724** | MIT 【脚本】 | TypeScript 93.9% | last commit 2026-09-22；release 2.5.2 2026-09-21；archived=false | **表格 / 甘特 / 看板三视图并存于同一数据集** —— 「多视图切换」架构的最佳参考 | **参考实现（本模块最值得读的一个）** |
| Markwhen Obsidian Plugin | https://github.com/mark-when/obsidian-plugin | **444** | MIT 【脚本】 | TypeScript 96.9% | last commit 2026-05-14；release 0.0.7 2025-07-14 | 文本 → 时间轴 / 甘特 / 日历 | 参考实现 |
| eisenhower-matrix-obsidian | https://github.com/oamadorr/eisenhower-matrix-obsidian | **2** | MIT 【脚本】 | JavaScript 70.6% | last commit 2026-03-17；release 1.0.0 2026-03-17 | 四象限任务整理 | 参考实现 |
| priority-matrix-obsidian | https://github.com/dipendave/priority-matrix-obsidian | **6** | MIT 【脚本】 | TypeScript 84.6% | last commit 2026-05-17；release 2.0.3 2026-05-17 | 按紧急/重要可视化 | 参考实现 |
| prioritymatrix-obsidian | https://github.com/murtazaraza/prioritymatrix-obsidian | **3** | MIT 【脚本】 | TypeScript 92.8% | last commit 2026-05-21；release 1.0.7 2026-05-19 | 自动从 vault 抓任务进矩阵 | 参考实现 |
| obsidian-focus-first | https://github.com/christian-luger-at/obsidian-focus-first | **2** | MIT 【脚本】 | TypeScript 84.5% | last commit 2026-09-12；release 1.6.15 2026-09-06；archived=false | **按截止日期 + 优先级自动分象限**（自动归类规则，而非纯手工拖拽） | 参考实现 |
| obsidian-eisenhower-matrix-blocks | https://github.com/AngusK97/obsidian-eisenhower-matrix-blocks | **1** | MIT 【脚本】 | JavaScript 93.8% | last commit 2026-09-24；release 2.8.2 2026-09-24；archived=false | 可嵌入任意笔记的独立矩阵块 | 参考实现 |
| 4D Eisenhower Matrix | https://github.com/krcaljaroslav/4D-eisenhower-matrix | **1** | MIT 【脚本】 | TypeScript 88.5% | last commit 2026-09-19；release 1.0.39 2026-09-19；archived=false | **5 象限**扩展模型（DO / DECIDE / DELEGATE / DELETE + 第 5 类） | 参考实现（象限模型扩展思路） |
| Eisenhower Matrix for Bases | https://github.com/nakaba-lab/eisenhower-bases-view | **0** | MIT 【脚本】 | TypeScript 84.1% | last commit 2026-07-13；release 0.2.2 2026-07-13 | 矩阵视图 + 拖拽卡片直接改写笔记属性 | 参考实现 |

**Obsidian 生态的额外发现**：`obsidianmd/obsidian-releases` 的 `community-plugins.json`（2026-09-25 拉取）里，**艾森豪威尔矩阵相关插件至少有 12 个**（oamadorr / murtazaraza / dipendave / christian-luger-at / AngusK97 / krcaljaroslav / siranhq / bugrasitemkar / jmerryman-eng / nakaba-lab / xuhuaya0 / hotee11）。**全部 star ≤ 6，全部是个人作品** —— 这再次印证了「四象限开源生态极度碎片化、无成熟实现」的结论。

---

## 5. 明确不可用 / 许可陷阱清单（表 E）

| 项目 | 仓库 | 问题类型 | 原文证据（curl 核实） |
|---|---|---|---|
| Planka | https://github.com/plankanban/planka | **非 OSI 开源 + 禁止商业托管** | `LICENSE.md`：「PLANKA Community License v1.1」；Restricted Use 条款原文：*"operating PLANKA as a hosted service for third parties for any commercial gain whatsoever is prohibited"*。商业产品**不可用** |
| Focalboard | https://github.com/mattermost-community/focalboard | **已停止维护 + 许可复杂** | `README.md` 首行：*"This repository is currently not maintained."*；`LICENSE.txt`：编译版 MIT / 源码 AGPL-3.0 或商业授权 / Admin Tools 与配置文件 Apache-2.0 三段式 |
| TaskView | https://github.com/Gimanh/taskview-community | **Source-Available，禁止 SaaS 与竞品** | `LICENSE.md`：*"explicitly prohibiting SaaS / managed hosting of TaskView for third parties"*、*"explicitly prohibiting competing commercial products"* |
| jarvis-ai-calendar | https://github.com/jilmiy/jarvis-ai-calendar | **根目录无 LICENSE 文件** | curl 尝试 LICENSE / LICENSE.md / LICENSE.txt / license / COPYING / LICENCE / license.txt 全部 404。法律上默认「保留所有权利」 |
| erictherobot/eisenhower-matrix | https://github.com/erictherobot/eisenhower-matrix | 同上 | 同上（无 LICENSE 文件） |
| DGSConsulting/priority-matrix-builder | https://github.com/DGSConsulting/priority-matrix-builder | 同上 | 同上 |
| kubarium/eisenhower-box | https://github.com/kubarium/eisenhower-box | 同上 | 同上 |
| padey/Prioritize-Like-Ike | https://github.com/padey/Prioritize-Like-Ike | 同上 | 同上 |
| qshaiya/time-matrix-app | https://github.com/qshaiya/time-matrix-app | 同上 | 同上 |
| vue-ganttastic | https://github.com/zunnzunn/vue-ganttastic | **许可证不一致** | `package.json` 写 `"license": "MIT"`，但仓库根目录无任何 LICENSE 文件（curl 核实）。法务风险 |
| react-beautiful-dnd | https://github.com/atlassian/react-beautiful-dnd | **已归档** | `archived=true`（2025-08-18 最后一次提交）；官方已转向 pragmatic-drag-and-drop |
| tui.calendar | https://github.com/nhn/tui.calendar | 已归档 | `archived=true`；最后提交 2023-02-09 |
| react-kanban / gantt-task-react / gantt-elastic / tegon | asseinfo / MaTeMaTuK / neuronetio / tegonhq | 已归档 | 均 `archived=true` |

**AGPL-3.0 清单（闭源 SaaS 一票否决）**：AppFlowy、Plane、Logseq、Vikunja（主仓）、Leantime、Taiga Front、Tegon。
**GPL-3.0 清单（闭源产品不可链入）**：Focus、Zen.、vitodo、OpenProject、Kanri、Obsidian Kanban、todo.txt-cli、topydo。（注：Einsen 是 Apache-2.0，不在 GPL 之列，可自由商用。）
**弱 copyleft / 可商用**：EPL-2.0（Huly）、OSL-3.0（Restyaboard，仍属 copyleft，慎用）、Apache-2.0 / MIT / BSD-3-Clause 系列可自由商用。

---

## 6. 未核实项与证据边界（必须与已核实内容区分）

**已 curl 核实（可直接采信）**
- 所有 Star / forks / archived / last commit / latest release / top_lang：`ghinfo.py` 于 2026-09-25 实测。
- 以下 License 正文已读原文：Einsen（Apache-2.0）、Focus（GPL-3.0）、antoinechampion/eisenhower-matrix（MIT）、uptownnickbrown/priority-matrix（MIT + d3 BSD-3）、hello-pangea/dnd（Apache-2.0）、pragmatic-drag-and-drop（Apache-2.0）、react-beautiful-dnd（Apache-2.0）、braiekhazem/react-kanban-kit（Apache-2.0）、vis-timeline（Apache-2.0 OR MIT）、frappe/gantt（MIT）、DHTMLX/gantt（MIT）、xpyjs/gantt（MIT）、worktile/ngx-gantt（MIT）、SVAR react-gantt / react-kanban（MIT，license.txt）、jsGanttImproved（BSD-3-Clause）、Planka（自定义社区许可）、Focalboard（三段式双许可）、TaskView（Source-Available）、Vikunja README（AGPL-3.0-or-later + desktop/ GPL-3.0-or-later）。

**未核实 / 仅为搜索摘要所见，未采信**
- Super Productivity「内置 Eisenhower Matrix 视图」的**宣传口径**：搜索摘要称 "Built-in Eisenhower Matrix view"；我实际拉取官网正文后发现其原文是 *"through its customizable boards feature"*，即**通用看板配 4 列**，并非独立原生视图。**两者矛盾时以官网正文为准**（已在上表 B 标注）。
- Focalboard「Personal Desktop 版为 MIT」的说法来自其 LICENSE.txt 原文，但我未核实编译产物中是否真的内附 `MIT-COMPILED-LICENSE.md`。
- Obsidian 社区插件页面对 `oamadorr/eisenhower-matrix-obsidian` 标注 MIT、782 次下载 —— 下载量**未核实**（插件页数据未二次拉取），MIT 已由 ghinfo.py 探测确认。
- 若干中文项目（jarvis-ai-calendar、vitodo、Gridflow）的**框架信息**来自仓库 description/topics，未逐个读 README 确认。
- `eisenhower-ui`、`webc-matriz-eisenhower` 等 npm 包只做了 registry 元数据检索，**未评估代码质量**。

**明确查不到**
- 未发现任何「React/Vue/Svelte 四象限矩阵组件库」满足：star > 500 且 MIT/Apache 且近一年有提交。**这个空位是本次调研最确定的结论。**

---

## 7. 建议的自研方案（基于以上证据）

四象限视图不必找现成库，按下面四层自己搭，工作量可控：

1. **数据层**：给任务加两个布尔/枚举维度 `important` 与 `urgent`（或直接用 priority 1-4 映射到象限）。参考 `harin/todoist-matrix` 的「视图层不改数据层」设计，以及 `christian-luger-at/obsidian-focus-first` 的**自动归类规则**（按截止日期 + 优先级自动落象限，而非纯手工拖拽）。
2. **交互层**：`dnd-kit`（MIT，17,667 star，支持 React/Vue/Svelte，含键盘无障碍）或 `SortableJS`（MIT，31,183 star，零依赖）。2×2 用 CSS Grid 布局，4 个 `useDroppable` + 卡片 `useDraggable` 即可。
3. **扩展层**：象限模型可参考 `krcaljaroslav/4D-eisenhower-matrix` 的 5 象限扩展（DO / DECIDE / DELEGATE / DELETE + 第 5 类）。
4. **其他视图复用**：
   - 看板 → 直接抄 `usekaneo/kaneo`（MIT，React + Hono）或 `super-productivity` 的自定义看板实现；
   - 甘特 → `frappe/gantt`（MIT，生态最大）或 `xpyjs/gantt`（MIT，Canvas，大数据量）；
   - 日历 → `fullcalendar`（MIT，20,653 star）；
   - 时间轴 → `vis-timeline`（Apache-2.0 OR MIT，双许可最友好）；
   - 多视图切换架构 → 读 `dotpm/obsidian-pm`（MIT，表格/甘特/看板三视图共享同一数据集）。

**许可策略**：本模块选型优先 MIT / Apache-2.0 / BSD-3-Clause；EPL-2.0 可作为独立服务；**完全回避 AGPL-3.0 / GPL-3.0 / 自定义非 OSI 许可**（若产品计划闭源商业化）。
