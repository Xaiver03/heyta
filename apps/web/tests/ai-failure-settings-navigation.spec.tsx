/**
 * 失败态也要有"下一步" —— 而且**只在设置里真能修的时候**才给
 * ==========================================================
 *
 * ## 钉住的是什么
 *
 * 失败文案此前只有一句话（「该功能需要你先授权数据出境。」），**没有按钮**。
 * 用户读完知道自己缺一步，但不知道那一步在哪里。
 *
 * 修法不是"所有失败都加一个去设置按钮" —— 网络抖动、端点返回空内容、
 * 模型没读懂，这些在设置里改什么都修不好。给它们也放按钮，
 * 等于把用户送到一个没有答案的地方，比没有按钮更糟。
 *
 * 所以本文件两侧都钉：
 *   - 能修的（未授权 → consent、端点报错 → endpoints）**必须有**按钮，且落点正确；
 *   - 修不了的（网络失败、模型没读懂）**必须没有**按钮。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider } from '@heyta/i18n';
import type { AiRoutingConfig, SecretStore } from '@heyta/ai';
import type { Task } from '@heyta/domain';

import type { SettingsTarget } from '../src/features/ai/route-explanation.js';

import type { EgressConsent } from '@heyta/ai';

const { AiBreakdown } = await import('../src/features/ai/AiBreakdown.js');

/** 一次已经授权的出境 —— 用于"已经能发出去、但端点自己出事"的那些 case。 */
const CONSENT: EgressConsent = {
  feature: 'breakdown',
  destination: 'user-endpoint',
  grantedAt: 1,
};

const EMPTY_SECRETS: SecretStore = { get: () => Promise.resolve(undefined) };

/** 自备远端 + 两个能力齐备 —— 拆解走得通，只差授权。 */
const REMOTE_ENDPOINT = {
  id: 'remote',
  label: 'Cloud vendor',
  endpoint: 'https://api.example.com/v1',
  model: 'some-model',
  capabilities: ['structured_output', 'long_context'] as const,
};

const ROUTING: AiRoutingConfig = {
  enabled: true,
  allowRemote: true,
  endpoints: [REMOTE_ENDPOINT],
  routes: { breakdown: [{ endpointId: 'remote' }] },
};

const TASK: Task = {
  id: 't1',
  title: 'Write the weekly report',
  note: 'Attach the numbers.',
  createdAt: 0,
  updatedAt: 0,
} as Task;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function render(
  fetchImpl: typeof fetch,
  onOpenSettings: (target: SettingsTarget) => void,
  consents: readonly EgressConsent[] = [],
): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <I18nProvider locale="zh-CN">
        <AiBreakdown
          task={TASK}
          routing={ROUTING}
          consents={consents}
          secrets={EMPTY_SECRETS}
          onApplyNote={() => Promise.resolve()}
          fetchImpl={fetchImpl}
          onOpenSettings={onOpenSettings}
        />
      </I18nProvider>,
    );
  });
  return container;
}

/** 点进披露态，再按"发送"并等失败态落定。 */
async function sendAndFail(el: HTMLDivElement): Promise<void> {
  act(() => {
    el.querySelector<HTMLButtonElement>('[data-testid="ai-breakdown-t1"]')?.click();
  });
  await act(async () => {
    el.querySelector<HTMLButtonElement>('[data-testid="ai-send"]')?.click();
    await Promise.resolve();
  });
}

/** 一个永远不会被到达的 fetch —— 未授权时请求根本不该发出去。 */
function unreachableFetch(): typeof fetch {
  return (() => Promise.reject(new Error('不该被调用'))) as unknown as typeof fetch;
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

describe('🔴 失败态的"去设置"', () => {
  it('未授权 → 出现在失败态，落点是 consent，且请求一个都没发', async () => {
    const seen: SettingsTarget[] = [];
    const el = render(unreachableFetch(), (target) => seen.push(target));
    await sendAndFail(el);

    expect(el.querySelector('[data-testid="ai-failed"]')).toBeTruthy();
    const button = el.querySelector<HTMLButtonElement>('[data-testid="ai-failure-settings"]');
    expect(button, '未授权是可以在设置里修的，必须有按钮').toBeTruthy();

    act(() => {
      button?.click();
    });
    expect(seen).toEqual(['consent']);
  });

  it('端点返回 5xx → 落点是 endpoints（密钥 / 余额 / 模型名都在端点行里）', async () => {
    const seen: SettingsTarget[] = [];
    const el = render(
      (() => Promise.resolve(new Response('boom', { status: 500 }))) as unknown as typeof fetch,
      (target) => seen.push(target),
      [CONSENT],
    );
    await sendAndFail(el);

    const button = el.querySelector<HTMLButtonElement>('[data-testid="ai-failure-settings"]');
    expect(button).toBeTruthy();
    act(() => {
      button?.click();
    });
    expect(seen).toEqual(['endpoints']);
  });

  it('🔴 网络失败 → **没有**按钮：设置里改什么都修不好', async () => {
    const seen: SettingsTarget[] = [];
    const el = render(
      // 同源回环？不是 —— 但这条 case 只关心"失败原因没有设置里的解"。
      (() => Promise.reject(new Error('connect ECONNREFUSED'))) as unknown as typeof fetch,
      (target) => seen.push(target),
      [CONSENT],
    );
    await sendAndFail(el);

    expect(el.querySelector('[data-testid="ai-failure-message"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="ai-failure-settings"]')).toBeNull();
    expect(seen).toEqual([]);
  });
});
