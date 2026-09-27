# 多端「一套代码」融合调研：外部最佳实践 × 本仓库实测

调研日期：2026-09-27。调研对象：heyta（本地优先 + E2EE 开源任务管理，MIT，小团队 + AI agent）。
本文是**调研原料**，不是产品文档。凡标「实测」者为本次在本机真实执行过命令并观察到输出；
凡标「分析」者为推断，非公开事实。**结论落到 [ADR-0024](../adr/0024-desktop-shell-and-ui-convergence.md)，
执行落到 [phase-3 计划](../plans/multi-platform-adaptation.md)。**

---

## 0. 方法与一个必须先说明的偏差

### 0.1 🔴 本次**没有**可用的联网搜索接口

本次调研中 `web_search` 全程返回 `Tavily API error (HTTP 432)`。因此本文**不是**搜索驱动的调研，
而是**直接从一手来源取得**：

| 手段 | 取到什么 | 本仓库既有工具 |
|---|---|---|
| `research/tools/ghinfo.py` | 仓库星数 / 许可证 / 归档状态 / 最后提交 / 最新 release（**故意绕过 api.github.com**，因匿名限流） | ✅ 仓库自带 |
| `registry.npmjs.org/<pkg>/latest` | 版本号 / `peerDependencies` / `license` 字段 | — |
| `releases.electronjs.org/releases.json` | Electron 每个版本打包的 Node / Chromium 版本 | — |
| 官方文档页直接抓取 | API 语义（Tauri 的 `invoke`、Electron 的 `sendSync`、Node 的 `node:sqlite`） | — |
| 本机读代码 / 跑命令 | 本仓库的行数、引擎、接口、门禁 | — |

**为什么必须写明这一点**：没有搜索意味着**覆盖面有系统性缺口** —— 我只会看到"我已经知道名字的项目"，
看不到我没想到的候选，也看不到社区踩坑帖与团队复盘。凡涉及"有没有别的方案""别人做得怎么样"的问题，
本文的可信度都低于一次正常的联网调研。§6 逐条标出这些缺口。

> ⚠️ api.github.com 本次返回 **HTTP 403 rate limit**（`API rate limit exceeded for 146.70.117.114`），
> 而 `ghinfo.py` 正常返回 —— 这正好印证了它存在的理由。

---

## 1. 一句话结论

**「一套代码」在 heyta 的正确落点是：UI 只写一份 React Native 组件，
由 react-native-web 渲染到 Web 与桌面，由 RN 原生渲染到 iOS/Android，由 RNOH 渲染到鸿蒙；
桌面壳选 Electron 而不是 Tauri，因为 heyta 的存储接口是同步的、而 Tauri 只有异步 IPC，
Electron 同时具备同步 IPC 与已在本仓库跑通的 `node:sqlite` 驱动。**

这不是"哪个框架更流行"的结论，而是三条**本仓库特有**的约束交集逼出来的：

1. 存储接口 `SqliteDriver` 是**同步**的（本仓库实测，4 个同步方法）→ 排除只有异步 IPC 的 Tauri；
2. 业务逻辑已全部在 `packages/`，**UI 才是唯一真正的重复**（实测 12,277 行 vs 3,661 行）→ 收敛的目标是 UI 层；
3. 桌面三平台里 **Linux 在 RN 侧没有官方目标**（既有调研实测 404）→ RN 全家桶包不住桌面。

---

## 2. 本仓库实测事实（本次重新测量，非引用旧结论）

### 2.1 UI 层是唯一的重复，而且量级不对称

| 路径 | 文件数 | 行数 |
|---|---|---|
| `apps/web/src` | 59 | **13,814** |
| `apps/web/src/features` | — | **12,277** |
| `apps/mobile/src` | 38 | **7,927** |
| `apps/mobile/src/screens` | — | **3,661** |
| `packages/app-host/src` | 18 | 4,592 |
| `packages/domain/src` | 23 | 6,535 |
| `packages/design-system/src` | 9 | 2,593 |

**读法**：业务逻辑层（`domain` + `app-host` = 11,127 行）**没有重复**——这是 ADR-0003 §2.1 的成果。
重复全在 UI：web 的 feature 目录 12,277 行 vs mobile 的 screen 目录 3,661 行。

