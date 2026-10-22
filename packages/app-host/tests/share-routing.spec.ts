/**
 * M2 写路径路由（ADR-0067 裁决一 + 补一 + 补二）的判据
 * =====================================================
 *
 * 这批用例钉的不是"函数会跑"，而是这条路由**坏得掉的五种方式**：
 *
 * | 判据 | 坏法（症状） |
 * |---|---|
 * | 共享清单的写进 share、个人的写进个人 | 两边都写 ⇒ 对面看到重复；只写个人 ⇒ 就是 M2 之前那格"互相看不见" |
 * | 清单这条记录本身（含挂接/解绑）**一律**走个人 log | 进 share ⇒ "我取消共享"变成一条共享写，每个成员都收到；而对面物化出一条本机没有对应行的记录 |
 * | 跨边界移动具名拒绝、**两侧零调用** | 悄悄只写一半 ⇒ 实体历史裂成两本 log，任一侧回放都残缺；静默忽略 ⇒ 用户以为移动成功了 |
 * | 写 `tagIds` 前先把标签发布进这份 share | 不发布 ⇒ 对面渲染出一枚解不出名字的空白标签 |
 * | 解析不出来（任务没挂清单）⇒ 走个人、不抛 | 抛错 ⇒ 在个人清单上改一条无归属任务被炸 |
 *
 * 变异验证（一次性臂，做完即还原）：
 * ① 把 `isRoutableKind` 里的 `PROJECT` 判断改成"含 PROJECT" ⇒ 那三条 PROJECT 判据红；
 * ② 把 `crossesShareBoundary` 的抛错换成 `return`（静默忽略）⇒ 跨边界那几条红；
 * ③ 把标签发布那段 `continue` 改成无条件发 ⇒ 「已在册不重发」红。
 */
import { describe, expect, it } from 'vitest';

import { emptyState, type MaterializedState, type OpIntent } from '@heyta/op-log';
import { OpType } from '@heyta/sync-core';

import {
  createShareRoutingCheckedDispatcher,
  crossesShareBoundary,
  routeShareIdForEntity,
  ShareChannelUnavailableError,
  ShareCrossListMoveError,
  createShareRoutingDispatcher,
  type ShareWriteChannel,
} from '../src/share-routing.js';
import type { ShareOpDispatchIntent } from '../src/share-client.js';

const SHARED = 'share-1';

/** 造一份「一条共享清单 + 一条个人清单 + 各自一条任务 + 两枚标签」的物化状态。 */
function fixture(): MaterializedState {
  const state = emptyState();
  Object.assign(state.projects as object, {
    pShared: { id: 'pShared', name: '装修', shareId: SHARED },
    pPersonal: { id: 'pPersonal', name: '私人' },
    pOtherShared: { id: 'pOtherShared', name: '另一份共享', shareId: 'share-2' },
  });
  Object.assign(state.tasks as object, {
    tShared: { id: 'tShared', title: '买漆', projectId: 'pShared' },
    tPersonal: { id: 'tPersonal', title: '看牙', projectId: 'pPersonal' },
    tLoose: { id: 'tLoose', title: '无归属' },
  });
  Object.assign(state.tags as object, {
    tagUrgent: { id: 'tagUrgent', name: '急', color: '#f00' },
    tagLater: { id: 'tagLater', name: '以后' },
  });
  return state;
}

interface Calls {
  readonly personal: OpIntent[];
  readonly share: { shareId: string; intent: ShareOpDispatchIntent }[];
}

function harness(state: MaterializedState, shareState?: MaterializedState, withChannel = true): {
  calls: Calls;
  dispatch: (intent: OpIntent) => Promise<void>;
} {
  const calls: Calls = { personal: [], share: [] };
  const channel: ShareWriteChannel | undefined = withChannel
    ? {
      dispatch: async (shareId, intent) => { calls.share.push({ shareId, intent }); },
      stateFor: () => shareState ?? emptyState(),
    }
    : undefined;
  const dispatch = createShareRoutingDispatcher({
    personalDispatch: async (intent) => { calls.personal.push(intent); },
    channel: () => channel,
    getState: () => state,
  });
  return { calls, dispatch };
}

describe('通道没装上 ⇒ 具名拒绝，绝不悄悄退回个人 log', () => {
  it('共享清单里的任务、通道未装 ⇒ 抛 ShareChannelUnavailableError，个人侧零调用', async () => {
    const { calls, dispatch } = harness(fixture(), undefined, false);
    await expect(
      dispatch({ entityType: 'TASK', entityId: 'tShared', opType: OpType.Update, payload: { title: '买漆' } }),
    ).rejects.toBeInstanceOf(ShareChannelUnavailableError);
    expect(calls.personal).toHaveLength(0);
  });

  it('同一份状态下的**个人**任务、通道未装 ⇒ 照常写个人 log（拒绝只针对共享）', async () => {
    const { calls, dispatch } = harness(fixture(), undefined, false);
    await dispatch({ entityType: 'TASK', entityId: 'tPersonal', opType: OpType.Update, payload: { title: '看牙' } });
    expect(calls.personal).toHaveLength(1);
  });
});

