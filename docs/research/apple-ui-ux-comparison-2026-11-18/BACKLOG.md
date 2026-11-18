# Apple 系统应用对齐 · 可执行 Backlog（2026-11-18）

**一句话结论**：README 的"最高杠杆 5 条 / 22 条改进"里有**相当一部分已经在 11-15～11-18 落地，或已被代码注释明确否决**（屏幕底改白、AppBar 不用大标题、tab 栏半透明材质、任务页 listCard/compact/barCollapsed、日历日/周/年视图与手势、便签多行编辑、专注大数字+圆环、iOS Widgets/Live Activity/App Intents）。真正的剩余工作量比 README 估计的**小得多且更窄**——本文件先把"已实现 / 已否决，勿改"逐条钉死，再只列**真正还没做、且不与既有决策冲突**的条目。

> 口径来源：本目录 `README.md`（Apple 侧取数见其 §1，本文不复述 Apple 截图细节）；heyta 现状**一律以当前代码为准**（README 的 heyta 截图多为改动前快照，见各条 evidence）。
> 严格只读任务：本文件是唯一新增文件，未改动任何既有文件。

---

## 1. 现状判定（逐屏，带证据）

> 每条分「已经做到」与「还差的」。**凡 README 建议其实已实现或已被注释否决，我会原文引用并标「已实现／已否决，勿改」——这比新建议更重要。**

### 1.1 任务（`apps/mobile/src/screens/TasksScreen.tsx` + `packages/ui/src/task-list/*`）

**已经做到（README 对应的建议多半已落地，勿重做）**

- **白卡列表 listCard**：`TaskList` 的 `listCard` prop 把整张列表画成一张白卡（`packages/ui/src/task-list/TaskList.tsx:204-213`、`333-346`），`TasksScreen` 已开启——
  - `apps/mobile/src/screens/TasksScreen.tsx:1909-1910`：`// 白卡列表（对齐滴答的"卡 + 卡内行"观感，见 TaskList 的 listCard）` → `listCard`。
- **44dp 紧凑行**：`TasksScreen.tsx:1898-1908` 原文：
  > `🔴 2026-11-15：移动端列表用 compact 密度，对齐滴答的 44dp 行距。` … `density="compact"`
  即 README §2.3「44pt 行规约」是通过 `density="compact"`（`density.ts` 里 `minHeight: 'touch-target.min'`=44）实现的，**不需要新增 `--ht-row-height` token**。
- **顶栏随滚动收起**：`TasksScreen.tsx:1738` 传 `barCollapsed`、`:1912` 传 `onScrollOffset={onListScroll}`；实现见 `kit.tsx:462-520`。README §2.1「滚动收缩」行为已具备（只是实现方式不是 AppBar 内的 Large Title，见下）。
- **行级手势**：左滑露出动作（`TasksScreen.tsx:1926` `swipeActions`）、长按开上下文菜单（`:1918`）、点行开详情——README §2.3「左右滑 + 长按菜单」已有。
- **空态自带行动入口、空态时不画 FAB**：`TasksScreen.tsx:1874-1888`（`action={<Button … 添加第一个任务>}`）、`:2024-2029`（`空态时不画 FAB`）。README §2.6「空态内容是对的」已成立。
- **行内优先级/日期/重复徽章**、**已完成删除线**（`TaskRow.tsx:346-352`）、**44 触控区补偿**（`TaskRow.tsx:299-304`，注释 `:275-289`）均已实现。

**还差的（本文件 backlog 会覆盖）**

