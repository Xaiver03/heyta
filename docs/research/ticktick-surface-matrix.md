# 界面地图与三方差集：滴答清单 macOS / Windows 与 heyta

> **这份文档只回答一个形状问题**：把滴答清单两个桌面端「用户能看见的界面」逐个拉平，
> heyta 各缺哪一格、多哪一格、哪两格其实是同一件事的两个名字。
> 它不回答「要不要做」，也不回答「怎么实现」——那是 [feature-matrix](feature-matrix.md) 与 ADR 的事。
>
> **取证日期**：2026-11-06。**对象**：本机 macOS 8.2.03（436 个 nib 名 / 430 个解出的文档）、
> Windows 8.2.5.0（639 个 BAML）、本仓当前 `main` 的 Web 与 mobile 两个壳。
> **不含截图、不含它的界面文案**：证据一律给「文件名 + 位置」。界面的措辞与像素属于它的表达层，
> 抄了既不能用也不该用（边界同 [桌面端取证](ticktick-desktop-teardown-2026-11.md) §5）。
>
> **与既有文档的分工**：那份取证回答「它怎么做的、该学哪七条」；
> [dida-capture/INTERFACE-NOTES.md](dida-capture/INTERFACE-NOTES.md) 是**画面上**逐个区域的实测（12 张原图）；
> [dida-view-unification.md](dida-view-unification.md) 是我们自己的视图收敛裁决。
> 本文是第三件东西：**一张可逐格追证的对齐表**，以及从它掉出来的差集。

---

## 0. 口径：一行是什么、一格凭什么算「有」

### 0.1 一行的定义

**一行 = 一个用户能用一句话点名的界面**（「看板」「任务详情」「打印预览」）。

不按文件切：macOS 的 `TTTaskDetailTagCollectionViewItem` 与 Windows 的
`views_tag_taglabelcontrol` 是同一种东西（一个标签 chip），不各占一行；
反过来 Windows 的 `views_detail_taskdetailwindow` 与 `views_detail_taskstickywindow`
是两个不同的界面，各占一行。

**不按导航层级切**：滴答 macOS 的 13 个顶层视图与它的 35 个 `*WindowController`
在表里是平级的行——因为对用户来说「看板」和「设置」都是「一屏」。

### 0.2 图例：一格能有五种说法

| 格里的写法 | 含义 | 强度 |
|---|---|---|
| `有 · X` | 找到 X 这个文件，且它是这一屏的载体 | 最强：可 diff、可重跑 |
| `有 · X（仅字符串）` | 只在字符串表里找到这个概念的词条，**没有**对应的界面文件 | 中：证明它在包里存在，不证明这一屏存在 |
| `半有 · 说明` | 有一部分，但缺一个用户会注意到的半边 | 中 |
| `无` | 这个端的界面文件与字符串表里都没有 | 强（附探针，见 §0.4） |
| `未核实` | 拿不到能判的证据（框架不在包内、结构不可读、只有名字） | 最弱 —— 它**不是**「无」 |

🔴 **`未核实` 不许被读成 `无`。** 这份表里所有 `未核实` 都登记在 §4，
连同「为什么这一格核不了」和「核它需要什么」。

### 0.3 三列的证据基准在哪

| 列 | 证据根 | 这里写成什么 |
|---|---|---|
| 滴答 macOS 8.2.03 | `Contents/Resources/*.nib`（430 个解出文档）+ `Contents/Resources/Base.lproj` 菜单 + 本地化字符串表（3528 条 × 2 语言） | `TT<类名>.nib`（相对 `Contents/Resources/`）；字符串证据写「strings: <键名>」 |
| 滴答 Windows 8.2.5.0 | `TickTick.g.resources` 里的 BAML（639 个：views 491 / resource 144 / styles 3 / app 1） | `views_<域>_<单元>.baml`（相对解包出的资源目录，如 `views_calendar_calendarhead`） |
| heyta | 本仓源码 | `路径:行号`，或本文件 §0.4 的探针编号 `G<n>` |

**重跑两个端清单的命令**（不依赖本机任何私有路径格式，只依赖解包目录）：

```sh
# macOS：436 个 nib 名（去重后 430 个文档 = 有 6 个名字没解出文档，见 §4-2）
ls Contents/Resources/*.nib | xargs -n1 basename | sed 's/\.nib$//' | sort > /tmp/nib-names.txt
# Windows：639 个 BAML 的前缀分区（491/144/3/1）
ls *.baml | sed 's/\.baml$//' | awk -F_ '{print $1}' | sort | uniq -c | sort -rn
```

**为什么 macOS 只能给到 nib、给不到「这一屏长什么样」**：nib 里每屏的对象数与连接数能读出来
（430 个文档都读到了 `object_count` / `connection_count`），但控件树语义不可读；
真正「图上是什么」的证据只有那 12 张截图，它们的结论在
[dida-capture/INTERFACE-NOTES.md](dida-capture/INTERFACE-NOTES.md)。
⇒ 本表的 macOS 列回答「**有没有这一屏**」，不回答「里面有什么」。

### 0.4 heyta 一列里每个「无」怎么验：20 条否定探针 + 20 条阳性对照

判「无」的门槛比判「有」高：**一条永远不命中的 grep 证明不了任何事**。
所以每条否定探针都配一条**同 scope、同参数、只换关键词**的阳性对照（C 系列），
对照必须命中，否则那条否定不作数（仓内元规则：不能失败的检查没有价值）。

所有命令的 cwd 都是仓库根，格式统一：
`grep -rniIlE '<模式>' --include='<glob>' <目录...>`，计数为**命中文件数**。

| 编号 | 探针（要找的东西） | 命中 | 阳性对照（同一命令换词） | 对照命中 |
|---|---|---|---|---|
| G1 | `kanban`（看板） | 0 | C1 `quadrant` | 50 |
| G2 | `stickywindow\|floatwindow\|pinwindow`（浮动便签窗） | 0 | C4 `sticky` | 6 |
| G3 | `tasktemplate\|task-template`（任务模板） | 0 | C5 `template` | 4 |
| G4 | `window\.print` / `@media print`（打印） | 0 / 0 | C3 `@media` | 23 |
| G5 | `savedfilter\|saved-filter`（保存的过滤器） | 0 | C6 `filter` | 23 |
| G6 | `commandpalette\|command-palette\|quickopen`（命令面板） | 0 | C7 `command` | 2 |
| G7 | `applock\|app-lock\|unlockpassword`（应用锁） | 0 | C8 `password` | 32 |
| G8 | `webcal\|icalfeed\|caldav`（日历订阅） | 0 | C2 `subscribe` | 30 |
| G9 | `assignee`（任务级委派 UI） | 0 | C9 `priority` | 16 |
| G10 | `attachment`（任务附件 UI） | 0 | C20 `notes` | 19 |
| G11 | `team`（团队） | 0 | C10 `member` | 5 |
| G12 | `siri`（系统快捷指令） | 0 | C24 `widget` | 41 |
| G13 | `nsstatusitem\|menubarextra\|statusitem`（菜单栏常驻） | 0 | C12 `menu` | 1 |
| G14 | `timetable\|coursearchive`（课程表） | 0 | C13 `holiday` | 4 |
| G15 | `checkitemreminder\|check-item-reminder`（检查事项级提醒） | 0 | C14 `reminder` | 33 |
| G16 | `whitenoise\|white-noise\|ringtone`（白噪音/铃声） | 0 | C23 `audio`（**也是 0**） | 0 |
| G17 | `notion`（Notion 集成） | 0 | C16 `markdown` | 9 |
| G18 | `geofence`（位置提醒） | 0 | C17 `timezone` | 9 |
| G19 | `dailysummary\|weeklysummary\|daily-summary`（独立总结屏） | 0 | C18 `review` | 46 |
| G20 | `日历订阅`（中文词条） | 0 | C19 `订阅` | 1 |

⚠️ **G16 是唯一一条对照不命中的探针，而它的「不命中」本身就是答案**：
`C23 audio`（`HTMLAudioElement|new Audio(|expo-av|just_audio`）全仓 **0** ——
heyta 现在**没有任何音频播放入口**。所以「没有白噪音」不是「少做了一个设置项」，
而是「这条能力的地基不存在」；这一格判「无」的依据比 grep 强，档位却仍按「一个设置项」算（§2 P2）。

⚠️ **G12 / G13 / G14 / G18 的「无」有一半是平台决定的**（Siri 在 macOS、菜单栏窗在桌面、
课程表是垂直场景、位置提醒要定位权限）——所以它们进差集时级别都低，见 §2。

**heyta 一列里每个「有 / 半有」的追证方式**：格子里直接给 `路径:行号`。
不给行号的（例如「有 · 见某目录」）一律不接受——`路径:行号` 或 `G<n>` 二选一，这是本表的硬约束。

### 0.5 两个端的顶层导航先各看一眼（它决定了后面很多格的意义）

- **macOS**：`List` 菜单正好 **13 项**，一屏一项：
  Pomodoro · All · Assignee · Calendar · Completed · Habit · Inbox · Matrix ·
  Today · Tomorrow · Next 7 Days · Summary · Trash。
  🔴 **菜单 13 项 ≠ rail 13 项**：截图实测那 5.8% 宽的图标栏只露「任务 / 日历 / 四象限 / 习惯 / 搜索」
  五个视图 + 底部三个动作（同步 / 通知 / 帮助），番茄钟、成长类、回收站、设置都**不在 rail 上**
  （[INTERFACE-NOTES](dida-capture/INTERFACE-NOTES.md) §1）。
  ⇒ 「这一屏存在」和「它有一个入口」在这份表里是**两个不同的问题**，本表只判前者。
