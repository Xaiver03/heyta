/**
 * 桌面壳的**存储宿主**：后端选择 + 页侧传输（B 的页侧判据）
 * ==========================================================
 *
 * ## 它钉住什么
 *
 * 主战场是移动端 + macOS + Windows（ADR-0036 P5）。而桌面壳（M2）此前是
 * "原生壳里包着一个把数据存在 **WebView 自己的 OPFS** 里的 web 应用" ——
 * 壳的 `heyta.sqlite` 与它是**两份**。这一刀让页侧能把存储交给宿主。
 *
 * 两条判据，都必须能因注入转红：
 *
 *   1. **选择**：只有宿主**主动注入端口**时才走 `'shell'`；没有端口时行为
 *      与今天逐字相同（默认 `sqlite`，`VITE_HEYTA_STORAGE=indexeddb` 走回退）。
 *      把 `resolveStorageBackend()` 里的端口判定删掉 ⇒ 第 3 条立刻红。
 *   2. **传输真的通了**：`initOpLog()` 能在宿主端口上完成交握，拿到
 *      **由壳侧给出的** `clientId`，并且恢复期的**存储调用真的穿过了端口**。
 *
 * 🔴 为什么"clientId 非空"就证明一次完整往返：它**只能由壳侧提供**
 * （`ready` 交握），页侧没有别的来源。
 * ⚠️ 但光有交握还不够 —— 所以我们另外记录**壳侧实际收到的调用**，
 * 要求它非空。端口只完成交握、不承载真实流量的那种半坏，会被这一条抓住。
 *
 * ⚠️ 线码的**完备性**不在这里判：它由存储契约那条判据担保
 * （`packages/storage/tests/contract.spec.ts` 的「宿主边界」一项，252/252）。
 * 两条判据分工不同，都要在。
 *
 * ⚠️ 这个文件里**只有一处** `initOpLog()` 调用：它按模块级 Promise 记忆化，
 * 第二次调用拿回同一个 Promise，所以"两条用例各自初始化一次"做不到。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DbOpLogStore,
  INDEXEDDB_SCHEMA,
  MemoryDbAdapter,
  createOpLogWirePort,
  serveOpLogWorker,
} from '@heyta/storage';

import { initOpLog, resolveStorageBackend } from '../src/lib/oplog.js';

/** 一对"裸 JSON"端口 —— 刻意不带线码，模拟 WebView 的宿主边界。 */
function rawJsonPortPair() {
  const pageListeners: Array<(e: { data: unknown }) => void> = [];
  let shellOnMessage: ((e: { data: unknown }) => void) | null = null;
  const roundTrip = (m: unknown): unknown => JSON.parse(JSON.stringify(m)) as unknown;

  const pageSide = {
    postMessage(message: unknown): void {
      const wire = roundTrip(message);
      queueMicrotask(() => shellOnMessage?.({ data: wire }));
    },
    addEventListener(_t: string, l: (e: { data: unknown }) => void): void {
      pageListeners.push(l);
    },
  };
  const shellSide = {
    postMessage(message: unknown): void {
      const wire = roundTrip(message);
      queueMicrotask(() => {
        for (const l of pageListeners) l({ data: wire });
      });
    },
    get onmessage(): ((e: { data: unknown }) => void) | null {
      return shellOnMessage;
    },
    set onmessage(v: ((e: { data: unknown }) => void) | null) {
      shellOnMessage = v;
    },
  };
  return { pageSide, shellSide };
}

type HostWindow = Window & { __heytaHostStoragePort?: unknown; __heytaStorage?: unknown };

afterEach(() => {
  delete (window as HostWindow).__heytaHostStoragePort;
  vi.unstubAllEnvs();
});

describe('存储后端的选择', () => {
  it('没有宿主端口时，照 VITE_HEYTA_STORAGE 走（未设时是 sqlite）', () => {
    /**
     * ⚠️ 这里**不能断言"未设时等于 sqlite"**：`apps/web/vite.config.ts` 的
     * test 段自己就设了 `VITE_HEYTA_STORAGE=indexeddb`（jsdom 里没有 Worker，
     * 走 SQLite 那条路会起不来）。所以判据写成"跟着环境变量走"，
     * 而不是写死一个在测试环境里不成立的默认值。
     */
    vi.stubEnv('VITE_HEYTA_STORAGE', 'sqlite');
    expect(resolveStorageBackend()).toBe('sqlite');
    vi.stubEnv('VITE_HEYTA_STORAGE', 'indexeddb');
    expect(resolveStorageBackend()).toBe('indexeddb');
  });

  it('🔴 宿主注入了端口 ⇒ 走 shell（且优先于环境变量）', () => {
    vi.stubEnv('VITE_HEYTA_STORAGE', 'indexeddb');
    (window as HostWindow).__heytaHostStoragePort = { postMessage: () => undefined };
    expect(resolveStorageBackend()).toBe('shell');
  });
});

describe('页侧传输：initOpLog 能在宿主端口上完成', () => {
  it('🔴 交握成功、后端上报为 shell、clientId 由壳侧给出、且恢复期真的走了端口', async () => {
    // ── 壳那一侧：真的存储栈（这一份就是桌面壳里 Jint 要跑的东西）──
    const shellDb = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
    await shellDb.init();
    const shellStore = new DbOpLogStore(shellDb);

    /**
     * 🔴 记录**壳侧实际收到的调用**。
     *
     * 这是"传输真的通了"的本体判据：后端名与 clientId 都可能只靠**一条**交握
     * 消息就成立。这里要看到 `initOpLog()` 里 `engine.recover()` 期间的
     * **存储调用**真的穿过了端口。端口半坏 ⇒ 这个数组为空。
     */
    const received: string[] = [];
    const recording = new Proxy(shellStore as unknown as Record<string, unknown>, {
      get(target, prop, recv) {
        const value = Reflect.get(target, prop, recv) as unknown;
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          received.push(String(prop));
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });

    const raw = rawJsonPortPair();
    // 🔴 两侧**各包一次**线码 —— 与两个桌面壳将要写的代码逐字相同。
    const shellSide = createOpLogWirePort(raw.shellSide);
    serveOpLogWorker(
      shellSide,
      Promise.resolve({ store: recording as never, clientId: 'shell-client-1' }),
    );

    // 页侧看到的是**裸**端口（宿主注入什么就是什么），由 oplog.ts 自己包线码。
    (window as HostWindow).__heytaHostStoragePort = raw.pageSide;

    await initOpLog('shell-backend-test');

    const reported = (globalThis as { __heytaStorage?: { backend?: string; clientId?: string } })
      .__heytaStorage;
    expect(reported?.backend, '后端必须被上报为 shell（否则"用了哪条路"不可知）').toBe('shell');
    expect(
      reported?.clientId,
      'clientId 只能由壳侧经 ready 交握给出 ⇒ 拿到它即证明一次完整往返',
    ).toBe('shell-client-1');

    expect(
      received,
      '恢复期必须真的调用过壳侧的存储方法 —— 空数组说明端口只完成了交握、没承载真实流量',
    ).not.toHaveLength(0);
  });
});
