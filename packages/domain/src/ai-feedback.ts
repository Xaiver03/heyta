/**
 * AI 反馈层：从「用户怎么处置建议」推断偏好
 * ============================================
 *
 * ## 为什么需要这一层
 *
 * 第一批五条偏好（`preferences.ts`）全部从**用户自己的数据**推断 ——
 * 任务、备注、专注记录。那是"你是什么样的人"。
 *
 * 但有一类偏好从那些数据里**根本推不出来**：**AI 该怎么为你工作**。
 * 你习惯写 6 项清单，不代表 AI 给你 6 项时你会满意 ——
 * 你可能觉得它太啰嗦，想要 3 项。
 *
 * 这个差距只有**看你怎么处置 AI 的建议**才能知道。而在本轮之前，
 * heyta 的 `AiBreakdown` **不记录任何反馈** ——
 * 建议被采用还是被丢掉，代码里没有留下任何痕迹。
 *
 * ## P6 与 P7 的分工
 *
 * - **P6 拆解粒度（来自反馈）** —— 你**采纳**的建议通常有几项。
 *   与 P4（从你自己的备注算）互补：P4 是冷启动信号，P6 是真实反馈信号。
 * - **P7 保留率** —— 你留下了 AI 提议的**几成**。
 *   接近 1 说明它的默认输出合适；明显偏低说明它**过量提议**。
 *
 * ## 🔴 P7 刻意**不含**「拒绝」
 *
 * 拒绝（`rejected`）的含义是歧义的：可能是"粒度不对"，
 * 也可能是"我根本不需要拆解"。把它算成"保留率 0"会把两种完全不同的
 * 信号混在一起，让这条偏好失去可解释性 —— 而不可解释的偏好没法给用户看，
 * 也就没法纠正。
 *
 * 高拒绝率是一个**独立的**信号（说明该不该用 AI），本轮不建模，如实留白。
 *
 * ## 纯函数
 *
 * 与 `preferences.ts` 同样的纪律：不读时钟、不读环境、零依赖。
 */

import type { AiFeedbackOutcome } from './entities.js';
import {
  MIN_SAMPLE_SIZE,
  MIN_CONFIDENCE,
  medianOf,
  type Preference,
  type WithheldPreference,
} from './preferences.js';

/**
 * 推断所需的最小字段集。
 *
 * 用**结构化子集**而不是直接收 `AiFeedback`：这样测试可以只造需要的字段，
 * 调用方也不必构造完整实体。
 */
export interface AiFeedbackRow {
  readonly feature: string;
  readonly outcome: AiFeedbackOutcome;
  /** AI 提议了几项。 */
  readonly proposedCount: number;
  /** 用户最终采用了几项。 */
  readonly appliedCount: number;
  readonly deletedAt?: number;
}

export interface FeedbackPreferenceInput {
  /**
   * 🔴 主开关，**必填**（与 `inferPreferences` 同样的理由，见 ADR-0014 §2.2）。
   * 可选参数会被忘记，而被忘记的隐私闸门最终一定 fail open。
   */
  readonly memoryEnabled: boolean;
  readonly feedback: readonly AiFeedbackRow[];
  /** 只看哪个功能的反馈。默认 `'breakdown'`（目前唯一有反馈的功能）。 */
  readonly feature?: string;
}

/** 参与推断的反馈条数上限，防止极端情况下 O(n) 变慢。 */
const MAX_ROWS = 500;

/**
 * 采样可信度：样本越多越可信，`FULL_SAMPLE_SIZE` 条封顶。
 *
 * 与 `preferences.ts` 里的同名概念一致，但**不导出复用** ——
 * 那里的是私有函数。宁可这里重复 4 行，也不为了复用把内部实现变成公开 API。
 */
const FULL_SAMPLE_SIZE = 20;
const sampleFactor = (n: number): number => Math.min(1, n / FULL_SAMPLE_SIZE);

/** 取参与推断的行：未删除、指定功能、时间倒序截断。 */
function usableRows(input: FeedbackPreferenceInput, feature: string): AiFeedbackRow[] {
  const rows: AiFeedbackRow[] = [];
  for (const row of input.feedback) {
    if (row.deletedAt !== undefined) continue;
    if (row.feature !== feature) continue;
    rows.push(row);
  }
  // 截断保留**最后** MAX_ROWS 条（数组约定为时间正序），
  // 偏好是"最近的我"，不是"历史上的我"。
  return rows.length > MAX_ROWS ? rows.slice(rows.length - MAX_ROWS) : rows;
}

// ─────────────────────────────────────────────────────────────
// P6 拆解粒度（来自反馈）
// ─────────────────────────────────────────────────────────────

/**
 * 你**采纳**的拆解通常有几项。
 *
 * 只统计 `accepted` / `modified` 且 `appliedCount > 0` 的：
 * 被拒绝的建议不表达"你要几项"，只表达"这个不要"。
 */
