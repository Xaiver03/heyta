/**
 * AI 一句话捕获界面测试
 * =======================
 *
 * 🔴 本文件最重要的是这四条：
 *
 *   1. 🔴 **披露必须发生在发送之前** —— 用户看到"发什么、发给谁"之前，
 *      一个字节都不该出去。
 *   2. 🔴 **AI 的输出不会自己写进数据** —— 必须用户再确认一次。
 *   3. 🔴 **用户可以改** —— 模型给的是候选（尤其日期是它**推算**的）。
 *   4. 🔴 **日期不许猜** —— 模型给坏了就留空，不许补一个"今天"。
 *
 * ⚠️ 全程用假的 `fetchImpl`，**不发任何真实网络请求**。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AiRoutingConfig, EgressConsent, SecretStore } from '@heyta/ai';
import { Priority, type PreferenceSet } from '@heyta/domain';

const { AiCapture, resolveCaptureTarget } = await import('../src/features/ai/AiCapture.js');

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

function makeRouting(
  endpoint: typeof LOCAL_ENDPOINT | typeof REMOTE_ENDPOINT,
): AiRoutingConfig {
  return {
    enabled: true,
    allowRemote: true,
    endpoints: [endpoint],
    routes: { capture: [{ endpointId: endpoint.id }] },
  };
}

const CONSENT: EgressConsent = { feature: 'capture', destination: 'user-endpoint', grantedAt: 1 };

const TEXT = '明天下午三点和张总开周会';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function render(props: Partial<Parameters<typeof AiCapture>[0]> = {}): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <AiCapture
        text={TEXT}
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
    await Promise.resolve();
  });
}

/**
 * 模拟用户改一个输入控件。
 *
 * ⚠️ 必须先拿**原型上的 setter** 再派发事件：直接 `node.value = x`
 * 会被 React 的 value tracker 吃掉，`onChange` 根本不会触发
 * （本仓库既有测试踩过这个，见 `capture-composer.spec.tsx`）。
 * `input` 与 `change` 都派发，因为 React 对文本控件听 `input`、
 * 对下拉框听 `change`。
 */
function setField(el: Element | null | undefined, value: string): void {
  act(() => {
    const node = el as HTMLInputElement | HTMLSelectElement | null;
    if (node === null) return;
    const proto =
      node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** 假端点：返回一段模型风格的文本，并记录打出去的请求。 */
function fakeFetch(content: string): {
  impl: typeof fetch;
  calls: { url: string; body: string }[];
} {
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

/** 假端点：按顺序返回不同的内容（用于测「重试」）。 */
function fakeFetchSequence(contents: readonly string[]): {
  impl: typeof fetch;
  calls: { url: string; body: string }[];
} {
  const calls: { url: string; body: string }[] = [];
  let index = 0;
  const impl = ((url: string, init?: { body?: string }) => {
    calls.push({ url: String(url), body: init?.body ?? '' });
    const content = contents[Math.min(index, contents.length - 1)] ?? '';
    index += 1;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ choices: [{ message: { content } }] }),
      text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content } }] })),
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
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

/** 点开披露面板（还没发送）。 */
function openDisclosure(el: HTMLDivElement): void {
  click(el.querySelector('[data-testid="capture-ai"]'));
}

// ─────────────────────────────────────────────────────────────────────────

