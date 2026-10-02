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
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么每条用例都要先播种一次「同意」（G-12 把前提改了）
 *
 * WS **不经** `window.fetch`，带闸的那层罩不到它 —— `restartRealtime()` 里那一条
 * `privacyConsent.networkAllowed()` 是它唯一的闸（全仓只有这一个构造点）。
 * 于是本文件的既有四条断言"登录后真的建了连接"**隐含了一个新前提**：
 * 这台设备已经同意过联网。不播种的话它们测的是"没同意所以没连"，
 * 而那正好把这条接线真正要钉的东西（URL 带 token、变了要重建）测丢了。
 *
 * ⚠️ 播种走 `privacyConsentActions.accept()` —— 就是用户点那个按钮走的**同一份**生产代码，
 * 不是往 localStorage 里手写一个自造字符串（那会让测试和真实决定格式各跑各的）。
 * 闸门被拦下的那一半由文件末尾那两条用例正面覆盖，不要因为这里播种了就删它们。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetOpLogForTests, initOpLog } from '../src/lib/oplog.js';
import { useSyncStore } from '../src/features/sync/store.js';
// ⚠️ **不**调 `__resetConsentInstallForTests()` —— 它清的是整个订阅者集合，
// 而同步 store 在**模块求值期**就订阅了一次（`subscribePrivacyConsent`）。
// 清了它，撤回同意时没人重建连接，本文件最后那条"撤下要当场断开"就会红，
// 而红的理由是**测试自己把接线拆了** —— 那种红会把人往生产代码里引。
import { privacyConsent, privacyConsentActions } from '../src/features/privacy/consent-gate.js';

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
  // 🔴 先替用户把「同意并联网」点掉（见文件头）：不这么做，下面四条断言测的是闸门，
  // 不是接线。放在 setState 之后是故意的 —— 播种会通知订阅者重建连接，
  // 而此刻凭据必须是空的，这样那一次通知不会留下连接。
  expect(privacyConsentActions.accept().persisted, '测试环境里 localStorage 不可用').toBe(true);
  expect(privacyConsent.networkAllowed()).toBe(true);
});

afterEach(() => {
  useSyncStore.getState().clearCredentials();
  // 把决定清回"没问过"：闸门是**进程级单例**，不清的话下一条用例继承上一条的同意，
  // 那两条"被拦下"的用例就会因为顺序而时红时绿。
  privacyConsent.revoke();
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

  /* ---------------------------------------------------------------------
   * 🔴 G-12：WS 是**唯一一个不经带闸 fetch 的出口**，所以它必须有自己的一道。
   * 上面每条都播种了同意，那只证明"放行之后接得上"；下面三条正面钉闸本身。
   * ------------------------------------------------------------------ */

  it('🔴 没同意时**一个 WS 都不构造**，凭据齐全也一样（G-12）', async () => {
    privacyConsent.revoke();
    expect(privacyConsent.networkAllowed()).toBe(false);

    useSyncStore.getState().applyAuthToken('http://127.0.0.1:3000', 'tok-abc');
    await flush();

    // 判据是**构造次数 = 0**，不是"连接没成功"。
    // 后者挡不住"先连上再断开"那种实现 —— 对端已经收到过一次带令牌的握手了。
    expect(FakeWebSocket.instances, '没同意就构造了 WebSocket（令牌已经出境）').toHaveLength(0);
  });

  it('🔴 撤回同意要**当场断开**那条连接（界面说"已撤回"而连接还挂着是更坏的状态）', async () => {
    useSyncStore.getState().applyAuthToken('http://127.0.0.1:3000', 'tok-abc');
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(1);
    const socket = FakeWebSocket.instances[0]!;

    privacyConsentActions.revoke();
    await flush();

    expect(socket.closeCalls.length, '撤回同意没有关闭实时连接').toBeGreaterThan(0);
    // 而且不是"关了又连"—— 闸门关闭后不许再构造第二条。
    expect(FakeWebSocket.instances, '撤回之后又重连了一条').toHaveLength(1);
  });

  it('🔴 在面板上点「同意」要**当场**建连，不需要刷新（否则"这次好了下次又坏了"）', async () => {
    privacyConsent.revoke();
    useSyncStore.getState().applyAuthToken('http://127.0.0.1:3000', 'tok-abc');
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(0);

    privacyConsentActions.accept();
    await flush();

    expect(FakeWebSocket.instances, '点了同意没连上，用户要刷新一次才有实时同步').toHaveLength(1);
    expect(FakeWebSocket.instances[0]!.url).toContain('token=tok-abc');
  });
});
