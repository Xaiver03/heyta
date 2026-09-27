# 多端适配实施计划：一套代码、多端复用

> 状态：**规划中**
> 依据：[多端「一套代码」融合调研](../research/multi-platform-ui-fusion.md) ·
> 选型：[ADR-0024](../adr/0024-desktop-shell-and-ui-convergence.md)（⚠️ **待确认**）
> 关系：本计划是 [P2 多端补齐](phase-2-multi-platform.md) 的**主体执行计划**，
> 不是 P3（平台特有能力）。**P3 中除去系统小组件的部分**依赖本计划产出的"一套 UI"；
> **系统小组件不依赖它**（见 §6.2）—— 组件是该平台的**原生 UI**，用不了这套 RN 组件，
> 所以[小组件计划](multi-platform-widgets.md)与 M0/M1 **并行不冲突**，
> **不要因为 M1 的结果去等待或取消小组件工作**。

---

## 0. 这份计划在回答什么

**「一套代码」怎么从今天的状态走到最终实现，每一步都可验证。**

三条实测事实决定了整个计划的形状（全部来自调研 §2，2026-09-27 重新测量）：

| 事实 | 数字 | 对计划的影响 |
|---|---|---|
| 业务逻辑**已经零重复** | `domain` 6,535 行 + `app-host` 4,592 行，各端共用 | 收敛的目标**只有 UI 层**，不碰逻辑 |
| UI 是唯一重复 | web `features` **12,277 行** vs mobile `screens` **3,661 行** | 主体工作量在这里 |
| 移动端缺 67% 的特性 | web 有而 mobile **完全没有**的合计 **8,227 行** | **这笔代码迟早要写**，收敛是把"写两遍"变成"写一遍" |

**因此本计划的最高优先级不是"加新端"，而是"停止写两遍"。**

---

## 1. 阶段总览

| 阶段 | 目标 | 交付判据（可验证） | 前置 |
|---|---|---|---|
| **M0** ✅ **已完成** | 共享展示层补完 | ✅ 取值只有一份（`category-colors` **3 份 → 1 份**）；✅ 门禁拦住回潮（两条新规则，**各自证伪过**） | 无 |
| **M1** | 🔴 垂直切片验证 | **一份** RN 组件在 web + mobile + 桌面三端都渲染出来 | M0 |
| **M2** | 桌面端骨架（Electron） | 桌面端跑通真实同步，煞有记录 | M1 |
| **M3** | 逐特性迁移 UI | 每个特性两端共用同一组件；旧 DOM 实现删除 | M2 |
| **M4** | 数据层统一（web SQLite） | ✅ **决策已落（ADR-0027）**；✅ **`SqliteWasmDriver` 已过同一套契约**；✅ **Worker 接缝已过同一套契约 + 真浏览器端到端**（M4-3a）；✅ **web 已切到 Worker 里的 SQLite，生产构建产出 worker+wasm**（M4-3b）；⬜ 删 IndexedDB 旧路径前的**真实旧库迁移验证**未做；⬜ "FTS5 在 web 可用"已实测**支持**但未接进检索功能 | M0（可与 M3 并行） |
| **M5** | 收敛收尾 + 门禁全端 | DOM UI 删除；门禁覆盖全端；文档固化 | M3、M4 |
| **M6** | 鸿蒙"跑起来" | 真机/模拟器启动成功 | 外部（模拟器镜像 + 签名） |

🔴 **M1 是成败点。** 它失败则 ADR-0024 需要重估（可能退化为"RN 覆盖移动端 + 桌面用 Web 壳"）。
**在 M1 通过之前，M3 不得大规模投入。**

---

## M0：共享展示层补完

### 目标

把 web 与 mobile **重复的、与渲染无关的**展示逻辑收进 `packages/`。
这一步**任何路线都要付**，即使后面推翻 ADR-0024 也不浪费。

### 判据

> ⚠️ **M0-2 执行后修正（原判据被证伪）**：原来写的是"同名文件归零"。
> 执行后确认那条**既不现实也不该做** —— 见 §5 的判定表：
> 同名剩余的是**按端 i18n key 的薄适配**（且 `due-display` 连算法都相同、
> 只是前缀不同），归零等于砍掉刻意的设计。改成下面三条**可验证**的：

1. 🔴 **同一个「事实」只有一份**（这是 M0 真正的判据，不是文件名）：
   任何**取值/阈值/分类**都不得在 `apps/*` 里被定义 —— 必须在 `packages/`。
   已验证：`CATEGORY_SLOT_TOKENS` 派生的槽位映射（M0-1）、
   `durationParts` 阈值、`CountdownUrgency`、`intensityLevel` 全部在 `packages/`。
2. **每条"只有一份"都要有能证伪的测试**：M0-1 已用注入漂移验证过
   （新测试红、旧测试仍绿）。
3. `check:layering` 新增一条规则：`apps/*` 不得再自定义类别颜色映射或热力色阶。
4. **M0-4（native 数字门禁）完成** —— 因为已实测 `check:design` 对 RN 数字失效。

### 任务

**M0-1 收敛 `category-colors.ts`（当前唯一同名重复）**

现状实测：`apps/web/src/lib/category-colors.ts` 69 行、`apps/mobile/src/lib/category-colors.ts` 64 行，
`cmp` 实测**内容不同**。mobile 那份的文件头注释要求它与
`packages/design-system` 的 `CATEGORY_SLOT_TOKENS` **逐项一致** —— 靠注释护栏。

- 读：`packages/design-system/src/` 中 `CATEGORY_SLOT_TOKENS` 的定义与
  `packages/design-system/tests/category-colors.spec.ts` 的断言
- 建：把派生映射移进 `packages/design-system`（它已经是类别色的单点）
- 改：两个 `apps/*/lib/category-colors.ts` 变为**薄再导出**，或直接删除并改调用点
- 验：`pnpm --filter @heyta/design-system test` + `pnpm check:design`

**M0-2 清点其余 mobile `lib/` 的归属**

mobile 侧现有：`category-display.ts`、`date.ts`、`due-display.ts`、`focus-display.ts`、
`focus-timer.ts`、`priority.ts`、`quick-dates.ts`、`recurrence-display.ts`、`use-today.ts`。

逐个判定三分类，**产出一张表写回本文件 §5**：

| 判定 | 处理 |
|---|---|
| 纯展示逻辑（无框架、无 DOM/RN API） | 移入 `packages/`，两端共用 |
| 依赖 `Intl` / 时区等平台差异 | 留外壳，但**契约进 packages** |
| 依赖 RN API（如 `use-today` 依赖 AppState） | 留外壳，标注为"平台 hook" |

**M0-3 ✅ 已完成 —— 补一条分层门禁**

- 改：`scripts/check-layering.mjs` 的 `RULES` 数组（第 9 条：`no-local-category-color-map`）
- 新规则：`apps/*` 中不得出现「槽位 / 热力」到颜色的映射字面量
- 🔴 **同时拦两种形态** —— 因为只按变量名拦是**可绕过的**：
  - (a) 具名映射（`SLOT_TOKENS = {…}` / `HEAT_VARS = […]`）
  - (b) **结构形态**（`{ 1: 'color.category-1', … }`）—— 变量名随便叫什么都拦得住
- ⚠️ 它**不拦**合法写法：`const SLOT_TOKENS = CATEGORY_SLOT_TOKEN_BY_SLOT`
  （`=` 后不是字面量 → 放行），也就是**从单点派生正是被鼓励的写法**
- 验（已做）：探针文件放三种形态（含**改名**成 `colors` 的那种），
  门禁报出 **3 处**、退出码 1；移除后恢复 `✅ 9 条规则 / 137 个文件` 通过

**M0-4 ✅ 已完成 —— 补 native 设计门禁（已实测的缺口，优先级高于 M0-3）**

> **结果**：`check-hardcoded.mjs` 新增第 6 类规则「裸 RN 尺度数字」。
>
> 属性集**刻意收窄**，这是量出来的取舍：窄集（`padding`/`margin`/`borderRadius`/
> `fontSize`/`gap`）全仓库 **6 处命中、全是真违规、零误报**；
> 宽集（再加 `opacity`/`width`/`height`/`top`…）**29 处命中，其中 16 处是 `opacity`**、
> 5 处 `minWidth`、8 处 `top`/`bottom` —— **大多是合法布局值**。
> 按本文件头「宁可少报，不可误报」只收窄集。顺带修掉 `ProfileScreen.tsx` 的 6 处
> （改用 `tokens['space.*']`）。
>
> **前后对照（同一个探针文件）**：补规则前**只报 1 处**（裸 hex）；
> 补规则后**报 4 处**（hex + `padding: 16` + `borderRadius: 12` + `fontSize: 15`）。
>
> **途中自己踩的坑（留档）**：第一版把零值交给 `MATCH_ALLOW` 处理，但本规则的
> `m[0]` 包含**属性名**（`"padding: 0"`），而 ALLOW 的 `/^0(px|rem|ms|s)?$/`
> 是针对**值**写的 → `apps/web/src/styles/app.css` 里 35 处 `padding: 0` / `margin: 0`
> **全部误报**。修法是让**正则本身不匹配零值**（`(?!0(?![.\d]))`），而不是放宽 ALLOW ——
> 放宽 ALLOW 正是本文件 16–19 行警告的"误报会训练人忽略门禁"。

`check:design` 对 RN 代码是**部分失效**的。2026-09-27 探针实测
（探针文件含 `color: '#2563EB'` + `padding: 16` + `borderRadius: 12` + `fontSize: 15`）：

