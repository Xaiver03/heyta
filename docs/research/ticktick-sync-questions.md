# 滴答清单 P4：同步与冲突 —— 从「表 + 路径 + 字符串」能推到什么、不能推到什么

> 立项：2026-11-06。支线 P4，只做**静态取证 + heyta 对账**。
> 上游是同一轮的主取证文档 [`ticktick-desktop-teardown-2026-11`](ticktick-desktop-teardown-2026-11.md)（包结构、数据模型、界面清单）；
> 本文只补它没展开的那一格：**同步与冲突的形状**，以及「它一定回答过、heyta 也必须回答」的问题清单。
>
> 🔴 **本轮没有抓包、没有反编译 Kotlin 层、没有登录任何账号。**
> 因此本文里**所有关于「云端协议」的陈述一律未核实** —— 包括但不限于：主同步通道的端点、
> 请求/响应体字段、服务端裁决规则、冲突错误码。第 6 节逐条列出这些空洞。
> 本文里凡是我推出来的，都写了「凭什么这么猜」；凡是不能推的，写「不可见」，不写「大概是」。

---

## 0. 六句话结论

1. **它的任务同步不是 op-log，是「行 + 行级同步状态位 + 版本戳」。** 58 张表里 36 张带 `ZSYNCSTATUS`、20 张带 `ZLASTMODIFIEDDATE`、19 张带 `ZETAG`，而**没有任何一张全量 oplog 表**（带操作列 `ZOP` 的只有 2 张：专注操作 + 延迟提醒；`ZOID`+`ZOTYPE` 只在专注那张，见 §2.2、§2.6）。这与 heyta 的 op-log/向量时钟是**两种不同的同步范式**，不是同一件事的两种写法。
2. **传输编排在原生层，但 Kotlin 层不是「只有词汇」。** TickTickKit 的二进制里保留了内嵌源码路径：`TTSyncManager.swift`、`TTSyncService.swift`、`TTBatchSyncHandler.swift` 及其逐实体子类——**push/pull/游标在这一层**。Kotlin 侧 macOS 切片确实只剩 `KMAConstantsSyncType` / `KMAConstantsSyncStatus` / `KMADeletedStatus` 这类**枚举字面**（`KMAConstants*` 现量 **53** 个，`grep -oE 'KMA[A-Za-z]*[Ss]ync[A-Za-z]*'` 只回三条 `KMAConstants*`）；
   🔴 **但 Windows 那颗 DLL 没剥净符号**，`kfun:` 读数里 Kotlin 层有 `modifyrepeat.sync.entity.*`（同步实体模型）、`modifyrepeat.helper.editor.*`（重复任务三种改法的处理器）、`core.date.recurrence.TickRRule`、`task.diff.DiffMatchPatch`——**业务规则与数据模型在共享层，只是 macOS 切片看不见**（§2.11）。
   上一轮 Teardown §7 说「KMP 层承载同步/冲突，未核实」：本轮的修正是**一半对**——承载的是规则与模型，不承载传输。
3. **它把「什么变了」拆得比「谁赢了」细得多。** 变更种类有 13 个 `SYNC_TYPE_*` 常量，任务侧还有四个**按维度**的批处理处理器（指派 / 顺序 / 父子 / 所属清单）；字段侧保留了一整族 `*Changed` 布尔键。但**裁决**那一侧，可见的只有 `ZLASTMODIFIEDDATE` + `ZETAG` 和一个取值不可见的 `DEFAULT_CONFLICT_STRATEGY`。
4. **专注、习惯、计时、课表、倒数日、项目模板、回收站各自有独立的 SyncManager；专注还多一张自己的操作表和一个 WebSocket helper。** 这是本轮最强的「独立通道」证据（§2.6–§2.7）。
5. **账号隔离靠 `ZACCOUNTID` 列，不靠分库。** 52/58 张表带它；同步代码里有一整族「account changed after X」守卫，还有一句 `big sync: cancelled stale account sync`。**它把「同步途中账号被换掉」当成一类必须显式处理的故障**（§2.9）。
6. **heyta 在 16 个问题里答了 9 个、答了但语义不同 5 个、没答 2 个（逐行相加 = 16，见 §4）。** 没答的两条是「每个视图能不能独立手排」与「多账号切换时本地库怎么隔离」；另有一条**实现了却从未被 ADR 论证**的语义（重复任务的「完成即推进」）。⚠️ 这些**不是缺陷**，是**尚未拍过的产品决定** —— 本文不给工单，只把问题摆到能被拍板的位置。

---

## 1. 取证口径

### 1.1 证据强度三级（本文全篇只用这三档）

| 档 | 判据 | 反例（为什么它不够格） |
|---|---|---|
| **强** | 有**确定性字面**：表名 + 列名、写进二进制的路径/枚举常量、或内嵌源码文件名。可复跑，读数稳定 | —— |
| **中** | 有字面但**归属层级不明**（知道这个词在包里，不知道它属于哪个结构体/哪条路径），或需要一步推理才能连到同步 | `mergeReminders.delta` 只证明存在一次"按 delta 合并提醒"的调用点，不证明线上载荷长这样 |
| **推测** | 只有**形状**没有**证据**：同类产品惯例、命名相似、缺某字面因而反推 | 「没看到 `/sync` 端点 ⇒ 端点一定叫 `/batch`」——这是缺失证据，不是证据 |

🔴 **本文不使用「大概/应该/想必」**：凡是这三档之外的话，一律进第 6 节的未核实清单。

### 1.2 本轮新增的四类读数（上一轮没有的）

| 新增读数 | 怎么取的 | 为什么它能提高证据档 |
|---|---|---|
| 58 张表的**完整 DDL 列名** | `strings -a TTGRDBPod \| grep 'CREATE TABLE'` 后再解析括号内列 | 列名是**结构性事实**：`ZSYNCSTATUS` 出现在 36 张表里，这个分布本身就是判据 |
| TickTickKit 的**内嵌源码路径** | 断言消息里带了 `/Volumes/workspace/repository/TickTickMac/...swift` | 文件名即**模块边界**：`TTTaskBatchSyncHandler` 与 `TTFocusSyncManager` 并列存在，说明它们不是同一层 |
| **Kotlin 层的类名清单** | `lipo -thin arm64` 后 `strings \| grep -oE 'KMA[A-Z][A-Za-z]+' \| sort -u` | 反证「引擎在 Kotlin」：**1024** 个 `KMA*` 类名里 `KMAConstants*` 只有 **54** 个，且没有一个是同步引擎（`KMASync*` 一个都不存在；带 `Patch` 字样的只有 `KMADiffMatchPatch*`，那是文本 diff 库） |
| **按框架分解的 `/api/` 路径** | 逐个 `.framework` 里 `strings \| grep -oE '/api/v[0-9]/...'` | 上一轮只统计了主二进制的 38 条；实际上 **TickTickKit 里另有 60 条**，且**都不在主二进制里** |

⚠️ 上一轮的 38 条与本文的 60 条**不重叠**（两个二进制各一份）。上一轮 Teardown §2 的「38 条」只覆盖主二进制，请以「主二进制 38 + TickTickKit 60」为准。

### 1.3 本轮的硬边界

- **不抓包**：没有 `mitmproxy` / `tcpdump`，一条请求都没看过。
- **不反编译**：Kotlin 层只做 `strings`；Swift 层只有符号与内嵌路径，没有反汇编。
- **不读用户数据**：`~/Library/Containers/com.TickTick.task.mac/Data` 在本机被 TCC 拒绝（`Operation not permitted`），本轮**没有**绕过。所以「本地库文件名 / 是否按账号分库」不能靠磁盘观察，只能靠二进制里的列名推（§2.9）。
- 与仓规一致：[`THIRD_PARTY_LICENSES.md`](../../THIRD_PARTY_LICENSES.md) 的「不使用其商标/图标/文案/界面素材」不变；本文只写结构与取舍。

---

## 2. 它推得出来的同步形状（每条带强度）

### 2.1 总图：状态同步，不是事件溯源

```text
        ┌───────────────── 原生层（macOS: Swift TickTickKit / Windows: .NET）─────────────────┐
        │  TTSyncManager ── TTSyncService ── TTHTTPManager+Entity ── TTStorageCenter          │
        │        │                                                                            │
        │        ├── TTBatchSyncHandler ─┬─ TTTaskBatchSyncHandler                            │
        │        │                       ├─ TTProjectBatchSyncHandler                         │
        │        │                       ├─ TTProjectGroupBatchSyncHandler                    │
        │        │                       ├─ TTTagBatchSyncHandler                             │
        │        │                       └─ TTFilterBatchSyncHandler                          │
        │        ├── 任务四维度: TT{Assignee,Order,Parent,Project}UpdatedTaskBatchSyncHandler  │
        │        ├── 逐域: Habit / Countdown / Timer / Timetable / ArchivedCourse / Template  │
        │        └── 回收站: TTTrashDataService                                                │
        └───────────────────────────────────┬──────────────────────────────────────────────────┘
                                            │
        ┌───────────────────────────────────▼──────────────────────────────────────────────────┐
        │  Kotlin 共享层（KotlinMultiplatformAll）：只有词汇 —— KMAConstantsSyncType /          │
        │  SyncStatus / KanbanSyncStatus / KMADeletedStatus + iCal/RRULE/时区/DiffMatchPatch   │
        └──────────────────────────────────────────────────────────────────────────────────────┘
```

**强度：强。** 判据：上述 `.swift` 路径逐条来自二进制里的断言消息，`KMA*` 类名逐条来自 Kotlin 切片；
「Kotlin 里没有 `KMASync*`」是**否定判据**（`grep -oE 'KMA[A-Za-z]*[Ss]ync[A-Za-z]*'` 只回三条 `KMAConstants*`）。

🔴 **为什么这一条重要**：如果同步引擎真在共享层，那么「两端行为一致」是结构给的；
现在引擎在原生层、共享层只有枚举，那么**两端一致靠的是同一套枚举值与同一套表结构**——
这是弱保证，也是它为什么把 13 个 `SYNC_TYPE_*` 常量放进共享层的合理解释（推测，见 §2.3）。

### 2.2 脏标记：行级 `ZSYNCSTATUS`，不是全表 diff

| 读数 | 值 | 强度 |
|---|---|---|
| 带 `ZSYNCSTATUS` 的表 | **36 / 58** | 强 |
| 带 `ZACCOUNTID` 的表 | **52 / 58** | 强 |
| 带 `ZLASTMODIFIEDDATE` 的表 | 20 | 强 |
| 带 `ZETAG` 的表 | 19 | 强 |
| 带 `ZOP`（操作类型串）的表 | **2**：`ZTTDELAYREMINDER`、`ZTTFOCUSSYNCOPERATION` | 强 |
| 带 `ZOID` + `ZOTYPE`（操作 id + 操作种类）的表 | **1**（`ZTTFOCUSSYNCOPERATION`） | 强 |

