# R14 · 主入口重复度盘点（abandon / complete / priority / dueDate）

判据只有一条：**同一个动作有几个互不相同的主入口**。两个入口指向同一个 store 方法，
仍然是两个入口 —— 复用调用链不等于复用入口。

盘点方法：`grep -rniE 'abandon|complete|priority|dueDate'` 于 `apps/web/src` 与
`packages/ui/src`，只把**真的会写数据的那个控件/手势**算入口；读字段做显示的
（徽章、描边色、筛选条件、活动流）一律不算。日期 2026-11-06。

---

## 1. 动作 × 触发点

| 动作 | 触发点(文件:行号) | 层级 | 是否与另一处同一 action |
|---|---|---|---|
| complete | `apps/web/src/App.tsx:3220` | Web 壳 · 平铺列表行勾选 | 是 → `store.toggleComplete`（`features/tasks/store.ts:338`） |
| complete | `apps/web/src/App.tsx:3292` | Web 壳 · 分组列表行勾选（与上一行互斥渲染） | 是 → 同上 |
| complete | `apps/web/src/App.tsx:3344` | Web 壳 · 搜索面板行勾选 | 是 → 同上 |
| complete | `apps/web/src/features/calendar/CalendarView.tsx:197` | Web 特性视图 · 日历条目 | 是 → 同上 |
| complete | `apps/web/src/features/quadrant/QuadrantBoard.tsx:434` | Web 特性视图 · 四象限卡片 | 是 → 同上 |
| complete | `apps/web/src/App.tsx:2812` → `:641` | Web 壳 · 批量工具栏「完成」 | 否，走 `bulkSetCompleted`（`store.ts:343`），且**只完成、不能取消** |
| complete | `packages/ui/src/task-list/TaskRow.tsx:360` | 共享行组件 · `onPress` → `onToggleTask` prop | 是，宿主注入；Web 侧的接线点即上表 5 行 |
| priority | `apps/web/src/features/tasks/TaskRowMenu.tsx:383` | Web 壳 · 行右键/上下文菜单的优先级子菜单 | 是 → `store.setPriority`（`store.ts:380`，接线在 `App.tsx:3981`） |
| priority | `apps/web/src/features/tasks/TaskDetailCard.tsx:519` | Web 特性 · 面单里的原生 select | 是 → 同上 |
| priority | `apps/web/src/features/ai/AiPrioritize.tsx:113` | Web 特性 · AI 建议确认后批量写入 | 是 → 同上 |
| priority | `packages/ui/src/task-list/TaskRow.tsx:306`、`priority-color.ts` | 共享层 · 只读取档位算描边色 | **不是入口**，纯显示 |
| dueDate | `apps/web/src/features/tasks/TaskDetailCard.tsx:435` | Web 特性 · 面单 `DueField`（快捷项 + 月历 + 清除，写点在 `DueEditor.tsx:183/197`） | 是 → `store.setDueDate`（`store.ts:405`，调用在 `:436`） |
| dueDate | `apps/web/src/features/quadrant/QuadrantBoard.tsx:342` | Web 特性 · 四象限**拖放隐式**写 dueDate | 是，但走 `store.setQuadrantDrop`（`store.ts:397`）合并 op，不是 `setDueDate` |
| dueDate | `apps/web/src/features/capture/CaptureComposer.tsx:283` | Web 特性 · 快速添加的 due chip（面板在 `packages/ui/src/capture/CaptureDuePanel.tsx:280/329/346/381`） | 否，随创建一次写入，不经过 `setDueDate` |
| dueDate | `apps/web/src/features/reminders/ReminderPanel.tsx:176` | Web 特性 · 只读 `hasDueDate` 决定提醒档位 | **不是入口** |
| abandon | `packages/ui/src/task-list/row-actions.ts:44`、`:83` | 共享层 · 动作**词表**（`RowActionId` 与一级菜单顺序） | 无触发点可并 |
| abandon | `packages/ui/src/task-list/activity-model.ts:53`、`:80` | 共享层 · 活动流字段名 | **不是入口** |
| abandon | 未核实 | `apps/web/src` 全域 grep **零命中**；`swipeActions` / `onLongPressTask` / `RowAction` 在 web 也零引用 | web 无入口，移动端入口未在本次 grep 范围内核实 |

---

## 2. 重复项（≥2 个互不相同的主入口）

- **complete —— 6 个入口。** 勾选框在平铺列表、分组列表、搜索面板、日历、四象限各接了一次
  `toggleComplete`（前三处是同一个 `TaskList` 的不同渲染分支，后两处是各自视图自己接的线）；
  批量工具栏是第六个，且语义只覆盖单向，等于同一动作的第二副面孔没有对齐。
- **priority —— 3 个入口。** 行菜单子菜单、面单 select、AI 确认写入。前两个是并列的
  手动入口（同一字段、两套控件形状、两套词条），第三个至少还过用户确认。
- **dueDate —— 3 个入口。** 面单 `DueField`、四象限拖放（隐式）、快速添加 chip。
  拖放那一支改的是同一个字段但走另一个 store 方法，用户看不见"我在设截止日期"。
- **abandon —— 不算重复项。** 它只有一个**词表定义**，web 侧一个入口都没有；
  问题是缺入口，不是重复入口。

---

## 3. 收敛建议（3 条）

1. **complete：把「哪个视图能勾选」收成一个声明。** 五个视图各自接 `onToggleTask`，
   就必然各自决定勾选框的尺寸、禁用条件与撤销回执；让视图只消费
   `packages/ui/src/task-list/TaskRow.tsx:360` 的那一枚（宿主只注入回调），
   批量工具栏复用同一条判断，别再写"只完成不取消"的第二套语义。
2. **priority：只留一个手动入口。** 面单 select（`TaskDetailCard.tsx:519`）与行菜单子菜单
   （`TaskRowMenu.tsx:383`）保留一个 —— 建议留面单（它是字段编辑的唯一归宿，
   也是注释里承认的"此前只有 AI 写入"后补的那一刀），行菜单那一项改成跳面单；
   两处共用 `store.setPriority` 不代表可以共用屏幕。
3. **dueDate：拖放不许静默改字段。** `QuadrantBoard.tsx:342` 在改 `important` 时顺带改
   `dueDate`，用户从没有第二处告诉你这件事；要么拖放后给出可见回执，要么把 dueDate
   那半段收回去只改 `important`。顺带清理 `DueEditor.tsx:210` 的 `DueEditor` —— 它
   只有导出、零调用点（grep 无 `<DueEditor`），而文件头注释把它写成"编辑本体"，
   读代码的人会以为还有第三个入口。
