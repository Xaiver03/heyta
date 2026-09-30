/**
 * 实时连接器 —— 用**假 WebSocket + 注入定时器**覆盖协议与重连纪律
 * =================================================================
 *
 * 这里**不碰真实时间**：退避用注入的 `sleep` 手动放行，所以"退避时长递增"
 * 是可断言的事实，而不是"睡 1 秒大概够了"的猜。
 *
 * 假 WebSocket 记录构造参数（URL），并允许手动触发 `onopen` / `onmessage` /
 * `onclose` / `onerror` —— 连接生命周期完全由测试驱动，没有网络、没有时序抖动。
 */

import { describe, expect, it, beforeEach } from 'vitest';

import {
  buildRealtimeUrl,
  createRealtimeClient,
  WS_CLOSE_AUTH_FAILURE,
  type WebSocketCloseEventLike,
  type WebSocketLike,
  type WebSocketMessageEventLike,
} from '../src/realtime.js';

/** 一个够用的假 WebSocket：只实现连接器声明要用的那几个成员。 */
class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = [];
  static reset(): void {
    FakeWebSocket.instances = [];
  }
  /** 最后一次 `close()` 的入参，用来断言 dispose 真的关了连接。 */
  closeCalls: Array<{ code?: number; reason?: string }> = [];

  readonly url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: WebSocketMessageEventLike) => void) | null = null;
  onclose: ((event: WebSocketCloseEventLike) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
  }

  // 测试侧手动触发事件 —— 刻意不自动派发，生命周期由用例说了算。
  emitOpen(): void {
    this.onopen?.();
  }
  emitMessage(data: unknown): void {
    this.onmessage?.({ data });
  }
  emitClose(code?: number): void {
    this.onclose?.({ code });
  }
  emitError(): void {
    this.onerror?.(new Error('boom'));
  }
}

/** 手动放行的 `sleep`：记录每次退避时长，由测试决定何时醒来。 */
function createManualSleep(): {
  sleep: (ms: number) => Promise<void>;
  delays: number[];
  release: () => boolean;
  releaseAll: () => void;
} {
  const delays: number[] = [];
  const pending: Array<() => void> = [];
  return {
    delays,
    sleep: (ms: number): Promise<void> => {
      delays.push(ms);
      return new Promise<void>((resolve) => {
        pending.push(resolve);
      });
    },
    release: (): boolean => {
      const resolve = pending.shift();
      if (resolve === undefined) return false;
      resolve();
      return true;
    },
    releaseAll: (): void => {
      while (pending.length > 0) pending.shift()?.();
    },
  };
}

/** 排空微任务 + 一个 0ms 宏任务，让异步连接流程推进到下一个稳定点。 */
const flush = (): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

const BASE_OPTIONS = {
  baseUrl: 'http://10.0.2.2:3000',
  clientId: 'client-A',
  onNewOps: (): void => undefined,
} as const;

beforeEach(() => {
  FakeWebSocket.reset();
});

describe('buildRealtimeUrl — 端点推导', () => {
  it('http → ws、https → wss，去掉尾部斜杠，路径是 /ws', () => {
    expect(buildRealtimeUrl('http://10.0.2.2:3000', 't', 'c')).toBe(
      'ws://10.0.2.2:3000/api/sync/ws?token=t&clientId=c',
    );
    expect(buildRealtimeUrl('https://sync.example.com/', 't', 'c')).toBe(
      'wss://sync.example.com/api/sync/ws?token=t&clientId=c',
    );
    // 已经给了 ws/wss 就原样保留。
    expect(buildRealtimeUrl('ws://nas.local:3000', 't', 'c')).toBe(
      'ws://nas.local:3000/api/sync/ws?token=t&clientId=c',
    );
  });

  it('🔴 token 必须 URL 编码（否则 + / = & ? 会改变 query 的含义）', () => {
    const token = 'a b+c/d=e&f?g#h';
    const url = buildRealtimeUrl('https://s.example.com', token, 'client-A');
    expect(url).toContain(`token=${encodeURIComponent(token)}`);
    // 断言它**不等于**未编码的拼法 —— 否则上面的 toContain 会因为巧合通过。
    expect(url).not.toContain(`token=${token}`);
  });
});

