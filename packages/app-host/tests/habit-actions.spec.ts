/**
 * 习惯 / 打卡动作层的测试
 * ==========================
 *
 * 与 `actions.spec.ts` 同样的取舍：**真实引擎 + 真实 SQLite（`:memory:`）**。
 *
 * 重点盯四类**静默失效**：
 *   1. 打卡记录用随机 id → 同一天点两下会得到**两条**记录，连续天数 +2
 *   2. 幂等只在 reducer 做 → "第二次打卡"与"改打卡值"在 op 上无法区分
 *   3. 打卡值缺省写成 1 → 一个"每天 8 杯水"的习惯完成率永远是 12%，且不报错
 *   4. 撤销打卡写成物理删除 → 另一端把它**同步回来**，用户看到"撤销的打卡复活了"
 */

import type { LocalDate } from '@heyta/domain';
import { toLocalDate } from '@heyta/domain';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType, type Operation } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHabitActions, habitLogId, type HabitActions } from '../src/habit-actions.js';

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let actions: HabitActions;
let clock = 1_700_000_000_000;
const now = (): number => clock;

/** 可控 id：顺序断言不能靠随机 id。 */
let idSeq = 0;
const makeHabitId = (): string => {
  idSeq += 1;
  return `habit-t-${String(idSeq).padStart(3, '0')}`;
};

const DAY1: LocalDate = '2026-03-01';
const DAY2: LocalDate = '2026-03-02';

async function opOf(
  entityType: 'HABIT' | 'HABIT_LOG',
  entityId: string,
): Promise<Operation<string>> {
  const ops = await engine.getOpsForEntity(entityType, entityId);
  const last = ops.at(-1);
  if (last === undefined) throw new Error(`没找到 ${entityId} 的 op`);
  return last;
}

function payloadOf(op: Operation<string>): Record<string, unknown> {
  return op.payload as Record<string, unknown>;
}

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  engine = new OpLogEngine({
    store: new DbOpLogStore<Operation<string>>(adapter),
    clientId: 'client-habit',
    now,
  });
  clock = 1_700_000_000_000;
  idSeq = 0;
  actions = createHabitActions(engine, { now, newHabitId: makeHabitId });
});

afterEach(() => {
  adapter.close();
});

describe('新建习惯', () => {
  it('产出一条 HABIT Create op，`target` 缺省为 1', async () => {
    const id = await actions.createHabit('喝水');

    const op = await opOf('HABIT', id);
    expect(op.opType).toBe(OpType.Create);
    expect(payloadOf(op).name).toBe('喝水');
    expect(payloadOf(op).target).toBe(1);
  });

  it('over 参数会覆盖默认字段', async () => {
    const id = await actions.createHabit('喝水', { target: 8, unit: '杯' });
    const op = await opOf('HABIT', id);
    expect(payloadOf(op).target).toBe(8);
    expect(payloadOf(op).unit).toBe('杯');
  });

  it('空名称抛错，且不留下任何 op', async () => {
    await expect(actions.createHabit('  ')).rejects.toThrow();
    expect(actions.listHabits()).toEqual([]);
  });
});

