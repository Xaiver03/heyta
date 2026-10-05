/**
 * 专注概览（工单 W7 的读侧出口）
 * ==============================
 *
 * 载体与 `focus-actions.spec.ts` 同一取舍：**真实引擎 + 真实 SQLite（`:memory:`）**。
 * 这一层要证的正是"从物化状态读出来的数对不对"，用假 `getState()` 只能证明
 * 我想到要读哪些字段 —— 而那恰好是这类代码最容易错的地方（实体没被物化、
 * 墓碑混进来、顺序依赖存储返回顺序，见 §7 #20）。
 *
 * 🔴 每条期望值都是**手算的**，不是把被测函数再调一遍。
 * 唯一例外是"记录列表条数 == `listSessions()` 里工作段条数"那一条 ——
 * 那是工单判据 ② 的原话形状，它比的是**两个出口的一致性**，
 * 而工作段用 `kind === 'work'` 现算（不借 `shouldPersistSession`），
 * 所以摘掉概览里的过滤会立刻红。
 */
import type { FocusSession } from '@heyta/domain';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFocusActions } from '../src/focus-actions.js';
import { createTaskActions } from '../src/actions.js';
import { focusOverview } from '../src/focus-overview.js';

let adapter: SqliteAdapter;
let engine: OpLogEngine;

/**
 * 固定时钟：2026-09-24 12:00（本地）。
 * "今天"的判定走本地日历日，所以测试不能依赖运行机器的时区。
 */
const CLOCK = new Date(2026, 8, 24, 12, 0, 0, 0).getTime();
const MIN = 60 * 1000;

let idSeq = 0;
const makeId = (): string => {
  idSeq += 1;
  return `f-${String(idSeq).padStart(3, '0')}`;
};

function session(over: Partial<FocusSession> = {}): FocusSession {
  return {
    id: '',
    kind: 'work',
    plannedMs: 25 * MIN,
    actualMs: 25 * MIN,
    completed: true,
    createdAt: CLOCK,
    updatedAt: CLOCK,
    startedAt: CLOCK - 25 * MIN,
    endedAt: CLOCK,
    ...over,
  };
}

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  engine = new OpLogEngine({
    store: new DbOpLogStore(adapter),
    clientId: 'client-overview',
    now: () => CLOCK,
  });
  idSeq = 0;
});

afterEach(() => {
  adapter.close();
});

describe('四张概览卡', () => {
  it('🔴 今日只数自然完成的工作段，累计时长却含放弃段 —— 两个问题两套口径', async () => {
    const actions = createFocusActions(engine, { newFocusId: makeId });
    await actions.log(session({ completed: true, actualMs: 25 * MIN }));
    await actions.log(session({ completed: false, actualMs: 8 * MIN }));
    await actions.log(session({ completed: true, actualMs: 25 * MIN }));
    await actions.log(session({ kind: 'shortBreak', completed: true, actualMs: 5 * MIN }));

    const o = focusOverview(engine, CLOCK);
    // 手算：完成 2 段；时长 25+8+25 = 58 分钟（休息 5 分钟不算）。
    expect(o.todayCount).toBe(2);
    expect(o.todayFocusMs).toBe(58 * MIN);
    expect(o.todayAbortedCount).toBe(1);
    expect(o.totalCount).toBe(2);
    expect(o.totalFocusMs).toBe(58 * MIN);
  });

  it('🔴 段数**不是**时长推出来的：同样 50 分钟，一段与两段读出来不同', async () => {
    const actions = createFocusActions(engine, { newFocusId: makeId });
    await actions.log(session({ actualMs: 50 * MIN }));

    expect(focusOverview(engine, CLOCK).totalCount).toBe(1);

    const second = createFocusActions(engine, { newFocusId: makeId });
    await second.log(session({ actualMs: 25 * MIN }));

    const o = focusOverview(engine, CLOCK);
    expect(o.totalFocusMs).toBe(75 * MIN);
    expect(o.totalCount).toBe(2);
    // 这条防的是"把 count 写成 focusMs/60000"：那样今天会读成 75 个番茄。
    expect(o.totalCount).not.toBe(Math.round(o.totalFocusMs / MIN));
  });

  it('昨天的段进累计、不进今日（"今天"是本地日历日，不是最近 24 小时）', async () => {
    const actions = createFocusActions(engine, { newFocusId: makeId });
    const yesterday = CLOCK - 26 * 60 * MIN;
    await actions.log(session({ createdAt: yesterday, startedAt: yesterday, endedAt: yesterday }));
    await actions.log(session());

    const o = focusOverview(engine, CLOCK);
    expect(o.todayCount).toBe(1);
    expect(o.todayFocusMs).toBe(25 * MIN);
    expect(o.totalCount).toBe(2);
    expect(o.totalFocusMs).toBe(50 * MIN);
  });

  it('已删除的记录既不进数也不进列表', async () => {
    const actions = createFocusActions(engine, { newFocusId: makeId });
    const keep = await actions.log(session());
    const gone = await actions.log(session());

    await engine.dispatch({
      entityType: 'FOCUS_SESSION',
      entityId: gone,
      opType: OpType.Delete,
      payload: {},
    });

    const o = focusOverview(engine, CLOCK);
    expect(o.todayCount).toBe(1);
    expect(o.totalFocusMs).toBe(25 * MIN);
    expect(o.records.map((r) => r.id)).toEqual([keep]);
  });
});