🔴 **`ZOP` 这一格本轮重量的原因（探针陷阱，值得记形状）**：上一版写的是「5 张：专注、延迟提醒、两个习惯打卡、项目」。
那是**子串匹配踩到了 CoreData 自己的列**——每张表都带 `Z_OPT`（行级乐观锁计数），习惯打卡表还带 `ZOPTIME`、
项目表带 `ZOPENTOTEAM`，用 `ZOP` 当子串去数就会全中。按**整列名相等**重数后是 2 张。
复跑要写全词：`awk`/python 按列 split 比对，**不要** `grep -c 'ZOP'`。

外加共享层的五个状态常量：`SYNC_INIT` / `SYNC_NEW` / `SYNC_UPDATE` / `SYNC_DONE` / `SYNC_ERROR_UP_LIMIT`。

**推出来的形状（强）**：每一行自己带一个「我需要被同步」的状态位，
同步器扫「状态位不是 DONE 的行」，而不是比对全表或订阅变更流。
`SYNC_NEW` 与 `SYNC_UPDATE` 并列 ⇒ **新增与更新在同步器里是两条不同的路径**（不是一条 upsert）。
`SYNC_ERROR_UP_LIMIT` ⇒ 上传**有硬上限**，且这个上限是一条**具名错误**而不是静默丢弃。

**凭什么这么猜**：`SYNC_*` 是共享层常量（两端同一份），`ZSYNCSTATUS INTEGER` 是每表一列；
两者同名同序，最省的解释就是「列取值 = 常量取值」。**但这只是最省的解释，不是读到的代码**——
「哪个整数对应 `SYNC_NEW`」不可见（§6 第 3 条）。

### 2.3 变更种类：13 个 `SYNC_TYPE_*`，任务侧再按维度拆四个处理器

共享层常量（强）：

```text
SYNC_TYPE_AUTO            SYNC_TYPE_MANUAL
SYNC_TYPE_TASK_CREATE     SYNC_TYPE_TASK_CONTENT
SYNC_TYPE_TASK_MOVE       SYNC_TYPE_TASK_ORDER      SYNC_TYPE_TASK_PARENT
SYNC_TYPE_TASK_ASSIGN     SYNC_TYPE_TASK_TRASH      SYNC_TYPE_TASK_RESTORE
SYNC_TYPE_TASK_DELETE_FOREVER                      SYNC_TYPE_TASK_PENDDING
SYNC_TYPE_COLUMN_MOVE
```

原生层对应的四个任务维度处理器（强）：

| 处理器 | 对应的 `SYNC_TYPE_*` |
|---|---|
| `TTAssigneeUpdatedTaskBatchSyncHandler` | `TASK_ASSIGN` |
| `TTOrderUpdatedTaskBatchSyncHandler` | `TASK_ORDER` |
| `TTParentUpdatedTaskBatchSyncHandler` | `TASK_PARENT` |
| `TTProjectUpdatedTaskBatchSyncHandler` | `TASK_MOVE` |

**推出来的形状（强）**：一次任务修改被**归类成一种类型**再入队；
「移动/排序/父子/指派」四类各自有专门处理器，说明它们的**合并规则不一样**
（否则一个 `TTTaskBatchSyncHandler` 就够了）。`TASK_CONTENT` 与 `TASK_ORDER` 分家这一条最值得注意：
**正文变了**和**顺序变了**在它那里是**两类不同的事务**。

**推测（中）**：`TASK_PENDDING`（原文拼写如此）与 `AUTO` / `MANUAL` 并列，最省的解释是
「同步意图的来源」而不是「字段维度」——`PENDDING` 可能是"暂缓/待定"这一档的意图标记。
**凭什么这么猜**：它与 `AUTO`/`MANUAL` 同处一组、且不指向任何字段名；但**词义不可见**。

### 2.4 字段级：`*Changed` 布尔族与 `merge*.delta`（中）

二进制里有一处**连续字面簇**（强，指"存在"这件事）：

```text
delta   revised   merge   task   checklistItems
titleChanged  contentChanged  descriptionChanged  checklistChanged
kindChanged   priorityChanged  progressChanged   sortOrderChanged
statusChanged  completionDateChanged  snoozedRemindDateChanged
remindersChanged  repeatRuleChanged  repeatFromChanged
```

**推出来的形状（中）**：载荷里带着「哪个字段变了」的布尔打标，因此**上传可以只带变化的字段**。
**凭什么这么猜**：这 14 个键与任务字段一一对应、且成组出现；但**它们是哪一层结构的 CodingKeys，
不可见** —— 可能是上传体、可能是本地合并的入参、也可能是日志字段。所以只给「中」。

另一处（中）：`mergeChecklistItems.delta` 与 `mergeReminders.delta`。
这两个名字说明**嵌套集合（清单项、提醒）是按 delta 合并的**，而不是整组覆盖。
**凭什么这么猜**：`merge` + 集合名 + `.delta` 三个词同时出现，且这两类恰好是任务里唯一的两个子集合
（对比：标题/优先级是标量，不需要 delta）。⚠️ 但它只证明**存在这个调用点**，不证明线上长这样。

第三处（中）：共享层里有 `KMADiffMatchPatch*`（Google diff-match-patch 的 Kotlin 移植）。
**它的存在**说明这个产品在某个地方做**文本级 patch**；**用途不可见** —— 可能是备注同步的增量，
也可能只是 Markdown 编辑器。**不写进协议结论。**

### 2.5 版本与裁决：`ZETAG` + `ZLASTMODIFIEDDATE` 成对出现，`ZCHECKPOINT` 只在用户行

| 读数 | 强度 | 能推到什么 | 不能推到什么 |
|---|---|---|---|
| `ZLASTMODIFIEDDATE` 20 表 | 强 | 每行有时间戳，最省的解释是**裁决基准** | 是不是唯一基准（也可能是显示用） |
| `ZETAG` 19 表，与上者**高度重叠** | 强 | 每行有一个**不透明版本串**，最省的解释是**条件写/冲突检测** | etag 由谁生成、是否服务端权威 |
| `ZCHECKPOINT` **只**在 `ZTTUSER` | 强 | 同步游标是**每用户一个**，不是每表一个 | 它是 seq 号还是时间戳还是加密串（`VARCHAR`，不可见） |
| `ZCLIENTID` 在 `ZTTUSER` | 强 | **设备身份**存在用户行上（与 `SYNC_TYPE_*` 需要"谁改的"一致） | 它是否参与裁决（见 §6 第 5 条） |
| `DEFAULT_CONFLICT_STRATEGY` | 强（存在）/ **推测**（语义） | 存在一个**默认冲突策略**常量 | 取值、谁执行、服务端还是客户端 |

🔴 **这一格是全文最大的空洞**：`ZETAG` + `ZLASTMODIFIEDDATE` 只能说明「有版本、有时间」，
**不能说明冲突怎么判**。凡是把滴答的冲突策略写成「LWW」的，都在**编**——包括我如果写的话。

### 2.6 独立通道矩阵：它把「写入频次不同的东西」拆成了各自的同步器

| 域 | 有独立 SyncManager（强） | 有独立操作表（强） | 有专用端点（强） | 备注 |
|---|---|---|---|---|
| 任务 / 清单 / 标签 / 过滤器 | `TT*BatchSyncHandler` | 无 | `/api/v2/task/`、`/api/v2/project/` | 行状态位 |
| **专注 / 番茄** | `TTFocusSyncManager` + `TTFocusSyncOperationSyncManager` | ✅ `ZTTFOCUSSYNCOPERATION`（**唯一**带 `ZOID`+`ZOTYPE`，另有 `ZOP`/`ZSYNCSTATUS`） | ✅ `/api/v2/pomodoro` 等 **7 条** | 另有 `TTFocusSyncWebsocketHelper` |
| 习惯 | `TTHabitSyncManager` | 无 | `/api/v2/habits/batch`、`/api/v2/habitCheckins/batch` | 打卡是独立端点 |
| 倒数日 | `TTCountdownSyncManager` | 无 | `/api/v2/countdown/batch`、`/api/v2/countdown/list` | |
| 计时（正计时/时间线） | `TTTimerSyncManager` | 无 | `/api/v2/timer/overview/`、`/api/v2/timer/statistics/` | |
| 课表 | `TTTimetableSyncManager` | 无 | `/api/v1/course/batch/timetable` | |
| 归档课程 | `TTArchivedCourseSyncManager` | 无 | `/api/v1/course/archived` | |
| 项目模板 | `TTProjectTemplateSyncManager` | 无 | `/api/v2/projectTemplates/all` | |
| 回收站 | `TTTrashDataService` | 无 | `/api/v2/trash/restore`、`/api/v2/trash/empty` | |
| 用户文档 | `TTSyncManager+UserDocument` | 无 | —— | |

**推出来的形状（强）**：**「一条全局通道」不成立**。它至少按域拆了十来条，
且专注那条**连数据模型都不同**：它是唯一带 `ZOID`+`ZOTYPE` 的表 —— 那是一个**操作队列**的形状，
而不是行状态位的形状（`ZOP` 另有延迟提醒表一张，共 2 张，见 §2.2）。

**专注这条的额外证据（强）**：
- `isFocusKeepInSync`（一个**开关**）与 `Focus Sync: isFocusKeepInSync disabled.` ⇒ 专注同步**可被关闭**。
- `Focus Sync: account changed after preflight / after preparing data / after response parsing /
  before applying current model / before finish / before handling updates / ...`
  **9 条**不同阶段的「账号变了」守卫 ⇒ 专注同步**最容易踩到账号切换**（它可能常驻/长连接）。
- `TTFocusSyncWebsocketHelper` ⇒ 专注有**推送**参与（而任务侧只看到 `TTBatchSync*` 轮询/批处理）。
  ⚠️ WebSocket 到底推什么**不可见**（§6 第 6 条）。

### 2.7 物化：`REPEATINSTANCE` 是投影行，`FETCHFLAG` 是**范围水位**

| 表 | 列 | 推出来的角色（强度） |
|---|---|---|
| `ZTTREPEATINSTANCE` | `ZINSTANCETYPE` / `ZSTARTDATE` / `ZENDDATE` / `ZREFERENCEID` / `ZACCOUNTID` | **只有时间、没有内容**的投影行（强）⇒ 内容属于母任务，实例只为查询/展示物化 |
| `ZTTREPEATINSTANCEFETCHFLAG` | `ZREFERENCEID` / `ZFETCHBEGINDATE` / `ZFETCHENDDATE` / `ZHASHTAG` | **范围水位**，不是脏标记（强） |
| `ZTTSORTORDER` | `ZITEMTYPE` / `ZCONTEXTID` / `ZITEMID` / `ZKEY` / `ZORDER` / `ZSYNCSTATUS` | **每个视图一套手动序，一行一条**（强） |
| `ZTTPROJECT.ZNEEDSPULLTASKS` | —— | 按清单**懒拉**任务（强，列名即断言） |
| `ZTTNETTEMPDATA` | `ZACCOUNTID` / `ZENTITYID` / `ZPROJECTID` / `ZDATA` / `ZTYPE` / `ZLASTMODIFIEDDATE` | 服务端数据的**暂存区**（中：名字与列都对得上，但用途无调用点证据） |