- **空态仍被"卡中卡"包住**：截图 `img/heyta-mobile-tasks-empty.png` 仍是一张描边卡把「11月18日 星期三 + 插画 + 今天还没有安排 + 添加按钮」整块包住。代码一致——`listCard` 把 `FlatList` 的 `contentContainerStyle` 画成白卡（`TaskList.tsx:333-346`），而 `ListEmptyComponent` 渲染在内容容器**内**（`TaskList.tsx:418`），所以空态落在卡里。README §2.2/§2.6「空状态被卡包住 → 去外框」**仍成立**。
- **分组标题在卡内，而 iOS inset grouped 的 section header 应在卡外**：`TaskList.tsx:354-359` 的分节头是作为列表 item 渲染的，与任务同处 `listCard` 内；`TasksScreen.tsx:1934-1940` 用 `SectionHeader` 渲染。README §2.2 第 2 点（header 在卡外）**仍成立**。
- **"计划 / 旗标"智能列表**：`TasksScreen` 的 `view` 只有 `'list' | 'quadrant' | 'timeline'`（`:574`），分组来自 `sectionTasks` 的 `overdue/dueToday/inbox/completed`（`:1035`、`:1098-1103`），**没有「计划（有日期全部）/ 旗标」两个智能列表**。

**🔴 已否决，勿改（README 建议与现有决策直接冲突）**

1. **不要在 AppBar 加 34pt Large Title**。`kit.tsx:197-204` 原文：
   > `高度取 nav.app-bar-height（56）。刻意不用大标题：大标题（screen-title）属于内容区，会随内容滚动 —— 放在这里会让标题区跟着滚走，且"标题该多大"变成两处决定。`
   并且 `TasksScreen.tsx:1552-1563` 已把内容区的日期从 `screen-title` 降为 `section-title`，原文理由「一屏出现两个页级标题…一屏两个大标题等于没有大标题」。→ README #2「加 Large Title」**与这两条决策冲突，勿改**（如要做，须作为新的产品决策，不能当布局微调）。
2. **不要把任务页页底改回分组灰 `#F2F2F7`**（README §2.2「页底 grouped-background」）。`kit.tsx:553-559` 原文：
   > `🔴 2026-11-16：屏幕底改白，与 Web 的 .ht-main 同一条口径。此前是 color.background（slate-50）—— 页面灰、卡片白，两者只差 7/255：既读不成分区，又被看成"蒙了一层灰"（产品负责人原话：「默认下面好像有一层灰色的底层遮罩」）。改白之后承载交给卡片自己那圈细线。`
   → 「白底 + 白卡 + 细线」是既定形态；`--ht-color-grouped-background` 仍在，但**只用于 grouped 档（如「我的」页）**，不许把它抄回任务页。

### 1.2 日历（`packages/ui/src/calendar/*` + `apps/mobile/src/screens/CalendarScreen.tsx`）

**已经做到——README 报为 P0「补日视图 / 周视图」的，实际都已实现**

- **日视图（全天带 + 24 小时轴 + now 红线）**：`packages/ui/src/calendar/CalendarDayBoard.tsx` 整个文件即日档，文件头 `:2-24` 明写「日视图：全天带 + 24 小时轴铺满整面」；now 线在 `:116-125`、`:226-232`（`nowLine` + `tokens['color.danger']`）。→ README §3.2 / 表 #10「P0 补日视图」**已实现，勿改**。
- **周视图 / 年视图**：`CalendarBoard.tsx:119-128`（`view?: 'month'|'week'`）、`:609-655`（`view==='year'` 走 `CalendarYearBoard`）；`cal` 档位表见 `CALENDAR_VIEW_ORDER`（`CalendarScreen.tsx:71` 引用）。→ README #11「补周视图」**基本已实现**。
- **档位入口 + 手势**：`CalendarScreen.tsx:433-568` 左右滑切周期 + 双指捏合切档（含 `pinchScale` 跟手缩放）；`:661-673` 标题可点开 `CalendarViewMenu`。
- **任务与日程同屏**：`CalendarBoard` 已接 `tasks`（按 dueDate）× 倒数日 `events`（第二日期源，`:535-563`）。
- **今天按钮回工具栏**：`CalendarScreen.tsx:725-738` 传 `onToday`，共享板把「回到今天」从页脚挪进工具栏。

**还差的**

- **日/周视图不可"从空白建任务"、不可拖拽改期/拉长**：`CalendarDayBoard.tsx:40-45` 文件头原文「下一步要把"点空白建任务带时刻"接进来 —— 那时它就是落点」——**这一步还没做**。README §3.2「拖拽改时间/拉长」仍缺（且档位表里没有议程列表视图）。
- **议程/列表视图**：`CALENDAR_VIEW_ORDER` 无「列表/议程」档（`CalendarScreen.tsx` 注释 `:104-108` 说明"表里没有的档位两端都画不出来"）。

