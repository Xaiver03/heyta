# ADR-0036：主战场 = 移动端 + macOS + Windows；UI 单源 = React Native 全端（内容岛增量嵌入）

> 状态：**已接受**（⚠️ **2026-09-29 收窄，2026-09-30 补齐 macOS 那一格**：§3.2 里
> 「Windows → `react-native-windows`」与「macOS → `react-native-macos`」**两格都已被
> [ADR-0037](0037-desktop-ui-falls-back-to-webview.md) 取代** —— **桌面端（Windows / macOS / Linux）
> 改走 M2（原生壳 + 内嵌 Web UI）**，不渲染成原生控件。
> 「RN 全端」现收窄为：iOS / Android / 鸿蒙（已是 RN）+ Web（`react-native-web`）。**其余结论不变。**）
> ⚠️ **第一次收窄只点名了 Windows 那一格**（ADR-0037 的正文却已写"桌面端"），于是 macOS 那格
> 长期停在"等 RN-macOS 0.84"，与 ADR-0037 冲突 —— 2026-09-30 按产品负责人要求"先定案"补齐，
> **定案与可判定的重开条件见主计划 §4.3（`docs/plans/multi-end-unified-strategy.md`）**。
> 日期：2026-09-29
> 决策者：产品负责人（2026-09-28 指示，原话见 §1.1）
> **全部取代** [ADR-0032](0032-windows-native-via-rnw.md) 与
> [ADR-0034](0034-windows-native-winui3-not-rnw.md) —— 判决**只落在 UI 机制上**；
> ADR-0034 关于**跨语言通道**的实测结论（§1.3 / §1.4 / §1.5、§6：`Microsoft.Data.Sqlite` 全同步 API、
> Jint + `packages/storage` 契约 **50/50** 重放、D2 领域层单源成立）**继续有效并被本 ADR 保留**，见 §5.2。
> **部分取代** [ADR-0024](0024-desktop-shell-and-ui-convergence.md) §2.2 / §2.3（桌面壳 = Electron；
> "不用 `react-native-windows` / `react-native-macos`"）—— 它 §2.1（UI 只写一份 React Native 组件）
> 与"系统小组件不纳入 UI 收敛"的**显式例外被强化**，不是被推翻。
> **部分取代** [ADR-0031](0031-native-apps-everywhere-not-pwa.md) §3 结论 1 的 Windows 一行；
> 该文核心结论（每一端都交付原生应用、PWA 不是任何端的交付形态、Capacitor 被否决）**被本 ADR 确认**，
> 其状态由「待确认」改为「已接受」（见该文 §6）。
>
> 依据：[多端共享 UI：业界最佳实践调研](../research/multi-platform-best-practice.md)（补上仓库此前系统性缺失的联网检索）·
> [多端统一方案：主战场重定义 · UI 单源 · 原生外壳](../plans/multi-end-unified-strategy.md)（当前唯一权威主计划）

---

## 1. 背景与约束

### 1.1 触发：产品负责人的两句话

2026-09-28，产品负责人给了主战场与机制的明确指示（原话）：

> 「**Web 端根本就不是主战场**，移动端和我的 macOS 还有 Windows 端才是主战场，重点必须是这两个东西。」
> 「多端尽可能用**原生的壳**。同时又尽可能需要**复用一套代码**。实在不行就**复用一套设计系统**。」
> 「我用原生的目的是为了**实现各种原生的功能操作**。如果有其他的方法能达到同样的目的的话，用**共享 UI 也是可以的**。」
> 「**UI 组件是一定要复用的**，至少要是一套设计系统的。我们设计系统各种**设计变量必须得是统一管理的**。」

其中「如果有其他的方法能达到同样的目的的话」是一句**开放性授权**：它把"原生"的**手段性**说清楚了
（原生是手段，原生能力是目的），并同时把"复用一套代码"抬成首要目标。

### 1.2 硬约束（承接主计划 §1，效力从高到低，上位推翻下位）

