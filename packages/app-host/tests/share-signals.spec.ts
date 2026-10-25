/**
 * M5「下行信号 ⇒ 拉一次 ⇒ 该不该吵」的判据（`share-signals.ts`）。
 *
 * 全部用内存 fake：这里判的是**编排与判断**，不是网络与密码学（那两面各有常驻验收
 * `verify:collab-sync` / `verify:collab-revoke`）。`pull` 是一枚计数用的替身 ——
 * "零请求"这条纪律只有数得出次数才叫判据。
 */

import { describe, expect, it } from 'vitest';

import { OpType } from '@heyta/sync-core';

import {
  createShareOpsSignalHandler,
  pullSharedListOnOpen,
  shareActivitiesFromOps,
  type ShareSignalReading,
} from '../src/share-signals.js';
import type { ShareLogStorage } from '../src/share-comments.js';
import type { SharePullResult } from '../src/share-client.js';
import type { DecryptedShareOp } from '../src/share-replay.js';
import type { ShareLogState } from '../src/share-op-log.js';

const SHARE = 'share-1';
const ME = 'device-A';

const op = (over: Partial<DecryptedShareOp> & { id: string }): DecryptedShareOp => ({
  clientId: 'device-B',
  timestamp: 1_700_000_000_000,
  actionType: 'add comment',
  entityType: 'COMMENT',
  opType: OpType.Create,
  entityId: over.id,
  schemaVersion: 1,
  payload: {},
  ...over,
});

const stateOf = (ops: readonly DecryptedShareOp[]): ShareLogState => ({
  ops,
  clock: { clientId: 0 },
  duplicates: 0,
});

/** 最小 `ShareLogStorage`：内存 map（与 web 那份同形状，只是不落 localStorage）。 */
const makeStorage = (entries: readonly [string, ShareLogState][] = []): ShareLogStorage & {
  map: Map<string, ShareLogState>;
} => {
  const map = new Map(entries);
  return {
    map,
    load: (shareId) => map.get(shareId),
    save: (shareId, state) => void map.set(shareId, state),
    list: () => [...map.keys()],
    cursor: () => 0,
    setCursor: () => undefined,
  };
};

const okResult = (added: number): SharePullResult => ({
  fetched: added,
  added,
  cursor: 10,
  pages: 1,
});

/**
 * 造一份"拉到新内容"的场景：本地已有 `before` 那些 op，`pull` 之后落盘 `after`。
 * 返回读过的读数与 pull 次数。
 */
const scenario = async (before: readonly DecryptedShareOp[], after: readonly DecryptedShareOp[]) => {
  const storage = makeStorage([[SHARE, stateOf(before)]]);
  let pulls = 0;
  const handler = createShareOpsSignalHandler({
    storage,
    knownShareIds: () => [SHARE],
    myClientId: ME,
    pull: async () => {
      pulls += 1;
      storage.map.set(SHARE, stateOf(after));
      return okResult(after.length - before.length);
    },
  });
  const reading: ShareSignalReading = await handler.onShareOpsSignal(SHARE);
  return { reading, pulls };
};