**`FETCHFLAG` 这一格是全文最干净的一条推理（强）**：
`FETCHBEGINDATE` + `FETCHENDDATE` 是**一个闭区间**，不是布尔。
一个布尔只能表达「取过 / 没取过」，而**区间**表达的是「这一段时间里我已经有实例了」。
所以：它的重复实例是**按视窗懒物化**的（打开月视图 → 只为这个月取实例），
`FETCHFLAG` 记录已取过的窗口，避免重复请求。**凭什么这么猜**：列名 + 列类型 + 表名
三者互相印证，且没有第二种解释能同时用到这三列。

### 2.8 删除：三态状态列 + 专用端点 + 拉取侧计数

非常干净的一条（强）：

```text
KMADeletedStatus:  DELETED_NO  ·  DELETED_TRASH  ·  DELETED_FOREVER
ZTTTASK:           ZDELETIONSTATUS INTEGER        （与 KMADeletedStatus 对应）
SYNC_TYPE_*:       TASK_TRASH  ·  TASK_RESTORE  ·  TASK_DELETE_FOREVER
端点:              /api/v2/trash/restore  ·  /api/v2/trash/empty  ·  /api/v2/tasks/delete
日志字面:          ---trash push deleted count:   ---trash push restored count:
                   task pull payload counts: deleteForever=
TTTrashDataService: handleTrashedRemoteTasks · pushRestoredToServer · restoredEntityIDs
```

**推出来的形状（强）**：
1. 删除**不是删行**，是把 `ZDELETIONSTATUS` 从 `NO` 推到 `TRASH` 再推到 `FOREVER` —— 墓碑是一条**状态列**。
2. 推与拉**不对称**：推侧按 `deleted` / `restored` 分开计数，拉侧只数 `deleteForever`。
   最省的解释：**拉侧只需要知道"有哪些被彻底删了"来清本地**，而新增/更新已经在常规拉取里。
3. `pushRestoredToServer()` 是**单独一条推送**（恢复不是"再推一次创建"）。

### 2.9 账号：一库多账号，靠列 + 在途守卫

| 读数 | 强度 |
|---|---|
| `ZACCOUNTID` 在 52/58 表 | 强 |
| `ZCLIENTID` 在 `ZTTUSER` | 强 |
| `big sync: cancelled stale account sync` | 强 |
| `Focus Sync: account changed ...`（9 条） | 强 |
| 无任何 `*.sqlite-<account>` 形态的文件名字面 | 中（否定证据，且磁盘被 TCC 挡住，无法确认） |

**推出来的形状（中偏强）**：**一个库装多个账号，`ZACCOUNTID` 是分区键**；
切换账号时**不清库**，而是①每个查询带账号过滤 ②在途同步用「账号是否变了」的守卫**主动作废**。
`cancelled stale account sync` 这句话的存在本身就是证据：**它把「同步跑着跑着账号被换了」当成一类必须处理的竞态**。

⚠️ 但**分库与否**严格来说仍是「中」：`ZACCOUNTID` 只能证明行被账号标记，
不能证明只有一个文件。磁盘那一层本轮读不到（§1.3）。

### 2.10 它没有的（否定证据，同样是读数）

| 没有看到 | 覆盖范围 | 强度 |
|---|---|---|
| 任何**全量** oplog / operation 表 | 58 张表全表名；带操作列的只有 2 张域内表（专注、延迟提醒） | 强 |
| 任何形如 `/api/*/sync` 或 `/api/*/delta` 的端点 | 主二进制 38 条 + TickTickKit 60 条 + Kotlin 层（0 条 URL） | 强（**在可见字面范围内**） |
| Kotlin 层的同步引擎类 | 1024 个 `KMA*` 类名（其中 `KMAConstants*` 54 个） | 强 |
| `deleteForever` 之外的墓碑保留期策略 | —— | 不可见 |

🔴 **「没有看到」不等于「不存在」**：`/sync` 可能是拼接出来的（`api/v2/<family>/batch`
这一族**就是**不带前导斜杠的字面，说明基址 + 路径片段是拼的）。所以本文**不写**「它的同步端点是 X」。
⚠️ 本轮补一个更硬的读数：TickTickKit 里 `api/v2/batch` 作字面出现 **24 次**、`api/v3/batch` **4 次**
（`strings | grep -oE 'api/v[0-9]/batch'`）——**批次端点是存在的、且被反复用**，
只是**没有任何字面说它就是任务同步通道**（可能是 calendar-bind 那族的批量接口）。
所以这条仍然是「未核实」，但从"连候选都没有"升到了"有两个候选、无法二选一"。

### 2.11 本轮新开通道：Windows 那颗 DLL **没剥净符号**（Kotlin 函数名可读）

前面所有关于 Kotlin 层的判断都建立在 macOS 切片上，而它是**真剥了**的
（`strings` 读 `kfun:` 命中 **0**）。Windows 那颗 `KotlinMultiplatformAll.dll`（PE32+ x86-64，
`file` 报 "stripped to external PDB"）**留着 5691 条 `kfun:` 函数符号**——
不是我们反编译，是它自己没剥。于是共享层的**模块边界**第一次可见：

| 包 | 符号数 | 里面是什么（按名字读） |
|---|---|---|
| `com.ticktick.task.modifyrepeat.sync.entity` | 171 | 任务同步实体：`RecurringTask`、`ChecklistItem`、`TaskReminder`、`PomodoroSummary`、`Attachment`、`Location`/`Loc` |
| `com.ticktick.task.modifyrepeat.helper.editor` | 45 | **重复任务改动的四个处理器** + `RepeatEditorTypeDecider` |
| `com.ticktick.task.modifyrepeat.undo` | 70 | 撤销模型：`TaskCheckUndoModel`、`TaskDeletedUndoModel`（都带 `getUpdateEntityIds`） |
| `com.ticktick.core.date.recurrence` | 59 | `TickRRule` + 四种迭代器（`CustomDay` / `ForgettingCurve` / `Lunar` / `MonthlyWorkDay`） |
| `com.ticktick.recurrence` | 37（含 `.lunar` 子包合计 **92**） | `RecurrenceGenerator.isInRepeatExDates`、`RepeatUtils.setValueToRRule` |
| `com.google.ical.*` | **350** | **vendored 的 Google ical-lib**（`values.RRuleSchema` 107、`iter` 44、`iter.Generators` 45、`util` 39）——RRULE 解析在共享层。对照 heyta：我们用的是 **ical.js**（MPL-2.0，`packages/domain/src/recurrence.ts:6-10` 写明"不自研 RRULE 解析器"），**同族不同实现**；它这层的许可证本轮没核，不做判断 |
| `com.ticktick.task.diff` | 42 | `DiffMatchPatch`（Google diff-match-patch 的 Kotlin 移植，含 `Patch`/`LinesToCharsResult` 内部类） |
| `com.ticktick.task.Constants` | 248 | `SyncType` / `SyncStatus` / `KanbanSyncStatus`（只有 `<init>` 可见，**取值不可见**） |

⚠️ **「符号数」这一列的口径必须先说清，否则下次重跑会数出别的数**：
它是 §7 ⑦ 那条 `grep -oE '^kfun:<包>[a-zA-Z0-9_.]*\.' | sed 去尾 | sort | uniq -c` 的**每个包名行读数**——
按**子包**分别计数，父包那一行只包含**直接挂在其下的签名**，所以 `com.ticktick.recurrence` 的 37
与「含 `.lunar` 合计 92」两个数**都对，只是口径不同**。
🔴 同理，**总签名条数不是一个可靠数**：`sed 's/(.*//'` 得 1582、`sed 's/().*//'` 得 1661、原始行含左括号的 1507。
要谈"这层多大"，用**包分布**（上表）而不是总数；引用总数必须连 `sed` 写法一起写。

#### 2.11.1 `sync.entity.RecurringTask` 的属性全集（强：**客户端模型**；中：线上载荷）

**A. 属性访问器**（`<get-X>` **30** 条、`<set-X>` **29** 条；set 是 get 的真子集，
**get-only 只有 `isUpdated` 一条**——它只能被内部置位，调用方写不进去，这与"脏位是同步器自己维护的"一致）：

```text
id · uniqueId · userId · projectId · projectUniqueId · parentId · childIds
kind · taskStatus · sortOrder · progress · isAllDay · isFloating · attendId · timeZone
dueDate · startDate · tempDueDate · tempStartDate · repeatFirstDate · repeatFrom
repeatFlag · repeatTaskId · exDate · completedTime · completedUserId
snoozeRemindTime · repeatReminderTime · isUpdated · modifiedTime
```

🔴 **`title` / `content` 不在这 30 条里**（这条缺席和存在一样是读数）：整份枚举里没有
`<get-title>` / `<get-content>` / `<get-notes>`。⇒ 这个类**不是**"任务的全部内容对象"，
而是**重复调度用的投影**（包名 `modifyrepeat.sync.entity` 与此一致）。
**所以下面每一条都不能推广成"任务同步载荷有这些字段"。**

**B. 普通方法**（不在访问器计数里）：`getRecurringDueDate` / `getRecurringStartDate`（+ set）、
`getItems` / `setItems`（ChecklistItem 集合）、`getReminders` / `setReminders`（TaskReminder 集合）、
`getTempOrRecurringDueDate` / `getTempOrRecurringStartDate`、`createModifiedTempTask`、
`addExDateToTask`(在 `TaskService` 上)、`toSyncString`、`isFirstRecursion`、`isRepeatTask`、`isNoteTask`、
`isChecklistMode`、`setCompleted`、`hasReminder`、`getExDateArray`。
（`deepCopy` **不在这个类上**，它在 `TickRRule` 上——`grep -c 'RecurringTask#deepCopy'` = 0。）

**能推到什么（强）**：
- `modifiedTime` + `isUpdated` 同时挂在**实体模型**上，而不只是 DB 列上 ⇒ §2.2/§2.5 的
  「行自带脏位 + 时间戳」不只是存储形状，**是对象的形状**。这条从"列名推"升到了"属性名读"。
- `tempDueDate` / `tempStartDate` + `createModifiedTempTask` + `getTempOrRecurring*` ⇒
  **「改这一次」是一个真实存在的临时态**，母规则上的日期与这一格显示的日期是两套值（§3 Q1）。
- `exDate`（集合）+ `repeatTaskId` + `repeatFirstDate` + `repeatFrom` ⇒ 母任务与派生任务之间靠 **id 链**，
  不靠实例表。

**不能推到什么**：`kotlinx.serialization` 的 `$serializer` codegen 在 `modifyrepeat.sync.entity.*` 里
**一个都没有**——全 DLL 带 serializer 字面的 ticktick 类只有三个：
`ErrorType`（`.$serializer` 及 4 个变体）、`TTCalendar`（`Companion#serializer()`）、
`DateAsStringSerializer`（+3 变体）；分母 = 上面 §7 ⑦ 那条 `grep` 的全部输出（9 行去重）。
⇒ `RecurringTask` 是**领域/调度模型，不是标注过的线上 DTO**。
⇒ **本节不能用来回答「请求体字段叫什么」**，§6 第 2 条仍然开着，只是范围缩小了。

#### 2.11.2 `modifyrepeat.helper.editor`：重复任务的改动被切成四个处理器（强）

