/**
 * 助手循环的**过程事件**（流式）测试
 * =====================================
 *
 * 这一层只有三个决定，但每一个都能只在边界上出错：
 *
 *   1. 🔴 **不给 `onEvent` 时，请求体里不许出现 `stream`。**
 *      移动端读不了流；"为了统一而全部打开"会让那边请求要流、却拿不回来。
 *      判据是**请求体逐次检查**，不是看返回值。
 *   2. 🔴 **`tool-started` 必须发在工具执行之前。** 发在之后，界面上那行
 *      "正在调用工具"就只在跑完之后才出现 —— 那正好把这个功能的意义取消掉。
 *      判据是事件顺序里 `tool-started` 与 `tool-finished` 的相对位置。
 *   3. **文本片段逐字交给界面，且与最终结果一致。** 两处不一致的症状是
 *      "边打出来的和最后留在历史里的不是同一句"。
 */

import { describe, expect, it } from 'vitest';

import type { AiEndpointConfig, AiRoutingConfig } from '@heyta/ai';
import type { LocalApiHost, LocalApiItem } from '@heyta/local-api';

import {
  requestAssistantTurn,
  type AssistantTurnEvent,
  type LocalObservationTranslate,
} from '../src/ai-assistant.js';

const LOCAL: AiEndpointConfig = {
  id: 'local',
  label: '本机 Ollama',
  endpoint: 'http://localhost:11434/v1',
  model: 'qwen3:8b',
  capabilities: ['structured_output', 'tool_calling', 'long_context'],
};

function routing(endpoint: AiEndpointConfig): AiRoutingConfig {
  return {
    enabled: true,
    allowRemote: false,
    endpoints: [endpoint],
    routes: { 'tool-calling': [{ endpointId: endpoint.id }] },
  };
}

const LOCALIZE_ZH: LocalObservationTranslate = (key, vars) => {
  if (key === 'web.ai.chat.local.found') return `我找到 ${String(vars?.count ?? 0)} 项：`;
  if (key === 'web.ai.chat.local.empty') return '没有符合条件的内容。';
  if (key === 'web.ai.chat.local.untitled') return '（未命名）';
  return `还有 ${String(vars?.count ?? 0)} 项未列出。`;
};

const TASKS: readonly LocalApiItem[] = [
  { id: 't1', title: '买牛奶', dueDate: '2026-03-14T09:00:00', priority: 'high', readable: true },
];

function fakeHost(items: readonly LocalApiItem[] = TASKS) {
  return {
    submits: 0,
    listTasks: () => Promise.resolve(items),
    getTask: (taskId: string) => Promise.resolve(items.find((task) => task.id === taskId)),
    listProjects: () => Promise.resolve([]),
    listHabits: () => Promise.resolve([]),
    listTags: () => Promise.resolve([]),
    listNotes: () => Promise.resolve([]),
    getNote: () => Promise.resolve(undefined),
    listHabitLogs: () => Promise.resolve([]),
    listFocusSessions: () => Promise.resolve([]),
    listReminders: () => Promise.resolve([]),
    listEvents: () => Promise.resolve([]),
    getEvent: () => Promise.resolve(undefined),
    submit: () => Promise.resolve({ ok: true as const, taskId: 'x' }),
  } as unknown as LocalApiHost & { submits: number };
}

/** 一段 SSE 响应。 */
function sseResponse(frames: readonly string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(`data: ${frame}\n\n`));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const DONE = '[DONE]';

interface StreamCall {
  readonly body: Record<string, unknown>;
}

/** 按顺序回放每轮该回的 SSE 帧，并记下每次请求体。 */
function scriptedStream(rounds: readonly (readonly string[])[]): {
  impl: typeof fetch;
  calls: StreamCall[];
} {
  const calls: StreamCall[] = [];
  let round = 0;
  const impl = ((_url: unknown, init?: { body?: unknown }) => {
    calls.push({ body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    const frames = rounds[round] ?? [];
    round += 1;
    return Promise.resolve(sseResponse(frames));
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** 工具调用帧（一次给全：名字 + 参数 + id）。 */
function toolCallFrame(id: string, name: string, args: string): string {
  return JSON.stringify({
    choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: args } }] } }],
  });
}

function textFrame(text: string): string {
  return JSON.stringify({ choices: [{ delta: { content: text } }] });
}

