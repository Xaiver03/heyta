/**
 * 移动端**共享信号**装配（`share/share-signals.ts`）—— 两类实时信号各送到各自 handler。
 * ===============================================================================
 *
 * 判据本体（该不该拉、吵几次）在 `@heyta/app-host` 的 `createShareOpsSignalHandler` /
 * `createShareRosterSignalHandler`；这里钉的是移动端把材料接对了：
 *
 *   · `new_share_ops` ⇒ 会话的 `pullShareOps`（拉进**那一份**缓存，合并视图看得见），
 *     本机不认得的 shareId ⇒ 零拉取；
 *   · 拉到新内容/验签被拒 ⇒ 敲"重画"（不是第二次下载 —— 游标是全 share 一份的）；
 *   · 活动（别人新增/删除评论）转发给界面监听器；
 *   · 🔴 `share_roster_changed` 的闸门 = 「清单行绑定 ∪ 登记中的 target」——
 *     **刚入群、清单行还没绑定**那一格在移动端也必须钉住：只认清单行绑定的话，
 *     owner 补发信封的信号会被丢掉、人永远停在等待页（§9.11 自锁同一形状）；
 *   · 成员面信号**不拉内容**（两类信号不串线）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppHost } from '@heyta/app-host';
import { emptyState, type MaterializedState } from '@heyta/op-log';
import { OpType } from '@heyta/sync-core';

import {
  __resetMobileShareSignalsForTests,
  bindShareSignalHost,
  dispatchShareOpsSignal,
  dispatchShareRosterSignal,
  installMobileShareSignals,
  registerShareRosterTarget,
  shareRepaintListenerCount,
  shareRosterTargetCount,
  subscribeShareActivity,
  subscribeShareRepaint,
  type ShareSignalDeps,
} from '../src/share/share-signals';
import { bindMobileOplogBase } from '../src/share/wiring';

function stateWith(shareIds: string[]): MaterializedState {
  const projects: Record<string, unknown> = {};
  shareIds.forEach((shareId, index) => {
    projects[`p${String(index)}`] = { id: `p${String(index)}`, deletedAt: undefined, shareId };
  });
  return { ...emptyState(), projects } as MaterializedState;
}

function fakeHost(shareIds: string[]): AppHost {
  return {
    clientId: 'dev-me',
    dispatch: vi.fn(async () => undefined),
    dispatchChecked: vi.fn(async () => undefined),
    getState: () => stateWith(shareIds),
  } as unknown as AppHost;
}

/**
 * 把"这台设备认得这几份 share"摆出来 —— 和生产的形状一致：
 * 合并视图那条腿（base）由 `db/open-host.ts` 绑，`clientId` 由实时通道建连时绑。
 * 🔴 2026-10-24 之前这里只调 `bindShareSignalHost` 一枚就够，因为它顺手把 base 也绑了；
 * 那一处多绑交的是**包装后**的宿主 ⇒ 读侧递归、真机崩在栈溢出。拆开后测试跟着拆。
 */
function bindDevice(shareIds: string[]): void {
  const host = fakeHost(shareIds);
  bindMobileOplogBase(host);
  bindShareSignalHost(host);
}

function fakeStorage(ops: { value: unknown[] } = { value: [] }) {
  return {
    load: () => (ops.value.length === 0 ? undefined : { ops: ops.value, clock: {} }),
    save: vi.fn(),
    list: () => [] as readonly string[],
    cursor: () => 0,
    setCursor: vi.fn(),
    ops,
  };
}

function fakeSession(storage: ReturnType<typeof fakeStorage>) {
  const pullShareOps = vi.fn(async (shareId: string) => {
    // 模拟"拉到一条别人写的评论"：落进 storage，活动差集才数得出。
    storage.ops.value = [
      { id: 'op-remote-1', clientId: 'dev-other', entityType: 'COMMENT', opType: OpType.Create, timestamp: 1, vectorClock: {} },
    ];
    return { fetched: 1, added: 1, cursor: 3, pages: 1, rejections: [] };
  });
  return {
    session: {
      channel: { dispatch: vi.fn(async () => undefined), stateFor: () => emptyState() as MaterializedState },
      pullShareOps,
      signatureRejections: () => [] as const,
    },
    pullShareOps,
  };
}

function install(deps: Partial<ShareSignalDeps> = {}): void {
  installMobileShareSignals(deps);
}