**🔴 已实现／已否决，勿改**

1. **不要照 README #5「日历视图切换改分段控件」**。移动端在 **2026-11-16** 已把视图切换收到**标题点击菜单**（`CalendarScreen.tsx:661-673` 原文：`标题就是当前时间范围…点它换档比找图标直`；并顺带省掉约 56dp 的一排分段控件）。分段组件 `CalendarViewTabs.tsx` 确实存在，但**移动端不再用它**（当前只在 web 测试与习惯页被引用；`apps/mobile/tests/calendar-view-entry.spec.ts:68` 还专门断言"不再出现 CalendarViewTabs"）。→ 把分段控件搬回日历页是**回退**，勿改。
2. **捏合是"手势连续、档位离散"，不要改成连续布局变形**：`CalendarScreen.tsx:467-469` 原文「四个档是四套完全不同的渲染（月格 / 周条 / 日时间轴 / 年卡），真要"连续变形"得重写渲染层，这一轮不做」。→ 不要把它当"没做完"来重做。

### 1.3 便签（`packages/ui/src/notes/*` + `apps/mobile/src/screens/NotesSection.tsx` / `NoteEditScreen.tsx`）

**已经做到——README「便签只有单行随手记」已过时**

- **多行编辑已存在**：`packages/ui/src/notes/NoteEditor.tsx:159-169` 用 `multiline` 的多行输入；`apps/mobile/src/screens/NoteEditScreen.tsx` 是**全屏 Modal** 承载编辑，`NotesSection.tsx:220-232` 已把摘要那段接成可点的 `onEdit` 入口。→ README §3.3 / #9 里「点开进详情、支持多行」**已实现**。
- **钉选 + 删除 + 归类到清单**：`NotesBoard.tsx:398-477`（钉选/删除）、`NotesSection.tsx:186-193`（`CaptureProjectPickerRow` 选清单）。
- **保存失败可见**：`NotesBoard.tsx:362-370`（`labels.saveFailed` + `accessibilityRole="alert"`）。

**还差的（须知口径：编辑已有，缺的是"备忘录能力面"）**

- **列表 composer 仍是单行**（`NotesBoard.tsx:63-68` 原文「composer 是单行的（一个刻意的取舍）…多行输入目前只能在别处产生」）——但多行**编辑**已在别处（NoteEditor），所以这是"新建入口单行"，不是"没有编辑器"。
- **富文本/清单项、文件夹、标签、附件/扫描、单条锁定**：均无。`Note` 只有 `projectId`（`NotesSection` 的 `newNoteProjectId`），无文件夹/标签字段。→ README #9 的"文件夹 + 标签 + 附件 + 锁定"**仍缺**，且触领域模型。

**🔴 已实现，勿改**：README 把便签整体判为"最大功能空白 P0"、按"从零做编辑器"排期——这一点已过时；**不要再造第二个编辑器**（`NoteEditor` 是共享唯一实现，见其文件头 `:1-30`）。

### 1.4 专注（`packages/ui/src/focus/*` + `apps/mobile/src/screens/FocusScreen.tsx`）

**已经做到——README「放大数字 + 主色圆环 / 正计时倒计时」已实现**

- **大数字 + 进度环**：`FocusRing.tsx` 用 `size.focus-ring`(256px)/`size.focus-ring-stroke`(10px)；中央数字用 `focus-display` 语义样式（`FocusPanel.tsx:227`），`typography.ts:264-270` 定义 `focus-display = font-size.5xl = 72px`。→ README §3.4「大数字偏小、圆环偏淡 → 放大数字+主色圆环」**已实现**。
- **正计时 / 倒计时两模式**：`FocusPanel.tsx:241-288`（`modeLabels` + `onModeChange`，`variant='dial'|'progress'`）。→ README「加正计时/倒计时两种模式」**已实现**。
- **关联任务、今日统计**：`FocusScreen.tsx:354-434`。

