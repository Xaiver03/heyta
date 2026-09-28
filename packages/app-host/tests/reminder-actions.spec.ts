/**
 * 提醒动作层的测试（B1-1 的写路径）
 * ====================================
 *
 * 与 `habit-actions.spec.ts` 同样的取舍：**真实引擎 + 真实 SQLite（`:memory:`）**。
 *
 * 重点盯四类**静默失效**（都是"op 写得出来、但到点不会按预期弹"的形状）：
 *   1. 用随机 id → 同一任务同一时刻建两次得到两条提醒 → 到点弹两次
 *   2. 到期判定在动作层重写一遍 → snooze 被忽略 → 用户按了"稍后提醒"还是照弹
 *   3. `firedAt` 不幂等 → 每次进前台都推一条 op → 两端假冲突
 *   4. 重复顺延靠新建实体 → 每个周期留下一条永不删除的提醒 → 撞上每任务上限
 */

import type { Reminder } from '@heyta/domain';
import { MAX_REMINDERS_PER_TASK } from '@heyta/domain';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTaskActions, type TaskActions } from '../src/actions.js';
import { createReminderActions, reminderId, type ReminderActions } from '../src/reminder-actions.js';

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let actions: ReminderActions;
let tasks: TaskActions;
let clock = 1_700_000_000_000;
const now = (): number => clock;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 可控 id：结构性断言不能靠随机 id。 */
let seq = 0;
const makeTaskId = (): string => {
  seq += 1;
  return `task-t-${String(seq).padStart(3, '0')}`;
};

const state = (): { reminders: Record<string, Reminder> } =>
  engine.getState() as unknown as { reminders: Record<string, Reminder> };

const opCount = async (entityId: string): Promise<number> =>
  (await engine.getOpsForEntity('REMINDER', entityId)).length;

const lastPayload = async (entityId: string): Promise<Record<string, unknown>> => {
  const ops = await engine.getOpsForEntity('REMINDER', entityId);
  const last = ops.at(-1);
  if (last === undefined) throw new Error(`没找到 ${entityId} 的 op`);
  return last.payload as Record<string, unknown>;
};

async function makeTask(over: { dueDate?: number } = {}): Promise<string> {
  return tasks.create('写周报', over);
}

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  engine = new OpLogEngine({
    store: new DbOpLogStore(adapter),
    clientId: 'client-reminder',
    now,
  });
  clock = 1_700_000_000_000;
  seq = 0;
  actions = createReminderActions(engine, { now });
  tasks = createTaskActions(engine, { now, newTaskId: makeTaskId });
});

afterEach(() => {
  adapter.close();
});

