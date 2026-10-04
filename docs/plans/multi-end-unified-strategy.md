# 多端统一方案：主战场重定义 · UI 单源 · 原生外壳

> 状态：**已定案（Q1 已于 2026-09-28 按最佳实践修订，见 §10）；T1/T2 与计划层收敛已执行（见 §11）**
> 起草日期：2026-09-28（CST）
> 🔴 **本文件是当前唯一的权威主计划。** 计划层的入口是 [`README.md`](README.md)。
> 用户旅程与认证的**单一事实源**是 [`user-journey-and-auth.md`](user-journey-and-auth.md)（**各端不得自行发明第二套旅程**；注册/登录一律前置）。
> 上位文件：[roadmap.md](roadmap.md)。本文件**取代** roadmap §5「下一步动作」的口径。
> 收敛的旧计划：见 §8 存废表（6 份被取代、4 份被吸收）。
>
> 🔴 **本文件在 2026-09-28 被自己的调研推翻过一次**：`../research/multi-platform-best-practice.md` 补上了
> 仓库此前**系统性缺失的联网检索**，并证明 **§3.2 的"桌面 UI 复用被堵死"是错的**（只看了 `latest` 标签，没看 `peerDependencies`）。
> 修订处：§3.2 / §3.3 / §4.2 / §4.3 / §4.4 / §7.1 / §7.2 / §10-Q1 / §11。
> **保留修订痕迹而不是抹掉** —— 这是本仓对"计划层漂移"的标准处置。

---

## 0. 这份方案回答什么

产品负责人（2026-09-28）的原话是三个问题加三条约束：

> 「目前是不是后端的进展远大于前端？各端是不是前端功能完全没有对齐？代码到底复用的怎么样？是不是一套代码，多端可以复用？」
>
> 「**Web 端根本就不是主战场**，移动端和我的 macOS 还有 Windows 端才是主战场，重点必须是这两个东西。」
> 「多端尽可能用**原生的壳**。同时又尽可能需要**复用一套代码**。实在不行就**复用一套设计系统**。」
> 「我用原生的目的是为了**实现各种原生的功能操作**。如果有其他的方法能达到同样的目的的话，用**共享 UI 也是可以的**。」
> 「**UI 组件是一定要复用的**，至少要是一套设计系统的。我们设计系统各种**设计变量必须得是统一管理的**。」

一句话结论（详见 §2、§3）：

> **不是"后端超前于前端"，而是"Web 前端超前于桌面前端"。**
> 逻辑层是真正的单源（做得好）；**但桌面三个原生壳各自手写了一份 UI，这恰好违反了本次钉死的"UI 组件必须复用"**。
> 因此本方案的第一动作不是"给桌面补功能"，而是**先把桌面 UI 变成共享实现，再谈功能**。

本文件同时是**既有全部多端调研的收敛处**（§8），并对**滴答清单实机取证**（§5）给出可排期的对标结论。

---

## 1. 决策前提（已钉死，不可再讨论）

按效力排序 —— 上位推翻下位：

| # | 约束 | 对设计的直接含义 |
|---|---|---|
| **P1** | **复用一套代码**是首要目标 | 任何"每个端再写一遍"的方案默认出局，除非 P2 证明非它不可 |
| **P2** | **原生外壳**，因为要**原生能力/原生适配** | 原生是**手段**。判断某处要不要原生，问的是"这里有没有一个只有原生才拿得到的平台能力" |
| **P3** | **UI 组件必须复用** | 手写 N 份 UI = 违反硬约束。UI 的实现只能有一份 |
| **P4** | 底线：**一套设计系统**，**设计变量统一管理** | 即使 P3 在某个端做不到，token 也必须单源 + 生成到该端。**当前 C#(WinUI3) 与 C(GTK4) 两个端连这条底线都没达到** |
| **P5** | 主战场 = **移动端 + macOS + Windows** | 功能交付以这三端为准；**Web 不再是功能首发地** |
| **P6** | 重要对标 = **本地滴答清单** | 见 §5。它是"原生多端 + 一套设计语言"的现成存在证明 |

🔴 **P2 与 P3 的关系是本方案的核心**：它们**不冲突**。原生外壳 ≠ 原生控件重画 UI。
移动端已经是这个形状的**现成存在证明**：`apps/mobile` 是原生 RN 外壳，渲染的却是 `packages/ui` 的**同一份**组件，token 来自 `packages/design-system` 的**同一份** `tokens.css`。

---

## 2. 现状实测（全部为 2026-09-28 本仓实测，非印象）

### 2.1 各端体量：落后的不是"前端"，是**桌面前端**

| 端 | 文件 / LOC | 提交数 | 界面形态 |
|---|---|---|---|
| `apps/web` | 351 / **46,610** | **86** | 18 个 feature 目录、9 个视图 |
| `apps/mobile` | 167 / **29,890** | 38 | 5 个 tab + 15 个 screen |
| `apps/landing` | 166 / 16,549 | 15 | 营销页（非应用） |
| `apps/desktop`（Electron） | 14 / **1,393** | 9 | **1 个页面，无导航** |
| `apps/desktop-macos`（SwiftUI） | **951 行 Swift** | 6 | 1 个 `ShellView` |
| `apps/desktop-linux`（GTK4/C） | 1,546 行 C | 3 | 同一个薄切片 |
| `apps/desktop-windows`（WinUI3/C#） | 683 行 C#/XAML | 6 | 同一个薄切片 |

> `server/` 56 个提交、`packages/domain` 31、`packages/app-host` 32。**全仓 434 个提交里 Web 占最多（86）**。
> ⇒ 「后端 >> 前端」不成立；成立的命题是 **「Web 前端 >> 桌面前端」**。

### 2.2 桌面壳的能力覆盖：**4–5 / 63**

| 层 | 有多少 | 桌面壳露了多少 |
|---|---|---|
| `packages/app-host` 写入动作（9 族） | **63 个方法**（实测逐族求和：20+9+7+2+9+11+3+2+0） | **4–5 个**（≈7%），全在 task 一族 |
| `packages/ui` 共享组件 | **30 个 `.tsx`**；`index.ts` 导出 **296 个符号**（含组件、纯视图模型与常量） | **0** |
| `packages/design-system/generated/HeytaTokens.swift` | 19,331 字节，专为 Swift 生成 | **0 消费者** |

`packages/app-host/src/native-bridge.ts:41-43` 自己就写着这个缺口：

> ⚠️ 已知缺口（不要假装没有）：`TaskView` 目前只覆盖"列出来 + 勾完成 + 新建 + 删"。象限、清单、标签、重复、备注编辑都**还没有**门面。

### 2.3 逻辑层是真的单源（这部分做得好，应保留）

- 三个桌面原生壳加载**同一个字节**的 `packages/app-host/bridge-bundle/native-bridge.js`，各自只实现「同步 SQLite 驱动 + 窄 JSON 门面」。
- 机器保证：`check:crosslang-contract` 把 `packages/storage` 的 **50 条契约断言一字不改**在 Jint 里重放，**50/50**。
- 三个壳的无头冒烟各自通过（macOS 14/14、Linux 12/12、Windows 12/12）。
- 引擎选型：macOS = 自带 JavaScriptCore；Linux = `libjavascriptcoregtk-4.1`；Windows = Jint 4.16.4。

### 2.4 **已实测的具体漂移：桌面与 web/mobile 的任务顺序不一致**

| 位置 | 排序规则 |
|---|---|
| 共享视图模型 `packages/ui/src/task-list/model.ts:86` `sortTasksForDisplay` | **完成态 → 截止日（无截止排最后）→ 原序** |
| 桌面门面 `packages/app-host/src/native-bridge.ts` `listTasks` | **`(createdAt, id)`** |

⇒ 同一个账号，桌面壳与 web/mobile **任务顺序不同**。这不是 bug 的大小问题，是**"第二个真相源"的形状**——本仓自己的硬纪律明确禁止，而它就这样存在于唯一一份桌面门面里。

### 2.5 设计系统：**P4 底线当前没达到**

`packages/design-system/src/generate.ts:5-11` 的生成目标只有两个：

```
*   - generated/HeytaTokens.swift      iOS / SwiftUI
*   - generated/HeytaTokens.ets        HarmonyOS / ArkUI (ArkTS)
```

| 端 | 需要的 token 形态 | 现状 |
|---|---|---|
| iOS / SwiftUI | `HeytaTokens.swift` | 生成 ✅ / **消费 0** ❌（见下方 🔴） |
| 鸿蒙 / ArkTS | `HeytaTokens.ets` | 生成 ✅ |
| mobile / RN | `src/generated/tokens.native.ts` | ✅ |
| web | `tokens.css` | ✅ |
| **macOS 原生壳**（现状：手写 SwiftUI） | 复用 `.swift` 即可 | **0 消费者** ❌ |
| **Windows / WinUI3**（现状：手写 XAML） | **没有 C# 生成器** | ❌ **不存在** |
| **Linux / GTK4**（现状：手写 C） | **没有 C 生成器** | ❌ **不存在** |

⇒ 按**当前**（各端手写原生 UI）的形状，桌面三壳的样式**没有任何 token 来源**，是裸值。

> 🔴 **但这张表的紧迫性已被 §3.3 / §10-Q1 的修订大幅降低**：若桌面改走 **RN 平台实现**，
> Windows/macOS 的 UI 样式走的是 **RN token 层**（`tokens.native.ts`，**已存在**），
> ⇒ **不需要 C# / C 生成器**，P4（设计变量单源）**自动成立**。只剩壳自己的 chrome（菜单/托盘/窗口）需要极少量的值。
> **这张表因此是"现状快照"，不是"待办清单"** —— 它的待办身份取决于 Q1 的落地结果（见 §4.4-G0）。

### 2.6 计划层本身碎片化（这是"旧的东西"的最大一块）

| 分类 | 份数 | 行数 |
|---|---|---|
| 多端 / 桌面 | **6** | **13,735** |
| AI 线 | 12 | 4,804 |
| 主线 / 其他 | 6 | 4,934 |
| 订阅 / 计费 | 6 | 1,650 |
| **合计** | **30 份** | **25,117 行** |

其中 **15 份已明确标注"已完成/已执行/已实现/已交付"**。
「多端/桌面」既是最重要的战线，又是最碎的一片 —— 同一个问题在 6 份文件里各有一个版本的答案。
**这正是"看到很多功能却不知道做到哪了"的直接原因。** 收敛方案见 §8。

### 2.7 文档与代码的漂移（实测 4 处，全部已定位到行）

| # | 文档说法 | 实测 | 处置 |
|---|---|---|---|
| 1 | `desktop-native-migration.md` 的 W1-2 与 §9「W1 WinUI 3 渲染最小切片」两行：「通道**有门禁**（`check:windows-shell` 12/12）」 | 根 `package.json` **没有**这个 script；同文件的 §10.3 自己已标为假声明，**正文两处仍留着** | ✅ **已修**：两处改为"脚本存在但未接进 `pnpm check`"，并指向 §6.3-T3 |
| 2 | `multi-platform-adaptation.md` 复述 `pnpm check` 链时写了 `check:status-bar` | `check` 链里**没有** `check:status-bar`（实际相邻的是 `check:web-storage` / `check:web-migration`） | ✅ **已修** |
| 3 | `desktop-packaging-handoff.md`「`.gitignore` 里没有 `dist/`」 | **假**：`.gitignore:2` 就是 `dist/`（`release/` 在 `:10`） | ✅ **已修** |
| 4 | 同文件 §3「Windows MSIX 卡在 `Add-AppxPackage` 0x80070005」 | **已被解决**：`apps/desktop-windows/evidence/packaged-first-run.txt` 记录 `ADD_APPX=OK` / `RESULT=OK` / `WINDOW_RECT=1152x587` | ✅ **已修**（并行会话先改到一半，本轮补全） |
| 5 | `desktop-native-migration.md` W1-2「界面本身尚未渲染」 | **假**：`MainWindow.xaml` 存在且已渲染真实列表 | ✅ **已修** |

另：`AGENTS.md` §2 仓库地图原先**缺**四个桌面壳的行（`desktop-native-migration.md` §10.3 已自查出，尚未补）⇒ ✅ **已补**（`apps/desktop` + 三个原生壳）。

🔴 **这几处共同说明一件事**：本仓最危险的失效不是"代码写错"，而是**文档声称已接线/未渲染/卡住，而代码早已不是那样**。
上面第 1 条尤其典型 —— **"脚本存在"被写成了"有门禁"**，中间差的那一步（接进 `pnpm check`）没有任何门禁会发现它缺失。

---

## 3. 三个必须裁决的矛盾

### 3.1 矛盾一：三份"桌面路线"互相不一致，且现行那份没被批准

| 文件 | 状态 | 它说的桌面路线 | UI 复用 |
|---|---|---|---|
| [`ADR-0024`](../adr/0024-desktop-shell-and-ui-convergence.md) | **已接受** | 桌面 = **Electron**（+RNW） | ✅ macOS/Linux/Windows 都复用 `packages/ui` |
| [`ADR-0034`](../adr/0034-windows-native-winui3-not-rnw.md) | **待确认** | Windows = **WinUI 3 原生** | ❌ 「`packages/ui` 的价值对 Windows **归零**」 |
| **实际落地** | —— | macOS = SwiftUI、Windows = WinUI3、Linux = GTK4，**三个原生壳** | ❌ 三个壳各自手写，**0 共享组件** |

两条**已接受的 ADR 之间的冲突**：ADR-0024（已接受）说桌面复用共享 UI；而 macOS/Linux 的原生壳**没有任何 ADR 授权**（`desktop-native-migration.md:230-232` 自述"没有另开 ADR，是 ADR-0034 的 D2 路线第三次被复用"），ADR-0034 本身又**尚未确认**。
⇒ 现状是**实现跑在决策前面**，而且跑出来的形状**违反 P3**。

### 3.2 矛盾二：桌面 UI 复用这条路 —— 🔴 **Windows 没被堵住，只有 macOS 被堵住**

> ⚠️ **本节在 2026-09-28 被推翻并重写。** 原文写的是"这条路技术上被堵住了"，那是**只查了 `latest` 标签、没查 `peerDependencies`、也没查上游支持矩阵**得出的结论。
> 完整调研见 [`../research/multi-platform-best-practice.md`](../research/multi-platform-best-practice.md)。

**① Windows：`react-native-windows@0.84.0` 与 heyta 的移动端逐字对齐**

```
react-native-windows@0.84.0  peerDependencies = {
  "react":        "^19.2.3",
  "react-native": "0.84.1",     ← 精确锁定，与 heyta 完全相同
}
```

heyta 的 `apps/mobile`：`react-native: 0.84.1`、`react: 19.2.3`。
⇒ **接 RNW 不需要改移动端任何版本号。** RNW 0.84 且是微软 **Active** 支持阶段。

**② macOS：确实落后（`latest` 0.81.9，peer RN 0.81.6），但 0.84 在微软的 PR 栈里**

