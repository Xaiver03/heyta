# 滴答清单数据模型三方对照：macOS 8.2.03 / Windows 8.2.5.0 / heyta

> 调研日期：**2026-11-06**。本文是「滴答清单逆向取证」支线的数据模型产物，**只给证据与判定，不下新的架构结论**（要下结论走 ADR）。
> 取证对象：macOS 8.2.03（`TTGRDBPod` 里的 58 张表 DDL）、Windows 8.2.5.0（解包目录 `app/` 的托管程序集）、本仓 `packages/shared-schema/` + `packages/domain/`。
> 用途：回答一个问题 —— **它有的实体，我们缺哪些、缺的那部分该不该补**。所有判定都能追到表名、TypeDef 名或 `文件:行号`。
> ⚠️ 本文**不搬它的 DDL**：全篇只引用 3 行列声明（§0.3），其余一律用表名 + 列名清单表述。

---

## 0. 两条前提修正 + 一条引用约定（读表前必读）

共享事实里有两条经本轮实测需要修正（§0.1/§0.2）。**不修正会读错整张表**，所以放在最前面；§0.3 是本文的引用约定。

### 0.1 「实体在 `TickTickModels.dll`」不成立 —— 实体在 `TickTick.exe`

`TickTickModels.dll` 的 **123 个 TypeDef** 逐段是：

| 段 | 数量 | 内容 | 证据 |
|---|---|---|---|
| `<Module>` | 1 | 模块行 | TypeDef `0x02000001` |
| `SQLite.*` | 28 | **sqlite-net 本体**（`SQLiteConnection`/`TableMapping`/`TableAttribute`/`ColumnAttribute`/…） | TypeDef `0x02000002`–`0x0200001d` |
| `TickTickModels.*` | 31 | **DTO 与基类**：`BaseModel`/`OrderModel`/`StringModel`/`IntModel` + `CalendarConnectInfo`/`FocusOptionModel`/`FocusSyncStatusModel`/`ReminderTimeModel`/`ReminderDelayModel`/`TimerModel`/`WindowModel`/`TaskStickyModel`/`MFA*`/`CalendarContent*` 等 | TypeDef `0x0200001e`–`0x0200003c` |
| 编译器生成 | 63 | `<>c`、`<>c__DisplayClass*`、`<XxxAsync>d__*` | TypeDef `0x0200003d`–`0x0200007b` |

真正的**业务实体**在 `TickTick.exe`：`ticktick_WPF.Models` 命名空间 **292 个类型**，其中 **83 个派生自 `TickTickModels.BaseModel`**（`TaskModel`/`ProjectModel`/`TagModel`/`HabitModel`/`FilterModel`/`ColumnModel`/`CountdownModel`/`CourseModel`/`TaskTemplateModel`/`TeamModel`/`PomodoroModel`/…），另有 26 张表名出现在 `TickTick.exe` 的**手写 SQL 字面量**里（`select * from TaskModel where …` 等，UTF-16 `#US` 堆）。

⇒ 「数据层是 sqlite-net」对了一半：**库是 sqlite-net，但 sqlite-net 的映射类型分布在两个程序集里**，`TickTickModels.dll` 只持有少而老的本地状态模型。

### 0.2 Windows 侧**没有可读 DDL**：类即表，属性即列

`TickTick.exe` 里 `CREATE TABLE` 字面量 **0 条**、`INSERT INTO` **0 条** —— 建表与写入都由 sqlite-net 的 API 按反射生成的映射执行。因此 Windows 的表形状**只能从类推**：

| 观测 | 现量 | 含义 |
|---|---|---|
| `SQLite.TableAttribute` | **2** 处 | 只有 2 个类显式改表名（见 §0.3 第 2 条） |
| `SQLite.PrimaryKeyAttribute` | **4** 处 | 业务表**基本没有**显式主键声明 |
| `SQLite.IgnoreAttribute` | **111** 处 | **111 个属性不是列** ⇒ 「属性集 ≠ 列集」 |
| `SQLite.IndexedAttribute` / `NotNull` / `Unique` | 32 / 31 / 1 | 索引与约束也不在类里成规模声明 |

⇒ 任何「Windows 某表有 N 列」的说法，若直接用属性数，就会**多算 [Ignore] 的那些**。本文表格里给的是**属性清单**，并标注了哪些确定不是列（§4 第 3 条）。

### 0.3 引用约定：全篇只引这 3 行（其余一律不搬）

1. `ZTTTASK` 的 GRDB 内部三列：`Z_PK INTEGER PRIMARY KEY, Z_ENT INTEGER, Z_OPT INTEGER` —— 出处：`TTGRDBPod` 内 `CREATE TABLE IF NOT EXISTS ZTTTASK (` 字面量。这三列在 56 张表里**全部存在**，是 GRDB 记录的通用前缀，不是业务列。
2. `[Table]` 的两个参数值（解密自 CustomAttribute blob）：`ProjectPinSortOrderModel` → `"SyncSortOrderModel"`；`AIPinStorageRow` → `"AIConversationPins"`。⇒ **「类名即表名」是默认值，不是常量**：`ProjectPinSortOrderModel` 与 `SyncSortOrderModel` 两个类**映射到同一张表**。
3. `ZACCOUNTID VARCHAR` —— 出现在 52 / 56 张业务表里，是本篇 §2.1 的唯一依据。

---

## 1. 三列实体对照表

**图例**

- macOS 列 = 表名（关键列）。全部 58 张表的列清单来自 `TTGRDBPod` 的 DDL 字面量。
- Windows 列 = TypeDef 全名简写 + 属性清单。表名默认等于类名（§0.2），少数显式改名已标。
- heyta 列 = 领域模型 + `文件:行号`。「无」的写法固定为 `无（entity-types.ts:22-146 / entities.ts:996）`，意思是：该实体**既不在** `packages/shared-schema/src/entity-types.ts:22-146` 的 19 个实体类型里，**也不在** `packages/domain/src/entities.ts:996` 的 `EntityModelMap` 14 个键里 —— 这两处是 heyta 实体清单的**全部**事实源，缺一即无。
- 判定四档：**对应** / **它有我无** / **我有它无** / **语义不同**。

