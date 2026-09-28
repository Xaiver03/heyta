# 多端原生构建计划：原生优先，代码量不设上限

> 状态：**规划中**
> 决策依据：[ADR-0032](../adr/0032-windows-native-via-rnw.md)（Windows 走 RNW 原生）
> 上位计划：[多端适配实施计划](multi-platform-adaptation.md) M2
> 素材：[桌面端选型调研](../research/desktop-shell-selection.md)（含全部一手数字）

---

## 0. 这份计划在回答什么

**「每个端都交付原生应用」这个目标，逐端分别可达吗？不可达的那几端怎么办？**

产品要求（2026-09-28 原话）：

> 「我们尽可能需要原生，包括 Windows 上面也需要原生。**哪怕是代码量偏大。**」

🔴 这句话改变的不是"想不想"，而是**权衡的方向**：
[ADR-0024](../adr/0024-desktop-shell-and-ui-convergence.md) §2.2 选 Electron 的**唯一**决定性理由是
"UI 复用度最高"；现在**原生性排在复用度之前**，那个论证前提就没了。
本计划据此重排桌面三端。

⚠️ **但"尽可能"是一个需要逐端兑现的词，不是一句口号。**
三端的原生可达性**根本不同**，把它们混成一句"都上原生"会让计划从第一天起就是假的。
下一节先把这件事钉死。

---

## 1. 🔴 先钉死：三端的原生可达性不一样

| 平台 | 真原生方案 | 可达性 | 决定性事实 |
|---|---|---|---|
| **Windows** | **react-native-windows（RNW）** | ✅ **可行** | RNW **0.84.0** 的 `peerDependency` 是 `react-native: 0.84.1`，**与 heyta 精确相等**；官方 support matrix 上 0.84 = **Active Support** |
| **macOS** | `react-native-macos` | 🔴 **现在不可行** | 最新 **0.81.9**，`peerDep: react-native 0.81.6`，官方明文要求"同一 minor 版本"；heyta 在 **0.84.1** → **版本硬冲突**，不是"难" |
| **macOS**（备选） | SwiftUI / AppKit 原生 | ⚠️ 可行，代价是**另写一整套 UI** | 那会是**第四份** UI 实现 —— 与"停止写两遍"直接对立 |
| **Linux** | —— | 🔴 **不存在 RN 目标** | RN 系没有 Linux。真原生 = GTK4 / Qt，**又一个独立代码库** |
| **iOS / Android** | React Native | ✅ **已经是原生** | `apps/mobile`；且已落地真原生小组件（WidgetKit / App Widget） |
| **鸿蒙** | RNOH + ArkTS 卡片 | ✅ **已经是原生** | `apps/mobile/harmony`；出包已通，模拟器已可用 |
| **Web** | —— | ✅ 就是 Web（定义如此） | `apps/web` |

**结论**：**Windows 真的迁**（可行）；**macOS / Linux 保留 Electron 并如实标注为过渡**，
不假装它们也是原生的。

> 🔴 **为什么这条要写在最前面**：如果计划写成"桌面三端统一上原生"，
> 那么它在 macOS 上**第一天就会撞上 0.81 vs 0.84.1 的硬墙**，
> 而 Linux 上根本无墙可撞 —— 只能自己造一个（GTK/Qt）。这两件事必须**分开对待**，
> 否则整份计划会因为其中一半不成立而被整体放弃，连带把 Windows 这一半也拖死。

---

## 2. Windows：Electron → RNW 原生

### 2.1 为什么是 RNW，不是别的"原生"

| 候选 | 判定 | 理由 |
|---|---|---|
| **RNW** | ✅ **选它** | RN 版本**精确对齐**（0.84.0 ↔ 0.84.1）；New Arch 是**唯一**架构（C++/WinAppSDK/Win32/Composition 渲染），产物是真·原生窗口，不是 WebView；`cpp-app` 模板**自带 Windows Packaging project**（微软官方 FAQ 原文） |
| Tauri | ✗ | 用 **WebView2** 渲染 —— **不是原生 UI**，与本次要求不符（尽管它的代码复用度更高，但那正是被降权的那个维度） |
| .NET MAUI / WinUI 3 手写 | ✗ | 真原生，但是**第五份 UI 实现**；且与 RN 心智模型、`packages/ui` 全都无关 |
| 继续 Electron | ✗（但保留） | Chromium + Node，**不是原生**。保留只能作为过渡与对照基线 |
| Capacitor | ✗ | **根本没有 Windows 平台**（官方平台只有 iOS/Android/Web）。见 [ADR-0031](../adr/0031-native-apps-everywhere-not-pwa.md) §1.2 |

