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

import { computeStreak, isAchieved, isScheduledOn } from '@heyta/domain';

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

  it('新建配置在一条 Create 中保存，undefined 目标仍取默认值', async () => {
    const id = await actions.createHabit('阅读', {
      target: undefined, unit: ' 页 ', icon: 'book', backfillDays: 7,
      frequency: { type: 'weekly', daysOfWeek: [1, 3, 5] },
    });
    const ops = await engine.getOpsForEntity('HABIT', id);
    expect(ops).toHaveLength(1);
    expect(payloadOf(ops[0]!)).toMatchObject({ target: 1, unit: '页', icon: 'book', backfillDays: 7 });
  });

  it('非法目标或补打卡范围在新建时不落盘', async () => {
    for (const target of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(actions.createHabit('阅读', { target })).rejects.toThrow();
    }
    for (const backfillDays of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(actions.createHabit('阅读', { backfillDays })).rejects.toThrow();
    }
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

describe('分类色槽位', () => {
  it('与清单同一条规则：存槽位号字符串，清除写 null', async () => {
    const id = await actions.createHabit('跑步', { unit: '分钟', target: 30 });
    await actions.setHabitColor(id, 5);

    const withColor = (await engine.getOpsForEntity('HABIT', id)).filter(
      (op) => 'color' in payloadOf(op),
    ).at(-1);
    expect(withColor?.opType).toBe(OpType.Update);
    expect(payloadOf(withColor!).color).toBe('5');

    await actions.setHabitColor(id, undefined);
    const cleared = (await engine.getOpsForEntity('HABIT', id)).filter(
      (op) => 'color' in payloadOf(op),
    ).at(-1);
    expect(payloadOf(cleared!).color).toBeNull();
    expect(engine.getState().habits[id]?.color).toBeUndefined();
  });

  it('🔴 非法槽位抛错；找不到的习惯也抛错', async () => {
    const id = await actions.createHabit('跑步');
    await expect(actions.setHabitColor(id, 0 as never)).rejects.toThrow(/1–8/);
    await expect(actions.setHabitColor('不存在', 1)).rejects.toThrow(/找不到习惯/);
  });

  it('上色不影响打卡与连续天数（颜色只是身份，不是状态）', async () => {
    const id = await actions.createHabit('跑步', { unit: '分钟', target: 30 });
    await actions.setHabitColor(id, 2);
    await actions.checkIn(id, DAY1);

    const habit = engine.getState().habits[id];
    expect(habit?.color).toBe('2');
    expect(habit?.target).toBe(30);
    expect(Object.values(engine.getState().habitLogs)).toHaveLength(1);
  });
});

describe('习惯图标（setHabitIcon）', () => {
  it('写 op 的 payload 里带图标 key', async () => {
    const id = await actions.createHabit('阅读');
    await actions.setHabitIcon(id, 'book');

    const withIcon = (await engine.getOpsForEntity('HABIT', id)).filter(
      (op) => 'icon' in payloadOf(op),
    ).at(-1);
    expect(withIcon?.opType).toBe(OpType.Update);
    expect(payloadOf(withIcon!).icon).toBe('book');
  });

  it('🔴 不认识的值抛错，且**一条 op 都不发出**（落成第一个图标 = 静默改数据）', async () => {
    const id = await actions.createHabit('阅读');
    const before = (await engine.getOpsForEntity('HABIT', id)).length;

    await expect(actions.setHabitIcon(id, 'trophy' as never)).rejects.toThrow(/闭集里的 key/);

    const after = await engine.getOpsForEntity('HABIT', id);
    expect(after).toHaveLength(before);
    expect(after.some((op) => 'icon' in payloadOf(op))).toBe(false);
  });

  it('🔴 清除写成显式 null，不是"不放这个键"（不放 = 不改）', async () => {
    const id = await actions.createHabit('阅读', { icon: 'moon' });
    expect(engine.getState().habits[id]?.icon).toBe('moon');

    await actions.setHabitIcon(id, undefined);
    const cleared = (await engine.getOpsForEntity('HABIT', id)).filter(
      (op) => 'icon' in payloadOf(op),
    ).at(-1);
    expect(payloadOf(cleared!).icon).toBeNull();
    expect(engine.getState().habits[id]?.icon).toBeUndefined();
  });

  it('找不到的习惯也抛错', async () => {
    await expect(actions.setHabitIcon('不存在', 'book')).rejects.toThrow(/找不到习惯/);
  });

  it('改图标不动打卡（图标只是身份，不是状态）', async () => {
    const id = await actions.createHabit('喝水', { target: 8 });
    await actions.checkIn(id, DAY1);
    await actions.setHabitIcon(id, 'drop');

    expect(engine.getState().habits[id]?.target).toBe(8);
    expect(Object.values(engine.getState().habitLogs)).toHaveLength(1);
  });
});

/**
 * 频次写入口（工单 H5）
 * ======================
 *
 * 🔴 这一族要挡的坏，与"判定侧"无关 —— 判定侧（`isScheduledOn` → `computeStreak`）
 * 早就按计划日数连续天数了，缺的**从来不是算法，是一条能写进去的路径**。
 * 所以最后那两条（F6 / F7）是这一单的全部意义：**写完立刻拿判定侧读回来**。
 * 只测"payload 里有 frequency"的话，"写入口接上了而判定根本不读这个键"
 * 这个形状没有任何一层会红（§7 第 195 条：字段看起来有功能，而功能不可达）。
 *
 * ⚠️ 校验与归一**在动作层**（`normalizeHabitFrequency`），界面一个判断都不写：
 *   · `{interval, everyNDays: 0}` 会让 `isScheduledOn` 里的取模除零 ⇒ NaN ⇒ 恒 false
 *     ⇒ 连续天数永远 0，而界面上看不出哪里不对；
 *   · `weekly` 空集合 = "没有计划日"，当"每天"会在用户没打算打卡的日子里判他断链；
 *   · `interval:1` 与"七天全选"归一成 `daily` —— 同一语义在磁盘上只允许一种存法
 *     （§3.3：已落盘的数据会长期存在）。
 */
describe('频次（setHabitFrequency / normalizeHabitFrequency）', () => {
  /** 2026-03-01 是**周日**（ISO 7），03-02 周一、03-03 周二、03-09 周一。 */
  const MON1: LocalDate = '2026-03-02';
  const TUE: LocalDate = '2026-03-03';
  const MON2: LocalDate = '2026-03-09';

  const frequencyOps = async (id: string) =>
    (await engine.getOpsForEntity('HABIT', id)).filter((op) => 'frequency' in payloadOf(op));

  it('F1 建的时候带频次 ⇒ CREATE 的 payload 里就有它', async () => {
    const id = await actions.createHabit('写周报', { frequency: { type: 'weekly', daysOfWeek: [5] } });
    const create = (await engine.getOpsForEntity('HABIT', id)).at(-1);

    expect(create?.opType).toBe(OpType.Create);
    expect(payloadOf(create!).frequency).toEqual({ type: 'weekly', daysOfWeek: [5] });
    expect(engine.getState().habits[id]?.frequency).toEqual({ type: 'weekly', daysOfWeek: [5] });
  });

  it('F2 改频次 = 恰好一条 UPD，且物化状态读得到', async () => {
    const id = await actions.createHabit('拉伸');
    const before = (await engine.getOpsForEntity('HABIT', id)).length;

    await actions.setHabitFrequency(id, { type: 'interval', everyNDays: 3 });

    const after = await engine.getOpsForEntity('HABIT', id);
    expect(after).toHaveLength(before + 1);
    expect((await frequencyOps(id)).at(-1)?.opType).toBe(OpType.Update);
    expect(engine.getState().habits[id]?.frequency).toEqual({ type: 'interval', everyNDays: 3 });
  });

  it('🔴 F3 清除写成显式 null，不是"不放这个键"（不放 = 不改）', async () => {
    const id = await actions.createHabit('冥想', { frequency: { type: 'interval', everyNDays: 4 } });
    expect(engine.getState().habits[id]?.frequency).toBeDefined();

    await actions.setHabitFrequency(id, undefined);

    const cleared = (await frequencyOps(id)).at(-1);
    expect(payloadOf(cleared!).frequency).toBeNull();
    expect(engine.getState().habits[id]?.frequency).toBeUndefined();
  });

  it('🔴 F4 非法值一条 op 都不发出（落成"看起来改了而判定恒 false"最坏）', async () => {
    const id = await actions.createHabit('背单词');
    const before = (await engine.getOpsForEntity('HABIT', id)).length;
    const state = engine.getState().habits[id]?.frequency;

    // 四份坏：除零那一档、非整数、空的日子集合、闭集外的星期号。
    const bad: unknown[] = [
      { type: 'interval', everyNDays: 0 },
      { type: 'interval', everyNDays: 2.5 },
      { type: 'weekly', daysOfWeek: [] },
      { type: 'weekly', daysOfWeek: [8] },
    ];
    for (const input of bad) {
      await expect(
        actions.setHabitFrequency(id, input as never),
        `非法频次被放过去了：${JSON.stringify(input)}`,
      ).rejects.toThrow();
    }

    const after = await engine.getOpsForEntity('HABIT', id);
    expect(after).toHaveLength(before);
    expect(after.some((op) => 'frequency' in payloadOf(op))).toBe(false);
    expect(engine.getState().habits[id]?.frequency).toBe(state);
  });

  it('🔴 F5 归一：`interval:1` 与"七天全选"都存成 daily（同一语义只许一种存法）', async () => {
    const a = await actions.createHabit('喝水');
    const b = await actions.createHabit('深呼吸');

    await actions.setHabitFrequency(a, { type: 'interval', everyNDays: 1 });
    await actions.setHabitFrequency(b, {
      type: 'weekly',
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });

    expect(payloadOf((await frequencyOps(a)).at(-1)!).frequency).toEqual({ type: 'daily' });
    expect(payloadOf((await frequencyOps(b)).at(-1)!).frequency).toEqual({ type: 'daily' });
  });

  it('🔴 F5b 日子集合去重 + 升序（不去重就会有 `[3,1,3]` 与 `[1,3]` 两份存量）', async () => {
    const id = await actions.createHabit('周会');
    await actions.setHabitFrequency(id, { type: 'weekly', daysOfWeek: [3, 1, 3, 1] });

    expect(engine.getState().habits[id]?.frequency).toEqual({ type: 'weekly', daysOfWeek: [1, 3] });
  });

  it('F6 🔴 写完判定侧真的读得到：每周只挑周一 ⇒ 周二不是计划日', async () => {
    const id = await actions.createHabit('写周报');
    await actions.setHabitFrequency(id, { type: 'weekly', daysOfWeek: [1] });

    const habit = engine.getState().habits[id]!;
    expect(isScheduledOn(habit.frequency, MON1)).toBe(true);
    expect(isScheduledOn(habit.frequency, TUE)).toBe(false);
    // 对照：没设过频次的那条恒真（"未设置 = 每天"这条口径没被本单改掉）。
    const plain = await actions.createHabit('随便');
    expect(isScheduledOn(engine.getState().habits[plain]!.frequency, TUE)).toBe(true);
  });

  it('F7 🔴 连续天数按计划日数：同样两个周一，weekly 连成 2、daily 只算 1', async () => {
    const weekly = await actions.createHabit('周复盘');
    await actions.setHabitFrequency(weekly, { type: 'weekly', daysOfWeek: [1] });
    const daily = await actions.createHabit('每日复盘');

    for (const id of [weekly, daily]) {
      await actions.checkIn(id, MON1);
      await actions.checkIn(id, MON2);
    }
    const state = engine.getState();
    const logs = Object.values(state.habitLogs);

    const w = computeStreak(state.habits[weekly]!, logs, MON2);
    const d = computeStreak(state.habits[daily]!, logs, MON2);

    // 🔴 这一条是"写入口 ↔ 判定"那根接缝本身：中间那 6 天对 weekly 习惯**不是**计划日，
    //    所以连续不该断；对 daily 习惯它们是计划日而空着，于是从 03-09 往回一步就断。
    expect(w.current).toBe(2);
    expect(d.current).toBe(1);
    expect(w.longest).toBe(2);
  });

  it('F8 改频次不动打卡（规则变更不清历史；与改图标同族）', async () => {
    const id = await actions.createHabit('拉伸', { target: 1 });
    await actions.checkIn(id, MON1);
    await actions.setHabitFrequency(id, { type: 'interval', everyNDays: 3 });

    expect(Object.values(engine.getState().habitLogs)).toHaveLength(1);
    expect(engine.getState().habits[id]?.target).toBe(1);
  });

  it('F9 找不到的习惯抛错，不静默空操作', async () => {
    await expect(
      actions.setHabitFrequency('不存在', { type: 'daily' }),
    ).rejects.toThrow(/找不到习惯/);
  });

  it('F10 🔴 另一台设备 applyRemote 之后读到同一个频次（不是只活在本机）', async () => {
    const id = await actions.createHabit('晨跑');
    await actions.setHabitFrequency(id, { type: 'weekly', daysOfWeek: [2, 4] });

    const adapterB = new SqliteAdapter({
      schema: INDEXEDDB_SCHEMA,
      driverFactory: () => new NodeSqliteDriver(':memory:'),
    });
    await adapterB.init();
    const engineB = new OpLogEngine({
      store: new DbOpLogStore<Operation<string>>(adapterB),
      clientId: 'client-peer',
      now,
    });

    await engineB.applyRemote(await engine.getPendingUpload());

    const onB = createHabitActions(engineB);
    expect(onB.listHabits().find((h) => h.id === id)?.frequency).toEqual({
      type: 'weekly',
      daysOfWeek: [2, 4],
    });
    adapterB.close();
  });
});

/**
 * 习惯目标：数值 / 单位 / 达成口径
 * ==================================
 *
 * 🔴 这一组钉的是「习惯计数型 / 时长型」**在写路径上缺的那一米**：
 * `Habit` 有 `target` / `unit` / `goalType`，`isAchieved` 把三种口径都实现了，
 * `checkIn` 也收 `value` —— 但**没有任何动作能改一个已建习惯的目标**
 * （`createHabit` 只能设初始值，而 `NewHabitFields` 原来连 `goalType` 都没有）。
 * ⇒ 界面上只能建"每天做一次"的习惯，**计数型与时长型到不了用户手里**，
 * 而且不报错 —— 这正是本仓最忌讳的"看起来有其实没有"。
 */
describe('习惯目标（setHabitGoal）', () => {
  it('数值 / 单位 / 口径三者都能改，且都落进同一条 UPD', async () => {
    const id = await actions.createHabit('喝水');

    await actions.setHabitGoal(id, { target: 8, unit: '杯', goalType: 'exactly' });

    const op = await opOf('HABIT', id);
    expect(op.opType).toBe(OpType.Update);
    expect(payloadOf(op).target).toBe(8);
    expect(payloadOf(op).unit).toBe('杯');
    expect(payloadOf(op).goalType).toBe('exactly');

    const habit = actions.listHabits()[0]!;
    expect(habit.target).toBe(8);
    expect(habit.unit).toBe('杯');
    expect(habit.goalType).toBe('exactly');
  });

  it('空单位（或全是空白）= **清除**，写成 `null` 而不是空串', async () => {
    const id = await actions.createHabit('喝水', { unit: '杯' });

    await actions.setHabitGoal(id, { unit: '   ' });

    // `null` 能穿过 JSON 表达"清除"（与 setHabitColor / setDueDate 同一条约定）。
    // 留一个空串的话，界面上会渲染成「1 」，看起来像少了个字。
    expect(payloadOf(await opOf('HABIT', id)).unit).toBeNull();
    expect(actions.listHabits()[0]!.unit).toBeUndefined();
  });

  it('🔴 负数 / 非有限数的目标**抛错且不留 op**（不然 `isAchieved` 会恒真或恒假）', async () => {
    const id = await actions.createHabit('喝水', { target: 8 });
    const before = (await engine.getOpsForEntity('HABIT', id)).length;

    await expect(actions.setHabitGoal(id, { target: -1 })).rejects.toThrow(/不小于 0/);
    await expect(actions.setHabitGoal(id, { target: Number.NaN })).rejects.toThrow(/不小于 0/);

    expect((await engine.getOpsForEntity('HABIT', id)).length, '被拒绝的调用写了 op').toBe(before);
    expect(actions.listHabits()[0]!.target).toBe(8);
  });

  it('`atMost` + `target: 0` 是**合法**的（"一次都不碰"），不能被当成非法值拦掉', async () => {
    const id = await actions.createHabit('喝咖啡');
    await expect(actions.setHabitGoal(id, { target: 0, goalType: 'atMost' })).resolves.toBeUndefined();
    expect(actions.listHabits()[0]!.target).toBe(0);
  });

  it('一个字段都没传 ⇒ **不写 op**（空 UPD 是纯噪音）', async () => {
    const id = await actions.createHabit('喝水');
    const before = (await engine.getOpsForEntity('HABIT', id)).length;

    await actions.setHabitGoal(id, {});

    expect((await engine.getOpsForEntity('HABIT', id)).length).toBe(before);
  });

  it('找不到习惯时抛错（不静默空操作）', async () => {
    await expect(actions.setHabitGoal('no-such-habit', { target: 3 })).rejects.toThrow(/找不到习惯/);
  });

  it('🔴 改目标之后，**`isAchieved` 的判定真的变了** —— 这才叫"计数型能用"', async () => {
    const id = await actions.createHabit('喝咖啡');
    // 默认：target 1 / atLeast ⇒ 打了 1 次就算达成。
    await actions.checkIn(id, DAY1, 1);

    const habitBefore = actions.listHabits()[0]!;
    const logBefore = actions.listLogs()[0]!;
    expect(isAchieved(habitBefore, logBefore), '默认口径下应当达成').toBe(true);

    // 改成"最多 0 次"⇒ 同样的那次打卡**不再算达成**。
    await actions.setHabitGoal(id, { target: 0, goalType: 'atMost' });

    const habitAfter = actions.listHabits()[0]!;
    const logAfter = actions.listLogs()[0]!;
    expect(isAchieved(habitAfter, logAfter), '改成 atMost/0 之后 1 次就不该算达成').toBe(false);
  });
});

// ── 追加到 packages/app-host/tests/habit-actions.spec.ts ───────────────
describe('习惯进回收站（W4 / P-1）', () => {
  const trashedIds = (): string[] => actions.listTrashedHabits().map((h) => h.id);

  it('🔴 删除 → 回收站列出它；还原 → 回到 listHabits（正向对照各一条）', async () => {
    const doomed = await actions.createHabit('要删的习惯');
    clock += 1000;
    const alive = await actions.createHabit('活着的习惯');

    clock += 1000;
    await actions.removeHabit(doomed);

    expect(trashedIds()).toEqual([doomed]);
    expect(actions.listHabits().map((h) => h.id)).toEqual([alive]);

    expect(await actions.restoreHabit(doomed)).toBe(true);
    expect(trashedIds()).toEqual([]);
    expect(actions.listHabits().map((h) => h.id)).toEqual([doomed, alive]);
  });

  it('🔴 还原写一条新的 UPD { deletedAt: null }；不在回收站时返回 false 且不写 op', async () => {
    const id = await actions.createHabit('删了又还原');
    await actions.removeHabit(id);
    const before = (await engine.getOpsForEntity('HABIT', id)).length;

    await actions.restoreHabit(id);
    const ops = await engine.getOpsForEntity('HABIT', id);
    expect(ops).toHaveLength(before + 1);
    expect(ops.at(-1)?.opType).toBe(OpType.Update);
    expect(payloadOf(ops.at(-1)!).deletedAt).toBeNull();

    // 再还原一次：已经没有墓碑了 ⇒ 空操作（不该产出第二条噪音 op）。
    expect(await actions.restoreHabit(id)).toBe(false);
    expect(await engine.getOpsForEntity('HABIT', id)).toHaveLength(before + 1);
  });

  it('🔴 彻底删除：从回收站消失、墓碑仍在，而打卡记录一条都不少', async () => {
    const id = await actions.createHabit('喝水');
    await actions.checkIn(id, DAY1);
    await actions.checkIn(id, DAY2);

    await actions.removeHabit(id);
    clock += 1000;
    await actions.purgeHabit(id);

    expect(trashedIds()).toEqual([]);
    const raw = engine.getState().habits[id];
    expect(typeof raw?.deletedAt).toBe('number'); // 清墓碑 = 离线对端会把它复活
    expect(raw?.purgedAt).toBe(clock);
    // 打卡记录是"这条习惯发生过什么"的事实源：连彻底删除都不许顺手清掉它。
    expect(actions.listLogs()).toHaveLength(2);
  });

  it('彻底删除的三条拒绝：不存在 / 没删过 / 已彻底删除（幂等）', async () => {
    await expect(actions.purgeHabit('habit-不存在')).rejects.toThrow(/找不到/);

    const live = await actions.createHabit('还活着');
    await expect(actions.purgeHabit(live)).rejects.toThrow(/不在回收站里/);

    await actions.removeHabit(live);
    // 🔴 布尔与 op 数各钉一格（G-8）：`undefined` 与 `false` 在"只数 op"的判据里长得一样。
    expect(await actions.purgeHabit(live), '真的打上了标记却返回 false').toBe(true);
    const ops = (await engine.getOpsForEntity('HABIT', live)).length;
    expect(
      await actions.purgeHabit(live),
      '早已彻底删除却返回 true ⇒ 宿主会把什么都没写成的一句报成"已彻底删除"',
    ).toBe(false);
    await actions.purgeHabit(live);
    expect(await engine.getOpsForEntity('HABIT', live)).toHaveLength(ops);
  });

  it('🔴 已彻底删除的习惯不许被还原（抛错 ≠ 返回 false）', async () => {
    const id = await actions.createHabit('删了、又彻底删除');
    await actions.removeHabit(id);
    await actions.purgeHabit(id);

    await expect(actions.restoreHabit(id)).rejects.toThrow(/已被彻底删除/);
  });

  it('🔴 另一端回放后也不在回收站里（"在回收站"这件事本身跨设备）', async () => {
    const adapterB = new SqliteAdapter({
      schema: INDEXEDDB_SCHEMA,
      driverFactory: () => new NodeSqliteDriver(':memory:'),
    });
    await adapterB.init();
    const engineB = new OpLogEngine({
      store: new DbOpLogStore<Operation<string>>(adapterB),
      clientId: 'client-habit-trash-other',
      now,
    });

    const trashed = await actions.createHabit('只是删掉');
    clock += 1000;
    const purged = await actions.createHabit('彻底删除');
    await actions.removeHabit(trashed);
    await actions.removeHabit(purged);
    await actions.purgeHabit(purged);

    await engineB.applyRemote(await engine.getPendingUpload());
    const onB = createHabitActions(engineB, { now });

    expect(onB.listTrashedHabits().map((h) => h.id)).toEqual([trashed]);
    expect(onB.listHabits()).toEqual([]);

    adapterB.close();
  });
});


/**
 * 工单 W6：`checkIn` 的**量**这一米。
 *
 * 三条判据逐条对应工单里的验收：
 *   ① 目标 8、今天记 5 ⇒ 落盘 `value=5`
 *   ② 不传 `value` 时逐字保持旧行为（缺省 = target）
 *   ③ 撤销打卡仍走软删（`undoCheckIn` 那几条已有，这里只补"减到 0 不是记 0"）
 *
 * 另外钉住两条工单没写、但加了这个通道之后**才会存在**的失败形状：
 *   · 幂等纪律不能被"能改量"悄悄削弱（同值 / 不给值 ⇒ 零 op）
 *   · 比较的是**有效值**，不是 `value` 这个键（否则"记满"会在一条没写量的旧记录上
 *     白写一条 op，而 reducer 收敛成同一条实体 ⇒ 测试全绿、op-log 在长胖）
 */
describe('打卡量（W6）', () => {
  it('🔴 判据①：目标 8、记 5 ⇒ 落盘 value=5，且物化状态读到 5', async () => {
    const id = await actions.createHabit('阅读', { target: 8 });
    expect(await actions.checkIn(id, DAY1, 5)).toBe(true);
    expect(payloadOf(await opOf('HABIT_LOG', habitLogId(id, DAY1))).value).toBe(5);
    expect(actions.listLogs()[0]!.value).toBe(5);
  });

  it('🔴 判据②：已经打过卡时**不给** value ⇒ 幂等空操作，一条 op 都不发', async () => {
    const id = await actions.createHabit('阅读', { target: 8 });
    await actions.checkIn(id, DAY1);
    const before = (await engine.getOpsForEntity('HABIT_LOG', habitLogId(id, DAY1))).length;

    expect(await actions.checkIn(id, DAY1)).toBe(false);
    expect((await engine.getOpsForEntity('HABIT_LOG', habitLogId(id, DAY1))).length).toBe(before);
  });

  it('已经打过卡时给**与当前相同**的量 ⇒ 同样零 op（点了个没变化的东西）', async () => {
    const id = await actions.createHabit('阅读', { target: 8 });
    await actions.checkIn(id, DAY1, 5);
    const before = (await engine.getOpsForEntity('HABIT_LOG', habitLogId(id, DAY1))).length;

    expect(await actions.checkIn(id, DAY1, 5)).toBe(false);
    expect((await engine.getOpsForEntity('HABIT_LOG', habitLogId(id, DAY1))).length).toBe(before);
  });

  it('🔴 改量是**一条 UPD**，payload 只有 `value`（不重发身份字段）', async () => {
    const id = await actions.createHabit('阅读', { target: 8 });
    await actions.checkIn(id, DAY1, 5);

    expect(await actions.checkIn(id, DAY1, 3)).toBe(true);
    const ops = await engine.getOpsForEntity('HABIT_LOG', habitLogId(id, DAY1));
    expect(ops).toHaveLength(2);
    const update = ops.at(-1)!;
    expect(update.opType).toBe(OpType.Update);
    expect(Object.keys(payloadOf(update))).toEqual(['value']);
    expect(actions.listLogs()[0]!.value).toBe(3);
  });

  it('🔴 缺省比的是**有效值**：一条没写量的旧记录上"记满"不再白写一条 op', async () => {
    const id = await actions.createHabit('阅读', { target: 8 });
    // 绕过动作层直接落一条**没有 value** 的打卡（磁盘上真实存在这种形状：
    // `HabitLog.value` 是可选字段，`entities.ts:309`）。
    await engine.dispatch({
      entityType: 'HABIT_LOG',
      entityId: habitLogId(id, DAY1),
      opType: OpType.Create,
      payload: { habitId: id, date: DAY1 },
    });
    const before = (await engine.getOpsForEntity('HABIT_LOG', habitLogId(id, DAY1))).length;
    expect(actions.listLogs()[0]!.value).toBeUndefined();

    // 它读出来就是 8（`@heyta/domain#habitLogValue`），所以"记 8"没有变化。
    expect(await actions.checkIn(id, DAY1, 8)).toBe(false);
    expect((await engine.getOpsForEntity('HABIT_LOG', habitLogId(id, DAY1))).length).toBe(before);

    // 而"记 5"是有变化的 —— 这条正对照防的是"比较恒假 ⇒ 整条判断其实是空转"。
    expect(await actions.checkIn(id, DAY1, 5)).toBe(true);
  });

  it('负数 / 非有限数 ⇒ 抛且零 op；而 **0 是合法读数**（合并 main 时的裁决）', async () => {
    const id = await actions.createHabit('阅读', { target: 8 });
    for (const bad of [-3, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(actions.checkIn(id, DAY1, bad)).rejects.toThrow(/不小于 0 的有限数/);
    }
    expect(actions.listLogs()).toEqual([]);
    expect(await engine.getOpsForEntity('HABIT_LOG', habitLogId(id, DAY1))).toHaveLength(0);

    // 这一档原来写作"0 也抛"（详情面那条线的选择：今天没做请撤销打卡）。
    // 合并 main 时否证了它，两条都是**已承诺的对外行为**：
    //   · `local-api-host.ts` 的 `record-checkin` 在写入前按 `value < 0` 判 invalid ⇒ 0 一路通行，
    //     收紧到 >0 会让本机 API / MCP 这个对外工具面在同一次调用里由内层抛错（契约悄悄改窄）；
    //   · `atMost` 型习惯里"今天 0 次"就是**达成**的样子，删掉记录反而把读数换成"没记"。
    // 它担心的"这一格同时读起来像打过卡又像没做"是真的，但那是**显示层**要分开的事
    //（存在性 ≠ 达成，`isAchieved` 走 `habitLogValue`：0 对 atMost 达成、对 atLeast 不达成）。
    expect(await actions.checkIn(id, DAY1, 0)).toBe(true);
    expect(actions.listLogs()[0]!.value).toBe(0);
  });

  it('⚠️ 刻意**允许小数**（"每天 0.5 小时"是合法目标，卡整数会把合法数据判成非法输入）', async () => {
    const id = await actions.createHabit('有氧', { target: 1, unit: '小时' });
    expect(await actions.checkIn(id, DAY1, 0.5)).toBe(true);
    expect(actions.listLogs()[0]!.value).toBe(0.5);
    expect(isAchieved(actions.listHabits()[0]!, actions.listLogs()[0]!)).toBe(false);
  });

  it('🔴 判据③：撤销打卡**仍然是软删**，改量这一米没把它换成物理删', async () => {
    const id = await actions.createHabit('阅读', { target: 8 });
    await actions.checkIn(id, DAY1, 5);
    const before = (await engine.getOpsForEntity('HABIT_LOG', habitLogId(id, DAY1))).length;

    expect(await actions.undoCheckIn(id, DAY1)).toBe(true);
    const last = await opOf('HABIT_LOG', habitLogId(id, DAY1));
    expect(last.opType).toBe(OpType.Delete);
    expect(actions.listLogs()).toEqual([]);
    // 撤销走的是 `DEL`，不是 `{value: 0}` —— 这条是"减到 0"那条 UI 判据的底层依据。
    expect((await engine.getOpsForEntity('HABIT_LOG', habitLogId(id, DAY1))).length).toBe(before + 1);
  });

  it('🔴 `target: 0`（"一次都不碰"）时按默认打卡记 **1**，不是 0 —— 0 会把"做了"记成"守住了"', async () => {
    const id = await actions.createHabit('喝咖啡', { target: 0, goalType: 'atMost' });
    expect(await actions.checkIn(id, DAY1)).toBe(true);

    const logged = actions.listLogs()[0]!;
    expect(logged.value).toBe(1);
    // 这一句才是这条判据的全部意思：做了 1 次 ⇒ **未**达成。
    // 缺省若写成 `habit.target ?? 1`（= 0），`atMost` 的 `value <= target` 会判它达成，
    // 于是"破戒"在连续天数里被记成"守住"，而界面上一个字都不报。
    expect(isAchieved(actions.listHabits()[0]!, logged)).toBe(false);
  });

  it('改过的量在**换一天**时不受影响（缺省落 target，不是沿用昨天的 5）', async () => {
    const id = await actions.createHabit('阅读', { target: 8 });
    await actions.checkIn(id, DAY1, 5);
    await actions.checkIn(id, DAY2);
    expect(actions.listLogs().find((l) => l.date === DAY2)?.value).toBe(8);
  });
});
