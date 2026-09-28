/**
 * AI 工具调用（模型路径）测试
 * ==============================
 *
 * 六条不许被改坏的规矩：
 *
 *   1. 🔴 **规则命中时一次网络请求都不发** —— 隐私优先，数 `fetch` 次数。
 *   2. 🔴 **`fields` 必须含 `tools`** —— 工具名与说明是出境数据。
 *   3. 🔴 **模型不可信**：目录外 / 未授权 / 坏参数 / 多个调用，一律回问，不猜。
 *   4. 🔴 **写工具只产出提案**：`submit` 次数为 0。
 *   5. 🔴 **一个工具都没授权时不发请求**（送模型也没用）。
 *   6. 🔴 **失败原因用 `packages/ai` 给的句子**，`cause` 带具体原因码。
 */

import { describe, expect, it } from 'vitest';

import type { AiRoutingConfig } from '@heyta/ai';
import type { LocalApiHost, LocalApiItem } from '@heyta/local-api';

import {
  TOOL_CALL_EGRESS_FIELDS,
  buildToolCallInvocation,
  parseToolArguments,
  requestToolCall,
  toToolDescriptors,
} from '../src/ai-tool-call.js';

const ALL_GRANTS = {
  list_tasks: true,
  get_task: true,
  list_projects: true,
  create_task: true,
} as const;

interface Captured {
  url: string;
  body: Record<string, unknown>;
}

function countingFetch(response: unknown): { impl: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const impl = ((url: unknown, init?: { body?: unknown }) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(response) });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function fakeHost(): LocalApiHost & { submits: number } {
  const items: readonly LocalApiItem[] = [{ id: 't1', title: '买牛奶', readable: true }];
  const host = {
    submits: 0,
    listTasks: (): Promise<readonly LocalApiItem[]> => Promise.resolve(items),
    getTask: (): Promise<LocalApiItem | undefined> => Promise.resolve(items[0]),
    listProjects: () => Promise.resolve([{ id: 'p1', name: '工作', taskCount: 1 }]),
    submit: (): Promise<{ ok: true; taskId: string }> => {
      host.submits += 1;
      return Promise.resolve({ ok: true, taskId: 'created-1' });
    },
  };
  return host;
}

const ROUTING: AiRoutingConfig = {
  enabled: true,
  allowRemote: false,
  endpoints: [
    {
      id: 'local-tools',
      label: '本机（支持工具调用）',
      endpoint: 'http://localhost:11434/v1',
      model: 'qwen3:8b',
      capabilities: ['structured_output', 'tool_calling'],
    },
  ],
  routes: { 'tool-calling': [{ endpointId: 'local-tools' }] },
};

/** 模型要求调用某个工具。 */
const toolCallResponse = (name: string, args: string) => ({
  choices: [
    {
      message: {
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name, arguments: args } }],
      },
    },
  ],
});

const deps = (fetchImpl: typeof fetch, host = fakeHost()) => ({
  routing: ROUTING,
  consents: [],
  grants: ALL_GRANTS,
  host,
  routed: { fetchImpl },
});

describe('构造与映射', () => {
  it('🔴 `fields` 含 `tools`（工具名也是出境数据）', () => {
    const invocation = buildToolCallInvocation({ text: '看看任务' }, [
      { name: 'list_tasks', description: '列出任务', parameters: { type: 'object', properties: {} } },
    ]);
    expect(invocation.feature).toBe('tool-calling');
    expect([...invocation.fields]).toEqual([...TOOL_CALL_EGRESS_FIELDS]);
    expect(invocation.fields).toContain('tools');
    expect(invocation.user).toContain('看看任务');
  });

  it('🔴 只映射已授权工具（未授权不可见）', () => {
    const descriptors = toToolDescriptors({ list_tasks: true });
    expect(descriptors.map((d) => d.name)).toEqual(['list_tasks']);
    expect(descriptors[0]?.parameters).toMatchObject({ additionalProperties: false });
  });

  it('parseToolArguments：空串 = 无参；坏 JSON / 数组 / 标量都失败', () => {
    expect(parseToolArguments('')).toEqual({ ok: true, args: {} });
    expect(parseToolArguments('{"limit":3}')).toEqual({ ok: true, args: { limit: 3 } });
    expect(parseToolArguments('{oops').ok).toBe(false);
    expect(parseToolArguments('[1,2]').ok).toBe(false);
    expect(parseToolArguments('"x"').ok).toBe(false);
  });
});