describe('通道可以晚到（端壳的密钥是异步解出来的）', () => {
  /** 通道在下一拍才出现 —— 与 web 上 `getPayloadCipher()` 那个 await 同形。 */
  function lateChannelHarness(channelPromise: Promise<ShareWriteChannel | undefined>): (intent: OpIntent) => Promise<void> {
    return createShareRoutingDispatcher({
      personalDispatch: async () => { throw new Error('不该写个人 log'); },
      channel: () => channelPromise,
      getState: fixture,
    });
  }

  it('provider 返回 Promise ⇒ 派发**等**它给出通道，而不是抢在密钥落地前抛错', async () => {
    const sent: ShareOpDispatchIntent[] = [];
    const dispatch = lateChannelHarness(Promise.resolve({
      dispatch: async (_shareId, intent) => { sent.push(intent); },
      stateFor: () => emptyState(),
    }));
    await dispatch({ entityType: 'TASK', entityId: 'tShared', opType: OpType.Update, payload: { title: '买漆两桶' } });
    expect(sent).toHaveLength(1);
  });

  it('provider 异步地给出 undefined ⇒ 照样具名拒绝（等一次不等于把"没有"读成"有"）', async () => {
    const dispatch = lateChannelHarness(Promise.resolve(undefined));
    await expect(
      dispatch({ entityType: 'TASK', entityId: 'tShared', opType: OpType.Update, payload: { title: '买漆' } }),
    ).rejects.toBeInstanceOf(ShareChannelUnavailableError);
  });
});

describe('路由判据：所属清单的 shareId 是否在册', () => {
  it('共享清单里的任务 ⇒ 解析出那份 share', () => {
    expect(routeShareIdForEntity(fixture(), 'TASK', 'tShared')).toEqual({ shareId: SHARED });
  });

  it('个人清单里的任务 ⇒ blocked=project-not-shared（不是抛错）', () => {
    expect(routeShareIdForEntity(fixture(), 'TASK', 'tPersonal')).toEqual({ blocked: 'project-not-shared' });
  });

  it('标签没有清单归属 ⇒ kind-not-routable（这是补一存在的原因）', () => {
    expect(routeShareIdForEntity(fixture(), 'TAG', 'tagUrgent')).toEqual({ blocked: 'kind-not-routable' });
  });
});

describe('写侧分流：一个意图只进一本 log', () => {
  it('改共享任务的标题 ⇒ 进 share，个人侧零调用', async () => {
    const { calls, dispatch } = harness(fixture());
    await dispatch({ entityType: 'TASK', entityId: 'tShared', opType: OpType.Update, payload: { title: '买漆两桶' } });
    expect(calls.personal).toHaveLength(0);
    expect(calls.share).toEqual([{ shareId: SHARED, intent: { entityType: 'TASK', entityId: 'tShared', opType: OpType.Update, payload: { title: '买漆两桶' } } }]);
  });

  it('改个人任务的标题 ⇒ 进个人 log，share 侧零调用', async () => {
    const { calls, dispatch } = harness(fixture());
    await dispatch({ entityType: 'TASK', entityId: 'tPersonal', opType: OpType.Update, payload: { title: '看牙改约' } });
    expect(calls.share).toHaveLength(0);
    expect(calls.personal).toHaveLength(1);
  });

  it('任务没挂清单 ⇒ 走个人 log 且不抛（读个人清单没有理由被炸）', async () => {
    const { calls, dispatch } = harness(fixture());
    await dispatch({ entityType: 'TASK', entityId: 'tLoose', opType: OpType.Update, payload: { title: '随便' } });
    expect(calls.share).toHaveLength(0);
    expect(calls.personal).toHaveLength(1);
  });
});