describe('resolveCaptureTarget', () => {
  it('识别回环端点为"数据不出设备"', () => {
    const target = resolveCaptureTarget(makeRouting(LOCAL_ENDPOINT));
    expect(target?.isLocal).toBe(true);
    expect(target?.label).toBe('本机 Ollama');
  });

  it('识别远端端点为"数据会离开设备"', () => {
    expect(resolveCaptureTarget(makeRouting(REMOTE_ENDPOINT))?.isLocal).toBe(false);
  });

  it('没有路由时返回 undefined', () => {
    expect(
      resolveCaptureTarget({ enabled: true, allowRemote: true, endpoints: [], routes: {} }),
    ).toBeUndefined();
  });

  it('被禁用的端点不算首选', () => {
    const routing: AiRoutingConfig = {
      enabled: true,
      allowRemote: true,
      endpoints: [{ ...LOCAL_ENDPOINT, disabled: true }],
      routes: { capture: [{ endpointId: 'local' }] },
    };
    expect(resolveCaptureTarget(routing)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 披露必须发生在发送之前', () => {
  it('🔴🔴 点「AI 捕获」**不发任何请求**，只显示披露', () => {
    const { impl, calls } = fakeFetch('{"title":"甲"}');
    const el = render({ fetchImpl: impl });

    openDisclosure(el);

    expect(el.querySelector('[data-testid="capture-disclosure"]')).toBeTruthy();
    // 🔴 但一个请求都没发
    expect(calls).toHaveLength(0);
  });

  it('🔴 披露里写明**发给哪个端点**', () => {
    const el = render();
    openDisclosure(el);
    const dest = el.querySelector('[data-testid="capture-destination"]');
    expect(dest?.textContent).toContain('本机 Ollama');
    expect(dest?.textContent).toContain('http://localhost:11434/v1');
    expect(dest?.textContent).toContain('qwen3:8b');
  });

  it('🔴 披露里写明**发哪几个字段**（含今天与那句话本身）', () => {
    const el = render();
    openDisclosure(el);
    const fields = el.querySelector('[data-testid="capture-field-list"]')?.textContent ?? '';
    expect(fields).toContain('today');
    expect(fields).toContain('text');
  });

  it('🔴 披露里显示**将要发送的那一句**（用户改过输入也看得见）', () => {
    const el = render();
    openDisclosure(el);
    expect(el.querySelector('[data-testid="capture-text-preview"]')?.textContent).toContain(TEXT);
  });

  it('🔴 本机端点标"数据不出设备"，且**不出现**端到端加密警告', () => {
    const el = render();
    openDisclosure(el);
    expect(el.querySelector('[data-testid="capture-destination-kind"]')?.textContent).toContain(
      '不出设备',
    );
    expect(el.querySelector('[data-testid="capture-e2ee-warning"]')).toBeNull();
  });

  it('🔴🔴 远端端点必须出现"不受端到端加密保护"的明文警告', () => {
    const el = render({ routing: makeRouting(REMOTE_ENDPOINT), consents: [CONSENT] });
    openDisclosure(el);
    expect(el.querySelector('[data-testid="capture-destination-kind"]')?.textContent).toContain(
      '离开设备',
    );
    const warn = el.querySelector('[data-testid="capture-e2ee-warning"]');
    expect(warn).toBeTruthy();
    expect(warn?.textContent).toContain('不受端到端加密保护');
  });

  it('没有配置端点时说明该去哪配，且不发请求', () => {
    const { impl, calls } = fakeFetch('{"title":"甲"}');
    const el = render({
      routing: { enabled: true, allowRemote: true, endpoints: [], routes: {} },
      fetchImpl: impl,
    });
    openDisclosure(el);
    expect(el.querySelector('[data-testid="capture-no-target"]')?.textContent).toContain('设置');
    expect(calls).toHaveLength(0);
  });

  it('🔴 取消之后不发请求', () => {
    const { impl, calls } = fakeFetch('{"title":"甲"}');
    const el = render({ fetchImpl: impl });
    openDisclosure(el);
    click(el.querySelector('[data-testid="capture-cancel"]'));
    expect(calls).toHaveLength(0);
    expect(el.querySelector('[data-testid="capture-ai"]')).toBeTruthy();
  });

  it('🔴 输入为空时按钮不可点（没有可解析的东西）', () => {
    const el = render({ text: '   ' });
    const button = el.querySelector('[data-testid="capture-ai"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('按了「发送」才会真的发', async () => {
    const { impl, calls } = fakeFetch('{"title":"甲"}');
    const el = render({ fetchImpl: impl });
    openDisclosure(el);
    expect(calls).toHaveLength(0);
    await clickAsync(el.querySelector('[data-testid="capture-send"]'));
    expect(calls).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 AI 的输出不会自己写进数据', () => {
  it('🔴 拿到结果后**没有**自动调用 onApply', async () => {
    const applied: unknown[] = [];
    const { impl } = fakeFetch('{"title":"和张总开周会"}');
    const el = render({
      fetchImpl: impl,
      onApply: (fields) => {
        applied.push(fields);
        return Promise.resolve();
      },
    });
    openDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="capture-send"]'));

    expect(el.querySelector('[data-testid="capture-proposal"]')).toBeTruthy();
    // 🔴 但还没有写进任何地方
    expect(applied).toHaveLength(0);
  });

  it('🔴 用户确认后写入，字段与模型给的一致', async () => {
    const applied: { title: string; dueDate?: string; priority?: Priority }[] = [];
    const { impl } = fakeFetch(
      '{"title":"和张总开周会","dueDate":"2026-09-26T15:00:00","priority":"high"}',
    );
    const el = render({
      fetchImpl: impl,
      onApply: (fields) => {
        applied.push(fields);
        return Promise.resolve();
      },
    });
    openDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="capture-send"]'));
    await clickAsync(el.querySelector('[data-testid="capture-apply"]'));

    expect(applied).toHaveLength(1);
    expect(applied[0]?.title).toBe('和张总开周会');
    expect(applied[0]?.dueDate).toBe('2026-09-26T15:00:00');
    expect(applied[0]?.priority).toBe(Priority.High);
  });

  it('🔴 结果渲染成**可编辑**的控件（标题/日期/时间/优先级都在）', async () => {
    const { impl } = fakeFetch('{"title":"甲","dueDate":"2026-09-26T15:00:00","priority":"low"}');
    const el = render({ fetchImpl: impl });
    openDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="capture-send"]'));

    const title = el.querySelector('[data-testid="capture-title"]') as HTMLInputElement;
    const date = el.querySelector('[data-testid="capture-due-date"]') as HTMLInputElement;
    const time = el.querySelector('[data-testid="capture-due-time"]') as HTMLInputElement;
    const priority = el.querySelector('[data-testid="capture-priority"]') as HTMLSelectElement;
    expect(title.value).toBe('甲');
    expect(date.value).toBe('2026-09-26');
    expect(time.value).toBe('15:00');
    expect(priority.value).toBe('low');
  });

  it('🔴 用户改了标题 → onApply 收到**改后**的标题（候选不是事实）', async () => {
    const applied: { title: string }[] = [];
    const { impl } = fakeFetch('{"title":"开会"}');
    const el = render({
      fetchImpl: impl,
      onApply: (fields) => {
        applied.push(fields);
        return Promise.resolve();
      },
    });
    openDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="capture-send"]'));

    setField(el.querySelector('[data-testid="capture-title"]'), '和张总开周会');
    await clickAsync(el.querySelector('[data-testid="capture-apply"]'));

    expect(applied[0]?.title).toBe('和张总开周会');
  });

  it('🔴 用户改了日期 → onApply 收到改后的日期', async () => {
    const applied: { dueDate?: string }[] = [];
    const { impl } = fakeFetch('{"title":"开会","dueDate":"2026-09-26"}');
    const el = render({
      fetchImpl: impl,
      onApply: (fields) => {
        applied.push(fields);
        return Promise.resolve();
      },
    });
    openDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="capture-send"]'));

    setField(el.querySelector('[data-testid="capture-due-date"]'), '2026-10-01');
    await clickAsync(el.querySelector('[data-testid="capture-apply"]'));

    expect(applied[0]?.dueDate).toBe('2026-10-01');
  });

  it('🔴 用户清空日期 → 写入时**没有**截止时间（不是补一个）', async () => {
    const applied: { dueDate?: string }[] = [];
    const { impl } = fakeFetch('{"title":"开会","dueDate":"2026-09-26"}');
    const el = render({
      fetchImpl: impl,
      onApply: (fields) => {
        applied.push(fields);
        return Promise.resolve();
      },
    });
    openDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="capture-send"]'));

    setField(el.querySelector('[data-testid="capture-due-date"]'), '');
    await clickAsync(el.querySelector('[data-testid="capture-apply"]'));

    expect(applied[0]?.dueDate).toBeUndefined();
  });

  it('🔴 用户把优先级改成"不设置" → 写入时**没有** priority', async () => {
    const applied: { priority?: Priority }[] = [];
    const { impl } = fakeFetch('{"title":"开会","priority":"high"}');
    const el = render({
      fetchImpl: impl,
      onApply: (fields) => {
        applied.push(fields);
        return Promise.resolve();
      },
    });
    openDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="capture-send"]'));

    setField(el.querySelector('[data-testid="capture-priority"]'), '');
    await clickAsync(el.querySelector('[data-testid="capture-apply"]'));

    expect(applied[0]?.priority).toBeUndefined();
  });

  it('"不要了"不写入', async () => {
    const applied: unknown[] = [];
    const { impl } = fakeFetch('{"title":"甲"}');
    const el = render({
      fetchImpl: impl,
      onApply: (fields) => {
        applied.push(fields);
        return Promise.resolve();
      },
    });
    openDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="capture-send"]'));
    click(el.querySelector('[data-testid="capture-discard"]'));
    expect(applied).toHaveLength(0);
  });

  it('确认写入后显示"已填入候选字段"', async () => {
    const { impl } = fakeFetch('{"title":"甲"}');
    const el = render({ fetchImpl: impl });
    openDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="capture-send"]'));
    await clickAsync(el.querySelector('[data-testid="capture-apply"]'));
    expect(el.querySelector('[data-testid="capture-applied"]')).toBeTruthy();
  });

  it('🔴 结果里标出**这份候选来自哪里**', async () => {
    const { impl } = fakeFetch('{"title":"甲"}');
    const el = render({ fetchImpl: impl });
    openDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="capture-send"]'));
    expect(el.querySelector('[data-testid="capture-proposal-source"]')?.textContent).toContain(
      '本机',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔴 日期只是候选
// ─────────────────────────────────────────────────────────────────────────

describe('🔴 日期不许猜', () => {
  it('🔴 模型给的日期不成立 → 界面明说"没法用、已留空"，且日期控件是空的', async () => {
    const { impl } = fakeFetch('{"title":"开会","dueDate":"明天下午三点"}');
    const el = render({ fetchImpl: impl });
    openDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="capture-send"]'));

    expect(el.querySelector('[data-testid="capture-dropped"]')?.textContent).toContain('截止时间');
    const date = el.querySelector('[data-testid="capture-due-date"]') as HTMLInputElement;
    expect(date.value).toBe('');
  });

  it('🔴 模型没给日期 → 日期控件为空，**不是今天**', async () => {
    const { impl } = fakeFetch('{"title":"买牛奶"}');
    const el = render({ fetchImpl: impl });
    openDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="capture-send"]'));

    const date = el.querySelector('[data-testid="capture-due-date"]') as HTMLInputElement;
    const time = el.querySelector('[data-testid="capture-due-time"]') as HTMLInputElement;
    expect(date.value).toBe('');
    expect(time.value).toBe('');
    expect(el.querySelector('[data-testid="capture-dropped"]')).toBeNull();
  });

  it('🔴 只给了日期时**不补时间**（补 00:00 就是把"那一天"改成了"那一刻"）', async () => {
    const { impl } = fakeFetch('{"title":"开会","dueDate":"2026-09-26"}');
    const el = render({ fetchImpl: impl });
    openDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="capture-send"]'));

    const date = el.querySelector('[data-testid="capture-due-date"]') as HTMLInputElement;
    const time = el.querySelector('[data-testid="capture-due-time"]') as HTMLInputElement;
    expect(date.value).toBe('2026-09-26');
    expect(time.value).toBe('');
  });

  it('🔴 结果面板明确告诉用户"日期是模型的推算，请核对"', async () => {
    const { impl } = fakeFetch('{"title":"开会","dueDate":"2026-09-26"}');
    const el = render({ fetchImpl: impl });
    openDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="capture-send"]'));
    expect(el.querySelector('[data-testid="capture-proposal"]')?.textContent).toContain('推算');
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('失败路径', () => {
  it('🔴 未授权远端时失败，提示去逐功能授权，且**请求没发出去**', async () => {
    const { impl, calls } = fakeFetch('{"title":"甲"}');
    const el = render({ routing: makeRouting(REMOTE_ENDPOINT), consents: [], fetchImpl: impl });
    openDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="capture-send"]'));

    expect(el.querySelector('[data-testid="capture-failure-message"]')?.textContent).toContain(
      '授权',
    );
    expect(calls).toHaveLength(0);
  });

  it('🔴 模型返回一坨废话 → 显示"没能捕获"，并提供**重试**', async () => {
    const { impl, calls } = fakeFetchSequence([
      '抱歉，我无法完成这个任务。',
      '{"title":"和张总开周会"}',
    ]);
    const applied: unknown[] = [];
    const el = render({
      fetchImpl: impl,
      onApply: (fields) => {
        applied.push(fields);
        return Promise.resolve();
      },
    });
    openDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="capture-send"]'));

    expect(el.querySelector('[data-testid="capture-failed"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="capture-failure-message"]')?.textContent).toContain(
      '没法读成任务字段',
    );
    expect(calls).toHaveLength(1);
    // 还没写任何东西
    expect(applied).toHaveLength(0);

    // 重试：用**同一句话**再发一次
    await clickAsync(el.querySelector('[data-testid="capture-retry"]'));
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).toContain(TEXT);
    expect(el.querySelector('[data-testid="capture-proposal"]')).toBeTruthy();
  });

  it('🔴 关闭失败面板后回到按钮态', async () => {
    const { impl } = fakeFetch('废话');
    const el = render({ fetchImpl: impl });
    openDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="capture-send"]'));
    click(el.querySelector('[data-testid="capture-cancel-failed"]'));
    expect(el.querySelector('[data-testid="capture-ai"]')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 熔断状态必须真的**读回来**', () => {
  const NOW = Date.now();

  const TRIPPED = {
    version: 1,
    entries: [{ endpointId: 'local', consecutiveFailures: 3, circuitOpenUntil: NOW + 60_000 }],
  };

  const STALE = {
    version: 1,
    entries: [{ endpointId: 'local', consecutiveFailures: 3, circuitOpenUntil: NOW - 60_000 }],
  };

  it('🔴🔴 上次跳闸的端点这次**不该再撞**（一个请求都不发）', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = (url) => {
      calls.push(String(url));
      return Promise.resolve(new Response('{}', { status: 200 }));
    };
    const el = render({ healthSnapshot: TRIPPED, fetchImpl });

    openDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="capture-send"]'));

    expect(calls).toHaveLength(0);
    expect(el.querySelector('[data-testid="capture-failed"]')).toBeTruthy();
  });

  it('🔴 过期跳闸**不该**继续拦着 —— 退化方向是"再试一次"', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = (url) => {
      calls.push(String(url));
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: '{"title":"甲"}' } }] }), {
          status: 200,
        }),
      );
    };
    const el = render({ healthSnapshot: STALE, fetchImpl });

    openDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="capture-send"]'));

    expect(calls).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('🔴🔴 披露必须是**三维**：发给谁 / 发什么 / 留多久', () => {
  it('🔴🔴 本机端点：明说"未离开设备"', () => {
    const el = render({ consents: [CONSENT] });
    openDisclosure(el);
    expect(el.querySelector('[data-testid="capture-retention-text"]')?.textContent).toContain(
      '未离开设备',
    );
  });

  it('🔴🔴 远端端点：明说"保留策略由你的端点决定，heyta 无从知晓"', () => {
    const el = render({ routing: makeRouting(REMOTE_ENDPOINT), consents: [CONSENT] });
    openDisclosure(el);
    expect(el.querySelector('[data-testid="capture-retention-text"]')?.textContent).toContain(
      'heyta 无从知晓',
    );
  });

  it('🔴 三维都在（发给谁 / 发什么 / 留多久）', () => {
    const el = render({ routing: makeRouting(REMOTE_ENDPOINT), consents: [CONSENT] });
    openDisclosure(el);
    expect(el.querySelector('[data-testid="capture-destination"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="capture-field-list"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="capture-retention-text"]')).toBeTruthy();
  });

  it('🔴 披露文案来自 buildDisclosure（不是界面自己写的）', async () => {
    const { buildDisclosure } = await import('@heyta/ai');
    const expected = buildDisclosure({
      feature: 'capture',
      destination: 'user-endpoint',
      fields: [],
    });
    const el = render({ routing: makeRouting(REMOTE_ENDPOINT), consents: [CONSENT] });
    openDisclosure(el);
    // 🔴 两边必须逐字一致 —— 界面自己写一份就会漂移
    expect(el.querySelector('[data-testid="capture-retention-text"]')?.textContent).toBe(
      expected.retentionText,
    );
  });
});

