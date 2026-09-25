# ADR-0004：跨平台 UI 技术栈 = React Native

- **状态**：已接受
- **日期**：2026-09-25
- **决策者**：产品负责人（指示："最好是用跨平台UI技术栈"）
- **取代**：ADR-0003 §2.4 的"尚未决定"状态（结论部分被本 ADR 落实，ADR-0003 其余内容不变）
- **影响层**：`apps/`（新增 `apps/mobile`）、`packages/design-system`（消费方式）

---

## 1. 背景与约束

ADR-0003 §2.4 把"具体跨平台 UI 技术栈"留成了开放项。产品负责人现已定调：
**用跨平台技术栈**，而不是各端各写一套 UI。

推导结论的**硬约束**（按优先级，前两条会直接排除选项）：

| # | 约束 | 来源 |
|---|---|---|
| 1 | **留在 JS 生态** | 产品负责人（早前明确指示） |
| 2 | **不能用 WebView 套壳** | ADR-0003 §3.2（iOS 会清理 WebView 的 IndexedDB，本地优先应用丢本地数据不可接受） |
| 3 | **必须覆盖 iOS + HarmonyOS** | 已有 Apple Developer 与鸿蒙开发者账号 |
| 4 | **业务逻辑不得进入 UI 层** | ADR-0003 §2.1/§3.3：逻辑在 `packages/`，`apps/*` 只做壳 |
| 5 | **设计变量只有一个来源** | AGENTS.md §5：值只在 `tokens.css` 定义，其余平台**生成** |
| 6 | 存储必须走系统级 SQLite | ADR-0003 §3.2 |

约束 1 + 2 一起把"浏览器内核套壳"这一类（Capacitor、Tauri 移动端、各种 WebView 容器）**全部排除**。

---

## 2. 选项

| 选项 | 优点 | 缺点 | 关键证据 |
|---|---|---|---|
| **React Native**（+ RNOH 覆盖鸿蒙） | 满足全部 6 条约束；JS/TS 与 `packages/` 同语言；**设计 token 已就绪**；鸿蒙有成熟适配 | 鸿蒙支持是**第三方适配**，非 Meta 官方；新架构（C-API）迁移期 | 见 §3 证据 |
| Flutter | 三端一致性最好，官方支持鸿蒙的社区分支存在 | **Dart，不在 JS 生态** → 违反约束 1 | — |
| uni-app / Taro | JS 生态，宣称覆盖鸿蒙 | 框架锁定重；DSL 层再叠一层；与"业务逻辑在 packages/"的契合度需重估 | — |
| 各端原生（SwiftUI + ArkUI） | 平台观感与性能最好 | **不跨平台** → 违反产品负责人指示；UI 要写三遍 | ADR-0003 §2.4 原候选 |
| Capacitor / WebView 套壳 | 复用现有 Web UI 最省事 | **违反约束 2**，已被否决 | ADR-0003 §3.2 |

---

## 3. 结论

**选 React Native。** 它是唯一同时满足全部 6 条硬约束的选项。

决定性的一点不是"RN 很流行"，而是**约束 1 + 2 的交集里只剩它**：
排除 WebView 套壳之后，能同时覆盖 iOS 与鸿蒙、且还在 JS 生态里的方案，只有 RN 系。

### 证据

1. **鸿蒙支持真实存在且在持续维护**，不是传闻。已从"仓库元数据"升级为**本机实测**。
   - 核心框架：`openharmony-sig/ohos_react_native`（Gitee / GitCode）。
   - **⚠️ 两侧是两个不同的包名，此前我把它们混为一谈过**（见下方"踩过的坑"）：
     - JS 侧走 **npm**：`@react-native-oh/react-native-harmony`（最新 `0.84.4`）
     - 鸿蒙侧走 **ohpm**：`@rnoh/react-native-openharmony`（最新 `0.84.3`）
     - 用 ohpm 查 `@react-native-oh/...` 会 404，反之亦然。**两套 registry，两个名字。**
   - 许可证实测：**两侧都是 MIT**（npm 侧 `package/LICENSE` 实读为
     `Copyright (c) 2024 Huawei Technologies Co., Ltd.`）。
   - 活跃度实测：npm 侧 **2026-09-24 发布**（查询当天）；ohpm 侧 52 个版本。
   - 官方文档明确说明已适配 **Codegen 与新架构（C-API）**。
   - 三方库适配：`react-native-oh-library` 组织，npm 公仓坐标 **`@react-native-oh-tpl`**；
     活跃度（GitHub API，`pushed_at`）：`react-native-harmony-gesture-handler` 2026-08-03、
     `react-native-harmony-reanimated` 2026-01-14、`react-native-harmony-screens` 2026-07-06。

   > **踩过的坑（值得记，因为很容易重犯）**：官方《环境搭建》文档写的是
   > "目前 React Native for OpenHarmony 仅支持 **0.72.5** 版本"，并给出
   > `npm i @react-native-oh/react-native-harmony@x.x.x`。**照这份文档做会选到三年前的分支** ——
   > 实测两侧都已在 `0.84.x`，`peerDependencies` 要求 `react-native@0.84.1`。
   > **文档里的版本号一律要上网核对，不能照抄。**