- **Windows**：`views_mainwindow.baml` + `views_tabbar_leftmenubar.baml` + `views_mainlistview_*`（5 个）
  说明它同样是「左竖栏 + 主列表 + 详情」三件套，且竖栏里连通知控件都是自绘的
  （`views_tabbar_leftmenubar.baml` 引用了 `ticktick_WPF.Views.Misc.NotificationControl`）。
  ⚠️ 但它的 BAML 里**没有可读的菜单文案**（文案走独立字符串资源），
  所以「Windows 的顶层清单是否与 macOS 那 13 项同构」**未核实**（§4-7）。

---

## 1. 屏幕级对齐矩阵

### 1.1 外壳与导航

| # | 界面 | 滴答 macOS 8.2.03 | 滴答 Windows 8.2.5.0 | heyta |
|---|---|---|---|---|
| 1 | 主窗口（三栏外壳） | 有 · `TTMainWindowController.nib`、`TTMainViewController.nib`、`TTSideBySideListContainerViewController.nib` | 有 · `views_mainwindow.baml` | 有 · `apps/web/src/features/shell/RailNavigation.tsx:207`、`apps/web/src/App.tsx:1023` |
| 2 | 图标导航栏（rail） | 半有 · `TTMainViewController.nib` 内嵌（截图实测见 INTERFACE-NOTES §1；**nib 级证据未核实**，§4-3） | 有 · `views_tabbar_leftmenubar.baml` | 有 · `apps/web/src/features/shell/view-tabs.ts:326`（`splitRailTabs`）、`apps/web/src/features/shell/RailNavigation.tsx:30` |
| 3 | 顶部 tab 条 | 有 · `TabBarViewController.nib` | 有 · `views_tabbar_leftmenubar.baml` | 无 · 桌面 Web 由 rail 承载，没有独立 tab 条；移动端有 `apps/mobile/src/nav/TabBar.tsx:57` |
| 4 | 清单 / 标签组织树（侧栏） | 有 · `TTProjectListView.nib`、`TTProjectListContainerViewController.nib`、`TTProjectListSmartListCell.nib`、`TTProjectListTeamCell.nib`、`TTProjectListEmptyHolderCell.nib` | 有 · `views_mainlistview_projectlist_minicalendar.baml`、`resource_sidebar.baml` | 有 · `apps/web/src/features/projects/ProjectsPanel.tsx:84` |
| 5 | 侧栏迷你月历 | 未核实 | 有 · `views_mainlistview_projectlist_minicalendar.baml`（**名字里有，但这一文件也可能只是清单树**，§4-1） | 无 · 侧栏无月历；月网格只在日历视图里（`apps/web/src/features/calendar/CalendarView.tsx:60`） |
| 6 | 全局命令面板（一键跳到任意动作） | 有 · `TTCommandPanelViewController.nib` | 未核实 | 无 · G6 |
| 7 | 快捷键一览 / 自定义 | 有 · `TTShortcutsListViewController.nib`、`TTShortcutsPreferenceViewController.nib`、`TTShortcutsSettingsViewcontroller.nib` | 有 · `views_config_shortcutsconfig.baml` | 半有 · 有快捷键（`Cmd+K` 开搜索，`apps/web/src/App.tsx:2284`）但**没有一览与自定义面板**，G11 对照 C11 `shortcut` 仅 1 命中且在 mobile |
| 8 | 搜索浮层 / 搜索窗 | 有 · `TTSearchViewController.nib`、`TTSearchCandidateCell.nib`、`TTSearchTaskCandidateCell.nib`、`TTSearchCandidateHeaderCell.nib` | 有 · `views_search_searchdialog.baml`、`views_search_searchinputcontrol.baml`、`views_search_searchfiltercontrol.baml`（共 11 个） | 有 · `packages/ui/src/search/SearchPanel.tsx:137` |

### 1.2 智能清单

| # | 界面 | 滴答 macOS 8.2.03 | 滴答 Windows 8.2.5.0 | heyta |
|---|---|---|---|---|
| 9 | 今天 | 有 · `List` 菜单第 9 项；**无专用 nib**（由任务列表渲染，渲染色未核实） | 未核实（无 `today` BAML，可能在 `views_mainlistview_*` 内） | 有 · `apps/web/src/features/shell/view-tabs.ts:87`（`PRIMARY_NAV`） |
| 10 | 明天 | 有 · `List` 菜单第 10 项 | 未核实（同上） | 无 · `packages/domain/src/task-filter.ts:51` 的判别联合七分支里没有 `tomorrow` |
| 11 | 最近 7 天 | 有 · `List` 菜单第 11 项 | 未核实（同上） | 有 · `apps/web/src/features/shell/view-tabs.ts:87`、天数常数 `NEXT_SEVEN_DAYS` 在 `packages/domain/src/task-filter.ts:69` |
| 12 | 收集箱 | 有 · 侧栏项（INTERFACE-NOTES §2.1 实测）；无专用 nib | 有 · `views_editinboxdialog.baml`（收集箱可配置） | 有 · `TaskFilter` 的 `{ kind: 'all' }` 即收集箱，`packages/domain/src/task-filter.ts:51` + `apps/web/src/features/shell/view-tabs.ts` 文件头注释 |
| 13 | 全部（跨清单平铺） | 有（菜单项）· `List` 菜单第 2 项；**它到底是「所有任务」还是「按清单分组的全部」，读不到**，§4-7 | 未核实 | 无 · `{ kind: 'all' }` 的语义已被「收集箱」占用（`packages/domain/src/task-filter.ts:51` 只有七分支），没有第二档 |
| 14 | 已完成 | 有 · 侧栏贴底 + `List` 菜单第 5 项 | 有 · `views_completed_completedfiltercontrol.baml` | 有 · `apps/web/src/features/shell/view-tabs.ts:87`（`completed`） |
| 15 | 委派 / 按负责人 | 有（仅字符串）· strings: `Assignee`、`By Assignee` + `List` 菜单第 3 项；无专用 nib | 有 · `views_setassigneedialog.baml`、`views_quickadd_assigneetokencontrol.baml` | 无 · G9（领域层有 `assigneeUserId?` 字段 `packages/domain/src/entities.ts:298`，**没有任何 UI 读写它**） |
| 16 | 总结 / Summary | 有 · `TTSummaryViewController.nib` | 有 · `views_summary_summarycontrol.baml`、`views_summary_summarydisplayfiltercontrol.baml`、`views_summary_insertsummarywindow.baml` | 半有 · 成长页有一日进度 / 周回顾 / 连续性 / 热力图（`apps/web/src/features/motivation/GrowthView.tsx:277`），但那不是「一天/一周的收尾总结」这一屏，且没有「插入总结」 |
| 17 | 回收站 | 有（仅字符串）· strings: `Trash`、`Go to Trash`、`Clear Trash` + `List` 菜单第 13 项；无专用 nib | 未核实（无 `trash` BAML；大概率在 `views_mainlistview_*` 内） | 有 · `apps/web/src/features/trash/TrashView.tsx:72`、`apps/web/src/features/shell/view-tabs.ts:272` |
| 18 | 智能清单设置（改哪几条、排序） | 有 · `TTSmartListsPreferenceViewController.nib`、`TTSmartListPreferenceCell.nib` | 有 · `views_setting_smartlistconfig.baml` | 无 · `grep -rniIlE 'smartlist\|smart-list' --include=*.ts* apps/web/src packages/ui/src packages/domain/src` = 0（对照：同命令 `calendar` = 6） |
| 19 | 自定义过滤器（保存的筛选） | 有 · `TTFilterEditViewController.nib`、`TTFilterNormalEditorCell.nib` | 有 · `views_filter_filtereditdialog.baml`、`views_filter_advancedfiltercontrol.baml`、`views_filter_filterpreviewwindow.baml`（共 11 个） | 无 · G5 |
| 20 | 清单分组（文件夹 + 其下清单） | 有 · `TTFolderEditViewController.nib`、`TTProjectListDividerCell.nib` | 有 · `views_addprojectgroupdialog.baml`、`views_project_projectdividercontrol.baml` | 有 · 领域规则 `packages/domain/src/project-hierarchy.ts:1`（只允许一层），界面在 `apps/web/src/features/projects/ProjectsPanel.tsx:144`（移入文件夹的候选集） |

### 1.3 任务对象与编辑