| 规则 | 形态 | 对 RN 是否有效 |
|---|---|---|
| 裸 hex 颜色 | `#2563EB` | ✅ **有效** —— 但 4 处只报出这 1 处 |
| 裸 px 尺寸 | `16px` | ❌ **失效** —— RN 写 `padding: 16`（**无单位数字**） |
| 裸 ms/s 时长 | `300ms` | ❌ 失效（RN 写 `300`） |
| 裸 z-index | 数字 | ❌ 失效 |

**结论：颜色规则能迁移到 RN，尺寸 / 时长 / z-index 规则不能。**

- 改：`design-system/heyta/check-hardcoded.mjs`，为 RN 增一套**数字**规则
  （`StyleSheet.create` 里出现、且不在 token 表内的无单位数字即违规）
- 备选（子代理建议，**未核实**）：用 ESLint core 的 `no-restricted-syntax` 扩规则集，
  零新依赖 —— 但那是**另一套机制**，先评估再决定，别默认换工具
- 验：探针必须让门禁报出**全部 4 处**（当前只报 1 处）——
  这正是"门禁必须能被证伪"的用法

> 🔴 **为什么这条排在 M1 之前**：M1 一旦引入共享 RN 组件，而门禁又对 RN 的数字失效，
> 那么**新 UI 从第一天起就没有设计系统保护，而且不会有任何东西失败** ——
> 这与本计划 §2 门禁设计的前提直接冲突。

### 回退

M0 全部是**纯搬迁 + 再导出**，无行为改变。任一任务出问题可单独回退，互不依赖。

---

## M1：🔴 垂直切片验证（决定成败）

### 目标

用**一个真实特性**证明「一份 RN 组件，三端渲染」在 heyta 的版本组合下真的成立。

**切片选「任务列表」** —— web（`features/tasks`，585 行）与 mobile（`TasksScreen.tsx`，764 行）
**两端都有实现**，是最干净的对照实验。

### 要验证的四个未核实项（调研 §6.2 的 1/2/3）

| # | 问题 | 判据 |
|---|---|---|
| 1 | `react-native-web` 0.21.3 与 **RN 0.84.1 + React 19** 能否共存 | web 端构建通过且渲染出组件 |
| 2 | Metro / Vite 能否解析同一个 workspace 包 | 两端 import 同一个包名成功 |
| 3 | **`react-native` 实例不被复制两份** | 复用仓库已有门禁 `check:mobile-bundle`（`phase-2` §2.23 已因双 React 崩过一次） |
| 4 | 桌面端能否加载同一个 web 产物 | Electron 里渲染出同一组件 |

> 🔴 **第 3 条是本仓库的已知雷区**：`@heyta/i18n` 自带的 React 曾在 APK 里被打成**第二份**，
> 应用启动即崩 —— 这一条已经踩过，见 `phase-2-multi-platform.md` §2.23
> 新增 workspace 包**必须**跑 `check:mobile-bundle`。

### 任务

**M1-1 建 `packages/ui`**

- 建：`packages/ui/package.json`（`name: "@heyta/ui"`，`private`，`type: module`）
- 依赖：`react`、`react-native`（**peer，不锁死版本**）、`@heyta/design-system`、`@heyta/domain`
- **不要**在这一步引入任何样式库（ADR-0024 §2.4）
- 参照 `packages/app-host/package.json` 的 tsup 构建配置

**M1-2 实现 `TaskList` 组件**

- 建：`packages/ui/src/task-list/TaskList.tsx`
- 只用 RN 原语：`View` / `Text` / `Pressable` / `FlatList` / `StyleSheet`
- 样式值**全部**来自 `@heyta/design-system/native`，禁止字面量（`check:design` 会拦）
- 数据来自 `@heyta/app-host` 的既有 action，**不新增业务逻辑**（`check:layering` 会拦）

**M1-3 Web 端接入**

- 改：`apps/web/package.json` 加 `react-native-web@0.21.3`（**先登记许可证**，见 §4）
- 改：`apps/web/vite.config.ts` 加 `resolve.alias` 把 `react-native` 指向 `react-native-web`
- 验：`pnpm --filter @heyta/web build` 通过

**M1-4 Mobile 端接入 —— 当时：⚠️ 不能直接替换（实测结论）；现已补齐**

- 改：`apps/mobile` 用 `@heyta/ui` 的 `TaskList` 替换 `TasksScreen` 里的列表渲染
- 验：`pnpm --filter @heyta/mobile run build:android:debug` 出包

> 🔴 **实测结论：现有 `TaskList` 还不是 `TasksScreen` 的等价替换，直接换就是产品退化。**
> 逐行读过 `apps/mobile/src/screens/TasksScreen.tsx`（763 行）后，缺的是这些：
>
> | mobile 既有 | 共享 `TaskList` 当时的状态 |
> |---|---|
> | 截止徽章（图标 + 逾期变红 + 档位文案） | ❌ 无 |
> | 优先级徽章（数值枚举 → 文案与颜色） | ❌ 无 |
> | 重复规则标记（`repeatOf` + 规则串 → 句子） | ❌ 无 |
> | 尾部删除按钮（带无障碍名） | ❌ 无 |
> | **点行 = 打开详情**（不是切换完成） | ❌ 点行 = 切换完成 |
> | `busy` 置灰（防连点发两条变更） | ❌ 无 |
> | 全套 i18n 无障碍整句 | ❌ 只有裸标题 |
> | 扁平模式是**分节头与任务交错的混合列表** | ❌ 纯平列表 |
>
> **已经做的**：把 `TaskList` 扩成「**共享机制 + 宿主内容**」的插槽式组件
> （`renderMeta` / `renderTrailing` / `labels` / `onOpenTask` / `busyTaskId`），
> 于是上表里除最后一条外都有了归属：机制留在共享层（排序、行骨架、
> 44 触控区补偿、checkbox 的 role/state/busy、空态），
> 本地化内容由宿主注入（**必须整句**，所以 `labels` 每一项都是 `(row) => string`）。
>
> **这两步后来都补齐了**（见下面的「M1-4 mobile 替换已完成」）：
> 分节支持进了共享层，`TasksScreen` 的本地 `TaskRow` 已删除。
> 上面这张表的价值在于记录**当时判断"不能直接替换"的依据** ——
> 如果当时硬换，丢掉的就是这些能力，而且不会报错，只会静默少东西。
>
> ⚠️ 顺带记一个**刻意选择的默认值**：`onOpenTask` 没传时行体**不可点**，
> 而**不是**降级成"点行=切换完成"。后者会让"忘了传 onOpenTask"表现成
> **点一下就误完成一条任务** —— 那是语义上的破坏，宁可不可点。

### M1 徽章：图标必须**共享**，否则"一行长什么样"永远在四个端各一份

上面那张表里"截止 / 优先级 / 重复"三个徽章是**最后一类"必须共享"的东西**，
而它们卡在一个具体问题上：**共享层不能 import 任何一个平台专属的图标包**
（`lucide-react` 依赖 DOM，`lucide-react-native` 依赖 RN 原生视图）。第一版
的结论是"让宿主注入 `renderMeta`"，但那等于承认"一行长什么样"拆到了四个端。

**解法：把图标「数据」与「渲染」分开。**

| 层 | 谁提供 | 说明 |
|---|---|---|
| 图标**数据** | `lucide`（ISC，**零依赖**） | 它导出 `IconNode = [标签名, 属性][]`，是**框架无关**的 |
| 图标**渲染** | `packages/ui/src/icon/Icon.tsx` | 把数据喂给 `react-native-svg`，四端同一份源码 |

这同时满足了仓库既有的一条结论 —— `apps/mobile/src/ui/icons.tsx` 里写着
"**优先用 Lucide 而不是自己画**：ISC、周更、三端可用"。我们只是把消费点
从"各端各一个渲染包"换成了"共享层用数据包"，四个端的字形因此**不可能再漂移**。

于是 `TaskBadges` 的分工变成：

| 共享（有判断、有测试） | 宿主（本地化 / 业务） |
|---|---|
| 图标字形 | 截止文案（`t()`） |
| 图标与文字的间距、字号、对齐 | 优先级文案 |
| **逾期自动变红 + 换警告三角** | **优先级的颜色**（色槽由优先级数值决定） |
| 一个徽章都没有时返回 `null` | 重复规则的句子 |

为什么"逾期变红"留共享、"优先级颜色"给宿主：逾期是个**布尔语义**
（两个状态，且"逾期=危险色"是设计系统的规定）；优先级是**数据驱动**的
（各有各的色槽，映射属业务）。把后者定死等于把优先级色板焊死在共享包里。

**实测证据**（真实浏览器，`scripts/verify-universal-slice.sh`）：

```
✓ 徽章渲染出 SVG — 4 个 <svg>
✓ lucide 图标数据变成了真实几何 — 13 个 <path>
✓ 逾期用危险色、未逾期用弱色 — #dc2626 ≠ #94a3b8
✓ 逾期换了字形 — 警告三角 3 条 path vs 日历 5 条
✓ 逾期与未逾期两种文案都渲染到了
```

最后两条是刻意的：**只测颜色**会漏掉"逾期换字形"这条给色觉障碍用户的冗余信号；
**只测文案**则字形映射接错了也测不出来。

⚠️ 踩到并修掉的两个坑（都**不报根因**，值得记）：

1. 只把裸包名 `react-native-svg` 指到 `ReactNativeSVG.web.js` **不够** ——
   它内部 `export * from './elements'` 会解析到**原生** `elements.js`，
   一路拖进 `react-native/Libraries/...` 的 Flow 源码，报成
   `Expected ',', got '{' in codegenNativeComponent.js`。
   **那句报错和真正的根因毫无关系。** 修法是把 `.web.*` 排进
   `resolve.extensions` 的前面（见 `apps/web/vite.config.ts`）。
