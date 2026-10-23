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
 * | **新建**那一形：归属从这次写入声明的 `projectId`/`taskId` 读，且"实体还不存在"不算移动 | 只认已存在的实体 ⇒ 共享清单里加一条任务要么落进个人 log（对面永远看不见），要么当场抛"暂不支持跨清单移动" |
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
  routeShareIdForIntent,
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

  it('🔴 载荷里塞一个共享清单的 id **压不过**裁决一：实体已存在时仍按它自己的归属判', () => {
    // 补三那句"回退只发生在 `entity-not-found` 那一形"的钉子。
    // 这条判的是**解析器**而不是派发器：派发器上"把个人任务改到共享清单"会先撞上
    // 补二的 `reject-move`，所以那条路本来就红不了 —— 而解析器这一层要是松了，
    // 任何一次带 projectId 的写都能把私人条目判成共享（交到别人的钥后面）。
    expect(
      routeShareIdForIntent(fixture(), {
        entityType: 'TASK',
        entityId: 'tPersonal',
        opType: OpType.Update,
        payload: { projectId: 'pShared', title: '看牙' },
      }),
    ).toEqual({ blocked: 'project-not-shared' });
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

/**
 * 🔴 新建那一形：实体**还不在这台设备的状态里**，"所属清单"只能从这次写入声明的归属读。
 *
 * 这批是 2026-10-22 做 M2-d 验收臂时发现的洞，不是风格问题：
 * `routeShareIdForEntity` 只解析"已存在的实体"，于是新建一条共享任务得到
 * `entity-not-found` ⇒ 判成个人；更糟的是 `crossesShareBoundary` 那两侧里
 * "源"也是 undefined ⇒ 与目的地的 shareId 不等 ⇒ **在共享清单里新建任务当场抛
 * "暂不支持跨清单移动"**。用户点的是"加一条任务"，界面报的是一次移动被拒。
 * 已登记为 ADR-0067「一·补」的第三类，不改上面任何一条裁决。
 */
describe('新建（CRT）那一形的归属解析', () => {
  const NEW = 't-brand-new';

  it('在共享清单里新建一条任务 ⇒ 进 share，个人侧零调用', async () => {
    const { calls, dispatch } = harness(fixture());
    await dispatch({
      entityType: 'TASK',
      entityId: NEW,
      opType: OpType.Create,
      payload: { title: '买滚筒', projectId: 'pShared' },
    });
    expect(calls.personal).toHaveLength(0);
    expect(calls.share).toHaveLength(1);
    expect(calls.share[0]!.shareId).toBe(SHARED);
  });

  it('在个人清单里新建 ⇒ 进个人 log，且不抛（新建不是"从 undefined 搬过来"）', async () => {
    const { calls, dispatch } = harness(fixture());
    await dispatch({
      entityType: 'TASK',
      entityId: NEW,
      opType: OpType.Create,
      payload: { title: '约牙医', projectId: 'pPersonal' },
    });
    expect(calls.share).toHaveLength(0);
    expect(calls.personal).toHaveLength(1);
  });

  it('收集箱里新建（载荷根本没有 projectId）⇒ 走个人 log', async () => {
    const { calls, dispatch } = harness(fixture());
    await dispatch({ entityType: 'TASK', entityId: NEW, opType: OpType.Create, payload: { title: '随手一条' } });
    expect(calls.share).toHaveLength(0);
    expect(calls.personal).toHaveLength(1);
  });

  it('在共享清单里新建、通道没装上 ⇒ 具名拒绝，绝不退回个人 log', async () => {
    const { calls, dispatch } = harness(fixture(), undefined, false);
    await expect(
      dispatch({ entityType: 'TASK', entityId: NEW, opType: OpType.Create, payload: { title: '买滚筒', projectId: 'pShared' } }),
    ).rejects.toBeInstanceOf(ShareChannelUnavailableError);
    expect(calls.personal).toHaveLength(0);
  });

  it('便签同形：在共享清单里新建 ⇒ 进 share', async () => {
    const state = fixture();
    Object.assign(state.notes as object, {});
    const { calls, dispatch } = harness(state);
    await dispatch({
      entityType: 'NOTE',
      entityId: 'n-brand-new',
      opType: OpType.Create,
      payload: { body: '门要换锁芯', projectId: 'pShared' },
    });
    expect(calls.personal).toHaveLength(0);
    expect(calls.share.map((c) => c.intent.entityType)).toEqual(['NOTE']);
  });

  it('评论同形：归属由它挂的那条任务决定（那条任务在共享清单里 ⇒ 进 share）', async () => {
    const { calls, dispatch } = harness(fixture());
    await dispatch({
      entityType: 'COMMENT',
      entityId: 'c-brand-new',
      opType: OpType.Create,
      payload: { taskId: 'tShared', body: '要哑光的' },
    });
    expect(calls.personal).toHaveLength(0);
    expect(calls.share[0]!.shareId).toBe(SHARED);
  });

  it('反向防回归：实体**已存在**时把 projectId 从共享改成个人 ⇒ 仍然具名拒绝', async () => {
    const { calls, dispatch } = harness(fixture());
    await expect(
      dispatch({ entityType: 'TASK', entityId: 'tShared', opType: OpType.Update, payload: { projectId: 'pPersonal' } }),
    ).rejects.toBeInstanceOf(ShareCrossListMoveError);
    expect(calls).toEqual({ personal: [], share: [] });
  });
});
