/**
 * AI 优先级排序界面测试
 * =========================
 *
 * 🔴 本文件最重要的是这四条：
 *
 *   1. 🔴 **披露必须发生在发送之前** —— 用户在看到"发什么、发给谁"之前，
 *      一个字节都不该出去。
 *   2. 🔴 **AI 的输出不会自己写进数据** —— 必须用户再确认一次。
 *   3. 🔴 **逐条取舍真的生效** —— 勾掉的那条不能被写进去。
 *   4. 🔴 **未授权时一次网络请求都不发**。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { zhCN } from '@heyta/i18n';


import { Priority } from '@heyta/domain';
import type { AiRoutingConfig, EgressConsent, SecretStore } from '@heyta/ai';
import type { PreferenceSet, Task } from '@heyta/domain';

const { AiPrioritize, resolvePrioritizeTarget } = await import(
  '../src/features/ai/AiPrioritize.js'
);

const EMPTY_SECRETS: SecretStore = { get: () => Promise.resolve(undefined) };

const LOCAL_ENDPOINT = {
  id: 'local',
  label: '本机 Ollama',
  endpoint: 'http://localhost:11434/v1',
  model: 'qwen3:8b',
  capabilities: ['structured_output'] as const,
};

const REMOTE_ENDPOINT = {
  id: 'remote',
  label: '云端供应商',
  endpoint: 'https://api.example.com/v1',
  model: 'some-model',
  capabilities: ['structured_output'] as const,
};

function makeRouting(endpoint: typeof LOCAL_ENDPOINT | typeof REMOTE_ENDPOINT): AiRoutingConfig {
  return {
    enabled: true,
    allowRemote: true,
    endpoints: [endpoint],
    routes: { prioritize: [{ endpointId: endpoint.id }] },
  };
}

const CONSENT: EgressConsent = { feature: 'prioritize', destination: 'user-endpoint', grantedAt: 1 };

const TASKS: readonly Task[] = [
  {
    id: 't1',
    title: '做发布',
    note: '我自己写的备注。',
    createdAt: 0,
    updatedAt: 0,
  } as Task,
  { id: 't2', title: '写周报', createdAt: 0, updatedAt: 0 } as Task,
];

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function render(props: Partial<Parameters<typeof AiPrioritize>[0]> = {}): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <AiPrioritize
        tasks={TASKS}
        routing={makeRouting(LOCAL_ENDPOINT)}
        consents={[]}
        secrets={EMPTY_SECRETS}
        onApply={() => Promise.resolve()}
        {...props}
      />,
    );
  });
  return container;
}

function click(el: Element | null | undefined): void {
  act(() => {
    (el as HTMLElement | null)?.click();
  });
}

async function clickAsync(el: Element | null | undefined): Promise<void> {
  await act(async () => {
    (el as HTMLElement | null)?.click();
    await Promise.resolve();
  });
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

/** 假端点。 */
function fakeFetch(content: string) {
  const calls: { url: string; body: string }[] = [];
  const impl = ((url: string, init?: { body?: string }) => {
    calls.push({ url: String(url), body: init?.body ?? '' });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ choices: [{ message: { content } }] }),
      text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content } }] })),
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** 两条建议的模型输出。 */
const TWO_SUGGESTIONS = JSON.stringify([
  { id: 't1', priority: 'high', reason: '截止最近，先做' },
  { id: 't2', priority: 'low', reason: '可以往后放' },
]);

// ─────────────────────────────────────────────────────────────────────────

describe('resolvePrioritizeTarget', () => {
  it('识别回环端点为"数据不出设备"', () => {
    const t = resolvePrioritizeTarget(makeRouting(LOCAL_ENDPOINT));
    expect(t?.isLocal).toBe(true);
    expect(t?.label).toBe('本机 Ollama');
  });

  it('🔴 用的是 prioritize 这条路由（不是 breakdown）', () => {
    const routing: AiRoutingConfig = {
      enabled: true,
      allowRemote: true,
      endpoints: [LOCAL_ENDPOINT],
      routes: { prioritize: [{ endpointId: 'local' }] },
    };
    expect(resolvePrioritizeTarget(routing)?.endpointId).toBe('local');
  });

  it('没有路由时返回 undefined', () => {
    expect(
      resolvePrioritizeTarget({ enabled: true, allowRemote: true, endpoints: [], routes: {} }),
    ).toBeUndefined();
  });
});