### 2.2 🔴 移动端缺的不是"少写了一点"，是一整批特性

按功能配对后（左侧 web feature，右侧 mobile screen）：

| web feature | 行数 | mobile 对应 | 行数 |
|---|---|---|---|
| `ai` | **3,207** | — | **无** |
| `settings` | **1,978** | `ProfileScreen` | 386 |
| `timeline` | **1,483** | — | **无** |
| `motivation` | **1,090** | — | **无** |
| `sync` | 978 | `ConflictSheet` | 279 |
| `tasks` | 585 | `TasksScreen` + `TaskDetailSheet` | 1,326 |
| `habits` | **577** | — | **无** |
| `focus` | 536 | `FocusScreen` | 427 |
| `categories` | 431 | `CategoriesScreen` | 365 |
| `projects` | **341** | — | **无** |
| `quadrant` | **317** | — | **无** |
| `capture` | 277 | — | **无** |
| `shell` | 243 | — | — |
| `subscription` | **234** | — | **无** |

**加粗 = 移动端完全没有对应实现，合计 8,227 行（占 web feature 的 67%）。**

**分析（这条是整份文档最重要的经济学论据）**：
现在的状态不是"两边各写一半"，而是**每个特性要么写两遍，要么在移动端缺席**。
收敛到一套代码**不是额外成本，而是把"迟早要再写一遍"的那 8,227 行变成只写一次**。
换句话说：**不收敛才是更贵的那条路。**

### 2.3 一处被注释承认、但只有一半护栏的重复

`apps/web/src/lib/category-colors.ts`（69 行）与 `apps/mobile/src/lib/category-colors.ts`（64 行）
**同名、不同内容**（`cmp` 实测不同）。mobile 那份的文件头注释写着它必须与
`packages/design-system` 的 `CATEGORY_SLOT_TOKENS` **逐项一致**，并提到
`packages/design-system/tests/category-colors.spec.ts` 的实测数字。

**分析**：这是"用注释当护栏"的典型 —— 注释不会在漂移时失败。设计令牌的**取值**已经在
`design-system` 里单点定义（见 §2.4），但**两个外壳各有一份派生映射**。

### 2.4 RN 侧的设计令牌管线**已经存在**（不是待建）

- `packages/design-system` 的 `exports` 已含 `./native`（`types` / `import` / `require` 三路）。
- 产物 `packages/design-system/generated/` 下已有 `tokens.json`、`HeytaTokens.swift`、`HeytaTokens.ets`。
- `apps/mobile/src/theme.tsx` 已消费 `@heyta/design-system/native`（导入 `HeytaNativeTokens`、`TextStyleName`）。

**结论**：RN 路线**不新增设计系统债务**。这一点 ADR-0004 §3.2 已声称，本次**独立复核成立**。

### 2.5 存储层是"窄接口 + 跨引擎契约测试"，这是本仓库最大的结构性资产

`packages/storage/src/` 实测有三个引擎实现与一个驱动缝：

```
memory/memory-adapter.ts
indexeddb/indexeddb-adapter.ts
sqlite/sqlite-adapter.ts          ← 适配器逻辑只有一份
sqlite/sqlite-driver.ts           ← 驱动接口（可替换）
sqlite/node-sqlite-driver.ts      ← Node 宿主实现（node:sqlite）
tests/contract.spec.ts            ← 同一套契约跑遍所有实现
```

`sqlite-driver.ts` 的接口**全文只有 4 个同步方法**（外加一个可选方法）：

```ts
interface SqliteDriver {
  exec(sql: string): void;
  run(sql: string, params?: readonly SqlValue[]): void;
  all<T>(sql: string, params?: readonly SqlValue[]): T[];
  close(): void;
  isUniqueViolation?(error: unknown): boolean;   // 可选
}
```

文件头注释明确写了**为什么必须同步**：

> 同步是有意的 —— 原生桥（JSI / NAPI）通常就是同步调用，而 `DbAdapter` 的并发契约
> 由适配器内部的 FIFO 队列负责，不依赖驱动。

**分析**：这条约束是本仓库自己写的、有理由的，**不是可以随手改的实现细节**。
它把"桌面端能不能复用存储"变成一道**硬筛子**（见 §4.3）。

