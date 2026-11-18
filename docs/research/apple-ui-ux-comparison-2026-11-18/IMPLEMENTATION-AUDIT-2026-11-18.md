# 任务页空态 iOS 化 · 实施与验收报告（2026-11-18）

> 目标：在 heyta 仓库落地「移动端任务页 iOS 原生布局」的一刀，并用目标模式 + 并行子 Agent 实施、主 Agent 统一审计验收。
> 结论先行：**本轮实际落地 1 个 P0 修复（B01）**——任务列表空态不再被"卡中卡"包住，改为落在页面上并在剩余空间垂直居中。**其余 README 建议经代码复核大多已实现或被既有决策否决**，故不做（详见 [`BACKLOG.md`](BACKLOG.md) 与下方 §5）。改动**仅**在 `packages/ui`，**未碰不可逆层**，web/其它宿主行为逐字节不变。

---

## 1. 范围与决策依据

- 直接依据：同目录 [`BACKLOG.md`](BACKLOG.md)——由并行子 Agent 逐屏核对**当前代码**（带文件/行号证据）后产出。它推翻了白天 README 中多处基于旧截图的判断。
- 关键事实（决定"做什么/不做什么"）：
  1. **屏幕底改白是既定决策**（`apps/mobile/src/ui/kit.tsx:553-559`，产品负责人原话"像蒙了一层灰"）→ 不改回分组灰底。
  2. **AppBar 明确不用大标题**（`kit.tsx:197-204`；`TasksScreen.tsx:1552-1563`）→ 不加 34pt Large Title。
  3. 任务页 `listCard` / `density="compact"`(44dp) / `barCollapsed` / 空态带行动按钮 / 空态不画 FAB —— **均已实现**。
  4. 日历日/周/年视图 + now 线 + 手势、便签多行编辑、专注大数字+圆环、iOS Widgets/Live Activity/App Intents 源码 —— **均已存在或已实现**。
  5. **工作区正有另一会话在并行修改** `apps/mobile/src/{screens/AuthScreen,WelcomeScreen,FocusScreen}.tsx`、`packages/ui/src/focus/*`、`packages/design-system/*`、iOS `project.pbxproj` 等（`git status` 现量 33 项）→ **不能碰这些文件**（含 BACKLOG 的 B02 专注沉浸式、B16 token 新增）。
- 因此在本会话可安全推进的真实 P0 只有 **B01**。

---

