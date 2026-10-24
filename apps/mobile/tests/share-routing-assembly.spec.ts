/**
 * M6-2 写路由装配（`share/wiring.ts` 真件 + 假引擎）的验收
 * =========================================================
 *
 * 钉的是"装配装对没有"，不重复 app-host 自己钉过的判据（`share-routing.spec.ts`）：
 *
 *   ① 共享清单里的写 ⇒ 交 `channel.dispatch`，**个人 log 零调用**；
 *   ② 非共享的写 ⇒ 逐字交回引擎，**share 通道零调用**；
 *   ③ `dispatchChecked` 那一形：共享 ⇒ 队列里只决策不提交；个人 ⇒ CAS 语义不变；
 *   ④ 🔴 **没装共享通道时，逐字等于原来的 `dispatch`**（web 的既有纪律）：
 *      路由件缺席 ⇒ 直接走引擎，`currentState()` 交回的**就是引擎那份状态对象本身**
 *     （引用相等 —— 不是"内容恰好一样"）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { emptyState, type MaterializedState, type OpIntent } from '@heyta/op-log';
import { OpType } from '@heyta/sync-core';
import type { ShareWriteChannel } from '@heyta/app-host';

import {
  attachMobileShareWiring,
  bindMobileOplogBase,
  currentState,
  dispatchChecked,
  dispatchIntent,
} from '../src/share/wiring';

const SHARED = 'share-1';

/** 与 app-host 那份路由判据同款的最小夹具：一条共享清单 + 一条个人清单。 */
function fixture(): MaterializedState {
  const state = emptyState();
  Object.assign(state.projects as object, {
    pShared: { id: 'pShared', name: '装修', shareId: SHARED },
    pPersonal: { id: 'pPersonal', name: '私人' },
  });
  Object.assign(state.tasks as object, {
    tShared: { id: 'tShared', title: '买漆', projectId: 'pShared' },
    tPersonal: { id: 'tPersonal', title: '看牙', projectId: 'pPersonal' },
  });
  return state;
}

interface Harness {
  personal: OpIntent[];
  share: { shareId: string; entityId: string | undefined }[];
  engineCheckedRuns: unknown[];
  state: MaterializedState;
}

function harness(withChannel = true): Harness & { cleanup: () => void } {
  const h: Harness = { personal: [], share: [], engineCheckedRuns: [], state: fixture() };
  const channel: ShareWriteChannel | undefined = withChannel
    ? {
        dispatch: async (shareId, intent) => {
          h.share.push({ shareId, entityId: intent.entityId });
        },
        stateFor: () => emptyState(),
      }
    : undefined;
  bindMobileOplogBase({
    dispatch: async (intent) => {
      h.personal.push(intent);
    },
    dispatchChecked: async <T>(build: (state: MaterializedState) => { intent?: OpIntent; value: T }): Promise<T> => {
      const result = build(h.state);
      h.engineCheckedRuns.push(result.intent);
      if (result.intent !== undefined) h.personal.push(result.intent);
      return result.value;
    },
    getState: () => h.state,
  });
  attachMobileShareWiring(
    withChannel
      ? {
          channel: async () => channel,
          mergeView: (personal) => personal,
        }
      : undefined,
  );
  return { ...h, cleanup: () => { attachMobileShareWiring(undefined); bindMobileOplogBase(undefined); } };
}

afterEach(() => {
  attachMobileShareWiring(undefined);
  bindMobileOplogBase(undefined);
});

const renameShared = (): OpIntent => ({
  entityType: 'TASK' as OpIntent['entityType'],
  entityId: 'tShared',
  opType: OpType.Update,
  payload: { title: '买漆（换牌子）' },
});
const renamePersonal = (): OpIntent => ({
  entityType: 'TASK' as OpIntent['entityType'],
  entityId: 'tPersonal',
  opType: OpType.Update,
  payload: { title: '看牙（改约）' },
});

describe('路由：判据交 app-host，壳只装配', () => {
  it('① 共享清单里的写 ⇒ 交 share 通道，个人 log 零调用', async () => {
    const h = harness();
    await dispatchIntent(renameShared());
    expect(h.share).toEqual([{ shareId: SHARED, entityId: 'tShared' }]);
    expect(h.personal, '共享写落进个人 log = 对面永远看不见（M2 之前那一格）').toHaveLength(0);
    h.cleanup();
  });

  it('② 非共享的写 ⇒ 逐字交回引擎，share 通道零调用', async () => {
    const h = harness();
    await dispatchIntent(renamePersonal());
    expect(h.personal).toHaveLength(1);
    expect(h.personal[0]!.entityId).toBe('tPersonal');
    expect(h.share).toHaveLength(0);
    h.cleanup();
  });

  it('③ `dispatchChecked`：共享那形队列里**只决策不提交**，个人那形 CAS 不变', async () => {
    const h = harness();
    const value = await dispatchChecked(() => ({ intent: renameShared(), value: 'ok' }));
    expect(value).toBe('ok');
    expect(h.engineCheckedRuns).toEqual([undefined]);
    expect(h.share.map((s) => s.entityId)).toEqual(['tShared']);
    expect(h.personal).toHaveLength(0);

    await dispatchChecked(() => ({ intent: renamePersonal(), value: 'ok2' }));
    // 个人那一形**原样交回引擎**：intent 仍在写队列里提交。
    expect(h.engineCheckedRuns[1]).toBeDefined();
    expect(h.personal).toHaveLength(1);
    h.cleanup();
  });

  it('④ 🔴 没装共享通道 ⇒ 逐字等于原来的 `dispatch`，读侧交回的就是引擎那份状态', async () => {
    const h = harness(false);
    await dispatchIntent(renamePersonal());
    expect(h.personal).toHaveLength(1);
    // 引用相等而不是内容相等：装配缺席时合并这一层**根本不存在**。
    expect(currentState()).toBe(h.state);
    h.cleanup();
  });

  it('判成共享但通道那一刻还没建好 ⇒ 具名失败，**不退回个人 log**', async () => {
    const h = harness();
    attachMobileShareWiring({ channel: async () => undefined, mergeView: (p) => p });
    await expect(dispatchIntent(renameShared())).rejects.toThrow(/share|共享/);
    expect(h.personal, '悄悄落个人 log = 界面动了、对面看不见').toHaveLength(0);
    h.cleanup();
  });
});