describe('新建提醒', () => {
  it('产出一条 REMINDER Create op，并把 taskId / triggerAt 落进物化状态', async () => {
    const taskId = await makeTask();
    const at = clock + 10 * MINUTE;

    const id = await actions.createReminder(taskId, at);

    const ops = await engine.getOpsForEntity('REMINDER', id);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.entityType).toBe('REMINDER');
    expect(ops[0]?.opType).toBe(OpType.Create);
    expect(await lastPayload(id)).toMatchObject({ taskId, triggerAt: at });
    expect(state().reminders[id]?.triggerAt).toBe(at);
  });

  it('🔴 id 是 `${taskId}:${triggerAt}`，同一任务同一时刻建两次只有一条', async () => {
    const taskId = await makeTask();
    const at = clock + 10 * MINUTE;

    const first = await actions.createReminder(taskId, at);
    const second = await actions.createReminder(taskId, at);

    expect(first).toBe(reminderId(taskId, at));
    expect(second).toBe(first);
    expect(await opCount(first)).toBe(1);
    expect(actions.listForTask(taskId)).toHaveLength(1);
  });

  it('不同时刻是两条提醒', async () => {
    const taskId = await makeTask();
    await actions.createReminder(taskId, clock + 10 * MINUTE);
    await actions.createReminder(taskId, clock + 20 * MINUTE);
    expect(actions.listForTask(taskId)).toHaveLength(2);
  });

  it('🔴 给不存在的任务建提醒会抛错（不是"建好了但点进去什么都没有"）', async () => {
    await expect(actions.createReminder('task-不存在', clock + MINUTE)).rejects.toThrow(
      /找不到任务/,
    );
  });

  it('给已软删除的任务建提醒同样抛错', async () => {
    const taskId = await makeTask();
    await tasks.remove(taskId);
    await expect(actions.createReminder(taskId, clock + MINUTE)).rejects.toThrow(/找不到任务/);
  });

  it('过去的时间戳抛错，宽限窗口内接受', async () => {
    const taskId = await makeTask();
    await expect(actions.createReminder(taskId, clock - 5 * MINUTE)).rejects.toThrow(
      /已经过去了/,
    );
    await expect(actions.createReminder(taskId, clock - 30_000)).resolves.toBeTruthy();
  });

  it('超出一年的时间戳抛错（挡"秒当毫秒"）', async () => {
    const taskId = await makeTask();
    await expect(actions.createReminder(taskId, clock + 400 * DAY)).rejects.toThrow(/一年/);
  });

  it(`每任务最多 ${String(MAX_REMINDERS_PER_TASK)} 条存活提醒`, async () => {
    const taskId = await makeTask();
    for (let i = 1; i <= MAX_REMINDERS_PER_TASK; i += 1) {
      await actions.createReminder(taskId, clock + i * MINUTE);
    }
    await expect(actions.createReminder(taskId, clock + 99 * MINUTE)).rejects.toThrow(/上限/);
  });

  it('墓碑不占上限名额（删一条还能再建一条）', async () => {
    const taskId = await makeTask();
    const ids: string[] = [];
    for (let i = 1; i <= MAX_REMINDERS_PER_TASK; i += 1) {
      ids.push(await actions.createReminder(taskId, clock + i * MINUTE));
    }
    await actions.removeReminder(ids[0]!);
    await expect(actions.createReminder(taskId, clock + 99 * MINUTE)).resolves.toBeTruthy();
  });
});

describe('「截止前 N 分钟」提醒', () => {
  it('触发时刻 = 截止 − 提前量，并记下 offsetMs（供重复顺延用）', async () => {
    const due = clock + DAY;
    const taskId = await makeTask({ dueDate: due });

    const id = await actions.createReminderBeforeDue(taskId, 30 * MINUTE);

    expect(state().reminders[id]?.triggerAt).toBe(due - 30 * MINUTE);
    expect(await lastPayload(id)).toMatchObject({ triggerAt: due - 30 * MINUTE, offsetMs: 30 * MINUTE });
  });

  it('任务没有截止时间时抛错，不静默变成绝对提醒', async () => {
    const taskId = await makeTask();
    await expect(actions.createReminderBeforeDue(taskId, 30 * MINUTE)).rejects.toThrow(/没有截止时间/);
  });

  it('负提前量抛错', async () => {
    const taskId = await makeTask({ dueDate: clock + DAY });
    await expect(actions.createReminderBeforeDue(taskId, -1)).rejects.toThrow(/提前量/);
  });
});

describe('到点判定（due）', () => {
  it('到点前返回空、到点后按触发时刻返回', async () => {
    const taskId = await makeTask();
    const id = await actions.createReminder(taskId, clock + 10 * MINUTE);

    expect(actions.due()).toEqual([]);
    clock += 10 * MINUTE;
    expect(actions.due().map((r) => r.id)).toEqual([id]);
  });

  it('🔴 snooze 后原触发点不再算到点，snooze 到点才回来', async () => {
    const taskId = await makeTask();
    const id = await actions.createReminder(taskId, clock + 10 * MINUTE);

    clock += 10 * MINUTE;
    expect(await actions.snoozeReminder(id, clock + 30 * MINUTE)).toBe(true);
    expect(actions.due()).toEqual([]);

    clock += 30 * MINUTE;
    expect(actions.due().map((r) => r.id)).toEqual([id]);
  });

  it('已投递 / 已关闭都不算到点', async () => {
    const taskId = await makeTask();
    const a = await actions.createReminder(taskId, clock + 10 * MINUTE);
    const b = await actions.createReminder(taskId, clock + 20 * MINUTE);

    clock += 20 * MINUTE;
    expect(await actions.markReminderFired(a)).toBe(true);
    expect(await actions.dismissReminder(b)).toBe(true);
    expect(actions.due()).toEqual([]);
  });
});