```text
TaskEditor#getEditHandler
├─ TaskEditNormalHandler          （非重复任务）
├─ TaskEditCurrentHandler         updateTaskCurrentRecursion / checkRepeatChanged /
│                                 clearRepeat / postponeToNextRecursion / unDoneSubTask
├─ TaskEditFromCurrentHandler     editTaskAllRecursion / getRecursionCountFromStartToNow /
│                                 reCalculateRepeatCount
└─ TaskEditAllHandler             setStartDateByRecurrenceTask
RepeatEditorTypeDecider: updateDetermined · deleteDetermined · postponeDetermined · skipRepeatRecurrenceDetermined
```

**推出来的形状，分四档给（不要一整段都标"强"）**：

| 结论 | 档 | 凭什么 |
|---|---|---|
| 改动被切成四个处理器 | **强** | 四个类名 + `TaskEditor#getEditHandler` 都是字面 |
| **界面上确实问"改哪个范围"** | **强**（本轮新证） | zh-Hans 文案直接在场：`editing_repeat_msg`=「你正在修改重复任务的时间，请确认**修改范围**。」、`deleting_repeat_msg`=「…请确认**删除范围**。」、`only_this_recurrence`=「仅此周期」、`future_recurrences`=「此周期和未来周期」、`all_uncompleted_recurrences`=「所有未完成周期」 |
| 「跳过这一格不动 `COUNT`」 | **强**（本轮新证） | `repeat_task_skip_toast`=「已跳过，**重复次数不变**。」——这是**产品自己写给用户看的语义**，比任何代码推理都硬 |
| 改规则时 `COUNT` 的基线是"从序列开始到现在" | **中** | 只有 `reCalculateRepeatCount` + `getRecursionCountFromStartToNow` 两个名字；**函数体没读**，"基线"是我按名字连起来的一步推理 |
| 「只改这一次」= 挂 EXDATE + 克隆一条脱离序列的任务 | **中** | `RecurrenceGenerator.isInRepeatExDates` + `TaskService.addExDateToTask` + `cloneTaskInDB` + `createModifiedTempTask` 同包共现；**没有一条调用顺序的证据** |

🔴 上一段里"外加 `Decider` 把四种动作各自做一次作用范围裁决"这句，四种动作的字面是
`updateDetermined` / `deleteDetermined` / `postponeDetermined` / `skipRepeatRecurrenceDetermined`
——**改 / 删 / 顺延 / 跳过**，与上面 `skip_this_period`、`editing_repeat_msg` 两族文案互相印证。

⚠️ **三条必须一起读的限制**：
1. **单壳**：macOS 切片 `kfun:` 命中 0，这些名字**只有 Windows 一份**，跨壳不可证。
   `TaskServiceWin#resetTaskColumnToDefaultIdIfIsEmpty(...modifyrepeat.sync.entity.RecurringTask)`
   这条签名同时说明包里有 **Windows 专属**代码，所以「共享层同一份」是**推测**，不是读数。
2. **名字不是行为**：`reCalculateRepeatCount` 证明这个方法存在，不证明它在所有路径上都被调用。
3. **本轮仍未反编译**：只做 `strings`，没有读任何一条函数体。

### 2.12 四个假朋友（本轮逐条拆掉，防止下一轮当同步证据用）

`KotlinMultiplatformAll` 里 `SYNC` 88 / `Patch` 64 / `Clock` 56 / `Conflict` 12 / `delta` 8 这串计数
**不能整条当成同步读数**——拆开是这样的：

| 词 | 命中 | 实际归属（按字面读） | 判 |
|---|---|---|---|
| `SYNC` | 88 | `SYNC_TYPE_*` / `SYNC_NEW`/`UPDATE`/`DONE`/`INIT`/`ERROR_UP_LIMIT` | ✅ 真同步词汇 |
| `Patch` | 64 | `Patch_Margin`、`Patch_DeleteThreshold`、`Match_Threshold`、`Match_Distance` —— 是 **Google diff-match-patch 的配置项名**，不是服务端 patch 语义 | ❌ 假朋友 |
| `Clock` | 56 | `CLOCK_HOUR`、`CLOCK_HOUR_OF_DAY`、`CLOCK_HOUR_OF_AMPM`、`CLOCK_CYCLE`、`clock_gettime` —— 全是 **历法/时间字段** | ❌ 假朋友 |
| `Conflict` | 12 | `findConflictTransitionLocalDate:localTime:` / `getConflictTransition...` 是 **NSCalendar 的 DST 冲突切换 API**；`presentedItemDidResolveConflictVersion:` / `presentedSubitemAtURL:...` 是 **NSFileProvider/iCloud 文档版本**选择器；只剩 `DEFAULT_CONFLICT_STRATEGY` 一条与同步有关 | ⚠️ 只有 1/12 相关 |
| `delta` | 8 | `deltaTDate:`、`deltaTYear:month:`（时间差）、`diff_toDeltaDiffs:`（diff 库）| ❌ 假朋友 |
| `Merge` | 10 | `mergeChecklistItems.delta` / `mergeReminders.delta` 是真合并；但 zh-Hans 文案里的「合并标签到…」「%d个任务将以子任务形式合并」是**产品功能**，不是同步合并 | ⚠️ 分层看 |

**这一格为什么值得写**：上一轮共享事实里那句「只能读到 SYNC/Patch/Clock/Conflict/delta 这类字符串计数」
正是最容易二次误读的地方——**五个词里只有一个词是真的**。凡按计数下结论的，都会把
diff-match-patch 的补丁参数读成"它有服务端增量补丁协议"、把 NSCalendar 的 DST API 读成"它有冲突解决器"。

### 2.13 第五档证据：界面文案（它不写代码，但它写了"愿意对用户说什么"）

二进制讲"实现"，`.strings` 讲**产品愿意把哪件事摆到用户面前**。这一档本轮第一次量，
而且它对 Q10 的影响比任何一条二进制读数都大：

| 读数 | 分母 | 结果 | 能推到什么 |
|---|---|---|---|
| 含 `conflict` 的文案 | **41 个语言目录、143,939 条**（全语言） | **0 条** | 它**从不**把"冲突"作为一件事说给用户听 |
| zh-Hans 含「冲突」 | 3,485 条 | **0 条** | 同上，中文侧一致 |
| zh-Hans 含「覆盖」 | 3,485 条 | 1 条，且是**模板**「保存为模板，覆盖原模板」 | "覆盖"这个词它**只用在模板上**，没用在同步上 |
| zh-Hans 含「合并」 | 3,485 条 | 5 条：标签合并、任务合并（`New merged task`） | **又一处假朋友**：这些是**产品功能**，不是同步合并 |
| zh-Hans 含「未同步」 | 3,485 条 | 4 条 | 👇 这一族才是它对"同步出事"的真实口径 |

那 4 条「未同步」里最值钱的两句（**强**，因为是原文）：

- `clear_data_or_send_feedback_email`：「点击"清除并重启应用"可以修复一些未知错误，
  但会**永久删除未同步的任务数据**。」
- `Abnormal data detected, ...`：「检测到本地有**未同步的异常数据**，请先清理异常数据再尝试更新应用。」
- 另有退登那一句：「同步失败，上一次同步之后的修改未能保存到云端。确定要退出登录吗？」

**推出来的形状（强）**：**它对"同步出了岔子"的公开兜底是"清掉本地"，不是"给你挑一边"**。
一个产品在 41 种语言里一次都没写过"冲突"，却在设置/更新路径上写了"检测到未同步的异常数据 → 清理"，
这不是实现细节，这是**产品取向**：冲突对用户不可见，异常数据的处置方式是丢弃。

⚠️ **这条推到哪为止**：文案**不能**证明服务端没有裁决规则（§6 第 4 条照旧开着），
也不能证明用户永远不会丢数据——它只证明**这件事没有面向用户的出口**。
反过来看 heyta：`ConflictDialog.tsx` / `ConflictSheet.tsx` 是**两个平台的真界面**，
i18n 里"冲突"是一族条目而不是一句 —— 这是两边**最直白的一处产品差异**，
而它在本轮之前只是被"裁决算法不可见"这句话挡住了，看不见形状。

⚠️ 局限：本轮只扫了 `*/Localizable.strings`，**没有**扫 `.nib` 里的硬编码字符串与
`Base.lproj` 之外的 XIB 文案。要说"全应用 0 处冲突文案"还差这一步（§6 第 13 条）。

---

## 3. 十六个「它一定回答过、heyta 也必须回答」的问题

每组给三件事：**它的可见答案（带强度）** / **heyta 现状（`文件:行`）** / **判级**。
判级定义：**答了** = 语义与问题对得上且有实现；**答了但语义不同** = 有实现但回答的是另一个问题；
**没答** = 没有对应决定，或决定了但没落地。

### A 组：重复与实例

#### Q1 改了重复规则之后，历史实例归谁？

- **它的答案（强）**：实例是**投影行**（`ZTTREPEATINSTANCE` 只有时间列），规则改了实例就能重算；
  「历史」不以实例行承载。⚠️ 已完成的**过去实例是否会因规则变更而被重算掉**不可见。
- **它的答案 · 本轮补（范围=强，机制=中）**：Windows 符号表把这格从"不可见"推到"模块可见"——
  `com.ticktick.task.modifyrepeat.helper.editor` 用**四个处理器**分开接三种改动范围
  （`TaskEditCurrentHandler.updateTaskCurrentRecursion` / `TaskEditFromCurrentHandler.editTaskAllRecursion` /
  `TaskEditAllHandler` / `TaskEditNormalHandler`），`RepeatEditorTypeDecider` 再按
  update / delete / postpone / skip 四种动作各裁一次范围。
  🔴 **而且"范围"这一档不是只在代码里，产品文案直接在场**：
  `editing_repeat_msg`「你正在修改重复任务的时间，请确认**修改范围**。」、
  `deleting_repeat_msg`「…请确认**删除范围**。」、`only_this_recurrence`「仅此周期」、
  `future_recurrences`「此周期和未来周期」、`all_uncompleted_recurrences`「所有未完成周期」。
  ⇒ **「重复任务的编辑必须有作用范围」在它是界面级事实，不是实现细节**（这条给强）。
  两条机制推理各降半档（只有名字共现，没有调用顺序证据，见 §2.11.2 的分级表；均给中）：
  ① `reCalculateRepeatCount` + `getRecursionCountFromStartToNow` ⇒ 改"这次及以后"时重算 `COUNT`，基线取"从序列开始到现在"；
  ② `isInRepeatExDates` + `addExDateToTask` + `cloneTaskInDB` + `createModifiedTempTask` ⇒ "只改这一次"是往母规则挂 EXDATE 再克隆一条脱链任务。
  ✅ **有一条不用推理**：`repeat_task_skip_toast`「已跳过，**重复次数不变**。」
  ⇒ 跳过与 `COUNT` 的关系**是它自己写给用户看的**，这条可以直接当结论用（强）。
- **heyta 现状**：`packages/app-host/src/actions.ts:546-601` —— 完成一个重复任务是
  **把 `dueDate` 推进到下一次**（「完成一个重复任务 = 把到期日推进，而不是写 `completedAt`」），
  **不产生任何实例行**；`packages/domain/src/recurrence.ts:175` 的 `nextOccurrence` 每次现算。
  历史只能从 op-log 折出来，而且 [`task-activity.ts:37`](../../packages/domain/src/task-activity.ts)
  明写「**不许**说成这条任务的完整历史」。
