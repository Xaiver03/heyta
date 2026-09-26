/**
 * AI 拆解界面测试
 * =================
 *
 * 🔴 本文件最重要的是**披露**那几条：
 *
 *   1. 🔴 **披露必须发生在发送之前** —— 用户在看到"发什么、发给谁"之前，
 *      一个字节都不该出去。这是计划 §5 验收判据 ④。
 *   2. 🔴 **AI 的输出不会自己写进数据** —— 必须用户再确认一次。
 *   3. 🔴 **追加而不是覆盖备注**。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiRoutingConfig, EgressConsent, SecretStore } from '@heyta/ai';
import type { PreferenceSet, Task } from '@heyta/domain';

const { AiBreakdown, resolvePreferredTarget } = await import('../src/features/ai/AiBreakdown.js');

const EMPTY_SECRETS: SecretStore = { get: () => Promise.resolve(undefined) };

const LOCAL_ENDPOINT = {
  id: 'local',
  label: '本机 Ollama',
  endpoint: 'http://localhost:11434/v1',
  model: 'qwen3:8b',
  capabilities: ['structured_output', 'long_context'] as const,
};

const REMOTE_ENDPOINT = {
  id: 'remote',
  label: '云端供应商',
  endpoint: 'https://api.example.com/v1',
  model: 'some-model',
  capabilities: ['structured_output', 'long_context'] as const,
};

function makeRouting(endpoint: typeof LOCAL_ENDPOINT | typeof REMOTE_ENDPOINT): AiRoutingConfig {
  return {
    enabled: true,
    allowRemote: true,
    endpoints: [endpoint],
    routes: { breakdown: [{ endpointId: endpoint.id }] },
  };
}

const CONSENT: EgressConsent = { feature: 'breakdown', destination: 'user-endpoint', grantedAt: 1 };

const TASK: Task = {
  id: 't1',
  title: '做发布',
  note: '我自己写的备注。',
  createdAt: 0,
  updatedAt: 0,
} as Task;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function render(props: Partial<Parameters<typeof AiBreakdown>[0]> = {}): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <AiBreakdown
        task={TASK}
        routing={makeRouting(LOCAL_ENDPOINT)}
        consents={[]}
        secrets={EMPTY_SECRETS}
        onApplyNote={() => Promise.resolve()}
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

// ─────────────────────────────────────────────────────────────────────────

describe('resolvePreferredTarget', () => {
  it('识别回环端点为"数据不出设备"', () => {
    const t = resolvePreferredTarget(makeRouting(LOCAL_ENDPOINT));
    expect(t?.isLocal).toBe(true);
    expect(t?.label).toBe('本机 Ollama');
  });

  it('识别远端端点为"数据会离开设备"', () => {
    const t = resolvePreferredTarget(makeRouting(REMOTE_ENDPOINT));
    expect(t?.isLocal).toBe(false);
  });

  it('没有路由时返回 undefined', () => {
    expect(resolvePreferredTarget({ enabled: true, allowRemote: true, endpoints: [], routes: {} })).toBeUndefined();
  });

  it('跳过的端点不算首选', () => {
    const routing: AiRoutingConfig = {
      enabled: true,
      allowRemote: true,
      endpoints: [{ ...LOCAL_ENDPOINT, disabled: true }],
      routes: { breakdown: [{ endpointId: 'local' }] },
    };
    expect(resolvePreferredTarget(routing)).toBeUndefined();
  });
});

describe('🔴🔴 披露必须发生在发送之前', () => {
  it('🔴🔴 点"AI 拆解"**不发任何请求**，只显示披露', async () => {
    const { impl, calls } = fakeFetch('- 甲');
    const el = render({ fetchImpl: impl });

    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));

    // 披露面板出现了
    expect(el.querySelector('[data-testid="ai-disclosure"]')).toBeTruthy();
    // 🔴 但一个请求都没发
    expect(calls).toHaveLength(0);
  });

  it('🔴 披露里写明**发给哪个端点**', () => {
    const el = render();
    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
    const dest = el.querySelector('[data-testid="ai-destination"]');
    expect(dest?.textContent).toContain('本机 Ollama');
    expect(dest?.textContent).toContain('http://localhost:11434/v1');
    expect(dest?.textContent).toContain('qwen3:8b');
  });

  it('🔴 披露里写明**发哪几个字段**', () => {
    const el = render();
    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
    const fields = el.querySelector('[data-testid="ai-field-list"]')?.textContent ?? '';
    expect(fields).toContain('title');
    expect(fields).toContain('note');
  });

  it('🔴 本机端点标"数据不出设备"，且**不出现**端到端加密警告', () => {
    const el = render();
    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
    expect(el.querySelector('[data-testid="ai-destination-kind"]')?.textContent).toContain('不出设备');
    expect(el.querySelector('[data-testid="ai-e2ee-warning"]')).toBeNull();
  });

  it('🔴🔴 远端端点必须出现"不受端到端加密保护"的明文警告', () => {
    const el = render({ routing: makeRouting(REMOTE_ENDPOINT), consents: [CONSENT] });
    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
    expect(el.querySelector('[data-testid="ai-destination-kind"]')?.textContent).toContain('离开设备');
    const warn = el.querySelector('[data-testid="ai-e2ee-warning"]');
    expect(warn).toBeTruthy();
    expect(warn?.textContent).toContain('不受端到端加密保护');
  });

  it('没有配置端点时说明该去哪配，且不发请求', () => {
    const { impl, calls } = fakeFetch('- 甲');
    const el = render({
      routing: { enabled: true, allowRemote: true, endpoints: [], routes: {} },
      fetchImpl: impl,
    });
    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
    expect(el.querySelector('[data-testid="ai-no-target"]')?.textContent).toContain('设置');
    expect(calls).toHaveLength(0);
  });

  it('🔴 取消之后不发请求', () => {
    const { impl, calls } = fakeFetch('- 甲');
    const el = render({ fetchImpl: impl });
    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
    click([...el.querySelectorAll('button')].find((b) => b.textContent?.includes('取消')));
    expect(calls).toHaveLength(0);
    expect(el.querySelector('[data-testid="ai-breakdown-t1"]')).toBeTruthy();
  });

  it('按了"发送"才会真的发', async () => {
    const { impl, calls } = fakeFetch('- 甲\n- 乙');
    const el = render({ fetchImpl: impl });
    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
    expect(calls).toHaveLength(0);
    await clickAsync(el.querySelector('[data-testid="ai-send"]'));
    expect(calls).toHaveLength(1);
  });
});

describe('🔴🔴 AI 的输出不会自己写进数据', () => {
  it('🔴 拿到结果后**没有**自动调用 onApplyNote', async () => {
    const applied: string[] = [];
    const { impl } = fakeFetch('- 甲\n- 乙');
    const el = render({
      fetchImpl: impl,
      onApplyNote: (note) => {
        applied.push(note);
        return Promise.resolve();
      },
    });
    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
    await clickAsync(el.querySelector('[data-testid="ai-send"]'));

    // 结果展示出来了
    expect(el.querySelector('[data-testid="ai-proposal"]')).toBeTruthy();
    // 🔴 但还没有写进任何地方
    expect(applied).toHaveLength(0);
  });

  it('🔴 用户确认后写入，而且**是追加不是覆盖**', async () => {
    const applied: string[] = [];
    const { impl } = fakeFetch('- 甲\n- 乙');
    const el = render({
      fetchImpl: impl,
      onApplyNote: (note) => {
        applied.push(note);
        return Promise.resolve();
      },
    });
    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
    await clickAsync(el.querySelector('[data-testid="ai-send"]'));
    await clickAsync(el.querySelector('[data-testid="ai-apply"]'));

    expect(applied).toHaveLength(1);
    // 🔴 原备注必须还在
    expect(applied[0]).toContain('我自己写的备注。');
    expect(applied[0]).toContain('- [ ] 甲');
    expect(applied[0]).toContain('- [ ] 乙');
  });

  it('"不要了"不写入', async () => {
    const applied: string[] = [];
    const { impl } = fakeFetch('- 甲');
    const el = render({
      fetchImpl: impl,
      onApplyNote: (note) => {
        applied.push(note);
        return Promise.resolve();
      },
    });
    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
    await clickAsync(el.querySelector('[data-testid="ai-send"]'));
    click([...el.querySelectorAll('button')].find((b) => b.textContent?.includes('不要了')));
    expect(applied).toHaveLength(0);
  });

  it('确认写入后显示"已写入备注"', async () => {
    const { impl } = fakeFetch('- 甲');
    const el = render({ fetchImpl: impl });
    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
    await clickAsync(el.querySelector('[data-testid="ai-send"]'));
    await clickAsync(el.querySelector('[data-testid="ai-apply"]'));
    expect(el.querySelector('[data-testid="ai-applied-t1"]')).toBeTruthy();
  });

  it('🔴 结果里标出**这份提议来自哪里**', async () => {
    const { impl } = fakeFetch('- 甲');
    const el = render({ fetchImpl: impl });
    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
    await clickAsync(el.querySelector('[data-testid="ai-send"]'));
    expect(el.querySelector('[data-testid="ai-proposal-source"]')?.textContent).toContain('本机');
  });
});

describe('失败路径', () => {
  it('🔴 失败时给出**具体原因**，不是"AI 不可用"一句话', async () => {
    const el = render({
      routing: { enabled: true, allowRemote: true, endpoints: [], routes: {} },
      fetchImpl: (() => Promise.reject(new Error('x'))) as unknown as typeof fetch,
    });
    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
    // 没有端点 → 披露阶段就会说明
    expect(el.querySelector('[data-testid="ai-no-target"]')).toBeTruthy();
  });

  it('🔴 模型返回一坨废话 → 显示"没读懂"，并提供**不依赖 AI 的退路**', async () => {
    const applied: string[] = [];
    const { impl } = fakeFetch('抱歉，我无法完成这个任务。');
    const el = render({
      fetchImpl: impl,
      onApplyNote: (note) => {
        applied.push(note);
        return Promise.resolve();
      },
    });
    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
    await clickAsync(el.querySelector('[data-testid="ai-send"]'));

    expect(el.querySelector('[data-testid="ai-failed"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="ai-failure-message"]')?.textContent).toContain('没有能识别');

    // 退路：手动空清单
    await clickAsync(el.querySelector('[data-testid="ai-manual"]'));
    expect(applied).toHaveLength(1);
    expect(applied[0]).toContain('我自己写的备注。');
  });

  it('🔴 未授权远端时失败，提示去逐功能授权，且**请求没发出去**', async () => {
    const { impl, calls } = fakeFetch('- 甲');
    const el = render({ routing: makeRouting(REMOTE_ENDPOINT), consents: [], fetchImpl: impl });
    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
    await clickAsync(el.querySelector('[data-testid="ai-send"]'));
    expect(el.querySelector('[data-testid="ai-failure-message"]')?.textContent).toContain('授权');
    expect(calls).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 「数据出不出设备」只能有一个判据', () => {
  /**
   * 🔴 **反漂移测试。**
   *
   * 这里不重复写一遍回环规则 —— 那正是原来出 bug 的地方。
   * 分成两类：
   *   - **URL 合法**的端点：`isLocal` 必须与 `isLoopbackEndpoint()` 一致
   *   - **URL 不合法**的端点：根本不该有候选（`resolveRoute` 会排除它）
   */
  const ACCEPTED = [
    'http://localhost:11434/v1',
    'http://127.0.0.1:11434/v1',
    'http://127.0.0.2:11434/v1',
    'http://LOCALHOST:11434/v1',
    'http://[::1]:11434/v1',
    'https://api.example.com/v1',
  ] as const;

  /** ⚠️ 这些**不是**"被判成远端"，而是**根本不能发送**。 */
  const REJECTED = [
    'http://api.example.com/v1', // 远端明文 http
    'http://localhost.evil.com/v1', // 远端明文 http
    'http://127.0.0.1:80@evil.com/v1', // userinfo；真实主机是 evil.com
  ] as const;

  for (const endpoint of ACCEPTED) {
    it(`🔴 ${endpoint} —— 与 isLoopbackEndpoint 一致`, async () => {
      const { isLoopbackEndpoint } = await import('@heyta/ai');
      const target = resolvePreferredTarget(
        makeRouting({ ...LOCAL_ENDPOINT, endpoint } as typeof LOCAL_ENDPOINT),
      );
      expect(target?.isLocal).toBe(isLoopbackEndpoint(endpoint));
    });
  }

  for (const endpoint of REJECTED) {
    it(`🔴 ${endpoint} —— URL 不合法，不该有候选`, () => {
      expect(
        resolvePreferredTarget(makeRouting({ ...LOCAL_ENDPOINT, endpoint } as typeof LOCAL_ENDPOINT)),
      ).toBeUndefined();
    });
  }

  it('🔴 127.0.0.0/8 整段都算本机（不只是 .0.1）', () => {
    const target = resolvePreferredTarget(
      makeRouting({ ...LOCAL_ENDPOINT, endpoint: 'http://127.0.0.2:11434/v1' } as typeof LOCAL_ENDPOINT),
    );
    expect(target?.isLocal).toBe(true);
  });

  it('🔴 大小写不敏感', () => {
    const target = resolvePreferredTarget(
      makeRouting({ ...LOCAL_ENDPOINT, endpoint: 'http://LOCALHOST:11434/v1' } as typeof LOCAL_ENDPOINT),
    );
    expect(target?.isLocal).toBe(true);
  });
});