describe('share 信号 · 该不该去拉', () => {
  it('🔴 本机既不认得也没落盘 ⇒ 零请求、不响（信号是按账号扇的，不是按设备）', async () => {
    const storage = makeStorage([['别的share', stateOf([])]]);
    let pulls = 0;
    const handler = createShareOpsSignalHandler({
      storage,
      knownShareIds: () => ['别的share'],
      myClientId: ME,
      pull: async () => {
        pulls += 1;
        return okResult(1);
      },
    });
    const reading = await handler.onShareOpsSignal(SHARE);
    expect(pulls, '本机没有的 share 一次都不该去下载').toBe(0);
    expect(reading).toMatchObject({ knownLocally: false, pulled: false, added: 0, activities: [] });
  });

  it('🔴 刚入群那台设备：本机有清单行绑着这份 share，但**一次都没拉过** ⇒ 照样拉', async () => {
    // 这一格是 M2 界面腿（`verify:collab-journey` 两台互见）实测抓出来的：
    // 落盘日志的索引只有**拉过之后**才有内容，所以只认索引的话，第一份别人写的内容
    // 会因为"本机还不认识它"被丢掉 —— 而这个判据自锁：不拉就永远不进索引。
    // 症状不是"少一条"而是**新成员永远看不见任何改动**，直到某次手动进评论区。
    const storage = makeStorage();
    expect(storage.list(), '前提：这台设备一个字节都还没落过盘').toEqual([]);
    let pulls = 0;
    const handler = createShareOpsSignalHandler({
      storage,
      knownShareIds: () => [SHARE],
      myClientId: ME,
      pull: async () => {
        pulls += 1;
        storage.map.set(SHARE, stateOf([op({ id: 'c-1' })]));
        return okResult(1);
      },
    });
    const reading = await handler.onShareOpsSignal(SHARE);
    expect(pulls, '本机绑定过 ⇒ 就该去拉').toBe(1);
    expect(reading).toMatchObject({ knownLocally: true, pulled: true, added: 1 });
    expect(reading.activities).toEqual(['added']);
  });

  it('本机有的 share ⇒ 真的拉一次，并把 added 带回来', async () => {
    const { reading, pulls } = await scenario([], [op({ id: 'c-1' })]);
    expect(pulls).toBe(1);
    expect(reading.pulled).toBe(true);
    expect(reading.added).toBe(1);
    expect(reading.activities).toEqual(['added']);
  });

  it('🔴 那三格必须**活着过磁盘**：走一遍 JSON 往返的 storage 仍要报 added', async () => {
    // 这一臂钉的是 `readFreshOps` 里那处 `as` 断言的东西：
    // `ShareLogStorage` 的声明只有基类形状，而活动要看 entityType/opType。
    // 哪天某份 storage 实现（web 那份是 JSON.stringify 落 localStorage）把这两格丢了，
    // 这里会红 —— 而不是留下"测试全绿、通知永远不响"。
    const through = (ops: readonly DecryptedShareOp[]): ShareLogState =>
      JSON.parse(JSON.stringify({ ops, clock: {}, duplicates: 0 })) as ShareLogState;
    const storage = makeStorage([[SHARE, through([])]]);
    const handler = createShareOpsSignalHandler({
      storage,
      knownShareIds: () => [SHARE],
      myClientId: ME,
      pull: async () => {
        storage.map.set(SHARE, through([op({ id: 'c-1' })]));
        return okResult(1);
      },
    });
    const reading = await handler.onShareOpsSignal(SHARE);
    expect(reading.activities).toEqual(['added']);
  });

  it('🔴 同一条 op 被信号推两次 ⇒ 第二次不响（按日志差集算，不按 added 数猜）', async () => {
    const storage = makeStorage([[SHARE, stateOf([])]]);
    let pulls = 0;
    let arrived = false;
    const handler = createShareOpsSignalHandler({
      storage,
      knownShareIds: () => [SHARE],
      myClientId: ME,
      pull: async () => {
        pulls += 1;
        // 第二次 pull 折叠后没有新 op（服务端不去抖，同一条会被推两遍）
        if (arrived) return okResult(0);
        arrived = true;
        storage.map.set(SHARE, stateOf([op({ id: 'c-1' })]));
        return okResult(1);
      },
    });
    const first = await handler.onShareOpsSignal(SHARE);
    const second = await handler.onShareOpsSignal(SHARE);
    expect(first.activities).toEqual(['added']);
    expect(second.activities, '同一条评论不该吵第二遍').toEqual([]);
    expect(pulls).toBe(2);
  });

  it('拉取抛错 ⇒ 不抛穿、如实留读数、不响（实时回调不能掀连接）', async () => {
    const storage = makeStorage([[SHARE, stateOf([])]]);
    const boom = new Error('404 not a member');
    const handler = createShareOpsSignalHandler({
      storage,
      knownShareIds: () => [SHARE],
      myClientId: ME,
      pull: async () => {
        throw boom;
      },
    });
    const reading = await handler.onShareOpsSignal(SHARE);
    expect(reading.error).toBe(boom);
    expect(reading.activities).toEqual([]);
    expect(reading.pulled, '发过请求这件事要留痕，哪怕失败').toBe(true);
  });
});

