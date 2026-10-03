/**
 * heyta 领域模型
 * =================
 *
 * 这一层**不 import 任何框架**。理由不是教条，而是：
 * op-log 的 apply 逻辑完全建立在这些函数之上。这一层有任何框架耦合，
 * 换 UI 框架（P2 要上移动端）时都会被放大成重写。
 *
 * 设计原则：
 *   1. **不变量写在类型里，能静态检查的不要留到运行时。**
 *   2. **持久化字段一律可选**（见 AGENTS.md §3.3）：新增必填字段会破坏
 *      每一个已有安装 —— 磁盘上的旧数据没有该字段，会在 hydration 时炸。
 *   3. **视图不建实体**：四象限、今日视图都是 TASK 的派生结果。
 */

import type { EntityType } from '@heyta/shared-schema';

import type { CategorySlot } from './activity-categories.js';
import type { LocalDate } from './date.js';

/** 所有实体共有的元数据。 */
export interface EntityBase {
  /** 全局唯一 ID（客户端生成，离线可用）。 */
  id: string;
  /**
   * 创建时间（epoch ms）。
   *
   * ⚠️ 用数字而不是 Date：Date 序列化/反序列化会引入时区与精度问题，
   * 而 op-log 需要对时间戳做确定性比较（LWW）。
   */
  createdAt: number;
  updatedAt: number;
  /** 软删除标记（墓碑）。删除必须可同步、可恢复。 */
  deletedAt?: number;
  /**
   * 「已彻底删除」标记（回收站里的不可逆动作）。
   *
   * 🔴 **这是可加性的可选字段，不是 schema bump**（AGENTS.md §3.3）。
   *
   * 语义：`deletedAt !== undefined` 是**回收站**（可恢复）；
   * 再加上 `purgedAt !== undefined` 就是**已彻底删除**（回收站不再显示它，
   * 恢复动作会拒绝它）。墓碑本身**必须留着** —— 清掉 `deletedAt` 会让
   * 离线端把这条旧数据当成"从未删除"，又同步回来。
   *
   * ⚠️ **它不等于把 op-log 里的历史抹掉。** op-log 是只追加的事实日志，
   * `purgedAt` 只是给用户一个"从回收站移除且不可恢复"的终点。
   * 真正的加密擦除需要协议级支持，不在本字段的语义范围内 ——
   * 不要把它当"数据已经不存在"来宣传。
   *
   * 老客户端不认识它：读到一条带 `purgedAt` 的 op 只会当普通字段合并，
   * 而 `deletedAt` 仍在，于是行为与升级前一致（不复活、不显示）——
   * 这正是它不需要 bump schema 的原因。
   */
  purgedAt?: number;
}

// ─────────────────────────────────────────────────────────────
// 任务
// ─────────────────────────────────────────────────────────────

/** 任务优先级。数值越大越优先，便于排序时直接比大小。 */
export enum Priority {
  None = 0,
  Low = 1,
  Medium = 2,
  High = 3,
}

/**
 * 艾森豪威尔象限。
 *
 * 🔴 **象限是派生视图，不是 TASK 的存储字段** —— 见
 * `docs/adr/0015-four-quadrant-as-derived-view.md`。这个枚举只是**分类结果**，
 * 落盘的是它的两个**轴**：
 *
 *   - **重要性** → `Task.important`（**存**。它是用户的主观判断，推不出来）
 *   - **紧迫性** → `Task.dueDate`（**推**。由截止时间与"紧迫窗口"算出）
 *
 * 判定是纯函数：`packages/domain/src/quadrant.ts` 的
 * `classifyQuadrant` / `bucketByQuadrant`。**不要给 `Task` 加 `quadrant` 字段** ——
 * 那会让同一件事有两份定义，而它们必然会漂移。
 *
 * ⚠️ 这条注释曾经写反（写着"象限是 TASK 的存储字段，不是派生视图"），
 * 与 ADR-0015 和当时的代码都矛盾。**它会诱导下一个人去加字段**，
 * 而加字段正是 ADR-0015 §2 明令禁止的事。改动前先读 ADR。
 */
export enum Quadrant {
  /** 重要且紧急 —— 立即做 */
  UrgentImportant = 1,
  /** 重要不紧急 —— 计划做 */
  ImportantNotUrgent = 2,
  /** 紧急不重要 —— 委托/快速处理 */
  UrgentNotImportant = 3,
  /** 不重要不紧急 —— 减少或删除 */
  Neither = 4,
}