describe('🔴🔴 披露必须发生在发送之前', () => {
  it('🔴🔴 点"AI 排优先级"不发任何请求，只显示披露', () => {
    const { impl, calls } = fakeFetch(TWO_SUGGESTIONS);
    const el = render({ fetchImpl: impl });

    click(el.querySelector('[data-testid="prioritize-open"]'));

    expect(el.querySelector('[data-testid="prioritize-disclosure"]')).toBeTruthy();
    // 🔴 但一个请求都没发
    expect(calls).toHaveLength(0);
  });

  it('🔴 披露里写明发给哪个端点', () => {
    const el = render();
    click(el.querySelector('[data-testid="prioritize-open"]'));
    const dest = el.querySelector('[data-testid="prioritize-destination"]');
    expect(dest?.textContent).toContain('本机 Ollama');
    expect(dest?.textContent).toContain('http://localhost:11434/v1');
    expect(dest?.textContent).toContain('qwen3:8b');
  });

  it('🔴 披露里写明发哪几个字段（tasks，且**不含** note）', () => {
    const el = render();
    click(el.querySelector('[data-testid="prioritize-open"]'));
    const fields = el.querySelector('[data-testid="prioritize-field-list"]')?.textContent ?? '';
    expect(fields).toContain('tasks');
    expect(fields).not.toContain('note');
  });

  it('🔴 远端端点必须出现"不受端到端加密保护"的明文警告', () => {
    const el = render({ routing: makeRouting(REMOTE_ENDPOINT), consents: [CONSENT] });
    click(el.querySelector('[data-testid="prioritize-open"]'));
    expect(el.querySelector('[data-testid="prioritize-destination-kind"]')?.textContent).toContain(
      '离开设备',
    );
    const warn = el.querySelector('[data-testid="prioritize-e2ee-warning"]');
    expect(warn).toBeTruthy();
    expect(warn?.textContent).toContain('不受端到端加密保护');
  });

  it('没有配置端点时说明该去哪配，且不发请求', () => {
    const { impl, calls } = fakeFetch(TWO_SUGGESTIONS);
    const el = render({
      routing: { enabled: true, allowRemote: true, endpoints: [], routes: {} },
      fetchImpl: impl,
    });
    click(el.querySelector('[data-testid="prioritize-open"]'));
    expect(el.querySelector('[data-testid="prioritize-no-target"]')?.textContent).toContain('设置');
    expect(calls).toHaveLength(0);
  });

  it('🔴 取消之后不发请求', () => {
    const { impl, calls } = fakeFetch(TWO_SUGGESTIONS);
    const el = render({ fetchImpl: impl });
    click(el.querySelector('[data-testid="prioritize-open"]'));
    click(el.querySelector('[data-testid="prioritize-cancel"]'));
    expect(calls).toHaveLength(0);
    expect(el.querySelector('[data-testid="prioritize-open"]')).toBeTruthy();
  });

  it('🔴 右上角的关闭按钮同样不发请求', () => {
    const { impl, calls } = fakeFetch(TWO_SUGGESTIONS);
    const el = render({ fetchImpl: impl });
    click(el.querySelector('[data-testid="prioritize-open"]'));
    click(el.querySelector('[data-testid="prioritize-disclosure-close"]'));
    expect(calls).toHaveLength(0);
    expect(el.querySelector('[data-testid="prioritize-open"]')).toBeTruthy();
  });

  it('按了"发送"才会真的发', async () => {
    const { impl, calls } = fakeFetch(TWO_SUGGESTIONS);
    const el = render({ fetchImpl: impl });
    click(el.querySelector('[data-testid="prioritize-open"]'));
    expect(calls).toHaveLength(0);
    await clickAsync(el.querySelector('[data-testid="prioritize-send"]'));
    expect(calls).toHaveLength(1);
  });

  it('🔴🔴 未授权远端时失败，提示去逐功能授权，且请求没发出去', async () => {
    const { impl, calls } = fakeFetch(TWO_SUGGESTIONS);
    const el = render({ routing: makeRouting(REMOTE_ENDPOINT), consents: [], fetchImpl: impl });
    click(el.querySelector('[data-testid="prioritize-open"]'));
    await clickAsync(el.querySelector('[data-testid="prioritize-send"]'));
        // 🔴 钉的是**哪一个词条**，不是它此刻的字面量：界面口径已统一成「批准内容离开本机」，
    //    既不写"授权"也不写监管定性词（check:ui-language 规则 7）。抓 substring 会在下次
    //    改文案时再红一次，而钉 key 同时留住真正的判据 —— 失败面渲染的是这一条原因。
    expect(
      el.querySelector('[data-testid="prioritize-failure-message"]')?.textContent,
    ).toContain(zhCN['web.ai.failure.cause.egressNotAuthorized']);
    expect(calls).toHaveLength(0);
  });
});

