/**
 * M2 在 **web 这一端**的接线判据：`lib/oplog.ts` 的写入口与读入口确实走了路由与合并视图。
 * ============================================================================
 *
 * app-host 那边已经证过判据本体（`share-routing.spec.ts`、`share-view.spec.ts`）。
 * 这一枚钉的是**接起来不断** —— 仓内最高发的失效形状是"两边各自绿，中间那一行没人测"：
 *
 * | 判据 | 坏法（症状） |
 * |---|---|
 * | 装了通道之后，共享清单里一条任务的改动**不进个人 op-log** | 只接了读没接写 ⇒ 改动落本机，对面的成员永远看不见（就是 M2 之前那一格） |
 * | `currentState()` 交出的是合并视图 | 只接送侧不接读侧 ⇒ 作者连自己刚写的改动都看不见（数据在 share 日志里、界面空白） |
 * | 判据读的状态与界面读的是**同一份** | 路由自己读引擎状态 ⇒ 别人建的那条任务判成"个人"，改动悄悄只落本机 |
 * | 个人清单的写照旧落个人 log | 路由把所有写都往 share 上试 ⇒ 没登录时连改名都炸 |
 * | 通道装不上 ⇒ 具名拒绝且个人侧零写 | 退回个人 log ⇒ "改成功了"但对面的成员永远看不见 |
 * | `dispatchChecked`（CAS 那条**第二个提交入口**）同样分流 | 只包 `dispatch` ⇒ AI 追加清单、估时那两枚动作绕过路由 |
 *
 * ⚠️ 每一条都带对照臂：同一条写在**没装通道**时确实会落进个人 log。
 *    少了这一臂，"个人 log 没多一条"可能只是因为那条写根本没发生。
 *
 * 变异验证（一次性臂，2026-10-22 实测后已还原，还原只从 `.mut-bak` 取并 `diff -q` 确认）：
 * ① `dispatchIntent` 绕过路由（直接 `engine.dispatch`）⇒ 恰好 4 枚具名红
 *    （共享那条写进个人 log、跨边界不再拒、通道缺失不再抛、判据不再同源）；
 * ② `currentState()` 不合并（`return personal`）⇒ 恰好 3 枚具名红（读侧三格全红）；
 * ③ `dispatchChecked` 绕过路由 ⇒ 恰好 1 枚具名红（共享条目上那枚 CAS）。
 * 三臂各自只打中自己那一族 ⇒ 这 11 枚判据不是"整片一起红"的粗尺。
 */
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

import { createShareViewMerger, ShareChannelUnavailableError, ShareCrossListMoveError, type ShareOpDispatchIntent, type ShareWriteChannel } from '@heyta/app-host';
import { emptyState, type MaterializedState, type OpIntent } from '@heyta/op-log';
import { OpType } from '@heyta/sync-core';

import {
  __resetOpLogForTests,
  attachShareWiring,
  currentState,
  dispatchChecked,
  dispatchIntent,
  initOpLog,
  requireEngine,
} from '../src/lib/oplog.js';

const SHARED = 'share-web-1';

let dbName: string;
const sent: { shareId: string; intent: ShareOpDispatchIntent }[] = [];

function shareState(tasks: MaterializedState['tasks'] = {}): MaterializedState {
  const state = emptyState();
  Object.assign(state.tasks as object, tasks);
  return state;
}

/** 替身通道：记账而已，判断全在 app-host。 */
function channelFor(state: MaterializedState): ShareWriteChannel {
  return {
    dispatch: async (shareId, intent) => { sent.push({ shareId, intent }); },
    stateFor: () => state,
  };
}

function attach(state: MaterializedState = shareState()): void {
  const channel = channelFor(state);
  attachShareWiring({
    channel: () => channel,
    mergeView: createShareViewMerger({ stateFor: (shareId) => (shareId === SHARED ? channel.stateFor(shareId) : emptyState()) }),
  });
}

async function personalOpCount(): Promise<number> {
  return requireEngine().countStoredOps();
}

beforeEach(async () => {
  const g = globalThis as unknown as { indexedDB: IDBFactory; IDBKeyRange: typeof IDBKeyRange };
  g.indexedDB = new IDBFactory();
  g.IDBKeyRange = IDBKeyRange;
  sent.length = 0;
  dbName = `web-route-${Math.random().toString(36).slice(2)}`;
  __resetOpLogForTests();
  await initOpLog(dbName);

  // 播种：一条共享清单（挂 shareId）+ 一条个人清单 + 各自一条任务。全走真实引擎。
  for (const intent of [
    { entityType: 'PROJECT', entityId: 'pShared', opType: OpType.Create, payload: { name: '装修' } },
    { entityType: 'PROJECT', entityId: 'pPersonal', opType: OpType.Create, payload: { name: '私人' } },
    { entityType: 'TASK', entityId: 'tShared', opType: OpType.Create, payload: { title: '买漆', projectId: 'pShared' } },
    { entityType: 'TASK', entityId: 'tPersonal', opType: OpType.Create, payload: { title: '看牙', projectId: 'pPersonal' } },
    { entityType: 'PROJECT', entityId: 'pShared', opType: OpType.Update, payload: { shareId: SHARED } },
  ] satisfies OpIntent[]) {
    await dispatchIntent(intent);
  }
});

