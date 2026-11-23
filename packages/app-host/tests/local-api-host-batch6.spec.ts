/**
 * 工具层补全（批次 6）—— `submitIntent` 对清单/习惯属性意图的分发判据（seam 层）
 * =====================================================================
 *
 * 只守两件事：
 * 1. 每条 `intent.action` 是否真的翻成**对应那个动作方法**、把实体字段改对（成功路径）；
 * 2. 不存在 / 非法参数是否在门口被挡成 `not-found` / `invalid`（拒绝路径）。
 *
 * 用**真引擎 + 真动作集**（`createLocalApiHost` 自己构造动作集），因为这几条动作都是
 * 字段级写入、没有分支黑箱，靠读最终实体状态即可证明接线是否对（比桩更直接）。
 * 成功路径的"提案不落库 / 确认 +1"三腿另由 `ai-tool-proposal-all-writes.spec.ts` 覆盖。
 */

import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import type { LocalApiWriteIntent } from '@heyta/local-api';
import type { Operation } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTaskActions } from '../src/actions.js';
import { createLocalApiHost } from '../src/local-api-host.js';
import { startOfDay } from '@heyta/domain';

const CLOCK = 1_700_000_000_000;

let adapter: SqliteAdapter;
let engine: OpLogEngine;

function makeHost() {
  return createLocalApiHost(engine, createTaskActions(engine, { now: () => CLOCK }), {
    isReadable: () => true,
    now: () => CLOCK,
  });
}

async function seed(intent: LocalApiWriteIntent): Promise<string> {
  const result = await makeHost().submit(intent);
  if (!result.ok) throw new Error(`前置数据没落下来：${result.message}`);
  return result.taskId;
}

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  engine = new OpLogEngine({
    store: new DbOpLogStore<Operation<string>>(adapter),
    clientId: 'client-test',
    now: () => CLOCK,
  });
});

afterEach(() => {
  adapter.close();
});