| # | 界面 | 滴答 macOS 8.2.03 | 滴答 Windows 8.2.5.0 | heyta |
|---|---|---|---|---|
| 21 | 任务行（列表项） | 有 · `TTTaskListStandardCell.nib`、`TTTaskListDetailedCell.nib`、`TTTaskListHabitCell.nib`、`TTTaskListCountdownCell.nib`（**按行型分四种 nib**） | 有 · `views_tasklist_sectionitemcontrol.baml`、`views_tasklist_editablesectioncontrol.baml`、`views_tasklist_item_subtasklistitem.baml` | 有 · `packages/ui/src/task-list/TaskRow.tsx:147` |
| 22 | 任务详情面板 | 有 · `TTTaskDetailWindowController.nib`、`TTSingleTaskDetailViewController.nib`、`TTMultiTaskDetailViewController.nib`、`TTTaskDetailHolderViewController.nib`、`TTDetailContainerViewController.nib` | 有 · `views_detail_taskdetailwindow.baml`、`views_detail_taskdetailhead.baml`、`views_detail_taskdetailbottomcontrol.baml`、`views_detail_taskdetailmorecontent.baml` | 有 · `apps/web/src/features/tasks/TaskDetailCard.tsx:271` |
| 23 | 快速添加（捕获条 / 捕获窗） | 有 · `TTQuickAddViewController.nib`、`TTAddTaskBarViewController.nib`、`TTTaskInputViewContentCell.nib`、`TTTaskInputViewTitleCell.nib` | 有 · `views_quickadd_quickaddview.baml`、`views_quickadd_addtaskwindow.baml`、`views_quickadd_quickaddtext.baml` | 有 · `apps/web/src/features/capture/CaptureComposer.tsx:107` |
| 24 | 日期 / 时间选择器 | 有 · `TTDatePickerViewController.nib`、`TTDateModelPickerViewController.nib`、`TTDateRangePickerController.nib`、`TTMonthPickerViewController.nib` | 有 · `views_time_datepicker.baml`、`views_time_datetimeselector.baml`、`views_time_tickdatepicker.baml`（`time_` 共 25 个） | 有 · `apps/web/src/features/tasks/DueEditor.tsx:92`（面板定位）+ `packages/ui/src/date-picker/` |
| 25 | 重复规则编辑器 | 有 · `TTDatePickerCustomRepeatVC.nib`、`TTRepeatCyclePreviousViewController.nib`、`TTRepeatChangeAlertViewController.nib` | 有 · `views_time_setrepeatdialog.baml`、`views_time_modifyrepeatdialog.baml`、`views_customrepeatdialog.baml` | 有 · `apps/web/src/features/tasks/TaskRepeat.tsx:155` |
| 26 | 提醒编辑器 | 有 · `TTDueDatePickerSetReminderController.nib`、`TTDueDatePickerCustomReminderController.nib`、`TTRemindItemsManagementViewController.nib`（**日期与提醒合成一个控件**） | 有 · `views_setremindercontrol.baml`、`views_reminderpopup.baml`、`views_proreminderwindow.baml`、`views_time_customremindercontrol.baml`（**拆成两个件**） | 有 · `apps/web/src/features/reminders/ReminderPanel.tsx:73` |
| 27 | 优先级 | 有 · `Task` 菜单四项 + `TTTaskMenuViewController.nib` | 有 · `views_setprioritydialog.baml` | 有 · `apps/web/src/features/tasks/TaskRowMenu.tsx:360`、色档在 `apps/web/src/features/tasks/priority-display.ts` |
| 28 | 子任务 / 检查事项 | 有 · `TTSubtasksViewController.nib`、`TTSubtasksCell.nib`、`TTTaskDetailCheckItemCell.nib`、`TTQuickAddChecklistItemCell.nib` | 有 · `views_checklist_checklistcontrol.baml`、`views_checklist_checklistitemcontrol.baml`、`views_tasklist_item_subtasklistitem.baml` | 有 · `apps/web/src/features/tasks/SubtaskPicker.tsx:62` |
| 29 | 检查事项**级**提醒（给某一条 checklist 单独设提醒） | 有（仅字符串）· strings: `Reminder for Check Item`、`More Check Items`；nib 未核实 | 有 · 字符串资源里有这一档的整组条目（`ProReminderForSubTasks*`），界面挂在 `views_setremindercontrol.baml` 上，**未核实** | 无 · G15 |
| 30 | 任务模板 | 有 · `TTTaskTemplateEditViewController.nib`、`TTTaskTemplatePickerViewController.nib`、`TTTaskTemplatePickerWindowController.nib`、`TTTemplatePreviewViewController.nib` | 有 · `views_template_addtemplatedialog.baml`、`views_config_edittemplatewindow.baml`、`views_config_previewtemplatewindow.baml` | 无 · G3 |
| 31 | 任务附件 | 有 · `TTAttachmentFileView.nib`、`TTAttachmentImageCell.nib`、`TTAttachmentAudioCell.nib`、`TTAttachmentURLFileView.nib`（`TTAttachment*` 共 9 个） | 有 · `views_detail_attachmentfiledisplaycontrol.baml`、`views_detail_attachmentimagedisplaycontrol.baml`、`views_detail_attachmentoptionpanel.baml` | 半有 · 领域层与 op 层齐备（`packages/domain/src/attachments.ts:1`），**界面零处**（G10）—— 典型的「零件都在、线没接」 |
| 32 | 评论 / 活动流 | 有 · `TTTaskDetailAddCommentView.nib`、`TTTaskDetailCommentCell.nib`、`TTListActivitiesViewController.nib` | 有 · `views_activity_taskactivitypanel.baml`、`views_activity_taskactivitycontrol.baml`、`views_activity_taskactivityitem.baml` | 有 · `apps/web/src/features/share/ShareCommentsSection.tsx:36` |
| 33 | 标签管理（增 / 改 / 合并 / 批量） | 有 · `TTTagManagementViewController.nib`、`TTTagEditViewController.nib`、`TTTagMergeViewController.nib`、`TTTaskDetailTagCollectionCell.nib` | 有 · `views_tag_addoredittagwindow.baml`、`views_tag_mergetagwindow.baml`、`views_tag_batchaddtagwindow.baml`（`tag_` 共 15 个） | 半有 · 侧栏内可增 / 改 / 删（`apps/web/src/features/projects/ProjectsPanel.tsx:487`、`:490`、`:508`），**无独立管理页、无合并、无批量加** |
| 34 | 排序 | 有 · `TTSortOptionPickerViewController.nib`、`TTSortOptionPickerResetCell.nib` | 有 · `views_mainlistview_tasklist_tasklistviewoptionsdialog.baml` | 有 · `apps/web/src/features/shell/view-tabs.ts:394`（`SORT_LABEL`） |
| 35 | 批量多选 | 有 · `TTMultiTaskDetailViewController.nib` | 有 · `views_misc_batchtaskcontrol.baml`、`views_tag_batchsettagcontrol.baml` | 有 · `apps/web/src/App.tsx:550`（`bulkSelecting`） |
| 36 | 浮动便签 / 置顶任务窗 | 有 · `TTStickyWindowController.nib`、`TTTaskStickyViewController.nib`、`TTTaskCollapsedStickyViewController.nib`、`TTStickyPreferenceViewController.nib`、`TTTaskStickyThemePickerViewController.nib` | 有 · `views_detail_taskstickywindow.baml`、`views_config_stickynoteconfig.baml` | 无 · G2 |
| 37 | 笔记列表 / 笔记编辑器 | 未核实 · strings 有 `Notes`、`note_list`、`no_notes_here`、`convert_to_note`，但 nib 清单里**没有**独立笔记控制器（§4-5） | 未核实 · 只有 `views_markdown_*`（12 个，是编辑器）与 `views_config_stickynoteconfig.baml`，没有笔记列表 baml | 有 · `apps/web/src/features/notes/NotesView.tsx:75` |

### 1.4 视图类功能面