| # | 业务实体 | 它的 macOS（表 / 关键列） | 它的 Windows（类 / 属性） | heyta | 判定 |
|---|---|---|---|---|---|
| 1 | 任务 | `ZTTTASK`（`ZTITLE`/`ZCONTENT`/`ZSTATUS`/`ZPRIORITY`/`ZSTARTDATE`/`ZENDDATE`/`ZETAG`/`ZSYNCSTATUS`/`ZPINNEDDATE`/`ZPARENTID`/`ZTASKTYPE`，50 列） | `TaskModel`（`id`/`title`/`content`/`status`/`priority`/`isAllDay`/`etag`/`pinnedTime`/`parentId`/`taskType`/`sortOrder`，51 属性） | `Task` `packages/domain/src/entities.ts:259` | **对应** |
| 2 | 子任务层级 | `ZTTTASK.ZPARENTID`（自引用） | `TaskModel.parentId`（自引用） | `Task.parentId` `entities.ts:289` + `subtasks.ts:98` | **对应** |
| 3 | 检查项 | `ZTTCHECKLISTITEM`（`ZTITLE`/`ZSTATUS`/`ZALLDAY`/`ZTASK`/`ZSORTORDER`，14 列） | `TaskDetailItemModel`（`title`/`status`/`TaskId`/`sortOrder`/`isAllDay`，11 属性） | 无独立实体：清单项是**备注里的 Markdown**（`timeline.ts:113` 明确「不是持久化模型」；导入计数见 `ticktick-import.ts:661`） | **语义不同** |
| 4 | 清单 | `ZTTPROJECT`（`ZNAME`/`ZCOLOR`/`ZCLOSED`/`ZKIND`/`ZVIEWMODE`/`ZSORTOPTION`/`ZTIMELINE`/`ZETAG`/`ZISINBOX`，37 列） | `ProjectModel`（`name`/`color`/`closed`/`kind`/`viewMode`/`SortOption`/`Timeline`/`Isinbox`/`groupId`，33 属性） | `Project` `entities.ts:431` | **对应** |
| 5 | 清单分组 / 文件夹 | `ZTTPROJECTGROUP`（`ZNAME`/`ZEXPANDED`/`ZSHOWSALL`/`ZSORTTYPE`/`ZVIEWMODE`/`ZSORTOPTION`/`ZTIMELINE`，20 列） | `ProjectGroupModel`（同名列 + `open`/`showAll`/`teamId`，16 属性） | `Project.parentId` `entities.ts:439` + `project-hierarchy.ts:66`（**只有一层**，`entities.ts:432-437`） | **语义不同** |
| 6 | 标签 | `ZTTTAG`（`ZNAME`/`ZLABEL`/`ZCOLOR`/`ZPARENT`/`ZCOLLAPSED`/`ZVIEWMODE`/`ZSORTOPTION`/`ZTIMELINE`，18 列） | `TagModel`（`name`/`label`/`color`/`parent`/`collapsed`/`viewMode`/`SortOption`/`Timeline`/`pinyin`，20 属性） | `Tag` `entities.ts:453`（**平铺**，无 `parent`/`collapsed`） | **对应**（层级语义不同） |
| 7 | 便签 | **无此表**（58 张里没有 `ZTTNOTE`） | **无此类型**（`ticktick_WPF.Models` 里无 `NoteModel`；`NoteItemModel` 是更新日志条目） | `Note` `entities.ts:492` | **我有它无** |
| 8 | 重复规则 | `ZTTTASK.ZREPEATRULE` + `ZREPEATFROM` + `ZREPEATTASKID`（**列**，不是实体） | `TaskModel.repeatFlag` + `repeatFrom` + `repeatTaskId`（**属性**） | `Task.repeatRule` `entities.ts:399` + `repeatDtstart` `:407` + `repeatAfterCompletion` `:422`；`TASK_REPEAT_CFG` 实体名保留但**有意不用**（`packages/op-log/src/state.ts:538`） | **对应** |
| 9 | 重复实例 | `ZTTREPEATINSTANCE`（`ZINSTANCETYPE`/`ZSTARTDATE`/`ZENDDATE`/`ZREFERENCEID`，8 列） | **无对应表**（无出现在 SQL 里的实例表） | 只**求值**不物化：`recurrence.ts:117 occurrencesInRange` / `:175 nextOccurrence` | **它有我无** |
| 10 | 实例拉取标记 | `ZTTREPEATINSTANCEFETCHFLAG`（`ZREFERENCEID`/`ZFETCHBEGINDATE`/`ZFETCHENDDATE`/`ZHASHTAG`，8 列） | **无对应表** | 无（`recurrence.ts:117` 求值即得，不需要「这段窗口拉过没有」；`entity-types.ts:22-146` 无此名） | **它有我无** |
| 11 | 提醒 | `ZTTREMINDER`（`ZRULE`/`ZTASK`，7 列） | `TaskReminderModel`（`id`/`Taskid`/`taskserverid`/`trigger`）+ `ReminderModel`（`Trigger`/`RemindTime`/`Type`/`CheckItemId`/`HabitId`/`EventId`/`Assignee`，23 属性） | `Reminder` `entities.ts:702` | **对应** |
| 12 | 延迟提醒 / 稍后提醒 | `ZTTDELAYREMINDER`（`ZREMINDTIME`/`ZNEXTTIME`/`ZOBJID`/`ZOBJTYPEVALUE`/`ZOP`/`ZSYNCSTATUS`，14 列） | `ReminderDelayModel`（`ObjId`/`RemindTime`/`NextTime`/`op`/`SyncStatus`，7 属性，`TickTickModels.dll`；DAO = `ReminderDelayDao`） | 无独立实体：稍后提醒 = 改 `Reminder` 的触发时刻（`reminders.ts:60` 的预置档位） | **语义不同** |
| 13 | 附件 | `ZTTATTACHMENT`（`ZFILENAME`/`ZLOCALFILEPATH`/`ZREMOTEFILEURL`/`ZFILESIZE`/`ZTASKID`/`ZSYNCSTATUS`，20 列） | `AttachmentModel`（`fileName`/`localPath`/`remoteFileUrl`/`size`/`taskId`/`sync_status`，13 属性） | `Attachment` `entities.ts:971`（**元数据实体，字节走单独通道**：`entity-types.ts:116-139`） | **对应** |
| 14 | 评论 | `ZTTCOMMENT`（`ZTITLE`/`ZTASKID`/`ZREPLIEDCOMMENTID`/`ZMENTIONS`/`ZATTACHMENTS`/`ZCOMMENTERUSERPROFILE`，17 列） | `CommentModel`（`title`/`taskSid`/`replyCommentId`/`mentions`/`Attachments`/`userProfile`，24 属性） | `Comment` `entities.ts:942`（**一条评论 = 一个实体**：`entity-types.ts:101-103`） | **对应** |
| 15 | 习惯 | `ZTTHABIT`（`ZNAME`/`ZGOAL`/`ZSTEP`/`ZUNIT`/`ZTARGETDAYS`/`ZRECURRENCERULE`/`ZSECTIONID`/`ZCURRENTSTREAK`/`ZLONGESTSTREAK`，32 列） | `HabitModel`（`Name`/`Goal`/`Step`/`Unit`/`TargetDays`/`RepeatRule`/`SectionId`/`CompletedCyclesList`，29 属性） | `Habit` `entities.ts:541` | **对应** |
| 16 | 打卡记录 | `ZTTHABITCHECKIN`（`ZCHECKINSTAMP`/`ZCHECKINTIME`/`ZVALUE`/`ZGOAL`/`ZSTATUS`/`ZOPTIME`，16 列） | `HabitCheckInModel`（`CheckinStamp`/`CheckinTime`/`Value`/`Goal`/`Status`/`opTime`，10 属性） | `HabitLog` `entities.ts:569` | **对应** |
| 17 | 习惯文字记录 | `ZTTHABITRECORD`（`ZSTAMP`/`ZCONTENT`/`ZEMOJITYPE`/`ZOPTIME`，12 列） | `HabitRecordModel`（`Stamp`/`Content`/`Emoji`/`opTime`，9 属性） | 无（`HabitLog` 无 content/emoji 字段，`entities.ts:569`） | **它有我无** |
| 18 | 习惯分组 | `ZTTHABITSECTION`（`ZNAME`/`ZSORTORDER`/`ZETAG`，11 列） | `HabitSectionModel`（`Name`/`SortOrder`/`Etag`，9 属性） | 无（`entity-types.ts:22-146` 无此名；`entities.ts:996` 无此键） | **它有我无** |
| 19 | 习惯跳过 / 周期 | `ZTTHABITSKIP`（`ZDATE`/`ZHABITID`，8 列）+ `ZTTHABITCHECKCYCLE`（`ZSTREAK`/`ZTARGETDAYS`/`ZSTARTDATE`/`ZENDDATE`，10 列） | `SkipHabitModel` + `CompletedCycle` | 无实体，但**能力有**：跳过归到 `habit-resilience.ts:49`（冻结/重开窗口），周期归到 `habit-streak.ts:108 computeStreak`（由 `HabitLog` 派生，不落表） | **语义不同** |
| 20 | 习惯设置 | `ZTTHABITSETTINGS`（`ZENABLED`/`ZSHOWSINCALENDAR`/`ZSHOWSINTODAY`/`ZDEFAULTSECTIONMODEL`，10 列） | `HabitSettingsModel`（`Enabled`/`ShowInCalendar`/`ShowInToday`/`DefaultSection`，4 属性） | 无实体：进 `GLOBAL_CONFIG`（`state.ts:548`） | **语义不同** |
| 21 | 专注会话 | `ZTTPOMODORO`（`ZTYPE`/`ZPOMOSTATUS`/`ZSTARTDATE`/`ZENDDATE`/`ZPAUSEDURATION`/`ZADJUSTEDFOCUSDURATION`/`ZADDED`/`ZNOTE`/`ZSLICES`/`ZTASKID`，16 列） | `PomodoroModel`（`Type`/`Status`/`StartTime`/`EndTime`/`PauseDuration`/`AdjustTime`/`Added`/`Note`/`Tasks`/`TaskSid`，14 属性）+ `PomoTask`（11 属性） | `FocusSession` `entities.ts:597` | **对应** |
| 22 | 专注同步队列 | `ZTTFOCUSSYNCOPERATION`（`ZOP`/`ZDURATION`/`ZAUTOPOMOLEFT`/`ZPOMOCOUNT`/`ZFOCUSONTYPE`/`ZFIRSTFOCUSID`/`ZSYNCSTATUS`，22 列） | `FocusOptionModel`（`op`/`duration`/`autoPomoLeft`/`pomoCount`/`focusOnType`/`firstFocusId`，14 属性，`TickTickModels.dll`）+ `FocusSyncStatusModel`（16 属性）；DAO = `FocusOptionModelDao` | 无（`entity-types.ts:22-146` / `entities.ts:996` 无此键）—— 该能力由 **op-log 本体**承担（`packages/op-log/src/state.ts:634 applyOperation`） | **它有我无**（架构差异） |
| 23 | 计时器 / 正计时 | `ZTTTIMER`（`ZNAME`/`ZPOMODURATION`/`ZTODAYDURATION`/`ZTOTALDURATION`/`ZMONTHSTATISTICS`/`ZWEEKSTATISTICS`/`ZYEARSTATISTICS`/`ZOBJTYPE`，25 列） | `TimerModel`（`Name`/`PomodoroTime`/`Overview`/`ObjType`/`ObjId`/`SyncStatus`，18 属性；DAO = `TimerDao`） | 无独立实体：专注配置在 `focus.ts:20 FocusConfig`，统计由 `focus-overview.ts:94 focusOverview` 派生 | **语义不同** |
| 24 | 番茄设置 | `ZTTPOMOSETTINGS`（`ZPOMODURATION`/`ZSHORTBREAKDURATION`/`ZLONGBREAKDURATION`/`ZLONGBREAKINTERVAL`/`ZAUTOPOMO`/`ZDAILYPOMOGOALS`，15 列） | `FocusOptionBean`（`opList`/`lastPoint`）+ 设置类 | `FocusConfig` `focus.ts:20` + `DEFAULT_FOCUS_CONFIG` `:31`（**配置对象，不落表**） | **语义不同** |
| 25 | 倒数日 / 纪念日 | `ZTTCOUNTDOWN`（`ZNAME`/`ZTARGETDATE`/`ZIGNOREYEAR`/`ZRECURRENCERULE`/`ZREMINDERS`/`ZSHOWAGE`/`ZDAYSOPTION`/`ZTIMERMODE`/`ZSTYLE`/`ZPINNEDTIME`，34 列） | `CountdownModel`（`Name`/`TargetDate`/`IgnoreYear`/`RepeatFlag`/`Reminder`/`ShowAge`/`DaysOption`/`TimerMode`/`Style`/`pinnedTimeValue`，35 属性） | `CountdownEvent` `entities.ts:782`（一实体装 countdown/anniversary/birthday/festival 四态，`:749`） | **对应** |
| 26 | 节假日 / 农历 | `ZTTHOLIDAY`（`ZDATE`/`ZNAME`/`ZCATEGORY`/`ZRESTTYPE`，7 列，**无 `ZACCOUNTID`**） | `HolidayModel`（`type`/`date`/`name`/`region`，4 属性） | 无实体：**随包静态数据**（`holidays.ts:56 FESTIVAL_IDS` + `generated/holiday-cn.generated.ts`），调休走运营侧导入（`holidays.ts:173`） | **语义不同** |
| 27 | 筛选器 / 智能清单 | `ZTTFILTER`（`ZNAME`/`ZRULE`/`ZSORTTYPE`/`ZVIEWMODE`/`ZSORTOPTION`/`ZTIMELINE`/`ZETAG`，17 列） | `FilterModel`（`name`/`rule`/`sortType`/`viewMode`/`SortOption`/`Timeline`/`ParallelViewMode`，16 属性） | 无实体：筛选是**纯函数**（`task-filter.ts:51 TaskFilter` / `:93 visibleTasks`），不持久化 | **语义不同** |
| 28 | 看板列 | `ZTTCOLUMN`（`ZNAME`/`ZPROJECTID`/`ZISCOMPLETED`/`ZISINPROGRESS`/`ZISINITIAL`/`ZSORTORDER`，16 列） | `ColumnModel`（`name`/`projectId`/`sortOrder`/`color`/`syncStatus`，11 属性 —— **没有**那三个状态布尔） | 无（`entity-types.ts:22-146` / `entities.ts:996` 无此键） | **它有我无** |
| 29 | 每视图排序 | **7 张**：`ZTTSORTORDER`、`ZTTTASKPINNEDSORTORDER`、`ZTTTASKDUEDATESORTORDER`、`ZTTTASKPROJECTSORTORDER`、`ZTTTASKPRIORITYSORTORDER`、`ZTTTASKTAGSORTORDER`、`ZTTPROJECTPINNEDSORTORDER` | **3 张表**：`SyncSortOrderModel`（`EntityId`/`SortOrder`/`Type`/`SortOrderType`/`ColumnId`）+ `TaskSortOrderInDateModel` + `TaskSortOrderInPriorityModel`；`ProjectPinSortOrderModel` 用 `[Table("SyncSortOrderModel")]` **复用同一张表** | `Task.order` `entities.ts:423` + 三档派生排序 `task-order.ts:118 sortTasks`（**无每视图顺序**） | **语义不同** |
| 30 | 任务更新状态 | `ZTTTASKUPDATESTATUS`（`ZTASKID`/`ZTYPE`/`ZFROMPROJECTID`/`ZOLDPARENTID`/`ZCOLUMNID`，11 列） | `SyncStatusModel`（`EntityId`/`Type`/`MoveFromId`/`OldParentId`/`ModifyPoint`/`UserId`，6 属性 —— **泛化到任意实体**） | 无（op-log 取代，`state.ts:634`） | **它有我无** |
| 31 | 任务修改时间 | `ZTTTASKMODIFYTIMES`（`ZTASKID`/`ZTIMES`，6 列） | `TaskSyncedJsonModel`（`taskSid`/`jsonString`，3 属性） | 无（每条 op 自带时刻，`state.ts:634`） | **它有我无** |
| 32 | 任务折叠状态 | `ZTTTASKCOLLAPSEDSTATUS`（`ZPROJECTID`/`ZTASKID`/`ZLASTMODIFIEDDATE`，8 列） | `SectionStatusModel` / `ArrangeSectionStatusModel` | 无（UI 状态：`entity-types.ts:22-146` 无此名、`entities.ts:996` 无此键） | **它有我无** |
| 33 | 日历订阅 | **5 表链**：`ZTTCALSUBSCRIPTIONACCOUNT`（20 列）/`…CALENDAR`（21）/`…EVENT`（32）/`…PROJECT`（16）/`…ARCHIVEREVENT`（14） | **4 表**：`BindCalendarAccountModel` + `BindCalendarModel` + `CalendarEventModel`（31 属性）+ `CalendarSubscribeProfileModel` | 无（`entity-types.ts:22-146` / `entities.ts:996` 无此键；`ical.js` 只用于 RRULE，`recurrence.ts` 头部） | **它有我无** |
| 34 | 模板 | `ZTTTASKTEMPLATE`（`ZTITLE`/`ZCHILDREN`/`ZITEMTITLES`/`ZTAGNAMES`，16 列） | `TaskTemplateModel`（`Title`/`ChidlrenToString`/`ItemsToString`/`TagsToString`，12 属性） | 无（`entity-types.ts:22-146` 无此名、`entities.ts:996` 无此键；`grep -ri template` 在 `packages/domain/src` 零命中） | **它有我无** |
| 35 | 清单模板 / 预设清单 | `ZTTPROJECTTEMPLATE`（`ZNAME`/`ZKEYWORD`，7 列）+ `ZTTPRESETPROJECT`（`ZEMPTYTITLE`/`ZTASKTITLES`/`ZISDEFAULTSELECTED`，10 列；**只有它不带 `ZACCOUNTID`** —— `ZTTPROJECTTEMPLATE` 是带的） | `ProjectTemplatesModel` / `SummaryTemplate(s)`（`SummaryTemplate` 属另一件事） | 无（`entity-types.ts:22-146` / `entities.ts:996` 均无此名） | **它有我无** |
| 36 | 课程表 | `ZTTTIMETABLE`（`ZWEEKCOUNT`/`ZSCHOOLID`/`ZLESSONTIMES`/`ZREMINDERS`，16 列）+ `ZTTCOURSE`（`ZTIMETABLE`/`ZCOURSEOCCURENCES`，10 列）+ `ZTTCOURSEARCHIVE`（`ZBEGINTIME`/`ZENDTIME`，10 列） | `TimeTableModel`（`currentTimetableId`/`displayInCalendar`，4 属性）+ `CourseModel`（`Name`/`Items`/`ScheduleId`，6 属性）+ `CourseScheduleModel` | 无（`entity-types.ts:22-146` / `entities.ts:996` 均无此名；`grep -ri timetable` 在 `packages/**` 零命中） | **它有我无** |
| 37 | 团队 / 成员 | `ZTTTEAM`（`ZNAME`/`ZISEXPIRED`/`ZEXPIREDDATE`/`ZJOINEDDATE`，12 列）+ `ZTTTEAMMATE`（`ZROLE`/`ZSITEID`/`ZTEAMID`/`ZUSERCODE`/`ZEMAIL`/`ZNICKNAME`，14 列） | `TeamModel`（`needAuditCode`/`industry`/`scale`/`teamPro`，16 属性）+ `TeamMember` | **服务端模型**：`server/prisma/schema.prisma:326 Share` / `:350 ShareMember` / `:408 ShareOperation`；清单关联见 `Project.shareId` `entities.ts:450` | **语义不同** |
| 38 | 账号 / 用户 | `ZTTUSER`（37 列：`ZUSERCODE`/`ZACCESSTOKEN`/`ZISPRO`/`ZCHECKPOINT`/`ZCLIENTID`）+ `ZTTPUBLICUSERPROFILE`（11 列）；**两张都无 `ZACCOUNTID`** | `UserModel`（22 属性）+ `UserProfile` + `UserPublicProfilesModel` | **服务端模型**：`schema.prisma:13 User`；本机只有会话令牌（`session-contract.ts`） | **语义不同** |
| 39 | 用户设置 / UI 文档 | `ZTTUSERSETTINGS`（25 列：`ZSORTTYPEOFALL`/`ZCALENDARDISPLAYCONFIGURATION`/`ZSHORTCUTS`/…）+ `ZTTUSERDOCUMENT`（25 列：`ZDESKTOPCONFIGURATION`/`ZQUICKADDCONF`/`ZEISENHOWERMATRIX`/`ZTIMETABLE`/`ZRECENTCOLORS`） | `UserSettingsModel`（`nlpenabled`）+ `CommonSettings` + `WidgetSettingModel` + …（配置类成规模，但**不是实体表**） | `GLOBAL_CONFIG`（`state.ts:548`，**有意落在物化状态之外**） | **语义不同** |
| 40 | 网络临时数据 | `ZTTNETTEMPDATA`（`ZPROJECTID`/`ZDATA`/`ZTYPE`/`ZLASTMODIFIEDDATE`，9 列） | `TempDataModel` | 无（缓存不是事实源；op-log 是唯一写入口 `packages/op-log/src/state.ts:634 applyOperation`，同 `AGENTS.md` §3.4） | **它有我无** |
| 41 | 备份快照 | `ZTTBACKUP`（`ZDATA`/`ZTYPE`，7 列） | 无对应表（走文件导出） | 导出文档 `export-dump.ts:155 buildExportDocument` / `:58 EXPORT_FORMAT_VERSION` | **语义不同** |
| 42 | AI 记录 | `ZTTTASKAIRECRECORD`（`ZIMPORTANCE`/`ZESTIMATEDDURATION`/`ZCTIME`/`ZMTIME`/`ZTASKID`，9 列 —— 表名里 `REC` 出现两次，是它自己的拼写） | `AudioAttachmentAIResultModel`（9 属性）+ `AICompleteViewModel` 等 | `AiFeedback` `entities.ts:633` + `PreferenceCorrection` `:656` + `AssistantTurn` `:887`（**记的是"用户怎么处置建议"，不是"AI 算出什么"**） | **语义不同** |
| 43 | 多账号 | **`ZACCOUNTID` × 52 / 56 表**（缺的 4 张是 `ZTTUSER`/`ZTTPUBLICUSERPROFILE`/`ZTTHOLIDAY`/`ZTTPRESETPROJECT` = 全局或自身主键） | `userId` 列 × 47 / 83 类；`TaskModel` **不带** userId/accountId | 无（`entities.ts:22-39` 的 `EntityBase` 无账号字段；账号在服务端 `schema.prisma:13`） | **它有我无** |

