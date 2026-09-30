# ADR-0031：每一端都交付原生应用；PWA 不是任何端的交付形态

> 状态：**已接受**（2026-09-29 确认；依据见文末 §6）
> 日期：2026-09-28
> 取代：无（**确认并收窄** [ADR-0024](0024-desktop-shell-and-ui-convergence.md) §2.5 的表述）
> ⚠️ **被 [ADR-0032](0032-windows-native-via-rnw.md) 收窄**：本文 §1.3/§3 用
> **"减少代码量"** 论证否决更原生的桌面方案，而 ADR-0032 明确
> **接受更大的代码量**（原生性优先于复用度）。⇒ 引用本文时请注意：
> **"Capacitor 被否决"这一条结论仍然成立**（它没有 Windows 平台，与代码量无关），
> 但**"因为代码多所以不选"这类论证不再有效**。
> 🔴 **Windows 一行又被 [ADR-0034](0034-windows-native-winui3-not-rnw.md) 取代**：
> ADR-0032 选的 react-native-windows **没有 ≥0.85 的稳定版**，选它会把 `apps/mobile`
> 一起冻在已出上游支持窗口的 RN 0.84.1 上。Windows 现定为
> **WinUI 3 / Windows App SDK 原生（C#）**。**引用 §3 结论 1 时以 ADR-0034 为准。**
> 🔴 **2026-09-29 再修订**：ADR-0034 又被 [ADR-0036](0036-main-battlefield-and-rn-single-source-ui.md) 取代。
> Windows 一行最终为 **`react-native-windows`（内容岛）** —— ADR-0034 的否决前提已被两条实测证伪
> （RNW 0.84.0 的 peer 与 heyta 逐字对齐；heyta 本来就在 RN Unsupported 区，不是 RNW 推进去的）。
> **引用 §3 结论 1 时以 [ADR-0036](0036-main-battlefield-and-rn-single-source-ui.md) 为准。**

## 1. 背景与约束

### 1.1 触发这次决策的一句话

> 「在 Windows 端上，我们希望是用 Capacitor 打包，而不是用那个 PWA，
> 我们希望是原生的 APP 应用，在各个端上都是原生的应用。
> 只是说希望尽可能减少我们的代码量。」

这句话里有一个**方向**和一个**具体工具**。方向与 [ADR-0024](0024-desktop-shell-and-ui-convergence.md)
（桌面壳 = Electron、UI 只写一份 RN 组件）一致；**具体工具在 Windows 上不成立**。
两者必须分开回答 —— 否则会为了一个不存在的工具去改一个已经能用的架构。

### 1.2 硬约束一：Capacitor 没有 Windows 目标

Capacitor 官方文档的平台导航只有三项：**iOS / Android / Web(PWA)**。
`npx cap add` 的取值也只有 `android` / `ios`。**没有 `windows`。**
（来源：<https://capacitorjs.com/docs/getting-started>，2026-09-28 抓取。）

也就是说 "用 Capacitor 打包 Windows" 这条路径**在技术上不存在**，
不是"配置麻烦"或"文档少"——是没有这个平台。

🔴 顺带一个容易混的点：Capacitor 的 Web 平台**本身**就是 PWA。
所以"用 Capacitor 而不用 PWA"在 Windows 上是自相矛盾的：
Capacitor 在 Windows 上能给的，恰恰就是 PWA 那一份。

### 1.3 硬约束二：Capacitor 渲染不了系统组件（**能力问题，不是代码量问题**）

heyta 的移动端是 React Native（`apps/mobile`），并且已经落地了**真原生小组件**：
WidgetKit（iOS）、App Widget（Android）、ArkTS 卡片（鸿蒙）。

Capacitor 是"Web 视图 + 插件"，它**渲染不了**这些平台的系统组件 ——
要小组件仍然得**手写各端原生代码**（这一点与
[`../research/desktop-shell-selection.md`](../research/desktop-shell-selection.md) §3 对鸿蒙的判定同构）。

⚠️ **2026-09-28 更正本条的有效论据。** 这里原本写的是"净效果会增加代码量，
与'减少代码量'的目标相反"。但 [ADR-0032](0032-windows-native-via-rnw.md)
已经明确**代码量不作为否决理由**（原生性优先）。所以本条**唯一有效的论据**
是上面那条**能力事实**：**Capacitor 给不了系统组件** ——
即便它能让代码变少，也不构成选它的理由。

