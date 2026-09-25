# 模块 7：跨端同步引擎 / CRDT / 离线优先数据库 —— 授权与商业可用性精确判断

- **调研日期**：2026-09-25（所有 star / last commit / release 均为当日实测）
- **调研目标**：为自研「滴答清单（TickTick）替代品」筛选可合法商用、可长期维护的 local-first 跨端同步方案
- **取证方式**：
  - Star / fork / archived / default branch / last commit / latest release：`research/ghinfo.py` 抓取 github.com 公开 HTML + `commits.atom` / `releases.atom`（**非** api.github.com）
  - License 判定：**一律 `curl` 抓 `raw.githubusercontent.com` 的 LICENSE 原文**（`LICENSE` / `LICENSE.md` / `LICENSE.txt` / `COPYING` 逐个回退），必要时追加读取 `licenses/` 子目录、`package.json` 的 `license` 字段、文件头 SPDX 声明
  - 商业条款：优先抓官方 licensing / pricing / FAQ 页面原文；搜索摘要仅作线索，**单独标注为"官网/搜索说法"**
- **证据分级**（下文表格「关键条款摘录」列内标注）：
  - `[原文]` = 直接读到 LICENSE / 官方 licensing 页面原文
  - `[元数据]` = GitHub 页面 license 字段 + 已用原文交叉验证一致
  - `[官网]` = 官网营销页 / pricing 页说法（未读完整法律文本）
  - `[搜索]` = 搜索索引摘要，**未核实**
  - `[未核实]` = 拿不到证据，明确留空

---

## 0. 一句话结论

**真正"完全开源可商用 + 自带同步能力"的组合只有三条路**：① Yjs/Loro/Automerge（纯 CRDT 库）+ 自写同步服务（Hocuspocus / y-websocket，均 MIT）；② Electric（Apache-2.0，但只有 Postgres 只读下行，写路径要自己写）；③ Zero / LiveStore / cr-sqlite / SQLSync（Apache-2.0 或 MIT，服务端要自建）。
**PowerSync、Couchbase Lite 4.x、sqlite-sync、Triplit、ObjectBox Sync、Ditto 属于 source-available / BSL / AGPL / 纯商业**，作为"自研商业 SaaS"有明确法律或架构风险，其中 sqlite-sync 与 Couchbase BSL 的条款直接禁止"提供竞争性托管服务"。

---

## 1. 主表：纯 CRDT 库（引擎层）

| 项目 | 仓库 | Star（2026-09-25 实测） | License | 开源可商用？ | 技术栈 | 活跃度 | 定位/集成方式 | 关键条款摘录 |
|---|---|---|---|---|---|---|---|---|
| **Yjs** | https://github.com/yjs/yjs | 22,842 | **MIT** | ✅ **是**（完全开源可商用） | TypeScript/JS（含 Rust/其他语言绑定） | last commit 2026-09-22；v13.6.33 @ 2026-09-23；未 archived | 底层 CRDT 引擎，最成熟生态。库（嵌入） | `[原文]` LICENSE 为逐字标准 MIT 文本（Copyright 2023 Kevin Jahns / RWTH Aachen）。GitHub 显示 NOASSERTION 属解析误报，原文无附加限制。 |
| **Automerge** | https://github.com/automerge/automerge | 6,615 | **MIT** | ✅ **是** | Rust 核心 + JS/WASM（Rust 占约 50%） | last commit 2026-09-24；rust/automerge-0.12.0 @ 2026-09-16；未 archived | JSON-like CRDT，历史/分支模型强。库 | `[原文]` LICENSE：`Copyright (c) 2019-2021 the Automerge contributors` + 标准 MIT 授权段。 |
| **Loro** | https://github.com/loro-dev/loro | 6,167 | **MIT** | ✅ **是** | Rust 核心（78.7%）+ WASM/Swift/Kotlin 绑定 | last commit 2026-09-21；rust-pre-release 1.16.2 @ 2026-09-21；未 archived | 高性能 CRDT，富文本/列表/Map，内存与体积优于 Yjs。库 | `[原文]` LICENSE：`MIT License / Copyright (c) 2023 Loro`，无附加条款。 |
| **SyncedStore** | https://github.com/YousefED/SyncedStore | 1,863 | **MIT** | ✅ 是（但**已停更**） | TypeScript（Yjs 之上封装） | **last commit 2023-10-31（近 3 年无提交）**；v0.6.0 @ 2023-10-15；未 archived | 声明式 Yjs 封装。库 | `[原文]` MIT。**活跃度是唯一风险**：不建议新项目采用。 |
| **TinyBase** | https://github.com/tinyplex/tinybase | 5,177 | **MIT** | ✅ **是** | TypeScript（52.5%，含 React/Svelte/Solid 绑定） | last commit 2026-09-23；v10.1.0-beta.0 @ 2026-09-24；未 archived | 响应式数据存储 + 同步引擎，可对接 Yjs/Automerge 或第三方同步。库 | `[原文]` LICENSE：`MIT License / Copyright (c) James Pearce, 2021 -`。**无自家付费云**（官网仅推荐第三方同步后端）。`[官网]` tinybase.org 架构选项页明确"第三方同步平台可能产生商业服务费用"。 |

---

## 2. 主表：同步/后端一体（服务端 + 客户端）

