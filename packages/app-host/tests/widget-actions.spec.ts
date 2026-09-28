/**
 * 小组件意图落地的测试
 * ======================
 *
 * 与 `actions.spec.ts` / `project-actions.spec.ts` 同样的取舍：
 * **真实引擎 + 真实 SQLite（`:memory:`）**，不是假的 dispatch 探针。
 *
 * 这里尤其重要，因为这个文件的核心断言是"**一次点击 = 恰好一条 op**" ——
 * 而假探针只能证明"我调了 dispatch 一次"，它对
 * "`setCompleted` 内部自己又发了一条 op"这类情况一无所知。
 * 只有去 op-log 里**数真实 op** 才能证明它。
 *
 * 重点盯四类静默失效：
 *   1. **一次点击产生两条 op** → 同步时多出无意义的写，两端 `updatedAt` 对不上
 *   2. **重复任务被写成 `completedAt`** → "每周一"的任务从组件点完成之后永远消失
 *   3. **一条坏意图堵住整批** → 用户后面所有点击都不生效，且队列永远清不掉
 *   4. **已在目标态仍然执行** → `completedAt` 被改到现在，所有基于完成时间的口径偏移
 */

import { parseLocalDate, toLocalDate } from '@heyta/domain';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import type { Operation } from '@heyta/sync-core';
import {
  emptyIntentQueue,
  mergeIntents,
  type WidgetIntent,
  type WidgetIntentQueue,
} from '@heyta/widget-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTaskActions, type TaskActions } from '../src/actions.js';
import { drainWidgetIntents, type WidgetDrainTasks } from '../src/widget-actions.js';

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let tasks: TaskActions;

let clock = 1_700_000_000_000;
const now = (): number => clock;

let idSeq = 0;
const makeId = (): string => {
  idSeq += 1;
  return `task-w-${String(idSeq).padStart(3, '0')}`;
};

/** `LocalDate` → 本地正午。正午离日界最远，跨时区都落在同一天。 */
function localNoon(date: string): number {
  return parseLocalDate(date).getTime() + 12 * 60 * 60 * 1000;
}

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  engine = new OpLogEngine({
    store: new DbOpLogStore<Operation<string>>(adapter),
    clientId: 'client-widget',
    now,
  });
  clock = 1_700_000_000_000;
  idSeq = 0;
  tasks = createTaskActions(engine, { now, newTaskId: makeId });
});

afterEach(() => {
  adapter.close();
});

function intent(taskId: string, targetIsDone: boolean, at = clock): WidgetIntent {
  return { taskId, targetIsDone, at };
}

function queueOf(...intents: WidgetIntent[]): WidgetIntentQueue {
  return mergeIntents(emptyIntentQueue(), intents);
}

async function opCount(entityId: string): Promise<number> {
  return (await engine.getOpsForEntity('TASK', entityId)).length;
}

/**
 * 🔴 **本文件的主要断言形式：op 数的增量必须等于 `applied`。**
 *
 * 用增量而不是绝对值：`applied` 是"这个函数认为它做了几件事"，
 * 增量是"op-log 里真的多了几条"。两者必须相等，且都是 1（单条意图的情况）。
 * 断言"至少 1 条"会让"一次点击产生两条 op"溜过去 —— 那正是最难发现的形态。
 */
async function expectExactlyOps(
  entityId: string,
  delta: number,
  run: () => Promise<number>,
): Promise<void> {
  const before = await opCount(entityId);
  const applied = await run();
  const after = await opCount(entityId);
  expect(after - before).toBe(delta);
  expect(applied).toBe(delta);
}