describe('🔴🔴 披露的端点必须是**实际会被用**的那个', () => {
  /** A 缺 long_context（会被排除），B 齐全。 */
  const CHAIN: AiRoutingConfig = {
    enabled: true,
    allowRemote: true,
    endpoints: [
      { id: 'a', label: '供应商 A', endpoint: 'https://a.example.com/v1', model: 'ma', capabilities: ['structured_output'] },
      { id: 'b', label: '供应商 B', endpoint: 'https://b.example.com/v1', model: 'mb', capabilities: ['structured_output', 'long_context'] },
    ],
    routes: { breakdown: [{ endpointId: 'a' }, { endpointId: 'b' }] },
  };

  it('🔴🔴 披露不能指向一个会被过滤掉的端点', () => {
    const target = resolvePreferredTarget(CHAIN);
    // 早先这里返回 A（只跳过 disabled），而实际请求打到 B —— 且因为成功，
    // 用户永远不会发现。现在必须直接是 B。
    expect(target?.endpointId).toBe('b');
  });

  it('🔴🔴 真实发送的这个端点，正是披露的那个', async () => {
    const { invokeRouted } = await import('@heyta/ai');
    const target = resolvePreferredTarget(CHAIN);

    const calls: string[] = [];
    const fetchImpl: typeof fetch = (url) => {
      calls.push(String(url));
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: '- 甲' } }] }), { status: 200 }),
      );
    };
    const outcome = await invokeRouted(
      CHAIN,
      { feature: 'breakdown', system: 's', user: 'u', fields: ['title'] },
      [{ feature: 'breakdown', destination: 'user-endpoint', grantedAt: 1 }],
      undefined,
      { fetchImpl },
    );

    expect(outcome.result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    // 🔴 披露的地址必须就是请求打到的地址
    expect(calls[0]).toContain(new URL(target!.endpoint).host);
  });

  /** 两个端点**都**能用 —— 这才是真的回退链（CHAIN 里 A 被排除了）。 */
  const TWO_GOOD: AiRoutingConfig = {
    ...CHAIN,
    endpoints: [
      { ...CHAIN.endpoints[0]!, capabilities: ['structured_output', 'long_context'] },
      CHAIN.endpoints[1]!,
    ],
  };

  it('🔴 回退链要一并披露（回退会换一家公司，而成功时没有任何提示）', () => {
    const target = resolvePreferredTarget(TWO_GOOD);
    expect(target?.endpointId).toBe('a');
    expect(target?.fallbacks).toEqual(['供应商 B']);
  });

  it('🔴🔴 A 失败时数据真的去了 B —— 所以 B 必须提前披露', async () => {
    const { invokeRouted } = await import('@heyta/ai');
    const calls: string[] = [];
    const fetchImpl: typeof fetch = (url) => {
      calls.push(String(url));
      // 首选打不通，回退才成功
      if (String(url).includes('a.example.com')) {
        return Promise.reject(new Error('connect ECONNREFUSED'));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: '- 甲' } }] }), { status: 200 }),
      );
    };
    const outcome = await invokeRouted(
      TWO_GOOD,
      { feature: 'breakdown', system: 's', user: 'u', fields: ['title'] },
      [{ feature: 'breakdown', destination: 'user-endpoint', grantedAt: 1 }],
      undefined,
      { fetchImpl },
    );

    // 🔴 成功了 —— 用户不会看到任何失败提示
    expect(outcome.result.ok).toBe(true);
    expect(calls[1]).toContain('b.example.com');
  });

  it('🔴 回退链出现在界面上', () => {
    const el = render({ routing: TWO_GOOD, consents: [CONSENT] });
    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
    expect(el.querySelector('[data-testid="ai-fallback-list"]')?.textContent).toContain('供应商 B');
  });

  it('🔴 只有一个候选时不显示回退链（不制造噪音）', () => {
    const el = render({ routing: makeRouting(LOCAL_ENDPOINT), consents: [CONSENT] });
    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
    expect(el.querySelector('[data-testid="ai-fallbacks"]')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 熔断状态必须真的**读回来**（只落盘不读等于白做）', () => {
  const NOW = Date.now();

  /** 落盘快照：`local` 已跳闸。 */
  const TRIPPED = {
    version: 1,
    entries: [
      { endpointId: 'local', consecutiveFailures: 3, circuitOpenUntil: NOW + 60_000 },
    ],
  };

  /** 落盘快照：跳闸**早就过期**了。 */
  const STALE = {
    version: 1,
    entries: [
      { endpointId: 'local', consecutiveFailures: 3, circuitOpenUntil: NOW - 60_000 },
    ],
  };

  it('🔴🔴 上次跳闸的端点这次**不该再撞**（一个请求都不发）', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = (url) => {
      calls.push(String(url));
      return Promise.resolve(new Response('{}', { status: 200 }));
    };
    const el = render({
      routing: makeRouting(LOCAL_ENDPOINT),
      consents: [CONSENT],
      healthSnapshot: TRIPPED,
      fetchImpl,
    });

    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
    click(el.querySelector('[data-testid="ai-send"]'));
    await act(async () => {
      await Promise.resolve();
    });

    // 🔴 这就是本 prop 的全部意义：不传它，这里会打出去一个必然失败的请求
    expect(calls).toHaveLength(0);
    expect(el.querySelector('[data-testid="ai-failed"]')).toBeTruthy();
  });

  it('🔴 过期跳闸**不该**继续拦着 —— 退化方向是"再试一次"', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = (url) => {
      calls.push(String(url));
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: '- 甲' } }] }), { status: 200 }),
      );
    };
    const el = render({
      routing: makeRouting(LOCAL_ENDPOINT),
      consents: [CONSENT],
      healthSnapshot: STALE,
      fetchImpl,
    });

    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
    click(el.querySelector('[data-testid="ai-send"]'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // 过期的跳闸必须放行，否则 AI 会**永久不可用**
    expect(calls).toHaveLength(1);
  });

  it('🔴 坏快照（版本对不上）不该炸，也不该拦住请求', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = (url) => {
      calls.push(String(url));
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: '- 甲' } }] }), { status: 200 }),
      );
    };
    const el = render({
      routing: makeRouting(LOCAL_ENDPOINT),
      consents: [CONSENT],
      healthSnapshot: { version: 999, entries: 'garbage' } as never,
      fetchImpl,
    });

    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
    click(el.querySelector('[data-testid="ai-send"]'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(calls).toHaveLength(1);
  });

  it('🔴 跳闸的端点后面还有可用的 → 走回退，而且是**披露过**的那个', async () => {
    const TWO: AiRoutingConfig = {
      enabled: true,
      allowRemote: true,
      endpoints: [
        { ...LOCAL_ENDPOINT, id: 'a', label: 'A', endpoint: 'https://a.example.com/v1' },
        { ...LOCAL_ENDPOINT, id: 'b', label: 'B', endpoint: 'https://b.example.com/v1' },
      ],
      routes: { breakdown: [{ endpointId: 'a' }, { endpointId: 'b' }] },
    };
    const calls: string[] = [];
    const fetchImpl: typeof fetch = (url) => {
      calls.push(String(url));
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: '- 甲' } }] }), { status: 200 }),
      );
    };
    const el = render({
      routing: TWO,
      consents: [CONSENT],
      healthSnapshot: { version: 1, entries: [{ endpointId: 'a', consecutiveFailures: 3, circuitOpenUntil: NOW + 60_000 }] },
      fetchImpl,
    });

    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));

    // 🔴🔴 **这是"回退链披露"之所以是承重的（而不只是礼貌）的原因。**
    //
    // 披露用的是**不含熔断状态**的静态推导，所以跳闸的 A 仍会出现在首选位置。
    // 只有当 B 被一并列出时，用户才在按下发送**之前**看到过真正的目的地。
    // 删掉回退链披露，这里就是一个未披露的目的地变更。
    expect(el.querySelector('[data-testid="ai-fallback-list"]')?.textContent).toContain('B');

    click(el.querySelector('[data-testid="ai-send"]'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(calls).toHaveLength(1);
    // 实际发到 B —— 而 B 已经在上面披露过了
    expect(calls[0]).toContain('b.example.com');
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 披露必须是**三维**：发给谁 / 发什么 / 留多久', () => {
  it('🔴🔴 本机端点：明说"未离开设备"', () => {
    const el = render({ routing: makeRouting(LOCAL_ENDPOINT), consents: [CONSENT] });
    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
    expect(el.querySelector('[data-testid="ai-retention-text"]')?.textContent).toContain(
      '未离开设备',
    );
  });

  it('🔴🔴 远端端点：明说"保留策略由你的端点决定，heyta 无从知晓"', () => {
    const el = render({ routing: makeRouting(REMOTE_ENDPOINT), consents: [CONSENT] });
    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
    const text = el.querySelector('[data-testid="ai-retention-text"]')?.textContent ?? '';
    // 这句是 heyta 在**明确不背书** —— 不能省
    expect(text).toContain('heyta 无从知晓');
  });

  it('🔴 三维都在（发给谁 / 发什么 / 留多久）', () => {
    const el = render({ routing: makeRouting(REMOTE_ENDPOINT), consents: [CONSENT] });
    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
    expect(el.querySelector('[data-testid="ai-destination"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="ai-field-list"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="ai-retention-text"]')).toBeTruthy();
  });

  it('🔴 披露文案来自 buildDisclosure（不是界面自己写的）', async () => {
    const { buildDisclosure } = await import('@heyta/ai');
    const expected = buildDisclosure({
      feature: 'breakdown',
      destination: 'user-endpoint',
      fields: [],
    });
    const el = render({ routing: makeRouting(REMOTE_ENDPOINT), consents: [CONSENT] });
    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
    // 🔴 两边必须逐字一致 —— 界面自己写一份就会漂移
    expect(el.querySelector('[data-testid="ai-retention-text"]')?.textContent).toBe(
      expected.retentionText,
    );
  });
});

