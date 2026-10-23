/**
 * ADR-0067 裁决三「并发同字段必须可见」的判据
 * =========================================
 *
 * 这一片要挡的是这条线里**最坏的一种静默**：两个人各自改了同一处，其中一个人的
 * 东西没了，而且界面上一个字都不说。ADR 给的两形判据逐条钉在下面：
 *
 * - **不同字段各改一次 ⇒ 两边都保留、无冲突提示**（弹一句"保留哪一边"是谎报，
 *   因为谁也没丢东西）；
 * - **同一字段各改一次 ⇒ 恰好一枚具名冲突、且不静默丢任一侧内容**（两侧载荷逐字都在）。
 *
 * ⚠️ 这些用例喂给 `deriveShareConflicts` 的都是**已解密**的 op（明文载荷），
 *    与 `replayShareOps` 吃的是同一份；时钟形状用 M2-b 落地之后的真形状
 *    （每台设备自己那一维自增、别人的维逐维带过），不是随手写的 `{a:1}`。
 *
 * 🔴 夹具里每条 op 的钟**必须含它读过的那些维**，这一格是被自己的用例教出来的：
 *    第一版把 B 的钟写成 `{b:1}`，于是它与基线那条并发，"不同字段各改一次"
 *    那一枚抓到的其实是一个**真**冲突（B 确实盖掉了它从没读过的备注）。
 *    判据没错，是夹具在谎报"这两个人读过同一份"。
 */

import { emptyState } from '@heyta/op-log';
import { deriveShareIdentityKeyPair } from '@heyta/sync-core';
import { describe, expect, it } from 'vitest';

import type { ShareOpWire, ShareOpWireRow } from '../src/share-client.js';
import { createShareCommentDispatch } from '../src/share-comments.js';

import { foldShareOps, emptyShareLogState, type ShareLogState } from '../src/share-op-log.js';
import {
  deriveShareConflicts,
  shareConflictResolution,
  type ShareConflict,
} from '../src/share-conflicts.js';
import type { DecryptedShareOp } from '../src/share-replay.js';
import { replayShareOps } from '../src/share-replay.js';
/** 签名件夹具：真派生一枚 Ed25519（固定种子），签的是生产原语。
 * 签名本身对不对由 `share-client.spec.ts` / sync-core 那两族判据钉，这里只补"有没有签名件"这一档。 */
const shareAuthorKeyPair = deriveShareIdentityKeyPair(new Uint8Array(32).fill(21));
const signerFor = async () => ({ memberId: 'member-1', ed25519SecretKey: shareAuthorKeyPair.ed25519SecretKey });


const T0 = 1_700_000_000_000;

function op(over: Partial<DecryptedShareOp> & Pick<DecryptedShareOp, 'id' | 'clientId'>): DecryptedShareOp {
  return {
    actionType: 'edit task',
    opType: 'UPD',
    entityType: 'TASK',
    entityId: 't-1',
    schemaVersion: 1,
    timestamp: T0,
    vectorClock: {},
    payload: {},
    ...over,
  };
}

/** 走一遍真实折叠（拿到重放**全序**那份），再推冲突 —— 与生产路径同一个输入形状。 */
function conflictsFrom(ops: readonly DecryptedShareOp[]): ShareConflict[] {
  const log = foldShareOps(emptyShareLogState(), ops);
  return deriveShareConflicts('share-1', log.ops as readonly DecryptedShareOp[]);
}

/** 同一组 op 物化出来的那行任务（用来证"两边都保留"不是嘴上说的）。 */
function rowOf(ops: readonly DecryptedShareOp[]): Record<string, unknown> {
  const { state } = replayShareOpsFrom(ops);
  return (state as unknown as { tasks: Record<string, Record<string, unknown>> }).tasks['t-1'] ?? {};
}

function replayShareOpsFrom(ops: readonly DecryptedShareOp[]) {
  const log = foldShareOps(emptyShareLogState(), ops);
  return replayShareOps(emptyState(), [log.ops as readonly DecryptedShareOp[]]);
}