2. 切片种子里两条任务的截止时间**都设在过去**，于是"未逾期"那个分支
   **从来没被渲染过** —— 断言因此失败，看起来像配色接错了。
   **分支没被渲染到，等于那个分支不存在**，所以种子改成一过去一未来。

### M1-4 的分节支持已完成

`TaskList` 现在两种形态**互斥**（联合类型，而不是把 `tasks`/`sections` 都设成可选 ——
后者会让"两个都传"和"一个都没传"在类型上都合法，且只表现成一张空列表）。
分节形态下共享层负责**展平、跳空组、给稳定 key、行骨架**，
宿主只给 `renderSectionHeader`。空分组不产生标题这条从 mobile 手写的
`if (list.length === 0) return;` 提到了共享层，四个端不会各写一遍、也不会有人忘。

### M1-4 mobile 替换已完成（`TasksScreen`）

本地那个 150 行的 `TaskRow` **已删除**（连同新加的注释，文件 763 → 721 行，
+209 / −243）。`TasksScreen` 里 `<FlatList>`、`<Checkbox>`、`function TaskRow`
的残留**各 0 处**。

**但要注意：这个判据不能只看行数。** 一个文件少 42 行说明不了什么 ——
真正的产出是把**行机制**从"mobile 一份、web 另一份"变成了一份，
而 web 那份的代价要到 M3 才收回来。用行数衡量 M1-4 会得出误导性的结论
（和 M0 那条口径澄清是同一个道理）。

替换后 `TasksScreen` 只剩**属于本端的选择**：
哪几个分组、什么标题、什么图标、文案怎么说、优先级用哪个色槽。
其余（排序、行骨架、44 触控区补偿、checkbox 的 role/state/busy、
空组跳过、分节展平、重排稳定性）全在共享层。

**两个视图都改成了共享分节渲染，但语义刻意不同**：

| 视图 | 空分组 | 理由 |
|---|---|---|
| 按今天分组（逾期/今天/收集箱/已完成） | **跳过**（默认） | 一个写着"已完成 0"的标题是纯噪音 |
| 四象限矩阵 | **保留**（`keepEmptySections`） | 矩阵的价值就在于**四个格子同时在**；藏掉空格会让人以为那个象限不存在 |

这条差异原本是两处手写逻辑，现在是一条有名字、有测试的选项。

⚠️ 替换时抓到并修掉的一个**静默布局 bug**：共享 `TaskList` 第一版自带
`paddingHorizontal: screen.gutter`，在 web 切片上看完全正常 ——
但 mobile 的 `<Screen>` **已经**加了同样的 gutter，套上去就是**双倍缩进**。
症状只是"这一页比别的页窄一点"，不报错。已改为列表**不自带页面边距**
（页面边距属于宿主，它才知道自己有没有被别的容器包着）。

⚠️ 另记一个类型坑：分节数组的 `meta` 如果不显式标注类型，TS 会把每一项
各推一个具体类型（`{tone:'danger'} | {tone:undefined} | …`），而
`TaskSection<TMeta>` 要求**同一个 T**，于是整组赋值失败 —— 报错落在
`sections={...}` 那一行，看不出是"少了个类型标注"。而 `.map` 的回调
**只标注左边变量不够**，必须写回调的返回类型，否则 `icon` 被推成字面量
而不是 `IconName`，图标名拼错就**不会**在编译期报出来。

**M1-4 的前置结论（对 M3 投入决策有用）**

这次替换尝试回答了一个比"能不能渲"更贵的问题：**共享组件的替代成本有多大**。
答案是：**机制部分很便宜**（行骨架/排序/无障碍一次就能共享），
**内容部分本来就必须各端各写**（i18n 决定了这一点，而共享包不能引 i18n，
因为那会带进第二份 React）。真正卡住的是**列表结构本身**
（分节/分组/拖拽这些"列表的形状"），它属于机制，所以必须在共享层做一次
足够通用的设计，否则每个端都会各自长出形状不同的列表。

**M1-5 三端验证（本阶段的判据）—— 🔴 必须含鸿蒙**

- 建：`scripts/verify-universal-slice.sh`，一条命令跑完并输出判据
- 必须记录**实测输出**，不能只报"通过"

> 🔴 **为什么鸿蒙是这个切片的必选项，而不是可选项**：
> [ADR-0024](../adr/0024-desktop-shell-and-ui-convergence.md) §2.6 已一手核实
> **鸿蒙的第三方库适配层严重滞后**（`op-sqlite` 8.0.2 vs 仓库 18.2.5；
> `safe-area-context` 4.7.4 vs 5.5.2），而且是 **patch 模式**、不会自动跟上。
> 这造成一种**不对称**：
>
> - **Web / 桌面**：随时可以回退到现有 DOM 实现 → 试错成本**可逆**；
> - **鸿蒙**：如果现代导航 / 动画 / 存储基线在鸿蒙上跑不起来，那是**不可回退的架构约束** ——
>   它一旦成立，"一份 UI 代码库"的上限就被定死了。
>
> 所以**必须在投入任何大规模 UI 迁移之前**让鸿蒙在场并给出结论。
> 一个只跑通 web + iOS/Android 的切片，**不足以**支撑 M3 的投入决策。
>
> 🔴 **"鸿蒙在场"要验的核心一条是存储，不是"App 能启动"。**
> `@react-native-oh-tpl/op-sqlite` 是 **8.0.2**，而仓库用 `@op-engineering/op-sqlite@^18.2.5`
> （**差 10 个大版本**）。要验的是**这个版本 + Hermes 能不能真的打开既有加密库并读写**。
> 两条**互相独立**的调研都命中了这一条：本仓 [ADR-0024](../adr/0024-desktop-shell-and-ui-convergence.md) §2.6，
> 以及本次[选型调研](../research/multi-platform-selection-evidence.md) §9 的移动壳线 ——
> 后者在不知道前者的前提下，把"RNOH 0.84.4 上 `op-sqlite` + Hermes 兼容性"
> 独立标为鸿蒙壳的**最大风险**。
> → 所以 M1-5 的鸿蒙判据**必须包含一次真实的"打开库 + 读 + 写"**，
> 只报"App 启动成功"**不算过**。

### 验收命令

```bash
pnpm install --frozen-lockfile        # 锁文件一致
pnpm -r typecheck
pnpm check:licenses                   # 新依赖已登记
pnpm check:design                     # 无硬编码设计值
pnpm check:layering                   # 无业务逻辑进 apps
pnpm check:mobile-bundle              # 🔴 无第二份 React
pnpm check
```

### 回退

M1 是**独立分支上的实验**。若 `react-native-web` 与 RN 0.84.1 不兼容，
结论写回 ADR-0024（状态改「已废弃」或「已取代」），回到"双 UI + 桌面 Web 壳"的方案 B'。

---

## M2：桌面端骨架（Electron）

### 目标

Windows / macOS / Linux 三平台各出一个能跑起真实同步的桌面应用，
**存储复用已有实现，不新写引擎**。

### ✅ 已完成的部分（2026-09-27）

> 骨架已落地并验证，操作细节见 **[桌面端操作手册](../runbooks/desktop.md)**。
> 一句话结论：**Spike S1 的答案是"主进程持库"，而且 `@heyta/node-host` 与
> `NodeSqliteDriver` 一行都没改就被复用了。**

| 项 | 状态 | 证据 |
|---|---|---|
| Spike S1（`node:sqlite` 能不能用） | ✅ **已答**：主进程持库 | 渲染进程被 sandbox 隔离本就不该碰文件系统；主进程是 Node，`DatabaseSync` 同步，与既有驱动接口相容 |
| Spike S2（`check:design` 范围） | ✅ **已加** `apps/desktop/src` | `check:design` 通过 |
| M2-1 依赖登记 | ✅ `electron@44.4.5`（MIT） | `check:licenses` 通过（白名单内，**自动**登记，无需手工） |
| M2-2 建桌面壳工程 | ✅ **已完成**（渲染页仍是占位） | `build` 出 `main.cjs` + `preload.cjs`；`typecheck` 通过；11 个测试通过 |
| **M2-2b 桌面端渲染进程 + GUI 冒烟** | ✅ **已完成**（本轮）—— 同时关掉 **M1 判据第 4 条** | `e2e/tests/desktop-window.spec.ts` 通过；截图见 `e2e/test-results/desktop-window.png` |
| **Windows 真机验证** | ✅ **已实测**（2026-09-27） | 在 `windows-pc` 上 `pnpm -r build` **exit 0**、桌面端产物**字节级一致**、**11/11 测试通过**。详见 [桌面端手册](../runbooks/desktop.md) §5.2 |
| M2-3 跑通真实同步 | ✅ **已完成并实测**（本轮） | **三端全链路通过（18/18）**：Web（真浏览器）↔ 服务端（真 Postgres）↔ 笔记本（真 SQLite、**另一个 clientId**），第 3 相是**全新浏览器上下文（空 IndexedDB）**把两台设备的数据全拉回来。命令 `pnpm verify:multi-end`，前置见 [本地验证手册](../runbooks/local-server-verification.md)。⚠️ 过程中修掉一个**让整个脚本从没真正跑起来过**的 bug，见下 |
| M2-4 三平台产包 + 签名 | 🟡 **三平台产包 ✅，桌面签名未做** | `@electron/packager`（BSD-2-Clause）；`release/heyta-{darwin-arm64,win32-x64,linux-x64}` 三份都产出（本轮复测 ✅）。**macOS 包已实测启动 + 截图**（`e2e/tests/desktop-window.spec.ts` 的"打包产物"用例）。⚠️ Windows / Linux 产物**未在对应系统上运行验证过**；桌面端安装器 / 签名 / 公证 / 自动更新**一律未做**（缺证书）。详见 [`runbooks/desktop.md` §4.3](../runbooks/desktop.md) |
| **Android release AAB + 发布签名** | ✅ **已完成并实测**（本轮） | `./gradlew bundleRelease` → `BUILD SUCCESSFUL`，44 MB AAB。**签名接线已用真 keystore 验证换掉了签名者**。⚠️ 上架用的正式 keystore 仍需自备（见 [多平台构建手册](../runbooks/multi-platform-build.md) §1.5）。**过程中发现 release 打包一直是坏的** —— 见下 |