describe('createRealtimeClient — 协议', () => {
  it('连接 URL 带 /ws、编码后的 token、正确的 clientId', async () => {
    const token = 'tok en+/=&?';
    const client = createRealtimeClient({
      ...BASE_OPTIONS,
      getToken: () => token,
      WebSocketImpl: FakeWebSocket,
    });

    client.connect();
    await flush();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0]?.url).toBe(
      `ws://10.0.2.2:3000/api/sync/ws?token=${encodeURIComponent(token)}&clientId=client-A`,
    );
    client.dispose();
  });

  it("收到 {type:'new_ops', latestSeq} → onNewOps 被调用且带对的值", async () => {
    const seen: number[] = [];
    const client = createRealtimeClient({
      ...BASE_OPTIONS,
      getToken: () => 't',
      onNewOps: (seq) => seen.push(seq),
      WebSocketImpl: FakeWebSocket,
    });

    client.connect();
    await flush();

    FakeWebSocket.instances[0]?.emitMessage(
      JSON.stringify({ type: 'new_ops', latestSeq: 42, timestamp: 1 }),
    );
    expect(seen).toEqual([42]);

    // 再来一次，值跟着变 —— 证明不是"只报第一次"。
    FakeWebSocket.instances[0]?.emitMessage(
      JSON.stringify({ type: 'new_ops', latestSeq: 43, timestamp: 2 }),
    );
    expect(seen).toEqual([42, 43]);

    client.dispose();
  });

  it('🔴 未知类型 / 坏消息不许崩，也不许误报成新 op', async () => {
    const seen: number[] = [];
    const client = createRealtimeClient({
      ...BASE_OPTIONS,
      getToken: () => 't',
      onNewOps: (seq) => seen.push(seq),
      WebSocketImpl: FakeWebSocket,
    });

    client.connect();
    await flush();
    const ws = FakeWebSocket.instances[0];
    expect(ws).toBeDefined();

    // 服务端已存在但我们不处理的类型（presence）+ 一个未来才有的类型。
    expect(() => {
      ws?.emitMessage(JSON.stringify({ type: 'presence_state', payload: { a: 1 } }));
      ws?.emitMessage(JSON.stringify({ type: 'brand_new_type_from_the_future', x: 1 }));
      // 非 JSON、空、以及 JSON 但不是对象。
      ws?.emitMessage('not json at all');
      ws?.emitMessage('');
      ws?.emitMessage('null');
      ws?.emitMessage(JSON.stringify({ type: 'new_ops' })); // 缺 latestSeq
      ws?.emitMessage(JSON.stringify({ type: 'new_ops', latestSeq: 'nope' }));
      // Node `ws` 给的 Buffer 形态。
      ws?.emitMessage(Buffer.from(JSON.stringify({ type: 'new_ops', latestSeq: 7 })));
    }).not.toThrow();

    // 只有那条合法 new_ops 生效。
    expect(seen).toEqual([7]);
    client.dispose();
  });

  it('宿主 onNewOps 抛错不影响连接（后续消息照常送达）', async () => {
    let calls = 0;
    const client = createRealtimeClient({
      ...BASE_OPTIONS,
      getToken: () => 't',
      onNewOps: () => {
        calls += 1;
        throw new Error('宿主渲染挂了');
      },
      WebSocketImpl: FakeWebSocket,
    });

    client.connect();
    await flush();
    const ws = FakeWebSocket.instances[0];

    expect(() => {
      ws?.emitMessage(JSON.stringify({ type: 'new_ops', latestSeq: 1 }));
    }).not.toThrow();
    expect(() => {
      ws?.emitMessage(JSON.stringify({ type: 'new_ops', latestSeq: 2 }));
    }).not.toThrow();
    expect(calls).toBe(2);

    client.dispose();
  });
});

