# ADR-0024：UI 收敛方向 = React Native + react-native-web；桌面壳 = Electron

> 状态：**已接受**（产品负责人 2026-09-27 确认：桌面端路线 = **Electron**）
> 日期：2026-09-27（确认日期：2026-09-27）
> 决策者：产品负责人（指示原话：「多端尽可能减少代码量，维护同一套代码，提高可维护性」）
> 影响层：`apps/*`（新增桌面壳与共享 UI 包）、`packages/`（共享层补完）、`packages/storage`（桌面驱动复用）
> 依据：[多端「一套代码」融合调研](../research/multi-platform-ui-fusion.md) ·
> 执行：[多端适配实施计划](../plans/multi-platform-adaptation.md)

> ✅ **已确认**：2026-09-27 产品负责人在「确认 Electron / 改用 Tauri / 先不定」中**选择确认 Electron**，
> 本 ADR 状态由「待确认」改为「已接受」。
>
> ⚠️ 但 §5 的未核实项**仍然是未核实的** —— 它们是**待做的 spike，不是拦路石**。
> 决策已定，接下来要用 [M1/M2](../plans/multi-platform-adaptation.md) 的实测去**验证**它们，
> 而不是用它们去**推翻**决策。若某条实测不成立，走 §2.2 与 §5 已写明的降级路径，
> 不要默默改设计。

---

## 1. 背景

### 1.1 要解决的问题

[计划总路线图](../plans/roadmap.md) 里 P2「多端补齐」进行中，桌面端（Windows / macOS / Linux）
在 [ADR-0003](0003-multi-platform-strategy.md) §2.4 与 [ADR-0004](0004-ui-stack.md) 里**一直是「待定」**。
产品负责人现在给了明确的判据：**尽量少写代码、一套代码、可维护性优先**。

### 1.2 现状（2026-09-27 重新实测，见调研 §2）

| 层 | 状态 |
|---|---|
| 业务逻辑 | ✅ **已零重复**。`packages/domain`（6,535 行）+ `packages/app-host`（4,592 行）被各端共用 |
| 设计令牌 | ✅ **RN 侧管线已存在**。`packages/design-system` 已导出 `./native` 与 `generated/tokens.json`，`apps/mobile` 已消费 |
| 存储 | ✅ **窄接口 + 跨引擎契约测试**。`SqliteDriver` 只有 4 个**同步**方法；已有 memory / IndexedDB / SQLite 三个实现 |
| **UI** | 🔴 **唯一的重复**。web `features` **12,277 行** vs mobile `screens` **3,661 行** |

### 1.3 关键发现：移动端缺的不是"少写一点"

按功能配对后，**web 有而 mobile 完全没有的特性合计 8,227 行**（占 web feature 的 67%）：
`ai`(3,207)、`timeline`(1,483)、`motivation`(1,090)、`habits`(577)、`projects`(341)、
`quadrant`(317)、`capture`(277)、`subscription`(234)，以及 `settings` 的大部分。

**这把问题的性质改变了**：不是"两边各写一半"，而是**每个特性要么写两遍，要么在移动端缺席**。
**8,227 行迟早要写 —— 区别只在于写一遍还是两遍。**

---

## 2. 决策

### 2.1 UI 只写一份 React Native 组件

**新建共享 UI 包，组件用 RN 原语书写**，各端只提供渲染目标：

| 目标 | 渲染方式 |
|---|---|
| iOS / Android | RN 原生（现有 `apps/mobile`） |
| HarmonyOS | RNOH（已实测出 HAP） |
| Web | **react-native-web 0.21.3** |
| Windows / macOS / Linux | react-native-web 产物 + **Electron 壳** |

`apps/web` 现有的 DOM/CSS 组件**不能直接搬**（ADR-0004 §4 已指出），
须按特性增量迁移，**不搞大爆炸式重写**。