2. 🔴 **设计系统侧已经不用再做任何事** —— 这一条改变了 P2 的工作量估算。
   `packages/design-system/src/generate.ts` 的注释里已写明
   `generated/tokens.json` 的用途是 **"React Native 等 JS 运行时"**，
   而它**已经在产出**（`packages/design-system/generated/tokens.json`）。
   也就是说 ADR-0003 §2.4 表里"React Native 需要一层 tokens.css → JS 对象的导出（P2）"
   **已经完成**，RN 直接消费 `tokens.json` 即可。选择 RN 没有新增设计系统债务。

3. **存储侧已就绪**：`packages/storage` 的 SQLite 适配器已实现并通过与其他引擎同一套契约
   （135 条），非 Web 宿主的真实读写 + 同步也已零 mock 验证通过（`pnpm verify:p2`）。
   RN 属于非 Web 宿主，因此 **没有 IndexedDB 依赖**，恰好落在已验证的路径上。

4. `@heyta/sync-client` 已从 `apps/web` 抽出（零浏览器 API），RN 壳可直接复用同一份同步编排。

---

## 4. 后果

### 正面

- UI 组件可以在 Web 与移动端之间**大量复用**（React 同源），而不是写三遍。
- `packages/` 一行不改 —— 这一点已由 Node 宿主验证过（零修改即跑通全栈）。
- 设计系统无需新增产物。

### 负面 / 需要接受的成本

- 🔴 **鸿蒙路径依赖第三方适配**。RN 官方（Meta）不支持鸿蒙；`ohos_react_native` 由 OpenHarmony
  SIG 维护。它 MIT 且活跃，但**版本节奏由第三方决定**，必须锁版本并跟踪。
- **UI 复用不等于 UI 不需要适配**。RN 没有 DOM/CSS：`tokens.css` 的**取值**能复用，
  但组件的布局写法（flexbox 差异、无 `hover`、无 `:focus-visible`、触控目标 44×44）
  必须重写。现有 `apps/web` 的 React 组件**不能直接搬**。
- **新架构（C-API）迁移期**：RNOH 声明后续只基于 C-API 演进，需要跟住。
- 需要为 RN 增加一条测试路径（Jest/RN Testing Library），与现有 Web 的 jsdom 测试并行。

### 需要靠规范兜住的

- 设计变量：RN 侧**禁止**直接写颜色，必须走 `tokens.json`。`check:design` 目前只扫 Web，
  **在 `apps/mobile` 落地时必须扩展到它**，否则设计系统在移动端形同虚设。
- 业务逻辑：新写的移动端 UI 不得内含领域逻辑，沿用 ADR-0003 §2.1。

---

## 5. 未核实项

**必须写明，因为这决定了后续第一步该做什么。**