describe('drainWidgetIntents —— 恰好 +1 条 op', () => {
  it('🔴 完成一条普通任务：applied === 1，且 op 数精确 +1', async () => {
    const id = await tasks.create('写周报');

    await expectExactlyOps(id, 1, async () => {
      const result = await drainWidgetIntents(queueOf(intent(id, true)), tasks);
      expect(result.skippedAlreadyInTarget).toBe(0);
      expect(result.skippedMissing).toBe(0);
      expect(result.failed).toEqual([]);
      expect(result.remaining.intents).toEqual([]);
      return result.applied;
    });

    // 而且真的完成了（不是"发了 op 但没生效"）
    expect(tasks.findTask(id)!.completedAt).toBeDefined();
  });

  it('🔴 取消完成：同样恰好 +1，且 `completedAt` 被清掉', async () => {
    const id = await tasks.create('写周报');
    await tasks.setCompleted(id, true);
    expect(tasks.findTask(id)!.completedAt).toBeDefined();

    await expectExactlyOps(id, 1, async () =>
      (await drainWidgetIntents(queueOf(intent(id, false)), tasks)).applied,
    );
    expect(tasks.findTask(id)!.completedAt).toBeUndefined();
  });

  it('3 条意图 → 3 条 op（线性，不批量、也不重复）', async () => {
    const a = await tasks.create('A');
    const b = await tasks.create('B');
    const c = await tasks.create('C');

    const before = (await opCount(a)) + (await opCount(b)) + (await opCount(c));
    const result = await drainWidgetIntents(
      queueOf(intent(a, true), intent(b, true), intent(c, true)),
      tasks,
    );
    const after = (await opCount(a)) + (await opCount(b)) + (await opCount(c));

    expect(result.applied).toBe(3);
    expect(after - before).toBe(3);
  });
});

describe('drainWidgetIntents —— 跳过', () => {
  it('🔴 已在目标状态 → 0 条 op，且从 remaining 移除', async () => {
    const id = await tasks.create('写周报');
    await tasks.setCompleted(id, true);
    const completedAtBefore = tasks.findTask(id)!.completedAt;
    const opsBefore = await opCount(id);

    const result = await drainWidgetIntents(queueOf(intent(id, true)), tasks);

    expect(result.applied).toBe(0);
    expect(result.skippedAlreadyInTarget).toBe(1);
    expect((await opCount(id)) - opsBefore).toBe(0);
    // 必须移除：留着的话每次 drain 都会重新评估它、永远清不掉
    expect(result.remaining.intents).toEqual([]);

    // 🔴 完成时间**没有被改到现在** —— 这是"跳过"存在的全部理由。
    // 不跳的话，所有基于 `completedAt` 的口径（"今天完成了 3 件"）都会偏移。
    expect(tasks.findTask(id)!.completedAt).toBe(completedAtBefore);
  });

  it('任务不存在 → 0 条 op、不抛、且从 remaining 移除（不留毒丸）', async () => {
    const id = await tasks.create('会被删掉的任务');
    await tasks.remove(id); // 软删除 → findTask 返回 undefined

    const result = await drainWidgetIntents(queueOf(intent(id, true)), tasks);
    expect(result.applied).toBe(0);
    expect(result.skippedMissing).toBe(1);
    // 🔴 必须移除。留着的话每次 drain 都会重新评估它，永远清不掉。
    expect(result.remaining.intents).toEqual([]);
  });

  it('完全没创建过的 id 也一样（不认识的任务）', async () => {
    const result = await drainWidgetIntents(queueOf(intent('never-existed', true)), tasks);
    expect(result.applied).toBe(0);
    expect(result.skippedMissing).toBe(1);
    expect(result.remaining.intents).toEqual([]);
  });
});

describe('drainWidgetIntents —— 失败处理', () => {
  it('🔴 单条失败**不中断整批**，失败的那条留在队列里', async () => {
    const ok1 = await tasks.create('先点的');
    const boom = await tasks.create('这条会失败');
    const ok2 = await tasks.create('后点的');

    const flaky: WidgetDrainTasks = {
      findTask: (entityId) => tasks.findTask(entityId),
      setCompleted: async (entityId, completed) => {
        if (entityId === boom) throw new Error('库锁住了（模拟暂时性失败）');
        await tasks.setCompleted(entityId, completed);
      },
    };

    const result = await drainWidgetIntents(
      queueOf(intent(ok1, true), intent(boom, true), intent(ok2, true)),
      flaky,
    );

    // 前后两条都生效了 —— 一条坏意图没有拖垮整批
    expect(result.applied).toBe(2);
    expect(tasks.findTask(ok1)!.completedAt).toBeDefined();
    expect(tasks.findTask(ok2)!.completedAt).toBeDefined();
    // 失败的那条恰好留下，且保序
    expect(result.failed.map((i) => i.taskId)).toEqual([boom]);
    expect(result.remaining.intents.map((i) => i.taskId)).toEqual([boom]);
    // 失败的那条确实没有产生 op
    expect(await opCount(boom)).toBe(1); // 只有 create 那条
  });

  it('全部失败 → applied 0，队列原样留下（下次重试）', async () => {
    const id = await tasks.create('会失败');
    const alwaysFails: WidgetDrainTasks = {
      findTask: (entityId) => tasks.findTask(entityId),
      setCompleted: async () => {
        throw new Error('一直失败');
      },
    };

    const result = await drainWidgetIntents(queueOf(intent(id, true)), alwaysFails);
    expect(result.applied).toBe(0);
    expect(result.remaining.intents).toEqual([intent(id, true)]);
  });
});

