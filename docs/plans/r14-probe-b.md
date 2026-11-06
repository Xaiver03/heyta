# R14 · 探针 B：四个动作的入口层级（设优先级 / 完成 / 搜索 / 开设置）

层级口径同探针 A：**全局** = 外壳任何视图都在；**视图** = 当前视图页头/工具栏；
**对象** = 那一行/那张卡；**字段** = 面单里那一格。只算真的写数据或换画面的控件。
日期 2026-11-06，范围 `apps/web/src` + `packages/ui/src`。


> ⚠️ **本文件的 `文件:行号` 已漂，别直接引用。**
> 2026-11-06 晚 E 包改了 `App.tsx`（删 B5 那枚、接 A1）与 `TaskRowMenu.tsx`，
> 本文件的探针行号整批下移（例：行菜单→`openTask` 从 `App.tsx:3986` 变 `:4008`）。
> **唯一真源是 [`r14-entry-table.md`](r14-entry-table.md)** —— 它写的是
> `文件:行号（锚点）`，由 `scripts/check-entry-table.mjs` 验"锚点必须在 ±3 行内"，
> 行号漂了会红。本文件保留原样，只当"当时是怎么盘的"的考古记录。

| 动作 | 应有层级 | 当前入口(文件:行号) |
|---|---|---|
| 设优先级 | 字段（面单那一格）；对象级的行菜单子菜单是同一字段的第二副面孔 | `apps/web/src/features/tasks/TaskDetailCard.tsx:519` → `features/tasks/store.ts:380` `setPriority` · `features/tasks/TaskRowMenu.tsx:383`（子菜单项 `:353`、按钮 `:360`）→ 宿主接线 `App.tsx:3981` → 同上 · `features/ai/AiPrioritize.tsx:113`（AI 确认后批量写入）→ 同上 · 拖放/快捷键改优先级：**未核实**（web 无此入口） |
| 完成 | 对象（那一行的勾选框，同一份撤销回执）；批量归视图工具栏 | `packages/ui/src/task-list/TaskRow.tsx:360` `onPress` → 宿主注入 `store.toggleComplete`（`features/tasks/store.ts:338`）· 接线共 5 处：`App.tsx:3220`（平铺列表行）· `App.tsx:3292`（分组列表行）· `App.tsx:3344`（搜索面板行）· `features/calendar/CalendarView.tsx:197` · `features/quadrant/QuadrantBoard.tsx:434` · 第六个：批量工具栏 `App.tsx:2812` → `:641` `bulkSetCompleted`（`store.ts:343`，**只完成、不能取消**）· 面单 `TaskDetailCard.tsx`：**未核实**（该文件 `:381` 只读 `completedAt` 做显示，无完成入口） |
| 搜索 | 全局（一处唤起、一份输入框）；视图内不许再起第二套筛选搜索 | rail「搜索」tab：`features/shell/view-tabs.ts:285` `SEARCH_VIEW_TAB` → `features/shell/RailNavigation.tsx:427` `activate` → `App.tsx:2562` `onNavigate`（`setView(key)` 在 `:2565`）· 快捷键 ⌘/Ctrl+K：`App.tsx:2284` 监听 → `:2291` `goToView('search')`（再按一次关：`closeSecondarySurface`）· 输入框：`packages/ui/src/search/SearchPanel.tsx:197` `onChangeText` → `App.tsx:2189` `onSearchQueryChange` → 命中 `App.tsx:2135` `searchTasks` · 各视图自带的搜索框：**未核实**（`apps/web/src/features` 全域 `type="search"` 零命中，仅 `features/admin/AdminPanel.tsx:344`/`:853` 管理后台有） |
| 开设置 | 全局（外壳一个固定入口）；其它地方的跳转只该带锚点，不该各写一套开法 | 头像菜单：`features/shell/AccountMenu.tsx:359` → `RailNavigation.tsx:60`/`:457` `onOpenSettings` → `App.tsx:2569`（`setView('settings')` 在 `:2573`）；窄壳同菜单 `features/shell/CompactRailNavigation.tsx:66` · rail 上**没有**独立设置项：`view-tabs.ts:303` `SETTINGS_VIEW_TAB` 注释明写"只为查 `labelKey`，不参与 rail 渲染" · AI「去设置」：`App.tsx:1035` `openAiSettings`（context `:2491`，消费点 `features/ai/RouteUnavailable.tsx:79`/`:187`）→ `setView` 在 `:1041` · 同步请求：`features/sync/store.ts:551` `openSettings` → `App.tsx:1063`；按钮 `features/subscription/SubscriptionNotice.tsx:125` · 帮助：`App.tsx:2606`（锚点 `help`）· 个人信息/中枢：`App.tsx:2580`/`:2586` · 深链 `?settings=`：`App.tsx:1105` · 键盘直达设置：**未核实**（web 快捷键只有 ⌘K 一条） |
