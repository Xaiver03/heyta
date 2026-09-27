/**
 * 「没有可用端点」必须说出**真实原因**，并给一条真的能走的路
 * ==========================================================
 *
 * ## 钉住的是什么
 *
 * 四个 AI 面板各自调 `resolveRoute()`，但**只取 `candidates[0]`** ——
 * `resolution.excluded` 从头到尾没有任何读取点。于是候选全被排除时，
 * 界面永远说同一句「还没有给「X」配置端点」，而真实原因可能是：
 *
 *   - 端点全在设备外，而「允许远程端点」没开
 *   - 端点没声明这个功能需要的能力
 *   - 端点被停用 / 被熔断 / 地址非法 / 路由指向了不存在的端点
 *
 * 用户照着那句"去添加端点"做，是解决不了问题的。
 *
 * ## 为什么每个原因都要一条断言，而且要比**通用文案**
 *
 * "渲染出了某段文字"证明不了"渲染的是对的那段"。所以每条 case 都：
 *
 *   1. 断言 `data-route-reason`（结构化原因，不是文字）；
 *   2. 断言文案**包含该原因的专属词条**；
 *   3. 断言文案**不包含**通用那句 —— 这一条才真正防住"六个原因说同一句话"。
 *
 * 第 3 条在改动前会全红：那时渲染的就是通用那句。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider, translate, type MessageKey } from '@heyta/i18n';
import type { AiHealthSnapshot, AiRoutingConfig, SecretStore } from '@heyta/ai';
import type { Task } from '@heyta/domain';

import {
  explainNoCandidate,
  resolveFeatureRoute,
  type SettingsTarget,
} from '../src/features/ai/route-explanation.js';

const { AiDuration } = await import('../src/features/ai/AiDuration.js');
const { AiBreakdown } = await import('../src/features/ai/AiBreakdown.js');

/** 与 `language-switcher.spec.tsx` 同一套判据：扩展 A + 基本区。 */
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF]/;

const EMPTY_SECRETS: SecretStore = { get: () => Promise.resolve(undefined) };

/** 端点标签一律用英文 —— 英文断言里不该出现任何汉字（含夹具自己带进来的）。 */
const LOCAL_ENDPOINT = {
  id: 'local',
  label: 'Local Ollama',
  endpoint: 'http://localhost:11434/v1',
  model: 'qwen3:8b',
  capabilities: ['structured_output'] as const,
};

const REMOTE_ENDPOINT = {
  id: 'remote',
  label: 'Cloud vendor',
  endpoint: 'https://api.example.com/v1',
  model: 'some-model',
  capabilities: ['structured_output'] as const,
};

/** 拆解需要 `long_context` —— 用它来触发"能力没声明"，这是最真实的那条路。 */
const LOCAL_FOR_BREAKDOWN = {
  ...LOCAL_ENDPOINT,
  capabilities: ['structured_output'] as const,
};

const TASK: Task = {
  id: 't1',
  title: 'Write the weekly report',
  note: 'Attach the numbers.',
  createdAt: 0,
  updatedAt: 0,
} as Task;

/** `local` 已跳闸（未来 60 秒内不再尝试）。 */
const TRIPPED: AiHealthSnapshot = {
  version: 1,
  entries: [{ endpointId: 'local', consecutiveFailures: 3, circuitOpenUntil: Date.now() + 60_000 }],
};

function durationRouting(overrides: Partial<AiRoutingConfig> = {}): AiRoutingConfig {
  return {
    enabled: true,
    allowRemote: true,
    endpoints: [LOCAL_ENDPOINT],
    routes: { 'duration-estimate': [{ endpointId: 'local' }] },
    ...overrides,
  };
}

interface ReasonCase {
  readonly reason: string;
  readonly key: MessageKey;
  readonly settingsTarget: SettingsTarget;
  readonly testId: string;
  readonly panel: 'duration' | 'breakdown';
  readonly routing: AiRoutingConfig;
  readonly healthSnapshot?: AiHealthSnapshot;
  /** 通用那句本身（"还没配置端点"）不适用于 `unconfigured` 这条 case。 */
  readonly generic: MessageKey;
}