### 1.4 硬约束三：Windows 这一端**已经能跑，但当时不是原生的**

`apps/desktop`（Electron）已有实测证据：

| 证据 | 位置 |
|---|---|
| `release/heyta-win32-x64` 产物产出 | [`../plans/multi-platform-adaptation.md`](../plans/multi-platform-adaptation.md) M2-4 |
| 打包件在**真 Windows** 上启动并建出完整 op-log schema（`heyta.sqlite`，6 张表） | [`../runbooks/desktop.md`](../runbooks/desktop.md) §5.6 |
| 开窗冒烟 `--window` 在真 Windows 上通过**并截图**（内容已人眼确认非空白） | [`../runbooks/desktop.md`](../runbooks/desktop.md) §5.5 |

而且它**复用的就是 `apps/web` 那一套**：`apps/desktop/package.json` 直接依赖
`@heyta/ui`，窗口里渲染的 `TaskList` 就是共享组件（冒烟断言的
`data-testid="task-row-*"` 由 `@heyta/ui` 自己打）。

**"原生应用"和"代码只写一份"这两件事，现在是同时成立的** —— 不需要引入新壳。

## 2. 选项

| 选项 | 优点 | 缺点 | 关键证据 |
|---|---|---|---|
| **A. 各端原生应用，共享 `packages/ui`**（现状） | Windows/macOS/Linux 走 Electron，iOS/Android/鸿蒙走 RN；**组件只写一份**；原生能力（小组件、SQLite、钥匙串）都在 | 需要维护两条壳（Electron + RN）；桌面端体积/内存大于纯 Web | 选项 1.4 的三条实测；ADR-0024 §2.1–2.2 |
| **B. Windows 改用 Capacitor 打包** | — | 🔴 **Capacitor 没有 Windows 平台**，做不了 | <https://capacitorjs.com/docs/getting-started>（平台导航只有 iOS / Android / Web） |
| **C. 全部端改用 Capacitor** | 只需一套 Web 代码 | ① Windows 仍无平台；② iOS/Android 的**系统小组件要重写原生**；③ 丢掉已有 RN 组件工作 | 选项 1.3；`../research/desktop-shell-selection.md` §3 |
| **D. Windows 交付 PWA（不装原生壳）** | 最省事，代码复用 100% | 拿不到 package identity ⇒ **注册不了 Windows 小组件**；系统集成最弱；离线/存储受浏览器约束 | `../research/desktop-shell-selection.md` §5、§7 |

## 3. 结论

1. **每一端的交付物都是"原生应用"**，不存在"某一端交 PWA 就行"。
   - **Windows → `apps/desktop-windows`（react-native-windows 原生）**
     —— ⚠️ **2026-09-28 由 [ADR-0032](0032-windows-native-via-rnw.md) 更新**。
     本条原文写的是"Windows → `apps/desktop`（Electron）"，
     而 **Electron 不是原生**，与本文自己第 1 句的要求矛盾。
     Electron 现降级为**过渡壳 / 基线 / 对照基准**。
   - macOS / Linux → `apps/desktop`（Electron，**如实标注为过渡**，
     原因见 [多端原生构建计划](../plans/desktop-native-migration.md) §3–§4：
     RN-macOS 卡在 0.81、RN 生态没有 Linux）
   - iOS / Android → `apps/mobile`（React Native）
   - 鸿蒙 → `apps/mobile/harmony`（RNOH 壳 + ArkTS 卡片）
2. **Capacitor 被否决**，理由**只有一条**（更正见 1.3）：
   Windows 上没有这个平台，且它渲染不了系统组件。
3. **"减少代码量"靠共享包实现，不靠换壳实现**：
   `packages/ui`（组件）、`packages/domain`（业务规则）、`packages/sync-core`（协议与加密）
   由各端共用；**换壳只会换掉最外层，换不掉这些**。
   ⚠️ 但请注意：**"代码量少"在本项目里已经不是决策依据**
   （[ADR-0032](0032-windows-native-via-rnw.md)：原生性优先）。
   这一条保留的**唯一**含义是"**别把共享包也复制多份**"。
