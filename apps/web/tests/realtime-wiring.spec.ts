/**
 * 实时同步（#10）在 **web 宿主**里的接线
 * =========================================
 *
 * 🔴 这个文件钉的是**最后一米**，不是协议本身：
 * `packages/sync-client/src/realtime.ts`（450 行：指数退避 + 抖动 + 上限 + 令牌活取值）
 * 与它自己的 `realtime.spec.ts` **都早就写完了**，服务端的 WS 广播也早就完成 ——
 * 但**没有任何宿主 `createRealtimeClient()`**。
 *
 * ⇒ 症状是"在另一台设备上改了，这边要等很久才出现，而且看起来像同步坏了"。
 * 这与本仓反复记过的"能力齐全、用户收不到"是同一个形状。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这里**只**覆盖宿主接线（客户端行为由 `packages/sync-client/tests/realtime.spec.ts` 覆盖）：
 *
 *   1. 登录之后**真的建了** WebSocket，且 URL 带上了 token 与 clientId；
 *   2. 🔴 地址/令牌变了要**重建**（缓存旧值的症状是"令牌换过之后实时一直连不上"）；
 *   3. 🔴 登出要**断开**（否则那个连接会带着失效令牌在后台一直重连）；
 *   4. 未配置/未登录时**不连**（本地优先下"未登录"是合法状态，不是故障）。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetOpLogForTests, initOpLog } from '../src/lib/oplog.js';
import { useSyncStore } from '../src/features/sync/store.js';

/** 与 `packages/sync-client/tests/realtime.spec.ts` 同形的最小假实现。 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static reset(): void {
    FakeWebSocket.instances = [];
  }

  readonly url: string;
  closeCalls: Array<{ code?: number; reason?: string }> = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
  }
}

/**
 * 🔴 `connect()` 是**异步**的：它先 `await getToken()` 才构造 WebSocket。
 * 所以断言前必须把微任务/宏任务跑完 —— 直接同步断言会永远看到空数组，
 * 而症状是"实时同步没接上"，看起来像接线漏了（第一版就是这么误判的）。
 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

let dbName: string;

beforeEach(async () => {
  const g = globalThis as unknown as {
    indexedDB: IDBFactory;
    IDBKeyRange: typeof IDBKeyRange;
    WebSocket: unknown;
  };
  g.indexedDB = new IDBFactory();
  g.IDBKeyRange = IDBKeyRange;
  // 宿主代码**不注入** `WebSocketImpl`，走 `globalThis.WebSocket` 的默认解析 ——
  // 所以把假的装在这里，顺带证明那条默认路径真的成立。
  g.WebSocket = FakeWebSocket;
  FakeWebSocket.reset();

  dbName = `realtime-wire-${Math.random().toString(36).slice(2)}`;
  __resetOpLogForTests();
  await initOpLog(dbName);
  // 每条用例从"干净、未配置"开始。
  useSyncStore.setState({ baseUrl: '', token: undefined, status: { kind: 'idle' } });
});

afterEach(() => {
  useSyncStore.getState().clearCredentials();
  FakeWebSocket.reset();
});

describe('实时通道在 web 宿主里的接线', () => {
  it('🔴 登录之后**真的建了** WebSocket，且 URL 带上 token 与 clientId', async () => {
    useSyncStore.getState().applyAuthToken('http://127.0.0.1:3000', 'tok-abc');
    await flush();

    expect(FakeWebSocket.instances, '登录之后没有任何 WebSocket —— 实时同步没接上').toHaveLength(1);
    const url = FakeWebSocket.instances[0]!.url;
    expect(url.startsWith('ws://127.0.0.1:3000/api/sync/ws'), `端点不对：${url}`).toBe(true);
    expect(url).toContain('token=tok-abc');
    expect(url).toContain('clientId=');
  });

  it('未配置 / 未登录时**不连**（本地优先下"未登录"是合法状态）', async () => {
    useSyncStore.getState().configure('', '', '');
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('🔴 地址/令牌变了要**重建**连接（缓存旧值的症状是"换过令牌后实时一直连不上"）', async () => {
    useSyncStore.getState().applyAuthToken('http://127.0.0.1:3000', 'tok-1');
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(1);

    useSyncStore.getState().applyAuthToken('http://127.0.0.1:3000', 'tok-2');
    await flush();

    expect(FakeWebSocket.instances, '没有重建 —— 旧连接还在用旧令牌').toHaveLength(2);
    expect(FakeWebSocket.instances[1]!.url).toContain('token=tok-2');
    // 旧那条必须被关掉，否则两条连接并存。
    expect(FakeWebSocket.instances[0]!.closeCalls.length, '旧连接没被关闭').toBeGreaterThan(0);
  });

  it('🔴 登出要**断开**（否则带着失效令牌在后台一直重连）', async () => {
    useSyncStore.getState().applyAuthToken('http://127.0.0.1:3000', 'tok-abc');
    await flush();
    const socket = FakeWebSocket.instances[0]!;

    useSyncStore.getState().clearCredentials();

    expect(socket.closeCalls.length, '登出没有关闭实时连接').toBeGreaterThan(0);
  });

  it('`startRealtime()` 用**当前**凭据启动（冷启动那条路）', async () => {
    // 模拟"从磁盘读回了凭据"：直接写 state（不经过 applyAuthToken，所以此刻还没有连接）。
    useSyncStore.setState({ baseUrl: 'https://sync.example.com', token: 'tok-restored' });
    expect(FakeWebSocket.instances).toHaveLength(0);

    useSyncStore.getState().startRealtime();
    await flush();

    expect(FakeWebSocket.instances, 'startRealtime 没有建连').toHaveLength(1);
    // `https` ⇒ `wss`（与 buildRealtimeUrl 的口径一致）。
    expect(FakeWebSocket.instances[0]!.url.startsWith('wss://sync.example.com/api/sync/ws')).toBe(true);
  });

  it('`startRealtime()` 幂等：连着调两次不会建出两条连接', async () => {
    useSyncStore.getState().applyAuthToken('http://127.0.0.1:3000', 'tok-abc');
    await flush();
    useSyncStore.getState().startRealtime();
    useSyncStore.getState().startRealtime();
    await flush();

    // 每次调用都会 **dispose 旧的再建新的** —— 所以实例数会增加，
    // 但**活着的只应该有一条**。这里断言"旧的那条确实被关了"。
    const alive = FakeWebSocket.instances.filter((s) => s.closeCalls.length === 0);
    expect(alive, '同时有不止一条活着的连接').toHaveLength(1);
  });
});