### 2.6 服务端已在 PostgreSQL 上

`server/prisma/schema.prisma` 实测：`provider = "postgresql"`，连接走 `env("DATABASE_URL")`。
**服务端数据源已经是 Postgres，无需迁移。**

### 2.7 门禁已经具备"把教训变成机器判据"的机制

`package.json` 的 `check` 串联 17 道门禁。其中与本次直接相关的：

| 门禁 | 作用 | 对本次的意义 |
|---|---|---|
| `check:layering` | `apps/*` 不得重新长出业务逻辑（4–6 条具体形状，全部来自真实漂移） | 新增端时**直接复用**，无需新写 |
| `check:design` | 禁止硬编码设计值，**已扫 `apps/web/src` + `apps/mobile/src` + `apps/landing/src`** | 新增桌面端要**加进这个列表** |
| `check:tokens` | 生成物与源一致 | 令牌管线变更时自动兜底 |
| `check:licenses` | 未登记的依赖不得引入 | **引入 Electron 之前必须先登记** |
| `check:native-deps` | 原生依赖管控 | 新增原生模块的闸门 |

**分析**：本仓库的文化是"每条踩过的坑变成一条会在下次失败的门禁"（`check-layering.mjs` 的
文件头逐条列出了 6 个真实漂移事故）。**因此本规划必须包含门禁，而不只是代码** ——
否则收敛会以"注释约定"的形式存在，而 §2.3 已经证明注释挡不住漂移。

---

## 3. 外部事实（一手来源，全部标注取得方式与日期）

### 3.1 候选框架的仓库元数据（`research/tools/ghinfo.py`，2026-09-27 执行）

| 仓库 | ★ | 许可证 | 最后提交 | 最新 release |
|---|---|---|---|---|
| `necolas/react-native-web` | 22,137 | **MIT** | 2026-09-25T14:49Z | **0.21.3 @ 2026-09-25** |
| `microsoft/react-native-windows` | 17,347 | **NOASSERTION (Other)** ⚠️ | 2026-09-26T17:53Z | 0.85.0-preview.2（`0.85-stable`） |
| `microsoft/react-native-macos` | 4,386 | MIT | 2026-09-01T16:19Z | **v0.81.9 @ 2026-07-13** |
| `tauri-apps/tauri` | 111,423 | Apache-2.0 | 2026-09-26T16:07Z | `v3.0.0-alpha.3` @ 2026-09-26 |
| `electron/electron` | 123,287 | **MIT** | 2026-09-27T07:50Z | v46.0.0-nightly |
| `tamagui/tamagui` | 14,206 | **MIT** | 2026-09-24 | v2.7.7 |
| `nativewind/nativewind` | 8,103 | MIT | 2026-09-15 | — |
| `expo/expo` | 52,456 | MIT | 2026-09-26 | — |
| `OP-Engineering/op-sqlite` | 1,044 | MIT | 2026-09-20 | 18.2.5 |
| `react-navigation/react-navigation` | 24,507 | （抓取失败，NA） | 2026-09-22 | — |

⚠️ 两点必须如实标注：
- `react-native-windows` 的许可证被 GitHub 判为 **NOASSERTION (Other)**，**不是 MIT**。
  `react-native-macos` 才是 MIT。**引入 RNW 前必须人工读 LICENSE 文件**（本仓库 `check:licenses` 会拦）。
- `react-navigation` 的许可证本次**未抓到**，不得当作已核实。

### 3.2 npm 侧（`registry.npmjs.org/<pkg>/latest`，2026-09-27 执行）

| 包 | 版本 | `license` 字段 | `peerDependencies` |
|---|---|---|---|
| `react-native-web` | **0.21.3** | MIT | `react@^18.0.0 \|\| ^19.0.0`, `react-dom@^18.0.0 \|\| ^19.0.0` |
| `tamagui` | 2.7.7 | **`null`** ⚠️ | `react@>=19` |
| `nativewind` | 4.2.7 | MIT | `tailwindcss@>3.3.0` |
| `@shopify/restyle` | 2.4.5 | MIT | `react@*`, `react-native@*` |
| `@sqlite.org/sqlite-wasm` | **3.53.4-build1** | **Apache-2.0** | — |
| `@tauri-apps/api` | **2.12.0** | Apache-2.0 OR MIT | — |
| `@tauri-apps/cli` | **2.12.0** | Apache-2.0 OR MIT | — |