> **覆盖度**：56 张业务表**全部**出现在上表里。一行覆盖多张表的只有这几处 —— 排序 7 张（#29）、日历订阅 5 张（#33）、课程 3 张（#36）、模板/预设 2 张（#35）、团队 2 张（#37）、用户 2 张（#38）、设置 2 张（#39）、习惯跳过/周期 2 张（#19）。另有 3 行讲的是**列或维度**而不是独立的表：#2（`ZTTTASK.ZPARENTID`）、#8（`ZTTTASK` 的三个重复列）、#43（`ZACCOUNTID` 铺表）。2 张 GRDB 系统表（`Z_PRIMARYKEY`/`grdb_migrations`）不在对照范围。

**判定计数（43 行）**：对应 **12**；语义不同 **15**；它有我无 **15**；我有它无 **1**（便签，`entities.ts:492`）。

---

## 2. 它比我们多的 6 类实体

按「**要不要跟**」排序，不按表数量排。每条只答两问：**它为什么需要**（有证据）、**heyta 要不要**（给判据）。

### 2.1 多账号：`ZACCOUNTID` 铺满 52 / 56 张表

**它为什么需要。** 一个本地库里同时装多个账号的数据，切账号不重建库。证据是 `ZACCOUNTID` 出现在 52 张业务表里，且**缺的 4 张恰好是"不该按账号分"的**：`ZTTUSER`（自身主键就是账号）、`ZTTPUBLICUSERPROFILE`（别人的公开资料）、`ZTTHOLIDAY`（全局日历参考数据）、`ZTTPRESETPROJECT`（随包预设）。这个"缺得很有规律"本身就是语义证据：**它们清楚哪些数据是账号私有的**。

