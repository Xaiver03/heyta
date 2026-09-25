# Part 2C —— 习惯连续天数（Streak）· 各平台本地数据库 · 跨平台框架实证 · 组件事实核验

- **核验日期**：2026-09-25（环境本地时间 `Fri Sep 25 2026`，作为"今天"用于活跃度判断）
- **核验方法（全部为本会话实际执行）**：
  1. **GitHub 公共 HTML + `commits.atom` / `releases.atom`**：`python3 research/tools/ghinfo.py owner/repo ...`（刻意不走 api.github.com，规避限流）。Star / fork / license 字段 / archived / 最近提交 / 最新 release / 主语言均来自此。
  2. **许可证原文**：`curl` 拉取 `raw.githubusercontent.com/OWNER/REPO/HEAD/LICENSE*`（含 `LICENSE.md`、`LICENSE.txt`、`COPYING`、`LICENSE-MIT`、`LICENSE-APACHE-2.0`）逐行阅读；对 monorepo 定位到具体子包（如 `packages/powersync/LICENSE`）。
  3. **官方注册表 / 包元数据 API**（权威）：`registry.npmjs.org`、`pub.dev/api/packages/<pkg>` + `pub.dev/api/packages/<pkg>/score`（含 `platform:*`、`license:*` 标签）、`crates.io` 对应的 `Cargo.toml` 原文。
  4. **官方文档 HTML**：`docs.flutter.dev`、`kotlinlang.org`、`rn.dev out-of-tree platforms`、`v2.tauri.app`、`drift.simonbinder.eu`、`watermelondb.dev`、`rxdb.info`、`objectbox.io`，均以 `curl` + 文本抽取阅读。
- **工具限制声明**：本会话 `web_search` 全程返回 `Tavily API error (HTTP 432)`（多次重试无效）；`web_fetch` 对多数非 GitHub 域名报 "non-public IP"。**因此本文件没有依赖搜索摘要的结论**——凡无法从上述主源读到的，一律写 `未核实`。
- **许可政策**：本项目要求组件允许 **闭源商用**。MIT / Apache-2.0 / BSD / ISC / MPL-2.0 视为可用；AGPL / GPL / LGPL / BUSL / Elastic / SSPL / **FSL** / 专有 / 付费插件 一律红标。**双许可/二元发行**（源码宽松、二进制或插件付费）会明确区分"哪一部分免费"。
- **重要提醒**：`NOASSERTION (Other)` 是 GitHub 的自动识别失败，**不等于**许可证有问题。本文件对 `sql.js`、`react-native-windows`、`powersync.dart`、`microsoft/react-native` 等均回到 `LICENSE` 原文确认。

---

## 目录

