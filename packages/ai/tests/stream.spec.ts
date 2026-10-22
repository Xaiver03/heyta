/**
 * 流式（SSE）读流测试
 * =====================
 *
 * 这一层最贵的失败不是"流没跑起来"，而是**三种只在边界上出现的事**：
 *
 *   1. **半帧**：一帧跨两个网络分片是常态。按 `\n\n` 切完把尾巴丢掉，
 *      症状是"回答少了最后几个字"，而且只在慢网络下出现 —— 单元测试用
 *      刻意的一字节切分把它钉住。
 *   2. **中途断流**：这时前半句**已经在屏幕上了**。如果路由层按老规则
 *      换端点重试，用户会看到同一句话的前半段被两个不同模型各写一遍。
 *      所以断言是**数请求**：只能有一次。
 *   3. **端点忽略 `stream`**：有些兼容层直接回整份 JSON。按 SSE 读会得到
 *      零帧 ⇒ 若判成"空响应"，用户看到的是"模型没说话"，而真相是
 *      "这个端点不支持流式"。必须退回 JSON 路径。
 *
 * ⚠️ 全程真链路：真 `invokeRouted` + 真 `ReadableStream`，只注入 `fetchImpl`。
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ROUTING_POLICY,
  invokeRouted,
  type AiEndpointConfig,
  type AiRoutingConfig,
  type EgressConsent,
} from '../src/index.js';
import {
  SSE_DONE,
  createCompletionAccumulator,
  splitSseFrames,
  sseData,
} from '../src/stream.js';

// ─────────────────────────────────────────────────────────────────────────
// 台架
// ─────────────────────────────────────────────────────────────────────────

const LOCAL: AiEndpointConfig = {
  id: 'local',
  label: '本机 Ollama',
  endpoint: 'http://localhost:11434/v1',
  model: 'qwen3:8b',
  capabilities: ['structured_output', 'tool_calling'],
};

const LOCAL_SECOND: AiEndpointConfig = {
  ...LOCAL,
  id: 'local-2',
  label: '本机备用',
  endpoint: 'http://localhost:11435/v1',
};

const INVOCATION = {
  feature: 'tool-calling' as const,
  system: 's',
  user: 'u',
  fields: ['text', 'tools'],
};

const CONSENTS: readonly EgressConsent[] = [];

/** 一帧 SSE（负载已序列化）。 */
const frame = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`;

/** 文本增量帧。 */
const textFrame = (text: string): string => frame({ choices: [{ delta: { content: text } }] });

/** 一个真 `Response`，body 是一段 SSE。 */
function sseResponse(chunks: readonly string[], contentType = 'text/event-stream'): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': contentType } });
}

/**
 * 一段在吐出 `prefix` 之后**报错**的流。
 *
 * ⚠️ 用 `pull` 而不是在 `start` 里先入队再 `error()`：后者按 Streams 规范
 * 会把**已入队但没被读走**的块一并丢弃，于是"吐了一半再断"这个前提根本
 * 不成立，测试会变成在测"什么都没吐就断了"（本文件第一版就是这么写的，
 * 断言当场红了）。这与被测代码无关，是台架的错。
 */
function brokenStreamResponse(prefix: readonly string[]): Response {
  const encoder = new TextEncoder();
  let emitted = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = prefix[emitted];
      if (chunk !== undefined) {
        emitted += 1;
        controller.enqueue(encoder.encode(chunk));
        return;
      }
      controller.error(new Error('socket hang up'));
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

interface Recorded {
  readonly url: string;
  readonly rawBody: string;
}

function fetchOnce(response: () => Response): { impl: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const impl = ((url: unknown, init?: { body?: unknown }) => {
    calls.push({ url: String(url), rawBody: String(init?.body ?? '') });
    return Promise.resolve(response());
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function config(endpoints: readonly AiEndpointConfig[] = [LOCAL]): AiRoutingConfig {
  return {
    enabled: true,
    allowRemote: false,
    endpoints: [...endpoints],
    routes: { 'tool-calling': endpoints.map((endpoint) => ({ endpointId: endpoint.id })) },
  };
}

function parseBody(raw: string): Record<string, unknown> {
  return JSON.parse(raw) as Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────
// 纯解析
// ─────────────────────────────────────────────────────────────────────────

describe('SSE 切帧', () => {
  it('保留没切完的尾巴（半帧不许当帧喂给 JSON.parse）', () => {
    const { frames, rest } = splitSseFrames('data: {"a":1}\n\ndata: {"b":');
    expect(frames).toEqual(['data: {"a":1}']);
    expect(rest).toBe('data: {"b":');
  });

  it('CRLF 也切得出来（否则在 CRLF 服务器上一帧都切不出）', () => {
    const { frames, rest } = splitSseFrames('data: {"a":1}\r\n\r\ndata: {"b":2}\r\n\r\n');
    expect(frames).toEqual(['data: {"a":1}', 'data: {"b":2}']);
    expect(rest).toBe('');
  });

  it('没有 data: 行的帧（keep-alive 注释）不算数据', () => {
    expect(sseData(': ping')).toBeUndefined();
    expect(sseData('event: message')).toBeUndefined();
  });

  it('多行 data 按 SSE 规范用换行连接，且只去掉一个前导空格', () => {
    expect(sseData('data:  a\ndata: b')).toBe(' a\nb');
  });
});

describe('分片累加器', () => {
  it('文本增量拼起来，并按帧逐个交出', () => {
    const acc = createCompletionAccumulator();
    expect(acc.accept({ choices: [{ delta: { content: '你' } }] })).toEqual([{ type: 'text', delta: '你' }]);
    acc.accept({ choices: [{ delta: { content: '好' } }] });
    expect(acc.text).toBe('你好');
  });

  it('空字符串与缺失的 delta 不产生片段（别把心跳当内容）', () => {
    const acc = createCompletionAccumulator();
    expect(acc.accept({ choices: [{ delta: { content: '' } }] })).toEqual([]);
    expect(acc.accept({ choices: [{}] })).toEqual([]);
    expect(acc.accept({ nope: true })).toEqual([]);
    expect(acc.text).toBe('');
  });

  it('思考片段单独成一种（与答案正文分开）', () => {
    const acc = createCompletionAccumulator();
    acc.accept({ choices: [{ delta: { reasoning_content: '先看看' } }] });
    acc.accept({ choices: [{ delta: { content: '结论' } }] });
    expect(acc.reasoning).toBe('先看看');
    expect(acc.text).toBe('结论');
  });

  it('工具调用跨帧装配：名字在第一帧、参数被拆成多帧', () => {
    const acc = createCompletionAccumulator();
    const started = acc.accept({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: 'call_a', function: { name: 'list_tasks', arguments: '' } },
            ],
          },
        },
      ],
    });
    expect(started).toEqual([{ type: 'tool-call', index: 0, id: 'call_a', name: 'list_tasks' }]);

    acc.accept({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"limit":' } }] } }],
    });
    acc.accept({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '3}' } }] } }],
    });
    expect(acc.toolCalls).toEqual([
      { id: 'call_a', name: 'list_tasks', arguments: '{"limit":3}' },
    ]);
  });

  it('两个工具调用按 index 排序，没名字的槽位丢掉', () => {
    const acc = createCompletionAccumulator();
    acc.accept({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 1, id: 'b', function: { name: 'get_task', arguments: '{}' } },
              { index: 0, id: 'a', function: { name: 'list_tasks', arguments: '{}' } },
              { index: 2, id: 'c', function: { arguments: '{}' } },
            ],
          },
        },
      ],
    });
    expect(acc.toolCalls.map((call) => call.name)).toEqual(['list_tasks', 'get_task']);
  });

  it('finish_reason 记下来（不参与拼接，但调用方要能看见）', () => {
    const acc = createCompletionAccumulator();
    acc.accept({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
    expect(acc.finishReason).toBe('tool_calls');
  });

  it('[DONE] 是哨兵：它不是 JSON，解析器不该碰它', () => {
    expect(SSE_DONE).toBe('[DONE]');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 路由层：真发、真读
// ─────────────────────────────────────────────────────────────────────────

describe('invokeRouted 的流式路径', () => {
  it('请求带 stream: true，片段逐字回调，最终返回与非流式同形的结果', async () => {
    const { impl, calls } = fetchOnce(() =>
      sseResponse([textFrame('好'), textFrame('的'), `data: ${SSE_DONE}\n\n`]),
    );
    const deltas: string[] = [];

    const out = await invokeRouted(config(), INVOCATION, CONSENTS, DEFAULT_ROUTING_POLICY, {
      fetchImpl: impl,
      onDelta: (delta) => {
        if (delta.type === 'text') deltas.push(delta.delta);
      },
    });

    expect(calls).toHaveLength(1);
    expect(parseBody(calls[0]?.rawBody ?? '')).toMatchObject({ stream: true });
    expect(deltas).toEqual(['好', '的']);
    expect(out.result.ok).toBe(true);
    if (!out.result.ok) throw new Error('unreachable');
    expect(out.result.suggestion.text).toBe('好的');
  });

  it('不加 onDelta 时请求体里**没有** stream（字节形状不许变）', async () => {
    const { impl, calls } = fetchOnce(
      () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '嗯' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await invokeRouted(config(), INVOCATION, CONSENTS, DEFAULT_ROUTING_POLICY, { fetchImpl: impl });
    const body = parseBody(calls[0]?.rawBody ?? '');
    expect(Object.keys(body)).not.toContain('stream');
  });

  it('工具调用从流里装配出来，回给调用方的形状与非流式一致', async () => {
    const { impl } = fetchOnce(() =>
      sseResponse([
        frame({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_1', function: { name: 'list_tasks', arguments: '' } },
                ],
              },
            },
          ],
        }),
        frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"limit":2}' } }] } }] }),
        `data: ${SSE_DONE}\n\n`,
      ]),
    );
    const out = await invokeRouted(config(), INVOCATION, CONSENTS, DEFAULT_ROUTING_POLICY, {
      fetchImpl: impl,
      onDelta: () => undefined,
    });
    if (!out.result.ok) throw new Error(out.result.message);
    expect(out.result.suggestion.toolCalls).toEqual([
      { id: 'call_1', name: 'list_tasks', arguments: '{"limit":2}' },
    ]);
  });

  it('端点忽略 stream 直接回 JSON ⇒ 退回非流式读取，不判成空响应', async () => {
    const { impl } = fetchOnce(
      () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '整份回来了' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const deltas: string[] = [];
    const out = await invokeRouted(config(), INVOCATION, CONSENTS, DEFAULT_ROUTING_POLICY, {
      fetchImpl: impl,
      onDelta: (delta) => {
        if (delta.type === 'text') deltas.push(delta.delta);
      },
    });
    if (!out.result.ok) throw new Error(out.result.message);
    expect(out.result.suggestion.text).toBe('整份回来了');
    expect(deltas, '没有逐字出现，但结果是完整的').toEqual([]);
  });

  it('🔴 中途断流：已经有片段出去 ⇒ **不许换端点重试**', async () => {
    const { impl, calls } = fetchOnce(() => brokenStreamResponse([textFrame('前半句')]));
    const deltas: string[] = [];

    const out = await invokeRouted(
      config([LOCAL, LOCAL_SECOND]),
      INVOCATION,
      CONSENTS,
      DEFAULT_ROUTING_POLICY,
      {
        fetchImpl: impl,
        onDelta: (delta) => {
          if (delta.type === 'text') deltas.push(delta.delta);
        },
      },
    );

    expect(deltas).toEqual(['前半句']);
    expect(calls, '换端点会把前半句重画一遍，所以只能有一次请求').toHaveLength(1);
    expect(out.result.ok).toBe(false);
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.reason).toBe('network');
    expect(out.result.message).toContain('中断');
    // 🔴 "已经有片段出去"是**包内**标记，不许漏进界面拿到的失败对象：
    // 多一个界面不认识的键，词条表就没有它那一句（`ai-failure-parity` 会红）。
    expect(out.result).not.toHaveProperty('partial');
  });

  it('一个片段都没出去就断了 ⇒ 仍然按原策略回退到下一个端点', async () => {
    let call = 0;
    const calls: string[] = [];
    const impl = ((url: unknown) => {
      calls.push(String(url));
      call += 1;
      return Promise.resolve(call === 1 ? brokenStreamResponse([]) : sseResponse([textFrame('备用端点答的')]));
    }) as unknown as typeof fetch;

    const out = await invokeRouted(
      config([LOCAL, LOCAL_SECOND]),
      INVOCATION,
      CONSENTS,
      DEFAULT_ROUTING_POLICY,
      { fetchImpl: impl, onDelta: () => undefined },
    );

    expect(calls).toHaveLength(2);
    if (!out.result.ok) throw new Error(out.result.message);
    expect(out.result.suggestion.text).toBe('备用端点答的');
  });

  it('只会说话的模型：只调工具、不给文本，不算空响应', async () => {
    const { impl } = fetchOnce(() =>
      sseResponse([
        frame({
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, id: 'call_x', function: { name: 'list_tasks', arguments: '{}' } }],
              },
            },
          ],
        }),
        `data: ${SSE_DONE}\n\n`,
      ]),
    );
    const out = await invokeRouted(config(), INVOCATION, CONSENTS, DEFAULT_ROUTING_POLICY, {
      fetchImpl: impl,
      onDelta: () => undefined,
    });
    if (!out.result.ok) throw new Error(out.result.message);
    expect(out.result.suggestion.text).toBe('');
    expect(out.result.suggestion.toolCalls?.[0]?.name).toBe('list_tasks');
  });

  it('空流（只有 [DONE]）仍然是空响应', async () => {
    const { impl } = fetchOnce(() => sseResponse([`data: ${SSE_DONE}\n\n`]));
    const out = await invokeRouted(config(), INVOCATION, CONSENTS, DEFAULT_ROUTING_POLICY, {
      fetchImpl: impl,
      onDelta: () => undefined,
    });
    expect(out.result.ok).toBe(false);
    if (out.result.ok) throw new Error('unreachable');
    expect(out.result.reason).toBe('empty-response');
  });

  it('坏帧跳过，不打死整段（keep-alive 空帧不该让回答失败）', async () => {
    const { impl } = fetchOnce(() =>
      sseResponse([': ping\n\n', 'data: {不是 JSON\n\n', textFrame('还在')]),
    );
    const out = await invokeRouted(config(), INVOCATION, CONSENTS, DEFAULT_ROUTING_POLICY, {
      fetchImpl: impl,
      onDelta: () => undefined,
    });
    if (!out.result.ok) throw new Error(out.result.message);
    expect(out.result.suggestion.text).toBe('还在');
  });

  it('一次字节被切成两半（半帧跨分片）也能读完整', async () => {
    const encoderPayload = `data: ${JSON.stringify({ choices: [{ delta: { content: '跨分片' } }] })}`;
    const { impl } = fetchOnce(() =>
      sseResponse([encoderPayload.slice(0, 20), `${encoderPayload.slice(20)}\n\n`, `data: ${SSE_DONE}\n\n`]),
    );
    const texts: string[] = [];
    const out = await invokeRouted(config(), INVOCATION, CONSENTS, DEFAULT_ROUTING_POLICY, {
      fetchImpl: impl,
      onDelta: (delta) => {
        if (delta.type === 'text') texts.push(delta.delta);
      },
    });
    if (!out.result.ok) throw new Error(out.result.message);
    expect(texts).toEqual(['跨分片']);
  });
});