**还差的**

- **专注页不是沉浸式，环没竖居中**：`FocusScreen.tsx:297` 用 `<Screen title=…>` 默认 `page` 档；`FocusPanel` 有 `fill`（竖居中，`FocusPanel.tsx:109-113`、`:217`）但移动端**没传**。`kit.tsx:400-405` 明确 `immersive` 档「尚未有实现，先在类型里占位」。→ 这是一处真实布局缺口。
- **Live Activity / 灵动岛**：**iOS 原生壳已有源码**（见下 §1.6），但需现量确认已打包生效。

### 1.5 设置 / 「我的」（`apps/mobile/src/screens/ProfileScreen.tsx` + `SettingsScreen.tsx`）

**已经做到——README §3.5「这是我们已经学得最好的一屏」，属实且更完整**

- **grouped 页 + 白卡 + 阴影**：`ProfileScreen.tsx:1540` `<Screen … background="grouped">`；账号卡 `:1607` `<Card shadow="card">`。
- **居中头像头部 + `›` 可点**：`ProfileScreen.tsx:1577-1652`（居中头像块、`action.disclose` 箭头）。
- **设置搬进独立二级面（Modal）**：`SettingsScreen.tsx:1-25` 文件头「设置面（独立的第二层表面）…为什么是 Modal」；组用 `SectionHeader` + `Card` + `SettingsRow`（`:557-574`、`:600-685`）。
- **功能域收进枢纽页**：`ProfileScreen.tsx:1164-1185`（`featuresOpen` → `hubRows`）。

**还差的（小）**：README §3.5 三点（账号卡、chevron、能收就收）**基本都做了**；仅"更多高级项折叠"可继续打磨，非硬缺口。

### 1.6 系统能力（README §3.6 说「Widgets / Live Activities / App Intents 均无」——**已过时**）

**已实现（iOS 原生壳有源码）——README #16/#17/#18 应改判**

- **专注 Live Activity（灵动岛 + 锁屏横幅）**：`apps/mobile/ios/HeytaWidgetExtension/HeytaWidgetBundle.swift:49` 原文 `// W5-3 · 专注 Live Activity（灵动岛 + 锁屏横幅）`。
- **Widgets + App Intents**：`apps/mobile/ios/HeytaWidgetCore/Package.swift:36`（iOS 17 交互式组件 `Button(intent:)` / App Intent）、`Sources/HeytaWidgetUI/TodayWidgetView.swift:1`/`QuadrantWidgetView.swift:1`（`import AppIntents`）、`WidgetChrome.swift:186`（`点击不是本地改状态，而是触发 [toggle]（一个 App Intent）`）。
- **多端小组件**：`packages/widget-core`、`apps/desktop-windows/HeytaWidgetProvider/*`、`apps/mobile/harmony/.../widget/*`。
- 设置里的小组件旅程：`SettingsScreen.tsx:711-730`（`widgetRows` + `widgetBridgeAvailable`）。

> ⚠️ **待确认**：源码在 ≠ 已随包上架、≠ 每个平台都接好。本文不把"有源码"写成"已交付"，backlog 里以「现量确认 + 补齐缺口」排，而不是按 README「从零做 Widgets」重做。

**仍缺的（真实）**：Spotlight 系统索引（`grep spotlight` 只命中注释，非真实接入）、通知分级（时间敏感/摘要）、位置提醒。Live Activity/Live Widget 的「打包与各端齐套」需现量。

---

## 2. 可执行 Backlog

> 层级：**布局 / 功能 / 系统能力**。优先级 P0 先做。**"是否冲突"列写清与哪条既有决策冲突——凡写「冲突」的不许直接做，须先产品拍板。**
> 门禁名对应 `package.json` 的 `check:*`。落点写「文件 + 函数/组件」。

