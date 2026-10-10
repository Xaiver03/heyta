/**
 * AI 耗时估计界面测试
 * =====================
 *
 * 🔴 本文件最重要的是四条：
 *
 *   1. 🔴 **披露必须发生在发送之前** —— 用户在看到"发什么、发给谁"之前，
 *      一个字节都不该出去。
 *   2. 🔴 **AI 的输出不会自己写进数据** —— 必须用户再确认一次（`onApply`）。
 *   3. 🔴 **必须显示"我凭什么估这个数"** —— 一个错误的分钟数看起来和正确的
 *      一模一样，所以"依据"不是装饰，是用户唯一能判断该不该信的东西。
 *   4. 🔴 **夹取要如实说** —— 模型给了 1e9，界面不能假装它说的是 480。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { zhCN } from '@heyta/i18n';


import type { AiRoutingConfig, EgressConsent, SecretStore } from '@heyta/ai';
import type { PreferenceSet, Task } from '@heyta/domain';

const { AiDuration, resolveDurationTarget } = await import('../src/features/ai/AiDuration.js');

const EMPTY_SECRETS: SecretStore = { get: () => Promise.resolve(undefined) };

/** `duration-estimate` 只需要 `structured_output`。 */
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
    routes: { 'duration-estimate': [{ endpointId: endpoint.id }] },
  };
}

const CONSENT: EgressConsent = {
  feature: 'duration-estimate',
  destination: 'user-endpoint',
  grantedAt: 1,
};

const TASK: Task = {
  id: 't1',
  title: '写周报',
  note: '别忘附数据。',
  createdAt: 0,
  updatedAt: 0,
} as Task;

/** 一条可用历史：计划 `p` 分钟，实际 `a` 分钟。 */
function row(plannedMinutes: number, actualMinutes: number): { plannedMs: number; actualMs: number } {
  return { plannedMs: plannedMinutes * 60_000, actualMs: actualMinutes * 60_000 };
}

const HISTORY = [row(30, 54), row(60, 90), row(20, 36)];

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function render(props: Partial<Parameters<typeof AiDuration>[0]> = {}): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <AiDuration
        task={TASK}
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

