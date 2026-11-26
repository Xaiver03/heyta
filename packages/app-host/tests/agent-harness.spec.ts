/**
 * 云端 Agent 循环（原生引擎）测试：多步工具调用 → 回灌 → 最终回答，全程零网络。
 */
import { describe, expect, it } from 'vitest';

import type { CloudToolDescriptor, CloudToolTransport } from '../src/ai-cloud-tools.js';
import { runCloudAgentTurn, type HarnessModelReply, type HarnessToolCall } from '../src/agent-harness.js';

const tools: CloudToolDescriptor[] = [
  { name: 'list_tasks', description: '列任务', parameters: { type: 'object', properties: {}, additionalProperties: false } },
];

function toolCall(name: string, args: Record<string, unknown> = {}, id = 'c1'): HarnessToolCall {
  return { id, name, arguments: args };
}

describe('runCloudAgentTurn（原生云端循环）', () => {
  it('模型发起工具调用 → 经 transport 执行 → 结果回灌 → 出最终回答', async () => {
    const calls: { name: string; args: unknown }[] = [];
    const transport: CloudToolTransport = {
      async invoke(name, args) {
        calls.push({ name, args });
        return { ok: true, data: [{ title: '写周报' }, { title: '开会' }] };
      },
    };
    const scripted: HarnessModelReply[] = [
      { toolCalls: [toolCall('list_tasks', { completed: false })] },
      { text: '你有 2 个任务：写周报、开会。' },
    ];
    const events: string[] = [];
    const result = await runCloudAgentTurn('我有啥任务', {
      transport,
      tools,
      systemPrompt: '你是助手',
      callModel: async () => scripted.shift()!,
      onEvent: (e) => events.push(`${e.type}:${e.tool}`),
    });

    expect(result.text).toBe('你有 2 个任务：写周报、开会。');
    expect(result.steps).toEqual([{ tool: 'list_tasks', ok: true }]);
    expect(calls).toEqual([{ name: 'list_tasks', args: { completed: false } }]);
    expect(events).toEqual(['tool-started:list_tasks', 'tool-finished:list_tasks']);
    // tool 消息带上云端返回的数据
    const toolMsg = result.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.toolCallId).toBe('c1');
    expect(JSON.parse(toolMsg!.content)).toEqual([{ title: '写周报' }, { title: '开会' }]);
  });

  it('工具失败作为 tool 消息回给模型（不中止循环）', async () => {
    const transport: CloudToolTransport = {
      async invoke() {
        return { ok: false, reason: 'not-granted', message: '未授权' };
      },
    };
    const scripted: HarnessModelReply[] = [
      { toolCalls: [toolCall('list_tasks')] },
      { text: '抱歉，读取失败。' },
    ];
    const result = await runCloudAgentTurn('x', {
      transport,
      tools,
      systemPrompt: 's',
      callModel: async () => scripted.shift()!,
    });
    expect(result.steps).toEqual([{ tool: 'list_tasks', ok: false, error: '未授权' }]);
    expect(result.text).toBe('抱歉，读取失败。');
    const toolMsg = result.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('未授权');
  });

  it('有界：模型一直要工具时到 maxSteps 停下并报 stopped', async () => {
    const transport: CloudToolTransport = {
      async invoke() {
        return { ok: true, data: [] };
      },
    };
    const result = await runCloudAgentTurn('loop', {
      transport,
      tools,
      systemPrompt: 's',
      maxSteps: 3,
      callModel: async () => ({ toolCalls: [toolCall('list_tasks')] }),
    });
    expect(result.stopped).toBe('tool-steps');
    expect(result.steps.length).toBe(3);
  });

  it('history 会作为上下文前置', async () => {
    let seen: string[] = [];
    const result = await runCloudAgentTurn('第二轮', {
      transport: { invoke: async () => ({ ok: true, data: [] }) },
      tools,
      systemPrompt: 's',
      history: [
        { role: 'user', content: '第一轮' },
        { role: 'assistant', content: '收到' },
      ],
      callModel: async ({ messages }) => {
        seen = messages.map((m) => `${m.role}:${m.content}`);
        return { text: '好' };
      },
    });
    expect(result.text).toBe('好');
    expect(seen).toEqual(['system:s', 'user:第一轮', 'assistant:收到', 'user:第二轮']);
  });
});