// ── 🔴 记忆偏好：从界面到网络请求 ─────────────────────────────────────

const PREF_SET = (memoryEnabled: boolean): PreferenceSet => ({
  memoryEnabled,
  estimateBias: null,
  deepWorkWindow: null,
  leadTime: null,
  granularity: null,
  titleStyle: {
    id: 'title-style',
    value: { cjkShare: 1, medianTitleLength: 12, emojiShare: 0 },
    sampleSize: 40,
    confidence: 0.9,
    evidenceFacts: { kind: 'title-style', cjkShare: 1, medianTitleLength: 12, emojiShare: 0, samples: 40 },
    evidence: '基于 40 条任务，你的标题以中文为主，平均 12 个字',
  },
  withheld: [],
});

describe('🔴 记忆偏好从界面走到请求体', () => {
  it('关了记忆 → 请求体里没有偏好，披露里也没有 preferences 字段', async () => {
    const { impl, calls } = fakeFetch('{"title":"甲"}');
    const el = render({ fetchImpl: impl, preferenceSet: PREF_SET(false) });

    openDisclosure(el);
    expect(el.querySelector('[data-testid="capture-field-list"]')?.textContent).not.toContain(
      'preferences',
    );

    await clickAsync(el.querySelector('[data-testid="capture-send"]'));
    const body = calls[0]?.body ?? '';
    expect(body).not.toContain('关于这位用户的历史习惯');
    expect(body).not.toContain('任务标题以中文为主');
  });

  it('🔴 开了记忆 → 披露**先**列出 preferences 字段，然后请求体里真的有偏好', async () => {
    const { impl, calls } = fakeFetch('{"title":"甲"}');
    const el = render({ fetchImpl: impl, preferenceSet: PREF_SET(true) });

    openDisclosure(el);

    // ① 披露必须**在发送前**就说明会发偏好
    expect(el.querySelector('[data-testid="capture-field-list"]')?.textContent).toContain(
      'preferences',
    );
    // 此刻还没有任何请求出去
    expect(calls).toHaveLength(0);

    // ② 确认后才真的带上
    await clickAsync(el.querySelector('[data-testid="capture-send"]'));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body ?? '').toContain('关于这位用户的历史习惯');
    expect(calls[0]?.body ?? '').toContain('任务标题以中文为主');
  });

  it('不传 preferenceSet（旧的调用点）→ 一个偏好都不发，也不报错', async () => {
    const { impl, calls } = fakeFetch('{"title":"甲"}');
    const el = render({ fetchImpl: impl });
    openDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="capture-send"]'));
    expect(calls[0]?.body ?? '').not.toContain('关于这位用户的历史习惯');
  });
});