describe('专注记录列表', () => {
  it('🔴 判据 ②：条数 == listSessions() 里的工作段条数（休息段不许混进来）', async () => {
    const actions = createFocusActions(engine, { newFocusId: makeId });
    await actions.log(session());
    await actions.log(session({ kind: 'shortBreak' }));
    await actions.log(session({ kind: 'longBreak' }));
    await actions.log(session({ completed: false }));

    const workCount = actions
      .listSessions()
      .filter((s) => s.kind === 'work').length;
    // 前提成立本身也要断言：否则"两边都是 0"会读成一致。
    expect(workCount, '夹具没造出工作段').toBeGreaterThan(0);
    expect(focusOverview(engine, CLOCK).records).toHaveLength(workCount);
  });

  it('新到旧：最近那一段在第一行', async () => {
    const actions = createFocusActions(engine, { newFocusId: makeId });
    const ids = [];
    for (const [i, offset] of [0, 30, 60].entries()) {
      const at = CLOCK + (i + 1) * 60 * MIN;
      ids.push(
        await actions.log(
          session({ createdAt: at - MIN, startedAt: at - MIN, endedAt: at, actualMs: offset * MIN }),
        ),
      );
    }

    const records = focusOverview(engine, CLOCK + 90 * MIN).records;
    expect(records.map((r) => r.id)).toEqual([...ids].reverse());
  });

  it('🔴 归属日用 endedAt，不是 createdAt（跨零点那一轮不能落到前一天）', async () => {
    const actions = createFocusActions(engine, { newFocusId: makeId });
    const started = new Date(2026, 8, 23, 23, 40, 0, 0).getTime();
    const ended = new Date(2026, 8, 24, 0, 5, 0, 0).getTime();
    await actions.log(session({ createdAt: started, startedAt: started, endedAt: ended }));

    const o = focusOverview(engine, CLOCK);
    expect(o.todayCount).toBe(1);
    expect(o.records[0]?.at).toBe(ended);
  });

  it('actualMs 缺失时退回 plannedMs，不当 0（老数据与别的写入方不一定填）', async () => {
    const actions = createFocusActions(engine, { newFocusId: makeId });
    await actions.log(session({ actualMs: undefined, plannedMs: 25 * MIN }));

    expect(focusOverview(engine, CLOCK).records[0]?.actualMs).toBe(25 * MIN);
  });
});

describe('记录行的任务标题', () => {
  it('有关联任务时带标题，没关联时是 null（不是空串、不是 undefined）', async () => {
    const taskId = await createTaskActions(engine).create('写周报');
    const actions = createFocusActions(engine, { newFocusId: makeId });
    await actions.log(session({ taskId }));
    await actions.log(session({ taskId: null as unknown as string | undefined }));

    const records = focusOverview(engine, CLOCK).records;
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.taskTitle).sort()).toEqual([null, '写周报']);
    expect(records.find((r) => r.taskTitle === '写周报')?.taskId).toBe(taskId);
  });

  it('🔴 任务被删之后，历史记录仍说得出当时挂在什么上面', async () => {
    const taskActions = createTaskActions(engine);
    const taskId = await taskActions.create('写周报');
    const actions = createFocusActions(engine, { newFocusId: makeId });
    await actions.log(session({ taskId }));

    await taskActions.remove(taskId);

    const [record] = focusOverview(engine, CLOCK).records;
    expect(record?.taskTitle).toBe('写周报');
  });

  it('关联到一个查不到的 id 时给 null，不抛', async () => {
    const actions = createFocusActions(engine, { newFocusId: makeId });
    await actions.log(session({ taskId: 'ghost-task' }));

    expect(focusOverview(engine, CLOCK).records[0]?.taskTitle).toBeNull();
  });
});
