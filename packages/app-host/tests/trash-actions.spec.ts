/**
 * 回收站动作的跨设备测试
 * ==========================
 *
 * 🔴 **这个文件守的是本工单最关键的判据：恢复必须跨设备成立。**
 *
 * 形状是"两个真引擎 + 两个真 SQLite"（都是 `:memory:`，各自一份库）：
 *
 *   A：create → remove → restore   （全部通过 `createTaskActions` 的真实实现）
 *   B：把 A 产出的**全部 op** 原样 `applyRemote` 回放
 *   → 断言 B 那边条目回来了、墓碑没了、原字段一个不少
 *
 * 为什么不能用假 dispatch 探针：探针只能证明"我调了 dispatch"，
 * 它证明不了"另一端回放同一串 op 之后看到的是同一个世界"。而这一条恰恰是
 * 本工单要修的那个 bug 的本质（本地看着好了、另一台设备还当它已删）。
 *
 * ⚠️ **变异验证**（报告里贴了真实输出）：把 `restore()` 退化成"只改本地
 * 物化状态、不发 op"，下面的跨设备断言会红 —— 因为 B 那串 op 里根本没有
 * 恢复那一条。这正是"本地生效但没同步"的形状。
 */

import { Priority } from '@heyta/domain';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType, type Operation } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTaskActions, type TaskActions } from '../src/actions.js';

let adapterA: SqliteAdapter;
let adapterB: SqliteAdapter;
let engineA: OpLogEngine;
let engineB: OpLogEngine;
let actionsA: TaskActions;
let actionsB: TaskActions;

/** 可控时钟：`deletedAt` / `purgedAt` 都写进载荷，断言必须精确，不能靠容差。 */
let clock = 1_700_000_000_000;
const now = (): number => clock;
const advance = (ms = 1000): void => {
  clock += ms;
};

let idSeq = 0;
const makeId = (): string => {
  idSeq += 1;
  return `task-t-${String(idSeq).padStart(3, '0')}`;
};

function newAdapter(): SqliteAdapter {
  return new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
}

function payloadOf(op: Operation<string>): Record<string, unknown> {
  return op.payload as Record<string, unknown>;
}

beforeEach(async () => {
  adapterA = newAdapter();
  adapterB = newAdapter();
  await adapterA.init();
  await adapterB.init();

  engineA = new OpLogEngine({
    store: new DbOpLogStore<Operation<string>>(adapterA),
    clientId: 'client-a',
    now,
  });
  engineB = new OpLogEngine({
    store: new DbOpLogStore<Operation<string>>(adapterB),
    clientId: 'client-b',
    now,
  });

  clock = 1_700_000_000_000;
  idSeq = 0;
  // 两边用**同一份动作实现** —— 跨设备分歧最容易出在"两台各写一份"。
  actionsA = createTaskActions(engineA, { now, newTaskId: makeId });
  actionsB = createTaskActions(engineB, { now, newTaskId: makeId });
});

afterEach(() => {
  adapterA.close();
  adapterB.close();
});

/** 把 A 上某个实体的全部 op 原样送到 B（等价于服务端转发）。 */
async function shipToB(entityId: string): Promise<Operation<string>[]> {
  const ops = await engineA.getOpsForEntity('TASK', entityId);
  await engineB.applyRemote(ops);
  return ops;
}