### 🔴 Android release 打包从没跑通过（2026-09-28 修）

真机跑 `bundleRelease` 才暴露：`@sqlite.org/sqlite-wasm` 被打进了 **Android** bundle，
它的 Emscripten 胶水层用 `import.meta.url`，而 **Hermes 不支持**：

```
error: 'import.meta' is currently unsupported   （4 处）
> Task :app:createBundleReleaseJsAndAssets FAILED
```

起因是 `packages/storage` **主入口**导出了 Web 的 `SqliteWasmDriver`。
那里的注释写着"它用的是**动态 import**，所以不会让别的打包目标背上那 852 KB"
—— **那个判断是错的**：它只对会做代码分割的打包器成立，
**Metro 不做代码分割**，动态 `import()` 照样内联。

**两个可复用的结论**：

1. **"动态 import" 不是隔离手段，子路径导出才是。**
   本文件里 `NodeSqliteDriver` 早就是这个做法，只是当时没推广到 wasm。
2. **这一类缺陷只在 release 现形** —— debug 不跑 Hermes 字节码编译，所以 debug 一直是好的。
   ⇒ **release 构建必须真的跑**，`pnpm check` 全绿不能替代它。

已把 `import.meta` 加进 `check-mobile-bundle.mjs`（它本来就会真打两个包的产物），
**并已验证它会红**（注入回原缺陷 → 报 4 次，与 hermesc 的错误数吻合）。

⚠️ **环境**：JDK 24 会在 `op-sqlite` 的 CMake 配置上失败，必须用 **JDK 17**。

### 🔴 三端同步验收「一直在跑」，其实从没跑到过第 1 步（2026-09-28 修）

`scripts/verify-multi-end-sync.sh` 的头注释写得很到位（"只测一端等于没测"、
"界面说已同步在上传被拒收时同样会出现"），但**它自己没能跑起来**：

```
scripts/lib/mobile-e2e-fresh-account.sh: line 81: email�: unbound variable
```

第 81 行是 `echo "✅ 全新账号：$email（令牌 ${#token} 字符）"`。
bash **把紧跟 `$email` 的全角括号首字节算进了变量名**。全仓 **172 处**、
18 个验收脚本都有这个写法（见 `5599141`）。

**教训（比 bug 本身重要）**：这类写法**没有 `set -u` 时不会报错**，
只是把值打印成乱码 —— 脚本"照常通过"，**证据是错的**。
对一份以实测输出为证据的验收脚本，这比崩溃更危险：崩溃你看得见，乱码你不看。
已加 `check:shell-unicode` 常驻护栏。

### ⚠️ 跑三端验收的两个前置（都会伪装成"产品缺陷"）

| 前置 | 少了会怎样 |
|---|---|
| 服务端必须放行 web 端口：`CORS_ORIGINS=http://127.0.0.1:4328` | 状态条显示「离线 · 改动已排队」，**服务端日志里一条请求都没有** —— 看着像网络问题，其实请求没发出去 |
| 服务端要连 `heyta_mobile_smoke`，且以 `TEST_MODE` 跑（`/api/test/create-user` 只在 TEST_MODE 挂载） | 建号失败 |

好消息：脚本的**前置检查**把这两条都拦下来了，并直接给出修法。

⚠️ **不要在被测应用正在被编辑时跑它**：`webServer` 是 Vite dev，
任何 `apps/web` 改动都会通过 HMR 推给正在跑的页面；
Zustand store 被热替换会**重置回 `idle`**，表现为"已同步 → 未同步"的假红。

**🔴 与计划原文不同的一处改动（架构上更好，值得记）**：

计划原写"主进程加载 `apps/web` 的静态构建产物"。实测后**没有那样做** ——
因为那会让桌面端变成"web 的皮"，而 ADR-0024 §2.6 已确认 web 侧要
**保留 DOM 实现、逐组件接入共享 UI**。现在桌面壳是 `@heyta/node-host` 的用户，
**完全不依赖 web 产物**，所以 web 怎么演进都不会把它绑住。

**"复用而非复制"是被机器钉住的，不是靠读代码**：
`apps/desktop/tests/reuse.spec.ts` 断言桌面壳的**依赖面** ——
只允许 `electron` / `node:*` / `@heyta/node-host`，且运行时依赖**恰好一个**。
已做注入违规的证伪（注入 `@heyta/domain` 后 **2 条测试同时变红**）。

### 🔴 先做 spike（这是 M2 的门槛，不是可选步骤）

**Spike S1：`node:sqlite` 在 Electron 渲染进程里能用吗？**

- 若**能用** → 渲染进程直接 `new NodeSqliteDriver(path)`，接线最简单
- 若**不能用** → 走退路：主进程持库，preload 用 `ipcRenderer.sendSync`
  包一层自定义函数暴露给渲染进程（Electron **有**同步 IPC，Tauri 没有）
- **无论哪条路都必须实测记录**，因为 ADR-0024 §5 把它列为未核实项

> ⚠️ Electron 官方文档注明：**>=29.0.0 `ipcRenderer` 不能再经 `contextBridge` 直接暴露**，
> 必须在 preload 里包一层。这是已知模式，不是拦路石。

**Spike S2：桌面端 `check:design` 扫描范围**

- 改：`design-system/heyta/check-hardcoded.mjs` 的 `ROOTS` 数组
- 现状已含 `apps/web/src`、`apps/mobile/src`、`apps/landing/src`；**加上桌面壳目录**
- 不加这一条，设计系统在桌面端**形同虚设**

### 任务

**M2-1 依赖登记（🔴 仓库硬规则：未登记不得引入）**

- 改：`research/licenses-inventory.generated.md`（由 `node research/tools/license-inventory.mjs` 生成）
- 登记：`electron`（MIT）、以及 M1 引入的 `react-native-web`（MIT）
- 验：`pnpm check:licenses` 退出 0

**M2-2 建桌面壳工程**

- 建：`apps/desktop/`（`package.json` + `main.ts` + `preload.ts`）
- 主进程加载 `apps/web` 的**静态构建产物**
- 存储按 Spike S1 的结论接线

**M2-3 跑通真实同步（不是 mock）**

- 参照 [本地验证手册](../runbooks/local-server-verification.md) 起真实服务端
- 判据：桌面端写入 → 另一端（web 或 mobile）同步可见
- 必须留证据：截图 / 日志 / 数据库文件路径

**M2-4 桌面端构建与交付文档**

- 改：[构建矩阵](../reference/build-matrix.md) §7 一页速查，加桌面端三行
- 改：`apps/desktop/package.json` 加 `build:win` / `build:mac` / `build:linux`
- ⚠️ **签名与公证未调研**（ADR-0024 §5）—— 本阶段只做到**未签名产包**，
  并像 Android 那样如实标注"可测试、不可分发"

### 回退

Electron 壳与自己打包的静态产物是**松耦合**的：即使 UI 收敛中途停住，
桌面端依然能用现在的 DOM 版 web 产物 —— **桌面端不等 M3**。

### 🔗 与小组件计划的关系：PWA 是另一条不能忽略的路

[多端小组件改造计划](multi-platform-widgets.md) §3.1–§3.2 有两条与本阶段直接相关的结论，
**必须一起读，否则两个计划会各说各话**：

| 平台 | 组件路径 | 要桌面壳吗 | 🔴 不能省略的前提与代价 |
|---|---|---|---|
| **Windows** | **PWA widget provider** | **不需要**（确实不需要写 C++/C#） | 但 **PWA 仍必须 MSIX 打包** —— package identity 是注册组件 appExtension 的硬前提；PWA 必须能从**公网 endpoint** 安装（PWABuilder 不支持 localhost）；⚠️ **"只在 Edge 里安装、不上 Store"到底行不行，无一手定论**（官方成文路径只有 PWABuilder→Store；2023 年有"5 台机器仅 1 台出现"的反面记录）→ **这是唯一可能推翻整条路的单点，必须实测** |
| **macOS** | **Continuity**（iPhone 组件上 Mac） | **不需要 Mac 壳** | 但**需要 iPhone 上装着带 WidgetKit 扩展的原生 App** —— 它是 **iOS 组件工作的副产品，不是独立路径**；**交互在 iPhone 上执行**（Mac 只是显示器 + 转发器）；🔴 且与"iOS 锁屏隐藏内容"（给扩展加 Data Protection capability 设 `NSFileProtectionComplete`）**互斥，二者只能选一** |
| macOS / Windows（**原生**组件，后置） | WidgetKit / Windows App SDK + MSIX | ✅ 要，**这正是本阶段的壳** | ⚠️ **Electron 在两端都是组件最差项**：上游 `electron#35751`「macOS Notification Center Widget」**Closed as not planned**；electron-builder 官方称它「**never re-signs** `Contents/PlugIns`」→ 自嵌 `.appex` 要自己写全套签名钩子，且**无真实 Electron 应用带 WidgetKit 组件的先例** |

