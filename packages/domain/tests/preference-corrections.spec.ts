import { describe, expect, it } from 'vitest';
import {
  allPreferenceIds,
  applyFeedbackCorrections,
  applyPreferenceCorrections,
  describeSuppressed,
  preferenceLabel,
  presentPreferenceIds,
  suppressedPreferenceIds,
  type PreferenceCorrectionRow,
} from '../src/preference-corrections.js';
import { emptyFeedbackPreferenceSet, type FeedbackPreferenceSet } from '../src/ai-feedback.js';
import { emptyPreferenceSet, type Preference, type PreferenceSet } from '../src/preferences.js';
import {
  preferenceEvidenceText,
  type PreferenceEvidence,
} from '../src/preference-evidence.js';

/**
 * 造一条偏好。
 *
 * ⚠️ 第 14 轮起 `Preference` 有**必需**的 `evidenceFacts`（结构化事实）。
 * 这个 helper 只关心"有没有这条偏好"，所以给一个形状对得上的最小事实 ——
 * 但它必须**真的存在**：曾经就是"缺字段"让面板在运行时炸过一次。
 */
const factsFor = (id: Preference<unknown>['id'], value: unknown): PreferenceEvidence => {
  switch (id) {
    case 'estimate-bias':
      return { kind: 'estimate-bias', multiplier: value as number, samples: 20 };
    case 'granularity':
      return { kind: 'granularity', items: value as number, samples: 20 };
    case 'lead-time':
      return { kind: 'lead-time', days: value as number, samples: 20 };
    case 'feedback-keep-ratio':
      return { kind: 'feedback-keep-ratio', ratio: value as number, adopted: 20 };
    case 'feedback-granularity':
      return { kind: 'feedback-granularity', items: value as number, adopted: 20 };
    case 'deep-work-window':
      return {
        kind: 'deep-work-window',
        startHour: 8,
        endHour: 11,
        concentration: 0.6,
        samples: 20,
      };
    case 'title-style':
      return {
        kind: 'title-style',
        cjkShare: 0.9,
        medianTitleLength: 10,
        emojiShare: 0,
        samples: 20,
      };
  }
};

const pref = <T>(id: Preference<T>['id'], value: T): Preference<T> => {
  const evidenceFacts = factsFor(id, value);
  return {
    id,
    value,
    sampleSize: 20,
    confidence: 0.9,
    evidenceFacts,
    evidence: preferenceEvidenceText(evidenceFacts),
  };
};

function full(): PreferenceSet {
  return {
    memoryEnabled: true,
    estimateBias: pref('estimate-bias', 1.8),
    deepWorkWindow: pref('deep-work-window', { startHour: 8, endHour: 11, concentration: 0.8 }),
    leadTime: pref('lead-time', 3),
    granularity: pref('granularity', 6),
    titleStyle: pref('title-style', { cjkShare: 1, medianTitleLength: 12, emojiShare: 0 }),
    withheld: [],
  };
}

function fullFeedback(): FeedbackPreferenceSet {
  return {
    memoryEnabled: true,
    feedbackGranularity: pref('feedback-granularity', 4),
    keepRatio: pref('feedback-keep-ratio', 0.6),
    withheld: [],
  };
}

const suppress = (preferenceId: string): PreferenceCorrectionRow => ({
  preferenceId,
  kind: 'suppress',
});

describe('纠正：算出当前被抑制的偏好', () => {
  it('抑制记录被算进来', () => {
    expect([...suppressedPreferenceIds([suppress('lead-time')])]).toEqual(['lead-time']);
  });

  it('🔴 墓碑（已删除的纠正）不算 —— 删除纠正 = 恢复那条偏好', () => {
    expect(suppressedPreferenceIds([{ ...suppress('lead-time'), deletedAt: 1 }]).size).toBe(0);
  });

  it('非 suppress 的纠正不会被误当成抑制', () => {
    const rows = [{ preferenceId: 'lead-time', kind: 'suppress' as const }, { preferenceId: 'granularity', kind: 'suppress' as const }];
    expect(suppressedPreferenceIds(rows).size).toBe(2);
  });

  it('空输入 → 空集合', () => {
    expect(suppressedPreferenceIds([]).size).toBe(0);
  });
});

