/**
 * `setCalendarEventTags`：阶段 A 唯一的日程写路径
 * ==============================================
 *
 * 判据只盯**写出来的那一条 op** 与**该拒的三种引用**：
 *
 *   1. 一次勾选 = **一条** `UPD`，载荷只有 `{tagIds}`（不多带内容字段）；
 *   2. 重复 id 去重（界面"点两次"很常见）；
 *   3. 空集合写 `null` 而不是 `[]`（reducer 的合并语义下，`[]` 不是"清空"）；
 *   4. 未知 / 已删的日程、未知 / 已删的标签 ⇒ **抛错且一条 op 都不发**。
 *
 * 状态用**真 reducer**（`applyOperation`）累起来，不手搓假状态：`null` 清空这一档
 * 只在 reducer 里成立，假状态会把它测成"随便"。
 */

import type { OpIntent, MaterializedState } from '@heyta/op-log';
import { applyOperation, emptyState } from '@heyta/op-log';
import { OpType, type Operation } from '@heyta/sync-core';
import { describe, expect, it } from 'vitest';

import type { ActionContext } from '../src/actions.js';
import { setCalendarEventTags } from '../src/calendar-event-actions.js';

let seq = 0;

interface SeedOp {
  readonly entityType: string;
  readonly entityId: string;
  readonly opType: string;
  readonly payload: Record<string, unknown>;
}

/** 把几条 seed op 真喂给 reducer，得到物化状态。 */
function stateAfter(ops: readonly SeedOp[]): MaterializedState {
  let state = emptyState();
  for (const op of ops) {
    seq += 1;
    state = applyOperation(state, {
      id: `seed-${String(seq)}`,
      actionType: 'test',
      opType: op.opType,
      entityType: op.entityType,
      entityId: op.entityId,
      payload: op.payload,
      clientId: 'test-device',
      vectorClock: { test: seq },
      timestamp: 1_700_000_000_000 + seq,
      schemaVersion: 1,
    } as Operation<string>);
  }
  return state;
}

const calendarEventCreate = (over: Record<string, unknown> = {}): SeedOp => ({
  entityType: 'CALENDAR_EVENT',
  entityId: 'cev-1',
  opType: OpType.Create,
  payload: {
    id: 'cev-1',
    summary: '周会',
    start: 1_700_000_000_000,
    end: 1_700_003_600_000,
    ...over,
  },
});

const tagCreate = (id: string, name: string): SeedOp => ({
  entityType: 'TAG',
  entityId: id,
  opType: OpType.Create,
  payload: { id, name },
});

function fakeContext(state: MaterializedState): {
  readonly ctx: ActionContext;
  readonly intents: OpIntent[];
} {
  const intents: OpIntent[] = [];
  return {
    intents,
    ctx: {
      getState: () => state,
      dispatch: async (intent: OpIntent) => {
        intents.push(intent);
        return undefined;
      },
    },
  };
}

const baseState = (): MaterializedState =>
  stateAfter([calendarEventCreate(), tagCreate('tag-1', '工作'), tagCreate('tag-2', '重要')]);

describe('setCalendarEventTags', () => {
  it('勾选一次 = 一条 UPD，载荷只有去重后的 tagIds', async () => {
    const { ctx, intents } = fakeContext(baseState());

    await setCalendarEventTags(ctx, 'cev-1', ['tag-1', 'tag-2', 'tag-1']);

    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      entityType: 'CALENDAR_EVENT',
      entityId: 'cev-1',
      opType: OpType.Update,
      payload: { tagIds: ['tag-1', 'tag-2'] },
    });
    // 只带这一格：内容字段一个都不许混进来（否则下一次同步会拿旧内容覆盖新内容）。
    expect(Object.keys(intents[0]?.payload ?? {})).toEqual(['tagIds']);
  });

  it('清空标签写 `null`，不写空数组（reducer 的合并语义）', async () => {
    const { ctx, intents } = fakeContext(baseState());

    await setCalendarEventTags(ctx, 'cev-1', []);

    expect(intents).toHaveLength(1);
    expect(intents[0]?.payload).toEqual({ tagIds: null });
  });

  it('未知日程 ⇒ 抛错，且一条 op 都不发', async () => {
    const { ctx, intents } = fakeContext(baseState());

    await expect(setCalendarEventTags(ctx, 'cev-missing', ['tag-1'])).rejects.toThrow('找不到日程');
    expect(intents).toHaveLength(0);
  });

  it('已删除的日程 ⇒ 抛错，且一条 op 都不发', async () => {
    const state = stateAfter([
      calendarEventCreate(),
      tagCreate('tag-1', '工作'),
      {
        entityType: 'CALENDAR_EVENT',
        entityId: 'cev-1',
        opType: OpType.Update,
        payload: { deletedAt: 1_700_000_100_000 },
      },
    ]);
    const { ctx, intents } = fakeContext(state);

    await expect(setCalendarEventTags(ctx, 'cev-1', ['tag-1'])).rejects.toThrow('找不到日程');
    expect(intents).toHaveLength(0);
  });

  it('未知标签 ⇒ 抛错，且一条 op 都不发（悬空引用在写入侧就拦住）', async () => {
    const { ctx, intents } = fakeContext(baseState());

    await expect(setCalendarEventTags(ctx, 'cev-1', ['tag-1', 'tag-ghost'])).rejects.toThrow(
      '找不到标签',
    );
    expect(intents).toHaveLength(0);
  });

  it('已删除的标签同样拒绝（与任务的 setTags 同一条判据）', async () => {
    const state = stateAfter([
      calendarEventCreate(),
      tagCreate('tag-1', '工作'),
      { entityType: 'TAG', entityId: 'tag-1', opType: OpType.Update, payload: { deletedAt: 1 } },
    ]);
    const { ctx, intents } = fakeContext(state);

    await expect(setCalendarEventTags(ctx, 'cev-1', ['tag-1'])).rejects.toThrow('找不到标签');
    expect(intents).toHaveLength(0);
  });
});