export interface Task extends EntityBase {
  title: string;
  /** 备注（Markdown）。可选 —— 老数据可能没有。 */
  note?: string;
  /** 所属清单。未归类时为 undefined（收集箱）。 */
  projectId?: string;
  /**
   * 父任务 ID（**子任务**）。
   *
   * 🔴 **这是可选字段，不是 schema bump**（AGENTS.md §3.3、见 B1-3）。
   * 运行时默认值：**`undefined` = 顶级任务**。读的时候一律走
   * `packages/domain/src/subtasks.ts` 的 `parentIdOf()`，不要各端自己写
   * `task.parentId ?? undefined` —— 那样"顶级"这件事会有第二份定义。
   *
   * 语义边界（**本轮只定义到这里，其余是未决的产品决策**）：
   *
   *   - **父任务必须存在、且未软删除。** 指向不存在父的任务在
   *     `buildTaskTree` 里被当作**顶级**处理（`detached`）；父已删除的记进
   *     `promotedFromDeletedParent`。两种都**如实上报**，不静默丢、也不强行
   *     造一个空父节点。
   *   - **不许出现环**：把 A 的父设成 A 的后代必须被拒绝。判据是
   *     {@link validateParentChange} 的 `cycle`，这是本模块最关键的一条。
   *   - **深度 / 直接子数上限**单点定义在 `subtasks.ts` 的
   *     `MAX_SUBTASK_DEPTH` / `MAX_SUBTASK_CHILDREN`，超限**返回失败原因**。
   *   - ⚠️ **父任务完成时子任务怎样、删父任务时子任务怎样 —— 仓库现状没有
   *     任何逻辑，本轮也刻意不发明默认值。** 详见 `subtasks.ts` 文件头的
   *     「两件刻意不决定的事」。
   */
  parentId?: string;
  tagIds?: string[];
  priority?: Priority;
  /** 是否标记为重要（象限的第 1 个轴）。 */
  important?: boolean;
  /** 截止时间（epoch ms）。象限的第 2 个轴由它推导紧迫性。 */
  dueDate?: number;
  /** 完成时间。存在即表示已完成（不另设 completed 布尔，避免两者不一致）。 */
  completedAt?: number;
  /**
   * 排期起点（epoch ms）。可选；**运行时默认 `undefined` = 未排期起点**
   * （AGENTS.md §3.3：已落盘的数据没有这个字段，hydration 不得炸）。
   *
   * 🔴 [ADR-0043](../../../docs/adr/0043-timeline-p2-task-start-date-duration.md)：
   * 时间线 P2 的排期面字段 —— 与 `durationMinutes` 一起推导时间线板上的
   * `range`（条）。**不 bump `CURRENT_SCHEMA_VERSION`**（纯可加性）。
   *
   * ⚠️ 与 `dueDate` 的分工：`dueDate` 是"什么时候到期"（日历/提醒/象限的语义），
   * `startDate` 是"什么时候开始做"（时间线排期的语义）。两者独立、互不推导。
   */
  startDate?: number;
  /**
   * 排期时长（**分钟**，正整数）。可选；`undefined` = 时长未知。
   *
   * 🔴 [ADR-0043](../../../docs/adr/0043-timeline-p2-task-start-date-duration.md)：
   * 与 AI 估时（备注里「预计耗时：N 分钟」）**同一个单位**，链路上不需要换算。
   * 字段存在时它是唯一事实源；缺失时读取侧回退 note 行（旧数据不搬家、不失效）。
   * 写入走 `setSchedule`（动作层夹到 [MIN, MAX] 并取整）。
   */
  durationMinutes?: number;
  /**
   * 重复规则（RFC 5545 RRULE 串）。不存在即不重复。
   *
   * 🔴 **规则为什么在 `Task` 上，而不是一个 `TASK_REPEAT_CFG` 实体。**
   * 上游 Super Productivity 的形状是"任务持有 `repeatCfgId`，规则放另一个实体"，
   * heyta 的 schema 里也一直留着 `TASK_REPEAT_CFG` 实体名。但**本引擎做不到**：
   * `sync-core` 的线类型里有 `MultiEntityPayload.entityChanges`（带 `entityType`，
   * 看着就是为跨实体准备的），而 `packages/op-log` 的 reducer **完全没有处理它** ——
   * 没有一处 `isMultiEntityPayload`。也就是说一条混合实体类型的 op 会在 reducer 里
   * 被当成普通字段合并，**静默不生效**（同 AGENTS.md #20 的形状）。
   * `OpIntent` 也只接受单一 `entityType`。
   *
   * 于是"设一次重复"若要走两实体，就得发**两个 op**，而第二个之前的状态是
   * "任务指着一条不存在的规则"。§3.4 的"一个用户意图 = 一个 op"正是为了拦这个。
   * 两个可选字段让整件事回到**一个 op、原子生效**，且不需要动 reducer。
   *
   * ⚠️ `TASK_REPEAT_CFG` 仍留在 `ENTITY_TYPES` 里（vendored 线协议词表，不能删），
   * 因此它继续登记在 `UNMODELED_ENTITY_TYPES` 并写明了原因 —— 不代表"还没做"。
   *
   * 🔴 **不要手拼这个字符串**，用 `Recurrence.daily/weekly/...`：
   * 拼错一个分号不会报错，只会静默变成另一条规则。
   */
  repeatRule?: string;
  /**
   * 规则的**锚点**（`YYYY-MM-DD` 本地日期），设规则那一刻的截止日。
   *
   * 不是装饰：`BYDAY` / `BYMONTHDAY` / `INTERVAL=2` 的选择基准都由它决定，
   * 而 `dueDate` 会随着每次完成往后推 —— 拿它当锚点会让"每两周的周三"
   * 在第二次完成之后整体漂移。所以锚点必须**钉一次、之后不动**。
   */
  repeatDtstart?: string;
  /** 排序键（在清单内的位置）。 */
  order?: number;
}