describe('drainWidgetIntents —— 重复任务走既有语义', () => {
  it('🔴 完成重复任务 = 推进到期日，**不是**写 `completedAt`', async () => {
    // 2026-09-21 是周一
    const id = await tasks.create('每周一例会', { dueDate: localNoon('2026-09-21') });
    await tasks.setRepeat(id, 'FREQ=WEEKLY;BYDAY=MO');

    await expectExactlyOps(id, 1, async () =>
      (await drainWidgetIntents(queueOf(intent(id, true)), tasks)).applied,
    );

    const task = tasks.findTask(id)!;
    // 🔴 没有写 completedAt —— 写了的话它掉进"已完成"分组再也不出来
    expect(task.completedAt).toBeUndefined();
    // 而是推进到了下一个周一
    expect(toLocalDate(task.dueDate!)).toBe('2026-09-28');
  });

  it('这条路径证明组件**复用**了 `TaskActions`，而不是自己拼 op', async () => {
    // 如果 `drainWidgetIntents` 自己拼 `{ completedAt: now() }`，
    // 上面那条测试会红（重复任务的 completedAt 会被写上）。
    // 这条用一个"应该被推进"的日期再确认一次语义来源。
    const id = await tasks.create('每天复盘', { dueDate: localNoon('2026-09-27') });
    await tasks.setRepeat(id, 'FREQ=DAILY');

    await drainWidgetIntents(queueOf(intent(id, true)), tasks);
    const task = tasks.findTask(id)!;

    expect(task.completedAt).toBeUndefined();
    expect(toLocalDate(task.dueDate!)).toBe('2026-09-28');
  });
});

describe('drainWidgetIntents —— 端到端（与 W0-4 的折叠接起来）', () => {
  it('🔴 同一任务连点两次 → 队列只剩后一次 → **只产生 1 条 op**', async () => {
    // 这是 last-wins 折叠与"恰好一条 op"两条性质的**接缝**：
    // 折叠没生效的话这里会是 2 条 op（先完成后取消），用户看到的是"点了两下没反应"。
    const id = await tasks.create('写周报');

    // 用户先点"取消完成"（当时它确实未完成），又点"完成"
    const queue = queueOf(intent(id, false, 100), intent(id, true, 200));
    expect(queue.intents).toEqual([intent(id, true, 200)]);

    await expectExactlyOps(id, 1, async () =>
      (await drainWidgetIntents(queue, tasks)).applied,
    );
    expect(tasks.findTask(id)!.completedAt).toBeDefined();
  });

  it('🔴 连点两次且**最后一次是取消** → 0 条 op（折叠避免了一对无用 op）', async () => {
    const id = await tasks.create('写周报');
    // 未完成 → 点"完成" → 又点"取消完成"。最后的目标态 = 未完成 = 当前态。
    const queue = queueOf(intent(id, true, 100), intent(id, false, 200));

    await expectExactlyOps(id, 0, async () =>
      (await drainWidgetIntents(queue, tasks)).applied,
    );
    // 没有产生任何 op —— 而不是"完成 + 取消"那两条
    expect(tasks.findTask(id)!.completedAt).toBeUndefined();
  });

  it('混合队列：该执行的执行、该跳的跳，且 remaining 为空', async () => {
    const todo = await tasks.create('待办');
    const already = await tasks.create('已经完成');
    await tasks.setCompleted(already, true);

    const result = await drainWidgetIntents(
      queueOf(intent(todo, true), intent(already, true), intent('ghost', true)),
      tasks,
    );

    expect(result).toMatchObject({ applied: 1, skippedAlreadyInTarget: 1, skippedMissing: 1 });
    expect(result.failed).toEqual([]);
    expect(result.remaining.intents).toEqual([]);
  });
});
