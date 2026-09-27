/**
 * 「估时依据」在英文界面里不许露中文
 * ====================================
 *
 * ## 这是一个真实缺陷（不是预防性测试）
 *
 * `AiDuration.tsx` 的"估时依据"列表直接渲染了 `{hint.summary}` ——
 * 而 `PreferenceHint.summary` 的注释写着它是**中文投影**
 *（`packages/domain/src/preference-hints.ts`）。同一份注释在 `facts` 上写着：
 *
 * > 🔴 结构化事实。**壳必须用这个取自己的词条**，不要渲染 `summary`
 * > —— 那是领域层拼好的中文，英文界面会露中文。
 *
 * `MemoryPanel.tsx` 早就做对了（`preferenceEvidenceCopy(preference.evidenceFacts, t)`），
 * 而 `AiDuration` 漏了。`check:ui-language` 扫不到它：那里渲染的是变量，
 * 不是字面量。
 *
 * ## 为什么旧的测试全绿
 *
 * 现有 spec 里带 `preferenceSet` 的用例**全部走默认中文渲染** ——
 * 中文渲染下"渲染 summary"和"渲染词条"看起来都对。所以必须有一条
 * **按语言渲染、按语言断言**的测试。
 *
 * ## 为什么断言写死到词条，而不是断言"没有汉字"
 *
 * 只断言 `not.toMatch(CJK)` 的话，把这一块整个删掉也能绿。
 * 所以每条依据都断言**逐字等于对应语言的词条**，并且**不等于**夹具里
 * 那份中文 `evidence` —— 后者才直接钉住"没有渲染领域层的句子"。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider, translate, type Locale, type MessageKey } from '@heyta/i18n';
import type { AiFeature, AiRoutingConfig, SecretStore } from '@heyta/ai';
import type { PreferenceSet, Task } from '@heyta/domain';

const { AiDuration } = await import('../src/features/ai/AiDuration.js');
const { AiBreakdown } = await import('../src/features/ai/AiBreakdown.js');
const { AiCapture } = await import('../src/features/ai/AiCapture.js');
const { AiPrioritize } = await import('../src/features/ai/AiPrioritize.js');

const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF]/;

const EMPTY_SECRETS: SecretStore = { get: () => Promise.resolve(undefined) };

const LOCAL_ENDPOINT = {
  id: 'local',
  label: 'Local Ollama',
  endpoint: 'http://localhost:11434/v1',
  model: 'qwen3:8b',
  capabilities: ['structured_output', 'long_context'] as const,
};

function routingFor(feature: AiFeature): AiRoutingConfig {
  const routes: AiRoutingConfig['routes'] = {};
  routes[feature] = [{ endpointId: 'local' }];
  return {
    enabled: true,
    allowRemote: true,
    endpoints: [LOCAL_ENDPOINT],
    routes,
  };
}

/**
 * 记忆开着、两条估时用得上的偏好都有。
 *
 * ⚠️ `evidence` 刻意写成**一眼能认出来的中文整句** —— 断言里要证明它
 * **没有**被渲染出来。
 */
const PREFERENCE_SET: PreferenceSet = {
  memoryEnabled: true,
  estimateBias: {
    id: 'estimate-bias',
    value: 1.8,
    sampleSize: 30,
    confidence: 0.9,
    evidenceFacts: { kind: 'estimate-bias', multiplier: 1.8, samples: 30 },
    evidence: '【领域层拼好的中文】基于 30 次专注，你倾向低估任务耗时。',
  },
  deepWorkWindow: {
    id: 'deep-work-window',
    value: { startHour: 8, endHour: 11, concentration: 0.8 },
    sampleSize: 40,
    confidence: 0.9,
    evidenceFacts: {
      kind: 'deep-work-window',
      startHour: 8,
      endHour: 11,
      concentration: 0.8,
      samples: 40,
    },
    evidence: '【领域层拼好的中文】基于 40 次专注，80% 集中在 08:00–11:00。',
  },
  leadTime: null,
  granularity: null,
  titleStyle: null,
  withheld: [],
};

const TASK: Task = {
  id: 't1',
  title: 'Write the weekly report',
  note: 'Attach the numbers.',
  createdAt: 0,
  updatedAt: 0,
} as Task;

/** 两条依据在当前语言下**期望的**句子（写死词条，不从渲染结果回读）。 */
const EXPECTED: readonly {
  readonly testId: string;
  readonly key: MessageKey;
  readonly params: Record<string, string | number>;
}[] = [
  {
    testId: 'duration-basis-estimate-bias',
    key: 'web.memory.evidence.estimateBiasUnder',
    params: { samples: 30, multiplier: '1.80' },
  },
  {
    testId: 'duration-basis-deep-work-window',
    key: 'web.memory.evidence.deepWorkWindow',
    params: { samples: 40, percent: 80, from: '08:00', to: '11:00' },
  },
];

let root: Root | undefined;
let container: HTMLDivElement | undefined;

