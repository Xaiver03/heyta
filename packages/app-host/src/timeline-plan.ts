/**
 * 时间线的**规划语义**：任务 → 可渲染的时间线块
 * =================================================
 *
 * 这里回答的是几个**产品问题**，而不是排版：
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
 * 返回的 `TimelineBlock` 类型定义在 `@heyta/domain` —— 因为共享 UI
 * （`packages/ui`）也要用它，而 ui 与 app-host **互不依赖**（见该类型注释）。
 */

import {
  buildTimeline,
  parseChecklistFromNote,
  type ChecklistItem,
  type TimelineBlock,
} from '@heyta/domain';

import { readDurationFromNote } from './duration-note.js';

/** 时间线需要的最小任务形状。**结构类型就够了**，刻意不 import `Task`。 */
export interface TimelineTaskLike {
  readonly id: string;
  readonly title: string;
  readonly note?: string;
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

/** 一批任务 → 一批块。顺序 = 块序。 */
export function planTimelineBlocks(
  tasks: readonly TimelineTaskLike[],
): readonly TimelineBlock[] {
  return tasks.map(planTimelineBlock);
}
