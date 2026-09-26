/**
 * 记录 AI 反馈（功能 ①的反馈层）
 * ================================
 *
 * ## 这个文件为什么必须存在
 *
 * `packages/domain/src/ai-feedback.ts` 能算出 P6/P7，
 * `packages/op-log` 能把 `AI_FEEDBACK` 物化 —— 但如果**没有一条路径
 * 把界面的处置写进去**，那两层就都是空转。
 *
 * 这正是本仓库最高发的失效形状（AGENTS.md #20）：**能力建好了、
 * 单测全绿、但零调用方**。此前的 `memory.ts` 就是活例子。
 *
 * 所以这里提供**唯一**的写入路径，并且它对每次调用做输入校验 ——
 * 让"记了假数据"和"没记"一样不可能悄悄发生。
 */

import type { EntityType } from '@heyta/shared-schema';
import { OpType } from '@heyta/sync-core';
import type { OpIntent } from '@heyta/op-log';
import type { AiFeedbackOutcome } from '@heyta/domain';

import type { ActionContext } from './actions.js';
import { randomId } from './ids.js';

/** `record` 的入参。 */
export interface AiFeedbackInput {
  /** 哪个功能。目前只有 `'breakdown'`。 */
  feature: string;
  outcome: AiFeedbackOutcome;
  /** AI 提议了几项。 */
  proposedCount: number;
  /** 用户最终采用了几项。 */
  appliedCount: number;
}

export interface AiFeedbackActions {
  /** 记一条反馈。返回新实体的 id。 */
  record(input: AiFeedbackInput): Promise<string>;
}

export interface AiFeedbackActionsOptions {
  now?: () => number;
  newId?: () => string;
}

/**
 * 可以被纠正的偏好 id。
 *
 * ⚠️ 这是**持久化取值**，与 `@heyta/domain` 的 `PreferenceId` 是两份定义。
 * 它们必须一致 —— 但这里是写入侧，不该 import 推断层的类型来做运行时校验
 * （推断层可能改 id，而磁盘上已经有旧 id 的记录）。
 * 有测试核对两边不漏。
 */
const KNOWN_PREFERENCE_IDS: readonly string[] = [
  'estimate-bias',
  'deep-work-window',
  'lead-time',
  'granularity',
  'title-style',
  'feedback-granularity',
  'feedback-keep-ratio',
];

/** 各功能名。**不直接用 `AiFeature` 字面量** —— 这里是持久化取值，要独立演进。 */
const VALID_FEATURES: readonly string[] = ['breakdown'];

const VALID_OUTCOMES: readonly AiFeedbackOutcome[] = ['accepted', 'modified', 'rejected'];

/** 一次建议的项数上限。超过它一定是上游出了问题。 */
const MAX_ITEMS = 200;

const isNonNegativeInt = (n: number): boolean => Number.isInteger(n) && n >= 0;

/**
 * 用户对偏好的纠正（"这条不对，忘掉它"）。
 *
 * 🔴 纠正**必须持久化**。不持久化的话，用户每次打开设置都要再删一遍
 * 同一条错的偏好 —— 而"删了又回来"会让整个记忆层显得不可信。
 */
export interface PreferenceCorrectionActions {
  /** 忘掉一条偏好。返回纠正记录的 id。 */
  suppress(preferenceId: string): Promise<string>;
  /** 撤销一次「忘掉」（删除纠正记录 = 恢复那条偏好）。 */
  restore(correctionId: string): Promise<void>;
}

export function createPreferenceCorrectionActions(
  ctx: ActionContext,
  options: AiFeedbackActionsOptions = {},
): PreferenceCorrectionActions {
  const newId = options.newId ?? (() => `prefcorr-${randomId()}`);

  return {
    async suppress(preferenceId) {
      // 未知 id 不记 —— 记下来也没人认得，只会变成永远清不掉的垃圾。
      if (!KNOWN_PREFERENCE_IDS.includes(preferenceId)) {
        throw new Error(`未知的偏好「${preferenceId}」，无法忘掉`);
      }
      const entityId = newId();
      await ctx.dispatch({
        entityType: 'PREFERENCE_CORRECTION' as EntityType,
        entityId,
        opType: OpType.Create,
        payload: { preferenceId, kind: 'suppress' },
      } satisfies OpIntent);
      return entityId;
    },

    async restore(correctionId) {
      if (ctx.getState().preferenceCorrections[correctionId] === undefined) {
        throw new Error(`找不到这条纠正记录「${correctionId}」`);
      }
      await ctx.dispatch({
        entityType: 'PREFERENCE_CORRECTION' as EntityType,
        entityId: correctionId,
        opType: OpType.Delete,
        payload: {},
      } satisfies OpIntent);
    },
  };
}

export function createAiFeedbackActions(
  ctx: ActionContext,
  options: AiFeedbackActionsOptions = {},
): AiFeedbackActions {
  const newId = options.newId ?? (() => `aifb-${randomId()}`);

  return {
    async record(input) {
      // ── 校验：宁可抛错，也不要往偏好层喂脏数据 ──────────────────
      //
      // 🔴 为什么这里抛错而不是"静默丢掉"：
      // 一条 `appliedCount > proposedCount` 的记录会**静默**污染
      // P7「保留率」（它算出 > 1 的比例，而调用方不会看到任何异常）。
      // 偏好层"安静地算错"比它直接失败危险得多 ——
      // 因为算出来的结果会被展示给用户，看起来还很合理。
      if (!VALID_FEATURES.includes(input.feature)) {
        throw new Error(`未知的 AI 功能「${input.feature}」，无法记录反馈`);
      }
      if (!VALID_OUTCOMES.includes(input.outcome)) {
        throw new Error(`未知的反馈结果「${String(input.outcome)}」`);
      }
      if (!isNonNegativeInt(input.proposedCount) || !isNonNegativeInt(input.appliedCount)) {
        throw new Error('反馈项数必须是非负整数');
      }
      if (input.proposedCount > MAX_ITEMS || input.appliedCount > MAX_ITEMS) {
        throw new Error(`反馈项数超出上限 ${String(MAX_ITEMS)}`);
      }
      if (input.appliedCount > input.proposedCount) {
        throw new Error(
          `采用的项数（${String(input.appliedCount)}）不能多于提议的项数（${String(input.proposedCount)}）`,
        );
      }
      // 三态与计数必须自洽 —— 防止调用点"声称采用、实际一项没要"。
      if (input.outcome === 'rejected' && input.appliedCount !== 0) {
        throw new Error('拒绝的反馈，采用项数必须是 0');
      }
      if (input.outcome === 'accepted' && input.appliedCount !== input.proposedCount) {
        throw new Error('「全部采用」的反馈，采用项数必须等于提议项数');
      }
      if (
        input.outcome === 'modified' &&
        (input.appliedCount === 0 || input.appliedCount === input.proposedCount)
      ) {
        throw new Error('「改后采用」的反馈，采用项数必须严格介于 0 与提议项数之间');
      }

      const entityId = newId();
      await ctx.dispatch({
        entityType: 'AI_FEEDBACK' as EntityType,
        entityId,
        opType: OpType.Create,
        payload: {
          feature: input.feature,
          outcome: input.outcome,
          proposedCount: input.proposedCount,
          appliedCount: input.appliedCount,
        },
      } satisfies OpIntent);
      return entityId;
    },
  };
}
