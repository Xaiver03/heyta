# 多端共享 UI：业界最佳实践调研（**补上仓库缺失的联网检索**）

> ## 🔴 2026-09-30 追注：**本文件 §2/§3.2/§4 的"桌面端 → RN 平台实现"结论已被实测推翻**
>
> 本文件当时推翻了自己（从"M2 原生壳 + WebView"改成"M1 RN 平台实现"），
> 依据是**版本对齐**（RNW 0.84.0 ↔ RN 0.84.1）与**上游在推的 PR 栈**。那条依据**不够**：
>
> - **RNW**：版本逐字对齐，但补上它要求的 MSVC v145 后**仍 `0xC0000409`、窗口从未出现**
>   ⇒ **工具集不是变量**，版本对齐 ≠ 能用。
> - **RN-macOS**：npm 最高 `0.81.9`、peer 精确锁 `0.81.6`，与 heyta `0.84.1` **硬冲突**；
>   追赶 tracker [#3098](https://github.com/microsoft/react-native-macos/issues/3098) **没有承诺日期**。
>
> ⇒ 现行决定见 [ADR-0037](../adr/0037-desktop-ui-falls-back-to-webview.md) 与
> [主计划 §4.2/§4.3](../plans/multi-end-unified-strategy.md)：**桌面端（Windows/macOS/Linux）
> 走 M2 —— 原生壳 + 壳内 WebView 加载共享 UI**，不渲染成原生控件。
> macOS 那一格的定案与**可判定的重开条件**写在主计划 §4.3。
>
> **本文件正文保留原样**（它是"这条路走过、当时的依据是这样"的证据），
> 但**不要再把 §2/§3.2/§4 的目标表当作现行目标态**。

> 状态：**调研结论**（只读调研，未改动任何产品代码）
> 日期：2026-09-28（CST）
> 立项理由：本仓的多端选型**是在没有联网搜索的情况下做的** ——
> [multi-platform-ui-fusion.md](multi-platform-ui-fusion.md) §0.1 与 [ADR-0024](../adr/0024-desktop-shell-and-ui-convergence.md) §5 都写着
> 「本次调研中 `web_search` 全程返回 `Tavily API error (HTTP 432)`……**覆盖面有系统性缺口**」
> 「**没有**社区踩坑帖与团队复盘的一手证据」。本文件补的就是这个缺口。
>
> 🔴 **本文件推翻了自己之前的推荐**（原推荐：原生壳 + 内嵌 WebView 承载共享 UI）。
> 改动理由见 §5：**有一条更好的路，而且是微软自己在用的路。**

---

## 0. 方法与渠道（先说清可信度）

| 渠道 | 结果 |
|---|---|
| `web_search`（Tavily） | 🔴 **仍失败**：`Tavily API error (HTTP 432)`（与 2026-09 当年的失败一致） |
| **AnySearch**（`api.anysearch.com`） | ✅ **可用**，本轮主要检索通道 |
| **npm registry 直查** | ✅ **最权威**：版本与 peerDependencies 逐字读出，不经过二手转述 |
| **GitHub / 官方文档 / 工程博客直抓** | ✅ 一手来源 |
| 国内搜索引擎（Sogou/CSDN 等） | ⚠️ 结果基本是下载站噪音，**未采用** |

**凡本文件的版本与依赖结论，都以 npm registry 直查为准**；凡"某公司怎么做"的结论，都以**该公司自己的官方博客/文档**为准，不采信二手对比文。

---

## 1. 结论摘要（先给要的东西）

**业界最佳实践不是"发明一个原生壳 + 共享 UI 的混搭"，而是一条已经成熟、且有官方支持的路：**

> ### 🔴 用 **React Native 作为唯一的 UI 实现**，让每个平台的 **RN 平台实现（out-of-tree platform）把它渲染成该平台的原生控件**。

也就是：

| 端 | UI 渲染 | 是否原生控件 | 状态 |
|---|---|---|---|
| iOS / Android | React Native | ✅ | ✅ 已是 |
| 鸿蒙 | RNOH | ✅ | ✅ 已是 |
| **Windows** | **`react-native-windows`** | ✅ **WinUI / XAML** | ✅ **今天可用，且与 heyta 版本零冲突**（§3.1） |
| **macOS** | **`react-native-macos`** | ✅ **AppKit** | 🟡 **等 0.84 发布**（§3.2） |
| Web | `react-native-web` | —— | ✅ 已是 |
| 系统小组件 | 各端原生 | ✅ | ✅ 已裁决的例外 |

**这套做法同时满足产品负责人的全部四条约束**（原生外壳 / 一套代码 / UI 组件复用 / 一套设计系统），**而且比我上一轮推荐的"原生壳 + 内嵌 WebView"更好** —— 因为它是**原生控件**，WebView 不是。

**采用方式**：**Microsoft Office 式的 content islands（内容岛）增量嵌入** —— 不重写，而是在**现有原生壳里逐块嵌入 RN 视图**（§4）。

---

## 2. 业界在怎么做：五个一手证据

### 2.1 🔴 Microsoft Office：**RN 内容岛嵌进原生应用**（最重要的一条）

来源：[How Office Is Modernizing Their App Suite's UI using Windows App SDK and React Native](https://devblogs.microsoft.com/react-native/2025-05-09-office-modernize/)（Microsoft 官方 React Native 博客，2025-05-09，作者是 MS 高级工程师）

原文关键段落（逐字）：

> 「**Office has hundreds of millions of customers who expect visual consistency across desktop, mobile, and web. Currently, there are over 40 Office experiences which use React Native** to build cross-platform features such as Privacy Dialog and Accessibility Assistant.」
>
> 「**Content Islands** — React Native can be **embedded into existing Windows applications**, which allows apps to **choose which experiences to migrate onto the platform**. This feature is critical for Office's modernization efforts. React Native content islands **seamlessly integrate into an app's overall UI** giving a consistent look and feel across an application. **The islands can interact with one another and pass app data between platforms.**」
>
> 「**React Native is built on top of Windows App SDK**, so developers building apps with React Native still have access to **WinUI controls** and other key APIs.」
>
> 「**React Native uses WinUI under the covers to support many native Windows controls.**」

🔴 **这条直接回答了两个问题**：
1. **"别人怎么构建这种多端应用？"** —— 微软自己**不做大爆炸重写**，而是**在既有原生应用里逐个嵌入 RN 内容岛**。Office 同时用着 RN + WebView2 + Scene Graph 三套 UI 技术。
2. **"RNW 是原生吗？"** —— **是**。RNW 建立在 Windows App SDK 之上，**底层用的就是 WinUI 控件**，且 WinUI 与 RN 内容可以**并排渲染、数据互通**。

### 2.2 RNW 的路线：**0.82 起彻底移除旧架构，全程 Fabric，且解锁原生 XAML 控件**

来源：[React Native 博客（Microsoft）](https://devblogs.microsoft.com/react-native/)（2026-06-30，v0.82 公告）

> 「React Native Windows v0.82 is here, marking a major milestone: **the legacy Paper architecture has been fully removed. All applications now run exclusively on the New Architecture (Fabric)**, and **this release also unlocks XAML controls for community modules — so Windows apps can seamlessly mix native XAML controls with React components.**」

来源：[RNW README](https://github.com/microsoft/react-native-windows) / [npm](https://www.npmjs.com/react-native-windows)

> 「the new RNW **Fabric renderer targets Composition from the start but has the ability to host islands of XAML for advanced native controls**. Apps on the new architecture will be **WinAppSDK Win32** by default.」

⇒ RNW 既有 Composition 渲染，又能**嵌入 XAML 原生控件**。这正就是"原生外壳 + 共享 UI"的成品形态，**不需要我们自己发明**。

### 2.3 Microsoft Teams 2.0：**Electron → WebView2**（"WebView 路线"确实有人走，但那是另一个权衡）

来源：[Microsoft Tech Community](https://techcommunity.microsoft.com/discussions/microsoftteams/teams-2-0-moves-away-from-electron-to-embrace-edge-webview2/2484565)、[ThoughtStuff](https://blog.thoughtstuff.co.uk/2021/08/stop-saying-microsoft-teams-is-being-rewritten-from-electron-to-react/)

Teams 从 Electron 换成 **Edge WebView2**（宿主仍是原生外壳），官方预期**内存减半**。

⚠️ **注意它与 heyta 的差别**：Teams 的 UI 本来就是**Web 应用**（Angular→React），换 WebView2 是"把同一个 Web UI 换个宿主"，**JS 渲染目标没变**。
heyta 的共享 UI 是 **React Native 组件**（不是 DOM），所以对 heyta 而言，**RN 平台实现比 WebView 更贴近原生**。

### 2.4 Compose Multiplatform：技术上最强的"共享 UI"，但**与 heyta 的核心资产不兼容**

来源：[kotlinlang.org/compose-multiplatform](https://kotlinlang.org/compose-multiplatform/)、[JetBrains 博客（1.8.0）](https://blog.jetbrains.com/kotlin/2025/05/compose-multiplatform-1-8-0-released-compose-multiplatform-for-ios-is-stable-and-production-ready/)

CMP 的 iOS 自 **1.8.0（2025-05）起 Stable**，Desktop（Windows/macOS/Linux）与 Web（Beta）都在。**它是唯一能在 iOS+Android+macOS+Windows+Linux 上共享同一份 UI 代码的成熟方案。**

🔴 **但对 heyta 不成立**：CMP 是 **Kotlin**。heyta 最大的资产是 **TypeScript 的 packages/**（domain 17.6k 行、app-host 63 个动作、storage/op-log/sync/ai），而 ADR-0003 把"业务逻辑只能在 `packages/`"定成硬约束。**KMP 消费不了 TS**（原生互操作只有 C/ObjC —— 本仓 [deep-dive-cross-language-and-components.md](../../research/deep-dive-cross-language-and-components.md) 已实测这一条）。
⇒ 选 CMP = **要么把 TS 核心重写成 Kotlin，要么让 UI 与逻辑分属两个生态**。两者都违反"复用一套代码"。

### 2.5 Tauri：小而省，但**不是原生控件**

来源：[tech-insider.org](https://tech-insider.org/tauri-vs-electron-2026/)、[betterstack](https://betterstack.com/community/guides/scaling-nodejs/tauri-vs-electron-vs-deno-vs-electrobun/)、[Tauri 官方](https://v2.tauri.app/start/)

Tauri 用系统 WebView，**比 Electron 小约 96%、内存少约 75%**。
🔴 但代价是**跨平台一致性**（各平台 WebView 是不同引擎，社区明确提到 "Tauri uses the native platform WebView which can make it behave inconsistently across different platforms"）。
⇒ 且 Tauri 是 **WebView 渲染 ⇒ UI 不是原生控件**，与 heyta 的目标（原生）不符；本仓 ADR-0024 已因**存储接口是同步的**而否决它（Tauri `invoke` 只有 async）。

---

## 3. 版本现实（**npm registry 直查**，这是全篇最关键的一节）

### 3.1 🔴 Windows：`react-native-windows@0.84.0` 与 heyta **逐字对齐**

```
react-native-windows@0.84.0  peerDependencies = {
  "react":          "^19.2.3",
  "react-native":   "0.84.1",      ← 精确锁定
  "@types/react":   "^19.1.1"
}
```

heyta 的 `apps/mobile/package.json`（实测）：

```
"react":        "19.2.3"
"react-native": "0.84.1"
```

⇒ **`react-native` 版本完全相同（0.84.1），`react` 也满足 `^19.2.3`。**
**接 RNW 不需要改移动端任何一行版本号。**

RNW 官方支持状态（[support matrix](https://microsoft.github.io/react-native-windows/support/)）：

| RNW 版本 | 支持阶段 | 发布 | 维护开始 | 支持结束 |
|---|---|---|---|---|
| **0.84** | ✅ **Active** | 2026-06-22 | 2026-06-22 | TBD |
| 0.83 | Maintenance | 2026-05-27 | 2026-07-31 | 2026-09-30 |
| 0.82 | Maintenance | 2026-03-16 | 2026-06-30 | 2026-08-31 |
| 0.81 | ❌ Unsupported | 2025-12-19 | 2025-04-30 | 2026-06-30 |

### 3.2 macOS：`react-native-macos` 落后，但**0.84 正在 PR 栈里**

npm 上 `react-native-macos` 最高只有 **0.81.9**，peer `react-native: 0.81.6`（精确锁定）⇒ **直接接会要求把移动端降到 0.81.6，这是真降级**。

🟡 **但微软正在追赶，而且目标版本正好是 0.84.1**。
来源：[microsoft/react-native-macos#3098 — "React Native macOS 0.83–0.87: PR stack and release tracker"](https://github.com/microsoft/react-native-macos/issues/3098)（2026-09-21 开，最近 7 天内更新）。原文逐字：

> 「This tracker records the intended order for React Native macOS **0.83–0.87**. … Publication follows **0.83 → 0.84 → 0.85 → 0.86 → 0.87**.」
>
> - `chore(0.83): prepare stable 0.83.0 with React Native **0.83.10**`（#3022）
> - `chore(0.84): prepare stable 0.84.0 with React Native **0.84.1**`（#3031）← **与 heyta 完全相同**
> - `chore(0.85): prepare stable 0.85.0 with React Native **0.85.3**`（#3034）
> - `chore(0.86): prepare stable 0.86.0 with React Native **0.86.3**`（#3036）
> - `0.87 mainline`（#3037 / #3107）
>
> 「Checkboxes indicate merged PRs. **All active implementation PRs are open.**」

⇒ **0.84.0 尚未发布**（PR 是开的）。所以 macOS 是"**等**"，不是"不行"。

独立对比（[platform.uno, 2026-08-21](https://platform.uno/articles/react-native-windows-macos-versions-vs-dotnet-lts/)，Uno 是竞品，注意立场）：

> 「**React Native for Windows trails upstream by three minor series and macOS by six**」
> 「**Microsoft's support for React Native for Windows 0.84 is Active. What is Unsupported is the upstream 0.84.x series** that release corresponds to.」

### 3.3 🔴 一条必须先纠正的前提：**heyta 现在就已经在 RN 的不支持区**

来源：[reactnative.dev/releases/overview](https://reactnative.dev/releases/overview)（官方支持矩阵，逐字）

| RN 版本 | 状态 |
|---|---|
| 0.87.x | Active |
| 0.86.x | Active |
| 0.85.x | **End of Cycle** |
| **0.84.x** | 🔴 **Unsupported** |

> 「we're committed to maintain the **latest 3 minor series**」

**heyta 的 `apps/mobile` 在 RN 0.84.1 ⇒ upstream 已经是 Unsupported。**

🔴 **这条直接动摇 [ADR-0034](../adr/0034-windows-native-winui3-not-rnw.md) 的论证前提。**
ADR-0034 否决 RNW 的**唯一决定性理由**是：

> 「RNW 最新稳定版 = 0.84.0（`peerDep: RN 0.84.1`），**无 0.85+ 稳定版**；而 RN 上游已 0.87.1 ⇒ 选它 = 把 `apps/mobile` 一起冻在**出了支持窗口的 RN** 上。」

**但"冻结"这个词假设了一个不曾存在的状态**：heyta 的移动端**本来就在窗口之外**（0.84 = Unsupported），
**不是 RNW 把它推进去的**。三件事要分开：

| 命题 | 真假 |
|---|---|
| 「接 RNW 要求把移动端降级」 | ❌ **假**（RNW 0.84.0 peer 就是 RN 0.84.1，heyta 正在这里） |
| 「接 RNW 会阻止移动端升到 0.85+」 | ✅ 真（但这是"上限"，不是"降级"） |
| 「移动端现在是受支持的版本」 | ❌ **假**（0.84 已 Unsupported） |

⇒ **接 RNW 的边际成本不是"从受支持跌到不受支持"，而是"停在原地，换来 Windows 原生 UI + 共享 UI"。**
⚠️ 同时也要如实说：**移动端升级到 0.87 这件事本身就欠着，且与 RNW 无关**（见 §6 未核实项）。

---

## 4. 采用方式：Content Islands（微软自己在用的那一招）

**不要**"先决定全量重写，再动手"。Office 的做法是**增量**：

```
现有原生外壳（SwiftUI / WinUI 3 / GTK4）   ← 原封不动保留
        │
        ├─ 原生能力仍归外壳：窗口、菜单、托盘、通知、URL scheme、
        │  钥匙串、文件关联、系统小组件…
        │
        └─ 逐个视图替换为 RN 内容岛：
             视图 1（任务列表）→ 嵌入 RN
             视图 2（四象限）  → 嵌入 RN
             …
           未迁的视图继续用原生渲染 —— 两者并排、数据互通
```

**为什么这是本仓最该抄的一条**：
- 本仓**已经有**三个能跑的原生壳（冒烟 12/12、14/14、12/12）—— 不需要推倒，**只需要往里嵌 RN**。
- 本仓的 `packages/ui` **已经是** React Native 组件（30 个 `.tsx`，被 web/mobile 消费）—— **不需要重写，只需要多一个渲染目标**。
- "同一份 UI 契约"因此从"靠门禁保证"变成"**字面上就是同一份代码**"。
- 每一刀都可独立回退（Office 40+ 个体验就是这么一块块搬的）。
- 本仓早已有 brownfield/岛式遗留的先例可循：Callstack 的 [`react-native-brownfield`](https://oss.callstack.com/react-native-brownfield/docs/getting-started/ios)（把 RN 打包成 XCFramework 嵌进原生 iOS 应用）是这一类做法的现成工具。

---

## 5. 对我上一轮推荐的修正

| | 上一轮推荐（我） | **本轮修正后** |
|---|---|---|
| Windows UI | 原生壳 + **内嵌 WebView** 承载共享 UI | ✅ **RNW**（RN 渲染成 **WinUI/XAML 原生控件**） |
| 是否原生控件 | ❌ 不是（WebView） | ✅ **是** |
| macOS UI | 同 Windows | 🟡 **等 RN-macOS 0.84**；过渡期才用 WKWebView + `react-native-web` |
| 与 heyta 版本 | 无关 | ✅ **RNW 0.84.0 与移动端逐字对齐，零改动** |
| 是否需要"发明"机制 | 需要（要定壳↔UI 通道） | ❌ **不需要** —— 微软已把这套做成产品 |
| 有官方依据吗 | 无（我的综合） | ✅ **有**：微软官方博客 + 官方支持矩阵 + 官方 tracker |

🔴 **改这一刀的理由只有一条**：P2 说"原生的目的是获得原生能力/适配"，而我上一轮的 WebView 方案**主动放弃了原生控件**。
RNW 能在**不放弃任何东西**的前提下做到同样的事 —— 那么按 P1（复用优先）与 P2（原生），就没有理由再选 WebView。

**WebView 方案降级为 macOS 的过渡档**（等 RN-macOS 0.84 期间），不再是主方案。

---

## 6. 本轮**未核实**的（不许当结论用）

1. 🔴 **RNW 能否注册 Windows 系统小组件**（`IWidgetProvider`）—— **仍未找到任何真实先例**。这是 heyta 明确要的能力之一。⚠️ 但不能因此判定不行：RNW 应用是 **WinAppSDK Win32 且可打包 MSIX**，具备 packaged app 的前提；**必须实测**。
2. **RN-macOS 0.84.0 的发布时点** —— tracker 里 PR 是开的，**没有承诺日期**。
3. **RNW 0.84 与 RN-macOS 0.84 能否在同一 monorepo 共存**（两个 out-of-tree 平台、同一 RN 0.84.1）—— **没有找到先例**，需要 spike。
4. **`packages/ui` 现用组件在 RNW/RN-macOS 上的实际可用面** —— 本仓依赖 `lucide-react-native`、`react-native-svg`、`react-native-safe-area-context`，**这些在 RNW 上的支持度未逐项核实**（本仓 `research/tools/windows-native-gaps.mjs` 数出 4 个原生库 / 3 个缺口，那是基于 RNW 不可用的前提数的，**前提已变，需重跑**）。
5. **Hermes 在 RNW 上的状态** —— 未核实。
6. **heyta 移动端升到 RN 0.87 的路径与代价** —— 与本方案正交，但**欠着**，且 0.85 已 End of Cycle，**升级窗口在收窄**。
7. **Office 那 40+ 个体验是否包含 macOS** —— 该博客只讲 Windows；**不要推断 Office 在 macOS 上用 RN**。
8. 本文件所有"某公司怎么做"的结论均来自**其官方博客**，**未与当事人复核**。

---

## 7. 这份调研对仓库既有结论的影响

| 既有结论 | 出处 | 影响 |
|---|---|---|
| RNW 因"会冻结移动端在不受支持的 RN 上"被否决 | [ADR-0034](../adr/0034-windows-native-winui3-not-rnw.md) | 🔴 **前提被证伪**（§3.3）：移动端**本来就在** Unsupported 区；且 RNW peer 与 heyta **逐字对齐**。**该决策需要重开** |
| 「`packages/ui` 的价值对 Windows 归零」 | [ADR-0034](../adr/0034-windows-native-winui3-not-rnw.md) §4 | 🔴 **不成立**（§2.1/§2.2）：RNW 正是复用 `packages/ui` 且渲染成原生 XAML 的官方路径 |
| 「UI 复用度与原生性不可兼得」（我上一轮的三选一） | [multi-end-unified-strategy.md](../plans/multi-end-unified-strategy.md) §3.3 | 🔴 **这是个假两难**：RNW 同时给出两者。我上一轮的候选表**缺了 RNW 这一格** |
| 原生壳 + 内嵌 WebView 是唯一同时满足四约束的路 | 同上 §4.3 | 🟡 **降级为 macOS 过渡档** |
| macOS 原生壳"没有另开 ADR" | [desktop-native-migration.md](../plans/desktop-native-migration.md) §3 | ⚠️ 仍然没有；且 macOS 路线本身要改，**更需要一份** |
| Compose Multiplatform 未进入候选 | 本仓调研 | ✅ **结论不变**，但现在有了明确理由（§2.4：与 TS 核心不兼容），不再是"没查到" |

---

## 8. 来源清单（全部可复核）

| # | 来源 | 类型 |
|---|---|---|
| 1 | [Office modernize with WinAppSDK + React Native](https://devblogs.microsoft.com/react-native/2025-05-09-office-modernize/) | 微软官方博客 |
| 2 | [React Native 博客（Microsoft）— RNW v0.82](https://devblogs.microsoft.com/react-native/) | 微软官方博客 |
| 3 | [react-native-windows README](https://github.com/microsoft/react-native-windows) / [npm](https://www.npmjs.com/react-native-windows) | 官方仓库 |
| 4 | [RNW Support Matrix](https://microsoft.github.io/react-native-windows/support/) | 官方支持矩阵 |
| 5 | [RNW New vs Old Architecture](https://microsoft.github.io/react-native-windows/docs/new-architecture/) | 官方文档 |
| 6 | [React Native Releases Overview（支持矩阵）](https://reactnative.dev/releases/overview) | 官方支持矩阵 |
| 7 | [react-native-macos#3098 版本追赶 tracker](https://github.com/microsoft/react-native-macos/issues/3098) | 官方 issue |
| 8 | [react-native-macos README](https://github.com/microsoft/react-native-macos) | 官方仓库 |
| 9 | [Teams 2.0 → WebView2](https://techcommunity.microsoft.com/discussions/microsoftteams/teams-2-0-moves-away-from-electron-to-embrace-edge-webview2/2484565) | 微软官方社区 |
| 10 | [Compose Multiplatform 官方](https://kotlinlang.org/compose-multiplatform/) / [JetBrains 1.8.0 博客](https://blog.jetbrains.com/kotlin/2025/05/compose-multiplatform-1-8-0-released-compose-multiplatform-for-ios-is-stable-and-production-ready/) | 官方 |
| 11 | [Tauri 官方](https://v2.tauri.app/start/) / [Tauri vs Electron 2026](https://tech-insider.org/tauri-vs-electron-2026/) | 官方 + 对比 |
| 12 | [platform.uno：RN on Windows/macOS 版本现实](https://platform.uno/articles/react-native-windows-macos-versions-vs-dotnet-lts/) | ⚠️ **竞品立场**，仅取其可复核的版本数字 |
| 13 | [Callstack react-native-brownfield](https://oss.callstack.com/react-native-brownfield/docs/getting-started/ios) | 工具文档 |
| 14 | **npm registry 直查**（`react-native-windows` / `react-native-macos` / `react-native` 的 dist-tags 与 peerDependencies） | 🔴 **最高可信度** |

---

*本文件的版本事实以 npm registry 与官方支持矩阵为准；凡未核实者一律标"未核实"（§6）。*