## 2. 变更清单（B01：任务空态去"卡中卡"）

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/ui/src/task-list/card-policy.ts` | 新增 | 纯函数 `shouldShowListCard(listCard, itemCount)`：`listCard===true && itemCount>0` 才画卡；空列表不画卡。无 RN/样式/token 依赖，可在 node 环境单测。 |
| `packages/ui/tests/card-policy.spec.ts` | 新增 | 6 条用例钉住"空列表不画卡"（含负数防御）。 |
| `packages/ui/src/task-list/TaskList.tsx` | 修改 | ①引入 `showCard`/`isEmptyCard`（由 `card-policy` 派生）；②`listCard` 样式改用 `showCard`；③空列表且 `listCard` 时 `contentContainerStyle` 加 `flexGrow:1`，并把 `ListEmptyComponent` 包进 `emptyCenter`（`flex:1 + justifyContent:'center'`）→ 空态落页面底色、在 header 之外剩余空间垂直居中。**影响面严格锁在 `listCard` 路径**（仅移动端任务页传它）。 |

**行为保证**：`listCard=false`（web/desktop/dev 及所有传 `emptyMessage` 的宿主）时，`showCard=false`、`isEmptyCard=false`，`gap`/卡片 spread/`ListEmptyComponent` 取值与改动前逐字节一致。

改动统计（`git diff --stat`）：`TaskList.tsx` **+50 −4**；两个新文件。

---

## 3. 统一验收（可复现命令 + 读数）

| 检查 | 命令 | 结果 |
|---|---|---|
| 新增判据单测 | `cd packages/ui && npx vitest run tests/card-policy.spec.ts` | ✅ **6 passed** |
| ui 全量单测 | `cd packages/ui && npx vitest run` | ✅ **66 files / 993 tests passed** |
| ui 类型检查 | `cd packages/ui && npx tsc --noEmit -p tsconfig.spec.json` | ✅ **exit 0** |
| ui 构建（供移动端消费 dist） | `pnpm --filter @heyta/ui build` | ✅ **Build success（CJS/ESM/DTS）** |
| 空态单一来源 | `node scripts/check-empty-state.mjs` | ✅ 四道断言通过 |
| 任务行单一来源 | `node scripts/check-row-single-source.mjs` | ✅ 通过 |
| token 引用可解析 | `node scripts/check-design-token-refs.mjs` | ✅ 146 引用全解析 |
| 字号纪律 | `node scripts/check-font-size-discipline.mjs` | ✅ 通过 |
| 主题单一来源 | `node scripts/check-theme-single-source.mjs` | ✅ 通过 |
| 原生壳裸 hex | `node scripts/check-native-bare-values.mjs` | ✅ 通过 |
| 分层边界 | `node scripts/check-layering.mjs` | ✅ 通过 |
| 硬编码设计变量 | `node design-system/heyta/check-hardcoded.mjs` | ✅ 无硬编码（`flexGrow/flex/justifyContent` 属布局关键字，非设计尺度） |
| 文案合规 | `node scripts/check-ui-language.mjs` | ✅ 通过 |

**唯一红项（与本次改动无关，已归因）**：`node scripts/check-l4-no-style.mjs` → `apps/mobile/src/screens` 内联样式 **53 > 基线 52（多 1 处）**。
- 证据①：该门禁**只扫** `apps/web/src/features/**` 与 `apps/mobile/src/screens/**`；本次改动的 `packages/ui/src/**` **不在扫描范围**。
- 证据②：`apps/mobile/src/screens/TasksScreen.tsx` 的 mtime 为 11-17，本次**未修改**；`git status` 里被改的是**另一会话**的 `AuthScreen.tsx / WelcomeScreen.tsx / FocusScreen.tsx`。
- 结论：这 +1 处是**工作区既有的并发改动**，不归因本次 B01。要过全量 L4 需由那处改动的所有者收敛。

---

## 4. 视觉验收状态（诚实标注：未完成）

- **未完成原因**：模拟器上已安装的 `com.heyta` 是**旧 JS bundle**；本轮改动在 `packages/ui`（源码 + `dist` 已重建），要肉眼看到必须**重打 RN 包并安装**。而当前工作区有**另一会话正在修改 iOS 原生工程（`project.pbxproj`）与 focus 相关文件**，此刻重建/安装会与之相互干扰，且 Release 模拟器构建耗时且易受脏工程失败。
- **待执行命令（在有干净工程时）**：
  ```bash
  # 1) 已构建 @heyta/ui dist（本轮已做）
  pnpm --filter @heyta/ui build
  # 2) 重打 iOS 模拟器包并安装（或 npx react-native run-ios）
  pnpm --filter @heyta/mobile build:ios
  # 3) 启动并截图（用本仓既有脚本/模拟器 UDID）
  xcrun simctl launch 4C1B456B-C506-4A72-94B5-18A80E1EBCE9 com.heyta
  xcrun simctl io 4C1B456B-C506-4A72-94B5-18A80E1EBCE9 screenshot /tmp/after-tasks-empty.png
  ```
- **预期（改前的反证图已在）**：改前 `docs/research/apple-ui-ux-comparison-2026-11-18/img/heyta-mobile-tasks-empty.png` 显示"描边白卡包住空态"；改后应为：**无卡框，日期副标题在顶部、空态（插画+文案+主按钮）在下方剩余空间垂直居中**。
- 逻辑依据：`EmptyState` 的 `page` 档本身"居中 + 上下 `space.16` + 插画"（`packages/ui/src/empty-state/EmptyState.tsx` / `model.ts`），本次只是**不再套白卡**并给居中层 `flex:1`。

---

## 5. 本轮**未做**及原因（避免误读为遗漏）

| 条目 | 为什么不做 |
|---|---|
| B02 专注页沉浸式（P0） | `apps/mobile/src/ui/kit.tsx` 的 `immersive`、`FocusScreen.tsx`、`packages/ui/src/focus/*` **正被另一会话修改**；现在动会互相覆盖（kit.tsx 还是共享文件）。 |
| B03 日历日/周视图可操作化（P0） | 需 `parseCapture` 支持"时刻(HH:MM)"，**跨领域/数据模型**，风险高；且 `CalendarDayBoard.tsx` 文件头明写"全仓几乎没有带时刻的任务"——先确认模型再动手。 |
| B04/B05/B06/B07… | B04 需拆"卡外 header + 卡内行"结构；B07 触 `shared-schema`（不可逆层，须先 ADR）；其余为 P1/P2。 |
| 改回灰底 / 加 Large Title / 换系统蓝 / 用 SF Symbols / 加第 6 tab | **与既有明确决策冲突**，`BACKLOG.md` §4 已列为"不要做"。 |

---

## 6. 回滚方式

本轮改动**未提交**（工作区含另一会话的未提交改动，提交会牵连他人成果）。已做可回滚快照：
- `.local/ios-tasklist-slice-20261118/`：`TaskList.patch`（仅本文件 diff）、`TaskList.tsx`、`card-policy.ts`、`card-policy.spec.ts`、`SHA256.txt`。
- 回滚：`git checkout -- packages/ui/src/task-list/TaskList.tsx && rm packages/ui/src/task-list/card-policy.ts packages/ui/tests/card-policy.spec.ts`，再 `pnpm --filter @heyta/ui build`。
- 记录 sha256：`TaskList.tsx bcd...`/`d594...` 见快照 `SHA256.txt`。

> ⚠️ 恢复/提交前请先与并发会话协调（AGENTS.md §6：同一检出并行写者需隔离）。本报告只声明"这些文件是我改的"，不替他人处置其未提交改动。

---

## 7. 建议下一步

1. 在干净工程上执行 §4 的构建+截图，完成 B01 的**真机/模拟器视觉验收**。
2. 待焦点/原生那批并发改动落地后，再做 **B02（专注沉浸式）**——它是真实布局缺口（`FocusPanel.fill` 已存在但移动端未传、`immersive` 档仅有占位）。
3. 日历"带时刻建任务/拖拽"（B03）与便签"备忘录闭环"（B07）需先定**数据模型/ADR**，再排期；不要当布局微调做。
