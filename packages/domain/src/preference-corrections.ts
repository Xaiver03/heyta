/**
 * 应用用户对偏好的**纠正**
 * ==========================
 *
 * ## 为什么纠正必须单独记录
 *
 * 偏好是**推断**的，所以它一定会错。而 `applyOperation` 只认 op-log 里
 * 发生过的事实 —— "用户认为这条推断是错的"**推不出来**，只能显式记。
 *
 * 不记的后果很具体：用户每次打开设置都要再删一遍同一条错的偏好，
 * 而"删了又回来"会让整个记忆层显得不可信 —— 一旦用户不信它，
 * 他就不会打开这个开关，那这一层就白做了。
 *
 * ## 「抑制」与「还没算出来」是两件事
 *
 * 这两种状态**不能合并**：
 *
 * | 状态 | 含义 | 该说的话 |
 * |---|---|---|
 * | `withheld` | 数据还不够，我还不知道你 | 「我还需要 N 次专注」 |
 * | `suppressed` | 你告诉我这条不对，我记住了 | 「你已忘记这条」 |
 *
 * 合并的话，用户会看到"我还需要 5 次专注"出现在一条他**刚刚亲手删掉**的
 * 偏好上 —— 那看起来就像系统没听见他说话。
 *
 * ## 纯函数
 *
 * 与 `preferences.ts` 同样的纪律：不读时钟、不读环境、零依赖。
 */

import type { PreferenceCorrectionKind } from './entities.js';
import type { PreferenceId, PreferenceSet } from './preferences.js';
import type { FeedbackPreferenceSet } from './ai-feedback.js';

/** 推断所需的最小字段集（结构化子集，便于测试）。 */
export interface PreferenceCorrectionRow {
  readonly preferenceId: string;
  readonly kind: PreferenceCorrectionKind;
  readonly deletedAt?: number;
}

/**
 * 从纠正记录里算出**当前被抑制**的偏好 id 集合。
 *
 * - 墓碑（`deletedAt`）不算 —— 删掉纠正记录 = 恢复那条偏好
 * - 非 `suppress` 的纠正目前不存在，但显式过滤掉，
 *   免得将来加"改成某个值"时它被误当成抑制
 */
export function suppressedPreferenceIds(
  corrections: readonly PreferenceCorrectionRow[],
): Set<string> {
  const suppressed = new Set<string>();
  for (const row of corrections) {
    if (row.deletedAt !== undefined) continue;
    if (row.kind !== 'suppress') continue;
    suppressed.add(row.preferenceId);
  }
  return suppressed;
}

/** 一条被抑制的偏好的说明（给界面用）。 */
export interface SuppressedPreference {
  readonly id: string;
  /** 这是哪条偏好的中文名，用于"你已忘记：XX"。 */
  readonly label: string;
}

/**
 * 偏好 id → 中文名。
 *
 * ⚠️ 这张表要**覆盖所有 `PreferenceId`**。漏一个的后果是界面上出现
 * `feedback-keep-ratio` 这样的内部标识 —— 用户看不懂，也就没法判断
 * 自己删掉的到底是什么。有测试逐个核对它不漏。
 */
const PREFERENCE_LABELS: Record<PreferenceId, string> = {
  'estimate-bias': '估时偏差',
  'deep-work-window': '高效时段',
  'lead-time': '完成提前量',
  granularity: '任务拆解粒度',
  'title-style': '表达习惯',
  'feedback-granularity': '采纳的拆解粒度',
  'feedback-keep-ratio': '建议保留比例',
};

/** 取偏好的中文名；未知 id 原样返回（至少不丢，便于排查）。 */
export function preferenceLabel(id: string): string {
  return (PREFERENCE_LABELS as Record<string, string | undefined>)[id] ?? id;
}

/** 所有偏好的 id（披露与界面遍历用）。 */
export function allPreferenceIds(): readonly PreferenceId[] {
  return Object.keys(PREFERENCE_LABELS) as PreferenceId[];
}

/**
 * 把抑制应用到第一批偏好集。
 *
 * **纯函数**：返回新对象，不改入参。
 */
export function applyPreferenceCorrections(
  set: PreferenceSet,
  suppressed: ReadonlySet<string>,
): PreferenceSet {
  if (suppressed.size === 0) return set;
  return {
    ...set,
    estimateBias: suppressed.has('estimate-bias') ? null : set.estimateBias,
    deepWorkWindow: suppressed.has('deep-work-window') ? null : set.deepWorkWindow,
    leadTime: suppressed.has('lead-time') ? null : set.leadTime,
    granularity: suppressed.has('granularity') ? null : set.granularity,
    titleStyle: suppressed.has('title-style') ? null : set.titleStyle,
    // 🔴 被抑制的偏好从 `withheld` 里**移除** —— 它不是"还不够了解你"。
    withheld: set.withheld.filter((w) => !suppressed.has(w.id)),
  };
}

/** 把抑制应用到反馈层偏好集。同样是纯函数。 */
export function applyFeedbackCorrections(
  set: FeedbackPreferenceSet,
  suppressed: ReadonlySet<string>,
): FeedbackPreferenceSet {
  if (suppressed.size === 0) return set;
  return {
    ...set,
    feedbackGranularity: suppressed.has('feedback-granularity') ? null : set.feedbackGranularity,
    keepRatio: suppressed.has('feedback-keep-ratio') ? null : set.keepRatio,
    withheld: set.withheld.filter((w) => !suppressed.has(w.id)),
  };
}

/** 当前有哪些偏好 id **确实算出来了**（用于判断"删得掉吗"）。 */
export function presentPreferenceIds(
  set: PreferenceSet,
  feedbackSet?: FeedbackPreferenceSet,
): string[] {
  const ids: string[] = [];
  if (set.estimateBias !== null) ids.push('estimate-bias');
  if (set.deepWorkWindow !== null) ids.push('deep-work-window');
  if (set.leadTime !== null) ids.push('lead-time');
  if (set.granularity !== null) ids.push('granularity');
  if (set.titleStyle !== null) ids.push('title-style');
  if (feedbackSet?.feedbackGranularity != null) ids.push('feedback-granularity');
  if (feedbackSet?.keepRatio != null) ids.push('feedback-keep-ratio');
  return ids;
}

/**
 * 列出"你已忘记"的偏好。
 *
 * 🔴 必须传**纠正之前**的推断结果（`raw`）。
 * 传纠正之后的集合会永远返回空 —— 被抑制的偏好已经不在里面了，
 * 于是界面上"你已忘记：XX"永远不会出现，用户无法恢复。
 * 这个错误我在第一版里就犯了，测试当场抓到。
 */
export function describeSuppressed(
  rawPresent: readonly string[],
  suppressed: ReadonlySet<string>,
): SuppressedPreference[] {
  const out: SuppressedPreference[] = [];
  for (const id of rawPresent) {
    if (suppressed.has(id)) out.push({ id, label: preferenceLabel(id) });
  }
  return out;
}