describe('规则优先：命中就不出境', () => {
  it('🔴 规则命中 → via rule，且 fetch 次数为 0', async () => {
    const { impl, calls } = countingFetch(toolCallResponse('list_tasks', '{}'));
    const outcome = await requestToolCall({ text: '列出所有任务' }, deps(impl));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.via).toBe('rule');
    expect(outcome.result.kind).toBe('observation');
    expect(calls).toHaveLength(0);
  });
});

describe('模型路径：严格校验', () => {
  it('模型选中只读工具 → 执行并返回观察；请求体带 tools', async () => {
    const { impl, calls } = countingFetch(toolCallResponse('list_tasks', '{}'));
    const outcome = await requestToolCall({ text: '帮我看看下周三评审要准备什么' }, deps(impl));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.via).toBe('model');
    expect(outcome.result.kind).toBe('observation');
    const body = calls[0]?.body;
    expect(Array.isArray(body?.['tools'])).toBe(true);
    expect(body?.['tool_choice']).toBe('auto');
  });

  it('🔴 模型选中写工具 → 只产出提案，submit 次数为 0', async () => {
    const host = fakeHost();
    const { impl } = countingFetch(toolCallResponse('create_task', '{"title":"写周报"}'));
    const outcome = await requestToolCall({ text: '帮我记一下写周报这件事' }, deps(impl, host));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.kind).toBe('proposal');
    if (outcome.result.kind !== 'proposal') return;
    expect(outcome.result.proposal.intent).toEqual({ action: 'create-task', title: '写周报' });
    expect(host.submits).toBe(0);
  });

  it('🔴 模型编了一个目录外的工具 → failed unknown-tool（不猜）', async () => {
    const { impl } = countingFetch(toolCallResponse('delete_everything', '{}'));
    const outcome = await requestToolCall({ text: '帮我看看下周三评审要准备什么' }, deps(impl));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.kind).toBe('failed');
    if (outcome.result.kind !== 'failed') return;
    expect(outcome.result.reason).toBe('unknown-tool');
  });

  it('🔴 模型调了一个未授权的工具 → denied', async () => {
    const { impl } = countingFetch(toolCallResponse('complete_task', '{"taskId":"t1"}'));
    const outcome = await requestToolCall({ text: '帮我看看下周三评审要准备什么' }, deps(impl));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.kind).toBe('denied');
  });

  it('坏参数 → tool-call-malformed（回问，不猜）', async () => {
    const { impl } = countingFetch(toolCallResponse('list_tasks', '{not json'));
    const outcome = await requestToolCall({ text: '帮我看看下周三评审要准备什么' }, deps(impl));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('tool-call-malformed');
  });

  it('一次要求多个工具 → multiple-tool-calls（单步不挑一个）', async () => {
    const { impl } = countingFetch({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: 'a', function: { name: 'list_tasks', arguments: '{}' } },
              { id: 'b', function: { name: 'list_projects', arguments: '{}' } },
            ],
          },
        },
      ],
    });
    const outcome = await requestToolCall({ text: '帮我看看下周三评审要准备什么' }, deps(impl));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('multiple-tool-calls');
  });

  it('模型只回话、不调工具 → model-returned-text 并把话带出来', async () => {
    const { impl } = countingFetch({ choices: [{ message: { content: '你说的是哪一件事？' } }] });
    const outcome = await requestToolCall({ text: '帮我看看下周三评审要准备什么' }, deps(impl));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('model-returned-text');
    expect(outcome.text).toContain('哪一件事');
  });
});

describe('边界', () => {
  it('空输入 → empty-text，不发请求', async () => {
    const { impl, calls } = countingFetch({});
    const outcome = await requestToolCall({ text: '   ' }, deps(impl));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('empty-text');
    expect(calls).toHaveLength(0);
  });

  it('🔴 一个工具都没授权 → no-granted-tools，不发请求', async () => {
    const { impl, calls } = countingFetch({});
    const outcome = await requestToolCall(
      { text: '帮我看看下周三评审要准备什么' },
      { ...deps(impl), grants: {} },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('no-granted-tools');
    expect(calls).toHaveLength(0);
  });

  it('🔴 路由失败 → ai-unavailable，且 cause 带具体原因码', async () => {
    const { impl } = countingFetch({});
    const outcome = await requestToolCall(
      { text: '帮我看看下周三评审要准备什么' },
      { ...deps(impl), routing: { ...ROUTING, enabled: false } },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('ai-unavailable');
    expect(outcome.cause).toBe('not-configured');
  });
});