describe('回收站：恢复可跨设备', () => {
  it('🔴 A 删除 → 恢复；B 回放同一串 op 后条目回来、墓碑消失、原字段全在', async () => {
    const dueDate = clock + 86_400_000;
    const id = await actionsA.create('写文档', {
      note: '记得带伞',
      dueDate,
      priority: Priority.High,
      important: true,
    });
    await actionsA.remove(id);

    // A 侧此刻确实是墓碑
    expect(engineA.getState().tasks[id]!.deletedAt).toBeTypeOf('number');
    expect(actionsA.listTrashed().map((t) => t.id)).toEqual([id]);

    await actionsA.restore(id);

    // A 侧：墓碑没了
    expect(engineA.getState().tasks[id]!.deletedAt).toBeUndefined();

    const ops = await shipToB(id);

    // 恢复是**一条普通 UPD**，载荷用 `null` 表达"清除 deletedAt" —— 不 bump schema、
    // 不动 reducer、老客户端回放得到逐字相同的结果。
    expect(ops).toHaveLength(3); // CRT + DEL + UPD，一个用户意图恰好一条 op
    const restoreOp = ops[2]!;
    expect(restoreOp.opType).toBe(OpType.Update);
    expect(payloadOf(restoreOp)).toEqual({ deletedAt: null });

    // 🔴 本工单最关键的三条断言：B 那边条目回来了、墓碑没了、原字段一个不少。
    const onB = engineB.getState().tasks[id]!;
    expect(onB.deletedAt).toBeUndefined();
    expect(onB.title).toBe('写文档');
    expect(onB.note).toBe('记得带伞');
    expect(onB.dueDate).toBe(dueDate);
    expect(onB.priority).toBe(Priority.High);
    expect(onB.important).toBe(true);
  });

  it('回放是幂等的：同一串 op 再送一次，B 的状态不变，且不会产生新的本地 op', async () => {
    const id = await actionsA.create('任务');
    await actionsA.remove(id);
    await actionsA.restore(id);

    const ops = await shipToB(id);
    const before = engineB.getState();

    const again = await engineB.applyRemote(ops);

    // 全部被当作"已见过"跳过
    expect(again.applied).toHaveLength(0);
    expect(again.skipped).toBe(ops.length);
    // 状态逐字段相同（用同一个对象引用表达"没有发生任何变更"）
    expect(engineB.getState().tasks[id]).toBe(before.tasks[id]);

    /**
     * 🔴 副作用闸门：回放的 op **不得**再次触发写入。
     * 远端 op 只应落进日志（`source: 'remote'`），永远不进上传队列 ——
     * 否则会出现"同步回来又传一遍"的双向灾难（AGENTS.md §3.4）。
     */
    expect(await engineB.getPendingUpload()).toHaveLength(0);
  });

  it('listTrashed 只列已删除未彻底删除的条目；恢复后立刻移出回收站', async () => {
    const first = await actionsA.create('第一条');
    advance();
    const second = await actionsA.create('第二条');
    advance();
    await actionsA.remove(first);
    advance();
    await actionsA.remove(second);

    // 最近删除的在前
    expect(actionsA.listTrashed().map((t) => t.id)).toEqual([second, first]);

    await actionsA.restore(first);
    expect(actionsA.listTrashed().map((t) => t.id)).toEqual([second]);
  });

  it('对活着的任务调 restore 不产生 op，并返回 false（G-8 的布尔出口）', async () => {
    const id = await actionsA.create('任务');
    const before = (await engineA.getOpsForEntity('TASK', id)).length;

    expect(
      await actionsA.restore(id),
      '一条本来就在回收站外的任务被返回 true ⇒ 宿主会说"已还原"（G-8 登记的正是这一格）',
    ).toBe(false);

    expect((await engineA.getOpsForEntity('TASK', id)).length).toBe(before);
  });

  it('真的还原一次返回 true（上面那条 false 的阳性对照）', async () => {
    const id = await actionsA.create('任务');
    await actionsA.remove(id);
    expect(await actionsA.restore(id), '还原确实写了 op 却返回 false').toBe(true);
  });
});

describe('回收站：彻底删除可跨设备且不可恢复', () => {
  it('🔴 A 彻底删除；B 回放后拿到 purgedAt，墓碑仍在，且恢复被拒绝', async () => {
    const id = await actionsA.create('旧任务');
    advance();
    await actionsA.remove(id);
    advance();
    await actionsA.purge(id);

    // 回收站里不再是它
    expect(actionsA.listTrashed().some((t) => t.id === id)).toBe(false);

    const ops = await shipToB(id);
    const purgeOp = ops[2]!;
    expect(purgeOp.opType).toBe(OpType.Update);
    expect(payloadOf(purgeOp)).toEqual({ purgedAt: clock });

    const onB = engineB.getState().tasks[id]!;
    expect(onB.purgedAt).toBeTypeOf('number');
    /**
     * 🔴 墓碑**必须还在**：清掉 `deletedAt` 会让离线端把这条旧数据当成
     * "从未删除"又同步回来 —— 那正是"彻底删除反而复活"的形状。
     */
    expect(onB.deletedAt).toBeTypeOf('number');
    expect(engineB.getState().tasks[id]!.purgedAt).toBe(clock);

    // 不可逆：两边的 restore 都拒绝
    await expect(actionsA.restore(id)).rejects.toThrow('已被彻底删除');
    await expect(actionsB.restore(id)).rejects.toThrow('已被彻底删除');
  });

  it('purge 幂等：重复调用不再发 op，第二句返回 false（G-8）', async () => {
    const id = await actionsA.create('任务');
    await actionsA.remove(id);
    expect(await actionsA.purge(id), '真的打上了标记却返回 false').toBe(true);
    const count = (await engineA.getOpsForEntity('TASK', id)).length;

    expect(
      await actionsA.purge(id),
      '早已彻底删除却返回 true ⇒ CLI 会把什么都没写成的一句印成"已彻底删除"',
    ).toBe(false);

    expect((await engineA.getOpsForEntity('TASK', id)).length).toBe(count);
  });

  it('对不在回收站里的任务调 purge 会抛错（否则它会无墓碑地消失）', async () => {
    const id = await actionsA.create('活着的任务');
    await expect(actionsA.purge(id)).rejects.toThrow('不在回收站里');
  });
});
