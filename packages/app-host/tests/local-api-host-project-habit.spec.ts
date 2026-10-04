/**
 * 清单 / 习惯的写入**真的产出 op**（宿主层判据）
 * ==============================================
 *
 * 与 `local-api-host.spec.ts` 同一个台架（真引擎 + 真 SQLite，`:memory:`），
 * 因为要证的是同一件事：**"我调了个函数"不算，磁盘上多了一条 op 才算。**
 *
 * 四条承重断言：
 *
 *   1. 🔴 `create-project` / `create-habit` 各产出**一条** CRT op，载荷就是那几个字段
 *   2. 🔴 非法取值（达成口径不认识 / 目标负数 / 空单位）被**拒绝且不写 op** ——
 *      不猜、不"落成默认值"
 *   3. 🔴 `parentId` 指向不存在或已删除的清单时报 `not-found`；指向一个**已在清单下面**
 *      的清单时报 `invalid`（领域层只支持一层，挂到二级下面的清单在四个端上都渲染不出来）
 *   4. 🔴 结果里的 `entityId` + `entityType` 说的是**刚落地的那个实体**，
 *      而 `listHabits()` 读回来的正是它（写→读同一条闭环，不是两个各自成立的桩）
 */

import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType, type Operation } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTaskActions } from '../src/actions.js';
import { createLocalApiHost } from '../src/local-api-host.js';

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let clock = 1_700_000_000_000;
const now = (): number => clock;

function makeHost() {
  // 与 `local-api-host.spec.ts` 一样直接把引擎当 `ActionContext` 传进去。
  return createLocalApiHost(
    engine,
    createTaskActions(engine, { now }),
    // 🔴 `isReadable` 必填（理由见 `local-api-host.ts`）；这些用例测的是清单与习惯，
    // 所以按"全都读得出来"给。
    { isReadable: () => true },
  );
}

function opsOf(entityType: 'PROJECT' | 'HABIT', entityId: string): Promise<Operation<string>[]> {
  return engine.getOpsForEntity(entityType, entityId);
}

/** 当前状态里未删除的清单数 —— 用来证明"拒绝的那一次**真的什么都没写**"。 */
function aliveCount(record: Record<string, { deletedAt?: number }>): number {
  return Object.values(record).filter((x) => x.deletedAt === undefined).length;
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
    now: () => clock,
  });
  clock = 1_700_000_000_000;
});

afterEach(() => {
  adapter.close();
});

