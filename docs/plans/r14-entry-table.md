# R14 · 入口表（一个动作该从哪一层出来）

> **上游**：[产品需求对齐清单](ticktick-parity-prd-2026-11.md) R14 · [交接文档](ticktick-parity-handoff-2026-11.md) §3（四个缺陷）
> · [取证：UX 信息架构与入口链路](../research/ticktick-ux-ia-and-entry-paths.md) §2/§3/§7。
> **取证日**：2026-11-06。**范围**：`apps/web/src` + `packages/ui/src`（web 壳与共享层）。
> **判据**：`node scripts/check-entry-table.mjs`（11 条规则，`--self-test` 有 9 条臂 + 阳性对照）。
>
> 这张表**不**回答"哪一屏存在"（[P2 界面地图](../research/ticktick-surface-matrix.md)）、
> **不**回答"菜单里有哪些键"（[P5](../research/ticktick-keyboard-and-menus.md)）、
> **不**回答"四种状态怎么画"（[P7](../research/ticktick-states-and-feedback.md)）。
> 它只回答一件事：**这个动作，用户应该在哪一层找到它；而现在它在哪。**

---

## 0. 这张表怎么用

三个用途，按重要性：

1. **B/C/D 每加一个按钮，先来这里查一行**。表里没有这个动作 ⇒ 先在表里加一行（id、作用域、层级、主入口），
   再动代码。这是 R14 的全部意义：**入口先于功能**。
2. **判"这是缺陷还是取舍"**。「第二入口」那格有位置 + 处置写 `保留` = 判过的取舍（附理由）；
   写 `收敛` = 登记的债（附债的编号）。两者都不是"没人知道有几个"。
3. **判据化**。`r14-entry-table.mjs` 读这张表，逐个核对表里引用的源文件（含 5 个关键源文件），红在 11 条规则之一上。

---

## 1. 两个轴：作用域决定层，代价决定深度

取证反推出的总规则（[§3.1](../research/ticktick-ux-ia-and-entry-paths.md)）压成两句：

- **作用域决定层** —— 这个动作改的是「一个字段的值 / 一条任务 / 一个视图的读法 / 整个应用」。
  它**不是**按"重要不重要"分层。J1–J4 就是这个映射，本文把它写成了**可判红的**形状（脚本 R3）：

  | 作用域 | 只许落在 | 判据（脚本 R3） |
  |---|---|---|
  | 单值（一个字段的值） | 字段层 | `单值 → 字段` |
  | 单条（一条任务本身） | 对象层 | `单条 → 对象` |
  | 多条（一批任务） | 对象层（批量条） | `多条 → 对象` |
  | 全局（与选中无关） | 全局层或视图层 | `全局 → 全局 \| 视图` |

- **代价决定深度**（J5）—— 放错层会不会不可撤销。同一条任务上，「删除」比「放弃」深一档：
  删除进危险区（分隔线以下）+ 有子任务时就地二次确认；放弃不进危险区（可恢复）。
  所以本表里 `abandon` 与 `delete` 都是对象层、都写 `直接`，但**分组不同**：
  删除在分隔线以下（危险组），放弃在以上。这一格由 `groupRowActions()` 判，不由壳判。

**四层的定义**（按"动作改什么"划，不按"重要程度"划）：

| 层 | 它改的是什么 | 本仓的载体 |
|---|---|---|
| 全局 | 与"当前选中哪一条"无关的应用级动作 | rail / 头像菜单 / 设置页 / 快捷键（web 没有系统菜单栏，全局层的载体是外壳常驻控件） |
| 视图 | 一整个视图怎么读（排序/筛选/显示/范围/分享/进入多选） | 页头 `⋯`、批量条、视图页头 |
| 对象 | 一条（或一批）任务本身（完成/删除/移动/结构/状态） | 行菜单、批量条 |
| 字段 | 一条任务的某个字段的值 | 详情面单（`TaskDetailCard`） |

---

## 2. 三列的口径（不写清就没法判）

**类型**（2026-11-06 新增，因为前两版表只能看不能判）：

| 类型 | 含义 | 为什么必须单独标 |
|---|---|---|
| `直接` | 点了就做那件事 | 正常情况 |
| `导航型` | **名字像动作，其实是导航** —— 点了只是把你送到能做那件事的地方 | 它在入口表里长得和真动作一模一样，但它**不是**那个动作的入口。漏标就会得出"加子任务有两个主入口"的错误结论（实际只有一个：面单里的 `SubtaskField`） |
| `隐式` | 用户不觉得自己在改这个字段，但数据被写了 | 入口表最容易漏的一类：四象限拖放顺带写 `dueDate`，用户以为自己在改象限 |
| `缺入口` | 共享层/别端有，web 一处都没有 | A1 的形状。**零入口不会有任何测试变红**，只能靠账本 |