// ─────────────────────────────────────────────────────────────
// 清单 / 标签
// ─────────────────────────────────────────────────────────────

export interface Project extends EntityBase {
  name: string;
  /**
   * 父清单 ID（支持文件夹嵌套）。
   *
   * ⚠️ 允许无父（顶层）。**不支持任意深度嵌套** ——
   * 只允许一层文件夹 + 其下清单，避免循环引用与深度查询。
   */
  parentId?: string;
  color?: string;
  /** 是否归档（隐藏但保留数据）。 */
  archived?: boolean;
}

export interface Tag extends EntityBase {
  name: string;
  color?: string;
}

// ─────────────────────────────────────────────────────────────
// 便签
// ─────────────────────────────────────────────────────────────

/**
 * 独立便签（**不是**任务的备注字段）。
 *
 * 语义移植自上游 `features/note/note.model.ts`（MIT）：便签可挂在项目下、
 * 也可不挂（= 未归属），并可钉到「今天」。
 *
 * 与上游的三处**有意不同**：
 *
 * 1. 上游有 `created` / `modified`，本地由 `EntityBase` 的
 *    `createdAt` / `updatedAt` 统一提供，不另立一套时间字段
 *    （op-log 要对时间戳做确定性比较，只能有一处）。
 * 2. **没有 `backgroundColor`。** 上游允许存任意 hex 作为便签底色，
 *    但那会绕开设计系统（AGENTS.md §5：组件禁止裸值，取值只能来自 token）。
 *    要支持便签配色，正确的做法是先在 `tokens.css` 里加语义 token
 *    （并通过对比度测试），而不是让用户数据里出现自由 hex。
 *    在 token 就位之前，此字段**刻意缺席** —— 缺席比开一个后门好。
 * 3. 🔴 **`projectId` 是可选的、且"未归属"= 字段不存在，不是 `null`。**
 *    上游写 `projectId: null`，但本地 **reducer 把 `null` 定义为"显式清除
 *    这个字段"**（`packages/op-log/src/state.ts`：合并语义下传递
 *    "取消完成"这类意图只能靠 `null` 穿过 JSON，然后在 reducer 里翻成
 *    `delete`）。所以往 op 载荷里写 `projectId: null`，物化后读回来是
 *    **`undefined` 而不是 `null`** —— 声明成必填的 `string | null` 会是一个
 *    **类型谎言**：类型说有值，运行时没有。
 *    （实测来源：`packages/app-host/tests/note-actions.spec.ts` 的
 *    「未归属永远合法」那条，最初断言 `toBeNull()` 直接红了。）
 *
 *    于是这里与 `Task.projectId` 对齐：**可选，缺省 = 未归属**。
 *    需要显式 `null` 表达"未归属"的调用方走 `notes.ts` 的
 *    {@link noteProjectId} —— 它是唯一一处把 `undefined` 归一成 `null` 的地方。
 */