export function inferGranularityFromFeedback(
  input: FeedbackPreferenceInput,
): { preference: Preference<number> | null; withheld: WithheldPreference | null } {
  const id = 'feedback-granularity' as const;
  const rows = usableRows(input, input.feature ?? 'breakdown');

  const counts: number[] = [];
  for (const row of rows) {
    if (row.outcome === 'rejected') continue;
    if (row.appliedCount > 0) counts.push(row.appliedCount);
  }

  if (counts.length === 0) {
    return {
      preference: null,
      withheld: { id, reason: 'no-data', detail: '还没有采纳过 AI 的拆解建议' },
    };
  }
  if (counts.length < MIN_SAMPLE_SIZE) {
    return {
      preference: null,
      withheld: {
        id,
        reason: 'not-enough-samples',
        detail: `还需要 ${MIN_SAMPLE_SIZE - counts.length} 次采纳`,
      },
    };
  }

  const value = medianOf(counts);
  // 粒度用「项」衡量：四分位距达 4 项就算很不稳定。
  const sorted = [...counts].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)] ?? value;
  const q3 = sorted[Math.floor(sorted.length * 0.75)] ?? value;
  const dispersion = q3 - q1;
  const stability = Math.max(0, 1 - dispersion / 4);
  const confidence = sampleFactor(counts.length) * stability;

  if (confidence < MIN_CONFIDENCE) {
    return {
      preference: null,
      withheld: {
        id,
        reason: 'not-stable-enough',
        detail: '你采纳的拆解项数差异很大，暂时看不出固定喜好',
      },
    };
  }

  return {
    preference: {
      id,
      value,
      sampleSize: counts.length,
      confidence,
      evidence: `基于你采纳的 ${counts.length} 次拆解，通常是 ${value} 项`,
    },
    withheld: null,
  };
}

// ─────────────────────────────────────────────────────────────
// P7 保留率
// ─────────────────────────────────────────────────────────────

/**
 * AI 提议的项里，你通常留下几成。
 *
 * 接近 1 → 它的默认输出合适，不必调。
 * 明显偏低 → 它**过量提议**了，应该少给几项、给更粗的粒度。
 *
 * 🔴 拒绝的建议**不参与**（见文件头：拒绝的含义是歧义的）。
 */
export function inferKeepRatio(
  input: FeedbackPreferenceInput,
): { preference: Preference<number> | null; withheld: WithheldPreference | null } {
  const id = 'feedback-keep-ratio' as const;
  const rows = usableRows(input, input.feature ?? 'breakdown');

  const ratios: number[] = [];
  for (const row of rows) {
    if (row.outcome === 'rejected') continue;
    if (row.proposedCount <= 0) continue;
    ratios.push(row.appliedCount / row.proposedCount);
  }

  if (ratios.length === 0) {
    return {
      preference: null,
      withheld: { id, reason: 'no-data', detail: '还没有可以对比的拆解建议' },
    };
  }
  if (ratios.length < MIN_SAMPLE_SIZE) {
    return {
      preference: null,
      withheld: {
        id,
        reason: 'not-enough-samples',
        detail: `还需要 ${MIN_SAMPLE_SIZE - ratios.length} 次采纳`,
      },
    };
  }

  const value = medianOf(ratios);
  const sorted = [...ratios].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)] ?? value;
  const q3 = sorted[Math.floor(sorted.length * 0.75)] ?? value;
  // 保留率的四分位距达 0.5 就算很不稳定。
  const stability = Math.max(0, 1 - (q3 - q1) / 0.5);
  const confidence = sampleFactor(ratios.length) * stability;

  if (confidence < MIN_CONFIDENCE) {
    return {
      preference: null,
      withheld: {
        id,
        reason: 'not-stable-enough',
        detail: '你保留建议的比例波动太大，暂时看不出固定习惯',
      },
    };
  }

  const pct = Math.round(value * 100);
  const evidence =
    value >= 0.9
      ? `基于 ${ratios.length} 次采纳，你几乎总是全部保留 AI 的拆解`
      : value <= 0.3
        ? `基于 ${ratios.length} 次采纳，你通常只留下 ${pct}% —— AI 给得太多了`
        : `基于 ${ratios.length} 次采纳，你通常留下约 ${pct}% 的拆解项`;

  return {
    preference: { id, value, sampleSize: ratios.length, confidence, evidence },
    withheld: null,
  };
}

// ─────────────────────────────────────────────────────────────
// 汇总
// ─────────────────────────────────────────────────────────────

/** 反馈层的偏好结果。 */
export interface FeedbackPreferenceSet {
  readonly memoryEnabled: boolean;
  readonly feedbackGranularity: Preference<number> | null;
  readonly keepRatio: Preference<number> | null;
  readonly withheld: readonly WithheldPreference[];
}

/** 主开关关闭时的返回值：**空集**，一条都不推断。 */
export function emptyFeedbackPreferenceSet(memoryEnabled = false): FeedbackPreferenceSet {
  return {
    memoryEnabled,
    feedbackGranularity: null,
    keepRatio: null,
    withheld: [],
  };
}

/**
 * 推断反馈层的偏好（P6 / P7）。
 *
 * 🔴 `memoryEnabled === false` 时**立即返回空集** ——
 * 不读 feedback、不产出任何东西。总开关的落点与 `inferPreferences` 一致。
 */
export function inferFeedbackPreferences(input: FeedbackPreferenceInput): FeedbackPreferenceSet {
  if (!input.memoryEnabled) return emptyFeedbackPreferenceSet(false);

  const granularity = inferGranularityFromFeedback(input);
  const keep = inferKeepRatio(input);

  const withheld: WithheldPreference[] = [];
  for (const w of [granularity.withheld, keep.withheld]) {
    if (w !== null) withheld.push(w);
  }

  return {
    memoryEnabled: true,
    feedbackGranularity: granularity.preference,
    keepRatio: keep.preference,
    withheld,
  };
}