**heyta 要不要：不要这个形状。**

- 代价：每行加一列 `accountId` ⇒ 所有查询、所有唯一约束、所有索引都要带它；更要紧的是 **op-log 要按账号分区**（向量时钟与 LWW 都变成"每账号一套"），那是把账号塞进数据层。
- heyta 的账号边界已经在**更外面**：账号是服务端 `User`（`schema.prisma:13`），本机库是"这一台设备的这一份状态"，令牌层面还有会话撤销（`session-contract.ts`）。
- 若将来要做多账号，正确形状是**一账号一库 + 一账号一密钥**（数据库文件级隔离），而不是行级 `accountId`。写在 §2.1 是为了**拦住**"照抄滴答加个 accountId 列"这条最省事的错路。

### 2.2 每视图独立排序：macOS 7 张表 / Windows 3 张表

**它为什么需要。** 「我今天手动把这三条任务拖到这个顺序」必须跨设备保留，而不同视图（今天 / 清单内 / 优先级分组内 / 按截止日 / 按标签 / 置顶）是**不同的顺序空间** —— 一个任务在"今天"里排第 1，在它自己的清单里可能排第 9。所以它给每个视图一个 `(entityId → order)` 空间。

两端做法**不一样**，这本身就是证据：

- macOS 7 张（`ZTTSORTORDER` 通用一张 + 6 张按视图分：置顶 ×2、截止日、清单、优先级、标签）；
- Windows 收敛成 `SyncSortOrderModel`（带 `SortOrderType` 区分子空间）+ 2 张按日期/优先级分，且 `ProjectPinSortOrderModel` 直接 `[Table("SyncSortOrderModel")]` **复用同一张表**（§0.3 第 2 条）。