| # | 界面 | 滴答 macOS 8.2.03 | 滴答 Windows 8.2.5.0 | heyta |
|---|---|---|---|---|
| 38 | 日历（月 / 周 / 日 / 年 四档） | 有 · `TTCalendarViewController.nib`、`TTMonthCalViewController.nib`、`TTWeekCalViewController.nib`、`TTYearCalViewController.nib` | 有 · `views_calendar_calendarhead.baml`、`views_calendar_weekmonthswitch.baml`、`views_calendar_year_yearcalendarcontrol.baml`（`calendar_` 共 37 个） | 有 · `apps/web/src/features/calendar/CalendarView.tsx:60`；四档定义在 `packages/ui/src/calendar/model.ts:313` |
| 39 | 日历侧栏 / 日历选择 | 有 · `TTCalendarSidebarViewController.nib`、`TTCalendarTypePickerVC.nib` | 有 · `views_calendar_calendarsidebar.baml` | 有 · `apps/web/src/features/calendar/CalendarSidebar.tsx:263` |
| 40 | 日历显示设置 / 事件样式 / 配色 | 有 · `TTCalendarDisplayOptionsViewController.nib`、`TTCalendarDisplayOptionsWindowController.nib`、`TTCalendarItemStyleViewController.nib`、`TTCalColorConfigViewController.nib`、`TTWeekCalendarAlldayViewItem.nib` | 有 · `views_calendar_calendardisplaysettingwindow.baml`、`views_calendar_calendarcolorconfigwindow.baml`、`views_calendar_calendarstyleselectwindow.baml`、`views_calendar_calendartimezoneconfigwindow.baml` | 无 · 日历没有专属设置面板（`grep -rniIlE 'weekstart\|firstdayofweek' --include=*.ts* packages/ui/src/calendar/model.ts` 里 `weekStart` 只是回调参数，不是设置项；设置页也没有日历段） |
| 41 | 外部日历订阅（Google / iCloud / Outlook / URL） | 有 · `TTCalSubscriptionPreferenceViewController.nib`、`TTCalSubAddGoogleViewController.nib`、`TTCalSubAddICloudViewController.nib`、`TTCalSubscriptionAddURLVC.nib`、`TTCalSubscriptionEditViewController.nib`（`TTCalSubscription*` 共 11 个） | 有 · `views_subscribe_integratedcalendarswindow.baml`、`views_config_subscribecalendar.baml`、`views_config_addurlcalendarwindow.baml`、`views_calendar_bindoutlookwindow.baml` | 无 · G8 / G20 |
| 42 | 时间线 / 时间块 | 有 · `TTTimelineViewController.nib`、`TTTimelineCategoryCell.nib`、`TTTimelineSettingsController.nib`、`TTWeekCalTimelineViewItem.nib` | 有 · `views_timeline_timelinecontainer.baml`、`views_timeline_timelinesettingswindow.baml`、`views_timeline_timelinenavbar.baml`（共 9 个） | 有 · `apps/web/src/features/timeline/TimelinePanel.tsx:60` |
| 43 | 四象限 / 艾森豪威尔矩阵 | 有 · `TTEisenhowerMatrixViewController.nib`、`TTEisenhowerMatrixQuadrantViewController.nib`、`TTEisenhowerMatrixQuadrantEditViewController.nib`、`TTMatrixQuadrantTaskCell.nib` | 有 · `views_eisenhower_matrixcontainer.baml`、`views_eisenhower_quadrantcontrol.baml`、`views_eisenhower_editquadrantwindow.baml`、`views_eisenhower_managematrixviewswindow.baml` | 有 · `apps/web/src/features/quadrant/QuadrantBoard.tsx:218`，象限入口 `apps/web/src/features/shell/view-tabs.ts:48` |
| 44 | 看板（分列拖拽） | 有 · `TTKanbanViewController.nib`、`TTKanbanColumnViewController.nib`、`TTKanbanColumnSectionCell.nib`、`TTKanbanDisplaySettingsVC.nib`、`TTKanbanCountdownCell.nib` | 有 · `views_kanban_kanbancontainer.baml`、`views_kanban_kanbandisplaysettingwindow.baml`、`views_kanban_item_kanbandragitem.baml`（共 6 个） | 无 · G1 |
| 45 | 习惯列表 | 有 · `TTHabitListViewController.nib`、`TTHabitListCellView.nib`、`TTHabitListWeekView.nib`、`TTHabitListSectionCell.nib` | 有 · `views_habit_habitlistcontrol.baml`、`views_habit_habitlistitem.baml`、`views_habit_habitdaycell.baml` | 有 · `apps/web/src/features/habits/HabitsView.tsx:97` |
| 46 | 习惯详情 / 打卡记录 | 有 · `TTHabitDetailViewController.nib`、`TTHabitLogViewController.nib`、`TTHabitCheckCyclesViewController.nib`、`TTHabitRecordViewController.nib`、`TTHabitCheckInPopViewController.nib` | 有 · `views_habit_habitdetailwindow.baml`、`views_habit_habitcheckinwindow.baml`、`views_habit_checkinlogcontrol.baml`、`views_habit_manualrecordcheckincontrol.baml`、`views_habit_habitmonthgrid.baml` | 半有 · 详情面板有近 90 天热力图与补打卡（`apps/web/src/features/habits/HabitsView.tsx:623`、`apps/web/src/features/habits/HabitDetailCard.tsx:13`），**没有独立的打卡记录窗**（按月网格逐日看历史那一屏） |
| 47 | 习惯编辑（频率 / 目标 / 图标 / 提醒） | 有 · `TTHabitEditWindowController.nib`、`TTHabitEditFreqViewController.nib`、`TTHabitEditGoalViewController.nib`、`TTHabitEditGoalAmountViewController.nib`、`TTHabitEditIconViewController.nib`、`TTHabitSettingsWindowController.nib` | 有 · `views_habit_addoredithabitdialog.baml`、`views_habit_sethabitfrequencycontrol.baml`、`views_habit_sethabitgoalcontrol.baml`、`views_habit_sethabiticoncontrol.baml`、`views_habit_habitsettingwindow.baml` | 有 · `apps/web/src/features/habits/HabitFrequencyEditor.tsx:62`、`apps/web/src/features/habits/HabitGoalEditor.tsx:69`、`apps/web/src/features/habits/HabitIconPicker.tsx:47`（三者都在 `apps/web/src/features/habits/HabitsView.tsx:97` 的详情面里挂载） |
| 48 | 习惯统计图表（完成率 / 仪表） | 未核实（`TTHabitCheckCyclesViewController.nib` 可能是它，但无法从名字判定） | 有 · `views_habit_habitstatisticsview.baml`、`views_habit_habitcheckinchartcontrol.baml`、`views_habit_percentgauge.baml` | 半有 · 强度/连续性/里程碑在成长页（`apps/web/src/features/motivation/GrowthView.tsx:277`），**习惯内页没有图表** |
| 49 | 专注 / 番茄钟 | 有 · `TTFocusViewController.nib`、`TTFocusImmersiveViewController.nib`、`TTStopwatchConfirmViewController.nib`、`TTTimerEditingViewController.nib`、`TTFocusSettingsPopWindowController.nib` | 有 · `views_pomo_pomowindow.baml`、`views_pomo_focusimmersewindow.baml`、`views_pomo_pomosettings.baml`、`views_pomo_minifocus_minifocuswindow.baml`（`pomo_` 共 31 个） | 有 · `apps/web/src/features/focus/FocusTimer.tsx:170` |
| 50 | 专注统计 / 记录明细 | 有 · `TTPomoStatisticsViewController.nib`、`TTFocusDetailRecordsViewController.nib`、`TTTimerDetailViewController.nib`、`TTFocusBatchManagementViewController.nib` | 有 · `views_pomo_focusstatistics_addfocusrecordwindow.baml`、`views_pomo_focusstatistics_batchfocusrecwindow.baml`、`views_pomo_focusstatistics_focusrecdeleteallwindow.baml`、`views_pomo_minifocus_minifocusstatisticsview.baml` | 半有 · 当日与累计在详情面（`apps/web/src/features/focus/FocusDetailPane.tsx:43`），**没有按日/周/月的图表屏，也没有补录记录** |
| 51 | 专注白噪音 / 铃声 | 有 · `TTPomoRingtoneViewController.nib`、`TTPomoRingtoneItemView.nib` + strings: `White Noises` | 有 · `views_pomo_selectsoundcontrol.baml` + 字符串资源有这一档条目（`PomoSoundProSummary`） | 无 · G16（且 C23 音频 API 全仓 0 ⇒ 不是"少个开关"，是"没有音频入口"） |
| 52 | 倒数日 / 纪念日 | 有 · `TTCountdownViewController.nib`、`TTCountdownEditViewController.nib`、`TTCountdownStylePickerViewController.nib`、`TTCountdownBackgroundPickerViewController.nib`、`TTCountdownImportViewController.nib`（`TTCountdown*` 共 21 个） | 有 · `views_countdown_views_countdowncontainer.baml`、`views_countdown_views_countdowndetailwindow.baml`、`views_countdown_views_editcountdowndialog.baml`（`countdown_` 共 18 个） | 有 · `apps/web/src/features/countdown/CountdownView.tsx:255` |
| 53 | 成长 / 复盘（自己的进步面） | 未核实（\(\)`TTSummaryViewController.nib` 是最近的邻居，但两者语义不同，§4-6） | 未核实 | 有 · `apps/web/src/features/motivation/GrowthView.tsx:277` |
| 54 | 课程表 | 有 · `TTCourseDetailViewController.nib` | 有 · `views_calendar_coursedetailwindow.baml`、`views_detail_coursedetailcontrol.baml` | 无 · G14 |

### 1.5 设置

| # | 界面 | 滴答 macOS 8.2.03 | 滴答 Windows 8.2.5.0 | heyta |
|---|---|---|---|---|
| 55 | 设置总窗（分节壳） | 有 · `TTSettingsWindowController.nib`、`TTSettingsMoreViewController.nib`、`TTFuncPreferencesDateTimeViewController.nib` | 有 · `views_settingdialog.baml`、`views_setting_generalsettings.baml`、`views_setting_moresettingsconfig.baml`、`views_setting_featureconfig.baml`（共 10 个） | 有 · `apps/web/src/App.tsx:3421`（设置 sheet），八节词条在 `packages/i18n/src/locales/en.ts:561`–`:568` |
| 56 | 外观 / 主题 / 应用图标 | 有 · `TTThemePreferencesViewController.nib`、`TTCustomThemeEditViewController.nib`、`TTCustomThemeOptionsViewController.nib`、`TTAppIconPreferencesViewConntroller.nib`、`TTAppStylePickerViewController.nib` | 有 · `views_theme_interfacestylewindow.baml`、`views_theme_customthemedialog.baml`、`views_theme_appiconitem.baml`、`views_theme_autodarksettingwindow.baml`（`theme_` 共 15 个） | 半有 · 浅色/深色与语言在「设置 → 显示」（`packages/i18n/src/locales/zh-CN.ts:797`），**无自定义主题、无应用图标、无界面密度** |
| 57 | 提醒与通知设置 | 有 · `TTNotificationPreferenceViewController.nib`、`TTRemindItemsManagementViewController.nib` | 有 · `views_config_reminderconfig.baml`、`views_setting_moresettingsconfig.baml` | 半有 · 移动端有「提醒与通知」一节（`packages/i18n/src/locales/zh-CN.ts:3776`），**桌面 Web 的设置里没有这一段**（`grep -rniIlE 'notification' --include=*.tsx apps/web/src/features/settings` 只命中 `apps/web/src/features/settings/WidgetPushPanel.tsx`） |
| 58 | 共享清单的默认通知偏好 | 有（仅字符串）· strings: `Default Notifications for Shared Lists`；挂在偏好窗内，nib 未核实 | 未核实 | 有 · `apps/web/src/features/share/ShareNotificationSettings.tsx:23` |
| 59 | 集成与导入 | 有 · `TTIntegrationsAndImportPreferenceViewController.nib`、`TTSubscribeInOtherAppViewController.nib`、`TTSubscribeInOtherView.nib` | 有 · `views_config_integrationsandimporttypeselectwindow.baml`、`views_config_integrationsandimporttypeselector.baml`、`views_config_integrationitemscontrol.baml` | 有 · `apps/web/src/features/settings/TickTickImportPanel.tsx:101`（从滴答迁入）、`apps/web/src/features/settings/ImportPanel.tsx` |
| 60 | 账号与安全（改密 / 设备 / 注销） | 有 · `TTAccountPreferencesViewController.nib`、`TTChangePasswordViewController.nib`、`TTAccountDeletionViewController.nib`、`TTAccountSubscriptionPreferenceWindowController.nib` | 有 · `views_config_accountinfo.baml`、`views_config_securitynetworkconfig.baml`、`views_config_proxysettings.baml` | 有 · `apps/web/src/features/settings/PasswordPanel.tsx:248`、`apps/web/src/features/settings/PasskeyPanel.tsx:142`、`apps/web/src/features/settings/SessionsPanel.tsx:85`、`apps/web/src/features/settings/CloseAccountPanel.tsx:58` |
| 61 | 应用锁（启动 / 解锁密码） | 无 · 字符串表里没有对应词条（`grep` 只命中无关词） | 有 · `views_lock_appunlockwindow.baml`、`views_lock_setpasswordwindow.baml`、`views_lock_resetpasswordwindow.baml`、`views_lock_forgetpasswordwindow.baml` + 字符串资源整组 | 无 · G7 |