- [类别 6 —— Streak / 连续天数计算库](#类别-6--streak--连续天数计算库)
- [类别 7 —— 各平台本地数据库](#类别-7--各平台本地数据库)
  - [7.1 逐组件核验表](#71-逐组件核验表)
  - [7.2 平台覆盖矩阵](#72-平台覆盖矩阵)
  - [7.3 静态加密（Encryption at rest）与同步/复制](#73-静态加密encryption-at-rest与同步复制)
- [类别 8 —— 跨平台框架实证](#类别-8--跨平台框架实证)
  - [8.1 框架与真实应用核验表](#81-框架与真实应用核验表)
  - [8.2 Flutter Web 真实限制](#82-flutter-web-真实限制)
  - [8.3 React Native 的桌面/桌面端覆盖真相](#83-react-native-的桌面端覆盖真相)
  - [8.4 KMP 平台成熟度与 TS/npm 复用（关键架构问题）](#84-kmp-平台成熟度与-tsnpm-复用关键架构问题)
  - [8.5 Tauri v2 移动端](#85-tauri-v2-移动端)
- [结论 / 推荐](#结论--推荐)
- [附录 —— 原始证据](#附录--原始证据)

---

## 类别 6 —— Streak / 连续天数计算库

### 6.1 结论先行

> **没有任何成熟、可复用、被广泛采用的"习惯 streak 计算库"存在于任何主流语言生态中。** 本会话在 npm（`total: 620` 个 "streak" 匹配）与 pub.dev（`streak` / `habit` 两个查询）实测了**全部靠前的候选**，结论是：要么它们是"GitHub 贡献 streak 可视化/CRM 工具"，要么是个人项目级别的 UI widget，要么下载量可忽略。
>
> **Head-to-head 证据**：两个最有代表性的开源习惯追踪 App——`FriesI23/mhabit`（1596★）与 `xpavle00/Habo`（1511★）——的 `pubspec.yaml` 依赖清单里**都没有任何 streak 库**（mhabit 依赖含 `simple_heatmap_calendar` 仅用于热力图渲染；Habo 依赖含 `table_calendar`）。它们的连续天数逻辑是**在 App 内自建**的。`iSoron/uhabits`（10275★，GPL-3.0）同样把 streak/score 逻辑内嵌在 `uhabits-core` 模块里，**未作为独立库发布**。
>
> **推荐：自建**。不要把 streak 计算交给任何第三方库。

### 6.2 实测候选（按生态）

| 组件 | 注册表/仓库 URL | Star(实测) | License(精确SPDX) | 语言 | 最近发布 | 采纳度(实测) | 闭源商用? | 备注与来源 |
|---|---|---|---|---|---|---|---|---|
| `streak_calculator` | https://github.com/abdullah-cse/streak_calculator | 未核实 | **MIT** | Dart | pub.dev `1.0.0` @ `2026-01-02`（共 7 版，首版 2025-09-30） | likes **17**，30 日下载 **47** | ✅ 可 | 目前 pub.dev 上最贴近需求的包：README/描述称支持 daily/weekly/monthly、自定义目标、弹性schedule。但 `1.0.0`、下载量极低、无社区验证。**不足以作为生产依赖**。 |
| `streak_calendar` | https://github.com/habit-rewards/streak_calendar | 未核实 | 未核实（仓库 LICENSE 文件首行为 `Copyright 2013 Deepanshu Chaudhary`，非标准 SPDX 文本，pub.dev 评分标签未列出 license） | Dart/Flutter | pub.dev `1.1.2` @ `2024-07-15` | likes **13**，30 日下载 **69** | 未核实 | 本质是**日历/连续打卡 UI 组件**，不是计算引擎。 |
| `flutter_streak` | https://github.com/Mohiuddin655-PUB/flutter_streak | 未核实 | **Apache-2.0** | Dart | pub.dev `1.0.1` @ `2025-09-26` | likes **3**，30 日下载 **28** | ✅ 可 | 个人项目，2 个版本。 |
| `streakify` | https://github.com/yassine-bennkhay/streakify | 未核实 | **MIT** | Dart | pub.dev `0.0.2` @ `2024-09-15` | likes **7**，30 日下载 **6** | ✅ 可 | 0.0.x，纯 Flutter 日历 widget。 |
| `streak_plus` | https://github.com/androidshashi/streak_plus | 未核实 | **MIT** | Dart | pub.dev `0.0.1` @ `2026-03-26` | likes **2**，30 日下载 **8** | ✅ 可 | 描述自称 "Offline-first streak engine with sync support"，但只有 1 个版本、无采用。 |
| `animated_habit_heatmap` | https://github.com/mayankthakur/animated_habit_heatmap | 未核实 | 未核实 | Dart/Flutter | pub.dev `0.2.0` @ `2026-03-08` | — | 未核实 | 纯可视化 heatmap widget。 |
| `date-streaks` (npm) | https://github.com/jonsamp/date-streaks | 未核实 | **ISC** | JS | npm `1.2.1` @ **2020-03-17** | 周下载 **898** | ✅ 可 | npm 上"从日期数组算各种 streak 指标"的包，**6 年未更新**。功能面窄（无 jump/skip/每周目标）。 |
| `use-streak` (npm) | https://github.com/jsjoeio/use-streak | 未核实 | **MIT** | JS/React | npm `1.0.4` @ **2021-11-15** | 周下载 **25** | ✅ 可 | React hook，Duolingo 式计数器。5 年未更新。 |
| `streak-calc-math` (npm) | 无仓库字段 | 未核实 | **MIT** | JS | npm `1.0.0` @ `2026-08-05` | 周下载 **48** | ✅ 可 | 依赖自由的"calendar-day bucketing + streak math"原语。极新、无采用。 |
| `@molecule/api-streak` (npm) | https://github.com/molecule-dev/molecule | 未核实 | **Apache-2.0** | TS | npm `1.0.2` @ `2026-09-20` | 周下载 **169** | ✅ 可 | 后端服务端 streak 跟踪（含 freezes + cron audit），**不是客户端库**。 |
| `longest-streak` (npm) | https://github.com/wooorm/longest-streak | 未核实 | **MIT** | JS | npm `3.1.0` @ **2022-11-15** | — | ✅ 可 | **名不符实**：算的是"字符串中最长重复子串"，与习惯无关。搜索噪声。 |
| `streak` (npm) | `git://github.com/czarneckid/coffeescript-streak.git` | 未核实 | **无 license 字段**（npm 元数据 `license: None`） | CoffeeScript | npm `0.1.0` @ **2012-05-18** | 周下载 **0** | 🟥 **无许可=默认全权利保留，禁止使用** | 2012 年的 Redis 后端 win/loss streak 库，事实废弃。 |
| 🟥 `iSoron/uhabits` | https://github.com/iSoron/uhabits | **10275** | 🟥 **GPL-3.0** | Kotlin (83.3%) | 提交 `2026-07-21`；release `v2.3.1` @ `2025-08-14` | — | 🟥 **GPL-3.0 —— 禁止闭源商用** | 最有名的开源习惯追踪器。streak 逻辑在 `uhabits-core`（Java/Kotlin 模块）内，**未抽成独立库**。许可证原文 `LICENSE.txt` 为 GNU GPL v3。**只能读算法思路，不能复制代码。** |
| ✅ `FriesI23/mhabit` | https://github.com/FriesI23/mhabit | **1596** | **Apache-2.0** | Dart (97.6%) | 提交 `2026-09-23`；release `v1.27.9+198` @ `2026-09-20` | — | ✅ 可 | 活跃维护的 Flutter 习惯追踪器，覆盖 Android/iOS/Windows/macOS/Linux，WebDAV 同步、local-first。**可作为 streak 算法与数据模型的参考实现（Apache-2.0 允许借鉴，需保留声明）。** |
| 🟥 `xpavle00/Habo` | https://github.com/xpavle00/Habo | **1511** | 🟥 **GPL-3.0** | Dart (95.8%) | 提交 `2026-05-06`；release `v4.0.0` @ `2026-05-10` | — | 🟥 **GPL-3.0 —— 禁止闭源商用** | 隐私优先习惯追踪器，E2EE 同步。**代码不可用于闭源产品。** |
| `limboy/habbit` | https://github.com/limboy/habbit | 140 | **MIT** | Dart | 提交 `2019-01-27` | — | ✅ 可 | 极简 habit tracker，**7 年未动**。 |
| Beeminder | https://www.beeminder.com | — | 🟥 专有商业服务 | — | — | — | 🟥 **闭源商业产品** | 商业 habit/goal 服务，无开源库。**不可作为组件。** |

### 6.3 一个正确的 streak 实现必须处理什么（基于实测证据的工程清单）

由于不存在可复用库，下清单是**自建时必须覆盖的边界条件**；每条都对应上表 App 在真实代码里必须自行解决的问题：

1. **时区与"哪一天算今天"**：用户"完成时间"是 UTC instant，但 streak 要按**用户本地日历日**切分。跨时区旅行会重排"连续"。`mhabit` 依赖里显式引入了 `flutter_timezone` 与 `win2iana_tz_converter`（Windows 时区名 → IANA 转换），正是为此。**必须在数据层存 IANA 时区 ID 与"本地日期键"，不能只存 UTC 时间戳。**
2. **DST（夏令时）**：某些本地日只有 23 小时或多 25 小时；用 `instant + 86400s` 推进日期会漂移。**必须用日历运算（如 `TZDateTime.add(Duration(days:1))` 且按本地日归一化），不能做秒级加减。**
3. **跳过的日子 / 弹性 schedule**：习惯可能定义为"每周一三五"或"每隔 N 天"。此时"未打卡日"不等于"断链"。需要把 **schedule（计划）与 occurrence（应做实例）分离**，streak 只在"应做且未做"时断裂。
4. **每周目标（"3 次/周"）**：这不是逐日布尔值，需要**按周聚合的配额模型** + 跨周边界规则（周日 vs 周一起始、是否跨周补做）。
5. **Streak freeze / 豁免**：允许用户"冻结"若干天而不算断链，需要一条独立的豁免记录，并在回溯计算时扣除。
6. **回溯编辑（retroactive edits）**：用户补打昨天的卡、或删除历史记录，**必须触发整条 streak 的重算**，而不是只更新当前计数。因此 streak **应派生而非存储**（或用可重算的物化视图 + 脏标记）。
7. **"今天尚未完成"的语义**：当天未结束时不能把 streak 判为断。正确做法是"当前 streak 若今天已做则 +1，否则显示截至昨天的连续值"。
8. **性能**：回溯重算要能 O(发生次数) 完成，避免每次全表扫描；建议按 `(habit_id, local_date)` 建索引并缓存"上一次断点"。

**结论**：streak 计算量小但语义密集，**自建一个约 200–400 行的纯函数模块（输入：已排序的完成记录 + schedule + 时区；输出：current/best streak + 每日状态）** 是成本最低、风险最低的路线；把它写成带单元测试的领域模块，而不是找库。

---

## 类别 7 —— 各平台本地数据库

### 7.1 逐组件核验表

> 所有 Star / 提交 / release 均为本会话 `tools/ghinfo.py` 实测（2026-09-25）。"闭源商用?" 一列已考虑**双许可 / 二元发行**的特殊情形。

#### Flutter / Dart 侧

| 组件 | 仓库 URL | Star(实测) | License(精确SPDX) | 语言 | 最近提交/发布 | 闭源商用? | 备注与来源 |
|---|---|---|---|---|---|---|---|
| **Drift** | https://github.com/simolus3/drift | **3281** | **MIT** | Dart (99.1%) | 提交 `2026-09-24T15:08:44Z`；release `drift-2.35.0` @ `2026-09-09` | ✅ 可 | `LICENSE` 原文 "MIT License / Copyright (c) 2019 Simon Binder"。pub.dev `drift@2.35.0`（likes 2473，30 日下载 **1,339,010**，标签 `platform:android,ios,windows,linux,macos,web`，`license:mit`）。**Dart 侧第一推荐**。 |
| **sqflite** | https://github.com/tekartik/sqflite | **3020** | **BSD-2-Clause** | Dart (76.3%) | 提交 `2026-09-20T20:45:23Z`；release `sqflite_common/v2.5.13` @ `2026-09-15` | ✅ 可 | pub.dev `sqflite@2.4.4`（likes 5566，30 日下载 **3,219,315**，标签仅 `platform:android,ios,macos`——**不含 web/windows/linux**）。桌面需配 `sqflite_common_ffi`。**无内建加密**（见 7.3）。 |
| ⚠️ **Isar（原仓库）** | https://github.com/isar/isar | **4024** | **Apache-2.0** | Dart (48.5%) | 提交 `2025-06-14T08:12:25Z`；release `v4.0.0-dev.14` @ `2023-08-21` | ✅ 可（但**不建议**） | `packages/isar/README.md` 原文警告：**"⚠️ ISAR V4 IS NOT READY FOR PRODUCTION USE ⚠️ 生产请用稳定版 3。"** 且 v3（pub.dev `isar@3.1.0+1` @ `2023-04-25`）已 **3.5 年未发版**；30 日下载已跌至 **3367**。**事实停摆。** |
| ⚠️ **isar-community/isar（旧社区 fork）** | https://github.com/isar-community/isar | **252** | **Apache-2.0** | Dart (71.1%) | 提交 `2025-08-18`；release `3.1.8` @ `2024-08-13`；**`archived: true`** | ✅ 可（但已归档） | README 顶部原文：**"This repository is no longer maintained… Please use the renamed repository `isar-community/isar-community`."** |
| **isar-community/isar-community（现役社区 fork）** | https://github.com/isar-community/isar-community | **193** | **Apache-2.0** | Dart (70.8%) | 提交 `2026-09-08T04:40:41Z`；release `3.3.2` @ `2026-03-23` | ✅ 可 | pub.dev 包名 `isar_community@3.3.2`（likes 161，30 日下载 **102,411**，标签 `platform:android,ios,windows,linux,macos`——**无 web**）。是 Isar 3 唯一还在维护的分支，但**规模小（193★）、无 Web**。 |
| **sqlite3 (Dart bindings)** | https://github.com/simolus3/sqlite3.dart | **299** | **MIT** | Dart (85.9%) | 提交 `2026-09-16T19:25:53Z`；release `sqlite3-3.6.0` @ `2026-09-13` | ✅ 可 | pub.dev `sqlite3@3.6.0`（30 日下载 **2,501,977**，标签含 **`platform:web`** + `is:wasm-ready`）。Drift 的底层。全平台（含 Web/WASM）。 |
| **sqlite3_flutter_libs** | https://github.com/simolus3/sqlite3.dart/tree/main/legacy/sqlite3_flutter_libs | 见上（同 monorepo） | **MIT** | Dart | pub.dev `0.6.0+eol` @ `2026-02-15` | ✅ 可 | 版本号后缀 **`+eol`** = 已停止维护（迁移到新的 native asset/hook 方案）。新项目不要再用。 |
| **sqlcipher_flutter_libs** | https://github.com/simolus3/sqlite3.dart/tree/main/legacy/sqlcipher_flutter_libs | 见上（同 monorepo） | **MIT AND BSD-3-Clause-HP AND Pixar**（pub.dev 评分标签实测三项） | Dart | pub.dev `0.7.0+eol` @ `2026-02-15` | ✅ 可 | 为 Flutter 提供 SQLCipher 原生库，**已 EOL**。drift 官方推荐的加密路径已转为 `encrypted_drift` + SQLite3MultipleCiphers。 |
| **PowerSync Dart SDK** | https://github.com/powersync-ja/powersync.dart | **251** | **Apache-2.0**（**子包** `packages/powersync/LICENSE` 原文为 Apache-2.0；仓库根无 LICENSE，故 GitHub 显示 `NA`） | Dart (99.7%) | 提交 `2026-09-23T12:22:59Z`；release `powersync-v2.4.0` @ `2026-09-02` | ✅ **客户端可**；服务端见下 | pub.dev `powersync@2.4.0`（likes 154，30 日下载 **30,283**，标签 **全 6 平台** + `is:wasm-ready`）。⚠️ **注意：SDK 宽松，但服务端不是**——见 7.1 末。 |

#### JS / React Native 侧

| 组件 | 仓库 URL | Star(实测) | License(精确SPDX) | 语言 | 最近提交/发布 | 闭源商用? | 备注与来源 |
|---|---|---|---|---|---|---|---|
| **WatermelonDB** | https://github.com/Nozbe/watermelondb | **11786** | **MIT** | JS (70.1%) | 提交 `2025-08-11T12:09:31Z`；release `v0.28.1-0` @ `2025-07-24` | ✅ 可 | `LICENSE` 原文 "MIT License / Copyright (c) Nozbe"。官方文档自述 **"Multiplatform. iOS, Android, Windows, web, and Node.js"**。⚠️ **提交已约 13.5 个月无更新**（相对 2026-09-25），出现维护放缓迹象。无内建加密。 |
| ⚠️ **RxDB（核心）** | https://github.com/pubkey/rxdb | **23391** | **Apache-2.0**（核心） | TypeScript (92.9%) | 提交 `2026-09-18T06:49:12Z`；release `17.5.0` @ `2026-08-20` | ✅ 核心可 | `LICENSE.txt` 原文 Apache-2.0。极活跃，覆盖所有 JS 运行时（浏览器/Node/Electron/React Native，另有 Flutter 绑定）。**内建免费加密插件**（`rxdb.info/encryption.html`：encrypt/decrypt on all supported device types）。 |
| 🟥 **RxDB Premium 插件** | https://rxdb.info/premium/ | — | 🟥 **付费专有许可**（Pro / Pro Plus 商业授权） | TypeScript | 页面实测（本会话） | 🟥 **付费才能用** | RxDB 官方原文："**While the core of RxDB is free and open-source, we offer paid licenses for businesses and professionals. Pro and Pro Plus tiers add commercial plugins.**" 付费插件包含：**Premium storages（OPFS、SQLite、Filesystem）、性能插件（Sharding、Memory-Mapped）、Server adapters、SLA/自定义商业条款**。且明确 **"We do not currently offer a free trial"**、"Premium licenses are provided on an [annual] basis"。**→ 闭源商用只能用 Apache-2.0 核心；一旦需要官方 SQLite/OPFS 高性能存储会掉进付费区。** |
| **op-sqlite** | https://github.com/OP-Engineering/op-sqlite | **1044** | **MIT** | C (98.0%) | 提交 `2026-09-20T16:24:13Z`；release `18.2.5` @ `2026-09-20` | ✅ 可 | `LICENSE` 原文标准 MIT；npm `@op-engineering/op-sqlite@18.2.5`（`license: MIT`，2026-09-20）。README 原文：**"iOS, Android, macOS and web support"** + **"SQLCipher is supported as a compilation target"**。RN 上速度最快的 SQLite 绑定。 |
| **expo-sqlite** | https://github.com/expo/expo | **52422**（monorepo） | **MIT** | TypeScript (56.8%) | 提交 `2026-09-25T06:17:49Z` | ✅ 可 | 官方文档元数据 `platforms: ['android','ios','macos','tvos','web','expo-go']`；config plugin 支持 **`useSQLCipher: true`**（即 SQLCipher 加密有官方配置入口）。 |
| **better-sqlite3** | https://github.com/WiseLibs/better-sqlite3 | **7496** | **MIT** | JS (68.4%) | 提交 `2026-08-10T03:10:10Z`；release `v13.0.3` @ `2026-08-05` | ✅ 可 | Node.js 专用（**桌面/服务端**），**不支持浏览器/RN**。无内建加密。 |
| **sql.js** | https://github.com/sql-js/sql.js | **13663** | **MIT**（GitHub 侧栏显示 `NOASSERTION (Other)` 系自动识别失败） | JS (88.9%) | 提交 `2026-08-14T18:15:38Z`；release `v1.14.2` @ `2026-08-14` | ✅ 可 | `LICENSE` 原文："**MIT license … Copyright (c) 2017 sql.js authors**"。SQLite 编译到 WASM，**Web + Node**；内存/IndexedDB 持久化。**无内建加密**。 |
| **cr-sqlite** | https://github.com/vlcn-io/cr-sqlite | **3800** | **MIT** | Rust (55.5%) | 提交 `2026-08-10T10:55:49Z`；**release `v0.16.3` @ `2024-01-17`** | ✅ 可 | `LICENSE` 原文 "MIT License / Copyright (c) 2023 One Law LLC"。是 SQLite 的**可加载扩展**（`load_extension`），提供 CRDT 多主复制，用于离线合并。⚠️ **最新 release 停在 2024-01，近 2.6 年未发版**（仓库仍有提交）。**无内建加密**。 |

#### KMP（Kotlin Multiplatform）侧

| 组件 | 仓库 URL | Star(实测) | License(精确SPDX) | 语言 | 最近提交/发布 | 闭源商用? | 备注与来源 |
|---|---|---|---|---|---|---|---|
| **SQLDelight** | https://github.com/cashapp/sqldelight | **6885** | **Apache-2.0** | Kotlin (95.1%) | 提交 `2026-09-22T12:47:57Z`；release `2.4.0` @ `2026-09-18` | ✅ 可 | `LICENSE.txt` 原文 Apache-2.0。官方文档列出驱动：`android-driver`、`native-driver`（iOS/macOS/Linux/Windows）、`sqlite-driver`(JVM) + JDBC(MySQL/PostgreSQL/HSQL)；另有 web-worker-driver（JS/Web，本会话未深入核实）。**KMP 侧第一推荐。** |
| ⚠️ **Realm Kotlin** | https://github.com/realm/realm-kotlin | **1103** | **Apache-2.0** | Kotlin (96.1%) | 提交 `2025-01-20T20:27:06Z`；release `v3.0.0` @ `2024-10-03` | ✅ SDK 可，但**已官方弃用** | `LICENSE` 原文 Apache-2.0。**README 顶部红头原文**："**We announced the deprecation of Atlas Device Sync + Realm SDKs in September 2024**"；并指向 MongoDB 弃用文档。非同步版需 `3.0.0+` 或 `community` 分支。⚠️ **提交停在 2025-01，事实停更。不建议新项目采用。** |
| 🟥 **ObjectBox Java** | https://github.com/objectbox/objectbox-java | **4624** | **Apache-2.0（源码）**，但 🟥 **二进制另受 `ObjectBox Binary License`（专有）约束** | Java (96.2%) | 提交 `2026-07-15T04:35:53Z`；release `6.0.0-beta` @ `2026-07-15` | ⚠️ **需法务确认** | `LICENSE.txt` 原文 Apache-2.0（源码层）。**但实际运行时二进制由 `objectbox.io/0209-ob-binary-license/` 覆盖**，原文：授予 "non-exclusive, non-transferable, non-sublicensable, **revocable**, limited, **royalty-free** licence"；禁止 "use the Software for purposes of the development of a **competing software product or service**"。**这不是 OSI 许可，且可被单方撤销、含竞业禁止。** 另 ObjectBox **Sync 是商业付费产品**（`objectbox.io/sync/`）。 |

#### Rust 侧

| 组件 | 仓库 URL | Star(实测) | License(精确SPDX) | 语言 | 最近提交/发布 | 闭源商用? | 备注与来源 |
|---|---|---|---|---|---|---|---|
| **rusqlite** | https://github.com/rusqlite/rusqlite | **4408** | **MIT** | Rust (99.5%) | 提交 `2026-09-21T10:45:45Z`；release `0.40.2` @ `2026-08-08` | ✅ 可 | `Cargo.toml` 原文 `license = "MIT"`。Rust 生态标准 SQLite 绑定。 |
| **sqlx** | https://github.com/launchbadge/sqlx | **17499** | **MIT OR Apache-2.0**（Cargo.toml 原文；GitHub 侧栏只显示 Apache-2.0） | Rust (99.0%) | 提交 `2026-09-14T15:02:32Z`；release `v0.9.0` @ `2026-05-21` | ✅ 可（双许可任选） | 本会话直接读 `Cargo.toml`：`license = "MIT OR Apache-2.0"`。支持 SQLite/PostgreSQL/MySQL。 |
| **SQLCipher** | https://github.com/sqlcipher/sqlcipher | **7285** | **BSD-3-Clause** | C (81.0%) | 提交 `2026-09-06T14:38:47Z`；release `v5.0.0-beta` @ `2026-09-15` | ✅ 可 | SQLite 的加密 fork（AES-256）。**BSD-3-Clause 可闭源商用**；注意 SQLCipher 商业版由 Zetetic 提供额外支持，但社区版本身是 BSD。 |

#### 同步服务端（易被忽略的许可陷阱）

| 组件 | 仓库 URL | Star(实测) | License(精确SPDX) | 语言 | 最近提交/发布 | 闭源商用? | 备注与来源 |
|---|---|---|---|---|---|---|---|
| 🟥 **PowerSync Service（服务端）** | https://github.com/powersync-ja/powersync-service | **386** | 🟥 **FSL-1.1-ALv2** | TypeScript (99.6%) | 提交 `2026-09-23T11:42:12Z`；release `v1.26.1` @ `2026-09-14` | 🟥 **有条件的禁止** | `LICENSE` 原文第一行："**# Functional Source License, Version 1.1, ALv2 Future License**"，缩写 `FSL-1.1-ALv2`。原文："**A Permitted Purpose is any purpose other than a Competing Use. A Competing Use means making the Software available to others in a commercial product or service that…**"。**即：不能拿它做与 PowerSync 竞争的商业产品/服务。** 但含 "**Grant of Future License**"：**自发布满两周年起自动转为 Apache-2.0**。客户端 SDK（Dart/JS）是 Apache-2.0，服务端是 FSL。 |
| ✅ **PowerSync JS SDK** | https://github.com/powersync-ja/powersync-js | **724** | **Apache-2.0** | TypeScript (92.2%) | 提交 `2026-09-23T11:14:02Z`；release `@powersync/web@2.4.1` @ `2026-09-23` | ✅ 可 | 客户端宽松，与服务端许可**不同**。 |

### 7.2 平台覆盖矩阵

图例：`✅` 官方支持；`⚠️` 有支持但有重要限制/需额外包/未完全核实；`❌` 不支持；`—` 不适用。

| 组件 | iOS | Android | Windows | macOS | Linux | Web | 依据 |
|---|:--:|:--:|:--:|:--:|:--:|:--:|---|
| **Drift** (Flutter) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | pub.dev score 标签 `platform:` 全 6 项实测 |
| **sqflite** (Flutter) | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | ❌ | pub.dev 标签仅 `android,ios,macos`；桌面需 `sqflite_common_ffi`；无 web |
| **sqlite3 (Dart)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | pub.dev 标签全 6 项 + `is:wasm-ready` |
| **PowerSync Dart SDK** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | pub.dev 标签全 6 项 + `is:wasm-ready` |
| ⚠️ **Isar v3 / isar_community** | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️/❌ | pub.dev `isar` 标签含 web；**`isar_community` 标签实测无 web** |
| ⚠️ **WatermelonDB** | ✅ | ✅ | ✅ | ⚠️ | ❌ | ✅ | 官方文档原文 "iOS, Android, Windows, web, and Node.js"（未列 Linux/macOS） |
| **RxDB（核心）** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 覆盖所有 JS 运行时（浏览器/Node/Electron/RN）；桌面经 Electron。**官方 SQLite/OPFS 存储属付费 Premium** |
| **op-sqlite** (RN) | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | README 原文 "iOS, Android, macOS and web support" |
| **expo-sqlite** | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | 官方文档 `platforms: android, ios, macos, tvos, web` |
| **better-sqlite3** | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | Node.js 专用 |
| **sql.js** | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | WASM，浏览器 + Node |
| **cr-sqlite** | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ✅ | 作为 SQLite 可加载扩展，凡有 SQLite 的平台皆可用；WASM 构建支持浏览器。具体 RN/Flutter 集成未逐一核实 → `⚠️` |
| **SQLDelight** (KMP) | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | 官方驱动列表：`native-driver`(iOS/macOS/Linux/Windows)、`android-driver`、`sqlite/jdbc-driver`(JVM)；web-worker-driver 支持 JS/Web（未深入核实） |
| ⚠️ **Realm Kotlin** | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | KMP+Android SDK；**已于 2024-09 官方弃用** |
| 🟥 **ObjectBox Java** | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | Android + JVM 桌面（Java/Kotlin）；iOS 走独立的 ObjectBox Swift（另一套）；无 web。**二进制许可专有** |
| **rusqlite / sqlx** (Rust) | ⚠️ | ⚠️ | ✅ | ✅ | ✅ | ⚠️ | 桌面/服务端原生；移动端经 FFI 可用；Web 需 WASM 目标（rusqlite 非开箱即用） |

**"一次写、六平台跑"的可行解**：
- **Flutter 路线**：`Drift`（业务层，MIT）+ `sqlite3`（含 Web/WASM）覆盖全部 6 平台 ✅；加密用 `encrypted_drift`。
- **JS/RN 路线**：核心数据库可全平台覆盖，但 **RxDB 的官方高性能存储需付费**；`WatermelonDB` 缺 Linux。
- **KMP 路线**：`SQLDelight` 是唯一宽松且活跃的全平台选项，但 **Web 端成熟度弱**。
- **没有任何单一组件在"所有语言/所有平台"上同时满足"宽松许可 + 活跃维护 + 加密 + 同步"**。

### 7.3 静态加密（Encryption at rest）与同步/复制

| 组件 | 静态加密 | 证据 / 路径 | 同步 / 复制 |
|---|---|---|---|
| **Drift** | ✅ 支持 | 官方文档 `drift.simonbinder.eu/platforms/encryption/` 原文："Use drift on encrypted databases… There are two ways"：新方案 `encrypted_drift`（基于 SQLite3MultipleCiphers，支持**所有原生平台含桌面**），旧方案 `sqlcipher_flutter_libs`（已 EOL） | ❌ 无内建同步；需搭配 PowerSync / 自建 |
| **sqflite** | ⚠️ 非内建 | 无加密 API；社区方案 `sqflite_sqlcipher@3.4.1`（MIT，30 日下载 87,032，标签 `android,ios,macos`） | ❌ 无 |
| **sqlite3 (Dart)** / sqlite3_flutter_libs | ⚠️ 需换加密库 | 本身是明文绑定；加密需 `sqlcipher_flutter_libs`（EOL）或 `encrypted_drift` | ❌ |
| **PowerSync** | 未核实 | pub.dev / SDK 文档本会话未读到明确 SQLCipher 支持声明 → `未核实` | ✅ **内置同步引擎**（Postgres/MongoDB/MySQL/SQL Server → SQLite），服务端 FSL 🟥 |
| **WatermelonDB** | 未核实 | 文档未提及静态加密 → `未核实` | ⚠️ 提供 sync 原语（pull/push 协议），但**同步后端需自建** |
| **RxDB** | ✅ 内建（核心，免费） | `rxdb.info/encryption.html`：官方免费加密插件，"encryption works on all RxDB supported device types"，字段级加密；限制：**加密字段不能用于查询算子** | ✅ 内建 Replication 协议（对接现有后端，CouchDB/GraphQL 等） |
| **op-sqlite** | ✅ 支持 | README 原文："**SQLCipher is supported as a compilation target**" | ❌ 无 |
| **expo-sqlite** | ✅ 官方配置 | 官方文档 config plugin 选项 **`useSQLCipher: true`** | ❌ 无 |
| **better-sqlite3** | ⚠️ 非内建 | 本会话未读到内建加密；需自编译 SQLCipher 版本 → `未核实` 精确路径 | ❌ |
| **sql.js** | ❌ | WASM 版 SQLite，无加密说明 | ❌ |
| **cr-sqlite** | ❌ | README 未提及加密 | ✅ **CRDT 多主复制**（核心卖点），但 release 停 2024-01 |
| **SQLDelight** | ⚠️ 非内建 | 生成类型安全 API；Android 需自行接 SQLCipher 的 `SupportFactory` → `未核实` 官方封装 | ❌ |
| ⚠️ **Realm Kotlin** | ✅ 内建（Realm 自带 AES-256） | 本会话未逐行核实文档，但 Realm 长期宣称内建加密 → 文档级 `未核实`；**即使有也已弃用** | 🟥 **Atlas Device Sync 已于 2024-09 弃用**（README 原文）；`3.0.0+` 已移除同步 |
| 🟥 **ObjectBox** | 未核实 | 文档站本会话重定向异常，未读取到加密声明 → `未核实` | ⚠️ **ObjectBox Sync 为商业付费产品**（`objectbox.io/sync/`） |
| **rusqlite / sqlx** | ⚠️ 非内建 | 需链接 SQLCipher（Rust crate `rusqlite` 有 `bundled-sqlcipher` feature；本会话未逐一核实） | ❌ |

---

## 类别 8 —— 跨平台框架实证

### 8.1 框架与真实应用核验表

| 组件 | 仓库 URL | Star(实测) | License(精确SPDX) | 语言 | 最近提交/发布 | 闭源商用? | 备注与来源 |
|---|---|---|---|---|---|---|---|
| **Flutter（框架）** | https://github.com/flutter/flutter | 未核实 | BSD-3-Clause（未在本会话抓取，`未核实`） | Dart | — | ✅ 可（未核实） | 本文件聚焦"用 Flutter 写成的真实任务类 App"，框架本身数据见项目其它部分。 |
| 🟥 **AppFlowy** | https://github.com/AppFlowy-IO/AppFlowy | **76917** | 🟥 **AGPL-3.0** | Dart (73.6%) | 提交 `2026-06-26`；release `v0.14.5` @ `2026-09-25` | 🟥 **AGPL-3.0 —— 禁止闭源商用** | `LICENSE` 原文为 GNU Affero GPL v3 完整文本。Flutter 生态最大的 Notion/任务替代品，但**AGPL 意味着闭源商业产品不能链接其代码**（含网络服务传染）。**仅可作为竞品研究，不可作为组件。** |
| ✅ **mhabit** | https://github.com/FriesI23/mhabit | **1596** | **Apache-2.0** | Dart (97.6%) | 提交 `2026-09-23`；release `v1.27.9+198` @ `2026-09-20` | ✅ 可 | **Flutter 全桌面+移动（Android/iOS/Windows/macOS/Linux）+ WebDAV 同步 + local-first** 的真实习惯追踪器。是本项目最贴近的正面参照。 |
| ✅ **Zest** | https://github.com/darkmoonight/Zest | **485** | **MIT** | Dart (92.0%) | 提交 `2026-07-15`；release tag `dev` @ `2026-02-24` | ✅ 可 | Flutter 任务管理 App，活跃。 |
| ✅ **WhatTodo** | https://github.com/burhanrashid52/WhatTodo | **1265** | **Apache-2.0** | Dart (94.7%) | 提交 `2024-11-16`；release `2.0.2` @ `2024-11-09` | ✅ 可 | 使用 `sqflite` 的 Flutter Todo + 项目/标签/截止日期。**维护放缓（近 2 年）**。 |
| ⚠️ **flutter-todos** | https://github.com/asjqkkkk/flutter-todos | **2120** | **MIT** | Dart (99.1%) | 提交 `2025-12-19`；release `v1.1.2` @ **2020-03-10** | ✅ 可 | Star 高但 release 停在 2020；已非活跃。 |
| ⚠️ **Taskist** | https://github.com/huextrat/Taskist | **1057** | **MIT** | Dart (95.9%) | 提交 **2020-07-09**；无 release | ✅ 可 | Firebase Todo 示例，**6 年未动**。 |
| 🟥 **Habo** | https://github.com/xpavle00/Habo | **1511** | 🟥 **GPL-3.0** | Dart (95.8%) | 提交 `2026-05-06`；release `v4.0.0` @ `2026-05-10` | 🟥 **GPL-3.0 —— 禁止闭源商用** | Flutter 习惯追踪器（E2EE、自托管同步）。**代码不可用。** |
| ✅ **React Native（框架）** | https://github.com/facebook/react-native | **126724** | **MIT** | C++ (35.1%) | 提交 `2026-09-25T06:30:04Z`；release `0.88.0-rc.2` @ `2026-09-22` | ✅ 可 | 极活跃。官方平台 = iOS + Android（**仅此两个是一等公民**）。 |
| 🟥 **Notesnook** | https://github.com/streetwriters/notesnook | **14636** | 🟥 **GPL-3.0** | TypeScript (85.5%) | 提交 `2026-09-18`；release `v3.4.13` @ `2026-09-15` | 🟥 **GPL-3.0 —— 禁止闭源商用** | 大型 RN + Electron 笔记应用（E2EE）。**是有力证据：RN 可承载桌面+移动的复杂数据型 App**，但代码 GPL 不可用。 |
| ✅ **react-native-windows** | https://github.com/microsoft/react-native-windows | **17347** | **MIT**（GitHub 侧栏 `NOASSERTION (Other)` 系 LICENSE 内含 "Portions derived from React Native" 段导致识别失败，原文是 MIT） | C++ (48.8%) | 提交 `2026-09-24T02:59:41Z`；release `v0.85.0-preview.2` @ `2026-09-25` | ✅ 可 | README 原文：支持 **Windows 10 SDK / WinUI3 / WinAppSDK Win32**，新架构 Fabric 正在推进。**微软在持续投入（提交就在今天）**。 |
| ✅ **react-native-macos** | https://github.com/microsoft/react-native-macos | **4386** | **MIT** | C++ (31.9%) | 提交 `2026-09-01T16:19:47Z`；release `v0.81.9` @ `2026-07-13` | ✅ 可 | `LICENSE` 原文标准 MIT。**活跃，但规模仅为 Windows 版的约 1/4。** |
| ⚠️ **react-native-linux（社区）** | https://github.com/lucid-softworks/react-native-linux | **32** | 未核实（GitHub `NOASSERTION (Other)`） | C++ (47.5%) | 提交 `2026-07-27`；**无 release** | 未核实 | **不是官方支持，仅 32★、无发版。生产不可依赖。** |
| ⚠️ **react-native-everywhere** | https://github.com/sarthakpranesh/react-native-everywhere | **74** | **MIT** | TypeScript (95.1%) | 提交 **2022-08-07**；release `v2.0.0` @ `2022-08-07` | ✅ 可 | "Expo + Tauri" 模板，覆盖 Android/iOS/Web/macOS/Windows/Linux。**4 年未动**，仅作思路参考。 |
| ✅ **Compose Multiplatform** | https://github.com/JetBrains/compose-multiplatform | **19386** | **Apache-2.0** | Kotlin (99.2%) | 提交 `2026-09-24T15:30:50Z`；release `v1.13.0-alpha02+dev4869` @ `2026-09-25` | ✅ 可 | `LICENSE.txt` 原文 Apache-2.0。JetBrains 主力投入。**稳定性分级见 8.4。** |
| ✅ **Alkaa** | https://github.com/igorescodro/alkaa | **1645** | **Apache-2.0** | Kotlin (70.3%) | 提交 `2026-05-25`；release `v3.4.2` @ `2026-01-02` | ✅ 可 | **真实的 KMP + Compose Multiplatform 任务管理 App（Android + iOS）**。是 KMP 做 todo 的最佳正面证据，且**许可宽松**。 |
| 🟥 **Twine** | https://github.com/msasikanth/twine | **2414** | 🟥 **GPL-3.0** | Kotlin (92.3%) | 提交 `2026-09-08`；release `v3.9.0` @ `2026-09-09` | 🟥 **GPL-3.0 —— 禁止闭源商用** | KMP + Compose 的 RSS 阅读器（可证明 KMP 能承载数据密集型 App），**但代码 GPL 不可用**。 |
| ✅ **KaMPKit** | https://github.com/touchlab/KaMPKit | **2453** | **Apache-2.0** | Kotlin (86.3%) | 提交 `2026-09-18` | ✅ 可 | Touchlab 的 KMP 起步模板；架构参考价值高，许可宽松。 |
| **Tauri** | https://github.com/tauri-apps/tauri | **111382** | **Apache-2.0 OR MIT**（双许可；GitHub 侧栏显示 Apache-2.0） | Rust (81.4%) | 提交 `2026-09-25T01:39:09Z`；release `tauri v3.0.0-alpha.2` @ `2026-09-21` | ✅ 可（双许可任选） | 本会话读 `Cargo.toml`：`license = "Apache-2.0 OR MIT"`；仓库含 `LICENSE-APACHE-2.0`、`LICENSE-MIT`、`LICENSE.spdx`。注意：**v3 已进入 alpha**（release 为 `v3.0.0-alpha.2`），生产应锁 v2。 |

### 8.2 Flutter Web 真实限制

来源：Flutter 官方文档 `docs.flutter.dev/platform-integration/web/faq`（页面自述 "reflects Flutter **3.47**"，页面更新于 `2026-09-21`，本会话逐条抽取原文）。

| 限制 | 官方原文（节选） | 对"数据密集型任务 App"的影响 |
|---|---|---|
| **不适合文档型/文本流内容** | "**At this time, Flutter is not suitable for static websites with text-rich flow-based content.** For example, blog articles benefit from the document-centric model that the web is built around…" | 任务 App 的**营销页/帮助文档/公开分享页**不应是 Flutter；但主应用（SPA/PWA）在官方推荐范围内："Flutter is particularly suited for app-centric experiences: **Progressive Web Apps / Single Page Apps / Existing Flutter mobile apps**"。 |
| **SEO 不友好** | "**application output doesn't align with what search engines need to properly index.**" 官方建议改用 Jaspr（Dart 但非 Flutter）或混用。 | 若需要搜索引擎收录任务内容，必须另做 DOM 页面。 |
| **无 `dart:io` / 无文件系统** | "**Can I use dart:io with a web app? No. The file system is not accessible from the browser.**"；"calling any `Platform.isXYZ` method throws an `UnsupportedError`"；且"importing `dart:io` in a package **causes pub.dev to score the package as not supporting the web**"。 | **直接决定本地数据库选型**：任何依赖 `dart:io` 的插件（含多数原生 SQLite 插件）在 Web 上不可用——必须用 WASM 路线（如 Drift 的 `WasmDatabase` / `sqlite3` 的 wasm 构建），或用 IndexedDB 存储。 |
| **不支持 isolates / 并发** | "**Dart's concurrency support that uses isolates is not currently supported in Flutter web.** … can potentially work around this by using web workers, although such support isn't built in." | 后台批量解析/大查询需要自己接 Web Worker，不能照搬移动端的 isolate 架构。 |
| **缓存/Service Worker 需自管** | "**Flutter no longer generates or manages a caching service worker by default**… you need to configure a service worker yourself using standard web tooling or third-party solutions such as Workbox." | 离线优先 App 的 Web 端离线能力**要额外自建**，不是免费获得。 |
| 浏览器支持范围广（正面） | "Chrome / Safari / Edge / Firefox（mobile & desktop）" | 可用性 OK。 |

> **结论**：Flutter Web 对"app-centric SPA"可行，但**对数据密集型 App 有三处硬约束**：(1) 无文件系统 → 数据库必须走 WASM/IndexedDB；(2) 无 isolate → 重计算要接 Worker；(3) 无默认 service worker → 离线要自建。这三点需在架构初期就按 Web 分支设计，否则后期返工。

### 8.3 React Native 的桌面端覆盖真相

来源：React Native 官方文档 `reactnative.dev/docs/out-of-tree-platforms`（本会话抽取原文，页面版本 0.87）。

官方原文把平台明确分成两类：

- **From Partners**（合作方维护）：
  - React Native **macOS**
  - React Native **Windows**
  - React Native **visionOS**
  - React Native **OpenHarmony**
- **From Community**（社区维护）：
  - React Native **tvOS**
  - React Native **Web**
  - React Native **Skia** —— "React Native using Skia as a renderer. **Currently supports Linux and macOS.**"

> ⚠️ **关键澄清**：**React Native 没有官方的 Linux 目标平台。** 官方页面里唯一提到 Linux 的是 `React Native Skia`——那是**渲染后端**（Skia 渲染器可在 Linux/macOS 上跑），**不是一个完整的 RN 平台 target**。社区里名为 `react-native-linux` 的项目仅 **32★、无 release**，不可用于生产。
>
> **因此 RN 现实可达的平台覆盖是：iOS + Android（官方）+ Windows（微软维护，17347★，今日仍有提交）+ macOS（微软维护，4386★）+ Web（react-native-web，社区）+ visionOS/OpenHarmony（合作方，边缘）。Linux 缺口需要另用 Tauri/Electron 补。**

**健康度判断（基于实测数字）**：
- `react-native-windows`：**健康**。提交 `2026-09-24`、release `2026-09-25`——几乎是当天活跃。
- `react-native-macos`：**活跃但落后**。最新 release `v0.81.9`（`2026-07-13`），而 RN 主干已到 `0.88.0-rc.2`。**版本滞后约 7 个小版本**，意味着部分新 RN API/新架构特性在 macOS 上会延迟可用。
- **Linux：❌ 无官方支持**。

### 8.4 KMP 平台成熟度与 TS/npm 复用（关键架构问题）

#### (A) 官方稳定性分级（权威来源）

来源：`kotlinlang.org/docs/multiplatform/supported-platforms.html`（本会话直接解析页面中的两张 HTML 表格，逐格抽取，非搜索摘要）。

**表 1 —— 核心 Kotlin Multiplatform 技术（代码共享）稳定性：**

| 平台 | 稳定性 |
|---|---|
| Android | **Stable** |
| iOS | **Stable** |
| Desktop (JVM) | **Stable** |
| Server-side (JVM) | **Stable** |
| Web based on Kotlin/Wasm | **Beta** |
| Web based on Kotlin/JS | **Stable** |
| watchOS | **Beta** |
| tvOS | **Beta** |

**表 2 —— Compose Multiplatform UI 框架稳定性：**

| 平台 | 稳定性 |
|---|---|
| Android | **Stable** |
| iOS | **Stable** |
| Desktop (JVM) | **Stable** |
| Web based on Kotlin/Wasm | **Beta** |

> **结论**：**Compose Multiplatform 的 iOS 已是 Stable，Web/Wasm 仍是 Beta。** 且注意：表中"Web based on Kotlin/JS = Stable"**只适用于核心 KMP 代码共享，Compose UI 框架在 Web 上只有 Wasm 一条路且为 Beta**——两条不要混淆。另：**Compose Multiplatform 的 UI 表里没有 watchOS/tvOS**。

#### (B) KMP 能否消费 TypeScript / npm 包？—— 分平台，答案不同

这是本任务最关键、也最容易被错误简化的架构问题。逐一给出主源：

| 目标平台 | 能否直接用 TS/npm 包？ | 机制 | 来源（本会话实读） |
|---|---|---|---|
| **Kotlin/JS（Web）** | ✅ **可以** | `external` 声明描述 JS API；`external` 实现"provided externally (by the developer or via an **npm dependency**)"；另有 `js("...")` 内联 JS。 | `kotlinlang.org/docs/js-interop.html` 原文："When the compiler sees such a declaration, it assumes that the implementation … is provided externally (by the developer or via an **npm dependency**)" |
| **Kotlin/Wasm（Web）** | ✅ **可以** | 同样用 `external` 声明 + JavaScript modules。文档设有专章 "**Kotlin/Wasm and Kotlin/JS interoperability differences**"，即二者相似但有差异。 | `kotlinlang.org/docs/wasm-js-interop.html` 原文："Kotlin/Wasm allows you to use both JavaScript code in Kotlin and Kotlin code in JavaScript… you can notice that Kotlin/Wasm interoperability is similar [to Kotlin/JS]. **However, there are key differences to consider.**" |
| **Kotlin/Native（iOS / Android native / 桌面 native）** | ❌ **不能直接调用 JS/npm** | Kotlin/Native 的互操作只有 **C 和 Swift/Objective-C**（经 `cinterop`），**没有任何 JS 运行时或 JS interop**。 | `kotlinlang.org/docs/native-c-interop.html` 原文："Kotlin/Native comes with a **cinterop** tool… you can use it to quickly generate everything you need to interact with an external **C library**"；`native-objc-interop.html` 原文："Kotlin/Native provides indirect interoperability with **Swift through Objective-C**… Objective-C frameworks and libraries can be used in Kotlin code if properly imported"。两份官方互操作文档中**均无 JavaScript/JS 字样**。 |
| **Android（JVM 侧）** | ⚠️ 可在 JVM 上跑 JS 引擎，但非官方互操作 | 例如嵌入 QuickJS/JSC 之类的 JVM 绑定；**不是 KMP 官方能力，需额外引入第三方**。→ 具体可行性 `未核实` |

> ### 🚨 对架构的直接结论
>
> **一个 KMP App 无法在"所有目标平台"上复用同一个 TS/同步库。** 具体地：
> - 若 Sync 引擎是 **TypeScript**（如 RxDB / PowerSync JS SDK / Yjs / 自研 TS sync），则它**只能被 KMP 的 JS 或 Wasm 目标消费**——也就是**只在 Web 端**。
> - 在 **iOS 原生**（Kotlin/Native）上，Kotlin 只能通过 `cinterop` 调 **C / Objective-C** 代码。要复用 TS/JS sync 逻辑，**必须把 JS 引擎（QuickJS / JavaScriptCore）编译进 App 并自己搭桥**，或把同步逻辑**用 Kotlin 重写**，或改用**有 Kotlin/Native 原生实现的同步方案**（如 SQLDelight + 自建 sync，或 PowerSync 的 **Dart/Kotlin 原生 SDK** 路线但需确认其 KMP 支持）。
> - **因此"KMP 壳 + TS 同步内核"不是一个跨平台可复用的架构**：它在 Web 上成立，在 iOS/Android 原生上不成立。若坚持复用 TS sync，正确的技术组合是 **Tauri（Rust+WebView，六平台都跑同一个 WebView）** 或 **RN（JS 内核天然全平台）**，而不是 KMP。

**KMP 的真实应用证据**：`igorescodro/alkaa`（1645★, Apache-2.0）是 Android+iOS 的任务管理 App，`msasikanth/twine`（2414★, 但 GPL-3.0）是数据密集的 RSS 阅读器，`touchlab/KaMPKit`（2453★, Apache-2.0）是官方推荐模板。→ **KMP 做移动端任务 App 是成熟可行的；Web 端仍是 Beta。**

### 8.5 Tauri v2 移动端

来源：`v2.tauri.app/blog/tauri-20/`（本会话实读）。

- **Tauri 2.0 Stable 发布于 `2024-10-02`**（页面 JSON-LD `datePublished: 2024-10-02`）。
- 官方原文："**Tauri is a framework for building tiny and fast binaries for all major desktop (macOS, linux, windows) and mobile (iOS, Android) platforms.**"
- 官方原文："this release also targets mobile platforms, the plugin system also supports mobile plugins. You can write or re-use native code in **Swift on iOS and Kotlin on Android** and directly expose functions to the Tauri frontend."
- `v2.tauri.app/start/` 侧栏含 "Mobile Plugin Development / iOS / Android / Multi-Window on Mobile / File Associations on Mobile"，即移动端已是文档化的一等功能。
- 许可：**Apache-2.0 OR MIT**（`Cargo.toml` 原文），✅ 闭源商用。
- ⚠️ **注意版本**：本会话实测最新 release 为 `tauri v3.0.0-alpha.2`（`2026-09-21`）——**v3 已在 alpha**，生产环境应锁 v2 稳定线。

> **Tauri 对本项目的独特价值**：它把**同一个 WebView + 同一套 JS/TS 代码**带到 Windows/macOS/Linux/iOS/Android——**这正是 8.4 中"TS 同步内核无法在 KMP 原生端复用"的解法**。若同步/存储内核选 TypeScript（RxDB / PowerSync JS / Yjs），**Tauri 是目前唯一能让这段 TS 在全部 6 平台原样复用的框架**（代价：UI 是 WebView，而非原生渲染）。

---

## 结论 / 推荐

### 类别 6 —— Streak
- **不存在可复用的成熟 streak 库**（npm/pub 全量候选实测：要么名不符实、要么 <1000 周下载、要么个人项目、要么 5–14 年未更新）。
- 主流开源习惯 App（`mhabit`/`Habo` 的 `pubspec.yaml` 实测无 streak 依赖；`uhabits` 内嵌于 core）**全部自建**。
- **推荐：自建**一个纯函数模块（约 200–400 行 + 单测），必须覆盖：IANA 时区与本地日期键、DST 日历运算、schedule 与 occurrence 分离（skip/弹性）、每周配额模型、streak freeze 豁免记录、回溯编辑触发重算、当天未结束的语义、按 `(habit_id, local_date)` 索引的性能。参照实现可看 `FriesI23/mhabit`（**Apache-2.0**，允许借鉴）；**不要看 `uhabits`/`Habo` 的代码（GPL-3.0 传染）**。

### 类别 7 —— 本地数据库
- **许可最干净、覆盖最全的 Flutter 组合**：**`Drift`（MIT）+ `sqlite3`（MIT，含 Web/WASM）**，加密走 **`encrypted_drift`**（SQLite3MultipleCiphers）。`sqflite` 可作替代但 Web/Windows/Linux 需额外包且无加密。
- **KMP 首选 `SQLDelight`（Apache-2.0，活跃）**；**`Realm Kotlin` 已官方弃用，禁用**；**`ObjectBox` 源码 Apache-2.0 但二进制是专有可撤销许可 + 竞业禁止，需法务确认**。
- **JS/RN**：`WatermelonDB`（MIT）与 `RxDB` 核心（Apache-2.0）都可用于闭源商用；**但 RxDB 的官方 SQLite/OPFS 高性能存储属付费 Premium**，`WatermelonDB` 无 Linux 且提交已放缓 13 个月。`op-sqlite`（MIT，支持 SQLCipher）是 RN 侧最佳 SQLite 绑定。
- **🟥 三个必须避开的许可陷阱**：
  1. **PowerSync Service = FSL-1.1-ALv2**（禁止竞品商业用途；满 2 年自动转 Apache-2.0）——注意其**客户端 SDK 是 Apache-2.0，服务端不是**。
  2. **RxDB Premium 插件 = 付费专有**（无免费试用）。
  3. **ObjectBox 运行时二进制 = 专有 Binary License**（可撤销 + 竞业禁止），尽管源码是 Apache-2.0。
- **没有单一组件同时满足"全平台 + 宽松许可 + 活跃 + 加密 + 同步"**；同步层必须自建或接受 FSL/付费。

### 类别 8 —— 跨平台框架
- **Flutter**：移动+桌面五平台成熟，**Web 有三处硬约束**（无 `dart:io`→DB 必须走 WASM；无 isolate→重计算接 Worker；无默认 service worker→离线自建）。真实证据充分（`mhabit` 1596★ 全平台 habit tracker）。
- **React Native**：iOS/Android 官方 + **Windows（微软活跃维护 17347★）+ macOS（4386★，版本滞后约 7 个小版本）**；**Linux 无官方支持**，社区 `react-native-linux` 仅 32★。
- **KMP**：**Compose Multiplatform iOS 已 Stable，Web/Wasm 仍 Beta**。**核心限制：KMP 只能在 JS/Wasm 目标消费 TS/npm；iOS/Android 原生只能 cinterop 调 C/Objective-C，无法直接复用 TS 同步库。**
- **Tauri v2**：2024-10-02 稳定发布，官方支持 desktop + iOS + Android，许可 Apache-2.0 OR MIT。**它是让同一套 TS/TS 同步栈在全部 6 平台复用的唯一现实框架。**
- **✅ 最终推荐（按"全平台 + 闭源商用 + 可复用 TS 同步内核"加权）**：
  - **首选 Tauri 2（Apache-2.0 OR MIT）**：唯一能让 TS/本地优先同步栈（RxDB 核心 / Yjs / 自研）在 Windows/macOS/Linux/iOS/Android/Web 六端原样复用；代价是 WebView UI。
  - **次选 Flutter（+ Drift，均 MIT）**：UI 性能与桌面成熟度最好，但 Web 端要按 8.2 的三条约束单独设计，且**无法复用 TS 同步内核**（需用 Dart 重写或走 PowerSync Dart SDK）。
  - **不推荐 KMP 承载跨端 TS 同步内核**（8.4 的互操作硬约束）；**不推荐 RN 用于 Linux**（无官方目标）。**AppFlowy（AGPL）、Notesnook（GPL）、Twine（GPL）、Habo（GPL）一律只作研究、不可作组件。**

---

## 附录 —— 原始证据

### A. `tools/ghinfo.py` 实测输出（2026-09-25）

> 说明：以下为 `tools/ghinfo.py` 的实测结果。**为控制篇幅，`desc` 与 `topics` 两列做了截断/省略**（star / fork / license / archived / branch / last_commit / latest_release / top_lang 均逐字保留原值）。完整未截断数据见本会话 `ghinfo.py` 运行输出。

```
repo	stars	forks	license	archived	branch	last_commit	latest_release	top_lang	desc	topics
simolus3/drift	3281	469	MIT (MIT License)	false	develop	2026-09-24T15:08:44Z	drift-2.35.0 @ 2026-09-09T20:16:24Z	dart: 99.1%	Drift is an easy to use, reactive, typesafe persistence library for Dart & Flutter.
tekartik/sqflite	3020	556	BSD-2-Clause (BSD 2-Clause \)	false	master	2026-09-20T20:45:23Z	sqflite_common/v2.5.13 @ 2026-09-15T15:14:15Z	dart: 76.3%	SQLite flutter plugin
isar/isar	4024	602	Apache-2.0 (Apache License 2.0)	false	main	2025-06-14T08:12:25Z	v4.0.0-dev.14 @ 2023-08-21T09:36:48Z	dart: 48.5%	Extremely fast, easy to use, and fully async NoSQL database for Flutter
isar-community/isar	252	51	Apache-2.0 (Apache License 2.0)	true	v3	2025-08-18T03:33:46Z	3.1.8 @ 2024-08-13T08:32:33Z	dart: 71.1%	Extremely fast, easy to use, and fully async NoSQL database for Flutter
isar-community/isar-community	193	98	Apache-2.0 (Apache License 2.0)	false	v3	2026-09-08T04:40:41Z	3.3.2 @ 2026-03-23T20:28:35Z	dart: 70.8%	Extremely fast, easy to use, and fully async NoSQL database for Flutter
powersync-ja/powersync.dart	251	40	NA	false	main	2026-09-23T12:22:59Z	powersync-v2.4.0 @ 2026-09-02T19:17:26Z	dart: 99.7%	PowerSync client SDK for Flutter/Dart
powersync-ja/powersync-service	386	57	NOASSERTION (Other)	false	main	2026-09-23T11:42:12Z	v1.26.1 @ 2026-09-14T21:50:19Z	typescript: 99.6%	PowerSync Service is the server-side component of the PowerSync sync engine.
powersync-ja/powersync-js	724	92	Apache-2.0 (Apache License 2.0)	false	main	2026-09-23T11:14:02Z	@powersync/web@2.4.1 @ 2026-09-23T11:15:52Z	typescript: 92.2%	PowerSync client SDKs for JavaScript clients
simolus3/sqlite3.dart	299	124	MIT (MIT License)	false	main	2026-09-16T19:25:53Z	sqlite3-3.6.0 @ 2026-09-13T15:22:49Z	dart: 85.9%	sqlite3 bindings for Dart
Nozbe/watermelondb	11786	659	MIT (MIT License)	false	master	2025-08-11T12:09:31Z	v0.28.1-0 @ 2025-07-24T09:14:06Z	javascript: 70.1%	Reactive & asynchronous database for powerful React and React Native apps
pubkey/rxdb	23391	1176	Apache-2.0 (Apache License 2.0)	false	master	2026-09-18T06:49:12Z	17.5.0 @ 2026-08-20T12:56:29Z	typescript: 92.9%	The local-first database that runs on every JS runtime
OP-Engineering/op-sqlite	1044	91	MIT (MIT License)	false	main	2026-09-20T16:24:13Z	Release 18.2.5 @ 2026-09-20T14:34:46Z	c: 98.0%	Fastest SQLite library for react-native by @ospfranco
WiseLibs/better-sqlite3	7496	480	MIT (MIT License)	false	master	2026-08-10T03:10:10Z	v13.0.3 @ 2026-08-05T03:26:05Z	javascript: 68.4%	The fastest and simplest library for SQLite3 in Node.js.
sql-js/sql.js	13663	1115	NOASSERTION (Other)	false	master	2026-08-14T18:15:38Z	Release v1.14.2 @ 2026-08-14T18:13:05Z	javascript: 88.9%	A javascript library to run SQLite on the web.
vlcn-io/cr-sqlite	3800	125	MIT (MIT License)	false	main	2026-08-10T10:55:49Z	v0.16.3: 0.16.3 release @ 2024-01-17T17:47:06Z	rust: 55.5%	Convergent, Replicated SQLite. Multi-writer and CRDT support for SQLite
cashapp/sqldelight	6885	578	Apache-2.0 (Apache License 2.0)	false	main	2026-09-22T12:47:57Z	2.4.0 @ 2026-09-18T06:56:18Z	kotlin: 95.1%	SQLDelight - Generates typesafe Kotlin APIs from SQL
realm/realm-kotlin	1103	95	Apache-2.0 (Apache License 2.0)	false	main	2025-01-20T20:27:06Z	v3.0.0 @ 2024-10-03T10:55:04Z	kotlin: 96.1%	Kotlin Multiplatform and Android SDK for the Realm Mobile Database
objectbox/objectbox-java	4624	311	Apache-2.0 (Apache License 2.0)	false	main	2026-07-15T04:35:53Z	6.0.0-beta @ 2026-07-15T04:32:11Z	java: 96.2%	Database for Android and JVM
rusqlite/rusqlite	4408	500	MIT (MIT License)	false	master	2026-09-21T10:45:45Z	0.40.2 @ 2026-08-08T14:20:24Z	rust: 99.5%	Ergonomic bindings to SQLite for Rust
launchbadge/sqlx	17499	1705	Apache-2.0 (Apache License 2.0)	false	main	2026-09-14T15:02:32Z	v0.9.0 @ 2026-05-21T17:30:35Z	rust: 99.0%	The Rust SQL Toolkit
sqlcipher/sqlcipher	7285	1401	BSD-3-Clause (BSD 3-Clause \)	false	master	2026-09-06T14:38:47Z	v5.0.0-beta @ 2026-09-15T16:18:07Z	c: 81.0%	SQLCipher is a standalone fork of SQLite that adds 256 bit AES encryption
FriesI23/mhabit	1596	95	Apache-2.0 (Apache License 2.0)	false	main	2026-09-23T12:09:15Z	v1.27.9+198 @ 2026-09-20T23:24:07Z	dart: 97.6%	Open-source Flutter habit tracker
iSoron/uhabits	10275	1256	GPL-3.0 (GNU General Public License v3.0)	false	dev	2026-07-21T12:58:29Z	v2.3.1 @ 2025-08-14T02:33:03Z	kotlin: 83.3%	Loop Habit Tracker
AppFlowy-IO/AppFlowy	76917	6041	AGPL-3.0 (GNU Affero General Public License v3.0)	false	main	2026-06-26T02:35:45Z	v0.14.5 @ 2026-09-25T01:37:50Z	dart: 73.6%	AI collaborative workspace
microsoft/react-native-windows	17347	1208	NOASSERTION (Other)	false	main	2026-09-24T02:59:41Z	react-native-windows_v0.85.0-preview.2 @ 2026-09-25T04:27:20Z	c++: 48.8%	A framework for building native Windows apps with React.
microsoft/react-native-macos	4386	172	MIT (MIT License)	false	main	2026-09-01T16:19:47Z	v0.81.9 @ 2026-07-13T19:07:12Z	c++: 31.9%	A framework for building native macOS apps with React.
JetBrains/compose-multiplatform	19386	1429	Apache-2.0 (Apache License 2.0)	false	master	2026-09-24T15:30:50Z	v1.13.0-alpha02+dev4869 @ 2026-09-25T03:15:10Z	kotlin: 99.2%	Compose Multiplatform
tauri-apps/tauri	111382	4025	Apache-2.0 (Apache License 2.0)	false	dev	2026-09-25T01:39:09Z	tauri v3.0.0-alpha.2 @ 2026-09-21T16:10:29Z	rust: 81.4%	Build smaller, faster, and more secure desktop and mobile applications
facebook/react-native	126724	25285	MIT (MIT License)	false	main	2026-09-25T06:30:04Z	0.88.0-rc.2 @ 2026-09-22T08:52:19Z	c++: 35.1%	A framework for building native applications using React
streetwriters/notesnook	14636	1008	GPL-3.0 (GNU General Public License v3.0)	false	master	2026-09-18T04:52:27Z	Notesnook Android v3.4.13 @ 2026-09-15T11:30:33Z	typescript: 85.5%	A fully open source & end-to-end encrypted note taking alternative to Evernote
touchlab/KaMPKit	2453	212	Apache-2.0 (Apache License 2.0)	false	main	2026-09-18T19:10:35Z	NO-RELEASES	kotlin: 86.3%	KaMP Kit by Touchlab
msasikanth/twine	2414	138	GPL-3.0 (GNU General Public License v3.0)	false	main	2026-09-08T10:15:07Z	v3.9.0 @ 2026-09-09T03:57:15Z	kotlin: 92.3%	Twine: A multiplatform RSS reader built using Kotlin and Compose
```

补充实测行（App / 社区平台）：

```
darkmoonight/Zest	485	59	MIT (MIT License)	false	main	2026-07-15T13:38:59Z	dev @ 2026-02-24T12:04:42Z	dart: 92.0%	Task management application
huextrat/Taskist	1057	267	MIT (MIT License)	false	master	2020-07-09T17:54:35Z	NO-RELEASES	dart: 95.9%	Flutter ToDo App with Firebase
burhanrashid52/WhatTodo	1265	275	Apache-2.0 (Apache License 2.0)	false	master	2024-11-16T11:27:52Z	2.0.2 @ 2024-11-09T10:54:57Z	dart: 94.7%	A Simple Todo app design in Flutter
asjqkkkk/flutter-todos	2120	459	MIT (MIT License)	false	master	2025-12-19T05:52:32Z	v1.1.2 @ 2020-03-10T02:42:46Z	dart: 99.1%	one day list app created by flutter
igorescodro/alkaa	1645	163	Apache-2.0 (Apache License 2.0)	false	main	2026-05-25T16:16:37Z	v3.4.2 @ 2026-01-02T21:19:10Z	kotlin: 70.3%	Kotlin multiplatform app to manage your tasks
felipejoglar/taskodoro-apps	3	0	Apache-2.0 (Apache License 2.0)	false	main	2024-02-01T08:32:19Z	NO-RELEASES	kotlin: 99.6%	Taskodoro is the productivity app made with Kotlin Multiplatform
limboy/habbit	140	20	MIT (MIT License)	false	master	2019-01-27T01:10:42Z	NO-RELEASES	dart: 96.2%	an ultra simple habit tracker powered by flutter
xpavle00/Habo	1511	180	GPL-3.0 (GNU General Public License v3.0)	false	master	2026-05-06T19:31:03Z	v4.0.0 @ 2026-05-10T15:33:48Z	dart: 95.8%	Privacy-first habit tracker
unbug/TodoRN	74	27	NA	false	master	2016-10-13T02:08:44Z	NO-RELEASES	javascript: 83.8%	React Native+Redux TodoMVC App
lucid-softworks/react-native-linux	32	4	NOASSERTION (Other)	false	main	2026-07-27T09:02:03Z	NO-RELEASES	c++: 47.5%	(no description)
sarthakpranesh/react-native-everywhere	74	14	MIT (MIT License)	false	main	2022-08-07T15:53:43Z	RNE v2.0.0 @ 2022-08-07T16:00:47Z	typescript: 95.1%	React Native Template based on Expo and Tauri
expo/expo	52422	14185	MIT (MIT License)	false	main	2026-09-25T06:17:49Z	prefold/web @ 2026-09-17T12:04:07Z	typescript: 56.8%	An open-source framework for making universal native apps with React
```

### B. 许可证原文关键片段（`curl raw.githubusercontent.com/.../HEAD/LICENSE*`）

| 仓库 | 文件 | 原文关键行 |
|---|---|---|
| pubkey/rxdb | `LICENSE.txt` | `Apache License / Version 2.0, January 2004` |
| objectbox/objectbox-java | `LICENSE.txt` | `Apache License / Version 2.0`（**但二进制另见 objectbox.io/0209-ob-binary-license/**） |
| realm/realm-kotlin | `LICENSE` | `Apache License / Version 2.0`（README 顶部另有 **deprecation 红头**） |
| isar/isar ；isar-community/isar | `LICENSE` | `Apache License / Version 2.0` |
| Nozbe/watermelondb | `LICENSE` | `MIT License / Copyright (c) Nozbe` |
| OP-Engineering/op-sqlite | `LICENSE` | `Copyright 2021 Oscar Franco` + 标准 MIT 正文 |
| vlcn-io/cr-sqlite | `LICENSE` | `MIT License / Copyright (c) 2023 One Law LLC` |
| cashapp/sqldelight | `LICENSE.txt` | `Apache License / Version 2.0` |
| powersync-ja/powersync.dart | `packages/powersync/LICENSE` | `Apache License / Version 2.0`（**仓库根无 LICENSE**） |
| powersync-ja/powersync-service | `LICENSE` | `# Functional Source License, Version 1.1, ALv2 Future License` / `FSL-1.1-ALv2` |
| iSoron/uhabits | `LICENSE.txt` | `GNU GENERAL PUBLIC LICENSE / Version 3, 29 June 2007` |
| FriesI23/mhabit | `LICENSE` | `Apache License / Version 2.0` |
| AppFlowy-IO/AppFlowy | `LICENSE` | `GNU AFFERO GENERAL PUBLIC LICENSE / Version 3, 19 November 2007` |
| microsoft/react-native-windows | `LICENSE` | `The MIT License (MIT) / Copyright (c) Microsoft Corporation`（含 "Portions derived from React Native"） |
| microsoft/react-native-macos | `LICENSE` | `MIT License / Copyright (c) Meta Platforms, Inc.` |
| JetBrains/compose-multiplatform | `LICENSE.txt` | `Apache License / Version 2.0` |
| simolus3/drift | `LICENSE` | `MIT License / Copyright (c) 2019 Simon Binder` |
| tekartik/sqflite | `LICENSE` | `BSD 2-Clause License / Copyright (c) 2019, Alexandre Roux Tekartik` |
| sql-js/sql.js | `LICENSE` | `MIT license / Copyright (c) 2017 sql.js authors (see AUTHORS)` |
| tauri-apps/tauri | `LICENSE-MIT` / `LICENSE-APACHE-2.0` / `LICENSE.spdx` | `MIT License / Copyright (c) 2017 - Present Tauri Apps Contributors`；`Cargo.toml` → `license = "Apache-2.0 OR MIT"` |
| launchbadge/sqlx | `Cargo.toml` | `license = "MIT OR Apache-2.0"` |
| rusqlite/rusqlite | `Cargo.toml` | `license = "MIT"` |
| abdullah-cse/streak_calculator | `LICENSE` | `MIT License` |
| Mohiuddin655-PUB/flutter_streak | `LICENSE` | `Apache License / Version 2.0` |
| yassine-bennkhay/streakify | `LICENSE` | `MIT License` |
| androidshashi/streak_plus | `LICENSE` | `MIT License` |

**ObjectBox Binary License 关键原文**（`https://objectbox.io/0209-ob-binary-license/`）：
> "…grants to Licensee, a non-exclusive, non-transferable, non-sublicensable, **revocable**, limited, **royalty-free** licence for the Term to use the Software in creating Applications."
> "vi. use the Software for purposes of the development of a **competing software product or service**, or any other purpose that is to Licensor's commercial disadvantage."

**RxDB Premium 关键原文**（`https://rxdb.info/premium/`）：
> "While the **core of RxDB is free and open-source**, we offer **paid licenses** for businesses and professionals. Pro and Pro Plus tiers add **commercial plugins**…"
> 付费插件清单：Premium storages (OPFS, SQLite, Filesystem) / Performance plugins (Sharding, Memory-Mapped) / Performance plugins & server adapters / Logger / SLA、自定义商业条款。
> "**We do not currently offer a free trial.**"

**PowerSync Service (FSL) 关键原文**（`https://raw.githubusercontent.com/powersync-ja/powersync-service/main/LICENSE`）：
> "**Permitted Purpose** … A Permitted Purpose is any purpose other than a **Competing Use**. A Competing Use means making the Software available to others in a commercial product or service that…"
> "**Grant of Future License**: We hereby irrevocably grant you an additional license to use the Software under the **Apache License, Version 2.0** that is effective on the **second anniversary** of the date we make the Software available."

### C. 包注册表实测（pub.dev / npm）

**pub.dev score 标签（`platform:*` / `license:*`）实测：**

```
drift             likes 2473  dl30d 1339010  [platform:android,ios,windows,linux,macos,web; license:mit]
sqflite           likes 5566  dl30d 3219315  [platform:android,ios,macos; license:bsd-2-clause]      ← 无 web/windows/linux
isar              likes 2448  dl30d 3367     [platform:android,ios,windows,linux,macos,web; license:apache-2.0]  (v3.1.0+1 @2023-04-25)
isar_community    likes  161  dl30d 102411   [platform:android,ios,windows,linux,macos; license:apache-2.0]        ← 无 web
sqlite3           likes  464  dl30d 2501977  [platform:android,ios,windows,linux,macos,web; license:mit]
sqlite3_flutter_libs    likes 176 dl30d 601214 [platform:...全6; license:mit]  v0.6.0+eol
sqlcipher_flutter_libs  likes  39 dl30d  70564 [platform:...全6; license:mit,bsd-3-clause-hp,pixar]  v0.7.0+eol
powersync         likes  154  dl30d  30283   [platform:android,ios,windows,linux,macos,web; license:apache-2.0]
sqflite_sqlcipher likes  165  dl30d  87032   [platform:android,ios,macos; license:mit]  v3.4.1 @2026-08-04
```

**pub.dev streak 包实测：**

```
streak_calculator  latest 1.0.0   @2026-01-02  likes 17  dl30d 47   repo abdullah-cse/streak_calculator  (MIT)
streak_calendar    latest 1.1.2   @2024-07-15  likes 13  dl30d 69   repo habit-rewards/streak_calendar
flutter_streak     latest 1.0.1   @2025-09-26  likes  3  dl30d 28   repo Mohiuddin655-PUB/flutter_streak  (Apache-2.0)
streakify          latest 0.0.2   @2024-09-15  likes  7  dl30d 6    repo yassine-bennkhay/streakify       (MIT)
streak_plus        latest 0.0.1   @2026-03-26  likes  2  dl30d 8    repo androidshashi/streak_plus        (MIT)
animated_habit_heatmap latest 0.2.0 @2026-03-08 (widget)
```

**npm 实测（`registry.npmjs.org/-/v1/search?text=streak` → `total: 620`；下载量来自 `api.npmjs.org/downloads/point/last-week`）：**

```
date-streaks      1.2.1  @2020-03-17  ISC   dl/week 898
use-streak        1.0.4  @2021-11-15  MIT   dl/week 25
streak-calc-math  1.0.0  @2026-08-05  MIT   dl/week 48
@molecule/api-streak 1.0.2 @2026-09-20 Apache-2.0 dl/week 169
streak            0.1.0  @2012-05-18  license: None  dl/week 0
longest-streak    3.1.0  @2022-11-15  MIT   （字符串最长重复子串，与习惯无关）
```

**npm op-sqlite：** `@op-engineering/op-sqlite` latest `18.2.5`，`license: MIT`，`modified 2026-09-20`。

### D. 官方文档原文摘录

**1. Compose Multiplatform / KMP 稳定性（kotlinlang.org，`<table>` 原样解析）：**

```
[表1 核心 KMP 代码共享]  Android=Stable | iOS=Stable | Desktop(JVM)=Stable | Server-side(JVM)=Stable
                        | Web(Kotlin/Wasm)=Beta | Web(Kotlin/JS)=Stable | watchOS=Beta | tvOS=Beta
[表2 Compose Multiplatform UI]  Android=Stable | iOS=Stable | Desktop(JVM)=Stable | Web(Kotlin/Wasm)=Beta
```

**2. Kotlin 互操作能力边界：**

```
js-interop.html:      "…it assumes that the implementation … is provided externally (by the developer or via an npm dependency)"
wasm-js-interop.html: "Kotlin/Wasm allows you to use both JavaScript code in Kotlin and Kotlin code in JavaScript … However, there are key differences"
native-c-interop.html:   "Kotlin/Native comes with a cinterop tool … to interact with an external C library"
native-objc-interop.html:"Kotlin/Native provides indirect interoperability with Swift through Objective-C … Pure Swift modules are not yet supported"
→ 两份 native 互操作文档均无 JavaScript 字样：Kotlin/Native（iOS/Android 原生）不能直接消费 TS/npm。
```

**3. React Native 平台清单（`reactnative.dev/docs/out-of-tree-platforms` 原文）：**

```
From Partners: React Native macOS | React Native Windows | React Native visionOS | React Native OpenHarmony
From Community: React Native tvOS | React Native Web
                | React Native Skia - "React Native using Skia as a renderer. Currently supports Linux and macOS."
→ 官方一等公民 = iOS + Android；Linux 无完整 RN 平台 target。
```

**4. Flutter Web FAQ（`docs.flutter.dev/platform-integration/web/faq`，Flutter 3.47，页面更新 2026-09-21）：**

```
"What scenarios are ideal for Flutter on the web?" → "…particularly suited for app-centric experiences: Progressive Web Apps / Single Page Apps / Existing Flutter mobile apps. At this time, Flutter is not suitable for static websites with text-rich flow-based content."
"Search Engine Optimization (SEO)" → "…application output doesn't align with what search engines need to properly index."
"Can I use dart:io with a web app?" → "No. The file system is not accessible from the browser."
"Does Flutter web support concurrency?" → "Dart's concurrency support that uses isolates is not currently supported in Flutter web."
"Does hot reload work with a web app?" → "Yes! For more information, check out hot reload on the web."
"How do I configure a service worker?" → "Flutter no longer generates or manages a caching service worker by default … you need to configure a service worker yourself."
```

**5. Tauri v2 移动端（`v2.tauri.app/blog/tauri-20/`，`datePublished: 2024-10-02`）：**

```
"Tauri is a framework for building tiny and fast binaries for all major desktop (macOS, linux, windows) and mobile (iOS, Android) platforms."
"…the plugin system also supports mobile plugins. You can write or re-use native code in Swift on iOS and Kotlin on Android and directly expose functions to the Tauri frontend."
```

**6. drift 加密（`drift.simonbinder.eu/platforms/encryption/`）：**

```
"Use drift on encrypted databases… There are two ways to use drift on encrypted databases."
"…This allows you to use an encrypted drift database on all native platforms, including Desktop."
"…instead, which provides encryption support."（指 encrypted_drift / SQLite3MultipleCiphers；旧方案 sqlcipher_flutter_libs 已 EOL）
```

**7. WatermelonDB 平台（`watermelondb.dev/docs`）：**

```
"Multiplatform. iOS, Android, Windows, web, and Node.js"
```

### E. `未核实` 清单（明确未取得主源的项目）

| 项目 | 未核实的字段 | 原因 |
|---|---|---|
| 各 streak 包（`streak_calculator` 等） | GitHub Star | 只查了 pub.dev 注册表与仓库 LICENSE，未对每个小仓库跑 ghinfo |
| `streak_calendar` | License（精确 SPDX） | 仓库 LICENSE 文件首行为非标准 "Copyright 2013 Deepanshu Chaudhary"，pub.dev 标签未列 license |
| `PowerSync`（客户端）静态加密 | SQLCipher 支持 | 未读到明确声明 |
| `better-sqlite3` 静态加密 | SQLCipher 编译路径 | 未逐行核实文档 |
| `SQLDelight` 静态加密 / Web driver | 官方封装 | 未深入核实 |
| `ObjectBox` 静态加密 | 加密支持 | 文档站 `docs.objectbox.io/sync` 重定向异常，未读到原文 |
| `Realm Kotlin` 静态加密 | 文档级 | 未逐行核实文档（且已弃用，无必要） |
| `rusqlite` SQLCipher feature | 精确 feature 名 | 未核实 `Cargo.toml` 的 feature 列表 |
| `flutter/flutter` 框架 | Star / License / 提交 | 本轮聚焦"用 Flutter 写的真实 App"，框架元数据未抓取 |
| `lucid-softworks/react-native-linux` | License | GitHub 显示 `NOASSERTION`，未回原文 |
| KMP 消费 JS 的"Android JVM 嵌入 JS 引擎" | 可行性 | 未找到官方文档支持，标记为需第三方方案 |
