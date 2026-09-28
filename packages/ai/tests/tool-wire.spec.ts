/**
 * 工具线格式测试（`packages/ai`）
 * =================================
 *
 * 四条不许被改坏的规矩：
 *
 *   1. 🔴 **不给工具时，请求体与从前逐字相同** —— 否则给四个既有功能
 *      加工具线格式会静默改变它们的出境数据面。
 *   2. 🔴 **"只调工具、不说话"是合法响应** —— `content` 为空但有 `tool_calls`
 *      不能报 `empty-response`（否则国产端点最常见的形态会被当故障）。
 *   3. 🔴 **响应形状不可信**：坏掉的 `tool_calls` 项要逐项丢掉，不是整份作废。
 *   4. 🔴 **`tool_calling` 能力终于生效**：端点在 `capabilities` 里没显式声明它，
 *      就会被 `'tool-calling'` 功能**排除**（ADR-0010 不做能力推断）。
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FEATURE_CAPABILITIES,
  extractToolCalls,
  invokeRouted,
  resolveRoute,
  type AiEndpointConfig,
  type AiRoutingConfig,
} from '../src/index.js';

/** 声明了 `tool_calling` 的本机端点。 */
const LOCAL_TOOLS: AiEndpointConfig = {
  id: 'local-tools',
  label: '本机（支持工具调用）',
  endpoint: 'http://localhost:11434/v1',
  model: 'qwen3:8b',
  capabilities: ['structured_output', 'tool_calling'],
};

/** 没声明任何能力的本机端点（= 只有基线）。 */
const LOCAL_BASELINE: AiEndpointConfig = {
  id: 'local-baseline',
  label: '本机（未声明能力）',
  endpoint: 'http://localhost:11434/v1',
  model: 'qwen3:8b',
};

const TOOL = {
  name: 'list_tasks',
  description: '列出任务',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
} as const;

function config(overrides: Partial<AiRoutingConfig> = {}): AiRoutingConfig {
  return {
    enabled: true,
    allowRemote: false,
    endpoints: [LOCAL_TOOLS],
    routes: { 'tool-calling': [{ endpointId: 'local-tools' }] },
    ...overrides,
  };
}

interface CapturedCall {
  url: string;
  body: Record<string, unknown>;
}

function captureFetch(response: unknown): { impl: typeof fetch; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const impl = ((url: unknown, init?: { body?: unknown }) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(response) });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const invocation = (withTools: boolean) => ({
  feature: 'tool-calling' as const,
  system: 's',
  user: '帮我看看有什么任务',
  fields: withTools ? ['text', 'tools'] : ['text'],
  ...(withTools ? { tools: [TOOL] } : {}),
});

describe('请求体：tools 只在给了工具时出现', () => {
  it('给了工具 → 序列化成 OpenAI 兼容的 tools + tool_choice', async () => {
    const { impl, calls } = captureFetch({ choices: [{ message: { content: '好的' } }] });
    await invokeRouted(config(), invocation(true), [], undefined, { fetchImpl: impl });

    const body = calls[0]?.body;
    expect(body).toBeDefined();
    expect(body?.['tool_choice']).toBe('auto');
    const tools = body?.['tools'] as readonly { type: string; function: { name: string } }[];
    expect(Array.isArray(tools)).toBe(true);
    expect(tools[0]?.type).toBe('function');
    expect(tools[0]?.function.name).toBe('list_tasks');
  });

  it('🔴 没给工具 → 请求体里**没有** tools 键（既有功能零影响）', async () => {
    const { impl, calls } = captureFetch({ choices: [{ message: { content: '好的' } }] });
    await invokeRouted(
      config({ routes: { 'tool-calling': [{ endpointId: 'local-tools' }] } }),
      invocation(false),
      [],
      undefined,
      { fetchImpl: impl },
    );

    const body = calls[0]?.body;
    expect(body).toBeDefined();
    expect(Object.keys(body ?? {})).toEqual(['model', 'messages']);
  });

  it('tools 为空数组时也**不加**该键（省略 = 与从前一致）', async () => {
    const { impl, calls } = captureFetch({ choices: [{ message: { content: '好的' } }] });
    await invokeRouted(
      config(),
      { ...invocation(false), tools: [] },
      [],
      undefined,
      { fetchImpl: impl },
    );
    expect(Object.keys(calls[0]?.body ?? {})).toEqual(['model', 'messages']);
  });
});