| # | 约束 | 对设计的直接含义 |
|---|---|---|
| **P1** | **复用一套代码**是首要目标 | 任何"每个端再写一遍"的方案默认出局，除非 P2 证明非它不可 |
| **P2** | **原生外壳**，因为要**原生能力/原生适配** | 原生是**手段**；判断某处要不要原生，问"这里有没有只有原生才拿得到的平台能力" |
| **P3** | **UI 组件必须复用** | 手写 N 份 UI = 违反硬约束。UI 实现只能有一份 |
| **P4** | 底线：**一套设计系统**，设计变量统一管理 | 即使 P3 在某端做不到，token 也必须单源 + 生成到该端 |
| **P5** | 主战场 = **移动端 + macOS + Windows** | 功能交付以这三端为准；**Web 不再是功能首发地** |
| **P6** | 重要对标 = **本地滴答清单** | 它是"原生多端 + 一套设计语言"的现成存在证明 |

### 1.3 🔴 决定性新证据（2026-09-29 本机实抓，两条缺一不可）

[ADR-0034](0034-windows-native-winui3-not-rnw.md) 否决 `react-native-windows` 的**唯一决定性理由**是：

> 「RNW 无 0.85+ 稳定版 ⇒ 选它会把 `apps/mobile` 一起**冻在出了支持窗口的 RN** 上。」

**这条前提被两条实测同时证伪。**

**① RNW 0.84.0 与 heyta 逐字对齐，接进来零版本改动。**

```
$ curl -s https://registry.npmjs.org/react-native-windows |
    python3 -c "import json,sys; d=json.load(sys.stdin); print(d['dist-tags']['latest']);
                print(d['versions']['0.84.0']['peerDependencies'])"
0.84.0
{'react': '^19.2.3', '@types/react': '^19.1.1', 'react-native': '0.84.1'}
```

而 heyta 的 `apps/mobile/package.json` 实测是 `react: 19.2.3` + `react-native: 0.84.1`。
⇒ **`react-native` 版本完全相同（0.84.1），`react` 满足 `^19.2.3`。**
**接 RNW 不需要改移动端任何一行版本号** —— "接 RNW 要求降级"是**假**。
（同一次实抓：RNW `dist-tags.latest = 0.84.0`、无 `0.85`/`0.86`/`0.87` 稳定版，只有 `preview = 0.85.0-preview.2`；RN 上游 `latest = 0.87.1`。）

**② heyta 本来就在 RN 的不受支持区，不是 RNW 把它推进去的。**

