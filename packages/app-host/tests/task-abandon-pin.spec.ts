/**
 * 第五态「放弃」与置顶（ADR-0083 / ADR-0048 I5）
 * ==============================================
 *
 * 这一族盯的是**四类静默失效**，它们全都不会报错：
 *
 *   1. 清除写成 `undefined` → JSON 丢掉 → 对端永远清不掉（`null` 才是"显式清除"）；
 *   2. 放弃顺手写了 `completedAt` → 它凭空进完成率，还会被"完成即推进"顺移；
 *   3. 隐藏留在调用方 → 同一份数据两端不同答案（ADR-0048 的 I5）；
 *   4. 幂等边界没做 → 连点两下往 op-log 灌两条什么都没改的噪音。
 */

import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import type { Operation } from '@heyta/sync-core';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTaskActions, type TaskActions } from '../src/actions.js';

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let actions: TaskActions;
let clock = 1_700_000_000_000;
const now = (): number => clock;

let idSeq = 0;
const makeId = (): string => {
  idSeq += 1;
  return `pin-t-${String(idSeq).padStart(3, '0')}`;
};

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
  clock = 1_700_000_000_000;
  idSeq = 0;
  actions = createTaskActions(engine, { now, newTaskId: makeId });
});

function payloadOf(op: Operation<string>): Record<string, unknown> {
  return op.payload as Record<string, unknown>;
}

async function opsOf(entityId: string): Promise<Operation<string>[]> {
  return engine.getOpsForEntity('TASK', entityId);
}

describe('置顶 Task.pinnedAt', () => {
  it('写一条 UPD，载荷是时刻', async () => {
    const id = await actions.create('钉住这条');
    clock += 1_000;
    await actions.setPinned(id, true);

    const ops = await opsOf(id);
    expect(ops).toHaveLength(2);
    expect(payloadOf(ops[1]!).pinnedAt).toBe(clock);
    expect(actions.listTasks().find((t) => t.id === id)?.pinnedAt).toBe(clock);
  });

  it('取消置顶写 `null`，读回来是 `undefined`（不是 null）', async () => {
    // 🔴 这一条是 §3.3 那个hydration 陷阱的正面对策：reducer 把 `null` 定义成
    // "显式删除该字段"，所以**声明成 `number | null` 会是一个类型谎言**。
    const id = await actions.create('先钉后撤');
    await actions.setPinned(id, true);
    await actions.setPinned(id, false);

    const ops = await opsOf(id);
    expect(payloadOf(ops[2]!).pinnedAt).toBeNull();
    expect(actions.listTasks().find((t) => t.id === id)?.pinnedAt).toBeUndefined();
  });

  it('幂等：已经是那个状态就不再写 op', async () => {
    const id = await actions.create('连点两下');
    await actions.setPinned(id, true);
    await actions.setPinned(id, true);
    expect(await opsOf(id)).toHaveLength(2); // CRT + 一条 UPD
  });

  it('置顶只改**组内顺序**，未置顶的仍按创建序', async () => {
    const a = await actions.create('a');
    const b = await actions.create('b');
    const c = await actions.create('c');
    await actions.setPinned(c, true);
    await actions.setPinned(b, true);

    // ⚠️ 两条都置顶时**不比时刻**（否则变成"后钉的压过先钉的"那种 LIFO 栈），
    // 所以这里落到次级判据 = 创建序 ⇒ b 在 c 前。
    expect(actions.listTasks().map((t) => t.id)).toEqual([b, c, a]);
  });

  it('任务不存在时抛错而不是静默返回', async () => {
    await expect(actions.setPinned('nope', true)).rejects.toThrow('找不到任务');
  });
});

describe('放弃 Task.abandonedAt（第五态）', () => {
  it('放弃**不碰** completedAt —— 它不进完成率', async () => {
    const id = await actions.create('不想做了');
    await actions.setAbandoned(id, true);

    const task = actions.listAbandonedTasks().find((t) => t.id === id);
    expect(task?.abandonedAt).toBe(clock);
    expect(task?.completedAt).toBeUndefined();
  });

  it('默认出口不含它，`listAbandonedTasks()` 只含它', async () => {
    const kept = await actions.create('还在做');
    const dropped = await actions.create('放弃了');
    await actions.setAbandoned(dropped, true);

    expect(actions.listTasks().map((t) => t.id)).toEqual([kept]);
    expect(actions.listAbandonedTasks().map((t) => t.id)).toEqual([dropped]);
    // 待办数也不能算它，否则"清空待办"永远清不干净。
    expect(actions.listPendingTasks().map((t) => t.id)).toEqual([kept]);
  });

  it('恢复回到默认出口，且**不经过回收站**', async () => {
    const id = await actions.create('放弃了又回来');
    await actions.setAbandoned(id, true);
    await actions.setAbandoned(id, false);

    expect(actions.listTasks().map((t) => t.id)).toEqual([id]);
    expect(actions.listAbandonedTasks()).toHaveLength(0);
    expect(actions.listTrashed().map((t) => t.id)).not.toContain(id);
  });

  it('已放弃 + 已删除 → 两个出口都不含（未删除判据在前）', async () => {
    const id = await actions.create('放弃了又被删');
    await actions.setAbandoned(id, true);
    await actions.remove(id);

    expect(actions.listAbandonedTasks().map((t) => t.id)).not.toContain(id);
    expect(actions.listTrashed().map((t) => t.id)).toContain(id);
  });

  it('幂等：重复放弃不写第二条', async () => {
    const id = await actions.create('连点两下放弃');
    await actions.setAbandoned(id, true);
    await actions.setAbandoned(id, true);
    expect(await opsOf(id)).toHaveLength(2);
  });

  it('放弃一条**已完成**的任务，不会把完成态撤掉', async () => {
    const id = await actions.create('做完了又不想留');
    await actions.setCompleted(id, true);
    await actions.setAbandoned(id, true);

    const [abandoned] = actions.listAbandonedTasks();
    expect(abandoned?.completedAt).toBeDefined();
  });
});