export interface Note extends EntityBase {
  /** 所属清单；**缺省 = 未归属**（不是 `null`，理由见上面第 3 条）。 */
  projectId?: string;
  /** 是否钉到「今天」。 */
  isPinnedToToday: boolean;
  /** 正文。 */
  content: string;
  /** 配图地址。 */
  imgUrl?: string;
  /** 是否锁定（禁止编辑）。 */
  isLock?: boolean;
}

// ─────────────────────────────────────────────────────────────
// 习惯
// ─────────────────────────────────────────────────────────────

/** 习惯的重复周期。 */
export type HabitFrequency =
  | { type: 'daily' }
  | { type: 'weekly'; /** 1=周一 … 7=周日 */ daysOfWeek: number[] }
  | { type: 'interval'; everyNDays: number };

export type HabitGoalType = 'atLeast' | 'atMost' | 'exactly';

/**
 * 习惯定义。
 *
 * ⚠️ 上游 Super Productivity 用 `SIMPLE_COUNTER`，**没有 goal/target/unit**，
 * 撑不起滴答清单级别的习惯模块。所以这是 heyta 自己新增的实体（见 shared-schema 注释）。
 */
export interface Habit extends EntityBase {
  name: string;
  /** 打卡目标的数值，如 8（杯水）。默认 1（纯打卡）。 */
  target?: number;
  /** 目标单位，如「杯」「页」「分钟」。 */
  unit?: string;
  goalType?: HabitGoalType;
  frequency?: HabitFrequency;
  color?: string;
  /**
   * 列表行首的图标，存的是**闭集词表里的 key**（`'drop'`），不是字形名。
   *
   * 🔴 一律可选（AGENTS §3.3）：磁盘上已经写下去的习惯没有这个字段，
   * 必填只会在回放/读取时炸，而构建是绿的。
   * 没设过时界面用 `deriveHabitIcon(id)` 派生一个 —— 所以这个字段**不是**
   * "有没有图标"的开关，只记录"用户自己挑过哪个"。
   */
  icon?: string;
  /**
   * 允许补打卡的天数上限。
   *
   * 为什么需要它：完全禁止补打卡对真实用户太苛刻，
   * 但无限补打卡会让"连续天数"失去意义。
   */
  backfillDays?: number;
}

/** 单日打卡记录。 */
export interface HabitLog extends EntityBase {
  habitId: string;
  /** 打卡日期，`YYYY-MM-DD`（**本地日期**，不是 UTC —— 用户的"今天"由本地时区决定）。 */
  date: string;
  /** 实际完成值。默认等于 Habit.target。 */
  value?: number;
  note?: string;
}

// ─────────────────────────────────────────────────────────────
// 专注 / 番茄钟
// ─────────────────────────────────────────────────────────────

export type FocusSessionKind = 'work' | 'shortBreak' | 'longBreak';

export interface FocusSession extends EntityBase {
  kind: FocusSessionKind;
  /** 关联任务（可选 —— 允许无任务的纯计时）。 */
  taskId?: string;
  /** 计划时长（ms）。 */
  plannedMs: number;
  /** 实际时长（ms）。未完成时可能小于 plannedMs。 */
  actualMs?: number;
  /** 是否自然完成（区别于用户手动中止）。 */
  completed?: boolean;
  startedAt?: number;
  endedAt?: number;
}

// ─────────────────────────────────────────────────────────────
// AI 反馈
// ─────────────────────────────────────────────────────────────

/**
 * 用户对一次 AI 建议的最终处置。
 *
 * 三态而不是布尔，因为「**改完才用**」和「**直接用**」对偏好的含义完全不同：
 * 前者说明 AI 的默认输出有系统性偏差，后者说明没有。
 */
export type AiFeedbackOutcome = 'accepted' | 'modified' | 'rejected';

/**
 * 一次 AI 建议的处置记录。
 *
 * 🔴 **只记事实，不记内容。**
 * 不存 AI 提议的原文、也不存用户的最终文本 —— 那些已经在任务备注里了，
 * 再存一份就是第二份会漂移的副本（而且会让这条本机行为记录变成内容泄露面）。
 * 这里只有数字与枚举。
 *
 * ⚠️ 持久化字段一律可选（AGENTS.md §3.3）。
 */
