/**
 * ADR-0070「成员面信号 ⇒ 该不该重取、一条变化吵几次」的判据（`share-roster-signals.ts`）。
 *
 * 全部内存 fake：这里判的是**编排与合并**，不是网络（那面有常驻验收 `verify:collab-sync`
 * 第 14 步）也不是界面（那面在 `apps/web/tests/share-roster-signal.spec.tsx`）。
 * `refresh` 是一枚可编排耗时与失败的替身 —— "一次人类操作只吵一次"这条纪律
 * 只有数得出调用次数、并能把两次调用叠在途上，才叫判据。
 *
 * 失法臂（每臂都对应下面一枚用例，摘掉实现里那一行就会红）：
 *   A 闸门放开 ⇒ "谁发信号我都重取"，等于让服务端替本机决定取什么
 *   B 合并按**信号条数**记账而不是按在途 ⇒ 一次入群连打两次 GET
 *   C 尾巴漏跑 ⇒ 第二次变化被吞，面板停在旧名册上直到下一次信号
 *   D 异常抛穿 ⇒ 一条坏的重取把信号消费者整个带走
 *   E 各 shareId 共用一把在途锁 ⇒ 别的清单的信号被误合并
 */

import { describe, expect, it } from 'vitest';

import { createShareRosterSignalHandler, type ShareRosterSignalReading } from '../src/share-roster-signals.js';

const SHARE = 'share-1';
const OTHER = 'share-2';

/** 一枚可编排的 refresh 替身：数次数、可按 shareId 挂起、可抛。 */
const makeRefresh = () => {
  const calls: string[] = [];
  const held = new Set<string>();
  const resolvers = new Map<string, () => void>();
  let shouldThrow = false;
  return {
    calls,
    port: async (shareId: string): Promise<void> => {
      calls.push(shareId);
      if (held.has(shareId)) {
        await new Promise<void>((resolve) => { resolvers.set(shareId, resolve); });
      }
      if (shouldThrow) throw new Error('refresh failed');
    },
    /** 挂起**这一份清单**的重取（别的 shareId 照常走 —— 判的就是"各锁一把"）。 */
    holdOnce: (shareId: string) => { held.add(shareId); },
    release: (shareId: string) => {
      held.delete(shareId);
      const resolve = resolvers.get(shareId);
      resolvers.delete(shareId);
      resolve?.();
    },
    fail: (value: boolean) => { shouldThrow = value; },
  };
};

const readingOf = (result: ShareRosterSignalReading) => ({
  knownLocally: result.knownLocally,
  refreshed: result.refreshed,
  coalesced: result.coalesced,
  failed: result.failed,
});

describe('闸门：本机认不认得这份 share', () => {
  it('A 不认得 ⇒ 零重取，读数如实写 knownLocally=false', async () => {
    const refresh = makeRefresh();
    const handler = createShareRosterSignalHandler({ knownShareIds: () => [], refresh: refresh.port });
    const reading = await handler.onRosterSignal(SHARE);
    expect(readingOf(reading)).toEqual({ knownLocally: false, refreshed: false, coalesced: false, failed: false });
    expect(refresh.calls).toEqual([]);
  });

  it('认得 ⇒ 重取一次；名单是每次现取的（注册新 target 后不必重建 handler）', async () => {
    const refresh = makeRefresh();
    let known: string[] = [];
    const handler = createShareRosterSignalHandler({ knownShareIds: () => known, refresh: refresh.port });
    expect((await handler.onRosterSignal(SHARE)).knownLocally).toBe(false);
    known = [SHARE];
    const second = await handler.onRosterSignal(SHARE);
    expect(second.knownLocally).toBe(true);
    expect(second.refreshed).toBe(true);
    expect(refresh.calls).toEqual([SHARE]);
  });
});

describe('合并：一条人类操作换来几条信号', () => {
  it('B 在途时再来一条 ⇒ 不并发第二次，读数标 coalesced', async () => {
    const refresh = makeRefresh();
    refresh.holdOnce(SHARE);
    const handler = createShareRosterSignalHandler({ knownShareIds: () => [SHARE], refresh: refresh.port });
    const first = handler.onRosterSignal(SHARE);
    const second = await handler.onRosterSignal(SHARE);
    expect(readingOf(second)).toEqual({ knownLocally: true, refreshed: false, coalesced: true, failed: false });
    refresh.release(SHARE);
    await first;
    expect(refresh.calls).toEqual([SHARE, SHARE]);
  });

  it('C 尾巴必须跑，且只补一次：三条连着的信号换来两次重取', async () => {
    const refresh = makeRefresh();
    refresh.holdOnce(SHARE);
    const handler = createShareRosterSignalHandler({ knownShareIds: () => [SHARE], refresh: refresh.port });
    const first = handler.onRosterSignal(SHARE);
    // 接受邀请 + 自证公钥 + 信封下发：同一次人类操作换三条信号。
    await handler.onRosterSignal(SHARE);
    await handler.onRosterSignal(SHARE);
    refresh.release(SHARE);
    await first;
    expect(refresh.calls).toEqual([SHARE, SHARE]);
  });

  it('E 不同 shareId 各自一把锁：别人的在途不许把我这条并掉', async () => {
    const refresh = makeRefresh();
    refresh.holdOnce(SHARE);
    const handler = createShareRosterSignalHandler({ knownShareIds: () => [SHARE, OTHER], refresh: refresh.port });
    const inFlight = handler.onRosterSignal(SHARE);
    const other = await handler.onRosterSignal(OTHER);
    expect(other.refreshed).toBe(true);
    expect(refresh.calls).toEqual([SHARE, OTHER]);
    refresh.release(SHARE);
    await inFlight;
  });
});

describe('失败面：重取炸了不许把消费者带走', () => {
  it('D 抛穿 ⇒ 读数 failed=true 而这一趟不抛', async () => {
    const refresh = makeRefresh();
    refresh.fail(true);
    const handler = createShareRosterSignalHandler({ knownShareIds: () => [SHARE], refresh: refresh.port });
    const reading = await handler.onRosterSignal(SHARE);
    expect(reading.failed).toBe(true);
    expect(reading.refreshed).toBe(true);
  });

  it('尾巴那一次也炸 ⇒ 锁必须清掉，下一条信号还能重取', async () => {
    const refresh = makeRefresh();
    refresh.holdOnce(SHARE);
    const handler = createShareRosterSignalHandler({ knownShareIds: () => [SHARE], refresh: refresh.port });
    const first = handler.onRosterSignal(SHARE);
    await handler.onRosterSignal(SHARE);
    refresh.fail(true);
    refresh.release(SHARE);
    await first;
    expect(refresh.calls).toHaveLength(2);
    const third = await handler.onRosterSignal(SHARE);
    expect(third.refreshed).toBe(true);
    expect(refresh.calls).toHaveLength(3);
  });

  it('G 失败之后成功 ⇒ failed 如实回落，不留在旧读数上', async () => {
    const refresh = makeRefresh();
    refresh.fail(true);
    const handler = createShareRosterSignalHandler({ knownShareIds: () => [SHARE], refresh: refresh.port });
    expect((await handler.onRosterSignal(SHARE)).failed).toBe(true);
    refresh.fail(false);
    expect((await handler.onRosterSignal(SHARE)).failed).toBe(false);
  });
});
