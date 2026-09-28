# 多端原生构建计划：原生优先，代码量不设上限

> 状态：**规划中**
> 决策依据：[ADR-0034](../adr/0034-windows-native-winui3-not-rnw.md)（Windows 走 WinUI 3 / Windows App SDK 原生）
> 上位计划：[多端适配实施计划](multi-platform-adaptation.md) M2
> 素材：[桌面端选型调研](../research/desktop-shell-selection.md)（含全部一手数字 + §8 的 2026-09-28 复核）

---

## 0. 这份计划在回答什么

**「每个端都交付原生应用」这个目标，逐端分别可达吗？不可达的那几端怎么办？**

产品要求（2026-09-28 原话）：

> 「我们尽可能需要原生，包括 Windows 上面也需要原生。**哪怕是代码量偏大。**」

🔴 这句话改变的不是"想不想"，而是**权衡的方向**：
[ADR-0024](../adr/0024-desktop-shell-and-ui-convergence.md) §2.2 选 Electron 的**唯一**决定性理由是
"UI 复用度最高"；现在**原生性排在复用度之前**，那个论证前提就没了。

⚠️ **但"尽可能"是一个需要逐端兑现的词，不是一句口号。**
而且它授权的是**一次性的代码量**，不是**永久性的双份维护**，也不是
**让另一个已在交付的产品停止获得上游支持**。这两条边界在第 2、3 节是关键。

---

## 1. 🔴 先钉死：三端的原生可达性不一样

| 平台 | 真原生方案 | 可达性 | 决定性事实 |
|---|---|---|---|
| **Windows** | **WinUI 3 / Windows App SDK（C#）** | ✅ **本次就做** | 不碰 RN 版本 ⇒ 移动端保持升级自由；ADO.NET 同步 SQLite；**官方 C# widget provider 教程**（[ADR-0034](../adr/0034-windows-native-winui3-not-rnw.md) §1.3/§1.4） |
| **Windows**（备选） | react-native-windows | 🔴 **本轮出局** | RNW 最新稳定版 = **0.84.0**（`peerDep: RN 0.84.1`），**无 0.85+ 稳定版**；而 RN 上游已 0.87.1 ⇒ 选它 = 把 `apps/mobile` 一起冻在出了支持窗口的 RN 上 |
| **macOS** | SwiftUI / AppKit 原生 | ⚠️ **可达，但本轮不启动** | 见 [ADR-0034](../adr/0034-windows-native-winui3-not-rnw.md) §3.1：先解 `packages/domain` 单源问题，否则 Swift 也跑不了 TS —— **排在 Windows 之后**（§3） |
| **macOS**（备选） | `react-native-macos` | 🔴 **现在不可行** | 最新 **0.81.9**（`peerDep: react-native 0.81.6`），官方要求"同一 minor"；heyta 在 **0.84.1** → 硬冲突 |
| **Linux** | GTK4 / libadwaita（或 Qt） | ⏸ **可达，但没有需求证据** | RN 生态没有 Linux。真原生 = **又一个独立代码库**；而**目前没有任何 Linux 桌面用户的证据**（§4） |
| **iOS / Android** | React Native | ✅ **已经是原生** | `apps/mobile`；且已落地真原生小组件（WidgetKit / App Widget） |
| **鸿蒙** | RNOH + ArkTS 卡片 | ✅ **已经是原生** | `apps/mobile/harmony`；出包已通，模拟器已可用 |
| **Web** | —— | ✅ 就是 Web（定义如此） | `apps/web` |

**结论**：**Windows 本次迁**；**macOS 排在 Windows 的领域层方案之后**；
**Linux 等需求证据**；三端在没有原生壳之前**保留 Electron 并如实标注为过渡**，不假装它们是原生的。