**三条关键读法**：

1. **`react-native-web` 0.21.3 的 peer 是 React 19 兼容的**（`|| ^19.0.0`），
   与 `apps/web` 的 `react@^19.2.0` **不冲突**。而且它**不对 `react-native` 声明 peer**
   ——它是独立实现，不绑定 RN 版本。这是"Web 端可以吃 RN 组件"的前提，本次**已核实**。
2. **`tamagui` 的 npm `license` 字段是 `null`**，而其仓库 LICENSE 是 MIT（ghinfo）。
   两种可能：打包遗漏，或最近改过。**这是一个"文件说 MIT、包元数据说不知道"的缺口**，
   与本仓库 `packages/storage` 曾经"注释说有 `@types/node`、实际没有"是同一类问题（§2.3 同类）。
   **引入前必须人工确认**，不能只看其中一边。
3. **Tauri 的生产线是 v2.12.0，不是 v3** —— 仓库最新 tag 是 `v3.0.0-alpha.3`（alpha），
   而 npm 上 `@tauri-apps/api` 与 `cli` 的 `latest` 都是 **2.12.0**。
   任何"用 Tauri"的方案都应锁 v2。

### 3.3 🔴 决定性事实一：Tauri **没有**同步 IPC

来源：Tauri v2 官方文档 `https://v2.tauri.app/develop/calling-rust/`（2026-09-27 抓取）。

文档里 `invoke` 的绑定签名原文就是 `async`：

```rust
#[wasm_bindgen(js_namespace = ["window", "__TAURI__", "core"])]
async fn invoke(cmd: &str, args: JsValue) -> JsValue;
```

文档正文另有两处：

> Commands can accept arguments and return values. They can also return errors and **be async**.

> **Asynchronous commands are preferred in Tauri** to perform heavy work in a manner that
> doesn't result in UI freezes or slowdown.

**分析**：Tauri 的前端↔后端通道**只有 Promise 形态**。把它套到 §2.5 那个
**同步**的 `SqliteDriver` 上，只有三种出路，每一种都要动"不可逆层"：

| 出路 | 代价 |
|---|---|
| 把 `SqliteDriver` 改成异步 | 波及 `SqliteAdapter`、`DbAdapter` 的并发契约、op-log 写入路径；ADR-0003 把存储列为**不可逆层** |
| 用 `SharedArrayBuffer` + `Atomics.wait` 自造同步桥 | 需要 COOP/COEP 响应头；WebView 内行为未实测；属于自研基础设施 |
| 在 Tauri 侧跑一个 Node sidecar，走本地 HTTP | 依然是异步；还多一个进程与一个端口 |

**这条不是"Tauri 不好"，而是"Tauri 与 heyta 已有的一个明确设计选择不兼容"。**

### 3.4 🔴 决定性事实二：Electron **有**同步 IPC，且自带 Node 24

**同步 IPC** —— 来源 `https://www.electronjs.org/docs/latest/api/ipc-renderer`（2026-09-27 抓取）：

> `ipcRenderer.sendSync(channel, ...args)` … Returns `any` - The value sent back by the
> `ipcMain` handler. Send a message to the main process via channel and **expect a result
> synchronously**.

同一页有一条必须记住的约束：

> **>=29.0.0** `ipcRenderer` can no longer be sent over the `contextBridge`

**分析**：`sendSync` 从 v29 起不能在 `contextBridge` 里**直接暴露**，标准做法是在 preload 里
**包一层自定义函数**再暴露。这是一个已知、有文档的接线模式，不是拦路石。

**自带 Node** —— 来源 `https://releases.electronjs.org/releases.json`（2026-09-27 抓取，本地过滤）：

| Electron 稳定版 | 打包的 Node | Chromium | 日期 |
|---|---|---|---|
| **44.4.5** | **24.21.0** | 152.0.7977.130 | 2026-09-23 |
| 43.7.5 | 24.21.0 | 150.0.7871.250 | 2026-09-23 |
| 42.11.8 | 24.19.0 | 148.0.7778.280 | 2026-09-23 |
| 41.10.7 | 24.18.0 | 146.0.7680.216 | 2026-08-24 |