const CASES: readonly ReasonCase[] = [
  {
    reason: 'remote-not-allowed',
    key: 'web.ai.routeExplain.remoteNotAllowed',
    settingsTarget: 'remote',
    testId: 'duration-no-target',
    panel: 'duration',
    generic: 'web.ai.noTarget.duration',
    // 路由**指向远端端点**，而闸 2（允许远程端点）关着。
    routing: durationRouting({
      allowRemote: false,
      endpoints: [REMOTE_ENDPOINT],
      routes: { 'duration-estimate': [{ endpointId: 'remote' }] },
    }),
  },
  {
    reason: 'capability-missing',
    key: 'web.ai.routeExplain.capabilityMissing',
    settingsTarget: 'capability',
    testId: 'ai-no-target',
    panel: 'breakdown',
    generic: 'web.ai.noTarget.breakdown',
    // 只声明 structured_output → 拆解要的 long_context 没声明。
    routing: {
      enabled: true,
      allowRemote: true,
      endpoints: [LOCAL_FOR_BREAKDOWN],
      routes: { breakdown: [{ endpointId: 'local' }] },
    },
  },
  {
    reason: 'endpoint-disabled',
    key: 'web.ai.routeExplain.endpointDisabled',
    settingsTarget: 'endpoints',
    testId: 'duration-no-target',
    panel: 'duration',
    generic: 'web.ai.noTarget.duration',
    routing: durationRouting({ endpoints: [{ ...LOCAL_ENDPOINT, disabled: true }] }),
  },
  {
    reason: 'endpoint-url-rejected',
    key: 'web.ai.routeExplain.endpointUrlRejected',
    settingsTarget: 'endpoints',
    testId: 'duration-no-target',
    panel: 'duration',
    generic: 'web.ai.noTarget.duration',
    routing: durationRouting({ endpoints: [{ ...LOCAL_ENDPOINT, endpoint: 'not a url' }] }),
  },
  {
    reason: 'circuit-open',
    key: 'web.ai.routeExplain.circuitOpen',
    settingsTarget: 'endpoints',
    testId: 'duration-no-target',
    panel: 'duration',
    generic: 'web.ai.noTarget.duration',
    routing: durationRouting(),
    healthSnapshot: TRIPPED,
  },
  {
    reason: 'endpoint-missing',
    key: 'web.ai.routeExplain.endpointMissing',
    settingsTarget: 'endpoints',
    testId: 'duration-no-target',
    panel: 'duration',
    generic: 'web.ai.noTarget.duration',
    // 路由指向一个不存在的端点 —— 配置损坏，而不是"没配"。
    routing: durationRouting({
      endpoints: [],
      routes: { 'duration-estimate': [{ endpointId: 'ghost' }] },
    }),
  },
  {
    reason: 'unconfigured',
    key: 'web.ai.noTarget.duration',
    settingsTarget: 'endpoints',
    testId: 'duration-no-target',
    panel: 'duration',
    generic: 'web.ai.noTarget.duration',
    routing: durationRouting({ routes: {} }),
  },
];

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function renderPanel(
  c: ReasonCase,
  locale: 'zh-CN' | 'en',
  onOpenSettings: (target: SettingsTarget) => void,
): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <I18nProvider locale={locale}>
        {c.panel === 'duration' ? (
          <AiDuration
            task={TASK}
            routing={c.routing}
            consents={[]}
            secrets={EMPTY_SECRETS}
            onApply={() => Promise.resolve()}
            onOpenSettings={onOpenSettings}
            {...(c.healthSnapshot === undefined ? {} : { healthSnapshot: c.healthSnapshot })}
          />
        ) : (
          <AiBreakdown
            task={TASK}
            routing={c.routing}
            consents={[]}
            secrets={EMPTY_SECRETS}
            onApplyNote={() => Promise.resolve()}
            onOpenSettings={onOpenSettings}
          />
        )}
      </I18nProvider>,
    );
  });
  // 点进披露态（只算不发，所以是同步的）。
  const runId = c.panel === 'duration' ? 'duration-run-t1' : 'ai-breakdown-t1';
  act(() => {
    container?.querySelector<HTMLButtonElement>(`[data-testid="${runId}"]`)?.click();
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
  vi.restoreAllMocks();
});