describe('写侧：共享清单的改动不再进个人 op-log', () => {
  it('对照臂 —— 没装通道时，同一条写**确实**落进个人 log（这条写本身是能落盘的）', async () => {
    const before = await personalOpCount();
    await dispatchIntent({ entityType: 'TASK', entityId: 'tShared', opType: OpType.Update, payload: { title: '买漆两桶' } });
    expect(await personalOpCount()).toBe(before + 1);
    expect(sent).toHaveLength(0);
  });

  it('装上通道后改共享任务的标题 ⇒ 个人 log 一条不多，通道收到那条', async () => {
    attach();
    const before = await personalOpCount();
    await dispatchIntent({ entityType: 'TASK', entityId: 'tShared', opType: OpType.Update, payload: { title: '买漆两桶' } });
    expect(await personalOpCount()).toBe(before);
    expect(sent).toEqual([
      { shareId: SHARED, intent: { entityType: 'TASK', entityId: 'tShared', opType: OpType.Update, payload: { title: '买漆两桶' } } },
    ]);
  });

  it('个人清单里的任务照旧进个人 log（路由不许把不属于共享的写也拦走）', async () => {
    attach();
    const before = await personalOpCount();
    await dispatchIntent({ entityType: 'TASK', entityId: 'tPersonal', opType: OpType.Update, payload: { title: '看牙改约' } });
    expect(await personalOpCount()).toBe(before + 1);
    expect(sent).toHaveLength(0);
  });

  it('跨边界移动 ⇒ 具名拒绝，两侧零写', async () => {
    attach();
    const before = await personalOpCount();
    await expect(
      dispatchIntent({ entityType: 'TASK', entityId: 'tShared', opType: OpType.Update, payload: { projectId: 'pPersonal' } }),
    ).rejects.toBeInstanceOf(ShareCrossListMoveError);
    expect(await personalOpCount()).toBe(before);
    expect(sent).toHaveLength(0);
  });

  it('通道问出来是空的 ⇒ 抛 ShareChannelUnavailableError，个人侧一条都不写', async () => {
    attachShareWiring({ channel: () => undefined, mergeView: (personal) => personal });
    const before = await personalOpCount();
    await expect(
      dispatchIntent({ entityType: 'TASK', entityId: 'tShared', opType: OpType.Update, payload: { title: '买漆三桶' } }),
    ).rejects.toBeInstanceOf(ShareChannelUnavailableError);
    expect(await personalOpCount()).toBe(before);
  });
});

describe('读侧：currentState() 交出的是合并视图', () => {
  it('别人建的那条任务在界面上显形，并挂到本机那条清单行', () => {
    attach(shareState({ tRemote: { id: 'tRemote', title: '别人买的漆', projectId: 'pAuthorSide' } }));
    const merged = currentState();
    expect(merged.tasks['tRemote']?.title).toBe('别人买的漆');
    // 🔴 作者本机那条清单 id 在这台设备上不存在；不重定位就落进"未归属"。
    expect(merged.tasks['tRemote']?.projectId).toBe('pShared');
    // 本机自己那条不能丢。
    expect(merged.tasks['tShared']).toBeDefined();
  });

  it('摘掉接线 ⇒ 逐字退回引擎那一份（共享内容随之消失，本机条目一条不少）', () => {
    attach(shareState({ tRemote: { id: 'tRemote', title: '别人买的漆', projectId: 'pAuthorSide' } }));
    expect(currentState().tasks['tRemote']).toBeDefined();
    attachShareWiring(undefined);
    expect(currentState()).toBe(requireEngine().getState());
    expect(currentState().tasks['tRemote']).toBeUndefined();
    expect(currentState().tasks['tShared']).toBeDefined();
  });

  it('判据与界面同源：只有共享日志里有的那条任务，路由也认它是共享的', async () => {
    const before = await personalOpCount();
    attach(shareState({ tRemote: { id: 'tRemote', title: '别人买的漆', projectId: 'pAuthorSide' } }));
    await dispatchIntent({ entityType: 'TASK', entityId: 'tRemote', opType: OpType.Update, payload: { title: '买漆两桶' } });
    expect(sent.map((c) => c.intent.entityId)).toEqual(['tRemote']);
    expect(await personalOpCount()).toBe(before);
  });
});

describe('第二个提交入口：dispatchChecked（CAS）同样分流', () => {
  it('共享条目上的 CAS 动作 ⇒ 个人 log 一条不多，通道收到那条', async () => {
    attach();
    const before = await personalOpCount();
    const value = await dispatchChecked<string>(() => ({
      value: '估时已写',
      intent: { entityType: 'TASK', entityId: 'tShared', opType: OpType.Update, payload: { timeEstimate: 3_600_000 } },
    }));
    expect(value).toBe('估时已写');
    expect(await personalOpCount()).toBe(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.intent).toEqual({ entityType: 'TASK', entityId: 'tShared', opType: OpType.Update, payload: { timeEstimate: 3_600_000 } });
  });

  it('个人条目上的 CAS 动作 ⇒ 仍在引擎写队列里落盘（接路由没让 CAS 退化）', async () => {
    attach();
    const before = await personalOpCount();
    const value = await dispatchChecked<string>(() => ({
      value: '本地写好了',
      intent: { entityType: 'TASK', entityId: 'tPersonal', opType: OpType.Update, payload: { timeEstimate: 1_800_000 } },
    }));
    expect(value).toBe('本地写好了');
    expect(await personalOpCount()).toBe(before + 1);
    expect(sent).toHaveLength(0);
    // 落的是 build 交回的那条 intent，不是被摘走半截的形状。
    expect(currentState().tasks['tPersonal']?.timeEstimate).toBe(1_800_000);
  });

  it('CAS 里判定"这次不写" ⇒ 两侧零调用', async () => {
    attach();
    const before = await personalOpCount();
    const value = await dispatchChecked<string>(() => ({ value: '什么都没改' }));
    expect(value).toBe('什么都没改');
    expect(await personalOpCount()).toBe(before);
    expect(sent).toHaveLength(0);
  });
});