describe('share 信号 · 什么算一条活动', () => {
  it('🔴 自己设备写的 op 不算活动（自己动手的事不需要通知自己）', () => {
    expect(shareActivitiesFromOps([op({ id: 'c-1', clientId: ME })], ME)).toEqual([]);
  });

  it('评论新增 ⇒ added；评论删除 ⇒ deleted；两类同时到达 ⇒ 去重且按来序', () => {
    expect(shareActivitiesFromOps([op({ id: 'c-1' })], ME)).toEqual(['added']);
    expect(
      shareActivitiesFromOps([op({ id: 'c-2', opType: OpType.Delete, actionType: 'delete comment' })], ME),
    ).toEqual(['deleted']);
    expect(
      shareActivitiesFromOps(
        [
          op({ id: 'c-3', opType: OpType.Delete }),
          op({ id: 'c-4', opType: OpType.Delete }),
          op({ id: 'c-5' }),
        ],
        ME,
      ),
    ).toEqual(['deleted', 'added']);
  });

  it('编辑评论正文（UPD）⇒ 不响：偏好里没有"编辑"这一档，塞进 added 就是响错', () => {
    expect(shareActivitiesFromOps([op({ id: 'c-6', opType: OpType.Update })], ME)).toEqual([]);
  });

  it('非 COMMENT 的 op ⇒ 不响（M2 之后 TASK 的 op **已经**在这份日志里，但活动档位今天只映射评论）', () => {
    // 这一臂钉的是"映射面"，不是"日志里有什么"：M2（ADR-0067 裁决一/补三）之后共享任务的
    // CRT/UPD/DEL 确实进 share log，而偏好表里没有"有人加了任务 / 有人勾了完成"那一档措辞。
    // 要给任务族加档位，改的是这一臂 + `ShareSignalActivity` 那个联合 + 通知偏好那一节，
    // 不是让 `completed` 那一档悄悄长出一个没人判过的输入。
    expect(shareActivitiesFromOps([op({ id: 't-1', entityType: 'TASK' })], ME)).toEqual([]);
  });
});

describe('打开一份共享清单 ⇒ 拉一次既有下行（M6 设备腿 L2 那一格）', () => {
  // 这一族判据的存在理由：`new_share_ops` 只在**有人新写**时响，所以"加入之前就在清单里的
  // 东西"没有任何一条路径会带来。2026-10-25 iOS 设备腿实测到（成员名册已下来、清单行已绑好，
  // 评论区那一节写「这条共享清单里还没有任务」）。pull 数得出次数，"每次都拉/不抛穿"才叫判据。
  const pulled = (added = 0): SharePullResult => ({
    fetched: added,
    added,
    cursor: 7,
    pages: 1,
  });

  it('打开 ⇒ 真的发一次拉取，且带的是这一份 shareId', async () => {
    const calls: string[] = [];
    const reading = await pullSharedListOnOpen(
      {
        pull: async (shareId) => {
          calls.push(shareId);
          return pulled(3);
        },
      },
      'share-a',
    );
    expect(calls).toEqual(['share-a']);
    expect(reading).toMatchObject({ shareId: 'share-a', pulled: true, added: 3 });
  });

  it('拉取抛错 ⇒ 不抛穿，读数里 pulled=true 且 error 在册（锁着的保险库不许变成错误弹窗）', async () => {
    const boom = new Error('vault locked');
    await expect(
      pullSharedListOnOpen({ pull: async () => { throw boom; } }, 'share-b'),
    ).resolves.toMatchObject({ shareId: 'share-b', pulled: true, added: 0, error: boom });
  });

  it('对照臂：追平那一趟（added=0）照样算"拉过" ⇒ 判据不是"有新内容才算"，撤掉拉取会红', async () => {
    const reading = await pullSharedListOnOpen({ pull: async () => pulled(0) }, 'share-c');
    expect(reading.pulled).toBe(true);
    expect(reading.added).toBe(0);
    expect(reading.error).toBeUndefined();
  });

  it('没有 shareId（空串/全空格）⇒ 零请求，不拿一个不存在的清单去撞 404', async () => {
    let calls = 0;
    const ports = {
      pull: async () => {
        calls += 1;
        return pulled(0);
      },
    };
    await expect(pullSharedListOnOpen(ports, '')).resolves.toMatchObject({ pulled: false });
    await pullSharedListOnOpen(ports, '   ');
    expect(calls).toBe(0);
  });
});