**因此本阶段的定位要说清**：Electron 壳**不是**"Windows/macOS 上有组件"的前提
（那两条不依赖壳，但**各有前提，见上表**），而是**"这两个平台上有真正的桌面应用"**的前提 ——
即**原生 SQLite、脱离浏览器窗口、可离线长驻**。

**顺带一个组合效应**：M4 若把 web 换上 SQLite（sqlite-wasm + OPFS），
那么**PWA 也就有了本地 SQLite**，PWA 与 Electron 的差距会缩小到
"是否需要原生文件/托盘/自动更新"。**这个组合效应值得在 M4 的 ADR 里一并考虑**，
但**不要**据此跳过 M2 —— PWA 装不进 MSIX 生态，也拿不到原生 sqlite 的性能。

> 🔴 **这条的完整论证见** `../research/multi-platform-selection-evidence.md` §10.3
> （那份文档已与 ADR-0024 对账，明确指出：Electron 路线下 PWA 化的**价值上升而非下降**，
> 且 `apps/web` 现在**不是** PWA —— 无 manifest、无 service worker、无图标、无插件，已实测）。

---

## M3：逐特性迁移 UI（主体工作量）

### 目标

把 web 的 **12,277 行** DOM/CSS UI **逐特性**迁到 RN 原语，每迁一个，
两端（web + mobile）立刻共用同一份，并**删除旧实现**。

### 迁移顺序（按"移动端是否已有对应"排序）

**第一组：移动端已有对应 → 收益最快、风险最低**

| 顺序 | 特性 | web 行数 | mobile 对照 |
|---|---|---|---|
| 1 | `tasks` | 585 | `TasksScreen` 764 + `TaskDetailSheet` 562 |
| 2 | `focus` | 536 | `FocusScreen` 427 |
| 3 | `categories` | 431 | `CategoriesScreen` 365 |
| 4 | `sync` | 978 | `ConflictSheet` 279 |
| 5 | `settings` | 1,978 | `ProfileScreen` 386 |

**第二组：移动端完全没有 → 迁完即"移动端免费获得 8,227 行特性"**

| 顺序 | 特性 | web 行数 |
|---|---|---|
| 6 | `capture` | 277 |
| 7 | `projects` | 341 |
| 8 | `quadrant` | 317 |
| 9 | `habits` | 577 |
| 10 | `motivation` | 1,090 |
| 11 | `timeline` | 1,483 |
| 12 | `ai` | 3,207 |

> 💡 **与小组件计划的接口：投影层只定义一次（别让组件计划长出第二套"怎么算今日"）。**
> 第二组里的 `quadrant` / `habits` / `timeline` / `motivation`，正是
> [小组件计划](multi-platform-widgets.md)要展示的**同一批派生视图**（今日任务、四象限、习惯热力）。
> **"怎么算今日 / 怎么算四象限"只能有一份实现** —— 否则 M3 迁完 UI 之后，
> 组件会长出第二套投影，重复 M0 刚刚证明"不该做"的那种**静默漂移**
> （改一处**不会让任何测试变红**，正是 M0-1 的教训）。
> → 投影层归本计划的共享层（`packages/`），由小组件计划的 `packages/widget-core`
> **消费**它，而不是各自实现一遍。

### 每轮的固定流程（不许跳步）

1. 在 `packages/ui` 用 RN 原语实现该特性
2. web 端切换过去，**删除对应的 `apps/web/src/features/<name>/` DOM 实现**
3. mobile 端切换过去
4. 把该特性的测试迁到只写一份
5. 跑 `pnpm check`
6. **记录该轮的行数变化**到 §5 的进度表

### 判据（每轮）

- 该特性在 `apps/web` 与 `apps/mobile` 下**不再各有一份实现**
- 两端都能跑（web 构建 + Android debug 出包）
- `pnpm check` 退出 0
- 净行数**下降**（这是本计划的核心指标，必须持续为负）

### 🔴 已知会卡住的地方

| 难点 | 现状 | 需要替代方案 |
|---|---|---|
| 拖拽排序 | `@dnd-kit/*`（DOM 专用） | RN 侧 gesture-handler / reanimated，**需调研** |
| 甘特图 | `features/timeline` 1,483 行 | RN SVG（`react-native-svg` 已在用） |
| 热力图 | `react-activity-calendar` | RN SVG 自绘 |
| 富交互 | hover / `:focus-visible` / `contextmenu` | RN 无对应，**需要交互降级设计** |

> ⚠️ 最后一行是**产品问题不是技术问题**：桌面/Web 的鼠标悬停、右键菜单在 RN 原语下
> 需要显式设计。**不要假装它能免费得到。**

### 回退

每轮**独立可回退**（一个特性一个提交）。迁移期间两套 UI 并存，
必须保持 `pnpm check` 全绿，否则会停在中途。

---

## M4：数据层统一（可与 M3 并行）

### 目标

让三端**真正共用一套存储契约**，而不是"两种存储 + 一种检索能力"。

### 为什么这是独立一条线（来自调研 §3.7）

既有实测已判定：**「三端一套 SQL」这个前提不成立** —— 浏览器端是 IndexedDB，**没有 SQL**。
后果不是"性能差一点"，而是：

- **FTS5 检索在 web 上永远用不了**
- AI 记忆检索**天然只有 2/3 端可复用**（`research/ai-memory-db-2026-09.md` 的实测结论）

关键区分（容易搞混）：

> **不能用 WASM 的是 Hermes（移动端）**，而移动端本来就有**原生** SQLite（op-sqlite 且已带 FTS5）。
> **浏览器是能吃 WASM 的。**

### 任务

**M4-1 决策（先写 ADR，再动手）** ✅ **已完成**

- 建：新 ADR「客户端存储统一 = SQLite」→ [**ADR-0027**](../adr/0027-unified-client-storage-sqlite-everywhere.md)
- 选项：web 用 `@sqlite.org/sqlite-wasm`（实测 **3.53.4-build1，Apache-2.0，0 依赖**）+ OPFS
- 写明**不做的代价**（web 永远没有本地检索）与**做的代价**（WASM 体积、OPFS 兼容面）
- 🔴 ADR 里记了一条**决定性的**一手事实：`installOpfsSAHPoolVfs()` 异步，
  但它产出的 `OpfsSAHPoolDb` 继承 `oo1.DB`、方法是**同步**的 ——
  所以 `SqliteDriver` 的同步接口不用改。**搞反这一点会让三端一起改成 async。**

**M4-2 实现 `SqliteWasmDriver`** ✅ **已完成**

- 建：`packages/storage/src/sqlite/sqlite-wasm-driver.ts`
- 驱动本体与 OPFS **解耦**（构造只收一个已打开的 `oo1.DB`），因此
  **映射逻辑能在 Node 里用内存库测**，OPFS 接入留给真浏览器
- `SqliteAdapter` **一行不改** —— 这正是窄接口的价值
- 验：`packages/storage/tests/contract.spec.ts` 各加一行 → **262 个测试全过**，
  含 `SqliteWasmDriver` 的 DbAdapter 契约与 OpLogStore 契约
- 验（**真浏览器**）：`node scripts/verify-web-sqlite.mjs` → 全绿，
  含**刷新页面后数据仍在**（OPFS 真的落盘）、唯一冲突判定、`close()` 幂等
- 🔴 截图：`e2e/test-results/web-sqlite-opfs.png`（AGENTS.md §6.2 硬性规定）

**M4-2b 真浏览器验证暴露的关键约束** ✅ **已查明并落 ADR**

真浏览器跑出来两件 **Node 侧永远测不到** 的事，各写进一份记录：

1. **Vite 的 dep 预打包会破坏 wasm**：报 `Incorrect response MIME type` + 魔数变成
   `<!do`（即拿到了 index.html）。修法是 `optimizeDeps.exclude: ['@sqlite.org/sqlite-wasm']`。
   ⚠️ 与 `react-native-svg` 是**同一类**坑：**预打包会破坏"按相对路径找自身资源"的包**。
2. 🔴 **`openSqliteWasmDriver` 必须跑在 DedicatedWorker 里** →
   [**ADR-0028**](../adr/0028-web-sqlite-must-run-in-worker.md)。
   主线程上 `FileSystemFileHandle.prototype.createSyncAccessHandle` 是 `undefined`
   （规范 `[Exposed=DedicatedWorker]`），必然报 `Missing required OPFS APIs.`；
   Worker 里同一项是 `function`，一次通过。
   附带纠正：SAH Pool **不需要 COOP/COEP**（`SharedArrayBuffer` 为 `undefined` 也跑通），
   ADR-0027 §6.1 把这项代价写大了。
3. ⚠️ 顺带记下：**Chromium 里 FTS5 是可用的**（探针实测，仅记录、不当成三端前提）。

> 🔴 **鸿蒙的存储基线必须先查清，否则 M4 会做出一个只有两端的结论**：
> [ADR-0024](../adr/0024-desktop-shell-and-ui-convergence.md) §2.6 已**一手核实** ——
> 鸿蒙适配版 `@react-native-oh-tpl/op-sqlite` 是 **8.0.2**，而仓库用的是
> `@op-engineering/op-sqlite@^18.2.5`（**差 10 个大版本**）。
> 既有调研称「`op-sqlite` 已内置 FTS5 与 sqlite-vec」——
> **该结论是否覆盖 8.0.2 未核实**。
>
> 因此 M4 **不得**把 FTS5 / sqlite-vec 当作鸿蒙端已具备的能力：
> 要么在鸿蒙上实测，要么在文档里**把鸿蒙显式排除在该能力之外**。
> 这正是 M1 要求"鸿蒙在场"的同一个理由 —— 它是唯一不可回退的那一端。