describe('清单这条记录本身一律走个人 log（ADR-0068 裁决一）', () => {
  it('解绑（清单已在册、payload 把 shareId 置空）⇒ 仍走个人，绝不进 share', async () => {
    const { calls, dispatch } = harness(fixture());
    await dispatch({ entityType: 'PROJECT', entityId: 'pShared', opType: OpType.Update, payload: { shareId: null } });
    expect(calls.share).toHaveLength(0);
    expect(calls.personal).toHaveLength(1);
  });

  it('同一份清单上改名字（shareId 在册）⇒ **也走个人**：清单不是共享内容', async () => {
    const { calls, dispatch } = harness(fixture());
    await dispatch({ entityType: 'PROJECT', entityId: 'pShared', opType: OpType.Update, payload: { name: '家庭装修' } });
    expect(calls.share).toHaveLength(0);
    expect(calls.personal).toHaveLength(1);
  });

  it('PROJECT 这个类型解析结果 = kind-not-routable（判据只有一处，不留"改绑定"那种特例守卫）', () => {
    expect(routeShareIdForEntity(fixture(), 'PROJECT', 'pShared')).toEqual({ blocked: 'kind-not-routable' });
  });
});

describe('跨边界移动具名拒绝（补二）', () => {
  it('共享 → 个人：抛 ShareCrossListMoveError，且两侧都零调用', async () => {
    const { calls, dispatch } = harness(fixture());
    await expect(
      dispatch({ entityType: 'TASK', entityId: 'tShared', opType: OpType.Update, payload: { projectId: 'pPersonal' } }),
    ).rejects.toBeInstanceOf(ShareCrossListMoveError);
    expect(calls).toEqual({ personal: [], share: [] });
  });

  it('个人 → 共享：同样拒绝（进共享要把内容交给别人的钥，属 M3/M4 那一族）', async () => {
    const { dispatch } = harness(fixture());
    await expect(
      dispatch({ entityType: 'TASK', entityId: 'tPersonal', opType: OpType.Update, payload: { projectId: 'pShared' } }),
    ).rejects.toThrow(/SHARE_CROSS_LIST_MOVE_NOT_SUPPORTED|跨清单移动/);
  });

  it('共享 → 另一份共享：也拒绝（两份 share 的密钥不同）', () => {
    expect(crossesShareBoundary(fixture(), {
      entityType: 'TASK', entityId: 'tShared', opType: OpType.Update, payload: { projectId: 'pOtherShared' },
    })).toBe(true);
  });

  it('同一条共享清单内部换任务顺序（不碰 projectId）⇒ 不算移动', async () => {
    const { calls, dispatch } = harness(fixture());
    await dispatch({ entityType: 'TASK', entityId: 'tShared', opType: OpType.Update, payload: { sortOrder: 3 } });
    expect(calls.share).toHaveLength(1);
  });
});

describe('标签发布是一条独立意图（补一）', () => {
  it('给共享任务打一枚这份 share 里还没有的标签 ⇒ 先一条 TAG 创建、再一条 tagIds 写', async () => {
    const { calls, dispatch } = harness(fixture());
    await dispatch({ entityType: 'TASK', entityId: 'tShared', opType: OpType.Update, payload: { tagIds: ['tagUrgent'] } });
    expect(calls.share.map((c) => [c.intent.entityType, c.intent.opType])).toEqual([
      ['TAG', OpType.Create],
      ['TASK', OpType.Update],
    ]);
    expect(calls.share[0]!.intent).toEqual({ entityType: 'TAG', entityId: 'tagUrgent', opType: OpType.Create, payload: { name: '急', color: '#f00' } });
  });

  it('标签已在册 ⇒ 不重发（幂等：第二次写同一个 tagIds 只多一条任务 op）', async () => {
    const already = emptyState();
    Object.assign(already.tags as object, { tagUrgent: { id: 'tagUrgent', name: '急' } });
    const { calls, dispatch } = harness(fixture(), already);
    await dispatch({ entityType: 'TASK', entityId: 'tShared', opType: OpType.Update, payload: { tagIds: ['tagUrgent'] } });
    expect(calls.share.map((c) => c.intent.entityType)).toEqual(['TASK']);
  });

  it('两枚标签一枚在册一枚没有 ⇒ 只补没有的那枚', async () => {
    const already = emptyState();
    Object.assign(already.tags as object, { tagUrgent: { id: 'tagUrgent', name: '急' } });
    const { calls, dispatch } = harness(fixture(), already);
    await dispatch({ entityType: 'TASK', entityId: 'tShared', opType: OpType.Update, payload: { tagIds: ['tagUrgent', 'tagLater'] } });
    expect(calls.share.map((c) => c.intent.entityId)).toEqual(['tagLater', 'tShared']);
  });
});

