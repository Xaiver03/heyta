/**
 * E2 页侧：宿主端口销毁的发信方，以及它进账的形状
 * ==========================================================
 *
 * ## 它防的是什么
 *
 * `eraseHostStoragePortData()` 的产物是**凭据**，不是布尔。所以四种"没拿到凭据"
 * 的场合都必须各自留下一条写得清原因的报告，而不是静默：
 *
 * | 场合 | 必须报 | 不许 |
 * |---|---|---|
 * | 这台设备根本没有这一档存储（Web / node-host / 移动端） | **空数组** | 凭空造一条 `false`（那会让逐宿主的账多一行假洞） |
 * | 端口只有单槽 `onmessage` | `host-port-single-slot-receiver` | 挂上去（那会把正在跑的引擎的接收能力摘掉） |
 * | 端口对面不认识这一发（旧壳） | `host-port-silent`，且**有界** | 永远挂着（注销界面卡在转圈） |
 * | 端口已断（壳退了） | `host-port-post-failed` | 不结算 |
 *
 * 第二条那一格是本套件最值钱的一条：它与 `oplog-worker-bridge.ts:289` 那句
 * "`onmessage` 是单槽的，被覆盖就静默失去接收能力"是同一件事的两端。
 * 把它改回"两边都用，先 onmessage"，第 ③ 条立刻红。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { eraseLocalData, lastErasureReports, registerLocalEraser } from '../src/local-erasure.js';
import {
  eraseHostStoragePortData,
  HOST_STORAGE_PORT_TARGET,
} from '../src/host-storage-erasure.js';
import type { DbDestroyReport } from '@heyta/storage';

type Listener = (event: { data: unknown }) => void;

/** 一个壳侧端口的替身：记录出站消息，并允许测试主动投递入站消息。 */
function fakePort(options: { withAddEventListener?: boolean; throwOnPost?: boolean } = {}) {
  const sent: unknown[] = [];
  const listeners: Listener[] = [];
  const port: Record<string, unknown> = {
    postMessage: (message: unknown) => {
      if (options.throwOnPost === true) throw new Error('port closed');
      sent.push(message);
    },
  };
  if (options.withAddEventListener !== false) {
    port.addEventListener = (_type: string, listener: Listener) => {
      listeners.push(listener);
    };
  }
  return {
    port: port as never,
    sent,
    listeners,
    deliver: (data: unknown) => {
      for (const listener of [...listeners]) listener({ data });
    },
  };
}

function setPort(port: unknown): void {
  (globalThis as { window?: unknown }).window = { __heytaHostStoragePort: port };
}

function destroyReport(overrides: Partial<DbDestroyReport> = {}): DbDestroyReport {
  return {
    target: '/var/heyta/heyta.sqlite',
    containerRemoved: true,
    storesCleared: 4,
    ...overrides,
  };
}

beforeEach(() => {
  registerLocalEraser(undefined);
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  registerLocalEraser(undefined);
  vi.useRealTimers();
});