[microsoft/react-native-macos#3098](https://github.com/microsoft/react-native-macos/issues/3098) 原文：`chore(0.84): prepare stable 0.84.0 with React Native **0.84.1**`（#3031），追赶顺序 `0.83 → 0.84 → 0.85 → 0.86 → 0.87`，**PR 目前是开的、尚未发布**。
⇒ macOS 是"**等**"，不是"不行"。

**③ 🔴 最关键的一条：ADR-0034 的论证前提被证伪**

ADR-0034 否决 RNW 的唯一决定性理由是「选它 = 把 `apps/mobile` 一起冻在**出了支持窗口的 RN** 上」。
但 [RN 官方支持矩阵](https://reactnative.dev/releases/overview) 实测：

| RN 版本 | 状态 |
|---|---|
| 0.87.x / 0.86.x | Active |
| 0.85.x | End of Cycle |
| **0.84.x** | 🔴 **Unsupported** |

**heyta 的移动端现在就在 0.84.1 ⇒ 本来就在窗口之外。**

| 命题 | 真假 |
|---|---|
| 「接 RNW 要求把移动端**降级**」 | ❌ **假**（RNW 0.84.0 peer 就是 RN 0.84.1） |
| 「接 RNW 会**阻止**移动端升到 0.85+」 | ✅ 真（是"上限"，不是"降级"） |
| 「移动端现在是**受支持**的版本」 | ❌ **假**（0.84 已 Unsupported） |

⇒ **接 RNW 的边际成本不是"从受支持跌到不受支持"，而是"停在原地，换来 Windows 原生 UI + 共享 UI"。**
⚠️ 但移动端升级到 0.87 这件事**本身就欠着**，且与 RNW 无关（0.85 已 End of Cycle，**窗口在收窄**）。

### 3.3 矛盾三：我上一轮的候选表**漏了一格**，于是造出一个假两难

> ⚠️ 本节同样被重写。我上一轮把选项限定成"手写原生 UI / RN / WebView"三选一，**漏掉了 `react-native-windows` 这一格**，并因此得出"原生与 UI 复用不可兼得"的结论。**那是个假两难。**

| 候选 | 原生**控件** | 一套代码 | UI 组件复用 | 一套设计系统 | 判定 |
|---|---|---|---|---|---|
| **A. 各端手写原生 UI**（= 现状） | ✅ | ✅ 逻辑 | ❌ **3 份 UI** | ⚠️ 需补 C#/C 生成器 | ❌ 违反 P3 |
| **B. RN 全端**（**RNW + RN-macOS**） | ✅ | ✅✅ | ✅ | ✅ | 🥇 **最佳实践，且是微软自己在用的路** |
| **C. 原生壳 + 内嵌 WebView** | ❌ **不是原生控件** | ✅✅ | ✅ | ✅ | 🥈 **降级为 macOS 过渡档** |
| D. Compose Multiplatform | ✅ | ❌ **与 TS 核心不兼容** | ✅ | ✅ | ❌ 见 §3.4 |
| ~~E. 各端手写~~ | —— | —— | —— | —— | 同 A |

**为什么不只是"可选"，而是"最佳实践"**：

1. **RNW 渲染的就是原生控件。** 微软官方：*"React Native **uses WinUI under the covers** to support many native Windows controls"*、*"React Native is built on top of **Windows App SDK**"*。RNW v0.82 起*"legacy Paper architecture has been fully removed… **unlocks XAML controls for community modules — Windows apps can seamlessly mix native XAML controls with React components**"*。
2. **微软自己就是这么干的。** Office 官方博客：**40+ 个 Office 体验用 RN**，且用 **content islands**「embedded into existing Windows applications」增量迁移 —— **不做大爆炸重写**。
3. **它比 WebView 严格更好。** WebView 主动放弃原生控件，而 RNW 不放弃任何东西。既然 P1（复用优先）+ P2（原生）都不受损，**就没有理由再选 WebView**。
4. **它让"同一份 UI 契约"从"靠门禁保证"变成"字面上就是同一份代码"。**

**采用方式 = Content Islands（内容岛）**：三个原生壳**原封不动保留**（它们负责原生能力与自家平台特性），**逐个视图往壳里嵌 RN**；未迁的视图继续原生渲染，**两者并排、数据互通**。每一刀独立可回退。

> **C 的诚实代价**（保留，因为它仍是 macOS 的过渡档）：WebView 里 UI **不是原生控件** ⇒ 放弃一部分原生手感（P2 允许，但不是首选）。

### 3.4 为什么 Compose Multiplatform 不进候选（这次有明确理由）

CMP 技术上最强（iOS 已 Stable、覆盖 Desktop/Web），**但它要求 Kotlin**。
heyta 最大的资产是 **TypeScript 的 `packages/`**（domain 17.6k 行、app-host 63 个动作、storage/op-log/sync/ai），而 **KMP 消费不了 TS**（原生互操作只有 C/ObjC）。
⇒ 选 CMP = 把 TS 核心重写成 Kotlin，或让 UI 与逻辑分属两个生态。**两者都违反 P1。**
**这条以前是"没查到"，现在是"查到了但明确排除"。**

---

## 4. 目标架构（统一方案）

### 4.1 四层职责矩阵

```
┌─ L4 原生外壳 ────────────────────────────────────────────────┐
│ 每端一份，只放"只有原生才拿得到的东西"。不含任何业务/展示逻辑。 │
├─ L3 共享 UI ─────────────────────────────────────────────────┤
│ packages/ui —— **唯一一份 UI 实现**（React/RN 原语 + 纯视图模型）│
├─ L2 共享逻辑 ────────────────────────────────────────────────┤
│ packages/{domain,app-host,storage,op-log,sync-*,shared-schema, │
│           ai,local-api,widget-core,i18n}                      │
├─ L1 设计系统 ────────────────────────────────────────────────┤
│ packages/design-system —— tokens.css 单源，**生成**到每一端     │
└──────────────────────────────────────────────────────────────┘
        ▲ 单向依赖，禁止反向
```

### 4.2 每端形态（目标态）

| 端 | L4 外壳 | L3 共享 UI 的渲染方式 | 原生能力（L4 存在的理由） |
|---|---|---|---|
| **iOS / Android** | React Native（**已是原生**） | **RN 渲染** `packages/ui` ✅ 现状即目标 | WidgetKit / App Widget、Live Activity、Share Extension、通知、App Intents |
| **HarmonyOS** | RNOH | RN 渲染同一份 ✅ | ArkTS 卡片 |
| **Windows** | **WinUI 3 原生壳** | ✅ **M2：壳内 WebView2 加载 `packages/ui`（经 `react-native-web` 的那份产物，与 `apps/web` 字面上同一份代码）**（[ADR-0037](../adr/0037-desktop-ui-falls-back-to-webview.md)） | Win11 小组件、Toast、跳转列表、文件关联、URL scheme、凭据管理器 |
| **macOS** | **SwiftUI 原生壳** | ✅ **M2：壳内 WKWebView 加载同一份产物**（同上；已接成常设门禁 `check:macos-window`） | 菜单栏、托盘、**WidgetKit / Continuity**、通知、URL scheme、钥匙串、Finder |
| **Linux** | GTK4 / C | 同 macOS（M2；**是否投入待定**，§10-Q2） | 托盘、通知、`.desktop` 集成 |
| **Web** | —— | `react-native-web`（自身即渲染目标） | —— |
| **系统小组件（全端）** | 各端原生 | ❌ **不共享**（已裁决的例外） | 见 [`ADR-0024`](../adr/0024-desktop-shell-and-ui-convergence.md) §「例外」 |
| **landing** | —— | ❌ 不共享（永久豁免） | 营销页，实测静态引 `@heyta/ui` 会让首屏 **+61.9 kB gzip / +31%** |

> ⚠️ **系统小组件是所有端唯一合理的 UI 重复**，且这个重复是**平台强制的**（每个平台的组件都必须是该平台的原生 UI）。它**不**构成本方案要消灭的"3 份 UI"问题。

**🔴 这张表的关键变化（2026-09-30 更正）**：移动端（iOS / Android / 鸿蒙）的 L3 是 **RN 渲染成原生控件**；
而**两个桌面端的 L3 是 M2 —— 原生壳 + 壳内 WebView 加载同一份 `packages/ui` 产物**。

⚠️ 本表此前写的是"Windows → RNW、macOS → RN-macOS，都渲染成原生控件"，那**已被实测否掉**
（RNW：补上它要求的 MSVC v145 后**仍是同一个崩溃、仍然无窗口**；RN-macOS：版本硬冲突，见 §4.3）。
**"渲染成原生控件"对桌面端不再是目标态** —— 桌面端的目标态是"原生**壳** + 共享 UI"，
原生能力（窗口/菜单/托盘/通知/URL scheme/小组件/钥匙串）来自壳，不来自控件。

**采用方式**：现有 WinUI3 / SwiftUI 壳**不推倒**；共享 UI 整块**或逐视图**嵌进去，
未迁视图可继续原生渲染，两者并排、数据互通。

### 4.3 L3 的机制候选（✅ 结论已定，依据见 §3.2/§3.3）

| 机制 | UI 组件复用 | 原生**控件** | 今天可行吗 | 定位 |
|---|---|---|---|---|
| ~~**M1a. `react-native-windows`**~~ | ✅ 逐字复用 | ✅ **WinUI/XAML** | 🔴 **实测否掉** | **出局**（S1 spike：补上要求的 MSVC v145 后仍 `0xC0000409`、仍无窗口 ⇒ 工具集不是变量） |
| ~~**M1b. `react-native-macos`**~~ | ✅ 逐字复用 | ✅ **AppKit** | 🔴 **版本硬冲突** | **搁置**（npm 最高 **0.81.9**，peer `react-native: 0.81.6` **精确锁定**；heyta 在 **0.84.1**，官方要求同 minor ⇒ 要用它得把移动端降到 0.81 或维护两条 RN 版本流。上游 RN 已 0.87.1，macOS 落后 **6 个 minor**，追赶 tracker [#3098](https://github.com/microsoft/react-native-macos/issues/3098) **没有承诺日期**） |
| ✅ **M2. 原生壳 + 壳内 WebView 加载 `react-native-web` 产物** | ✅（同一份 UI 源码） | ❌ **非原生控件** | ✅ 今天，**且已实测通过并接成门禁** | ✅ **两个桌面端的现行路线**（Windows 6/6 旅程 + macOS `check:macos-window`） |
| **M3. 共享视图模型 + 各端渲染器** | ❌ 只剩契约 | ✅ | ✅ | **仅个别视图的逃生舱**（违反 P3，不默认） |
| ~~M4. 各端手写~~ | ❌ | ✅ | —— | **出局**（违反 P3） |

#### 🔴 macOS 这一格的**定案与重开条件**（2026-09-30；产品负责人要求"先定案"，本条即那次的结论）

**定案：macOS 的目标机制 = M2（SwiftUI 原生壳 + 壳内 WKWebView 加载共享 UI）。**
**不是**"过渡到 RN-macOS 的原生控件"—— 此前 §4.2 那张表把 RN-macOS 写成"macOS 主方案、WKWebView 只是过渡档"，
与本节及 ADR-0037 冲突，已按本节更正。

两条依据，缺一不可：

1. **RN-macOS 今天不可用**（版本硬冲突，不是"难"）：`0.81.9` + peer 精确锁 `0.81.6` vs heyta 的 `0.84.1`。
2. 🔴 **"等版本对齐"本身就不是充分条件。** RNW **就是**版本逐字对齐的（`0.84.0` ↔ RN `0.84.1`），
   结果补上它要求的工具集后**仍然崩在 CRT 初始化、窗口从未出现**。
   ⇒ 所以"等 RN-macOS 0.84 发布"这条旧到期条件**不成立**，不能再拿它当排期依据。

**重开条件（写成可判定的，不写成"以后再看"）**：同时满足下面三条，才重开 macOS 原生控件那一格 ——

| # | 条件 |
|---|---|
| 1 | `react-native-macos` 发布一个 **peer RN 与 heyta 当前 minor 对齐**的版本（今天是 `0.84.x`），且采用它**不需要**把 `apps/mobile` 降级或维护两条 RN 版本流 |
| 2 | 一次 spike 证明**能出窗口**（不是"能编过"）、**能渲染 `packages/ui`**、**交互能写回壳的存储** 三条同时成立 |
| 3 | 该 spike 的产物有人看过截图，且判据能因注入转红 |

⚠️ 只满足条件 1 **不构成重开理由**（RNW 的教训：版本对齐 ≠ 能用）。

### 🔴 2026-09-29 更新：**结论已改为 M2**（S1 实测把 M1a 否掉了）

见 [ADR-0037](../adr/0037-desktop-ui-falls-back-to-webview.md) 与 §7.1c：

| 机制 | 今天的判定 |
|---|---|
| **M1a（RNW）** | 🔴 **否掉**。JS 侧成立（`packages/ui` 零改动进 bundle），**原生侧不成立**：RNW 0.84 要求 MSVC v145；**补上 v145 后仍是同一个崩溃、仍然无窗口** ⇒ **工具集不是变量** |
| **M1b（RN-macOS）** | 🟡 **一并搁置**（落后 6 个 minor，且 M2 不需要它） |
| ✅ **M2（原生壳 + 内嵌共享 Web UI）** | ✅ **现行路线**。三样前提今天全部已就位：能出窗口的原生壳（MSIX 装上且窗口已截图）/ `Microsoft.Web.WebView2` 已在 NuGet 许可证清单 / `packages/ui` 已被 `apps/web` 以 `react-native-web` 消费 |
| **M3** | 仅个别视图逃生舱（不变） |

#### ✅ M2 的门槛（M2-A）已实测通过（2026-09-29）

报告：[`../research/spikes/m2-webview-shell/README.md`](../research/spikes/m2-webview-shell/README.md)（含截图与两份回执）。

| 子问题 | 状态 |
|---|---|
| **M2-A**：共享 UI（`packages/ui`）能不能在**原生壳里的 WebView2** 里渲染出来？ | ✅ **通过** |
| **M2-B**：壳能不能把**它自己的真数据**交给这份 UI？ | ✅ **通过** |
| **M2-C**：共享 UI 里的**交互**能不能写回壳的 SQLite？ | ✅ **通过**（见下） |
| **M2-D**：🔴 **真应用**能不能在壳里跑起来、且**注册/登录前置**成立？ | ✅ **通过**（见下） |
| **M2-macOS**：同一件事在 **macOS（WKWebView）** 上成立吗？ | ✅ **通过**，且**已接成常设门禁** |

**实测证据**（`windows-pc`，WinUI 3 + WebView2 Runtime 154.0.4258.37）：

```
M2A_NOTE=M2-A：共享 UI 已渲染 "{\"slice\":1,\"rows\":4,\"title\":\"heyta\"}"
WINDOW_RECT=52,52,1152x587   RESULT=WINDOW_OK   PNG bytes=45256
构建：DOTNET_EXIT=0 / 15s / 0 警告 0 错误
```

**截图人眼确认**：原生 WinUI 3 chrome（标题/输入框/添加按钮）与共享 UI（"写 M1 切片验证"标题、
带 `⚠ 已逾期` / `□ 高` 徽章的任务行）**同屏并存** —— 那正是 M2 的全部主张。

**反假通过**：把 `HEYTA_WEB_ROOT` 指向空目录 ⇒ 探测变成 `slice:0, rows:0, title:heyta.local`（404 页）
⇒ 断言**转红**。**同一份断言在两种输入下给出相反结论**，这条才是它能承重的证据。

**实现要点**（三条刻意的决定）：
1. **不用 `file://`**，用 `SetVirtualHostNameToFolderMapping("heyta.local", …)` ——
   `file://` 下没有正常 origin，service worker / fetch / module 的行为都与真浏览器不同，
   那样测出来的"能渲染"不能代表真实形态；
2. **断言取组件自己打的 testID 计数**（`[data-testid^="task-item-"]`），
   而不是"界面上有字" —— "窗口出来了" ≠ "共享 UI 渲染出来了"；
3. **轮询而不是固定 sleep** —— 固定 sleep 在慢机器上假失败、在快机器上白等。

#### 🔴 这个 spike 自己翻过一次车（记下来，因为它很容易重犯）

**第一版的断言是错的，而它在界面上说了谎。**
`ExecuteScriptAsync` 返回的是**被 JSON 编码过一次**的字符串（`"{\"slice\":1,…}"`），
我第一版用 `probe.Contains("\"rows\":")` 去匹配 —— 那个子串在 `\"rows\":` 里**根本不存在**，
于是**界面明明渲染了 4 行，状态栏却写着「没有渲染出共享行」**。
修法：先 `JsonSerializer.Deserialize<string>()` 取出内层 JSON 再解析。

📌 与 §7 里 `aka.ms` 那条（HTTP 200 ≠ 拿到 exe）**是同一类问题**：
**拿 `Contains` 或状态码去猜，必须换成结构化解析。**

#### ✅ M2-B 也通过了：壳的**真数据**驱动了共享 UI（2026-09-29）

```
SEED_VERIFY=3                                    ← 壳的库真有 3 条（经 smoke 工具的播种模式）
M2A_NOTE=M2-B：壳推了真数据、共享 UI 渲染了 "{\"host\":1,\"rows\":3,\"note\":\"…已收到 3 条（原始 638 字节）\"}"
RESULT=WINDOW_OK
```

**截图人眼确认**：**同一个窗口**里，**手写的原生 ListView**（3 条真任务 + 复选框）与
**共享 `packages/ui` 的 UI**（同样的 3 条）**同时存在**。⇒ **一份数据、两个渲染器、一个窗口。**

**反假通过**：把壳里"推数据"那一步注入成空操作（`if (false && _api is not null)`）
⇒ `pushed=0` / `rows:0` ⇒ 断言**转红** ⇒ 还原（`diff` 空）⇒ 复绿（`rows:3`）。

#### ✅ M2-C 也通过了：**交互写回壳的 SQLite**（2026-09-29）

```
WRITE_HANDLED=1     ← 壳收到并处理了 1 次写
DB_DONE=1           ← 壳**自己的 SQLite** 里已完成数 0→1
WRITE_NOTE=M2-C ✅ 读+写都成立：…；写处理 1 次，库里已完成 0→1
```

**通道**：读走 `ExecuteScriptAsync` → `window.__heytaSetTasks(<json>)`；
写走 `window.chrome.webview.postMessage(...)` → 壳的 `WebMessageReceived`。
**用 WebView2 自己的通道，不自造轮子。**

🔴 **判据取的是壳读自己的库（`_api.ListTasks()`），不是页面里的 DOM 状态** ——
DOM 变了只说明共享 UI 重画了，那与"数据真的写下去了"是两件事。

🔴 **页面刻意不做乐观更新**：写完等宿主把新列表推回来再重画。
乐观更新会让"写失败"看起来像"写成功"（列表已经变了）。**慢一点，但对得上。**

**两项反假通过**（都还原复绿、`diff` 为空）：
- 写处理器注入成空操作 ⇒ `WRITE_HANDLED=0` / `DB_DONE=0` / `🔴 写方向没成立`；
- **顺带抓到一个真实的两渲染器不一致**：第一次跑通后看截图发现**写完之后只有 WebView 被推了新列表、
  手写的原生 ListView 没刷新** ⇒ 上方"全未完成"、下方"完成 1 条"——**同一份数据、同一屏、两个相反的答案**。
  修法一行（写完调 `Refresh()`）。📌 那条手写列表本来要被 M2 替换掉，
  **但在它被删掉之前，它不许说谎。**

⚠️ **M2-C 只验了"勾完成"一种 op** —— 新建 / 删除 / 改标题 / **同步**都**未接**。

#### ✅ M2-D 也通过了：**真应用在壳里跑起来，注册/登录前置成立**（2026-09-29）

```
PROBE="{\"host\":0,\"rows\":0,\"signin\":1,\"capture\":1,\"note\":\"\"}"
M2-D ✅ 桌面壳里的真应用：注册/登录入口 1 个、采集框 1 个 —— **前置成立**（冷启动第一屏就可达）
```

一个环境变量 `HEYTA_WEB_MODE` 切换两种模式：`shell`（最小通道入口，验 M2-A/B/C 的机制）
与 **`app`（`apps/web` 的真应用，验旅程）**。分开是刻意的：通道要确定性场地，旅程要真应用。

**截图人眼确认**：壳里画出来的是真应用 —— hepta 标题 + **收藏箱**侧栏 + 搜索框 +
日期/倒计时 tab + **未同步** + 右上角**蓝色的「登录 / 注册」**。

⇒ 🔴 **桌面端冷启动第一屏就有注册/登录入口**，正是产品负责人钉死的那条
（"注册/登录一定要前置，不能藏在设置里"）。而这份界面**就是 `apps/web` 的构建产物**。

**反假通过**：`HEYTA_WEB_ROOT` 指向空目录（**只改环境变量，不必重编**）
⇒ `signin:0, capture:0` ⇒ `🔴 真应用没画出来` ⇒ 断言转红。

🔴 **这一步不能说明什么（重要）**：
**壳里的真应用用的是浏览器 IndexedDB，不是壳的 SQLite。**
M2-C 的读写通道验的是 `?shell=1` 那个最小入口；真应用**还没接到壳的存储上**。
⇒ 现在的形态是：**旅程 UI 完整（含前置登录）+ 数据落在 WebView 自己的 IndexedDB 里**，
与壳的 SQLite **是两份**。**把真应用的存储指到壳的 SQLite 是下一步。**
（截图里上方手写 ListView 显示壳的 3 条、下方真应用显示它自己的空库 ——
那**本来就不是同一份数据**，不是 bug，是这条限制的可见形态。）

#### ✅ M2-macOS 也通过了：**两个桌面端现在都有完整旅程 UI + 前置登录**（2026-09-29）

macOS 壳（SwiftUI）加了 `WKURLSchemeHandler` + `SharedWebView`，加载的是**与 Windows 逐字相同的产物**
（`apps/web/dist`，同一个入口）。

```
M2_MACOS_NOTE=M2-macOS ✅ 桌面壳里的真应用：注册/登录入口 1 个、采集框 1 个 —— **前置成立**
```

**截图人眼确认**：原生 SwiftUI chrome 在上，**共享 UI 在下** —— hepta + **收藏箱** + 今天 +
搜索 + 日期/倒计时 + **未同步** + 🔴 **「登录 / 注册以…」** + 0/0。

🔴 **与 Windows 一致地用自定义 scheme（`WKURLSchemeHandler`），不用 `file://`** ——
那条理由（`file://` 没有正常 origin，测出来的"能渲染"不代表真实形态）在 Windows 侧写过，
这里不能双标。

**✅ 已接成常设门禁**：`check:macos-window` 现在会带上 `HEYTA_WEB_ROOT` 启动壳，
并断言**壳里的真应用在冷启动第一屏就画出身份入口头像**，且**点开后菜单第一项是
登录/注册、未登录时没有「退出登录」**（2026-09-30 改锚点，见
`docs/plans/user-journey-and-auth.md` §3.1）。
⇒ **macOS 的"注册/登录前置"从此有常设验收，且能因注入转红**。

**两项反假通过**：
- 门禁里把产物目录指空 ⇒ `🔴 壳里的真应用没有把注册/登录前置：…(heyta error 404.)` ⇒ **exit=1**；还原复绿。
- 直接跑壳、产物指空 ⇒ `M2-macOS 🔴 主框架没加载成（provisional）：…404.`

🔴 **这一轮又抓到我自己的一个真 bug**：macOS 侧只实现了 `didFail`，**没实现
`didFailProvisionalNavigation`** —— 而"主框架根本没加载成"（404／目录不存在）走的是后者
⇒ 那条失败路径**没有任何回调**，探测不启动、证据一个字不写，
看起来像"证据丢了"而不是"断言转红了"。**两条都必须实现。**

#### 🔴 M2-B 顺手回答了 **G4**：窄门面的缺口**不会自动消失**，而且是实打实的

实测形态：窄门面（`TaskView`：id/title/done/completedAt/note）**能**驱动
"手写的 3 列 ListView"，**驱动不了共享 UI** —— 后者要完整 `Task`（优先级/截止/标签/重复/…）。
⇒ 共享 UI 上桌面时门面**必须**补出实体级出口：本轮给桥加了 **`listTaskEntities()`**
（返回完整实体；C# 侧**不建模、原样转发**，壳保持最薄）。

⚠️ 它是**只读**的：**写方向**（共享 UI 的交互回到壳）**仍未设计** ——
`shell-host.tsx` 的 `onToggleTask` 是**空函数**，**刻意不假装做到**
（"点了没有反应"比"点了看起来生效其实没写"好）。

⚠️ **M2 仍不能说明的事**（不许当结论用）：MSIX 打包形态未验；性能未测；
写方向未接；**只验了 Windows**（macOS 的 WKWebView / Linux 的 WebKitGTK 同理但未做）。

⚠️ **M2 的代价已认账**（ADR-0037 §5）：桌面端 UI **不是原生控件**。
⚠️ **M2 自己的未知数**（⇒ M2 的 spike）：壳 ↔ WebView 的通道形态；SQLite 仍由壳持有（冒烟已跑通），WebView 不碰存储。

**（以下为修订前的原文，保留作修订痕迹）**

**结论：M1a 立即开工，M1b 随 0.84 发布接入，M2 只在 macOS 等待期兜底。**

**M1a 的必须先验证的未知数**（⇒ §7.1 的 spike S1）：
1. 🔴 **`packages/ui` 实际能用多少**：本仓依赖 `lucide-react-native`、`react-native-svg`、`react-native-safe-area-context`，**它们在 RNW 上的支持度未逐项核实**。⚠️ 本仓 `research/tools/windows-native-gaps.mjs` 数出的"4 个原生库 / 3 个缺口"是**基于 RNW 不可用的前提**数的，**该前提已变，必须重跑**。
2. **RNW 能否注册 Windows 系统小组件**（`IWidgetProvider`）—— **仍无先例**，但 RNW 应用是 WinAppSDK Win32 且可 packaged MSIX，**具备前提，必须实测**。
3. **内容岛与现有 Jint 桥的关系** —— 接 RNW 后 Windows 侧大概率**不再需要 Jint**（RNW 自带 JS 引擎），要确认是替换还是并存。
4. **SQLite 驱动**：RNW 上要用 RN 生态的 SQLite（本仓移动端用 `@op-engineering/op-sqlite`），而**该库官方只列 iOS/Android/macOS/web，不含 Windows** ⇒ 需另选或自写驱动。

**M2 的未知数**（仅当被迫用 macOS 过渡档时才需验证）：壳 ↔ WebView 的通道形态；SQLite 仍由壳持有（已跑通 12–14/14 冒烟），WebView 不碰存储。

### 4.4 必须补的地基（无论 M1/M2/M3 都要做）

| # | 事项 | 现状 | 判据 |
|---|---|---|---|
| **G0** | 🔴 **P4 因 Q1 修订而大幅变简单** | —— | **接 RN 平台实现后，Windows/macOS 的 UI 样式走的是 RN token 层**（`packages/design-system/src/generated/tokens.native.ts`，**已存在**），**不再需要 C# / C 的 token 生成器**。设计变量单源因此**自动成立**（P4 直接满足）。⚠️ 只剩"原生外壳自己的 chrome"（菜单/托盘/窗口）需要极少量的值，那部分才需各自生成 |
| ~~G1~~ | ~~C# (WinUI3) token 生成器~~ | —— | ✅ **不再需要**（见 G0）。**仅当 S1 失败而退回"各端手写原生 UI"时才需要** |
| ~~G2~~ | ~~C (GTK4) token 生成器~~ | —— | 同上。Linux 若走 RN 也不需要；若维持 GTK4 手写则需要 |
| **G3** | **Swift token 真被消费** | ✅ **已完成（2026-09-29）** | 见下方 |

#### §4.6 G3 的解法与证据（2026-09-29）

**改动前**：`HeytaTokens.swift` 生成 19,331 B、**0 消费者** —— 等于 P4（设计变量单源）在 macOS 端没兑现。

| 文件 | 动作 |
|---|---|
| `apps/desktop-macos/scripts/sync-tokens.sh` | **新建**。把生成物从 `packages/design-system/generated/` 同步进壳的 **UI target**（`Sources/HeytaMac/Generated/`）。带 `--verify` 模式 |
| `apps/desktop-macos/.gitignore` | 忽略 `Sources/HeytaMac/Generated/` —— **派生物不入库**（入库就是第二份设计变量） |
| `apps/desktop-macos/Sources/HeytaMac/HeytaMacApp.swift` | chrome 的间距/字号改为 `HeytaTokens.Light.*`（**10 处**） |
| `scripts/check-macos-shell.mjs` | 加两步：先**同步**生成物（干净检出也能构建），再**断言壳真的在消费**（≥5 个 `HeytaTokens.Light.*` 命中，否则 exit 1） |

**三个必须说明的技术点**：
1. **目标必须是 `HeytaMac`（UI target）而不是 `HeytaShellCore`** —— 生成物里的 `enum HeytaTokens` 是 **internal**，跨 SwiftPM target 不可见。
2. 🔴 **几何/字号一律取 `HeytaTokens.Light`，这不是笔误**：生成物里 **Light 有 193 个成员**（颜色+几何+字排），**Dark 只有 58 个、全是颜色**（`tokens.css` 的 `[data-theme='dark']` 只覆盖颜色）⇒ `Dark.space6` **根本不存在**，编译就过不去。我第一版就是这么写的。
3. **源真一致性不在这条门禁里验** —— 那是 `check:tokens`（比对**入库的**生成物与 `tokens.css`）的职责。

**验证（实际输出）**：
```
✅ macOS 壳消费设计系统生成物：命中 7/7 个断言项。
✅ 跨语言那一层 + 落盘 全部通过。            → exit=0
swift build --product HeytaMac                → Build complete! exit=0
（删掉派生物后重跑：门禁自动重新同步 → 仍 exit=0，验证干净检出路径）
```

**反假通过（已做，且当场抓出门禁自身的一个缺陷）**：
- 把 `HeytaMacApp.swift` 里所有 `HeytaTokens.Light.*` 换成裸值 `12` →
  `❌ macOS 壳没有在消费设计系统生成物 …… 实际命中 0 个` → **exit=1**；还原后复绿。
- 🔴 **第一版门禁有缺陷**：它先 `--verify` 报 ❌、随后**又同步覆盖掉、最后 exit 0** ——
  那是本仓明令禁止的"看着在跑、其实没验"。反假通过把它当场抓出来了，已改成同步 + 消费点断言。
| **G4** | **门面缺口消除** | 4–5 / 63 方法 | ⚠️ **前提变了**：接 RN 后共享 UI **直接调 `packages/app-host`**（与 web/mobile 同路），**不再经 `native-bridge` 的窄门面** ⇒ 门面缺口**可能整个消失**。需在 S1 中确认 |
| **G5** | **消除 §2.4 的排序漂移** | ✅ **已完成（2026-09-29）** | 「两套排序」已合一，见 §4.5 |

#### §4.5 G5 的解法与证据（2026-09-29）

**根因不是"谁写错了"，而是分层造成的死角**：`packages/app-host`（L2，零框架依赖）
**够不到** `packages/ui`（L3，peer 依赖 react/react-native）——
让 app-host 依赖 ui 会把 React 拖进一个今天零框架依赖的包，那是不可接受的。
于是 `native-bridge.listTasks` 自己写了一份 `(createdAt, id)`。

**解法**：把展示排序搬到 **`packages/domain`**（app-host 与 ui **都已依赖它**、且它零框架依赖）。

| 文件 | 动作 |
|---|---|
| `packages/domain/src/task-order.ts` | **新建** —— `sortTasksForDisplay` 的唯一实现，含"为什么在这层"的完整论证 |
| `packages/domain/src/index.ts` | 加一行 `export * from './task-order.js'` |
| `packages/ui/src/task-list/model.ts` | **删掉本地重复定义**，改为 `import` + 转出（**消费者 API 不变**） |
| `packages/app-host/src/native-bridge.ts` | `listTasks` 改用共享的那一份，删掉本地 `alive.sort(...)` |
| `packages/app-host/tests/native-bridge-order.spec.ts` | **新建**，2 条断言 |

**判别点选「已完成排最后」** —— 两套规则**只在这一处必然分歧**：
先建 A、再建 B、把 A 完成 ⇒ 旧序 `A,B`、共享序 `B,A`。

**验证（实际输出）**：
```
packages/app-host  Test Files 33 passed (33)   Tests 681 passed (681)
packages/domain    Test Files 24 passed (24)   Tests 653 passed (653)
packages/ui        Test Files 16 passed (16)   Tests 263 passed (263)
pnpm --filter @heyta/{ui,app-host} exec tsc --noEmit → exit=0
```

**反假通过（已做）**：把 `listTasks` 改回 `(createdAt, id)` →
```
AssertionError: expected [ 'A 先建', 'B 后建' ] to deeply equal [ 'B 后建', 'A 先建' ]
Test Files  1 failed (1)   Tests  1 failed | 1 passed (2)
```
→ 还原后 `681 passed`，`diff` 为空。

---

## 5. 滴答清单对标（重要参考）

### 5.1 取证台账

macOS 端 TickTick **v8.2.03**，原生 AppKit + Swift + KMP（**不是 Electron**），12 张 2126×1300 @2x 原图 + 330 行界面笔记：

- `docs/research/dida-capture/INTERFACE-NOTES.md` —— 主交付（逐视图：布局占比、控件清单+真实文案、信息密度、抄/不抄、边界）
- `docs/research/dida-capture/CAPTURE-LOG.md` —— 台账（逐张图的坐标与 `effect` 原话、主动跳过项、过程偏差）

🔴 **隐私红线（必须先处理）**：截图含**用户真实业务信息**（备案、开户、尾款、薪资核算）与他人昵称。
**在脱敏之前不得进入 git。** 处置见 §6.3-T3。

### 5.2 实测骨架（像素占比）

| 区域 | px 区间 | 占宽 |
|---|---|---|
| 图标栏 rail | 0–123 | **5.8%** |
| 导航侧栏 | 123–601 | **22.5%** |
| 任务主列 | 603–1357 | **35.5%** |
| 右栏（详情面板 ↔ 空态插画，**同一个可复用插槽**） | 1359–2126 | **36.2%** |

栏间是 **1px 亮分隔线**，不是留白。

### 5.3 最值得抄的 6 条（按我们的收益排序）

1. **rail 用留白分上下两段**：上段"去哪看"（任务/日历/四象限/习惯/搜索），下段贴底"干点啥"（同步/通知/帮助），**中间 400px 纯空白**完成语义分组 —— 不靠分隔线。**这条比任何视觉细节都值钱：它是一套零成本的导航分层语法。**
2. **选中态 = 整块填纯白**，未选中 = 中性灰。同一形状只换填充 ⇒ **截图咖啡测试一眼读出当前视图**。
3. **复选框颜色即优先级**（红/橙/蓝/灰空心）—— 不占第二个字段位，**白赚一档信息密度**。
4. **任务行三段式**：标题 → 右侧右对齐元数据（清单名 + 日期/时间/计数）→ 第二行小灰备注**单行截断**。一行塞下清单名+时间+备注而不挤。
5. **习惯进度三层**：表头环形（今天）+ 卡片 7 点阵（本周）+ `⚡22 天`/`🔥0 天`（连续/累计）—— **不打开详情就知道坚持多久**。
6. **四象限每格再按清单分组并给计数**（见 `04-quadrant.png`）：2×2 卡片网格（**不是四列看板**）、每格带**彩色序号徽章**（Ⅰ红/Ⅱ黄/Ⅲ蓝/Ⅳ绿）、格内按清单分组带计数、**复选框描边继承象限色**、**行与列表视图是同一套行组件**。

### 5.4 明确不抄

| 不抄 | 理由（实测） |
|---|---|
| 右栏 **36% 宽空态插画区** | 无详情时纯浪费；窄屏/移动端必须回收 |
| 次要文字**对比度过低** | 底 `#1c1c1c` 上的中灰，可读性不达标 |
| 侧栏「清单/过滤器」**空态引导卡** | 吃大量纵向空间 |
| **「同步」占一等 rail 位** | 同步是状态不是目的地，不该与视图同级 |
| 四象限归属**由优先级+日期自动推导、不可拖拽** | 心智不透明；而 heyta 的四象限是**派生视图**（[`ADR-0015`](../adr/0015-four-quadrant-as-derived-view.md)），拖拽语义必须自己定义清楚 |
| 日历格内**不显示时间** | 格内只有标题，`11:30`/`15:00` 必须点开 |
| rail 上**没有番茄钟入口** | 与我们把专注作为一等能力的方向不同（**这是它的缺口，不是它的优点**） |

> 🔴 **2026-10-04 产品负责人改了第一行的前提，结论没改 —— 这里记清差别，别让下一位读成"这条推翻了"。**
> 她给的指令是把最右那一栏用起来：「右边那一栏只有选中任务的时候才会有状态，
> 那无状态的时候就可以默认显示 AI Chatbot」。⇒ **"不抄那张插画"继续有效**，
> 而它旁边的理由「无详情时纯浪费」有了新答案：无详情时那一栏装**功能**（AI 面），
> 不装装饰。落地在 `apps/web/src/App.tsx` 的 `aiPanels`（单步工具 + 对话助手），
> `AiPrioritize` 因为它是批量的、只能待在列表上方。
> ⚠️ 那一栏 ≤1023px 不出现（§5.4 第一行"窄屏/移动端必须回收"仍生效），
> 所以 AI 面在那一档**退回中间列** —— 回收的是**栏**，不是**功能**。
> 判据：`e2e/tests/ai-row-layout.spec.ts` 两档各钉一条"AI 面在哪一栏"。
>
> 同批：侧栏里那行重复的「收集箱」被删（「已经有一个收集箱的标题了，为什么还要个收集箱？」）。
> 回到收集箱的手势改成**再点一次已经亮着的 rail「任务」**；从别的视图回来时**位置保留**，
> 那是 R9（2026-10-02 同一位产品负责人："回到任务视图应当看到他离开时停着的那一格"）的要求。
> ⚠️ **待她拍**：这两条靠"点的时机"分开，是现量最省事的解，不是唯一解；
> 另一种是把收集箱放回侧栏（她刚删的）或给页头一个显式重置控件（要新词条，中英成对）。
> 判据：`apps/web/tests/app-mount.spec.tsx`。

### 5.5 功能 gap：按**新主战场**重排优先级

🔴 **本节的排序与 `site-and-parity-alignment.md` 的 B 轨不同，因为那份计划是 Web 优先的。** 旧计划把「Web 日历」列为 P0-2，理由是"Web 是主入口"；按 P5，**该条降级，日历要先上移动端 + macOS + Windows**。

| 新序 | 项 | 旧计划里的位置 | 为什么改 |
|---|---|---|---|
| **1** | **提醒系统** | 旧 P0-1 | 不变。滴答的招牌能力；不会提醒的待办，用户第二天就回去用滴答。**领域层+app-host 逻辑层已落地，缺宿主入口** |
| **2** | **子任务** | 旧 P0-3 | 升级。它是**对象模型地基**（消除 `- [ ]` 假象），且三端都要改模型 → 越晚越贵 |
| **3** | **搜索** | 旧 P0-6 | 升级。移动端与桌面都是"超过 50 条就不可用"，是主战场的第一道墙 |
| **4** | **已完成入口** | 旧 P0-5 | 不变。最便宜的一项 |
| **5** | **备注编辑** | 旧 P0-4 | 不变。连"写下来"都做不到 |
| **6** | **日历** | 旧 P0-2 | **降级**（原理由"Web 是主入口"已失效） |
| **7** | **滴答导入的三端入口** | 旧 P1（只有 Web 做完了） | 升级。**这是你我本人的真实迁移路径**：逻辑层已完整（幂等、引用完整性、墓碑语义），Web 有入口，**mobile / macOS / Windows 是 0** |
| **8** | 「看起来有、其实没有」的 13 项 | 旧 P1 | 🟡 **已实测复核**（见 §5.5b）：**9 项已修、4 项仍未接** |

**判据（照搬旧计划的，它对）**：一个功能算"做完"必须**三问全过** —— ① 有 `app-host` action；② 有宿主调用点；③ 有从**用户动作**出发的验收。

#### 🔬 2026-09-29 实测复核：§5.5 那张表**有一半是过期的**

产品负责人要求"按顺序做完"，所以我先把每一项**按层实测**了一遍（不是读文档）：

| 项 | domain | app-host | `packages/ui` | web | mobile | 实测结论 |
|---|---|---|---|---|---|---|
| **提醒** | ✅ 4 | ✅ 3 | ✅ 4 | ✅ 3 | ✅ 4 | ✅ **早已做完**（旧计划写的"缺宿主入口"**已过期**） |
| **搜索** | ✅ 8 | ✅ 1 | ✅ 8 | ✅ 8 | ✅ 3 | ✅ **早已做完** |
| **日历** | —— | —— | —— | ✅ 4 | ✅ 7 | ✅ **早已做完**（含移动端） |
| **已完成入口 / 备注编辑** | —— | ✅ | —— | ✅ | —— | ✅ 已有（`app-mount.spec` 各有一条断言） |
| **滴答导入** | ✅ 3 | ✅ 2 | ⬜ | ✅ 3 | ✅ **已补** | ✅ **三端都有入口** —— 桌面端**不需要新代码**：它加载的就是 web 的同一份构建（见下） |
| **子任务** | ✅ 2（616 行） | ✅ **已补** | ✅ **已补** | ✅ **已补** | ✅ **已补** | ✅ **四端的三问都过了**（见下；移动端是最后补上的那一半） |

🔴 **子任务那一条是本轮 `grep` 出来的，不是从文档抄的**：
`grep -rn parentId packages/app-host/src/` 只命中**清单**（project）的 `parentId`
（TickTick 导入、`project-actions`）—— **任务的一条都没有**。
这正是本方案 §2.2 说的"看起来有其实没有"：**模型支持、树能建、功能不存在，且不报错**。

**本轮补上的那一刀（B1-3 写路径）**：
| 文件 | 动作 |
|---|---|
| `packages/app-host/src/actions.ts` | 新增 **`setParent(entityId, parentId)`** —— 写前调领域层的 `validateParentChange`，**失败即 throw、不写 op**；`undefined` → `null` 表达"提为顶级" |
| `packages/app-host/tests/subtask-actions.spec.ts` | **新建**，9 条断言，逐条钉住 `ParentChangeRejection` 的每一种（`self` / **`cycle`** / `task_not_found` / `parent_not_found` / `depth_exceeded` / `children_exceeded`）+ 幂等 + **重开仍在** |

**验证**：`packages/app-host` **34 文件 / 690 测试全绿**。
**反假通过**：把 `validateParentChange` 换成"永远 ok" ⇒ **6 条转红**（含
`promise resolved "undefined" instead of rejecting` @ cycle）⇒ 还原后复绿、`diff` 为空。

**✅ 本轮把 web 侧的**三问**补齐了（2026-09-29）**：

| 文件 | 动作 |
|---|---|
| `packages/ui/src/subtasks/model.ts` | **新建**。`subtaskRejectionMessageKey`（6 个拒绝原因 → `common.subtask.reject.*`）+ `rejectionReasonOf`（从 `setParent` 抛的错误里**只认全角括号里那一整个词**，不让界面去 `includes('cycle')`）。形状与 `auth/model.ts` 完全一致 |
| `packages/ui/src/index.ts` | 末尾追加导出 |
| `packages/i18n` | `common.subtask.reject.*` 7 条 + `web.subtask.*` 6 条（zh/en 各 +13，**1798/1798**） |
| `apps/web/src/features/tasks/store.ts` | 加 `setParent`（🔴 **不 catch、不吞** —— 拒绝原因要一路冒到界面） |
| `apps/web/src/features/tasks/SubtaskPicker.tsx` | **新建**。chip 常驻显示归属 + `<details>` 里的原生 `<select>`；**候选用领域层的 `canSetParent` 预过滤**（选不到自己/后代 ⇒ 从界面**造不出环**）；拒绝时把人话显示出来 |
| `apps/web/src/App.tsx` | 接进行尾插槽（顺序：备注 → **子任务** → 清单/标签 → …） |
| `apps/web/tests/subtask-picker.spec.tsx` | **新建**，6 条断言（真 op-log + 真 store，不是 mock） |

**验证（实际输出）**：
```
✓ apps/web/tests/subtask-picker.spec.tsx (6 tests)
apps/web 全量：Test Files 61 passed | 2 skipped   Tests 874 passed | 12 skipped   exit=0
apps/web typecheck exit=0
check:ui-language ✅（1798 条 zh / 1798 条 en，集合一致）
```

**两条反假通过（都做了）**：
1. **去掉预过滤**（退化成只判 `id !== task.id`，漏掉"后代"这一整类）⇒
   `AssertionError: 子任务出现在候选里` **红** ⇒ 还原复绿、`diff` 为空。
   **这是最要紧的一条**：预过滤没了 = 从界面能造出环 = 树无限递归。
2. 门禁/断言本身的可失败性：测试第一版想"从 `<select>` 里选一个非法项"来触发拒绝，
   **结果选不到**（候选已正确过滤）—— 那**不是测试失败，是设计在起作用**。
   改成**注入一个会 reject 的 handler**（模拟跨端竞态）后才真正测到错误渲染路径。
   📌 这条值得记下来：**"测不到"有时候是功能对了**，别急着改产品去迁就测试。

#### ✅ 滴答导入的**移动端入口**（⑩ 第 7 项的另一半，2026-09-29 补）

| 文件 | 动作 |
|---|---|
| `apps/mobile/src/lib/ticktick-import.ts` | **新建**。`previewTickTickImport`（解析 + 算"会写什么"，**一个字都不写**）与 `confirmTickTickImport`（按批次派发，🔴 **不吞异常**） |
| `apps/mobile/src/screens/ExportScreen.tsx` | 加「从滴答清单导入」一段：多行粘贴框 + 预览 + 计数 + 报告明细 + 确认；**文本一改就把上一次的预览作废**（否则用户会对着旧预览按确认，而写下去的是旧 plan） |
| `apps/mobile/src/ui/kit.tsx` | `TextField` 加 `multiline` / `lines`（CSV 是多行文本；单行框里**只看得到最后一行**，而用户会以为"粘进去的只有这一点"——这正是"导入只进来几条"的经典误判） |
| `packages/i18n` | 只新增 **4 条**（`mobile.import.pasteLabel` / `pastePlaceholder` / `preview` / `pasteNotFile`）—— 其余**全部复用 web 的 `web.ticktick.*`**（title / intro / previewCounts / previewRows / confirm / done / doneNoop / failure.*）。**两端不可能说出不一样的话。** |
| `apps/mobile/tests/ticktick-import.spec.ts` | **新建**，7 条（4 条行为 + 1 条"确认按批次派发" + 1 条"原样上抛" + 1 条源码级接线） |

**三问**：① `app-host` 的 `createTickTickImportActions` ✅（早就有）｜② 宿主调用点 ✅
（`ExportScreen`，而它从 `ProfileScreen` 可达）｜③ 用户动作验收 ✅（7 条，见下）。

**验证**：`apps/mobile` **26 文件 / 406 测试全绿**（+7）；`typecheck` exit 0；
`check:mobile-bundle` / `check:ui-language` / `check:design` ✅。

**反假通过**：把 `confirmTickTickImport` 的异常**吞掉**（本仓明令禁止的写法）⇒
`AssertionError: promise resolved "{ report: … }" instead of rejecting` **红** ⇒
还原复绿、`diff` 为空。

#### 🔴 一处**有据的差异**（不假装两端等价）

**移动端是「粘贴 CSV 文本」，web 是「选文件」。** 理由：移动端要选文件必须引一个原生依赖
（`react-native-document-picker` / `react-native-fs` 之类），那要过 `AGENTS.md` §3.1–3.2
的**两道门**；而手机上 CSV 常常就在聊天/邮件里，长按复制再贴进来是**更短**的一条路。
所以这一版走粘贴、**零新依赖**，并把这个差别**写在界面上**（`mobile.import.pasteNotFile`），
不假装等价。

#### ✅ 桌面端的导入入口：**不需要新代码，只需要一条断言**（2026-09-29）

M2 之后桌面壳加载的**就是 `apps/web` 的同一份构建**，而那个构建里**早就有**滴答导入面板。
⇒ 所以"三端入口"在 M2 架构下**收敛成"共享 UI 有它"** ——
**这不是偷懒，这正是"UI 组件一定要复用"想要的结果**：一份实现，三端都有。

⚠️ 但**"加载成功"不等于"那个入口可达"**：设置 tab 点不点得开、面板在不在，
是加载成功也照样可能假的一件事。所以补的是一条**真断言** ——

`check:macos-window`（已在 `pnpm check` 链路里）现在会让 macOS 壳的探针**分三段**跑：
1. 冷启动第一屏：**身份入口头像** + 采集框（身份入口成立）；
2. **点头像 → 验身份菜单 IA**：第一项必须是 `sync-signin-entry`（登录/注册），
   必须有设置项，且未登录时**不得**有 `account-menu-signout`（退出登录）；
   然后点菜单里的「设置」（按 testID 找，**不写死索引**——索引会随条目增减漂移）；
3. 再看 `[data-testid="ticktick-import-panel"]` 与 `ticktick-file` 在不在。

```
M2_MACOS_NOTE=M2-macOS ✅ 身份入口成立（头像 1 个、采集框 1 个）；
              **身份菜单合规**（第一项 sync-signin-entry、登录入口 1 个、退出登录 0 个）；
              **设置里的滴答导入面板可达**（panel=1 file=1）
```

**反假通过**：把 `<TickTickImportPanel />` 从 `App.tsx` 摘掉 → 重建 web → 跑：
```
M2_MACOS_NOTE=M2-macOS 🔴 前置成立，但**设置里没有滴答导入面板**：{"panel":0,"fileInput":0}
```
⇒ 断言**转红**，而且**第一段仍然通过** —— 证明两条断言**相互独立**，故障只打中第二条。
还原（`diff` 为空）+ 重建 ⇒ 复绿。

⚠️ **仍未做**：**Windows 侧的同一条断言**（它的真机 spike 已过 M2-D，但没接进 `pnpm check`；
理由见 §5.5b 之后的 Windows 登记项：需要一台可达机器 + 一个能跑的远程门禁）。

#### 🔬 §5.5b 「看起来有、其实没有」13 项的**实测复核**（2026-09-29）

清单出自 [`../research/dida365-feature-benchmark.md`](../research/dida365-feature-benchmark.md) §3（写于更早）。
按它**自己定的三问判据**逐条实测（不是读文档）：① 有没有 `app-host` 的 action？② 有没有宿主的调用点？
③ 有没有一条**从用户动作出发**的验收？

| # | 项 | 实测（①/②/③） | 判定 |
|---|---|---|---|
| 1 | 提醒 | ✅4 / ✅9 / ✅9 | ✅ **已修**（旧文档写的"无字段、无 UI、无调度"已过期） |
| 2 | 用户可见通知 | ✅ —— `features/reminders/notify.ts` 投递 + `use-reminder-notifications.ts` 接线 + 设置里的「提醒通知」节 | ✅ **本轮已修**（⚠️ 真实形态是：`reminders/store.ts` 的 `due`「已到点、还没投递」**早就算好写进 state 了，没有任何东西读它**；全仓也一个 `new Notification(` 都没有。投递的是**本地提醒**——推送载荷刻意无数据（E2EE），它不可能说出任务标题。**局限如实写出**：应用没开就不响） |
| 3 | 子任务 | ✅3 / ✅7 / ✅5 | ✅ **本轮已修**（写路径 + 界面 + 验收） |
| 4 | 任务备注 | ✅4 / ✅7 / ✅4 | ✅ **已修** |
| 5 | Web 日历视图 | ✅ —— 共享 `packages/ui/src/calendar/CalendarBoard.tsx`，web 与 mobile 同一份；数学在 `@heyta/domain` | ✅ **本轮已修**（⚠️ 这一格此前被我判成「已修」是**假阳性**：`rg -li calendar` 命中的 4 个文件是 `CalendarDays` 图标、习惯热力图、日期显示，**没有一个日历视图**。顺带给 `TaskRow` 的 `density="minimal"` 补上了**第一个消费者**） |
| 6 | 「已完成」视图 | ✅9 / ✅9 / ✅18 | ✅ **已修** |
| 7 | 手动排序 | ✅1 / ✅1 / ✅7 | ✅ **已修** |
| 8 | 番茄钟自定义时长 | ✅ / ✅ / ✅ —— `FocusTimer.tsx` 有 `workMinutes`/`shortBreakMinutes` 配置 | ✅ **已修**（⚠️ 我第一版探错了路径：去 `packages/app-host` 找 `setConfig`，而它在 `apps/web/src/lib/focus-config.ts`） |
| 9 | 习惯计数型 / 时长型 | ✅ / ✅ **已补** / ✅ **已补** | ✅ **web + mobile 三问全过** |
| 10 | 「实时」多设备同步 | ✅ —— `apps/web/src/features/sync/store.ts` 建连/换令牌重建/登出断开/冷启动恢复；`apps/web/tests/realtime-wiring.spec.ts` 6 条 + 反假通过 | ✅ **本轮已修**（本轮之前：`realtime.ts` 450 行、`realtime.spec.ts` 齐全，而**没有任何宿主 `createRealtimeClient()`**。⚠️ **仍未做**：移动端尚未接；且真机双设备验证被外部条件挡住） |
| 11 | 桌面端 | ✅ / ✅ / ✅ | ✅ **本轮已修**（M2-D：真应用 + 注册/登录前置） |
| 12 | 笔记模块 | ✅（`note-actions.ts`）/ ✅（web + mobile 入口）/ ✅ | ✅ **已修** |
| 13 | 鸿蒙 | 🟡 —— **构建链已实测打通**（见下），卡在**模拟器系统镜像 + 签名** | 🟡 **阻塞（外部条件）** ⚠️ 这一格此前写的「`Index.ets` 是小组件 demo、**RN 一行都没接进去**」**严重过期**：它只看了 `apps/mobile/harmony/` 那个**小组件页**，漏了树外探针 —— 实测 `pnpm verify:harmony-rnoh` **17/17 通过、exit 0**（编出 37MB HAP，含 `librnoh_core.so` 5097000B / `librnoh_app.so` 3105584B / `libreactnative.so` 13428600B / `ets/modules.abc` 942504B），`pnpm verify:harmony-rnoh-js` **29/29 通过、exit 0**（真 codegen + 真 autolinking + Metro/Hermes bundle + release HAP 20MB 含 `hermes_bundle.hbc`）。**两个脚本自己都写明边界：不验运行**

**⇒ 13 项里 12 项已修、1 项仍未接**（13 鸿蒙应用 —— 见下面那条：它的**构建链**其实已实测打通，卡的是模拟器镜像与签名）。

#### ⑩ 最后一项 #13 鸿蒙：**构建链已实测打通，卡在纯外部条件**

按纪律"被外部条件挡住时：不空等，改做该条的可做部分，并如实登记阻塞"——
这一项的可做部分就是**把它验到能验的边界**，并把边界写清楚。

| 命令 | 结果 | 产物 |
|---|---|---|
| `pnpm verify:harmony-rnoh` | **17/17 通过，exit 0** | `entry-default-unsigned.hap` **37MB**：`librnoh_core.so`(5097000B) / `librnoh_app.so`(3105584B) / `libreactnative.so`(13428600B) / `ets/modules.abc`(942504B) |
| `pnpm verify:harmony-rnoh-js` | **29/29 通过，exit 0** | release HAP **20MB**：`hermes_bundle.hbc` + 三个 `.so`；真 codegen 产物 `RNOHGeneratedPackage.h`、真 autolinking 产物 `RNOHPackagesFactory.h/.ets` + `autolinking.cmake` |

**⇒ 结论：RN 在鸿蒙上的「JS 源码 → unsigned release HAP」整条链在本机是通的。**
两个脚本**自己都写明边界**：`不验运行 —— 缺模拟器系统镜像 + 签名`。
所以「RN 应用在鸿蒙上跑得起来」**仍然未验**，而那需要一台鸿蒙设备/模拟器 ——
**本机没有**（这就是外部阻塞的准确表述）。

⚠️ **这一格此前严重过期**：原文写「`Index.ets` 是小组件 demo、**RN 一行都没接进去**」——
它只看了 `apps/mobile/harmony/` 那个**小组件页**，**漏了树外探针**。
教训与前几轮同源：**判据必须查全**，"我在某个目录下没看到"不等于"不存在"。

🔴 **这两条验收刻意不接进 `pnpm check`（显式声明"不接"及理由）**：
它们要 `ohpm install` 一个 **309MB 的 har**、再用 NDK 的 cmake+ninja 真编 C++
（脚本日志里 `BuildNativeWithNinja... after 1 min`），单次是**分钟级**。
`pnpm check` 是每次改动都要跑的链 —— 往里塞一个分钟级的 C++ 构建，
结果不是"更安全"，而是**大家开始绕过整条链**。
它们是**决策输入 / 周期性验收**，不是 per-change 门禁。
⇒ 按判据的第二种写法显式登记（而不是假装它已经在链上）。

⚠️ 表头「实测（①/②/③）」**没有定义 ①②③ 是什么** —— 从数值看是三组审计查询的命中数，但读表的人无从知道。这是这张表的既有缺陷（未修）：**判据不可复现的表，和没有判据差不多**。

⚠️ **这张表本身犯过一次假阳性**（见第 5 项）：`rg -li` 命中字符串**不等于**功能存在。
这与 §7.1c 抓到的 `aka.ms` 那条（HTTP 200 ≠ 拿到 exe）是同一类错误 ——
**判据必须是结构性的，不能是「出现了这个词」**。

#### ✅ 第 9 项「习惯计数型 / 时长型」的 web 侧（2026-09-29 补）

实测出来的缺口是**三层**，不是一层：
`Habit` 有 `target` / `unit` / `goalType`，`isAchieved` 三种口径**全实现了**，
`checkIn` 也收 `value` —— 但 ①`NewHabitFields` **连 `goalType` 都没有**，
②**没有任何动作能改一个已建习惯的目标**，③**界面一处都到不了**。

| 文件 | 动作 |
|---|---|
| `packages/app-host/src/habit-actions.ts` | 新增 **`setHabitGoal(entityId, {target, unit, goalType})`**：数值必须**有限且 ≥ 0**、单位 trim 后空串 = **清除**（写 `null`）、**一个字段都没传就不写 op**（空 UPD 是噪音） |
| （同文件）`NewHabitFields` | 补上 `goalType` —— 原来新建时也指定不了口径 |
| `packages/ui/src/habits/HabitBoard.tsx` | 新增 **`renderGoalSlot`** 插槽（与 `renderColorSlot` 同形）：编辑控件留在各端，共享层只让出位置 |
| `apps/web/src/features/habits/HabitGoalEditor.tsx` | **新建**：摘要常驻可见 + 展开式编辑（数值/单位/三选一口径），**三字段一次提交**（一条 UPD，避免别的设备上出现"数值已变但口径还是旧的"中间态） |
| `apps/web/src/features/habits/store.ts` · `HabitsView.tsx` | 接上 `setHabitGoal` 与 `renderGoalSlot` |
| `packages/i18n` | `web.habits.goal.*` 各 10 条（zh/en） |

**验证**：app-host **699 全绿**（+7，含"改目标后 `isAchieved` 的判定真的变了"那条集成断言）；
web **880 全绿**（+6）；两处 typecheck exit 0；`check:ui-language` / `check:design` ✅。

**两项反假通过**（都还原复绿、`diff` 为空）：
- app-host：去掉数值校验 ⇒ `AssertionError: promise resolved "undefined" instead of rejecting` **红**；
- web：把 **`0` 当成非法值** ⇒ `expected "vi.fn()" to be called 1 times, but got 0 times` **红**
  —— 这条最要紧，因为 `atMost` + `0` 是"**一次都不碰**"，把它拦掉等于把一整类习惯（戒掉某件事）判了死刑。

🔴 **两处被门禁/测试当场抓到的问题**（都记下来了）：
1. `check:ui-language` 拦下了我的 `web.habits.goal.summary = '{type} {target}{unit}'`
   —— **一个汉字都没有**。纯占位符的 zh 词条与"忘了翻译"在门禁眼里是同一件事。
   修法是**拆成三条各自含中文的词条**（而不是加例外），顺带让两种语言的语序能各自调整。
2. 组件测试第一版直接 `input.value = '8'` 再派发 `input` 事件 —— **不会触发 React 的
   `onChange`**（React 在 input 上装了自己的 value 追踪器）。必须走**原生 setter**。
   症状是"测试里输入了但组件没收到"，看起来像组件坏了。

**✅ 移动端那一半也补上了（2026-09-29）**：

| 文件 | 动作 |
|---|---|
| `packages/ui/src/habits/model.ts` | 新增 **`habitGoalSummaryKey(goalType)`** —— 「口径 → 摘要词条 key」**收在共享层一份**（web 与 mobile 各有一个目标编辑器，各写一份的症状是"同一个 `atMost`，web 说『最多』、移动端说『不超过』"）。⚠️ 只给 **key**，句子在词条表里（本包不 import i18n） |
| `apps/mobile/src/ui/habit-goal-slot.tsx` | **新建**：摘要常驻可见 + 展开式面板（数值/单位/三选一 Chip）。⚠️ **交互形态与 web 不同是有意的**：触摸没有 hover 与 `Esc`，web 用 `<details>`+`<input>`、移动端用可展开面板+Chip（后者在手机上会调出键盘遮住上下文） |
| `apps/mobile/src/screens/HabitsScreen.tsx` | 传 **`renderGoalSlot`**；⚠️ 刻意**不包 `runFor()`**（它只 `.finally()`、没有 `.catch`，交给它会把 `setHabitGoal` 的 reject 变成 unhandled rejection） |
| `apps/web/src/features/habits/HabitGoalEditor.tsx` | 改用共享的 `habitGoalSummaryKey`（消掉 web 侧那份三选一） |
| `apps/mobile/tests/habit-goal-entry.spec.ts` | **新建**，5 条源码级断言 |
| `packages/ui/tests/habits-model.spec.ts` | +4 条（三种口径各给各的一句 / **三条 key 互不相同** / 没设口径 = `atLeast` / 认不出来的值也落 `atLeast`） |

**验证**：mobile **27 文件 / 411 测试全绿**（+5）；ui **27 测试**（+4）；`typecheck` exit 0；
`check:mobile-bundle` / `check:ui-language`（**零新增词条** —— 移动端**复用** `web.habits.goal.*`）/ `check:design` ✅。

**反假通过**：把移动端的下界写成 `parsed <= 0`（把 `0` 当非法）⇒
`AssertionError: 下界写成了 <= 0，会把「一次都不碰」判死` **红** ⇒ 还原复绿、`diff` 为空。

📌 **两端各一次"把 0 当非法"的注入**（web 行为测试 + mobile 源码断言），说明这条判据在**两个平台**上都被钉住了 ——
不是只在一端写了就算。

📌 **这张表本身就是"三问判据"有效性的证据**：它还抓到**我自己的两次误判**——
第 8 项我探错路径判成"未接"（实际已修）、第 13 项它的行数增长很容易被读成"鸿蒙做起来了"
（实际是小组件 demo，页面自己都写着数据是假的）。

**✅ 移动端那一半也补上了（2026-09-29）**：

| 文件 | 动作 |
|---|---|
| `apps/mobile/src/screens/TaskDetailSheet.tsx` | 加「上级任务」一节：`（顶级任务）` chip + **候选 chip**；候选由**领域层的 `canSetParent` 预过滤**（选不到自己/后代 ⇒ 从界面**造不出环**）；新写 `runSetParent` —— 🔴 **自己接住拒绝**，因为通用的 `run()` 只 `.then(onChanged)`、**没有 `.catch`**，直接交给它会把 `setParent` 的 throw 变成一条 **unhandled rejection**（用户看到"点了没反应"，原因只在控制台） |
| `apps/mobile/src/screens/TasksScreen.tsx` | 把**全量** `tasks` 传下去（用"当前视图可见的"当选集，会让子任务这个功能**随机地做不成**，且看起来像"没有这个选项"） |
| `packages/i18n` | `mobile.detail.field.parent` + `mobile.detail.parent.topLevel`（zh/en 各 +2） |
| `apps/mobile/tests/subtask-entry.spec.ts` | **新建**，5 条**源码级**断言 |

🔴 **为什么移动端是源码级断言而不是行为测试**：`apps/mobile` **没有组件测试栈**
（本仓刻意没引 `@testing-library/*`，理由见 `packages/ui/vitest.config.ts` 的文件头）。
而这一条要防的失效**恰好是"接线断了"**，不是"逻辑算错了" ——
domain 的 616 行在、`setParent` 在、**调用点是 0**。这种"缺一根线"**没有行为可测**，只能查源码。

**验证**：`apps/mobile` **25 文件 / 399 测试全绿**（+5）；`typecheck` exit 0；
`check:mobile-bundle` exit 0；`check:ui-language` ✅（词条 zh/en 集合一致）。
**反假通过**：把预过滤换成土办法 `t2.id !== task.id` ⇒
`AssertionError: expected … to match /canSetParent\(tasks,\s*task\.id,\s*t2\.id\)/` **红** ⇒ 还原复绿、`diff` 为空。

⚠️ **仍未做（如实登记）**：**没有做真机验收**。理由：本机唯一的 Android 模拟器
（`emulator-5554` / AVD `SSOS-Parity-A36`）**是另一个项目（SSOS）的会话在跑**，
往上装 heyta 会污染那个会话的环境 —— 按"不误伤并行会话"的纪律**没有动它**。
所以移动端这一条目前的证据是**源码级 + 类型 + 构建门禁**，**不是**"真机上点通了"。
按三问判据，**移动端这一端还不算"做完"**。

---

## 6. 旧资产清理

### 6.0 前置红线：**不得误伤在途工作**

工作树当前有 **50 余项未提交改动**（本轮开始时实测 51 项），其中含**并行会话正在做的两件事**：

- **M3 `timeline` 迁移**：`D apps/web/src/features/timeline/{GanttChart,TimelineView}.tsx`、`?? TimelinePanel.tsx`、`?? labels.ts`、`?? packages/ui/src/timeline/`、`?? packages/app-host/src/timeline-plan.ts`
- **滴答导入 UI**：`?? apps/web/src/features/settings/TickTickImportPanel.tsx`、`?? ticktick-import.ts`

**以下清单全部避开这些路径。** 清理动作一律先 `git status` 复核。

### 6.1 T1 —— ✅ **已执行**（本机产物/缓存/空目录；**全部未被 git 跟踪**）

**实测释放 2.23 GB。** 实际删除项：

| 路径 | 已释放 | 依据 |
|---|---|---|
| `release/` | 965 MB | `git ls-files` = 0；`.gitignore:10`；**旧 Electron** 产物，已被原生包取代 |
| `apps/mobile/ios/HeytaWidgetCore/.build/` | 423 MB | 未跟踪 |
| `apps/desktop-macos/.build/` | 264 MB | 未跟踪 |
| `research/upstream/` | 185 MB | 未跟踪（可重拉） |
| `research/standalone` 的忽略缓存（`.npm-cache` 131M + `sync-core/.npmcache2` 128M + `sync-core/node_modules` 80M + `dist`） | 339 MB | 未跟踪 |
| 各包构建产物（`apps/*/{dist,dist-types,renderer-dist}` + `packages/*/dist` + `*.tsbuildinfo`） | ~26 MB | 未跟踪，可由 `pnpm build` 重建 |
| `desktop-linux-check/`、`.worktrees/` | 0 B（空目录） | 全仓零引用 |

🔴 **两处我刻意没删，并说明理由**（与本节初稿不同，属于执行时的判断）：

| 保留项 | 体积 | 理由 |
|---|---|---|
| `dist/` | 93 MB | 里面是**已交付的原生包**（`windows/heyta.msix` 97 MB、`linux/heyta_1.0.0_amd64.deb`、窗口证据）。虽然脚本可重建，但 **Windows MSIX 能装上这件事是刚解决的真实成果**，本地删掉等于把它推回"需要远端 Windows 机器"才能复现 |
| `.pnpm-store/` | 1.0 GB | 它是**当前状态的活跃缓存**，不是"旧东西"。删它只换来一次全量重下载，没有清理价值 |

⇒ **若你要严格按初稿执行，说一句即可**，这两项都能删。**已交付的 MSIX 建议先备份到别处再删 `dist/`。**

### 6.2 T2 —— 零风险，只改文档

| # | 动作 | 状态 |
|---|---|---|
| 1 | 修 `desktop-native-migration.md` W1-2 与 §9 两行的假 `check:windows-shell` 门禁声明 | ✅ **已做** |
| 2 | 修 `multi-platform-adaptation.md` 里的 `check:status-bar` 复述 | ✅ **已做** |
| 3 | 修 `desktop-packaging-handoff.md` 的 `.gitignore` 说法 | ✅ **已做** |
| 4 | **回填** Windows MSIX **已装上并跑起来**（证据 `packaged-first-run.txt`） | ✅ **已做** |
| 5 | 修「Windows 界面未渲染」—— **实测已渲染**，三壳其实**都在同一个薄切片上** | ✅ **已做** |
| 6 | `AGENTS.md` §2 仓库地图**补四行**桌面壳 | ✅ **已做** |
| 7 | 全仓清掉"最后提交 09-27"这类**相对时间** | ⬜ 待做（`desktop-native-migration.md` §10.3 自己已写明会腐烂） |

### 6.3 T3 —— 需先改引用 / 需先决定

| # | 项 | 前置 | 建议 |
|---|---|---|---|
| 1 | **三个桌面壳手写的 UI 切片** | 必须先有 **M1（RN 平台实现）的共享 UI** 顶上（Windows 就绪；macOS 等 0.84） | **本方案要删的核心对象**：macOS `ShellView`、`MainWindow.xaml`、GTK4 的手写部分。**先替换，再删**（内容岛可逐视图替换，不必等全部就绪） |
| 2 | `apps/desktop`（Electron，17 文件 / 10 MB） | ① 用壳级 GUI 断言替换 `e2e/tests/desktop-window.spec.ts`（**唯一**自动化桌面 GUI 门禁）；② 改 `scripts/check-ui-provider.mjs:303` 的 `HOST_DIRS`；③ 定 `release/` 管线；④ 更新 lockfile | **保留到 ①② 完成**（它是活资产，不是死资产）；M2 落地后它唯一不可替代的价值（桌面 GUI e2e）即被壳级冒烟 + web e2e 取代 → **再退役** |
| 3 | `scripts/check-{macos,windows,linux}-shell.mjs` | ✅ **已完成（2026-09-29）** —— 三者曾是**孤儿脚本**（存在但未接进任何 `pnpm check`） | ✅ **已接线**：`package.json` 新增三个 `check:*-shell`，并**全部加进 `pnpm check` 链**（在 `check:crosslang-contract` 之后）。本机可跑的真跑、其余**响亮跳过**。**实测**：macOS `16/16` exit 0、Windows 跨语言全过 exit 0、Linux 在 darwin 上显式打印跳过原因 exit 0 |
| 3b | ✅ **新增 `check:macos-window`**（2026-09-29）—— **替换 Electron `desktop-window` 的那一格** | ✅ **已完成**：`scripts/check-macos-window.mjs`。四条断言（窗口真被截到 / 非空且不透明 / 自述取图方式 = `screencapturekit` / 与 `screencapture -l` 交叉验证一致），已接进 `pnpm check`。**反假通过**：把 `Method` 的 raw value 改坏 → `🔴 取图方式不是 screencapturekit` exit=1；还原复绿。⚠️ 非图形会话/无屏幕录制权限时**响亮跳过**（`launchctl managername ≠ Aqua`），不静默通过 |
| 4 | `apps/desktop-windows/evidence/packaged-first-run.{png,txt}` | 未跟踪**也**未忽略 | 入库或加 ignore（二选一，别留在悬空态） |
| 5 | `research/standalone/**` 已入库的 131 文件（含 `pylibs/**` 的 `.so`） | 需人工判断 | 先 `git rm --cached` 再决定；**不要**直接 `rm` |
| 6 | **`dida-capture` 的 12 张原图** | 🔴 **含真实业务数据与他人昵称** | 原图**保持本地并 gitignore**；只入库 `INTERFACE-NOTES.md` + `CAPTURE-LOG.md`（纯文本）；如需配图，另出**脱敏版** |
| 7 | `01-main-window.png` | 经实测是**更早日期的旧图**（计数 8/18/18 vs 本轮 5/17/17） | 移入 `_archive/`，不得作为证据引用 |

### 6.3b ⑨ 退役 Electron —— 🔴 **有据推迟**（2026-09-29 决定，不是遗漏）

**决定：现在不退役，等 M1a（RN 内容岛）落地之后再退。** 理由是 ⑨ 的**前置并没有真正满足**：

| 前置（方案 §6.3-T3-2 写的） | 现状 |
|---|---|
| ① 用壳级 GUI 断言替换 `desktop-window.spec.ts` | ✅ **已满足**：新增 `check:macos-window`（窗口真画出来 + 非空 + 取图方式 + 交叉验证），已接进 `pnpm check` |
| ② 改 `check-ui-provider.mjs` 的 `HOST_DIRS` | ⬜ 未做 |
| ③ 定 `release/` 管线 | ✅ 事实上已无（`release/` 已删，产物改由原生包脚本产出） |
| ④ 更新 lockfile | ⬜ 未做 |
| 🔴 **⑤（当初没写，但现在才是关键）`desktop-window.spec.ts` 还断言 `task-row-*`（`@heyta/ui` 打的锚点）** | ❌ **无法被替代** —— 原生三壳现在渲染的是**手写的 SwiftUI / XAML / GTK**，不是共享 UI。而 `apps/desktop` 是**唯一**一个在桌面壳里消费 `packages/ui` 的宿主 |

⇒ **退役 Electron 会同时删掉"M1a 要复刻的那个形状"的现存样本**，而且删掉的是
**S1 失败时的退路**（若 RNW 路线走不通，Electron 是唯一现成的桌面共享 UI 方案）。

**这与方案 §6.3-T3-2 的原文一致**：那里写的是
「M2 落地后它唯一不可替代的价值即被壳级冒烟 + web e2e 取代 → **再退役**」——
**"M2 落地"这个条件指的是共享 UI 上桌面，不是指门禁接线**。本轮完成的只是后半句的门禁那一半。

📌 **触发条件（写死）**：M1a 的**第一个** RN 内容岛在 Windows 上跑通（S1 通过 + ⑦ 开始），
且 `packages/ui` 真的在那个壳里渲染 ⇒ 那时再退役，并按 ②④ 收尾。
**在那之前保留 `apps/desktop`，它是活资产。**

---

### 6.4 T4 —— 治理（决策层）

| # | 动作 |
|---|---|
| 1 | **ADR-0031 / ADR-0034 的「待确认」必须落定** —— 现在实现跑在决策前面 |
| 2 | 🔴 **必须重开 ADR-0034** —— 它否决 RNW 的**唯一决定性理由已被证伪**（§3.2-③：移动端本来就在 RN 不受支持区；且 RNW 0.84.0 的 peer 与 heyta 逐字相同）。**不重开就是让一份基于错误前提的决策继续生效** |
| 3 | 新增 ADR：**主战场定义 + UI 单源策略（RN 全端 + 内容岛）**（P1–P6 与本方案 §4） |
| 4 | ADR-0024 与 ADR-0034 的冲突要**显式写出取代/修订关系**（本方案的 §3.1） |
| 5 | `roadmap.md` §5 与 `phase-2-multi-platform.md` 的重复口径收敛（见 §8） |

### 6.5 执行次序（建议）

```
① ✅ T1 全量清理（已执行，释放 2.23GB）                  ← 无前置
② ✅ T2 文档改正（6/7 项已做）                           ← 无前置
③ S1 spike：**RNW 内容岛**最小验证（Windows 先做）        ← 门槛，决定整条路
④ G3 壳 chrome 的 token 接线（C#/C 生成器**已不需要**，见 G0） ← 与 ③ 并行
⑤ G5 消除排序漂移（接 RN 后自动消失，只需加断言）           ← 与 ③ 并行
⑥ M1a 落地 → 逐视图把 Windows 壳的界面换成 RN 内容岛      ← 依赖 ③
⑦ 等 RN-macOS 0.84 发布（#3031）→ 接 macOS；等待期用 M2   ← 依赖上游
⑧ ✅ 壳级门禁接线（T3-3 已完成）+ ✅ macOS 窗口级门禁（已完成）← 依赖 ⑥
⑨ 退役 Electron（T3-2 前置满足后）
⑩ 按 §5.5 的新序补功能（提醒 → 子任务 → 搜索 → …）
```

---

## 7. 落地判据与门禁

### 7.1 Spike S1（**这是本方案唯一的门槛**）—— Windows 的 RNW 内容岛

> ⚠️ **S1 的对象在 2026-09-28 从"WebView 承载共享 UI"改成"RNW 内容岛"**（理由见 §3.3）。
> 判据结构不变（仍是四条），但**第一条的机制换了，因此新增 S1-0 与 S1-5 两条前置探针**。

| 项 | 判据（可执行） |
|---|---|
| **S1-0 依赖面** | ✅ **已完成（2026-09-29）** —— 见下方「S1-0 实测结果」 |
| **S1-1 真数据** | ⚠️ **部分通过** —— 见下方「S1 实测结果」 |
| **S1-2 单源** | **不新增第二份行组件**：`check:row-single-source` / `check:l4` 基线**不上升**（这是"字面上同一份代码"唯一的机器保证） |
| **S1-3 设计变量** | 内容岛里的样式全部来自 `tokens.css`（经 RN token 层）；壳侧 chrome 来自生成物 |
| **S1-4 反假通过** | 把数据源换成硬编码 → **必须转红**；把内容岛换成一份手写 XAML 列表 → `check:row-single-source` **必须转红** |
| **S1-5 混排** | ❌ **未做，且实测比预期难得多** —— 见下方「S1 实测结果」 |

**S1 的分级处置**（不要只有"过/不过"两档）：

#### 🔬 S1-0 实测结果（2026-09-29；`windows-pc` SSH 可达已实测，`dotnet` 可用）

**① 重跑 `node research/tools/windows-native-gaps.mjs`（exit 0）** —— 8 个直接依赖，其中原生模块 4 个：

| 依赖 | Windows 支持 | 判定 |
|---|---|---|
| `@op-engineering/op-sqlite` | ❌ 无 `windows/`；官方支持列表只有 iOS/Android/macOS/web/node | 🔴 **缺口** |
| `react-native-safe-area-context` | ❌ 无 `windows/`；`codegenConfig` **只声明 android+ios** | 🔴 **缺口** |
| `react-native-get-random-values` | ❌ 无 `windows/` | 🔴 **缺口** |
| `react-native-svg` | ✅ 有 `windows/`（GitHub API `contents/windows` → **HTTP 200**） | ✅ 可用 |

⚠️ 三个缺口都经 **GitHub API + npm metadata 双重核实**，不是靠脚本的"未登记"判定（脚本自己写明"未登记 ≠ 不支持"；这次确实不支持）。

**② SQLite 缺口有现成解法**：`react-native-turbo-sqlite@0.7.0`（**MIT**，2026-08-17）——
**纯 C++ TurboModule**，上游自述 "the native implementation can be shared across **Android, iOS, macOS, and Windows**"，codegen-based。
备选：自写 TurboModule —— 本仓 `packages/storage` 已有 `SqliteDriver` 端口，Windows 侧已有**同步的 C# 驱动**（`Heyta.Windows.Core/SqliteBridge.cs`）。

**③ 另两个缺口的解法方向**（**未经 spike 验证**）：
- `safe-area-context`：桌面没有刘海 ⇒ metro `resolver.resolveRequest` 别名到一个**返回零 inset 的本地 shim**；
- `get-random-values`：heyta 的加密**依赖真 CSPRNG**，**绝不许用 `Math.random` 冒充** ⇒ 需 Win32 `BCryptGenRandom` 的极小 TurboModule，或找现成方案。

**④ 工具链**：该机 SSH 可达、`dotnet` 可用（此前用 `winget` 装过 .NET SDK 10；**从未装过 Visual Studio**）。RNW 构建是否需要 VS 的 C++ 工作负载，**待 S1-1 实测**。

| 结果 | 处置 |
|---|---|
| S1-0 有不可用依赖 | ✅ **已按此处置**：三个缺口各给了解法方向；**SQLite 有现成 MIT 方案**，另两个是 shim / 极小 TurboModule 级别的工作量 —— **均不构成路线否决** |
| S1-1~S1-5 通过 | ✅ **按 M1a 铺开 Windows**，并为 macOS 0.84 预留同一套逐视图迁移 |
| S1 失败且无法补救 | 退到 **M2**（macOS 已是过渡档，Windows 也用 WebView）；**并如实记一条 ADR 的"接受残差"：P3 在桌面端只能以非原生控件兑现** |

### 7.1b 🔬 S1 实测结果（2026-09-29，`windows-pc` 真机）—— 🔴 **原生侧不成立，被判在"换一代 Visual Studio"上**

**报告全文**：[`../research/spikes/rnw-content-island/README.md`](../research/spikes/rnw-content-island/README.md)（442 行 + 11 个可复用脚本）。

**一句话**：**JS 侧成立**（`packages/ui` **零改动**就能被 RNW 的 Metro 打进 `platform=windows` bundle，1,895,932 字节，exit 0）；**原生侧不成立** —— RNW 0.84 要求 MSVC **v145（VS 2026）**，
本机只有 **v143**；用 v143 兜底**能编能链**（exit 0 / 40.7s / 产出 exe），但启动即 **fail-fast**（`0xC0000409`，WER `P4=ucrtbase.dll, P9=7` ⇒ `FAST_FAIL_GS_COOKIE_INIT`，崩在 CRT 初始化）
⇒ 🔴 **窗口从未出现**。所以**没有窗口截图**。

| 判据 | 判定 | 依据 |
|---|---|---|
| **S1-0** | ✅ **通过**（tarball 粒度） | `op-sqlite@18.2.5` / `safe-area-context@5.10.0` / `get-random-values@2.0.0` 的 `package/windows/` 文件数**都是 0**；`react-native-svg@15.15.5` 是 **153** |
| **S1-1** | ⚠️ **部分通过** | 数据**确实来自真 SQLite**（建 12288 字节真库、真 INSERT、`ROWS_RETURNED=6`）—— 但**读发生在构建前置步骤，不是应用运行时开库**（应用侧没有 Windows SQLite 驱动）；**渲染侧未通过** |
| **S1-2** | ✅ **bundle 级通过** | bundle 里 `task-item-` / `task-toggle-` **各出现 1 次** ⇒ **没有第二份行组件** |
| **S1-3** | ✅ **bundle 级通过** | `color.primary` / `size.row-min-height` / `size.checkbox` / `touch-target.min` / `resolveNativeTokens` 全在 bundle 里 |
| **S1-5** | ❌ **未做，且比预期难得多** | 见下 |

#### 🔴 S1-5 的实测推翻了方案里的一个隐含前提

方案原本把"RN 与 XAML 并排"当成 RNW 的既有能力（依据是微软官方博客：
*"Windows apps can seamlessly mix native XAML controls with React components"*）。**实测不成立**：

1. **RNW 0.84 只有 `cpp-app` 一个 app 模板** —— whole-window Win32 RN，**模板里根本没有 XAML**；
2. `ReactNativeIsland` **存在但是 composition 级 + `[experimental]`**，暴露的是 `Microsoft.UI.Content.ContentIsland`；
3. **RNW 自己是用 HWND 挂的**（`ReactNativeWindow.cpp` 里 `DesktopChildSiteBridge::Create(Compositor(), appWindow.Id())`）；
4. 在本机 WinAppSDK 的 winmd 里扫 `ContentIslandHost` —— **零命中**。

⇒ **"RN 内容岛与 XAML 并排"不是模板能力，是要自己写 WinUI 3 宿主并手工同步位置/DPI/焦点/Z 序。**
这**与方案 §4.3 的"content islands 增量嵌入"直接相关**：那条路的**嵌入机制本身要自己造**，
而微软 Office 那篇博客说的"embeddable"是在**他们自己的宿主**语境里。

#### 🔴 判据链上的一个新事实（S1 报告本身在这里有一处假阳性，已纠正）

S1 报告写「出路实测存在：`curl -L https://aka.ms/vs/18/release/vs_BuildTools.exe` → HTTP 200」。
**我复核发现那是假阳性**：那个短链**不存在** —— aka.ms 对未知短链会**回退到 Bing 搜索页**，
于是拿到的是 `HTTP 200` + 一张 HTML（`MZ` magic 检查：`<!` 而不是 `MZ`），**不是安装器**。
（教训与 AGENTS.md §7 的一贯口径一致：**工具返回成功不等于生效**。）

✅ **真实短链已找到并验证**：`https://aka.ms/vs/stable/vs_BuildTools.exe`
→ 5,695,056 字节、`MZ` 头（对照：VS 2022 的 `aka.ms/vs/17/release/vs_BuildTools.exe` 也是真 exe，4,478,032 字节）。
VS 2026 本身**确实存在**（2025-11 发布，带 v145 / MSVC 14.50）。

**⏳ 正在执行**：`windows-pc` 上已挂 `schtasks heyta-vs2026`（`/RL HIGHEST`，脱离 SSH），
装 `Workload.VCTools` + `Workload.Universal` + `ComponentGroup.UWP.VC` + `VC.Tools.x86.x64`（含 UWP 打包组件，为修 `wapproj` 的 `MSB4019`）。
**这一步单独就能定整条路线** —— 见 §7.1c 的判据。

#### 🔴 另一个非 RTFM 能得到的坑（F4）

`react-native-windows@0.84.0` 的 CLI **硬依赖 `pwsh.exe`**。
症状是 `error: unknown command 'init-windows'`，而根因是
`@react-native-windows/find-dotnet-tools` 抛 `Unable to find pwsh.exe`，
而 **RN CLI 会静默丢弃抛异常的依赖**（`react-native config` 里干脆没有 react-native-windows）。
装了 PowerShell 7 之后 `init-windows` 立刻成功（exit 0, 12394ms）。
**⇒ 以后 RNW 命令"不存在"，第一步查这个。**（已记进 §7 环境陷阱的待办）

### 7.1c 🔴 S1 的**最终判定**：工具集不是变量 —— **放弃 RNW，退 M2**（2026-09-29）

S1 报告的建议是「**单独**做"装 VS 2026 + 只重跑构建与启动 + 截图"这一步 —— 成败单独即可定整条路线」。
**我执行了这一步，并拿到了代理当初缺的那个对照组。**

#### 做了什么（每一步都有实测输出）

| 步 | 结果 |
|---|---|
| 找 VS 2026 引导器 | 🔴 **代理那条 URL 是假阳性**：`aka.ms/vs/18/release/vs_BuildTools.exe` **不存在**，aka.ms 回退到 Bing（`url_effective` 含 `bing.com`，内容是 HTML `<`）。**真短链是 `aka.ms/vs/stable/vs_BuildTools.exe`**（5,695,056 B，`MZ` 头）。对照：VS 2022 的 `vs/17/...` 也是真 exe（4,478,032 B） |
| 装 VS 2026 BuildTools | ✅ `schtasks /RL HIGHEST` 脱离 SSH，`EXITCODE=0`。装到 `\18\BuildTools`，**MSVC 14.51.36231**、`PlatformToolsets\v145` 就位 |
| 还原 `PlatformToolset` 到 **v145** | ✅（代理为兜底改成了 v143） |
| autolink | ✅ 第一次失败：**`--sln/--proj` 被当成相对路径**，传绝对路径会拼成双份（`ENOENT ...\HeytaRnwSpike\C:\src\...`）。用相对路径后 `AUTOLINK_EXIT=0` |
| 处理 autolink 拉进来的 `react-native-svg` | ⚠️ 它的 Windows 工程在 New Architecture 下**拿不到 `OutputPath`**（`MSB… 没有为项目 RNSVG.vcxproj 设置 BaseOutputPath/OutputPath`）。根因链：它按 **`UseFabric`** 分支导入 property sheet，而 RNW 0.84 的 `ExperimentalFeatures.props` 设的是 **`RnwNewArch`**；`ReactNativeWindowsDir` 又靠 `$(SolutionDir)` 推 ⇒ 两条 sheet 的 `Exists()` 都不成立。**为隔离变量，把它从依赖与 sln 里摘掉** |
| **v145 构建** | ✅ **`MSBUILD_EXIT=0` / 48s / exe 3,483,136 B @ 02:15:14**（旧的 v143 是 3,245,568 B @ 01:28:30 —— 两者 mtime 与大小都不同，**这次真的是 v145 产物**） |
| **启动 + 截图**（session 2，照抄既有 `schtasks` 机制） | 🔴 **`EXITED_EARLY code=-1073740791`**（`0xC0000409`）**`RESULT=NO_WINDOW`、`PNG_EXISTS=False`** |

#### 判定

| 工具集 | exe | 结果 |
|---|---|---|
| **v143** | 3,245,568 B @ 01:28 | `0xC0000409` `FAST_FAIL_GS_COOKIE_INIT`，无窗口 |
| **v145**（RNW 0.84 要求的那个） | 3,483,136 B @ 02:15 | **同一个错误码，仍然无窗口** |

⇒ 🔴 **工具集不是变量。** 代理的 F5（"v143 app ↔ v145 DLL 不一致"）**被证伪** ——
把 v145 补上之后，崩法**逐字相同**。而这次崩溃发生在 **CRT 初始化**
（`ucrtbase.dll` / `FAST_FAIL_GS_COOKIE_INIT`），**在任何 JS 或模块加载之前**，
所以"摘掉 react-native-svg"这个隔离动作**不影响该结论**（它改的是链接面与 JS bundle，不是 CRT 启动）。

⚠️ **如实标注一处未排除项**：这次 v145 构建的 `LIB` 环境里有两条
**不存在的路径**警告（`…\14.51.36231\atlmfc\lib\x64`、`…\VC\Auxiliary\VS\lib\x64`）——
说明我装的是 **BuildTools 的精简组件集**，不含 atlmfc 等。所以"**完整** VS 2026 安装
（含全部推荐组件）能不能跑起来"**没有被验证**。
📌 **但不因此推翻结论**：判据里"工具集"这一格已被填上（RNW 要求的就是 v145），
而它**没有改变结果**；继续加装组件属于"再赌一次"而不是"补一个已知缺口"。

#### ✅ 按判据执行的动作

| 动作 | 状态 |
|---|---|
| **放弃 RNW 路线** | ✅ 本文件 §10-Q1 与 [ADR-0036](../adr/0036-main-battlefield-and-rn-single-source-ui.md) 的"Windows → RNW"那一格**改判为 M2** |
| **退 M2（原生壳 + 内嵌 WebView 承载共享 UI）** | ✅ 见 §4.3；⚠️ 它**不需要** v145、不需要 RNW —— 用的是**已经验证能出窗口**的 `apps/desktop-windows` WinUI 3 壳 |
| **记一条 ADR 的"接受残差"** | ✅ [ADR-0037](../adr/0037-desktop-ui-falls-back-to-webview.md) |
| **保留 S1 的证据与脚本** | ✅ `docs/research/spikes/rnw-content-island/`（442 行 README + 11 个脚本）**不删** —— 它是"这条路走过、结论是这样"的证据 |

#### 🔴 这次证伪给方案带来的**正面**结果

M2 需要的三样东西，**今天全部已就位且已被验证**：
1. **能出窗口的原生壳** —— `apps/desktop-windows` 的 MSIX 已装上、窗口已截图（`evidence/packaged-first-run.txt`：`ADD_APPX=OK` / `RESULT=OK` / `1152x587`）；
2. **WebView2 已在 NuGet 许可证清单里**（`Microsoft.Web.WebView2@1.0.3719.77`）；
3. **共享 UI 已能被消费**：`apps/web` 用的就是 `packages/ui` + `react-native-web`，**同一份代码**。

⇒ **M2 不是"退而求其次"，它是把已经在跑的 web UI 搬进已经在跑的 Windows 壳里。**

### 7.1d S1 的分级处置（判据写死，不许含糊）

| 结果 | 处置 |
|---|---|
| **VS 2026 装成 + v145 构建 + 窗口出现** | ✅ 按 M1a 铺开，并立刻补三个依赖缺口（turbo-sqlite / safe-area shim / BCryptGenRandom） |
| **VS 2026 装成但窗口仍崩** | 🔴 **放弃 RNW 路线**（工具链已不是变量，F5 的推断被证实），退 M2，并**如实记一条 ADR 的"接受残差"** |
| **VS 2026 装不上 / 短链再失效** | 🟡 登记为**外部条件阻塞**（不可获得的工具链），同样退 M2；⚠️ **不把它写成"待办交给实现"——它等的是上游** |
| **S1-5（XAML 混排）** | 🔴 **单独立项**，不混进"RNW 能不能用"。已实测：它不是模板能力，要自己写 WinUI 3 宿主 |

⚠️ **无论哪条，`docs/research/spikes/rnw-content-island/` 的结论与脚本都保留** ——
它们是"这条路走过、结论是这样"的证据。

### 7.1e ✅ **完成**：次级表面应当是**浮层**，不是应用内一路由（2026-09-29；执行记录：[`goal-settings-ia.md`](goal-settings-ia.md)）

> 🔴 **排序由产品负责人拍板（2026-09-29）：主战场是移动端 + 电脑端，web 不是** ——
> 执行顺序照 goal：①移动端（主攻）②电脑端验证 ③web 只收尾。**三步全部完成**，
> 判据逐条事实见 goal 文件头那张表；移动端真机那一格的边界（iOS 夹具阻塞）也如实记在那里。
> 移动端结构门禁：`pnpm check:mobile-settings`（可注入故障，已验红→绿）。

⚠️ **§7.1d 把"设置收进头像菜单"做完了，但那只改了**入口**，没改"打开之后是什么"。**
已对照 Dida 实测补齐（证据与规律：`docs/research/dida-capture/INTERFACE-NOTES.md` **§11.5**，
它**取代**了该文件 §12 里"设置页未进入"那条边界）：

| 表面 | Dida | 我们（实测） |
|---|---|---|
| 任务 / 日历 / 四象限 / 习惯 | 应用内视图（rail 切主区） | 同 ✓ |
| 任务详情 | **面板**（占右栏，列表仍可见） | ？未盘点 |
| 快速添加 | **同一根添加条的两态**（不是弹窗） | ？未盘点 |
| 搜索 | 居中**浮层**，下层可见 | 已是独立视图（`role="tab"`）—— **与 Dida 不同，需判断** |
| 通知 | 侧向**浮层** | ？未盘点 |
| **设置** | 侧向**浮层**（两级结构，盖在当前视图上） | **`ViewKey` 之一的应用内路由** —— 替换内容区；`role="dialog"` 的设置浮层 **0 处**（web）；移动端**没有独立设置屏**，全在「我的」里 |

🔴 **规律（不是"弹窗更省事"）**：**这些表面里做的事都需要"回头看下面"**
（搜索时看列表、通知时看列表、设置时也看得到自己在哪个视图）；**主视图之间切换不需要这种回头**，
所以它们才留在应用内。

**判据应当是可执行、可注入故障的**（照 `check:ui-provider` 的先例做成门禁）：
**次级表面必须"下层可见"** —— 例如断言打开设置后**侧栏与当前视图的标记仍在 DOM 里**
（应用内路由会把它换掉，所以这条能红）。

**本条是独立的 IA 任务，同时影响 web 与移动端两端。**

### 7.1d ✅ 信息架构落地：rail / sidebar / header 三层（2026-09-29）

**触发**：产品负责人当场指出两件事 —— ①桌面壳「**分成上下两部分**」（上面手写原生 UI、
下面 WebView）；②「**所有东西都挤在收集箱上面的 Tab**」。并授权直接做
[`../research/dida-view-unification.md`](../research/dida-view-unification.md) §4.4。

#### ① 桌面壳：删掉手写界面，壳 = 窗口 + 共享 UI

macOS 壳的 `ShellView` 里原来有一份**手写的 SwiftUI 任务界面**，而 M2 又在下半屏加了
承载共享 UI 的 WebView ⇒ **同一个窗口里有两份任务列表、各自读各自的库**。
那是 spike 形态（当时为了在同屏证明「两者能并排」），不是产品形态。

现已删除整份手写界面（含 `AppApi` 的初始化、任务状态与增删改），
**壳的内容只有 `SharedWebView`**；`defaultSize` 从 `900×560`（手写界面时代的尺寸）
提到 **1280×820**（§6.3 的审计基准宽度）。

#### ② Web：三层外壳 + 一处同名冲突

| | 改之前 | 改之后 |
|---|---|---|
| 视图切换 | **顶栏平铺 9 个 tab**（1280px 下 8 个时只能完全看见 5 个） | **rail 竖列**（176px，「主要 / 更多」两组，**全部可见**） |
| 范围列 | 与视图、四象限筛选、清单/标签**堆在同一列** | **sidebar，且只在有范围的视图里出现**（目前只有「任务」） |
| 顶栏 | 标题 + 9 个 tab + 动作 | **标题 + 动作**（0 个 tab） |

🔴 **顺带修掉一处同名冲突（调研原文没记录，实测才发现）**：
「四象限」**同时**指 `view === 'quadrant'`（2×2 网格 `QuadrantBoard`）与侧栏的
`QUADRANT_NAV`（`goToFilter({kind:'quadrant'})`，而 `goToFilter` **一律 `setView('tasks')`**
⇒ 其实是**任务列表按单象限筛选**）。用户点侧栏那个「四象限」得到的**不是**四象限视图。
⚠️ **我当时的解法是给侧栏那节改名（「按象限筛选」），产品负责人 2026-09-29 当场否掉：
「侧栏应该就是叫四象限」** —— 侧栏列的就是那四个象限，名字直说。
⇒ **同名冲突是真的，但解法不是把用户认得的词从侧栏拿掉**；真要动，动的是**行为**
（或给 rail 那个视图换个名字）。**现状：侧栏那一节仍叫「四象限」**，冲突记为已知问题、未解。

**与建议的一处偏离（已记理由）**：§4.4 建议把低频视图藏进「更多」菜单，这里做成
**分组但全部可见** —— 折叠是**为顶栏宽度付的代价**，而竖列**没有这个上界**，
所以藏起来就只剩成本（用户多点一次）。

#### 验证

| 项 | 证据 |
|---|---|
| 14 道门禁 | 全 ✅（含 `check:tokens` / `check:l4` / `check:design`） |
| 全量测试 | **3342** 通过 0 失败（design-system 411 / domain 653 / ui 278 / app-host 699 / mobile 411 / web 890） |
| 真浏览器 e2e | `motivation.spec` + `smoke.spec` **8 passed**（含「9 个 tab + 顺序逐字一致」与全部视图白屏检测） |
| 人眼看 | macOS 壳窗口截图：rail 显示「主要（任务/四象限/习惯/时间线）+ 更多（番茄钟/成长/便签/回收站/设置）」，**顶栏 0 个 tab**，**设置视图无 sidebar** |
| 防回退 | `apps/web/tests/app-mount.spec.tsx` **新增 4 条**：顶栏 0 个视图 tab / rail 里 9 个 / 任务视图有 sidebar / 设置视图**没有** sidebar / 侧栏那节叫「四象限」且四个象限都在 |

⚠️ **仍未做**：§4.2 的**行密度契约**（`<TaskRow density="compact|minimal">`）——
四象限/日历格里的行还是各自画的；landing 的 `mockup.css` 仍手工复刻外壳。

#### 再加一层：账号收进头像 + 设置离开 rail（同日）

产品负责人给了滴答 rail 的实拍并说明结构：「**左边分别是任务、日历、四象限、习惯还有搜索这 5 个主菜单，
顶部那个头像，点击头像出现那些更多的设置之类的。然后下面的话有个疑问帮助**」。

⇒ 按这个结构重排（截图实证见 `docs/research/dida-capture/INTERFACE-NOTES.md` §1：
滴答的 rail 是"上段去哪看 / 下段工具（贴底）"两段，**rail 上不存在设置/回收站/便捷签**）：

| | 之前 | 之后 |
|---|---|---|
| rail 顶部 | `heyta` 文字标 | **头像**（点开 → 设置 / 统计 / 退出登录）+ 品牌名 |
| 「设置」 | rail 上的一个 tab | **收进头像菜单** |
| 「帮助」 | 设置页里的一段 | **rail 底部一个动作**（切到设置页并滚到那一段） |
| 「回收站」 | 与视图混在上段 | **工具段，贴底** |
| **默认按钮数** | 6 | **5**（4 视图 + 回收站）+ 头像 |

**账号邮箱落盘**（`credential-storage.ts` 的 `PersistedCredentials.email`）：
头像要用邮箱首字母，而刷新后 `useAuthStore` 会回到 `signed-out`（它的 `signed-in` 没落盘）——
不落 email 就会出现"刚登录是首字母、刷新后变通用图标"的自相矛盾。
⚠️ **不改那条承诺**：口令（解密密钥）**绝不落盘**；email 是**标签**，与 `baseUrl`/`token` 同类。
拿不到 email 时**退回通用图标**，不编一个字母（编出来的会让人以为那是他的账号）。

| 文件 | 动作 |
|---|---|
| `apps/web/src/features/shell/AccountMenu.tsx` | **新建**：头像 + 弹出菜单（设置/统计/退出登录）。点外部、`Esc` 都关闭；退出登录红字（它是这一组里唯一会清本机凭据的） |
| `apps/web/src/features/sync/credential-storage.ts` | `email?` 可选落盘；**老记录没有它不许判无效**（那会让所有老用户莫名被登出） |
| `apps/web/src/features/sync/store.ts` | `email` 状态 + `applyAuthToken(baseUrl, token, email?)`；`email ?? get().email` 保证不会把已有标签抹掉 |
| `apps/web/src/App.tsx` | 头像在 rail 顶部；`TOOL_VIEW_TABS` 只剩 `trash`；**`SETTINGS_VIEW_TAB` 单独登记**（`VIEW_TABS.find(v => v.key === view)` 要查它的 `labelKey`，但它**不参与 rail 渲染**）；帮助在 `role="tablist"` **外面**（它是动作，不是视图） |
| `apps/desktop-macos/.../HeytaMacApp.swift` | **M2 探针改走头像**（设置不再是 tab）；新增 `openAccountMenuProbe`，**分两次求值**（菜单点开才渲染，一次脚本里连点两下第二下必然落空） |

**验证**：14 道门禁全 ✅；web **894**、landing **410**；e2e **9 passed**；人眼看 macOS 壳截图确认 rail = 头像 + 5 个按钮。

🔴 **这一轮门禁抓到的三件事**（都修了，也说明它们真的在工作）：
1. **`check:macos-window` 报「找不到设置 tab」** —— 它复现的正是"设置从 rail 消失"这件事，
   逼我把探针改成走头像（而不是把设置加回 rail）。
2. **探针第二次仍报 `nil`** —— 根因是 **Swift 把 `\'` 解析成 `'`**，于是 JS 变成
   `'[data-testid='account-menu-avatar']'`、引号提前闭合。改用双引号选择器（与既有那条一致）。
3. **门禁吃的是 `apps/web/dist` 构建产物** —— 产物过期时它**测的是旧代码**。
   这次先重建产物再跑，才拿到真结论。
4. **`check:design` 抓到账号菜单里 4 处裸值**（`z-index: 20` / `8px` / `24px` / `rgb(0 0 0 …)`）——
   改成 `var(--ht-z-dropdown)` 与现成的 `var(--ht-shadow-lg)`。

#### ⑩ 日历视图（13 项 #5）：**共享 CalendarBoard**，Web 从"没有这一页"到有（同日）

产品负责人的参考 IA 里，日历是 5 个主菜单之一（任务 / **日历** / 四象限 / 习惯 / 搜索）——
而实测：**`apps/web` 一个日历都没有**（`features/` 下没有 `calendar/`、`ViewKey` 里没有 `'calendar'`），
`apps/mobile` 有一个 439 行的月历。

⚠️ 这一项在 2026-09-29 的复核里**一度被判成"已修"**：`rg -li calendar apps/web/src` 命中 4 个文件 ——
而它们是 `CalendarDays` 图标、习惯热力图、日期显示，**没有一个日历视图**。已更正为"仍未接"。

**做法**：把渲染提到共享层，**不是**在 web 里再写一份。

| 文件 | 动作 |
|---|---|
| `packages/ui/src/calendar/model.ts` | **新建**：`calendarDayTone`（逾期=danger 是"要注意"不是分类）、`groupTasksByDueDate`（用 `toLocalDate`，不是 `new Date(ms).getDate()` —— 后者极易用上 UTC 口径，症状是"凌晨到期的任务落到前一天"）、`MAX_CALENDAR_DOTS`、`CalendarBoardLabels`（动态文案是**函数**） |
| `packages/ui/src/calendar/CalendarBoard.tsx` | **新建**：月网格 + 当天的清单。🔴 当日列表**复用共享 `TaskList`**（`density="minimal"`）—— 这同时给 §4.2 的 `minimal` 档补上了**第一个消费者**（此前它被定义、被测试、却没人用） |
| `packages/ui/src/calendar/date-text.ts` | **新建**：`formatMonthTitleText` / `formatDayTitleText` / `WEEKDAY_MESSAGE_KEYS`。🔴 领域层的 `formatMonthTitle`/`formatDayTitle` **不能替代**：它们是**硬编码中文**的，双语下必须走词条 |
| `apps/web/src/features/calendar/CalendarView.tsx` | **新建**：取数据 + 把 i18n 翻成 `labels` + 转交 action |
| `apps/mobile/src/screens/CalendarScreen.tsx` | **439 → 232 行**：只剩取数据 + 文案 + 动作，界面全走共享板 |
| `apps/mobile/src/lib/date.ts` | **删掉**那三个函数（该文件头自己写着"不要转发一层，转发会让下一个人以为这里还是定义处"）；`DatePicker` / `TasksScreen` 改从 `@heyta/ui` 引 |
| `packages/ui/tests/calendar-date-text.spec.ts` | **新建**：用例**跟着实现搬**；用**记账假 `t`** 断言"要了哪个 key、传了什么参数"（措辞本身归 `check:ui-language`） |
| `apps/web/tests/calendar-view.spec.tsx` | **新建 6 条**（见下） |

**🔴 共享层不许 `import '@heyta/i18n'` 的做法**：照 `auth/model.ts` 的 `AuthFailureMessageKey` 先例，
`date-text.ts` 自己声明 `CalendarDateKey` 字面量联合（`MessageKey` 的子集）。
类型安全：函数参数**逆变**，所以宿主收 `MessageKey` 的 `t` 可以直接传进来。

**Web 验收（6 条，全部按"渲染出来的东西"判，不按字符串命中）**：
rail 上有「日历」且渲染出 ≥42 个格子 / 月份与当天标题符合共享实现的形状 / **未设截止时间的任务不在日历上且页面如实说明** /
当天有任务时**列表里真的有那一行** / 「回到今天」跨月后有效 / 功能模块能关掉它。

**故障注入**：把 `groupTasksByDueDate` 改成返回空表 → `当天列表没渲染: expected null not to be null` **转红**；
还原后 `diff` 空、6/6 绿。

**验证**：14 道门禁全 ✅；全量 **3770** 通过 0 失败
（web 908 / landing 410 / mobile 406 / ui 283 / app-host 699 / domain 653 / design-system 411）；
e2e **9 passed**；landing 的外壳对账已按"默认 rail = 6 项"同步。

⚠️ **途中踩到的两个真坑（都修了）**：
1. `check:ui-language` 报"像词条的行 1880、只解析出 1879" —— 我插 `common.*` 块时把
   `'mobile.weekday.mon'` **粘到了上一行末尾**（漏换行）。门禁直接失败而不是继续，**它做对了**。
2. 展厅的 `SHELL_ICONS` 是 `Record<ShellNavIconId, LucideIcon>`，我加 `calendar-days` 时**只改了数据没改类型** ⇒
   运行时拿到 `undefined` ⇒ React 渲染抛错 ⇒ **53 条展厅测试连带红**。补 `ShellNavIconId` 与映射即恢复。

⚠️ **并行会话的在途改动（我没碰）**：`apps/web/tests/ai-tool-run.spec.tsx` 被另一个会话改成
`grants?: typeof READ_GRANTS` 并传 `grants: {}`，而该类型要求全部键 ——
`pnpm exec tsc -p tsconfig.spec.json` 因此报 2 条错（**运行时 6/6 通过**）。
按纪律**不误伤在途改动**，故未修，仅记录。

#### ⑩ 全局搜索：**便签在此之前根本没有搜索入口**（同日）

产品负责人的 5 个主菜单里最后一个（任务 / 日历 / 四象限 / 习惯 / **搜索**）。

**实测的缺口不是"任务搜不到"** —— 两端都有搜索（web 顶栏输入框、mobile 任务页输入框），
共用 `@heyta/domain` 的 `searchTasks`。缺的是：**`NotesView` / `NotesBoard` 里一个 `query` 都没有** ——
"我记过这么一句话，在哪？"**没有任何地方能做**。

| 文件 | 动作 |
|---|---|
| `packages/domain/src/search.ts` | 加 `searchNotes` / `noteSearchText`。🔴 便签**没有 `title`**（正文在 `content`），所以不能直接喂 `matchesQuery`；`noteSearchText` 把 `content` 放进 `title` 位（该字段语义是"主要文本"，不是"标题"）。匹配语义复用 `termsOf`/`matchesQuery` ⇒ **AND、大小写、空查询匹配一切**三条只有一处定义 |
| `packages/ui/src/search/SearchPanel.tsx` | **新建**：输入 + 分组结果（任务走共享 `TaskList`、便签走 `notes/model.ts` 的 `toNoteRows`）+ **两种不同的空**（"还没输入" ≠ "没找到"） |
| `apps/web/src/App.tsx` | 「搜索」= 常驻视图（`SEARCH_VIEW_TAB`），排在**上段最后一个**；结果跨**全部**任务与全部便签 |
| `apps/web/tests/search-panel.spec.tsx` | **新建 6 条** |

**🔴 三个刻意的决定**

1. **它是视图（`role="tab"`），不是"点了弹浮层的动作"**。`tablist` 里放非 tab 元素是无效 a11y 结构
   （「帮助」正因此被放到 tablist 外面）。**能力相同**（跨任务与便签的全局搜索），
   "浮层 vs 整页"是呈现细节 ⇒ 组件名叫 `SearchPanel` 而不是 `SearchOverlay`。
2. **顶栏那个输入框保留**，两者分工写进 `SearchPanel.tsx` 文件头：
   顶栏筛的是**当前任务列表**（更快），本面板搜的是**全部任务 + 全部便签**（够得到便签）。
   删掉顶栏那个是功能倒退。
3. **`--ht-layout-panel-max-height` 进了 tokens.css + registry**（浮动结果区的最大高度是**布局约束**，
   不是间距）。⚠️ 只加 tokens.css 不加 registry 会被**生成器静默丢掉** —— 上一轮刚踩过。

**Web 验收（6 条）**：rail 上有「搜索」并渲染出面板 / 🔴 **便签能被搜到**（这是它补的缺口，
写成"搜到一条任务"在便签没接时**照样绿**）/ 任务与便签**分组**列出 / 「还没输入」与「没找到」是
两种不同的空 / 多词 AND / 清空后回到"还没输入"而不列出整个库。

**故障注入**：`searchNotes` 改成 `return []` → 2 条转红
（`搜「咖啡豆」之后没找到那条便签` / `没搜到便签`）；还原后 `diff` 空、6/6 绿。

**验证**：14 道门禁全 ✅；全量 **3782** 通过 0 失败
（web 914 / landing 410 / mobile 406 / ui 283 / app-host 699 / domain 659 / design-system 411）；e2e **9 passed**。

🔴 **这一轮把上一次记的"对账缺口"真的踩了一遍**：我最初把「搜索」写成**硬编码按钮**，
于是 rail 上有 7 个 tab、而 landing 的外壳对账（读的是 `VIEW_TABS` 常量）**照样绿**。
已改成常量驱动（`SEARCH_VIEW_TAB`），并让对账函数把它算进来 ——
⚠️ 顺带修了它的一个解析缺陷：`SEARCH_VIEW_TAB` 是**单个对象**（以 `};` 结尾），
而原来的 `arrayBlock` 找 `];`，会一路吃到下一个 `];`，把后面几个常量全吞进来（实测算出 8 项而不是 7）。
**"按常量对账 ≠ 按渲染对账"这条缺口本身仍然存在**（见下）。

⚠️ **landing 对账的一个真缺口（已记，未修）**：`apps/landing/tests/mockup-shell-shape.spec.tsx`
的 `appDefaultRail()` 读的是 **`App.tsx` 的三个常量数组**，而**不是实际渲染结果** ——
所以"常量里写了、`visibleToolTabs` 却不渲染它"这种不一致**它抓不到**
（改成 trash-only 之后它照样绿）。已把 `SHELL_VIEW_TABS` 与常量对齐，但
"按常量对账 ≠ 按渲染对账"这件事值得单独处理。

#### 追加（同日，产品负责人两条更准的约束）

> 「左边的侧边栏那个按钮应该尽可能地减少」
> 「（滴答设置页截图）就是这样子的自定义也可以」

⇒ 照滴答的**「功能模块」**机制重做：

| | 之前 | 之后 |
|---|---|---|
| rail 上段 | 9 个视图全放 | **任务 + 已启用的模块** |
| rail 下段 | —— | **回收站 / 设置**（贴底，**不给关**） |
| 默认开启 | 全部 | 四象限 / 习惯 / 时间线（"任务类"） |
| 默认关闭 | —— | 番茄钟 / 成长 / 便签（"额外玩法"） |
| **默认按钮数** | **9** | **6**（全关掉剩 3） |

| 文件 | 动作 |
|---|---|
| `apps/web/src/features/shell/modules.ts` | **新建**：模块 registry（`defaultOn`）+ 设备本地偏好（**存显式覆盖**，不是整个集合）+ `toggleModule`。契约**永不抛** |
| `apps/web/src/features/shell/FeatureModulesPanel.tsx` | **新建**：设置页最前面的卡片式开关（标题 + 一句说明 + 右侧开关）。🔴 "已保存"那句**只在真的改过之后才显示** |
| `apps/web/src/App.tsx` | rail 按 `enabledModules` 过滤；**关掉的模块不进 DOM**；工具段与视图段**共用同一个 `role="tablist"`**（`role=tab` 跑到 tablist 外面是无效结构） |
| `apps/web/src/styles/app.css` | 卡片网格（`auto-fill` + `minmax`，窄窗口不压扁）+ 工具段贴底（`margin-top:auto`，**不插 spacer 元素**） |
| `apps/landing/src/mockup/app-shell-shape.ts` | `SHELL_VIEW_TABS` 改为**默认 rail**（6 项）—— 画"全部 9 个"是另一个方向的不实 |
| `apps/landing/tests/mockup-shell-shape.spec.tsx` | 对账改成"**默认 rail**"：多读一份 `modules.ts` 的 `defaultOn` 一起算 |

**验证**：14 道门禁全 ✅；全量 **3346+** 测试通过（web **894**，其中 +4 条模块开关验收；
landing **401**，含改写后的对账）；**真浏览器 e2e 9 passed**（多了一条
「默认 rail 只有 6 个」——它**刻意不走 `openApp`**，因为 `openApp` 会打开全部模块，
那条断言在那套配置下永远测不到）；**人眼看** macOS 壳截图确认 6 张卡片与 6 个按钮。

🔴 **门禁抓到了我这次改动的三处**（都修了，记下来）：
1. `apps/landing` 的**外壳对账**按源码文本解析 `VIEW_TABS`，我改成三个展开拼接后它**当场红**
   —— 那条门禁正是为"复刻与真应用漂移"发明的，它工作了。
2. `language-switcher.spec` 报 `[role="tablist"]` 里找不到 `Settings` ——
   它暴露出我把「设置」**移出了 tablist 却还留着 `role="tab"`**（无效 a11y 结构）。
3. 我自己一度把 `quadrant/habits/timeline` **同时**写进 `PRIMARY_VIEW_TABS` 与
   `SHELL_MODULES` 的默认值里 —— 同一件事写两遍，已合并成
   `ALWAYS_ON`（只有任务）/ `MODULE` / `TOOL` 三段。

### 7.2 门禁（新增/变更）

| 门禁 | 要做什么 |
|---|---|
| `check:tokens` | ⚠️ **C# / C 生成物已不需要**（G0：UI 走 RN token 层）。改为**断言 RN token 层被桌面平台消费**，并覆盖壳 chrome 的生成物（若有） |
| `check:design` | `SCAN_ROOTS` 覆盖三个桌面壳；⚠️ 接 RN 后桌面 UI 的样式主要在 `packages/ui` 里，**壳侧只剩 chrome** ⇒ 扫描重心回到 `packages/ui` |
| `check:macos-shell` / `check:windows-shell` / `check:linux-shell` | **接线**进 `pnpm check`；非本机平台**响亮跳过**并打印原因（不是静默通过） |
| 新增：**UI 单源一致性** | 🔴 **判据升级**：不再是"两边渲染同一份契约"，而是"**字面上同一份代码**" —— 断言桌面平台消费的 `packages/ui` 与 web/mobile **是同一个 workspace 包**（`check:row-single-source` 已有基础，扩到桌面） |
| 新增：**排序单源** | 断言桌面路径与 `sortTasksForDisplay` 同序（§2.4） |
| `check:docs` | 已存在；本文件加入死链检查 |

### 7.3 不许出现的形状（本仓反复踩过的）

1. **「界面/账本说成功、功能没接上」** —— 13 项幻觉就是这个形状。
2. **静默跳过**：门禁在缺工具链时必须**打印"已跳过"**，不能静默通过。
3. **同一事实两份源**：§2.4 的排序就是现行案例。
4. **文档声称已接线而代码没有**：§2.7 的 4 处。
5. **把"跑起来了"当"验过了"**：截图必须有人眼看（本仓硬规范）。

---

## 8. 既有调研的收敛（存废表）

### 8.1 计划层：30 份 / 25,117 行 → **✅ 已收敛为"单一索引 + 权威标注"**

🔴 **执行时推翻了本节初稿的"批量归档"方案，原因是一条实测**：

> 本目录原有 **30 份**文件中，**零引用的有 0 份**；**25 份被 ≥3 个文件引用**。
> 物理移动会打断约 **150 处跨文档引用**（`check:docs` 会红，但那 150 处是机械改写，容易改出"链到了但语义变了"）。

⇒ **改用的做法**（本轮的**实际**收敛手段）：

| 动作 | 产物 | 效果 |
|---|---|---|
| **建立唯一入口** | [`README.md`](README.md)（96 行） | 逐文件标注：哪份是权威、哪份已交付、哪份被谁取代。**"当前状态该看哪一份"只有一个答案** |
| **给 4 份被取代的多端计划加权威标注** | `multi-platform-adaptation.md` / `desktop-native-migration.md` / `phase-2-multi-platform.md` / `site-and-parity-alignment.md` 各加 3–5 行 | 打开任何一份旧文件，**第一眼就知道它哪部分还有效、哪部分已被取代**，不必先读完 |
| **修正 `phase-2-multi-platform.md` 的状态行** | 由"进行中"改为"🔴 已被取代" | 它原先的状态行是**解不开的口令噪音**，读的人会以为它还在跑 |
| **挂进文档中心** | `docs/README.md` 的 `plans/` 行指向索引 | 下一个会话从文档中心进来就能看到，不会漏 |

**没有做（且不建议现在做）**：

| 项 | 为什么不做 |
|---|---|
| 物理移动 30 份文件到 `archive/` | 150 处引用要机械改写；**收益只是"目录更短"，风险却是"引用链断掉"**。索引已经解决读者的真实问题 |
| AI 线 12 份合并为 2 份 | 是**写作**任务（要逐份判断结论存废），不是机械操作。**建议单独立项**，且先看索引里对它们的定位 |
| 订阅/计费 6 份合并为 1 份 | 同上。且微信支付已搁置，这一簇的紧迫性最低 |
| `multi-platform-widgets-progress.md`（5,463 行）搬到 `docs/operations/` | 它被 2 个文件引用；搬之前要确认它的**进度日志**属性（若是日志，`docs/operations/` 才对） |

**判据（未变）**：`docs/plans/` 里**每一个"当前状态"只有一处** —— 本轮已达成这一点（索引 + 4 份标注），
**"文件数 ≤ 10"是下一轮的目标**，不是本轮的。

### 8.2 调研层：`docs/research/`（本轮 +1 份）

| 文件 | 处置 |
|---|---|
| 🔴 **`multi-platform-best-practice.md`（新，本轮）** | **保留 —— 这是本方案 §3.2/§3.3/§4.2/§4.3 与 Q1 修订的依据。** 它补上了仓库此前**系统性缺失的联网检索**（原调研自述 `web_search` 全程 432、无社区一手证据） |
| `dida365-feature-benchmark.md` / `dida-view-unification.md` / `dida365-help-center-ia.md` | **保留为对标唯一源**；本文件 §5 是它们的排期化出口 |
| `dida-capture/`（新，本轮） | **保留**（脱敏后） |
| `multi-platform-ui-fusion.md` / `multi-platform-selection-evidence.md` / `desktop-shell-selection.md` | **保留为选型证据**；⚠️ **但其中"桌面也上 RN 不可行"的结论已被 `multi-platform-best-practice.md` §3 用 npm registry 直查推翻** —— 读它们时以新文件为准 |
| `reuse-plan.md` / `reusable-components.md` | **保留**（前者仍是组件选型入口） |
| `feature-matrix.md` | **并入** §5.5 |
| `showcase-fidelity-audit.md` / `site-ia-and-landing-audit.md` | 归档（landing 相关） |
| `e2ee-*` / `ai-*` / `licensing-*` / `motivation-psychology.md` / `migration-tooling.md` | 保留 |
| `research/universal-rn-*.md`（仓库根） | **保留但降权**：头部自述"AI 子代理产出、未经逐条核实" |

### 8.3 权威口径（冲突时以谁为准）

1. **代码与实测** > 2. **ADR** > 3. **本文件** > 4. `docs/research/` > 5. 仓库根 `research/`

---

## 9. 未核实项（不许当结论用）

1. 🔴 **M1a（RNW 内容岛）的可行性本身** —— §7.1 的 S1 之前，M1a 只是**有最佳实践依据的推荐**，不是已证事实。**最佳实践成立 ≠ 在我们这个仓库成立。**
2. 🔴 **`packages/ui` 在 RNW 上的可用面** —— 本仓依赖 `lucide-react-native` / `react-native-svg` / `react-native-safe-area-context`，**均未逐项核实**。⚠️ 本仓 `research/tools/windows-native-gaps.mjs` 数出的"4 个原生库 / 3 个缺口"是**基于 RNW 不可用的前提**数的，**该前提已被本方案推翻，必须重跑**。
3. 🔴 **RNW 能否注册 Windows 系统小组件**（`IWidgetProvider`）—— **仍无任何真实先例**。**不能因此判不行**（RNW 是 WinAppSDK Win32 + 可 packaged MSIX，具备前提），但**必须实测**。
4. 🔴 **RNW 上的 SQLite 驱动** —— 移动端用 `@op-engineering/op-sqlite`，**其官方支持列表不含 Windows**。Windows 侧要用什么驱动**未定**。
5. 🔴 **heyta 的移动端本身已在 RN 不受支持区**（0.84 = Unsupported；`0.85` 已 End of Cycle）。**升级到 0.87 这件事欠着、且与本方案正交**，但**升级窗口在收窄**。
6. **`react-native-macos` 0.84.0 的发布时点** —— [tracker #3098](https://github.com/microsoft/react-native-macos/issues/3098) 里 PR 是开的，**微软没有承诺日期**。
7. **RNW 0.84 与 RN-macOS 0.84 能否在同一 monorepo 共存**（两个 out-of-tree 平台 + 同一个 RN 0.84.1）—— **没找到先例**，需要 spike。
8. **接 RNW 后 Windows 侧是否还需要现有的 Jint 桥** —— RNW 自带 JS 引擎，两者大概率不能并存；**替换还是保留未定**。
9. **`Microsoft.Web.WebView2` 已在 NuGet 许可证清单里**（`Microsoft.Web.WebView2@1.0.3719.77`），但**尚未在任何 `.csproj` 里被直接引用**（仅走 M2 过渡档时才需要）。
10. **GTK4 侧尚未链接任何 WebKit** —— `apps/desktop-linux` 目前只链 JSC。
11. **Jint 的性能与内存完全未测**；`Options.LimitMemory(n)` 是**累计分配预算**，不是峰值上限；**内嵌引擎失控会杀掉整个进程**（实测退出码 134）。
12. **`packages/ui` 迁移剩余量没有最新的总表** —— 计划里的"8 个特性/11,100 行"是 09-28 晚快照，之后又落了多刀。
13. **滴答取证未覆盖**：番茄钟（rail 上无入口）、详情面板完整字段、右键/拖拽、浅色主题、日历周/日视图。
14. **「复选框颜色=优先级」是推断不是实测**（依据见 `INTERFACE-NOTES.md` §12）。
15. **Linux 桌面用户证据仍然为零** —— 当初不做 Linux 的原生壳的理由**从未被推翻**。
16. **鸿蒙**：`op-sqlite` 只支持 iOS/Android/macOS/web，**未列鸿蒙**；这是鸿蒙壳最大风险点，仍未验。
17. **Office 那 40+ 个用 RN 的体验是否含 macOS** —— 微软那篇博客只讲 Windows，**不要推断 Office 在 macOS 上用 RN**。
18. **`OpLog` 迁移**：本方案**不动**存储与同步（`ADR-0027` 已统一到 SQLite）。

---

## 10. 三个分叉 —— Q1 **已于 2026-09-28 修订**；Q2 / Q3 维持

> Q2 / Q3 的选定不变。**Q1 被最佳实践调研推翻并重定**，理由见 §3.2/§3.3 与
> [`../research/multi-platform-best-practice.md`](../research/multi-platform-best-practice.md)。

| # | 问题 | ✅ **现行选定** | 说明 |
|---|---|---|---|
| **Q1** | 桌面 UI 复用机制 | 🔴 **（M2）原生壳 + 内嵌共享 Web UI** —— ⚠️ **2026-09-29 二次修订**：M1a（RNW）被 S1 实测否掉（见 §7.1c / [ADR-0037](../adr/0037-desktop-ui-falls-back-to-webview.md)），按预写判据退 M2 | **两次修订的完整轨迹**：<br>· 最初选 (M2)，理由是当时以为「桌面也上 RN」被上游堵死（**那个判断是错的**：只看了 `latest` 标签）。<br>· 改为 (M1a/M1b) RN 全端 —— 依据是 `react-native-windows@0.84.0` 的 peer 与 heyta **逐字相同**（**这条成立**）。<br>· **又退回 (M2)** —— 因为 S1 真机实测：JS 侧成立，但原生侧装了它要求的 v145 **仍然崩溃、无窗口**（**工具集不是变量**）。<br>· 三次改动都不是翻烧饼：每一次都由**新的实测**推动，且每次都留了修订痕迹。 |
| **Q2** | Linux 定位 | **与 macOS/Windows 同架构，但不做专项功能** | 不变。⚠️ **仍然没有 Linux 桌面用户的证据** |
| **Q3** | Electron（`apps/desktop`）退役时点 | **等壳级门禁替换掉 `desktop-window.spec.ts` 的断言之后** | 不变 |

**Q1 的授权来源**：产品负责人 2026-09-28 原话「你来搜索一下最佳实践吧…**然后按照他们的来也行**」。
⇒ 本表是**按最佳实践重定**的结果，不是执行方自选。

⚠️ **Q1 是"选定机制、未证可行"**：M1a 尚未验证（§7.1 的 S1 spike 是门槛）。**不要把本表读成"M1a 已成立"。**

---

## 11. 下一步（唯一入口）

### ✅ 已完成（2026-09-28，本轮）

| 步 | 内容 | 结果 |
|---|---|---|
| **第 0 步** | §6.1 T1 清理 | **释放 2.23 GB**（保留 `dist/` 与 `.pnpm-store`，理由见 §6.1） |
| **第 0 步** | §6.2 T2 文档改正 | **6 项已修**（第 7 项"清相对时间"待做） |
| **第 0 步** | §6.4 T4 之一：`AGENTS.md` §2 补四行桌面壳 | ✅ 已补 |
| **第 0 步** | §8.1 计划层收敛 | ✅ 建立 [`plans/README.md`](README.md) 唯一入口 + 4 份计划加权威标注 |
| **第 0 步** | 滴答取证隐私保护 | ✅ 12 张原图加 `.gitignore`（只入库 3 个文本文件） |
| **第 0 步** | 🔴 **最佳实践调研（补上仓库缺失的联网检索）** | ✅ [`../research/multi-platform-best-practice.md`](../research/multi-platform-best-practice.md) —— **并因此推翻了本方案自己的 §3.2/§3.3/§4.3 与 Q1** |

### ⏭ 下一步

> 🔴 **2026-09-29 重写**。这一节此前把 **S1（RNW 内容岛）** 列为"第 1 步是门槛"，
> 而那条路**已被实测否决**：RNW 在 v143 与 v145 上都在 CRT 初始化阶段
> `0xC0000409`（FAST_FAIL_GS_COOKIE_INIT）崩溃、窗口从未出现，
> 工具集不是变量。⇒ **ADR-0037** 改走 **M2（原生壳 + 内嵌共享 Web UI）**。
> **唯一入口指向一条死路**是比"没有入口"更坏的状态 —— 它会让接手的人先去走一遍那条路。

**①–⑩ 全部已做完并验证**（§6.5 的十步，与本节原 1→7 是同一序列的两种写法）：

| 步 | 内容 | 结果 |
|---|---|---|
| ①② | T1 清理 + T2 文档改正 7 项 | ✅（第 7 项"清相对时间"已做） |
| ③ | S1-0 → S1-5（RNW 内容岛门槛） | ✅ **做完并被否决**：5 个 spike + 11 个脚本 + 证据留档；结论进 **ADR-0037**（含"复活条件"），**没有删掉任何过程** |
| ④ | G3（壳 chrome 的 token 接线） | ✅ |
| ⑤ | G5（消除排序漂移 + 加断言） | ✅ |
| ⑥ | T4（治理：ADR-0034 重开 / 新 ADR / 0031 落定 / 取代链 / roadmap 口径） | ✅ |
| ⑦ | M1a 落地（壳界面换成共享 UI） | ✅ **改走 M2**：壳 = 窗口 + WebView，手写界面已删 |
| ⑧ | T3-3（三个壳门禁接进 `pnpm check`） | ✅（macOS 已接并会红；Windows/Linux 响亮跳过） |
| ⑨ | 退役 Electron | ✅（前置 ⑧ 已完成） |
| ⑩ | §5.5 新序补功能 | ✅ 提醒 / 子任务 / 搜索 / 已完成入口 / 备注编辑 / **日历** / 滴答导入三端 / 13 项幻觉复核 |

**13 项「看起来有其实没有」：12 项已修、1 项外部阻塞。**
唯一剩下的是 **#13 鸿蒙**，而它的**构建链已实测打通**
（`verify:harmony-rnoh` 17/17 → 37MB HAP；`verify:harmony-rnoh-js` 29/29 → 20MB release HAP，
含真 codegen / 真 autolinking / `hermes_bundle.hbc`）；
**卡的是模拟器系统镜像 + 签名**（产物 unsigned）—— 本机没有设备/镜像，纯外部条件。

#### 🔴🔴🔴 iOS 验收的三层"**绿而无效**"，以及它盖住的一个真死导出（同日）

给 `verify-mobile-ios.sh` 加第 7 步（设备上的**入站**方向：服务端推 → app 不点也收到）之后，
它连红了几轮。**每一轮的"红"都不是产品缺陷，而是这条验收自身在骗人** —— 而其中两层
足以让**任何**结论失效。这一节按发现顺序记，因为顺序本身就是教训。

**第一层：这个脚本 `不构建** —— 它验的是模拟器上**已经装着**的那个包**

前置条件里写着"该模拟器上已装好 Release 版"，而**全仓没有一处 `simctl install`**。
⇒ 我为实时通道改的代码**根本没上设备**，而脚本照样给出 36 项结论。
这正是本仓在 `mobile-e2e-up.sh` 文件头写过一次的那条：**"测试全绿 ≠ 这是当前产物"**。
已改成默认 `xcodebuild` + `simctl install`（`HEYTA_IOS_SKIP_BUILD=1` 可跳过）。

**第二层：bundle id 是过期的默认值 —— 它验的是**另一个 app**

```
工程里：  PRODUCT_BUNDLE_IDENTIFIER = com.heyta        （apps/mobile/ios/HeytaMobile.xcodeproj）
脚本里：  BID=${IOS_BID:-org.reactjs.native.example.HeytaMobile}   ← RN 模板的默认值
```

`simctl install` 装的是 `com.heyta`（**exit 0**），而脚本的 `get_app_container` /
`launch` / `phone_db()` 全都在查那个**根本不存在**的旧 id —— 于是它启动的、读 SQLite 的、
验的都是另一个 app。设备上实测积了**三个容器**：

```
34DE96BF…  09-28 20:51  6261119
3BF41560…  09-29 10:40  6383056   ← 我构建的
CAF2F462…  09-27 21:37  4522575   ← get_app_container 实际解析到的（两天前）
```

⇒ **这套验收跑了整整几轮，验的是两天前的代码。** 已把两个脚本的 `BID` 默认值改成 `com.heyta`。

**第三层：我自己写的那条"新鲜度判据"是恒真的**

为防第一层复发，我加了一条"已安装的包不比源码旧"。它**通过了** —— 而它是坏的，**两个独立的错**：

| 错 | 症状 |
|---|---|
| `find … -newer /dev/null` | `/dev/null` 是设备文件，它的 mtime 是**当下**（实测 `stat` 给的就是那一刻）⇒ `-newer` 恒假 ⇒ **一个文件都匹配不到** |
| `… \| xargs stat -f '%m'` | 本仓库路径里有**空格**（`All in one Data/01_PROJECTS/heyta`），`xargs` 默认按空白切分 ⇒ `stat` 收到不存在的路径、错误被 `2>/dev/null` 吞掉 ⇒ **输出 0 行** |

两条叠加 ⇒ `SRC_MTIME=0` ⇒ `BUNDLE_MTIME >= 0` **恒真**。实测：`find | wc -l` 是 **282**，
而 `find | xargs stat | wc -l` 是 **0**。

⇒ 现在的判据有三个分支，**算不出输入时红**而不是放过：
`SRC_MTIME ≤ 0` → 红（"判据没在运行，不是通过"）；解析不到 app → 红；bundle 比源码旧 → 红。

🔴 **这一层最值得记**：它是我为**防**第一层写的，而它自己变成了同一类东西 ——
**一个永远绿的判据比没有判据更坏**，因为它会让人以为这一段被守住了。

---

**清掉这三层之后，第 7 步终于验到了真东西，并立刻报出一个真死导出**

`notifyConfigured()` 在 `apps/mobile/src/sync/auto-sync.ts` 里**被导出、文档写着
"用户刚保存了同步凭据 —— 立刻同步一次"，而生产代码里一个调用点都没有**。
同步之所以还能发生，靠的是 `write-signal` 的"本地写入"那条路；
于是它承载的另一件事 —— **启动实时通道** —— 永远不会发生。

**修**：在三处保存凭据的地方配对通知（`auth/session.ts`、`ProfileScreen` 的 effect
与 `onSync`），并加一条**结构性**判据：每个 `writeSyncConfig(` 调用点后 25 行内必须有
`notifyConfigured();`。故障注入：注释掉 ⇒ **红**
（`auth/session.ts:63 写了同步凭据，却没通知`），还原后 12/12。

⚠️ **判据必须能识破"注释掉的调用"**：我当天早些时候写的第一版是
`/notifyConfigured[\s\S]*?startRealtime\(\)/` —— 它**把注释掉的调用也算成调用**，
注释掉照样绿。现在的版本**先剥掉行尾注释再判**。

⚠️ **`session.ts` 里只能用动态 `import()`**：静态引 `auto-sync` 会把
`react-native` 拖进 node 测试，而 RN 的入口是 **Flow 源码** ——
实测 `RolldownError: Flow is not supported`，整个 `auth-flow.spec.ts` 连**加载**都过不去。

**第四层（我自己的修复里）：等待的"条件"写错了 —— 于是它等于没等**

修第 5 步抖动时我写了一个"等到按钮回到空闲态"的循环，而它的条件是
**"按钮出现"**。可那个按钮**一直都在**（`disabled={!configured}`）——
变的只是 `enabled`。⇒ 循环第一次就返回，然后下面那条 `enabled` 断言红掉。
**等待的条件写错比超时更难发现：它不超时。** 已改成等 `found && enabled`。

⚠️ 这一层与前两层的形状完全一样（**判据看起来在工作，其实什么都没判**）——
而它是我在为**修**前两层的过程中写出来的。**同一天里第四次**。

**顺带修掉的一个测试抖动**（3 次红 2 次，且**不可归因**）

第 5 步"找不到「立即同步」按钮"：按钮的文案是
`busy ? '正在同步…' : '立即同步'`，而脚本只等 **5 秒** ——
首次同步含纯 JS Argon2id 派生（实测约 50 秒），期间那个标签**不存在**。
改成**等到按钮回到空闲态**（最多 120 秒），并在失败时打印现场
（按宽泛 label 问"按钮在不在、什么文案"）。
⚠️ 第一版诊断用了 `ax - --dump` —— 而 **shim 没有 `--dump`**（argparse 直接报错、
静默输出空），所以诊断本身也是空的。改用宽泛 label 才看得见。

#### 🔴🔴 入站方向验收第一次跑就抖出一个**真 P0**：实时通道的端点是错的（同日）

写 `scripts/verify-realtime-push.mjs`（对着**真服务端**验"服务端推 → 监听端收得到"）之后，
它**第一次运行就红了**：

```
❌ WebSocket 出错：Unexpected server response: 404
❌ 8 秒内没连上 —— 令牌无效 / 端点不对 / 服务端没注册 /ws
```

对着真服务端量两个端点：

```
GET /ws             → 404
GET /api/sync/ws    → 101 Switching Protocols
```

**根因**：`buildRealtimeUrl` 拼的是 `${origin}/ws`，而服务端把 `wsRoutes`
注册在 `prefix: '/api/sync'` 下（`server/src/server.ts`）。

⇒ **客户端连的是一个不存在的路径。** 真实部署里实时通道会**永远 404**、
按退避重试、而界面上看不出任何异常 —— 正是本仓最贵的那类"看起来在工作"的失效。

🔴 **为什么它一直没被发现（这一条比 bug 本身更重要）**

| 层 | 状态 |
|---|---|
| `packages/sync-client/tests/realtime.spec.ts` | **绿** —— 而它把 `/ws` 这个**错路径逐字断言了下来**。测试与实现一起错，所以两边都"对" |
| web / mobile 的接线测试 | **绿** —— 它们用**假 WebSocket**，任何 URL 都接受 |
| `check:crosslang-contract` / 14 道门禁 | **全绿** —— 没有一条会去连真服务端 |

⇒ **判据必须有一份对着真服务端连一次**。这也解释了为什么"入站方向"不能
靠"出站方向已经验过"来推：两者走的**不是同一个 URL**（出站是 HTTP `/api/sync/ops`，
入站是 WS）—— 出站通了完全不能说明入站通。

**修法**：`buildRealtimeUrl` → `/api/sync/ws`；同步改掉 spec 里那 4 处断言。
并给 `verify-realtime-push.mjs` 加了一条**结构性约束**：它**直接 import
`buildRealtimeUrl`**，不自己手拼 URL —— 于是"客户端改错，这里就红"，
而它第一次就是靠这个抓到的。

**新验收 `scripts/verify-realtime-push.mjs`（7 项，exit 0）**

| # | 断言 | 它防的失效 |
|---|---|---|
| 1 | 服务端 `/health` ok | 没起栈就往下跑 |
| 2 | 监听端连上 `/ws` | 令牌无效 / 端点不对（**就是这一条抓到的 P0**） |
| 3 | **反例**：上传之前 **3 秒内没有 `new_ops`** | 推送是"无条件定时发"的（那会让正例永远绿） |
| 4 | 笔记本设备 `add` + `sync` 真的成功 | 写入方是假的 |
| 5 | 监听端收到 `new_ops` 且 `latestSeq > 0` | 服务端没广播 / 收不到 |
| 6 | 消息**不带内容字段**（`ops`/`payload`/`ciphertext`…） | 有人把 op 内容搬进这条通道（E2EE 边界问题，不是风格） |

**故障注入**：把 URL 改回 `/ws` ⇒ 第 2 条**红**（404）；还原后 `diff` 空、7/7 绿。

⚠️ **我自己写错的两条断言（都改了，如实记下）**
1. 反例原本判"一条消息都没有" —— 而服务端**连上时会先发 `{type:'connected', …}` 握手**，
   于是反例**假红**。改成只盯 `new_ops`（把手按设计排除）。
2. `new_ops` 字段原本判"恰好 `{type, latestSeq}`" —— 服务端还带 `timestamp`（服务器发消息的时刻），
   那**不是内容**，于是又**假红**。改成**黑名单**（不许出现承载内容的字段）。
   **白名单数数会把合法的元信息也拦下，而它对真正的泄漏并不比黑名单更敏感。**

#### 🔴 移动端**真机**验收跑通了：`verify:mobile-ios` **36/36、exit 0**（同日）

此前把"真机双设备实测"记成外部阻塞，依据是"唯一的 Android 模拟器属于另一个项目"。
**那个判断只对了一半** —— 它还漏了 **iOS 路径**，而那条路是本仓早就打通并固化的。

| 命令 | 结果 |
|---|---|
| `PORT=3100 bash scripts/mobile-e2e-up.sh` | exit 0，服务端 `{"status":"ok","db":"connected","wsConnections":0}` + 全新账号 |
| `PORT=3100 bash scripts/verify-mobile-ios.sh` | **通过 36 项，失败 0 项，exit 0** |

**其中第 6 步正是我这一轮改过的那条路**（`auto-sync.ts` + 新的 `sync/realtime.ts`）：

```
════ 6. 自动同步：凭据配好后再写一条，**一下都不点**，它必须自己出去 ════
   ✅ 服务端在第 1 轮（约 5 秒）收到 Upload —— **全程没点过任何同步按钮**
   ✅ 笔记本（node-host 真 SQLite）在第 1 轮读到了「ios-autosync-100047」
```

⇒ **零点击自动同步在真机（iOS 模拟器 + 真服务端 + 真 SQLite 的笔记本设备）上没有回归。**
⚠️ 但要说清楚它**没有**验什么：它验的是"**写入会自己出去**"（那条我改过的路径仍然通），
**不是**"服务端主动推、这台不点也会收到"（实时通道的**入站**方向）。
后者需要造一次真正的服务端推送，仍然没做。

⚠️ **为什么一开始误判成阻塞**：`adb devices` 只有一个 `emulator-5554`（AVD `SSOS-Parity-A36`，
另一个项目的），而 `emulator -list-avds` **只有它** ⇒ 我据此下了"Android 不可用"的结论，
**没有再看 iOS**。教训与前几轮同源：**"这条路上没有"不等于"没有路"**。

#### 顺手修掉的一条**日志噪声**（它会淹掉真正的告警）

`check:journey-coverage` 的输出里出现了：

```
[sync] 实时通道没能建立（不影响登录与手动同步）： Error: op-log 引擎尚未初始化…
```

它**不是**缺陷（catch 按设计兜住了），但它是**噪声**：`restartRealtime` 的
`try/catch` 分不清"正常的还没就绪"与"真的接线坏了" —— 两者打**同一句警告**。
⇒ 加了 `hasEngine()`（`apps/web/src/lib/oplog.ts`），调用方**先问再连**，
就绪判断不再走异常路径。实测噪音 **1 → 0**。

**理由写进了代码注释**：冷启动早期在 `initOpLog()` 之前调 `applyAuthToken()` 是**正常路径**；
而且**不**在未就绪时排队等待 —— `main.tsx` 会在 `initOpLog()` 之后显式调一次
`startRealtime()`，"现在没连上"迟早会被补上，在这里 sleep/重试只是多一条要维护的路径。

#### G0 / G4 的**实证**（同日）—— 这两项从"需实证"变成"已实证"

§11 的附注写着「另：G0（P4 因 Q1 修订自动满足，**需实证**）、G4（门面缺口，接 RN 后是否消失**需实证**）」。
两项都是"前提变了、结论应该成立，但没人真的看过"。现在看过了。

**G0 —— 设计变量单源（P4）已成立，且确实不再需要 C#/C 生成器**

| 命令 | 实测 |
|---|---|
| `grep -c '^  --ht-' packages/design-system/src/tokens.css` | **313** 条 token |
| `ls packages/design-system/generated/` | 只有 `HeytaTokens.swift` / `HeytaTokens.ets` / `tokens.json` |
| `ls packages/design-system/generated/*.cs *.h` | **不存在** —— G1/G2（C# / C 生成器）确实**不需要** |
| `rg 'HeytaTokens' apps/desktop-macos/Sources/HeytaMac/` | 壳 chrome（"找不到共享 UI 产物"那个兜底屏）**真的在消费生成物**（`.Light.space3` / `.Light.fontSizeLg` …） |

⇒ **设计变量单源成立**：Web/RN 走 `tokens.css` 与 `tokens.native.ts`，ArkTS 与 Swift 走生成物，
而**没有**任何第四份手抄的取值表。`check:tokens` 的"4 个文件、195 个 token 一致"是它的常驻判据。

⚠️ **一处更正**：G0 的原文说"接 RN 平台实现后，Windows/macOS 的 UI 样式走的是 RN token 层"——
**M2 之后走的是 `tokens.css`**（桌面 UI 就是 web 构建产物），而不是 `tokens.native.ts`。
结论（单源、不需要 C#/C）不变，**理由换了**，所以记在这里。

**G4 —— 门面缺口在 M2 下确实消失（因为共享 UI 不在那条路上了）**

原文：「接 RN 后共享 UI **直接调 `packages/app-host`** ⇒ 门面缺口**可能整个消失**。需在 S1 中确认」。
S1 被否决了，所以这条要按 **M2** 重看 —— 而 M2 下结论更强：

```
apps/desktop-macos/Sources/HeytaMac/HeytaMacApp.swift   ← 只引用过一次 native-bridge，
                                                            而那是一次**过期的头注释**
                                                            （写着"把事件转成 AppApi 调用"，
                                                             描述的是已删除的手写界面）
```

实测：**app target（渲染路径）里没有 `AppApi` / Jint / JavaScriptCore 的任何调用**。
壳的内容只有 `SharedWebView`，界面来自 `apps/web` 的构建产物 ⇒ **与 web 走同一条路径**，
窄门面（`native-bridge` 的 4–5 / 63 方法）**不在渲染路径上**。

⚠️ **但 bridge 本身没有消失，也不该消失**：`HeytaShellCore` 里那份仍在用
（`heyta-smoke` 与各端壳的桥接测试、以及 `check:{macos,windows,linux}-shell`）。
⇒ 准确的结论是：**"门面缺口"这个说法在 M2 下失效了** —— 因为它描述的是
"共享 UI 要通过窄门面取数据"这个已经不存在的情形，而不是"bridge 应该被删"。

**顺手修掉的那条过期注释**（它就是 G4 一直没被看清的原因）：头部写着
"它只做三件事：把窗口搭起来、**把事件转成 `AppApi` 调用**、把错误显示出来"。
下一个人照着它会去找一个已经不在渲染路径上的东西。已改成如实描述 + 记下这次实证。

#### 补完：行密度契约的**盘点** + 回收站行**两端合一**（同日）

**① 先把 §4.2 的"不是三份 JSX"盘了一遍**（判据：谁在渲染 `task.title`）：

```
共享层  packages/ui/src/**   → 只有 task-list/model.ts 的 toTaskRow 一处
                              （quadrant 里那一处是**注释**，在解释它为什么不手写行）
宿主    apps/web/src、apps/mobile/src → 绝大多数是 aria-label（用标题拼读屏名，不是画行）
```

⇒ 共享层**干净**。但宿主那边查出**真的各写了一份回收站行**：两端都是
"标题 + 删除时间 + 还原/彻底删除"，连注释都一样（"用户自己的字：原样显示、不翻译"）。

**② 提取共享 `TrashBoard`**（`packages/ui/src/trash/TrashBoard.tsx`）

| 决定 | 理由 |
|---|---|
| **不复用 `TaskList`** | `task-list/density.ts` 的契约表明写"密度只改空间与次要插槽，**行骨架（勾选框 + 标题）一定在**"。回收站里勾选框**没有意义**（已删除的任务谈不上"完成"），主操作是**还原**。给它加 `showCheckbox` 会**违反那条契约** —— 而契约一放宽，就再没有东西挡得住"下一个容器也顺手去掉一部分骨架" |
| **确认弹窗不共享** | 它是**真的平台差异**（Web 自绘 `<div role="dialog">` + 焦点陷阱，移动端原生 `Modal`）。本板只交出 `onPurge`，**弹确认是宿主的事** |
| 复用共享文字样式 | 用 `row-title` / `row-meta`，视觉上与 `TaskRow` 一致 —— 差别只在**动作**，而那正是应该不同的地方 |

**③ 落地时门禁没拦住我，而一条单测拦住了**

`TrashView` 忘了包 `<HeytaUiProvider>` ⇒ **`pnpm check` 全绿**，
一直到 `apps/web/tests/trash.spec.tsx` 5 条一起报
`useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用` 才暴露。

根因是 `check:ui-provider` 的登记表**又一次**漏了新组件 —— 而这是**第六次**
（sync → AI → settings → quadrant → habits → calendar/trash）。已补登记
`CalendarBoard` / `TrashBoard` / `SearchPanel`，并**故障注入验证它会红**：

```
🔴 共享 UI 主题 Provider 覆盖不足 / 判据失效：
      apps/web/src/features/trash/TrashView.tsx:99 —— 组件 <TrashBoard>（TrashBoard）
```

⚠️ **这次事故的教训写进脚本注释**：在那之前，唯一的防线是"一条恰好覆盖到的单测"，
而门禁本该在更早、更便宜的地方拦住它。**漏登记 = 没有门禁**，这句在脚本里已经写了六遍。

**④ 一处我自己写错又删掉的测试**

我先给 `TrashBoard` 在 `packages/ui/tests/` 里写了 `.tsx` 组件测试 ——
而那个包的 `vitest.config.ts` **明确写着"不用 jsdom、也不 render 组件"**
（刻意的边界：组件树渲染得对不对，判据是三个平台的实际渲染）。
⇒ **删掉**。那个契约由宿主的端到端验收覆盖（`apps/web/tests/trash.spec.tsx` 8 条，
其中一条正是"第一次点击只打开确认框，不删除"），而它现在驱动的**就是共享板**。

**验证**：14 道门禁全 ✅；全量 **3823** 通过 0 失败（web 945 / mobile 416 /
app-host 699 / domain 659 / design-system 411 / landing 410 / ui 283）；e2e **9 passed**。

#### 补完：实时通道的**移动端** + 对账缺口的**可判据那一半**（同日）

**① #10 移动端接上实时通道**，而且**先把它提到共享层**。

这一轮开始时发现一个自打嘴巴的形状：web 的实时接线是**在 web 的 store 里内联**建的，
而 `packages/app-host/src/sync-wiring.ts` 的文件头正好写着
「**接线只有一份**，宿主只能注入真正的平台差异」—— 实时通道没理由例外。

| 文件 | 动作 |
|---|---|
| `packages/app-host/src/sync-wiring.ts` | 加 `createHostRealtimeClient`（收 `engine`，`clientId` 从它取 —— 与 `createSyncClient` **同一个来源**） |
| `apps/web/src/features/sync/store.ts` | **改走共享接线**（删掉内联那份） |
| `apps/mobile/src/sync/realtime.ts` | **新建**：移动端接线。🔴 依赖**可注入**（本仓既有做法，`tests/credential-wipe.spec.ts`），生产调用点一个都不传 |
| `apps/mobile/src/sync/auto-sync.ts` | `notifyConfigured()` 起连（**不在 `startAutoSync` 里** —— 移动端凭据刻意不落盘，冷启动时必然是 `undefined`，在那里起**永远建不起来且静默**）；`stopAutoSync` 停连 |

`apps/mobile/tests/realtime-wiring.spec.ts` **10 条**：真的建了客户端并连上 / `clientId` 来自 engine /
未配置不建连 / `getToken` 是活取值器 / `stopRealtime` 会 dispose / 反复 start 不留两条活连接 /
`onNewOps` 在途合并 / **+ 两条源码级判据**（`notifyConfigured` 真的调了、`stopAutoSync` 真的停了）。

⚠️ **途中修了一个"测试环境被原生模块拖垮"的问题**：`realtime.ts` 顶部静态 import `../db/open-host`
会拖进 `@op-engineering/op-sqlite`，于是**只测接线、根本不碰数据库的用例**也报
`Cannot find module '…/op-sqlite/node/dist/database'`。改成**惰性 `import()`**
（真正被推迟的只是加载时机，而这两件事本来就只在真的要用时才发生）。

🔴 **我自己写的第一版源码判据是假的**：`/notifyConfigured[\s\S]*?startRealtime\(\)/`
**把注释掉的调用也算成调用** —— 我把那行注释掉之后它**照样绿**。
改成**按行匹配真实调用**（去掉行尾注释再判）之后，注释掉就红。
**一条能被注释骗过去的判据，等于没有判据。**

**② 对账缺口：把"只数个数"换成"逐字对标签"**

`apps/web/tests/app-mount.spec.tsx` 的 rail 断言原本只 `toHaveLength(7)` ——
所以我把「搜索」硬编码进 JSX 时**它照样绿**，`apps/landing` 的常量对账也照样绿，
**两条判据都没看见多出来的那个按钮**。

现在改成**逐字对标签与顺序**：`['任务','日历','四象限','习惯','时间线','搜索','回收站']`。
故障注入：在 rail 里插一个硬编码 `role="tab"` ⇒ **红**
（`expected [ '顺手加的', '任务', …(4) ] to deeply equal [ Array(7) ]`），还原后 19/19。

✅ **缺口已关（更正）**：我一度把它记成"残余缺口"，而它其实由**两边各钉一半**关掉了 ——

```
  渲染 == 字面量     ← apps/web/tests/app-mount.spec.tsx（逐字对 rail 标签与顺序）
  常量 == 字面量     ← apps/landing/...（appDefaultRail 对字面量）
  登记处 == 常量     ← apps/landing/...（SHELL_VIEW_TABS 对 appDefaultRail）
  ⇒ 登记处 == 渲染
```

**两半都做了故障注入**：真应用里插一个硬编码 `role="tab"` ⇒ web 那条**红**；
登记处多一项而常量没有 ⇒ landing 那条**红**。
⇒ 不必把整个 web 应用拖进 landing 的测试环境；**只要那两半都不被删**。
这条链已写进 `apps/landing/tests/mockup-shell-shape.spec.tsx` 的注释里，
免得下一个人重新把它当成缺口。

**验证**：14 道门禁全 ✅；全量 **3820** 通过 0 失败（web 942 / landing 410 / mobile 416 /
app-host 699 / domain 659 / design-system 411 / ui 283）；e2e **9 passed**。
⚠️ 途中 `check:mobile-bundle` 抓到一次**真的打不出包**：我把 web 风格带扩展名的 import
（`./config.js`）写进了移动端，而 **Metro 的解析约定是不带扩展名** ⇒ 打包失败、门禁红。
已改回无扩展名。

#### ⚠️ 清掉四层假绿之后，iOS 验收**第一次真正验到当前构建**，并立刻报出 9 项失败

**这不是退步，是第一次看得见。** 在此之前它验的是一个**两天前的包**
（bundle id 还是 RN 模板的默认值 ⇒ 一个**完全不同的 app**），
而每一轮都报"通过 36 项"。现在它诚实地说：**34 通过 / 9 失败**。

失败**收敛到一个根**：第 5 步里「访问令牌」与「端到端加密口令」两个字段
**回读为空**（「服务器地址」那一个成功）——

```
✅ 已填写「服务器地址」
❌ 填写「访问令牌」失败，回读=「」
❌ 填写「端到端加密口令」失败，回读=「」
❌ 凭据填齐了但「立即同步」仍是禁用 —— 字段没真的写进活配置
```

⇒ 凭据进不了活配置 ⇒ 同步出不去、实时通道连不上 ⇒ 后面 7 项全部连带失败。

#### 🎯 找到最可能的根因：**页面会隐藏"已经设好的字段"，而夹具假设了一个无状态的表单**

继续逐层核实之后，「我的」页在两种状态下 dump 出来的形状**不一样**：

| 状态 | 树里有什么 |
|---|---|
| 令牌**未设** | 「服务器地址」「访问令牌」「端到端加密口令」**三个输入框都在** |
| 令牌**已设** | **只剩「服务器地址」一个输入框**（另外两个被隐藏了） |

而页面的状态栏在第二种状态下**诚实地写着**：

```
状态    还没设置端到端加密口令，同步已停止 —— heyta 不会以明文上传
待上传  2 项
```

⇒ **这不是产品缺陷**：UI 的状态是对的、话也说明白了。
**错的是夹具** —— `set_field` 连写三句，**假设三个框都在**。
在"令牌已经设过"的设备上，第二、三句会报「回读为空」，
而真因是**那个框根本不在** —— **症状（"写不进去"）与病因（"框不存在"）完全不像**，
而这一轮我正是被它带着往"AX 写不进 secure 框"的方向查了两轮。

**修**：第 5 步**先点「清除本机保存的凭据」**（那个按钮本来就在页面上），
拿到一个**确定的初态**，再按顺序填三个框。点击弹窗/键盘等副作用都由这个初态消除。

⚠️ **这一条也解释了为什么它时红时绿**：同一个模拟器上，
上一轮跑完时 app 的**内存里**可能已经留着令牌（移动端凭据刻意不落盘，但**同一会话内**在内存里），
于是下一轮起手就是"已设"状态 —— 而 `erase` 只清磁盘，清不掉那个进程的内存。

#### 逐一核实后的清单（2026-09-29，全部实测；含两条**我自己下错的结论**）

| # | 结论 | 证据 |
|---|---|---|
| 1 | **AX 树读得到** | `~/.heyta-tools/idb/venv/bin/idb --companion-path <C> ui describe-all --udid <U>` 返回节点 JSON（25 个 label，含「任务」「我的」） |
| 2 | **三个凭据字段都在**，`role=AXTextField` | 「服务器地址」「访问令牌」「端到端加密口令」各出现**两次**：一次 `StaticText`（标签）、一次 `TextField`（输入框） |
| 3 | 字段的 `AXValue` 暴露了症状 | 「服务器地址」= `http://10.0.2.2:3000`（**app 的默认值**）、「访问令牌」= `登录服务端后获得`（**占位符**，即空）、「口令」= `''` |
| 4 | ⚠️ **字段位置会变** | 同一次会话里「服务器地址」的 `frame.y` 实测从 **647 → 488**（页面被滚过）。而 shim 的 `--set` 是**按坐标**写的（`idb ui set-value <cx> <cy>`）⇒ 写之前读到的坐标可能已经过期 |
| 5 | 🔴 **`idb ui set-value` 是存在的** | 在 **venv 那个 idb** 里：`usage: idb ui set-value … --value VALUE`。**我一度断言"这台机器上没有这个子命令"—— 那是错的**，因为我查的是 `~/.local/bin/idb`（另一个、更旧的）。**又一次"查错了对象"** |

🔴 **第 5 条要单独记**：`resolve_idb()`（`scripts/lib/mobile-e2e.sh`）解析的是
`$HOME/.heyta-tools/idb/venv/bin/idb`，而**同机还存在** `~/.local/bin/idb`（版本更旧、
没有 `set-value`）。两者都能叫 `idb`，但能力不同 ——
**下一次任何人手工复现时，必须用脚本解析出来的那一个**，否则会像我一样得出反向结论。

🔴 **下一轮接手时先做这两件事（已实测的线索，不要重走）**：
1. **shim 的 `enabled` 语义已经核实**：`n.get("enabled", True) is not False` ——
   **缺键视为启用**。所以它在"按钮真的 disabled"时**会**给出 False（实测等了 120 秒都没等到 True），
   这一条可信；但**不能**把它当"元素可用"的通用判据。
2. **`ax` 的所有查询都是静默失败的**：`idb` 路径写错时 shim 一律返回
   `{"found":"False"}`（实测：我手工用 `~/.heyta-tools/idb/idb` 查——**那个文件不存在**，
   真正的在 `~/.local/bin/idb`，而脚本里的 `IDB_BIN` 由它自己解析）。
   ⇒ **排查"找不到元素"之前，先确认 idb 真的在跑、树真的读到了**
   （`$IDB --companion-path $C ui describe-all --udid $U` 直接调用能返回节点 JSON）。

⚠️ **仍未查明是产品缺陷还是夹具问题**，两种都可能：
- **产品侧**：全新安装的设备上，`ProfileScreen` 的那两个 `TextField` 可能真的不接受
  AX 写入（而 Composer 那个**接受** —— 第 3 步实测「添加」由 false → true）；
- **夹具侧**：`set_field` 对 `secure` 框与第二个字段的处理可能在这次 UI 改动之后失效了。

🔴 **两条要一起记的**：
1. **它此前"通过 36 项"是假的** —— 那 36 项里没有一项验到了当天的代码。
2. 我这轮又给夹具加了一处**条件写错**的等待（等"按钮出现"而按钮一直在），
   已改成等 `found && enabled`；但下一轮实测显示 shim 的 `enabled`
   在第 0 秒就报 `True`（而字段明明是空的）⇒ **它的语义也要先核实**，
   不能拿它当判据。

#### 第 30 轮收尾：**清空之后两个框仍不在树上** —— 状态机需要的迭代超出本次会话余量

"框不在就不判红"改完之后的干净重跑（`/tmp/ios15.log`，脚本全程未被改动）：

```
✅ 已清除本机凭据 —— 三个字段都会出现，下面按确定初态填
✅ 已填写「服务器地址」
✅ 「端到端加密口令」输入框不在树上（可能已经设好、被页面收起）—— 跳过填写，由下游凭据判据裁定
✅ 「访问令牌」输入框不在树上（…）
❌ 凭据填齐了但「立即同步」仍是禁用 —— 字段没真的写进活配置
```

⇒ **与孤立实验不一致**：孤立实验里"清空之后三个框都在、写令牌之后两个一起消失"，
而脚本序列里"清空之后那**两个框就没出现**"。

**⇒ 这个页面的字段可见性是一个我还没测全的状态机**（至少三个输入：当前凭据状态、
是否点过清除、以及点清除之前的页面状态）。**继续在夹层里按状态猜，只是在换着花样地红。**

🔴 **我停在这里，并如实说明为什么**：把那个状态机测清楚需要在真机夹具上再迭代若干轮，
而**本次会话的上下文余量已经放不下**。把状态压成下面这段"可直接执行"的说明，
比再盲试几轮更有价值。

**⚠️ 同时记一个我自己犯的、已经写进本仓纪律的错**：
我在 `ios14` **运行期间**编辑了脚本，于是 bash（**增量读文件**）读到中间态、
在 988 行报 `syntax error`。文件本身是好的 —— 纯粹是"边跑边改"造成的。
**运行中的 shell 脚本不能改**，这条以前记过，这次又踩了。

#### 第 30 轮的后半：改了顺序之后**换了一种失败** —— 而这次我不再在夹层里猜

按"先口令后令牌"改完重跑（`/tmp/ios14.log`）：

```
✅ 已清除本机凭据 —— 三个字段都会出现，下面按确定初态填
✅ 已填写「服务器地址」
❌ 找不到「端到端加密口令」输入框（它可能已经被设好、被页面收起了）
❌ 找不到「访问令牌」输入框（…）
❌ 凭据填齐了但「立即同步」仍是禁用
```

⇒ 与我那次**孤立实验**（清空之后三个框都在、写令牌之后两个一起消失）**不一致**：
这一轮里清空之后那两个框就**不在**了。

**⇒ 结论：这个页面的"哪些字段可见"是一个我还没测全的状态机**，
而我在夹层里按状态猜（先口令还是先令牌），猜错一次就换一种红。

**所以我改掉了这一层的行为**：框不在时**不判红**，只**如实报告**
（"可能已经设好、被页面收起"）—— 然后让**下游那条真正的判据**去裁：
凭据够不够用 → 「立即同步」能不能用 → 同步出不出得去。
**在这一层猜，只会把"页面状态不对"伪装成"填写失败"**，而这一轮我已经被那个伪装带偏过几轮。

#### 🎯 第 30 轮：**二分有答案了 —— 产品是对的，错的是判据**

按上一轮留下的二分法做了一次**孤立实验**（用脚本解析出来的那个 idb）：

```
导航「我的」→ 点「清除本机保存的凭据」→ 重读 frame（拿**新的**坐标）
→ 对「访问令牌」孤立 set-value @(201,668) → 立刻回读

  rc= 0 | stderr= (空)
  写前: 服务器地址 / 访问令牌 / 端到端加密口令 / 清单名称 / 标签名称 / 写点什么…
  写后: 服务器地址 / 清单名称 / 标签名称 / 写点什么…
        ↑ 「访问令牌」**与**「端到端加密口令」**双双消失**
```

⇒ **写成功了。** 然后页面**把这两个框收起来了**。

| 上一轮的二分 | 结论 |
|---|---|
| 坐标过期？ | **不是** —— 重读 frame 之后用的是新坐标，rc=0 |
| 字段不接受 set-value？ | **不是** —— 写进去了（症状是"写好之后它不见了"） |

⇒ **产品侧没有问题。** 错的是夹具的判据：`set_field` 要求"写完之后能**回读同一个框**"，
而这个页面**会在写成功之后收起那个字段** —— 于是"写失败"与"写完被收起"
在输出上**完全一样**（都是 `detail=""`）。

⚠️ **为什么查了这么多轮才看清**：症状（"回读为空"）与病因（"框被收起了"）
指向**完全相反的**方向 —— 前者让人去查"写不进去"，而真相是"写进去之后它不在了"。
**这类"两种完全不同的原因产生同一个症状"的失效，只能靠一次孤立实验分开，
靠读代码和读日志都分不开。**

**修（两处，都是语义而不是风格）**：
1. `set_field` 在写之前**先问框在不在**（不在就直接报"可能已被设好、被收起"），
   写完之后若**框消失且回读为空** ⇒ **判成功**；
2. **填写顺序改成「先口令、后令牌」** —— 因为设置令牌会把这两个框**一起**收起，
   先填令牌的话，后面那句 `set_field "端到端加密口令"` 连框都找不到。

#### 第 29 轮：清空凭据的修复**没有解决它** —— 状态收窄到"两个字段都写不进\"

加了「先点『清除本机保存的凭据』拿到确定初态」之后重跑（`/tmp/ios13.log`）：

```
✅ 已清除本机凭据 —— 三个字段都会出现，下面按确定初态填
✅ 已填写「服务器地址」
❌ 填写「访问令牌」失败，回读=「」
❌ 填写「端到端加密口令」失败，回读=「」
❌ 凭据填齐了但「立即同步」仍是禁用 —— 字段没真的写进活配置
```

⇒ **收窄了但没解决**：清空那一下确实生效（页面回到了三个框都在的状态），
而「服务器地址」能写进去、另外两个**回读始终为空**。

**下一轮直接从这里开始**（不要再重走前 29 轮的路）：
1. 用**脚本解析出来的那个 idb**（`~/.heyta-tools/idb/venv/bin/idb`）在「我的」页上
   对「访问令牌」做一次**孤立的** `ui set-value <cx> <cy> --value X`，**立刻** dump 回读 ——
   要区分的是两种情况：**坐标过期**（页面在点击"清除"之后重排过）还是
   **这个框压根不接受 set-value**。
2. 若是坐标问题：`set_field` 应当在**设值前重读 frame**（shim 现在就是这么做的，
   但"清除凭据"与"读 frame"之间还隔着一次点击引起的重排 —— 值得在点击后**先 dump 一次**再设值）。
3. 若是字段不接受：那才是产品侧要查的（RN 的 `secure` / `multiline` 输入框在
   iOS 无障碍层上的可写性）。

#### 🎯 第 31 轮：模型定型了 —— 而其中一半是我上一轮**测反了**

两次**互为对照**的探针把这件事钉死了：

| 探针 | `set-value` | 结果 |
|---|---|---|
| 状态机探针（进「我的」→清除×2→离开再回来） | 全程**没写过** | **三个字段在每一个状态下都在** |
| 孤立写入探针 | **rc=0（成功）** | 「访问令牌」与「端到端加密口令」**双双从树上消失** |
| 孤立写入探针（第二次） | **rc=1（失败）** | 三个框**原样都在**，值也没变 |

⇒ **确定模型（三条）**：
1. **没有"字段可见性状态机"** —— 三个框本来一直在；我上一轮据此改的"先口令后令牌"
   一度被我自己怀疑是错的，而**对照探针证明它是对的**：
2. **"框消失"是写成功之后的行为**（rc=0 才消失；rc=1 不消失）。所以先填令牌会让
   后面那句 `set_field "端到端加密口令"` **连框都找不到** —— 顺序是**语义**；
3. 🔴 **`idb ui set-value` 本身是时好时坏的**（同一条命令 rc=0/rc=1 都出现过）。

**⇒ 真正的根因是第 3 条，而 shim 把它吞掉了。**

`ios-ax-shim.py` 的 `--set` 里原本是：

```python
subprocess.run([... "ui", "set-value", ...], capture_output=True)
# 返回值丢掉、异常也 pass
```

⇒ **工具跑失败了，而没有任何人看。** 于是"工具失败"与"写进去了但回读方式不对"
在调用方看来**完全一样**（都是 `detail=""`），而这一整轮的排查方向
（状态机、填写顺序、坐标过期）**全都被这个假象带着走**。

⚠️ 这是本仓那条 **"工具返回成功不等于生效"的反面，而且更坏**：
**工具返回失败，而没人看。** 前者是"绿了但没做"，后者是"红了但当成别的红"。

**修（两处）**：
- `ios-ax-shim.py` 的 `--set` 现在把 **`setRc` / `setErr`** 一并 emit（异常也分类成
  `-1` 超时 / `-2` OSError），**不再吞**；
- `verify-mobile-ios.sh` 的 `set_field` **先看 rc**：非 0 直接报
  「写 X 时 idb 自己失败了（rc=…）：<stderr>」，与"写进去了"分开。

#### 🔴 第 32 轮：**前置的注册/登录入口，真机上第一次被验到**

按上一轮的结论（不再走"手动粘贴令牌"那条兜底路径），先探了产品自己的主路径。实测：

```
「我的」页顶部：  AXButton '注册 / 登录'
点开之后：        服务器地址 / 邮箱 / 端到端加密口令 /
                  注册新账号 / 用通行密钥登录 / 粘贴邮件里的链接或令牌
```

⇒ **三条登录路（邮箱注册 / 通行密钥 / 粘贴令牌）在真机上都可达**，
而且入口就在「我的」页最上面 —— **冷启动后一眼可见，不在设置里**。

**这正是本次目标里那条硬要求**（「注册/登录必须前置……**不能把认证藏在设置里**」）
**第一次在真机上被验到**。在此之前：本脚本一直走兜底路径，
而"前置入口"只在别处的单测里出现过。

**已加进 `verify-mobile-ios.sh` 的 5a 步**（四条断言）：
入口在 ⇒ 注册新账号在 ⇒ 通行密钥在 ⇒ 粘贴令牌在 ⇒ 三条路齐。

**顺带实测**：认证页的字段**接受写入**（「服务器地址」rc=0、「端到端加密口令」rc=0），
与"手动凭据"那段不同 —— 所以**下一轮把凭据填写整体搬到这里**是可行的，
而且验的是主路径。

⚠️ 途中 `idb ui set-value` 又出现了一次 **rc=1**（写「粘贴令牌」时）——
**而这一次它是可见的**（上一轮刚加的 `setRc`），换在两轮前就会被读成"回读为空"、
再去查一遍状态机。**修那个 rc 的价值当场兑现了。**

#### ✅ 第 31 轮收尾：**"逐字段填"这条自动化路径本身走不通** —— 而下一步已经明确

修完 rc 之后干净重跑（`/tmp/ios16.log`）：

```
✅ 已清除本机凭据，三个字段都就位（等了 1 秒）—— 下面按确定初态填   ← 新的轮询等待生效了
✅ 已填写「服务器地址」
✅ 「端到端加密口令」输入框不在树上（可能已经设好、被页面收起）—— 跳过填写
✅ 「访问令牌」输入框不在树上（…）
❌ 凭据填齐了但「立即同步」仍是禁用
```

⇒ **填完第一个框（服务器地址，成功）之后，另外两个也消失了。**
结合前面三组对照探针，模型是：**任何一次"写成功"都会把「手动填写凭据」这一段收起。**

⛔ **所以"逐字段填"这条路径本身不成立** —— 不是顺序问题、不是坐标问题、
也不是 rc 问题（那三个都修了）。这个表单**不是为一个字段一个字段地写而设计的**，
而 `idb ui set-value` 恰好是"写一次就让字段失焦/收起"的那种写法。

🔴 **下一步（已明确，不需要再摸索）：驱动页面顶上那个「注册 / 登录」按钮。**

它一直在「我的」页最上面（`AXButton '注册 / 登录'`），是**产品自己的主路径**；
而脚本现在走的"手动粘贴令牌"在页面上被明确标成**兜底路径**
（原文：「下面是手动填写凭据的兜底路径」）。

**顺带说：这正好对上本次目标里那条硬要求** ——
「**注册/登录必须前置**，不能把认证藏在设置里」。脚本一直没走那条路，
所以**"前置的登录入口在真机上真的能用"这件事，从来没有被端到端验过**。
下一轮做它，验的是产品的主路径，而不是兜底路径。

#### ⚠️ 记一条**既有的**测试抖动（本轮实测定位，未修）

全量跑 web 套件时偶发 1 红（2 次里 1 次）：

```
FAIL  tests/reminders-panel.spec.tsx > B. 没有截止时间时只有绝对时刻入口
      > 🔴 超过每任务上限时把错误显示出来，不静默吞掉
```

**单独跑 5/5 全过** ⇒ 是**并发 + 负载**下的时序抖动，不是产品缺陷，也不是本轮引入的
（本轮改的是 `reminders/notify.ts` 与它的接线，而这条测的是 `ReminderPanel`）。

**机制**（读代码可得）：那个用例点 8 次，每次之间 `await new Promise(r => setTimeout(r, 3))`，
**依赖 `Date.now()` 在这 3ms 里真的前进** —— 因为同一时刻的提醒会**幂等地落到同一条**上，
时钟不前进就永远撞不到"每任务 5 条"的上限。机器一忙，3ms 的 sleep 就不保证时钟前进。

⇒ **修法方向**（未做，留给下一轮）：把时钟换成**显式可控的**（注入一个每次 +1s 的 `now()`），
而不是靠真实 `setTimeout` 去推动它。**"靠真实时间前进"的夹具在并发下必然抖** ——
这与本仓已经记过的"固定 sleep 在慢机器上假失败"是同一个形状。

**⇒ 真正还没做的（不是"没验证"，是"没做"）：**

1. 🔴 **iOS 验收当前是 34/9**（见上）—— 而那 9 项的根是**凭据写不进活配置**。
   ⚠️ **此前记的"36/36 通过"要撤回**：那一轮验的是一个 bundle id 都不对的、
   两天前的包。**移动端实时通道的接线代码是对的（有单测与结构性判据），
   但"设备上确实连上了"这件事现在**没有**证据。**
   ✅ **入站方向也已验**：`scripts/verify-realtime-push.mjs` **7/7、exit 0**
   —— 而且它第一次跑就抖出了一个**真 P0**（端点路径错，见上）。
   **Android 侧仍外部阻塞**：
   `emulator -list-avds` 只有 `SSOS-Parity-A36`（另一个项目的），没有 heyta 的 AVD。
2. ✅ **行密度盘点已做**（见上）：共享层只有 `toTaskRow` 一处碰 `task.title`；
   回收站那两份手写行已合成共享 `TrashBoard`。
   ⚠️ **仍未做**：`TimelineView` / `GanttChart` / `FocusPanel` / `CategoryReportView`
   渲染的是**时长块 / 计时器 / 聚合**，不是任务行 —— 它们**不该**被硬套成
   `TaskRow`，但"同一实体的行在不同容器里的高度是否一致"这件事**只在任务行上有判据**。
3. ✅ **landing 对账的缺口已关**（见上）：靠"两边各钉一半"而不是"把 web 拖进 landing"。
   ⚠️ 代价是**两半都不能删** —— 删掉任何一半，链就断在最看不见的一段上。

**仍然不要动**：在途的 timeline / 滴答导入 / AI 面板改动（并行会话正在改
`apps/web/src/features/ai/*`，我这一轮遇到过它们的**中间态**：语法坏了 ⇒ 24 个测试文件无法转译、
web 套件从 951 掉到 588。**没有碰**，等它们稳定后复跑即恢复）。

---

*本文件所有数字均标注了来源与获得方式；凡未实测者一律标"未核实"。*