### 2.2 代价清单（必须**先认账再开工**）

这三笔成本是 RNW 路线的硬前置，**一笔都省不掉**：

| # | 代价 | 现状 | 为什么绕不开 |
|---|---|---|---|
| **C1** | **Windows 存储驱动** | 🔴 **`op-sqlite` 不支持 Windows**（官方文档只列 iOS/Android/macOS/web） | heyta 的 `SqliteDriver` 接口是**同步**的（ADR-0024 §2.2 的原始发现），Windows 侧必须提供一个**同样同步**的实现，否则 `op-log` 与 `DbAdapter` 的契约会变形 |
| **C2** | **社区原生库缺口** | 🔴 官方 React Native Directory 的 2716 个库里，**声明支持 Windows 的只有 73 个（2.8%）**，两个桌面端都支持的只有 **28 个** | 每一个用到的原生库都要单独确认；不支持的要么自己写 TurboModule，要么换库 |
| **C3** | **小组件 provider 只能写 C++/WinRT** | ⚠️ RNW New Arch **不支持 C#**（官方 FAQ 原文）；而微软样例与 `tauri-plugin-widgets` 的 provider **都是 C#** | 意味着**没有现成样例可抄**，要自己实现 `IWidgetProvider` COM exe server + manifest appExtension；且**上游没有任何"RN 桌面 + 系统组件"的先例**（调研 §7.2 第 3 行的"无先例"） |

**再加一条版本风险（不是成本，是持续性负担）**：

- RNW 与 RN stable **一一对应**，节奏约 **2–3 个月一个 stable**；官方 support matrix 上
  **0.83 的 EOS 是 2026-09-30**、0.82 已 EOS。⇒ **上了 RNW 就要跟着 RN 的发布火车走**，
  每次升级都要同步抬 RNW 与全部 Windows 原生库。
- 🔴 且 heyta 现在停在 RN **0.84.1**，而上游 stable 已到 **0.87.1** ——
  RN 官方只维护最新 3 个 minor series，**0.84.x 已经在上游支持窗口之外**。
  也就是说：**我们比 RNW 更早需要处理"升 RN"这件事**，而 RNW 恰好要求版本精确对齐。
  ⇒ 上 RNW 之前应当**先把 RN 抬到受支持的版本**，否则刚接上就落后。

### 2.3 阶段与任务

> 原则与 [M1](multi-platform-adaptation.md) 一致：**先做最小可验证切片，再铺开**。
> RNW 这一路最大的风险是"**看起来在推进，其实卡在 C1**"，所以 **W0 必须是最贵未知数**。

#### W0 — 🔴 **门槛阶段：先答"存储怎么同步"**（不做完不得往下）

| 任务 | 判据（可执行） | 为什么是这一条 |
|---|---|---|
| **W0-1** 确认 RNW 0.84 能真的起一个窗口 | `npx react-native init-windows --template cpp-app` → 出一个能启动的 Windows 应用 | 把"版本对齐"从**文档事实**变成**本机事实** |
| **W0-2** 🔴 **同步 SQLite 的 Windows 实现 spike** | 在 RNW 原生侧实现一个**同步**的 `SqliteDriver`（TurboModule 包 Win32 `sqlite3`，或找到现成等价物），并**跑通同一套 `DbAdapter` 契约测试** | **这是全计划唯一可能推翻 RNW 路线的点。** 契约测试是既有的、现成的、跨端共用的 —— 不需要新写判据 |
| **W0-3** 原生库盘点 | 逐个确认 `apps/mobile` 当前用到的原生库在 Windows 上的状态，产出**缺口清单** | C2 的量必须**数出来**，不能"到时候看" |
| **W0-4** 决策点 | 若 W0-2 失败 → **停**，回到 Electron 并记录原因；若成功 → 进 W1 | 明确写出"什么情况下放弃"，避免沉没成本推着走 |

⚠️ **W0 的产物不进 `apps/desktop`**，放 `/tmp` 或独立 spike 目录 ——
避免"半成品壳"污染现有可用的 Electron 路线。

#### W1 — 让共享 UI 在 RNW 上渲染出来（**verification 优先**）