> 🔴 **为什么这条要写在最前面**：如果计划写成"桌面三端统一上原生"，
> 那么它在 macOS 上会撞版本墙、在 Linux 上无墙可撞（只能自己造一个），
> 而**真正的工作量不在"写三个壳"，在于领域层要不要变成两份**（§2.3 W0-4）。
> 那一个问题解决一次，三个壳才都成立；不解决，三个壳就是三份漂移的业务逻辑。

---

## 2. Windows：Electron → WinUI 3 原生

### 2.1 为什么是 WinUI 3，不是 RNW（一句话版）

RNW 看起来显然，**唯一**理由是"与 RN 0.84.1 版本精确对齐" —— 而对齐到的那个版本
**已经不被上游支持**，且 RNW **没有更新的稳定版可对齐**。那条"对齐"现在是**负债**。
完整论证与被否决选项见 [ADR-0034](../adr/0034-windows-native-winui3-not-rnw.md) §1.2、§2。

### 2.2 代价清单（必须**先认账再开工**）

| # | 代价 | 现状 | 为什么绕不开 |
|---|---|---|---|
| **C-A** | **一整套 Windows UI 要另写** | `packages/ui`（React/RNW）对 Windows **不再复用** | 这是"原生优先于复用度"的直接价格，**已由产品授权** |
| **C-B** | 🔴 **`packages/domain`（6603 行纯 TS）的单源问题** | 🟡 **已有结论：D2 可行**（[spike](../../research/spikes/domain-single-source/README.md) 2026-09-28） | C# 进程跑不了 TS。D1 移植 = 永久两份源；D2 内嵌 JS 引擎跑同一份 bundle。**spike 实测：同一份 bundle 字节在裸 V8 与 .NET+Jint 上 22/22 用例一致、零宿主全局依赖** ⇒ **不必**认 D1 的永久双份维护。⚠️ 仅证明"可行"，未证明"够快"（[spike README 未证明项](../../research/spikes/domain-single-source/README.md)） |
| **C-C** | 门禁与许可证口径要扩到**非 npm** 世界 | `check:*` 全是 JS/TS 扫描器；`license-inventory.mjs` 只扫 npm | WinUI / .NET / `Microsoft.Data.Sqlite` / `SQLitePCLRaw` **扫不到 ≠ 合规**（§6） |

**已经不再是代价的三条**（ADR-0032 曾把它们记成硬前置）：

- ~~C1 同步 SQLite~~ → `Microsoft.Data.Sqlite` 是 **ADO.NET**，API 全同步
  （[ADR-0034](../adr/0034-windows-native-winui3-not-rnw.md) §1.4，含官方原文）；
  **且已端到端验过**：未改一行的 `SqliteAdapter` 在 Jint + C# 驱动上过契约
  （[spike](../../research/spikes/sqlite-driver-csharp/README.md)，exit 0）。
- ~~C3 provider 只能 C++/WinRT、无先例~~ → 微软**有 C# 版官方教程**
  （[ADR-0034](../adr/0034-windows-native-winui3-not-rnw.md) §1.3）。
- ~~C2 生态只有 2.8% 支持 Windows~~ → **heyta 自己只有 4 个原生库**，
  且换到 .NET 栈后这条**根本不适用**（[ADR-0034](../adr/0034-windows-native-winui3-not-rnw.md) §1.5：
  `op-sqlite` ❌ / `safe-area-context` ❌ / `get-random-values` ❌ / `react-native-svg` ✅）。

⚠️ **C2 的数字仍然要留着**：它只在"回到 RNW"或"继续维护 RN 壳"时才生效（§2.6）。

### 2.3 阶段与任务

> 原则与 [M1](multi-platform-adaptation.md) 一致：**先做最小可验证切片，再铺开**。
> Windows 路最大的风险是"**看起来在推进，其实卡在 C-B（领域层两份源）**"，
> 所以 **W0 必须把最贵的未知数放在最前面**。

#### W0 — 🔴 **门槛阶段**（不做完不得往下）