| 项目 | 仓库 | Star（2026-09-25 实测） | License | 开源可商用？ | 技术栈 | 活跃度 | 定位/集成方式 | 关键条款摘录 |
|---|---|---|---|---|---|---|---|---|
| **Electric** | https://github.com/electric-sql/electric | 10,370 | **Apache-2.0** | ✅ **是**（完全开源可商用） | Elixir 服务端 + TypeScript 客户端 | last commit 2026-09-09；最新 tag expo-db-electric-starter@1.0.29 @ 2026-09-09；未 archived | Postgres **只读下行**同步（Shapes + HTTP API），写路径需自建。服务（自托管）| `[原文]` LICENSE 为逐字 Apache-2.0 全文；README 徽章亦标 `license-Apache_2.0`。**注意 license 随版本变化的说法未获证实**：旧仓库 `electric-sql/electric-old` 的 LICENSE 同为 Apache-2.0，本次未发现任何 BSL/FSL 阶段证据。⚠️ 功能定位：**不是双向 CRDT**，README 明确写的是 read-path sync。 |
| **PowerSync Service** | https://github.com/powersync-ja/powersync-service | 386 | **FSL-1.1-ALv2**（Functional Source License 1.1, ALv2 Future License） | ⚠️ **混合/source-available**：非竞争用途可自托管，**"竞争性托管服务"被禁止** | TypeScript（99.6%） | last commit 2026-09-23；v1.26.1 @ 2026-09-14；未 archived | 服务端同步服务。服务（自托管 / 官方 SaaS） | `[原文]` LICENSE 原文关键条款：「A Permitted Purpose is any purpose other than a **Competing Use**. A Competing Use means making the Software available to others in a commercial product or service that: 1. substitutes for the Software; 2. substitutes for any other product or service we offer using the Software...; 3. offers the same or substantially similar functionality as the Software.」+「We hereby irrevocably grant you an additional license to use the Software under the **Apache License, Version 2.0** that is effective on the **second anniversary** of the date we make the Software available.」→ **每个版本发布满 2 年后自动转 Apache-2.0**。 |
| **PowerSync 客户端 SDK（JS）** | https://github.com/powersync-ja/powersync-js | 724 | **Apache-2.0** | ✅ **是** | TypeScript | last commit 2026-09-23；@powersync/web@2.4.1 @ 2026-09-23；未 archived | 客户端库。库 | `[原文]` Apache-2.0 全文。 |
| PowerSync SDK — Swift | https://github.com/powersync-ja/powersync-swift | 62 | **Apache-2.0** | ✅ 是 | Swift | 2026-09-19；1.16.2 @ 2026-09-16 | 客户端库 | `[元数据]` GitHub license 字段 Apache-2.0。 |
| PowerSync SDK — .NET | https://github.com/powersync-ja/powersync-dotnet | 51 | **Apache-2.0** | ✅ 是 | C# | 2026-09-17；PowerSync.Maui@0.1.5 @ 2026-09-10 | 客户端库 | `[元数据]` Apache-2.0。 |
| PowerSync SDK — Kotlin | https://github.com/powersync-ja/powersync-kotlin | 125 | **无 LICENSE 文件**（仓库根目录经核实只有 README/CHANGELOG/gradle 等，无任何 LICENSE） | ❓ **未核实**——无许可证声明即默认保留全部权利 | Kotlin | 2026-09-15；v1.15.1 @ 2026-09-07 | 客户端库 | `[原文]` 逐文件回退 `LICENSE / LICENSE.md / LICENSE.txt / COPYING` 全部 404，GitHub 亦显示 license 为空。**采用前必须向厂商索取书面授权确认**（对比：同厂商 Swift/.NET SDK 均为 Apache-2.0，推测是遗漏而非故意，但法律上"推测"无效）。 |
| **Rocicorp Mono（Zero + Replicache）** | https://github.com/rocicorp/mono | 3,392 | **Apache-2.0**（仓库根 LICENSE） | ✅ **是** | TypeScript（99%） | last commit 2026-09-24；zero/v1.11.0-canary.13 @ 2026-09-24；未 archived | Zero = 同步引擎 + `zero-cache` 服务端；Replicache 同仓维护。库 + 服务（自托管）| `[原文]` 根 LICENSE 为逐字 Apache-2.0；`packages/replicache/package.json` 显式 `"license": "Apache-2.0"`，版本 15.2.1。`packages/zero-client` / `zero-cache` / `zql` 的 package.json **未声明 license 字段**（版本 0.0.0，构建产物注入），仓库级 LICENSE 覆盖。**Zero 是 Apache-2.0**（用户预设正确）。 |
| **Replicache（历史仓库）** | https://github.com/rocicorp/replicache | 1,174 | **未声明**（仓库已无 LICENSE 文件） | ⚠️ 见上（代码已并入 mono，按 Apache-2.0 取用） | — | **archived = true**；last commit 2022-04-22；v10.0.0 GA @ 2022-05-09 | 已归档，仓库仅剩 README。 | `[原文]` 该仓库根目录经核实**只有 README.md**，无 LICENSE，GitHub license 字段为 NA。`[官网]` replicache.dev 首页原文：「After five years... Replicache is now in **maintenance mode**. We have **open-sourced the code and no longer charge for its use**. We have shifted focus to Zero.」→ **Replicache 现在不收费、不开新功能**；生产代码请从 `rocicorp/mono` 取（Apache-2.0）。 |
| **Ditto（DittoLive）** | 无开源核心仓库。GitHub 组织 https://github.com/getditto 下有 **30 个公开仓库**，均为工具链/示例/二进制分发包装（DittoSwiftPackage、DittoChat、dittocloud、ditto-cli 等） | 核心 SDK 无仓库（不计） | **Ditto Binary License**（专有商业许可） | ❌ **否**——商业 SDK，非开源 | 闭源二进制（C++ 核心）+ 各语言绑定 | 组织仓库活跃，但**核心闭源** | 商业 SDK / 托管 SaaS + P2P（蓝牙/WiFi mesh） | `[原文]` `getditto/DittoSwiftPackage` 的 `LICENSE.md` 原文：「**Ditto Binary License** ... NOTICE: All information contained herein is, and remains the property of DittoLive. The intellectual and technical concepts contained herein are **proprietary** to DittoLive ... 1. You agree **not to attempt to decompile, disassemble, reverse engineer** or otherwise discover the source code from which the binary code was derived.」+ 官网 https://www.ditto.com/sdk-license 同文本。→ **纯商业授权，无开源路径**。 |
| **Triplit** | https://github.com/aspen-cloud/triplit | 3,115 | **AGPL-3.0-only** | ⚠️ **是但 copyleft 传染**——AGPL 网络条款触发源码开放义务 | TypeScript（87.7%） | last commit **2025-09-11**（近 1 年无提交，疑似停滞）；vue-template@1.0.51 @ 2025-07-31；未 archived | 全栈同步数据库（IndexedDB/SQLite/Durable Objects 存储，WebSocket 同步）。库 + 服务 | `[原文]` 根 LICENSE 为逐字 AGPL-3.0 全文；`packages/client/package.json` 显式 `"license": "AGPL-3.0-only"`。其余包（server/db/react/svelte/server-core）未声明 license 字段。**若自研替代品是闭源商业 SaaS，直接嵌入 `@triplit/client` 会触发 AGPL 源码披露义务**。 |
| **InstantDB** | https://github.com/instantdb/instant | 10,522 | **Apache-2.0** | ✅ **是**（代码层） | TypeScript 48% + Clojure | last commit 2026-09-24；无 release tag（NO-RELEASES）；未 archived | 全栈后端（auth/permissions/storage/presence/streams）+ 客户端实时同步。库 + 官方 SaaS | `[原文]` 仓库根 `LICENSE.md` 为逐字 Apache-2.0 全文。`[官网]` instantdb.com/docs/self-hosting 提供自托管指南（VPS 约 $30/月起，AWS 生产约 $600/月起），官方 Instant Cloud 为付费托管。 |
| **Jazz** | https://github.com/garden-co/jazz | 196 | **MIT** | ✅ **是** | Rust 71.2% + TypeScript | last commit 2026-09-25；Jazz 2.0.0-alpha.56 @ 2026-09-21；未 archived | local-first 关系型数据库（浏览器/RN/后端）+ 官方全球存储云。库 + SaaS | `[原文]` LICENSE 原文：`MIT License / Copyright (c) 2026 Garden Computing, Inc. and contributors`，**唯一附加说明**：「The webfont files bundled with the homepage under `docs/public/fonts/` are expressly excluded from the MIT license above」→ 仅字体例外，代码本体 MIT。`[官网]` garden.co 提到"our global storage cloud"为商业基础设施。 |
| **Evolu** | https://github.com/evoluhq/evolu | 1,899 | **MIT** | ✅ **是** | TypeScript 96.8%（SQLite + CRDT） | last commit 2026-09-24；@evolu/web@3.1.2 @ 2026-09-06；未 archived | local-first 平台：端到端加密 + SQLite + CRDT 同步。库 | `[原文]` LICENSE：`The MIT License (MIT) / Copyright (c) 2023 Evolu`。README 自称 "TypeScript library and local-first platform"，未见付费条款。 |
| **SQLSync** | https://github.com/orbitinghail/sqlsync | 2,915 | **Apache-2.0** | ✅ **是** | Rust 87.1% + WASM | last commit **2025-11-19**（约 10 个月无提交）；无 release tag；未 archived | SQLite 之上的协作/离线优先封装（Rust + WASM）。库 + 服务（自托管）| `[原文]` LICENSE 为逐字 Apache-2.0 全文。⚠️ 活跃度需持续观察。 |
| **cr-sqlite** | https://github.com/vlcn-io/cr-sqlite | 3,800 | **MIT** | ✅ **是** | Rust 55.5% + C（SQLite 扩展） | last commit 2026-08-10；**最新 release v0.16.3 停留在 2024-01-17**（release 节奏滞后于提交）；未 archived | 收敛型复制 SQLite（多写 + CRDT），SQLite 运行时扩展。库 | `[原文]` LICENSE：`MIT License / Copyright (c) 2023 One Law LLC`。⚠️ release 滞后，需自行从源码构建。 |
| **LiveStore** | https://github.com/livestorejs/livestore | 3,715 | **Apache-2.0** | ✅ **是** | TypeScript 74% + Rust（响应式 SQLite） | last commit 2026-09-23；v0.5.0-dev.0 @ 2026-08-24；未 archived | 响应式 SQLite 状态管理 + 内置同步引擎。库 | `[原文]` LICENSE 为逐字 Apache-2.0 全文。⚠️ 版本仍为 `0.5.0-dev`，API 未稳定。 |

