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
  {
    name: 'list_tasks',
    description: '列任务',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    egressFields: ['task.title'],
  },
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
    expect(seen!.fields).toEqual(expect.arrayContaining(['text', 'tools', 'title']));
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

  it('工具观测含未披露字段 → 停发（egress-outside-disclosed-set）', async () => {
    const callModel = createRoutedModelCall({ routing, consents: [], invoke: async () => okOutcome({ text: 'ok' }) });
    await expect(
      callModel({
        messages: [
          { role: 'user', content: 'u' },
          { role: 'tool', content: '{"secret":"x"}', toolCallId: 'c1' },
        ],
        tools,
      }),
    ).rejects.toThrow('egress-outside-disclosed-set');
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
    expect(chat.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    const assistant = chat[2]!;
    expect(assistant.toolCalls?.[0]).toEqual({ id: 'c1', name: 'list_tasks', arguments: '{}' });
    expect(chat[3]!.toolCallId).toBe('c1');
  });

  it('parseToolCallArguments：坏 JSON → {}', () => {
    expect(parseToolCallArguments('{bad')).toEqual({});
    expect(parseToolCallArguments('{"a":1}')).toEqual({ a: 1 });
  });
});

describe('createRoutedModelCall 流式文本', () => {
  it('给了 onTextDelta → 经 deps.onDelta 转发 text 片段（忽略 reasoning）', async () => {
    const seen: string[] = [];
    const invoke: RoutedInvoke = async (_c, _inv, _cons, _p, deps) => {
      deps.onDelta?.({ type: 'reasoning', delta: '思考' });
      deps.onDelta?.({ type: 'text', delta: '你' });
      deps.onDelta?.({ type: 'text', delta: '好' });
      return okOutcome({ text: '你好' });
    };
    const callModel = createRoutedModelCall({ routing, consents: [], invoke, onTextDelta: (t) => seen.push(t) });
    const reply = await callModel({ messages: [{ role: 'user', content: 'hi' }], tools });
    expect(reply).toEqual({ text: '你好' });
    expect(seen).toEqual(['你', '好']);
  });
});

describe('toolChoice 透传（routed model）', () => {
  it('options.toolChoice 进入 AiInvocation.toolChoice', async () => {
    let seen: AiInvocation | undefined;
    const invoke: RoutedInvoke = async (_r, inv) => { seen = inv; return okOutcome({ text: 'ok', toolCalls: [] }); };
    const call = createRoutedModelCall({ routing, toolChoice: 'required', invoke });
    await call({ messages: [{ role: 'user', content: 'x' }], tools });
    expect(seen!.toolChoice).toBe('required');
  });
  it('未设则不出现（旧行为）', async () => {
    let seen: AiInvocation | undefined;
    const invoke: RoutedInvoke = async (_r, inv) => { seen = inv; return okOutcome({ text: 'ok', toolCalls: [] }); };
    const call = createRoutedModelCall({ routing, invoke });
    await call({ messages: [{ role: 'user', content: 'x' }], tools });
    expect('toolChoice' in seen!).toBe(false);
  });
});