> 🔴 **例外：系统小组件不纳入 UI 收敛。**
> 小组件由各平台原生载体绘制（iOS/macOS SwiftUI·WidgetKit、Android Kotlin·RemoteViews、
> 鸿蒙 ArkTS 卡片、Windows Adaptive Card 模板），**共享的是 `v: 1` JSON 契约而非 UI 代码**。
> **禁止使用 headless-JS 组件库**（如 `react-native-android-widget`）——
> 它会把 RN 组件树连同应用 JS 拖进一个后台进程，恰好摧毁"单写者快照 + 意图队列"这套契约
> 存在的理由。
>
> 这条例外有**三条独立成立的依据**：`react-native-web` 输出的是浏览器 DOM，渲染不到小组件；
> RN 原语也渲染不到（组件必须由平台自己的载体绘制）；以及本仓库上游的一手工程记录 ——
> Super Productivity 真的把同一款任务组件在 Android 与 iOS **各实现了一遍**，
> 两边**只有 `v: 1` 的 JSON 契约是共享的**。
> 详见[多端选型：小组件视角的证据](../research/multi-platform-selection-evidence.md) §1 与 §10.1。
>
> **因此「UI 只写一份」在应用内成立，在小组件上不成立** —— 小组件是
> **3 份原生 UI（Swift / Kotlin / ArkTS）+ 1 个 JSON 模板**，不随本 ADR 收敛。

### 2.2 桌面壳选 Electron，不选 Tauri，也不用 react-native-windows

**决定性理由只有一条：heyta 的存储接口是同步的。**

`packages/storage/src/sqlite/sqlite-driver.ts` 的接口全是**同步**方法
（`exec` / `run` / `all` / `close`），文件头注释写明了为什么：

> 同步是有意的 —— 原生桥（JSI / NAPI）通常就是同步调用，而 `DbAdapter` 的并发契约
> 由适配器内部的 FIFO 队列负责，不依赖驱动。

而 **Tauri v2 前端↔后端通道只有异步形态**：官方文档里 `invoke` 的绑定签名就是
`async fn invoke(cmd: &str, args: JsValue) -> JsValue`，正文写
"Asynchronous commands are preferred in Tauri"。
（来源：`https://v2.tauri.app/develop/calling-rust/`，2026-09-27 抓取）

**Electron 相反**：官方文档写明 `ipcRenderer.sendSync(...)`
"expect a result **synchronously**"；且 Electron 稳定版 44.4.5 自带 **Node 24.21.0**，
而 Node 从 **v23.4.0** 起 `node:sqlite` 不再需要 `--experimental-sqlite` 标志
（v25.7.0 起为 release candidate），其 `DatabaseSync` **全同步**。
（来源：`https://www.electronjs.org/docs/latest/api/ipc-renderer`、
`https://releases.electronjs.org/releases.json`、`https://nodejs.org/api/sqlite.html`）

**于是出现这条最有力的论证**：本仓库**已经写好并通过跨引擎契约测试**的
`NodeSqliteDriver`（`apps/node-host/src/host.ts` 真实使用，
`packages/storage/tests/contract.spec.ts` 覆盖）**可以直接给桌面端用，一行不用改。**

### 2.3 为什么不用 react-native-windows / react-native-macos

| 判据 | 实测 |
|---|---|
| **Linux 无官方目标** | `microsoft/react-native-linux` 返回 **HTTP 404**；社区替代仅 32★ 且无 release |
| macOS 侧版本落后 | `react-native-macos` 最新 release **v0.81.9（2026-07-13）**，而 RN 主干是 **0.84.1** |
| Windows 侧许可证存疑 | GitHub 将 `microsoft/react-native-windows` 判为 **NOASSERTION (Other)**，**不是 MIT** |
| 存储需重写 | 需为 Windows 新写原生 SQLite 驱动，而 Electron 路线**零新代码** |

前三行任意一条都足以否决它作为"桌面唯一方案"；第四条让它相对 Electron 完全没有优势。

### 2.4 不引入样式库（至少现在不）

用 RN 自带的 `StyleSheet` + 已生成的 `@heyta/design-system/native`。
理由是本仓库硬规则「设计变量的值只在一处定义，其余平台**生成**」（`AGENTS.md` §5）。
Tamagui / NativeWind / restyle 都**自带主题配置**，引入即等于**制造第二个设计真源** ——
而本仓库已经有过"注释说一致、实际已漂移"的事故（调研 §2.3）。

> ⚠️ 许可证旁注：`tamagui` 的 npm `license` 字段是 `null`，而其仓库 LICENSE 是 MIT。
> **两侧不一致，引入前必须人工读包内 LICENSE。** 这条本身也是一个值得记录的坑。

### 2.5 附带结论：`apps/web` 的 PWA 化**价值上升了**，不是下降

因为桌面端与 Web **共用同一个 react-native-web 产物**（§2.1），
把 `apps/web` 做成可安装 PWA 这件事**同时服务两个目的**：

1. Web 用户可安装 —— 对 Web 端本身就有价值；
2. 🔴 **Windows 11 的小组件可以完全绕开 Electron** —— 走 **PWA widget provider**，
   不需要 MSIX、不需要 WinRT COM server、不需要 C++/C#。

