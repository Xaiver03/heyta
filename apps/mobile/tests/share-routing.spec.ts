/**
 * 移动端**共享写路由**（`share/wiring.ts`）—— M6 最大的一块：共享清单里的改动
 * 不许悄悄落进个人 op-log。
 * ============================================================================
 *
 * ## 判据钉的是"可观察的调用"，不是"函数跑完了"
 *
 * 路由判据本体在 `@heyta/app-host`（`decideShareWrite`，全仓唯一出处）；
 * 这里钉的是**移动端确实把它装上了**，且三件材料接对了：
 *   · 共享清单里的任务改动 ⇒ 个人那条腿**一次都不写**（计数替身），share 通道收到；
 *   · 非共享清单的改动 ⇒ 通道提供者**一次都不问**，原样进个人 log；
 *   · 通道装不上（未登录/没解锁）⇒ `ShareChannelUnavailableError` 具名失败，
 *     **不许**"落本地当成功"（这条产品的核心承诺不是可绕的工程细节）；
 *   · 签名件拿不到 ⇒ 真 `createShareCommentDispatch` 撞 `ShareOpUnsignableError`：
 *     零上行、share 日志一条不折、个人 log 一条不写。
 * `dispatchChecked`（CAS 那两枚动作）必须给同一个答案 —— 少了一处就是换皮复活。
 */

import { describe, expect, it, vi } from 'vitest';

import {
  createShareCommentDispatch,
  ShareChannelUnavailableError,
  ShareCrossListMoveError,
  ShareOpUnsignableError,
  type ShareLogStorage,
  type ShareWriteChannel,
} from '@heyta/app-host';
import { emptyState, type CheckedDispatchBuilder, type MaterializedState, type OpIntent } from '@heyta/op-log';
import { OpType } from '@heyta/sync-core';

import {
  attachMobileShareWiring,
  bindMobileOplogBase,
  currentState,
  dispatchChecked,
  dispatchIntent,
  type MobileOplogBase,
} from '../src/share/wiring';

import { mobileSources, read, stripComments } from './source-reading';

function stateWith(shareId?: string): MaterializedState {
  return {
    ...emptyState(),
    projects: {
      p1: { id: 'p1', name: '清单', deletedAt: undefined, ...(shareId === undefined ? {} : { shareId }) } as never,
    },
    tasks: {
      t1: { id: 't1', projectId: 'p1', deletedAt: undefined } as never,
    },
  } as MaterializedState;
}

function fakeBase(state: () => MaterializedState = () => stateWith('s1')) {
  const dispatch = vi.fn(async (_intent: OpIntent): Promise<unknown> => undefined);
  const seen = new Map<string, string>();
  let checkedCalls = 0;
  const dispatchChecked = (<T,>(build: CheckedDispatchBuilder<T>): Promise<T> => {
    checkedCalls += 1;
    const result = build(state());
    // 记下引擎**真的拿到**的那条 intent（路由判为共享时应为 undefined）。
    seen.set('engineIntent', result.intent === undefined ? 'none' : String(result.intent.entityId));
    return Promise.resolve(result.value as T);
  }) as MobileOplogBase['dispatchChecked'];
  const host: MobileOplogBase = { dispatch, dispatchChecked, getState: state };
  return { host, dispatch, dispatchChecked, seen, checkedCalls: () => checkedCalls };
}

function fakeChannel() {
  const dispatch = vi.fn(async (_shareId: string, _intent: unknown): Promise<void> => undefined);
  const channel: ShareWriteChannel = {
    dispatch,
    stateFor: () => emptyState() as MaterializedState,
  };
  return { channel, dispatch };
}

function attachWithChannel(channel: ShareWriteChannel | undefined, calls: { n: number } = { n: 0 }) {
  attachMobileShareWiring({
    channel: async () => {
      calls.n += 1;
      return channel;
    },
    mergeView: (personal) => personal,
  });
  return calls;
}

const taskUpdate: OpIntent = { entityType: 'TASK', entityId: 't1', opType: OpType.Update, payload: { done: true } };