| 任务 | 判据 |
|---|---|
| W1-1 建 `apps/desktop-windows`（RNW `cpp-app`） | `build` + `typecheck` 通过 |
| W1-2 接入 `@heyta/ui` | **`TaskList` 渲染出来，且 `data-testid="task-row-*"` 可查** |
| W1-3 接入共享逻辑 | `packages/domain` / `packages/sync-core` 在 RNW 上跑通 |
| W1-4 **同一份断言** | 把 `e2e/tests/desktop-window.spec.ts` 的断言**照搬到 RNW 壳**上（不许改写断言，只许换 launch 方式） |

🔴 **W1-4 是这一阶段的核心价值**：如果两边必须写**不同的断言**，
那说明"一套 UI"没有真的成立，只是碰巧都能跑。

#### W2 — 组件与系统集成

| 任务 | 判据 |
|---|---|
| W2-1 最小可验证：先只做**一个** `IWidgetProvider` | Windows 上能注册并渲染**一张**卡片（内容可以是常量） |
| W2-2 接 `packages/widget-core` 的**同一份契约** | 与 iOS/Android/鸿蒙共用 golden fixture |
| W2-3 MSIX 打包 + package identity | `makeappx` / `winapp` CLI 产出 MSIX 并能安装 |

⚠️ 顺序不能反：**先在真机上看到一张卡片，再去接真实数据**。
C3 的"无先例"意味着这里最可能卡住，而卡住的位置必须在**最小**的形态上暴露。

#### W3 — 替换 Electron（Windows 端）

| 任务 | 判据 |
|---|---|
| W3-1 打包 / 安装器（NSIS 或 MSIX） | 同 Electron 那份的可比产物 |
| W3-2 签名 | 需证书（**当前没有** —— 这是外部条件，如实标注） |
| W3-3 走查清单与 Electron 版**逐项对齐** | 见 [`desktop-native-migration` 的验收矩阵] |

---

## 3. macOS：**现在不行**，但把触发条件写清楚

`react-native-macos` 最新 **0.81.9**（`peerDep: react-native 0.81.6`），
官方 Get Started 原文要求"React Native 与 react-native-macos 用**同一个 minor 版本**"。
heyta 在 **0.84.1**。⇒ 要用它必须：

- **把移动端降到 RN 0.81** —— 🔴 不可接受：0.81 在 RNW 的 support matrix 上是 **Unsupported**，
  而且会把移动端一起拖出支持窗口；**为了 macOS 破坏 Windows 与移动端，方向反了**；
- 或**维护两条 RN 版本流** —— 成本高且必然漂移。

**因此 macOS 的原生路线本次不启动**，触发条件写死：

> 🔴 **触发条件**：`react-native-macos` 发布 **≥ 0.84** 的 stable（即有与 RN 0.84.1 或更高
> 精确对齐的 release）→ 立刻按 §2.3 的 W1/W2 模板对 macOS 重跑一遍。

在触发之前，macOS 用 **Electron**，并**在文档里如实标注为过渡形态**（不叫"原生"）。

⚠️ **备选是 SwiftUI 原生**，本计划**不推荐**：
它意味着**第四份 UI 实现**。如果将来"macOS 必须原生"被提成硬需求，
那是一次**独立决策**（要新开 ADR），不能顺手塞进本计划。

---

## 4. Linux：**没有 RN 目标**，这是能力空白不是排期问题

RN 生态**没有 Linux**（RNW 管 Windows、RN-macOS 管 macOS）。真原生只能 GTK4 / Qt，
即**又一个独立代码库**。

**本计划的处理**：

1. Linux **继续用 Electron**，如实标注为过渡；
2. **但必须真的跑起来** —— Linux 产物至今**从未在 Linux 上运行过**。
   🔴 而"没有 Linux 机器"是**错的**：团队自己的
   `ubuntu-jcli`（124.223.13.226，Ubuntu 22.04.5）与
   `sanjiaozhou`（101.34.250.109，Ubuntu 24.04，8C/15G）**实测 SSH 可达**，
   清单见 [`local-server-verification.md`](../runbooks/local-server-verification.md) §0。
   这是**欠的活**，不是缺的条件；
3. 若将来"Linux 也必须原生"成为硬需求 → **另开 ADR**，它会是一次
   "引入第四个代码库"的决策，代价量级与 macOS SwiftUI 相同。

---

## 5. 其余各端现状（不在本计划改动范围内）

