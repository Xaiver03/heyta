/**
 * `setSchedule` 的 **op 形状判据**（时间线 P2，ADR-0043 §5 / goal §3.3 骨架 1）
 * ======================================================================
 *
 * 用**真实引擎 + 真实 SQLite**（`:memory:`），与 `actions.spec.ts` 同一条纪律：
 * 这些测试要证明"拖拽确实产出了一种**可同步的** op"，假 dispatch 探针
 * 对 op 的形状一无所知。
 *
 * 三种手势（goal §3.2）→ 三种 payload 形状，一一对应：
 *   - 泳道拖上轴 → `{ startDate, durationMinutes }`
 *   - 拖整条移动 → `{ startDate }`（时长**不在 payload 里** —— 字段级 LWW 不碰它）
 *   - 拖边改时长 → `{ durationMinutes }`（起点不动）
 *
 * 🔴 「字段在不在对象里」是语义：移动的 op 里**绝不能**混进 durationMinutes，
 * 否则两台设备同时拖（一台移动、一台改时长）时会互相覆盖 —— LWW 的决胜单位
 * 是字段，payload 越瘦，冲突面越小。
 */

import { startOfDay } from '@heyta/domain';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType, type Operation } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTaskActions, type TaskActions } from '../src/actions.js';

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let actions: TaskActions;
let clock = 1_700_000_000_000;
const now = (): number => clock;

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  engine = new OpLogEngine({
    store: new DbOpLogStore<Operation<string>>(adapter),
    clientId: 'client-test',
    now,
  });
  actions = createTaskActions(engine, { now });
});

afterEach(() => {
  adapter.close();
});

function payloadOf(op: Operation<string>): Record<string, unknown> {
  return op.payload as Record<string, unknown>;
}

async function opsOf(entityId: string): Promise<Operation<string>[]> {
  return engine.getOpsForEntity('TASK', entityId);
}

/** 建一条任务并返回 id。⚠️ create 本身是一条 CRT op —— 断言用 `opsAfter` 取增量。 */
async function seed(title = '被排期的任务'): Promise<string> {
  return actions.create(title);
}

/** 某实体在调用前的 op 数（增量断言的基线 —— getOpsForEntity 含 CRT）。 */
async function opCount(entityId: string): Promise<number> {
  return (await opsOf(entityId)).length;
}

/** 最后一条 op（= 刚写的那条）。 */
async function lastOp(entityId: string): Promise<Operation<string>> {
  const ops = await opsOf(entityId);
  return ops[ops.length - 1]!;
}

describe('setSchedule：三种手势 = 三种 payload 形状（goal §3.3 骨架 1）', () => {
  it('🔴 泳道拖上轴：{ startDate, durationMinutes } ⇒ 一条 UPD op，载荷两字段齐全', async () => {
    const id = await seed();
    const start = startOfDay(Date.now()) + 9 * 3_600_000;
    await actions.setSchedule(id, { startDate: start, durationMinutes: 90 });

    const before = await opCount(id);
    await actions.setSchedule(id, { startDate: start, durationMinutes: 90 });
    const ops = await opsOf(id);
    expect(ops).toHaveLength(before + 1);
    const last = await lastOp(id);
    expect(last.opType).toBe(OpType.Update);
    expect(last.entityType).toBe('TASK');
    expect(payloadOf(last)).toEqual({ startDate: start, startDateLocal: null, durationMinutes: 90 });
  });

  it('🔴 拖整条移动：{ startDate } ⇒ payload **只有** startDate（时长不进 payload）', async () => {
    const id = await seed();
    const start = startOfDay(Date.now()) + 9 * 3_600_000;
    await actions.setSchedule(id, { startDate: start, durationMinutes: 60 });
    const start2 = start + 3_600_000;
    const before = await opCount(id);
    await actions.setSchedule(id, { startDate: start2 });

    const ops = await opsOf(id);
    expect(ops).toHaveLength(before + 1);
    // 移动的 op 里没有 durationMinutes —— 字段级 LWW 的决胜单位是字段，
    // payload 越瘦，两台设备同时拖（一台移动一台改时长）的冲突面越小。
    expect(payloadOf(await lastOp(id))).toEqual({ startDate: start2, startDateLocal: null });

    // 物化状态：移动没有动时长
    const state = engine.getState();
    expect(state.tasks[id]?.startDate).toBe(start2);
    expect(state.tasks[id]?.durationMinutes).toBe(60);
  });

  it('🔴 拖边改时长：{ durationMinutes } ⇒ payload 只有它；夹取到 [5, 480] 并取整', async () => {
    const id = await seed();
    await actions.setSchedule(id, { durationMinutes: 999_999 });
    expect(payloadOf(await lastOp(id))).toEqual({ durationMinutes: 480 });

    await actions.setSchedule(id, { durationMinutes: 0.4 });
    expect(payloadOf(await lastOp(id))).toEqual({ durationMinutes: 5 });
  });

  it('🔴 显式清除：{ startDate: undefined } ⇒ 写 null（能穿过 JSON 的"清除"）', async () => {
    const id = await seed();
    await actions.setSchedule(id, { startDate: 1_700_000_100_000 });
    await actions.setSchedule(id, { startDate: undefined });

    expect(payloadOf(await lastOp(id))).toEqual({ startDate: null, startDateLocal: null });
    expect(engine.getState().tasks[id]?.startDate).toBeUndefined();
  });

  it('空对象 ⇒ 不产生任何 op（没点名任何字段就是没有意图）', async () => {
    const id = await seed();
    const before = await opCount(id);
    await actions.setSchedule(id, {});
    expect(await opCount(id)).toBe(before);
  });

  it('🔴 非法值**写之前 throw**（垃圾不进 op-log）：NaN / 0 / 负起点、非有限时长', async () => {
    const id = await seed();
    const before = await opCount(id);
    for (const bad of [Number.NaN, 0, -5, Number.POSITIVE_INFINITY]) {
      await expect(actions.setSchedule(id, { startDate: bad })).rejects.toThrow(/非法的排期起点/);
    }
    await expect(
      actions.setSchedule(id, { durationMinutes: Number.NaN }),
    ).rejects.toThrow(/非法的排期时长/);
    // 所有被拒的调用都没有留下 op
    expect(await opCount(id)).toBe(before);
  });

  it('任务不存在 ⇒ throw（静默成功会让用户以为排上了）', async () => {
    await expect(actions.setSchedule('task-ghost', { startDate: 1_700_000_100_000 })).rejects.toThrow(
      /找不到任务/,
    );
  });
});