| 编号 | 优先级 | 层级 | 具体改动 | 精确落点（文件 + 函数/组件） | 需要新增/复用的 token | 相关门禁 | 风险 | 是否与既有决策冲突 |
|---|---|---|---|---|---|---|---|---|
| B01 | P0 | 布局 | 任务列表空态去「卡中卡」：`listCard` 模式下把 `ListEmptyComponent` 移出白卡（空态落到页面底色、居中），或在空态分支不套卡 | `packages/ui/src/task-list/TaskList.tsx`（`listCard` 分支 `333-346`、`contentContainerStyle` `419`、`ListEmptyComponent` `418`）；`apps/mobile/src/screens/TasksScreen.tsx`（`emptyComponent` `1866-1891`） | 复用 `color.surface` / `--ht-color-grouped-background`（仅当空态需要一块底） | `check:empty-state` `check:l4` `check:design` | 中：`listCard` 语义是"列表卡"，空态无行——需两端行为一致，别让 web 受影响（web 不传 listCard） | 无（README §2.6 仍成立） |
| B02 | P0 | 布局 | 专注页沉浸式：实现 `Screen` 的 `immersive` 档（全屏、不画顶栏、内容竖居中），并由 `FocusScreen` 采用；把 `FocusPanel` 的 `fill` 接上 | `apps/mobile/src/ui/kit.tsx`（`Screen` chrome 分支，当前 `immersive` 仅占位，见 `:400-405`、`468-471`）；`apps/mobile/src/screens/FocusScreen.tsx`（`<Screen>` `:297`）；`packages/ui/src/focus/FocusPanel.tsx`（`fill` `:109-113`、`:217`） | 复用 `nav.app-bar-height`；无需新 token | `check:nav-chrome` `check:design` `check:tap-targets` | 中：`immersive` 档从未实现；退出依赖返回手势，需保留可达的退出方式 | 无（补齐既有占位档，不改方向） |
| B03 | P0 | 功能 | 日历日/周视图可操作化：点空白小时格建"带时刻任务"、拖拽改期/拉长 | `packages/ui/src/calendar/CalendarDayBoard.tsx`（`hourRow` `:187-224`、`day-block`）；`apps/mobile/src/screens/CalendarScreen.tsx`（`onOpenTask`/`stepCursor`/`pickDay`）；写入路径需 capture 支持**时刻**（`@heyta/app-host` `createTaskActions` / `parseCapture`） | 复用 `size.row-min-height`；时刻字段落点见风险 | `check:capture-shape` `check:form-anatomy` `check:l4` | **高**：`CalendarDayBoard.tsx:13-16` 明写「全仓几乎没有带时刻的任务（`parseCapture` 不解析 `16:00`）」——可能触领域/捕获语义，须先确认数据模型 | 无方向冲突，但**跨领域**，先做模型确认再动手 |
| B04 | P1 | 布局 | inset grouped 的**分组标题移到卡外**（当前 header 与任务同在 `listCard` 内） | `packages/ui/src/task-list/TaskList.tsx`（`renderItem` 分节头 `354-359`）；`apps/mobile/src/screens/TasksScreen.tsx`（`renderSectionHeader` `1934-1940`） | 复用 `group-label` / `TYPE_ROLE['section-heading']` | `check:empty-state` `check:l4` `check:design` | 中：需拆分"卡外 header + 卡内行"结构，注意别破坏 `FlatList` 单滚动宿主 | 无（README §2.2 第 2 点仍成立；但与 1.1「白底白卡」形态要协调，**不得改回灰底**） |
| B05 | P1 | 功能 | 任务补两个智能列表：**计划（有日期全部）**、**旗标** | `apps/mobile/src/screens/TasksScreen.tsx`（`view` `:574`、`sectionTasks` 分组 `:1035`、`listSections` `:1098-1103`）；领域侧 `packages/domain` 分组判据 | 复用 `color.primary` / `color.danger` | `check:l4` `check:ui-language` `check:reachability` | 中：需领域层新增分组归属（status/flagged），避免两端各算一遍 | 无 |
| B06 | P1 | 功能 | 日历补**议程/列表视图**（"接下来 N 天"议程） | `packages/ui/src/calendar/model.ts`（`CALENDAR_VIEW_ORDER`/`CALENDAR_VIEW_LABEL_KEYS`）+ `CalendarBoard.tsx`；入口 `apps/mobile/src/screens/CalendarViewMenu.tsx` | 复用现有 `space.*` | `check:calendar` `check:nav-chrome` | 中：加档位必须先有实现再进表（`CalendarViewTabs.tsx:19-27` 立的规矩） | 无（README #11 的议程部分） |
| B07 | P1 | 功能 | 便签升级"备忘录最小闭环"第一步：文件夹 + 标签归类 | `packages/domain` 的 `Note` 模型 + `packages/ui/src/notes/model.ts` + `NotesBoard.tsx` + `NoteEditScreen.tsx` | 复用现有 token | `check:layering` `check:field-single-source`；**触 `check:schema-migration-drift`** | **高**：`Note` 现只有 `projectId`；加文件夹/标签要动 `packages/shared-schema`（不可逆层），必须新写 ADR + 新字段一律可选 | 无方向冲突，但**须先 ADR**；不许 bump `CURRENT_SCHEMA_VERSION` |
| B08 | P1 | 无障碍 | Dynamic Type 全面 reflow 审计 + 外圈控件 `maxFontSizeMultiplier` 收口（列表/表单/空态） | `packages/ui/src/task-list/TaskRow.tsx`（`title`/`meta`）、`empty-state/EmptyState.tsx`、`apps/mobile/src/ui/kit.tsx` 的 `Text`（`maxFontSizeMultiplier` 已有，`:108-113`） | 复用现有 | `check:tap-targets` `check:font-size-discipline` `check:empty-state` | 中：大字号下布局回退易破（列表行/按钮），需真机+浏览器双验 | 无 |
| B09 | P1 | 系统能力 | 现量确认并补齐 **Live Activity / Widgets / App Intents** 的打包与多端齐套（iOS 已有源码） | `apps/mobile/ios/HeytaWidgetExtension/HeytaWidgetBundle.swift`、`apps/mobile/ios/HeytaWidgetCore/**`、`packages/widget-core`、`apps/mobile/harmony/**/widget/**` | — | `check:widgets` `check:ios-native-bridges` `check:native-deps` | 中：先量后补，别按 README「从零做」重写 | **与 README #16/#17/#18 冲突（README 判"无"，实际已有源码）** |
| B10 | P1 | 布局 | 设置「更多高级项」进一步下钻/折叠（现状已有枢纽页，补分组折叠） | `apps/mobile/src/screens/ProfileScreen.tsx`（`hubRows` `:1177-1185`）、`apps/mobile/src/screens/SettingsScreen.tsx`（`SettingsSection` `:557-685`） | 复用 | `check:settings-row-anatomy` `check:settings-prose` | 低 | 无（README §3.5 已认同） |
| B11 | P2 | 功能 | 任务**位置提醒**（到/离某地） | 提醒模型 `packages/app-host` + 原生通知壳 | 需新增（地理围栏不做 token） | `check:reminder-permission` | 高：原生权限 + 隐私披露；`check:privacy-as-blocker` 别当否决理由，但披露要写 | 无 |
| B12 | P2 | 功能 | 便签**附件/扫描文档** | `packages/ui/src/notes/*` + 复用 `createAttachmentActions`（已在任务侧存在） | 复用现有 | `check:licenses` `check:native-deps` | 高：相机/扫描依赖 + 许可证两道门 | 无 |
| B13 | P2 | 功能 | 便签**单条锁定** | `Note` 模型 + 凭据/加密通道（ADR-0081 可选加密） | — | `check:schema-migration-drift` `check:credential-routes` | 高：涉加密可选能力 | 无，但受 ADR-0081 约束 |
| B14 | P2 | 系统能力 | 通知分级（到期=时间敏感、其它=摘要） | 原生通知壳（iOS/Android） | — | `check:reminder-permission` | 中 | 无（README §3.6 P1） |
| B15 | P2 | 系统能力 | **Spotlight** 索引任务/便签/清单（Apple 原生，无 web 等价） | `apps/mobile/ios` 原生壳 + 索引桥 | — | `check:ios-native-bridges` | 中 | 无（README §3.6 P1） |
| B16 | P2 | 布局 | 卡片内边距/圆角向 iOS 靠（20pt / 10pt）——**仅对移动端新卡**，不动全局 `radius.lg` | `packages/ui/src/task-list/TaskList.tsx` `listCard` 样式；`kit.tsx` `Card` | **待确认**：现有 `radius.lg=12`、无 20pt 内边距 token；若新增须先加 token | `check:design` `check:spacing-scale` `check:tokens` | 中：改全局 `radius.lg` 会波及几十屏，只能局部新增 | 无 |