- **判级：答了但语义不同。** heyta 没有「实例」这个对象，所以「历史实例归谁」在 heyta 里
  **无对象可归**；它把「历史」降级成「本机记录到的变更流水」。**这不是遗漏，是另一种选择** ——
  但代价要认：**「上周那一条，是被我勾掉的、还是错过了、还是我改了规则才变到今天？」这个问题
  heyta 答不出** —— 因为上下文只剩一条被推来推去的 `dueDate`，没有发生过的事就没有痕迹。
  ⚠️ **本轮把差距定得更准**：它有的是**三档改动范围**（这次 / 这次及以后 / 全部），
  heyta 连"档"这个概念都没有——`thisAndFuture` / `thisAndFollowing` / `editScope` / `recurrenceScope` /
  「这次及以后」在 `packages/*/src`（375 个 .ts）+ `apps/*/src`（534 个 .ts/.tsx）里**命中 0**，
  `packages/i18n/src`（9 个文件）里也没有任何这一族文案；改规则永远等于改整条序列
  （`actions.ts:1105-1130` `setRepeat` 只写母任务一个 UPD）。
  所以 Q1 的真实差不是"历史归谁"，是**「一次重复任务的编辑要不要有作用范围」这个问题 heyta 从没问过自己**。

#### Q2 重复实例是物化的，还是每次算出来的？

- **它的答案（强）**：**懒物化 + 范围水位**（§2.7）。`FETCHBEGINDATE`/`FETCHENDDATE` 是区间，
  所以它是「按视窗取、记下取过哪一段」，不是"一次算到无穷"、也不是"每次纯计算"。
- **它的形状 · 本轮补（强，名字级）**：**两条腿同时存在**，不要读成"它物化所以不计算"。
  计算那一腿在共享层：`com.ticktick.recurrence.RecurrenceGenerator#occurrenceDatesOfRRule` 与
  `com.ticktick.core.date.recurrence` 的四种迭代器（`CustomDay` / `ForgettingCurve` / `Lunar` / `MonthlyWorkDay`）
  都是现算；物化那一腿只服务查询（投影 + 水位）。
  ⇒ 它是「**现算 + 按视窗缓存投影**」，不是「持久化实例」。这个区分对 heyta 才有意义：
  heyta 缺的**不是实例表**，是**"这段我算过了"的水位**——纯计算本身两头都成立。
- **heyta 现状**：`packages/domain/src/recurrence.ts:175-203` 纯函数现算（「接下来 N 次」预览是 `:212` 的 `firstOccurrences`）；
  `packages/app-host/src/actions.ts:574` 只在完成时算一次下一次。没有实例表、没有水位表。
- **判级：答了但语义不同。** 它是「投影物化 + 增量水合」，heyta 是「纯投影」。
  纯投影在**单机**上更省、更不会不一致；痛点在**性能与跨设备可见性**：
  纯投影意味着任何设备想看"未来 N 次"都得自己算，且**规则坏了就整段消失**
  （heyta 已经踩过：`actions.ts:495-500` 注释写「某一条任务的规则坏了不该让整个日期视图白屏」，
  处置是**退化成不重复**）。

#### Q3 重复规则存在任务上，还是独立实体？

- **它的答案（强）**：规则在**任务行/任务载荷**上（`*repeatRuleChanged` / `repeatFromChanged` 是任务字段级标记）。
  ⚠️ 这一点只有「字段级标记存在」这一层证据；它是否有独立规则实体**不可见**。
- **它的形状 · 本轮补（强，名字级）**：**两个都有，但分工明确**——
  `com.ticktick.core.date.recurrence.TickRRule` 是一个**结构化对象**，构造函数是
  `TickRRule#<init>(kotlin.String?)`，另有 `toString` / `toIcal` / `toTickTickIcal` / `deepCopy`
  ⇒ **规则以字符串形态存与传，在共享层解析成对象**（属性可读：`freq` `interval` `count` `until` `cycle`
  `byDay` `byMonth` `byMonthDay` `byCustomDate` `completedRepeatCount` `isSkipWeekend` `isSkipLegalRestDay` …）。
  `RepeatUtils#setValueToRRule` / `getValueByKey` 就是这个字符串↔键值的读写口。
  ⇒ 所以它**没有**独立规则实体（没有 `RULE` 表、`sync.entity` 里也没有规则类），
  但比 heyta 多一样东西：**一份跨壳的规则对象模型**。
  ⚠️ 这里不许写过头：heyta 的求值**能力不弱**——它用 ical.js，`BYDAY`/`BYSETPOS`/`BYMONTHDAY`
  全支持，连序数都用（`packages/domain/src/recurrence.ts:294` 直接生成
  `FREQ=MONTHLY;INTERVAL=n;BYDAY=+2WE`，`:299` 还专门剥 `+2WE` / `-1FR` 的序数）。
  真正的差是两点，都不是"算不算得出"：
  ① heyta 的规则**只是一串文本 + 一次求值**，没有跨壳共享的结构化对象，所以规则语义（含"跳过周末"
  这类**非 RFC 5545** 的档）只能由各端自己解释；它把 `isSkipWeekend` / `isSkipLegalRestDay` /
  `lunarDateString` 做成 `TickRRule` 上的**自有字段**，标准 RRULE 装不下这些，
  ⇒ **这条对 heyta 是真信息**：如果 heyta 以后要做「跳过周末」或农历，
  **不能靠塞进 RRULE 串**，那是它自己会撞上的同一道墙。
  ⚠️ 顺带读到的 `isForgettingCurveRepeat` / `lunarDateString` 两族**不属于本支线**，登记在此只为防止下一轮重复发现。
- **heyta 现状**：`packages/shared-schema/src/entity-types.ts:30` 声明了 `TASK_REPEAT_CFG`，
  但 `packages/op-log/src/state.ts:538-546` 把它登记进 `UNMODELED_ENTITY_TYPES` 并写明
  **"本条不是还没做，是决定不用"**；规则实际落在 `Task.repeatRule` / `Task.repeatDtstart`。
- **判级：答了。** 而且比它更明确 —— heyta 是**显式否决**了独立实体（理由是"一个用户意图 = 一个 op"）。
  ⚠️ **副作用必须记住**：任何客户端只要发了 `TASK_REPEAT_CFG` 的 op，就会被同步到所有设备、
  然后**哪儿也不显示**（`state.ts:521-523` 实测记录）。这是一条**协议里合法、产品里无物化**的地雷。

### B 组：通道与实体

#### Q4 专注记录与任务是不是一条通道？

- **它的答案（强）**：**不是**。四重独立：独立 SyncManager（+ 一个 Operation 变体）、
  独立操作表（唯一带 `ZOID`+`ZOTYPE` 的表）、7 条专用端点、独立 WebSocket helper、独立开关 `isFocusKeepInSync`。
- **heyta 现状**：`packages/shared-schema/src/entity-types.ts:56` 把 `FOCUS_SESSION` 定为独立**实体类型**，
  但**走同一条 op-log / 同一条线协议**：`packages/app-host/src/focus-actions.ts:9`
  「一次专注 = 一条 `FOCUS_SESSION` op」；上传/下载与任务共用 `serverSeq` 游标
  （`packages/storage/src/op-log-store.ts:53`）。
- **判级：答了但语义不同。** heyta 的"分开"在**实体粒度**，它的"分开"在**通道粒度**。
  两者不是同一件事：heyta 的专注记录与任务**共享一条队头** —— 一次大任务批量同步会排在专注记录前面。
  ⚠️ 这条是否构成问题**未实测**（没有按实体类型分队列的负载读数）。

#### Q5 提醒与任务是同一条通道吗？

- **它的答案（强，但只到"有自己的同步行"这一层）**：`ZTTDELAYREMINDER` 有
  `ZSYNCSTATUS` + `ZOP` + `ZOBJID` + `ZOBJTYPEVALUE` + `ZENTITYID`，并有专用端点 `/api/v2/reminder/delay`。
  ⇒ **延迟提醒是一条自己的同步行**，不是任务的字段。
- **heyta 现状**：`REMINDER` 是独立实体（`packages/shared-schema/src/entity-types.ts:31`，
  理由见 `packages/domain/src/entities.ts:669-682`：`dueDate` 是一个瞬间、提醒是通知规则），
  且**已完成物化**（从 `UNMODELED_ENTITY_TYPES` 移出，`packages/op-log/src/state.ts:525-531`）。
  ⚠️ 但「完成重复任务时顺带改提醒」是**一条 op**（`packages/shared-schema/src/task-repeat-completion-contract.ts:3-11`），
  即**跨实体的一次意图**。
- **判级：答了。** heyta 的处置比它更收敛（一个意图一个 op，用载荷标记而不是两个 op）。
  ⚠️ 反过来说：那条 op 的**载荷是一个私有标记**（`heytaTaskRepeatCompletion: 1`），
  对端若是不认识它的实现，会看到一条带陌生键的 `TASK/UPD`。可接受（字段级合并），但要记着。

#### Q6 每个视图的手动排序，是任务上的一个字段，还是一行独立数据？

- **它的答案（强）**：**一行独立数据**。`ZTTSORTORDER` 的
  `ZITEMTYPE` / `ZCONTEXTID` / `ZITEMID` / `ZKEY` / `ZORDER` / `ZSYNCSTATUS` 说明
  「哪个视图（context）× 哪种对象类型（itemType）× 哪一项（itemId）→ 序」，
  而且**每行自己带同步状态**。
- **heyta 现状**：**连"任务上的序字段"都没有 —— 它被明文禁止。**
  `packages/domain/src/entities.ts:348-356` 写着「**这一个字段（`pinnedAt`）同时就是"排在最前"**，
  不许另设 `isPinned` / `sortOrder`」；全仓 `packages/*/src` 里 `sortOrder` 的命中**只有这两处注释**
  （`entities.ts:348`、`:799`），没有任何实现。四象限/今日是**派生视图**
  （[`ADR-0015`](../adr/0015-four-quadrant-as-derived-view.md)），视图内顺序由派生规则决定。
- **判级：没答。** 差异比"两种排序"更根本：它有 **per-view 连续手排**（每个视图一套行），
  heyta 只有**置顶/不置顶两档**（`pinnedAt`）且**刻意拒绝**引入序字段。
  理由在 `entities.ts:348-353`：两个字段必然在一次编辑里漂移。
  ⇒ 这不是"没来得及"，是**一个已经拍过、但只拍了一半的决定**：
  「不要序字段」拍了，「那要不要 per-view 手排」**没有 ADR 回答过**。

### C 组：账号与隔离

#### Q7 多账号切换时，本地库怎么隔离？

- **它的答案（中偏强）**：一个库 + `ZACCOUNTID` 分区键（52/58 表）+ 查询层过滤（§2.9）。
  不分库（分库这一档未能证实，磁盘读不到）。