| 任务 | 判据（可执行） | 为什么是这一条 |
|---|---|---|
| **W0-1** 装工具链并起一个空窗口 | 🟡 **编译这一半已通**（2026-09-28）：`windows-pc` 上 **`winget install Microsoft.DotNet.SDK.10`** → **10.0.401**；该机 **从未装过 Visual Studio**（`C:\Program Files\Microsoft Visual Studio` 不存在），但 WinUI 3（Windows App SDK **2.5.1**）工程 **`dotnet build` 成功**（0 警告 0 错误）。⬜ **仍未做**：真的**启动一个窗口并截图** | 🔴 **2026-09-28 实测修正了官方文档的前置**：微软写的是"VS 2022 + WinUI 工作负载"，但**命令行编译不需要 VS**（[spike](../../research/spikes/winui3-toolchain-probe/README.md)）⇒ 省掉一个 10~20 GB 的共享机安装。⚠️ **"能编译" ≠ "能开窗"**：unpackaged 还需要机器上装 Windows App SDK 运行时，且**需要一个真实桌面会话**（SSH 进来的是无会话环境） |
| **W0-2** **同步 SQLite 驱动（C#）** | ✅ **已完成**（2026-09-28，exit 0）。**未改一行的** `SqliteAdapter` 在 **.NET 10 + Jint** 里跑在 C# 同步驱动（`Microsoft.Data.Sqlite` 10.0.12）上。🔴 后来升级为**全量契约重放**：`packages/storage/tests/contract/*.contract.ts` 的**全部 50 条断言、一个字不改**在 Jint 里跑，**50/50 通过**（约 2 秒）。复现：`pnpm check:crosslang-contract` | 契约测试**已经存在**，难的是**在 C# 侧重放它**。⚠️ **两个"默认值就是错的"陷阱**已写进 [spike README](../../research/spikes/sqlite-driver-csharp/README.md)：`Microsoft.Data.Sqlite` **只认具名参数**（契约是 `?` 位置），以及 **Jint 默认把 CLR 异常冒泡给宿主、中断脚本**（不打开 `CatchClrExceptions`，一条重复写入会**杀掉整个桌面进程**）。✅ **编组开销已测**：固定 6 µs/次、JSON 桥 4.9 µs/行 ⇒ **保留 JSON 桥**；2000 行时纯 C# 基线就占 46%，该优化的是"少搬行"。⚠️ 仍欠：Windows 宿主上的性能未测；`widget-core` golden fixture 未进通道 |
| **W0-3** 原生库缺口清单 | 数出 `apps/mobile` 用到的原生库及其 Windows 状态 | ✅ **已完成**：[ADR-0034](../adr/0034-windows-native-winui3-not-rnw.md) §1.5，**4 个原生库 / 3 个缺口**，含可复现命令 |
| **W0-4** 🔴 **领域层单源 spike** | ✅ **bundle 级已证 D2 可行**（2026-09-28）。实测：同一份 `@heyta/domain` bundle 字节（338445 B / 146 个导出）在**裸 V8 上下文**（零宿主全局访问）与 **.NET 10 + Jint 4.16.4** 上跑 22/22 用例，**结果逐条一致**。含打包进来的 `ical.js` RRULE 求值。复现：`bash research/spikes/domain-single-source/run.sh`（exit 0） | **这是全计划唯一可能推翻 Windows 原生路线、或把它变成永久双份维护的点。** D2 成立 ⇒ **不认** D1 的永久双份维护。⚠️ **只答了"可行"，没答"够快"**：ES 覆盖率、跨引擎浮点边界、Jint 性能与内存**均未测**（[spike README 未证明项](../../research/spikes/domain-single-source/README.md)）—— 这些进 W1 |
| **W0-5** 决策点 | ✅ **已判：进 W1**（2026-09-28）。三条门槛都过了 —— W0-1 **命令行可编译**（不需要 VS）、W0-2 **全量契约重放 50/50**、W0-4 **领域层不必两份源**。⚠️ W1 要盯的是**跨语言编组开销**（性能），不是 blob | 明确写出"什么情况下放弃"。**放弃判据依然有效**：若 W1 暴露出跨语言编组性能不可接受，仍回 Electron 并记录。⚠️ **2026-09-28 更正**：先前把"blob 过不了 JSON 桥"写成 W1 硬前置是**写重了** —— 实测**没有任何一处把二进制写进库**（加密层出门前就转 base64），它是**已声明的能力缺口**，不是在用路径上的缺口（[ADR-0034](../adr/0034-windows-native-winui3-not-rnw.md) §6.2 第 1 条） |