---

## 3. 主表：移动端 / 端侧本地数据库

| 项目 | 仓库 | Star（2026-09-25 实测） | License | 开源可商用？ | 技术栈 | 活跃度 | 定位/集成方式 | 关键条款摘录 |
|---|---|---|---|---|---|---|---|---|
| **WatermelonDB** | https://github.com/Nozbe/WatermelonDB | 11,786 | **MIT** | ✅ **是** | JavaScript 70.1%（React Native） | last commit 2025-08-11；v0.28.1-0 @ 2025-07-24；未 archived | RN 高性能响应式本地数据库。**本身不含同步**，需自建 sync 协议。库 | `[原文]` LICENSE：`MIT License / Copyright (c) Nozbe`。 |
| **RxDB** | https://github.com/pubkey/rxdb | 23,391 | **Apache-2.0**（核心）+ **Premium 插件为商业许可** | ⚠️ **混合模式**：核心开源可商用，Premium 插件需付费年授权 | TypeScript 92.9% | last commit 2026-09-18；17.5.0 @ 2026-08-20；未 archived | 跨 JS 运行时的 local-first 数据库 + 复制协议（CouchDB/Firebase/GraphQL/Postgres 等）。库 | `[原文]` `package.json` `"license": "Apache-2.0"`；README 第 256 行指向 premium 购买页。`[官网]` rxdb.info/premium 原文：「While the core of RxDB is free and open-source, we offer paid licenses for businesses and professionals. **Pro and Pro Plus tiers add commercial plugins**...」「Access to the Premium Plugins requires a **signed licensing agreement**... Premium licenses are provided on an **annual basis**.」「By default you are **not allowed to use the premium plugins after the license has expired**」+ 提供 Perpetual 选项。→ 核心够用可完全免费；性能/加密/存储引擎等关键插件在付费墙后。 |
| **Realm Core** | https://github.com/realm/realm-core | 1,052 | **Apache-2.0** | ✅ 是（**但同步功能已死**） | C++ 97.3% | last commit 2026-06-14；v20.1.5 @ 2026-06-14；未 archived | 端侧数据库核心。**Atlas Device Sync 已停服**。库 | `[元数据]` Apache-2.0。`[官网]` MongoDB 官方 Edge and Mobile 页原文：「As of September 2024, Atlas Edge Server and Atlas Device Sync have been deprecated. Edge Server was removed on **September 30, 2024**, and Device Sync will reach **end-of-life on September 30, 2025**.」→ **2026-09-25 已过 EOL，同步能力不可用**，只剩本地存储。 |
| Realm Swift SDK | https://github.com/realm/realm-swift | 16,612 | **Apache-2.0** | ✅ 是（本地库） | Objective-C/Swift | last commit 2026-06-14；v20.0.5 @ 2026-06-14；未 archived；**default branch 已改名为 `community`** | 社区分支（去 Device Sync 代码后的延续）。库 | `[元数据]` Apache-2.0 + `community` 默认分支是社区化维护的直接证据。 |
| Realm Kotlin SDK | https://github.com/realm/realm-kotlin | 1,103 | **Apache-2.0** | ✅ 是 | Kotlin 96.1% | last commit **2025-01-20**；v3.0.0 @ 2024-10-03（**明显停滞**） | Kotlin Multiplatform 端侧库。库 | `[元数据]` Apache-2.0。活跃度风险高。 |
| **Couchbase Lite Core（4.x）** | https://github.com/couchbase/couchbase-lite-core | 264 | **BSL 1.1（Couchbase Business Source License）**，仓库内混用 APL2 | ⚠️ **高风险**：BSL 有"禁止商用衍生物/托管服务"条款，**2029-05-01 才转 Apache-2.0** | C++ 78.1% | last commit 2026-09-25；Build-To-Use 4.1.0-98 @ 2026-06-30；未 archived | 跨平台 C++ 嵌入式 NoSQL + 复制器。库 | `[原文]` README 第 213 行原文：「The source code in this repo is governed by the **BSL 1.1** license.」`licenses/BSL-Couchbase.txt` 原文：「Licensed Work: Couchbase Lite Version 4.2 ... **Additional Use Grant**: You may make production use of the Licensed Work, provided ... (i) You may **not** prepare a derivative work based upon the Licensed Work and distribute or otherwise offer such derivative work ... (including in any "**as-a-service**" offering ...) for a fee or otherwise on a commercial or other for-profit basis. (ii) You may not link the Licensed Work to, or otherwise include the Licensed Work in or with, any product, application, or service (including in any Hosted Offering) that is distributed ... for a fee ...」+「**Change Date: May 1, 2029** / Change License: Apache License, Version 2.0」。另 `licenses/` 目录同时存在 `APL2.txt`，且 `Replicator/Replicator.cc` 文件头声明「governed by the Business Source License ... As of the Change Date ... governed by the Apache License, Version 2.0」→ **按文件混合授权，复制/同步模块是 BSL**。 |
| Couchbase Lite iOS（3.x 线） | https://github.com/couchbase/couchbase-lite-ios | 1,667 | **Apache-2.0** | ✅ 是（3.x 线） | Objective-C 49.5% | last commit 2026-09-24；3.4.2 @ 2026-09-16；未 archived | iOS/macOS 端侧库。库 | `[原文]` LICENSE 为逐字 Apache-2.0 全文；README 第 83 行原文：「Like all Couchbase source code, this is released under the Apache 2 license.」⚠️ **与 4.x core 的 BSL 存在版本线差异**：3.x 为 Apache-2.0，4.x core 为 BSL，选用时务必锁定版本并核对依赖树。 |
| Couchbase Lite Android（旧线） | https://github.com/couchbase/couchbase-lite-android | 1,165 | **Apache-2.0** | ✅ 是 | Java 95% | **archived = true**；last commit 2020-04-16；2.7.1 @ 2020-04-13 | 已归档，被 Kotlin SDK 取代。库 | `[原文]` LICENSE 为逐字 Apache-2.0。**archived，勿用于新项目**。 |
| **PouchDB** | https://github.com/pouchdb/pouchdb | 17,615 | **Apache-2.0** | ✅ **是** | JavaScript 98.8% | last commit 2026-08-25；9.0.0 @ 2024-06-21；未 archived | 浏览器端 CouchDB 兼容库，靠 CouchDB 复制协议同步。库 | `[原文]` `[元数据]` Apache-2.0。 |
| **ObjectBox（Java/Android 绑定）** | https://github.com/objectbox/objectbox-java | 4,624 | **Apache-2.0（仅语言绑定）**；native 库为 **ObjectBox Binary Licence**；Sync 为商业 | ⚠️ **混合模式，且核心非开源** | Java 96.2% | last commit 2026-07-15；6.0.0-beta @ 2026-07-15；未 archived | 端侧对象数据库 + 商业 Sync。库 + 商业服务 | `[原文]` `LICENSE.txt` 为逐字 Apache-2.0（绑定层）。`[官网]` objectbox.io/faq「License & Pricing」原文：「we open sourced the ObjectBox language **bindings** under the Apache 2.0 license ... If you need access to the **core**, please reach out to us individually.」+ 授权对照表：`Java libraries → Apache License 2.0`；`Gradle plugin → GNU GPL v3`（build time）；**`Native libraries → ObjectBox Binary Licence`**。同页 Sync 页原文：「ObjectBox database itself is free and open-source, but **ObjectBox Sync is a commercial product** with a licensing model. The sync functionality requires a **paid subscription**.」→ **真正跑数据的 native 引擎是二进制专有许可，Sync 必须付费**。 |
| **Apache CouchDB** | https://github.com/apache/couchdb | 6,963 | **Apache-2.0** | ✅ **是** | Erlang 57.5% | last commit 2026-09-24；3.5.2.post2 @ 2026-06-19；未 archived | 多主复制数据库（HTTP/JSON API），PouchDB 的天然服务端。服务（自托管）| `[元数据]` Apache-2.0。 |