### 3.5 `node:sqlite` 的可用性与成熟度

来源：`https://nodejs.org/api/sqlite.html`（2026-09-27 抓取）。文档头部的版本历史原文：

| 版本 | 变化 |
|---|---|
| v22.5.0 | 引入 `node:sqlite` |
| v23.4.0, v22.13.0 | **不再需要 `--experimental-sqlite`**，但仍标记 experimental |
| **v25.7.0** | **SQLite is now a release candidate** |

`DatabaseSync` 的类文档原文：**"All APIs exposed by this class execute synchronously."**

**分析（这三条拼起来就是结论）**：
Electron 稳定版 44.4.5 打包 **Node 24.21.0** ≥ 23.4.0，**所以 `node:sqlite` 无需任何标志**；
它的 `DatabaseSync` **全同步**，与 §2.5 的 `SqliteDriver` **形状完全吻合**；
而本仓库**已经写好并跑通了 `NodeSqliteDriver`**（`apps/node-host/src/host.ts` 真实使用，
`packages/storage/tests/contract.spec.ts` 用跨引擎契约覆盖）。

**也就是说：桌面端的存储引擎，本仓库已经有一个通过契约测试的实现，不需要新写。**

### 3.6 既有调研中的相关事实（本仓库 `research/`，本次复核仍在）

- **RN 没有官方 Linux 桌面目标**：`microsoft/react-native-linux` 返回 HTTP 404；
  社区 `lucid-softworks/react-native-linux` 仅 32★、无 release
  （`research/deep-dive-cross-language-and-components.md` §实测）。
- `react-native-macos` 此前实测落后主干约 7 个小版本；本次实测其**最新 release 仍是
  v0.81.9（2026-07-13）**，而 RN 主干已是 0.84.1 → **落后仍在**（§3.1）。
- Tauri 许可证为 `Apache-2.0 OR MIT` 双许可；v2.0 stable 发布于 2024-10-02。
- 上游 **Super Productivity** 用 Angular + Capacitor + Electron 覆盖六平台，
  是"JS 栈一套代码打满多端"的既有生产级先例（同域产品）。

### 3.7 AI 数据库：本仓库**已有**实测结论，不需要重新调研

`research/ai-memory-db-2026-09.md`（2026-09-26）的核心结论与实测数字：

- **heyta 不需要向量数据库**。记忆需求（推迟习惯、专注落差、接触频率）本质是
  **聚合计数**（`GROUP BY` / `COUNT` / `SUM`），不是最近邻检索；只有"语义检索"才需要向量，
  而它不在已声明的记忆目标里。
- 本机实测单线程纯 JS 暴力余弦扫描：**10,000 × 384 维 = 2.6 ms**，100,000 × 384 = 28.2 ms。
  个人任务管理器在 10³–10⁴ 量级 → **ANN 索引解决的是本产品不存在的规模问题**。
- **真正的瓶颈是嵌入模型**：远程嵌入 = 新的明文出境面（撞 ADR-0005/0006）；本地嵌入走 WASM
  在 **Hermes 上直接死**。
- **`op-sqlite` 已内置 FTS5 与 sqlite-vec（原生，非 WASM）** —— 该调研称这是"本次最有价值的单点发现"。
- 🔴 **该调研同时判定：「三端一套 SQL」这个前提不成立**，因为浏览器端是 IndexedDB，**没有 SQL**。
  因此任何基于 SQL 的检索（FTS5）在 heyta 里**天然只有 2/3 端可复用**。

**这条对整个多端规划的影响被低估了**：它说明 `apps/web` 的 IndexedDB **不只是"另一种存储实现"**，
而是**让"一套存储契约"这件事在检索能力上破功的那一端**。见 §5.3。

---

## 4. 融合：逐条对比

### 4.1 UI 收敛方案对比

