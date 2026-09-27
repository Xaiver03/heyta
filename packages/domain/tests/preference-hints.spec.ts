import { describe, expect, it } from 'vitest';
import {
  renderHintBlock,
  renderPreferenceHints,
  relevantPreferenceIds,
  type PreferenceRelevance,
} from '../src/preference-hints.js';
import {
  emptyPreferenceSet,
  type Preference,
  type PreferenceSet,
} from '../src/preferences.js';
import {
  preferenceEvidenceText,
  type PreferenceEvidence,
} from '../src/preference-evidence.js';

/**
 * 造一条偏好（字段齐全）。
 *
 * ⚠️ 第 14 轮起 `evidenceFacts` 是**必需**字段：壳按它取词条，
 * 不再渲染 `evidence`（那是领域层拼好的中文）。
 * 这里传入真实事实，`evidence` 由投影派生 —— 手写一句的话，
 * 这个 fixture 的形状和真货就不一样了。
 */
function pref<T>(id: Preference<T>['id'], value: T, facts: PreferenceEvidence): Preference<T> {
  return {
    id,
    value,
    sampleSize: 30,
    confidence: 0.9,
    evidenceFacts: facts,
    evidence: preferenceEvidenceText(facts),
  };
}

/** 全部偏好都有的开关打开状态。 */
function full(): PreferenceSet {
  return {
    memoryEnabled: true,
    estimateBias: pref('estimate-bias', 1.8, {
      kind: 'estimate-bias',
      multiplier: 1.8,
      samples: 30,
    }),
    deepWorkWindow: pref(
      'deep-work-window',
      { startHour: 8, endHour: 11, concentration: 0.8 },
      { kind: 'deep-work-window', startHour: 8, endHour: 11, concentration: 0.8, samples: 30 },
    ),
    leadTime: pref('lead-time', 3, { kind: 'lead-time', days: 3, samples: 30 }),
    granularity: pref('granularity', 6, { kind: 'granularity', items: 6, samples: 30 }),
    titleStyle: pref(
      'title-style',
      { cjkShare: 1, medianTitleLength: 12, emojiShare: 0 },
      { kind: 'title-style', cjkShare: 1, medianTitleLength: 12, emojiShare: 0, samples: 30 },
    ),
    withheld: [],
  };
}

describe('偏好提示：主开关是唯一入口', () => {
  it('🔴 关闭时，**任何用途**都产出空数组', () => {
    const off: PreferenceSet = { ...full(), memoryEnabled: false };
    const all: PreferenceRelevance[] = ['breakdown', 'capture', 'prioritize', 'duration-estimate'];
    for (const r of all) {
      expect(renderPreferenceHints(off, r)).toEqual([]);
    }
  });

  it('关闭时没有偏好值的来源 —— 即使用空集也不报错', () => {
    expect(renderPreferenceHints(emptyPreferenceSet(true), 'breakdown')).toEqual([]);
  });
});

describe('偏好提示：最小化出境面（按用途过滤）', () => {
  it('拆解只带 粒度 / 风格 / 估算偏差', () => {
    const ids = renderPreferenceHints(full(), 'breakdown').map((h) => h.id);
    expect(ids).toEqual(['granularity', 'title-style', 'estimate-bias']);
  });

  it('🔴 拆解**不带**时段与提前量（它们对拆解没用，多带就是多泄露）', () => {
    const ids = renderPreferenceHints(full(), 'breakdown').map((h) => h.id);
    expect(ids).not.toContain('deep-work-window');
    expect(ids).not.toContain('lead-time');
  });

  it('捕获只带风格（只是补全一个标题）', () => {
    expect(renderPreferenceHints(full(), 'capture').map((h) => h.id)).toEqual(['title-style']);
  });

  it('排序带提前量与时段', () => {
    expect(renderPreferenceHints(full(), 'prioritize').map((h) => h.id)).toEqual([
      'lead-time',
      'deep-work-window',
    ]);
  });

  it('估时带偏差与时段', () => {
    expect(renderPreferenceHints(full(), 'duration-estimate').map((h) => h.id)).toEqual([
      'estimate-bias',
      'deep-work-window',
    ]);
  });

  it('relevantPreferenceIds 与 renderPreferenceHints 的取值域一致', () => {
    const all: PreferenceRelevance[] = ['breakdown', 'capture', 'prioritize', 'duration-estimate'];
    for (const r of all) {
      const produced = renderPreferenceHints(full(), r).map((h) => h.id);
      for (const id of produced) {
        expect(relevantPreferenceIds(r)).toContain(id);
      }
    }
  });
});

