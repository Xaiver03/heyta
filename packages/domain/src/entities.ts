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
 * 注意：**象限是 TASK 的存储字段，不是派生视图。**
 * 存下来的理由是"重要性"是用户的主观判断，无法从其他字段推导 ——
 * 紧迫性可以从 dueDate 推导，重要性不行。
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
  tagIds?: string[];
  priority?: Priority;
  /** 是否标记为重要（象限的第 1 个轴）。 */
  important?: boolean;
  /** 截止时间（epoch ms）。象限的第 2 个轴由它推导紧迫性。 */
  dueDate?: number;
  /** 完成时间。存在即表示已完成（不另设 completed 布尔，避免两者不一致）。 */
  completedAt?: number;
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
 * 也可不挂（`projectId: null`），并可钉到「今天」。
 *
 * 与上游的两处**有意不同**：
 *
 * 1. 上游有 `created` / `modified`，本地由 `EntityBase` 的
 *    `createdAt` / `updatedAt` 统一提供，不另立一套时间字段
 *    （op-log 要对时间戳做确定性比较，只能有一处）。
 * 2. **没有 `backgroundColor`。** 上游允许存任意 hex 作为便签底色，
 *    但那会绕开设计系统（AGENTS.md §5：组件禁止裸值，取值只能来自 token）。
 *    要支持便签配色，正确的做法是先在 `tokens.css` 里加语义 token
 *    （并通过对比度测试），而不是让用户数据里出现自由 hex。
 *    在 token 就位之前，此字段**刻意缺席** —— 缺席比开一个后门好。
 */
export interface Note extends EntityBase {
  /** 所属项目；`null` = 不归属任何项目。 */
  projectId: string | null;
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
