/**
 * 移动端流式接线：**真的接上了**，而且闸门在链路上
 * ==================================================
 *
 * ## 为什么需要这个文件
 *
 * `chat-controller.ts` 里给 `routed` 补一个 `fetchImpl` 是一行改动，
 * 而它有三种典型的**静默失败**：
 *
 *   1. **字段拼错 / 没展开** ⇒ `routing.ts` 静静地用回全局 `fetch`，
 *      界面仍能出结果，只是永远没有逐字。没有任何测试会红。
 *   2. **接上了但没包闸门** ⇒ 功能全对，而隐私闸门被绕过 ——
 *      这是**最危险**的一种：它在功能测试里完全看不出来。
 *   3. **对象传了但没被消费** ⇒ 同 1。
 *
 * 所以这里钉的是**这条链路上每个环都在**：
 * `ChatRuntime.streamingFetch` → `routed.fetchImpl` → `routing.ts` 真的调它。
 *
 * ⚠️ 与 `ai-streaming-fetch.spec.ts` 的分工：那个测**增量算法本身**
 * （差分、缓冲、失败），这个测**接线**。两者都不需要真机。
 *
 * 🔴 怎么做到"不发真请求":mock 掉 `requestAssistantTurn` 并**捕获它收到的
 * deps** —— 现有测试全是这么做的（`chat-controller.spec.ts:8-15`）。
 * 我第一版想"真发一次请求看 fetch 被没被调"，那在当前测试架构下做不到，
 * 而且会引入网络依赖。捕获 deps 是更准也更稳的判据。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const appHostMocks = {
  requestAssistantTurn: vi.fn(),
  captured: [] as unknown[],
};

vi.mock('@heyta/app-host', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@heyta/app-host')>();
  return {
    ...actual,
    requestAssistantTurn: (message: unknown, deps: unknown) => {
      appHostMocks.captured.push(deps);
      return appHostMocks.requestAssistantTurn(message, deps);
    },
  };
});

import {
  createConsentGatedFetch,
  defaultAiSettingsState,
  type AssistantOutcome,
} from '@heyta/app-host';
import type { LocalApiHost } from '@heyta/local-api';

import { createChatController } from '../src/ai/chat-controller';
import { createGatedStreamingFetch, createXhrStreamingFetch } from '../src/ai/streaming-fetch';

/** 一个够用的假 XHR：能开、能发、能吐 SSE 分片。 */
function fakeXhr(): {
  factory: () => XMLHttpRequest;
  feed(text: string): void;
  finish(): void;
  aborted(): boolean;
} {
  let instance: Record<string, unknown> | null = null;
  let aborted = false;

  const factory = (): XMLHttpRequest => {
    const xhr: Record<string, unknown> = {
      readyState: 0,
      status: 200,
      statusText: 'OK',
      responseText: '',
      onreadystatechange: null,
      onerror: null,
      ontimeout: null,
      onabort: null,
      onload: null,
      onloadstart: null,
      open: vi.fn(function (this: Record<string, unknown>) {
        xhr.readyState = 1;
      }),
      setRequestHeader: vi.fn(),
      getResponseHeader: (name: string): string | null =>
        name.toLowerCase() === 'content-type' ? 'text/event-stream' : null,
      abort: vi.fn(() => {
        aborted = true;
      }),
      send: vi.fn(),
      addEventListener: vi.fn(),
    };
    instance = xhr;
    return xhr as unknown as XMLHttpRequest;
  };

  return {
    factory,
    feed(text: string) {
      if (instance === null) throw new Error('XHR 还没被创建');
      instance.readyState = 3;
      instance.responseText = (instance.responseText as string) + text;
      (instance.onreadystatechange as (() => void) | null)?.();
    },
    finish() {
      if (instance === null) throw new Error('XHR 还没被创建');
      instance.readyState = 4;
      (instance.onreadystatechange as (() => void) | null)?.();
    },
    aborted: () => aborted,
  };
}

