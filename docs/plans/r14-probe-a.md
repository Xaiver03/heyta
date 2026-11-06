# R14 · 探针 A：四个动作的入口层级（新建任务 / 设日期 / 删除单条 / 切换视图）

只列**真的会写数据或真的会换画面**的控件；读字段做显示的不算。层级口径：
**全局** = 外壳任何视图都在；**视图** = 当前视图的页头/工具栏；**对象** = 那一行/那张卡；
**字段** = 面单里那一格。日期 2026-11-06，范围 `apps/web/src` + `packages/ui/src`。


> ⚠️ **本文件的 `文件:行号` 已漂，别直接引用。**
> 2026-11-06 晚 E 包改了 `App.tsx`（删 B5 那枚、接 A1）与 `TaskRowMenu.tsx`，
> 本文件的探针行号整批下移（例：行菜单→`openTask` 从 `App.tsx:3986` 变 `:4008`）。
> **唯一真源是 [`r14-entry-table.md`](r14-entry-table.md)** —— 它写的是
> `文件:行号（锚点）`，由 `scripts/check-entry-table.mjs` 验"锚点必须在 ±3 行内"，
> 行号漂了会红。本文件保留原样，只当"当时是怎么盘的"的考古记录。

| 动作 | 应有层级 | 当前入口(文件:行号) |
|---|---|---|
| 新建任务 | 视图（每个视图自己的采集面）；全局只该留一个快捷键 | `apps/web/src/App.tsx:3152` → `features/capture/CaptureComposer.tsx:282` → `features/tasks/store.ts:328`（任务视图采集条）· `features/calendar/CalendarHeaderToolbar.tsx:151` → `features/calendar/store.ts:182` → `features/calendar/CalendarCapturePopover.tsx:113`（日历页头「+」）· `features/calendar/CalendarView.tsx:151`（日历点空白格）· `App.tsx:3404` `onCreateAt`（时间线/看板点空白建带日期）· `features/tasks/TaskRowMenu.tsx:475` → `App.tsx:3986`（行菜单「添加子任务」，实为 `openTask` 打开面单，**不建任务**）· 全局快捷键：**未核实**（web 无任何新建键位，`App.tsx:2284` 只有 ⌘K 搜索） |
| 设日期 | 字段（面单那一格 + 行尾 chip）；视图级手势不许静默写字段 | `features/tasks/TaskDetailCard.tsx:431`（`DueField` 定义 `features/tasks/DueEditor.tsx:125`，写点 `:183`/`:197`，调用 `TaskDetailCard.tsx:436`）→ `store.ts:405` · `packages/ui/src/capture/CaptureDuePanel.tsx:280`（采集框 due 面板，随创建一次写入，不走 `setDueDate`）· `features/quadrant/QuadrantBoard.tsx:342` → `store.ts:397` `setQuadrantDrop`（**拖放隐式改 dueDate**）· `App.tsx:3396` `onScheduleTask` → `store.setSchedule`（时间线拖放）· 面单以外无独立删除日期入口：清除在 `DueEditor.tsx:197` 那支 |
| 删除单条 | 对象（行菜单 / 面单动作区，同一份确认与回执）；批量归视图工具栏 | `features/tasks/TaskRowMenu.tsx:294`（按钮 `:630`）→ `App.tsx:1746` `deleteTaskWithReceipt` → `store.ts:347` · `App.tsx:643` `bulkDeleteTask`（批量工具栏，同一意图的第二副面孔）· 面单 `TaskDetailCard.tsx`：**无删除入口**（该文件只有 `:319` 的软删注释）· 键盘 `Delete`：**未核实**（web 行键盘只接 `ContextMenu`/`Shift+F10`，`App.tsx:1835`） |
| 切换视图 | 全局（rail / 外壳一处）；视图内部的子模式算视图级 | `features/shell/RailNavigation.tsx:427` `activate` → `App.tsx:2565` → `App.tsx:2032` `goToView`（`setView` 在 `:2044`）· `App.tsx:2697`（侧栏底部「工具」那一条 `goToView` —— 它只在任务视图存在）· `App.tsx:2291`（⌘K → `goToView('search')`）· `App.tsx:2915`（日历页头 → `goToView('timeline')`）· `features/calendar/CalendarHeaderToolbar.tsx:178` → `features/calendar/store.ts:173`（日历 day/week/month/year，视图级）· `features/countdown/CountdownView.tsx:297`（倒数日 active/all，视图级、另起一份 `useState`）· 设置页多路 `setView('settings')`：`App.tsx:1041`/`:1063`/`:1105`/`:2573`/`:2580`/`:2586`/`:2606` |