describe('共享域并发裁决（ADR-0067 裁决三）', () => {
  it('不同字段各改一次 ⇒ 无冲突提示，且两边的值都留在终态里', () => {
    const ops = [
      op({ id: 'op-base', clientId: 'device-a', vectorClock: { 'device-a': 1 }, payload: { title: '原来的标题', note: '原来的备注' } }),
      op({ id: 'op-a', clientId: 'device-a', timestamp: T0 + 1, vectorClock: { 'device-a': 2 }, payload: { title: 'A 改的标题' } }),
      op({ id: 'op-b', clientId: 'device-b', timestamp: T0 + 2, vectorClock: { 'device-a': 1, 'device-b': 1 }, payload: { note: 'B 改的备注' } }),
    ];
    expect(conflictsFrom(ops), '谁也没丢东西 ⇒ 不许弹"保留哪一边"').toEqual([]);
    const row = rowOf(ops);
    expect(row['title']).toBe('A 改的标题');
    expect(row['note']).toBe('B 改的备注');
  });

  it('同一字段各改一次 ⇒ 恰好一枚具名冲突，两侧内容逐字都在', () => {
    const ops = [
      op({ id: 'op-base', clientId: 'device-a', vectorClock: { 'device-a': 1 }, payload: { title: '原来的标题' } }),
      op({ id: 'op-a', clientId: 'device-a', timestamp: T0 + 1, vectorClock: { 'device-a': 2 }, payload: { title: 'A 改的标题' } }),
      op({ id: 'op-b', clientId: 'device-b', timestamp: T0 + 2, vectorClock: { 'device-a': 1, 'device-b': 1 }, payload: { title: 'B 改的标题' } }),
    ];
    const found = conflictsFrom(ops);
    expect(found, '同字段并发必须有一处要人来定').toHaveLength(1);
    const one = found[0]!;
    expect(one.entityType).toBe('TASK');
    expect(one.entityId).toBe('t-1');
    expect(one.errorCode, '查表用的编码必须是既有词条，不新建词表').toBe('CONFLICT_CONCURRENT');
    expect(one.fields).toEqual(['title']);
    // 🔴 两侧**都要在**：少任何一边就是"静默丢内容"换了个地方发生。
    expect(one.local.payload, '先写的那一条（全序里靠前）').toEqual({ title: 'A 改的标题' });
    expect(one.remote.payload, '踩掉它的那一条').toEqual({ title: 'B 改的标题' });
    expect(one.local.opId).toBe('op-a');
    expect(one.remote.opId).toBe('op-b');
    expect(one.id).toBe('share:share-1:TASK:t-1');
  });

  it('喂进去的先后调换 ⇒ 同一枚冲突、同一份两侧指派（读的是全序，不是到达顺序）', () => {
    const a = op({ id: 'op-a', clientId: 'device-a', timestamp: T0 + 1, vectorClock: { 'device-a': 2 }, payload: { title: 'A 改的标题' } });
    const base = op({ id: 'op-base', clientId: 'device-a', vectorClock: { 'device-a': 1 }, payload: { title: '原来的标题' } });
    const b = op({ id: 'op-b', clientId: 'device-b', timestamp: T0 + 2, vectorClock: { 'device-a': 1, 'device-b': 1 }, payload: { title: 'B 改的标题' } });
    const forward = conflictsFrom([base, a, b]);
    const backward = conflictsFrom([b, a, base]);
    expect(backward).toEqual(forward);
    expect(forward).toHaveLength(1);
  });

  it('用户点过"保留这一版"之后 ⇒ 这一处不再报（那条 op 自己就是后来者）', () => {
    const ops = [
      op({ id: 'op-base', clientId: 'device-a', vectorClock: { 'device-a': 1 }, payload: { title: '原来的标题' } }),
      op({ id: 'op-a', clientId: 'device-a', timestamp: T0 + 1, vectorClock: { 'device-a': 2 }, payload: { title: 'A 改的标题' } }),
      op({ id: 'op-b', clientId: 'device-b', timestamp: T0 + 2, vectorClock: { 'device-a': 1, 'device-b': 1 }, payload: { title: 'B 改的标题' } }),
    ];
    const [conflict] = conflictsFrom(ops);
    expect(conflict).toBeDefined();
    const intent = shareConflictResolution(conflict!, 'keep-local');
    expect(intent, '解决 = 把被选那一版重新发一条（一个意图 = 一个 op）').toEqual({
      entityType: 'TASK',
      entityId: 't-1',
      opType: 'UPD',
      payload: { title: 'A 改的标题' },
    });

    // 用户这台设备的钟此时**同时**含两边（{a:2,b:1} ⇒ 点保留的是本机那一侧时再 +1）。
    const resolved = conflictsFrom([
      ...ops,
      op({ id: 'op-fix', clientId: 'device-a', timestamp: T0 + 3, vectorClock: { 'device-a': 3, 'device-b': 1 }, payload: intent.payload }),
    ]);
    expect(resolved).toEqual([]);
    expect(rowOf([...ops, op({ id: 'op-fix', clientId: 'device-a', timestamp: T0 + 3, vectorClock: { 'device-a': 3, 'device-b': 1 }, payload: intent.payload })])['title'])
      .toBe('A 改的标题');
  });

  it('第三个人后来居上 ⇒ 也不再报（此刻已没有需要这位用户来定的事）', () => {
    const ops = [
      op({ id: 'op-a', clientId: 'device-a', timestamp: T0 + 1, vectorClock: { 'device-a': 1 }, payload: { title: 'A 改的标题' } }),
      op({ id: 'op-b', clientId: 'device-b', timestamp: T0 + 2, vectorClock: { 'device-b': 1 }, payload: { title: 'B 改的标题' } }),
      op({
        id: 'op-c',
        clientId: 'device-c',
        timestamp: T0 + 3,
        vectorClock: { 'device-a': 1, 'device-b': 1, 'device-c': 1 },
        payload: { title: 'C 后来改的标题' },
      }),
    ];
    expect(conflictsFrom(ops), 'C 的钟压过了两边 ⇒ 因果顺序已经定完').toEqual([]);
  });

  it('一人删、一人改（并发）⇒ 一枚冲突，"这条还要不要"交到用户手上', () => {
    const ops = [
      op({ id: 'op-base', clientId: 'device-a', vectorClock: { 'device-a': 1 }, payload: { title: '原来的标题' } }),
      op({ id: 'op-a', clientId: 'device-a', timestamp: T0 + 1, vectorClock: { 'device-a': 2 }, payload: { title: 'A 改的标题' } }),
      op({
        id: 'op-del',
        clientId: 'device-b',
        timestamp: T0 + 2,
        opType: 'DEL',
        actionType: 'delete task',
        vectorClock: { 'device-a': 1, 'device-b': 1 },
        payload: {},
      }),
    ];
    const found = conflictsFrom(ops);
    expect(found).toHaveLength(1);
    expect(found[0]!.fields).toEqual(['deletedAt']);
    expect(found[0]!.remote.opType, '被选那一侧重新发出去时必须是它原来的动作类型（保留删除就真删）').toBe('DEL');
    expect(shareConflictResolution(found[0]!, 'keep-remote')).toEqual({
      entityType: 'TASK',
      entityId: 't-1',
      opType: 'DEL',
      payload: {},
    });
  });

  it('退化形状（M2-b 之前的存量日志：每条都是 `{我:1}`）⇒ 不把历史噪声推给用户', () => {
    const ops = [
      op({ id: 'op-old-1', clientId: 'device-a', timestamp: T0 + 1, vectorClock: { 'device-a': 1 }, payload: { title: '第一版' } }),
      op({ id: 'op-old-2', clientId: 'device-a', timestamp: T0 + 2, vectorClock: { 'device-a': 1 }, payload: { title: '第二版' } }),
    ];
    expect(conflictsFrom(ops), '时钟相等意味着这份日志里没有因果边，弹"保留哪一边"是另一种谎报').toEqual([]);
  });
});

