/**
 * `CALENDAR_EVENT` 的物化接线（加实体是不是"可加的"，第 12 次）
 * ==========================================================
 *
 * `event-additive.spec.ts` 把"加一个实体不需要全量迁移"拆成三条判据；本文件是那三条
 * 在**这一个新实体**上的落地 —— 因为它是本仓第一次加"外部源写入、用户只读"的实体，
 * 有一条新形状要钉：
 *
 *   1. **桶存在且来自唯一那份映射**：`emptyState().calendarEvents` 是 `{}` 而不是
 *      `undefined`，`bucketFor(state, 'CALENDAR_EVENT')` 返回同一个桶。
 *      （两份手写映射曾经漂过：`snapshot()` 自己抄过一份，漏了的那处只会让
 *      `overwritten` 判定恒为 false —— 冲突覆盖**静默不生效**。）
 *   2. **走的是同一条 reducer 路径**：CRT → UPD 合并 → DEL 留墓碑且保留原字段。
 *      没有为它开第二条分支 —— 开了就意味着旧代码不认识它时会走别的路。
 *   3. **老数据不受影响**：只含旧实体的 op-log 重放后新桶仍是空的；而"老客户端"
 *      （= 不认识 `CALENDAR_EVENT` 的那一版）读到它的 op 必须**静默跳过**。
 *
 * 🔴 这一切的前提是**不 bump `CURRENT_SCHEMA_VERSION`**（ADR 草稿
 * `docs/adr/0089-calendar-events-are-a-mirror-entity.md`）：旧客户端未迁移即可应用，
 * 所以按 `schema-version.ts` 的政策用可加性；硬栅栏只在服务端白名单（上线顺序问题）。
 */

import { OpType, type Operation } from '@heyta/sync-core';
import { describe, expect, it } from 'vitest';

import {
  applyOperation,
  bucketFor,
  deserializeMaterializedState,
  emptyState,
  replayOperations,
  serializeMaterializedState,
  UNMODELED_ENTITY_TYPES,
} from '../src/state.js';

let opSeq = 0;
const op = (over: Partial<Operation<string>> & { entityType: string; entityId: string }): Operation<string> =>
  ({
    // 🔴 id 必须逐条唯一：归约器按 opId 幂等去重，同 id 的第二条会被当重复投递静默吞掉。
    id: `op-${over.entityType}-${over.entityId}-${String((opSeq += 1))}`,
    vectorClock: { client: 1 },
    timestamp: 1_700_000_000_000,
    opType: OpType.Create,
    payload: {},
    ...over,
  }) as Operation<string>;

/** 一条典型的投影载荷（connector 写什么形状，这里就喂什么形状 —— 全部可选字段都到位）。 */
const calendarRow = {
  accountId: 'org-foundu',
  calendarId: 'primary',
  sourceEventId: 'evt-1',
  summary: '周会',
  description: '纯文本',
  location: '会议室 A',
  start: 1_700_000_600_000,
  end: 1_700_003_600_000,
  allDay: false,
  timezone: 'Asia/Shanghai',
  status: 'confirmed',
  visibility: 'default',
  freeBusy: 'busy',
  attendees: [{ id: 'u1', name: '张三', rsvpStatus: 'accept', organizer: true }],
  reminders: [{ minutesBefore: 15 }],
};

describe('CALENDAR_EVENT 有自己的桶，且桶来自唯一那份映射', () => {
  it('空状态里 calendarEvents 是 `{}` 而不是 undefined', () => {
    const state = emptyState();
    expect('calendarEvents' in state).toBe(true);
    expect(state.calendarEvents).toEqual({});
    // 与倒数日那个桶**并列而不共用**：两者都上日历，但不是同一种东西。
    expect(state.events).toEqual({});
  });

  it('`bucketFor` 认这个实体（运行时唯一的 实体类型 → 桶 映射）', () => {
    const state = emptyState();
    expect(bucketFor(state, 'CALENDAR_EVENT')).toBe(state.calendarEvents);
    expect(bucketFor(state, 'NOT_AN_ENTITY')).toBeUndefined();
  });

  it('已建模清单里有它，"刻意不物化"清单里没有它', () => {
    const state = applyOperation(
      emptyState(),
      op({ entityType: 'CALENDAR_EVENT', entityId: 'ce:1', payload: calendarRow }),
    );
    expect(Object.keys(state.calendarEvents)).toEqual(['ce:1']);
    expect(UNMODELED_ENTITY_TYPES.map((u) => u.entityType)).not.toContain('CALENDAR_EVENT');
  });
});