- **heyta 现状**：**单库、无账号列**。三个壳的库名都是写死的：
  `apps/mobile/src/db/open-host.ts:35`（`heyta.sqlite`）、`apps/web/src/lib/oplog.ts:451`（`heyta`）、
  `apps/desktop/src/host.ts:33-35`（`desktopDbPath`）；`packages/storage/src/op-log-store.ts:29-49`
  的 `StoredOperation` **没有账号字段**，且 `packages/storage/src/` 全目录 `grep -rn accountId` **命中 0**。
  退出登录只清**凭据 + 小组件 + vault 会话**（`apps/mobile/src/screens/ProfileScreen.tsx:232-280`），
  **不清 op-log**。
- **判级：没答。** 后果是可推的（不是实测）：**同一台设备换账号后，上一个账号的任务仍在本地状态里**，
  而新账号的 op 会与它们共存同一条 op-log。这条要么被产品决定成「一台设备一个账号」，
  要么必须先拍隔离方案 —— **现在的代码两者都没有明说**。

#### Q8 同步跑到一半账号被换掉，在途请求怎么办？

- **它的答案（强）**：显式作废 + 具名日志。`big sync: cancelled stale account sync`，
  以及专注通道的 9 条 `account changed ...` 守卫，覆盖 preflight / 准备 / 解析 / 落库 / 收尾**每个阶段**。
- **heyta 现状**：有对应的**会话级**机制 —— `packages/app-host/src/host.ts:516` 用
  `(accountId, serverOrigin)` 组成 `scopeKey`，`invalidateVaultSession()`（声明 `host.ts:220`，实现在 `host.ts:740-741`）做栅栏；
  `apps/mobile/src/screens/ProfileScreen.tsx:258` 注释写明「清凭据时会 **fence remembered unlock、
  invalidate 已打开的宿主**」。
- **判级：答了。** 而且把 scope 做成 `账号 × 服务端源` 两个维度，比它的单账号列更严
  —— 同一账号在两个服务端（官方 / 自托管）下**不共享密钥作用域**。⚠️ 差别在于：
  heyta 栅栏的是**钥匙会话**，它作废的是**同步任务**；「在途上传回来后把旧账号数据写进本地」这条
  在 heyta 侧**没有看到对应守卫**（`engine.ts` 的 remote apply 不检查账号）。

### D 组：合并与冲突

#### Q9 离线改动按实体合并，还是按字段合并？

- **它的答案（中）**：**按字段**。三组证据：14 个 `*Changed` 字段标记、两个 `merge*.delta`，
  以及「移动 / 排序 / 父子 / 指派」四类改动各自有专门的 `SYNC_TYPE_*` + 专门处理器。
- **heyta 现状**：**两层，粒度不同 —— 这是关键，不是一句话能答的**：
  - **上传/冲突检测：按实体。** `packages/sync-core/src/entity-frontier.ts:31` 为每个实体折一条
    本地前沿时钟，`packages/sync-core/src/conflict-classification.ts:15` 判五类向量关系
    （`causal-successor` / `retry` / `equal-different-client` / `concurrent` / `superseded`）。
  - **物化/合并：按字段。** `packages/op-log/src/state.ts:589-596` 把 **UPD 载荷里每一个键**都记成
    一条字段版本 `{meta, value, deleted}`；`:329-350` 逐字段选胜者再拼出实体。
- **判级：答了（且比它更细）。** heyta 的字段级前沿在**重放层**，所以两台设备各改一个字段**不会互相吞掉**。
  ⚠️ 但这里有一处**两套粒度并存的真实张力**：冲突分类按实体判 `concurrent` → 交给 LWW 选边，
  而重放层又会按字段各自选一次。**两条链的结论在多数情况下一致，但"实体层判 remote 胜、
  字段层却让本地某个字段赢"是可构造的**。本文不判它是 bug（没有实测反例），
  但**这是一个必须被写下来的形状**：*裁决的单位与物化的单位不同*。

#### Q10 冲突时谁赢，由什么裁决？裁决不了怎么办？

- **它的答案**：**不可见，只到"有一个默认策略"这一层**。`DEFAULT_CONFLICT_STRATEGY` 存在（强），
  取值/执行方/兜底路径全部不可见（推测区）。
- **heyta 现状**：**四层，逐层可指**：
  1. 向量关系分类（`packages/sync-core/src/conflict-classification.ts:15`）；
  2. 自动 LWW：`packages/sync-core/src/conflict-resolution.ts:395` `planLwwConflictResolutions`，
     时间差 > 1h 直接取新（`:346-352`），否则 `(timestamp, clientId)` 字典序决胜（`:471-497`）；
  3. 语义优先级：远端归档 > 本地归档 > 删除 > 时间戳（`:419-465`）；
  4. 剩下 `manual` 交给人：`packages/sync-client/src/client.ts:1439` `resolveConflicts`，
     未解决时返回 `{kind:'conflict'}`（`:290`），界面在
     `apps/web/src/features/sync/ConflictDialog.tsx:123` 与 `apps/mobile/src/screens/ConflictSheet.tsx:1-10`
     逐条并列两边、由用户点「保留这一版」。
- **判级：答了。** heyta 在这一格上**明显更完整**：它有一条"人兜底"的可见出口，
  而滴答侧在本轮证据里**连裁决算法都看不到**。⚠️ 注意「看不到」≠「没有」：这句的边界见 §6 第 4 条，
  本文**不给它记任何一条裁决规则**。

#### Q11 同一毫秒、不同设备的并发写，谁赢？

- **它的答案**：**不可见**（`ZCLIENTID` 存在，但没有任何证据说它参与比较）。
- **heyta 现状**：`clientId` **字典序大者胜**，两处实现且注释互相指认：
  `packages/sync-core/src/conflict-resolution.ts:381-385`（冲突计划侧）与
  `packages/op-log/src/state.ts:240-252`（重放侧，还多一个 `opId` 末位兜底）。
  客户端持久化的理由写在 `packages/app-host/src/host.ts:176-178`（"同一台设备跨重启必须拿到同一个 clientId"）。
- **判级：答了。** 这是 heyta 相对它**可证更强**的一条：决胜规则**确定性 + 两端同构 + 有回归测试**
  （`packages/op-log/tests/vector-clock-trim.spec.ts`、`packages/sync-core/tests/conflict-resolution.spec.ts`）。

#### Q12 新设备第一次同步，靠什么"不重放一遍历史"？

- **它的答案（强）**：`SYNC_INIT` + `ZCHECKPOINT`（用户行一个游标）+ `SYNC_NEW`/`SYNC_UPDATE`
  的拉取分类。⇒ **首同步是"拿状态快照 + 记一个游标"，不是"重放全部变更"**。
  ⚠️ 快照与增量的边界怎么切（快照覆盖到哪个游标）**不可见**。
- **heyta 现状**：同一族机制都有 —— `packages/storage/src/op-log-store.ts:57-64` 的
  `MaterializedCheckpoint`（`coveredSeq` + `clock` + `appliedOpIds` + `checksum`）、
  `packages/sync-core/src/upload-planning.ts:34-66`（按**本地 seq** 切"快照内 / 快照外"）、
  `checkpoint` 增量水合见 [`ADR-0047`](../adr/0047-checkpointed-incremental-hydration.md)。
- **判级：答了。** 而且 heyta 的 checkpoint 带 **checksum 与 appliedOpIds**，比"一个 `VARCHAR` 游标"
  可验证性强。⚠️ 差异：它是**按用户一个游标**；heyta 的游标是**本地存储的元数据**
  （`serverSeq` 挂在每条 op 上，`op-log-store.ts:45-53` 明写"不能塞进 `Operation`，那是线协议类型"）。

### E 组：删除与墓碑

#### Q13 删除的墓碑怎么传播？

- **它的答案（强）**：三态状态列（`DELETED_NO`/`TRASH`/`FOREVER`）+ 三种专用 `SYNC_TYPE_*`
  + 专用端点 + 推侧按 `deleted`/`restored` 分别计数（§2.8）。
- **heyta 现状**：**四态 → 五态**。基座是 [`ADR-0048`](../adr/0048-deletion-four-states-and-the-no-physical-erase-boundary.md)：
  `alive → trashed → purged`，外加与它正交的 `archived`；`purgedAt` **永不单独出现**
  （不变式 `purgedAt ⇒ deletedAt`，理由写在 `packages/domain/src/entities.ts:38-46`：
  清掉 `deletedAt` 会让离线对端把数据当"从未删除"再同步回来）。
  ⚠️ **`ADR-0048` 的"四"已被 [`ADR-0083`](../adr/0083-task-abandonment-fifth-state-and-share-boundary.md) 取代**
  —— 2026-11-02 给任务加了第五态「放弃」；本文引用删除语义时以 **0048 §3/§4 + 0083** 为准，**不要再说"四态"**。
  删除在 reducer 里是**字段级墓碑**：`packages/op-log/src/state.ts:594-599`
  「DELETE 是字段级墓碑，创建还没到也必须物化，否则乱序重放会复活实体」。
  彻底删除是 `UPD { purgedAt }` 而不是 `DEL`（`packages/app-host/src/actions.ts:759-770`）。
- **判级：答了（且比它多两态）。** 五态 vs 三态是**真实的语义差**：heyta 有 `archived`
  与 `trashed` 并列（归档 ≠ 回收站），还有「放弃」这一档（放弃既不进"已完成"统计、
  也不该被重复规则推进 —— `ADR-0083` §1 表格）。滴答的 `ZARCHIVEDTIME` 是清单上的一个时间字段，
  任务侧没看到归档态，更没看到"放弃"。⚠️ heyta 的代价是自己认的：**没有任何物理删除路径**
  （`ADR-0048` §1 表格），所以"彻底删除"只是一句"不再提供恢复"。

#### Q14 彻底删除之后，旧设备会不会把它复活？

- **它的答案（中）**：`task pull payload counts: deleteForever=` 说明**拉取侧专门数彻底删除**，
  最省的解释是"拿这个数去清本地，防止旧设备再把行推回来"。**"防复活"这个意图不可见**，只看到计数。
- **heyta 现状**：三重防线，都可指：
  ① `purgedAt ⇒ deletedAt` 不变式（`packages/domain/src/entities.ts:38-46`）；
  ② DELETE 作为字段墓碑**必须在创建未到时也物化**（`packages/op-log/src/state.ts:594-599`）；
  ③ `restore` 对 `purgedAt` **抛错**（`packages/app-host/src/actions.ts:743-745`）。
- **判级：答了。** 而且 heyta 是把"防复活"写成**不变式 + 三重拦截**，它在可见证据里只是**一个计数**。

### F 组：时间与游标

#### Q15 一个实体的版本用什么表示？

- **它的答案（强）**：`ZLASTMODIFIEDDATE`（时间）+ `ZETAG`（不透明版本串）**成对**出现在 19-20 张表上。
  ⇒ 最省的解释是「时间给裁决、etag 给条件写」。
- **heyta 现状**：**不用 etag，用向量时钟**：`Operation.vectorClock`（每 op 一份），
  实体前沿由 `packages/sync-core/src/entity-frontier.ts:31` 折出；
  [`ADR-0046`](../adr/0046-lossless-vector-clock-frontiers.md) 已把"有损裁剪"换成
  签名前沿 delta 协商（`ADR-0008` 的 20→100 只是过渡，已被 0046 取代）。