describe('createRealtimeClient — 重连纪律', () => {
  it('🔴 掉线会重连，且退避时长递增（注入定时器，不花真实时间）', async () => {
    const timer = createManualSleep();
    const client = createRealtimeClient({
      ...BASE_OPTIONS,
      getToken: () => 't',
      WebSocketImpl: FakeWebSocket,
      sleep: timer.sleep,
      random: () => 0, // 固定抖动，让时长可断言
      initialBackoffMs: 1000,
      backoffFactor: 2,
      maxBackoffMs: 30_000,
    });

    client.connect();
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(1);

    // 第一次掉线（1006 = 异常关闭）→ 进入退避。
    FakeWebSocket.instances[0]?.emitClose(1006);
    await flush();
    expect(timer.delays).toEqual([500]); // 1000 * 2^0，equal jitter + random=0 → 一半

    expect(timer.release()).toBe(true);
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(2);

    // 第二次掉线 → 退避必须更长。
    FakeWebSocket.instances[1]?.emitClose(1006);
    await flush();
    expect(timer.delays).toEqual([500, 1000]); // 1000 * 2^1 → 一半

    expect(timer.release()).toBe(true);
    await flush();
    FakeWebSocket.instances[2]?.emitClose(1006);
    await flush();
    expect(timer.delays).toEqual([500, 1000, 2000]);
    // 严格递增：这正是"服务端不会再看到重连风暴"的机制。
    expect(timer.delays[1]).toBeGreaterThan(timer.delays[0] ?? 0);
    expect(timer.delays[2]).toBeGreaterThan(timer.delays[1] ?? 0);

    client.dispose();
  });

  it('退避有上限，不会无限翻倍', async () => {
    const timer = createManualSleep();
    const client = createRealtimeClient({
      ...BASE_OPTIONS,
      getToken: () => 't',
      WebSocketImpl: FakeWebSocket,
      sleep: timer.sleep,
      random: () => 0,
      initialBackoffMs: 1000,
      backoffFactor: 2,
      maxBackoffMs: 4000,
    });

    client.connect();
    await flush();

    for (let i = 0; i < 6; i += 1) {
      FakeWebSocket.instances.at(-1)?.emitClose(1006);
      await flush();
      timer.release();
      await flush();
    }

    // 1000→500, 2000→1000, 4000→2000, 4000→2000, …（封顶在 max）
    expect(timer.delays.at(-1)).toBe(2000);
    expect(Math.max(...timer.delays)).toBe(2000);

    client.dispose();
  });

  it('收到服务端 connected 后归零退避（会话真正建立才算成功）', async () => {
    const timer = createManualSleep();
    const client = createRealtimeClient({
      ...BASE_OPTIONS,
      getToken: () => 't',
      WebSocketImpl: FakeWebSocket,
      sleep: timer.sleep,
      random: () => 0,
      initialBackoffMs: 1000,
    });

    client.connect();
    await flush();
    // 失败一次，退避升到第二档。
    FakeWebSocket.instances[0]?.emitClose(1006);
    await flush();
    timer.release();
    await flush();
    FakeWebSocket.instances[1]?.emitClose(1006);
    await flush();
    expect(timer.delays).toEqual([500, 1000]);

    // 这一次服务端发了 connected → 退避归零。
    timer.release();
    await flush();
    FakeWebSocket.instances[2]?.emitMessage(JSON.stringify({ type: 'connected', userId: 1 }));

    FakeWebSocket.instances[2]?.emitClose(1006);
    await flush();
    expect(timer.delays).toEqual([500, 1000, 500]);

    client.dispose();
  });

  it('🔴 鉴权失败（4003）是终止码：不重连', async () => {
    const timer = createManualSleep();
    const client = createRealtimeClient({
      ...BASE_OPTIONS,
      getToken: () => 'expired',
      WebSocketImpl: FakeWebSocket,
      sleep: timer.sleep,
      random: () => 0,
    });

    client.connect();
    await flush();
    FakeWebSocket.instances[0]?.emitClose(WS_CLOSE_AUTH_FAILURE);
    await flush();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(timer.delays).toEqual([]);
    client.dispose();
  });

  it('未登录（getToken → undefined）不连也不空转', async () => {
    const timer = createManualSleep();
    const client = createRealtimeClient({
      ...BASE_OPTIONS,
      getToken: () => undefined,
      WebSocketImpl: FakeWebSocket,
      sleep: timer.sleep,
    });

    client.connect();
    await flush();

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(timer.delays).toEqual([]);
    client.dispose();
  });

  it('🔴 dispose() 之后不再重连（再触发 onclose、再 connect() 都不行）', async () => {
    const timer = createManualSleep();
    const client = createRealtimeClient({
      ...BASE_OPTIONS,
      getToken: () => 't',
      WebSocketImpl: FakeWebSocket,
      sleep: timer.sleep,
      random: () => 0,
    });

    client.connect();
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(1);

    client.dispose();
    // dispose 立即关闭当前连接。
    expect(FakeWebSocket.instances[0]?.closeCalls).toHaveLength(1);

    // 已经在途的 onclose 迟到（服务端关闭事件）：不许重连。
    FakeWebSocket.instances[0]?.emitClose(1006);
    timer.releaseAll();
    await flush();

    // 宿主手滑再 connect()：也不许重连。
    client.connect();
    timer.releaseAll();
    await flush();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(timer.delays).toEqual([]);
  });

  it('重复 connect() 不会起第二条连接循环', async () => {
    const client = createRealtimeClient({
      ...BASE_OPTIONS,
      getToken: () => 't',
      WebSocketImpl: FakeWebSocket,
    });

    client.connect();
    client.connect();
    client.connect();
    await flush();

    expect(FakeWebSocket.instances).toHaveLength(1);
    client.dispose();
  });

  it('🔴 getToken 每次连接都重新读：第一次 A、第二次 B', async () => {
    const timer = createManualSleep();
    let token = 'A';
    const client = createRealtimeClient({
      ...BASE_OPTIONS,
      getToken: () => token,
      WebSocketImpl: FakeWebSocket,
      sleep: timer.sleep,
      random: () => 0,
    });

    client.connect();
    await flush();
    expect(FakeWebSocket.instances[0]?.url).toContain('token=A');

    // 第一次掉线 → 用户在界面上换了令牌 → 第二次连接必须用新的。
    FakeWebSocket.instances[0]?.emitClose(1006);
    await flush();
    token = 'B';
    timer.release();
    await flush();

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1]?.url).toContain('token=B');
    expect(FakeWebSocket.instances[1]?.url).not.toContain('token=A');

    client.dispose();
  });
});
