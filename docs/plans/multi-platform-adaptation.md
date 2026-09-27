# 多端适配实施计划：一套代码、多端复用

> 状态：**规划中**
> 依据：[多端「一套代码」融合调研](../research/multi-platform-ui-fusion.md) ·
> 选型：[ADR-0024](../adr/0024-desktop-shell-and-ui-convergence.md)（⚠️ **待确认**）
> 关系：本计划是 [P2 多端补齐](phase-2-multi-platform.md) 的**主体执行计划**，
> 不是 P3（平台特有能力）。P3 依赖本计划产出的"一套 UI"。

---

## 0. 这份计划在回答什么

**「一套代码」怎么从今天的状态走到最终实现，每一步都可验证。**

三条实测事实决定了整个计划的形状（全部来自调研 §2，2026-09-27 重新测量）：

| 事实 | 数字 | 对计划的影响 |
|---|---|---|
| 业务逻辑**已经零重复** | `domain` 6,535 行 + `app-host` 4,592 行，各端共用 | 收敛的目标**只有 UI 层**，不碰逻辑 |
| UI 是唯一重复 | web `features` **12,277 行** vs mobile `screens` **3,661 行** | 主体工作量在这里 |
| 移动端缺 67% 的特性 | web 有而 mobile **完全没有**的合计 **8,227 行** | **这笔代码迟早要写**，收敛是把"写两遍"变成"写一遍" |

**因此本计划的最高优先级不是"加新端"，而是"停止写两遍"。**

---

## 1. 阶段总览

| 阶段 | 目标 | 交付判据（可验证） | 前置 |
|---|---|---|---|
| **M0** | 共享展示层补完 | 同一 helper 在 `apps/` 下只剩一处；门禁拦住回潮 | 无（**立刻可做**） |
| **M1** | 🔴 垂直切片验证 | **一份** RN 组件在 web + mobile + 桌面三端都渲染出来 | M0 |
| **M2** | 桌面端骨架（Electron） | 桌面端跑通真实同步，煞有记录 | M1 |
| **M3** | 逐特性迁移 UI | 每个特性两端共用同一组件；旧 DOM 实现删除 | M2 |
| **M4** | 数据层统一（web SQLite） | 三端共用一套存储契约测试；FTS5 在 web 可用 | M0（可与 M3 并行） |
| **M5** | 收敛收尾 + 门禁全端 | DOM UI 删除；门禁覆盖全端；文档固化 | M3、M4 |
| **M6** | 鸿蒙"跑起来" | 真机/模拟器启动成功 | 外部（模拟器镜像 + 签名） |

🔴 **M1 是成败点。** 它失败则 ADR-0024 需要重估（可能退化为"RN 覆盖移动端 + 桌面用 Web 壳"）。
**在 M1 通过之前，M3 不得大规模投入。**

---

## M0：共享展示层补完

### 目标

把 web 与 mobile **重复的、与渲染无关的**展示逻辑收进 `packages/`。
这一步**任何路线都要付**，即使后面推翻 ADR-0024 也不浪费。

### 判据

1. `apps/web/src/lib/` 与 `apps/mobile/src/lib/` 的**同名文件归零**（当前有 `category-colors.ts` 一处）。
2. 新增的展示逻辑有**单测**，且测试只写一份。
3. `check:layering` 新增一条规则：`apps/*` 不得再自定义类别颜色映射。

### 任务

**M0-1 收敛 `category-colors.ts`（当前唯一同名重复）**

现状实测：`apps/web/src/lib/category-colors.ts` 69 行、`apps/mobile/src/lib/category-colors.ts` 64 行，
`cmp` 实测**内容不同**。mobile 那份的文件头注释要求它与
`packages/design-system` 的 `CATEGORY_SLOT_TOKENS` **逐项一致** —— 靠注释护栏。

- 读：`packages/design-system/src/` 中 `CATEGORY_SLOT_TOKENS` 的定义与
  `packages/design-system/tests/category-colors.spec.ts` 的断言
- 建：把派生映射移进 `packages/design-system`（它已经是类别色的单点）
- 改：两个 `apps/*/lib/category-colors.ts` 变为**薄再导出**，或直接删除并改调用点
- 验：`pnpm --filter @heyta/design-system test` + `pnpm check:design`

**M0-2 清点其余 mobile `lib/` 的归属**