⚠️ **W0 的产物不进 `apps/desktop`**，放独立 spike 目录 ——
避免"半成品壳"污染现有可用的 Electron 路线。

#### W1 — 最小垂直切片（**verification 优先**）

| 任务 | 判据 |
|---|---|
| W1-1 建 `apps/desktop-windows`（WinUI 3） | `dotnet build` + 现有 `pnpm typecheck` 不因它变红 |
| W1-2 接上 W0-4 选定的领域层通道 | 界面能读到**真实**（非硬编码）任务数据 |
| W1-3 渲染出**同一份** UI 契约 | `data-testid="task-row-*"` 可查（这是 `@heyta/ui` 自己打的锚点，与 Electron/web 一致） |
| **W1-4** 🔴 **同一份断言** | `e2e/tests/desktop-window.spec.ts` 的断言**照搬**到 Windows 壳（**不许改写断言，只许换 launch 方式**） |

🔴 **W1-4 是这一阶段的核心价值**：如果两边必须写**不同的断言**，
那说明"同一套 UI 契约"没有真的成立，只是碰巧都能跑。

#### W2 — 组件与系统集成

| 任务 | 判据 |
|---|---|
| W2-1 先只做**一个** `IWidgetProvider` | Windows 小组件面板里能注册并渲染**一张**卡片（内容可以是常量） |
| W2-2 接 `packages/widget-core` 的**同一份契约** | 与 iOS/Android/鸿蒙共用 golden fixture |
| W2-3 MSIX 打包 + package identity | `makeappx` / `winapp` CLI 产出 MSIX 并能安装（widgets **要求 packaged app**） |

⚠️ 顺序不能反：**先在真机上看到一张卡片，再去接真实数据。**

#### W3 — 替换 Electron（Windows 端）

| 任务 | 判据 |
|---|---|
| W3-1 打包 / 安装器（MSIX，或 NSIS） | 与 Electron 那份可比产物 |
| W3-2 签名 | 需证书（**当前没有** —— 外部条件，如实标注） |
| W3-3 与 Electron 版**逐项对齐**的验收矩阵 | 见 [`desktop.md`](../runbooks/desktop.md) 的走查清单 |

### 2.4 测试怎么进 CI（🔴 不能假装它自动被覆盖）

`pnpm check` 是一条 **JS/TS 流水线**（`pnpm -r test` 跑的是 vitest）。
`apps/desktop-windows` 是 C# ⇒ **它默认不在任何门禁里**。

必须新增一条 `dotnet test` 通道，且**明写它的运行位置**：

| 通道 | 在哪跑 | 跑什么 |
|---|---|---|
| `pnpm check:windows-dotnet`（新增） | **只在 Windows 上**（`windows-pc` / CI 的 Windows runner） | `dotnet test`；含 W0-2 的驱动契约重放 |
| 跨语言契约（§6） | 两边都跑 | 同一份契约数据，TS 侧与 C# 侧各跑一遍，结果必须一致 |

⚠️ 在 macOS 上这条通道只能**跳过并显式报告"已跳过"**，
不能因为"本地没红"就当成验过 —— 这正是
[`ci-and-runner.md`](../runbooks/ci-and-runner.md) §8.1「看着在跑，其实什么都没验」那类坑。

### 2.5 回退

任一阶段失败 ⇒ 回到 `apps/desktop`（Electron）—— **它现在就是可用的**，
Windows 侧从未失去可用产物。W0-5 明确写下放弃判据。