| 方案 | 代码量 | 与现有 RN 移动端 | 与现有 Web | 风险 |
|---|---|---|---|---|
| **A. 保持双 UI**（现状） | 最大（每特性 ×2 或移动端缺席） | 不动 | 不动 | 最低，但**成本持续累加**（§2.2 的 8,227 行迟早要再写） |
| **B. 收敛到 RN + react-native-web** | 最小（UI 一份） | **直接成为主体** | **需要把 DOM/CSS 重写为 RN 原语** | 中高（一次性迁移，但可增量） |
| **C. 收敛到 Web + WebView 套壳** | 小 | 废弃 | 保留 | **已被 ADR-0004 §2 否决**（iOS 会清 WebView IndexedDB） |
| **D. 各端原生（SwiftUI/ArkUI/…）** | 最大 | 废弃 | 废弃 | 已被 ADR-0004 否决 |

**融合结论：选 B。** 理由是 §2.2 的经济学 —— 移动端已经缺 8,227 行的特性，
**这笔代码无论如何都要写，区别只在于写一遍还是两遍**。

### 4.2 桌面壳对比

| 判据 | **Electron** | Tauri v2 | react-native-windows/macos |
|---|---|---|---|
| 覆盖平台 | Win + macOS + **Linux** ✅ | Win + macOS + **Linux** ✅ | Win + macOS，**Linux 无官方目标** ❌ |
| 与本仓库同步 `SqliteDriver` 兼容 | ✅ **有同步 IPC**（`sendSync`）+ 自带 Node | ❌ **只有异步 IPC** | 需新写原生驱动 |
| 存储实现的现成度 | ✅ **`NodeSqliteDriver` 已有且通过契约测试** | ❌ 需新写（异步驱动） | ❌ 需新写（Windows 侧原生 SQLite） |
| 版本对齐 | 不涉及 RN 版本 | 不涉及 RN 版本 | macos 最新 v0.81.9 vs RN 0.84.1（**落后**） |
| 许可证 | **MIT** ✅ | Apache-2.0 OR MIT ✅ | RNW = **NOASSERTION** ⚠️ / macos = MIT |
| 体积 / 内存 | 大（Chromium + Node） | **小** | 中 |
| 与 Web 前端产物 | ✅ **同一个 bundle 直接装** | ✅ 同一 bundle | ❌ 另一套构建 |

**融合结论：选 Electron。** 决定性的是前三行：
**heyta 的存储接口是同步的，Electron 有同步 IPC 与现成的 Node SQLite 驱动，Tauri 两者都没有。**
体积是 Electron 的真实代价，必须承认；但它换来的是**存储层零新代码**，
而存储是 ADR-0003 标注的**不可逆层**。

> ⚠️ **未核实**：`node:sqlite` 在 Electron **渲染进程**里是否可直接用（取决于 Electron 对
> Node 内置模块的暴露策略）。因此规划里把它列为**必须实测的 spike**，
> 并准备了不依赖它的退路（`sendSync` + 主进程持库）。**在实测之前不得当作已成立。**

### 4.3 样式方案对比（若走 B）

| 方案 | 许可证 | 与"已生成的 tokens"关系 | 风险 |
|---|---|---|---|
| **RN `StyleSheet` + `@heyta/design-system/native`** | 自有 | ✅ **直接消费已生成的 token**，无第二个真源 | 无新增依赖 |
| NativeWind 4.2.7 | MIT | 需要 tailwind 配置，可能与 token 生成物**形成第二个真源** | 新增构建层 |
| Tamagui 2.7.7 | 仓库 MIT / **npm 字段 `null`** ⚠️ | 自带主题系统，**是竞争性的真源** | 需人工核许可证；主题模型与现有生成器重叠 |
| @shopify/restyle 2.4.5 | MIT | 主题对象可喂入生成物 | 新增依赖，收益待评估 |

**融合结论：先用 `StyleSheet` + 已有的 `@heyta/design-system/native`。**
理由是本仓库的硬规则「设计变量的值只在 `tokens.css` 定义，其余平台**生成**」（AGENTS.md §5）——
引入一个自带主题配置的库，等于**制造第二个真源**，这与 §2.3 那类漂移同源。
**样式库是可以后置的决定**，而"第二个真源"一旦引入就很难拆掉。

---

## 5. 融合后的目标架构

### 5.1 一张图

