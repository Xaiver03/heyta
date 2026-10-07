/**
 * 四象限（艾森豪威尔矩阵）
 * =========================
 *
 * **纯函数，无框架依赖。** 这是 heyta 的核心差异化功能之一，
 * 也是最容易被"顺手写进组件里"从而无法测试的逻辑。
 *
 * 关键设计判断：**象限的紧迫性由 dueDate 推导，重要性由用户判断。**
 * 两者不能都推导 —— "这件事重不重要"是主观的，任何算法都猜不对。
 */

import { Quadrant, type Task } from './entities.js';

/** 紧迫性的判定窗口：截止时间在 N 天内算"紧急"。 */
export const DEFAULT_URGENT_WINDOW_DAYS = 2;

export interface QuadrantOptions {
  /** 当前时间（epoch ms）。显式传入而不是读 Date.now()，否则函数不可测。 */
  now: number;
  /**
   * 多少天内算紧急。默认 {@link DEFAULT_URGENT_WINDOW_DAYS}。
   *
   * 为什么是 2 而不是 1：只算"今天到期"会让几乎所有任务都不紧急，
   * 象限退化成一个空矩阵。2 天给了用户一点提前量，同时仍然有意义。
   */
  urgentWindowDays?: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 判断任务是否紧急。
 *
 * 规则：
 *   - 已完成的**永不紧急**（它已经不需要做了）
 *   - 有截止时间且在窗口内（含已过期）→ 紧急
 *   - 无截止时间 → 不紧急
 */
export function isUrgent(task: Task, options: QuadrantOptions): boolean {
  if (task.completedAt !== undefined) return false;
  if (task.dueDate === undefined) return false;

  const windowMs =
    (options.urgentWindowDays ?? DEFAULT_URGENT_WINDOW_DAYS) * MS_PER_DAY;
  // 已过期也算紧急 —— 差值为负自然满足 <=
  return task.dueDate - options.now <= windowMs;
}

/**
 * 计算任务所属象限。
 *
 * 优先用**显式存储的** `important` 字段；未设置时回退到优先级推导。
 *
 * 为什么要有回退：`important` 是后加的字段，老数据没有它。
 * 若直接返回 `Neither`，所有历史任务会突然挤进"不重要不紧急"，
 * 象限视图看上去像坏了 —— 这是**前向兼容问题，不是排序问题**。
 */
export function classifyQuadrant(task: Task, options: QuadrantOptions): Quadrant {
  const urgent = isUrgent(task, options);
  const important = isImportant(task);

  if (important && urgent) return Quadrant.UrgentImportant;
  if (important && !urgent) return Quadrant.ImportantNotUrgent;
  if (!important && urgent) return Quadrant.UrgentNotImportant;
  return Quadrant.Neither;
}

/**
 * 是否重要。
 *
 * 显式 `important` 优先；未设置时用优先级推导（HIGH 视为重要）。
 * **故意不用 MEDIUM 当作重要** —— 那会让"重要"占绝大多数，象限失去区分度。
 */
export function isImportant(task: Task): boolean {
  if (task.important !== undefined) return task.important;
  // 显式字段缺失时的推导回退（见上方注释）
  return task.priority === 3; // Priority.High
}

export interface QuadrantBuckets {
  [Quadrant.UrgentImportant]: Task[];
  [Quadrant.ImportantNotUrgent]: Task[];
  [Quadrant.UrgentNotImportant]: Task[];
  [Quadrant.Neither]: Task[];
}

/**
 * 把任务列表分到四个象限。
 *
 * **已完成与已删除的任务被排除** —— 象限是"待办决策工具"，
 * 混入已完成项会让它变成一堆噪音。
 */
export function bucketByQuadrant(
  tasks: readonly Task[],
  options: QuadrantOptions,
): QuadrantBuckets {
  const buckets: QuadrantBuckets = {
    [Quadrant.UrgentImportant]: [],
    [Quadrant.ImportantNotUrgent]: [],
    [Quadrant.UrgentNotImportant]: [],
    [Quadrant.Neither]: [],
  };

  for (const task of tasks) {
    if (task.completedAt !== undefined) continue;
    if (task.deletedAt !== undefined) continue;
    buckets[classifyQuadrant(task, options)].push(task);
  }

  // 每个象限内部按截止时间升序（无截止时间排最后），再按优先级降序
  const sortKey = (t: Task): number => t.dueDate ?? Number.MAX_SAFE_INTEGER;
  // 显式列出四个桶而不是 Object.values(buckets) ——
  // 后者会把类型宽化成 any[]，丢掉 Task[]。
  const all: Task[][] = [
    buckets[Quadrant.UrgentImportant],
    buckets[Quadrant.ImportantNotUrgent],
    buckets[Quadrant.UrgentNotImportant],
    buckets[Quadrant.Neither],
  ];
  for (const list of all) {
    list.sort((a, b) => {
      const byDue = sortKey(a) - sortKey(b);
      if (byDue !== 0) return byDue;
      return (b.priority ?? 0) - (a.priority ?? 0);
    });
  }

  return buckets;
}

/** 象限的显示元数据。UI 用它做标签，**避免在各处硬编码象限名称**。 */
export const QUADRANT_META: Record<
  Quadrant,
  { key: keyof QuadrantBuckets; label: string; hint: string; tokenPrefix: string }
> = {
  [Quadrant.UrgentImportant]: {
    key: Quadrant.UrgentImportant,
    label: '重要且紧急',
    hint: '立即做',
    tokenPrefix: 'quadrant-1',
  },
  [Quadrant.ImportantNotUrgent]: {
    key: Quadrant.ImportantNotUrgent,
    label: '重要不紧急',
    hint: '计划做',
    tokenPrefix: 'quadrant-2',
  },
  [Quadrant.UrgentNotImportant]: {
    key: Quadrant.UrgentNotImportant,
    label: '紧急不重要',
    hint: '委托或快速处理',
    tokenPrefix: 'quadrant-3',
  },
  [Quadrant.Neither]: {
    key: Quadrant.Neither,
    label: '不重要不紧急',
    hint: '减少或删除',
    tokenPrefix: 'quadrant-4',
  },
} as const;

/**
 * 拖进"紧急"侧、而任务原本够不上紧急时，给它一个多远的期限。
 *
 * 1 小时的取值理由：它必须**明确落在窗口内**，同时要像"真的急"。
 * 直接用窗口边界（`now + 2 天`）在语义上不对 —— 那是"最不紧急的紧急"。
 */
export const DROP_URGENT_LEAD_MS = 60 * 60 * 1000;

/** 一次移动或撤销的原子字段改动；null 恢复重要性由优先级推导的状态。 */
export interface QuadrantTaskPatch {
  important: boolean | null;
  /**
   * 截止时间的改动：
   *   - `undefined` = 不用改
   *   - `null` = 清除
   *   - `number` = 设为该值
   */
  dueDate?: number | null;
}

export interface QuadrantDropPlan extends QuadrantTaskPatch {
  important: boolean;
  /**
   * 这次投放**动到了用户的截止时间**。
   *
   * ⚠️ 不是错误，但**不能无声**。用户设的"周五交报告"被一次拖拽清掉，
   * 而界面上什么都没发生，这是最容易被记成"数据丢了"的一类 bug。
   * UI 拿到这个字段就必须说明。
   */
  dueDateChange?: 'pushed' | 'cleared';
}

/** 只还原本次移动触及的字段，保留原先未显式指定重要性的语义。 */
export function planQuadrantDropUndo(task: Task, drop: QuadrantDropPlan): QuadrantTaskPatch {
  return {
    important: task.important ?? null,
    ...(drop.dueDate === undefined ? {} : { dueDate: task.dueDate ?? null }),
  };
}

/**
 * 把任务投放到某个象限时，应该产生哪些字段改动。
 *
 * 🔴 **为什么这是领域层的纯函数，而不是写在组件的事件处理里。**
 *
 * `apps/web` 的 `QuadrantBoard.tsx` 里原先有一段等价逻辑（2026-09-26 读代码核实），
 * 它有两个真缺陷，而**它至今一个测试都没有** —— 这两件事互为因果：
 *
 *   1. `if (urgent && task.dueDate === undefined)` **只处理"完全没有截止时间"**。
 *      一个"10 天后到期"的任务被拖进 Q1，只会被设成"重要"；它**仍然不紧急**，
 *      于是任务**弹回 Q2**。用户拖了等于没拖，界面上没有任何解释。
 *   2. 注释写着「一次操作 = 一条 op（AGENTS.md §3.4）：两个字段一次写完」，
 *      代码却是**两次 `await`**（两条 op）。注释描述的是意图，代码做的是另一件事。
 *
 * 移到领域层之后，"四个象限 × 三种截止时间状态（无 / 窗口内 / 窗口外）"
 * 可以被穷举验证。逻辑放在组件里，就只能靠人眼。
 */
export function planQuadrantDrop(
  task: Task,
  target: Quadrant,
  options: QuadrantOptions,
): QuadrantDropPlan {
  const important =
    target === Quadrant.UrgentImportant || target === Quadrant.ImportantNotUrgent;
  const wantUrgent =
    target === Quadrant.UrgentImportant || target === Quadrant.UrgentNotImportant;

  const plan: QuadrantDropPlan = { important };

  if (wantUrgent) {
    // 直接按"截止时间是否落在窗口内"判断，**不复用 `isUrgent`**：
    // `isUrgent` 对已完成任务恒返回 false（它已经不需要做了），
    // 那是**显示语义**。而这里问的是几何问题"它在不在窗口里" ——
    // 混用会让"已完成的紧急任务"被莫名其妙推一个期限。
    const windowMs = (options.urgentWindowDays ?? DEFAULT_URGENT_WINDOW_DAYS) * MS_PER_DAY;
    const alreadyUrgent = task.dueDate !== undefined && task.dueDate - options.now <= windowMs;

    // 已经紧急 → 别动用户的日期。拖拽只该改它必须改的东西。
    if (alreadyUrgent) return plan;

    // **窗口外的日期也要覆盖**，不能只在"没有日期"时才补 ——
    // 那正是原实现的缺陷 1，会让任务弹回原来的格。
    plan.dueDate = options.now + DROP_URGENT_LEAD_MS;
    plan.dueDateChange = 'pushed';
    return plan;
  }

  // 非紧急侧：要**真的落进这一格**，就必须没有截止时间 —— 紧迫性是从它推导的。
  // 这不是"顺手清掉"，而是"这一格的语义就是没有迫近的期限"。
  // 但它是**用户数据的删除**，所以必须通过 `dueDateChange` 让 UI 说出来。
  if (task.dueDate !== undefined) {
    plan.dueDate = null;
    plan.dueDateChange = 'cleared';
  }
  return plan;
}