**heyta 要不要：不要。** 两个理由，一个是原则、一个是事实。

- 原则：`entity-types.ts:15-18` 的设计原则 2 写明「**视图不建实体** …… 否则会出现"视图数据与任务数据不一致"这一类经典 bug」。每视图一条排序行 = 同一个任务的顺序有 N 份事实源。
- 事实：heyta 的顺序是**派生**的（`task-order.ts:118 sortTasks` 三档 + `Task.order` `entities.ts:423`）。拖拽只改 `Task.order`，没有第二个顺序空间。
- 真要做"每视图顺序"，形状应该是**一个**独立实体 `(viewKey, entityId, order)`，一次拖拽一个 op；而**不是** 7 张表。

### 2.3 重复实例物化 + fetch flag：`ZTTREPEATINSTANCE` + `ZTTREPEATINSTANCEFETCHFLAG`

**它为什么需要。** 它的同步是**服务端按时间窗口下发实例**：客户端滚到"下个月"，得问服务端要那个窗口的重复实例。于是需要两样东西 —— 物化的实例行（`ZINSTANCETYPE`/`ZSTARTDATE`/`ZENDDATE`/`ZREFERENCEID`，指回规则），和"这个窗口我拉过没有"的标记（`ZFETCHBEGINDATE`/`ZFETCHENDDATE`/`ZHASHTAG`）。**`ZHASHTAG` 这个字段最能说明问题**：它是"规则变了要重拉"的失效标记 —— 只有在"实例是缓存"的架构里才需要哈希。

**heyta 要不要：不要，且这是六类里省得最干净的一条。**

- heyta 的重复是**客户端求值**（`recurrence.ts:117 occurrencesInRange`），规则在 `Task.repeatRule` 上（`entities.ts:399`），没有实例行 ⇒ 不需要 fetch flag，也不会出现"实例行与规则漂移"（改了标题，历史实例行还是旧标题）。
- 代价要如实写：**没有实例行 ⇒ 不能"只改/只跳过某一次"**。heyta 没有 `exDates` 字段（`grep -rniE 'exdate'` 在 `packages/domain/src`、`packages/shared-schema/src` 零命中），所以"这周三跳过"今天表达不了。真要做，是一个**可加性可选字段**（`exDates?: string[]`，加在 `Task` 上），**不 bump `CURRENT_SCHEMA_VERSION`**，也**不需要**物化实例。

### 2.4 专注独立同步表：`ZTTFOCUSSYNCOPERATION`

**它为什么需要。** 专注是**长时运行的状态机**：开始/暂停/继续/休息/结束各自是一条要同步的事，而"会话还没结束"时，这些事**没有地方挂** —— 不能挂在一条还没写出来的会话上。于是它需要一个 op 队列表（`ZOP`/`ZDURATION`/`ZAUTOPOMOLEFT`/`ZPOMOCOUNT`/`ZFOCUSONTYPE`/`ZFIRSTFOCUSID`/`ZSYNCSTATUS`）。Windows 同构：`FocusOptionModel` + `FocusSyncStatusModel`（`TickTickModels.dll`，DAO = `FocusOptionModelDao`）—— **两端都有这张表**，说明它不是 macOS 的偶然实现。

**heyta 要不要：不要这张表，但要这个能力 —— 而且已经有了。**

- 底座不同：heyta 的 op-log 本体就是"操作队列"（`state.ts:634 applyOperation`），专注的每次 start/pause 天然是一条 op；`FocusSession` 是实体（`entities.ts:597`），进行中状态机在 `focus.ts:40 FocusState`。
- 这是 heyta 架构**真的**省掉的一类表（不是"还没做"）。判据：它的表之所以存在，是因为它的同步是"状态快照 + 队列"两层；heyta 只有 op-log 一层。

### 2.5 日历订阅五表链：`ZTTCALSUBSCRIPTION*`

**它为什么需要。** 外部日历（Google / Outlook / CalDAV）是**只读镜像**，且**属于别人的数据**：不能反向写、不能套用任务的同步语义。所以它单开一条链，五张表各有职责：

| 表 | 职责 | 关键列 |
|---|---|---|
| `ZTTCALSUBSCRIPTIONACCOUNT` | 第三方账号（**没有密码列**，见下） | `ZUSERNAME`/`ZSITE`/`ZKIND`/`ZWORKSPACEID`/`ZWORKSPACENAME`/`ZEXPIRED` |
| `ZTTCALSUBSCRIPTIONCALENDAR` | 账号下的日历 | `ZOUTID`/`ZACCESSROLE`/`ZPRIVILEGESET`/`ZSORTORDER`/`ZURL` |
| `ZTTCALSUBSCRIPTIONEVENT` | 事件本体 | `ZUID`/`ZORIGINALSTARTTIME`/`ZRECURRENCE`/`ZATTENDEES`/`ZRESPONSESTATUS` |
| `ZTTCALSUBSCRIPTIONPROJECT` | 日历 ↔ 清单绑定 | `ZSYNCPROJECTID`/`ZSYNCPROJECTSCOPE`/`ZDEFAULTTAGS` |
| `ZTTCALSUBSCRIPTIONARCHIVEREVENT` | 已删除事件的去重墓碑 | `ZUNIQUEKEY`/`ZVERSION`/`ZEVENTIDENTIFIER` |

**一个值得记下的不对称（别再凭印象写"凭据在库里"）**：macOS 这张订阅账号表 **20 列里没有 `ZPASSWORD`** —— `ZUSERNAME`/`ZSITE`/`ZKIND`/`ZWORKSPACEID` 都有，密码没有 ⇒ 凭据不落在这个库。而 Windows 的 `BindCalendarAccountModel` **有 `Password` 属性**（14 属性）。这是两端少见的"安全姿态不一致"。
⚠️ 但 Windows 那个字段**是否加密存储未核实**（没有库文件、也没有运行期样本）—— 不要据此下"明文"的结论，见 §4 第 8 条。

Windows 用 4 张（`BindCalendarAccountModel` + `BindCalendarModel` + `CalendarEventModel` + `CalendarSubscribeProfileModel`，另加 Google 专用的 `TaskGoogleEventInfo`）承载同一件事 —— 又一次「同语义、不同拆分」。

**heyta 要不要：这是真缺口，但缺的是产品面，不是数据模型面。**