---

## 4. 主表：传统自托管同步层

| 项目 | 仓库 | Star（2026-09-25 实测） | License | 开源可商用？ | 技术栈 | 活跃度 | 定位/集成方式 | 关键条款摘录 |
|---|---|---|---|---|---|---|---|---|
| **Mozilla Kinto** | https://github.com/Kinto/kinto | 4,418 | **Apache-2.0** | ✅ **是** | Python 96.5% | last commit 2026-09-18；26.3.3 @ 2026-08-10；未 archived | 通用 JSON 文档存储 + 分享/同步（内置 `kinto.js` 客户端同步）。服务（自托管）| `[原文]` LICENSE 原文：「Copyright 2012 - Mozilla Foundation / Licensed under the Apache License, Version 2.0」。 |
| **Nextcloud Server** | https://github.com/nextcloud/server | 36,908 | **AGPL-3.0** | ⚠️ **是但 copyleft**：自托管商用可以，但若修改后对外提供网络服务须开放修改源码 | PHP 57.2% | last commit 2026-09-25；v35.0.1 @ 2026-09-24；未 archived | 文件/日历/联系人自托管全家桶（含 CalDAV/CardDAV）。服务（自托管）| `[原文]` `COPYING` 为逐字 AGPL-3.0 全文。 |
| **sabre/dav** | https://github.com/sabre-io/dav | 1,723 | **BSD-3-Clause** | ✅ **是**（宽松，商业友好） | PHP 99% | last commit 2026-08-02；Release 4.7.1 @ 2026-07-07；未 archived | PHP 的 CalDAV/CardDAV/WebDAV 框架，可作为日历同步服务端。库/服务 | `[元数据]` BSD-3-Clause。 |
| **Radicale** | https://github.com/Kozea/Radicale | 5,044 | **GPL-3.0** | ⚠️ **是但 copyleft** | Python 87.8% | last commit 2026-09-24；3.8.1 @ 2026-09-25；未 archived | 轻量 CalDAV/CardDAV 服务器。服务（自托管）| `[元数据]` GPL-3.0。 |
| **CalDAV 协议本身** | RFC 4791（IETF 标准） | — | 无（协议规范，非软件） | ✅ 协议可自由实现 | — | — | 日历同步互操作层。若自研替代品要兼容系统日历，需实现 CalDAV 客户端；服务端可用 sabre/dav 或 Radicale。协议 | `[元数据]` IETF RFC，无授权限制。 |