describe('set-project-color', () => {
  it('设色写到 project.color', async () => {
    const projectId = await seed({ action: 'create-project', name: 'P' });
    const r = await makeHost().submit({ action: 'set-project-color', projectId, color: 3 });
    expect(r.ok).toBe(true);
    expect(engine.getState().projects[projectId]?.color).toBe('3');
  });

  it('省略 color = 清除（写成 null）', async () => {
    const projectId = await seed({ action: 'create-project', name: 'P' });
    await makeHost().submit({ action: 'set-project-color', projectId, color: 3 });
    await makeHost().submit({ action: 'set-project-color', projectId });
    expect(engine.getState().projects[projectId]?.color ?? null).toBeNull();
  });

  it('清单不存在 ⇒ not-found', async () => {
    const r = await makeHost().submit({ action: 'set-project-color', projectId: 'ghost', color: 3 });
    expect(r).toMatchObject({ ok: false, reason: 'not-found' });
  });

  it('color 越界 ⇒ invalid（宿主侧再挡一次）', async () => {
    const projectId = await seed({ action: 'create-project', name: 'P' });
    const r = await makeHost().submit({ action: 'set-project-color', projectId, color: 99 });
    expect(r).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

describe('set-habit-color / icon / goal / frequency', () => {
  it('set-habit-color 写 habit.color', async () => {
    const habitId = await seed({ action: 'create-habit', name: 'H' });
    const r = await makeHost().submit({ action: 'set-habit-color', habitId, color: 2 });
    expect(r.ok).toBe(true);
    expect(engine.getState().habits[habitId]?.color).toBe('2');
  });

  it('set-habit-icon 写 habit.icon', async () => {
    const habitId = await seed({ action: 'create-habit', name: 'H' });
    const r = await makeHost().submit({ action: 'set-habit-icon', habitId, icon: 'book' });
    expect(r.ok).toBe(true);
    expect(engine.getState().habits[habitId]?.icon).toBe('book');
  });

  it('set-habit-icon 不认识的图标 ⇒ invalid', async () => {
    const habitId = await seed({ action: 'create-habit', name: 'H' });
    const r = await makeHost().submit({ action: 'set-habit-icon', habitId, icon: 'not-a-real-icon' });
    expect(r).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('set-habit-goal 写 target/unit/goalType', async () => {
    const habitId = await seed({ action: 'create-habit', name: 'H' });
    const r = await makeHost().submit({ action: 'set-habit-goal', habitId, target: 8, unit: '杯', goalType: 'atLeast' });
    expect(r.ok).toBe(true);
    const h = engine.getState().habits[habitId];
    expect(h?.target).toBe(8);
    expect(h?.unit).toBe('杯');
    expect(h?.goalType).toBe('atLeast');
  });

  it('set-habit-goal 非法目标 ⇒ invalid', async () => {
    const habitId = await seed({ action: 'create-habit', name: 'H' });
    const r = await makeHost().submit({ action: 'set-habit-goal', habitId, target: -1 });
    expect(r).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('set-habit-frequency 写 frequency', async () => {
    const habitId = await seed({ action: 'create-habit', name: 'H' });
    const r = await makeHost().submit({ action: 'set-habit-frequency', habitId, frequency: { type: 'interval', everyNDays: 3 } });
    expect(r.ok).toBe(true);
    expect(engine.getState().habits[habitId]?.frequency).toEqual({ type: 'interval', everyNDays: 3 });
  });

  it('set-habit-frequency 非法频率 ⇒ invalid（动作层 normalize 抛）', async () => {
    const habitId = await seed({ action: 'create-habit', name: 'H' });
    const r = await makeHost().submit({ action: 'set-habit-frequency', habitId, frequency: { type: 'bogus' } as never });
    expect(r).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('习惯不存在 ⇒ not-found（四种属性工具同口径）', async () => {
    for (const intent of [
      { action: 'set-habit-color', habitId: 'ghost', color: 1 },
      { action: 'set-habit-icon', habitId: 'ghost', icon: 'book' },
      { action: 'set-habit-goal', habitId: 'ghost', target: 1 },
      { action: 'set-habit-frequency', habitId: 'ghost', frequency: { type: 'daily' } },
    ] as LocalApiWriteIntent[]) {
      const r = await makeHost().submit(intent);
      expect(r).toMatchObject({ ok: false, reason: 'not-found' });
    }
  });
});

describe('set-task-quadrant', () => {
  it('放进第 1 格 → important=true 且 dueDate 被设（紧急）', async () => {
    const taskId = await seed({ action: 'create-task', title: '象限任务' });
    const r = await makeHost().submit({ action: 'set-task-quadrant', taskId, quadrant: 1 });
    expect(r.ok).toBe(true);
    const t = engine.getState().tasks[taskId];
    expect(t?.important).toBe(true);
    expect(t?.dueDate).toBeDefined();
  });
  it('任务不存在 ⇒ not-found', async () => {
    const r = await makeHost().submit({ action: 'set-task-quadrant', taskId: 'ghost', quadrant: 1 });
    expect(r).toMatchObject({ ok: false, reason: 'not-found' });
  });
  it('quadrant 越界 ⇒ invalid', async () => {
    const taskId = await seed({ action: 'create-task', title: 'Q' });
    const r = await makeHost().submit({ action: 'set-task-quadrant', taskId, quadrant: 9 });
    expect(r).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

describe('postpone-task-to-today', () => {
  it('过去截止 → 顺延到今天（dueDate 前移到今天起点之后）', async () => {
    const taskId = await seed({ action: 'create-task', title: '拖延', dueDate: '2020-01-01' });
    const before = engine.getState().tasks[taskId]?.dueDate;
    expect(before).toBeLessThan(startOfDay(CLOCK));
    const r = await makeHost().submit({ action: 'postpone-task-to-today', taskId });
    expect(r.ok).toBe(true);
    expect(engine.getState().tasks[taskId]?.dueDate).toBeGreaterThanOrEqual(startOfDay(CLOCK));
  });
  it('任务不存在 ⇒ not-found', async () => {
    const r = await makeHost().submit({ action: 'postpone-task-to-today', taskId: 'ghost' });
    expect(r).toMatchObject({ ok: false, reason: 'not-found' });
  });
});

describe('record-habit-checkins', () => {
  it('两个习惯批量打卡 → 两条打卡记录', async () => {
    const h1 = await seed({ action: 'create-habit', name: 'H1' });
    const h2 = await seed({ action: 'create-habit', name: 'H2' });
    const r = await makeHost().submit({ action: 'record-habit-checkins', habitIds: [h1, h2], date: '2026-10-05' });
    expect(r.ok).toBe(true);
    const logs = Object.values(engine.getState().habitLogs).filter((l) => l.deletedAt === undefined);
    expect(logs.length).toBe(2);
  });
  it('任一习惯不存在 ⇒ not-found，且一条都不写', async () => {
    const h1 = await seed({ action: 'create-habit', name: 'H1' });
    const r = await makeHost().submit({ action: 'record-habit-checkins', habitIds: [h1, 'ghost'], date: '2026-10-05' });
    expect(r).toMatchObject({ ok: false, reason: 'not-found' });
    expect(Object.values(engine.getState().habitLogs).filter((l) => l.deletedAt === undefined).length).toBe(0);
  });
  it('空 habitIds ⇒ invalid', async () => {
    const r = await makeHost().submit({ action: 'record-habit-checkins', habitIds: [] });
    expect(r).toMatchObject({ ok: false, reason: 'invalid' });
  });
});