// ── 🔴 记忆偏好：从界面到网络请求 ─────────────────────────────────────
//
// 这一组防的是本仓库最高发的 bug 类：**能力实现了、被测了、但没人接**。
// `packages/domain` 与 `packages/app-host` 各自的测试都能过，
// 而界面忘了传 `preferenceSet` —— 那样偏好永远送不出去，且**没有任何症状**。
// 所以这里从「点按钮」一路断言到「HTTP 请求体」。

const PREF_SET = (memoryEnabled: boolean): PreferenceSet => ({
  memoryEnabled,
  estimateBias: null,
  deepWorkWindow: null,
  leadTime: null,
  granularity: {
    id: 'granularity',
    value: 6,
    sampleSize: 12,
    confidence: 0.9,
    evidenceFacts: { kind: 'granularity', items: 6, samples: 12 },
    evidence: '你的 12 条带清单任务，中位数是 6 项',
  },
  titleStyle: null,
  withheld: [],
});

describe('🔴 记忆偏好从界面走到请求体', () => {
  it('关了记忆 → 请求体里没有偏好，披露里也没有 preferences 字段', async () => {
    const { impl, calls } = fakeFetch('- 甲');
    const el = render({ fetchImpl: impl, preferenceSet: PREF_SET(false) });

    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
    expect(el.querySelector('[data-testid="ai-field-list"]')?.textContent).not.toContain('preferences');

    await clickAsync(el.querySelector('[data-testid="ai-send"]'));
    const body = calls[0]?.body ?? '';
    expect(body).not.toContain('关于这位用户的历史习惯');
    expect(body).not.toContain('6 项左右');
  });

  it('🔴 开了记忆 → 披露**先**列出 preferences 字段，然后请求体里真的有偏好', async () => {
    const { impl, calls } = fakeFetch('- 甲');
    const el = render({ fetchImpl: impl, preferenceSet: PREF_SET(true) });

    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));

    // ① 披露必须**在发送前**就说明会发偏好
    expect(el.querySelector('[data-testid="ai-field-list"]')?.textContent).toContain('preferences');
    // 此刻还没有任何请求出去
    expect(calls).toHaveLength(0);

    // ② 确认后才真的带上
    await clickAsync(el.querySelector('[data-testid="ai-send"]'));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body ?? '').toContain('关于这位用户的历史习惯');
    expect(calls[0]?.body ?? '').toContain('6 项左右');
  });

  it('不传 preferenceSet（旧的调用点）→ 一个偏好都不发，也不报错', async () => {
    const { impl, calls } = fakeFetch('- 甲');
    const el = render({ fetchImpl: impl });
    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
    await clickAsync(el.querySelector('[data-testid="ai-send"]'));
    expect(calls[0]?.body ?? '').not.toContain('关于这位用户的历史习惯');
  });
});