describe('CALENDAR_EVENT 走的是同一条 reducer 路径', () => {
  it('CRT → UPD 只合并给出的字段', () => {
    let state = applyOperation(
      emptyState(),
      op({ entityType: 'CALENDAR_EVENT', entityId: 'ce:1', payload: calendarRow }),
    );
    expect(state.calendarEvents['ce:1']).toMatchObject(calendarRow);

    state = applyOperation(
      state,
      op({
        entityType: 'CALENDAR_EVENT',
        entityId: 'ce:1',
        opType: OpType.Update,
        timestamp: 1_700_000_000_001,
        vectorClock: { client: 2 },
        payload: { summary: '周会（改期）', start: 1_700_003_600_000, end: 1_700_007_200_000 },
      }),
    );
    expect(state.calendarEvents['ce:1']).toMatchObject({
      summary: '周会（改期）',
      start: 1_700_003_600_000,
      // 没在载荷里出现的字段必须原样留着 —— 这正是"只比较投影、相同就不写 op"能成立的前提：
      // 一条 op 只带改动的字段，不是整行重写。
      calendarId: 'primary',
      sourceEventId: 'evt-1',
      timezone: 'Asia/Shanghai',
    });
  });

  it('DEL 留墓碑且保留原字段（回收站可恢复，与任务同一套语义）', () => {
    let state = applyOperation(
      emptyState(),
      op({ entityType: 'CALENDAR_EVENT', entityId: 'ce:2', payload: calendarRow }),
    );
    state = applyOperation(
      state,
      op({
        entityType: 'CALENDAR_EVENT',
        entityId: 'ce:2',
        opType: OpType.Delete,
        timestamp: 1_700_000_000_009,
        vectorClock: { client: 3 },
      }),
    );
    // 🔴 墓碑里**没有**并行的 `deleted` 布尔：归属只由 `deletedAt` 判（`inTrash()` 唯一判据）。
    // 两个字段并存会出现"`deleted=true` 但 `deletedAt` 为空"这种第三态。
    expect(state.calendarEvents['ce:2']).toMatchObject({
      deletedAt: 1_700_000_000_009,
      summary: '周会',
      sourceEventId: 'evt-1',
    });
    expect(state.calendarEvents['ce:2']).not.toHaveProperty('deleted');
  });

  it('清一个可选字段写 `null` 会把它删掉，而不是留成 null', () => {
    let state = applyOperation(
      emptyState(),
      op({ entityType: 'CALENDAR_EVENT', entityId: 'ce:3', payload: { ...calendarRow, location: '会议室 A' } }),
    );
    state = applyOperation(
      state,
      op({
        entityType: 'CALENDAR_EVENT',
        entityId: 'ce:3',
        opType: OpType.Update,
        timestamp: 1_700_000_000_001,
        vectorClock: { client: 2 },
        payload: { location: null },
      }),
    );
    expect(state.calendarEvents['ce:3']?.location).toBeUndefined();
  });
});

describe('老数据与老客户端', () => {
  it('只含旧实体的 op-log 重放后，calendarEvents 仍是空对象', () => {
    const state = replayOperations(emptyState(), [
      op({ entityType: 'TASK', entityId: 't1', payload: { title: '旧任务' } }),
      op({ entityType: 'EVENT', entityId: 'e1', payload: { title: '结婚纪念日', date: '2020-05-01' } }),
    ]);
    expect(state.calendarEvents).toEqual({});
    expect(Object.keys(state.events)).toEqual(['e1']);
  });

  it('不认识 `CALENDAR_EVENT` 的那一版（= 本判据的反向）静默跳过它的 op', () => {
    // 反向模拟的诚实做法：用一个**当前代码真的不认识**的类型名跑同一段重放。
    // 🔴 这条不是"测 fake"：它钉的是 reducer 的"未知实体优雅跳过"分支本身 ——
    // 那条分支坏了，症状是同步永久卡死（§7 第 34/41 条那两个 P0），
    // 而 `CALENDAR_EVENT` 上线后每一个旧客户端都会走它。
    const state = replayOperations(emptyState(), [
      op({ entityType: 'CALENDAR_EVENT', entityId: 'ce:1', payload: calendarRow }),
      op({ entityType: 'SOMETHING_FUTURE', entityId: 'x', payload: { whatever: true } }),
    ]);
    expect(Object.keys(state.calendarEvents)).toEqual(['ce:1']);
    expect(JSON.stringify(state)).not.toContain('SOMETHING_FUTURE');
  });
});

describe('检查点（物化状态持久化）不会把这个新桶漏掉', () => {
  it('serialize → deserialize 之后这一行还在，且字段逐个相同', () => {
    // 🔴 序列化遍历的是 `BUCKET_BY_ENTITY`，不是手写清单 —— 这条判据同时证明
    // 新桶真的进了那份映射（漏了的话这里会返回一个没有该行的空状态，且**不报错**）。
    const state = applyOperation(
      emptyState(),
      op({ entityType: 'CALENDAR_EVENT', entityId: 'ce:1', payload: calendarRow }),
    );
    const restored = deserializeMaterializedState(
      JSON.parse(JSON.stringify(serializeMaterializedState(state))),
    );
    expect(restored).toBeDefined();
    expect(restored?.calendarEvents['ce:1']).toMatchObject(calendarRow);
  });
});