- 现状零订阅：`ical.js` 只用于 RRULE 求值（`recurrence.ts` 头部第一段），没有 ICS 拉取。
- 若要做，形状**不该是 5 张表**：heyta 已有 `EVENT`/`CountdownEvent`（`entities.ts:782`）这一档，正确做法是给"外部事件"一个独立实体 + 一条 `source` 标记，且**镜像应当整体替换而不是逐字段 LWW**（只读镜像合并字段的语义是错的：远端删了一个字段，本地 LWW 会把它留着）。
- 结论：**暂不做**。做的时候必须先写 ADR，理由是这个功能会**撞上 op-log 的 LWW 语义**（§2.5 最后一段），不是加几张表的事。

### 2.6 模板三件套：`ZTTTASKTEMPLATE` / `ZTTPROJECTTEMPLATE` / `ZTTPRESETPROJECT`

**它为什么需要。** 三张表三件不同的事，所以叫"三件套"：

| 表 | 是什么 | 是不是用户数据 |
|---|---|---|
| `ZTTTASKTEMPLATE`（`ZCHILDREN`/`ZITEMTITLES`/`ZTAGNAMES`） | **一次插入一棵子树** + 检查项 + 标签 | 是（带 `ZACCOUNTID`） |
| `ZTTPROJECTTEMPLATE`（`ZNAME`/`ZKEYWORD`） | 清单模板（按关键词匹配） | 是 |
| `ZTTPRESETPROJECT`（`ZEMPTYTITLE`/`ZEMPTYCONTENT`/`ZTASKTITLES`/`ZISDEFAULTSELECTED`） | 新建清单时的**预设选项** | **否**（无 `ZACCOUNTID`） |

**heyta 要不要：拆开答，不要把三件当成一件。**

- **预设清单：不要。** 无 `ZACCOUNTID` 说明它本来就该是**随包静态数据** —— 和节假日同一档（§2.7），进常量/生成数据即可，不需要实体、不需要同步、不需要 op。
- **任务模板：要，但现在别建实体。** 建实体就要进 op-log、要跨端、要 AI 覆盖（`check:ai-coverage` 分母 +1），而当前**零产品需求**（`grep -ri template` 在 `packages/domain/src` 零命中）。最省形状是复用 `Task` 的字段子集 + 一棵子树（像 `ZCHILDREN`），等产品要了再按 ADR 定。
- 这是六类里**唯一"应该做但还没有形状"**的一条 —— 也是唯一适合写进下一阶段计划的一条。

### 2.7 其余候选：逐条标处置（不展开）

| 候选 | 它的形状 | heyta 现状 | 处置与判据 |
|---|---|---|---|
| 课程表 | `ZTTTIMETABLE` + `ZTTCOURSE` + `ZTTCOURSEARCHIVE`；Windows `TimeTableModel`/`CourseModel` | 零命中 | **不要**。学生场景（周课表 + 学期归档）与 heyta 目标用户不重合，且它是**独立产品面**不是任务模型的一部分 |
| 筛选器 | `ZTTFILTER`（`ZRULE` 是查询 DSL 字符串）；Windows `FilterModel` | 纯函数（`task-filter.ts:51`/`:93`） | **暂不要，但要备查**。「保存的智能清单」是最容易被误判成"视图"的一条 —— `entity-types.ts:15-18` 的原则 2 说"视图不建实体"，而**保存的筛选是用户数据、不是视图**。真做时它该是一个实体，不是派生 |
| 节假日 / 农历 | `ZTTHOLIDAY`（`ZCATEGORY`/`ZRESTTYPE`，无 `ZACCOUNTID`）；Windows `HolidayModel`（`region`） | 随包数据（`holidays.ts:56` + `generated/holiday-cn.generated.ts`） | **保持现状**。`holidays.ts` 头部那张表把"节日可算 / 调休不可算"分开写死了；一张能同步的表等于把**不可算的行政决定**也当成可算的（调休次年 11–12 月才公布） |
| 网络临时数据 | `ZTTNETTEMPDATA`（`ZDATA`/`ZTYPE`）；Windows `TempDataModel` | 无 | **不要**。缓存不是事实源；heyta 的 op-log 是唯一写入口（`AGENTS.md` §3.4），缓存掉了重算即可 |
| 看板列 | `ZTTCOLUMN`（`ZISCOMPLETED`/`ZISINPROGRESS`/`ZISINITIAL`）；Windows `ColumnModel`（**没有**这三个布尔） | 无 | **暂不要**。heyta 无看板视图；若做，三个状态列是**产品固定的三列**（不该是实体，除非要自定义列名/颜色 —— 那时才建实体） |
| 清单分组 | `ZTTPROJECTGROUP`；Windows `ProjectGroupModel` | `Project.parentId`（`entities.ts:439`） | **不复刻**。独立分组实体 = 两套层级各自维护父子；heyta 有意只做一层文件夹（`entities.ts:432-437`） |

---

## 3. 两端一致性检验：同一实体在 macOS 与 Windows 是否同构

这一节回答一个比"我们缺什么"更硬的问题：**「语义共享、UI 各写」到底做到了什么程度**。做法是把同一个业务实体在两端摆在一起看。

### 3.1 量化

| 面 | macOS 8.2.03 | Windows 8.2.5.0 |
|---|---|---|
| 存储层 | GRDB（`TTGRDBPod`），迁移 DDL 以字符串内嵌 | sqlite-net（本体在 `TickTickModels.dll`），**类即表**（无 DDL 字面量） |
| 表 / 类的规模 | **58 张表**（56 业务 + `Z_PRIMARYKEY`/`grdb_migrations` 2 张系统表） | `ticktick_WPF.Models` **292 个类型**；**83** 个派生 `TickTickModels.BaseModel`；**26** 个表名出现在手写 SQL 字面量里 |
| 带 `etag` 的比例 | `ZETAG` **19 / 56** | `etag` **16 / 83** |
| 带同步状态的比例 | `ZSYNCSTATUS` **36 / 56** | `syncStatus` \| `sync_status` **14 / 83**（另有泛化的 `SyncStatusModel` 表） |
| 带账号维度的比例 | `ZACCOUNTID` **52 / 56** | `userId` **47 / 83**（`TaskModel` 无） |
| 带排序列的比例 | `ZSORTORDER` **15 / 56** | `sortOrder` \| `SortOrder` **21 / 83** |
| 复合主键来源 | GRDB 的 `Z_PK INTEGER PRIMARY KEY`（56 张全有） | `[PrimaryKey]` 仅 **4** 处；主键靠 `BaseModel.Id` 约定 + 手写查询 |

两组数字放在一起看，结论已经很清楚：**没有一份共享 schema**。`etag`/`syncStatus` 这一类"同步契约词汇"的覆盖率两端接近（它是服务端协议逼出来的），而**表拆分、列命名、账号维度的表达方式**各写各的。

### 3.2 同构清单（语义 + 结构都对得上）

判据是"关键列能一一对上"，不是"名字一样"。