**M4-3 迁移 web 存储并删掉 IndexedDB 路径**

- ⚠️ **这是数据迁移**，需要一次性把用户既有 IndexedDB 数据导入 SQLite
- 参照 [迁移纪律](../../AGENTS.md)：不可逆层优先干净
- 判据：契约测试三端同一套；FTS5 检索在 web 可用

#### M4-3a 接缝 ✅ **已完成并端到端验证**（commit `a453dff`）

**边界画在 `OpLogStore`，不画在 `DbAdapter`** —— 这是本步唯一的关键决定：

`DbAdapter.transaction()` **接收回调**，而回调无法跨 Worker 序列化。画在 `DbAdapter`
就得把一次原子事务拆成一串请求发过去，**等于把原子性拆掉**。所以
`SqliteAdapter` 与 `DbOpLogStore` 都在 Worker 里，主线程只拿 `OpLogStore` 代理。

`DbAdapter` 的接口**本来就是全异步的**，所以这条接缝**没改任何接口** ——
主线程代理与 `IndexedDbOpLogStore` 完全同型，切换是"换实现"而不是"改架构"。

证据（✅实测）：

| 验证 | 命令 | 结果 |
|---|---|---|
| 桥接过**同一套** `OpLogStore` 契约 | `pnpm --filter @heyta/storage test` | **288 passed**（+26） |
| 真浏览器端到端（真 schema + 真桥接 + 跨刷新） | `node scripts/verify-web-sqlite.mjs` | **EXIT=0，13 项全过** |
| 截图（已亲眼看过，非白屏） | 同上 | `e2e/test-results/web-sqlite-opfs.png` |
| 全门禁 | `pnpm check` | **EXIT=0，26 passed** |

契约用的端口是**进程内假端口**，投递走 `queueMicrotask`（与真实 `postMessage`
一样是异步的）—— 这样"假设响应同步到达"这类错会当场暴露。

🔴 **本步踩出来的两条约束**（都已写进代码注释，Node 侧永远验不出来）：

1. **`driverFactory` 是同步的，而装 VFS 是异步的。**
   异步的只有"装池"且每个 origin 只装一次；池装好后 `new pool.OpfsSAHPoolDb(name)`
   是同步的。所以有 `createOpfsSahPoolDriverFactory()` 把异步边界提前吃掉。
2. **同名 VFS 会互抢句柄**（`NoModificationAllowedError`）。因为 VFS 名决定 OPFS 目录名。
   ⇒ **一个页面只应有一个存储 Worker**；**每个独立数据库家族要有自己的 `vfsName`**。

#### M4-3b 切换 `apps/web/src/lib/oplog.ts` ✅ **已完成并端到端验证**

`apps/web` 的存储默认走 **Worker 里的 SQLite**；`indexeddb` 保留为回退开关
（`VITE_HEYTA_STORAGE=indexeddb`），到迁移被验证通过之后再删。

**切换本身能成立，靠的是 `OpLogStore` 同型**：`requireStore()` 的返回类型从
`IndexedDbOpLogStore` 放宽到 `OpLogStore`，**其余代码一行没改**。

证据（✅实测）：

| 验证 | 命令 | 结果 |
|---|---|---|
| 真的在用 SQLite（**不是静默回退**） | `pnpm check:web-storage` | **EXIT=0**，三条证据一致 |
| 应用级 e2e（含"刷新后仍在"） | `pnpm check` | **26 passed** |
| 生产构建产出 worker + wasm | `pnpm --filter @heyta/web exec vite build` | `storage.worker-*.js` + `sqlite3-*.wasm`（852K / gzip 403K） |
| 全门禁 | `pnpm check` | **EXIT=0** |

🔴 **为什么不满足于"e2e 全绿"**：**两条路径都能让 e2e 全绿**。
静默回退到 IndexedDB 时一切看起来都正常 —— 所以新增了
`scripts/verify-web-storage-backend.mjs`，靠**三条互相独立的证据**：
应用自报 `window.__heytaStorage.backend`、OPFS 里确实有 `.heyta-web` 目录、
以及**旧 IndexedDB 侧查得清楚且为 0 条**（证明数据没有分叉到两条路）。
它已接进 `pnpm check`，不会再无声地退回去。

🔴 **本步踩出来的两个坑**（都是"dev 过、别的场景不过"）：

1. **`worker.format` 默认 `iife`，而存储 Worker 会代码分割** → 生产构建直接失败
   （`Invalid value "iife" ... not supported for code-splitting builds`），
   **dev 完全正常**。必须设 `worker: { format: 'es' }`，且调用侧要 `{ type: 'module' }`。
2. **`build` 里也必须排除 `@sqlite.org/sqlite-wasm` 的预打包** ——
   与探针里那次同源：esbuild 预打包会破坏"运行时按相对路径找自身资源"的包。
   这已是同一根因的**第三次**发作。

#### 旧库迁移 ✅ **已用真实旧库验证**

`migrateLegacyIndexedDb()`：SQLite 为空 **且** 旧库有 op 时一次性导入，
用 `appendImported`（不是 `appendLocal` —— 这些 op 不是本机新写的，
伪装成"刚产生"会让同步层判错因果），**不删旧库**（迁移期要能回退），
失败**不阻断启动**（否则用户连导出入口都没有）。

🔴 **造"真实旧库"的方式本身就是这条验证的关键**：
`scripts/verify-web-migration.mjs` **不让脚本照 schema 手搓数据** ——
那样验的是"我理解的旧库"，而不是"应用真的会写出的旧库"，二者不一致时
测试照样绿而用户数据照样丢。它改成两段式：先用 `VITE_HEYTA_STORAGE=indexeddb`
起服务让**应用自己**按旧路径写，再切回 `sqlite` 在**同一个 browser context** 里刷新。

| 断言 | 结果 |
|---|---|
| 第 1 段确实走 indexeddb，写进 3 条，独立数旧库也是 3 | ✅ |
| 第 2 段确实走 sqlite，**3 条全部出现且内容正确** | ✅ |
| 旧库**没有被删**（迁移期可回退） | ✅ |
| **再刷一次不翻倍**（幂等）—— 判据写松一点就会变成自我复制的数据源 | ✅ |

⚠️ **还没删 IndexedDB 路径。** 迁移已验证，但删旧路径是不可逆动作，
应在至少一个版本周期后再做。

### 回退

IndexedDB 路径**保留到迁移验证通过之后**再删。两者可并存一个版本周期。

---

## M5：收敛收尾 + 门禁全端

### 任务

1. 删除 `apps/web/src/features/` 下所有残留 DOM 实现
2. 删除 `apps/web/src/lib/` 下的重复 helper（M0 之后应已只剩薄导出）
3. **门禁全端覆盖**：
   - `check:design` 扫 `packages/ui` + 所有 `apps/*`
   - `check:layering` 覆盖新端
   - 新增一条：`apps/*` 不得直接 `import` `react-native-web`（只能经 `packages/ui`）
4. **文档固化**：
   - [构建矩阵](../reference/build-matrix.md) 补桌面端与"一套代码"的渲染路径说明
   - [多端构建手册](../runbooks/multi-platform-build.md) 补桌面端构建与验证
   - `AGENTS.md` §6.1 多端构建 —— 把桌面端补进构建入口

### 判据

- `pnpm check` 全绿
- `apps/web/src` 行数**显著低于**今天的 13,814（目标：UI 只剩接线）
- 同一个 UI 文件被 web / mobile / desktop **三端同时引用**（可用脚本证明）

---

## M6：鸿蒙"跑起来"（外部依赖）

### 现状（实测）

出包**已完成**：`pnpm verify:harmony-toolchain` / `verify:harmony-rnoh` / `verify:harmony-rnoh-js`
三条判据脚本能出 HAP（release 20 MB / debug 37 MB）。

**缺的三样都不是写代码能补的**：

| 缺什么 | 说明 |
|---|---|
| 模拟器系统镜像 | 本机 `~/.Huawei` 不存在 |
| 签名 | 产物是 `*-unsigned.hap`（`signingConfigs: []`，装不进任何设备） |
| 真机或模拟器 | — |

**因此 M6 不排期**，只在具备条件时执行。ADR-0024 不依赖 M6。

---

## 2. 门禁设计（本计划的一部分，不是附加项）

调研 §2.7 的结论：**注释挡不住漂移**，这个仓库已经用 6 次真实事故证明过。
因此每一阶段都必须配门禁：