### 1.6 账户 / 付费 / 协作

| # | 界面 | 滴答 macOS 8.2.03 | 滴答 Windows 8.2.5.0 | heyta |
|---|---|---|---|---|
| 62 | 登录 / 注册 / 二次验证 / 第三方登录 | 有 · `TTSignInViewController.nib`、`TTSignUpViewController.nib`、`TTPhoneSignUpViewController.nib`、`TTSignIn2FAViewController.nib`、`TTCaptchaCodeViewController.nib`、`TT3rdSignInWindowController.nib`、`TTTwitterSignInWindowController.nib` | 有 · `views_logindialog.baml`、`views_loginbindthirddialog.baml`、`views_thirdloginwebdialog.baml` | 半有 · 邮箱密码 + 通行密钥（`apps/web/src/features/auth/AuthPanel.tsx:110`、`apps/web/src/features/settings/PasskeyPanel.tsx:142`），**无手机号注册、无 TOTP 二次验证**（`grep -rniIlE 'totp\|two.factor\|2fa' --include=*.ts* apps/web/src packages/ui/src` = 0，对照 `password` = 32） |
| 63 | 订阅 / 付费 / 恢复购买 | 有 · `TTPaymentViewController.nib`、`TTPaymentFirstViewController.nib`、`TTPaymentStatusViewController.nib`、`TTPaymentWXPayQRCodeViewController.nib`、`TTPremiumUpgradePricingTermsViewController.nib`、`TTPremiumSubManagementViewController.nib` | 有 · `views_upgrade_payprowindow.baml`、`views_upgrade_wechatpayqrcodewindow.baml`、`views_upgrade_paysuccesswindow.baml`、`views_upgrade_manageprosubscribewindow.baml`（`upgrade_` 共 15 个） | 有 · `apps/web/src/features/subscription/SubscriptionPanel.tsx:52`、`apps/web/src/features/subscription/RenewPanel.tsx` |
| 64 | 清单共享 / 成员管理 | 有 · `TTProjectSharingViewController.nib`、`TTSharingContactSelectorViewController.nib`、`TTSharingMemberCell.nib`、`TTMemberListViewController.nib`、`TTCollaboratePreferenceViewController.nib`、`TTProjectTransferViewController.nib` | 有 · `views_project_shareprojectdialog.baml`、`views_project_shareuseritemcontrol.baml`、`views_project_projectpermissionsetcontrol.baml`、`views_team_inviteusersdialog.baml` | 有 · `apps/web/src/features/share/ShareFeature.tsx:190`、`apps/web/src/features/share/JoinSharedListDialog.tsx`（密钥分发型协作，ADR-0062） |
| 65 | 团队（席位 / 到期 / 扩容） | 有（仅字符串）· strings: `Manage Team`、`Teammates`、`Team`；nib 侧只有 `TTMemberListViewController.nib` | 有 · `views_team_inviteusersdialog.baml`、`views_team_teamexpiredreminddialog.baml`、`views_team_teamnotification.baml` + 字符串资源整组（团队到期 / 席位已满） | 无 · G11 |
| 66 | 笔记 / 便签之外的第二类内容：**摘要卡** | 有 · `TTSummaryViewController.nib`（同 #16） | 有 · `views_summary_insertsummarywindow.baml` | 有 · 倒数日卡片导出 `apps/web/src/features/countdown/card-export.ts:78`、成长页分享卡（`apps/web/src/features/motivation/GrowthView.tsx` 的 `shareLabels`） |

### 1.7 系统集成与周边

| # | 界面 | 滴答 macOS 8.2.03 | 滴答 Windows 8.2.5.0 | heyta |
|---|---|---|---|---|
| 67 | 通知中心 / 活动 | 有 · `TTNotificationViewController.nib` | 有 · `views_misc_notificationcontrol.baml`、`views_misc_notificationlistitem.baml`、`views_misc_notificationcontrol`（挂在 `views_tabbar_leftmenubar.baml` 上） | 有 · `apps/web/src/features/inbox/InboxBell.tsx:282` |
| 68 | 帮助 / 关于 / 更新 / 更新日志 | 有 · `TTAboutPreferenceViewController.nib`、`TTSoftwareUpdateWindowController.nib`、`TTUserGuideWindowController.nib`、`TTNewFeatureGuideViewController.nib`、`TTGuideContentsViewController.nib` | 有 · `views_config_aboutinfo.baml`、`views_update_newversionwindow.baml`、`views_update_versionnewswindow.baml`、`views_user_changelogwindow.baml`（`update_` 共 6 个） | 有 · `apps/web/src/features/settings/HelpPanel.tsx:95` |
| 69 | 新手引导 / 首启 | 有 · `TTWelcomeViewController.nib`、`TTWelcomeWindowController.nib`、`TTBeginnerGuidanceViewController.nib`、`TTWelcomeFeaturesViewController.nib`、`TTGuidePreferenceViewController.nib` | 有 · `views_newuser_newuserguide.baml`、`views_newuser_choosecommonprojectwindow.baml`、`views_guide_commonguidewindow.baml` | 半有 · 移动端有 `apps/mobile/src/screens/WelcomeScreen.tsx:143`，**Web 没有首启引导**（`grep -rn 'Welcome' --include=*.tsx apps/web/src` = 0，对照：同 scope 把 `Welcome` 换成 `Settings` 命中 45 个文件） |
| 70 | 打印 / 打印预览 | 有（仅字符串）· strings: `Print`、`Print Title Only`、`Print Title & Content` + `Task` 菜单一项；nib 未核实 | 有 · `views_print_printpreviewwindow.baml`、`views_print_tasklistprintview.baml`、`views_print_dayprint.baml`、`views_print_monthprint.baml`、`views_print_weekprint.baml`（`print_` 共 14 个） | 无 · G4 |
| 71 | 桌面 / 系统小组件 | 有（仅名字 + 字符串）· 名字在 436 行名单里但**未解出文档**：`TTTodayWidgetViewController`、`TTWidgetListCellView`；另有 strings 三条主包内小部件相关词条 | 有 · `views_widget_widgetwindow.baml`、`views_widget_widgetparentwindow.baml`、`views_widget_widgetsettings.baml`、`views_widget_matrixwidget.baml`（13 个）+ 字符串资源里有「托盘右键添加小部件」的整段说明 | 有 · `apps/desktop-macos/WidgetExtension/HeytaMacWidgetBundle.swift:7`（四个定义在 `:9`–`:12`：今日 / 四象限 / 习惯 / 专注），Windows 侧 `apps/desktop-windows/HeytaWidgetProvider/` |
| 72 | 菜单栏常驻窗（点图标在状态栏下拉一屏） | 有 · `TTMenuBarContainerViewController.nib`、`TTMenuBarTaskListViewController.nib`、`TTMenuBarCalendarViewController.nib`、`TTMenuBarFocusViewController.nib`、`TTMenuBarToastViewController.nib`、`TTMenuBarCalendarViewController.nib` | 未核实（Windows 走托盘图标 + 桌面小部件，不是状态栏下拉窗） | 无 · G13 |
| 73 | 系统快捷指令（Siri Shortcuts） | 有 · `TTSiriShortcutsViewController.nib`、`TTSiriShortcutsListsViewControler.nib`、`TTSiriShortcutsPreviewViewController.nib` | 无（平台不同） | 无 · G12 |
| 74 | AI 助手 / 建议 / 任务推荐 | 有 · `TTAISuggestionViewController.nib`、`TTAITaskRecommandViewController.nib`、`TTAISuggestionFeedbackViewController.nib`、`TTAISuggestionContentCell.nib`（`TTAI*` 共 17 个） | 有 · `views_ai_aiconversationview.baml`、`views_ai_aiworkspaceview.baml`、`views_ai_aifloatingwindow.baml`、`views_ai_airecommendwindow.baml`（共 11 个） | 有 · `apps/web/src/features/ai/AssistantPanel.tsx:121` |
| 75 | 邮件 / 第三方投递生成任务 | 未核实 | 有 · `views_subscribe_emailtaskcodewindow.baml`、`views_subscribe_telegramaccountwindow.baml`、`views_subscribe_wechatwindow.baml` | 有 · `apps/web/src/features/settings/InboundAutomationSettings.tsx:40`（入站规则 + 状态机） |
| 76 | 管理员后台（自托管控制台） | 无 | 无 | 有 · `apps/web/src/features/admin/AdminConsolePage.tsx:72` |
| 77 | 端到端加密 / 密钥保管库 | 无（云端明文口径；字符串表里没有对应语义） | 无 | 有 · `apps/web/src/features/sync/VaultSettingsPanel.tsx:101` |
| 78 | 功能模块开关（用户可关掉某个模块） | 无 | 无 | 有 · `apps/web/src/features/shell/FeatureModulesPanel.tsx:38` |
| 79 | 隐私同意 / 法律条款重确认 | 无 | 无 | 有 · `apps/web/src/features/privacy/PrivacyConsentSheet.tsx:79` |

