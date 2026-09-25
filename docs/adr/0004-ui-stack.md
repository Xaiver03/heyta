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

1. **鸿蒙支持真实存在且在持续维护**，不是传闻。
   - 核心框架：`openharmony-sig/ohos_react_native`（Gitee / GitCode），**Gitee 页面标注 License: MIT**。
   - 三方库适配：`react-native-oh-library` 组织，npm 公仓坐标 **`@react-native-oh-tpl`**。
   - 活跃度实测（GitHub API，`pushed_at`）：
     `react-native-harmony-gesture-handler` 2026-08-03、
     `react-native-harmony-reanimated` 2026-01-14、
     `react-native-harmony-screens` 2026-07-06；该组织在 **2026-09-24**（查询当天）仍有推送。
   - 官方文档明确说明已适配 **Codegen 与新架构（C-API）**。

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

1. 🔴 **本机没有 HarmonyOS 工具链，也没有 ArkTS 编译器**，因此我
   **完全没有验证** `ohos_react_native` 能否真的构建并运行。上面全部结论来自
   仓库元数据（许可证、最后推送时间）与官方文档，**不是**一次成功的构建。
   → 因此**在投入 UI 开发之前，第一步必须是"让一个最小 RN 壳在鸿蒙上真跑起来"**。
   如果这一步失败，"跨平台"的结论需要重新评估（可能要退到"RN 覆盖 iOS/Android +
   鸿蒙单独用 ArkUI"，那会改变本 ADR 的结论）。

2. **未验证** `@react-native-oh-tpl` 是否覆盖 heyta 需要的全部三方库
   （如拖拽、日历、图表）。若缺关键库，移动端功能范围要相应调整。

3. **未验证** RN 侧消费 `tokens.json` 的实际形态（token 名到 RN `StyleSheet` 的映射方式、
   暗色主题切换机制）。`tokens.json` 已产出不代表已试过消费。

4. **未验证** Android 是否在目标范围内 —— 产品负责人早前提及"安卓暂不考虑备案"，
   但 RN 天然覆盖 Android。这一点需要在排期时确认，不影响本 ADR 的技术结论。