describe('响应：tool_calls 解析', () => {
  it('🔴 只有 tool_calls、content 为空 → 成功（不是 empty-response）', async () => {
    const { impl } = captureFetch({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'list_tasks', arguments: '{}' } },
            ],
          },
        },
      ],
    });
    const outcome = await invokeRouted(config(), invocation(true), [], undefined, {
      fetchImpl: impl,
    });
    expect(outcome.result.ok).toBe(true);
    if (!outcome.result.ok) return;
    expect(outcome.result.suggestion.text).toBe('');
    expect(outcome.result.suggestion.toolCalls).toEqual([
      { id: 'c1', name: 'list_tasks', arguments: '{}' },
    ]);
  });

  it('没有 tool_calls → suggestion.toolCalls 为 undefined（不是空数组）', async () => {
    const { impl } = captureFetch({ choices: [{ message: { content: '今天有三条' } }] });
    const outcome = await invokeRouted(config(), invocation(true), [], undefined, {
      fetchImpl: impl,
    });
    expect(outcome.result.ok).toBe(true);
    if (!outcome.result.ok) return;
    expect(outcome.result.suggestion.toolCalls).toBeUndefined();
    expect(outcome.result.suggestion.text).toBe('今天有三条');
  });

  it('🔴 坏项逐项丢弃；全坏 + 无文本 → empty-response', async () => {
    const { impl } = captureFetch({
      choices: [
        {
          message: {
            content: '',
            tool_calls: [
              { id: 'c1', function: { name: 42, arguments: '{}' } },
              { id: 'c2', function: { arguments: '{}' } },
              { id: 'c3', function: { name: 'ok_tool', arguments: '{}' } },
            ],
          },
        },
      ],
    });
    const outcome = await invokeRouted(config(), invocation(true), [], undefined, {
      fetchImpl: impl,
    });
    expect(outcome.result.ok).toBe(true);
    if (!outcome.result.ok) return;
    // 坏的两项被丢掉，好的留下
    expect(outcome.result.suggestion.toolCalls).toEqual([
      { id: 'c3', name: 'ok_tool', arguments: '{}' },
    ]);
  });
});

describe('extractToolCalls —— 不信任响应形状', () => {
  it('没有 tool_calls → undefined', () => {
    expect(extractToolCalls({ choices: [{ message: { content: 'x' } }] })).toBeUndefined();
    expect(extractToolCalls({})).toBeUndefined();
    expect(extractToolCalls(null)).toBeUndefined();
  });

  it('模型没给 id → 造一个稳定的 call_<index>', () => {
    const calls = extractToolCalls({
      choices: [{ message: { tool_calls: [{ function: { name: 'a', arguments: '{}' } }] } }],
    });
    expect(calls).toEqual([{ id: 'call_0', name: 'a', arguments: '{}' }]);
  });

  it('arguments 不是字符串 → 空串（调用方解析失败会回问，不在这里猜）', () => {
    const calls = extractToolCalls({
      choices: [{ message: { tool_calls: [{ id: 'c', function: { name: 'a', arguments: 7 } }] } }],
    });
    expect(calls).toEqual([{ id: 'c', name: 'a', arguments: '' }]);
  });
});

describe("能力：tool_calling 终于生效", () => {
  it("DEFAULT_FEATURE_CAPABILITIES['tool-calling'] 要求 tool_calling", () => {
    expect(DEFAULT_FEATURE_CAPABILITIES['tool-calling']).toEqual(['tool_calling']);
  });

  it('🔴 未声明 tool_calling 的端点被排除（不做能力推断）', () => {
    const resolution = resolveRoute(
      config({ endpoints: [LOCAL_BASELINE], routes: { 'tool-calling': [{ endpointId: 'local-baseline' }] } }),
      'tool-calling',
      { health: {}, now: 0 },
    );
    expect(resolution.candidates).toHaveLength(0);
    expect(resolution.excluded.map((e) => e.reason)).toContain('capability-missing');
  });
});