| 业务实体 | macOS | Windows | 同构依据（列对照） |
|---|---|---|---|
| 清单 | `ZTTPROJECT` | `ProjectModel` | `ZKIND`↔`kind`、`ZVIEWMODE`↔`viewMode`、`ZSORTOPTION`↔`SortOption`、`ZTIMELINE`↔`Timeline`、`ZGROUPID`↔`groupId`、`ZETAG`↔`etag`、`ZCLOSED`↔`closed` |
| 标签 | `ZTTTAG` | `TagModel` | `ZPARENT`↔`parent`、`ZCOLLAPSED`↔`collapsed`、`ZSORTOPTION`↔`SortOption`、`ZTIMELINE`↔`Timeline`、`ZLABEL`↔`label`（Windows 多 `pinyin`/`inits`） |
| 清单分组 | `ZTTPROJECTGROUP` | `ProjectGroupModel` | `ZEXPANDED`↔`open`、`ZSHOWSALL`↔`showAll`、`ZSORTTYPE`↔`sortType`、`ZSORTOPTION`↔`SortOption` |
| 筛选器 | `ZTTFILTER` | `FilterModel` | `ZRULE`↔`rule`、`ZSORTTYPE`↔`sortType`、`ZVIEWMODE`↔`viewMode`、`ZSORTOPTION`↔`SortOption`（Windows 多 `ParallelViewMode`） |
| 习惯 | `ZTTHABIT` | `HabitModel` | `ZGOAL`↔`Goal`、`ZSTEP`↔`Step`、`ZUNIT`↔`Unit`、`ZTARGETDAYS`↔`TargetDays`、`ZRECURRENCERULE`↔`RepeatRule`、`ZSECTIONID`↔`SectionId` |
| 打卡 | `ZTTHABITCHECKIN` | `HabitCheckInModel` | `ZCHECKINSTAMP`↔`CheckinStamp`、`ZVALUE`↔`Value`、`ZGOAL`↔`Goal`、`ZOPTIME`↔`opTime` |
| 专注 | `ZTTPOMODORO` | `PomodoroModel` | 见 §3.3 (a)：**8 对字段一一对应，命名全不同** |
| 倒数日 | `ZTTCOUNTDOWN` | `CountdownModel` | `ZIGNOREYEAR`↔`IgnoreYear`、`ZDAYSOPTION`↔`DaysOption`、`ZSHOWAGE`↔`ShowAge`、`ZTIMERMODE`↔`TimerMode`、`ZSTYLE`↔`Style`、`ZPINNEDTIME`↔`pinnedTimeValue`（提醒一侧命名不同：`ZREMINDERS`↔`Reminder`、`ZRECURRENCERULE`↔`RepeatFlag`） |
| 任务模板 | `ZTTTASKTEMPLATE` | `TaskTemplateModel` | `ZCHILDREN`↔`ChidlrenToString`、`ZITEMTITLES`↔`ItemsToString`、`ZTAGNAMES`↔`TagsToString` |
| 评论 | `ZTTCOMMENT` | `CommentModel` | `ZTASKID`↔`taskSid`、`ZREPLIEDCOMMENTID`↔`replyCommentId`、`ZMENTIONS`↔`mentions`、`ZATTACHMENTS`↔`Attachments`、`ZCOMMENTERUSERPROFILE`↔`userProfile` |

**10 对同构。** 其中「任务模板」那一行值得单独指出：Windows 的 `ChidlrenToString` **少一个 `d`**，而 macOS 的 `ZCHILDREN` 拼对了 ⇒ 这个名字是**各端各自手敲**的（照抄同一个拼写不会只错一边），与 §3.3 (a) 的结论同向。

### 3.3 五处结构性分叉（语义同、结构不同）

**(a) 字段一一对应，命名几乎全不同。** 专注会话是最干净的样本：

| macOS `ZTTPOMODORO` | Windows `PomodoroModel` |
|---|---|
| `ZTYPE` | `Type` |
| `ZPOMOSTATUS` | `Status` |
| `ZSTARTDATE` / `ZENDDATE` | `StartTime` / `EndTime` |
| `ZPAUSEDURATION` | `PauseDuration` |
| `ZADJUSTEDFOCUSDURATION` | `AdjustTime` |
| `ZADDED` | `Added` |
| `ZNOTE` | `Note` |
| `ZTASKID` | `TaskSid` |

8 对字段，**没有一对同名**。`ZSTARTDATE` ↔ `StartTime`（Date 对 Time）尤其说明问题：两端的命名各自翻译了同一个服务端字段。⇒ "语义共享"是真的，"结构共享"是假的。

**(b) 同一功能不同表拆分。**

| 功能 | macOS | Windows |
|---|---|---|
| 排序空间 | 7 张表 | 3 张表（两个类映射到同一张 `SyncSortOrderModel`） |
| 日历订阅 | 5 表链 | 4 表 + Google 专用表 |
| 提醒 | `ZTTREMINDER`（规则）+ `ZTTDELAYREMINDER`（延迟） | `TaskReminderModel`（按任务）+ `ReminderModel`（跨实体 23 属性）+ `ReminderDelayModel` |
| 同步状态 | `ZTTTASKUPDATESTATUS`（**只管任务**，带 `ZFROMPROJECTID`/`ZOLDPARENTID`） | `SyncStatusModel`（**泛化到任意实体**，带 `MoveFromId`/`OldParentId`/`ModifyPoint`） |

最后一行是"同语义不同抽象层次"的典型：macOS 把"任务被移动过"做成**任务专用**表，Windows 做成**通用**表（`EntityId` + `Type`）。

**(c) 账号维度的三种表达。** macOS 每行 `ZACCOUNTID`；Windows 半数类有 `userId`，而 **`TaskModel` 一个都没有**（任务靠 `ProjectModel.userid` 间接归属）；heyta 干脆不在数据层表达（§2.1）。同一件事三种答案 ⇒ 这一层**没有共享设计**。

**(d) 只在一端存在的表。**

- 只在 macOS：`ZTTREPEATINSTANCE`、`ZTTREPEATINSTANCEFETCHFLAG`、`ZTTTASKCOLLAPSEDSTATUS`、`ZTTTASKMODIFYTIMES`、`ZTTSORTORDER`（Windows 用通用表替代）、`ZTTBACKUP`。
- 只在 Windows：`TaskGoogleEventInfo`（18 属性）、`TaskSyncedJsonModel`、`ProjectSyncedJsonModel`/`FilterSyncedJsonModel`/`TagSyncedJsonModel`、`SearchHistoryModel`、`TaskDetailItemModel`。
- 这一组的含义：**不是"谁更新"，而是"两端的宿主能力不同"** —— Windows 要处理 Google 会议链接与 WebView2 同步 JSON，macOS 要处理重复实例拉取窗口。

**(e) Windows 还多一层 Kotlin 核心。** `KotlinModels.dll` 只有 **13 个 TypeDef**（`KotlinModels.TASK`/`CheckItem`/`Reminder`/`Attachment`/`TTCalendar`/`DueDataModel`/`BatchEditModel`/…），**没有列**（无 backing field）—— 它是 **KMP 桥接层**，背后是原生 `KotlinMultiplatformAll.dll`（x86-64，6.7 MB）。而 `TickTickHandler.dll` 的 75 个 TypeDef 里出现 `KotlinMultiplatformAll_kref_com_ticktick_task_modifyrepeat_*` 一族，说明**重复规则的计算在 Kotlin 核心里**，WPF 只是壳。

⇒ 这一条把"UI 各写"的边界往深推了一层：Windows 不只是 UI 各写，**连业务引擎都复用了移动端的 Kotlin 代码**；macOS（Swift + GRDB）是另一套。

### 3.4 结论

**两端共享的是「字段词表 + 语义」，不是 schema。**

三条可检验的判据：

1. **对象数一致、字段数接近**：同一业务实体在两端都存在 —— 56 张 macOS 业务表里，只有 **3 张**在 Windows 找不到对应物（`ZTTREPEATINSTANCE`、`ZTTREPEATINSTANCEFETCHFLAG`、`ZTTBACKUP`），且这 3 张都属"实例缓存 / 本地快照"一类（§2.3）。
2. **命名几乎全不同**：§3.3 (a) 的 8 对字段零同名；连唯一能对上的 `children` 一族也**只有 Windows 一侧把 `Chidlren` 拼错** —— 同一份拼写不会只错一边，说明列名是各端各自敲的。
3. **表拆分不同**：排序 7 vs 3、日历订阅 5 vs 4、同步状态专用 vs 泛化。