也就是说：**Windows 的组件路径与桌面壳是解耦的**。
即使"Electron 承载原生组件"（§5 第 5 条）最终不成立，Windows 仍然可以有组件。

> 🔴 但前置条件**已实测且不成立**：`apps/web` 现在**不是 PWA** ——
> 无 manifest、无 service worker、无图标、无 PWA 插件。
> 而且 PWA widget provider 要求 PWA 能从**公网 endpoint** 安装（PWABuilder 不支持 localhost）。
> 详见[多端小组件改造计划](../plans/multi-platform-widgets.md) §3.1。

### 2.6 ⚠️ 两条必须写进决策的反面证据

#### (1) 🔴 已独立核实：鸿蒙侧的第三方库适配层滞后，且与仓库现状已经冲突

用 npm registry 一手核实（2026-09-27，本次亲自执行）：

| 库 | 仓库实际 | RNOH 适配版 |
|---|---|---|
| `react-native` | **0.84.1** | `@react-native-oh/react-native-harmony@0.84.4` 的 peer = **`0.84.1`** ✅ |
| `@op-engineering/op-sqlite` | **^18.2.5** | `@react-native-oh-tpl/op-sqlite` = **8.0.2** ⚠️ **差 10 个大版本** |
| `react-native-safe-area-context` | **^5.5.2** | `@react-native-oh-tpl/…` = **4.7.4** ⚠️ |
| `react-native-screens` | — | `@react-native-oh-tpl/…` = **3.34.0** |

**三条推论，都要落到计划里**：

1. ✅ **RNOH 与 RN 0.84.1 精确对齐** —— 这是本项目**宝贵的既成资产**。
   **因此本轮任何 UI 收敛都不得改动 RN 版本**（跳到 0.85+ 会直接掉出 RNOH 支持范围）。
2. 🔴 **`op-sqlite` 在鸿蒙上只有 8.0.2，而 iOS/Android 是 18.2.5。**
   本仓库既有调研称「`op-sqlite` 已内置 FTS5 与 sqlite-vec」——
   **该结论是否覆盖 8.0.2 未核实**。因此 [M4](../plans/multi-platform-adaptation.md)
   **不得**把 FTS5 / sqlite-vec 当作鸿蒙端已具备的能力。
3. ⚠️ 适配是**patch 模式**（固定基线、不随上游升级），所以这不是"等一等就好"，
   而是一个**需要长期维护的版本落差**。

#### (2) ⚠️ 未独立核实（引自子代理调研，引用前请自行复核）：web 重写的先例风险

一份 AI 子代理调研（`research/universal-rn-monorepo-ui-2026-09.md`）主张：
公开记录里**没有**"DOM/CSS React 应用迁到 RNW"的具名成功案例；
而 RNW 作者 Nicolas Gallagher 在 2025-11 公开论证这条路对 web-first 团队
是 *"massive switching cost with questionable returns"*，并已转向 React Strict DOM。

🔴 **我（写这份 ADR 的人）没有复核这两条主张** —— 来源是子代理，我没读原文。
但它的**方向与本 ADR §3「负面」已承认的最大成本一致**（12,277 行 DOM → RN 迁移），
所以它**不改变结论，而是加强了对 M3 的约束**：

> **M3 必须逐特性增量、每轮独立可回退，不得是"先重写、再验证"的大爆炸。**
> 并且 —— 见 [计划](../plans/multi-platform-adaptation.md) 的 M3 —— **web 保留现有
> DOM/CSS 实现，通过别名逐组件接入共享 UI，而不是整体替换。**

---

## 3. 后果

### 正面

- **UI 从"两份（且持续分叉）"变成一份**，移动端免费获得 8,227 行已有特性
- **桌面端存储零新代码** —— 直接复用已通过契约测试的 `NodeSqliteDriver`
- **设计令牌无需新建** —— RN 侧管线已存在且已被消费
- `check:layering` / `check:design` / `check:tokens` 等门禁**直接复用**，只需把新端加进扫描列表
- 桌面端与 Web **共用同一个前端产物**，构建与发布只有一条链

### 负面 / 必须接受的成本

- 🔴 **Web 的 12,277 行 DOM/CSS UI 需要迁到 RN 原语**。这是本方案最大的成本，
  必须**逐特性增量**做，不能重写。