4. **PWA 降级为"Web 端的可安装层"，不是任何端的交付形态。**
   ⚠️ 这一条**收窄**了 [ADR-0024](0024-desktop-shell-and-ui-convergence.md) §2.5 里
   "PWA 化价值上升"的表述 —— 那里说的"价值上升"指的是
   **Windows 小组件注册所必需的 package identity 这条技术路**（MSIX→Store），
   **不是**"Windows 可以交一个 PWA 了事"。两份 ADR 说的是两件事，此处明确边界。

## 4. 后果

- **不再评估 Capacitor。** 以后有人提"用 Capacitor 少写点代码"，直接引本 ADR §1.2/§1.3。
- 桌面端要继续承担 Electron 的体积与内存代价 —— 这是换取"一套 React 组件跑两端"付的价，
  已被 ADR-0024 §2.2 接受。
- **PWA 的工作不白做，但目标变了**：它服务的是
  ① Web 端可安装、② Windows 小组件的 package identity 路径。
  **不 service 任何"原生应用"的替代目标。**
- 多端验证的判据不变，且**必须以原生应用为准**：
  桌面 → [`../runbooks/desktop.md`](../runbooks/desktop.md)；移动 → `pnpm verify:mobile-*`。

## 5. 未核实项

1. **Electron 在 Windows 上注册系统小组件**是否可行 —— 上游 `electron#35751`
   「macOS Notification Center Widget」**Closed as not planned**，
   且**未找到**真实 Electron 应用带 WidgetKit / Windows 小组件的先例。
   所以"Windows 原生应用"与"Windows 小组件"目前是**两条独立的路**，
   后者仍押在 PWA + MSIX 上（见 `../research/desktop-shell-selection.md` §6）。
2. **Windows 打包件的可见窗口截图**仍未取得 —— 现有 Windows 证据是无头会话下
   进程内 `capturePage()` 拿的（`../runbooks/desktop.md` §5.5）。
3. **Linux 产物在 Linux 上运行**未实测。机器是有的
   （见 [`../runbooks/local-server-verification.md`](../runbooks/local-server-verification.md) §0），
   缺的是"去做"而不是"没有机器"。
4. Capacitor 未来是否会新增 Windows 平台 —— 按 §1.2 的抓取时点，**没有**。
   若上游新增，本 ADR 的 §1.2 需要重估（但 §1.3 的结论不受影响）。

---

## 6. 确认（2026-09-29）：状态由「待确认」改为「已接受」

### 6.1 为什么接受

本文的核心结论在 [ADR-0036](0036-main-battlefield-and-rn-single-source-ui.md) 落地后**被完整确认**，
不再有待决的不确定性：

| 本文结论 | 2026-09-29 的状态 |
|---|---|
| 每一端的交付物都是**原生应用** | ✅ **确认**：RN 全端（`react-native-windows` / `react-native-macos` / RN / RNOH）渲成各平台**原生控件**，Web 用 `react-native-web` |
| **PWA 不是任何端的交付形态** | ✅ **确认**：PWA 仍只作为 Web 端的可安装层与 Windows 小组件的 package identity 路径（§3 结论 4 的收窄仍成立） |
| **Capacitor 被否决**（没有 Windows 平台 + 渲染不了系统组件） | ✅ **确认**：与 [ADR-0032](0032-windows-native-via-rnw.md) §1.3 一致；ADR-0036 未改变这条 |
| "减少代码量"**不靠换壳**，靠共享包 | ✅ **确认**：ADR-0036 把 `packages/ui` 变成**字面上同一份代码**，正是这条的强化 |
| §3 结论 1 **Windows 一行** | 🔄 **三次改写**：0032（RNW）→ 0034（WinUI 3）→ **0036（RNW 内容岛）**。引用时**以 ADR-0036 为准** |

### 6.2 本文还有一处口径要注意

本文 §1.3 与 §3 结论 3 曾用"**减少代码量 / 代码量增加**"论证否决更原生的方案，
而 [ADR-0032](0032-windows-native-via-rnw.md) 已明确**代码量不是决策依据**（原生性优先）。
⇒ 引用本文时只采用它的**能力论据**（Capacitor 没有 Windows 平台、渲染不了系统组件），
**不要**引用它的代码量论据 —— 该口径已被后续 ADR 作废，正文保留不改（ADR 不可变）。
