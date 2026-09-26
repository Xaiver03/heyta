/**
 * 累计成就：活动总量与里程碑
 * ==================================
 *
 * 这一层的全部设计约束只有一句：**只增不减**。
 *
 * 心理学依据（见 `docs/research/motivation-psychology.md` §2.3、§3.3）：
 * 连续型指标（streak）会在中断那天动摇用户的自我评价，而**累计型指标不会** ——
 * 它记录的是"你做过什么"，不是"你最近状态如何"。
 * 所以累计层是中断之后的兜底，也是唯一可以长期看而不产生焦虑的进度形态。
 *
 * 先例：Apple Watch 的累计里程碑（合上 Move 环 100/365/500/1000 次）
 * **完全在设备本地计算**，证明个性化成就根本不需要云端
 * （见 `docs/research/competitor-incentive-teardown.md` §8）。
 * heyta 沿用同一形状 —— 因此本模块也不新增任何持久化字段。
 *
 * ⚠️ 与滴答清单的一处**刻意不同**：它的成就值有**扣分项**（逾期/未处理会掉分），
 * 于是"打开应用"这件事本身会带来负面反馈，用户会不敢打开。
 * heyta 的里程碑**只加不减、无惩罚项**。
 */

import type { FocusSession, HabitLog, Task } from './entities.js';
import { toLocalDate } from './date.js';
import { focusSessionDay, shouldPersistSession } from './focus.js';

/** 四个维度的累计总量。全部为"只增"计数。 */
export interface ActivityTotals {
  /** 累计打卡次数（达成与否不在此层区分 —— 那是 streak 的口径）。 */
  checkIns: number;
  /** 累计专注时长（ms）。只含工作段（`shouldPersistSession`）。 */
  focusMs: number;
  /** 累计完成的任务数。 */
  tasksCompleted: number;
  /** 有任意活动记录的**不同日子**数（打卡 / 专注 / 完成任务）。 */
  activeDays: number;
}

export interface ActivityTotalsInput {
  logs: readonly HabitLog[];
  tasks: readonly Task[];
  focusSessions: readonly FocusSession[];
}

/**
 * 汇总累计活动量。
 *
 * 🔴 **只统计未删除的记录**：软删除是产品语义（撤销打卡、撤销完成），
 * 把墓碑算进去会让"累计 100 次打卡"在用户撤销之后**不减少** ——
 * 那是错的，因为"撤销"在用户心里就是"这件事没发生"。
 */
export function computeActivityTotals(input: ActivityTotalsInput): ActivityTotals {
  const days = new Set<string>();
  let checkIns = 0;

  for (const log of input.logs) {
    if (log.deletedAt !== undefined) continue;
    checkIns += 1;
    days.add(log.date);
  }

  let focusMs = 0;
  for (const session of input.focusSessions) {
    if (session.deletedAt !== undefined) continue;
    // 休息不是专注成果 —— 口径与 `focusStatsForDay` 一致，不另立一套。
    if (!shouldPersistSession(session)) continue;
    focusMs += session.actualMs ?? session.plannedMs;
    days.add(toLocalDate(focusSessionDay(session)));
  }

  let tasksCompleted = 0;
  for (const task of input.tasks) {
    if (task.deletedAt !== undefined) continue;
    if (task.completedAt === undefined) continue;
    tasksCompleted += 1;
    days.add(toLocalDate(task.completedAt));
  }

  return { checkIns, focusMs, tasksCompleted, activeDays: days.size };
}

/** 里程碑的四个维度。 */
export type MilestoneKind = 'checkIns' | 'focusHours' | 'tasks' | 'activeDays';

export interface MilestoneDefinition {
  kind: MilestoneKind;
  /** 阈值（升序）。 */
  thresholds: readonly number[];
}

/**
 * 里程碑阶梯。
 *
 * 阈值偏低起步是刻意的：**第一个里程碑必须是"够得着的"**。
 * 目标梯度效应说明动机随感知距离缩小而上升，而一上来就摆出"5000 件任务"
 * 只会让人觉得这个功能跟自己无关（禀赋进度说的是同一件事）。
 */
export const MILESTONE_DEFINITIONS: readonly MilestoneDefinition[] = [
  { kind: 'checkIns', thresholds: [10, 50, 200, 500, 1000] },
  { kind: 'focusHours', thresholds: [10, 50, 200, 1000] },
  { kind: 'tasks', thresholds: [50, 200, 1000, 5000] },
  { kind: 'activeDays', thresholds: [7, 30, 100, 365] },
];

/** 单个里程碑的达成情况。`id` 形如 `checkIns:50`，界面据此取文案。 */
export interface MilestoneProgress {
  id: string;
  kind: MilestoneKind;
  threshold: number;
  /** 当前值。`focusHours` 为**小时数**（向下取整），其余为计数。 */
  value: number;
  reached: boolean;
  /** 到下一档的进度 0–1；已达该维度最高档时为 1。 */
  ratio: number;
}

/** 某个维度的当前值（`focusHours` 换算成小时）。 */
function milestoneValue(kind: MilestoneKind, totals: ActivityTotals): number {
  switch (kind) {
    case 'checkIns':
      return totals.checkIns;
    case 'focusHours':
      // 向下取整：显示"9 小时"时必须真的满 9 小时，不能四舍五入到 10。
      return Math.floor(totals.focusMs / (60 * 60 * 1000));
    case 'tasks':
      return totals.tasksCompleted;
    case 'activeDays':
      return totals.activeDays;
  }
}

/**
 * 把累计总量摊成里程碑阶梯。
 *
 * 返回值**包含全部档位**（含未达成的）：界面需要"下一档还差多少"来驱动
 * 目标梯度，只回已达成的档位会让下一步消失。
 */
export function deriveMilestones(totals: ActivityTotals): MilestoneProgress[] {
  const out: MilestoneProgress[] = [];

  for (const def of MILESTONE_DEFINITIONS) {
    const value = milestoneValue(def.kind, totals);

    for (let i = 0; i < def.thresholds.length; i += 1) {
      const threshold = def.thresholds[i]!;
      const next = def.thresholds[i + 1];
      const reached = value >= threshold;

      let ratio: number;
      if (reached && next === undefined) {
        // 已达该维度最高档：进度封顶，不再造出"下一档"的假目标。
        ratio = 1;
      } else if (reached && next !== undefined) {
        // 已达这一档：进度改为对**下一档**的靠近程度（目标梯度）。
        ratio = Math.min(1, value / next);
      } else {
        ratio = Math.min(1, value / threshold);
      }

      out.push({
        id: `${def.kind}:${String(threshold)}`,
        kind: def.kind,
        threshold,
        value,
        reached,
        ratio,
      });
    }
  }

  return out;
}