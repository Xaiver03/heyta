/**
 * AI 披露共享模型测试
 * ====================
 *
 * 🔴 这里钉住的是**跨面板一致性的判据本身**：
 *   · testid 拼法（改一个字就会让 web 的 6000 行定位钩子同时失效）；
 *   · "给定一个 target，必须披露哪些维度"（尤其 fallbacks / e2ee-warning）；
 *   · `disclosureParityGaps()` 能抓出"某个入口漏了一维"。
 *
 * ⚠️ 这里**不 render 组件**（本包测试是 node 环境，见 `vitest.config.ts`）。
 * 组件树渲染对不对，判据是 web 的集成测试与三个平台的实际渲染。
 */

import { describe, expect, it } from 'vitest';

import {
  AI_DISCLOSURE_DIMENSIONS,
  aiDisclosureTestIds,
  disclosureParityGaps,
  requiredDisclosureDimensions,
  toAiDisclosureViewModel,
  type AiDisclosureTarget,
  type AiDisclosureViewModel,
} from '../src/ai/model.js';

const LOCAL: AiDisclosureTarget = {
  label: '本机 Ollama',
  endpoint: 'http://localhost:11434/v1',
  model: 'qwen3:8b',
  isLocal: true,
  fallbacks: [],
};

const REMOTE_WITH_FALLBACK: AiDisclosureTarget = {
  label: '云端供应商',
  endpoint: 'https://api.example.com/v1',
  model: 'some-model',
  isLocal: false,
  fallbacks: ['备用云端', '另一家公司'],
};

describe('aiDisclosureTestIds', () => {
  it('🔴 拼出来的 testid 与改造前逐字一致（五个前缀各验一遍）', () => {
    expect(aiDisclosureTestIds('ai-')).toEqual({
      destination: 'ai-destination',
      destinationKind: 'ai-destination-kind',
      fallbacks: 'ai-fallbacks',
      fallbackList: 'ai-fallback-list',
      retention: 'ai-retention',
      retentionText: 'ai-retention-text',
      fields: 'ai-fields',
      fieldList: 'ai-field-list',
      e2eeWarning: 'ai-e2ee-warning',
    });
    expect(aiDisclosureTestIds('prioritize-').fieldList).toBe('prioritize-field-list');
    expect(aiDisclosureTestIds('duration-').fallbackList).toBe('duration-fallback-list');
    expect(aiDisclosureTestIds('capture-').retentionText).toBe('capture-retention-text');
    expect(aiDisclosureTestIds('ai-tool-').e2eeWarning).toBe('ai-tool-e2ee-warning');
  });
});

describe('requiredDisclosureDimensions', () => {
  it('🔴 远端 + 有回退 → 五维全在（回退链与 E2EE 都必须在）', () => {
    expect(requiredDisclosureDimensions(REMOTE_WITH_FALLBACK)).toEqual([
      'destination',
      'fallbacks',
      'retention',
      'fields',
      'e2ee-warning',
    ]);
  });

  it('本机 + 无回退 → 不回退就不披露回退链，本机不出现 E2EE 警告', () => {
    expect(requiredDisclosureDimensions(LOCAL)).toEqual(['destination', 'retention', 'fields']);
  });

  it('远端 + 无回退 → 有 E2EE 警告，但没有回退链（不制造噪音）', () => {
    expect(requiredDisclosureDimensions({ ...REMOTE_WITH_FALLBACK, fallbacks: [] })).toEqual([
      'destination',
      'retention',
      'fields',
      'e2ee-warning',
    ]);
  });

  it('维度集合是 AI_DISCLOSURE_DIMENSIONS 的子集（没有拼错的名字）', () => {
    const allowed = new Set<string>(AI_DISCLOSURE_DIMENSIONS);
    for (const dim of requiredDisclosureDimensions(REMOTE_WITH_FALLBACK)) {
      expect(allowed.has(dim)).toBe(true);
    }
  });
});

describe('toAiDisclosureViewModel', () => {
  it('用宿主给的分隔符拼字段与回退链（中英标点不同）', () => {
    const view = toAiDisclosureViewModel({
      target: REMOTE_WITH_FALLBACK,
      fields: ['title', 'note'],
      retentionText: '保留策略由你的端点决定',
      separator: '、',
    });
    expect(view.fieldsText).toBe('title、note');
    expect(view.fallbackText).toBe('备用云端、另一家公司');
    expect(view.retentionText).toBe('保留策略由你的端点决定');
    expect(view.dimensions).toEqual(requiredDisclosureDimensions(REMOTE_WITH_FALLBACK));
  });

  it('保留策略未定案（undefined）时 retentionText 保持 undefined —— 不是空串', () => {
    const view = toAiDisclosureViewModel({
      target: LOCAL,
      fields: ['title'],
      retentionText: undefined,
      separator: ', ',
    });
    expect(view.retentionText).toBeUndefined();
    // 字段永远逐项列出 —— 即使只有一个，也不合并、不省略。
    expect(view.fieldsText).toBe('title');
    expect(view.dimensions).toEqual(['destination', 'retention', 'fields']);
  });

  it('target.fallbacks 被拷贝，之后改原数组不影响视图', () => {
    const fallbacks = ['A'];
    const view = toAiDisclosureViewModel({
      target: { ...REMOTE_WITH_FALLBACK, fallbacks },
      fields: [],
      retentionText: undefined,
      separator: ', ',
    });
    expect(view.fallbacks).toEqual(['A']);
  });
});

describe('disclosureParityGaps', () => {
  const base = toAiDisclosureViewModel({
    target: REMOTE_WITH_FALLBACK,
    fields: ['tools'],
    retentionText: '未定案',
    separator: ', ',
  });

  it('🔴 五个入口视图相同 → 没有缺口', () => {
    expect(disclosureParityGaps([base, base, base, base, base])).toEqual([]);
  });

  it('🔴 复现修复前 AiToolRun 的漂移：缺 fallbacks 与 e2ee-warning 时必须报出来', () => {
    const drifted: AiDisclosureViewModel = {
      ...base,
      dimensions: ['destination', 'retention', 'fields'],
    };
    expect(disclosureParityGaps([base, base, base, base, drifted])).toEqual([
      'fallbacks',
      'e2ee-warning',
    ]);
  });

  it('空输入 → 空（没有可比较的对象，不编造缺口）', () => {
    expect(disclosureParityGaps([])).toEqual([]);
  });
});