```
                       ┌──────────────────────────────────────┐
                       │   UI 唯一实现：React Native 组件     │
                       │   （新建 packages/ui，消费 tokens）  │
                       └──────────────────────────────────────┘
                                        │
        ┌───────────────┬───────────────┼───────────────┬───────────────┐
        ▼               ▼               ▼               ▼               ▼
   iOS / Android    HarmonyOS        Web          Win/macOS/Linux
   RN 原生          RNOH        react-native-web    react-native-web
   (op-sqlite)   (ArkTS 绑定)   → 浏览器/静态托管    → Electron 壳
        │               │               │               │
        └───────────────┴───────────────┴───────────────┘
                        业务逻辑层（已存在，零重复）
        packages/domain · app-host · storage · sync-core · sync-client
                 op-log · ai · local-api · shared-schema
                                        │
                              存储：SQLite（见 §5.3）
```

### 5.2 与既有决策的关系

| 既有决策 | 本次是否改变 |
|---|---|
| ADR-0003（逻辑在 `packages/`，apps 只做壳） | **不变**，且是收敛能成立的前提 |
| ADR-0004（UI 栈 = React Native） | **不变**，本方案是它的**落地路径**；但明确了"桌面用 Electron 承载 RNW 产物" |
| ADR-0003 §3.2（否决 WebView 套壳） | **不变**，且**不冲突** —— Electron 承载的是我们自己打包的静态产物，存储走原生 SQLite 而非 IndexedDB |
| 服务端 = PostgreSQL | **不变**（§2.6 已核实） |

### 5.3 数据层：一条被忽视的主线

**现状**：服务端 Postgres ✅；移动端 op-sqlite ✅；Node 宿主 `node:sqlite` ✅；**Web = IndexedDB ⚠️**。

**为什么这是问题**（来自 §3.7 的既有实测）：
浏览器端没有 SQL → **FTS5 检索在 web 上永远用不了** → AI 记忆检索**只有 2/3 端可复用**。

**可选出路**：web 改用 **`@sqlite.org/sqlite-wasm`**（实测 **3.53.4-build1，Apache-2.0**）+ OPFS。

关键区分（容易搞混，必须写明）：

> **不能用 WASM 的是 Hermes（移动端）**，而移动端本来就有**原生** SQLite（且 op-sqlite 已带 FTS5）。
> **浏览器是能吃 WASM 的。** 所以"web 换 sqlite-wasm"**不触碰**移动端的约束。

**收益**：三端真正统一到一套 SQL 方言；FTS5 在 web 可用；AI 记忆检索三端一致；
桌面端与 web/mobile 共用同一套存储契约测试。

**代价（必须承认）**：WASM 产物体积；OPFS 的浏览器兼容面；web 端要新增一个
`SqliteWasmDriver`（仍是一个窄接口实现，契约测试已有）。**是否做，留给 ADR 决定，不在本调研里拍板。**

### 5.4 一条必须写下的例外：系统小组件不纳入 UI 收敛

「UI 只写一份」**在应用内成立，在小组件上不成立**。小组件必须由**平台自己的载体**绘制
（WidgetKit / RemoteViews / ArkTS / Adaptive Card），任何框架都不能让它可移植。

**这条有本仓库内的一手证据**：上游 Super Productivity 真的把同一款任务组件
在 Android 与 iOS **各实现了一遍**，两边**被共享的只有 `v: 1` 的 JSON 契约** ——
视图、渲染、点击回写、后台触发每一栏都是两端各写一遍。

真正要写的是 **3 份原生组件（Swift / Kotlin / ArkTS）+ 1 个 JSON 模板**，不是 5 份。

🔴 **还有一条"看起来能收敛"的陷阱路必须主动堵死**：`react-native-android-widget` 的模型是
**headless JS**（后台 JS 上下文里 `renderWidget`），它能让组件"用 RN 组件写"，
代价是**把 RN 组件树连同应用 JS 拖进一个后台进程** ——
恰好摧毁"单写者快照 + 意图队列"这套契约存在的理由。**即使它可用也不该用。**

> 完整论证（含 §10 与本调研的对账）见
> [多端选型：小组件视角的证据](multi-platform-selection-evidence.md) §1、§10.1。
> 那份文档与本文是**互补**关系：它从**小组件**视角审选型，本文从**UI 收敛**视角审选型。

---

## 6. 未核实项与信心分级

### 6.1 信心分级

