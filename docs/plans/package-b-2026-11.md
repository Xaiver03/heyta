# B 包 · 任务操作闭环（R3 / R4① / R8 + R1 收敛）

> **上游**：[产品需求对齐清单](ticktick-parity-prd-2026-11.md) R3 / R4 / R8（§4 的 B 包）；
> R1 收敛那条是 E 包让给 B 的（[入口表](r14-entry-table.md) 里 5 行 `收敛` 的债）。
> **落地日**：2026-11-06。**范围**：`packages/domain` · `packages/app-host` · `packages/ui/src/task-list` · `apps/web/src/{App.tsx,features/tasks,features/tags,features/shell}`。
> **一包三件交付**：①本文件 ②实现 + 门禁读数（见[§6](#6-门禁读数现量)）③用户能看到什么（见[§5](#5-用户能看到什么)）。

---

## 0. 一句话结论（逐条三选一，不含糊）

| 需求 | 状态 | 一句话 |
|---|---|---|
| **R3 重复任务「跳过这一次」** | **做到** | `Task.exDates?` + `recurrence.ts` 五个求值点 + `skipOccurrence`（**一条 op、可撤销**）+ 行菜单入口。三端共用纯函数。 |
| **R4① 手动排序接活** | **做到** | `order` 的写路径（`setOrder` 早就有）+ 领域 `planManualReorder` + web 拖拽（`renderRowWrapper` 插槽 + dnd-kit）。**一次拖动 = 一条 op**。 |
| **R8 标签管理页（合并/批量/改名）** | **做到（合并为「读侧别名」形态）** | 改名=1 op、批量删=1 条 DEL、**合并=1 条 TAG op**（`{deletedAt, mergedInto}`）+ 读侧唯一解析入口。代价：`task.tagIds` **原始数据仍留旧 id**（有测试钉住）。 |
| **R1 收敛（三处显式重复）** | **做到** | 行菜单的 `priority` / `moveToProject` / `tags` 三个子菜单删掉，落点只剩面单；`ROW_ACTION_IDS` 11 → 9。 |

---

## 1. R3 · 重复任务「跳过这一次」

### 1.1 做了什么

| 层 | 文件 | 内容 |
|---|---|---|
| 字段 | `packages/domain/src/entities.ts` | `Task.exDates?: LocalDate[]`（**可选**、**不 bump schema**、格式与仓里既有 `LocalDate` 同一个 `YYYY-MM-DD`） |
| 求值 | `packages/domain/src/recurrence.ts` | `RecurrenceRangeOptions.exDates`，五个求值点全部生效：`occurrencesInRange` / `nextOccurrence` / `firstOccurrences` / `nextAfterCompletion` / `occursOn`；外加 `normalizeExDates` / `withExDate` / `withoutExDate` / `isExDate`（**读写只有这一个入口**，升序+去重+上限 200 保留最近） |
| 写入 | `packages/app-host/src/actions.ts` | `skipOccurrence(id)`：**一条** `UPD { exDates, dueDate, dueDateLocal? }`；`completeTask` 也把 `exDates` 喂给 `nextOccurrence`（否则跳过的日期会被"完成"还回来） |
| 入口 | `apps/web/src/features/tasks/TaskRowMenu.tsx` + `packages/ui/src/task-list/row-actions.ts` | 行菜单 `skipOccurrence`（对象层）。**只在有生效规则时出现**（`repeating` 由宿主用领域 `repeatOf` 的同一判据算） |

**为什么"不物化实例"**：本仓一条 `Task` = 一个重复任务，到期日就是"当前那一次"。物化会凭空造实体，且跨端要回答"哪一条才是真的"。所以"跳过"= 记进排除集 + 把到期日推进到下一次。

### 1.2 判据与"怎么才会红"

| # | 判据 | 判据在哪 | 怎么才会红（实测） |
|---|---|---|---|
| R3-① | 跳过某一次 ⇒ 该次不再出现、**其它次不变** | `packages/domain/tests/exdates.spec.ts`（17 条） | 把 `exDateSetOf()` 改成恒返回 `undefined` ⇒ **10/17 红**；还原 ⇒ 17/17 绿 |
| R3-② | 撤销可恢复 | `packages/app-host/tests/skip-occurrence.spec.ts` 的 `undo()` 那条 | 给它带上 `heytaTaskRepeatCompletion` 标记（为了顺带重排提醒）⇒ `undo()` 返回 `unsupported`，该条红 |
| R3-③ | §3.4「一条 op」 | 同上「一条 op」组 | 拆成两条 `update` ⇒ `ops.length` 断言红 |
| R3-④ | `CURRENT_SCHEMA_VERSION` 不变 | 既有断言（本包未改它） | 本包**没有**任何 schema/迁移改动 |

### 1.3 实现里的两个刻意取舍（都有代价）

1. **跳过不重排提醒。** 重排要带 `heytaTaskRepeatCompletion` 标记（那是唯一能同一条 op 里带 `reminders` 的形状），而那条 op 会被 `history.ts` 判成 `batch` ⇒ **不可撤销**，直接违反 R3-②。两害相权取了"可撤销"。
2. **`firstOccurrences` 的预算口径改了**：原来上限数"循环次数 = count"，现在上限是 `count + exDates.length`（跳过的不占 `count`）。这条有专门用例（连跳 5 天仍给 3 条）。

### 1.4 途中发现、由总包修掉的缺口（不在我白名单）

`packages/shared-schema/src/task-repeat-completion-contract.ts` 的 `taskPatch` 是 `.strict()` 且只允许 `{dueDate, widgetCompletionReceipts}`，而 `completeTask` 会写 `dueDateLocal` ⇒ **任何带 `dueDateLocal` 的重复任务一勾完成就抛**。我这边用 `it.fails` 登记并复现，总包当天补了可选 `dueDateLocal` + 同日不变量；现在那条已翻成正常 `it`（`skip-occurrence.spec.ts` 最后一条）。

---

## 2. R4① · 手动排序：接通写路径

### 2.1 做了什么

| 层 | 文件 | 内容 |
|---|---|---|
| 领域 | `packages/domain/src/task-order.ts` | `manualOrderKey()`（`order ?? 1e12 + createdAt`）；`manual` 档真的排；`planManualReorder()`（落点 → 要写什么）；`manualOrderBetween()`（中值/上下界） |
| 写入 | `packages/app-host/src/actions.ts` | `setOrder`（**早就有**）收紧了校验：只拦非有限数（见 §2.3） |
| 共享层 | `packages/ui/src/task-list/TaskList.tsx` | 新插槽 `renderRowWrapper?: (row, node) => ReactNode` —— 唯一目的：把"行外面那个节点"交给宿主贴 dnd-kit 的 ref（共享层只许 RN 原语） |
| 宿 | `apps/web/src/features/tasks/ManualSortDnd.tsx` + `manual-sort.css` | `ManualSortWrapper`（要不要建拖放范围的唯一判断点）/ `ManualSortScope`（DndContext + SortableContext）/ `ReorderHandle`（行尾手柄，**没有拖放上下文就返回 `null`**） |
| 接线 | `apps/web/src/App.tsx` | `manualSortActive` / `manualRowWrapper`；两处 `TaskList` 包一层 `<ManualSortWrapper>`；`renderTaskTrailing` 里挂 `ReorderHandle` |

### 2.2 判据与"怎么才会红"

| # | 判据 | 判据在哪 | 怎么才会红（实测） |
|---|---|---|---|
| R4-① | 拖动后刷新/换端顺序不变 | `packages/domain/tests/manual-order.spec.ts`（12 条）+ `apps/web/tests/tags-manager-and-manual-sort.spec.tsx` | 把 `case 'manual'` 退回 `order ?? MAX_SAFE_INTEGER` ⇒ 领域 "没排过序按 createdAt 排" 那条红 |
| R4-② | **一次拖动 = 一条 op** | web 用例「拖动落点 → setOrder 写一条 op」 | 把 `setOrder` 的 `update(...)` 注掉 ⇒ **web 2/4 红**；还原 ⇒ 4/4 绿 |
| R4-③ | 切档位**不写任何数据** | 设计（见 §2.3）+ `App.tsx` 的 `manualSortActive` 只读 | 若在 `changeTaskSort('manual')` 里加归位写入 ⇒ 该判据（切换前后 `readRecentOps()` 长度）红 —— 这条**今天没有专门用例**，登记在 §7 |
| R4-④ | `respace` 兜底可判 | 领域「精度用尽时退化成 respace」 | 把 `manualOrderBetween` 的严格中值判断去掉（返回 `prev`）⇒ 该条红 |

### 2.3 🔴 与原始派单的偏离（总包已批准作废旧指令）

派单原要求"切到手动档那一刻归位（N 条单字段 op）"。**实际没做归位**，改成：

- **合成键**：`order ?? (MANUAL_ORDER_FALLBACK_BASE + createdAt)`，`MANUAL_ORDER_FALLBACK_BASE = 1e12`；
- 于是"两条没排过序的任务之间"**也插得进去**（中值落在 1e12 那一段，是一个合法的显式值）；
- 所以"首次拖动"也是**一条 op**，`respace` 只在"同一对邻居之间插到 double 夹不进"时才触发（实测要构造 `1` 与 `1 + Number.EPSILON` 这种相邻 double）。

**它的代价（写在这儿，别当没有）**：没排过序的任务在手动档下**按 `createdAt` 排**，而不是"你从哪个排序切过来的那个顺序"。理由：那个顺序取决于用户上一个动作，本来就不该被记住；把它固化成数据要付 N 条 op。总包复核后作废了旧指令，新判据是「切档位时 op-log 条数不变」。

`1e12` 这个数的口径：显式 `order`（滴答导入的 `Order`、以及拖动写出的中值）与合成键在**同一个数值轴上**比较；"显式小整数一律排在未排序之前"只在导入数据下成立，一旦在合成段里拖过，写进去的中值就是显式值 —— **语义仍然正确**。写入侧**不设上界**（第一版设了，被 web 用例打红：最常见的首次拖动中值就在 1e12 以上），只拦 `NaN`/`Infinity`。

---

## 3. R8 · 标签管理页

### 3.1 做了什么

| 层 | 文件 | 内容 |
|---|---|---|
| 字段 | `packages/domain/src/entities.ts` | `Tag.mergedInto?: string`（可选） |
| 解析 | `packages/domain/src/tags.ts`（新） | **唯一入口**：`resolveTagId` / `resolveTagIds` / `resolveTags` / `taskHasTag` / `tagUsageCount` / `indexTags` / `followTagAlias`（链跟到底、环返回 `undefined`、超深 32 层停） |
| 筛选 | `packages/domain/src/task-filter.ts` | `FilterContext.tags?` ⇒ `case 'tag'` 与 `scopeTasks` 走解析。**最致命的一格**：不给它时按 id 精确匹配（桌面/移动端今天的行为，已登记） |
| 写入 | `packages/app-host/src/tag-actions.ts`（新） | `merge` = **1 条 TAG op** `{deletedAt, mergedInto}`；`mergeMany`（每源 1 条）；`removeMany` = **1 条 DEL 带 `entityIds`**；`mergeImpact` / `usageCount` |
| 宿 | `apps/web/src/features/tags/{store.ts,TagsManager.tsx}`（新） | 浮层：多选（`OrganizerList` 的 `renderLeading` 插槽）+ 合并目标 + 就地确认（带影响面）+ 批量删 + 改名（走共享层行内编辑器） |
| 入口 | `apps/web/src/App.tsx` | 任务视图页头 `⋯` 里的「管理标签」（`testID="manage-tags-open"`），视图层、全局作用域 |

### 3.2 判据与"怎么才会红"

| # | 判据 | 判据在哪 | 怎么才会红（实测） |
|---|---|---|---|
| R8-① | 改名后所有引用处一起变 | `packages/app-host/tests/tag-merge.spec.ts`「改名」那条 | 改名时顺手重写任务的 `tagIds`（N 条 op）⇒「改名不碰任何任务」那条红 |
| R8-② | 合并后**没有任何任务还挂着被合并掉的那条** + **合并 = 一条 op** | `tag-merge.spec.ts`（9 条）+ `tags.spec.ts`（12 条）+ web 用例 | 把 `resolveTagId` 改成"直接返回入参"（= 关掉迁移步骤）⇒ **领域 10/12 红**、**web 1/4 红**；还原 ⇒ 12/12 + 4/4 绿 |
| R8-③ | 合并可撤销（1 条 op 的逆） | `tag-merge.spec.ts`「undo」那条 | 改成 `DEL` 表达合并（丢 `mergedInto`）⇒ 撤销清不掉去向，该条红 |
| R8-④ | 原始数据不变（设计而非漏改） | `tags.spec.ts`「原始数据不变」那条 | 一旦有人"顺手重写 tagIds"，那条红 —— 它逼人回来回答"一次合并 = N 条 op 还是不是" |

**为什么合并是"读侧别名"而不是重写任务**：跨实体一条 op 在本仓只有两条路（`entityIds` 同类型同载荷批量；`payload marker + reducer 扇出`），后者要改 `packages/shared-schema` + `packages/op-log/src/state.ts`（我的禁区）。所以走"**只动标签那一行**"，代价是 `task.tagIds` 里留着旧 id，收益是：一条 op、可撤销、并发冲突面只有一行。

---

## 4. R1 收敛（E 包让给 B 的那三笔）

| 动作 | 改前 | 改后 |
|---|---|---|
| `priority` | 行菜单子菜单 + 面单 select（两个落点） | **只有面单** `TaskDetailCard` 的 `PriorityField` |
| `moveToProject` | 行菜单子菜单 + 面单下拉 | **只有面单** `OrganizerField` |
| `tags` | 行菜单子菜单（含就地新建标签草稿）+ 面单复选框 | **只有面单** `OrganizerField` |
| `ROW_ACTION_IDS` | 11 个 id | **9 个**（删 3、加 1 = `skipOccurrence`） |
| `dueDate` | 面单 + 四象限拖放 + 时间线拖放 | **不动**（那两条是**隐式**入口，删它们 = 删功能；债务是"副作用可见性"，归 UX 不归 R1） |

**判据**（`apps/web/tests/task-row-menu.spec.tsx`）：
- 反向：三个子菜单的 testid 与它们的前缀族一个都不在了（`task-row-menu-priority*` / `-move` / `-tags*` / `-project-*` / `-new-tag`）；
- 正向（R1 的正面判据）：`TaskDetailCard.tsx` 里 `store.setPriority(` / `store.moveToProject(` / `store.setTags(` **各恰好 1 处** —— 出现第二个就红；
- 对象层动作没被顺手砍掉（打开/置顶/加子任务/放弃/删除都还在）。

**改测试这件事要说清**：删掉了原来的 `B1`（优先级四档）、`B4`（移动到）、`B3`（标签选取 + 就地新建共 6 条）、以及"键盘 Enter 展开移动到子菜单"那条 —— 共 **10 条**。它们钉的是"行菜单里这三个子菜单点了会把意图发出去"，而**形状本身被决定改掉**（AGENTS §6 第 3 条针对的是"为了让测试变绿而改测试"；这里是判据对象消失）。能力没有减少：三个字段在面单里都能改，且现在**只有一个**落点。由上面那组新判据接手。

---

## 5. 用户能看到什么

| 变化 | 在哪看 | 读数/判据 |
|---|---|---|
| 重复任务的行菜单多了「跳过这一次」 | 右键任意**重复**任务 | `skipOccurrence` 只在有生效规则时出现（web 用例「只在有生效规则时」）+ app-host 9 条 |
| 排序「手动拖拽」这一档**真的能拖了** | `⋯` → 手动拖拽 → 行尾出现拖拽手柄 | web 用例 4/4 绿；手柄 `data-testid="task-reorder-handle"` |
| 标签管理浮层 | `⋯` → 管理标签 | web 用例：点开挂出浮层、屏上两条标签、勾两条可合并 |
| 合并之后侧栏标签少一条、那条任务挂到目标标签上 | 合并后看标签列表 + 该任务的标签 chip | app-host：合并 1 条 op；`tags.spec`：有效标签里没有旧 id |
| 行菜单变短了 | 右键菜单 | 三个子菜单消失，只剩打开/置顶/加子任务/跳过这一次/放弃/删除 |

⚠️ **我没有截真浏览器图**（`ui-acceptance.md` 要求"人眼看过"那一档）。上面这一列是 **jsdom 行为判据**（`apps/web/tests/tags-manager-and-manual-sort.spec.tsx` 4/4 绿），**不是**"我看过截图"。这一格登记在 §7。

---

## 6. 门禁读数（现量）

| 门禁 | rc | 现量 |
|---|---|---|
| `pnpm typecheck`（全仓） | **0** | 所有包 `Done` |
| `check:control-semantics` | **0** | 17 枚自检臂全过；色调 4 档 / 中央规则 47 条 / 界面变体 5 个 |
| `check:row-single-source` | **0** | ht-* 前缀族 **33 恰在基线 33**；任务行单一来源 1 处 |
| `check:entry-table` | **0** | 入口表 **40 行** / 共享词汇表 **9 个 id、覆盖 9** / 自检 9 臂 |
| `check:ui-language` | **0** | 495 文件、850 处文案、83 处诊断字段；监管定性 0 处 |
| `check:layering` | **0** | 546 文件、9 条规则 |
| `check:design` | **0** | 无硬编码设计变量 |
| `check:reachability` | **0** | 14 实体、未建模 5 项已结清 |
| `check:op-log-semantics` | **0** | 6 组变异全部被断言抓住（每条都打了捕获条数） |
| 其它扫过的 | **0** | `check:overlay` / `check:danger-confirm` / `check:dirty-form-policy` / `check:form-anatomy` / `check:selection-single-source` / `check:empty-state` / `check:persistence-keys`（21/21 键）/ `check:z-ladder` / `check:ratchet-ceilings` / `check:ux-coverage` / `check:design-token-refs` |
| 🔴 `check:l4` | **1** | **78 处 > 基线 74** —— 那 4 处**全部是 `features/kanban/KanbanView.tsx` 的既有债**（`BLOCKED.md` B274，不在我白名单）。**我的新文件是 0 处**（`ManualSortDnd.tsx` 用 `style={rowStyle}` 传动态几何、手柄样式落在 `manual-sort.css`） |

测试现量：`packages/domain` **1229/1229**（54 文件）· `packages/app-host` **2106/2106**（129 文件）· `apps/mobile` 的 `row-actions-mobile` **28/28**（共享词汇表少两项没影响它）· `apps/web` 全量 **2708 passed / 13 skipped / 5 suites failed**，那 5 个 suite 的失败原因**不是本包**：`src/features/sync/store.ts`（A 包的改动）在模块级调 `onEngineChange(...)`，而这些 spec 的 `vi.mock('../src/lib/oplog.js')` 没给这个导出 ⇒ 报 `No "onEngineChange" export is defined on the mock`。

---

## 7. 我知道但没做的（不许藏）

1. **没有真浏览器截图**。R4 的拖拽手势（指针位移、dnd-kit 几何）、标签浮层的观感都只有 jsdom 判据。`ui-acceptance.md` 的"人眼看过"这一格是空的。
2. **R4-③「切档位不写数据」没有专门用例**。它是设计（`manualSortActive` 只读），但"注掉什么会红"没有钉住 —— 下一个人加归位逻辑不会有东西挡住他。
3. **`respace` 兜底路径只有领域用例**（构造相邻 double），web 侧那条分支（N 条 setOrder）没有用例。
4. **标签合并的读点没有 100% 走解析**。已接：`task-filter` 的标签分支与 `scopeTasks`、面单的标签 chip 与勾选（`TaskOrganizer`）、行菜单勾选态、标签管理页、`tagUsageCount`。**没接**（不在我白名单）：
   - `packages/ui/src/projects/model.ts`（侧栏"它挂在 N 条任务上"的影响面）与 `apps/web/src/features/projects/ProjectsPanel.tsx` 的 `tagCounts` ⇒ **合并后目标标签的侧栏计数会偏低**（少算了只挂着旧 id 的任务）。修法：两处各把 `(task.tagIds ?? []).some(...)` 换成 `resolveTagIds`。
   - `packages/local-api`（AI / MCP 出口）与导出：把 `tagIds` 原样吐出去，合并过的 id 会在出口里出现。
   - `apps/mobile` / `apps/desktop` 的 `filterTasks` 调用没有传 `context.tags`（已在 `tags.spec.ts` 里把"不传 = 精确匹配"钉住，谁去接线会看到那条注释）。
5. **标签浮层的关闭保护只有一半**：`isDirty` 只看"勾选了标签"，共享层 `OrganizerList` 里那个**行内改名草稿**的脏状态宿主拿不到 ⇒ 改名打到一半关浮层会丢。修法：`OrganizerList` 需要把 `renaming` 抛出来（共享层改动）。
6. **合并到"目标本身也在链上"的链式场景**由 `canonicalMergeTarget` 提供，但界面没有用它（今天拒绝而不是自动取链末端）。
7. **`docs/plans/r14-entry-table.md` 的行号漂移是我这批改动造成的**：我改了 `App.tsx` / `TaskRowMenu.tsx` 的行数，表里**别人那些行**的行号因此失效，我按锚点重定位了 **28 行**的行号（只改数字，没动锚点与处置）。这个文件此后归总包维护。
8. **`check:l4` 仍是红的**（78 > 74，kanban 的既有债），本包没有碰它也没有抬基线。
9. 变动里有一处**跨白名单**（总包已放行）：`packages/i18n/src/locales/{zh-CN,en}.ts` 追加 17 个词条 + `packages/app-host/src/index.ts` 的 1 段 re-export。

---

## 8. 文件主权清单

### 8.1 我改/新建的（都在白名单内，除 §8.2）

| 文件 | 状态 | 为什么 |
|---|---|---|
| `packages/domain/src/entities.ts` | 改 | `Task.exDates?` + `Tag.mergedInto?`（可选字段） |
| `packages/domain/src/recurrence.ts` | 改 | `exDates` 选项 + 五个求值点 + 4 个读写助手 |
| `packages/domain/src/task-order.ts` | 改 | `manualOrderKey` / `manual` 档真排 / `planManualReorder` / `manualOrderBetween` |
| `packages/domain/src/task-filter.ts` | 改 | `FilterContext.tags?` ⇒ 标签筛选走解析（含 `scopeTasks`） |
| `packages/domain/src/tags.ts` | **新建** | 合并别名的**唯一解析入口** |
| `packages/domain/src/index.ts` | 改 | 导出 `tags.js` |
| `packages/domain/tests/{exdates,manual-order,tags}.spec.ts` | **新建** | R3 / R4 / R8 的领域判据（17 + 12 + 12） |
| `packages/app-host/src/actions.ts` | 改 | `skipOccurrence` + `repeatOf` 带 `exDates` + `completeTask` 喂排除集 + `setOrder` 校验 |
| `packages/app-host/src/tag-actions.ts` | **新建** | 合并 / 批量删 / 影响面 |
| `packages/app-host/tests/{skip-occurrence,tag-merge}.spec.ts` | **新建** | 一条 op / 可撤销 / 无残留引用（9 + 9） |
| `packages/ui/src/task-list/TaskList.tsx` | 改 | `renderRowWrapper` 插槽（拖放要"行外面那个节点"） |
| `packages/ui/src/task-list/row-actions.ts` | 改 | 加 `skipOccurrence`、删 `priority`/`moveToProject`/`tags`（11 → 9） |
| `apps/web/src/features/tasks/TaskRowMenu.tsx` | 改 | 加「跳过这一次」；删三个子菜单（R1） |
| `apps/web/src/features/tasks/ManualSortDnd.tsx` | **新建** | 手动排序的拖放外壳（web 独有） |
| `apps/web/src/features/tasks/manual-sort.css` | **新建** | 拖拽手柄的 `cursor`/`touch-action`（挂既有 `.ht-row` 族） |
| `apps/web/src/features/tasks/store.ts` | 改 | 转发 `skipOccurrence` / `setOrder`；`filterTasks` 传 `tags` |
| `apps/web/src/features/tasks/TaskOrganizer.tsx` | 改 | 标签 chip 与勾选走 `resolveTags` / `resolveTagIds` |
| `apps/web/src/features/tags/store.ts` | **新建** | `tagManager`（只转发 app-host） |
| `apps/web/src/features/tags/TagsManager.tsx` | **新建** | 标签管理浮层 |
| `apps/web/src/App.tsx` | 改（**只动与三条需求直接相关的行**） | ①`manualSortActive`/`manualRowWrapper` 两个派生值 ②两处 `TaskList` 外包 `ManualSortWrapper` + `renderRowWrapper` ③`renderTaskTrailing` 里挂 `ReorderHandle` ④`⋯` 里加「管理标签」+ 渲染 `<TagsManager>` ⑤行菜单的 `onSkipOccurrence`/`repeating` 接线 ⑥删除行菜单三项的九条接线（R1）⑦`navCounts` 的 `filterTasks` 传 `tags` |
| `apps/web/tests/task-row-menu.spec.tsx` | 改 | R1 的新判据（反向 + 正向各一组）；删掉 10 条钉旧形状的用例（见 §4） |
| `apps/web/tests/tags-manager-and-manual-sort.spec.tsx` | **新建** | 交付物 ③ 的判据：入口→浮层→合并 1 条 op；拖动 1 条 op |
| `docs/plans/package-b-2026-11.md` | **新建** | 本文件 |
| `docs/plans/r14-entry-table.md` | 改 | 加 3 行（`skipOccurrence`/`reorder`/`manageTags`）、改 3 行（三项收敛成 `保留`）、28 行行号按锚点重定位 |

### 8.2 两处"接的线"（跨白名单，总包已放行）

| 文件 | 改了什么 | 为什么必须在这 |
|---|---|---|
| `packages/i18n/src/locales/zh-CN.ts` + `en.ts` | **追加** 17 个词条（`web.rowMenu.skipOccurrence`、`web.tasks.reorder.handle`、`web.tags.manage.*` 15 个） | `check:ui-language` 要求所有用户可见文案走词条表；仓里没有可复用的（`grep 跳过 / drag` 命中 0 个业务词条）。**只加不改不删**，两边同时加（词条数必须相等） |
| `packages/app-host/src/index.ts` | 1 段 re-export（`createTagManagementActions` 等 5 个名字） | 新建的 `tag-actions.ts` 是白名单内的文件，但 web 只能从 `@heyta/app-host` 入口取 —— 这是"出口"，不是业务语义搬家 |