### 2.6 什么时候回到 RNW

**触发条件（写死）**：`react-native-windows` 发布 **≥ 0.87 的 stable**
（即有与一个**仍在 RN 支持窗口内**的版本精确对齐的 release）→ 重新评估
[ADR-0034](../adr/0034-windows-native-winui3-not-rnw.md)。
现在只有 `0.85.0-preview.2`，**preview 不作为交付依据**。

---

## 3. macOS：可达，但**排在 Windows 的领域层方案之后**

两条路，顺序明确：

| 路 | 触发条件 | 说明 |
|---|---|---|
| **A. SwiftUI / AppKit 原生**（推荐方向） | **Windows 的 W0-4 有结论之后** | 它和 Windows 卡在**同一个**问题上：跨语言调用 `packages/domain`。**同一个答案用两次**，边际成本才合理。先做 macOS 就是把那个问题付两遍 |
| **B. `react-native-macos`** | 上游发布 **≥ 0.84 的 stable** 且 RN 版本能对上 | 更省 UI，但会重新引入"桌面壳反向锁死 RN 版本"的老问题（§2 的教训）。**触发时须重新权衡，不能默认回到这条路** |

在触发之前，macOS 用 **Electron**，并**在文档里如实标注为过渡形态**（不叫"原生"）。

⚠️ **不能顺手把 macOS 塞进 Windows 那一轮**：它会同时打开第二个"领域层怎么被调用"的
实现，让 W0-4 的结论不再唯一。**先有一个答案，再去用第二次。**

---

## 4. Linux：**没有 RN 目标**，且**没有需求证据** —— 这是产品判断不是排期问题

RN 生态**没有 Linux**。真原生只能 GTK4 / libadwaita（或 Qt），即**又一个独立代码库**。

**本计划的处理**：

1. 🔴 **先如实承认证据状况**：团队有自己的 Linux 主机
   （`ubuntu-jcli` 124.223.13.226 / `sanjiaozhou` 101.34.250.109，实测 SSH 可达，
   见 [`local-server-verification.md`](../runbooks/local-server-verification.md) §0），
   但它们是 **CI / 部署服务器**，**不是 Linux 桌面用户**。
   "我们有 Linux 机器" ≠ "有人要用 Linux 桌面版"。
   目前**没有任何 Linux 桌面用户的证据** ⇒ **不启动第四个原生壳**。
2. Linux **继续用 Electron**，如实标注为过渡；
3. **但必须真的跑起来** —— Linux 产物至今**从未在 Linux 上运行过**。
   这是**欠的活**，不是缺的条件（机器已具备）；
4. 若将来"Linux 也要原生"被提成硬需求 → **另开 ADR**，
   它会是一次"引入第四个代码库"的决策 —— 而且**应当在 §3 的领域层答案之后**。

---

## 5. 其余各端现状（不在本计划改动范围内）

| 端 | 形态 | 状态 |
|---|---|---|
| iOS / Android | React Native（原生） | ✅ 已在用；小组件（WidgetKit / App Widget）已落地 |
| 鸿蒙 | RNOH 壳 + ArkTS 卡片 | ✅ 出包已通；**模拟器已可全 CLI 起**（[多端构建手册](../runbooks/multi-platform-build.md) §4.1）；⬜ RN 应用上设备待做 |
| Web | React | ✅ 就是 Web |

---

## 6. 门禁要跟着改（本计划的一部分，不是附加项）

新增一个**壳**就等于新增一片**门禁盲区**。而本次新增的壳**是 C#，不在任何现有扫描器覆盖内** ——
这是比 ADR-0032 那版更严重的一档。