describe('🔴 create-project 产出真实的 PROJECT op', () => {
  it('一条 CRT，载荷是 { name, parentId: null }', async () => {
    const host = makeHost();
    const result = await host.submit({ action: 'create-project', name: '读书' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ops = await opsOf('PROJECT', result.taskId);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.opType).toBe(OpType.Create);
    expect(ops[0]?.payload).toEqual({ name: '读书', parentId: null });

    // 结果说清它是**清单**的 id（不是任务 id）。
    expect(result.entityType).toBe('PROJECT');
    expect(result.entityId).toBe(result.taskId);
    expect(engine.getState().projects[result.taskId]?.name).toBe('读书');
  });

  it('名字两端空白被去掉后落盘（与 `createProject` 同一条规则，只有一份）', async () => {
    const result = await makeHost().submit({ action: 'create-project', name: '  健身  ' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((await opsOf('PROJECT', result.taskId))[0]?.payload).toMatchObject({ name: '健身' });
  });

  it('🔴 合法 parentId：建出来的清单挂在那个子级上', async () => {
    const host = makeHost();
    const parent = await host.submit({ action: 'create-project', name: '工作' });
    expect(parent.ok).toBe(true);
    if (!parent.ok) return;

    const child = await host.submit({
      action: 'create-project',
      name: '周报',
      parentId: parent.taskId,
    });
    expect(child.ok).toBe(true);
    if (!child.ok) return;
    expect(engine.getState().projects[child.taskId]?.parentId).toBe(parent.taskId);
  });

  it('🔴 不存在的 parentId ⇒ not-found 且**一条 op 都没写**', async () => {
    const before = aliveCount(engine.getState().projects);
    const result = await makeHost().submit({
      action: 'create-project',
      name: '幽灵下面的清单',
      parentId: 'project-不存在',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
    expect(aliveCount(engine.getState().projects)).toBe(before);
  });

  it('🔴 只支持一层：父级自己已经在清单下面 ⇒ 拒绝，而不是建出一个**渲染不出**的清单', async () => {
    const host = makeHost();
    const top = await host.submit({ action: 'create-project', name: '文件夹' });
    expect(top.ok).toBe(true);
    if (!top.ok) return;
    const second = await host.submit({ action: 'create-project', name: '一层', parentId: top.taskId });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const before = aliveCount(engine.getState().projects);
    const third = await host.submit({
      action: 'create-project',
      name: '第三层',
      parentId: second.taskId,
    });
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.message).toContain('一层');
    expect(aliveCount(engine.getState().projects)).toBe(before);
  });
});

describe('🔴 create-habit 产出真实的 HABIT op', () => {
  it('只有名字时按产品默认落：target = 1（纯打卡型）', async () => {
    const result = await makeHost().submit({ action: 'create-habit', name: '冥想' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ops = await opsOf('HABIT', result.taskId);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.opType).toBe(OpType.Create);
    expect(ops[0]?.payload).toEqual({ name: '冥想', target: 1 });
    expect(result.entityType).toBe('HABIT');
  });

  it('目标三件事都带上时**逐字进载荷**，且 `listHabits()` 立刻读得回来', async () => {
    const host = makeHost();
    const result = await host.submit({
      action: 'create-habit',
      name: '喝水',
      target: 8,
      unit: '杯',
      goalType: 'atMost',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // `createHabit` 的载荷是 `{ name, target: 1, ...over }` ⇒ 给了 target 就**覆盖**默认的 1。
    // 这条断言钉的是"AI 传的目标数真的落进了 op"，而不是"落成了 1"。
    expect((await opsOf('HABIT', result.taskId))[0]?.payload).toEqual({
      name: '喝水',
      target: 8,
      goalType: 'atMost',
      unit: '杯',
    });

    // 🔴 写→读闭环：这条判据挡的是"写进 op 了但投影漏搬一个字段" ——
    // 那种情况下界面看得见、AI 看不见，而两边都不报错。
    const listed = await host.listHabits();
    expect(listed).toEqual([
      { id: result.taskId, name: '喝水', target: 8, unit: '杯', goalType: 'atMost' },
    ]);
  });

  it('🔴 非法取值一律拒绝且**不写 op**（不猜、不降级成默认值）', async () => {
    const host = makeHost();
    const cases: readonly { label: string; intent: Parameters<typeof host.submit>[0] }[] = [
      { label: '空白名', intent: { action: 'create-habit', name: '   ' } },
      { label: '负数目标', intent: { action: 'create-habit', name: '喝水', target: -2 } },
      { label: 'NaN 目标', intent: { action: 'create-habit', name: '喝水', target: Number.NaN } },
      { label: '空单位', intent: { action: 'create-habit', name: '喝水', unit: '  ' } },
      { label: '不认识的口径', intent: { action: 'create-habit', name: '喝水', goalType: 'whenever' } },
    ];

    for (const { label, intent } of cases) {
      const before = aliveCount(engine.getState().habits);
      const result = await host.submit(intent);
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.reason, label).toBe('invalid');
      expect(aliveCount(engine.getState().habits), `${label} 之后不该多出习惯`).toBe(before);
    }
  });

  it('目标 0 是**合法**的（`atMost` 的"今天一次都不碰"）', async () => {
    const result = await makeHost().submit({
      action: 'create-habit',
      name: '不碰手机',
      target: 0,
      goalType: 'atMost',
    });
    expect(result.ok).toBe(true);
  });
});

describe('listHabits 的读侧', () => {
  it('🔴 只出四个字段：color / icon / frequency 一个都不出去', async () => {
    const host = makeHost();
    const created = await host.submit({ action: 'create-habit', name: '喝水' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // 直接对实体写一个带颜色与图标的状态（模拟用户在界面上挑过），
    // 再问 AI 侧看到什么 —— 白名单重建漏一条就会在这里红。
    await engine.dispatch({
      entityType: 'HABIT',
      entityId: created.taskId,
      opType: OpType.Update,
      payload: { color: '3', icon: 'drop', frequency: 'daily', backfillDays: 2 },
    });

    const listed = await host.listHabits();
    expect(listed).toHaveLength(1);
    expect(Object.keys(listed[0] ?? {}).sort()).toEqual(['id', 'name', 'target']);
    expect(JSON.stringify(listed)).not.toContain('drop');
  });

  it('软删除的习惯不出现在列表里（与 `listTasks` 同一条规则）', async () => {
    const host = makeHost();
    const created = await host.submit({ action: 'create-habit', name: '要删的' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await engine.dispatch({
      entityType: 'HABIT',
      entityId: created.taskId,
      opType: OpType.Delete,
      payload: {},
    });
    expect(await host.listHabits()).toEqual([]);
  });
});