describe('eraseHostStoragePortData', () => {
  it('① 没有端口 ⇒ 空数组（不是"报一条失败"）', async () => {
    expect(await eraseHostStoragePortData()).toEqual([]);
  });

  it('② 壳侧回了凭据 ⇒ 原样交回，逐字段不折叠', async () => {
    const fake = fakePort();
    setPort(fake.port);
    const running = eraseHostStoragePortData();
    // 🔴 先证明页侧**确实发出去了**这一发，再回它 —— 否则"收到回包"可能是替身自己造的。
    expect(fake.sent).toEqual([{ type: 'oplog-destroy' }]);
    fake.deliver({ type: 'oplog-destroyed', report: destroyReport() });

    const reports = await running;
    expect(reports).toHaveLength(1);
    expect(reports[0]).toEqual(destroyReport());
  });

  it('③ 🔴 只有单槽 onmessage 的端口：不许占用，如实报一条 false', async () => {
    const raw: { postMessage: (m: unknown) => void; onmessage?: unknown } = {
      postMessage: () => undefined,
    };
    setPort(raw);

    const reports = await eraseHostStoragePortData();
    expect(reports[0]?.containerRemoved).toBe(false);
    expect(reports[0]?.reason).toBe('host-port-single-slot-receiver');
    // 这条才是"没把引擎的接收能力摘掉"的证明：单槽仍然是空的。
    expect(raw.onmessage ?? null).toBe(null);
  });

  it('④ 端口对面不认识这一发 ⇒ 有界超时后报 false，而不是永远挂着', async () => {
    vi.useFakeTimers();
    const fake = fakePort();
    setPort(fake.port);
    const running = eraseHostStoragePortData();
    await vi.advanceTimersByTimeAsync(4_999);
    let settled = false;
    void running.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled, '4.999s 时还不该结算（否则有界这条没有牙）').toBe(false);

    await vi.advanceTimersByTimeAsync(2);
    const reports = await running;
    expect(reports[0]?.containerRemoved).toBe(false);
    expect(reports[0]?.reason).toBe('host-port-silent');
  });

  it('⑤ 端口已断（postMessage 抛）⇒ 结算一条 false，不抛出', async () => {
    const fake = fakePort({ throwOnPost: true });
    setPort(fake.port);
    const reports = await eraseHostStoragePortData();
    expect(reports[0]?.containerRemoved).toBe(false);
    expect(reports[0]?.reason).toBe('host-port-post-failed');
  });

  it('⑥ 共用端口上的其它消息不许被当成回包（ready / 逐请求响应都得放行）', async () => {
    const fake = fakePort();
    setPort(fake.port);
    const running = eraseHostStoragePortData();
    fake.deliver({ type: 'ready', clientId: 'client-a' });
    fake.deliver({ id: 7, ok: true, value: null });
    fake.deliver({ type: 'oplog-destroyed', report: 'not-a-report' });
    // 上面三条都不该结算；最后一条形状不对，要如实报"读不到凭据"。
    const reports = await running;
    expect(reports[0]?.containerRemoved).toBe(false);
    expect(reports[0]?.reason).toBe('host-port-report-unreadable');
    expect(reports[0]?.target).toBe(HOST_STORAGE_PORT_TARGET);
  });
});

describe('eraseLocalData 里这一档的进账形状', () => {
  it('⑦ 宿主端口的凭据排在注册的销毁器之前，两份都在账上', async () => {
    const fake = fakePort();
    setPort(fake.port);
    registerLocalEraser(async () => [destroyReport({ target: 'indexeddb:heyta' })]);
    const running = eraseLocalData();
    fake.deliver({ type: 'oplog-destroyed', report: destroyReport() });

    const reports = await running;
    expect(reports.map((r) => r.target)).toEqual([
      '/var/heyta/heyta.sqlite',
      'indexeddb:heyta',
    ]);
    expect(lastErasureReports()).toEqual(reports);
  });

  it('⑧ 🔴 注册的销毁器抛错时，端口那一档的凭据必须**留在账上**', async () => {
    const fake = fakePort();
    setPort(fake.port);
    registerLocalEraser(async () => {
      throw new Error('宿主代码坏了');
    });
    const running = eraseLocalData();
    fake.deliver({ type: 'oplog-destroyed', report: destroyReport({ containerRemoved: true }) });

    await expect(running).rejects.toThrow('宿主代码坏了');
    // 库文件真的删了 —— 账上却什么都不剩，就是把一次成功的销毁读成"没清"。
    expect(lastErasureReports()).toHaveLength(1);
    expect(lastErasureReports()[0]?.containerRemoved).toBe(true);
  });

  it('⑨ 没注册销毁器仍然抛（这条不许被端口的存在绕过）', async () => {
    const fake = fakePort();
    setPort(fake.port);
    await expect(eraseLocalData()).rejects.toThrow(/明文仍在/);
    expect(fake.sent, '没注册就不该走到发信那一步').toEqual([]);
  });
});