| 门禁 | 要做什么 | 为什么 |
|---|---|---|
| `check:design` | `SCAN_ROOTS` 加 `apps/desktop-windows` | 上次加桌面渲染层时**当场抓出 6 处裸值** —— 盲区里一定已经攒了债 |
| `check:layering` | 覆盖新壳（壳不得直接构造 op） | 但**扫描器本身是 JS/TS 的** ⇒ C# 需要新的、语言无关的兜底，见下两行 |
| ✅ **已完成：跨语言契约重放** | `check:crosslang-contract` = `node scripts/check-crosslang-contract.mjs`。它跑的是 `packages/storage/tests/contract/*.contract.ts` 的**全部 50 条断言、一个字不改**（靠 `--alias:vitest=<替身>` 送进 Jint），**实测 50/50 通过**，全程约 2 秒。**契约没被复制、也没被改写** —— 见 [spike](../../research/spikes/sqlite-driver-csharp/README.md) | 这是"同一套契约"唯一的机器保证；C# 侧不能靠"我们照着写了"来证明。✅ **已接进 `pnpm check`**。🔴 **四道反假通过**：① 条数与真 vitest **逐一对齐**（每实现 24+26=50，真 vitest 也是 50）；② 注入"顺序颠倒"的细微 bug → 契约**当场抓 6 条**、非零退出，而 probe 阶段察觉不到；③ 没有 `dotnet` 时**显式报告跳过**；④ 覆盖面有限，**下一步的精确范围见下** |
| ⬜ **跨语言通道的剩余范围**（下一步，已勘定） | 把 `packages/widget-core`（W2 最大的风险面）也接进同一条通道。**已勘定要做的四件事**：① 替身补 5 个匹配器 —— `not` / `toBeTruthy` / `toContain` / `toContainEqual` / `toBeNull`（storage 契约只用到 6 个，widget 用到 11 个）；② **`--alias:node:fs` 替身** —— `tests/golden.spec.ts` 与 `tests/adaptive-card.spec.ts` 用 `readFileSync` 读 `fixtures/*.golden.json`，而 Jint 里没有文件系统；③ 同上还要供 `apps/web/public/widgets/` 里的 Adaptive Card 模板（`adaptive-card.spec.ts:299` 读它做"模板与数据不漂移"的比对）；④ `node:path` / `node:url` 也要替身（`import.meta.url` 在 Hermes/Jint 下不存在，已有前车之鉴）。⚠️ **Worker 桥（`oplog-worker-bridge.ts`）不需要** —— 那是 web 端专用端口，桌面壳不走它 | 这一条做完，W2 的"组件契约能不能在 C# 侧成立"才有机器保证；在此之前 W2 只有黄金夹具在四端（ArkTS/Swift/Kotlin）跑过，**没有第五端** |
| ✅ **已完成：非 npm 许可证清单** | `check:licenses:nuget` = `node research/tools/nuget-license-inventory.mjs`。它跑 `dotnet list package --include-transitive --format json` 读**本机实际还原出来的依赖树**，再去查**已入库的** `research/nuget-licenses-inventory.json`；新增 NuGet 包没刷新清单 → **失败并点名是哪个包**。白名单/`REVIEWED_OTHER` 与 npm 侧**共用** `license-policy.mjs`（避免两份白名单漂移） | `license-inventory.mjs` 只扫 npm；**扫不到 ≠ 合规**。✅ **已接进 `pnpm check`**（在 `check:licenses` 之后）。⚠️ 三条如实标注的边界：**没有 `dotnet` 时它显式报告"已跳过"**（不是假装通过）；`dotnet list package` 会**隐式还原**，所以 **NuGet 缓存冷的机器上这一步要联网**；**当前只覆盖 2 个 spike 工程**，`apps/desktop-windows` 落地后自动纳入 |
| `check:licenses` | ✅ 已登记 .NET 侧 8 个包：`Jint` **BSD-2-Clause**（原先被我误写成 MIT，**是这个门禁抓出来的**）、`Acornima` BSD-3-Clause、`Microsoft.Data.Sqlite`(.Core) MIT、`SQLitePCLRaw.*` Apache-2.0 | ADR-0034 §4 |
| **新增：`check:windows-dotnet`** | Windows 上跑 `dotnet test`；非 Windows 上**显式报告跳过** | §2.4：否则 C# 代码永远不在门禁里 |
| **新增：多壳断言一致性** | Electron / WinUI 必须过**同一份** `desktop-window` 断言 | 见 W1-4；这是"同一套 UI 契约"唯一的机器保证 |
| ~~`check:mobile-bundle`~~ | **不需要为 WinUI 3 跑** | 该门禁防的是 Hermes 的 `import.meta` 坑；WinUI 3 不走 Hermes（这一条随 RNW 出局而消失） |