mobile 侧现有：`category-display.ts`、`date.ts`、`due-display.ts`、`focus-display.ts`、
`focus-timer.ts`、`priority.ts`、`quick-dates.ts`、`recurrence-display.ts`、`use-today.ts`。

逐个判定三分类，**产出一张表写回本文件 §5**：

| 判定 | 处理 |
|---|---|
| 纯展示逻辑（无框架、无 DOM/RN API） | 移入 `packages/`，两端共用 |
| 依赖 `Intl` / 时区等平台差异 | 留外壳，但**契约进 packages** |
| 依赖 RN API（如 `use-today` 依赖 AppState） | 留外壳，标注为"平台 hook" |

**M0-3 补一条分层门禁**

- 改：`scripts/check-layering.mjs` 的 `RULES` 数组
- 参照文件头已有的 6 条规则写法（每条都对应一次真实漂移事故）
- 新规则：`apps/*` 中不得出现类别槽位到颜色/图标的映射字面量
- 验：故意在 `apps/web` 里加一处违规，确认门禁**退出码非零**（门禁必须能被证伪）

### 回退

M0 全部是**纯搬迁 + 再导出**，无行为改变。任一任务出问题可单独回退，互不依赖。

---

## M1：🔴 垂直切片验证（决定成败）

### 目标

用**一个真实特性**证明「一份 RN 组件，三端渲染」在 heyta 的版本组合下真的成立。

**切片选「任务列表」** —— web（`features/tasks`，585 行）与 mobile（`TasksScreen.tsx`，764 行）
**两端都有实现**，是最干净的对照实验。

### 要验证的四个未核实项（调研 §6.2 的 1/2/3）

| # | 问题 | 判据 |
|---|---|---|
| 1 | `react-native-web` 0.21.3 与 **RN 0.84.1 + React 19** 能否共存 | web 端构建通过且渲染出组件 |
| 2 | Metro / Vite 能否解析同一个 workspace 包 | 两端 import 同一个包名成功 |
| 3 | **`react-native` 实例不被复制两份** | 复用仓库已有门禁 `check:mobile-bundle`（`phase-2` §2.23 已因双 React 崩过一次） |
| 4 | 桌面端能否加载同一个 web 产物 | Electron 里渲染出同一组件 |

> 🔴 **第 3 条是本仓库的已知雷区**：`@heyta/i18n` 自带的 React 曾在 APK 里被打成**第二份**，
> 应用启动即崩 —— 这一条已经踩过，见 `phase-2-multi-platform.md` §2.23
> 新增 workspace 包**必须**跑 `check:mobile-bundle`。

### 任务

**M1-1 建 `packages/ui`**

- 建：`packages/ui/package.json`（`name: "@heyta/ui"`，`private`，`type: module`）
- 依赖：`react`、`react-native`（**peer，不锁死版本**）、`@heyta/design-system`、`@heyta/domain`
- **不要**在这一步引入任何样式库（ADR-0024 §2.4）
- 参照 `packages/app-host/package.json` 的 tsup 构建配置

**M1-2 实现 `TaskList` 组件**

- 建：`packages/ui/src/task-list/TaskList.tsx`
- 只用 RN 原语：`View` / `Text` / `Pressable` / `FlatList` / `StyleSheet`
- 样式值**全部**来自 `@heyta/design-system/native`，禁止字面量（`check:design` 会拦）
- 数据来自 `@heyta/app-host` 的既有 action，**不新增业务逻辑**（`check:layering` 会拦）

**M1-3 Web 端接入**

- 改：`apps/web/package.json` 加 `react-native-web@0.21.3`（**先登记许可证**，见 §4）
- 改：`apps/web/vite.config.ts` 加 `resolve.alias` 把 `react-native` 指向 `react-native-web`
- 验：`pnpm --filter @heyta/web build` 通过

**M1-4 Mobile 端接入**

- 改：`apps/mobile` 用 `@heyta/ui` 的 `TaskList` 替换 `TasksScreen` 里的列表渲染
- 验：`pnpm --filter @heyta/mobile run build:android:debug` 出包

**M1-5 三端验证（本阶段的判据）**

- 建：`scripts/verify-universal-slice.sh`，一条命令跑完并输出判据
- 必须记录**实测输出**，不能只报"通过"

### 验收命令

```bash
pnpm install --frozen-lockfile        # 锁文件一致
pnpm -r typecheck
pnpm check:licenses                   # 新依赖已登记
pnpm check:design                     # 无硬编码设计值
pnpm check:layering                   # 无业务逻辑进 apps
pnpm check:mobile-bundle              # 🔴 无第二份 React
pnpm check
```

