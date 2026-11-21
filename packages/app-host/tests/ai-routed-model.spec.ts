/**
 * createRoutedModelCall：把循环的 callModel 接到路由层（离线注入 invoke）。
 */
import { describe, expect, it } from 'vitest';

import type { AiInvocation, AiRoutingConfig, RoutedOutcome } from '@heyta/ai';

import type { CloudToolDescriptor, CloudToolTransport } from '../src/ai-cloud-tools.js';
import { createRoutedModelCall, harnessMessagesToChat, parseToolCallArguments, type RoutedInvoke } from '../src/ai-routed-model.js';
import { runCloudAgentTurn } from '../src/agent-harness.js';

const routing = {} as unknown as AiRoutingConfig;

function okOutcome(suggestion: Record<string, unknown>): RoutedOutcome {
  return {
    result: {
      ok: true,
      suggestion: { feature: 'tool-calling', text: '', destination: 'user-endpoint', ...suggestion },
    },
    attempts: [],
    health: {},
    resolution: {},
  } as unknown as RoutedOutcome;
}
function failOutcome(message: string): RoutedOutcome {
  return {
    result: { ok: false, reason: 'ai-unavailable', message },
    attempts: [],
    health: {},
    resolution: {},
  } as unknown as RoutedOutcome;
}

const tools: CloudToolDescriptor[] = [
  { name: 'list_tasks', description: '列任务', parameters: { type: 'object', properties: {}, additionalProperties: false } },
];

describe('createRoutedModelCall', () => {
  it('组装 AiInvocation：feature/fields/tools/messages 正确，且解析工具参数', async () => {
    let seen: AiInvocation | undefined;
    const invoke: RoutedInvoke = async (_c, invocation) => {
      seen = invocation;
      return okOutcome({ toolCalls: [{ id: 'c1', name: 'list_tasks', arguments: '{"completed":false}' }] });
    };
    const callModel = createRoutedModelCall({ routing, consents: [], invoke });
    const reply = await callModel({
      messages: [
        { role: 'system', content: '你是助手' },
        { role: 'user', content: '我的任务' },
      ],
      tools,
    });

    expect(seen!.feature).toBe('tool-calling');
    expect(seen!.fields).toEqual(['text', 'tools']);
    expect(seen!.tools?.[0]?.name).toBe('list_tasks');
    expect(seen!.messages?.map((m) => m.role)).toEqual(['system', 'user']);
    expect(reply.toolCalls?.[0]).toEqual({ id: 'c1', name: 'list_tasks', arguments: { completed: false } });
  });

  it('模型只回文本 → 无 toolCalls', async () => {
    const callModel = createRoutedModelCall({
      routing,
      consents: [],
      invoke: async () => okOutcome({ text: '你好' }),
    });
    const reply = await callModel({ messages: [{ role: 'user', content: 'hi' }], tools });
    expect(reply).toEqual({ text: '你好' });
  });

  it('路由失败 → 抛错（不吞）', async () => {
    const callModel = createRoutedModelCall({ routing, consents: [], invoke: async () => failOutcome('端点在熔断') });
    await expect(callModel({ messages: [{ role: 'user', content: 'x' }], tools })).rejects.toThrow('端点在熔断');
  });

  it('端到端：循环（runCloudAgentTurn）+ 路由 callModel + 云端工具 命中', async () => {
    const invocations: AiInvocation[] = [];
    const scripted: RoutedOutcome[] = [
      okOutcome({ toolCalls: [{ id: 'c1', name: 'list_tasks', arguments: '{}' }] }),
      okOutcome({ text: '你有 2 个任务。' }),
    ];
    const invoke: RoutedInvoke = async (_c, invocation) => {
      invocations.push(invocation);
      return scripted.shift()!;
    };
    const transport: CloudToolTransport = { invoke: async () => ({ ok: true, data: [{ title: 'A' }, { title: 'B' }] }) };

    const result = await runCloudAgentTurn('我有啥任务', {
      transport,
      tools,
      systemPrompt: '你是助手',
      callModel: createRoutedModelCall({ routing, consents: [], invoke }),
    });

    expect(result.text).toBe('你有 2 个任务。');
    expect(result.steps).toEqual([{ tool: 'list_tasks', ok: true }]);
    // 第二轮请求里应当出现 tool 结果帧（回灌成功）
    expect(invocations[1]!.messages?.some((m) => m.role === 'tool')).toBe(true);
  });
});

describe('辅助函数', () => {
  it('harnessMessagesToChat：tool 帧带 toolCallId，assistant(toolCalls) 不单独发', () => {
    const chat = harnessMessagesToChat([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'list_tasks', arguments: {} }] },
      { role: 'tool', content: '[]', toolCallId: 'c1' },
    ]);
    expect(chat.map((m) => m.role)).toEqual(['system', 'user', 'tool']);
    expect(chat[2]!.toolCallId).toBe('c1');
  });

  it('parseToolCallArguments：坏 JSON → {}', () => {
    expect(parseToolCallArguments('{bad')).toEqual({});
    expect(parseToolCallArguments('{"a":1}')).toEqual({ a: 1 });
  });
});
