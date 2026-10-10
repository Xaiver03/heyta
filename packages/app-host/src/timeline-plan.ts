/**
 * 时间线的**规划语义**：任务 → 可渲染的时间线
 * =================================================
 *
 * 本文件现在回答**两层**产品问题（2026-10-01 时间线重画，goal：
 * `docs/plans/goal-timeline-rework.md`）：
 *
 *   0. **任务级**：这个任务在时间上处在什么位置？（`planTimelineRows` →
 *      三态 `point` / `unscheduled`，P1 只有 `dueDate` 可用；`range` 等 P2）
 *      —— 这是**板**（`TimelineBoard`，一根共轴）的数据；
 *   1. **任务内**：一个任务的清单怎么排？（`planTimelineBlock`，见下）
 *      —— 这是**详情预览**的数据（任务内部坐标系，与板分开、必须标明）。
 *
 * 下面的 1–3 是清单排程（第 1 层）的老问题陈述：
 *
 *   1. 一个任务要排几条？（备注里有清单就按清单，没有就**整条任务自己算一条**）
 *   2. 备注里的 AI 估时能不能落到条上？（只有"整条任务 = 一个可排单元"时能）
 *   3. 落不下去时怎么办？（**明说分摊不了**，绝不按比例编一个用户没给过的工期）
 *
 * 它此前住在 `apps/web/src/features/timeline/TimelineView.tsx` 里 ——
 * 按 AGENTS.md §3.5（"这段代码里有没有任何一行在决定业务上该怎么做？"）
 * 那是**放错了层**：移动端/桌面端要画时间线时，只能再抄一份，而两份对
 * "整条任务怎么算"的理解只要差一点，同一个用户在两端会看到不同的排期，
 * 且两边都不报错。所以它属于 `packages/app-host`（业务语义层），
 * 与 `readDurationFromNote` 同侧。
 *
 * 返回的 `TimelineBlock` / `TimelineBoardRow` / `TaskTimePosition` 类型定义在
 * `@heyta/domain` —— 因为共享 UI（`packages/ui`）也要用它，而 ui 与 app-host
 * **互不依赖**（见相应类型注释）。
 */

import {
  addDays,
  buildTimeline,
  parseLocalDate,
  parseChecklistFromNote,
  type ChecklistItem,
  type TaskTimePosition,
  type TimelineBlock,
  type TimelineBoardRow,
} from '@heyta/domain';

import { readDurationFromNote } from './duration-note.js';

/** 时间线需要的最小任务形状。**结构类型就够了**，刻意不 import `Task`。 */
export interface TimelineTaskLike {
  readonly id: string;
  readonly title: string;
  readonly note?: string;
  /**
   * 截止时间（epoch ms）。**可选** —— 它本来就是 `Task` 上的字段（零 schema 改动，
   * goal P1 硬规则），此前时间线唯一的问题就是没把它接进来（R4 §5.1）。
   */
  readonly dueDate?: number;
  readonly dueDateLocal?: string;
  /** 排期起点（epoch ms）。可选 —— P2 起接（ADR-0043）。 */
  readonly startDate?: number;
  readonly startDateLocal?: string;
  /** 排期时长（分钟）。可选；字段缺失时读取侧由 note 里的估时行兜底（ADR-0043 §4）。 */
  readonly durationMinutes?: number;
}

/** 推导「任务在时间上的位置」所需的任务时间字段（P2 起含排期字段，ADR-0043）。 */
export interface TaskScheduleFields {
  readonly dueDate?: number;
  readonly dueDateLocal?: string;
  readonly startDate?: number;
  readonly startDateLocal?: string;
  readonly durationMinutes?: number;
}

