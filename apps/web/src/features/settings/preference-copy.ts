/**
 * 偏好 → 词条
 * =============
 *
 * 🔴 这个文件和 `features/settings/health-copy.ts`、`features/sync/sync-failure-copy.ts`
 * 是同一个套路：**领域层给事实，外壳给句子**。
 *
 * 迁移前这里是三处跨包中文：
 *   - `preferenceLabel(id)` —— 领域层拼好的中文名（"估时偏差"）；
 *   - `preference.evidence` —— 领域层拼好的中文句子（"基于 12 次专注，…"）；
 *   - `withheld.detail` —— 同上（"你的用时波动太大，暂时算不出稳定的偏差系数"）。
 *
 * 壳把这些**整句**渲染出来，于是英文界面永远露中文。门禁扫不到 ——
 * 它查的是字面量，这里渲染的是变量。
 *
 * ⚠️ 第 14 轮之前，`preferenceLabel` 是唯一"合法"的例子（它有测试逐个核对
 * 不漏 `PreferenceId`）。现在改成壳里按 id 取词条，那份测试的价值变成了
 * **这条 `Record<PreferenceId, MessageKey>` 的编译期穷尽性**：漏一个编译不过。
 *
 * ⚠️ 数字的中性格式（`09:00`、天数几位小数）来自领域层的
 * `clockText` / `roundedDaysText`，**不在这里重写** —— 重写就是让两种语言
 * 的正字法各写一份，迟早一边写成 `9:00`。
 */

import type { PreferenceEvidence, PreferenceId, WithheldPreference } from '@heyta/domain';
import { clockText, roundedDaysText } from '@heyta/domain';
import type { I18nValue, MessageKey, MessageVars } from '@heyta/i18n';

type T = I18nValue['t'];

/** 偏好 id → 名字。**穷尽的**：新加一种偏好却忘了词条 → 编译报错。 */
export const PREFERENCE_LABEL_KEY: Record<PreferenceId, MessageKey> = {
  'estimate-bias': 'web.memory.pref.estimateBias',
  'deep-work-window': 'web.memory.pref.deepWorkWindow',
  'lead-time': 'web.memory.pref.leadTime',
  granularity: 'web.memory.pref.granularity',
  'title-style': 'web.memory.pref.titleStyle',
  'feedback-granularity': 'web.memory.pref.feedbackGranularity',
  'feedback-keep-ratio': 'web.memory.pref.feedbackKeepRatio',
};

/**
 * 偏好名。
 *
 * ⚠️ 未知 id **原样返回**：这是领域层 `preferenceLabel()` 从第一版就有的约定
 *（"至少不丢，便于排查"）。界面上出现 `feedback-keep-ratio` 难看，但
 * 出现空白更糟 —— 用户会以为这条偏好没有名字，而不是"程序不认识它"。
 */
export function preferenceLabelText(id: string, t: T): string {
  const key = (PREFERENCE_LABEL_KEY as Record<string, MessageKey | undefined>)[id];
  return key === undefined ? id : t(key);
}

/**
 * 「我还不了解你」的原因 → 句子。
 *
 * 🔴 第 15 轮把 `WithheldPreference.detail`（领域层拼好的 21 句中文）**整个删了** ——
 * 它只有一个消费者（记忆面板），是纯界面文案。现在领域层只给
 * `reason` + `id`（+ 只在需要时的 `remaining`）。
 *
 * 句子由 **(偏好 id, reason)** 两个维度决定 —— 中文里 "还没有{东西}" 这一层
 * 七个说法各不相同，所以是三张按 `PreferenceId` **穷尽**的表。
 * 漏一个成员 = 编译错误（而不是界面上少一句话）。
 */
const WITHHELD_NO_DATA_KEY: Record<PreferenceId, MessageKey> = {
  'estimate-bias': 'web.memory.withheld.noData.estimateBias',
  'deep-work-window': 'web.memory.withheld.noData.deepWorkWindow',
  'lead-time': 'web.memory.withheld.noData.leadTime',
  granularity: 'web.memory.withheld.noData.granularity',
  'title-style': 'web.memory.withheld.noData.titleStyle',
  'feedback-granularity': 'web.memory.withheld.noData.feedbackGranularity',
  'feedback-keep-ratio': 'web.memory.withheld.noData.feedbackKeepRatio',
};

const WITHHELD_SAMPLES_KEY: Record<PreferenceId, MessageKey> = {
  'estimate-bias': 'web.memory.withheld.notEnoughSamples.estimateBias',
  'deep-work-window': 'web.memory.withheld.notEnoughSamples.deepWorkWindow',
  'lead-time': 'web.memory.withheld.notEnoughSamples.leadTime',
  granularity: 'web.memory.withheld.notEnoughSamples.granularity',
  'title-style': 'web.memory.withheld.notEnoughSamples.titleStyle',
  'feedback-granularity': 'web.memory.withheld.notEnoughSamples.feedbackGranularity',
  'feedback-keep-ratio': 'web.memory.withheld.notEnoughSamples.feedbackKeepRatio',
};

