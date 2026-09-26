/**
 * 身份标签（L3 叙事层）
 * ========================
 *
 * 它给的**不是奖励，是身份**。
 *
 * 依据（见 `docs/research/motivation-psychology.md` §3.1、§3.2）：
 * 外部奖励会挤掉内在动机（过度理由效应），而"我在打卡 → 我是这样的人"
 * 的自我认同转变不依赖任何外部奖励，是唯一不随新鲜感衰减的动力形态。
 *
 * 所以这里输出的是**可被用户认同的描述**，不是可消费的通货：
 *   - 没有金币、没有积分、没有可兑换物；
 *   - 没有排行榜、没有"超过 87% 的用户"；
 *   - 标签可以隐藏、可以关闭（界面负责），因为它们必须属于用户自己。
 *
 * ⚠️ 标签文案**不在这一层**（这里是领域层，不写面向用户的文案）。
 * 本模块只给 `id` + 阈值 + 进度，中文文案在界面层按 `id` 取（`check:ui-language` 扫描界面层）。
 */

import type { ActivityTotals, MilestoneKind } from './milestones.js';

/** 身份标签的判据维度。比里程碑多一个"当前连续天数"。 */
export type IdentityTagKind = MilestoneKind | 'streakDays';

export interface IdentityTagDefinition {
  /** 稳定 id，界面据此取文案。**改名等于让所有语言文案失配**，不要改。 */
  id: string;
  kind: IdentityTagKind;
  threshold: number;
}

/**
 * 标签阶梯。
 *
 * 选择标准只有一条：**它必须描述一件真的发生过、且用户会认的事**。
 * "累计 100 小时专注"是真的；"获得 500 金币"是我们编的。
 */
export const IDENTITY_TAG_DEFINITIONS: readonly IdentityTagDefinition[] = [
  { id: 'started', kind: 'activeDays', threshold: 7 },
  { id: 'routine', kind: 'activeDays', threshold: 30 },
  { id: 'steady', kind: 'activeDays', threshold: 100 },
  { id: 'checkin-hundred', kind: 'checkIns', threshold: 100 },
  { id: 'deep-fifty', kind: 'focusHours', threshold: 50 },
  { id: 'deep-two-hundred', kind: 'focusHours', threshold: 200 },
  { id: 'finisher-five-hundred', kind: 'tasks', threshold: 500 },
  { id: 'streak-thirty', kind: 'streakDays', threshold: 30 },
];

export interface IdentityTagProgress {
  id: string;
  kind: IdentityTagKind;
  threshold: number;
  /** 当前值（`focusHours` 为小时数）。 */
  value: number;
  reached: boolean;
  /** 距离达标 0–1（已达标为 1）。 */
  ratio: number;
}

export interface IdentityTagInput {
  totals: ActivityTotals;
  /** 所有习惯中最长的**当前**连续天数。没有任何连续时为 0。 */
  bestCurrentStreak: number;
}

function tagValue(kind: IdentityTagKind, input: IdentityTagInput): number {
  switch (kind) {
    case 'checkIns':
      return input.totals.checkIns;
    case 'focusHours':
      return Math.floor(input.totals.focusMs / (60 * 60 * 1000));
    case 'tasks':
      return input.totals.tasksCompleted;
    case 'activeDays':
      return input.totals.activeDays;
    case 'streakDays':
      return input.bestCurrentStreak;
  }
}

export function deriveIdentityTags(input: IdentityTagInput): IdentityTagProgress[] {
  return IDENTITY_TAG_DEFINITIONS.map((def) => {
    const value = tagValue(def.kind, input);
    const reached = value >= def.threshold;
    return {
      id: def.id,
      kind: def.kind,
      threshold: def.threshold,
      value,
      reached,
      ratio: reached ? 1 : Math.min(1, value / def.threshold),
    };
  });
}

/**
 * 只取已达成的标签 id。
 *
 * 界面常用它，因为"已获得的身份"才是展示重点；
 * 未达成的标签属于里程碑那一层（那里有完整的阶梯与进度）。
 */
export function reachedIdentityTagIds(input: IdentityTagInput): string[] {
  return deriveIdentityTags(input)
    .filter((tag) => tag.reached)
    .map((tag) => tag.id);
}