[RN 官方支持矩阵](https://reactnative.dev/releases/overview)（2026-09 实抓，见调研 §3.3）：

| RN 版本 | 状态 |
|---|---|
| 0.87.x / 0.86.x | Active |
| 0.85.x | **End of Cycle** |
| **0.84.x** | 🔴 **Unsupported** |

> 「we're committed to maintain the **latest 3 minor series**」

heyta 的 `apps/mobile` 在 **RN 0.84.1** ⇒ **upstream 现在就已经是 Unsupported。**
⇒ "冻结"这个词假设了一个**不曾存在**的状态。三件事必须分开：

| 命题 | 真假 |
|---|---|
| 「接 RNW 要求把移动端**降级**」 | ❌ **假**（RNW 0.84.0 peer 就是 RN 0.84.1，heyta 正在这里） |
| 「接 RNW 会**阻止**移动端升到 0.85+」 | ✅ 真（但这是"上限"，不是"降级"） |
| 「移动端现在是**受支持**的版本」 | ❌ **假**（0.84 已 Unsupported） |

⇒ **接 RNW 的边际成本不是"从受支持跌到不受支持"，而是"停在原地，换来 Windows 原生 UI + 共享 UI"。**
⚠️ 同时如实说：**移动端升级到 0.87 这件事本身就欠着，且与 RNW 无关**（见 §6 第 5 条）。

**③ RNW 渲染的就是原生控件，且微软自己在用。**（这段不是版本事实，是机制事实，来源见 §2.1 与调研 §2）

- RNW 官方：*"React Native **uses WinUI under the covers** to support many native Windows controls"*、
  *"React Native is built on top of **Windows App SDK**"*；v0.82 起 *"the legacy Paper architecture has been fully
  removed. All applications now run exclusively on the New Architecture (Fabric), and this release also unlocks
  **XAML controls for community modules**"*。
- 微软 Office 官方博客：*"there are over **40 Office experiences which use React Native**"*，且用
  **content islands** *"embedded into existing Windows applications"* 增量迁移 —— **不做大爆炸重写**。

---

## 2. 选项

| 选项 | 原生**控件** | 一套代码 | UI 组件复用 | 一套设计系统 | 判定 |
|---|---|---|---|---|---|
| **A. RN 全端**（`react-native-windows` + `react-native-macos` + 移动端 RN + `react-native-web`）（**本 ADR 选它**） | ✅ | ✅✅ | ✅ **字面上同一份 `packages/ui`** | ✅ RN token 层（已存在） | 🥇 **业界最佳实践，且是微软自己在用的路** |
| **B. 各端手写原生 UI**（WinUI 3 / SwiftUI / GTK4，= 现状） | ✅ | ✅ 逻辑 | ❌ **3+ 份 UI** | ⚠️ 需补 C# / C 生成器 | ❌ **违反 P3** |
| **C. 原生壳 + 内嵌 WebView 承载共享 UI** | ❌ **不是原生控件** | ✅✅ | ✅ | ✅ | 🥈 **降级为 macOS 过渡档**（§3.4） |
| **D. Compose Multiplatform** | ✅ | ❌ **与 TS 核心不兼容** | ✅ | ✅ | ❌ 见 §3.5 |
| **E. 保持 Electron** | ❌ WebView 渲染 | ✅✅ | ✅ | ✅ | ❌ 不是原生控件，且与 P5 后仍需 Windows/macOS 原生壳（`../runbooks/desktop.md` §5.5–§5.6） |
| **F. Tauri** | ❌ **WebView2 渲染** | ✅ | ✅ | ✅ | ❌ 不满足"原生控件"前提（ADR-0024 另因 Tauri 只有异步 IPC 而否决它） |
| **G. PWA** | ❌ | ✅ | ✅ | ✅ | ❌ 不是原生交付形态（[ADR-0031](0031-native-apps-everywhere-not-pwa.md)） |

**"为什么不选看起来更显然的 B（继续手写）"** —— 因为 B 直接违反 P3，而 P3 是产品明确钉死的硬约束；
B 唯一看起来显然的理由是"原生"，但 A **同样是原生控件**，且额外满足 P1/P3/P4。**B 没有任何一项 A 给不了的东西。**

---

## 3. 结论

### 3.1 主战场定义

- **主战场 = 移动端（iOS / Android）+ macOS + Windows。** 功能交付、验收与排期以这三端为准。
- **Web 降为次要端**：它仍是渲染目标（`react-native-web`）与站点载体，但**不再是功能首发地**；
  以"Web 是主入口"为前提排出的旧优先级（如把日历列为 P0-2）**失效**，按主计划 §5.5 重排。
- **Linux 与 macOS/Windows 同架构**（同一套 RN 平台实现路线），但**不做专项功能**；
  它是否投入、何时投入另见主计划 §10-Q2（⚠️ 至今没有 Linux 桌面用户的证据）。
- **系统小组件不在此列**：它是平台强制的原生 UI，见 §3.2 的例外。

### 3.2 UI 单源 = 用 React Native 作**唯一** UI 实现

**`packages/ui` 是唯一一份 UI 实现**（React / RN 原语 + 纯视图模型），各端只提供**渲染目标**：

| 端 | 渲染方式 | 是否原生控件 | 状态 |
|---|---|---|---|
| iOS / Android | React Native（现有 `apps/mobile`） | ✅ | ✅ **已是** |
| HarmonyOS | RNOH | ✅ | ✅ **已是** |
| ~~**Windows**~~ | ~~`react-native-windows`（WinAppSDK Win32 / WinUI / XAML）~~ | ~~✅~~ | 🔴 **已被 [ADR-0037](0037-desktop-ui-falls-back-to-webview.md) 取代** ⇒ **WinUI 3 原生壳 + 壳内 WebView2 加载共享 UI**（实测：补上要求 MSVC v145 仍 `0xC0000409`、无窗口） |
| ~~**macOS**~~ | ~~`react-native-macos`（AppKit）~~ | ~~✅~~ | 🔴 **同样被 ADR-0037 取代** ⇒ **SwiftUI 原生壳 + 壳内 WKWebView 加载共享 UI**（RN-macOS 版本硬冲突：`0.81.9`/peer `0.81.6` vs heyta `0.84.1`；重开条件见主计划 §4.3） |
| Linux | 同桌面端 M2 路线 | ❌（壳原生、UI 共享） | 与 macOS/Windows 同架构，不做专项（§3.1） |
| Web | `react-native-web` | —— | ✅ **已是** |
| **系统小组件（全端）** | **各端原生载体**（WidgetKit / App Widget / ArkTS 卡片 / Windows provider） | ✅ | ✅ **已裁决的例外** |

> 🔴 **唯一的 UI 重复是系统小组件，且它是平台强制的**：组件必须由平台自己的载体绘制。
> 沿用 [ADR-0024](0024-desktop-shell-and-ui-convergence.md) §2.1 的例外 ——
> 小组件是 **3 份原生 UI（Swift / Kotlin / ArkTS）+ 1 个 JSON 模板**，共享的是 `v: 1` JSON 契约而非 UI 代码；
> **禁止**把 headless-JS 组件库（如 `react-native-android-widget`）拖进来。
> 这条例外**不随本 ADR 收敛**，也不构成本 ADR 要消灭的"多份 UI"问题。

**设计变量（P4）**：Windows / macOS 的 UI 样式走 **RN token 层**
（`packages/design-system/src/generated/tokens.native.ts`，**已存在**）⇒ **不需要新建 C# / C 生成器**，
P4 **自动成立**。只剩外壳自己的 chrome（菜单 / 托盘 / 窗口）需要极少量的生成值。

### 3.3 采用方式 = **Content Islands（内容岛）**，增量嵌入，不推倒重写

**依据是微软 Office 的公开做法**：Office 有 **40+ 个体验**用 RN 构建，通过 **content islands**
*"embedded into existing Windows applications"* 逐块嵌入既有原生应用，**不做大爆炸重写**；
岛屿之间可互操作、可跨平台传数据（调研 §2.1）。

heyta 的具体做法：

```
现有原生外壳（WinUI 3 / SwiftUI / GTK4）   ← 原封不动保留，负责原生能力
        │
        ├─ 原生能力仍归外壳：窗口、菜单、托盘、通知、URL scheme、
        │  钥匙串、文件关联、系统小组件…
        │
        └─ 逐个视图替换为 RN 内容岛：
             「任务列表」→ 嵌入 RN（渲染 packages/ui 的同一份组件）
             「四象限」  → 嵌入 RN
             …
           未迁的视图继续原生渲染 —— 两者并排、数据互通
```

- **不推倒**：本仓三个原生壳（macOS / Windows / Linux）已在跑通的无头冒烟里验证过，
  只需要**往里嵌 RN**，不是重写。
- **不重写 UI**：`packages/ui` 已经是 RN 组件（被 web / mobile 消费），只需要**多接两个渲染目标**。
- **每一刀独立可回退**：这正是 Office 40+ 个体验的迁移形状。
- **"同一份 UI 契约"从"靠门禁保证"变成"字面上就是同一份代码"**（P3 的直接兑现）。

### 3.4 为什么不是 WebView（含 Teams 2.0 的差别）

WebView 路线（原生壳 + 内嵌 `react-native-web`，或 Tauri / Electron）**主动放弃原生控件**：

1. **它不满足 P2 的目的**：产品要原生是为了**原生功能操作**，而 WebView 里的 DOM 既不是原生控件，
   也拿不到 XAML / AppKit 的原生控件能力。
2. **RNW 在同一复用度下严格更好**：两者都是"同一份 `packages/ui` 源码"，但 RNW 渲成
   **WinUI / XAML 原生控件**，且能与原生控件**并排渲染、数据互通**。既然 P1（复用）与 P2（原生）都不受损，
   **就没有理由再选 WebView**。
3. ⚠️ **Teams 2.0 换 WebView2 不是反例，是另一个权衡**：Teams 的 UI 本来就是 Web 应用（Angular→React），
   换 WebView2 是"把同一个 Web UI 换个宿主"，**JS 渲染目标没变**；而 heyta 的共享 UI 是 **RN 组件而非 DOM**
   （调研 §2.3）。

⇒ WebView 方案**降级为 macOS 的过渡档**（等 `react-native-macos` 0.84 期间兜底），**不再是主方案**。

### 3.5 为什么不是 Compose Multiplatform

CMP 技术上最强（iOS 自 **1.8.0** 起 Stable，Desktop / Web 都在），是唯一能在
iOS + Android + macOS + Windows + Linux 共享同一份 UI 代码的成熟方案 —— **但它要求 Kotlin。**

🔴 **KMP 消费不了 TypeScript。** heyta 最大的资产是 TS 的 `packages/`
（`domain` 17.6k 行、`app-host` 63 个动作、`storage` / `op-log` / `sync` / `ai`），
而 [ADR-0003](0003-multi-platform-strategy.md) 把"业务逻辑只能在 `packages/`"定成硬约束。
KMP 的原生互操作只有 C / ObjC（本仓 `research/deep-dive-cross-language-and-components.md` 已实测这一条）。

⇒ 选 CMP = **要么把 TS 核心重写成 Kotlin，要么让 UI 与逻辑分属两个生态。两者都违反 P1。**
（这条以前在仓库里是"**没查到所以没进候选**"，现在有了明确理由：**查到了，明确排除**。）

---

## 4. 与既有 ADR 的取代 / 修订链（显式写清）

ADR 编号只增不改，所以这里把这条链一次写清。**ADR-0024 的正文不改**，关系只在本 ADR 说明。

```
ADR-0024（已接受，2026-09-27）
  桌面壳 = Electron；UI 收敛 = RN + react-native-web；否决 RNW / RN-macOS
        │
        ├─ 02.2 / §2.3 被部分取代（桌面壳不再是 Electron 的唯一形态）
        └─ §2.1（UI 只写一份 RN 组件）+ 系统小组件例外 ── 被本 ADR 强化
                │
                ▼
ADR-0032（已取代，2026-09-28）  Windows 走 react-native-windows
        │  被 ADR-0034 全部取代
        ▼
ADR-0034（已被取代，2026-09-28 → 2026-09-29）  Windows 走 WinUI 3 原生
        │  🔴 否决 RNW 的唯一决定性前提被证伪（§1.3-①/②）
        │  ⚠️ 其跨语言通道实测结论（§1.3/§1.4/§1.5/§6）保留有效
        ▼
ADR-0036（本文件，已接受，2026-09-29）
  主战场 = 移动端 + macOS + Windows；UI 单源 = RN 全端 + 内容岛
        │
        └─ 同时确认 ADR-0031（每端原生交付、PWA 非交付形态）→ 该文状态改为「已接受」
```

| 既有 ADR | 关系 | 说明 |
|---|---|---|
| [ADR-0003](0003-multi-platform-strategy.md) | **不变** | 逻辑在 `packages/`、apps 只做壳；本 ADR 能成立的前提 |
| [ADR-0004](0004-ui-stack.md) | **不变** | UI 栈 = React Native；本 ADR 是它的落地路径 |
| [ADR-0024](0024-desktop-shell-and-ui-convergence.md) | **部分取代** | §2.2 / §2.3（桌面壳 = Electron、否决 RNW/RN-macOS）被取代；§2.1 与小组件例外被强化 |
| [ADR-0031](0031-native-apps-everywhere-not-pwa.md) | **确认 + 部分取代** | 核心结论确认（状态改「已接受」）；§3 结论 1 的 Windows 一行以本 ADR 为准 |
| [ADR-0032](0032-windows-native-via-rnw.md) | **已取代** | 由 ADR-0034 取代，最终指向本 ADR；其"Capacitor 无 Windows 平台"等记录仍有效 |
| [ADR-0034](0034-windows-native-winui3-not-rnw.md) | **全部取代**（限 UI 机制） | 见其 §7「勘误 / 取代」；跨语言通道结论保留 |

⚠️ **"部分取代"的读法**：不是"那份 ADR 全错"。ADR-0024 里"UI 只写一份 RN 组件"与
"系统小组件不纳入收敛"这两条**仍然是本 ADR 的基础**；被换掉的只是"桌面壳用 Electron"这一个选择。

---

## 5. 后果

### 5.1 正面

- **`packages/ui` 成为跨端唯一真源**：Windows / macOS / Web / 移动端 / 鸿蒙消费**同一个 workspace 包**。
  ADR-0034 §4 的"`packages/ui` 的价值对 Windows 归零"**不成立**。
- **`apps/mobile` 的版本上限**是唯一代价，而**不是降级**（§1.3-②）—— 移动端本来就在 0.84。
- **P4 自动满足**：设计变量走已存在的 RN token 层，**不需要** C# / C token 生成器。
- **`native-bridge` 的窄门面缺口（4–5 / 63）可能整个消失**：内容岛直接消费 `packages/app-host`，
  与 web / mobile 同路；顺带消除主计划 §2.4 实测的**排序漂移**（桌面走共享 `sortTasksForDisplay`）。
- **P3 的兑现方式升级**：从"靠门禁保证两边契约相同"变成"**字面上同一份代码**"。
- **系统小组件路径更短**：RNW 是 WinAppSDK Win32 且可 packaged MSIX，具备注册 provider 的前提（但仍需实测，§6 第 3 条）。

### 5.2 ADR-0034 的跨语言通道结论**保留**（不随 UI 机制一起否掉）

本 ADR 判决的是 **UI 机制**，下列**实测结论继续有效**，它们是**跨语言通道**的证据，
与 Windows 用不用 RNW **无关**，且在本仓可能仍有用途（Linux GTK4 壳、既有 Electron 基线）：

| 来自 ADR-0034 | 状态 |
|---|---|
| §1.3 微软有**官方 C# widget provider 教程**（"RNW 只能 C++/WinRT"是选 RNW 造成的） | ✅ **保留** |
| §1.4 `Microsoft.Data.Sqlite` 是 **ADO.NET 全同步** API，"同步驱动"是**栈相关**而非 Windows 平台性质 | ✅ **保留** |
| §1.5 heyta 真实原生依赖是 **4 个 / 3 个缺口**（不是生态 2.8%），且已做成 `research/tools/windows-native-gaps.mjs` | ✅ **保留**（但清单需按 RNW 前提**重跑**，§6 第 2 条） |
| §6 领域层 spike：**D2 成立** —— 同一份 `@heyta/domain` bundle 在 node vm 与 .NET Jint 上 **22/22 逐条一致** | ✅ **保留**（D2 路线的可行性证明） |
| §6.2 **C1 结清**：未改一行的 `SqliteAdapter` 在 Jint 上跑完 `packages/storage` 契约 **50/50**，并抓出两个"默认值就是错的"陷阱 | ✅ **保留** |
| §6.2 附加实测：跨语言编组开销、Jint `CatchClrExceptions` / `LimitMemory` 的进程级风险 | ✅ **保留** |

⚠️ **但换到 RNW 后，Windows 侧大概率不再需要 Jint / C# SQLite 驱动**（RNW 自带 JS 引擎）——
**"不再需要"不等于"被证伪"**：这些结论是**已测事实**，本 ADR 只是不再把它们当作 Windows 的**前置**。
替换还是并存，由 S1 spike 定（§6）。

### 5.3 门禁必须同步扩张（否则新壳就是新盲区）

- `check:design` 的 `SCAN_ROOTS`、`check:layering`、`check:native-deps`、`check:licenses` 覆盖新壳目录。
- **新增 UI 单源门禁**：断言桌面平台消费的 `packages/ui` 与 web / mobile **是同一个 workspace 包**
  （`check:row-single-source` 已有基础，扩到桌面）；把数据源换成硬编码**必须转红**。
- **新增排序单源断言**：桌面路径与 `sortTasksForDisplay` 同序（改坏即红）。
- `check:macos-shell` / `check:windows-shell` / `check:linux-shell`：**接线**进 `pnpm check`，
  非本机平台**响亮跳过**并打印原因（**不是静默通过**）。
- 非 npm 依赖（NuGet）已有 `check:licenses:nuget`；接 RNW 后 npm 侧 `check:licenses` 照常覆盖。

---

## 6. 代价与未核实项（**不许当结论用**）

1. 🔴 **`react-native-macos` 0.84 尚未发布。** npm `latest = 0.81.9`、`peer: react-native 0.81.6`
   （2026-09-29 实抓）⇒ 现在直接接是**真降级**。追赶 PR 栈
   [microsoft/react-native-macos#3098](https://github.com/microsoft/react-native-macos/issues/3098) 里
   `chore(0.84): prepare stable 0.84.0 with React Native 0.84.1`（#3031）**是开的、未发布**，
   且**微软没有承诺日期**。等待期用 WebView 过渡档（§3.4）。
2. 🔴 **RNW 上的 SQLite 驱动未定。** 移动端用 `@op-engineering/op-sqlite`，其官方支持列表
   **不含 Windows**。要么另选、要么自写驱动。⚠️ `research/tools/windows-native-gaps.mjs` 数出的
   "4 个原生库 / 3 个缺口"是**基于 RNW 不可用的错误前提**数的，**必须重跑**（S1-0）。
3. 🔴 **RNW 能否注册 Windows 系统小组件（`IWidgetProvider`）——仍无任何真实先例。**
   ⚠️ **不能因此判不行**（RNW 是 WinAppSDK Win32 + 可 packaged MSIX，具备前提），但**必须实测**。
4. **`packages/ui` 现用组件在 RNW / RN-macOS 上的实际可用面未逐项核实**
   （`lucide-react-native` / `react-native-svg` / `react-native-safe-area-context`）。
5. **移动端升级到 RN 0.87 这件事欠着，且与本 ADR 正交**；`0.85` 已 End of Cycle，**升级窗口在收窄**。
   本 ADR 不做这件事，也不因为不做而否定它。
6. **RNW 0.84 与 RN-macOS 0.84 能否在同一 monorepo 共存**（两个 out-of-tree 平台 + 同一 RN 0.84.1）——
   **没找到先例**，需要 spike。
7. **Hermes 在 RNW 上的状态未核实**；RNW 自带 JS 引擎后 Jint 桥的去留待 S1 定。
8. **S1 spike 是唯一门槛**：在现有 `apps/desktop-windows` 壳里嵌一个 RN 内容岛，渲染 `packages/ui`
   组件、读**真数据**、与 XAML 控件**并排**，并做两条反假通过。**S1 未过之前，本 ADR 的 A 方案是
   "有最佳实践依据的推荐"，不是已证事实。**
9. **Office 那 40+ 个体验是否含 macOS** —— 微软那篇博客只讲 Windows，**不要推断 Office 在 macOS 上用 RN**。

---

## 7. 决策摘要（一句话）

**主战场是移动端 + macOS + Windows（Web 降为次要、不再是功能首发地）；UI 只写一份 React Native 组件
（`packages/ui`），Windows 用 `react-native-windows`、macOS 用 `react-native-macos`、Web 用
`react-native-web`、系统小组件保持各端原生（ADR-0024 的例外）；采用方式是微软 Office 式的
content islands 增量嵌入 —— 因为 RNW 0.84.0 与 heyta 的 RN 0.84.1 逐字对齐（零版本改动），
而 heyta 本来就在 RN 不受支持区，ADR-0034 的否决前提不成立；不选 WebView（放弃原生控件）、
不选 Compose Multiplatform（KMP 消费不了 TS，会逼 TS 核心重写）。**