---

## 5. 主表：Yjs 生态配套（通常 MIT，逐一核实）

| 项目 | 仓库 | Star（2026-09-25 实测） | License | 开源可商用？ | 技术栈 | 活跃度 | 定位/集成方式 | 关键条款摘录 |
|---|---|---|---|---|---|---|---|---|
| **y-websocket** | https://github.com/yjs/y-websocket | 714 | **MIT** | ✅ **是** | JavaScript 99.5% | last commit 2026-08-06；v3.1.0 @ 2026-08-06；未 archived | Yjs WebSocket 连接器（含服务端）。库/服务 | `[原文]` LICENSE：`The MIT License (MIT) / Copyright (c) 2025 Kevin Jahns`。 |
| **y-indexeddb** | https://github.com/yjs/y-indexeddb | 281 | **MIT** | ✅ **是** | JavaScript 98.5% | last commit 2025-02-12；v9.0.12 @ 2023-11-02；未 archived | Yjs 的 IndexedDB 离线持久化。库 | `[原文]` LICENSE：标准 MIT（Copyright 2014 Kevin Jahns / RWTH Aachen）。GitHub 显示 NOASSERTION 为解析误报。 |
| **y-prosemirror** | https://github.com/yjs/y-prosemirror | 467 | **MIT** | ✅ **是** | JavaScript 93.5% | last commit 2026-09-22；v2.0.0-12 @ 2026-09-21；未 archived | ProseMirror 编辑器绑定。库 | `[元数据]` MIT。 |
| **y-protocols** | https://github.com/yjs/y-protocols | 163 | **MIT** | ✅ **是** | JavaScript 100% | last commit 2026-05-05；v1.0.6-rc.1 @ 2026-02-13；未 archived | 同步/感知协议编解码。库 | `[原文]` LICENSE：标准 MIT。 |
| **y-leveldb** | https://github.com/yjs/y-leveldb | 115 | **MIT** | ✅ 是 | JavaScript 99.5% | **archived = true**；last commit 2026-03-07；v0.2.0 @ 2025-04-23 | LevelDB 持久化适配器。库 | `[原文]` LICENSE：标准 MIT。**已归档**。 |
| **Hocuspocus** | https://github.com/ueberdosis/hocuspocus | 2,600 | **MIT** | ✅ **是**（自托管完全免费商用） | TypeScript 98.2% | last commit 2026-09-22；v4.7.0 @ 2026-09-09；未 archived | 生产级 Yjs WebSocket 后端（持久化/Redis/Webhook/S3 扩展）。服务（自托管）| `[原文]` `LICENSE.md`：`MIT License / Copyright (c) 2023, Tiptap GmbH`。`[官网]` Tiptap 商业模式：编辑器与 Hocuspocus 本体 MIT 免费；**协作云（Cloud documents）、评论、历史、AI Toolkit 走 Tiptap Cloud Platform 付费**（Start $49/mo、Team $149/mo、Business $999/mo，2025-06 起取消免费层，改 30 天试用）。→ **自托管 Hocuspocus 不花钱，托管协作云才花钱**。 |