---

## 7. 风险登记

| 风险 | 影响 | 处置 |
|---|---|---|
| 🔴 **C-B 领域层只能做成两份源** | **核心业务逻辑永久双份维护** —— 不是代码量问题，**不被"哪怕是代码量偏大"覆盖** | **W0-4 前置**；若两路都不成立则**停**（W0-5） |
| 🔴 `windows-pc` 无任何 .NET 工具链 | W0 无法开始 | **W0-1**：装机是硬前置，已实测记录（[ADR-0034](../adr/0034-windows-native-winui3-not-rnw.md) §5.1） |
| ~~非 npm 依赖的许可证无人扫~~ | 合规盲区 | ✅ **已处理**：`check:licenses:nuget` 已接进门禁（§6）。**残余风险两条**：① 机器上没有 `dotnet` 时它**报告跳过**（不是假装通过）—— 别把"绿"读成"验过"；② 它只覆盖**仓库里的 `.csproj`**，`Microsoft.WindowsAppSDK` 要等 `apps/desktop-windows` 落地才会被纳入 |
| ~~跨语言编组开销可能否掉 JSON 桥~~ | 存储设计要重做 | ✅ **已实测处理**（2026-09-28）：固定开销 **6 µs/次**、JSON 桥约 **4.9 µs/行** ⇒ 现实行量下在一帧内，**保留 JSON 桥**。🔴 关键归因：2000 行时**纯 C# 基线就占 46%** —— 该优化的是"少搬行"（索引 + limit），不是编组格式。⚠️ 只在 macOS 测过，**Windows 宿主未测** |
| 🔴 **Jint 的约束在 JS 里 `catch` 不住** | **内嵌引擎失控会杀掉整个桌面进程**（实测退出码 134），而不是被优雅降级 | W1 必须二选一：给引擎做**进程内隔离**，或**显式接受并写下来**。另：`Options.LimitMemory(n)` 是**累计分配预算**、不是峰值内存上限，别拿它当 RSS 上限用（[ADR-0034](../adr/0034-windows-native-winui3-not-rnw.md) §6.2 第 3 条） |
| C# 不在 `pnpm check` 内 | 新壳成为门禁盲区 | §2.4 + §6 的 `check:windows-dotnet` |
| 双壳维护（Electron + WinUI 并存期） | 两套构建/签名/发布流水线 | 并存期尽量短；W3 完成即下线 Windows 的 Electron 产物 |
| macOS / Linux 长期停在 Electron | "原生"承诺在两端不成立 | **如实标注为过渡**（§3、§4），不包装成原生 |
| RNW 突然发布 ≥ 0.87 | 技术选型被上游改变 | §2.6 的触发条件已写死；届时重新评估，不追改 |

---

## 8. 这份计划明确**不做**的事

1. **不把移动端冻在 RN 0.84.1** 去迁就 RNW —— 这也是 [ADR-0034](../adr/0034-windows-native-winui3-not-rnw.md) 推翻 ADR-0032 的唯一理由。
2. **不把 `packages/domain` 默认做成两份源** —— 移植**是候选，不是默认**（W0-4 拍板）。
3. **不同时开 macOS 的原生壳** —— 先把领域层答案做出来（§3）。
4. **不为 Linux 开第四个原生壳** —— 没有需求证据（§4）。
5. **不引入 Tauri** —— WebView2 渲染，不是原生 UI。
6. **不引入 Capacitor** —— Windows 上根本没有这个平台（[ADR-0031](../adr/0031-native-apps-everywhere-not-pwa.md) §1.2）。
7. **不在 W0 通过之前铺开 W1/W2** —— 最贵未知数没答就问细节，是本仓反复踩过的坑。
8. **不把"跑起来了"当"原生"** —— Electron 跑起来不叫原生，窗口截到图也不叫基线已完成。

