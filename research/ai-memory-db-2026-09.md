# 小型 AI 产品的「AI 记忆 / AI 数据库」选型调研

调研日期：2026-09-26。调研对象：heyta（本地优先 + E2EE 开源任务管理，MIT，小团队）。
本文是**调研原料**，不是产品文档。凡标「分析」者为推断，非公开事实；凡标「实测」者为本次在本机真实执行过命令并观察到输出。

---

## 1. 一句话结论

**heyta 不需要向量数据库。** 现有 op-log（append-only 全量事件）+ SQLite 已经能算出「推迟习惯 / 专注落差 / 任务历史」这类记忆特征——它们是**聚合计数**（`GROUP BY`），不是最近邻检索；本次实测也证明即便真要向量检索，10k 条 × 384 维的暴力余弦扫描只要 **2.6 ms**，ANN 索引解决的规模问题 heyta 根本不存在。

而**真正的瓶颈不在索引，在嵌入模型**：远程嵌入 = 新的明文出境面（撞 ADR-0005/0006 的出境闸门）；本地嵌入 = `onnxruntime-web` 走 WASM（**Hermes 上直接死**）或 `onnxruntime-node`（Node 原生插件，RN 用不了）。也就是说，向量库是这条链上**最便宜、最可替换**的一环，把它换成一个新依赖，收益接近零、代价却是三端各写一遍。

三个被点名的候选里，**没有一个能同时跑三端**；而三端里**唯一真正能跑、且不引入新依赖的检索能力是 FTS5**——但它在 heyta 当前配置下**默认是关的**（见 §4.2），且**浏览器端根本用不了**（浏览器是 IndexedDB，没有 SQL）。

---

## 2. 方法与置信度分级

| 级别 | 含义 | 本文用法 |
|---|---|---|
| 🟢 **实测** | 本次在本机执行命令并观察到真实输出 | 唯一可当作定论的一级 |
| 🔵 **官方文档声称** | 官方 README / 源码 / release notes 原文，已引 URL 与逐字引文 | 可信但未经我运行 |
| 🟡 **分析** | 我基于 🟢/🔵 的推断 | 明确标注 |
| ⚪ **未查到** | 没查到或没验证 | §10 集中列出 |

**采集手段**：`curl https://api.github.com/repos/...`（真实 star/license/pushed_at/archived）、`curl https://registry.npmjs.org/...`、`curl https://unpkg.com/<pkg>/?meta`（真实包内文件清单）、`curl https://raw.githubusercontent.com/...`（真实 LICENSE 与 README 原文）、`anysearch` 搜索与正文抽取、以及本机 `node -e` 实验。

> ⚠️ **GitHub API 限流**：本机未认证额度为 60 次/小时。首批 14 个候选的 star/license/pushed_at/archived **全部取到**（下表数据均为真实 API 返回），但随后的 `open_issues_count` / `subscribers_count` / releases / commits **未取到**（`remaining: 0`，reset 约 47 分钟后）。凡依赖这些字段的结论本文一律不写。

---

## 3. 🔴 先核实前提：heyta 的「三端」到底是什么

这是本次调研**最重要的发现**，因为它推翻了一个常见假设——「heyta 三端都有 SQLite」。

### 3.1 三端是三种不同的存储引擎（🟢 实测，读代码）

| 壳 | 生产存储 | 证据 |
|---|---|---|
| **浏览器** | **IndexedDB**（**没有 SQL**） | `apps/web/src/lib/oplog.ts:61` → `db = new IndexedDbAdapter(dbName)`；`packages/storage/src/indexeddb/indexeddb-adapter.ts` 文件头自述「Web 端的生产存储」 |
| **React Native（iOS / Android）** | **op-sqlite**（JSI 原生，非 WASM） | `apps/mobile/src/db/op-sqlite-driver.ts:38` → `import { open, type DB, type Scalar } from '@op-engineering/op-sqlite'`；`apps/mobile/package.json` → `"@op-engineering/op-sqlite": "^18.2.5"` |
| **Node（桌面 / CLI）** | **`node:sqlite`** 内置模块 | `packages/storage/src/sqlite/node-sqlite-driver.ts`；`packages/storage/src/sqlite/index.ts` 注释：「⚠️ 这里**故意不导出** `NodeSqliteDriver` —— 它 `import 'node:sqlite'`」 |

`packages/storage/src/sqlite/sqlite-driver.ts` 的文件头把这件事写得很清楚：

> 但 SQLite **不是一种绑定**：
>   - Node 测试 / 校验路径 → `node:sqlite` 内置模块（见 `node-sqlite-driver.ts`）
>   - iOS                 → 注入原生绑定（Swift / SQLite3 C API）
>   - HarmonyOS           → 注入 ArkTS 绑定

ADR-0003 也明写：「🔴 **IndexedDB 只在浏览器有。iOS 与鸿蒙必须用 SQLite。**」

🟡 **分析（这条决定了后面所有结论）**：任何「基于 SQL 的检索/向量方案」（FTS5、sqlite-vec）在 heyta 里**天然只有 2/3 端可复用**，浏览器端要么另写一套（内存扫描 / WASM SQLite），要么放弃。**「三端一套 SQL」这个前提不成立。**

### 3.2 Hermes 与 WebAssembly：前提成立，但坊间说法有噪音

任务书给的硬约束是「Hermes 不支持 WebAssembly」。**本次核实：结论成立**，但需要知道一个反噪音的细节。

**🟢 实测（heyta 自己的真机证据）** —— `packages/sync-core/tests/argon2-fallback.spec.ts` 文件头：

> 背景：`packages/sync-core` 的 Argon2id 原先只有 `hash-wasm`（WASM）一条实现，
> 而 Hermes 不支持 WebAssembly。真机实测点「立即同步」会得到
>
>     WebAssembly is not supported in this environment!
>
> 也就是说移动端**一条数据都同步不出去**（`AGENTS.md` §7 第 26 条）。

`apps/mobile/src/screens/ProfileScreen.tsx:96` 也写：「Hermes 没有 WebAssembly，Argon2id 只能走纯 JS 路径。**实测**：这台模拟器上第一次同步（含一次密钥派生）耗时约 30–40 秒」。heyta 的移动壳是 **React Native 0.84.1**（`apps/mobile/package.json`）。

**⚠️ 反噪音：网上有「RN 0.84 已支持 WebAssembly」的说法，本次核实认为该说法会误导选型。**

- 🔵 **官方 RN 0.84 release notes 里 "WebAssembly"/"WASM" 出现 0 次**（🟢 实测：抓取 https://reactnative.dev/blog/2026/02/11/react-native-0.84 正文 9,541 字符，"Hermes V1" 出现 12 次，"WebAssembly" 0 次、"WASM" 0 次）。
- 🔵 Hermes 官方仓库的跟踪 issue **#429「WASM support within Hermes?」至今仍是 `Open`**，标签 `enhancement`，`No one assigned`，开于 2020-12-04。issue 正文原话：「At present it does not look like Hermes has support for running WASM via a `global.WebAssembly`」[来源: https://github.com/facebook/hermes/issues/429]。
- 🔵 第三方（Callstack 活动页）确实写了「WebAssembly Support in Hermes」并称「It's powered by native …」[来源: https://www.callstack.com/events/react-native-0-84-and-other-news]。