---

## 6. 主表：其他相关候选（补充发现）

| 项目 | 仓库 | Star（2026-09-25 实测） | License | 开源可商用？ | 技术栈 | 活跃度 | 定位/集成方式 | 关键条款摘录 |
|---|---|---|---|---|---|---|---|---|
| **AFFiNE** | https://github.com/toeverything/AFFiNE | 72,951 | **MIT（主体）+ AFFiNE EE License（`packages/backend`、`packages/common/native`）** | ⚠️ **混合模式**：客户端/前端 MIT，**服务端是企业版专有许可，生产使用需订阅** | TypeScript 82.6% + Rust | last commit 2026-09-22；2026.9.23-canary.909 @ 2026-09-23；未 archived | 完整 local-first 知识库产品（可直接参考其 CRDT 架构）。产品 + 库 | `[原文]` 根 LICENSE 原文：「All content that resides under the "**packages/backend**" and "packages/common/native" directory ... is licensed under the license defined in "packages/backend/server/LICENSE"」「Content outside of the above mentioned directories ... is available under the "**MIT**" license」。`packages/backend/server/LICENSE` 原文（EE License）：「This software ... **may only be used in production, if you** (and any entity that you represent) **have agreed to, and are in compliance with, the AFFiNE Subscription Terms of Service** ... and otherwise have a valid **AFFiNE Enterprise Edition subscription** for the correct number of user seats.」「you may copy and modify the Software for **development and testing purposes**, without requiring a subscription.」「it is **forbidden to copy, merge, publish, distribute, sublicense, and/or sell** the Software.」→ **客户端 MIT 可白嫖参考，自建后端等于绕过 EE 授权，法律上有风险**。 |
| **Liveblocks** | https://github.com/Liveblocks/liveblocks | 4,732 | **Apache-2.0（多数）+ AGPL-3.0-or-later（`packages/liveblocks-server`、`tools/liveblocks-cli`）** | ⚠️ **混合**：客户端库 Apache-2.0 可商用；**服务端组件 AGPL 传染** | TypeScript 79.9% | last commit 2026-09-24；v3.24.3-livetextreplay @ 2026-09-22；未 archived | 多人协作基础设施（含 Yjs provider）。库 + 官方 SaaS | `[原文]` 根 LICENSE 原文：「This repository contains software under **two licenses**: 1. Most of the code ... is licensed under the **Apache License 2.0** ... 2. The following components are licensed under the **GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)**: `packages/liveblocks-server` (published as `@liveblocks/server`), `tools/liveblocks-cli` (published as `liveblocks`)」。 |
| **sqlite-sync（SQLite Cloud）** | https://github.com/sqliteai/sqlite-sync | 567 | **Elastic License 2.0（修改版）** | ❌ **高风险**：非开源项目商用需商业授权；**禁止替换/自实现网络层** | C 97.3% | last commit 2026-09-24；1.1.4 @ 2026-09-21；未 archived | SQLite 的 CRDT 离线同步（对接 SQLite Cloud / PostgreSQL / Supabase）。库 + 商业服务 | `[原文]` `LICENSE.md` 原文：「This software is licensed under the **Elastic License 2.0**, with the additional grants and restrictions described below.」「**Additional Grant for Open-Source Projects**: ... provided the software is incorporated into or used by an **open-source project** licensed under an OSI-approved open-source license ...」「**Network Layer Restriction**: ... the permissions granted for open-source projects **do not extend to modifying, replacing, bypassing, reimplementing, or substituting the Network Layer** of the software.」「A **commercial license from SQLite Cloud, Inc. is required** if you: 1. modify or create a derivative work of the Network Layer; 2. replace the Network Layer ...; 4. implement or use an alternative network transport, communication protocol, synchronization mechanism, replication mechanism, server protocol, network backend ...」「**This restriction applies regardless of whether the resulting software ... is itself open source, source-available, non-commercial, or distributed without charge.**」「2. For **non-open-source or commercial production use**, you may use ... only with a commercial license from SQLite Cloud, Inc.」「3. You may not provide the software to third parties as a **managed service** ... unless you have a license for that use.」→ **对本项目（闭源商业滴答清单替代品）几乎完全不可用**。 |
| **TanStack DB** | https://github.com/tanstack/db | 3,917 | **MIT** | ✅ 是 | TypeScript 99.8% | last commit 2026-09-24；@tanstack/vue-db@0.2.1 @ 2026-09-14；未 archived | 响应式客户端 store（同步能力需搭配后端）。库 | `[元数据]` MIT。 |