| 级别 | 内容 |
|---|---|
| 🟢 **实测**（本机命令 / 官方文档原文） | §2.1–§2.7 全部行数与接口；§3.1–§3.5 的版本号、许可证、日期；Tauri `invoke` 为 async；Electron `sendSync` 同步；`node:sqlite` 的版本历史与同步性；Electron 44.4.5 打包 Node 24.21.0 |
| 🟡 **分析**（有依据的推断） | §4.2 选 Electron 的推理；§2.2 的经济学论据；§5.3 的收益推演 |
| 🔴 **未核实**（不得当结论用） | 见下 |

### 6.2 🔴 未核实项，逐条列出

1. **没有联网搜索**（§0.1）→ 候选清单**不完整**，可能漏掉我没想到的方案；
   也**没有**社区踩坑帖与团队复盘的一手证据。所有"别人做得怎么样"的判断都缺这一层。
2. **`node:sqlite` 在 Electron 渲染进程的可用性** —— 未实测。退路（`sendSync` + 主进程）已备。
3. **react-native-web 0.21.3 与 RN 0.84.1 的实际兼容性** —— peer 字段不约束 RN，
   但"不声明 peer"不等于"已适配 0.84 的 API 面"。**必须用一个垂直切片实测。**
4. **`react-native-windows` 的许可证** —— GitHub 判为 NOASSERTION，**未读 LICENSE 原文**。
5. **`react-navigation` 的许可证** —— 抓取失败，**未核实**。
6. **`tamagui` 的许可证** —— npm 字段 `null` 与仓库 MIT 冲突，**未读包内 LICENSE**。
7. **Electron 在 macOS/Linux 的**公证（notarization）与签名成本 —— 本次完全没查。
8. **既有 13,814 行 web UI 的迁移工作量** —— 只有 LOC 统计，**没有**逐特性的人工估算。
9. **`@sqlite.org/sqlite-wasm` 的 OPFS 在 Safari/Firefox 的实际行为** —— 未查。
10. **桌面端自动更新、深链、托盘** —— 未调研。

---

## 7. 对本项目的直接含义

1. **先做共享层，不先做新端。** §2.2 证明移动端缺 8,227 行特性。
   把这些特性抽成"与渲染无关的展示逻辑 + RN 组件"，**是任何路线都要付的成本**，
   且立刻减少重复 —— 即使后面推翻桌面选型也不浪费。
2. **桌面选 Electron，但把它当作"消费 web 产物"的壳。** 它的价值是**存储层零新代码**
   （§3.5），而不是"又一个运行环境"。
3. **必须先用一个垂直切片证明 RNW 可行**（未核实项 3）。
   切片选**任务列表**：web 与 mobile **两端都有实现**，是最干净的对照实验。
4. **不要引入样式库**（§4.3）。先吃已有的 `@heyta/design-system/native`，
   避免制造第二个设计真源 —— 这与 §2.3 的漂移是同一类风险。
5. **数据层要独立成一条线**（§5.3）。web 的 IndexedDB 是"一套存储契约"破功的那一端，
   它同时卡住 AI 记忆的三端一致性。
6. **每一条收敛都要配一道门禁**（§2.7）。注释挡不住漂移，这个仓库已经用 6 次事故证明过了。

---

## 附：本次所有一手来源

| 来源 | 用途 |
|---|---|
| `research/tools/ghinfo.py`（本仓库） | §3.1 全部仓库元数据 |
| `https://registry.npmjs.org/<pkg>/latest` | §3.2 版本 / 许可证字段 / peer |
| `https://v2.tauri.app/develop/calling-rust/` | §3.3 Tauri `invoke` 为 async |
| `https://www.electronjs.org/docs/latest/api/ipc-renderer` | §3.4 `sendSync` 同步 |
| `https://releases.electronjs.org/releases.json` | §3.4 Electron ↔ Node 版本对应 |
| `https://nodejs.org/api/sqlite.html` | §3.5 `node:sqlite` 版本历史与同步性 |
| `research/ai-memory-db-2026-09.md`（本仓库） | §3.7 AI 数据库结论与实测数字 |
| `research/deep-dive-cross-language-and-components.md`（本仓库） | §3.6 RN 无 Linux 目标等 |