🟡 **分析**：所谓「RN 的 WebAssembly 支持」指的是**经由原生模块把 WASM 跑起来**的集成路径（Nitro / MLC / 自写 TurboModule 那一类），**不是** JS 运行时里出现标准的 `WebAssembly` 全局对象。区别是决定性的：`hash-wasm` / `sql.js` / `wa-sqlite` / `hnswlib-wasm` / `onnxruntime-web` 这些库内部调的是**标准 `WebAssembly.instantiate`**，它们不会因为 RN 0.84 就能用；要让某一个 WASM 库在 Hermes 上跑，得为它单独写原生胶水。**因此「依赖 WASM 的库在 Hermes 上出局」这条判据继续有效**，heyta 自己的 30–40 秒纯 JS Argon2 兜底就是代价的实证。

### 3.3 与记忆相关的既有资产（🟢 实测）

| 已有 | 内容 | 证据 |
|---|---|---|
| op-log | append-only 全量事件；`stores.ts` 的 `STORES = { OPS, STATE, META, ARCHIVE }`，`STATE` 自述「可从 OPS 完整重建」 | `packages/storage/src/stores.ts` |
| 领域模型 | `Task / Project / Tag / Note / Habit / HabitLog / FocusSession`（`FocusSessionKind = 'work' \| 'shortBreak' \| 'longBreak'`） | `packages/domain/src/entities.ts` |
| AI 端口层 | `packages/ai` 自述「**不含任何业务逻辑，也绝不写 op**」；`egress.ts` 出境闸门按 `(feature, destination)` 精确匹配授权 | `packages/ai/package.json`、`packages/ai/src/egress.ts` |
| 已有判断 | `docs/plans/ai-strategy.md` §4.1 已写「**不需要新建一个数据库。**」并点名本文档 | `docs/plans/ai-strategy.md:108` |

> 🔴 **命名陷阱（避免后续误会）**：op-log 里有 `VECTOR_CLOCK` 字段（`packages/storage/src/stores.ts` 的 `OP_FIELDS`）。那是**因果向量时钟**（causal vector clock，用于冲突判定，见 ADR-0008），**与 embedding / 向量检索毫无关系**。搜索时不要把两者混为一谈。

---

## 4. 逐候选详表

> **「是否依赖 WASM」列的口径**：指**该方案在 heyta 目标壳上落地时**是否必须用 WebAssembly。
> **「RN/Hermes」列**：`✅ 原生` = 走 JSI/原生模块，无 WASM；`🔴 WASM` = 必须 WASM，Hermes 出局；`❌` = 无路径。

### 4.1 向量 / 嵌入式数据库

GitHub 数据均为 🟢 实测（2026-09-26 真实 API 返回）。

| 候选 | 许可证（SPDX） | star | 最后提交 | archived | **依赖 WASM？** | 浏览器 | **RN / Hermes** | 运行时体积 | 常驻服务 |
|---|---|---|---|---|---|---|---|---|---|
| **sqlite-vec** | Apache-2.0（GitHub）/ npm 声明 `MIT OR Apache` | 8,137 | 2026-05-18 | 否 | **本身否**（是纯 C 扩展）；但**浏览器端必须自建静态编译的 WASM** | ⚠️ 需自建 WASM（官方 demo 包自述「may change at any time」） | ✅ **可原生**（靠 op-sqlite 内置，见 §4.2） | npm 包 4 KB / 5 文件 + 平台 `.dylib`/`.so` | 嵌入式 |
| **LanceDB** | Apache-2.0 | 11,533 | 2026-09-26 | 否 | 否（Node 原生） | ❌（npm 包内无浏览器构建） | ❌ 无 RN 路径 | `@lancedb/lancedb` 1.44 MB / 62 文件；`engines.node >= 22` | 嵌入式（但仅 Node） |
| **ChromaDB** | Apache-2.0 | 29,381 | 2026-09-25 | 否 | 否（Rust 原生绑定 + REST） | ❌ | ❌ | `chromadb` 1.72 MB；原生绑定 `chromadb-js-bindings-*` 仅 darwin/linux/win32 | **客户端 → 需服务**；1.0+ 原生绑定仅桌面 |
| **Qdrant** | Apache-2.0 | 34,830 | 2026-09-25 | 否 | 否 | 客户端可以 | ❌ 服务端 | `@qdrant/js-client-rest` 947 KB（`engines.node >= 22`） | **必须独立服务** |
| **pgvector** | **PostgreSQL**（GitHub 显示 `NOASSERTION`，实为 PostgreSQL License） | 23,161 | 2026-09-26 | 否 | 否 | ❌ | ❌ | Postgres 扩展（C） | **必须 PostgreSQL 服务** |
| **DuckDB VSS** | MIT | 41,713 | 2026-09-25 | 否 | 浏览器端是 WASM；Node 端是原生 | ✅（`duckdb-wasm`） | ❌ | `@duckdb/duckdb-wasm` **149.4 MB** / 85 文件；`@duckdb/node-api` 652 KB；`duckdb` 61.2 MB | 嵌入式（Node）/ WASM（浏览器） |
| **usearch** | Apache-2.0（GitHub）/ npm 声明 `Apache 2.0` ⚠️ | 4,320 | 2026-08-31 | 否 | 否（NAPI 预编译） | ❌ | ❌ | npm **25.2 MB** / 544 文件；`prebuilds/{darwin-arm64+x64,linux-arm64,linux-x64,win32-x64}/usearch.node` | 嵌入式（仅桌面 Node） |
| **hnswlib** | Apache-2.0 | 5,334 | 2026-09-15 | 否 | `hnswlib-node` 否 / `hnswlib-wasm` 是 | 仅 WASM 包 | ❌ | `hnswlib-node` 196 KB；`hnswlib-wasm` 3.05 MB | 嵌入式 |

**逐条证据（🔵 官方原文）**