describe('偏好提示：没推断出来的偏好不许出现', () => {
  it('null 的偏好被跳过（不拿"平均用户"凑数）', () => {
    const partial: PreferenceSet = { ...full(), granularity: null, titleStyle: null };
    expect(renderPreferenceHints(partial, 'breakdown').map((h) => h.id)).toEqual(['estimate-bias']);
  });

  it('全为 null 时返回空数组', () => {
    const none: PreferenceSet = { ...emptyPreferenceSet(true) };
    expect(renderPreferenceHints(none, 'breakdown')).toEqual([]);
    expect(renderHintBlock([])).toBe('');
  });
});

describe('偏好提示：措辞', () => {
  const textOf = (set: PreferenceSet, r: PreferenceRelevance, id: string): string | undefined =>
    renderPreferenceHints(set, r).find((h) => h.id === id)?.text;

  it('低估用「放大」，高估用「收紧」，接近 1 说「很准」', () => {
    const low = { ...full(), estimateBias: pref('estimate-bias', 1.8, { kind: 'estimate-bias', multiplier: 1.8, samples: 30 }) };
    const high = { ...full(), estimateBias: pref('estimate-bias', 0.6, { kind: 'estimate-bias', multiplier: 0.6, samples: 30 }) };
    const exact = { ...full(), estimateBias: pref('estimate-bias', 1.0, { kind: 'estimate-bias', multiplier: 1, samples: 30 }) };
    expect(textOf(low, 'breakdown', 'estimate-bias')).toContain('放大');
    expect(textOf(high, 'breakdown', 'estimate-bias')).toContain('收紧');
    expect(textOf(exact, 'breakdown', 'estimate-bias')).toContain('很准');
  });

  it('提前量：提前 / 逾期 / 踩点 三种措辞分开', () => {
    const early = { ...full(), leadTime: pref('lead-time', 3, { kind: 'lead-time', days: 3, samples: 30 }) };
    const late = { ...full(), leadTime: pref('lead-time', -2, { kind: 'lead-time', days: -2, samples: 30 }) };
    const onTime = { ...full(), leadTime: pref('lead-time', 0, { kind: 'lead-time', days: 0, samples: 30 }) };
    expect(textOf(early, 'prioritize', 'lead-time')).toContain('提前 3 天');
    expect(textOf(late, 'prioritize', 'lead-time')).toContain('逾期');
    expect(textOf(onTime, 'prioritize', 'lead-time')).toContain('截止当天');
  });

  it('🔴 时段补零（8 点必须写成 08:00，不能是 8:00）', () => {
    const t = textOf(full(), 'prioritize', 'deep-work-window');
    expect(t).toContain('08:00–11:00');
  });

  it('风格：中文 / 英文 / 混用分别措辞，emoji 只在明显时提', () => {
    const cn = { ...full(), titleStyle: pref(
      'title-style',
      { cjkShare: 1, medianTitleLength: 12, emojiShare: 0 },
      { kind: 'title-style', cjkShare: 1, medianTitleLength: 12, emojiShare: 0, samples: 30 },
    ) };
    const en = { ...full(), titleStyle: pref(
      'title-style',
      { cjkShare: 0, medianTitleLength: 8, emojiShare: 0 },
      { kind: 'title-style', cjkShare: 0, medianTitleLength: 8, emojiShare: 0, samples: 30 },
    ) };
    const mix = { ...full(), titleStyle: pref(
      'title-style',
      { cjkShare: 0.5, medianTitleLength: 10, emojiShare: 0.5 },
      {
        kind: 'title-style',
        cjkShare: 0.5,
        medianTitleLength: 10,
        emojiShare: 0.5,
        samples: 30,
      },
    ) };
    expect(textOf(cn, 'capture', 'title-style')).toContain('中文');
    expect(textOf(en, 'capture', 'title-style')).toContain('英文');
    expect(textOf(mix, 'capture', 'title-style')).toContain('中英混用');
    expect(textOf(mix, 'capture', 'title-style')).toContain('emoji');
    expect(textOf(cn, 'capture', 'title-style')).not.toContain('emoji');
  });

  it('🔴 提示文本里**不含**样本量（那是给用户看的，不是给模型的）', () => {
    for (const hint of renderPreferenceHints(full(), 'breakdown')) {
      expect(hint.text).not.toContain('基于');
      // 而 summary 就是给用户看的 evidence，必须原样带上
      expect(hint.summary).toBeTruthy();
    }
  });
});

describe('偏好提示：确定性与拼装', () => {
  it('同样输入 → 同样的顺序与文本（prompt 可做字节级断言）', () => {
    const a = renderPreferenceHints(full(), 'breakdown');
    const b = renderPreferenceHints(full(), 'breakdown');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('renderHintBlock 拼成一段带标题的列表', () => {
    const block = renderHintBlock(renderPreferenceHints(full(), 'breakdown'));
    expect(block).toContain('历史习惯');
    expect(block.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(3);
  });
});