describe('移动端共享写路由（wiring.ts）', () => {
  it('🔴 共享清单里的任务改动**不写个人 op-log**，进 share 通道并带上 shareId', async () => {
    const { host, dispatch } = fakeBase();
    const { channel, dispatch: channelDispatch } = fakeChannel();
    bindMobileOplogBase(host);
    attachWithChannel(channel);

    await dispatchIntent(taskUpdate);

    expect(dispatch, '共享改动悄悄落进了个人 op-log —— 对面的成员永远看不见，正是要关掉的那格').not.toHaveBeenCalled();
    expect(channelDispatch).toHaveBeenCalledTimes(1);
    expect(channelDispatch.mock.calls[0]?.[0]).toBe('s1');
    expect(channelDispatch.mock.calls[0]?.[1]).toMatchObject({ entityType: 'TASK', entityId: 't1' });
  });

  it('🔴 非共享清单的改动**不进** share 通道（通道提供者一次都不问），原样进个人 log', async () => {
    const { host, dispatch } = fakeBase(() => stateWith(undefined));
    const { channel } = fakeChannel();
    bindMobileOplogBase(host);
    const calls = attachWithChannel(channel);

    await dispatchIntent(taskUpdate);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(calls.n, '个人那条腿不该催问共享通道').toBe(0);
  });

  it('没装共享通道时**逐字等于原来的 dispatch**（web 的既有纪律）', async () => {
    const { host, dispatch } = fakeBase();
    bindMobileOplogBase(host);
    attachMobileShareWiring(undefined);

    await dispatchIntent(taskUpdate);

    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('🔴 实体属于共享清单但通道装不上 ⇒ 具名 `ShareChannelUnavailableError`，个人 log 一条不写', async () => {
    const { host, dispatch } = fakeBase();
    bindMobileOplogBase(host);
    attachWithChannel(undefined);

    await expect(dispatchIntent(taskUpdate)).rejects.toBeInstanceOf(ShareChannelUnavailableError);
    expect(dispatch, '退回个人 log 就是这条线一直在防的"写成功了但对面永远看不见"').not.toHaveBeenCalled();
  });

  it('🔴 签名件拿不到 ⇒ 写路径具名失败（`ShareOpUnsignableError`）：零上行、日志不折、个人 log 不写', async () => {
    // 真 `createShareCommentDispatch`（app-host 那件实现）接到移动端路由上：
    // 上行端口/加解密都齐、唯独 `signerFor` 给不出身份（这台设备没有成员行/没解锁）。
    const uploadOps = vi.fn(async () => ({ accepted: [], rejected: [] }));
    const downloadOps = vi.fn(async () => ({ ops: [], cursor: { latestServerSeq: 0 } }));
    const saved: string[] = [];
    const storage: ShareLogStorage = {
      load: () => undefined,
      save: (shareId) => {
        saved.push(shareId);
      },
      list: () => [],
      cursor: () => 0,
      setCursor: () => undefined,
    };
    const dispatch = createShareCommentDispatch({
      api: { uploadOps, downloadOps } as never,
      cipherFor: async () => ({ encrypt: async () => 'ct', decrypt: async () => '{}' }),
      // 🔴 不许为了跑通而临时造一把密钥 —— 如实给不出，让写路径具名失败。
      signerFor: async () => undefined,
      storage,
      currentUserId: () => 'u-1',
      clientId: 'dev-1',
      schemaVersion: 1,
      isSignedIn: () => true,
    });
    const { host, dispatch: personalDispatch } = fakeBase();
    bindMobileOplogBase(host);
    attachWithChannel({ dispatch: dispatch.dispatchShareOp, stateFor: dispatch.stateFor });

    await expect(dispatchIntent(taskUpdate)).rejects.toBeInstanceOf(ShareOpUnsignableError);
    expect(uploadOps, '签不出名就不该有一个上行请求').not.toHaveBeenCalled();
    expect(saved, '签不出的那条 op 不许折进本地 share 日志').toHaveLength(0);
    expect(personalDispatch, '失败也不许退回个人 log').not.toHaveBeenCalled();
  });

  it('`dispatchChecked`（CAS 那两枚动作）给**同一个答案**：共享 ⇒ 引擎一条不提交、通道收到', async () => {
    const { host, seen, checkedCalls } = fakeBase();
    const { channel, dispatch: channelDispatch } = fakeChannel();
    bindMobileOplogBase(host);
    attachWithChannel(channel);

    const value = await dispatchChecked<string>(() => ({ value: 'ok', intent: taskUpdate }));

    expect(value).toBe('ok');
    expect(seen.get('engineIntent'), '共享那一形必须在队列里只决策不提交').toBe('none');
    expect(channelDispatch).toHaveBeenCalledTimes(1);
    expect(checkedCalls()).toBe(1);
  });

  it('`dispatchChecked` 判为个人 ⇒ intent 原样交回引擎（CAS 语义与接路由之前逐字相同）', async () => {
    const { host, seen } = fakeBase(() => stateWith(undefined));
    const { channel, dispatch: channelDispatch } = fakeChannel();
    bindMobileOplogBase(host);
    attachWithChannel(channel);

    await dispatchChecked<string>(() => ({ value: 'ok', intent: taskUpdate }));

    expect(seen.get('engineIntent')).toBe('t1');
    expect(channelDispatch).not.toHaveBeenCalled();
  });

  it('清单这条记录本身不是共享内容：共享清单的 PROJECT 改名走**个人** log（ADR-0068 裁决一）', async () => {
    const { host, dispatch } = fakeBase();
    const { channel, dispatch: channelDispatch } = fakeChannel();
    bindMobileOplogBase(host);
    attachWithChannel(channel);

    await dispatchIntent({ entityType: 'PROJECT', entityId: 'p1', opType: OpType.Update, payload: { name: '新名字' } });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(channelDispatch).not.toHaveBeenCalled();
  });

  it('跨边界移动一律具名拒绝（ADR-0067 补二）：两本 log 都不写', async () => {
    const { host, dispatch } = fakeBase();
    const { channel, dispatch: channelDispatch } = fakeChannel();
    bindMobileOplogBase(host);
    attachWithChannel(channel);

    await expect(
      dispatchIntent({ entityType: 'TASK', entityId: 't1', opType: OpType.Update, payload: { projectId: 'pOther' } }),
    ).rejects.toBeInstanceOf(ShareCrossListMoveError);
    expect(dispatch).not.toHaveBeenCalled();
    expect(channelDispatch).not.toHaveBeenCalled();
  });

  it('合并视图没装时 `currentState()` 逐字是个人状态', () => {
    const shared = stateWith('s1');
    const { host } = fakeBase(() => shared);
    bindMobileOplogBase(host);
    attachMobileShareWiring(undefined);
    expect(currentState()).toBe(host.getState());
  });

  it('🔴 判据工厂在移动端**只有一个构造点**，且实时通道确实把两类共享信号传了出去（源码读数）', () => {
    const routing = stripComments(read('apps/mobile/src/share/wiring.ts'));
    expect(routing).toMatch(/createShareRoutingDispatcher\(/);
    expect(routing).toMatch(/createShareRoutingCheckedDispatcher\(/);
    // 第二份构造 = 两处各判一次"该进哪本 log"，迟早给出不同答案。
    const constructors = mobileSources()
      .map((rel) => stripComments(read(rel)))
      .reduce((n, src) => n + (src.match(/createShareRoutingDispatcher\(/g) ?? []).length, 0);
    expect(constructors, '移动端出现了第二处 createShareRoutingDispatcher 构造点').toBe(1);
    const realtime = stripComments(read('apps/mobile/src/sync/realtime.ts'));
    expect(realtime).toMatch(/onNewShareOps/);
    expect(realtime).toMatch(/onShareRosterChanged/);
  });

  it('🔴 壳的既有纪律不许被这批新文件打破：无 `localStorage`/`btoa`/`atob`/DOM `document`/`window.`', () => {
    // ⚠️ `document` 只拦 **DOM 用法**（`document.body` 那一族）：本壳有以 `document`
    // 命名的局部变量/props（legal-recheck 屏），`\bdocument\.` 会把它们误报成浏览器全局。
    for (const rel of mobileSources()) {
      const src = stripComments(read(rel));
      expect(src, `${rel} 出现了 localStorage`).not.toMatch(/\blocalStorage\b/);
      expect(src, `${rel} 出现了 btoa/atob`).not.toMatch(/\b(btoa|atob)\s*\(/);
      expect(src, `${rel} 出现了 DOM document`).not.toMatch(
        /\bdocument\.(body|head|documentElement|createElement|querySelector|getElementById|addEventListener|title)\b/,
      );
      expect(src, `${rel} 出现了 window.`).not.toMatch(/\bwindow\.[a-zA-Z_$]/);
    }
  });
});