**处置**：`新增`（本包补的）/ `收敛`（有多入口，登记为债，附债号）/ `删除`（本次删掉的）/ `保留`（判过，附理由）/ `未落地`（今天没有入口，登记为边界）。

**第二入口**：`—` 表示没有。有位置时**处置必须是 `保留` 或 `收敛`** —— 脚本 R7 钉这一条，
因为"允许第二入口"必须是**判过**的，不能是默认的（默认就会长成 B5 那样两枚同时在场）。

---

## 3. 入口表（38 行）

> 🔴 每个 `文件:行号` 后面括号里是**锚点**：脚本要求该锚点出现在那一行 ±3 行内。
> 行号会漂，锚点不会 —— 这条规则让表在两周后仍然可信（也是唯一能让"行号写错"变红的办法）。
> ⚠️ **只有这一节（§3）的行号由脚本验锚点**；§4/§5 里的行号是 2026-11-06 的读数，改代码后可能漂。

| 动作 | 作用域 | 应有层级 | 当前入口 | 第二入口 | 类型 | 处置 |
|---|---|---|---|---|---|---|
| 新建任务 `create` | 全局 | 视图 | apps/web/src/App.tsx:3242（CaptureComposer destination={） | apps/web/src/features/calendar/CalendarHeaderToolbar.tsx:154（calendar-capture-toggle） | 直接 | 保留 — 视图层：每个视图自己的采集面（探针 A）；全局只该留一个快捷键，而 web 今天只有 ⌘K 一个全局键（探针 A 把"全局新建键位"标为未核实） |
| 切换视图 `switchView` | 全局 | 全局 | apps/web/src/features/shell/RailNavigation.tsx:111（rail-view-${tab.key}） | apps/web/src/App.tsx:2130（goToView(） · apps/web/src/App.tsx:2345（toLowerCase() !== 'k'） | 直接 | 保留 — rail 是主入口；⌘K 与深链是第二条输入通路（C3 口径：同一入口的不同输入） |
| 全局搜索 `search` | 全局 | 全局 | apps/web/src/App.tsx:2345（toLowerCase() !== 'k'） | apps/web/src/features/shell/RailNavigation.tsx:111（rail-view-${tab.key}） | 直接 | 保留 — J6 的镜像：⌘K 是 rail「搜索」tab 的键盘镜像，不是第二个落点 |
| 设日期 `dueDate` | 单值 | 字段 | apps/web/src/features/tasks/TaskDetailCard.tsx:431（&lt;DueField） | apps/web/src/features/quadrant/QuadrantBoard.tsx:338（setQuadrantDrop） · apps/web/src/App.tsx:3507（onScheduleTask） | 直接,隐式 | 收敛 — 两处**隐式**入口（四象限拖放 / 时间线拖放）会顺带写 dueDate —— 用户不觉得自己在改日期，见 `r14-entry-duplication.md` §3 第 3 条 |
| 删除单条 `delete` | 单条 | 对象 | apps/web/src/features/tasks/TaskRowMenu.tsx:528（data-testid="task-row-menu-delete"） | apps/web/src/features/tasks/TaskDetailCard.tsx:632（task-detail-more）— **同一入口的第二条输入通路**：它 `onShowActions` 打开的是**同一张 `TaskRowMenu`**，不是第二个入口（取证 §1.2 C3「入口 ≠ 输入通路」） | 直接 | 保留 — 判过：入口数 1，通路数 2 |
| 设优先级 `priority` | 单值 | 字段 | apps/web/src/features/tasks/TaskDetailCard.tsx:519（void store.setPriority） | — | 直接 | 保留 — **R1 收敛已落地（B 包，2026-11-06）**：行菜单那枚子菜单（`task-row-menu-priority`）已删，`ROW_ACTION_IDS` 11 → 9。判据=面单里 `store.setPriority(` 恰好 1 处（`apps/web/tests/task-row-menu.spec.tsx` 的 R1 正面判据） |
| 完成单条 `complete` | 单条 | 对象 | packages/ui/src/task-list/TaskRow.tsx:362（task-toggle-${row.id}） | apps/web/src/App.tsx:3312（onToggleTask={） · apps/web/src/features/calendar/CalendarView.tsx:263（onToggleTask={onToggleTask}） · apps/web/src/features/quadrant/QuadrantBoard.tsx:433（onToggleTask={(taskId)） | 直接 | 保留 — 共享行组件一枚勾选框，5 处视图各自接线（探针 B）；批量完成另立一行 |
| 放弃任务 `abandon` | 单条 | 对象 | apps/web/src/features/tasks/TaskRowMenu.tsx:503（data-testid="task-row-menu-abandon"） | — | 直接 | 新增 — A1 的修法：补这一处之前 web 零入口 |
| 取消放弃 `unabandon` | 单条 | 对象 | 未落地 | — | 缺入口 | 未落地 — web 没有「已放弃」视图，恢复入口无处可挂 —— 等 B 包那一档（边界，不是遗漏） |
| 打开详情 `open` | 单条 | 对象 | apps/web/src/features/tasks/TaskRowMenu.tsx:410（data-testid="task-row-menu-open"） | apps/web/src/App.tsx:3308（onOpenTask={openTask}） | 直接 | 保留 — 点行与右键是两条输入通路，落点同一个（`openTask`） |
| 置顶 `pin` | 单条 | 对象 | apps/web/src/features/tasks/TaskRowMenu.tsx:439（data-testid="task-row-menu-pin"） | — | 直接 | 保留 — 与 `unpin` **同一个槽位的两副面孔**（一个控件、两个 id），宿主按当前态只给一副 |
| 取消置顶 `unpin` | 单条 | 对象 | apps/web/src/features/tasks/TaskRowMenu.tsx:439（data-testid="task-row-menu-pin"） | — | 直接 | 保留 — 同上：与 `pin` 共用一个控件 |
| 移动清单 `moveToProject` | 单值 | 字段 | apps/web/src/features/tasks/TaskDetailCard.tsx:473（void store.moveToProject） | — | 直接 | 保留 — **R1 收敛已落地（B 包，2026-11-06）**：行菜单那枚子菜单（`task-row-menu-move`）已删；批量移清单仍另立一行（作用域不同：多条 → 对象层） |
| 加子标签 `tags` | 单值 | 字段 | apps/web/src/features/tasks/TaskDetailCard.tsx:476（void store.setTags） | — | 直接 | 保留 — **R1 收敛已落地（B 包，2026-11-06）**：行菜单那枚子菜单（`task-row-menu-tags`）与它的「新建标签」草稿一并删掉。标签的**管理**动作另立一行（`manageTags`）—— 那与「给一条任务加标签」是不同作用域 |
| 加子任务 `addSubtask` | 单条 | 对象 | apps/web/src/features/tasks/TaskDetailCard.tsx:488（&lt;SubtaskField） | apps/web/src/features/tasks/TaskRowMenu.tsx:458（data-testid="task-row-menu-add-subtask"） | 直接,导航型 | 保留 — 🔴 行菜单那一枚是**导航型**：它只 `openTask`，不建任务（抽查已复核，见 §4） |
| 跳到字段（面单工具条） `gotoField` | 单条 | 对象 | apps/web/src/features/tasks/TaskDetailCard.tsx:609（data-testid="task-detail-goto-list"） | — | 导航型 | 保留 — 导航型：只把焦点交给那一格（`focusInPane`），**不写任何东西**；同族还有 `task-detail-goto-note` |
| 加提醒 `reminder` | 单值 | 字段 | apps/web/src/features/tasks/TaskDetailCard.tsx:452（&lt;ReminderField） | — | 直接 | 保留 — 行上无徽标能看见"这条有提醒"（A3 的已知边界） |
| 设重复 `repeat` | 单值 | 字段 | apps/web/src/features/tasks/TaskDetailCard.tsx:545（&lt;RepeatField） | — | 直接 | 保留 |
| 写备注 `note` | 单值 | 字段 | apps/web/src/features/tasks/TaskDetailCard.tsx:410（void store.setNote） | — | 直接 | 保留 — 面单收起时行尾那颗 chip 是同一落点的第二条通路（`noteInColumn` 的反向） |
| 改标题 `title` | 单值 | 字段 | apps/web/src/features/tasks/TaskDetailCard.tsx:362（void store.renameTask） | — | 直接 | 保留 |
| 进入多选 `select` | 全局 | 视图 | apps/web/src/App.tsx:3077（testID="task-select-open"） | — | 直接 | 保留 — web 的多选是**视图层**的一档（页头 `⋯` 里进入、批量条接管），所以行菜单里不重复一枚 |
| 排序 `sort` | 全局 | 视图 | apps/web/src/App.tsx:3052（task-sort-${key}） | — | 直接 | 保留 — 视图属性，与选中无关（J3）；空列表也在 |
| 共享清单 `share` | 全局 | 视图 | apps/web/src/App.tsx:3138（testID="share-open-button"） | — | 直接 | 保留 — 条件：只停在自己的清单且同步已配置 |
| 助手 `assistant` | 全局 | 视图 | apps/web/src/features/shell/RailNavigation.tsx:471（rail-assistant） | apps/web/src/App.tsx:3091（testID="assistant-open"） | 直接 | 保留 — 第二处只在详情列收起时出现（互斥条件成立，B6） |
| 详情栏开关 `detailPaneToggle` | 全局 | 视图 | apps/web/src/App.tsx:3153（data-testid="detail-pane-toggle"） | — | 直接 | 收敛 — B5 的修法：`⋯` 里那枚「展开详情栏」已删，收起态只剩页头这一枚（见 §5） |
| 开设置 `settings` | 全局 | 全局 | apps/web/src/features/shell/AccountMenu.tsx:359（web.shell.account.settings） | apps/web/src/App.tsx:2629（onOpenSettings={） | 直接 | 保留 — 头像菜单是主入口；AI / 同步 / 帮助 / 深链各自只带锚点跳转（探针 B） |
| 批量完成 `bulkComplete` | 多条 | 对象 | apps/web/src/App.tsx:2870（data-testid="bulk-complete"） | — | 直接 | 保留 — 只完成、不能取消 —— 与单条完成是**不同语义**，登记为债（`r14-entry-duplication.md` §2） |
| 批量删除 `bulkDelete` | 多条 | 对象 | apps/web/src/App.tsx:2924（data-testid="bulk-delete"） | — | 直接 | 保留 |
| 批量移清单 `bulkMove` | 多条 | 对象 | apps/web/src/App.tsx:2887（web.shell.bulk.move） | — | 直接 | 保留 |
| 退出多选 `bulkExit` | 全局 | 视图 | apps/web/src/App.tsx:2933（data-testid="bulk-exit"） | — | 直接 | 保留 |
| 改主题 `theme` | 全局 | 全局 | apps/web/src/App.tsx:3883（data-testid="theme-toggle"） | — | 直接 | 保留 — 在设置 → 显示里（全局层的载体是"开设置"那一处）；`rememberThemeChoice` 是唯一记账点 |
| 开专注 `focusStart` | 全局 | 视图 | apps/web/src/features/focus/FocusTimer.tsx:269（onStart={） | — | 直接 | 保留 |
| 加习惯 `habitCreate` | 全局 | 视图 | apps/web/src/features/habits/HabitsView.tsx:311（habits-add-open） | — | 直接 | 保留 |
| 归档清单 `archiveProject` | 单条 | 对象 | apps/web/src/features/projects/ProjectsPanel.tsx:354（onArchive） | — | 直接 | 保留 — 侧栏组织器那一层（`archive: { button … }`） |
| 导入 `import` | 全局 | 全局 | apps/web/src/features/settings/ImportPanel.tsx:116（data-testid="import-run"） | — | 直接 | 保留 — 设置 → 数据；与「滴答导入」是两个面板 |
| 导出 `export` | 全局 | 全局 | apps/web/src/features/settings/ExportPanel.tsx:111（data-testid="export-json"） | — | 直接 | 保留 |
| 加附件 `attachment` | 单条 | 对象 | 未落地 | — | 缺入口 | 未落地 — `grep -rn attach apps/web/src/features/tasks` = 0；附件只在 AI 面板（`features/ai/ImageAttach.tsx`）里存在，不是任务附件 |
| 清空回收站 `emptyTrash` | 多条 | 对象 | 未落地 | — | 缺入口 | 未落地 — web 只有**逐条**彻底删除（`features/trash/TrashView.tsx` 的 `run(id, kind, "purge")`），没有批量清空 |
| 跳过这一次 `skipOccurrence` | 单条 | 对象 | apps/web/src/features/tasks/TaskRowMenu.tsx:477（data-testid="task-row-menu-skip-occurrence"） | — | 直接 | 新增 — B 包 R3。只在**有生效重复规则**时出现（`repeating`，判据在领域层 `repeatOf`）。代价低于删除：一条普通单实体 `UPD`，⌘Z 可撤销 ⇒ 不进危险组（J5） |
| 手动拖拽排序 `reorder` | 全局 | 视图 | apps/web/src/features/tasks/ManualSortDnd.tsx:137（data-testid="task-reorder-handle"） | — | 直接 | 新增 — B 包 R4①。作用域=全局（顺序与"选中哪一条"无关，J3）⇒ 视图层。只在「手动拖拽」档位出现（那一档由 `⋯` 的 `task-sort-manual` 选，**那是档位不是入口**）；一次拖动 = **一条** op（`planManualReorder` 的 `move`） |
| 管理标签 `manageTags` | 全局 | 视图 | apps/web/src/App.tsx:3069（testID="manage-tags-open"） | — | 直接 | 新增 — B 包 R8。全局作用域、落在视图层（J1 允许 `全局 → 全局 \| 视图`）；粒度是"一次操作"不是"一屏"，所以不新开 `ViewKey`（那会连带选中立场 / 键盘光标 / rail 期望表三处登记） |

---

## 4. 抽查：探针那三条判据，我复核了两条、纠偏一条

派单给了 [探针 A](r14-probe-a.md) / [探针 B](r14-probe-b.md) 的 8 个动作，并点了三条判据要求复核。
逐条给读数：

### 4.1 ✅ 复核通过：「添加子任务」在行菜单里是**导航型**，不建任务

- 入口：`apps/web/src/features/tasks/TaskRowMenu.tsx:619`（`data-testid="task-row-menu-add-subtask"`）
- 接线：`apps/web/src/App.tsx:4008` `onAddSubtask={(parentId) => { … openTask(parentId); }}`
- 结论：**它只 `openTask`，一条 op 都不写**。真正的建子任务入口是面单里的
  `apps/web/src/features/tasks/TaskDetailCard.tsx:488`（`SubtaskField`）。
- 所以表里 `addSubtask` 的主入口是**面单**，行菜单那枚标 `导航型`。
  若不标，这张表会得出"加子任务有两个主入口"的假结论 —— 那正是"只能看不能判"。

⚠️ **探针 A 的行号已经漂了**（它写 `App.tsx:3986`）：那是**我改 App.tsx 之前**的行号。
本表统一用锚点定位，所以不受影响；引用探针的行号时请以本表为准。

### 4.2 ✅ 复核通过：四象限 / 时间线拖放**隐式**写 `dueDate`

- `apps/web/src/features/quadrant/QuadrantBoard.tsx:342` `await store.setQuadrantDrop(taskId, plan)`
  —— 同一处 `:346` 用 `plan.dueDateChange === undefined` 决定提示文案，即这个 plan **确实带日期变更**；
- `apps/web/src/App.tsx:3418` `onScheduleTask` → `store.setSchedule`（时间线拖放，同样写日期/时长）。
- 结论：**存在隐式入口**，且用户界面只说"拖到了哪个象限/哪一天"，不会说"你改了截止日期"。
  表里 `dueDate` 那行类型写 `直接,隐式`，处置 `收敛`（债-3）。

### 4.3 ⚠️ 纠偏：「删除单条只有行菜单一个入口」——**入口数对，通路数不对**

- 探针说"面单与键盘都没有删除入口"。**入口数 1 成立**，但要说清两点：
  1. 面单工具条**有**一枚「任务操作」按钮（`TaskDetailCard.tsx:632` `data-testid="task-detail-more"`），
     它 `onShowActions(task.id, …)` → `openRowMenuAt` → **同一张 `TaskRowMenu`**。
     按取证 §1.2 C3 的口径（「入口 ≠ 输入通路」），这是**同一个入口的第二条输入通路**，不是第二个入口。
  2. 键盘：行上只接了 `ContextMenu` / `Shift+F10`（`App.tsx` 的 `handleTaskRowKeyDown`），
     **没有** `Delete` 键 —— 这一半探针是对的。
- 结论：表里 `delete` 的第二入口写的是那条通路，并注明"不计入口数"。
  **口径不写清，下一轮就会有人把它当成重复入口删掉。**

### 4.4 顺带记一笔：面单工具条前两枚也是**导航型**

`task-detail-goto-list`（`:609`）/ `task-detail-goto-note`（`:620`）只做 `focusInPane(...)`：
把焦点交给那一格，不写任何东西（`TaskDetailCard.tsx:600-603` 的注释自己写着这条）。
表里 `gotoField` 一行就是给这一族留的位置。

---

## 5. 三个已修缺陷：改了什么、读数是多少

### 5.1 B5 · 详情栏开关在收起态**两枚同时在场** → 只剩一枚

| 项 | 读数 |
|---|---|
| 缺陷 | 页头 `data-testid="detail-pane-toggle"` 只判 `canToggleDetailPane`（`App.tsx:1360`）；`⋯` 里那枚 `detail-pane-open` 才判 `!detailColumnShown` ⇒ **收起态两枚都在**，点哪个都展开 |
| 代码与注释分家 | 注释（原 `:3026`）写"页头那枚图标让位给助手"，而**代码没让位** —— 注释替一个不存在的实现做了担保 |
| 裁决 | **留页头那枚（它是开关，`aria-pressed`，两态都可达），删 `⋯` 里那枚** |
| 理由 1 | 删页头那枚会让「收起」**不可达**（`⋯` 那枚只能展开）—— 那是把重复换成功能缺失 |
| 理由 2 | `scripts/check-surface-budget.mjs` 的页头预算写的就是「`⋯` + 一枚结构开关」；页头那枚是被预算量的那件，`⋯` 那枚住在菜单里、预算看不见它 |
| 理由 3 | R2「入口账本只减不增」：重复要减，减掉能力更弱的那个落点 |
| 读数 | 剥注释后 `testID="detail-pane` 出现 **0** 次；`data-testid="detail-pane-toggle"` 恰好 **1** 处（脚本 R10 钉住，臂 7 证明它会红） |

### 5.2 A1 · 「放弃任务」web 零入口 → 一处对象层主入口

| 段 | 位置 |
|---|---|
| 词汇 | `packages/ui/src/task-list/row-actions.ts:57`（`ROW_ACTION_IDS`，其中 `:65` `'abandon'`、`:66` `'unabandon'`） |
| 入口 | `apps/web/src/features/tasks/TaskRowMenu.tsx:775`（`data-testid="task-row-menu-abandon"`），点击 `:777` `onSetAbandoned?.(taskId, !abandoned)` |
| 接线 | `apps/web/src/App.tsx:4049` `onSetAbandoned={(id, abandoned) => { void useTaskStore.getState().setAbandoned(id, abandoned); }}`；当前态 `:4053` `abandoned={isAbandoned(rowMenuTask)}` |
| 转发 | `apps/web/src/features/tasks/store.ts:400` `await taskActions.setAbandoned(id, abandoned)` |
| **同一个 action** | `packages/app-host/src/actions.ts:870` `async setAbandoned(entityId, abandoned)` —— **与移动端 `TasksScreen.tsx` 调的是同一个**，不是另写一条 op |
| 判据 | 新用例 `apps/web/tests/task-row-menu-abandon.spec.tsx`（6 条，全部通过）；删掉 `case 'abandon'` 立刻红 |
| 层级 | 对象层（J2：改的是一条任务本身的状态），代价低于删除 ⇒ 不进危险区（J5） |
| 登记 | 表里 `abandon` 处置 `新增`；`unabandon` 处置 `未落地`（web 没有「已放弃」视图，恢复入口无处可挂 —— 边界，不是遗漏） |

### 5.3 C2 · 两套行动作词汇表 → 共享层一份，web 只渲染

| 项 | 改前 | 改后 |
|---|---|---|
| id 集合 | 共享层 7 个（`open/pin/unpin/abandon/unabandon/select/delete`）vs web 行菜单 7 项（打开/优先级/移动/加子任务/标签/删除/置顶）**交集 3** | `ROW_ACTION_IDS` **11 个**（多 `priority/moveToProject/addSubtask/tags`），**唯一一份** |
| 顺序 | 共享层另有一个 6 项 `ROW_ACTION_ORDER`，与 7 个 id 不等长 | 顺序 = `ROW_ACTION_IDS`，`ROW_ACTION_ORDER` 已删 |
| 分组 / 危险档 | web 自己决定分隔线位置 | `groupRowActions()` 决定 |
| web 的职责 | 自己写一份清单 + 自己排 | **只渲染**：`ROW_ACTION_IDS.flatMap(...)` 给内容，`renderRowAction(id)` 画 |
| 判据 | 无 | 脚本 R9：每个 id 字面量必须出现在 `case` 标签里；`hostContentOf`/`renderRowAction` 必须覆盖全部 id；`case` 里不许有共享层没有的 id |

---

## 6. 五条可判红规则（取证 §7）+ 现量

| # | 规则 | 今天能红的判据 | 现量 |
|---|---|---|---|
| R1 | 一个字段只有一个**编辑落点** | `apps/web/tests/task-detail-card.spec.tsx:817`（截止）；本表「第二入口 + 处置=收敛」把其余字段的债显式登记 | 截止 ✅ 1 处；优先级 / 清单 / 标签 ⚠️ 各 2 个落点（登记为债，见 `r14-entry-duplication.md`） |
| R2 | 入口账本**只减不增** | 本表 + `r14-entry-table.mjs`（新增一行/删一行都要改表） | 38 行动作，其中 8 行有第二入口（`保留` 5 / `收敛` 3） |
| R3 | 全局层只许放**镜像** | 本表 `search`（⌘K ↔ rail tab）、`settings`（头像菜单 ↔ 各处跳转）两行的「第二入口」写明"同一入口的另一条输入" | 绿（未发现"只从全局可达"的动作） |
| R4 | 空态动作必须是**非空态已有**的同一入口 | `apps/web/tests/empty-state-action.spec.tsx`（空态槽默认不画） | 绿（空集：web 空态要么不给动作，要么给的是别处也有的"新建"） |
| R5 | 从主界面到"改一条任务" ≤ **3 层** | ✅ **已测**（`e2e/tests/r5-entry-depth.spec.ts`，真浏览器 5 passed）：三条基线链路**都是 2 层**，全部 ≤ 3 | 口径：**层 = 1 + 同屏可见的可交互表面数**（主界面算第 1 层），与取证 §4 一致。⚠️ 两处口径差写在那个 spec 的文件头：R5 原文那三个选择器**看不见详情列**（它是 `<aside>`），而取证 §4.2 把详情算一层 ⇒ 本表按取证算 |

---

## 7. 判据：脚本怎么用、怎么变红

```sh
node scripts/check-entry-table.mjs              # 判当前工作树（11 条规则）
node scripts/check-entry-table.mjs --self-test  # 9 条臂 + 阳性对照
HEYTA_CHECK_ROOT=/tmp/x node scripts/check-entry-table.mjs   # 判副本（故障注入用）
```

**每条规则怎么才会红**（与 `--self-test` 的臂一一对应）：

| 规则 | 怎么让它红 | 臂 |
|---|---|---|
| R2 | **把一行复制一遍**（同一动作两行、各一个主入口） | 臂 1 |
| R6 | 在一行的「当前入口」里塞两个 `文件:行号` | 臂 2 |
| R3 | 把 `设日期` 的作用域改成 `单条`（单条只许对象层） | 臂 3 |
| R6 | 把路径改成不存在的文件 | 臂 4 |
| R6 | 行号不动、锚点抄错 | 臂 5 |
| R8 | 删掉 `abandon` 那一行（共享词汇表有 id 没登记） | 臂 6 |
| R10 | 把 `⋯` 里那枚详情栏开关加回 `App.tsx` | 臂 7 |
| R9 | 在 `TaskRowMenu.tsx` 里另立一份 id 数组 | 臂 8 |
| R11 | 让 `store` 不再转发 `setAbandoned` | 臂 9 |
| R1 / R4 / R5 / R7 | 删行到 <20 / 类型写错枚举 / 处置写错枚举 / 有第二入口却写 `新增` | 未做成臂（低频，且都是纯文本断言；加臂的成本大于收益） |

---

## 8. 未核实（这一节是待办，不是免责）

| # | 未核实的事 | 为什么核不了 | 核它需要什么 |
|---|---|---|---|
| 1 | ~~R5「≤ 3 层」的现量~~ | ✅ **已测（2026-11-06，`e2e/tests/r5-entry-depth.spec.ts`，5 passed / 20.0s）** | 见下表的逐链路读数 |
| 2 | 「已放弃」视图与 `unabandon` 的落点 | web 没有这一屏，B 包才有 | B 包落地后回填本表一行 |
| 3 | 移动端（`apps/mobile`）的入口表 | 本表范围只有 `apps/web/src` + `packages/ui/src` | 另一份表；共享层 id 已是两端的公共词表，可直接复用 |
| 4 | 桌面端托盘 / 全局热键（`apps/desktop`）的镜像关系 | 不在本包文件主权内，且 C-① 正在改 | 与 C-① 对表后补 |
| 5 | 附件（`attachment`）是否有产品决策 | web 零实现（`grep -rn attach apps/web/src/features/tasks` = 0） | 产品决策；在那之前本表写 `未落地`，不写"缺" |
| 6 | 「清空回收站」是否要做 | 今天只有逐条彻底删除 | 同上 |
**R5 逐链路现量**（2026-11-06，真浏览器，`HEYTA_E2E_APP_PORT=4428`）：

| 链路 | 点击 | 层 | 那一层是什么 |
|---|---|---|---|
| ① 新建一条任务 + 设日期 | **4**（输入框 1 / 日期胶囊 1 / 月份格子 1 / 提交 1） | **2** | 主界面 1 + `dialog:capture-due-popover` |
| ①b 同一条 + 设优先级（字段层） | **1**（点行开详情；native select 不计 —— 按取证 §4 的计数法算上"选一档"是 **2**） | **2** | 主界面 1 + `detail-column` |
| ② 打开详情改子任务归属 | **1**（同上，算上"选一档"是 **2**） | **2** | 主界面 1 + `detail-column` |
| ③ 设置里改一个外观项 | **4**（头像 1 / 设置 1 / 外观分组 1 / 主题开关 1） | **2** | 主界面 1 + `dialog:settings-sheet` |

🔴 **仪器自检**（这条比读数重要）：空主界面读到 **1 层**；把三层 `role="dialog"` 叠上去读到 **4 层**
—— 所以"全是 2 层"不是尺子坏了。那个 spec 的第一版写的是"命中就 break"，三层只读到 1 层，**被自检当场抓住**。

| 7 | ~~这道门禁还没进 `pnpm check:*`~~ | ✅ **已接（总包，2026-11-06）** | 落成 `"check:entry-table": "node scripts/check-entry-table.mjs --self-test && node scripts/check-entry-table.mjs"` 并挂进 `check` 链（紧接 `check:row-single-source`）。脚本同时从 `docs/plans/` 搬到 `scripts/`，与其余门禁同址 —— 顺带让它落进 `check:scripts-parse` 的覆盖。`check:gate-wiring` rc=0（它会红在"定义过但没进链"这条上） |

---

## 9. 文件主权：本包改了什么、哪两处是"接的线"

E 包的独占路径（[交接文档](ticktick-parity-handoff-2026-11.md) §2）：
`docs/plans/r14-entry-table.md` · `packages/ui/src/**/row-actions*` · `apps/web/src/features/tasks/TaskRowMenu.tsx` · `apps/web/src/App.tsx`（只改入口相关行）。

| 文件 | 状态 | 改了什么 | 谁接的 |
|---|---|---|---|
| `docs/plans/r14-entry-table.md` + `.mjs` | 新增 | 本表 + 门禁（11 条规则 / 9 臂） | E |
| `packages/ui/src/task-list/row-actions.ts` | 改 | `ROW_ACTION_IDS`（11 个 id，唯一一份）+ 顺序同源 | E（独占路径） |
| `apps/web/src/features/tasks/TaskRowMenu.tsx` | 改 | 只渲染：`ROW_ACTION_IDS.flatMap` + `renderRowAction(id)`；新增 `abandon` 项 | E（独占路径） |
| `apps/web/src/App.tsx` | 改 | ① 删 `⋯` 里那枚详情栏开关（B5）② `onSetAbandoned` / `abandoned` 接线（A1） | E（只动入口相关行） |
| `apps/web/tests/task-row-menu-abandon.spec.tsx` | 新增 | A1 的 6 条行为判据 | E |
| **`packages/ui/src/index.ts`** | 改 **1 行** | 导出 `ROW_ACTION_IDS` | **E 接的线**（总包 2026-11-06 批准） |
| **`apps/web/src/features/tasks/store.ts`** | 改 **+8 行** | `setAbandoned` 声明 + 转发 | **E 接的线**（总包批准） |

**两处"接的线"为什么必须在这里**（下一轮读这份表的人要知道这条线是谁接的，别再来一遍）：

1. **`packages/ui/src/index.ts` 的 1 行导出** —— 共享层不导出 `ROW_ACTION_IDS`，web 就只能自己抄第二份 id 列表，
   而那正是 C2 的成因（两套词汇表）。所以"导出"不是顺手改，它是**唯一一份词汇表能不能被消费**的前提。
   判据：脚本 R9 要求 `TaskRowMenu.tsx` 出现 `ROW_ACTION_IDS` 且每个 id 字面量只出现在 `case` 标签里。
2. **`apps/web/src/features/tasks/store.ts` 的 `setAbandoned`** —— 这个文件的既有契约写在它自己的文件头：
   「把界面意图转交给 `@heyta/app-host` 的 `createTaskActions`」。新加的 8 行**只转发**，
   不写 op、不预读状态、不吞错（幂等边界在 `TaskActions.setAbandoned`）。
   🔴 判据：如果这里出现 `entityType: 'TASK'` 或 `dispatchIntent`，那就越界成了第二套写路径
   （`check:layering` 的 `no-op-construction-in-apps` 会红）。

---

## 10. 与既有文档的关系（不重复，只对账）

| 那一份 | 它管什么 | 本表管什么 |
|---|---|---|
| [取证：入口链路](../research/ticktick-ux-ia-and-entry-paths.md) | 它（滴答）的四层、J1–J6、三条链路读数 | **我们**的每一行落在哪、有几个入口、欠哪笔债 |
| [探针 A](r14-probe-a.md) / [探针 B](r14-probe-b.md) | 8 个动作的入口清单（含链路与 store 方法） | 并进 38 行，并补「类型」这一列（导航型 / 隐式 / 缺入口） |
| [主入口重复度盘点](r14-entry-duplication.md) | 4 个动作（abandon / complete / priority / dueDate）的重复度 | 覆盖 38 行；那 4 行的债号与收敛建议直接引用它 |
| [`ux-principles.md`](../agents/ux-principles.md) | 界面**解剖**（一档高度 / 一行一容器 / 配置收起） | 补它缺的那一层：**动作该在哪一层** |
| [`overlay-feedback.md`](../agents/overlay-feedback.md) | 浮层**行为**（怎么关、多危险） | 只碰"浮层在层级里的位置"，关法不重复 |
