/**
 * 偏好文案：名字 + 依据
 * ======================
 *
 * 🔴 这个文件存在的理由：**领域层拼好的中文被两个壳整句渲染**，
 * 而门禁扫不到（它查的是字面量，这里渲染的是变量）。
 * 迁移前 `preference.evidence` / `preferenceLabel(id)` / `hint.summary`
 * 都是**跨包中文**，英文界面里它们永远露中文。
 *
 * 现在领域层给**结构化事实**（`PreferenceEvidence`），壳给句子。
 * 这个文件钉住三件事：
 *
 *   1. **每一种事实都有中英两句**，英文里一个汉字都没有；
 *   2. **每种偏好都有名字**，未知 id 原样返回（不变成空白）；
 *   3. 🔴 **中文词条逐字等于领域层的投影** —— 这是这个测试最要紧的一条。
 *
 * 第 3 条为什么必要：中文句子现在有**两份**（领域层 `preferenceEvidenceText()`
 * 是给领域测试和非界面消费者用的投影，词条表是给界面用的）。
 * 两份就是两个可能漂移的地方。与其写注释提醒下一个人"记得同步"，
 * 不如让漂移**必然变红**：这里逐字比对。领域那边自己的测试也在钉同一批句子，
 * 所以漂移会从两个方向各红一次。
 */

import { describe, expect, it } from 'vitest';

import { translate } from '@heyta/i18n';
import {
  allPreferenceIds,
  preferenceEvidenceText,
  preferenceLabel,
  type PreferenceEvidence,
  type WithheldPreference,
} from '@heyta/domain';

import {
  preferenceEvidenceCopy,
  preferenceLabelText,
  withheldCopy,
} from '../src/features/settings/preference-copy.js';

/** 每种语言各绑定一份取词函数。 */
const zh = translate.bind(null, 'zh-CN');
const en = translate.bind(null, 'en');

/** 一个汉字都没有，说明英文词条没有被写回中文。 */
const CJK = /[\u4E00-\u9FFF]/;

/**
 * 覆盖**每一个分支**的事实样本。
 *
 * `estimate-bias` / `lead-time` / `feedback-keep-ratio` 各有三档措辞，
 * `title-style` 有三档语言判断，所以这里每种都给了跨档的样本 ——
 * 只给一个样本的话，另外两档的英文漏翻译了也不会红。
 */
const CASES: readonly PreferenceEvidence[] = [
  { kind: 'estimate-bias', multiplier: 1.8, samples: 12 },
  { kind: 'estimate-bias', multiplier: 0.7, samples: 9 },
  { kind: 'estimate-bias', multiplier: 1, samples: 20 },
  { kind: 'deep-work-window', startHour: 9, endHour: 12, concentration: 0.63, samples: 15 },
  { kind: 'lead-time', days: 2.4, samples: 11 },
  { kind: 'lead-time', days: -1.6, samples: 11 },
  { kind: 'lead-time', days: 0.2, samples: 11 },
  { kind: 'granularity', items: 5, samples: 12 },
  { kind: 'title-style', cjkShare: 0.95, medianTitleLength: 14, emojiShare: 0, samples: 30 },
  { kind: 'title-style', cjkShare: 0.05, medianTitleLength: 8, emojiShare: 0.5, samples: 30 },
  { kind: 'title-style', cjkShare: 0.5, medianTitleLength: 10, emojiShare: 0.1, samples: 30 },
  { kind: 'feedback-granularity', items: 4, adopted: 6 },
  { kind: 'feedback-keep-ratio', ratio: 0.95, adopted: 7 },
  { kind: 'feedback-keep-ratio', ratio: 0.2, adopted: 7 },
  { kind: 'feedback-keep-ratio', ratio: 0.6, adopted: 7 },
];

describe('偏好名字', () => {
  it('🔴 每一种偏好都有名字，且 zh 与领域层 `preferenceLabel()` **逐字一致**', () => {
    for (const id of allPreferenceIds()) {
      expect(preferenceLabelText(id, zh)).toBe(preferenceLabel(id));
      // 英文里不许有汉字，而且必须真的和中文不同（不是把中文抄过去）
      expect(preferenceLabelText(id, en)).not.toMatch(CJK);
      expect(preferenceLabelText(id, en)).not.toBe(preferenceLabelText(id, zh));
    }
  });

  it('未知 id 原样返回 —— 领域层从第一版就有的约定（不丢，便于排查）', () => {
    // 空白比"难看的 id"更糟：用户会以为这条偏好没有名字。
    expect(preferenceLabelText('feedback-keep-ratio', zh)).toBe('建议保留比例');
    expect(preferenceLabelText('something-new', zh)).toBe('something-new');
    expect(preferenceLabelText('something-new', en)).toBe('something-new');
  });
});