export interface AiFeedback extends EntityBase {
  /**
   * 哪个功能产生的建议。
   *
   * 用 `string` 而不是 `AiFeature` 联合：domain **不依赖 `packages/ai`**。
   * 取值由调用方保证（目前是 `'breakdown'`）。
   */
  feature: string;
  outcome: AiFeedbackOutcome;
  /** AI 提议了几项。 */
  proposedCount: number;
  /** 用户最终采用了几项（`rejected` 时为 0）。 */
  appliedCount: number;
}

/**
 * 用户对一条偏好的纠正。
 *
 * 目前只有「抑制」（忘掉它）。留成联合类型而不是布尔，
 * 是为了将来能加"改成某个值"而不必再动一次实体形状。
 */
export type PreferenceCorrectionKind = 'suppress';

export interface PreferenceCorrection extends EntityBase {
  /** 哪条偏好。取值空间由推断层定义（见 `PreferenceId`）。 */
  preferenceId: string;
  kind: PreferenceCorrectionKind;
}

// ─────────────────────────────────────────────────────────────
// 提醒
// ─────────────────────────────────────────────────────────────

/**
 * 任务提醒（**独立实体，不是 `Task.dueDate` 的派生视图**）。
 *
 * 🔴 **为什么必须是独立实体**（这是 B1-1 的关键决定，依据逐条列出）：
 *
 * 1. **没有 ADR 管这件事。** `docs/adr/` 里没有任何一份决定"提醒用独立实体还是
 *    派生"（`grep -rn "提醒\|REMINDER" docs/adr/` 只命中 ADR-0020 的订阅到期提醒，
 *    与任务提醒无关）。所以本条不是"ADR 已定、照做"，而是**新拍的产品决定**；
 *    拍它的依据是下一条。
 * 2. **计划里已经登记了结论。** `docs/plans/site-and-parity-alignment.md` §B1-1
 *    写的是「**物化 `REMINDER`** + 调度 + 本地通知」，并把"物化新实体要动
 *    `EntityModelMap` / `BUCKET_BY_ENTITY` / 编译期断言三处"列为关键难点 ——
 *    即一条已经记录的、要动实体层的工作。
 * 3. **`dueDate` 表达不了一条提醒。** `dueDate` 是**一个瞬间**，语义由
 *    [ADR-0015](../docs/adr/0015-four-quadrant-as-derived-view.md) §2 钉死为
 *    "紧迫性轴"（象限由它派生）。提醒是**通知规则**，实际用法是：
 *    「截止前 30 分钟提醒」、一条任务挂**多个**提醒、只看时间不看截止
 *    （绝对时刻提醒）。把这些塞进 `dueDate` 会让同一个字段同时表达
 *    "截止"与"何时通知"两件事，而它们必然在某次编辑里漂移。
 * 4. **一个用户意图 = 一个 op，而提醒的增删改是独立意图。**
 *    （AGENTS.md §3.4；`Task.repeatRule` 的注释用同一条推理否决了
 *    `TASK_REPEAT_CFG`，见 `UNMODELED_ENTITY_TYPES`。）
 *    若把提醒做成 `Task.reminders[]` 数组：加一条提醒 = 重写整条任务的载荷，
 *    于是"改标题"与"加提醒"在同一实体上 LWW 互斥（一端加的提醒会被另一端
 *    改标题的 op 覆盖掉），而**单条提醒的删除/顺延也做不到**。独立实体让
 *    每条提醒有自己的 id 与时钟，这正是 `HabitLog` 相对 `Habit` 的关系。
 *
 * 判据（什么时候算到期、重复怎么算）全在纯函数模块
 * `packages/domain/src/reminders.ts`；op 的构造在
 * `packages/app-host/src/reminder-actions.ts`。**不要在任何 `apps/*` 里重新判断。**
 *
 * ⚠️ 持久化字段的可选性：`taskId` / `triggerAt` 是**实体身份的一部分**
 * （没有它们这条提醒没有意义），所以是必填 —— 与 `HabitLog.habitId` / `date`
 * 同一条先例。其余状态字段一律可选 + 运行时默认值（AGENTS.md §3.3），
 * 这样老数据/另一端少写一个字段不会让 hydration 炸。
 */