---

## 7. 三类归因汇总（决策视图）

### A. 完全开源可商用（无附加限制，可直接嵌入闭源商业产品）

| 项目 | License | 备注 |
|---|---|---|
| Yjs / Automerge / Loro | MIT | 纯 CRDT 引擎，生态最成熟 |
| y-websocket / y-indexeddb / y-prosemirror / y-protocols / Hocuspocus | MIT | Yjs 全链路自建，服务端零授权成本 |
| TinyBase | MIT | 需自配同步后端 |
| Electric | Apache-2.0 | **仅 Postgres 只读下行**，写路径自建 |
| Zero（rocicorp/mono） | Apache-2.0 | 双向同步 + 服务端自建 |
| Replicache | Apache-2.0（mono） | 已维护模式，官方建议迁 Zero |
| Evolu | MIT | 端到端加密 + SQLite + CRDT |
| cr-sqlite / SQLSync / LiveStore | MIT / Apache-2.0 / Apache-2.0 | 均需自建同步服务 |
| InstantDB / Jazz | Apache-2.0 / MIT | 代码可商用，官方云付费可选 |
| WatermelonDB | MIT | **不含同步**，需自建 |
| Realm Core / realm-swift | Apache-2.0 | **同步能力已 EOL，仅剩本地库** |
| PouchDB + Apache CouchDB | Apache-2.0 | 经典主从复制组合，成熟稳定 |
| Kinto | Apache-2.0 | 自带客户端同步，Mozilla 出品 |
| sabre/dav | BSD-3-Clause | 最宽松，CalDAV 服务端首选 |
| TanStack DB | MIT | 存储层，非同步引擎 |
| PowerSync **客户端 SDK**（JS/Swift/.NET） | Apache-2.0 | ⚠️ 仅客户端；服务端另有条款 |

### B. Copyleft / 需注意（可商用但触发开源义务或需隔离）

| 项目 | License | 风险点 |
|---|---|---|
| Triplit | **AGPL-3.0-only** | 嵌入闭源 SaaS 会触发网络条款源码披露；且已近 1 年无提交 |
| Nextcloud Server | AGPL-3.0 | 自托管内部用可以；修改后对外提供网络服务须开源修改 |
| Radicale | GPL-3.0 | 同上（分发/衍生触发） |
| Liveblocks 服务端组件 | AGPL-3.0-or-later | 客户端库 Apache-2.0，服务端必须隔离或不用 |
| ObjectBox（native 引擎） | ObjectBox Binary Licence | 绑定 Apache-2.0 但**真正跑数据的 native 库是二进制专有许可**；Gradle 插件 GPL-3.0（build time） |
| RxDB | Apache-2.0 核心 + 商业 Premium 插件 | 核心够用免费；性能/加密/存储引擎插件在付费墙后，且**授权到期后不得继续使用** |
| Couchbase Lite iOS（3.x） | Apache-2.0 | 3.x 宽松，但 4.x core 是 BSL，**依赖树须锁版本核对** |
| AFFiNE | MIT 主体 + EE License（backend） | 前端可参考；**自建其 backend 绕过 EE 订阅有法律风险** |

### C. 商业授权 / source-available（有风险，不适合作为闭源商业替代品的核心依赖）

| 项目 | License | 关键限制 |
|---|---|---|
| **PowerSync Service** | FSL-1.1-ALv2 | **禁止 "Competing Use"**（提供替代/实质相似功能的产品或服务）；**发布满 2 年后**才转 Apache-2.0 |
| **Couchbase Lite Core（4.x）** | BSL 1.1 | 禁止商用衍生物与 "as-a-service" 托管；**Change Date 2029-05-01** 才转 Apache-2.0 |
| **sqlite-sync** | Elastic License 2.0（修改版） | **禁止修改/替换/自实现 Network Layer**，禁止向第三方提供 managed service；非开源项目商用需商业授权 |
| **Ditto** | Ditto Binary License | 纯专有二进制，**禁止反向工程**，无源码 |
| **ObjectBox Sync** | 商业订阅 | 明确付费订阅，自托管也需授权 |
| **Replicache（历史收费期）** | 现 Apache-2.0 | 现已免费+维护模式，不再收费（官网原文） |
| **PowerSync Kotlin SDK** | **无 LICENSE 文件** | 无授权声明 = 默认保留全部权利，**必须书面确认后方可采用** |
| **MongoDB Atlas Device Sync** | 已 EOL | **2025-09-30 停止服务**，Realm 只剩本地库 |

