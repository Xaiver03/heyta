# ADR-0032：Windows 桌面端迁到 react-native-windows 原生

> 状态：**待确认**
> 日期：2026-09-28
> 取代：**部分取代** [ADR-0024](0024-desktop-shell-and-ui-convergence.md) §2.2（"桌面壳选 Electron"）；
> **收窄** [ADR-0031](0031-native-apps-everywhere-not-pwa.md)（该文用"减少代码量"论证否决更原生的方案，
> 而本决策明确**接受更大的代码量**）

## 1. 背景与约束

### 1.1 触发

产品要求（原话）：

> 「我们尽可能需要原生，包括 Windows 上面也需要原生。**哪怕是代码量偏大。**」

### 1.2 🔴 这句话抽掉了 ADR-0024 §2.2 的论证前提

ADR-0024 §2.2 选 Electron 时，"否决 Tauri 与 react-native-windows"的理由**不是**
"Electron 更原生" —— 它恰恰**不是**原生。理由集中在**复用度**：
"UI 复用度最高"、"与移动端同一套 RN 心智模型"。

而 §2.2 同时记录了**唯一一条决定性理由**：

> 「heyta 的存储接口是**同步**的。」

⚠️ 这条理由**至今仍然成立**，而且**在新方向下变得更关键** ——
因为它正是 RNW 路线最贵的那一笔成本（§3 结论 C1）。
本 ADR **不否认**它，而是**接受它作为代价**：既然"代码量偏大"可接受，
那么"为 Windows 写一个同步存储驱动"就从"否决理由"变成"工程任务"。

### 1.3 硬约束：Capacitor 不在候选里

[ADR-0031](0031-native-apps-everywhere-not-pwa.md) §1.2 已核实：
Capacitor 的官方平台只有 **iOS / Android / Web(PWA)**，**没有 Windows**。
所以"用 Capacitor 做 Windows 原生"不是一个可选项。

### 1.4 各端原生可达性**根本不同**（本 ADR 只决定 Windows）

| 平台 | 原生方案 | 可达性 | 决定性事实 |
|---|---|---|---|
| **Windows** | **RNW** | ✅ | RNW **0.84.0** `peerDep: react-native 0.84.1` = **与 heyta 精确相等**；support matrix 上 0.84 = Active |
| macOS | react-native-macos | 🔴 不可行 | 最新 **0.81.9**，`peerDep: 0.81.6`，官方要求同一 minor；heyta 在 0.84.1 → **硬冲突** |
| Linux | —— | 🔴 不存在 | RN 生态没有 Linux |

🔴 **本 ADR 只对 Windows 拍板。** macOS / Linux 的处理见
[多端原生构建计划](../plans/desktop-native-migration.md) §3–§4 ——
把它们捆在一起表决，会让不成立的那一半拖死成立的那一半。

## 2. 选项

| 选项 | 优点 | 缺点 | 关键证据 |
|---|---|---|---|
| **A. Windows 走 RNW 原生**（本 ADR 选它） | RN 版本**精确对齐**；真原生窗口（C++/WinAppSDK/Win32/Composition）；`cpp-app` 自带 Packaging project；与移动端**同一套 RN 心智** | ① 要写 Windows **同步存储驱动**；② 原生库缺口大（**支持 Windows 的 RN 库仅 73/2716 = 2.8%**）；③ 组件 provider 只能 C++/WinRT（**New Arch 不支持 C#**）；④ 要跟 RN 发布火车 | 调研 §1.2/§1.5/§2（含官方 support matrix 与 FAQ 原文） |
| B. 保持 Electron | 已实测可用（真 Windows 上启动、建库、开窗截图）；零新增成本 | 🔴 **不是原生** —— Chromium + Node，正是本次要摆脱的东西 | [`../runbooks/desktop.md`](../runbooks/desktop.md) §5.5–§5.6 |
| C. Tauri | 复用 `apps/web` 代码最多；两端组件都有脚手架 | 🔴 用 **WebView2** 渲染，**UI 不是原生** | 调研 §7.2 第 2 行 |
| D. .NET MAUI / WinUI 3 手写 | 最"纯"的原生 | 🔴 **第五份 UI 实现**，与 `packages/ui`、RN 心智全无关 | —— |
| E. Capacitor | —— | 🔴 **没有 Windows 平台** | ADR-0031 §1.2（官方文档） |