/** 有限正数才算"有"；NaN / Infinity / <= 0 / 类型不对一律"没有"（fail closed）。 */
function validMs(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** 有限的正时长（分钟）才算"有"。 */
function validMinutes(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function localMidnight(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  try {
    return parseLocalDate(value).getTime();
  } catch {
    return undefined;
  }
}

/**
 * 从任务推导「它在时间上的位置」（三态，[ADR-0043](../../docs/adr/0043-timeline-p2-task-start-date-duration.md) §3）：
 *
 *   - `startDate` +（`durationMinutes` 或 `dueDate`）⇒ **`range`**（画条；
 *     `dueDate` 作终点时要求在起点之后，否则退化）
 *   - 仅 `dueDate` ⇒ **`point`**（画菱形，绝不画条）—— P1 形态，不变
 *   - 仅 `startDate`（无时长无截止）⇒ **`point` 落在起点** —— R4 §5.2
 *     「只有时刻 ⇒ 点」对起点的应用：起点是真实的时间坐标，不该被丢进泳道
 *   - 都没有 ⇒ **`unscheduled`**（进有名字的泳道，不落图）
 *
 * 🔴 **绝不在这里编长度**：`durationMinutes` 单独存在（没有起点）**不产生任何
 * 几何** —— 没有起点就没有位置，估时/时长只是行头的文字 badge。
 *
 * 非法值按"没有"处理（fail closed）：一个坏时间戳不该让视图崩掉，
 * 也不该被默默夹成某个"看起来还行"的时刻。
 */
export function deriveTaskTimePosition(fields: TaskScheduleFields): TaskTimePosition {
  const start = fields.startDateLocal === undefined ? validMs(fields.startDate) : localMidnight(fields.startDateLocal);
  const due = fields.dueDateLocal === undefined ? validMs(fields.dueDate) : localMidnight(fields.dueDateLocal);
  const duration = validMinutes(fields.durationMinutes);

  if (start !== undefined) {
    if (duration !== undefined) {
      return { kind: 'range', startMs: start, endMs: start + duration * 60_000 };
    }
    if (due !== undefined && due > start) {
      // A date-only due is inclusive. The timeline range endpoint is exclusive.
      const endMs = fields.dueDateLocal === undefined
        ? due
        : localMidnight(addDays(fields.dueDateLocal, 1)) ?? due;
      return { kind: 'range', startMs: start, endMs };
    }
    return { kind: 'point', atMs: start };
  }
  if (due !== undefined) {
    return { kind: 'point', atMs: due };
  }
  return { kind: 'unscheduled' };
}

/**
 * 把一个任务算成时间线**板上的一行**（任务级，与 `planTimelineBlock` 的
 * 任务内清单排程是两个坐标系）。
 *
 * **纯函数**，不读时钟、不联网。三态语义见 `deriveTaskTimePosition`。
 */
export function planTimelineRow(task: TimelineTaskLike): TimelineBoardRow {
  // 🔴 时长的**事实源次序**（ADR-0043 §4）：字段在场 ⇒ 它赢（note 行忽略）；
  // 字段缺失 ⇒ note 里的 AI 估时行回退 —— 旧数据不搬家、不失效。
  const fieldMinutes =
    typeof task.durationMinutes === 'number' &&
    Number.isFinite(task.durationMinutes) &&
    task.durationMinutes > 0
      ? task.durationMinutes
      : undefined;
  return {
    taskId: task.id,
    title: task.title,
    position: deriveTaskTimePosition(task),
    aiMinutes: fieldMinutes ?? readDurationFromNote(task.note),
  };
}

/** 一批任务 → 一批行。顺序 = 输入序（板上的**显示**序由共享层按时间排序）。 */
export function planTimelineRows(
  tasks: readonly TimelineTaskLike[],
): readonly TimelineBoardRow[] {
  return tasks.map(planTimelineRow);
}

/**
 * 把一个任务算成一块可渲染的结果。**纯函数**，不读时钟、不联网。
 *
 * 三个分支（这是本模块存在的全部理由）：
 *   · 备注里**没有清单** → 整条任务自己算一条，估时直接落上去（最常见）
 *   · 清单**只有 1 条** → 估时就是这一条的（不发生分摊）
 *   · 清单**有 N > 1 条** → 估时是整条的，**分摊不了**：子条目按默认时长排，
 *     并置 `unattributable` 让界面明说
 */
export function planTimelineBlock(task: TimelineTaskLike): TimelineBlock {
  const checklist = parseChecklistFromNote(task.note);
  const hasChecklist = checklist.length > 0;

  // 没有清单时，**整条任务自己就是一条**：否则这条任务会在时间线上
  // 完全消失，而它恰恰是最需要看到"要花多久"的那一类。
  const units: ChecklistItem[] = hasChecklist ? checklist : [{ title: task.title }];

  // 🔴 显式判断 `undefined`，**不要**用 `||` / 真值判断：
  // `0` 是"估了 0 分钟"，与"没估过"是两件事（见 `duration-note.ts`）。
  const aiMinutes = readDurationFromNote(task.note);

  // 只有"整条任务 = 一个可排单元"时，估时才能**不发生分摊**地落下去。
  const single = units.length === 1 ? units[0] : undefined;
  const durationsInMinutes =
    single !== undefined && aiMinutes !== undefined ? { [single.title]: aiMinutes } : undefined;

  const plan = buildTimeline(units, {
    ...(durationsInMinutes === undefined ? {} : { durationsInMinutes }),
    // 🔴 告诉排程层这些数是 AI 估的 —— 界面才能说「AI 估时」而不是含糊的"约 N 分钟"。
    durationOrigin: 'ai',
  });

  return {
    taskId: task.id,
    title: task.title,
    plan,
    aiMinutes,
    hasChecklist,
    unitCount: units.length,
    unattributable: aiMinutes !== undefined && units.length > 1,
  };
}