/** 渲染 `AiDuration` 并点进披露态（披露只算不发，同步即可）。 */
function renderDurationBasis(locale: Locale): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <I18nProvider locale={locale}>
        <AiDuration
          task={TASK}
          routing={routingFor('duration-estimate')}
          consents={[]}
          secrets={EMPTY_SECRETS}
          preferenceSet={PREFERENCE_SET}
          onApply={() => Promise.resolve()}
        />
      </I18nProvider>,
    );
  });
  act(() => {
    container?.querySelector<HTMLButtonElement>('[data-testid="duration-run-t1"]')?.click();
  });
  return container;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('🔴 估时依据按当前语言取词条（不是领域层的中文投影）', () => {
  it('中文：每条依据逐字等于 zh 词条', () => {
    const el = renderDurationBasis('zh-CN');
    for (const { testId, key, params } of EXPECTED) {
      const node = el.querySelector(`[data-testid="${testId}"]`);
      expect(node, `缺少 ${testId}`).toBeTruthy();
      expect(node?.textContent).toBe(translate('zh-CN', key, params));
    }
  });

  it('🔴 英文：每条依据逐字等于 en 词条，且整块一个汉字都没有', () => {
    const el = renderDurationBasis('en');
    const block = el.querySelector('[data-testid="duration-basis-preferences"]');
    expect(block, '有偏好就必须渲染依据').toBeTruthy();

    for (const { testId, key, params } of EXPECTED) {
      const node = el.querySelector(`[data-testid="${testId}"]`);
      expect(node, `缺少 ${testId}`).toBeTruthy();
      expect(node?.textContent).toBe(translate('en', key, params));
    }
    expect(CJK.test(block?.textContent ?? '')).toBe(false);
  });

  it('🔴 两种语言都不渲染领域层的 `evidence` 整句（那正是这个 bug 的形状）', () => {
    for (const locale of ['zh-CN', 'en'] as const) {
      const el = renderDurationBasis(locale);
      const text = el.querySelector('[data-testid="duration-basis-preferences"]')?.textContent ?? '';
      expect(text, `${locale} 渲染了领域层的中文投影`).not.toContain('【领域层拼好的中文】');
      act(() => {
        root?.unmount();
      });
      container?.remove();
      root = undefined;
      container = undefined;
    }
  });

  it('🔴 英文下整块依据区没有汉字（中文那条作为对照必须**有**汉字）', () => {
    const zh = renderDurationBasis('zh-CN');
    expect(CJK.test(zh.querySelector('[data-testid="duration-basis"]')?.textContent ?? '')).toBe(
      true,
    );
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = undefined;
    container = undefined;

    const en = renderDurationBasis('en');
    expect(CJK.test(en.querySelector('[data-testid="duration-basis"]')?.textContent ?? '')).toBe(
      false,
    );
  });
});

/**
 * 四个面板的英文披露态都不许出现汉字。
 *
 * ⚠️ 这条是**回归网**，不是本轮的缺陷本身：四个面板里只有 `AiDuration`
 * 有"依据"这一块，另外三个目前不渲染任何领域层句子。但它防的是同一类
 * 失效 —— 有人往披露里加一句跨包中文，门禁看不见（渲染的是变量）。
 */
describe('🔴 四个 AI 面板的英文披露态都不许露中文', () => {
  function renderPanel(locale: Locale, node: React.JSX.Element): HTMLDivElement {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(<I18nProvider locale={locale}>{node}</I18nProvider>);
    });
    return container;
  }

  it('捕获 / 拆解 / 排序 / 估时 —— 英文披露态 textContent 无汉字', () => {
    const cases: readonly { name: string; open: () => void; render: () => HTMLDivElement }[] = [
      {
        name: 'capture',
        render: () =>
          renderPanel('en', (
            <AiCapture
              text="Buy milk tomorrow"
              routing={routingFor('capture')}
              consents={[]}
              secrets={EMPTY_SECRETS}
              preferenceSet={PREFERENCE_SET}
              onApply={() => Promise.resolve()}
            />
          )),
        open: () => {
          container?.querySelector<HTMLButtonElement>('[data-testid="capture-ai"]')?.click();
        },
      },
      {
        name: 'breakdown',
        render: () =>
          renderPanel('en', (
            <AiBreakdown
              task={TASK}
              routing={routingFor('breakdown')}
              consents={[]}
              secrets={EMPTY_SECRETS}
              preferenceSet={PREFERENCE_SET}
              onApplyNote={() => Promise.resolve()}
            />
          )),
        open: () => {
          container?.querySelector<HTMLButtonElement>('[data-testid="ai-breakdown-t1"]')?.click();
        },
      },
      {
        name: 'prioritize',
        render: () =>
          renderPanel('en', (
            <AiPrioritize
              tasks={[TASK]}
              routing={routingFor('prioritize')}
              consents={[]}
              secrets={EMPTY_SECRETS}
              preferenceSet={PREFERENCE_SET}
              onApply={() => Promise.resolve()}
            />
          )),
        open: () => {
          container?.querySelector<HTMLButtonElement>('[data-testid="prioritize-open"]')?.click();
        },
      },
      {
        name: 'duration',
        render: () =>
          renderPanel('en', (
            <AiDuration
              task={TASK}
              routing={routingFor('duration-estimate')}
              consents={[]}
              secrets={EMPTY_SECRETS}
              preferenceSet={PREFERENCE_SET}
              onApply={() => Promise.resolve()}
            />
          )),
        open: () => {
          container?.querySelector<HTMLButtonElement>('[data-testid="duration-run-t1"]')?.click();
        },
      },
    ];

    for (const c of cases) {
      const el = c.render();
      act(() => {
        c.open();
      });
      const panel = el.querySelector('[role="dialog"]');
      expect(panel, `${c.name} 没有进入披露态`).toBeTruthy();
      const text = panel?.textContent ?? '';
      expect(CJK.test(text), `${c.name} 的英文披露态里出现汉字：${text}`).toBe(false);

      act(() => {
        root?.unmount();
      });
      container?.remove();
      root = undefined;
      container = undefined;
    }
  });
});