describe('runCloudAgentTurn 幂等键', () => {
  it('给了 runId → 每个工具调用带 runId:s<step>:<callId> 幂等键', async () => {
    const seen: { key?: string }[] = [];
    const transport: CloudToolTransport = {
      invoke: async (_n, _a, _s, opts) => {
        seen.push({ key: opts?.idempotencyKey });
        return { ok: true, data: [] };
      },
    };
    const scripted: HarnessModelReply[] = [
      { toolCalls: [{ id: 'call-9', name: 'list_tasks', arguments: {} }] },
      { text: 'ok' },
    ];
    await runCloudAgentTurn('x', {
      transport,
      tools,
      systemPrompt: 's',
      runId: 'R',
      callModel: async () => scripted.shift()!,
    });
    expect(seen[0]?.key).toBe('R:s0:call-9');
  });
});

describe('工具结果截断（上下文管理）', () => {
  it('超长工具结果被截断并标注', async () => {
    const big = 'x'.repeat(600);
    const transport: CloudToolTransport = { invoke: async () => ({ ok: true, data: big }) };
    const scripted: HarnessModelReply[] = [
      { toolCalls: [{ id: 'c1', name: 'list_tasks', arguments: {} }] },
      { text: 'ok' },
    ];
    const result = await runCloudAgentTurn('x', {
      transport, tools, systemPrompt: 's',
      maxToolResultChars: 100,
      callModel: async () => scripted.shift()!,
    });
    const toolMsg = result.messages.find((m) => m.role === 'tool');
    expect(toolMsg!.content.length).toBeLessThan(200);
    expect(toolMsg!.content).toContain('truncated');
  });
});

describe('工具超时与并行（最佳实践对齐）', () => {
  it('单工具超时 → 失败回灌，循环继续', async () => {
    const transport: CloudToolTransport = { invoke: () => new Promise((res) => setTimeout(() => res({ ok: true, data: 1 }), 500)) };
    const scripted: HarnessModelReply[] = [
      { toolCalls: [{ id: 'c1', name: 'list_tasks', arguments: {} }] },
      { text: 'done' },
    ];
    const result = await runCloudAgentTurn('x', {
      transport, tools, systemPrompt: 's', toolTimeoutMs: 20,
      callModel: async () => scripted.shift()!,
    });
    expect(result.steps[0]).toMatchObject({ ok: false });
    expect(result.text).toBe('done');
  });

  it('parallelSafe 为真时多只读工具并发', async () => {
    let active = 0; let maxActive = 0;
    const transport: CloudToolTransport = { invoke: async () => { active++; maxActive = Math.max(maxActive, active); await new Promise((r) => setTimeout(r, 30)); active--; return { ok: true, data: 1 }; } };
    const scripted: HarnessModelReply[] = [
      { toolCalls: [{ id: 'a', name: 'list_tasks', arguments: {} }, { id: 'b', name: 'list_projects', arguments: {} }] },
      { text: 'ok' },
    ];
    await runCloudAgentTurn('x', { transport, tools, systemPrompt: 's', parallelSafe: () => true, callModel: async () => scripted.shift()! });
    expect(maxActive).toBe(2);
  });
});

describe('有界重试（只读工具）', () => {
  it('只读工具失败一次后重试成功', async () => {
    let n = 0;
    const transport: CloudToolTransport = { invoke: async () => { n += 1; return n === 1 ? { ok: false, reason: 'transient', message: 'transient' } : { ok: true, data: 1 }; } };
    const scripted: HarnessModelReply[] = [{ toolCalls: [{ id: 'c1', name: 'list_tasks', arguments: {} }] }, { text: 'ok' }];
    const result = await runCloudAgentTurn('x', { transport, tools, systemPrompt: 's', retryAttempts: 1, retryBackoffMs: 1, isRetryable: () => true, callModel: async () => scripted.shift()! });
    expect(result.steps[0]!.ok).toBe(true);
    expect(n).toBe(2);
  });
  it('写工具失败不重试', async () => {
    let n = 0;
    const transport: CloudToolTransport = { invoke: async () => { n += 1; return { ok: false, reason: 'boom', message: 'boom' }; } };
    const scripted: HarnessModelReply[] = [{ toolCalls: [{ id: 'c1', name: 'create_task', arguments: {} }] }, { text: 'ok' }];
    await runCloudAgentTurn('x', { transport, tools, systemPrompt: 's', retryAttempts: 2, retryBackoffMs: 1, isRetryable: () => false, callModel: async () => scripted.shift()! });
    expect(n).toBe(1);
  });
});