- **sqlite-vec** README 原文：「Written in pure C, no dependencies, runs anywhere SQLite runs (Linux/MacOS/Windows, **in the browser with WASM**, Raspberry Pis, etc.)」[来源: https://raw.githubusercontent.com/asg017/sqlite-vec/main/README.md]。绑定表里有 Python / Node.js / Ruby / Go / Rust / Datasette / rqlite，**没有 React Native、没有浏览器独立绑定**。
- **sqlite-vec npm 包**（🟢 实测 `unpkg` 文件清单）：只有 `README.md`、`package.json`、`index.cjs`、`index.mjs`、`index.d.ts` —— 5 个文件。`index.cjs` 通过 `optionalDependencies` 拉平台预编译扩展（`sqlite-vec-darwin-arm64` 等），调用 `db.loadExtension(path)`；支持平台硬编码为 `[["darwin","x64"],["linux","x64"],["darwin","arm64"],["win32","x64"],["linux","arm64"]]` —— **无 iOS / Android**。
- **usearch**（🟢 实测 `unpkg` 文件清单）：`prebuilds/darwin-arm64+x64/usearch.node`、`linux-arm64`、`linux-x64`、`win32-x64` —— **只有桌面 OS，无移动端**。包内**没有** `.wasm` 产物（清单里出现的 `numkong/**/wasm*` 是 vendored C 库的测试与 toolchain 文件，不是可加载的 WASM 模块）。
- **LanceDB**（🟢 实测）：`@lancedb/lancedb@0.39.0`，`engines: {"node": ">= 22"}`，`dist/native.js` 加载原生绑定；包内无 `.wasm`。
- **ChromaDB**（🟢 实测 npm `optionalDependencies`）：`chromadb-js-bindings-darwin-x64`、`-darwin-arm64`、`-linux-x64-gnu`、`-win32-x64-msvc`、`-linux-arm64-gnu` —— **只有桌面 OS**。
- **Tantivy**（见 §4.3）：Rust 库，npm 上只有一个单人维护的 napi-rs 绑定。
- **Qdrant 的「嵌入式」模式是 Python/Rust 专属**（🔵 官方文档）：Qdrant Edge 被描述为「a lightweight, embedded vector search engine for in-process retrieval … with no background services」，但官方明确「use the **Python Bindings** for Qdrant Edge package or the `qdrant-edge` **Rust crate**」；快速上手页也写「Qdrant Edge … supports **Python and Rust**」[来源: https://qdrant.tech/documentation/edge/]。🟡 分析：**JS 没有嵌入式 Qdrant**，`@qdrant/js-client-rest` 是纯 REST 客户端（deps 只有 `@qdrant/openapi-typescript-fetch` + `undici`）→ 必须连服务。另：npm `qdrant-local` 的 `postinstall` 会**下载并 spawn 一个原生 Qdrant 服务端二进制**，不是嵌入式。
- **PGlite 是 WASM Postgres**（🔵 官方 README 原文）：「PGlite - the **WASM build of Postgres** from Electric.」「Unlike previous "Postgres in the browser" projects, PGlite does not use a Linux virtual machine - it is simply **Postgres in WASM**.」[来源: https://raw.githubusercontent.com/electric-sql/pglite/main/README.md]。🟡 分析：它让「浏览器里跑 Postgres + pgvector」在技术上成立，但**在 Hermes 上直接出局**（WASM），且体积 25.4 MB——对 heyta 是三重不合适（Hermes 出局 / 体积 / 与 IndexedDB 存储重复）。
- **pgvector 必须有服务**（🔵 官方 README）：「Enable the extension (do this once in each database where you want to use it) — `CREATE EXTENSION vector;`」[来源: https://raw.githubusercontent.com/pgvector/pgvector/master/README.md]。🟡 分析：与「本地优先」直接冲突。
- **DuckDB**：🔵 `@duckdb/duckdb-wasm` 自述「DuckDB-Wasm brings DuckDB to every browser thanks to **WebAssembly**」[来源: https://github.com/duckdb/duckdb-wasm]。🟡 **分析（决定性的一条）**：既然是 WASM，**Hermes 上直接出局**；而 Node 侧 `duckdb` / `@duckdb/node-api` 是原生插件（`duckdb@1.4.4` deps 含 `node-gyp`，`unpackedSize` 61.2 MB），**不是 RN 可用的绑定**。⚪ **未验证**：我**没有**确认 VSS 扩展在 `duckdb-wasm` 构建里是否可加载（官方 WASM 总览页只在导航侧栏提到 VSS，正文未确认；我没有跑过 `INSTALL vss` 的浏览器实验）。因为 Hermes 已出局，这条不影响结论，但不要把它当作「VSS 在浏览器可用」的依据。

### 4.2 🔴 本次最有价值的单点发现：op-sqlite 已内置 FTS5 与 sqlite-vec（原生，非 WASM）

这条推翻了「sqlite-vec 依赖 WASM 所以在 Hermes 出局」的朴素结论。

**🟢 实测（读 heyta 已安装的 `@op-engineering/op-sqlite@18.2.5`）**

- **license: MIT**，包内 `LICENSE` 存在。
- README 特性列表逐字原文：`- iOS, Android, macOS and web support`、`- FTS5 plugin`、`- Rtree plugin`、`- sqlite-vec plugin`、`- Load runtime extensions`。文末：「# License / MIT License.」
- **iOS 侧预编译二进制确实随包分发**：`ios/sqlitevec.xcframework/{ios-arm64,tvos-arm64,ios-arm64_x86_64-simulator,tvos-arm64_x86_64-simulator}/sqlitevec.framework`
- **Android 侧预编译二进制确实随包分发**：`android/src/main/libsqlitevec/{arm64-v8a,armeabi-v7a,x86,x86_64}/libsqlite_vec.so`
- **iOS 构建开关**（`op-sqlite.podspec`）：
  - `fts5 = false`、`use_sqlite_vec = false` —— **两者默认都是关的**
  - `fts5 = op_sqlite_config["fts5"] == true`；`use_sqlite_vec = op_sqlite_config["sqliteVec"] == true`
  - 打开时：`SQLITE_ENABLE_FTS5=1`（第 170–171 行）、`OP_SQLITE_USE_SQLITE_VEC=1` 并 `frameworks.push("ios/sqlitevec.xcframework")`（第 190–193 行）
  - 未打开时：`exclude_files += ["ios/sqlitevec.xcframework/**/*"]`（第 162–163 行）
  - 限制：`raise "sqlite-vec is not supported with phone version. It cannot load extensions."`（第 76 行）；`use_sqlite_vec` 与 `libsql` / `turso` 后端互斥
- **Android 构建开关**（`android/CMakeLists.txt`）：注释「Apply library-default SQLite flags (driven by package.json toggles such as performanceMode, **fts5** and rtree）」；`if (USE_SQLITE_VEC) add_definitions(-DOP_SQLITE_USE_SQLITE_VEC=1)`
- **Android 侧 FTS5 也是默认关的**（`android/build.gradle`，来自并行核查）：`def enableFTS5 = false`（第 60 行）→ `enableFTS5 = !!opsqliteConfig["fts5"]`（第 99 行）→ `defaultSqliteFlags += "-DSQLITE_ENABLE_FTS5=1"`（第 156 行）。**配置从 `packageJson["op-sqlite"]` 读取**。
- 🔵 **官方安装文档给出了默认配置块，两个开关都是注释掉的**（`docs/docs/installation.md`）：

  ```json
  {
    "op-sqlite": {
      "sqlcipher": false
      // "performanceMode": true,
      // "fts5": true,
      // "rtree": true,
      // "sqliteVec": true,
      // "tokenizers": ["simple_tokenizer"]
    }
  }
  ```

  同文档对 `fts5` 的说明：「`fts5` enables the full text search extension.」；平台声明：「This package runs on `iOS`, `Android`, `macOS` and `web`.」；web 说明：「Web support is async-only and uses the sqlite wasm worker API with OPFS persistence.」
- 🔵 **一条对 heyta「三端复用」很关键的官方声明**（同文档）：「**It's impossible to run a React Native JSI module in Node.**」🟡 分析：这从上游确认了 heyta 的 `SqliteDriver` 抽象为什么必须存在——**op-sqlite 与 `node:sqlite` 不可能共用一份绑定**。
- **Web 支持是 WASM**：`peerDependencies` 含 `"@sqlite.org/sqlite-wasm": "*"`，包内有 `src/Storage.web.ts`、`src/opsqlite-web-wasm-asset.ts`、`src/opsqlite-web.worker.ts`。🟡 分析：所以 op-sqlite 在浏览器上靠 WASM（浏览器有 WASM，可行），在 iOS/Android 上靠 JSI 原生（Hermes 可行）——**同一套 API，两种底层**。

**🔴 关键后果：heyta 现在并没有打开这两个开关。** 🟢 实测：全仓库 `grep op_sqlite_config / sqliteVec / fts5`（apps / packages / docs / AGENTS.md，排除 node_modules）**零命中**。也就是说：

> **heyta 当前 iOS/Android 上没有 FTS5，也没有 sqlite-vec。要用，必须先在 monorepo 根 `package.json` 里加 `"op-sqlite": { "fts5": true }`（或 `"sqliteVec": true`），然后重新原生构建出包。**

改动本身是**一行配置**，但性质是**原生构建配置 + 重新出包**，不是「装个 npm 包」；且 `pnpm check` 里包含「iOS 原生依赖」门禁（AGENTS.md §6）。

🔵 **备选：`expo-sqlite`（FTS5 默认开）**——`expo-sqlite@57.0.3`（MIT）的 `enableFTS` 默认值为 `'true'`，podspec / build.gradle 都追加 `-DSQLITE_ENABLE_FTS4=1 -DSQLITE_ENABLE_FTS3_PARENTHESIS=1 -DSQLITE_ENABLE_FTS5=1`，即**开箱就有 FTS5**。🟡 但分析：op-sqlite 自己的文档把 `expo-sqlite` 列在「Compilation clashes」里，**换驱动不是零成本的**，而且 heyta 的 `OpSqliteDriver` 是围绕 op-sqlite 的同步/异步语义专门写的（`apps/mobile/src/db/op-sqlite-driver.ts` 记录了 `SqliteDriver` 四个方法全同步、而 op-sqlite 主 API 是异步的这层不匹配）。**不建议为 FTS5 换驱动。**

**⚪ 未验证的重要缺口**：我只验证了**二进制与开关确实存在**，**没有**在真机/模拟器上实际加载 sqlite-vec 并跑通一次 KNN。README 声称可用，但「声称」与「跑通」之间还有距离（例如扩展加载权限、`sqliteVec` 与现有 schema 的共存）。**这一步必须真机实测后才能定案。**

### 4.3 检索

| 候选 | 许可证 | star | 最后提交 | **依赖 WASM？** | 浏览器 | **RN / Hermes** | 体积 | 常驻服务 |
|---|---|---|---|---|---|---|---|---|
| **SQLite FTS5** | Public Domain（SQLite 本体） | — | 随 SQLite 发布 | 否（原生编译选项） | ❌ heyta 浏览器无 SQL | ✅ **可用**（需打开 op-sqlite `fts5` 开关） | 0（随 SQLite） | 嵌入式 |
| **Tantivy** | MIT | 16,144 | 2026-09-25 | Rust 库；JS 侧要么 WASM 要么原生 | 仅 WASM | ❌ | — | 嵌入式（Rust） |

**🟢 实测：`node:sqlite` 的 FTS5 是完整可用的**（Node **v24.2.0**，本次真实执行）：

```
FTS5_OK [{"title":"defer gym task"}]           # CREATE VIRTUAL TABLE ... USING fts5(...) + MATCH 查询
BM25_OK [{"title":"defer gym task","score":-0.000001375}]   # bm25() 排序可用
UNICODE61_OK                                    # tokenize='unicode61 remove_diacritics 2'
TRIGRAM_OK                                      # tokenize='trigram'
PORTER_OK                                       # tokenize='porter'
```

🟡 分析：对中文场景，`trigram` 分词器可用是**关键的好消息**——它让 FTS5 在无分词词典的情况下也能做中文子串检索。这条在 heyta 里价值很高（中文任务标题）。

**Tantivy 的 JS 现实（🟢 实测 npm）**：npm 上名为 `tantivy` 的包只有 `0.1.0` 一个版本，`description: "uses napi-rs"`，单一维护者 `pierrotws`，最后修改 `2025-02-27`；`tantivy-wasm`、`tantivy-js`、`node-tantivy` **均不存在（404）**，`@quickwit` npm scope **0 个包**。🔵 Tantivy 官方 README 的「Can I use Tantivy in other languages?」只列 **Python（tantivy-py）与 Ruby（tantiny）**，并自述「You can also find other bindings on GitHub but they may be less maintained.」🟡 分析：Tantivy 本体（Rust，MIT，16k star，活跃）是优秀引擎，但**从 JS 用它的唯一现实路径是 WASM（Hermes 出局）或自己写原生绑定**；npm 上那几个非官方 napi 包（`@bigmoves/tantivy-js`、`@oxdev03/node-tantivy-binding`、`@arso-project/sonar-tantivy`）全是 **Node-only、无 RN**，且不满足 heyta §3.1 的可维护性门槛。

**🔴 如果 heyta 真要在浏览器端做 FTS5：只有官方 `sqlite-wasm` 一条路（🟢 实测，来自并行核查）**

浏览器端没有非 WASM 的 SQLite（这是**固有事实**，不是选型问题）。但**并非所有 WASM SQLite 都带 FTS5**——这一点极易踩坑：

| 浏览器 SQLite 包 | 版本 | 许可证 | FTS5 | 🟢 实测结果 |
|---|---|---|---|---|
| **`@sqlite.org/sqlite-wasm`** | 3.53.4-build1 | Apache-2.0 | ✅ **有** | `>>> @sqlite.org/sqlite-wasm FTS5: SUPPORTED`（sqlite_version 3.53.4） |
| `wa-sqlite` | 1.0.0 | npm **null**（仓库 README 称 2023-02-10 起 MIT） | ❌ **没有** | `>>> WA-SQLITE FTS5: NOT SUPPORTED -> no such module: fts5`（sqlite_version 3.44.0） |
| `sql.js` | 1.14.2 | MIT | ❌ **没有**（只有 FTS4） | `>>> SQL.JS FTS5: NOT SUPPORTED -> no such module: fts5`；`>>> SQL.JS FTS4: SUPPORTED`（sqlite_version 3.49.1） |
| `absurd-sql` | 0.0.54 | npm **null** | ❌（转调 sql.js） | 最后发布 2023-08-31 |

原因在编译开关里，与实测完全吻合：`sql.js/Makefile` 只有 `-DSQLITE_ENABLE_FTS3 -DSQLITE_ENABLE_FTS3_PARENTHESIS`，**没有 FTS5**；`wa-sqlite/Makefile` 的 `WASQLITE_DEFINES` 里**也没有 FTS5**。

🔵 SQLite 官方 WASM 文档自述其定位：「…which enable the use of sqlite3 in **modern WASM-capable browsers**」，并提到历史上唯一原生级的浏览器 SQLite（WebSQL）「has long since been removed from browsers」[来源: https://sqlite.org/wasm/doc/trunk/index.md]。

🟡 **分析**：所以「浏览器端做检索」在 heyta 里有三条路，代价递增——① 纯 JS 内存扫描（**零依赖，推荐**，数据量小）；② 引 `@sqlite.org/sqlite-wasm`（~2.9 MB，WASM，但**与 IndexedDB 存储是两套东西**，等于浏览器端再养一个存储引擎）；③ 自建 WASM SQLite。注意 ② 里**不能**用更常见的 `sql.js` / `wa-sqlite`，因为它们**没有 FTS5**。

**🔵 `sqlite-vec` 在浏览器端还有一层额外的坏消息**：官方 WASM 文档原话——「It's not possibly to dynamically load a SQLite extension into a WASM build of SQLite. So `sqlite-vec` must be **statically compiled into custom WASM builds**.」，而提供的 `sqlite-vec-wasm-demo` 被明确标注为「This package is a **demonstration** and may change at any time.」[来源: https://alexgarcia.xyz/sqlite-vec/wasm.html]。🟡 分析：这意味着**浏览器端要用 sqlite-vec，等于要自己维护一个定制 WASM 构建**——对一个小团队来说是明确的高成本项。（另有第三方 RN 封装 `react-native-nitro-sqlite-vec@10.0.0`，非官方，未评估。）

### 4.4 AI 记忆框架

| 候选 | 许可证 | star | 最后提交 | 主语言 | **JS/TS SDK** | **需要服务？** | **写入时调 LLM？** | RN / Hermes | 浏览器 |
|---|---|---|---|---|---|---|---|---|---|
| **mem0** | Apache-2.0 | 66,006 | 2026-09-25 | Python | ✅ `mem0ai@3.3.1`（有 OSS 路径） | OSS 库可嵌入式，但需**向量库 provider** | ✅ | ❌ **Node-only**（见下） | ❌ |
| **Letta**（原 MemGPT） | Apache-2.0 | 24,889 | 2026-09-10 | Python | 仅 `@letta-ai/letta-client@1.12.1`（**服务端客户端**，965 文件） | **必须服务** | ✅ | ❌ | ❌ |
| **Zep** | Apache-2.0 | 4,932 | 2026-09-18 | Python | 仅 `@getzep/zep-cloud@3.30.0`（**云客户端**，npm `license` 为 **null**） | **必须服务**（Go 服务 + 图库） | ✅ | ❌ | ❌ |
| **Graphiti**（Zep 引擎） | Apache-2.0 | 未取到 | 未取到 | Python | 未查到 JS SDK | 需 Neo4j/FalkorDB 等图库 | ✅ | ❌ | ❌ |
| **Cognee** | Apache-2.0 | 30,987 | 2026-09-26 | Python | 未查到官方 JS SDK | 需数据库 | ✅ | ❌ | ❌ |
| **Memary** | MIT | 2,650 | **2024-10-22** | Jupyter/Python | ❌ | 需 Neo4j + LLM | ✅ | ❌ | ❌ |

**🔴 mem0 的 OSS 路径实测 disqualification（本次最硬的证据之一）**

🟢 实测：拉取 `mem0ai@3.3.1` 的 `dist/oss/index.js`，提取全部 `require(...)`：

```
require("@zilliz/milvus2-sdk-node")   # 服务端向量库客户端
require("axios")
require("better-sqlite3")             # Node 原生插件，RN/浏览器都没有
require("compromise")
require("crypto")                     # Node 内置
require("fs")                         # Node 内置
require("natural")
require("openai")                     # 写入时调 LLM = 明文出境
require("os")                         # Node 内置
require("path")                       # Node 内置
require("uuid")
require("zod")
```

🔵 mem0 npm README 也自述 OSS 版「**Vector Store Integration**: Supports various vector store providers」「**SQLite Storage**: Use SQLite for memory history management」[来源: https://unpkg.com/mem0ai@3.3.1/README.md]。

🟡 **分析**：`fs` / `os` / `path` / `crypto` / `better-sqlite3` 这五个一起出现，等于**宣告它只能跑在 Node**——浏览器没有 `fs`/`path`/`os`，Hermes 没有 `better-sqlite3`。再叠加 `openai`（写入即调 LLM，明文出境）与 `@zilliz/milvus2-sdk-node`（还要一个向量库服务），mem0 在 heyta 三端约束下**全线出局**。

**🔴 记忆框架的共同结构性问题（🟡 分析，但依据充分）**

1. **它们全是「服务 + LLM」形态**，不是「嵌入式库」。Letta 要跑服务端；Zep 要 Go 服务 + 图库；Cognee 要数据库；Memary 要 Neo4j。heyta 的浏览器与移动壳**不可能**内嵌这些。
2. **它们在写入/读取时调 LLM 做抽取与摘要**——对 E2EE + 本地优先是**结构性冲突**：要么把任务明文送出去（撞 `packages/ai/src/egress.ts` 的 `(feature, destination)` 精确授权闸门，且 ADR-0005 §3.4 要求「每个能力分支只能发送它当下需要的那一小段明文」），要么整套框架无法工作。
3. **Memary 已近停更**（2024-10-22，约 2 年无提交）——虽然形式上过了「2021 之后仍在维护」的门槛，但对一个要长期养的小团队来说是不可接受的基础设施。

> ⚪ 未查到：Cognee / Graphiti 是否提供官方 JS SDK、以及这些框架是否公开承诺「服务端看不到明文」。§10 列出。

---

## 5. 🔴 三端兼容性矩阵

口径：`✅ 原生`=无 WASM，可在该壳直接跑；`✅ WASM`=靠 WASM（该壳有 WASM 所以可行）；`🔴`=WASM 且该壳无 WASM（出局）；`❌`=无路径。

| 方案 | 浏览器（IndexedDB，无 SQL） | **RN / Hermes** | Node（`node:sqlite`） | 三端一套代码？ |
|---|---|---|---|---|
| **SQLite FTS5** | ❌ 无 SQL（唯一办法是 WASM：`@sqlite.org/sqlite-wasm`，**`sql.js`/`wa-sqlite` 都没有 FTS5**） | ✅ 原生（需开 op-sqlite `fts5` 开关 + 重新构建） | ✅ **实测可用**（含 bm25 / snippet / highlight / fts5vocab / trigram / porter） | ❌（浏览器要另写） |
| `@sqlite.org/sqlite-wasm`（浏览器 FTS5 的唯一选项） | ✅ WASM（2.9 MB） | 🔴 WASM → 出局 | ✅ 原生可用（但没必要） | ❌ |
| **sqlite-vec** | ⚠️ 无现成路径（WASM 下**不能动态加载扩展**，需自建静态编译 WASM） | ✅ **原生**（op-sqlite 内置 `sqlitevec.xcframework` / `libsqlite_vec.so`，需开开关）⚠️ 未真机验证 | ✅ **实测跑通 KNN** | ❌（浏览器要另写） |
| **纯 JS 暴力余弦扫描** | ✅ 原生 | ✅ 原生 | ✅ 原生 | ✅ **唯一真正三端一致** |
| LanceDB | ❌ | ❌ | ✅ 原生（Node ≥ 22） | ❌ |
| ChromaDB | ❌ | ❌ | 客户端（需服务）/ 桌面原生绑定 | ❌ |
| Qdrant | ❌ | ❌ | 客户端（需服务） | ❌ |
| pgvector | ❌ | ❌ | 需 PostgreSQL 服务 | ❌ |
| DuckDB VSS | ✅ WASM | 🔴 无 WASM → 出局 | ✅ 原生 | ❌ |
| usearch | ❌ | ❌ | ✅ 原生（仅桌面） | ❌ |
| hnswlib | 仅 WASM 包 | 🔴 WASM → 出局 | ✅ 原生（`hnswlib-node`） | ❌ |
| Tantivy | 仅 WASM | 🔴 WASM → 出局 | 需自写绑定 / 单人包 | ❌ |
| mem0 / Letta / Zep / Cognee / Memary | ❌ | ❌ | 多为 Python/服务 | ❌ |

**读法**：整张表里，**只有「纯 JS 暴力余弦扫描」是三端一致的**；而它恰好**不需要任何新依赖**。这为 §7 的结论提供了结构性依据。

---

## 6. 许可证门禁：按 heyta 的实际脚本判定（🟢 实测读源码）

heyta 的判据不是「许可证是否宽松」，而是 `research/tools/license-inventory.mjs` 的**字符串匹配**。这会产生几个反直觉的失败。

**脚本实际逻辑**（`research/tools/license-inventory.mjs`）：

- `PERMISSIVE = ['MIT','ISC','Apache-2.0','BSD-2-Clause','BSD-3-Clause','0BSD','Unlicense','CC0-1.0','Python-2.0','BlueOak-1.0.0','MIT-0','Apache-2.0 WITH LLVM-exception','Zlib','MPL-2.0']`
- `classify()`：先查 `RESTRICTED`（`AGPL/GPL/LGPL/SSPL/BUSL/BSL/FSL/Elastic/CC-BY-NC/CC-BY-SA/EUPL/OSL/CPAL/Commons Clause`，用 `up.includes(...)` 子串匹配），再查 `PERMISSIVE`（**同样是 `up.includes(k.toUpperCase())` 子串匹配**），都不中 → `'other'`
- `other` **默认失败**（`failing = restricted + unknown + unreviewedOther`，`process.exit(failing ? 1 : 0)`）；只有登记在 `REVIEWED_OTHER` 里才放行
- 目前 `REVIEWED_OTHER` **只有一条**：`'CC-BY-4.0'`（caniuse-lite 构建期数据包）

**由此推出的具体后果（🟡 分析，机制为实测）**：

| 包 | 声明的 license 字符串 | 脚本判定 | 后果 |
|---|---|---|---|
| `sqlite-vec` (npm) | `MIT OR Apache` | 含 `MIT` → `permissive` | ✅ 通过 |
| `@lancedb/lancedb` | `Apache-2.0` | `permissive` | ✅ 通过 |
| `chromadb` | `Apache-2.0` | `permissive` | ✅ 通过 |
| `hnswlib-node` / `hnswlib-wasm` | `Apache-2.0` | `permissive` | ✅ 通过 |
| **`usearch`** | **`Apache 2.0`**（空格，非 SPDX） | `"APACHE 2.0".includes("APACHE-2.0")` = **false** → `other` → 未登记 | 🔴 **门禁失败**（尽管底层就是 Apache-2.0） |
| **`@getzep/zep-cloud`** | **`null`** | `normalize(null)` → `'UNKNOWN'` → `unknown` | 🔴 **门禁失败**（AGENTS.md §3.2：「无 LICENSE 文件 = 无授权 = 一行都不能用」） |
| `wa-sqlite` | `null` | 同上 | 🔴 门禁失败 |
| **pgvector** | **PostgreSQL License** | 不在 `PERMISSIVE` 里 → `other` → 未登记 | 🔴 **门禁失败**（虽属 BSD 风格宽松许可，但 SPDX 是 `PostgreSQL` 而非 `BSD-*`） |

🟡 **分析**：`usearch` 与 `pgvector` 这两条特别值得记——**底层许可证完全没问题，卡住的是字符串**。这正是 AGENTS.md 里那段「加一条登记的成本是刻意的」在起作用。如果最终真要用，正确做法是在 `REVIEWED_OTHER` 里逐项登记理由，**而不是**改 `PERMISSIVE`。

---

## 7. 🔴 特别提醒：heyta 真的需要一个向量数据库吗？

**我的结论：不需要。** 下面是逐条论证，而不是「为了凑方案而推荐」。

### 7.1 向量库能解决、而 op-log + SQLite 解决不了的问题：只有一个

把任务书里点名的记忆需求拆开看：

| 需求 | 它本质是什么 | 需要向量库吗 |
|---|---|---|
| 任务历史 | 按实体/时间检索事件 | ❌ 索引 + `WHERE` |
| **推迟习惯** | 「这条任务被改过几次截止日期」= 对 `UPD` op 的**计数** | ❌ `GROUP BY` / `COUNT` |
| **专注记录** | `FocusSession` 实体求和/分组 | ❌ `SUM` / `GROUP BY` |
| 接触频率 | 按实体计数 | ❌ `COUNT` |
| **语义检索**（「找和这条意思相近的任务」） | 最近邻 | ✅ **只有这一条** |

**只有最后一类**需要向量检索，而它**不在** heyta 已声明的记忆目标里（`docs/plans/ai-strategy.md` §4 的落点是「推迟/专注落差」这个**确定性事实**）。

### 7.2 三条独立理由，任何一条都足以否决

**理由一：产品要的是「计数」，向量库只会给「相似」。**
ai-strategy.md §4 的核心主张是「**事实用规则算，人话让模型说**」。`GROUP BY` 给出的是可解释、可复现、可测试的整数；ANN 给出的是概率性的「相似度」。用一个概率性组件去回答一个确定性问题是**降级**，不是升级。

**理由二：向量库解决的是 heyta 不存在的规模问题（🟢 实测数字）。**

本机 Node v24.2.0 单线程纯 JS 暴力余弦扫描实测：

| 向量数 × 维度 | 耗时 |
|---|---|
| 1,000 × 384 | **0.3 ms** |
| 10,000 × 384 | **2.6 ms** |
| 100,000 × 384 | **28.2 ms** |
| 1,000,000 × 384 | **269.1 ms** |
| 10,000 × 1536 | **10.6 ms** |
| 100,000 × 1536 | **107.6 ms** |

（384 维对应 all-MiniLM-L6-v2 / bge-small 这类小模型；1536 维对应 OpenAI text-embedding-3-small。）

🟡 **分析**：一个个人任务管理器的任务量在 10³–10⁴ 量级。也就是说**暴力扫描 0.3–3 ms**，而这段代码是一个 `Float32Array` 加一层 `for` 循环——**三端完全一致、零依赖、零原生构建**。ANN 索引（HNSW/IVF）优化的是 10⁶ 以上的场景。**引入向量库等于为不存在的问题付费。**

**理由三：真正的瓶颈是嵌入模型，而它正好撞在 E2EE 与 Hermes 上。**

这是最容易被忽略、也是最致命的一条。要拿到向量，先得有 embedder：

| 嵌入来源 | 代价 |
|---|---|
| **远程 API**（OpenAI 等） | 任务明文出境 → 必须过 `authorizeEgress(feature, destination)` 的精确授权，且按 ADR-0005 §3.4「只能发送当下需要的那一小段明文」；同时产生**服务端明文派生物** |
| **本地 WASM**（transformers.js / ONNX） | 🟢 实测：`@huggingface/transformers@4.3.0` 依赖 `onnxruntime-web`（**WASM**，144.6 MB）与 `onnxruntime-node`（原生，301.1 MB）→ 前者在 **Hermes 上直接死**，后者是 Node 插件、RN 用不了 |
| **本地原生**（Core ML / ORT Mobile / MLC） | 要为 iOS / Android / 鸿蒙**各写一套原生推理**——正是 AGENTS.md §7 第 481 条明确规避的「原生绑定要分别写 Android / iOS / 鸿蒙三套」 |

> ⚪ 附注：`@xenova/transformers`（旧版）最后发布于 **2024-05-29**，已被 `@huggingface/transformers` 取代；两者都逃不掉 WASM/原生二选一。

**而且嵌入向量本身就是明文派生物。** 嵌入反演攻击（Embedding Inversion Attacks）能从向量恢复出相当部分的原文语义 [来源: https://arxiv.org/html/2503.12896]；有分析指出「embedding stores are the real risk」[来源: https://securing.ai/model-inversion/]。🟡 分析：这与 ADR-0005 反复警告的「明文派生物」是同一类风险——**在本地多存一份 embedding，等于多存一份可被反演的语义摘要**；而一旦为了多端同步去同步它，E2EE 就破了。

### 7.3 第四条理由：确定性与可重建性（heyta 自己的不变量）

`packages/storage/src/stores.ts` 明写 `STATE`「**可从 OPS 完整重建**」。这是 heyta 的核心不变量。🟡 分析：

- 如果向量索引由**远程/非确定性**的 embedder 生成，它**无法从 op-log 确定性地重建** → 它变成**第二个、不可重建的事实源**，会漂移。
- heyta 为「客户端与服务端各自裁剪向量时钟」这种小得多的漂移写过一整份 ADR-0008（含「永久拒绝是它的必然后果」的故障链）。引入一个不可重建的派生索引，是**同一类故障形状的放大版**。

### 7.4 那么代价是什么？

| 引入向量库的代价 | 具体到 heyta |
|---|---|
| 新依赖 + 许可证门禁 | 见 §6：`usearch` / pgvector 会被门禁直接拦下 |
| 原生构建改动 | op-sqlite 需打开 `sqliteVec`（或 `fts5`）开关并**重新出包**；`pnpm check` 含 iOS 原生依赖门禁 |
| **浏览器端要另写一套** | 浏览器是 IndexedDB、**没有 SQL**（§3.1）——三端无法复用 |
| 鸿蒙端未知 | 鸿蒙壳**尚未建**；op-sqlite README 只列 iOS/Android/macOS/web，**未列 HarmonyOS** |
| 新的派生存储要跟 op-log 保持一致 | 新的漂移类故障 + 新的测试面 |
| 新的出境面 | 每接一个远程 embedder 都要扩 `AiFeature` + 重新征求授权 |
| 团队成本 | 对一个「小团队的小型 AI 产品」，以上每一项都是长期负担 |

### 7.5 结论

> **不加向量库。** 现在缺的不是**存储**，而是**在 op-log 之上的确定性派生层**——把事件历史压成可查询的特征（推迟次数、专注落差、接触频率）。这一层是纯规则、纯函数、可测试、三端一致，且**不产生任何新的明文派生物**。这与 `docs/plans/ai-strategy.md` §4.1 已有的判断一致，本文为该判断补上了可验证的依据。

**如果将来产品真的要做「语义检索」**（唯一正当理由），最小代价路线是：

1. **仍然不要引入向量数据库** —— 把 embedding 存成 `Float32Array`，放进现有 `STATE` 存储，用暴力扫描（🟢 实测 10k 条 2.6 ms）。
2. **embedder 走用户自己的本地端点**（`localhost` Ollama / vLLM）——ADR-0006 已把回环地址判为「明文没离开设备、**无需出境授权**」，这是唯一不新增出境面的取向量方式。
3. **embedding 不参与同步**（它是明文派生物，且可从 op-log 重算）。
4. 只有在「本地端点不可用 + 用户显式授权出境」时，才把 embedder 指向远程，并把新目的地登记进 `(feature, destination)` 授权。

---

## 8. 可选架构路线与代价

### 路线 A：确定性特征层（推荐）

在 op-log / `MaterializedState` 之上加一个纯函数派生层，算「推迟次数 / 专注落差 / 接触频率」。

- **代价**：无新依赖、无原生改动、三端一致、无新出境面。需要的是**设计**（哪些特征、怎么算）而不是技术选型。
- **风险**：特征是「规则」，如果产品后来要做语义检索，需要再加一层。
- **证据支撑**：§7.2 理由一、理由三、理由四。

### 路线 B：A + 打开 FTS5（推荐作为「需要文本检索时」的第一步）

在路线 A 基础上，把 op-sqlite 的 `fts5` 开关打开，iOS/Android 用 FTS5（🟢 `node:sqlite` 侧已实测可用，含 `trigram` 对中文友好）；浏览器端用**内存里的纯 JS 子串/分词扫描**（数据量小，无需 SQL）。

- **代价**：改 `op_sqlite_config` + 重新原生构建；**三端两套实现**（浏览器无 SQL）；FTS5 索引同样是从 op-log 派生的，需定义重建时机。
- **不解决**：语义近似（FTS5 是词法的）。
- **证据支撑**：§4.2（开关与二进制实测）、§4.3（FTS5 实测）。

### 路线 C：B + sqlite-vec（仅当语义检索成为核心功能）

在 B 之上，打开 op-sqlite 的 `sqliteVec` 开关，用 `vec0` 虚表存本地端点产出的 embedding。

- **代价**：原生构建改动 + 真机验证（⚪ 尚未验证）+ 浏览器端仍需另写（内存暴力扫描）+ 鸿蒙端未知 + 需要 embedder（§7.2 理由三）。
- **仍不需要**：任何独立向量数据库。
- **证据支撑**：§4.2（二进制实测）、§7.2 理由二（暴力扫描够快）。

### 路线 D：引入独立向量数据库（**不推荐**）

LanceDB / Chroma / Qdrant / pgvector / usearch / hnswlib / DuckDB VSS 任一。

- **代价**：三端矩阵（§5）显示**没有一个能覆盖浏览器 + Hermes**；桌面 Node 侧可行但只覆盖 1/3 端；pgvector/Qdrant 还要独立服务，与「本地优先」直接冲突；`usearch`/pgvector 还会被许可证门禁拦下（§6）。
- **收益**：在 heyta 的数据规模下 ≈ 0（§7.2 理由二）。

### 路线 E：引入 AI 记忆框架（**不推荐**）

mem0 / Letta / Zep / Cognee / Memary。

- **代价**：🟢 实测 mem0 OSS 需要 `fs`/`os`/`path`/`crypto`/`better-sqlite3`/`openai`（Node-only + 明文出境 + 还要向量库）；其余均为「服务 + LLM」形态，浏览器/Hermes 无路径（§4.4）。
- **与 E2EE 的结构性冲突**：它们在写入/读取时调 LLM，等于把明文送出去（§4.4）。

---

## 9. 结论与建议

1. **不引入向量数据库**，也不引入 AI 记忆框架。理由见 §7（三条独立理由 + 可重建性）。
2. **优先做「确定性特征层」**（路线 A）：推迟次数、专注落差、接触频率——纯规则、可测试、三端一致、零新依赖。
3. **需要文本检索时先上 FTS5**（路线 B），但要知道：① RN 端必须先在 monorepo 根 `package.json` 加 `"op-sqlite": { "fts5": true }`（默认关）并**重新原生构建**；② **浏览器端没有 SQL，要另写一套**（若一定要用 SQL，只有 `@sqlite.org/sqlite-wasm` 带 FTS5，`sql.js`/`wa-sqlite` 都不带）；③ 🟢 `node:sqlite` 侧已实测 FTS5 + bm25 + snippet + highlight + fts5vocab + trigram 可用。
4. **语义检索留到确有产品需求时**（路线 C），且**仍然不要用向量数据库**——`Float32Array` + 暴力扫描（🟢 10k 条 2.6 ms）三端一致；embedder 优先走本地端点（ADR-0006 视为非出境）。
5. **本文附带的两条工程提醒**：
   - 🔴 **`VECTOR_CLOCK` 是因果向量时钟，不是向量检索**（§3.3），别混。
   - 🔴 **`usearch` / pgvector 会被 heyta 的许可证门禁拦下**（§6），原因是 license 字符串而非底层许可——要用得走 `REVIEWED_OTHER` 登记。

---

## 10. 哪些是实测的、哪些只是官方文档声称的、哪些没查到

### 🟢 实测（本次在本机真实执行并观察输出）

- `node:sqlite`（Node **v24.2.0**，SQLite **3.50.0**）的 **FTS5 可用**，含 `bm25()`、`snippet()`、`highlight()`、`fts5vocab`、`unicode61 remove_diacritics 2`、`trigram`、`porter`；编译选项实测为 `ENABLE_FTS3` / `ENABLE_FTS3_PARENTHESIS` / `ENABLE_FTS5`。附带：该模块在 v24.2.0 仍会打 `ExperimentalWarning`。
- **浏览器端 SQLite 的 FTS5 实测结论**：`@sqlite.org/sqlite-wasm@3.53.4-build1` **有 FTS5**；`wa-sqlite@1.0.0` **没有**（`no such module: fts5`，sqlite 3.44.0）；`sql.js@1.14.2` **没有 FTS5、只有 FTS4**（sqlite 3.49.1）。原因与各自 Makefile 的编译开关一致。
- **`node:sqlite` 可加载 sqlite-vec 原生扩展并跑通 KNN**：`vec_version() = v0.1.9`；`vec0` 虚表插入 3 条 4 维向量，查询 `[1,0,0,0]` 返回距离 `0 / 0.1414 / 1.4142`；`vec_to_json()` 正常；**FTS5 与 `vec0` 可在同一库共存**；无 WASM 参与。附带发现：`vec0` 主键在 `node:sqlite` 下必须用 **BigInt**（传 `1` 会报 `Only integers are allows for primary key values`）；需 `new DatabaseSync(path, { allowExtension: true })`，事后调用 `enableLoadExtension` 会报 `Cannot enable extension loading because it was disabled at database creation`。
- **暴力余弦扫描基准**：1k/10k/100k/1M × 384 维 = 0.3 / 2.6 / 28.2 / 269.1 ms；10k/100k × 1536 维 = 10.6 / 107.6 ms。
- **heyta 三端存储引擎**：浏览器 `IndexedDbAdapter`、RN `@op-engineering/op-sqlite@18.2.5`、Node `node:sqlite`（读代码 + package.json）。
- **heyta 当前未开启 op-sqlite 的 FTS5 / sqlite-vec**：全仓库 `grep op_sqlite_config|sqliteVec|fts5`（排除 node_modules）零命中。
- **op-sqlite 随包分发的 sqlite-vec 二进制确实存在**：`ios/sqlitevec.xcframework/**/sqlitevec.framework`、`android/src/main/libsqlitevec/{4 ABIs}/libsqlite_vec.so`；`op-sqlite.podspec` 中 `fts5 = false`、`use_sqlite_vec = false` **默认关闭**（`android/build.gradle` 同样是 `def enableFTS5 = false`）；`android/CMakeLists.txt` 有 `USE_SQLITE_VEC` 分支。配置从 `packageJson["op-sqlite"]` 读取。
- **op-sqlite 的 web 支持是 WASM**：`peerDependencies` 含 `@sqlite.org/sqlite-wasm`，包内有 `Storage.web.ts` / `opsqlite-web-wasm-asset.ts`。
- **各候选的 npm 真实数据**：license、版本、`unpackedSize`、`engines`、`dependencies`/`optionalDependencies`、最后修改时间（含 `usearch` 25.2 MB / 544 文件、`@duckdb/duckdb-wasm` 149.4 MB、`@op-engineering/op-sqlite` 352.0 MB / 164 文件、`sqlite-vec` 4 KB / 5 文件等）。
- **`usearch` 的 prebuilds 只有桌面 OS**；**`chromadb` 的原生绑定只有桌面 OS**；**`sqlite-vec` npm 的平台白名单无 iOS/Android**（读包内文件清单与 `index.cjs`）。
- **mem0 `dist/oss/index.js` 的 `require()` 全集**（含 `fs`/`os`/`path`/`crypto`/`better-sqlite3`/`openai`/`@zilliz/milvus2-sdk-node`）。
- **npm 上 `tantivy` 包只有一个版本 0.1.0、单人维护、2025-02-27**；`tantivy-wasm`/`node-tantivy`/`@quickwit/tantivy` 不存在。
- **官方 RN 0.84 release notes 中 "WebAssembly"/"WASM" 出现 0 次**（正文 9,541 字符）。
- **heyta 许可证门禁的实际逻辑与 `PERMISSIVE`/`REVIEWED_OTHER` 内容**（读 `research/tools/license-inventory.mjs`），并据此推出 §6 的判定表。
- **14 个候选的 GitHub star / license / pushed_at / archived**（2026-09-26 真实 API 返回，见 §4.1、§4.4 表）。

### 🔵 仅官方文档/源码声称（已引原文，但未由我运行验证）

- **op-sqlite 支持 FTS5 与 sqlite-vec 插件**（README 特性列表 + podspec/CMake 开关）——**二进制与开关为实测，但「在真机上真能加载并查询」未验证**。
- **sqlite-vec 在浏览器走 WASM**（README 原文「in the browser with WASM」）。
- **op-sqlite 支持 iOS / Android / macOS / web**（README）——**未列 HarmonyOS**。
- **mem0 OSS 支持多向量库与 SQLite 历史**（npm README）。
- **Hermes 不支持 `global.WebAssembly`**：官方 issue #429 仍 `Open`（🔵 原文）＋ heyta 自己的真机实测（🟢，`WebAssembly is not supported in this environment!`）。
- **pgvector 的真实许可是 PostgreSQL License**（读 LICENSE 原文；GitHub API 显示 `NOASSERTION`）。
- **Tantivy 本体 MIT**（读 LICENSE 原文）。
- **Zep / Graphiti / LanceDB 为 Apache-2.0**（读 LICENSE 原文）。
- **嵌入反演攻击可恢复语义**（arXiv 2503.12896 等）。

### ⚪ 没查到 / 未验证（不要当成已知）

1. **op-sqlite 内置 sqlite-vec 在真机/模拟器上是否真能加载并跑通 KNN** —— 只验证了二进制与开关存在，**没有跑过设备**。这是最需要补的一步。
2. **op-sqlite 是否支持 HarmonyOS** —— 🔵 在 `README.md`、`docs/docs/installation.md`、`package.json` 里搜 `harmony|ohos|openharmony` **零命中**；官方只声明「iOS, Android, macOS and web」。但 `apps/mobile/src/db/op-sqlite-driver.ts` 注释称其为「iOS/鸿蒙 上的实现」。**两处说法不一致，未解决。** 而 heyta 鸿蒙壳**尚未建**。🟡 这是 FTS5/sqlite-vec 路线在鸿蒙端的**未决风险**。
2b. **Qdrant Edge 是否有 JS/TS 绑定** —— 未查到；官方只点名 `qdrant-edge-py`（PyPI）与 `qdrant-edge`（crates.io）。
2c. **Tantivy 是否有官方 JS/TS/WASM 绑定** —— 未查到；官方 README 只列 Python 与 Ruby。
3. **`@op-engineering/op-sqlite` 的 352 MB `unpackedSize` 对最终 App 体积的实际影响** —— 未做产物体积测量（该数字含多平台 xcframework/`.so`，不等于打进包里的量）。
4. **LanceDB / Chroma 是否有独立的浏览器或 React Native 官方构建** —— 只验证了主 npm 包内无 WASM/无移动绑定，未穷尽其官方文档与周边包。
5. **Cognee / Graphiti / Memary 是否有官方 JS SDK** —— 未逐项核实（Memary 无、Cognee/Graphiti 未查到）。
6. **这些记忆框架是否有「服务端看不到明文」的官方承诺** —— 未找到公开信息。
7. **GitHub 限流导致未取到**：各候选的 `open_issues_count`、`subscribers_count`、releases、近期 commit 列表（`remaining: 0`）。§4 表中 `pushed_at` 为首批已取到的真实值。
8. **FTS5 中文分词的实测质量** —— 只验证了 `trigram` / `unicode61` tokenizer **可用**，**未评测**中文任务标题的召回效果。
9. **真实设备上的向量/检索性能** —— 本文所有性能数字均来自本机 Node v24.2.0（Apple Silicon），**非** iOS/Android 真机。

---

## 附：本文引用的关键来源

- sqlite-vec README：https://raw.githubusercontent.com/asg017/sqlite-vec/main/README.md
- Hermes issue #429（WASM 支持跟踪，仍 Open）：https://github.com/facebook/hermes/issues/429
- React Native 0.84 官方发布说明：https://reactnative.dev/blog/2026/02/11/react-native-0.84
- Callstack RN 0.84 活动页（「WebAssembly Support in Hermes」说法来源）：https://www.callstack.com/events/react-native-0-84-and-other-news
- op-sqlite 官方文档：https://op-engineering.github.io/op-sqlite/
- mem0 npm README：https://unpkg.com/mem0ai@3.3.1/README.md
- 嵌入反演：https://arxiv.org/html/2503.12896 ；https://securing.ai/model-inversion/
- heyta 内部依据：`docs/plans/ai-strategy.md` §4/§4.1、`docs/adr/0003-multi-platform-strategy.md`、`docs/adr/0005-ai-data-path.md`、`docs/adr/0006-supply-modes.md`、`docs/adr/0008-vector-clock-limit.md`、`packages/storage/src/stores.ts`、`packages/storage/src/sqlite/sqlite-driver.ts`、`packages/ai/src/egress.ts`、`research/tools/license-inventory.mjs`、`packages/sync-core/tests/argon2-fallback.spec.ts`
