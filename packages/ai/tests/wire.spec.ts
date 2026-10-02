/**
 * 线格式的唯一组装点 —— 两条路必须吐出**逐字相同**的字节
 * ======================================================
 *
 * 🔴 这条判据为什么要**行为级**、而不是 grep 一下函数名：
 * `createProvider()`（单端点 / 本机 / 历史路径）与 `invokeRouted()`（生产路径）
 * 原来各自拼一遍 `chat.completions` 的请求体，两边注释互相写"保持同一形状"。
 * 注释拦不住漂移 —— 而这个漂移**恰好是出境数据面**：一条路多发一个字段、
 * 少发一个字段，用户在披露块里看到的和实际发出去的就不是同一件事。
 *
 * 所以这里不做"有没有两份"的文本检查（那种检查改个名字就绕过了），
 * 而是**分别驱动两条真路径**，把它们各自打给 `fetchImpl` 的
 * `url` / `headers` / **原始 body 串**逐字节比对。
 * 任何一边单独改动形状 ⇒ 立刻红。
 *
 * ⚠️ 比对的是 `JSON.stringify` 之前的**原始字符串**，不是解析后的对象：
 * 键的顺序也是线格式的一部分（既有测试按 `Object.keys(body)` 断言），
 * 而且"少一个键"和"键值为 undefined"在序列化后不同。
 */

import { describe, expect, it } from 'vitest';

import {
  createProvider,
  invokeRouted,
  type AiEndpointConfig,
  type AiInvocation,
  type AiRoutingConfig,
} from '../src/index.js';
// ⚠️ 从 `../src/wire.js` 而不是 `../src/index.js` 导入：线格式是**包内接缝**，
// 不是 `@heyta/ai` 的公开 API —— 导出去等于邀请包外的人来拼请求体，
// 而那正是这次要消灭的第二份组装。
import { buildChatRequestBody, chatCompletionsUrl, isEmptyModelResponse } from '../src/wire.js';

const ENDPOINT = 'http://localhost:11434/v1';
const MODEL = 'qwen3:8b';

const TOOL = {
  name: 'list_tasks',
  description: '列出任务',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
} as const;

/** 一次调用发出去的三样东西（原始串，未经解析）。 */
interface WireCall {
  url: string;
  headers: Record<string, string>;
  rawBody: string;
}