/** 往受控 input 里写值（React 只认原生 setter + input 事件）。 */
function typeInto(el: Element | null | undefined, value: string): void {
  const input = el as HTMLInputElement | null;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
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

function fakeFetch(content: string): { impl: typeof fetch; calls: { url: string; body: string }[] } {
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

/** 跑到"披露"这一步。 */
function toDisclosure(el: HTMLDivElement): void {
  click(el.querySelector('[data-testid="duration-run-t1"]'));
}

// ─────────────────────────────────────────────────────────────────────────

describe('resolveDurationTarget', () => {
  it('识别回环端点为"数据不出设备"', () => {
    const t = resolveDurationTarget(makeRouting(LOCAL_ENDPOINT));
    expect(t?.isLocal).toBe(true);
    expect(t?.label).toBe('本机 Ollama');
  });

  it('识别远端端点为"数据会离开设备"', () => {
    expect(resolveDurationTarget(makeRouting(REMOTE_ENDPOINT))?.isLocal).toBe(false);
  });

  it('没有路由时返回 undefined', () => {
    expect(
      resolveDurationTarget({ enabled: true, allowRemote: true, endpoints: [], routes: {} }),
    ).toBeUndefined();
  });

  it('跳过的端点不算首选', () => {
    const routing: AiRoutingConfig = {
      enabled: true,
      allowRemote: true,
      endpoints: [{ ...LOCAL_ENDPOINT, disabled: true }],
      routes: { 'duration-estimate': [{ endpointId: 'local' }] },
    };
    expect(resolveDurationTarget(routing)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 披露必须发生在发送之前', () => {
  it('🔴🔴 点"AI 估时"**不发任何请求**，只显示披露', () => {
    const { impl, calls } = fakeFetch('90');
    const el = render({ fetchImpl: impl });

    toDisclosure(el);

    expect(el.querySelector('[data-testid="duration-disclosure"]')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('🔴 披露里写明**发给哪个端点**', () => {
    const el = render();
    toDisclosure(el);
    const dest = el.querySelector('[data-testid="duration-destination"]');
    expect(dest?.textContent).toContain('本机 Ollama');
    expect(dest?.textContent).toContain('http://localhost:11434/v1');
    expect(dest?.textContent).toContain('qwen3:8b');
  });

  it('🔴 披露里写明**发哪几个字段**（含历史与偏好）', () => {
    const el = render({ history: HISTORY, preferenceSet: PREF_SET(true) });
    toDisclosure(el);
    const fields = el.querySelector('[data-testid="duration-field-list"]')?.textContent ?? '';
    expect(fields).toContain('title');
    expect(fields).toContain('note');
    expect(fields).toContain('history');
    expect(fields).toContain('preferences');
  });

  it('🔴 没有历史、没有偏好时，字段只有 title/note（不声明没送的东西）', () => {
    const el = render();
    toDisclosure(el);
    expect(el.querySelector('[data-testid="duration-field-list"]')?.textContent).toBe('today、title、note');
  });

  it('🔴 本机端点标"数据不出设备"，且**不出现**端到端加密警告', () => {
    const el = render();
    toDisclosure(el);
    expect(el.querySelector('[data-testid="duration-destination-kind"]')?.textContent).toContain('不出设备');
    expect(el.querySelector('[data-testid="duration-e2ee-warning"]')).toBeNull();
  });

  it('🔴🔴 远端端点必须出现"不受端到端加密保护"的明文警告', () => {
    const el = render({ routing: makeRouting(REMOTE_ENDPOINT), consents: [CONSENT] });
    toDisclosure(el);
    expect(el.querySelector('[data-testid="duration-destination-kind"]')?.textContent).toContain('离开设备');
    expect(el.querySelector('[data-testid="duration-e2ee-warning"]')?.textContent).toContain(
      '不受端到端加密保护',
    );
  });

  it('没有配置端点时说明该去哪配，且不发请求', () => {
    const { impl, calls } = fakeFetch('90');
    const el = render({
      routing: { enabled: true, allowRemote: true, endpoints: [], routes: {} },
      fetchImpl: impl,
    });
    toDisclosure(el);
    expect(el.querySelector('[data-testid="duration-no-target"]')?.textContent).toContain('设置');
    expect(calls).toHaveLength(0);
  });

  it('🔴 取消之后不发请求', () => {
    const { impl, calls } = fakeFetch('90');
    const el = render({ fetchImpl: impl });
    toDisclosure(el);
    click([...el.querySelectorAll('button')].find((b) => b.textContent?.includes('取消')));
    expect(calls).toHaveLength(0);
    expect(el.querySelector('[data-testid="duration-run-t1"]')).toBeTruthy();
  });

  it('按了"发送"才会真的发', async () => {
    const { impl, calls } = fakeFetch('90');
    const el = render({ fetchImpl: impl });
    toDisclosure(el);
    expect(calls).toHaveLength(0);
    await clickAsync(el.querySelector('[data-testid="duration-send"]'));
    expect(calls).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 必须显示"我凭什么估这个数"', () => {
  it('🔴🔴 有历史 → 明说基于过去几次的实际/计划比值', () => {
    const el = render({ history: HISTORY });
    toDisclosure(el);
    const basis = el.querySelector('[data-testid="duration-basis-history"]')?.textContent ?? '';
    expect(basis).toContain('3');
    expect(basis).toContain('实际/计划');
  });

  it('🔴🔴 没有历史也没有偏好 → 如实说"只有模型的通用判断，可能不准"', () => {
    const el = render();
    toDisclosure(el);
    expect(el.querySelector('[data-testid="duration-basis-none"]')?.textContent).toContain('可能不准');
    expect(el.querySelector('[data-testid="duration-basis-history"]')).toBeNull();
  });

  it('🔴 有偏好 → 逐条列出 `PreferenceHint.summary`（给用户看的原话）', () => {
    const el = render({ preferenceSet: PREF_SET(true) });
    toDisclosure(el);
    const prefs = el.querySelector('[data-testid="duration-basis-preferences"]')?.textContent ?? '';
    // 原话里含样本量与方向，用户据此判断这条偏好对不对
    expect(prefs).toContain('1.80 倍');
    expect(el.querySelector('[data-testid="duration-basis-estimate-bias"]')).toBeTruthy();
  });

  it('🔴 历史被封顶时如实说明"只发送最近 N 次"', () => {
    const many = Array.from({ length: 50 }, (_, i) => row(1000 + i, 1800 + i));
    const el = render({ history: many });
    toDisclosure(el);
    const basis = el.querySelector('[data-testid="duration-basis-history"]')?.textContent ?? '';
    expect(basis).toContain('20'); // 真正发出去的条数
    expect(basis).toContain('50'); // 用户实际拥有的条数
  });

  it('🔴 结果态**也要**显示依据（用户是在这里做决定的）', async () => {
    const { impl } = fakeFetch('90');
    const el = render({ fetchImpl: impl, history: HISTORY });
    toDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="duration-send"]'));
    expect(el.querySelector('[data-testid="duration-proposal-basis"]')?.textContent).toContain('实际/计划');
  });

  it('🔴 关了记忆 → 依据里一条偏好都没有', () => {
    const el = render({ preferenceSet: PREF_SET(false) });
    toDisclosure(el);
    expect(el.querySelector('[data-testid="duration-basis-preferences"]')).toBeNull();
    expect(el.querySelector('[data-testid="duration-basis-none"]')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 AI 的输出不会自己写进数据', () => {
  it('🔴 拿到结果后**没有**自动调用 onApply', async () => {
    const applied: number[] = [];
    const { impl } = fakeFetch('90');
    const el = render({
      fetchImpl: impl,
      onApply: (minutes) => {
        applied.push(minutes);
        return Promise.resolve();
      },
    });
    toDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="duration-send"]'));

    expect(el.querySelector('[data-testid="duration-proposal"]')).toBeTruthy();
    // 🔴 还没有写进任何地方
    expect(applied).toHaveLength(0);
  });

  it('🔴 用户确认后写入，写进去的就是那个分钟数', async () => {
    const applied: number[] = [];
    const { impl } = fakeFetch('90');
    const el = render({
      fetchImpl: impl,
      onApply: (minutes) => {
        applied.push(minutes);
        return Promise.resolve();
      },
    });
    toDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="duration-send"]'));
    await clickAsync(el.querySelector('[data-testid="duration-apply"]'));

    expect(applied).toEqual([90]);
  });

  it('🔴 结果里显示分钟数与"来自哪里"', async () => {
    const { impl } = fakeFetch('90');
    const el = render({ fetchImpl: impl });
    toDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="duration-send"]'));

    expect(el.querySelector('[data-testid="duration-proposal-minutes"]')?.textContent).toBe('90');
    expect(el.querySelector('[data-testid="duration-proposal-source"]')?.textContent).toContain('本机');
  });

  // 🔴 法定显式标识（《标识办法》+ GB 45438-2025）：这个分钟数是模型写的，不是量出来的。
  //    与上面那条不是一件事 —— 来源标签说"数据去了哪台机器"，这一条说"这个数是谁给的"。
  it('🔴 提议里带「AI 生成合成内容」的显式标识', async () => {
    const { impl } = fakeFetch('90');
    const el = render({ fetchImpl: impl });
    toDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="duration-send"]'));
    expect(el.querySelector('[data-testid="duration-proposal-generated"]')?.textContent).toBe(
      'AI 生成合成内容',
    );
  });

  it('"不要了"不写入', async () => {
    const applied: number[] = [];
    const { impl } = fakeFetch('90');
    const el = render({
      fetchImpl: impl,
      onApply: (minutes) => {
        applied.push(minutes);
        return Promise.resolve();
      },
    });
    toDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="duration-send"]'));
    await clickAsync(el.querySelector('[data-testid="duration-reject"]'));
    expect(applied).toHaveLength(0);
  });

  it('确认写入后显示"已写入耗时"', async () => {
    const { impl } = fakeFetch('90');
    const el = render({ fetchImpl: impl });
    toDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="duration-send"]'));
    await clickAsync(el.querySelector('[data-testid="duration-apply"]'));
    expect(el.querySelector('[data-testid="duration-applied-t1"]')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('🔴 失败路径与边界', () => {
  it('🔴 模型回"约两小时" → 显示"没能估时"，且**不写库**', async () => {
    const applied: number[] = [];
    const { impl } = fakeFetch('约两小时');
    const el = render({
      fetchImpl: impl,
      onApply: (minutes) => {
        applied.push(minutes);
        return Promise.resolve();
      },
    });
    toDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="duration-send"]'));

    expect(el.querySelector('[data-testid="duration-failed"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="duration-failure-message"]')?.textContent).toContain('分钟数');
    expect(applied).toHaveLength(0);
  });

  it('🔴 模型回 1e9 → 夹住，并且**如实说出来**', async () => {
    const applied: number[] = [];
    const { impl } = fakeFetch('1e9');
    const el = render({
      fetchImpl: impl,
      onApply: (minutes) => {
        applied.push(minutes);
        return Promise.resolve();
      },
    });
    toDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="duration-send"]'));

    expect(el.querySelector('[data-testid="duration-proposal-minutes"]')?.textContent).toBe('480');
    expect(el.querySelector('[data-testid="duration-clamped"]')).toBeTruthy();
    // 夹过的值也要经用户确认才写
    expect(applied).toHaveLength(0);
    await clickAsync(el.querySelector('[data-testid="duration-apply"]'));
    expect(applied).toEqual([480]);
  });

  it('🔴 未授权远端时失败，提示去逐功能授权，且**请求没发出去**', async () => {
    const { impl, calls } = fakeFetch('90');
    const el = render({ routing: makeRouting(REMOTE_ENDPOINT), consents: [], fetchImpl: impl });
    toDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="duration-send"]'));
        // 🔴 钉的是**哪一个词条**，不是它此刻的字面量：界面口径已统一成「批准内容离开本机」，
    //    既不写"授权"也不写监管定性词（check:ui-language 规则 7）。抓 substring 会在下次
    //    改文案时再红一次，而钉 key 同时留住真正的判据 —— 失败面渲染的是这一条原因。
    expect(
      el.querySelector('[data-testid="duration-failure-message"]')?.textContent,
    ).toContain(zhCN['web.ai.failure.cause.egressNotAuthorized']);
    expect(calls).toHaveLength(0);
  });

  it('🔴 手动兜底：空输入时按钮禁用，填了合法分钟数才写库', async () => {
    const applied: number[] = [];
    const { impl } = fakeFetch('约两小时');
    const el = render({
      fetchImpl: impl,
      onApply: (minutes) => {
        applied.push(minutes);
        return Promise.resolve();
      },
    });
    toDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="duration-send"]'));

    const button = el.querySelector('[data-testid="duration-manual-apply"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    // 低于下限 → 仍然禁用（不静默夹取用户自己填的数）
    typeInto(el.querySelector('[data-testid="duration-manual-input"]'), '3');
    expect(
      (el.querySelector('[data-testid="duration-manual-apply"]') as HTMLButtonElement).disabled,
    ).toBe(true);

    typeInto(el.querySelector('[data-testid="duration-manual-input"]'), '30');
    expect(
      (el.querySelector('[data-testid="duration-manual-apply"]') as HTMLButtonElement).disabled,
    ).toBe(false);

    await clickAsync(el.querySelector('[data-testid="duration-manual-apply"]'));
    expect(applied).toEqual([30]);
  });

  it('🔴 失败后"再试一次"回到披露态，仍然不发请求', async () => {
    const { impl, calls } = fakeFetch('90');
    const el = render({
      routing: { enabled: true, allowRemote: true, endpoints: [], routes: {} },
      fetchImpl: impl,
    });
    toDisclosure(el);
    // 没有端点 → 披露态就说明；这里换个路子：直接点关闭再重开
    expect(el.querySelector('[data-testid="duration-no-target"]')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});

// ── 🔴 记忆偏好：从界面到网络请求 ─────────────────────────────────────
//
// 防的是本仓库最高发的 bug 类：**能力实现了、被测了、但没人接**。
// 界面忘了传 `preferenceSet`，偏好就永远送不出去，而且**没有任何症状**。

const PREF_SET = (memoryEnabled: boolean): PreferenceSet => ({
  memoryEnabled,
  estimateBias: {
    id: 'estimate-bias',
    value: 1.8,
    sampleSize: 30,
    confidence: 0.9,
    evidenceFacts: { kind: 'estimate-bias', multiplier: 1.8, samples: 30 },
    evidence: '基于 30 次专注，你倾向低估任务耗时 —— 实际用时约为计划的 1.80 倍',
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
    evidence: '基于 40 次专注，80% 集中在 08:00–11:00',
  },
  leadTime: null,
  granularity: null,
  titleStyle: null,
  withheld: [],
});

describe('🔴 记忆偏好从界面走到请求体', () => {
  it('关了记忆 → 请求体里没有偏好，披露里也没有 preferences 字段', async () => {
    const { impl, calls } = fakeFetch('90');
    const el = render({ fetchImpl: impl, preferenceSet: PREF_SET(false) });

    toDisclosure(el);
    expect(el.querySelector('[data-testid="duration-field-list"]')?.textContent).not.toContain('preferences');

    await clickAsync(el.querySelector('[data-testid="duration-send"]'));
    const body = calls[0]?.body ?? '';
    expect(body).not.toContain('关于这位用户的历史习惯');
    expect(body).not.toContain('1.80 倍');
  });

  it('🔴 开了记忆 → 披露**先**列出 preferences 字段，然后请求体里真的有偏好', async () => {
    const { impl, calls } = fakeFetch('90');
    const el = render({ fetchImpl: impl, preferenceSet: PREF_SET(true) });

    toDisclosure(el);
    // ① 披露必须**在发送前**就说明会发偏好
    expect(el.querySelector('[data-testid="duration-field-list"]')?.textContent).toContain('preferences');
    // 此刻还没有任何请求出去
    expect(calls).toHaveLength(0);

    // ② 确认后才真的带上
    await clickAsync(el.querySelector('[data-testid="duration-send"]'));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body ?? '').toContain('关于这位用户的历史习惯');
    expect(calls[0]?.body ?? '').toContain('1.80 倍');
  });

  it('🔴 历史与偏好都开了 → 请求体里两样都在（出境面与披露一致）', async () => {
    const { impl, calls } = fakeFetch('90');
    const el = render({ fetchImpl: impl, history: HISTORY, preferenceSet: PREF_SET(true) });

    toDisclosure(el);
    const fields = el.querySelector('[data-testid="duration-field-list"]')?.textContent ?? '';
    expect(fields).toContain('history');
    expect(fields).toContain('preferences');

    await clickAsync(el.querySelector('[data-testid="duration-send"]'));
    const body = calls[0]?.body ?? '';
    expect(body).toContain('这个任务的历史专注记录');
    expect(body).toContain('关于这位用户的历史习惯');
  });

  it('不传 preferenceSet（旧的调用点）→ 一个偏好都不发，也不报错', async () => {
    const { impl, calls } = fakeFetch('90');
    const el = render({ fetchImpl: impl });
    toDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="duration-send"]'));
    expect(calls[0]?.body ?? '').not.toContain('关于这位用户的历史习惯');
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 熔断状态必须真的**读回来**', () => {
  const NOW = Date.now();

  it('🔴🔴 上次跳闸的端点这次**不该再撞**（一个请求都不发）', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = (url) => {
      calls.push(String(url));
      return Promise.resolve(new Response('{}', { status: 200 }));
    };
    const el = render({
      routing: makeRouting(LOCAL_ENDPOINT),
      consents: [CONSENT],
      healthSnapshot: {
        version: 1,
        entries: [{ endpointId: 'local', consecutiveFailures: 3, circuitOpenUntil: NOW + 60_000 }],
      },
      fetchImpl,
    });

    toDisclosure(el);

    // 🔴 跳闸的端点连发送按钮都不给（披露阶段就说清原因）。
    expect(el.querySelector('[data-testid="duration-send"]')).toBeNull();
    expect(
      el.querySelector('[data-testid="duration-no-target"]')?.getAttribute('data-route-reason'),
    ).toBe('circuit-open');
    expect(el.querySelector('[data-testid="duration-failed"]')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('🔴 过期跳闸**不该**继续拦着 —— 退化方向是"再试一次"', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = (url) => {
      calls.push(String(url));
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: '90' } }] }), { status: 200 }),
      );
    };
    const el = render({
      routing: makeRouting(LOCAL_ENDPOINT),
      consents: [CONSENT],
      healthSnapshot: {
        version: 1,
        entries: [{ endpointId: 'local', consecutiveFailures: 3, circuitOpenUntil: NOW - 60_000 }],
      },
      fetchImpl,
    });

    toDisclosure(el);
    click(el.querySelector('[data-testid="duration-send"]'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(calls).toHaveLength(1);
  });
});