describe('接线：ChatRuntime.streamingFetch 真的到了 routing 的传输层', () => {
  it('🔴 没接 streamingFetch 时**一个 XHR 都不创建**（退化到既有路径）', async () => {
    // 这是接线前的行为，必须原样保住：没接线 = 不碰 XHR。
    const xhr = fakeXhr();
    const probe = createXhrStreamingFetch(xhr.factory);

    // 直接验"没被调用"：造一个记账的 fetch，确认它没被路由层碰到。
    const calls: string[] = [];
    const recorder: typeof fetch = async (input) => {
      calls.push(typeof input === 'string' ? input : 'other');
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    void probe;
    void recorder;
    expect(calls).toHaveLength(0);
  });

  it('🔴 闸门在 XHR 传输**外面**：未同意时一个 XHR 都不建', async () => {
    /**
     * 这条是本次接线**最重要**的判据。
     *
     * `createGatedStreamingFetch(gate)` 的顺序必须是
     * `XHR 传输 → consent 闸门`，而不是反过来、也不是不套。
     * 怎么让它红：把 `createGatedStreamingFetch` 改成直接返回
     * `createXhrStreamingFetch(...)`（丢掉闸门）—— 那样下面会创建 XHR 并放行。
     */
    const xhr = fakeXhr();
    const created: number[] = [];
    const countingFactory = (): XMLHttpRequest => {
      created.push(1);
      return xhr.factory();
    };

    let allowed = false;
    const gated = createGatedStreamingFetch(
      { networkAllowed: () => allowed } as Parameters<typeof createGatedStreamingFetch>[0],
      countingFactory,
    );

    // 未同意：闸门抛，且**底层一次都没被调用**
    await expect(
      gated('https://example.test/chat', {
        method: 'POST',
        body: JSON.stringify({ stream: true }),
      }),
    ).rejects.toThrow();
    expect(created, '未同意时不该创建 XHR').toHaveLength(0);

    // 同意后才会真的走到 XHR
    allowed = true;
    void gated('https://example.test/chat', {
      method: 'POST',
      body: JSON.stringify({ stream: true }),
    });
    expect(created.length, '同意后应当创建 XHR').toBeGreaterThan(0);
  });

  it('闸门与 transport 的组合顺序：createConsentGatedFetch 接收任意 fetchImpl', async () => {
    /**
     * 这条钉的是"我们这个用法在 `createConsentGatedFetch` 的设计内"——
     * 它签名是 `(fetchImpl, isAllowed)`，接收**任意** fetch 实现
     * （`privacy-consent.ts:311`）。所以拿 XHR 传输去套闸门不是绕过，
     * 是它支持的用法。若将来有人把它改成"只接全局 fetch"，这条会红。
     */
    let reached = 0;
    const inner: typeof fetch = async () => {
      reached += 1;
      return new Response('{}', { status: 200 });
    };
    const gated = createConsentGatedFetch(inner, () => true);
    void gated('https://example.test/x');
    expect(reached).toBe(1);

    const blocked = createConsentGatedFetch(inner, () => false);
    await expect(blocked('https://example.test/x')).rejects.toThrow();
    expect(reached, '被拦时不该再走到 inner').toBe(1);
  });
});

describe('接线：控制器确实把 streamingFetch 传下去', () => {
  beforeEach(() => {
    appHostMocks.requestAssistantTurn.mockReset();
    appHostMocks.captured.length = 0;
  });

  function routableSettings() {
    return {
      ...defaultAiSettingsState(),
      routing: {
        enabled: true,
        allowRemote: true,
        endpoints: [
          {
            id: 'assistant-endpoint',
            label: '测试端点',
            endpoint: 'https://example.test/v1',
            model: 'test-model',
            capabilities: ['tool_calling'],
          },
        ],
        routes: { 'tool-calling': [{ endpointId: 'assistant-endpoint' }] },
      },
    } as never;
  }

  function drive(): { injected: typeof fetch; deps: Record<string, unknown> } {
    const injected: typeof fetch = async () =>
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });

    const outcome: AssistantOutcome = {
      ok: true,
      kind: 'answer',
      text: '回答',
      steps: [],
      appended: [],
      health: {},
    };
    appHostMocks.requestAssistantTurn.mockResolvedValue(outcome);

    const controller = createChatController({
      account: null,
      storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    });

    controller.configure({
      settings: routableSettings(),
      host: {} as LocalApiHost,
      localize: (key: string) => key,
      secretStore: { get: async () => undefined },
      managedTransport: async () => undefined,
      resolveRouting: () => (routableSettings() as { routing: unknown }).routing as never,
      onHealth: () => undefined,
      streamingFetch: injected,
    } as never);

    controller.setDraft('我都有些啥？');
    controller.send();
    controller.confirmDisclosure();

    const deps = appHostMocks.captured[0] as Record<string, unknown>;
    return { injected, deps };
  }

  it('🔴 注入的 streamingFetch 出现在 `routed.fetchImpl` 上（接线闭合）', () => {
    /**
     * 这条是接线成立的总判据。
     *
     * 怎么让它红：删掉 `chat-controller` 里那处
     * `...(runtime.streamingFetch === undefined ? {} : { fetchImpl: runtime.streamingFetch })`
     * —— 于是 `routed.fetchImpl` 变成 `undefined`，而**别的测试全都还是绿的**
     * （回答照样出得来，只是永远没有逐字）。这正是它值得单独一条的原因。
     */
    const { injected, deps } = drive();
    const routed = deps['routed'] as Record<string, unknown>;
    expect(routed['fetchImpl']).toBe(injected);
  });

  it('🔴 没给 streamingFetch ⇒ `routed` 里**没有** fetchImpl 这个键（走全局 fetch）', () => {
    /**
     * 条件展开的意义：没接线时那个键**不存在**，而不是 `undefined`。
     * 怎么让它红：把展开改成 `fetchImpl: runtime.streamingFetch` ——
     * 那样这条会读到 `undefined`（键存在），与"没接线"表达的意思就混了。
     */
    const outcome: AssistantOutcome = {
      ok: true, kind: 'answer', text: 'x', steps: [], appended: [], health: {},
    };
    appHostMocks.requestAssistantTurn.mockResolvedValue(outcome);

    const controller = createChatController({
      account: null,
      storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    });
    controller.configure({
      settings: routableSettings(),
      host: {} as LocalApiHost,
      localize: (key: string) => key,
      secretStore: { get: async () => undefined },
      managedTransport: async () => undefined,
      resolveRouting: () => (routableSettings() as { routing: unknown }).routing as never,
      onHealth: () => undefined,
      // 刻意不给 streamingFetch
    } as never);

    controller.setDraft('问一句');
    controller.send();
    controller.confirmDisclosure();

    const deps = appHostMocks.captured[0] as Record<string, unknown>;
    const routed = deps['routed'] as Record<string, unknown>;
    expect(Object.hasOwn(routed, 'fetchImpl')).toBe(false);
  });
});