---

## 9. 进度账本（每轮更新）

| 阶段 | 状态 | 证据 |
|---|---|---|
| W0-0 复核 RNW 是否有 ≥0.85 | ✅ **已完成** | npm `dist-tags`：`latest=0.84.0`，无 0.85+ 稳定版（[ADR-0034](../adr/0034-windows-native-winui3-not-rnw.md) §1.2） |
| W0-3 原生库缺口清单 | ✅ **已完成**，且**做成了可重跑的脚本** | **4 个原生库 / 3 个缺口**（[ADR-0034](../adr/0034-windows-native-winui3-not-rnw.md) §1.5）。复现：`node research/tools/windows-native-gaps.mjs` —— 它会现场数一遍，并在**清单过期**（包不再是直接依赖）或**可能漏报**（某依赖声明了 `codegenConfig` 却不在清单里）时报警 |
| W0-1 装工具链 + 起窗口 | 🟡 **编译已通，开窗未做**（2026-09-28） | .NET SDK **10.0.401** 已装（`winget`）；该机**无 VS** 但 WinUI 3 / WinAppSDK 2.5.1 **`dotnet build` 0 警告 0 错误**，产出 **162304 字节的 exe** —— 见 [spike](../../research/spikes/winui3-toolchain-probe/README.md)。⬜ 启动窗口 + 截图仍待做（无桌面会话 + 需装 WinAppSDK 运行时） |
| W0-2 同步 SQLite 驱动（C#） | ✅ **已完成；契约全量重放 + 编组开销已测**（2026-09-28） | ① 未改一行的 `SqliteAdapter` + `DbOpLogStore` 跑**原样契约 50/50 通过**（约 2 秒），已做成门禁 `check:crosslang-contract`；反假通过：条数与真 vitest 对齐、注入细微 bug 能抓 6 条。② 编组开销：固定 **6 µs/次**、JSON 桥 **4.9 µs/行** ⇒ 保留 JSON 桥；2000 行时纯 C# 基线占 46%，该优化的是"少搬行"。⚠️ 未测：Windows 宿主上的性能；`widget-core` golden fixture 未进通道 |
| W0-5 决策点 | ✅ **已判：进 W1**（2026-09-28） | W0-1 / W0-2 / W0-4 三条门槛都过；放弃判据仍有效。⚠️ 更正：blob 曾被写成 W1 硬前置，实测**没有一处把二进制写进库** ⇒ 不是在用路径上的缺口 |
| **W0-4 🔴 领域层单源 spike** | ✅ **bundle 级已证 D2 可行**（2026-09-28） | 同一份 bundle（338445 B / 146 导出）在裸 V8 与 .NET+Jint 上 **22/22 一致、零宿主全局**；复现 `bash research/spikes/domain-single-source/run.sh`。⚠️ 性能/ES 覆盖率未测 |
| W1 WinUI 3 渲染最小切片 | ⬜ 未开始 | — |
| W2 组件 + MSIX | ⬜ 未开始 | — |
| W3 替换 Windows 端 Electron | ⬜ 未开始 | — |
| macOS 原生 | ⏸ **排在 W0-4 之后** | §3 |
| Linux 产物在 Linux 上运行 | ⬜ 未开始 | 机器已具备（[§0](../runbooks/local-server-verification.md)） |
| 鸿蒙 RN 应用上设备 | ⬜ 未开始 | 模拟器已具备（[§4.1](../runbooks/multi-platform-build.md)） |