| 门禁 | 现状 | 本计划要做的 |
|---|---|---|
| `check:layering` | ✅ **9 条规则**（M0-3 补了色槽映射那条） | M5 覆盖新端 |
| `check:design` | ✅ 扫 web/mobile/landing/**desktop/src**/**desktop/renderer**/**packages/ui**，**6 类规则**（M0-4 补了 RN 无单位数字；M2-2 加了桌面；M2-4 补了桌面渲染层 —— 补上时**当场抓出 6 处裸值**） | 新增平台壳时必须同步加 `SCAN_ROOTS` |
| `check:licenses` | ✅ 已有；`electron` 已自动登记（M2-1） | M1 登记 `react-native-web` |
| `check:mobile-bundle` | ✅ 已有（双 React 雷区） | M1-5 必须跑 |
| `check:native-deps` | ✅ 已有 | 新增原生模块时兜底 |
| **新增**：apps 不得直接依赖 `react-native-web` | ❌ | M5 加 |
| 🔴 **`check:widgets`** | ❌ **不存在** | 由[小组件计划](multi-platform-widgets.md) §2 拥有；理由见下 |

### 🔴 原生代码是现有门禁的盲区（实测，2026-09-27）

规则集里有一条 **`no-op-construction-in-apps`**（第 7 条）—— 它存在的理由就是"**别让外壳自己构造 op**"。
但**原生代码完全不在它的视野内**：

| 门禁 | 扫描范围（实测） | 原生代码（`.swift` / `.kt` / `.ets`） |
|---|---|---|
| `check:layering` | `EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts']`；`SKIP_DIRS` 含 **`ios`**、**`android`** | ❌ **全部跳过** |
| `check:design` | `SCAN_ROOTS` = 4 个 `src` 目录 | ❌ 窗口外 |
| `check:ui-language` | `ROOTS` = 3 个 `apps/*/src` | ❌ 窗口外 |

**后果**：一旦组件存在（iOS 的 `.appex`、Android 的 Kotlin、鸿蒙的 ArkTS），
**没有任何东西拦得住"组件直接构造一个 op"** —— 而"点一下勾选完成"恰好**就是**一次 op，
这正是组件最自然的实现方式，也是 `no-op-construction-in-apps` 当初被写出来的原因。

→ **`check:widgets` 至少要锁三件事**：① 各端解析器吃**同一份** golden fixture；
② 原生侧**不得构造 op**（意图只能进队列，由 `packages/app-host` 转换）；
③ 原生侧不得直接打开加密 DB。设计见[小组件计划](multi-platform-widgets.md) §2.4 与 §5。

---

## 3. 风险登记

| 风险 | 影响 | 应对 |
|---|---|---|
| 🔴 RNW 0.21.3 与 RN 0.84.1 不兼容 | M1 失败，ADR-0024 需重估 | M1 就是为验它而存在；退路是"双 UI + 桌面壳" |
| 🔴 **鸿蒙第三方库基线滞后**（`op-sqlite` 8.0.2 vs 仓库 18.2.5；`safe-area-context` 4.7.4 vs 5.5.2；**patch 模式**） | 鸿蒙上跑不起现代导航 / 存储基线 = **不可回退**的架构约束 | ADR-0024 §2.6 已**一手核实**；M1 **必须**让鸿蒙在场并给结论 |
| ⚠️ **DOM→RNW 重写无先例**，且 RNW 作者本人反对（**未独立核实**） | M3 可能付出巨大成本、却得到更差的 web 体验 | M3 **逐特性增量 + 每轮可回退**；web 保留 DOM 实现，**别名接入而非整体替换** |
| 🟢 **`check:design` 对 RN 数字失效**（实测：4 处硬编码只报 1 处） | ✅ **已缓解**（M0-4 补第 6 类规则；同一探针 1 处 → **4 处**） | 属性集刻意收窄，后续若发现漏网再量一次 |
| 🔴 迁移停在半途 | 两套 UI 长期并存，成本翻倍 | 每轮独立提交，`pnpm check` 全绿，净行数必须下降 |
| 🔴 `node:sqlite` 在 Electron 渲染进程不可用 | 桌面存储需绕路 | Spike S1 先验；退路是 `sendSync` + 主进程 |
| Electron 体积/内存 | 用户观感 | 明确接受（换存储正确性）；写入文档 |
| 桌面签名/公证成本未知 | 无法分发 | 本阶段只做未签名产包，**如实标注** |
| 🔴 **原生组件代码不在任何门禁覆盖内** | 组件"点一下勾选完成"时**没有任何东西会失败**，而 `no-op-construction-in-apps` 正是为拦这类事存在的 | [小组件计划](multi-platform-widgets.md) 新增 `check:widgets`；证据见 §2 下方"原生代码是现有门禁的盲区" |
| 🔴 **Windows PWA 组件本地安装是否可用未证实** | 若不可用，Windows 组件要另做 MSIX + 原生 provider | 官方成文路径只有 PWABuilder→Store，**先实测再承诺**（唯一可能推翻该路径的单点） |
| ⚠️ **macOS Continuity 与"锁屏隐藏内容"互斥** | 二者只能选一：要 Mac 桌面覆盖，就得放弃 iOS 锁屏内容保护 | 产品决策，须写进 ADR；首版可用"默认脱敏 + 显式 opt-in"折中 |
| 拖拽/甘特无 RN 等价物 | 交互降级 | 逐特性评估；可能需要产品决策 |
| 本次调研无联网搜索 | 候选清单不完整 | 调研 §6.2 已列出全部缺口，**不假装完整** |

---

## 4. 依赖登记清单（引入前必须完成）

| 依赖 | 版本（实测） | 许可证（实测） | 状态 |
|---|---|---|---|
| `react-native-web` | 0.21.3（2026-09-25，`latest`） | MIT | ✅ **已登记**（M1-3：白名单内**自动**登记，`check:licenses` 通过，清单第 788 行） |
| `react-native-svg` | 15.15.5 | MIT | ✅ **已登记**（M1 徽章：web 端需显式指向 `ReactNativeSVG.web.js`，见 `apps/web/vite.config.ts`） |
| `lucide` | 1.48.0 | ISC | ✅ **已登记**（**框架无关的图标数据包，零依赖** —— 共享层靠它拿图标，见 §M1 徽章一节） |
| `electron` | 44.4.5 稳定（自带 Node 24.21.0） | MIT | ✅ **已登记**（M2-1：白名单内**自动**登记，`check:licenses` 通过） |
| `@sqlite.org/sqlite-wasm` | 3.53.4-build1 | Apache-2.0 | ✅ **已登记**（ADR-0027；0 依赖，MIT 之外少见的零传递面） |

⚠️ **不引入**（除非另有人工核实）：`tamagui`（npm `license` 字段为 `null`，
与仓库 MIT 冲突，**未读包内 LICENSE**）。

---

## 5. 进度账本（每轮更新，这是本计划的核心指标）

**起点（2026-09-27 实测）**：

| 指标 | 起点值 |
|---|---|
| `apps/web/src` | 13,814 行 / 59 文件 |
| `apps/web/src/features` | 12,277 行 |
| `apps/mobile/src` | 7,927 行 / 38 文件 |
| `apps/mobile/src/screens` | 3,661 行 |
| 两端同名重复文件 | 1 处（`category-colors.ts`） |
| 移动端缺失特性 | 8,227 行 |

**每完成一轮填一行**：

> ⚠️ **指标口径（M0-1 完成后补的一条澄清）**：「净行数必须持续为负」这条
> **只适用于 M3（UI 迁移）**，不适用于 M0（共享层收敛）。
> M0 的产出是**把重复变成单点 + 加断言**，行数很可能**净增** ——
> M0-1 就是 **+94**。用行数衡量 M0 会得出错误结论：
> 它真正该衡量的是**"同一个事实有几份"**（M0-1 把它从 3 份降到 1 份）。

| 轮次 | 特性 | 净行数变化 | 两端共用同一组件？ | `pnpm check` |
|---|---|---|---|---|
| **M0-1** ✅ 已完成（`c1d67b8`） | 色彩映射收敛：槽位 / heat / unset 收进设计系统单点 | **+94**（+168 / −74）⚠️ **净增** | — | ✅ **`pnpm check` 全绿**（407 单测 + 24 E2E） |
| **M0-4** ✅ 已完成 | native 数字门禁（新增第 6 类规则）+ 修掉 6 处违规 | +约 50（规则 + 注释）⚠️ 净增 | — | ✅ 同一探针 **1 处 → 4 处**；`check:design` 全绿 |
| **M0-3** ✅ 已完成 | 分层防回潮规则（同时拦具名与结构两种形态） | +约 35（规则 + 注释）⚠️ 净增 | — | ✅ 探针 3 种形态全被抓（含**改名**的）；现状 9 条规则通过 |
| **M2（骨架部分）** ✅ 已完成 | 桌面壳落地（`apps/desktop`，5 个源文件） | +约 400（含 11 个测试与断言）⚠️ 净增 | **是**：壳只做窗口 + 白名单，业务全经 `@heyta/node-host` | ⏳ 9 个相关门禁全绿；`pnpm check` 的 2 个 E2E 红**与本改动无关**（详见提交说明） |
| **M1-1 / M1-2 / M1-3** ✅ 已完成（`f2c6d84`） | 建 `packages/ui` + `TaskList` + 主题契约；web 端 `react-native-web` 接入 | **+624**（`packages/ui`）+ 74（web 切片入口）⚠️ 净增（M0/M1 口径不适用行数，见上方澄清） | **是**：`apps/web` 与将来的 mobile/鸿蒙 import 同一个 `@heyta/ui` | ✅ **M1 判据 1、2 通过**（真实浏览器实测，见下）；`check:design`/`check:layering`/`check:licenses`/`check:docs` 全绿；ui 包 **15/15 测试** |
| **M1-4 插槽 + 分节** ✅ 已完成 | `TaskList` 扩成"共享机制 + 宿主内容"；分节形态（联合类型互斥） | +约 150（插槽 + 分节 + 注释）/ −约 40 | **是** | ✅ ui 包 21/21；`check:design`/`check:layering` 全绿 |
| **M1 徽章** ✅ 已完成 | 图标数据/渲染分离：`lucide` 数据 + 共享 `react-native-svg` 渲染 | +约 260（Icon + TaskBadges + 注释） | **是**：四端字形不可能再漂移 | ✅ **真实浏览器**：4 svg / 13 path、逾期 `#dc2626`≠未逾期 `#94a3b8`、警告三角 3 path vs 日历 5 path |
| **M1-4 mobile 替换** ✅ 已完成 | `TasksScreen` 换用共享 `TaskList` + `TaskBadges`：本地 `TaskRow` **彻底删除** | **−42**（763 → 721；+209 / −243） | **是**：四端同一份行机制 | ✅ mobile typecheck 通过；`check:design`/`check:layering`/`check:licenses`/`check:docs`/**`check:mobile-bundle`** 全绿；`<FlatList>/<Checkbox>/function TaskRow` 残留 **0** 处 |
| **M1-5** ✅ 脚本已交付 | `scripts/verify-universal-slice.sh` + 浏览器断言 | +约 330（脚本 + 注释）⚠️ 净增 | — | ✅ **8 通过 / 0 失败 / 3 明确未验**（iOS·Android 真机、鸿蒙、桌面加载） |
| M1-4 收尾（分节支持 + 替换） | 任务列表切片 | — | — | — |
| M1-5 收尾（鸿蒙 op-sqlite 读写） | 任务列表切片 | — | — | — |

### M1-1 ~ M1-3 的实测证据（2026-09-27）

判据 1「`react-native-web` 0.21.3 与 RN 0.84.1 + React 19 能否共存」——
**通过，且是真实浏览器里渲出来的，不是"构建不报错"**：

```
pnpm --filter @heyta/web run build          ✓ built in 3.88s
  dist/assets/universal-slice-*.js   159.64 kB   ← 独立懒加载 chunk，不进主包
  dist/assets/index-*.js             957.62 kB

# 起 `vite preview`，Playwright(chromium) 打开 http://127.0.0.1:4173/?slice=1
渲染出的行数: 4
 · "写 M1 切片验证"          ← 有截止时间，排最前
 · "核对鸿蒙 op-sqlite 版本差"  ← 其次
 · "（无标题）"               ← 空标题兜底
 · "✓\n已完成的示例"          ← 已完成沉底 + 勾
根节点 testID 命中: 1
点击前: "写 M1 切片验证"
点击后: "核对鸿蒙 op-sqlite 版本差"   ← 点击后该行变已完成并自动重排到末尾
页面错误: 无
```

最后两行是这条判据里信息量最大的地方：它一次同时证明了
**`Pressable` 可交互 + state 更新 + 重排序**三件事在 `react-native-web` 上都成立。
只截一张静态渲染图是证明不了这些的。

判据 2「Metro / Vite 能否解析同一个 workspace 包」——
Vite 侧已通过（`@heyta/ui` 被 import 并成功打包）；**Metro 侧要等 M1-4**。

**踩到并解决的一个真实坑**（值得记下来，因为它只在 pnpm 布局下出现）：
别名最初写成 `replacement: 'react-native-web'`，构建**直接失败**：

```
Could not load react-native-web (imported by ../../packages/ui/dist/index.js):
ENOENT: no such file or directory, open 'react-native-web'
```

根因是「解析**从导入方所在位置**开始」：`@heyta/ui` 是 workspace 包，Vite 解析到它的
真实路径 `packages/ui/dist/`，于是从 `packages/ui/` 往上找 —— 而 `react-native-web`
只装在 `apps/web/node_modules/`（它是 web 端的依赖）。
修法是把别名指向 `require.resolve('react-native-web/package.json')` 得到的**绝对目录**，
从根上消掉"从谁的位置找"这个变量。

**M1-5 的前置状态**：判据 3（无第二份 React）与判据 4（桌面端加载同一产物）
**尚未验证**，鸿蒙更是完全没跑 —— 这三条都不能算过，见 M1-5 那一节。

**M0-2 的展示逻辑归属判定表**（2026-09-27 执行完毕 —— **结论是"几乎都不该动"**）：

> 🔴 **根因发现（比这张表本身重要）**：heyta 的"重复"有一个**结构性来源** ——
> **按端命名的 i18n key**（`web.*` vs `mobile.*`）。
> 只要一个展示函数要取词，它的**算法即使逐字相同，也必须写两遍**，因为 key 前缀不同。
>
> 也就是说：**共享层现在的天花板不是"没抽干净"，而是"文案按端命名"这个刻意设计。**
>
> 三条实测证据（本次逐字比对）：
> - 两端 `formatDuration` **逐字同构**，只差 key 前缀；
> - 两端 `KIND` 映射（mobile `KIND_KEY` / web `KIND_COPY`）只差 key 前缀；
> - 两端 `remainingText` 的 `-1 / 0 / 1 / 2 / 其他` 分支**完全相同**，只差 key 前缀。

| mobile `lib/` 文件 | 语义核心在哪 | 判定 | 依据 |
|---|---|---|---|
| `category-display.ts` | ✅ **已在 `@heyta/domain`**（`durationParts` 阈值、`CategoryKind`、`CategorySeries`） | **保留在两端** | 剩下的是 key 前缀映射。web 的对应物叫 `features/categories/copy.ts` —— **文件名不同**，这正是"按文件名找重复"会漏掉的一个 |
| `due-display.ts` | ✅ **已在 `@heyta/domain`**（`CountdownUrgency`、倒计时分类） | **保留在两端** | 剩下的是 key 前缀映射。单复数不变量**已由两端测试钉住**：mobile `plural-keys.spec.ts` 断言 `'1 day overdue'` 且**不含** `'1 days'`；web `due-display.spec.tsx` |
| `date.ts` | 部分在 domain | **保留** | web **零等价物** —— 单消费方 |
| `focus-display.ts` | — | **保留** | web **零等价物** —— 单消费方 |
| `focus-timer.ts` | — | **保留** | web **零等价物** —— 单消费方 |
| `priority.ts` | — | **保留** | web **零等价物** —— 单消费方 |
| `quick-dates.ts` | — | **保留** | web **零等价物** —— 单消费方 |
| `recurrence-display.ts` | — | **保留** | web **零等价物** —— 单消费方 |
| `use-today.ts` | — | **保留** | 依赖 RN `AppState` —— 属"**平台 hook**"，本就不该进 `packages/` |

**为什么"没搬"是刻意的（三条判据，写下来免得下次有人重做这轮清点）**：

1. **单消费方进 `packages/` 不是共享，是把代码挪远** —— 多一层间接、少一份就地可读性，
   而且**没有任何门禁能证明它被复用了**。抽象要有第二个消费者。
2. **语义核心已在 domain、只剩按端文案映射的模块，合并会同时踩两件事**：
   与 `check:ui-language` 的按端词条设计冲突，并制造一个只做字符串拼接的空抽象层。
3. 🔴 **真正的重复只有 `category-colors.ts` 一处，而它不在这张表里** ——
   因为它的**取值不在任何 package 内**，漂移是**静默**的（改一处不会让任何测试变红）。
   **M0-1 已修，并补了可证伪的测试。**

> **对 M0 的含义**：**不再有值得做的抽取**。
> M0 剩下的是**门禁**，不是更多搬迁 —— 而两条门禁（M0-4 / M0-3）**已完成并各自证伪过**。

---

## M0 收尾（2026-09-27）

**M0 四项全部完成**，每项都带"能被证伪"的证据：

| 任务 | 产出 | 证伪证据 |
|---|---|---|
| M0-1 | 色槽 / heat / unset 收进设计系统单点 | 注入漂移 → 新测试**红**、而**旧测试仍绿** |
| M0-2 | 9 个 helper 的归属判定表 | **负结果**：共享层已接近完整，无需抽取 |
| M0-3 | `check:layering` 第 9 条规则 | 探针 3 种形态全被抓（含**改名**的） |
| M0-4 | `check:design` 第 6 类规则 + 修 6 处违规 | 同一探针 **1 处 → 4 处** |

**M0 的意外收获**：原以为要"抽更多共享代码"，实测发现**共享层已经几乎完整** ——
语义核心（`CountdownUrgency`、`durationParts`、`intensityLevel`）早已在 `packages/domain`，
两端剩下的只是**按端 i18n key 的文案映射**（那是刻意设计，且有测试钉住）。

所以 M0 真正的产出不是搬迁，而是**两条补上「静默失效」的门禁** + **一个负结果**：
护栏失效的特征不是报错，而是**什么都不发生** —— 两个缺口都是这么被发现的。

---

## 6. 这份计划明确**不做**的事

1. **不重写业务逻辑** —— `packages/domain` / `app-host` 已经是零重复的，动它没有收益。
2. 🔴 **不把系统小组件纳入 UI 收敛** —— 小组件是**该平台的原生 UI**，
   任何框架都不能让它可移植。真正要写的是 **3 份原生组件（Swift / Kotlin / ArkTS）+ 1 个 JSON 模板**，
   共享的是 `v: 1` JSON 契约而不是 UI 代码。
   **禁止使用 headless-JS 组件库**（`react-native-android-widget` 那类），
   它会把 RN 组件树连同应用 JS 拖进后台进程。「UI 只写一份」在**应用内**成立，在小组件上不成立。
   见 [多端选型：小组件视角的证据](../research/multi-platform-selection-evidence.md) §10.1。
   小组件有自己的计划与排序：[多端小组件改造计划](multi-platform-widgets.md)，**与 M0/M1 并行不冲突**。
3. **不引入向量数据库** —— 已有实测结论（调研 §3.7）：需求是计数不是相似，
   暴力余弦扫描 10k×384 = 2.6 ms，ANN 索引解决的是本产品不存在的规模问题。
4. **不引入样式库**（ADR-0024 §2.4）—— 避免第二个设计真源。
5. **不做大爆炸式重写** —— 12,277 行必须逐特性迁。
6. **不承诺桌面端可分发** —— 签名/公证未调研，本阶段只到未签名产包。
7. **不承诺桌面端有原生小组件** —— Electron 能否承载 `.appex` / MSIX widget provider
   **未核实**（ADR-0024 §5 第 5 条）；降级路径是 macOS Continuity 与 Windows PWA provider。
8. **不把鸿蒙排进关键路径** —— 缺的是模拟器镜像与签名，不是代码。
