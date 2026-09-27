/**
 * 端点停用开关 + 「去设置」的落点
 * =================================
 *
 * ## ① 停用开关补的是一个「有读无写」的字段
 *
 * `AiEndpointConfig.disabled` 一直存在，`resolveRoute` 也真的会跳过它
 * （`packages/ai/src/routing.ts` 里 `endpoint-disabled` 是一条正式的排除原因），
 * 但**全仓没有任何地方写它**。用户想"暂时别用这个端点"只能把它删掉 ——
 * 删除会连带清掉路由与授权，代价完全不成比例。
 *
 * 所以这里钉两件事：
 *   1. 开关真的写进存储（`loadAiSettings()` 读得回来）；
 *   2. 停用之后，AI 面板说出的原因是 `endpoint-disabled`，**不是**通用那句
 *      「还没有配置端点」。这正是模块 2 的另一半：能力有了，界面要如实反映。
 *
 * ## ② `focusTarget` 是「去设置」的最后一米
 *
 * 面板说"去设置"之后，用户到了设置页还得自己找。`focusTarget` 让页面
 * 停在对应的区块上。断言的是 `data-focused`（呈现状态），不是滚动 ——
 * jsdom 没有 `scrollIntoView`。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider } from '@heyta/i18n';
import type { SecretStore } from '@heyta/ai';
import type { Task } from '@heyta/domain';

import {
  createSessionSecretStore,
  defaultAiSettings,
  loadAiSettings,
  saveAiSettings,
  type PersistedAiSettings,
} from '../src/features/settings/aiStore.js';
import type { SettingsTarget } from '../src/features/ai/route-explanation.js';

const { AiSettings } = await import('../src/features/settings/AiSettings.js');
const { AiDuration } = await import('../src/features/ai/AiDuration.js');

const EMPTY_SECRETS: SecretStore = { get: () => Promise.resolve(undefined) };

const LOCAL_ENDPOINT = {
  id: 'local',
  label: '本机 Ollama',
  endpoint: 'http://localhost:11434/v1',
  model: 'qwen3:8b',
  capabilities: ['structured_output'] as const,
};

/** 一个装好的配置：AI 开着、远端开着、估时有路。 */
function readySettings(): PersistedAiSettings {
  return {
    ...defaultAiSettings(),
    routing: {
      enabled: true,
      allowRemote: true,
      endpoints: [{ ...LOCAL_ENDPOINT }],
      routes: { 'duration-estimate': [{ endpointId: 'local' }] },
    },
  };
}

const TASK: Task = {
  id: 't1',
  title: '写周报',
  createdAt: 0,
  updatedAt: 0,
} as Task;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function render(ui: React.JSX.Element): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<I18nProvider locale="zh-CN">{ui}</I18nProvider>);
  });
  return container;
}

function remount(ui: React.JSX.Element): HTMLDivElement {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  return render(ui);
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

describe('🔴 停用端点 —— `disabled` 的写入端', () => {
  it('端点行里有开关，初始未勾选', () => {
    const el = render(<AiSettings initial={readySettings()} secrets={createSessionSecretStore()} />);
    const box = el.querySelector<HTMLInputElement>('[data-testid="endpoint-local-disabled"]');
    expect(box, '端点行必须有停用开关').not.toBeNull();
    expect(box?.checked).toBe(false);
  });

  it('🔴 勾上 → 真的写进存储；取消 → 也写回 false', () => {
    const el = render(<AiSettings initial={readySettings()} secrets={createSessionSecretStore()} />);
    const box = el.querySelector<HTMLInputElement>('[data-testid="endpoint-local-disabled"]');

    act(() => {
      box?.click();
    });
    expect(loadAiSettings().routing.endpoints[0]?.disabled).toBe(true);

    const box2 = el.querySelector<HTMLInputElement>('[data-testid="endpoint-local-disabled"]');
    act(() => {
      box2?.click();
    });
    expect(loadAiSettings().routing.endpoints[0]?.disabled).toBe(false);
  });

  it('停用状态在界面上可见（不只是内部字段）', () => {
    const el = render(<AiSettings initial={readySettings()} secrets={createSessionSecretStore()} />);
    const box = el.querySelector<HTMLInputElement>('[data-testid="endpoint-local-disabled"]');
    act(() => {
      box?.click();
    });
    expect(el.querySelector('[data-testid="endpoint-local-disabled-note"]')).not.toBeNull();
  });

  it('🔴 停用唯一端点后，AI 面板说的是「端点已被停用」而不是「还没配置端点」', () => {
    const el = render(<AiSettings initial={readySettings()} secrets={createSessionSecretStore()} />);
    act(() => {
      el.querySelector<HTMLInputElement>('[data-testid="endpoint-local-disabled"]')?.click();
    });

    // 用**刚写下的**配置渲染估时面板 —— 走的是真实的读回路径。
    const panel = remount(
      <AiDuration
        task={TASK}
        routing={loadAiSettings().routing}
        consents={loadAiSettings().consents}
        secrets={EMPTY_SECRETS}
        onApply={() => Promise.resolve()}
      />,
    );
    act(() => {
      panel.querySelector<HTMLButtonElement>('[data-testid="duration-run-t1"]')?.click();
    });

    const note = panel.querySelector('[data-testid="duration-no-target"]');
    expect(note).not.toBeNull();
    expect(note?.getAttribute('data-route-reason')).toBe('endpoint-disabled');
  });
});

describe('🔴 「去设置」的落点（focusTarget）', () => {
  const CASES: readonly { target: SettingsTarget; testId: string }[] = [
    { target: 'endpoints', testId: 'ai-endpoints-section' },
    { target: 'remote', testId: 'ai-remote-gate' },
    { target: 'capability', testId: 'ai-features-section' },
    { target: 'consent', testId: 'ai-features-section' },
  ];

  for (const c of CASES) {
    it(`${c.target} → ${c.testId} 被高亮`, () => {
      const el = render(
        <AiSettings
          initial={readySettings()}
          secrets={createSessionSecretStore()}
          focusTarget={c.target}
        />,
      );
      const node = el.querySelector(`[data-testid="${c.testId}"]`);
      expect(node, `缺少 ${c.testId}`).not.toBeNull();
      expect(node?.getAttribute('data-focused')).toBe('true');
    });
  }

  it('没有 focusTarget（用户自己点进来）→ 一块都不高亮', () => {
    const el = render(<AiSettings initial={readySettings()} secrets={createSessionSecretStore()} />);
    for (const testId of [
      'ai-endpoints-section',
      'ai-remote-gate',
      'ai-features-section',
    ]) {
      expect(el.querySelector(`[data-testid="${testId}"]`)?.getAttribute('data-focused')).toBeNull();
    }
  });

  it('落点只影响呈现：渲染结束后配置一个字节都没变', () => {
    saveAiSettings(readySettings());
    const before = JSON.stringify(loadAiSettings());
    render(
      <AiSettings
        initial={readySettings()}
        secrets={createSessionSecretStore()}
        focusTarget="consent"
      />,
    );
    expect(JSON.stringify(loadAiSettings())).toBe(before);
  });
});