## 3. 结论

**Windows 桌面端改用 react-native-windows 原生实现**，
新增 `apps/desktop-windows`（RNW `cpp-app`），并把 Electron 降级为：

1. **基线** —— 已实测可用，RNW 必须**逐项对齐**它的行为；
2. **过渡壳** —— Windows 侧在 RNW 达到可交付前继续用它；
3. **对照基准** —— 两边必须通过**同一份** `desktop-window` 断言（见计划 §6）。

同时**接受三笔明确成本**（不藏）：

| | 成本 | 处置 |
|---|---|---|
| **C1** | Windows **同步** SQLite 驱动 | 🔴 **全计划门槛**：W0-2 spike 必须先过同一套 `DbAdapter` 契约，**过不了就停**，回 Electron 并记录 |
| **C2** | 原生库缺口（2.8% 生态） | W0-3 逐个数出来，形成缺口清单 |
| **C3** | 组件 provider 只能 C++/WinRT，且**无先例** | W2-1 先做**一张常量卡片**，在最小形态上暴露问题 |

### 3.1 一条必须先做的前置

🔴 **先把 RN 抬到受支持的版本，再上 RNW。**

理由：heyta 停在 RN **0.84.1**（发布于 2026-02-27），而上游 stable 已到 **0.87.1**；
RN 官方只维护最新 3 个 minor series ⇒ **0.84.x 已在上游支持窗口之外**。
而 RNW 要求与 RN **精确对齐**。
⇒ 若直接上 RNW，接上的第一天就已经落后；升 RN 的成本只会随时间变大。

## 4. 后果

- 桌面端**从一套壳变成两套壳**（Windows 用 RNW、macOS/Linux 用 Electron），
  并存期需要两套构建/签名/发布流水线。**并存期应尽量短。**
- `packages/ui` 的**价值上升**：它从"web/desktop 复用"变成"RN 全家（mobile + Windows + 鸿蒙 + web）复用"，
  成为跨端唯一真源。ADR-0024 §2.1 的方向**被强化**，不是被推翻。
- 🔴 **门禁必须同步扩张**，否则新壳就是新盲区：
  `check:design` 的 `SCAN_ROOTS`、`check:layering`、`check:native-deps`、`check:mobile-bundle`
  都要覆盖 `apps/desktop-windows`。上一次给桌面渲染层加 `SCAN_ROOTS` 时**当场抓出 6 处裸值** ——
  盲区里一定已经攒了债。
- **macOS 与 Linux 上"原生"这个承诺暂不成立**，文档必须**如实标注为过渡**，
  不得包装成原生。它们的触发条件写在计划 §3 与 §4。
- 不接受"用 Tauri 换更少代码"的反提议：本次**原生性优先于复用度**，
  而 Tauri 的渲染层是 WebView2，不满足这个前提。

## 5. 未核实项

1. 🔴 **C1 能否做成** —— Windows 上是否存在与 heyta 同步 `SqliteDriver` 契约相容的实现，
   **完全没有验证**。这是全计划的门槛，W0-2 之前不得把它当成已解决。
2. **C2 的真实规模** —— 只知生态总数（73/2716），**不知道 heyta 自己用到几个**。
3. **C3 的可行性** —— RNW New Arch 下写 `IWidgetProvider` COM exe server，
   **未找到任何先例**（既没有 RN 应用带 Windows 小组件的案例，也没有 C++/WinRT 版的样例可抄）。
4. **RNW 0.84 在本机的实际可构建性** —— 调研读的是 npm 与官方文档，
   **没有在本机 init 过一个 `cpp-app`**。W0-1 就是为这条设的。
5. **Windows 打包件的可见窗口截图**仍未取得（无头会话限制，与壳无关）。
6. **RNW 的 release 行为**是否也会踩到 `import.meta` 这类只在 release 现形的坑 ——
   已知 Hermes/WinAppSDK 路径与移动端不同，**未核实**。