### 回退

M1 是**独立分支上的实验**。若 `react-native-web` 与 RN 0.84.1 不兼容，
结论写回 ADR-0024（状态改「已废弃」或「已取代」），回到"双 UI + 桌面 Web 壳"的方案 B'。

---

## M2：桌面端骨架（Electron）

### 目标

Windows / macOS / Linux 三平台各出一个能跑起真实同步的桌面应用，
**存储复用已有实现，不新写引擎**。

### 🔴 先做 spike（这是 M2 的门槛，不是可选步骤）

**Spike S1：`node:sqlite` 在 Electron 渲染进程里能用吗？**

- 若**能用** → 渲染进程直接 `new NodeSqliteDriver(path)`，接线最简单
- 若**不能用** → 走退路：主进程持库，preload 用 `ipcRenderer.sendSync`
  包一层自定义函数暴露给渲染进程（Electron **有**同步 IPC，Tauri 没有）
- **无论哪条路都必须实测记录**，因为 ADR-0024 §5 把它列为未核实项

> ⚠️ Electron 官方文档注明：**>=29.0.0 `ipcRenderer` 不能再经 `contextBridge` 直接暴露**，
> 必须在 preload 里包一层。这是已知模式，不是拦路石。

**Spike S2：桌面端 `check:design` 扫描范围**

- 改：`design-system/heyta/check-hardcoded.mjs` 的 `ROOTS` 数组
- 现状已含 `apps/web/src`、`apps/mobile/src`、`apps/landing/src`；**加上桌面壳目录**
- 不加这一条，设计系统在桌面端**形同虚设**

### 任务

**M2-1 依赖登记（🔴 仓库硬规则：未登记不得引入）**

- 改：`research/licenses-inventory.generated.md`（由 `node research/tools/license-inventory.mjs` 生成）
- 登记：`electron`（MIT）、以及 M1 引入的 `react-native-web`（MIT）
- 验：`pnpm check:licenses` 退出 0

**M2-2 建桌面壳工程**

- 建：`apps/desktop/`（`package.json` + `main.ts` + `preload.ts`）
- 主进程加载 `apps/web` 的**静态构建产物**
- 存储按 Spike S1 的结论接线

**M2-3 跑通真实同步（不是 mock）**

- 参照 [本地验证手册](../runbooks/local-server-verification.md) 起真实服务端
- 判据：桌面端写入 → 另一端（web 或 mobile）同步可见
- 必须留证据：截图 / 日志 / 数据库文件路径

**M2-4 桌面端构建与交付文档**

- 改：[构建矩阵](../reference/build-matrix.md) §7 一页速查，加桌面端三行
- 改：`apps/desktop/package.json` 加 `build:win` / `build:mac` / `build:linux`
- ⚠️ **签名与公证未调研**（ADR-0024 §5）—— 本阶段只做到**未签名产包**，
  并像 Android 那样如实标注"可测试、不可分发"

### 回退

Electron 壳与自己打包的静态产物是**松耦合**的：即使 UI 收敛中途停住，
桌面端依然能用现在的 DOM 版 web 产物 —— **桌面端不等 M3**。

### 🔗 与小组件计划的关系：PWA 是另一条不能忽略的路

[多端小组件改造计划](multi-platform-widgets.md) §3.1–§3.2 有两条与本阶段直接相关的结论，
**必须一起读，否则两个计划会各说各话**：

| 平台 | 组件路径 | 要桌面壳吗 |
|---|---|---|
| **Windows** | **PWA widget provider** | 🔴 **不需要** —— 但 PWA 必须能从**公网 endpoint** 安装（PWABuilder 不支持 localhost） |
| **macOS** | **Continuity**（iPhone 组件上 Mac） | 🔴 **不需要** |
| macOS / Windows（**原生**组件，后置） | WidgetKit / Windows App SDK + MSIX | ✅ 要，**这正是本阶段的壳** |

**因此本阶段的定位要说清**：Electron 壳**不是**"Windows/macOS 上有组件"的前提
（那两条靠 PWA 与 Continuity 就够了），而是**"这两个平台上有真正的桌面应用"**的前提 ——
即**原生 SQLite、脱离浏览器窗口、可离线长驻**。