/** 等火并出去的 `void (async …)()` 走完（sink 是投递式的，不等它会假阴性）。 */
async function settled(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

afterEach(() => {
  __resetMobileShareSignalsForTests();
  // base 现在不由 `bindShareSignalHost` 管（那是生产里 `db/open-host.ts` 一件事），
  // 所以复位也得自己摘 —— 不摘会把这台假设备漏给下一个用例。
  bindMobileOplogBase(undefined);
});

describe('移动端共享信号装配', () => {
  it('🔴 `new_share_ops`：本机认得（清单行绑定在册）⇒ 真的拉了那一份', async () => {
    bindDevice(['s1']);
    const storage = fakeStorage();
    const { session, pullShareOps } = fakeSession(storage);
    install({ ensureSession: async () => session, ensureStorage: async () => storage as never });

    dispatchShareOpsSignal('s1', 7);
    await settled();

    expect(pullShareOps, '内容信号没接到会话的下行出口 —— 别人写完这台永远看不见').toHaveBeenCalledTimes(1);
    expect(pullShareOps.mock.calls[0]?.[0]).toBe('s1');
  });

  it('本机不认得的 shareId ⇒ 零拉取（信号按账号扇出，本地事实本地判）', async () => {
    bindDevice(['s1']);
    const storage = fakeStorage();
    const { session, pullShareOps } = fakeSession(storage);
    install({ ensureSession: async () => session, ensureStorage: async () => storage as never });

    dispatchShareOpsSignal('s-never-seen', 1);
    await settled();

    expect(pullShareOps).not.toHaveBeenCalled();
  });

  it('拉到新内容 ⇒ 敲"重画"（界面从盘上重放，不做第二次下载）', async () => {
    bindDevice(['s1']);
    const storage = fakeStorage();
    const { session } = fakeSession(storage);
    install({ ensureSession: async () => session, ensureStorage: async () => storage as never });

    const repaint = vi.fn();
    const unsubscribe = subscribeShareRepaint(repaint);
    expect(shareRepaintListenerCount()).toBe(1);

    dispatchShareOpsSignal('s1', 7);
    await settled();

    unsubscribe();
    expect(repaint, '内容落盘了但没人被叫去重读 —— "数据在盘上、界面不动"那一格').toHaveBeenCalledTimes(1);
  });

  it('别人新增的评论 ⇒ 活动转发给界面监听器（自己不吵自己按 clientId 滤）', async () => {
    bindDevice(['s1']);
    const storage = fakeStorage();
    const { session } = fakeSession(storage);
    install({ ensureSession: async () => session, ensureStorage: async () => storage as never });

    const activities = vi.fn();
    subscribeShareActivity((shareId, _latestSeq, kinds) => activities(shareId, kinds));

    dispatchShareOpsSignal('s1', 9);
    await settled();

    expect(activities).toHaveBeenCalledTimes(1);
    expect(activities.mock.calls[0]?.[0]).toBe('s1');
    expect(activities.mock.calls[0]?.[1]).toContain('added');
  });

  it('🔴 刚入群、清单行还没绑定：登记中的 target 也算认得（owner 补发信封的信号不许丢）', async () => {
    // 这台设备刚点完「接受邀请」：`getState()` 里还没有任何 shareId 绑定
    //（那一行要等 finalize 成功才写），但入群对话框已经把自己的重取登记上了。
    bindDevice([]);
    const refresh = vi.fn(async () => undefined);
    const unregister = registerShareRosterTarget('s-just-joined', refresh);
    expect(shareRosterTargetCount('s-just-joined')).toBe(1);
    install();

    dispatchShareRosterSignal('s-just-joined');
    await settled();

    unregister();
    expect(refresh, '闸门只认清单行绑定 = 拦住的正是它等的那条信号（§9.11 自锁同一形状）').toHaveBeenCalledTimes(1);
  });

  it('成员面信号：本机不认得、也没登记的 shareId ⇒ 一条重取都不跑', async () => {
    bindDevice(['s1']);
    const refresh = vi.fn(async () => undefined);
    registerShareRosterTarget('s1', refresh);
    install();

    dispatchShareRosterSignal('s-unknown');
    await settled();

    expect(refresh).not.toHaveBeenCalled();
  });

  it('两类信号不串线：成员面信号**不拉内容**', async () => {
    bindDevice(['s1']);
    const storage = fakeStorage();
    const { session, pullShareOps } = fakeSession(storage);
    const refresh = vi.fn(async () => undefined);
    install({ ensureSession: async () => session, ensureStorage: async () => storage as never });
    registerShareRosterTarget('s1', refresh);

    dispatchShareRosterSignal('s1');
    await settled();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(pullShareOps, '成员面变化不该触发内容下行（两本通道各走各的）').not.toHaveBeenCalled();
  });

  it('宿主没绑（拿不到 clientId）⇒ 内容信号不处理，而不是拿空串把"自己不吵自己"静默作废', async () => {
    const storage = fakeStorage();
    const { session, pullShareOps } = fakeSession(storage);
    install({ ensureSession: async () => session, ensureStorage: async () => storage as never });

    dispatchShareOpsSignal('s1', 1);
    await settled();

    expect(pullShareOps).not.toHaveBeenCalled();
  });

  it('一枚重取炸了不许把别人带走，但整体要抛（静默成功会让"面板没更新"和成功长得一样）', async () => {
    const ok = vi.fn(async () => undefined);
    const boom = vi.fn(async () => {
      throw new Error('panel reload failed');
    });
    registerShareRosterTarget('s1', ok);
    registerShareRosterTarget('s1', boom);
    await expect(async () => {
      const { runShareRosterTargets } = await import('../src/share/share-signals');
      await runShareRosterTargets('s1');
    }).rejects.toThrow('share roster refresh failed');
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
