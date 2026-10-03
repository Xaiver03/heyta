/**
 * 加一个实体是不是"可加的"（W2 判据 ①）
 * =====================================
 *
 * 这条文件回答的不是"EVENT 能不能用"，而是**没有 EVENT 的那批数据会不会因为
 * 加了它而坏掉**。三件事必须同时成立，缺一个就是"加实体 = 全量迁移"：
 *
 *   1. 一条**只含旧实体**的 op-log 在新代码下重放，结果与加实体之前逐项相同，
 *      且新桶是空的（不是 `undefined`、不是抛错）。
 *   2. 新实体的 op 走的是**同一条** reducer 路径（CRT/UPD/DEL/墓碑保留字段），
 *      没有为它开第二条分支 —— 开了就意味着旧代码不认识它时会走别的路。
 *   3. 🔴 **反过来也成立**：一条当前代码不认识的实体类型的 op，必须被**静默跳过**
 *      而不是抛错。这才是"不需要 bump `CURRENT_SCHEMA_VERSION`"的真实依据 ——
 *      将来加第 12 个实体时，今天这个版本就是那个"老客户端"。
 *      第 3 条一旦坏掉，症状是"同步永久卡死"（§7 第 34/41 条那两个 P0 的形状）。
 */

import { OpType, type Operation } from '@heyta/sync-core';
import { describe, expect, it } from 'vitest';

import {
  applyOperation,
  emptyState,
  replayOperations,
  UNMODELED_ENTITY_TYPES,
  type MaterializedState,
} from '../src/state.js';

let opSeq = 0;
const op = (over: Partial<Operation<string>> & { entityType: string; entityId: string }): Operation<string> =>
  ({
    // 🔴 id 必须逐条唯一：归约器按 opId 幂等去重（ADR-0009 的契约 —— 同 id 就是同一条
    // op 的重复投递），旧的 `op-${type}-${id}` 默认值会让同一实体的第二条 op被
    // 当成重复投递静默吞掉（2026-10-03 合流时被字段版本归约器当场抓出来）。
    id: `op-${over.entityType}-${over.entityId}-${String((opSeq += 1))}`,
    vectorClock: { client: 1 },
    timestamp: 1_700_000_000_000,
    opType: OpType.Create,
    payload: {},
    ...over,
  }) as Operation<string>;

describe('旧数据在新代码下', () => {
  it('只含旧实体的 op-log 重放不炸，新桶是空的而不是 undefined', () => {
    const legacy: Operation<string>[] = [
      op({ entityType: 'TASK', entityId: 't1', payload: { title: '旧任务' } }),
      op({ entityType: 'NOTE', entityId: 'n1', payload: { content: '旧便签', projectId: null, isPinnedToToday: false } }),
      op({ entityType: 'REMINDER', entityId: 'r1', payload: { taskId: 't1', triggerAt: 1_700_000_600_000 } }),
    ];
    const state = replayOperations(emptyState(), legacy);
    expect(Object.keys(state.tasks)).toEqual(['t1']);
    expect(state.notes.n1?.content).toBe('旧便签');
    expect(state.reminders.r1?.taskId).toBe('t1');
    expect(state.events).toEqual({});
  });

  it('老 op 里没有任何一条引用 EVENT，重放后 events 仍是空对象（不是缺键）', () => {
    const state = replayOperations(emptyState(), [
      op({ entityType: 'TASK', entityId: 't2', payload: { title: 'x' } }),
    ]);
    expect('events' in state).toBe(true);
    expect(Object.keys(state.events)).toHaveLength(0);
  });
});

describe('新实体走的是同一条 reducer 路径', () => {
  it('CRT → UPD 合并 → DEL 留墓碑且保留原字段', () => {
    let state = applyOperation(
      emptyState(),
      op({ entityType: 'EVENT', entityId: 'e1', payload: { title: '结婚纪念日', date: '2020-05-01' } }),
    );
    expect(state.events.e1?.title).toBe('结婚纪念日');
    state = applyOperation(
      state,
      op({
        entityType: 'EVENT',
        entityId: 'e1',
        opType: OpType.Update,
        timestamp: 1_700_000_000_001,
        vectorClock: { client: 2 },
        payload: { pinnedAt: 1_700_000_000_001 },
      }),
    );
    expect(state.events.e1).toMatchObject({ title: '结婚纪念日', date: '2020-05-01', pinnedAt: 1_700_000_000_001 });
    state = applyOperation(
      state,
      op({
        entityType: 'EVENT',
        entityId: 'e1',
        opType: OpType.Delete,
        timestamp: 1_700_000_000_002,
        vectorClock: { client: 3 },
      }),
    );
    // 🔴 墓碑必须**留着全部原字段** —— 这是"回收站可恢复"的前提，
    // 也是 EVENT 与 TASK 共用同一套回收站语义的证据（没有为它开分支）。
    expect(state.events.e1).toMatchObject({
      deletedAt: 1_700_000_000_002,
      title: '结婚纪念日',
      date: '2020-05-01',
    });
  });

  it('清 pinnedAt 写 null 会把字段删掉，而不是留成 null', () => {
    let state = applyOperation(
      emptyState(),
      op({ entityType: 'EVENT', entityId: 'e2', payload: { title: 'a', date: '2020-05-01', pinnedAt: 5 } }),
    );
    state = applyOperation(
      state,
      op({
        entityType: 'EVENT',
        entityId: 'e2',
        opType: OpType.Update,
        timestamp: 1_700_000_000_001,
        vectorClock: { client: 2 },
        payload: { pinnedAt: null },
      }),
    );
    expect(state.events.e2?.pinnedAt).toBeUndefined();
  });
});

describe('反向：今天这个版本就是将来那个"老客户端"', () => {
  it('不认识的实体类型被静默跳过，不抛错也不卡住重放', () => {
    const ops: Operation<string>[] = [
      op({ entityType: 'TASK', entityId: 't3', payload: { title: '在前的任务' } }),
      op({ entityType: 'SOMETHING_FUTURE', entityId: 'x', payload: { whatever: true } }),
      op({ entityType: 'TASK', entityId: 't4', payload: { title: '在后的任务' } }),
    ];
    const state = replayOperations(emptyState(), ops);
    expect(Object.keys(state.tasks).sort()).toEqual(['t3', 't4']);
  });

  it('合法但刻意不物化的实体（登记在 UNMODELED 里）同样被跳过', () => {
    const listed = UNMODELED_ENTITY_TYPES.map((e) => e.entityType);
    expect(listed).toContain('TASK_REPEAT_CFG');
    const state = replayOperations(emptyState(), [
      op({ entityType: 'TASK_REPEAT_CFG', entityId: 'cfg1', payload: { rule: 'FREQ=WEEKLY' } }),
      op({ entityType: 'TASK', entityId: 't5', payload: { title: 'y' } }),
    ]);
    expect(Object.keys(state.tasks)).toEqual(['t5']);
    expect(JSON.stringify(state)).not.toContain('cfg1');
  });

  it('新实体确实**不在**"刻意不物化"的清单里（防止有人把 EVENT 塞回去图省事）', () => {
    const listed = UNMODELED_ENTITY_TYPES.map((e) => e.entityType);
    expect(listed).not.toContain('EVENT');
  });
});

/** 编译期兜底：`MaterializedState` 必须有 `events`，否则上面几条读不到。 */
type HasEvents = MaterializedState['events'];
const _typeProbe: HasEvents = {};
void _typeProbe;