**顺带一个组合效应**：M4 若把 web 换上 SQLite（sqlite-wasm + OPFS），
那么**PWA 也就有了本地 SQLite**，PWA 与 Electron 的差距会缩小到
"是否需要原生文件/托盘/自动更新"。**这个组合效应值得在 M4 的 ADR 里一并考虑**，
但**不要**据此跳过 M2 —— PWA 装不进 MSIX 生态，也拿不到原生 sqlite 的性能。

> 🔴 **这条的完整论证见** `../research/multi-platform-selection-evidence.md` §10.3
> （那份文档已与 ADR-0024 对账，明确指出：Electron 路线下 PWA 化的**价值上升而非下降**，
> 且 `apps/web` 现在**不是** PWA —— 无 manifest、无 service worker、无图标、无插件，已实测）。

---

## M3：逐特性迁移 UI（主体工作量）

### 目标

把 web 的 **12,277 行** DOM/CSS UI **逐特性**迁到 RN 原语，每迁一个，
两端（web + mobile）立刻共用同一份，并**删除旧实现**。

### 迁移顺序（按"移动端是否已有对应"排序）

**第一组：移动端已有对应 → 收益最快、风险最低**

| 顺序 | 特性 | web 行数 | mobile 对照 |
|---|---|---|---|
| 1 | `tasks` | 585 | `TasksScreen` 764 + `TaskDetailSheet` 562 |
| 2 | `focus` | 536 | `FocusScreen` 427 |
| 3 | `categories` | 431 | `CategoriesScreen` 365 |
| 4 | `sync` | 978 | `ConflictSheet` 279 |
| 5 | `settings` | 1,978 | `ProfileScreen` 386 |

**第二组：移动端完全没有 → 迁完即"移动端免费获得 8,227 行特性"**

| 顺序 | 特性 | web 行数 |
|---|---|---|
| 6 | `capture` | 277 |
| 7 | `projects` | 341 |
| 8 | `quadrant` | 317 |
| 9 | `habits` | 577 |
| 10 | `motivation` | 1,090 |
| 11 | `timeline` | 1,483 |
| 12 | `ai` | 3,207 |

### 每轮的固定流程（不许跳步）

1. 在 `packages/ui` 用 RN 原语实现该特性
2. web 端切换过去，**删除对应的 `apps/web/src/features/<name>/` DOM 实现**
3. mobile 端切换过去
4. 把该特性的测试迁到只写一份
5. 跑 `pnpm check`
6. **记录该轮的行数变化**到 §5 的进度表

### 判据（每轮）

- 该特性在 `apps/web` 与 `apps/mobile` 下**不再各有一份实现**
- 两端都能跑（web 构建 + Android debug 出包）
- `pnpm check` 退出 0
- 净行数**下降**（这是本计划的核心指标，必须持续为负）

### 🔴 已知会卡住的地方

| 难点 | 现状 | 需要替代方案 |
|---|---|---|
| 拖拽排序 | `@dnd-kit/*`（DOM 专用） | RN 侧 gesture-handler / reanimated，**需调研** |
| 甘特图 | `features/timeline` 1,483 行 | RN SVG（`react-native-svg` 已在用） |
| 热力图 | `react-activity-calendar` | RN SVG 自绘 |
| 富交互 | hover / `:focus-visible` / `contextmenu` | RN 无对应，**需要交互降级设计** |

> ⚠️ 最后一行是**产品问题不是技术问题**：桌面/Web 的鼠标悬停、右键菜单在 RN 原语下
> 需要显式设计。**不要假装它能免费得到。**

### 回退

每轮**独立可回退**（一个特性一个提交）。迁移期间两套 UI 并存，
必须保持 `pnpm check` 全绿，否则会停在中途。

---

## M4：数据层统一（可与 M3 并行）

### 目标

让三端**真正共用一套存储契约**，而不是"两种存储 + 一种检索能力"。

### 为什么这是独立一条线（来自调研 §3.7）

既有实测已判定：**「三端一套 SQL」这个前提不成立** —— 浏览器端是 IndexedDB，**没有 SQL**。
后果不是"性能差一点"，而是：

- **FTS5 检索在 web 上永远用不了**
- AI 记忆检索**天然只有 2/3 端可复用**（`research/ai-memory-db-2026-09.md` 的实测结论）

关键区分（容易搞混）：

> **不能用 WASM 的是 Hermes（移动端）**，而移动端本来就有**原生** SQLite（op-sqlite 且已带 FTS5）。
> **浏览器是能吃 WASM 的。**

### 任务

**M4-1 决策（先写 ADR，再动手）**