- 🔴 **Electron 体积与内存显著大于 Tauri**（Chromium + Node）。这是用**存储正确性**
  换来的，要明确接受。
- 拖拽 / 甘特 / 热力图 / 富交互在 RN 原语下**需要替代实现**（现状是 `@dnd-kit` 等 DOM 库）
- 桌面端的**签名、公证、自动更新**成本本次**完全未调研**
- UI 收敛期间会**同时存在两套 UI**，需要一条明确的"迁移中"纪律与门禁，否则会停在中途

### 需要靠规范兜住的

- **跨度期的门禁**：新端必须加进 `check:design` 的扫描列表，否则设计系统在新端形同虚设
- **禁止二次真源**：UI 包不得定义颜色/间距字面量，只能消费 `@heyta/design-system/native`
- **依赖必须先登记**：Electron 等新依赖在 `check:licenses` 之前不得引入（仓库硬规则）

---

## 4. 与既有 ADR 的关系

| 既有决策 | 本 ADR 的影响 |
|---|---|
| [ADR-0003](0003-multi-platform-strategy.md) 逻辑在 `packages/`，apps 只做壳 | **不变**，且是本 ADR 能成立的前提 |
| [ADR-0003](0003-multi-platform-strategy.md) §3.2 否决 WebView 套壳 | **不冲突**。该否决针对**移动端**（iOS 清 WebView IndexedDB）。Electron 承载的是自己打包的静态产物，且存储走**原生 SQLite**，不是 IndexedDB |
| [ADR-0004](0004-ui-stack.md) UI 栈 = React Native | **不变**。本 ADR 是它的**落地路径**，并补上它留空的桌面端 |
| 服务端 = PostgreSQL | **不变**（调研 §2.6 已核实 `provider = "postgresql"`） |
| 鸿蒙走 RNOH | **不变**，出包已实测；缺的仍是模拟器镜像与签名 |

---

## 5. 🔴 未核实项（在确认前不得当作已成立）

1. **`node:sqlite` 在 Electron 渲染进程是否可直接使用** —— 未实测。
   退路已备：`sendSync` + 主进程持库（同样满足同步接口）。
2. **react-native-web 0.21.3 与 RN 0.84.1 的实际兼容面** —— peer 字段不约束 RN，
   但"不声明 peer"不等于"已适配 0.84 的 API"。
3. **12,277 行 web UI 的迁移工作量** —— 只有 LOC 统计，**没有逐特性人工估算**。
4. **Electron 的签名 / 公证 / 自动更新成本** —— 完全未调研。
5. 🔴 **Electron 能否承载平台小组件载体** —— 组件让"桌面端未调研"这个空白变大了，
   新增三条，任一条为否则只能走降级路径：

   | 未核实项 | 若为否，后果 |
   |---|---|
   | Electron 的 macOS 产物能否内嵌 WidgetKit `.appex`，且在 **Developer ID 签名 + 公证 + 非 App Store 分发**下被系统识别？ | macOS 只能退回 **Continuity**（iPhone 组件上 Mac，降级形态） |
   | Electron 的 Windows 产物能否 MSIX 打包并注册 Win11 widget provider（WinRT COM server）？ | Windows 只能走 **PWA widget provider** |
   | `.app` 由 electron-builder 之类产出，嵌入 `.appex` 需动 bundle 结构与双 target 签名 —— 工程上多难？ | 决定"原生桌面组件"值不值 |

   ⚠️ 这三条**不构成推翻 Electron 的理由** —— §2.2 选它的决定性理由是**同步存储**，与组件无关。
   正确做法是承认"原生桌面组件"是一个**可能拿不到的可选项**，并准备好两条降级路径。
6. **`react-native-windows` 的真实许可证** —— 只看到 GitHub 的 NOASSERTION 判定，**未读 LICENSE 原文**。
7. **本次调研没有可用的联网搜索接口**（`web_search` 全程 HTTP 432）——
   候选清单**不完整**，且缺少社区踩坑帖与团队复盘这一层证据。详见调研 §6.2。

**因此本 ADR 不改变任何"先验证再投入"的顺序**：第一步仍是用**一个垂直切片**实测
react-native-web 在 web + 桌面 + 移动三端能否真的共用同一份组件。

---

## 6. 决策摘要（一句话）

**UI 只写一份 React Native 组件，Web 与桌面用 react-native-web 渲染，桌面壳用 Electron
——因为 Electron 有同步 IPC 与现成的 `node:sqlite` 驱动，而 Tauri 只有异步 IPC。**