// ── 🔴 反馈层：界面上的取舍真的被记下来了吗 ─────────────────────────
//
// 这一层此前**完全不存在**：建议被采用还是被丢掉，代码里没有痕迹。
// 于是 P6/P7 偏好永远学不到东西 —— 而"没记录"是**没有任何症状**的，
// 只能靠测试钉住。

describe('🔴 反馈层：处置必须被记录', () => {
  /** 跑到"拿到建议"这一步。 */
  async function toProposal(
    onFeedback?: (fb: { outcome: string; proposedCount: number; appliedCount: number }) => void,
  ): Promise<HTMLDivElement> {
    const { impl } = fakeFetch('- 甲\n- 乙\n- 丙\n- 丁');
    const el = render({
      fetchImpl: impl,
      ...(onFeedback === undefined ? {} : { onFeedback }),
    });
    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
    await clickAsync(el.querySelector('[data-testid="ai-send"]'));
    return el;
  }

  it('全选后写入 → accepted，且提议数 = 采用数', async () => {
    const seen: { outcome: string; proposedCount: number; appliedCount: number }[] = [];
    const el = await toProposal((fb) => seen.push(fb));

    await clickAsync(el.querySelector('[data-testid="ai-apply"]'));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.outcome).toBe('accepted');
    expect(seen[0]?.proposedCount).toBe(4);
    expect(seen[0]?.appliedCount).toBe(4);
  });

  it('🔴 取消勾选两条 → modified，采用数如实是 2', async () => {
    const seen: { outcome: string; proposedCount: number; appliedCount: number }[] = [];
    const el = await toProposal((fb) => seen.push(fb));

    // 默认全选
    expect(el.querySelector('[data-testid="ai-kept-count"]')?.textContent).toBe('4');
    click(el.querySelector('[data-testid="ai-item-1"]'));
    click(el.querySelector('[data-testid="ai-item-3"]'));
    expect(el.querySelector('[data-testid="ai-kept-count"]')?.textContent).toBe('2');

    await clickAsync(el.querySelector('[data-testid="ai-apply"]'));

    expect(seen[0]?.outcome).toBe('modified');
    expect(seen[0]?.appliedCount).toBe(2);
  });

  it('🔴 写入的是**勾选后**的条目，不是全部（取舍真的生效）', async () => {
    const applied: string[] = [];
    const { impl } = fakeFetch('- 甲\n- 乙\n- 丙');
    const el = render({
      fetchImpl: impl,
      onApplyNote: (note) => {
        applied.push(note);
        return Promise.resolve();
      },
    });
    click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
    await clickAsync(el.querySelector('[data-testid="ai-send"]'));

    click(el.querySelector('[data-testid="ai-item-0"]')); // 去掉「甲」
    await clickAsync(el.querySelector('[data-testid="ai-apply"]'));

    const note = applied[0] ?? '';
    expect(note).not.toContain('甲');
    expect(note).toContain('乙');
    expect(note).toContain('丙');
  });

  it('🔴 点「不要了」→ rejected，采用数 0', async () => {
    const seen: { outcome: string; proposedCount: number; appliedCount: number }[] = [];
    const el = await toProposal((fb) => seen.push(fb));

    click([...el.querySelectorAll('button')].find((b) => b.textContent?.includes('不要了')));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.outcome).toBe('rejected');
    expect(seen[0]?.appliedCount).toBe(0);
  });

  it('🔴 一条都不勾时写入按钮禁用（不能产生 rejected+apply 的矛盾记录）', async () => {
    const el = await toProposal();
    for (const i of [0, 1, 2, 3]) click(el.querySelector(`[data-testid="ai-item-${String(i)}"]`));
    const btn = el.querySelector('[data-testid="ai-apply"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('不传 onFeedback（旧调用点）→ 不报错，也不记录', async () => {
    const el = await toProposal();
    await clickAsync(el.querySelector('[data-testid="ai-apply"]'));
    // 走到这里没抛就是通过
    expect(el.querySelector('[data-testid="ai-proposal"]')).toBeNull();
  });
});