**统计：共 16 条；P0 = 3 条（B01/B02/B03）。**

---

## 3. 依赖与并行建议

**文件不相交、可并行给多个 Agent 的工作包（互不改同一文件）**

| 包 | 覆盖条目 | 只动的文件 | 可并行原因 |
|---|---|---|---|
| **包 A · 任务列表** | B01、B04 | `packages/ui/src/task-list/TaskList.tsx`、`apps/mobile/src/screens/TasksScreen.tsx` | 与日历/便签/专注/设置文件不相交 |
| **包 B · 日历** | B03、B06 | `packages/ui/src/calendar/*`、`apps/mobile/src/screens/CalendarScreen.tsx`、`CalendarViewMenu.tsx` | 与包 A 不相交（唯一共享是 `@heyta/ui` 桶文件，见下） |
| **包 C · 便签** | B07、B12、B13 | `packages/ui/src/notes/*`、`apps/mobile/src/screens/NotesSection.tsx`、`NoteEditScreen.tsx`、`Note` 领域模型 | 领域改动独立 |
| **包 D · 专注** | B02 | `apps/mobile/src/ui/kit.tsx`（Screen immersive）、`apps/mobile/src/screens/FocusScreen.tsx`、`packages/ui/src/focus/FocusPanel.tsx` | 专注专属 |
| **包 E · 设置** | B10 | `ProfileScreen.tsx`、`SettingsScreen.tsx` | 独立 |
| **包 F · 原生系统能力** | B09、B14、B15 | `apps/mobile/ios/**`、`apps/mobile/harmony/**`、`android/**`、`packages/widget-core` | 原生壳独立，可与 Dart/TS 包并行 |