所以「语义共享、UI 各写」在**数据层**实际做到的是「**语义共享、存储各写**」。把它当作一份"多端复用的 schema"来读会全程读错；当作"一个服务端契约 + 三套（Swift/GRDB、C#/sqlite-net、Kotlin 共享核心）本地映射"来读，每一处差异都有解释。

**这对 heyta 的直接含义**：不要把它的表结构当成"正确形状"来抄。它自己两端就不一致 —— 而它两端能不一致，恰恰是因为**真正共享的那一层（服务端 JSON 字段）在数据库之上**。heyta 的对应层是 `packages/shared-schema/`：这是**我们已经做对的地方**，也是本文不建议照抄任何一张表结构的根本理由。

---

## 4. 未核实项与取证边界

按"会不会推翻本文结论"排序。

1. **本地库真实 schema 未取证。** 58 张表来自迁移 DDL 的**累积字面量**，我取的是 `CREATE TABLE IF NOT EXISTS` 的**基线列**。运行时可能已有 `ALTER TABLE … ADD COLUMN`（GRDB 迁移的常见第二步），那些列**不在**我这份清单里。
   ⇒ 结论「某表没有某列」在本文里只用于 macOS 侧且都配了"Windows 端也没有"或"heyta 有对应物"的交叉证据；单独依赖"macOS 没有某列"的判定请先跑一次 `.schema`。
   ⇒ 本轮**未确证** 8.2.03 的库文件路径（`~/Library/Application Support/…/TickTick.db` 一类），因此**没有**做这一步。

2. **Windows 的库文件没取。** `/tmp/rea-lab/win/app` 是**解包目录**，没有运行期产生的 `TickTick.db`。Windows 侧的表名结论全部来自 ①UTF-16 `#US` 堆里的手写 SQL 字面量（`select * from TaskModel …`，26 张表名）②类名/属性名。**不是** `.schema` 输出。
   ⇒ 因此「Windows 表名 = 类名」是**强推断**（有 SQL 字面量 + `[Table]` 覆写两处反例佐证），不是日志级事实。

3. **`[Ignore]` 让「属性集 ≠ 列集」。** Windows 侧 111 个属性带 `[Ignore]`（`Attachments`/`Reminders`/`Tags`/`SortOption`/`Timeline`/`Calendars`/`userProfile` 等）。本文表格里 Windows 列是**属性清单**，其中被 `[Ignore]` 标注的那些**不是列**。要精确列集只有两条路：跑 `.schema`，或逐个类减去 `[Ignore]`。
   ⇒ 影响面：§3.1 的"带 X 列的比例"可能偏大（分母 83 是类数，不是列数），但**不影响**任何一条"对应 / 它有我无"的判定。

4. **「类名即表名」有 2 处显式覆写。** `ProjectPinSortOrderModel`→`SyncSortOrderModel`、`AIPinStorageRow`→`AIConversationPins`。所以它是**默认值**而非常量。**已知的第一对共表是 `ProjectPinSortOrderModel` + `SyncSortOrderModel`**（§3.3 (b) 的 "Windows 3 张表" 已把它算作一张）；若还有第三处覆写没被解出来，那个计数会再变。

5. **只对照了 1 个版本组合**（macOS 8.2.03 / Windows 8.2.5.0），且**两端版本号不同**。跨版本漂移（老列还在不在、迁移链怎么累积）未验证。本文任何"某端有 N 张表"都是**这两个版本**的现量。

6. **Windows 建表路径是推断。** 已观测：`CREATE TABLE` / `INSERT INTO` 字面量各 **0** 条，而 `[PrimaryKey]` 只有 4 处。这两件事放在一起，最自然的解释是"建表与写入由 sqlite-net 按映射在运行时生成，SELECT 手写"。**这是推断，未在运行时验证**（没有库文件、也没跑过那个 exe）。它不影响实体对照，只影响"DDL 在哪"这个方法论问题。

7. **`Z_PRIMARYKEY` / `grdb_migrations` 未展开。** 它们是 GRDB 的系统表，本文只用来证明"58 张里 56 张是业务表"。

8. **`BindCalendarAccountModel.Password` 的存储形态未核实。** 已观测：macOS 的对应表 `ZTTCALSUBSCRIPTIONACCOUNT` **没有密码列**，Windows 那个类**有** `Password` 属性（§2.5）。但"属性存在"不等于"明文入库"—— 它可能是加密串、也可能由别的通道落盘。**本轮没有库文件、也没有运行期样本，因此不下任何"安全"结论。** 要用这条必须先在 Windows 上取一份 `TickTick.db` 看该列的取值形状。

---

## 5. 复现线索（只列命令，不列结论）

```bash
# macOS：表名 + 列清单（DDL 是连续长串，取 CREATE ... 到第一个右括号）
# ⚠️ 别用 `strings | grep '^ZTT[A-Z]*$'` 数表名：实测得 67 条，比真实的 56 张业务表
#    多 11 条（那个正则同时命中不是表名的字面量）。表名只能按 CREATE TABLE 上下文取。
python3 - <<'PY'
import re
b=open("/Applications/TickTick.app/Contents/Frameworks/TTGRDBPod.framework/Versions/A/TTGRDBPod","rb").read()
tabs={}
for m in re.finditer(rb'CREATE TABLE IF NOT EXISTS (ZTT[A-Z0-9_]+) \((.{0,4000}?)\)', b, re.S):
    tabs.setdefault(m.group(1).decode(), m.group(2).decode('utf-8','replace'))
print('业务表', len(tabs), '（另有 Z_PRIMARYKEY / grdb_migrations 2 张系统表）')
for n, body in tabs.items():
    cols=re.findall(r'\b(Z[A-Z0-9_]+) (?:INTEGER|TEXT|TIMESTAMP|VARCHAR|BLOB|REAL)', body)
    print(n, len(cols), ','.join(cols))
PY

# Windows：实体类与属性（dnfile，不用跑目标）
PYTHONPATH=/tmp/rea-lab/py python3 - <<'PY'
import dnfile
pe=dnfile.dnPE('/tmp/rea-lab/win/app/TickTick.exe'); md=pe.net.mdtables
models=[r for r in md.TypeDef.rows if str(r.TypeNamespace)=='ticktick_WPF.Models']
print('Models 类型', len(models), '/ 全部 TypeDef', len(md.TypeDef.rows))
for r in models:
    props=[str(x.row.Name) for x in r.FieldList if 'k__BackingField' in str(x.row.Name)]
    if props: print(str(r.TypeName), len(props))
PY

# Windows：手写 SQL 表名（注意 #US 是 UTF-16LE，macOS strings 没有 -e，用 python 抽）
python3 - <<'PY'
import re
data=open('/tmp/rea-lab/win/app/TickTick.exe','rb').read()
for m in re.finditer(rb'(?:[\x20-\x7e]\x00){5,}', data):
    s=m.group()[::2].decode('ascii','ignore')
    if re.search(r'\bfrom\s+[A-Za-z]', s, re.I): print(s)
PY
```

---

## 6. 一句话结论

**它比我们多的 15 行实体里，真正该补的只有 3 行 / 2 项（任务模板 #34、清单模板与预设 #35、日历订阅 #33），而且两项都不是"加表"能解决的 —— 一项要先有产品形状（模板），另一项要先解决只读镜像与 LWW 的冲突（订阅）。其余 12 行 —— 多账号（#43）、重复实例物化（#9/#10）、专注同步队列（#22）、习惯分组与文字记录（#17/#18）、看板列（#28）、课程表（#36）、网络临时数据（#40）、任务侧三张状态表（#30/#31/#32）—— 都是它那套"服务端下发 + 本地快照"架构的产物，heyta 的 op-log 已经把它们的位置占了。**

而两端自身的不一致（§3）是本文最有用的一条副作用证据：**连它自己都没有一份跨端 schema**，所以「照它的表结构设计」这个做法本身就没有可抄的对象。