const WITHHELD_UNSTABLE_KEY: Record<PreferenceId, MessageKey> = {
  'estimate-bias': 'web.memory.withheld.notStableEnough.estimateBias',
  'deep-work-window': 'web.memory.withheld.notStableEnough.deepWorkWindow',
  'lead-time': 'web.memory.withheld.notStableEnough.leadTime',
  granularity: 'web.memory.withheld.notStableEnough.granularity',
  'title-style': 'web.memory.withheld.notStableEnough.titleStyle',
  'feedback-granularity': 'web.memory.withheld.notStableEnough.feedbackGranularity',
  'feedback-keep-ratio': 'web.memory.withheld.notStableEnough.feedbackKeepRatio',
};

/**
 * 一条"扣下的偏好" → 词条 + 参数。
 *
 * `remaining` 只在 `not-enough-samples` 这一支存在（判别联合保证的），
 * 所以这里不会出现"忘了给数字 → 界面上说还需要 0 次"。
 */
export function withheldCopy(w: WithheldPreference): {
  key: MessageKey;
  params: MessageVars;
} {
  switch (w.reason) {
    case 'disabled':
      return { key: 'web.memory.withheld.disabled', params: {} };
    case 'no-data':
      return { key: WITHHELD_NO_DATA_KEY[w.id], params: {} };
    case 'not-enough-samples':
      return { key: WITHHELD_SAMPLES_KEY[w.id], params: { remaining: w.remaining } };
    case 'not-stable-enough':
      return { key: WITHHELD_UNSTABLE_KEY[w.id], params: {} };
  }
}
/** 「标题以什么语言为主」三档（`cjkShare` 的分档**在代码里**，是判据不是文案）。 */
const TITLE_STYLE_LANG_KEY: Record<'cjk' | 'latin' | 'mixed', MessageKey> = {
  cjk: 'web.memory.evidence.titleStyleLangZh',
  latin: 'web.memory.evidence.titleStyleLangEn',
  mixed: 'web.memory.evidence.titleStyleLangMixed',
};

/**
 * 事实 → 词条 + 参数。
 *
 * 分档（`>1.05`、`<=0.3`…）留在**代码**里：那是判据，不是文案；
 * 句子和数字的单位才进词条表。
 */
export function preferenceEvidenceCopy(
  facts: PreferenceEvidence,
  t: T,
): { key: MessageKey; params: MessageVars } {
  switch (facts.kind) {
    case 'estimate-bias': {
      const key: MessageKey =
        facts.multiplier > 1.05
          ? 'web.memory.evidence.estimateBiasUnder'
          : facts.multiplier < 0.95
            ? 'web.memory.evidence.estimateBiasOver'
            : 'web.memory.evidence.estimateBiasAccurate';
      return {
        key,
        params: { samples: facts.samples, multiplier: facts.multiplier.toFixed(2) },
      };
    }
    case 'deep-work-window':
      return {
        key: 'web.memory.evidence.deepWorkWindow',
        params: {
          samples: facts.samples,
          percent: Math.round(facts.concentration * 100),
          from: clockText(facts.startHour),
          to: clockText(facts.endHour),
        },
      };
    case 'lead-time': {
      const key: MessageKey =
        facts.days > 0.5
          ? 'web.memory.evidence.leadTimeAhead'
          : facts.days < -0.5
            ? 'web.memory.evidence.leadTimeLate'
            : 'web.memory.evidence.leadTimeOnTime';
      return { key, params: { samples: facts.samples, days: roundedDaysText(facts.days) } };
    }
    case 'granularity':
      return {
        key: 'web.memory.evidence.granularity',
        params: { samples: facts.samples, items: facts.items },
      };
    case 'title-style': {
      const lang: 'cjk' | 'latin' | 'mixed' =
        facts.cjkShare >= 0.8 ? 'cjk' : facts.cjkShare <= 0.2 ? 'latin' : 'mixed';
      return {
        key: 'web.memory.evidence.titleStyle',
        params: {
          samples: facts.samples,
          median: Math.round(facts.medianTitleLength),
          // 嵌套取词条：`lang` 参数本身也是**要翻译的**（"以中文为主" / "mostly Chinese"）。
          lang: t(TITLE_STYLE_LANG_KEY[lang]),
          emoji: facts.emojiShare >= 0.2 ? t('web.memory.evidence.titleStyleEmoji') : '',
        },
      };
    }
    case 'feedback-granularity':
      return {
        key: 'web.memory.evidence.feedbackGranularity',
        params: { adopted: facts.adopted, items: facts.items },
      };
    case 'feedback-keep-ratio': {
      const key: MessageKey =
        facts.ratio >= 0.9
          ? 'web.memory.evidence.feedbackKeepRatioAlmostAll'
          : facts.ratio <= 0.3
            ? 'web.memory.evidence.feedbackKeepRatioTrimmed'
            : 'web.memory.evidence.feedbackKeepRatioPartial';
      return {
        key,
        params: { adopted: facts.adopted, percent: Math.round(facts.ratio * 100) },
      };
    }
  }
}