---

## 8. 针对「滴答清单替代品」的选型建议

### 8.1 授权最干净的两条路线

**路线 1（推荐）：Yjs/Loro + 自建 Hocuspocus/y-websocket**
- 全链路 MIT，无任何商业限制，可闭源商用、可自建、可托管给用户。
- 冲突合并天然由 CRDT 解决；离线用 y-indexeddb（Web）/ y-leveldb（不推荐，已归档）/ 自建 SQLite 持久化。
- 代价：需要自研任务实体的 CRDT schema（Y.Map/Y.Array）与服务端鉴权、配额、快照压缩。

**路线 2：Electric（读）+ 自研写路径，或 Zero（读写）**
- Electric 只解决"服务端 Postgres → 客户端"的单向下行，Apache-2.0 完全干净；写路径必须自己写（可配 CRDT 或 LWW）。
- Zero 提供双向同步 + `zero-cache` 服务端，Apache-2.0，但 API 仍是 canary 阶段（`v1.11.0-canary.13`），生产稳定性需自测。

### 8.2 需要规避的组合
- ❌ 以 **sqlite-sync** 为同步核心：Network Layer 限制直接封死"自研同步协议"这条路。
- ❌ 以 **Couchbase Lite 4.x** 为端侧同步核心：BSL 的 as-a-service 条款 + 2029 年才转 Apache-2.0。
- ❌ 以 **Triplit** 为闭源 SaaS 的核心：AGPL-3.0 网络条款 + 项目疑似停滞（最后提交 2025-09）。
- ❌ 依赖 **Ditto / ObjectBox Sync / PowerSync 商业版**：需持续付费且条款随厂商变动。
- ⚠️ **Realm** 的同步已死（2025-09-30 EOL），只能当本地库用。
- ⚠️ **PowerSync** 若要用：客户端 SDK（Apache-2.0）可放心，**服务端只能自托管 Open Edition 且不得提供竞争性托管服务**——即"给用户提供一个滴答清单 SaaS"这件事本身可能落进 Competing Use 的定义，需法务判定。

### 8.3 交叉验证与后续动作
1. **PowerSync Kotlin SDK 无 LICENSE** —— 建议由商务/法务向 Journey Mobile 索取书面授权，否则 Android 端需换用其他方案。
2. **Couchbase 3.x（Apache-2.0）与 4.x core（BSL）并存** —— 若考虑 Couchbase，必须用 `gradle dependencies` / `Podfile.lock` 逐项核对实际引入的是哪条版本线。
3. **RxDB Premium / ObjectBox Sync 报价** —— 若团队愿意付费，需走商务询价（两者均不公开单价）。
4. **Zero 与 LiveStore 的生产就绪度** —— 两者均处 0.x/canary，建议做 4–8 周 PoC 验证离线重放与冲突收敛。
5. **AGPL 类（Triplit/Nextcloud/Radicale）若必须用** —— 只能以"独立进程 + 网络协议隔离"方式部署，且不得修改其源码后对外提供服务。

---

## 9. 方法论备注（证据可复现）

```bash
# Star / 活跃度（2026-09-25 实测）
python3 research/ghinfo.py yjs/yjs automerge/automerge loro-dev/loro ...

# License 原文（逐个文件名回退）
for f in LICENSE LICENSE.md LICENSE.txt COPYING; do
  curl -sSL -A "Mozilla/5.0" \
    "https://raw.githubusercontent.com/OWNER/REPO/BRANCH/$f"
done

# 混合授权仓库的额外核查
curl -sSL "https://raw.githubusercontent.com/couchbase/couchbase-lite-core/master/licenses/BSL-Couchbase.txt"
curl -sSL "https://raw.githubusercontent.com/toeverything/AFFiNE/canary/packages/backend/server/LICENSE"
curl -sSL "https://raw.githubusercontent.com/aspen-cloud/triplit/main/packages/client/package.json"
```

**已知限制**：
- 本机 `web_fetch` 对 github.com 及部分厂商域名（如 www.powersync.com）返回 "resolves to a non-public IP address"，因此 GitHub 侧全部改用 `curl`；厂商域名用 `curl --compressed` 抓取后本地去标签解析。
- PowerSync 的 `licensing-terms` 页与 pricing 页文本已读到原文；但 `docs.powersync.com` 自托管指南路径多次 404，未能读到具体部署文档，已在表中以 FSL LICENSE 原文为准。
- Triplit 官网 `www.triplit.dev` 出现 TLS 握手失败，未能读到其 Cloud 定价原文；其 license 结论完全基于仓库 LICENSE 与 package.json 原文。
- Ditto 官网 pricing 页 JS 渲染，未能抓到结构化价格；结论基于其 SDK License 原文（GitHub 与官网同文本）。
- **所有 star 数字均为 2026-09-25 当日实测，会随时间变化；所有"未核实"项均为确实拿不到证据，未做任何推测填充。**