---

## 2. 三方差集

### 2.1 判级的三问

每一格缺口的级别不是感觉，按顺序回答三个问题：

1. **Q1 迁移断点**：一个滴答用户搬过来，缺这一格会不会让**主路径走不完**（当天的活干不下去 / 数据找不回）？
   成立 ⇒ 直接 P0。
2. **Q2 零件是否已在**：heyta 的领域层或共享层是否已有对应能力，只是没有界面？
   成立 ⇒ 至少 P1，理由不是"重要"，而是**成本极低而失效显形**（最后一米）。
3. **Q3 是否可推迟**：不影响其它功能成立、且不是每天用 ⇒ P2。

**与仓内基线的对账**：本文的级别**默认服从** [feature-matrix](feature-matrix.md) §2–§4 已有的判级，
只有一格偏离基线（任务附件 P2 → P1，理由在 §2.3 那行）；基线未覆盖的格才由本文首次判级，逐格写判据。

### 2.2 只有滴答有：P0（主路径断点）

| 缺口 | 判据 | 两侧证据 | 备注 |
|---|---|---|---|
| **明天**（智能清单的第三条） | Q1：仓内基线 [feature-matrix](feature-matrix.md) §2.2 自己把它判成 P0；而 heyta 的 `TaskFilter` 是**判别联合**，缺这一档时"明天要干什么"只能翻今天列表往下扫，主路径（每天早上过一遍明天）走不完 | 滴答：macOS `List` 菜单第 10 项；Windows 未核实。heyta：`packages/domain/src/task-filter.ts:51` 七分支无 `tomorrow` | 成本最低的一格：纯增量分支 + 一行 rail 项（`apps/web/src/features/shell/view-tabs.ts:87`） |
| **标签管理页**（改 / 合并 / 批量） | Q1 不成立、但基线 §1.4 把它判 P0（"标签需要独立管理页"），我**维持**：现在的形态下漏删一个标签会在任务上留孤儿 id，而唯一的入口是逐行改名 | 滴答：macOS `TTTagManagementViewController.nib` + `TTTagMergeViewController.nib`；Windows `views_tag_mergetagwindow.baml` + `views_tag_batchaddtagwindow.baml`。heyta：`apps/web/src/features/projects/ProjectsPanel.tsx:487` | 这格的现状是"能增删改、不能合并/批量/独立成页"，见 §1 #33 |

### 2.3 只有滴答有：P1（有零件无界面 / 每天都用）

| 缺口 | 判据 | 两侧证据 |
|---|---|---|
| **看板视图** | 基线 §2.6 判 P1。它**不是**顶层导航对象（macOS 的 `List` 菜单 13 项里没有 Kanban，它是每个清单的展示模式之一）⇒ 缺它不破主路径，但"按清单管项目"的人没有第二形态 | 滴答：macOS `TTKanbanViewController.nib`、Windows `views_kanban_kanbancontainer.baml`。heyta：G1 全仓 0 |
| **自定义过滤器（保存的筛选）** | 基线 §2.7 判 P1。重度用户每天第一件事是跑一条固定查询；heyta 的 `TaskFilter` 是**硬编码的七个 kind**（`packages/domain/src/task-filter.ts:51`），没有任何"用户自建查询"的位置 | 滴答：macOS `TTFilterEditViewController.nib`、Windows `views_filter_filtereditdialog.baml`（11 个文件）。heyta：G5 |
| **任务附件（界面）** | 基线 §1.10 判 P2，本文**上调为 P1**。理由只一条：Q2 成立得太彻底 —— 实体（`packages/domain/src/attachments.ts:1`）、op 构造、HTTP 字节通道全都写好了，缺的只有界面（G10 = 0）。这种缺口的成本是个位数小时，而它在用户眼里是"这个产品不能存文件" | 滴答：macOS `TTAttachment*` 9 个 nib、Windows `views_detail_attachment*` 3 个。heyta：G10 |
| **日历订阅（iCal / Google / Outlook）** | 基线未单列；按 Q1 不成立、Q2 不成立、但它是滴答**数据模型**的一部分（第三方日历建成五表链与任务并列，见[取证](ticktick-desktop-teardown-2026-11.md) §4.5）⇒ P1：不做的话"日历"只能看自家任务，那是半个日历 | 滴答：macOS `TTCalSubscription*` 11 个 nib、Windows `views_subscribe_integratedcalendarswindow.baml`。heyta：G8 / G20 |
| **日历显示设置** | Q2 半成立（`weekStart` 已是模型参数）。缺它时用户改不了周起始日与事件配色，而这在一个"已有四档日历视图"的产品里是很显眼的空洞 | 滴答：macOS `TTCalendarDisplayOptionsViewController.nib`、Windows `views_calendar_calendardisplaysettingwindow.baml`。heyta：§1 #40 |

### 2.4 只有滴答有：P2（长尾 / 平台独占 / 该明确裁决的）

| 缺口 | 判据 | 两侧证据 |
|---|---|---|
| 委派 / 按负责人 | Q1 不成立；且它与 ADR-0062 的边界直接相关（"聚合型协作"是红线）。**这格的正确动作不是实现，是裁决**：写进 ADR 说"不做"，或把 `assigneeUserId`（`packages/domain/src/entities.ts:298`）删掉——一个没人读写的字段比没有更危险 | 滴答：macOS strings `By Assignee` + `List` 菜单；Windows `views_setassigneedialog.baml`。heyta：G9 |
| 任务模板 | 基线未单列。它主要服务"项目型"用户，与看板同族 | 滴答：macOS `TTTaskTemplate*` 4 个 nib；Windows `views_template_addtemplatedialog.baml`。heyta：G3 |
| 浮动便签 / 置顶任务窗 | 需要窗口层能力（多窗口、置顶），桌面壳才有意义 | 滴答：macOS `TTStickyWindowController.nib`；Windows `views_detail_taskstickywindow.baml`。heyta：G2 |
| 检查事项级提醒 | 基线里没有这一档；它是"更细的提醒"，属滴答的 Pro 卖点 | 滴答：macOS strings `Reminder for Check Item`；Windows 字符串资源整组。heyta：G15 |
| 智能清单设置 | 现在只有三条固定智能清单，改不了顺序也改不了集合 | 滴答：macOS `TTSmartListsPreferenceViewController.nib`；Windows `views_setting_smartlistconfig.baml`。heyta：§1 #18 那两条 grep（`smartlist` 0 命中 / 对照 `calendar` 6） |
| 全局命令面板 | Q3：rail + `Cmd+K` 已覆盖"去哪"；命令面板解决的是"键盘全程不离手"，属优化 | 滴答：macOS `TTCommandPanelViewController.nib`；Windows 未核实。heyta：G6 |
| 白噪音 / 铃声 | 基线 §4.4 判 P2（要音频资源授权）。**但 heyta 的前提更差**：全仓没有任何音频播放入口（C23 = 0），所以这不是"加个设置项"，是先决定"要不要有音频子系统" | 滴答：macOS `TTPomoRingtoneViewController.nib`；Windows `views_pomo_selectsoundcontrol.baml`。heyta：G16 |
| 打印 | Q3：导出 CSV/JSON 已覆盖"把数据带走"，打印解决的是"纸面" | 滴答：Windows `views_print_*` 14 个；macOS 仅字符串 + 菜单。heyta：G4 |
| 应用锁 | 桌面端有它才有"离开工位时锁住"；移动端靠系统生物识别 | 滴答：Windows `views_lock_*` 4 个；macOS 无。heyta：G7 |
| 新手引导（Web 首启） | 移动端已有；Web 侧缺的不是能力而是那一屏 | 滴答：两端都有；heyta：`apps/mobile/src/screens/WelcomeScreen.tsx:143` |
| 课程表 | 明显垂直场景（学生），两端都有 | 滴答：macOS `TTCourseDetailViewController.nib`；Windows `views_calendar_coursedetailwindow.baml`。heyta：G14 |
| 团队 | 需要服务端后台与席位计费，与本地优先/E2EE 的立场冲突 ⇒ **建议明确写"不做"**，而不是留在差集里当待办 | 滴答：Windows `views_team_*` 5 个 + 字符串整组；macOS 仅 strings。heyta：G11 |
| 菜单栏常驻窗 / Siri 快捷指令 | 平台独占；heyta 的 macOS 壳刚有 widget，菜单栏窗是下一步的事 | 滴答：macOS `TTMenuBar*` 6 个 + `TTSiriShortcuts*` 3 个。heyta：G13 / G12 |

### 2.5 只有 heyta 有