describe('🔴🔴 AI 的输出不会自己写进数据', () => {
  it('🔴 拿到结果后没有自动调用 onApply', async () => {
    const applied: unknown[] = [];
    const { impl } = fakeFetch(TWO_SUGGESTIONS);
    const el = render({
      fetchImpl: impl,
      onApply: (decisions) => {
        applied.push(decisions);
        return Promise.resolve();
      },
    });
    click(el.querySelector('[data-testid="prioritize-open"]'));
    await clickAsync(el.querySelector('[data-testid="prioritize-send"]'));

    expect(el.querySelector('[data-testid="prioritize-proposal"]')).toBeTruthy();
    // 🔴 但还没有写进任何地方
    expect(applied).toHaveLength(0);
  });

  it('🔴 用户确认后写入，且写的是 id + 新优先级', async () => {
    const applied: { id: string; priority: Priority }[][] = [];
    const { impl } = fakeFetch(TWO_SUGGESTIONS);
    const el = render({
      fetchImpl: impl,
      onApply: (decisions) => {
        applied.push([...decisions]);
        return Promise.resolve();
      },
    });
    click(el.querySelector('[data-testid="prioritize-open"]'));
    await clickAsync(el.querySelector('[data-testid="prioritize-send"]'));
    await clickAsync(el.querySelector('[data-testid="prioritize-apply"]'));

    expect(applied).toHaveLength(1);
    expect(applied[0]).toEqual([
      { id: 't1', priority: Priority.High },
      { id: 't2', priority: Priority.Low },
    ]);
  });

  it('"不要了"不写入', async () => {
    const applied: unknown[] = [];
    const { impl } = fakeFetch(TWO_SUGGESTIONS);
    const el = render({
      fetchImpl: impl,
      onApply: (decisions) => {
        applied.push(decisions);
        return Promise.resolve();
      },
    });
    click(el.querySelector('[data-testid="prioritize-open"]'));
    await clickAsync(el.querySelector('[data-testid="prioritize-send"]'));
    click(el.querySelector('[data-testid="prioritize-reject"]'));
    expect(applied).toHaveLength(0);
  });

  it('确认写入后显示"已应用"', async () => {
    const { impl } = fakeFetch(TWO_SUGGESTIONS);
    const el = render({ fetchImpl: impl });
    click(el.querySelector('[data-testid="prioritize-open"]'));
    await clickAsync(el.querySelector('[data-testid="prioritize-send"]'));
    await clickAsync(el.querySelector('[data-testid="prioritize-apply"]'));
    expect(el.querySelector('[data-testid="prioritize-applied"]')).toBeTruthy();
  });

  it('🔴 结果里标出这份提议来自哪里', async () => {
    const { impl } = fakeFetch(TWO_SUGGESTIONS);
    const el = render({ fetchImpl: impl });
    click(el.querySelector('[data-testid="prioritize-open"]'));
    await clickAsync(el.querySelector('[data-testid="prioritize-send"]'));
    expect(el.querySelector('[data-testid="prioritize-proposal-source"]')?.textContent).toContain(
      '本机',
    );
  });

  // 🔴 法定显式标识（《标识办法》+ GB 45438-2025）：这个顺序是模型给的建议。
  it('🔴 提议里带「AI 生成合成内容」的显式标识', async () => {
    const { impl } = fakeFetch(TWO_SUGGESTIONS);
    const el = render({ fetchImpl: impl });
    click(el.querySelector('[data-testid="prioritize-open"]'));
    await clickAsync(el.querySelector('[data-testid="prioritize-send"]'));
    expect(el.querySelector('[data-testid="prioritize-proposal-generated"]')?.textContent).toBe(
      'AI 生成合成内容',
    );
  });
});