export interface Reminder extends EntityBase {
  /**
   * 提醒归属的任务 id。
   *
   * 本轮的产品口径是**任务提醒**（B1-1 的验收就是"给任务建一条 10 分钟后的提醒"）。
   * 将来若要支持独立提醒（不挂任务），正确做法是把它改成可选并**同时**定义
   * "无任务提醒"的语义，而不是在调用方约定 `taskId: ''`。
   */
  taskId: string;
  /**
   * 触发时刻（epoch ms）—— **权威值**。到没到只看它（`snoozedUntil` 优先）。
   */
  triggerAt: number;
  /**
   * 相对任务 `dueDate` 的提前量（ms，正数 = 提前）。
   *
   * ⚠️ **它只用于重复任务的重算**，不是第二个权威值：读"何时触发"一律走
   * `reminderEffectiveAt()`。给了它，任务完成顺延时提醒跟着走
   * （`nextTriggerAfterRepeat()`）；不给 = 绝对时刻提醒，**不随重复移动**
   * —— 这是刻意的：「每天 9 点提醒我」里的 9 点是绝对时间，跟着 dueDate
   * 漂移反而是错的。
   */
  offsetMs?: number;
  /** 已投递的时刻。存在即表示本机已经发过这条通知（幂等依据）。 */
  firedAt?: number;
  /** 「稍后提醒」到（epoch ms）。存在且未到时，触发时刻以它为准。 */
  snoozedUntil?: number;
  /** 用户主动关闭。存在即不再触发（清除写 `null`，见 `reminders.ts`）。 */
  dismissedAt?: number;
}

// ─────────────────────────────────────────────────────────────
// 倒数日 / 纪念日
// ─────────────────────────────────────────────────────────────

/**
 * 倒数日的**类型档位**。
 *
 * 🔴 这四档是**用户选的**，不是从日期推出来的（§2.6「App 不替用户决定含义」）：
 * 哪天出生、哪天是节日，只有用户知道。唯一能从日期说的是
 * "还没到 / 已过"这副面孔，所以它是 `kind` 缺席时的兜底，而不是反过来。
 */
export type CountdownEventKind = 'countdown' | 'anniversary' | 'birthday' | 'festival';

/**
 * 农历闰月那年怎么过（ADR-0044 D2 的产品决定）。
 *
 * · `first`（默认）= 逢闰过正：闰月那年过**非闰**的那个同名月
 * · `last` = 逢闰过闰
 * · `both` = 两个月各过一次（下一次发生日取两者中较早的那个）
 */
export type LunarLeapMonthPolicy = 'first' | 'last' | 'both';

/**
 * 倒数日 / 纪念日（**倒数纪念日**功能的载体，ADR-0044 D1 拍定新建实体）。
 *
 * 🔴 **为什么是独立实体而不是"没有截止日的 Task"**（依据逐条）：
 *
 * 1. **视图不建实体，但倒数日不是视图。** `docs/plans/countdown-anniversary.md` §0
 *    的立项理由就是它有自己的字段（历法、闰月口径、归档、置顶、样式），
 *    这些塞进 Task 会让"改标题"与"改历法"在同一实体上 LWW 互斥 ——
 *    与 `Reminder` 不用 `Task.dueDate` 承载是同一条推理。
 * 2. **它没有"完成"这个状态。** Task 的 reducer 语义（完成 → 顺延时 `completedAt`）
 *    套在一个"每年都要来一次"的东西上是错的。
 * 3. **日历需要第二个源**（W6）：一条没有截止日的倒数日能上日历，
 *    这正是它区别于 TASK 的可观测判据。
 *
 * ⚠️ 持久化字段的可选性（AGENTS §3.3）：`title` / `date` 是**实体身份的一部分**
 * （没有它们这张卡片什么都没有），与 `Note.content`、`HabitLog.habitId`、
 * `Reminder.taskId` 同一条先例，是必填；**其余一律可选 + 运行时默认值**。
 *
 * ⚠️ `date` 存的一律是**公历 LocalDate**（`YYYY-MM-DD`）。农历不是第二个字段：
 * `isLunar` 说的是"每年重复时按农历那一天推"，锚点本身仍用公历写，
 * 读的时候经 `solarToLunar` 换算。这样排序、日历、回收站都不必认识两套日期。
 */