- **判级：答了但语义不同。** etag 是**服务端权威的线性版本**，向量时钟是**端侧因果**。
  这一条不是"谁更好"，是**两种世界观**：etag 能表达"我落后了，给我新的"，
  **不能表达"我这两处改动互不覆盖"**；反之向量时钟能判并发，但**不告诉你服务端现在是什么版本**。
  ⚠️ heyta 的向量时钟前沿**无界增长**是真问题（`ADR-0046` 全篇在拆它），而 etag 天然有界 —— 这是它的路线**换来的好处**。

#### Q16 上传队列有上限吗？超了怎么办？

- **它的答案（强）**：有。`SYNC_ERROR_UP_LIMIT` 是一条**具名状态**。
  ⇒ 上传有硬上限，且超限是**一等状态**而不是静默丢。
- **heyta 现状**：**没有"上传通道饱和"这个状态**。上传队列 = "`source==='local'` 且
  `uploadStatus==='pending'`"（`packages/op-log/src/engine.ts:276-279` 过滤 `source`，
  `packages/storage/src/db-op-log-store.ts:437-444` 按索引取 `pending`；两者的等价性由
  `op-log-store` 契约测试钉住，见 `db-op-log-store.ts:449-453`）。被服务端拒绝的行是
  `uploadStatus: 'rejected'`，**根本不进这条队列**（`packages/op-log/src/engine.ts:232` 把它
  与 `'import'` 一起挡在检查点之外）。另一条上限是向量时钟（`MAX_VECTOR_CLOCK_SIZE`，裁剪行为见
  [`ADR-0008`](../adr/0008-vector-clock-limit.md) §4，前沿协商见 [`ADR-0046`](../adr/0046-lossless-vector-clock-frontiers.md)）。
- **判级：答了但语义不同。** 它把"上传超限"当成**一个可以显示给用户的状态**；
  heyta 把"被拒"当成**行的一个本地属性**（`uploadStatus: 'rejected'`），
  而"时钟超限"是**另一件事**（会被裁剪，且只在 `console.warn` 留痕 —— `ADR-0008` §4 第 1 条）。
  ⚠️ 也就是说：**heyta 没有一个统一的"上传通道饱和"信号**。

---

## 4. 判级汇总

| # | 问题 | 它的证据强度 | heyta 判级 | heyta 锚点 |
|---|---|---|---|---|
| Q1 | 改 RRULE 后历史实例归谁 | 强 | 答了但语义不同 | `app-host/src/actions.ts:546` |
| Q2 | 实例物化还是现算 | 强 | 答了但语义不同 | `domain/src/recurrence.ts:175` |
| Q3 | 规则存任务上还是独立实体 | 强 | 答了 | `shared-schema/src/entity-types.ts:30` |
| Q4 | 专注与任务同一条通道吗 | 强 | 答了但语义不同 | `app-host/src/focus-actions.ts:9` |
| Q5 | 提醒与任务同一条通道吗 | 强 | 答了 | `shared-schema/src/entity-types.ts:31` |
| Q6 | 每视图手排是行还是字段 | 强 | **没答** | `domain/src/entities.ts:348`（明文禁止序字段） |
| Q7 | 多账号本地库怎么隔离 | 中偏强 | **没答** | `storage/src/op-log-store.ts:29` |
| Q8 | 同步途中换账号 | 强 | 答了 | `app-host/src/host.ts:516` |
| Q9 | 按实体还是按字段合并 | 中 | 答了（更细） | `op-log/src/state.ts:589` |
| Q10 | 冲突谁赢、裁决不了怎么办 | 推测 | 答了 | `sync-core/src/conflict-resolution.ts:395` |
| Q11 | 同毫秒并发谁赢 | 不可见 | 答了 | `sync-core/src/conflict-resolution.ts:381` |
| Q12 | 首同步靠什么不重放历史 | 强 | 答了 | `storage/src/op-log-store.ts:57` |
| Q13 | 墓碑怎么传播 | 强 | 答了（多两态） | `ADR-0048` + `ADR-0083` |
| Q14 | 彻底删除后旧设备会不会复活 | 中 | 答了 | `domain/src/entities.ts:38` |
| Q15 | 实体版本用什么表示 | 强 | 答了但语义不同 | `sync-core/src/entity-frontier.ts:31` |
| Q16 | 上传有没有上限、超了怎么办 | 强 | 答了但语义不同 | `op-log/src/engine.ts:276` |

**计数（现量，逐行相加 = 16）**：

| 判级 | 条数 | 是哪几条 |
|---|---|---|
| 答了 | 9 | Q3 Q5 Q8 Q9 Q10 Q11 Q12 Q13 Q14 |
| 答了但语义不同 | 5 | Q1 Q2 Q4 Q15 Q16 |
| 没答 | 2 | Q6 Q7 |

（本段不给百分比：这类计数的分母取决于"问题算不算一条"，写一个百分数只会让下一次对账更难。）

**两条「没答」的共同形状**：都不是"忘了写"，而是**一个尚未被拍的产品决定**——

1. **Q6（每视图手排）**：要不要让同一任务在不同视图里排不同位？现在**连序字段都没有**
   （`entities.ts:348-356` 明文禁止），只有 `pinnedAt` 两档，**结构上就表达不出来**。
   要改得动实体清单 → 是一条 ADR 级决定。
2. **Q7（多账号隔离）**：一台设备是否允许多账号？如果**不**允许，那就该在切账号时显式拒绝或清库；
   如果**允许**，本地库必须先有分区键。现在两边都没说。
3. **附带一条「答了但没论证」（Q1/Q2）**：既然没有实例对象，"历史实例"该不该有？
   ⚠️ 本文把 Q1 记为"答了但语义不同"（因为 heyta 明确选了推进式语义），
   但**没有任何一份 ADR 决定过「完成重复任务 = 推进到期日」这条语义**：
   `docs/adr/` 里 [ADR-0068](../adr/0068-share-member-identity-and-content-publication.md)
   与 [ADR-0083](../adr/0083-task-abandonment-fifth-state-and-share-boundary.md) §1 都**引用**了它（当既有事实用），
   却没有一份**论证**过它；而 ADR-0083 §5 第 1 条把「重复任务 × 放弃」列为**未核实项**
   （"放弃后调度器会不会仍然生成下一周期" → 本轮按"不会"实现，**没有实测**）。
   ⇒ 这是一条**实现了、被引用了、但从未被裁决**的语义。

---

## 5. 从对账里得到的六条判断（不是工单）

1. **范式不同，不要对齐。** 它是「行状态位 + 字段标记 + 时间/etag」，heyta 是「op-log + 向量时钟 + 字段级重放」。
   任何"把滴答的同步搬过来"的想法都会先撞上 `ADR-0046` 与 `hard-constraints §3.4`
   （[`docs/agents/hard-constraints.md`](../agents/hard-constraints.md) §3.4：op-log 是唯一写入口）。
   可以学的是**它对"什么变了"的分类粒度**（13 个 `SYNC_TYPE_*`），不是它的机制。
2. **它最值得学的一件是「在途账号切换」的显式化。** 9 条阶段守卫 + 一句
   `cancelled stale account sync`，把一个**只在竞态里出现**的故障变成了**可读日志的一等事件**。
   heyta 有 scopeKey 与 vault 栅栏，但**同步任务本身没有"账号已变"的守卫**（§3 Q8 的 ⚠️）。
3. **heyta 最值得守住的一件是「人兜底」。** 它的裁决算法在本轮证据里完全不可见，
   而 heyta 有 `manual` 档 + 两个平台的真界面（`ConflictDialog` / `ConflictSheet`）。
   这条一旦为了"自动化"被砍掉，就等于把"分不出来"变成"静默选一边"。
4. **Q9 那条两套粒度的张力，是本轮唯一发现的"内部形状问题"**：
   冲突分类按实体、物化按字段。它不是缺陷，但**没有一份文档同时描述这两层**，
   所以下次有人改 `conflict-resolution.ts` 时**看不到重放侧的字段前沿**。这属于纯文档缺口。
5. **重复这条线上 heyta 缺的三样，本轮才分得清（Q1/Q2/Q3）。** 分别是：
   ① **改动范围**（这次 / 这次及以后 / 全部）——heyta 一个都没有，改规则恒等于改整条序列；
   ② **"我算过哪一段"的水位**——两头都是现算，它额外把结果按视窗缓存了，heyta 每次重算；
   ③ **一份跨壳的规则对象模型**——heyta 只有一串文本。
   三样代价不同：①是**产品决定**（要不要给用户三档），②是**性能账**（要先有日期视图的负载读数才有资格说该做），
   ③是**表达力上限**（「跳过周末」「农历」这类**装不进标准 RRULE** 的档，将来只能各端自己解释）。
   ⚠️ 本条只把三样分开，**不给工单**：②在没有负载读数之前提出就是臆测需求。
6. **本轮的方法教训（写给下一位取证的人）**：同一份共享层，两颗二进制的**可读性不对称**——
   macOS 的 `KotlinMultiplatformAll` 真剥了（`kfun:` 命中 0），Windows 的 `KotlinMultiplatformAll.dll`
   没剥净（5691 条）。所以「共享层里没有 X」这类结论**必须写明是在哪一颗上量的**，
   否则下一轮会在错的那颗上重复证明一遍不存在。本轮 §2.1 与 §6 第 10 条就是这个错的两次自我更正。

---

## 6. 未核实清单（必须与结论一起读）

🔴 **云端协议全部未核实。** 具体空洞：

| # | 未核实项 | 为什么核不了 | 它会影响哪个结论 |
|---|---|---|---|
| 1 | 主同步通道的端点（是 `api/v2/batch` 还是 `api/v3/batch`，是否按实体家族） | 可见字面里**没有** `/sync`、`/delta`；`api/v2/batch` 24 次 / `api/v3/batch` 4 次**是字面**，但没有一处说明它承载哪个实体族 | §2.10 的"没有看到"、§2.6 各通道的真实边界 |
| 2 | 请求/响应体字段名与嵌套 | 需要抓包。⚠️ **本轮范围缩小但没关闭**：`sync.entity.RecurringTask` 的属性名可读（§2.11.1），但该包**没有 `$serializer` codegen** ⇒ 它是领域模型不是线上 DTO，**不能当载荷字段用** | §2.4 的 `*Changed` 族归属（中）、§2.11.1 的强度上限 |
| 3 | `ZSYNCSTATUS` 的整数↔`SYNC_*` 映射 | 需要运行时或反编译 | §2.2 的"状态机"细节 |
| 4 | 冲突的实际裁决方（客户端 / 服务端 / 协商） | `DEFAULT_CONFLICT_STRATEGY` 只有名字 | **§2.5 全格** |
| 5 | `ZCLIENTID` 是否参与裁决 | 同上 | Q11 |
| 6 | `TTFocusSyncWebsocketHelper` 推什么（信号 / 内容） | 需要抓包 | §2.6 专注通道的实时程度 |
| 7 | 是否按账号分**库文件** | 磁盘被 TCC 拒绝（`Operation not permitted`），本轮**没有绕过** | Q7 从"中偏强"降不到"强" |
| 8 | 墓碑保留期（`DELETED_FOREVER` 行何时真删） | 用户动作 `trash/empty` 之外没有任何清理字面 | §2.8 第 3 条 |
| 9 | `TASK_PENDDING` 的语义 | 词义 + 拼写，无结构 | §2.3 的推测 |
| 10 | Kotlin 层到底承载了什么 | 上一版写"Kotlin 层没有同步引擎"，靠的是 macOS 切片里**没有 `KMASync*` 类名**——那是**否定证据 + 剥了符号的二进制**。本轮 Windows 切片读出 5691 条 `kfun:`，`modifyrepeat.sync.entity` / `.helper.editor` / `core.date.recurrence` 都在里面 ⇒ **这一条已被部分否证**：共享层承载**规则与模型**，不承载传输。仍未核的是它**承载到哪一层** | §2.1 整格、§2.11 |
| 11 | `modifyrepeat.*` 是**共享代码**还是 Windows 专属 | 只有 Windows 一份符号可读（macOS `kfun:` 命中 0）；而同一包里确有 `TaskServiceWin#…` 这类**明确带 Win 后缀**的函数 ⇒ 无法从符号判断包归属 | §2.11 全节的"跨壳一致"含义 |
| 12 | 函数名背后的**调用路径与顺序** | 全程只做 `strings`，**没有读过任何一条函数体**。`reCalculateRepeatCount` 存在，不等于它在每条改规则的路径上都被调用 | §2.11.2、Q1 的"本轮补" |