describe('路由版 dispatchChecked：走 CAS 的那两枚动作也必须分流', () => {
  /**
   * 判据形状：`setTaskEstimate` / `appendChecklist` 提交 intent 走的是**引擎内部**的
   * `dispatchLocked`，外面那层 `dispatch` 路由拦不到。不单独给一条路由，
   * 它们就会把共享清单里一条任务的改动写进个人 log —— 症状与 M2 之前一模一样。
   */
  function checkedHarness(opts: {
    engineState: MaterializedState;
    view: MaterializedState;
    shareState?: MaterializedState;
    withChannel?: boolean;
  }): { calls: Calls; run: <T>(build: (state: MaterializedState) => { intent?: OpIntent; value: T }) => Promise<T> } {
    const calls: Calls = { personal: [], share: [] };
    const channel: ShareWriteChannel | undefined = opts.withChannel === false
      ? undefined
      : {
        dispatch: async (shareId, intent) => { calls.share.push({ shareId, intent }); },
        stateFor: () => opts.shareState ?? emptyState(),
      };
    // 替身引擎：同步跑 build；build 给了 intent 就等于"在写队列里提交了"。
    const engineDispatchChecked = async <T>(
      build: (state: MaterializedState) => { intent?: OpIntent; value: T },
    ): Promise<T> => {
      const result = build(opts.engineState);
      if (result.intent !== undefined) calls.personal.push(result.intent);
      return result.value;
    };
    const run = createShareRoutingCheckedDispatcher({
      personalDispatch: async (intent) => { calls.personal.push(intent); },
      channel: () => channel,
      getState: () => opts.view,
      engineDispatchChecked,
    });
    return { calls, run };
  }

  const estimateIntent: OpIntent = {
    entityType: 'TASK', entityId: 'tShared', opType: OpType.Update, payload: { note: '⏱ 25m' },
  };

  it('目标是共享清单的任务 ⇒ 交进 share，个人侧一条都不写，返回值原样透传', async () => {
    const base = fixture();
    const { calls, run } = checkedHarness({ engineState: base, view: base });
    const value = await run(() => ({ value: 'updated' as const, intent: estimateIntent }));
    expect(value).toBe('updated');
    expect(calls.share.map((c) => c.shareId)).toEqual([SHARED]);
    expect(calls.personal).toHaveLength(0);
  });

  it('目标是个人任务 ⇒ **原样交回引擎**（CAS 仍在写队列里），share 侧零调用', async () => {
    const base = fixture();
    const personalIntent: OpIntent = { ...estimateIntent, entityId: 'tPersonal' };
    const { calls, run } = checkedHarness({ engineState: base, view: base });
    await run(() => ({ value: 'updated' as const, intent: personalIntent }));
    expect(calls.share).toHaveLength(0);
    expect(calls.personal).toEqual([personalIntent]);
  });

  it('build 没给 intent（没改动 / 找不到条目）⇒ 两侧零调用', async () => {
    const base = fixture();
    const { calls, run } = checkedHarness({ engineState: base, view: base });
    expect(await run(() => ({ value: 'unchanged' as const }))).toBe('unchanged');
    expect(calls).toEqual({ personal: [], share: [] });
  });

  it('跨边界移动 ⇒ 抛具名错误，**两侧都零**（不许悄悄只写一半）', async () => {
    const base = fixture();
    const { calls, run } = checkedHarness({
      engineState: base,
      view: base,
    });
    await expect(
      run(() => ({
        value: 'moved' as const,
        intent: { entityType: 'TASK', entityId: 'tShared', opType: OpType.Update, payload: { projectId: 'pPersonal' } },
      })),
    ).rejects.toBeInstanceOf(ShareCrossListMoveError);
    expect(calls).toEqual({ personal: [], share: [] });
  });

  it('通道没装上 ⇒ 抛 ShareChannelUnavailable，个人侧零（绝不退回个人 log）', async () => {
    const base = fixture();
    const { calls, run } = checkedHarness({ engineState: base, view: base, withChannel: false });
    await expect(run(() => ({ value: 'updated' as const, intent: estimateIntent })))
      .rejects.toBeInstanceOf(ShareChannelUnavailableError);
    expect(calls.personal).toHaveLength(0);
  });

  it('判据读的是**合并视图**：引擎状态里没有、只有共享日志里有的那条任务，也要正确分流', async () => {
    const engineState = fixture(); // 个人 log：没有 tTheirs
    const view = fixture();
    Object.assign(view.tasks as object, { tTheirs: { id: 'tTheirs', title: '买刷子', projectId: 'pShared' } });
    const theirs: OpIntent = { entityType: 'TASK', entityId: 'tTheirs', opType: OpType.Update, payload: { note: '⏱ 10m' } };
    const { calls, run } = checkedHarness({ engineState, view });
    await run(() => ({ value: 'updated' as const, intent: theirs }));
    expect(calls.share.map((c) => c.intent.entityId)).toEqual(['tTheirs']);
    // 如果这枚判据读的是引擎给的那份个人状态，tTheirs 解析不出来 ⇒ 会被判成个人 ⇒ 这条必红。
    expect(calls.personal).toHaveLength(0);
  });
});