| 我们有 | 为什么滴答没有（或不需要） | 证据 |
|---|---|---|
| **管理员后台**（自托管控制台） | 它是云服务，没有"运维这台服务器"这一面 | `apps/web/src/features/admin/AdminConsolePage.tsx:72` |
| **端到端加密 / 密钥保管库 / 设备撤销** | 它是云端明文口径；这决定了它做不了"服务端看不见" | `apps/web/src/features/sync/VaultSettingsPanel.tsx:101`、`apps/web/src/features/settings/SessionsPanel.tsx:85` |
| **功能模块开关**（用户关掉不用的模块） | 它是全家桶，模块不可关；由此它的 rail 只能固定 5 项 | `apps/web/src/features/shell/FeatureModulesPanel.tsx:38` |
| **rail 用户编排**（主段 / 更多、拖动排序、可恢复的「任务/搜索」锚点） | 它的 rail 是硬编码的 5 视图 + 3 动作 | `apps/web/src/features/shell/view-tabs.ts:326`（`splitRailTabs`）、偏好形状是 `RailPreference`（`apps/web/src/features/shell/rail-pref.ts:11`），落盘键 `heyta.shell.rail`（同文件 `:16`） |
| **入站自动化**（规则 → 建任务，带状态机） | 它有邮件投递，但没有用户可编的规则面 | `apps/web/src/features/settings/InboundAutomationSettings.tsx:40` |
| **从滴答迁入** | 它是被迁出方 | `apps/web/src/features/settings/TickTickImportPanel.tsx:101` |
| **隐私同意 / 法律条款重确认** | 合规面，与功能对标无关 | `apps/web/src/features/privacy/PrivacyConsentSheet.tsx:79` |
| **放弃态（abandoned）作为第四种任务状态** | 它是三态（完成 / 未完成 / 删除）；放弃态是 heyta 自己的模型决定（ADR-0048） | `packages/domain/src/task-filter.ts:93`（`visibleTasks`） |
| **成长 / 复盘面**（今日进度 + 周回顾 + 连续性 + 里程碑 + 身份标签 + 热力图 + 分享卡，七块） | 它有 Summary 与专注统计，但是**两处、且都是"看数"**；heyta 的是**一处、按"回顾"组织**。这一格是"半独有"，不是"独有" | `apps/web/src/features/motivation/GrowthView.tsx:277` |

### 2.6 两边都无、但产品语义上该有

| 该有的东西 | 为什么"两边都无"不等于"不该有" | 现状证据 |
|---|---|---|
| **真正的「全部任务」平铺** | 滴答的 `All` 与 heyta 的 `all` 都**不是**"所有任务"：前者按清单分组、后者已被"收集箱"这个语义占用（`packages/domain/src/task-filter.ts:51`）。于是两端都缺一个"我到底有多少条没做完"的平铺视图——而这恰恰是迁移者第一个会问的问题 | 滴答 `List` 菜单有 `All`（照名字它该是这一个，但语义未核实，§4-7）；heyta `packages/domain/src/task-filter.ts:51` |
| **提醒的时区归属显式化** | 两端都有提醒与日历时区设置，但都没有"这条提醒按哪台设备的时区响"这个可见的问题；跨时区用户（heyta 有 `timezone` 概念 9 处，`apps/web/src/features/settings/inbound-runtime.ts` 等）会遇到它 | heyta 有 `timezone`（C17 = 9）但提醒面没有对应控件；滴答的 `TTCalendarTimeZoneSettingsViewController.nib` 只管日历 |
| **附件 / 笔记 / 评论的正文可搜索性** | 两端都有搜索，但都只搜**名字**：heyta 的候选取任务标题 + 笔记标题 + 快捷动作（`packages/ui/src/search/SearchPanel.tsx:155`），笔记正文与评论不在其中；滴答的候选只有任务一类（`TTSearchTaskCandidateCell.nib`）。「我记得那句话，但忘了它在哪条任务里」是最常见的检索方式，两端都答不了 | 滴答：`TTSearchTaskCandidateCell.nib`；heyta：`packages/ui/src/search/SearchPanel.tsx:155` |
| **任务之间的阻塞关系**（A 等 B） | 两端都只有「子任务」（父子）与「链接父任务」（滴答 `views_mainlistview_detailview_linkparenttaskmenu.baml`），没有「同级阻塞」。heyta 甚至已有 `BLOCKED.md` 这个项目级概念，说明这个词在产品里是活的 | 两端的「父」都是**包含**关系而非**依赖**关系；heyta 无依赖字段：`grep -rniIlE 'blockedby' --include=*.ts* packages/domain/src packages/app-host/src` = 0（对照：同命令 `parentTaskId` = 7） |
| **一次操作的回执统一形状** | 两端都是"每个动作各自弹 toast / 各自弹 confirm"。heyta 已有共享的 `UndoReceipt` / `danger-tier` 机制（`apps/web/src/App.tsx` 的 `UndoReceipt`），这已经是比两端更进一步的形状——**这一格是"我们该继续领先"而不是"补差"** | heyta `packages/domain/src/danger-tier.ts`；两端无对应文件名 |

---

## 3. 命名与粒度差异

### 3.1 同一个界面在两端叫什么（11 组）

| 界面 | 滴答 macOS | 滴答 Windows | heyta |
|---|---|---|---|
| 四象限 | `TTEisenhowerMatrixViewController`（**连名带姓**：艾森豪威尔） | `eisenhower_matrixcontainer`（**只留姓**） | `QuadrantBoard`（**只留形状**） |
| 看板 | `TTKanbanViewController` + `TTKanbanColumnViewController` | `kanban_kanbancontainer` + `kanban_item_kanbandragitem` | 无 |
| 专注 / 番茄 | **两套词并存**：`TTFocus*`（25 个）与 `TTPomo*`（5 个），且 `TTTimerDetailViewController` 又用第三种 | `pomo_*`（31 个，含 `pomo_focusstatistics_*`）—— 一个目录里塞了两种词 | `FocusTimer` / `FocusDetailPane`（统一叫 Focus） |
| 习惯 | `TTHabit*`（27 个） | `habit_*`（23 个） | `HabitsView` / `HabitDetailCard` |
| 倒数日 | `TTCountdown*`（21 个） | `countdown_views_countdown*`（**双前缀**，18 个） | `CountdownView` |
| 标签 | `TTTag*`（管理 / 编辑 / 合并各一个 nib） | `tag_*`（15 个，管理 / 编辑 / 合并 / 批量各一个 baml） | 没有独立名——它在 `ProjectsPanel` 里 |
| 提醒 | `TTDueDatePickerSetReminderController`（**与日期合成一个控件**） | `setremindercontrol` + `reminderpopup`（**拆成两件**） | `ReminderPanel`（**独立面板**） |
| 已完成 | 侧栏贴底的一项（无类名） | `completed_completedfiltercontrol` | `TaskFilter{kind:'completed'}`（**是一个筛选值，不是一屏**） |
| 设置 | `*PreferenceViewController`（32 个 nib 名里带 Preference） | `config_*`（35 个）与 `setting_*`（10 个）**两套词并存** | 一个 sheet + 八节 |
| 总结 | `TTSummaryViewController` | `summary_summarycontrol` | 无独立屏；语义散在 `GrowthBoard` 的七块里 |
| 笔记 | 只有字符串（`note_list`） | 只有 `markdown_*` 编辑器 | `NotesView`（一个独立 store + 一屏） |

### 3.2 哪一端拆得更细（现量，不是感觉）

| 口径 | 滴答 macOS | 滴答 Windows |
|---|---|---|
| 界面资源总数 | 430 个 nib（436 行名单 / 433 个不同名字：3 个名字未解出文档、另 3 行是重名，见 §4.2） | 491 个 `views_*` BAML（全部 639 个里；其余 144 是字符串/图标/字体资源） |
| 窗口级 | **35** 个 `*WindowController` | **108** 个 `*window` + **45** 个 `*dialog` = **153** |
| 控制器级 | **210** 个 `*ViewController` | ——（WPF 没有对应层，UserControl 混在 `views_*` 里） |
| 叶子级（cell / item） | **163** 个 `*Cell` / `*Item` / `*View`，占 38% | **103** 个 `*control` + 若干 `*item` |
| 分区的做法 | **按类名前缀**（`TTCal*` 48、`TTHabit*` 27、`TTFocus*` 25、`TTCountdown*` 21） | **按目录名**（`calendar` 37、`config` 35、`pomo` 31、`time` 25、`habit` 23） |

**结论（三句）**：

1. **macOS 在"控件级"拆得更细**：一个 cell 一个 nib（163 个，38%），`TTTaskList*Cell` 按行型分了四种。
   这意味着一行任务长什么样，在 macOS 上是**四个不同类**，而在 Windows 上是一个 `tasklist_sectionitemcontrol` 配模板。
2. **Windows 在"窗口级"拆得更细**：153 个 window + dialog，是 macOS 35 个 WindowController 的 **4.4 倍**。
   它把"一个可命名的界面单元"全部编成独立文件，连"详情面里的一块"也单独成文件
   （`views_mainlistview_detailview_linkparenttaskmenu.baml`）。
3. **所以两端的"文件数"不能直接比，也不能直接读成"界面数"**：macOS 的文件数被 cell 撑大，
   Windows 的文件数被"块"撑大。真正可比的量是**窗口/对话框级界面**：
   Windows 153 vs macOS 35 —— 同一款产品，两个端在"有多少个独立窗口"这件事上差了 4 倍。

### 3.3 这些差异暗示了什么