export interface CountdownEvent extends EntityBase {
  /** 标题。空白标题在写入侧拒绝（见 `domain/src/events.ts` 的 `eventRejection`）。 */
  title: string;
  /** 锚点日期（公历 `YYYY-MM-DD`，**不是时间戳** —— 倒数日没有"几点"）。 */
  date: LocalDate;
  /** 类型档位；**缺席 = 用户没选过**，由日期方向兜底（见 `eventKindOf`）。 */
  kind?: CountdownEventKind;
  /** 每年重复时按农历锚点推（`true`）。默认 `false` = 公历。 */
  isLunar?: boolean;
  /** 闰月口径；默认 `'first'`（ADR-0044 D2）。只在 `isLunar` 为真时有意义。 */
  leapMonthPolicy?: LunarLeapMonthPolicy;
  /**
   * RRULE 字符串（与 `Task.repeatRule` 同一套词表，由 `Recurrence` 构造，
   * **不许界面手拼**）。缺席 = 不重复（一次性倒数日）。
   */
  recurrence?: string;
  /**
   * 置顶时刻。🔴 **它同时就是"排在最前"**，不再另设 `sortOrder`／`isPinned`
   * 第二个字段（§2.4：两个字段必然在一次编辑里漂移；先例是 `Note.isPinnedToToday`）。
   */
  pinnedAt?: number;
  /**
   * 归档时刻。**归档 ≠ 删除**（§2.5）：它不进回收站、不可被"还原"，
   * 只在归档视图里出现。🔴 实现成"打 `deletedAt` 再打回来"是错的 ——
   * 那会让归档项出现在回收站，且离线端会把它当"从未删除"同步回来。
   */
  archivedAt?: number;
  /** 图标名（Lucide）。🔴 只给图标不给含义（§2.6）。 */
  icon?: string;
  /**
   * 色槽**编号**（1–8），不是颜色值。与活动分类同一条纪律：
   * 存不变量而不是"长什么样"，调色板改版不该动磁盘上的旧数据。
   */
  color?: CategorySlot;
  /** 备注（卡片上的那行小字）。 */
  notes?: string;
}

/**
 * 实体类型 → 领域模型 的映射。
 * 用于 op-log 的 apply 阶段做类型收窄。
 */
export interface EntityModelMap {
  TASK: Task;
  PROJECT: Project;
  TAG: Tag;
  NOTE: Note;
  HABIT: Habit;
  HABIT_LOG: HabitLog;
  FOCUS_SESSION: FocusSession;
  AI_FEEDBACK: AiFeedback;
  PREFERENCE_CORRECTION: PreferenceCorrection;
  REMINDER: Reminder;
  EVENT: CountdownEvent;
}

export type ModeledEntityType = keyof EntityModelMap;

/**
 * 有领域模型的实体类型的**运行时**清单。
 *
 * 🔴 `EntityModelMap` 的键与这份清单必须完全一致，且这是唯一一处运行时可读的定义。
 *
 * 这里曾经把同样 6 个名字**手写了第三遍**（`hasModel` 里一串 `type === 'TASK' || ...`）。
 * 于是「哪些实体被建模」这件事在仓库里有**三份**互不校验的定义：
 * `EntityModelMap`、`hasModel`、以及 `@heyta/op-log` 的 `BUCKET_BY_ENTITY`。
 * 两套并行定义必然漂移 —— 这正是 AGENTS.md #4/#7 的形状。
 *
 * 下面的编译期断言保证：往 `EntityModelMap` 加了键却忘了加进这里，`typecheck` 就红。
 */
export const MODELED_ENTITY_TYPES = [
  'TASK',
  'PROJECT',
  'TAG',
  'NOTE',
  'HABIT',
  'HABIT_LOG',
  'FOCUS_SESSION',
  'AI_FEEDBACK',
  'PREFERENCE_CORRECTION',
  'REMINDER',
  'EVENT',
] as const satisfies readonly ModeledEntityType[];

/** 编译期兜底：清单漏掉 `EntityModelMap` 的任何一个键都会让这里类型错误。 */
type AllModeledAreListed =
  Exclude<ModeledEntityType, (typeof MODELED_ENTITY_TYPES)[number]> extends never ? true : never;
const allModeledAreListed: AllModeledAreListed = true;
void allModeledAreListed;

/** 运行时守卫：该实体类型是否有领域模型（系统实体没有）。 */
export function hasModel(type: EntityType): type is ModeledEntityType {
  return (MODELED_ENTITY_TYPES as readonly string[]).includes(type);
}