**必须串行（有共享文件 / 共享 token）**

1. **`apps/mobile/src/ui/kit.tsx` 是共享文件**：包 D（B02 改 `Screen` 的 `immersive`）会碰它；若包 A 也要改 `Screen` 的 `background`/`chrome`，**两者必须串行**，否则同一文件互相覆盖。
2. **`packages/design-system/src/tokens.css` 是唯一事实源、单文件**：B16（或任何"新增 token"）必须**最先**落地并由一个 Agent 独占；所有消费方（A/B/C/D）在 token 落地后再并行。当前 backlog 大多"复用现有 token"，除 B16 外都不新增 → 风险集中在 B16。
3. **`packages/ui/src/index.ts`（桶文件）**：多个包都要从这里导出新组件/类型 → 收尾由**一个整合者**统一改桶文件并跑 `pnpm -r typecheck`，避免并行时 Duplicate identifier（仓里已因 `TaskRow` 撞名踩过，见 `TaskRow.tsx:80-92`）。
4. **B07（便签文件夹/标签）与 B13（便签锁定）都动 `Note` 模型 / `shared-schema`** → 串行，且各自先写 ADR。
5. **B09 与 B14/B15 都动 iOS/Android 原生壳** → 原生壳内串行（同一 Xcode/Gradle 工程），但可与 TS 包并行。

**推荐的执行顺序**：B16（token 前置，若要做）→ 包 A + 包 B + 包 D + 包 E 并行（文件不相交）→ 包 C（先出 ADR）→ 包 F（原生，独立排期）。收尾统一跑门禁 + `pnpm -r typecheck`。

---

## 4. 不要做清单（证据支持，明确不做）

> 这些不是"暂时搁置"，是**有原文决策支撑、应当明确不做**——防止下一个 Agent 为了"更像 iOS"把它们抄回去。