### 6.1 本轮**没有**做的事（写死，防止被后续引用成"已做"）

- **没有抓包**：一条 HTTP/WS 流量都没看。所有"端点"陈述都只是**二进制里的字符串**。
- **没有反编译 Kotlin 层**：两端都只有 `lipo -thin` + `strings`。
  Windows 那颗 DLL 的 `kfun:` 符号是**它自己没剥净**、被 `strings` 读到的，
  **不是**反编译产物——函数签名（名字与参数类型）可见，**函数体一行都没读**。
  所以 §2.11 的每一个结论都必须配一句"名字级"。
- **没有反汇编 Swift**：只有符号表与内嵌路径。
- **没有登录、没有造数据、没有代理它的流量。**
- **没有读本机容器**（被 TCC 拒绝，未尝试绕过）。

---

## 7. 复跑命令（全部只读）

```bash
# ① 主二进制的 /api/ 路径（上一轮用过的，38 条）
lipo -thin arm64 -output /tmp/TT-arm64 /Applications/TickTick.app/Contents/MacOS/TickTick
strings -a /tmp/TT-arm64 | grep -oE '/api/v[0-9]/[a-zA-Z0-9/_.-]{2,60}' | sort -u | wc -l

# ② TickTickKit 里的 60 条（本轮新增：主二进制里一条都没有）
strings -a /Applications/TickTick.app/Contents/Frameworks/TickTickKit.framework/Versions/A/TickTickKit \
  | grep -oE '/api/v[0-9]/[a-zA-Z0-9/_.-]{2,60}' | sort -u

# ③ 内嵌源码路径（本轮新增：同步编排在原生层的直接证据）
strings -a /Applications/TickTick.app/Contents/Frameworks/TickTickKit.framework/Versions/A/TickTickKit \
  | grep -oE '/Volumes/workspace/repository/[A-Za-z0-9+_/. -]+\.swift' | sed 's|.*/repository/||' | sort -u

# ④ 共享层词汇（本轮新增：证明 Kotlin 里有枚举、没有引擎）
F=/Applications/TickTick.app/Contents/Frameworks/KotlinMultiplatformAll.framework/Versions/A/KotlinMultiplatformAll
lipo -thin arm64 -output /tmp/TTKMA-arm64 "$F"
strings -a /tmp/TTKMA-arm64 | grep -E '^(SYNC|DELETED)[A-Z_]*$' | sort -u
strings -a /tmp/TTKMA-arm64 | grep -oE 'KMA[A-Za-z]*[Ss]ync[A-Za-z]*' | sort -u   # 只回 KMAConstants*

# ⑤ 58 张表的完整 DDL（本轮新增：ZSYNCSTATUS / ZACCOUNTID / ZETAG 的分布就是判据）
#    ⚠️ 表名计数两种写法**都给 58**（56 张 ZTT* + Z_PRIMARYKEY + grdb_migrations）。
#    上一版在这里写"只匹配 [A-Z_] 会得到 57"，本轮按两种正则各跑一次**否证了这句话**——
#    会读成 57 的是**列名解析**，不是表名计数（见下面 ⑥ 的警告）。
strings -a /Applications/TickTick.app/Contents/Frameworks/TTGRDBPod.framework/Versions/A/TTGRDBPod \
  | grep -oE 'CREATE TABLE( IF NOT EXISTS)? +[A-Za-z_]+' | sort -u | wc -l

# ⑥ 列分布（36 / 52 / 20 / 19）——必须按**平衡括号**切块，不能用行尾 `)` 猜
#    🔴 探针陷阱：用 `re.findall(r'CREATE TABLE IF NOT EXISTS (\w+) \((.*?)\n\s*\)')` 这种
#    "看到一行只有一个 ) 就收块"的写法，会把 ZTTTASK 的 50 列**并进 grdb_migrations 那一块**，
#    于是读出 57 张表、并且 `ZDELETIONSTATUS` 会被报成"在 grdb_migrations 上"。
#    本轮 36/52/20/19 三个数在两种解析下**恰好相同**（因为 ZTTTASK 的那几列被记在了另一个名字下，
#    总数不变），这是运气，不是解析器对。
strings -a /Applications/TickTick.app/Contents/Frameworks/TTGRDBPod.framework/Versions/A/TTGRDBPod > /tmp/ttgrdb.txt
python3 - <<'PY'
import re
txt=open('/tmp/ttgrdb.txt',encoding='utf-8',errors='replace').read()
T={}
for p in re.split(r'CREATE TABLE(?: IF NOT EXISTS)? +', txt)[1:]:
    m=re.match(r'([A-Za-z_]+)\s*\(', p)
    if not m: continue
    body=p[m.end():]; d=1; i=0
    while i<len(body) and d:
        d += (body[i]=='(') - (body[i]==')'); i+=1
    cols=[c.strip().split()[0] for c in body[:i].split('\n') if re.match(r'^Z[A-Za-z_]+$', c.strip())]
    if m.group(1) not in T or len(cols)>len(T[m.group(1)]): T[m.group(1)]=cols
print('tables', len(T))
for col in ['ZSYNCSTATUS','ZACCOUNTID','ZLASTMODIFIEDDATE','ZETAG','ZOP','ZOID','ZOTYPE']:
    hits=sorted(t for t,cs in T.items() if col in cs)
    print(col, len(hits), hits if len(hits)<=3 else '')
PY
#    ⚠️ 数**整列名**，不要数子串：`Z_OPT`（CoreData 自带的行锁计数）每张表都有，
#    `ZOPTIME`（习惯打卡）、`ZOPENTOTEAM`（项目）也会被 `ZOP` 命中 —— 上一版"5 张表带 ZOP"就是这么来的。

# ⑦ Windows 那颗 DLL 的 Kotlin 符号（本轮新开通道；macOS 切片同一条命令回 0）
#    ⚠️ `$WIN` 是解包产物，不是安装包：重启后可能没了，要重跑就得先重新解包。
#       下面三个数是 2026-11-06 在 `/tmp/rea-lab/win/app/KotlinMultiplatformAll.dll` 上现量的。
WIN=/tmp/rea-lab/win/app/KotlinMultiplatformAll.dll
strings -a - "$WIN" | grep -c 'kfun:com.ticktick'      # Windows 5691 —— macOS 切片同一条命令 0
strings -a - "$WIN" | grep -oE '^kfun:com\.ticktick[a-zA-Z0-9_.]*\.' \
  | sed 's/^kfun://; s/\.$//' | sort | uniq -c | sort -rn | head -12   # 包布局（§2.11 那张表）
strings -a - "$WIN" | grep -oE 'kfun:com\.ticktick\.task\.modifyrepeat\.sync\.entity\.RecurringTask#[^ ]*' \
  | sed 's/(.*//' | sed 's/^kfun:[^#]*#//' | sort -u                   # §2.11.1 那串属性名
#    ⚠️ 别在 macOS 那颗上找 `kfun:`，找不到不等于不存在（§5 第 6 条）。
#    ⚠️ "签名条数"随 `sed` 写法变，两个都别单独引用：`s/(.*//`（砍到第一个左括号）得 **1582**；
#       `s/().*//`（只砍空参数表）得 **1661**——差的 79 条就是**带参数的重载**，
#       前者把它们并成同一条。全量原始行里含左括号的是 1507 条。
#       ⇒ 要引用"共享层到底多大"，用下面那条**包分布**，别用总数。

# ⑧ 批次端点字面（§2.10 补的那句）
strings -a /Applications/TickTick.app/Contents/Frameworks/TickTickKit.framework/Versions/A/TickTickKit \
  | grep -oE 'api/v[0-9]/batch' | sort | uniq -c                                    # api/v2/batch 24、api/v3/batch 4

# ⑨ 假朋友自查（§2.12）：把 Conflict / delta 的**整条字面**打出来，别只看计数
strings -a /Applications/TickTick.app/Contents/Frameworks/KotlinMultiplatformAll.framework/Versions/A/KotlinMultiplatformAll \
  | grep -iE 'conflict|delta' | sort -u
```

⚠️ **读数会随版本漂移**：本轮对象是 8.2.03。上面每条都带"数什么"，
所以下次重跑时**看形状变了没有**，别只看数字变了没有。

---

## 8. 与其它文档的关系

| 文档 | 关系 |
|---|---|
| [`ticktick-desktop-teardown-2026-11`](ticktick-desktop-teardown-2026-11.md) | 上游主取证。本文**收窄**了它 §7 的「KMP 承载同步」这一条（§2.1），并补齐它只点到名字的 §4.2–§4.4 |
| [`op-log-e2-conflict-taxonomy`](op-log-e2-conflict-taxonomy.md) | 客户端/服务端共用的五类协议分类（本文 Q9/Q10 的第 1 层） |
| [`aed-implementation-evidence`](aed-implementation-evidence.md) | 向量时钟前沿的无损化（本文 Q15 的 heyta 侧现状） |
| [`ADR-0008`](../adr/0008-vector-clock-limit.md) → [`ADR-0046`](../adr/0046-lossless-vector-clock-frontiers.md) | 时钟上限与前沿协商：**引用时用 0046，0008 已被取代** |
| [`ADR-0048`](../adr/0048-deletion-four-states-and-the-no-physical-erase-boundary.md) · [`ADR-0083`](../adr/0083-task-abandonment-fifth-state-and-share-boundary.md) | 删除四态（0048）→ 加第五态「放弃」（0083 取代了 0048 §2 的"四个"）；本文 Q13/Q14 以两份合读为准 |
| [`hard-constraints §3.4`](../agents/hard-constraints.md) | op-log 纪律（"一个意图 = 一个 op"），本文 §5 第 1 条的约束来源 |