1. **滴答的产品 IA 以"窗口"为单位，heyta 的以"视图 key"为单位。**
   滴答两端都是"一屏一文件"；heyta 是 12 个 `ViewKey`（`apps/web/src/features/shell/view-tabs.ts:127`）
   + 若干嵌在视图里的槽（详情面、捕获条、各 popover）。
   ⇒ 这解释了为什么本表 79 行里 heyta 有 11 格「半有」（而「无」21 格、「有」47 格）：**不是漏做，是两边的"屏"粒度不同**——
   滴答把「设置里的日历段」「标签管理」都做成了独立窗，heyta 把它们做成了某一屏里的一段。
   **这一条必须先裁决再谈差集**：如果 heyta 决定继续用"视图 + 槽"的形状，那么 §2 里若干 P2
   其实不该按"缺一屏"来记，而该按"缺一段"来记（成本低一档）。
2. **滴答的复杂度放在编辑器与设置，不在视图。**
   13 个顶层视图 vs 153 个窗口/对话框 ⇒ 它的产品重量在"把一条任务编辑到底"和"把偏好配到满意"。
   heyta 反过来：12 个视图 + 一个 `TaskDetailCard` + 5 个 popover。
   ⇒ 若要对标，投入方向是**编辑器深度与设置细分**，而不是再加一个视图。
   这也是本表里"看板 P1 而不是 P0"的第二个理由：它加的是视图，而视图不是它的重心。
3. **同一功能两端的合成度不同，说明这是设计自由度，不是产品决定。**
   日期与提醒：macOS 合成一个控件（`TTDueDatePickerSetReminderController`），Windows 拆成两件
   （`setremindercontrol` + `reminderpopup`）。同一家公司、同一个功能、两端不同形状
   ⇒ 这一格**不必对齐**，heyta 自选即可（现在是独立 `ReminderPanel`）。
4. **命名残差在它内部也存在，不能当 IA 证据。**
   `pomo` 与 `focus` 在 Windows 的同一个目录里并存（`pomo_focusstatistics_*`），
   macOS 更是 `TTFocus*` / `TTPomo*` / `TTTimer*` 三套词。
   ⇒ 看到"名字不像"不能推"是两个功能"，看到"名字像"也不能推"是同一个屏"（§4-1）。
5. **`countdown_views_countdown*` 这种双前缀是编译产物的事故，不是目录结构。**
   它说明 Windows 的这批文件名是**从 XAML 路径平铺出来的**（`Views/Countdown/...` → `countdown_views_...`），
   所以文件名里的层级词是路径残留，读它时必须先还原路径，否则会把"子目录"当成"子功能"（§4-1）。

---

## 4. 未核实项（这一节是免责声明，也是下一轮的任务单）

### 4.1 🔴 BAML 名字相似 ≠ 同一屏（这一类最容易把人带错）

| 看起来像 | 实际可能不是 | 需要什么才能判 |
|---|---|---|
| `views_ai_aicompletewindow` = "AI 完成窗" | `complete` 在这里可能是"补全"（输入补全）而不是"完成"。同族还有 `views_misc_completestory`，那个 `complete` 又是第三个意思 | 反编译 BAML 取控件树，或跑起来点一次 |
| `views_countdown_views_countdown*` = "countdown 下有个 views 子目录" | 是 XAML 路径 `Views/Countdown/*` 平铺成文件名的事故（同族：`views_activity_*` 没有这层） | 看 `.g.resources` 里的原始 key 顺序 |
| `views_mainlistview_detailview_*` = "MainListView 的子页面" | 是"详情面里的**一块**"（`linkparenttaskmenu`、`notionblock`、`googleeventinfoblock`），不是页面 | 同上；另外这三个的 `object_count` 会明显小于一个页面 |
| `views_habit_habitcompletedcyclescontrol` 与 `views_habit_habitcompletedcyclesitem` = 两屏 | 是"控件 + 项"一对（macOS 侧对应一个 nib 里的 collectionView + item） | 看 `views_*` 的 FQN 是 `...Control` 还是 `...Item` |
| `views_kanban_*`（6 个）= 6 个看板界面 | 只有 `kanban_kanbancontainer` 是容器，其余是设置窗 / 拖拽项 / 活动窗 | 逐个看 FQN 顶层类型 |
| `resource_sidebar.baml` = 侧栏 | `resource_*` 是**资源字典**（图标、颜色、字体、字符串），不是界面。144 个 `resource_*` 里没有一个是屏幕 | 这类文件一律不进矩阵 |
| `views_config_*`（35 个）= 35 个设置页 | 它是"配置域"的**全部控件**，含 `config_hotkeycontrol`、`config_editmenuitem` 这种零件 | 同 §3.2 的口径：只数 `*window` / `*dialog` |

**这条风险的形状**：文件名是**编译产物的路径残留**，不是产品的 IA。
拿它当 IA 用，会同时犯两个方向的错——把零件当屏（高估 Windows 的界面数），
把屏当零件（低估它的设置细分）。

### 4.2 macOS 436 行名单 vs 430 个解出文档：差额已逐一对上

差额不是"6 个丢了"，而是 3 行重名 + 3 个名字没解出文档：

```
436 行名单 → 433 个不同名字 → 430 个解出文档
名单有、文档没有（3 个）：MainMenu、TTTodayWidgetViewController、TTWidgetListCellView
```

- **`MainMenu` 与那 3 行重名**：它是菜单栏，解在了另一份产物里（本表的 13 项顶层视图就是从那里读的），
  所以它**没有** nib 文档是正常的，不是缺口。
- **两个 widget nib 没解出**：`TTTodayWidgetViewController`、`TTWidgetListCellView`。
  ⇒ 主包资源里**确实有**小部件界面（这修正了本表初稿的一句错话"436 个 nib 里没有 widget 控制器"）。
- **不影响矩阵的正确性**：本表 79 行里引用的每一个 `.nib` 都在这 430 个解出文档之内
  （逐个对过名单），没有一行依赖未解出的那 3 个。

### 4.3 只有字符串、没有界面文件的那些格

`Trash`（#17）、`Assignee`（#15）、`Print`（#70）、`Notes`（#37）、
`检查事项级提醒`（#29）、`Widget`（#71）、`共享清单默认通知`（#58）—— 这 7 格在 macOS 列标的是
「有（仅字符串）」。**字符串证明"这个词在包里"，不证明"这一屏存在"**：
它可能是侧栏里的一行（Trash 大概率是）、可能是一个菜单项（Assignee）、
也可能整个界面是动态拼的（Widget 在扩展里）。

要把它变成「有 · 文件」需要：跑起来点开一次，或拿到 `MainViewController` 的控件树。

### 4.4 Windows 侧没有独立文件的那些格

回收站（#17）、收集箱设置（#12 的 Windows 侧只有 `editinboxdialog`）、
今日 / 明日 / 最近 7 天（#9–#11）—— Windows 没有对应的 `*window` / `*dialog`，
它们大概率内嵌在 `views_mainlistview_*`（5 个文件）里。**未核实**，因为 BAML 控件树不可读。

### 4.5 笔记（#37）到底在不在 macOS / Windows 上

macOS 有 4 条笔记相关字符串（`Notes`、`note_list`、`no_notes_here`、`convert_to_note`），
但 430 个 nib 里**没有**一个独立的笔记控制器（`TTTaskDetailNoteInfoViewController` 是任务里的备注信息，
`TTCountdownNotesViewController` 是倒数日的备注）。
⇒ 两种可能：笔记列表由 `TTTaskListViewController` 换模式渲染，或它在另一个 bundle 里。**未核实**。

### 4.6 滴答的 Summary（#16）与成长/复盘（#53）是不是同一件事

只能确认两端都有 `Summary` 这一屏（macOS `TTSummaryViewController.nib`，Windows `summary_*` 三个文件），
**它里面是什么读不到**。heyta 的 `GrowthBoard` 是"七块回顾"，两者语义重叠但不重合，
本表按「半有」记而不是按「有」记，就是因为这一点没核。

### 4.7 Windows 的顶层导航是否与 macOS 那 13 项同构

macOS 的 13 项来自可读的 `List` 菜单（解码产物 `menu.json`，不是仓内文件，见 §0.3），Windows 的菜单文案在独立字符串资源里、
BAML 只给控件不给你文案 ⇒ **未核实**。
⚠️ 这一条会影响 §2 里「明天」的定级：如果 Windows 端也没有顶层的"明天"，
那这一格的**产品共识强度**就要降一档（本文仍按 P0 记，因为基线 [feature-matrix](feature-matrix.md) §2.2 判了 P0）。

### 4.8 heyta 侧的「无」不等于「决定不做」

本表 heyta 列的「无」只说明"当前 `main` 上没有可追的界面"，不说明产品立场。
其中 3 格**已经有立场冲突需要裁决**，不该被当成待办：

- **委派 / 团队**（#15 / #65）：与 ADR-0062「聚合型协作是红线」的关系没说清；
  `assigneeUserId`（`packages/domain/src/entities.ts:298`）这个没人读写的字段是最该先处理的那一个。
- **应用锁**（#61）：桌面端锁屏与 E2EE 的解锁流程（Vault）会不会互相打架，没核。
- **白噪音**（#51）：要不要有音频子系统，是产品决定，不是补一个设置项。

---

## 5. 一句话结论

**heyta 在"主路径"上只缺两格（明天、标签管理页），缺得最多的是"编辑器与设置的细分"——
而本表 11 格「半有」的成因不是漏做，是两端的"屏"粒度不同：滴答按窗口组织，heyta 按视图 + 槽组织。**

先把"粒度"这条裁决掉，§2 里一半的 P2 会自己变成"不该做"，另一半会变成"改一段就够"。
不裁决就按窗口数去补，会补出 150 个我们并不需要的窗。
