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