- 建：新 ADR「客户端存储统一 = SQLite」
- 选项：web 用 `@sqlite.org/sqlite-wasm`（实测 **3.53.4-build1，Apache-2.0**）+ OPFS
- 必须写明**不做的代价**（web 永远没有本地检索）与**做的代价**（WASM 体积、OPFS 兼容面）

**M4-2 实现 `SqliteWasmDriver`**

- 建：`packages/storage/src/sqlite/sqlite-wasm-driver.ts`
- 只需实现**已有的 4 个同步方法**（`exec`/`run`/`all`/`close`）
- `SqliteAdapter` **一行不改** —— 这正是窄接口的价值
- 验：`packages/storage/tests/contract.spec.ts` 加一行把新驱动也跑一遍

**M4-3 迁移 web 存储并删掉 IndexedDB 路径**

- ⚠️ **这是数据迁移**，需要一次性把用户既有 IndexedDB 数据导入 SQLite
- 参照 [迁移纪律](../../AGENTS.md)：不可逆层优先干净
- 判据：契约测试三端同一套；FTS5 检索在 web 可用

### 回退

IndexedDB 路径**保留到迁移验证通过之后**再删。两者可并存一个版本周期。

---

## M5：收敛收尾 + 门禁全端

### 任务

1. 删除 `apps/web/src/features/` 下所有残留 DOM 实现
2. 删除 `apps/web/src/lib/` 下的重复 helper（M0 之后应已只剩薄导出）
3. **门禁全端覆盖**：
   - `check:design` 扫 `packages/ui` + 所有 `apps/*`
   - `check:layering` 覆盖新端
   - 新增一条：`apps/*` 不得直接 `import` `react-native-web`（只能经 `packages/ui`）
4. **文档固化**：
   - [构建矩阵](../reference/build-matrix.md) 补桌面端与"一套代码"的渲染路径说明
   - [多端构建手册](../runbooks/multi-platform-build.md) 补桌面端构建与验证
   - `AGENTS.md` §6.1 更新入口

### 判据

- `pnpm check` 全绿
- `apps/web/src` 行数**显著低于**今天的 13,814（目标：UI 只剩接线）
- 同一个 UI 文件被 web / mobile / desktop **三端同时引用**（可用脚本证明）

---

## M6：鸿蒙"跑起来"（外部依赖）

### 现状（实测）

出包**已完成**：`pnpm verify:harmony-toolchain` / `verify:harmony-rnoh` / `verify:harmony-rnoh-js`
三条判据脚本能出 HAP（release 20 MB / debug 37 MB）。

**缺的三样都不是写代码能补的**：

| 缺什么 | 说明 |
|---|---|
| 模拟器系统镜像 | 本机 `~/.Huawei` 不存在 |
| 签名 | 产物是 `*-unsigned.hap`（`signingConfigs: []`，装不进任何设备） |
| 真机或模拟器 | — |

**因此 M6 不排期**，只在具备条件时执行。ADR-0024 不依赖 M6。

---

## 2. 门禁设计（本计划的一部分，不是附加项）

调研 §2.7 的结论：**注释挡不住漂移**，这个仓库已经用 6 次真实事故证明过。
因此每一阶段都必须配门禁：

| 门禁 | 现状 | 本计划要做的 |
|---|---|---|
| `check:layering` | ✅ 6 条规则 | M0-3 加 1 条；M5 覆盖新端 |
| `check:design` | ✅ 扫 web/mobile/landing | M2-2 加桌面；M5 加 `packages/ui` |
| `check:licenses` | ✅ 已有 | M2-1 登记 `electron`、`react-native-web` |
| `check:mobile-bundle` | ✅ 已有（双 React 雷区） | M1-5 必须跑 |
| `check:native-deps` | ✅ 已有 | 新增原生模块时兜底 |
| **新增**：apps 不得直接依赖 `react-native-web` | ❌ | M5 加 |

---

## 3. 风险登记