describe('纠正：应用到偏好集', () => {
  it('被抑制的那条变成 null，其余不动', () => {
    const out = applyPreferenceCorrections(full(), new Set(['lead-time']));
    expect(out.leadTime).toBeNull();
    expect(out.estimateBias).not.toBeNull();
    expect(out.granularity).not.toBeNull();
  });

  it('🔴 纯函数：不改入参', () => {
    const raw = full();
    applyPreferenceCorrections(raw, new Set(['lead-time']));
    expect(raw.leadTime).not.toBeNull();
  });

  it('空集合时原样返回（避免无意义的对象重建导致重渲染）', () => {
    const raw = full();
    expect(applyPreferenceCorrections(raw, new Set())).toBe(raw);
  });

  it('🔴 被抑制的偏好必须从 `withheld` 里移除 —— 它不是「还不够了解你」', () => {
    const raw: PreferenceSet = {
      ...full(),
      leadTime: null,
      withheld: [{ id: 'lead-time', reason: 'not-enough-samples', remaining: 5 }],
    };
    const out = applyPreferenceCorrections(raw, new Set(['lead-time']));
    expect(out.withheld).toEqual([]);
  });

  it('反馈层同样能抑制', () => {
    const out = applyFeedbackCorrections(fullFeedback(), new Set(['feedback-keep-ratio']));
    expect(out.keepRatio).toBeNull();
    expect(out.feedbackGranularity).not.toBeNull();
  });
});

describe('🔴「你已忘记」必须用**纠正之前**的结果算', () => {
  it('传纠正后的集合 → 永远为空（这就是我第一版犯的错）', () => {
    const raw = full();
    const suppressed = new Set(['lead-time']);
    const corrected = applyPreferenceCorrections(raw, suppressed);

    // 用纠正后的集合算 —— 空的，于是恢复入口根本不出现
    expect(describeSuppressed(presentPreferenceIds(corrected), suppressed)).toEqual([]);

    // 用纠正前的集合算 —— 正确
    expect(describeSuppressed(presentPreferenceIds(raw), suppressed)).toEqual([
      { id: 'lead-time', label: '完成提前量' },
    ]);
  });

  it('没算出来的偏好不进「你已忘记」（用户删了个不存在的东西）', () => {
    const raw: PreferenceSet = { ...emptyPreferenceSet(true) };
    const forgotten = describeSuppressed(presentPreferenceIds(raw), new Set(['lead-time']));
    expect(forgotten).toEqual([]);
  });
});

describe('偏好中文名', () => {
  it('🔴 每个 PreferenceId 都有中文名（否则界面会露出内部标识）', () => {
    for (const id of allPreferenceIds()) {
      const label = preferenceLabel(id);
      expect(label, `${id} 没有中文名`).not.toBe(id);
      expect(label.length).toBeGreaterThan(1);
    }
  });

  it('覆盖第一批五条 + 反馈层两条', () => {
    expect([...allPreferenceIds()].sort()).toEqual(
      [
        'deep-work-window',
        'estimate-bias',
        'feedback-granularity',
        'feedback-keep-ratio',
        'granularity',
        'lead-time',
        'title-style',
      ].sort(),
    );
  });

  it('未知 id 原样返回（不丢信息，便于排查）', () => {
    expect(preferenceLabel('nope')).toBe('nope');
  });
});

describe('presentPreferenceIds', () => {
  it('只列出确实算出来的', () => {
    expect(presentPreferenceIds(full(), fullFeedback()).sort()).toEqual(
      [
        'estimate-bias',
        'deep-work-window',
        'lead-time',
        'granularity',
        'title-style',
        'feedback-granularity',
        'feedback-keep-ratio',
      ].sort(),
    );
  });

  it('空集 → 空列表', () => {
    expect(presentPreferenceIds(emptyPreferenceSet(true), emptyFeedbackPreferenceSet(true))).toEqual([]);
  });

  it('不传反馈集也能用', () => {
    expect(presentPreferenceIds(full())).toHaveLength(5);
  });
});