function capture(): { impl: typeof fetch; calls: WireCall[] } {
  const calls: WireCall[] = [];
  const impl = ((url: unknown, init?: { body?: unknown; headers?: Record<string, string> }) => {
    calls.push({
      url: String(url),
      headers: { ...(init?.headers ?? {}) },
      rawBody: String(init?.body ?? ''),
    });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ choices: [{ message: { content: '好的' } }] }),
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function invocation(withTools: boolean): AiInvocation {
  return {
    feature: 'tool-calling',
    system: '你是解析器',
    user: '帮我看看有什么任务',
    fields: withTools ? ['text', 'tools'] : ['text'],
    ...(withTools ? { tools: [TOOL] } : {}),
  };
}

const ENDPOINT_CONFIG: AiEndpointConfig = {
  id: 'local',
  label: '本机',
  endpoint: ENDPOINT,
  model: MODEL,
  capabilities: ['structured_output', 'tool_calling'],
  keyRef: 'k1',
};

function routingConfig(): AiRoutingConfig {
  return {
    enabled: true,
    allowRemote: false,
    endpoints: [ENDPOINT_CONFIG],
    routes: { 'tool-calling': [{ endpointId: 'local' }] },
  };
}

/** 走 `createProvider()` 那条路。 */
async function viaProvider(apiKey: string | undefined): Promise<WireCall[]> {
  const { impl, calls } = capture();
  const provider = createProvider(
    { mode: 'own', endpoint: ENDPOINT, model: MODEL, ...(apiKey === undefined ? {} : { apiKey }) },
    { fetchImpl: impl },
  );
  await provider.invoke(invocation(true), []);
  return calls;
}

/** 走 `invokeRouted()` 那条路（密钥经 `SecretStore`，与生产一致）。 */
async function viaRouted(apiKey: string | undefined): Promise<WireCall[]> {
  const { impl, calls } = capture();
  await invokeRouted(
    routingConfig(),
    invocation(true),
    [],
    undefined,
    {
      fetchImpl: impl,
      secretStore: { get: () => Promise.resolve(apiKey) },
    },
  );
  return calls;
}

describe('两条路吐出的字节必须逐字相同（W7 收敛的判据）', () => {
  it('给了工具：url / headers / 请求体原串三样全等', async () => {
    const [provider] = await viaProvider('sk-test');
    const [routed] = await viaRouted('sk-test');

    // 前提：两边**真的**各发了一次请求。少了这一句，"两边都空 ⇒ 相等"会假通过。
    expect(provider).toBeDefined();
    expect(routed).toBeDefined();

    expect(routed?.url).toBe(provider?.url);
    expect(routed?.headers).toEqual(provider?.headers);
    expect(routed?.rawBody).toBe(provider?.rawBody);
  });

  it('🔴 变异点复现：把请求体里的 model 改掉，另一条路不会跟着变', async () => {
    // 这条不是"多写一个测试"，是在证明上面那条判据**有牙齿**：
    // 两条路若仍是两份组装，只改一份时上面的相等断言必须红。
    // 这里用等价手段制造分叉 —— 给一条路换个模型名，比较立刻不等。
    const { impl, calls } = capture();
    const provider = createProvider(
      { mode: 'own', endpoint: ENDPOINT, model: 'OTHER-MODEL', apiKey: 'sk-test' },
      { fetchImpl: impl },
    );
    await provider.invoke(invocation(true), []);
    const [routed] = await viaRouted('sk-test');
    expect(calls[0]?.rawBody).not.toBe(routed?.rawBody);
  });

  it('没给工具时两边都**不加** tools 键（省略 = 与从前一致）', async () => {
    const { impl, calls } = capture();
    const provider = createProvider(
      { mode: 'own', endpoint: ENDPOINT, model: MODEL },
      { fetchImpl: impl },
    );
    await provider.invoke(invocation(false), []);
    const routedCalls = await viaRouted(undefined);
    // ⚠️ `viaRouted` 固定带工具，这里只要它做一次请求来证明"两条路都跑得通"；
    // 无工具的形状比较用同一份 body 构造器完成（见下一条）。
    expect(routedCalls.length).toBe(1);

    expect(Object.keys(JSON.parse(String(calls[0]?.rawBody)) as object)).toEqual([
      'model',
      'messages',
    ]);
  });

  it('没有密钥时两边都**不发**空的 authorization', async () => {
    const [noKeyProvider] = await viaProvider(undefined);
    const [noKeyRouted] = await viaRouted(undefined);
    expect(noKeyProvider?.headers['authorization']).toBeUndefined();
    expect(noKeyRouted?.headers['authorization']).toBeUndefined();

    // 空串同样当成"没有密钥"：发 `Bearer ` 空头会让某些端点直接 401，
    // 症状是"配了地址却连不上"。
    const [emptyKey] = await viaProvider('');
    expect(emptyKey?.headers['authorization']).toBeUndefined();
  });
});

describe('buildChatRequestBody —— 形状本身', () => {
  it('省略 tools 时键恰好是 model + messages', () => {
    const body = buildChatRequestBody(MODEL, invocation(false));
    expect(Object.keys(body)).toEqual(['model', 'messages']);
  });

  it('给了 tools 时键是 model + messages + tools + tool_choice，且 tools 是 function 包装', () => {
    const body = buildChatRequestBody(MODEL, invocation(true));
    expect(Object.keys(body)).toEqual(['model', 'messages', 'tools', 'tool_choice']);
    expect(body['tools']?.[0]?.type).toBe('function');
    expect(body['tools']?.[0]?.function.name).toBe('list_tasks');
    expect(body['tool_choice']).toBe('auto');
  });

  it('messages 恰好两条且顺序是 system, user', () => {
    const body = buildChatRequestBody(MODEL, invocation(false));
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user']);
  });

  it('chatCompletionsUrl 拼在 base 之后（两条路必须同一个串）', () => {
    expect(chatCompletionsUrl(ENDPOINT)).toBe(`${ENDPOINT}/chat/completions`);
  });
});

describe('isEmptyModelResponse —— 判据共享，措辞各留', () => {
  it('🔴 只有 tool_calls、content 为空 → **不是**空响应（否则工具路径被打死）', () => {
    expect(isEmptyModelResponse({ text: '', toolCalls: [{ id: 'c0' }] })).toBe(false);
    expect(isEmptyModelResponse({ text: undefined, toolCalls: [{ id: 'c0' }] })).toBe(false);
  });

  it('既没文本也没工具调用 → 是空响应', () => {
    expect(isEmptyModelResponse({ text: undefined, toolCalls: undefined })).toBe(true);
    expect(isEmptyModelResponse({ text: '   ', toolCalls: undefined })).toBe(true);
  });

  it('有文本 → 不是空响应（哪怕没工具）', () => {
    expect(isEmptyModelResponse({ text: '好的', toolCalls: undefined })).toBe(false);
  });
});