describe('偏好依据（事实 → 句子）', () => {
  it('🔴 zh 词条渲染结果**逐字等于**领域层投影 —— 两份中文漂移必红', () => {
    for (const facts of CASES) {
      const copy = preferenceEvidenceCopy(facts, zh);
      expect(zh(copy.key, copy.params), `${facts.kind} 的 zh 词条与领域投影不一致`).toBe(
        preferenceEvidenceText(facts),
      );
    }
  });

  it('每一种事实在英文下都没有汉字，且与中文不同', () => {
    for (const facts of CASES) {
      const zhCopy = preferenceEvidenceCopy(facts, zh);
      const enCopy = preferenceEvidenceCopy(facts, en);
      const zhText = zh(zhCopy.key, zhCopy.params);
      const enText = en(enCopy.key, enCopy.params);

      expect(enText, `${facts.kind} 的英文里漏出了汉字`).not.toMatch(CJK);
      expect(enText, `${facts.kind} 的英文等于中文（等于没翻译）`).not.toBe(zhText);
    }
  });

  it('🔴 事实里的数字必须出现在句子里 —— 否则等于把数字丢了', () => {
    // 这一条是"事实真的是真源"的正面证明：改数字，句子必须跟着变。
    const a = preferenceEvidenceCopy({ kind: 'granularity', items: 5, samples: 12 }, en);
    const b = preferenceEvidenceCopy({ kind: 'granularity', items: 9, samples: 40 }, en);
    expect(en(a.key, a.params)).toContain('12');
    expect(en(a.key, a.params)).toContain('5');
    expect(en(b.key, b.params)).toContain('40');
    expect(en(b.key, b.params)).toContain('9');
    expect(en(a.key, a.params)).not.toBe(en(b.key, b.params));
  });
});

describe('「还不了解」的原因（第 15 轮从领域层搬来的）', () => {
  /**
   * 全部 (偏好, 原因) 组合 —— 7 × 3 = 21。
   *
   * `remaining` 只在 `not-enough-samples` 那一支给：判别联合让"这类原因
   * 忘了带数字"**编译不过**，所以这里不需要再造一个"缺数字"的样本。
   */
  const ALL: readonly WithheldPreference[] = allPreferenceIds().flatMap((id) => [
    { id, reason: 'no-data' } as const,
    { id, reason: 'not-stable-enough' } as const,
    { id, reason: 'not-enough-samples', remaining: 3 } as const,
  ]);

  it('🔴 21 种组合每一条都有中英两句，英文里没有汉字且与中文不同', () => {
    expect(ALL).toHaveLength(21);
    for (const w of ALL) {
      const { key, params } = withheldCopy(w);
      const zhText = zh(key, params);
      const enText = en(key, params);
      const 什么 = `${w.id} / ${w.reason}`;
      expect(zhText, `${什么}：中文是空的`).not.toBe('');
      expect(CJK.test(enText), `${什么}：英文里出现汉字「${enText}」`).toBe(false);
      expect(enText, `${什么}：中英一模一样`).not.toBe(zhText);
    }
  });

  it('"还差几条"的数字真的进了句子（不是把模板原样吐出来）', () => {
    const { key, params } = withheldCopy({
      id: 'granularity',
      reason: 'not-enough-samples',
      remaining: 4,
    });
    expect(zh(key, params)).toContain('4');
    expect(zh(key, params)).not.toContain('{remaining}');
    expect(en(key, params)).toContain('4');
    expect(en(key, params)).not.toContain('{remaining}');
  });

  /*
   * 🔴 这一条是**搬家的收据**：下面这些中文是它们在 `packages/domain` 里
   * 的原话（第 15 轮之前写死在 21 个 `detail:` 里）。
   * 搬家不许改字 —— 改了的话，中文界面会悄悄变样而没人知道。
   * 只挑三条有代表性的：带书名号的那句、带数字的那句、最短的那句。
   */
  it('中文措辞与搬走之前**逐字一致**', () => {
    const leadTime = withheldCopy({ id: 'lead-time', reason: 'no-data' });
    expect(zh(leadTime.key, leadTime.params)).toBe('还没有「有截止日期且已完成」的任务');

    const samples = withheldCopy({
      id: 'lead-time',
      reason: 'not-enough-samples',
      remaining: 5,
    });
    expect(zh(samples.key, samples.params)).toBe('还需要 5 个已完成的有截止日期任务');

    const unstable = withheldCopy({ id: 'title-style', reason: 'not-stable-enough' });
    expect(zh(unstable.key, unstable.params)).toBe('你的标题长度差异很大，暂时算不出固定的表达习惯');
  });

  it('`disabled` 也有话说（现在没有生产者，但类型里有这一支）', () => {
    const { key, params } = withheldCopy({ id: 'granularity', reason: 'disabled' });
    expect(zh(key, params)).not.toBe('');
    expect(en(key, params)).not.toBe('');
    expect(en(key, params)).not.toMatch(CJK);
  });
});