1. **不把品牌蓝 `#2563EB` 换成 iOS 系统蓝 `#007AFF`**。README §0 已认同保留；`--ht-color-primary` 是品牌资产，要学的是"强调色只用在可点元素"，不是色值。
2. **不把任务页页底改回分组灰 `#F2F2F7`**。2026-11-16 已改为白底（`kit.tsx:553-559` 原文见 §1.1）——灰底会被读成"蒙了一层灰"，是回退。
3. **不在 AppBar 放 34pt Large Title**。`kit.tsx:197-204` 明确否决（§1.1）；且一屏两个大标题 = 没有大标题（`TasksScreen.tsx:1552-1563`）。
4. **不为「像 iOS」砍掉四象限 / 成长 / AI / 专注 / 时间线**。README §0「别照抄 3 点」已认同；四象限是**同一批任务的另一种投影**，不是新数据（`TabBar.tsx:52-56`、`TasksScreen.tsx:566-573` 引 ADR-0015 §4）。
5. **不给四象限 / 便签新增第 6 个 tab**。`TabBar.tsx:52-56`（四象限不设 tab）；`NotesSection.tsx:17-24`（便签走「我的」页内一段，理由是 P10 已撤销第 6 tab；底部脚本按坐标寻址 5 个 tab）。
6. **不把 SF Symbols 用于 iOS 端替换 lucide**。README §2.9 建议 SF Symbols——与"图标跨端同一字形"的既有决策冲突：`TaskRow.tsx` 文件头与 `EmptyState.tsx:40-48` 原文「图标走 `../icon/Icon.tsx`（数据来自框架无关的 lucide…），所以四个端画的是**同一个字形**」。要用 SF Symbols 就等于让 iOS 与桌面/Android 字形分叉。
7. **不把日历视图切换改回"四格分段控件"并常驻**。2026-11-16 已改标题点击菜单，并省掉约 56dp（`CalendarScreen.tsx:661-673`）；分段组件仅保留给 web/习惯页。见 §1.2。
8. **不重写日历日/周/年档做"连续布局插值"**。`CalendarScreen.tsx:464-469` 原文「四个档是四套完全不同的渲染…真要连续变形得重写渲染层，这一轮不做」。
9. **不回退 tab 栏材质**。`TabBar.tsx` 正文已是 `BlurView` 真模糊 + `material.chrome-tint` + 悬浮发丝线（`149-160`）——README #7「改半透明」**已实现**。（注意：该文件**头部旧注释** `25-31` 仍写"没有做半透明材质、用不透明 color.surface"，那段已与实现自相矛盾，**不要按旧注释把 BlurView 拆掉**；是否顺手删旧注释是文档清理，不是回退实现。）
10. **不把桌面端照搬 iOS 的 44pt 低密度**。README §0「桌面保密度」已认同；桌面任务信息密度是优势。
11. **不引入 AGPL/GPL/LGPL 等库来实现毛玻璃 / 模糊**。许可证铁律（`AGENTS.md §3.2`）；当前 BlurView（`@react-native-community/blur`）已够用。
12. **不把「有源码」的 Widgets/Live Activity 当「没做」重写**（README #16/#17/#18 已过时，见 §1.6）。要做的是**现量确认 + 补缺口**（B09），不是从零再来。

---

## 5. 未取到 / 待确认

- **Live Activity / Widgets 是否已随各端包上架生效**：源码在（§1.6），但"源码在 ≠ 已交付"。**待确认**（用 `check:widgets` / `check:ios-native-bridges` + 真机现量）。
- **capture 是否支持"时刻（HH:MM）"**：`CalendarDayBoard.tsx:13-16` 明说"全仓几乎没有带时刻的任务（`parseCapture` 不解析 `16:00`）"。B03 依赖这一点，**待确认**数据模型是否有 time-of-day 字段。
- **`Note` 能否加文件夹/标签字段**：需先看 `packages/shared-schema` 当前 `Note` 定义与 ADR，**待确认**（B07）。
- **Android / Harmony 是否已有对应的 Live Activity/小组件等价物**：iOS 证据充分，其它端**待确认**。