describe('投递 / 关闭', () => {
  it('🔴 markReminderFired 幂等：第二次不写 op', async () => {
    const taskId = await makeTask();
    const id = await actions.createReminder(taskId, clock + MINUTE);

    expect(await actions.markReminderFired(id)).toBe(true);
    expect(await actions.markReminderFired(id)).toBe(false);
    expect(await opCount(id)).toBe(2); // CRT + 一条 UPD，不是两条 UPD
    expect(state().reminders[id]?.firedAt).toBe(clock);
  });

  it('已投递的提醒不写 snooze（避免必然无效的 op）', async () => {
    const taskId = await makeTask();
    const id = await actions.createReminder(taskId, clock + MINUTE);
    await actions.markReminderFired(id);

    expect(await actions.snoozeReminder(id, clock + 10 * MINUTE)).toBe(false);
    expect(await opCount(id)).toBe(2);
  });

  it('关闭 / 撤销关闭都幂等，且撤销能重新到点', async () => {
    const taskId = await makeTask();
    const id = await actions.createReminder(taskId, clock + MINUTE);
    clock += MINUTE;

    expect(await actions.dismissReminder(id)).toBe(true);
    expect(await actions.dismissReminder(id)).toBe(false);
    expect(actions.due()).toEqual([]);

    expect(await actions.undoDismissReminder(id)).toBe(true);
    expect(await actions.undoDismissReminder(id)).toBe(false);
    expect(actions.due().map((r) => r.id)).toEqual([id]);
  });
});

describe('改期 / 删除', () => {
  it('改期同时清掉 snooze（否则"改完时间却没生效"）', async () => {
    const taskId = await makeTask();
    const id = await actions.createReminder(taskId, clock + MINUTE);
    await actions.snoozeReminder(id, clock + 2 * HOUR);

    clock += HOUR;
    await actions.rescheduleReminder(id, clock + 5 * MINUTE);

    expect(state().reminders[id]?.snoozedUntil).toBeUndefined();
    expect(state().reminders[id]?.triggerAt).toBe(clock + 5 * MINUTE);
  });

  it('删除是软删除：墓碑留着、列表里不再出现、动作层认不出它', async () => {
    const taskId = await makeTask();
    const id = await actions.createReminder(taskId, clock + MINUTE);

    await actions.removeReminder(id);

    expect(state().reminders[id]?.deletedAt).toBe(clock);
    expect(actions.listForTask(taskId)).toEqual([]);
    await expect(actions.rescheduleReminder(id, clock + 2 * MINUTE)).rejects.toThrow(/找不到提醒/);
  });
});

describe('重复任务顺延', () => {
  it('🔴 带提前量的提醒跟着新截止走，并重置上一个周期的投递/关闭/推迟状态', async () => {
    const due = clock + DAY;
    const taskId = await makeTask({ dueDate: due });
    const id = await actions.createReminderBeforeDue(taskId, 30 * MINUTE);

    clock += 10 * MINUTE;
    await actions.markReminderFired(id);
    await actions.snoozeReminder(id, clock + HOUR);
    await actions.dismissReminder(id);

    const nextDue = due + DAY;
    expect(await actions.rescheduleForRepeat(taskId, nextDue)).toBe(1);

    const moved = state().reminders[id];
    expect(moved?.triggerAt).toBe(nextDue - 30 * MINUTE);
    expect(moved?.firedAt).toBeUndefined();
    expect(moved?.dismissedAt).toBeUndefined();
    expect(moved?.snoozedUntil).toBeUndefined();
    // 顺延不新建实体 → 上限不会被周期数吃掉
    expect(actions.listForTask(taskId)).toHaveLength(1);
  });

  it('绝对时刻提醒不被顺延，且不写 op', async () => {
    const taskId = await makeTask({ dueDate: clock + DAY });
    const id = await actions.createReminder(taskId, clock + 2 * HOUR);

    expect(await actions.rescheduleForRepeat(taskId, clock + 3 * DAY)).toBe(0);
    expect(await opCount(id)).toBe(1);
  });

  it('没有新截止时间时什么都不做', async () => {
    const taskId = await makeTask({ dueDate: clock + DAY });
    await actions.createReminderBeforeDue(taskId, HOUR);
    expect(await actions.rescheduleForRepeat(taskId, undefined)).toBe(0);
  });
});