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
  /** 重复规则 ID，指向 TASK_REPEAT_CFG。 */
  repeatCfgId?: string;
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

/**
 * 实体类型 → 领域模型 的映射。
 * 用于 op-log 的 apply 阶段做类型收窄。
 */
export interface EntityModelMap {
  TASK: Task;
  PROJECT: Project;
  TAG: Tag;
  HABIT: Habit;
  HABIT_LOG: HabitLog;
  FOCUS_SESSION: FocusSession;
}

export type ModeledEntityType = keyof EntityModelMap;

/** 运行时守卫：该实体类型是否有领域模型（系统实体没有）。 */
export function hasModel(type: EntityType): type is ModeledEntityType {
  return (
    type === 'TASK' ||
    type === 'PROJECT' ||
    type === 'TAG' ||
    type === 'HABIT' ||
    type === 'HABIT_LOG' ||
    type === 'FOCUS_SESSION'
  );
}