| 风险 | 影响 | 应对 |
|---|---|---|
| 🔴 RNW 0.21.3 与 RN 0.84.1 不兼容 | M1 失败，ADR-0024 需重估 | M1 就是为验它而存在；退路是"双 UI + 桌面壳" |
| 🔴 迁移停在半途 | 两套 UI 长期并存，成本翻倍 | 每轮独立提交，`pnpm check` 全绿，净行数必须下降 |
| 🔴 `node:sqlite` 在 Electron 渲染进程不可用 | 桌面存储需绕路 | Spike S1 先验；退路是 `sendSync` + 主进程 |
| Electron 体积/内存 | 用户观感 | 明确接受（换存储正确性）；写入文档 |
| 桌面签名/公证成本未知 | 无法分发 | 本阶段只做未签名产包，**如实标注** |
| 拖拽/甘特无 RN 等价物 | 交互降级 | 逐特性评估；可能需要产品决策 |
| 本次调研无联网搜索 | 候选清单不完整 | 调研 §6.2 已列出全部缺口，**不假装完整** |

---

## 4. 依赖登记清单（引入前必须完成）

| 依赖 | 版本（实测） | 许可证（实测） | 状态 |
|---|---|---|---|
| `react-native-web` | 0.21.3（2026-09-25） | MIT | 🔲 待登记 |
| `electron` | 44.4.5 稳定（自带 Node 24.21.0） | MIT | 🔲 待登记 |
| `@sqlite.org/sqlite-wasm` | 3.53.4-build1 | Apache-2.0 | 🔲 待 M4 决策 |

⚠️ **不引入**（除非另有人工核实）：`tamagui`（npm `license` 字段为 `null`，
与仓库 MIT 冲突，**未读包内 LICENSE**）。

---

## 5. 进度账本（每轮更新，这是本计划的核心指标）

**起点（2026-09-27 实测）**：

| 指标 | 起点值 |
|---|---|
| `apps/web/src` | 13,814 行 / 59 文件 |
| `apps/web/src/features` | 12,277 行 |
| `apps/mobile/src` | 7,927 行 / 38 文件 |
| `apps/mobile/src/screens` | 3,661 行 |
| 两端同名重复文件 | 1 处（`category-colors.ts`） |
| 移动端缺失特性 | 8,227 行 |

**每完成一轮填一行**：

| 轮次 | 特性 | 净行数变化 | 两端共用同一组件？ | `pnpm check` |
|---|---|---|---|---|
| M0-1 | category-colors 收敛 | （待填） | — | — |
| M1 | 任务列表切片 | （待填） | — | — |

**M0-2 的展示逻辑归属判定表**（执行后写回这里）：

| mobile `lib/` 文件 | 判定 | 去处 |
|---|---|---|
| `category-display.ts` | （待填） | |
| `date.ts` | （待填） | |
| `due-display.ts` | （待填） | |
| `focus-display.ts` | （待填） | |
| `focus-timer.ts` | （待填） | |
| `priority.ts` | （待填） | |
| `quick-dates.ts` | （待填） | |
| `recurrence-display.ts` | （待填） | |
| `use-today.ts` | （待填） | |

---

## 6. 这份计划明确**不做**的事

1. **不重写业务逻辑** —— `packages/domain` / `app-host` 已经是零重复的，动它没有收益。
2. 🔴 **不把系统小组件纳入 UI 收敛** —— 小组件是**该平台的原生 UI**，
   任何框架都不能让它可移植。真正要写的是 **3 份原生组件（Swift / Kotlin / ArkTS）+ 1 个 JSON 模板**，
   共享的是 `v: 1` JSON 契约而不是 UI 代码。
   **禁止使用 headless-JS 组件库**（`react-native-android-widget` 那类），
   它会把 RN 组件树连同应用 JS 拖进后台进程。「UI 只写一份」在**应用内**成立，在小组件上不成立。
   见 [多端选型：小组件视角的证据](../research/multi-platform-selection-evidence.md) §10.1。
   小组件有自己的计划与排序：[多端小组件改造计划](multi-platform-widgets.md)，**与 M0/M1 并行不冲突**。
3. **不引入向量数据库** —— 已有实测结论（调研 §3.7）：需求是计数不是相似，
   暴力余弦扫描 10k×384 = 2.6 ms，ANN 索引解决的是本产品不存在的规模问题。
4. **不引入样式库**（ADR-0024 §2.4）—— 避免第二个设计真源。
5. **不做大爆炸式重写** —— 12,277 行必须逐特性迁。
6. **不承诺桌面端可分发** —— 签名/公证未调研，本阶段只到未签名产包。
7. **不承诺桌面端有原生小组件** —— Electron 能否承载 `.appex` / MSIX widget provider
   **未核实**（ADR-0024 §5 第 5 条）；降级路径是 macOS Continuity 与 Windows PWA provider。
8. **不把鸿蒙排进关键路径** —— 缺的是模拟器镜像与签名，不是代码。