// ── 🔴 反馈层：处置必须被记录 ─────────────────────────────────────────

describe('🔴 反馈层：处置必须被记录', () => {
  async function toProposalWith(
    content: string,
    onFeedback?: (fb: { outcome: string; proposedCount: number; appliedCount: number }) => void,
  ): Promise<HTMLDivElement> {
    const { impl } = fakeFetch(content);
    const el = render({
      fetchImpl: impl,
      ...(onFeedback === undefined ? {} : { onFeedback }),
    });
    openDisclosure(el);
    await clickAsync(el.querySelector('[data-testid="capture-send"]'));
    return el;
  }

  it('原样确认 → accepted，提议数 = 采用数', async () => {
    const seen: { outcome: string; proposedCount: number; appliedCount: number }[] = [];
    const el = await toProposalWith(
      '{"title":"甲","dueDate":"2026-09-26","priority":"high"}',
      (fb) => seen.push(fb),
    );

    await clickAsync(el.querySelector('[data-testid="capture-apply"]'));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.outcome).toBe('accepted');
    expect(seen[0]?.proposedCount).toBe(3);
    expect(seen[0]?.appliedCount).toBe(3);
  });

  it('🔴 改了标题 → modified', async () => {
    const seen: { outcome: string; appliedCount: number }[] = [];
    const el = await toProposalWith('{"title":"甲"}', (fb) => seen.push(fb));

    setField(el.querySelector('[data-testid="capture-title"]'), '乙');
    await clickAsync(el.querySelector('[data-testid="capture-apply"]'));

    expect(seen[0]?.outcome).toBe('modified');
  });

  it('🔴 清掉日期 → modified，且采用数少 1', async () => {
    const seen: { outcome: string; appliedCount: number }[] = [];
    const el = await toProposalWith('{"title":"甲","dueDate":"2026-09-26"}', (fb) => seen.push(fb));

    setField(el.querySelector('[data-testid="capture-due-date"]'), '');
    await clickAsync(el.querySelector('[data-testid="capture-apply"]'));

    expect(seen[0]?.outcome).toBe('modified');
    expect(seen[0]?.appliedCount).toBe(1);
  });

  it('🔴 模型给 none、用户没动 → **不算** modified（None 与"不设置"是同一件事）', async () => {
    const seen: { outcome: string }[] = [];
    const el = await toProposalWith('{"title":"甲","priority":"none"}', (fb) => seen.push(fb));

    await clickAsync(el.querySelector('[data-testid="capture-apply"]'));

    expect(seen[0]?.outcome).toBe('accepted');
  });

  it('🔴 点「不要了」→ rejected，采用数 0', async () => {
    const seen: { outcome: string; appliedCount: number }[] = [];
    const el = await toProposalWith('{"title":"甲"}', (fb) => seen.push(fb));

    click(el.querySelector('[data-testid="capture-discard"]'));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.outcome).toBe('rejected');
    expect(seen[0]?.appliedCount).toBe(0);
  });

  it('不传 onFeedback（旧调用点）→ 不报错，也不记录', async () => {
    const el = await toProposalWith('{"title":"甲"}');
    await clickAsync(el.querySelector('[data-testid="capture-apply"]'));
    expect(el.querySelector('[data-testid="capture-proposal"]')).toBeNull();
  });
});