1. 🟡 **`ohos_react_native` 的依赖链已被实测打通，但"构建出 HAP 并运行"仍未验证。**
   → 因此**在投入 UI 开发之前，第一步仍然是"让一个最小 RN 壳在鸿蒙上真跑起来"**。
   如果这一步失败，"跨平台"的结论需要重新评估（可能要退到"RN 覆盖 iOS/Android +
   鸿蒙单独用 ArkUI"，那会改变本 ADR 的结论）。

   **下面这些已经不是"文档说"，而是在本机实际跑出来的（2026-09-25）：**

   | 实测项 | 结果 |
   |---|---|
   | npm 侧包存在 | ✅ `@react-native-oh/react-native-harmony` |
   | npm 侧许可证 | ✅ **MIT**（`Copyright (c) 2024 Huawei Technologies Co., Ltd.`） |
   | npm 侧活跃度 | ✅ **2026-09-24 发布**（查询当天） |
   | tarball 实际下载 | ✅ **103 MB / 1391 文件**，取出 3 个真实 `.har` |
   | ohpm 侧包存在 | ✅ `@rnoh/react-native-openharmony@0.84.3` |
   | ohpm 侧许可证 | ✅ **MIT**，52 个版本 |
   | **`ohpm install` 实际执行** | ✅ **成功，28.9 秒**，连依赖 `@ppd/ffrt@1.1.10` 一并拉下 |
   | 落盘体积 / 文件数 | 309 MB / **11975 个文件** |
   | 含真原生代码 | ✅ **2509 个 `.h`、2216 个 `.cpp`、40 个 `.ets`、4 个 `.so`** |
   | 本机原生工具链 | ✅ SDK `native/`（`llvm`、`build-tools`）、`hvigorw`、`ohpm`、`es2abc` |

   ⚠️ **两处必须说清的更正，因为它们都推翻了先前的说法：**

   - 本条初稿曾写"本机没有 HarmonyOS 工具链，也没有 ArkTS 编译器"。**那是错的** ——
     DevEco Studio 6.1.1.300 就装在本机，SDK 为 API 24。当时的探测只查了 PATH，
     就把"没找到"当成了"不存在"（陷阱 #21）。"本机没有工具链"这条**已作废**。
   - 官方《环境搭建》文档写"仅支持 React Native **0.72.5**"，**该文档已过时**：
     实测 npm 侧最新为 `0.84.4`、ohpm 侧 `0.84.3`，`peerDependencies` 要求
     `react-native@0.84.1`。**照文档选版本会选到一个三年前的分支。**

   ⚠️ **还没验证的是什么**：没有跑过 `hvigorw assembleHap`，
   **没有编译过一行 C++，没有生成过 HAP，没有在设备/模拟器上跑起来**。
   已确认的是"零件齐全且取得到"；未确认的是"这些零件能拼成能跑的东西"。
   原生侧需要本地编译（`CMakeLists.txt` 存在，且 `.so` 仅 4 个而非各 ABI 齐全），
   这是下一步最可能出问题的地方。

   > **更正（同日）**：本条初稿写的是"本机没有 HarmonyOS 工具链，也没有 ArkTS 编译器"。
   > **那是错的。** DevEco Studio 6.1.1.300 就装在本机
   > （`/Applications/DevEco-Studio.app`），SDK 为 API 24，`hdc` / `ohpm` / `hvigorw`
   > 以及**真正的 ArkTS 编译器 `es2abc`** 全都在里面，只是不在 PATH 上。
   > 当时的探测只查了 PATH，就把"没找到"当成了"不存在"。
   >
   > 因此"本机没有工具链"这条**已作废**；上面第 1 条收窄为**仅指 RNOH 未被构建验证**。
   > ArkTS 产物这一侧已经用真编译器验证通过，见 `pnpm check:arkts`。

2. **未验证** `@react-native-oh-tpl` 是否覆盖 heyta 需要的全部三方库
   （如拖拽、日历、图表）。若缺关键库，移动端功能范围要相应调整。

3. ✅ **已解决**：RN 侧消费形态已落地为 `generated/tokens.native.ts`
   （带类型、暗色已合并）+ `src/native.ts`（`useColorScheme` 的 null 归一化、
   减少动效合并）。详见下方"消费层"一节。
   ⚠️ 仍未验证的是**在真机/模拟器上渲染出来的样子** —— 类型与值是对的，
   但**没有人眼看过**它。

4. **未验证** Android 是否在目标范围内 —— 产品负责人早前提及"安卓暂不考虑备案"，
   但 RN 天然覆盖 Android。这一点需要在排期时确认，不影响本 ADR 的技术结论。

---

## 6. RN 消费层（本轮新增，回应上面第 3 条）

Web 端用 `cssVar()` 拿 CSS 变量；**RN 没有 `var()`，也没有层叠**，因此不能复用那条路径。
新增了两个东西：

1. **`generated/tokens.native.ts`** —— 自动生成，与 Swift/ArkTS 同源（同一个 `NativeToken[]`）。
   它比 `tokens.json` 多了两件关键的事：

   | | `tokens.json` | `tokens.native.ts` |
   |---|---|---|
   | 暗色段 | **稀疏**（只含 59 个被覆盖的） | **完整 126 个**（已与亮色合并） |
   | 类型 | `Record<string, string \| number>` | 每个 token 精确类型（颜色 `string`、尺寸 `number`） |
   | 拼错名字 | 运行期 `undefined` | **编译期报错** |

   🔴 第一行是**修掉一个真陷阱**，不是格式偏好：RN 拿到 `undefined` 颜色**不报错，
   只是不渲染**。直接消费 `tokens.json` 的 dark 段，任何未被覆盖的 token 都会静默消失。

2. **`src/native.ts`** —— 补上 RN 特有、而 CSS 帮我们做掉的两件事：
   - `resolveThemeName()`：`useColorScheme()` 的类型是 `'light' | 'dark' | null | undefined`，
     `null` 表示"系统未指定"。直接当索引会得到 `undefined`。已归一化为亮色。
   - `resolveNativeTokens()`：减少动效是**覆盖层**，必须与主题表合并后使用。

验证（`tests/native.spec.ts`，56 条，已用**三重注入**确认能失败）：

| 注入的缺陷 | 结果 |
|---|---|
| 把 dark 砍回稀疏（126 → 42 条） | **21 条测试红** |
| 把一个数值 token 写成字符串 | **4 条红** |
| 生成器把暗色的合并写错 | **2 条红** |

对比度也**用 RN 拿到的值重算**（亮/暗各一遍），与 Swift/ArkTS 同一套阈值。