describe('🔴🔴 逐条取舍', () => {
  async function toProposal(
    onApply?: (decisions: readonly { id: string; priority: Priority }[]) => void,
  ): Promise<HTMLDivElement> {
    const { impl } = fakeFetch(TWO_SUGGESTIONS);
    const el = render({
      fetchImpl: impl,
      ...(onApply === undefined
        ? {}
        : {
            onApply: (decisions: readonly { id: string; priority: Priority }[]) => {
              onApply(decisions);
              return Promise.resolve();
            },
          }),
    });
    click(el.querySelector('[data-testid="prioritize-open"]'));
    await clickAsync(el.querySelector('[data-testid="prioritize-send"]'));
    return el;
  }

  it('🔴 默认全选', async () => {
    const el = await toProposal();
    expect(el.querySelector('[data-testid="prioritize-kept-count"]')?.textContent).toBe('2');
  });

  it('🔴 每条都显示理由', async () => {
    const el = await toProposal();
    expect(el.querySelector('[data-testid="prioritize-reason-0"]')?.textContent).toContain(
      '截止最近',
    );
    expect(el.querySelector('[data-testid="prioritize-reason-1"]')?.textContent).toContain(
      '可以往后放',
    );
  });

  it('🔴 每条显示任务标题与优先级', async () => {
    const el = await toProposal();
    expect(el.querySelector('[data-testid="prioritize-title-0"]')?.textContent).toContain('做发布');
    expect(el.querySelector('[data-testid="prioritize-priority-0"]')?.textContent).toContain('高');
    expect(el.querySelector('[data-testid="prioritize-priority-1"]')?.textContent).toContain('低');
  });

  it('🔴🔴 勾掉一条 → 只写入选中的那条（取舍真的生效）', async () => {
    const applied: { id: string; priority: Priority }[][] = [];
    const el = await toProposal((decisions) => applied.push([...decisions]));

    click(el.querySelector('[data-testid="prioritize-item-0"]'));
    expect(el.querySelector('[data-testid="prioritize-kept-count"]')?.textContent).toBe('1');

    await clickAsync(el.querySelector('[data-testid="prioritize-apply"]'));

    expect(applied).toHaveLength(1);
    expect(applied[0]).toEqual([{ id: 't2', priority: Priority.Low }]);
  });

  it('🔴 一条都不勾时应用按钮禁用', async () => {
    const el = await toProposal();
    click(el.querySelector('[data-testid="prioritize-item-0"]'));
    click(el.querySelector('[data-testid="prioritize-item-1"]'));
    const btn = el.querySelector('[data-testid="prioritize-apply"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});

describe('失败路径', () => {
  it('🔴 模型返回一坨废话 → 显示"没读懂"', async () => {
    const { impl } = fakeFetch('抱歉，我无法完成这个任务。');
    const el = render({ fetchImpl: impl });
    click(el.querySelector('[data-testid="prioritize-open"]'));
    await clickAsync(el.querySelector('[data-testid="prioritize-send"]'));

    expect(el.querySelector('[data-testid="prioritize-failed"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="prioritize-failure-message"]')?.textContent).toContain(
      '没有能识别',
    );
  });
});

// ── 🔴 记忆偏好：从界面到网络请求 ─────────────────────────────────────
//
// 这一组防的是本仓库最高发的 bug 类：**能力实现了、被测了、但没人接**。

const PREF_SET = (memoryEnabled: boolean): PreferenceSet => ({
  memoryEnabled,
  estimateBias: null,
  deepWorkWindow: {
    id: 'deep-work-window',
    value: { startHour: 8, endHour: 11, concentration: 0.8 },
    sampleSize: 40,
    confidence: 0.9,
    evidenceFacts: { kind: 'deep-work-window', startHour: 8, endHour: 11, concentration: 0.8, samples: 40 },
    evidence: '基于 40 次专注，80% 集中在 08:00–11:00',
  },
  leadTime: {
    id: 'lead-time',
    value: 2,
    sampleSize: 20,
    confidence: 0.9,
    evidenceFacts: { kind: 'lead-time', days: 2, samples: 20 },
    evidence: '基于 20 条带截止日期的任务，你习惯提前 2 天完成',
  },
  granularity: null,
  titleStyle: null,
  withheld: [],
});

describe('🔴 记忆偏好从界面走到请求体', () => {
  it('关了记忆 → 请求体里没有偏好，披露里也没有 preferences 字段', async () => {
    const { impl, calls } = fakeFetch(TWO_SUGGESTIONS);
    const el = render({ fetchImpl: impl, preferenceSet: PREF_SET(false) });

    click(el.querySelector('[data-testid="prioritize-open"]'));
    expect(el.querySelector('[data-testid="prioritize-field-list"]')?.textContent).not.toContain(
      'preferences',
    );

    await clickAsync(el.querySelector('[data-testid="prioritize-send"]'));
    const body = calls[0]?.body ?? '';
    expect(body).not.toContain('关于这位用户的历史习惯');
  });

  it('🔴 开了记忆 → 披露先列出 preferences 字段，然后请求体里真的有偏好', async () => {
    const { impl, calls } = fakeFetch(TWO_SUGGESTIONS);
    const el = render({ fetchImpl: impl, preferenceSet: PREF_SET(true) });

    click(el.querySelector('[data-testid="prioritize-open"]'));
    // ① 披露必须**在发送前**就说明会发偏好
    expect(el.querySelector('[data-testid="prioritize-field-list"]')?.textContent).toContain(
      'preferences',
    );
    // 此刻还没有任何请求出去
    expect(calls).toHaveLength(0);

    // ② 确认后才真的带上
    await clickAsync(el.querySelector('[data-testid="prioritize-send"]'));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body ?? '').toContain('关于这位用户的历史习惯');
    expect(calls[0]?.body ?? '').toContain('提前 2 天');
  });

  it('🔴 排序只带自己的偏好（不把拆解粒度发出去）', async () => {
    const { impl, calls } = fakeFetch(TWO_SUGGESTIONS);
    const el = render({ fetchImpl: impl, preferenceSet: PREF_SET(true) });
    click(el.querySelector('[data-testid="prioritize-open"]'));
    await clickAsync(el.querySelector('[data-testid="prioritize-send"]'));
    const body = calls[0]?.body ?? '';
    expect(body).toContain('高效时段');
    expect(body).not.toContain('6 项左右');
  });

  it('不传 preferenceSet（旧的调用点）→ 一个偏好都不发，也不报错', async () => {
    const { impl, calls } = fakeFetch(TWO_SUGGESTIONS);
    const el = render({ fetchImpl: impl });
    click(el.querySelector('[data-testid="prioritize-open"]'));
    await clickAsync(el.querySelector('[data-testid="prioritize-send"]'));
    expect(calls[0]?.body ?? '').not.toContain('关于这位用户的历史习惯');
  });
});