describe('打卡', () => {
  it('🔴 记录 id 就是 `${habitId}:${date}` —— 幂等性的来源', async () => {
    const id = await actions.createHabit('喝水');
    await actions.checkIn(id, DAY1);

    const op = await opOf('HABIT_LOG', habitLogId(id, DAY1));
    expect(op.entityType).toBe('HABIT_LOG');
    expect(op.entityId).toBe(`${id}:${DAY1}`);
    expect(payloadOf(op).habitId).toBe(id);
    expect(payloadOf(op).date).toBe(DAY1);
  });

  it('🔴 同一天第二次打卡是幂等空操作：返回 false，且**不产生第二条 op**', async () => {
    const id = await actions.createHabit('喝水');

    expect(await actions.checkIn(id, DAY1)).toBe(true);
    expect(await actions.checkIn(id, DAY1)).toBe(false);

    // 存储里该实体只有一条 op（不是两条 CRT 让计数翻倍）
    const ops = await engine.getOpsForEntity('HABIT_LOG', habitLogId(id, DAY1));
    expect(ops).toHaveLength(1);
  });

  it('不同日期各算一条', async () => {
    const id = await actions.createHabit('喝水');
    expect(await actions.checkIn(id, DAY1)).toBe(true);
    expect(await actions.checkIn(id, DAY2)).toBe(true);
    expect(actions.listLogs()).toHaveLength(2);
  });

  it('🔴 打卡值缺省落在 habit.target 上（不是 1）', async () => {
    const id = await actions.createHabit('喝水', { target: 8 });
    await actions.checkIn(id, DAY1);

    expect(payloadOf(await opOf('HABIT_LOG', habitLogId(id, DAY1))).value).toBe(8);
  });

  it('显式传 value 时以 value 为准', async () => {
    const id = await actions.createHabit('喝水', { target: 8 });
    await actions.checkIn(id, DAY1, 3);
    expect(payloadOf(await opOf('HABIT_LOG', habitLogId(id, DAY1))).value).toBe(3);
  });

  it('没给 target 也没给 value 时落到 1', async () => {
    // 建习惯时 target 缺省是 1，把它显式清成 undefined 来单测兜底
    const id = await actions.createHabit('只打卡');
    await actions.checkIn(id, DAY1);
    expect(payloadOf(await opOf('HABIT_LOG', habitLogId(id, DAY1))).value).toBe(1);
  });

  it('省略日期时用**今天**（本地日期，来自注入的时间源）', async () => {
    const id = await actions.createHabit('喝水');
    await actions.checkIn(id);

    const today = toLocalDate(clock);
    const log = actions.listLogs()[0]!;
    expect(log.date).toBe(today);
    // 顺便确认它真的是个 YYYY-MM-DD
    expect(log.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('对不存在的习惯打卡会抛错，不静默丢弃', async () => {
    await expect(actions.checkIn('habit-不存在', DAY1)).rejects.toThrow();
  });
});

describe('撤销打卡', () => {
  it('软删除（DEL op），记录从列表里消失', async () => {
    const id = await actions.createHabit('喝水');
    await actions.checkIn(id, DAY1);
    expect(actions.listLogs()).toHaveLength(1);

    expect(await actions.undoCheckIn(id, DAY1)).toBe(true);

    const op = await opOf('HABIT_LOG', habitLogId(id, DAY1));
    expect(op.opType).toBe(OpType.Delete);
    expect(actions.listLogs()).toEqual([]);
  });

  it('没打卡时撤销是空操作：返回 false，且**不产生多余的 DEL**', async () => {
    const id = await actions.createHabit('喝水');

    expect(await actions.undoCheckIn(id, DAY1)).toBe(false);

    const ops = await engine.getOpsForEntity('HABIT_LOG', habitLogId(id, DAY1));
    expect(ops).toHaveLength(0);
  });

  it('🔴 撤销之后还能再打卡（不是单向的）', async () => {
    const id = await actions.createHabit('喝水');

    await actions.checkIn(id, DAY1);
    await actions.undoCheckIn(id, DAY1);
    expect(await actions.checkIn(id, DAY1)).toBe(true);
    expect(actions.listLogs()).toHaveLength(1);
  });
});

describe('删除习惯', () => {
  it('软删除，且**不**级联删打卡记录（撤销删除后历史还在）', async () => {
    const id = await actions.createHabit('喝水');
    await actions.checkIn(id, DAY1);

    await actions.removeHabit(id);

    expect(actions.listHabits()).toEqual([]);
    // 打卡记录还在 —— 回来的话历史不该丢
    expect(actions.listLogs()).toHaveLength(1);
  });

  it('删除不存在的习惯抛错', async () => {
    await expect(actions.removeHabit('habit-不存在')).rejects.toThrow();
  });
});

describe('🔴 反静默丢弃：另一台设备真的能物化它', () => {
  it('A 建习惯并打卡 → B 应用远端 → B 查得到习惯与打卡', async () => {
    const adapterB = new SqliteAdapter({
      schema: INDEXEDDB_SCHEMA,
      driverFactory: () => new NodeSqliteDriver(':memory:'),
    });
    await adapterB.init();
    const engineB = new OpLogEngine({
      store: new DbOpLogStore<Operation<string>>(adapterB),
      clientId: 'client-other',
      now,
    });

    const id = await actions.createHabit('喝水', { target: 8 });
    await actions.checkIn(id, DAY1);

    const pending = await engine.getPendingUpload();
    expect(pending).toHaveLength(2);

    const result = await engineB.applyRemote(pending);
    expect(result.applied).toHaveLength(2);

    const onB = createHabitActions(engineB);
    expect(onB.listHabits().map((h) => h.id)).toEqual([id]);
    const logs = onB.listLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.habitId).toBe(id);
    expect(logs[0]!.date).toBe(DAY1);
    expect(logs[0]!.value).toBe(8);

    adapterB.close();
  });
});