describe('🔴 每个排除原因都说自己的那句话（不是通用那句）', () => {
  for (const c of CASES) {
    it(`${c.reason} → ${c.key}`, () => {
      const el = renderPanel(c, 'zh-CN', () => undefined);
      const note = el.querySelector(`[data-testid="${c.testId}"]`);
      expect(note, '没有端点时必须渲染解释').toBeTruthy();
      expect(note?.getAttribute('data-route-reason')).toBe(c.reason);

      const text = note?.textContent ?? '';
      // ② 专属词条必须出现（逐字，不靠"包含某个词"）。
      expect(text).toContain(translate('zh-CN', c.key));
      // ③ 通用那句不能出现 —— 这一条才真正防住"六个原因说同一句话"。
      if (c.key !== c.generic) {
        expect(text).not.toContain(translate('zh-CN', c.generic));
      }
    });
  }

  it('🔴 英文界面下每个原因都没有一个汉字', () => {
    for (const c of CASES) {
      const el = renderPanel(c, 'en', () => undefined);
      const note = el.querySelector(`[data-testid="${c.testId}"]`);
      const text = note?.textContent ?? '';
      expect(text, `${c.reason} 的英文解释`).toContain(translate('en', c.key));
      expect(CJK.test(text), `${c.reason} 的英文解释里出现汉字：${text}`).toBe(false);
      act(() => {
        root?.unmount();
      });
      container?.remove();
      root = undefined;
      container = undefined;
    }
  });
});

describe('🔴 「去设置」把用户送到能修它的那一块', () => {
  for (const c of CASES) {
    it(`${c.reason} → ${c.settingsTarget}`, () => {
      const seen: SettingsTarget[] = [];
      const el = renderPanel(c, 'zh-CN', (target) => seen.push(target));
      act(() => {
        el.querySelector<HTMLButtonElement>(`[data-testid="${c.testId}-settings"]`)?.click();
      });
      expect(seen).toEqual([c.settingsTarget]);
    });
  }

  it('没有接导航（未传回调）时不渲染按钮 —— 点了没反应的按钮比没有按钮更糟', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const c = CASES[0]!;
    act(() => {
      root?.render(
        <I18nProvider locale="zh-CN">
          <AiDuration
            task={TASK}
            routing={c.routing}
            consents={[]}
            secrets={EMPTY_SECRETS}
            onApply={() => Promise.resolve()}
          />
        </I18nProvider>,
      );
    });
    act(() => {
      container?.querySelector<HTMLButtonElement>('[data-testid="duration-run-t1"]')?.click();
    });
    expect(container.querySelector('[data-testid="duration-no-target"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="duration-no-target-settings"]')).toBeNull();
  });
});

describe('原因优先级与不变式', () => {
  it('🔴 多个原因并存时报"用户下一步真能解决"的那一个', () => {
    // 远端闸关着 + 还有一个不存在的端点。开着远端之前，能力根本不会被检查，
    // 所以先报 remote-not-allowed 才是可执行的建议。
    const routing = durationRouting({
      allowRemote: false,
      endpoints: [REMOTE_ENDPOINT],
      routes: {
        'duration-estimate': [{ endpointId: 'remote' }, { endpointId: 'ghost' }],
      },
    });
    const route = resolveFeatureRoute(routing, 'duration-estimate');
    expect(route.target).toBeUndefined();
    expect(route.explanation?.reason).toBe('remote-not-allowed');
  });

  it('候选非空时**不给**解释 —— 解释只属于"一个都没有"', () => {
    const route = resolveFeatureRoute(durationRouting(), 'duration-estimate');
    expect(route.target?.endpointId).toBe('local');
    expect(route.explanation).toBeUndefined();
  });

  it('既没配路由、又没有排除记录时，宁可承认"判断不了"也不编一个原因', () => {
    const explanation = explainNoCandidate(
      { candidates: [], excluded: [], unconfigured: false },
      'capture',
    );
    expect(explanation.reason).toBe('unknown');
    expect(explanation.key).toBe('web.ai.routeExplain.unknown');
  });
});
