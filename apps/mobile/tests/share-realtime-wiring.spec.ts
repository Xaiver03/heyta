/**
 * 移动端实时通道 ↔ **共享信号**的接线（M6 判据：两类共享信号各送到各自 handler，
 * 且都不许触发个人全量同步）。
 * ============================================================================
 *
 * `sync/realtime.ts` 此前建客户端时**没传** `onNewShareOps` / `onShareRosterChanged` ——
 * 服务端发了共享事件，这台设备整条链上没有任何人接。本文件钉的是：
 *   · 两个回调**确实传进了** `makeClient`（调用点存在，纯逻辑全绿不算数）；
 *   · 内容信号 ⇒ `shareOpsSignal`（默认落点 `share-signals.handleShareOpsSignal`）；
 *   · 成员面信号 ⇒ `shareRosterSignal`（默认落点 `handleShareRosterSignal`）；
 *   · 🔴 两者都**不碰** `syncNow()`：共享内容有自己的下行通道，成员面只重取面板；
 *     接到个人全量同步上会把一次共享评论推放大成整库同步（web 有用例，形状一致）；
 *   · 个人那条腿（`onNewOps` → `syncNow`）逐字不变 —— 共享接线不许回归它。
 */

import { describe, expect, it, vi } from 'vitest';

import type { AppHost, RealtimeWiringOptions, SyncConfig } from '@heyta/app-host';
import type { RealtimeClient } from '@heyta/sync-client';

const signals = vi.hoisted(() => ({
  bindShareSignalHost: vi.fn(),
  handleShareOpsSignal: vi.fn(),
  handleShareRosterSignal: vi.fn(),
}));
// 默认落点的转发是**这一份**判据要观察的边界；信号内部逻辑归 share-signals.spec.ts。
vi.mock('../src/share/share-signals', () => signals);

import { startRealtime, stopRealtime } from '../src/sync/realtime';

function fakeHost(clientId = 'dev-me'): AppHost {
  return {
    clientId,
    engine: { getClientId: () => clientId },
    dispatch: vi.fn(async () => undefined),
    dispatchChecked: vi.fn(async () => undefined),
    getState: () => ({}) as never,
  } as unknown as AppHost;
}

const configured: SyncConfig = { serverUrl: 'https://heyta.example', token: 'JWT-1', password: 'p' };

function harness(over: Partial<Parameters<typeof startRealtime>[0]> = {}) {
  const options: RealtimeWiringOptions[] = [];
  const syncNow = vi.fn(async () => undefined);
  const shareOpsSignal = vi.fn();
  const shareRosterSignal = vi.fn();

  const start = startRealtime({
    openHost: async () => fakeHost(),
    readConfig: () => configured,
    networkAllowed: () => true,
    dataEgressAllowed: () => true,
    syncNow,
    makeClient: (o) => {
      options.push(o);
      return { connect: vi.fn(), dispose: vi.fn() } as unknown as RealtimeClient;
    },
    shareOpsSignal,
    shareRosterSignal,
    ...over,
  });
  return { start, options, syncNow, shareOpsSignal, shareRosterSignal };
}

describe('实时通道把两类共享信号传出去', () => {
  it('🔴 `makeClient` 确实收到了 `onNewShareOps` 与 `onShareRosterChanged`（接线存在的判据）', async () => {
    const { start, options } = harness();
    await start;
    expect(options).toHaveLength(1);
    expect(options[0]?.onNewShareOps, '服务端推了共享事件而这边没人接 —— M6 之前就是这样').toBeDefined();
    expect(options[0]?.onShareRosterChanged).toBeDefined();
    stopRealtime();
  });

  it('建连前把宿主绑进信号层（路由个人腿 + 闸门读清单行绑定 + clientId 的来源）', async () => {
    const { start } = harness();
    await start;
    expect(signals.bindShareSignalHost).toHaveBeenCalledTimes(1);
    stopRealtime();
  });

  it('`onNewShareOps(shareId, latestSeq)` ⇒ 送进内容 handler，**不触发个人全量同步**', async () => {
    const { start, options, syncNow, shareOpsSignal, shareRosterSignal } = harness();
    await start;
    options[0]?.onNewShareOps?.('s1', 42);
    expect(shareOpsSignal).toHaveBeenCalledWith('s1', 42);
    expect(shareRosterSignal).not.toHaveBeenCalled();
    expect(syncNow, '共享内容信号被接到了个人同步上 —— 一次评论推放大成整库同步').not.toHaveBeenCalled();
    stopRealtime();
  });

  it('🔴 `onShareRosterChanged(shareId)` ⇒ 送进成员面 handler，**不触发个人全量同步**（web 同款）', async () => {
    const { start, options, syncNow, shareOpsSignal, shareRosterSignal } = harness();
    await start;
    options[0]?.onShareRosterChanged?.('s1');
    expect(shareRosterSignal).toHaveBeenCalledWith('s1');
    expect(shareOpsSignal).not.toHaveBeenCalled();
    expect(syncNow, '成员面变化不该把整库再同步一遍').not.toHaveBeenCalled();
    stopRealtime();
  });

  it('默认落点：不注入时两类回调走 `handleShareOpsSignal` / `handleShareRosterSignal`', async () => {
    const { start, options } = harness({ shareOpsSignal: undefined, shareRosterSignal: undefined });
    await start;
    options[0]?.onNewShareOps?.('s9', 1);
    options[0]?.onShareRosterChanged?.('s9');
    expect(signals.handleShareOpsSignal).toHaveBeenCalledWith('s9', 1);
    expect(signals.handleShareRosterSignal).toHaveBeenCalledWith('s9');
    stopRealtime();
  });

  it('个人那条腿逐字不变：`onNewOps` 仍触发一次 `syncNow`（共享接线不许回归它）', async () => {
    const { start, options, syncNow, shareOpsSignal } = harness();
    await start;
    options[0]?.onNewOps?.(99);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(shareOpsSignal).not.toHaveBeenCalled();
    stopRealtime();
  });
});