/**
 * 接线判据 —— 纯函数对了不等于**接起来**对。
 *
 * 上面那些用例全在直接调 `deriveShareConflicts`；本文件第一版就是这样绿的，
 * 而 `createShareCommentDispatch` 里那两处折叠（写一次折一次、拉一次折一次）
 * 一个都没被谁测过。这正是本仓最高发的失效形状：闸门在一侧测过、投递在另一侧测过，
 * **只有接起来那一行**没被任何人测。
 */
describe('冲突清单接在生产路径上（createShareCommentDispatch）', () => {
  /** 一台设备：假服务端 + 内存盘 + 真 dispatcher（时钟走 M2-b 那条真路）。 */
  function makeRig() {
    const rows: ShareOpWireRow[] = [];
    const api = {
      uploadOps: async (_shareId: string, ops: readonly unknown[]) => {
        for (const wire of ops as readonly ShareOpWire[]) {
          rows.push({ ...wire, serverSeq: rows.length + 1, clientTimestamp: wire.timestamp });
        }
        // 假服务端"全收"：回执逐条给 id（共享腿按"在不在 accepted 里"判写成功）。
        return { accepted: (ops as readonly ShareOpWire[]).map((op) => ({ id: op.id })), rejected: [] };
      },
      downloadOps: async (_shareId: string, after: number) => ({
        ops: rows.filter((row) => row.serverSeq > after),
        cursor: { latestServerSeq: rows.length },
      }),
    };
    // 🔴 每台设备**自己的盘**：两台共用一个 Map 的话，后写的那台会把前一台的日志整个盖掉，
    // 于是"两个人互相看不见"这一格被夹具**假装成**已经收敛了（本文件第一版就是这么绿的）。
    const device = (clientId: string) => {
      const disk = new Map<string, ShareLogState>();
      const cursors = new Map<string, number>();
      return createShareCommentDispatch({
        signerFor,
        api: api as never,
        cipherFor: async () => ({
          encrypt: async (payload: string) => `ct:${payload}`,
          decrypt: async (payload: string) => payload.replace(/^ct:/, ''),
        }),
        storage: {
          load: (id) => disk.get(id) ?? emptyShareLogState(),
          save: (id, log) => void disk.set(id, log),
          list: () => [...disk.keys()],
          cursor: (id) => cursors.get(id) ?? 0,
          setCursor: (id, seq) => void cursors.set(id, seq),
        },
        currentUserId: () => 'u-me',
        clientId,
        schemaVersion: 1,
        isSignedIn: () => true,
        now: () => T0,
        newOpId: () => `op-${String(Math.random())}`,
      });
    };
    return { a: device('device-a'), b: device('device-b') };
  }

  const taskIntent = (title: string) => ({
    entityType: 'TASK',
    entityId: 't-1',
    opType: 'UPD',
    payload: { title },
  }) as never;

  it('两台设备各改同一格 ⇒ 两边的清单里都恰好有一枚，且两侧内容都在', async () => {
    const rig = makeRig();
    // A 先建一条（B 后来读到它）。
    await rig.a.dispatchShareOp('share-1', taskIntent('A 的第一版'));
    await rig.b.pullShareOps('share-1');
    // 两人各自改标题，且都**没**读到对方那一条。
    await rig.a.dispatchShareOp('share-1', taskIntent('A 改的标题'));
    await rig.b.dispatchShareOp('share-1', taskIntent('B 改的标题'));
    await rig.a.pullShareOps('share-1');
    await rig.b.pullShareOps('share-1');

    for (const [who, device] of [['A', rig.a], ['B', rig.b]] as const) {
      const found = device.conflicts();
      expect(found, `${who} 这台必须看得见这一处`).toHaveLength(1);
      expect(found[0]!.fields).toEqual(['title']);
      const titles = [found[0]!.local.payload, found[0]!.remote.payload] as Array<{ title: string }>;
      expect(titles.map((one) => one.title).sort()).toEqual(['A 改的标题', 'B 改的标题']);
    }
  });

  it('A 点「保留这一版」⇒ 只多**一条** op，两边之后都不再报', async () => {
    const rig = makeRig();
    await rig.a.dispatchShareOp('share-1', taskIntent('A 的第一版'));
    await rig.b.pullShareOps('share-1');
    await rig.a.dispatchShareOp('share-1', taskIntent('A 改的标题'));
    await rig.b.dispatchShareOp('share-1', taskIntent('B 改的标题'));
    await rig.a.pullShareOps('share-1');
    const before = rig.a.stateFor('share-1');
    expect(before).toBeDefined();

    const [one] = rig.a.conflicts();
    await rig.a.resolveConflict(one!, 'keep-local');
    expect(rig.a.conflicts(), '本机裁完就不再报').toEqual([]);

    await rig.b.pullShareOps('share-1');
    expect(rig.b.conflicts(), '对方拉到那条裁决之后也不再报（不需要服务端记账）').toEqual([]);
  });
});