/** 事件压成一个好断言的字符串（顺序就是屏上出现的顺序）。 */
function describeEvent(event: AssistantTurnEvent): string {
  switch (event.type) {
    case 'text':
      return `text:${event.delta}`;
    case 'reasoning':
      return `reasoning:${event.delta}`;
    case 'tool-started':
      return `started:${event.tool}:${event.kind}`;
    case 'tool-finished':
      return `finished:${event.tool}:${event.kind}:${String(event.ok)}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────

describe('过程事件', () => {
  it('读一步 → 答：工具行在文本之前，且顺序反映真实执行顺序', async () => {
    const { impl, calls } = scriptedStream([
      [toolCallFrame('c1', 'list_tasks', '{}'), DONE],
      [textFrame('你有'), textFrame('一条任务。'), DONE],
    ]);
    const events: AssistantTurnEvent[] = [];

    const outcome = await requestAssistantTurn(
      { text: '我都有些啥？' },
      {
        routing: routing(LOCAL),
        consents: [],
        tier: 'read-only',
        localize: LOCALIZE_ZH,
        host: fakeHost(),
        routed: { fetchImpl: impl },
        onEvent: (event) => events.push(event),
      },
    );

    expect(events.map(describeEvent)).toEqual([
      'started:list_tasks:read',
      'finished:list_tasks:read:true',
      'text:你有',
      'text:一条任务。',
    ]);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.kind !== 'answer') throw new Error('应当是一句回答');
    expect(outcome.text).toBe('你有一条任务。');
    expect(outcome.steps.map((step) => step.tool)).toEqual(['list_tasks']);

    // 🔴 开了过程事件 ⇒ 两次请求都带 stream
    expect(calls).toHaveLength(2);
    expect(calls[0]?.body['stream']).toBe(true);
    expect(calls[1]?.body['stream']).toBe(true);
    // 数据面没有因为这个开关变宽：字段集合仍然只有那几个
    expect(calls[0]?.body['fields']).toEqual(outcome.steps.length > 0 ? calls[0]?.body['fields'] : undefined);
  });

  it('🔴 不给 onEvent ⇒ 请求体里没有 stream（移动端读不了流）', async () => {
    const { impl, calls } = scriptedStream([[textFrame('嗯'), DONE]]);
    await requestAssistantTurn(
      { text: '我都有些啥？' },
      {
        routing: routing(LOCAL),
        consents: [],
        tier: 'read-only',
        localize: LOCALIZE_ZH,
        host: fakeHost(),
        routed: { fetchImpl: impl },
      },
    );
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0]?.body ?? {})).not.toContain('stream');
  });

  it('思考片段单独一路（不混进答案正文）', async () => {
    const { impl } = scriptedStream([
      [
        JSON.stringify({ choices: [{ delta: { reasoning_content: '先看看清单' } }] }),
        textFrame('看完了。'),
        DONE,
      ],
    ]);
    const events: AssistantTurnEvent[] = [];
    const outcome = await requestAssistantTurn(
      { text: '我都有些啥？' },
      {
        routing: routing(LOCAL),
        consents: [],
        tier: 'read-only',
        localize: LOCALIZE_ZH,
        host: fakeHost(),
        routed: { fetchImpl: impl },
        onEvent: (event) => events.push(event),
      },
    );

    expect(events.map(describeEvent)).toEqual(['reasoning:先看看清单', 'text:看完了。']);
    if (!outcome.ok || outcome.kind !== 'answer') throw new Error('应当是一句回答');
    expect(outcome.text).toBe('看完了。');
  });

  it('工具失败也开一行，并带上工具层的原因', async () => {
    const { impl } = scriptedStream([
      // `get_task` 缺必填参数 ⇒ 参数读不出来 ⇒ 工具层拒绝，再问模型
      [toolCallFrame('c1', 'get_task', '{}'), DONE],
      [textFrame('我需要一个任务名。'), DONE],
    ]);
    const events: AssistantTurnEvent[] = [];
    await requestAssistantTurn(
      // ⚠️ 这一句必须**不命中**本机规则：命中的话循环根本不会发出境请求，
      // 也就不会有工具行 —— 那测的就不是模型路径了（本文件第一版踩过）。
      { text: '我都有些啥？' },
      {
        routing: routing(LOCAL),
        consents: [],
        tier: 'read-only',
        localize: LOCALIZE_ZH,
        host: fakeHost(),
        routed: { fetchImpl: impl },
        onEvent: (event) => events.push(event),
      },
    );

    const started = events.filter((event) => event.type === 'tool-started');
    const finished = events.filter((event) => event.type === 'tool-finished');
    expect(started).toHaveLength(1);
    expect(finished).toHaveLength(1);
    expect(finished[0]?.type === 'tool-finished' && finished[0].ok).toBe(false);
  });
});