| 端 | 形态 | 状态 |
|---|---|---|
| iOS / Android | React Native（原生） | ✅ 已在用；小组件（WidgetKit / App Widget）已落地 |
| 鸿蒙 | RNOH 壳 + ArkTS 卡片 | ✅ 出包已通；**模拟器已可全 CLI 起**（[多平台构建手册](../runbooks/multi-platform-build.md) §4.1）；⬜ RN 应用上设备待做 |
| Web | React | ✅ 就是 Web |

---

## 6. 门禁要跟着改（本计划的一部分，不是附加项）

新增一个**壳**就等于新增一片**门禁盲区**。接入 RNW 时必须同步：

| 门禁 | 要做什么 | 为什么 |
|---|---|---|
| `check:design` | `SCAN_ROOTS` 加 `apps/desktop-windows` | 上次加桌面渲染层时**当场抓出 6 处裸值** —— 盲区里一定已经攒了债 |
| `check:layering` | 覆盖新壳 | 壳不得直接构造 op |
| `check:native-deps` | 覆盖 Windows 原生模块 | C2 的缺口清单要有机器兜底 |
| `check:licenses` | 登记 RNW 及其依赖 | MIT（已读 LICENSE 原文，见调研 §2） |
| **新增**：三壳断言一致性 | Electron / RNW 必须过**同一份** `desktop-window` 断言 | 见 W1-4；这是"一套 UI"唯一的机器保证 |
| `check:mobile-bundle` | **RNW 也要跑** | Hermes 相关的坑（`import.meta`）只在 release 现形；RNW 同样走 Hermes/WinAppSDK |

---

## 7. 风险登记

| 风险 | 影响 | 处置 |
|---|---|---|
| 🔴 **C1 同步 SQLite 在 Windows 上做不出来** | **整条 RNW 路线作废** | W0-2 前置；失败即停并记录（W0-4） |
| 🔴 **C3 小组件 provider 无先例** | 桌面组件可能长期缺位 | W2-1 先在**最小形态**上验证；若失败，桌面组件继续押 PWA + MSIX（[ADR-0031](../adr/0031-native-apps-everywhere-not-pwa.md) §5） |
| RN 0.84.x 已出上游支持窗口 | 越晚升越贵；RNW 要求精确对齐 | **上 RNW 之前先升 RN**（§2.2 末） |
| C2 原生库缺口比预期大 | 工作量放大 | W0-3 把缺口**数出来**再估算 |
| 双壳维护（Electron + RNW 并存期） | 两套构建/签名/发布流水线 | 并存期尽量短；W3 完成即下线 Windows 的 Electron 产物 |
| macOS/Linux 长期停在 Electron | "原生"承诺在两端不成立 | **如实标注为过渡**，不包装成原生（§3、§4） |

---

## 8. 这份计划明确**不做**的事

1. **不把移动端降到 RN 0.81** 去迁就 `react-native-macos`。
2. **不为 macOS / Linux 手写 SwiftUI / GTK / Qt** —— 那是另开 ADR 的独立决策。
3. **不引入 Tauri** —— 它用 WebView 渲染，**不是原生 UI**，与本次目标不符。
4. **不引入 Capacitor** —— Windows 上根本没有这个平台（[ADR-0031](../adr/0031-native-apps-everywhere-not-pwa.md) §1.2）。
5. **不在 W0 通过之前铺开 W1/W2** —— 最贵未知数没答就问细节，是本仓反复踩过的坑。
6. **不把"跑起来了"当"原生"** —— Electron 跑起来不叫原生，模拟器里渲染出来也不叫基线已完成。

---

## 9. 进度账本（每轮更新）

| 阶段 | 状态 | 证据 |
|---|---|---|
| W0-1 RNW 起窗口 | ⬜ 未开始 | — |
| W0-2 🔴 同步 SQLite spike | ⬜ 未开始 | **全计划门槛** |
| W0-3 原生库缺口清单 | ⬜ 未开始 | — |
| W1 RNW 渲染共享 UI | ⬜ 未开始 | — |
| W2 组件 + MSIX | ⬜ 未开始 | — |
| W3 替换 Windows 端 Electron | ⬜ 未开始 | — |
| macOS 原生 | ⏸ **等触发条件**（RN-macOS ≥ 0.84） | 调研 §2 |
| Linux 产物在 Linux 上运行 | ⬜ 未开始 | 机器已具备（[§0](../runbooks/local-server-verification.md)） |
| 鸿蒙 RN 应用上设备 | ⬜ 未开始 | 模拟器已具备（[§4.1](../runbooks/multi-platform-build.md)） |
