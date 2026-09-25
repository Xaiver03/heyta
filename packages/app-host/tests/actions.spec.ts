/**
 * 任务动作层的测试
 * ==================
 *
 * 用**真实引擎 + 真实 SQLite**（`:memory:`），不是假的 dispatch 探针。
 * 理由：这些测试要证明的是"动作确实产出了一种可同步的 op"，
 * 而假探针只能证明"我调了 dispatch"—— 它对 op 的**形状**一无所知。
 *
 * 重点盯三类静默失效：
 *   1. 清除类字段写成 `undefined` → 被 JSON 丢掉 → 对端静默不清除
 *   2. 完成态用两个字段表示 → 迟早不一致
 *   3. 列表顺序依赖存储返回顺序 → 同一份数据在两台设备上顺序不同
 */

import { Priority } from '@heyta/domain';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType, type Operation } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTaskActions, type TaskActions } from '../src/actions.js';

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let actions: TaskActions;
/**
 * 可控时钟。**引擎与动作层共用同一个源** —— 因为 `createdAt` 来自
 * `op.timestamp`（引擎时钟），而 `completedAt` 来自动作层时钟。
 * 两个时钟若不一致，测试里"完成时间早于创建时间"这类断言就成了噪声。
 */
let clock = 1_700_000_000_000;
const now = (): number => clock;

/**
 * 可控 id 生成器。
 *
 * **必须可控**：列表按 (createdAt, id) 排序，随机 id 会让顺序断言随机变红。
 * 这里给可预测的序列，让"排序是否真的生效"成为确定性断言。
 */
let idSeq = 0;
let idPrefix = 'task-t';
const makeId = (): string => {
  idSeq += 1;
  return `${idPrefix}-${String(idSeq).padStart(3, '0')}`;
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
    // 固定时间源与 op 序号，让断言不依赖真实时钟。
    now,
  });
  clock = 1_700_000_000_000;
  idSeq = 0;
  idPrefix = 'task-t';
  // 注入可控时钟：`completedAt` / `createdAt` 的断言必须精确，不能靠容差。
  actions = createTaskActions(engine, { now, newTaskId: makeId });
});

afterEach(() => {
  adapter.close();
});

/**
 * 收窄 `op.payload`。
 *
 * `Operation['payload']` 是 `unknown` —— 这是对的（线协议不校验实体成员，
 * 见 AGENTS.md §7 第 2 条）。测试里断言具体字段，所以在这里显式收窄，
 * 而不是到处写 `as any`（那会让拼错字段名也不报错）。
 */
function payloadOf(op: Operation<string>): Record<string, unknown> {
  return op.payload as Record<string, unknown>;
}

/** 把某个实体的全部 op 取出来（按 seq）。 */
async function opsOf(entityId: string): Promise<Operation<string>[]> {
  return engine.getOpsForEntity('TASK', entityId);
}

describe('create', () => {
  it('产出一条 CRT op，载荷含 title 与默认 priority', async () => {
    const id = await actions.create('写文档');
    const ops = await opsOf(id);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.opType).toBe(OpType.Create);
    expect(ops[0]!.entityType).toBe('TASK');
    expect(payloadOf(ops[0]!)).toEqual({ title: '写文档', priority: Priority.None });
  });

  it('over 参数会覆盖默认字段', async () => {
    const id = await actions.create('写文档', { priority: Priority.High, important: true });
    const ops = await opsOf(id);
    expect(payloadOf(ops[0]!)).toEqual({
      title: '写文档',
      priority: Priority.High,
      important: true,
    });
  });

  it('标题两端空白会被去掉', async () => {
    const id = await actions.create('  写文档  ');
    expect(payloadOf((await opsOf(id))[0]!)['title']).toBe('写文档');
  });

  it('空标题抛错，**不静默返回**（调用方会以为建成功了）', async () => {
    await expect(actions.create('   ')).rejects.toThrow('任务标题不能为空');
  });

  it('两次 create 产出不同的 entityId（用真实 id 生成器）', async () => {
    // 这条专门用真实 id 生成器，否则上面注入的可预测 id 会让它变成恒真。
    const real = createTaskActions(engine);
    const a = await real.create('A');
    const b = await real.create('B');
    expect(a).not.toBe(b);
  });
});

describe('完成态', () => {
  it('setCompleted(true) 写一个数字 completedAt', async () => {
    const id = await actions.create('A');
    await actions.setCompleted(id, true);
    expect(actions.findTask(id)!.completedAt).toBe(1_700_000_000_000);
  });

  it('🔴 setCompleted(false) 必须写 **null**，不能是 undefined', async () => {
    const id = await actions.create('A');
    await actions.setCompleted(id, true);
    await actions.setCompleted(id, false);

    const ops = await opsOf(id);
    const last = ops[ops.length - 1]!;
    // 键必须**存在**且为 null —— undefined 会被 JSON.stringify 丢掉，
    // 于是对端收到的载荷里根本没有这个键，既不清除也不设置 → 静默失效。
    const pl = payloadOf(last);
    expect(Object.prototype.hasOwnProperty.call(pl, 'completedAt')).toBe(true);
    expect(pl['completedAt']).toBeNull();
    // 而且必须真的能穿过 JSON（这正是问题所在）
    expect(JSON.parse(JSON.stringify(pl))).toHaveProperty('completedAt', null);

    expect(actions.findTask(id)!.completedAt).toBeUndefined();
  });

  it('toggleCompleted 在两种状态间来回切换（不是单向）', async () => {
    const id = await actions.create('A');
    expect(actions.findTask(id)!.completedAt).toBeUndefined();

    await actions.toggleCompleted(id);
    expect(actions.findTask(id)!.completedAt).toBe(1_700_000_000_000);

    await actions.toggleCompleted(id);
    expect(actions.findTask(id)!.completedAt).toBeUndefined();

    await actions.toggleCompleted(id);
    expect(actions.findTask(id)!.completedAt).toBe(1_700_000_000_000);
  });

  it('对不存在的任务操作会抛错，不静默 no-op', async () => {
    await expect(actions.setCompleted('task-不存在', true)).rejects.toThrow();
    await expect(actions.toggleCompleted('task-不存在')).rejects.toThrow();
    await expect(actions.rename('task-不存在', 'x')).rejects.toThrow();
  });
});

describe('清除类字段（null 语义）', () => {
  it('🔴 setDueDate(undefined) 写 null 而不是漏掉键', async () => {
    const id = await actions.create('A');
    await actions.setDueDate(id, 1_800_000_000_000);
    await actions.setDueDate(id, undefined);

    const ops = await opsOf(id);
    const last = ops[ops.length - 1]!;
    const pl = payloadOf(last);
    expect(Object.prototype.hasOwnProperty.call(pl, 'dueDate')).toBe(true);
    expect(pl['dueDate']).toBeNull();
  });

  it('🔴 moveToProject(undefined) 写 null 而不是漏掉键', async () => {
    const id = await actions.create('A');
    await actions.moveToProject(id, 'proj-1');
    await actions.moveToProject(id, undefined);

    const ops = await opsOf(id);
    const last = ops[ops.length - 1]!;
    const pl = payloadOf(last);
    expect(Object.prototype.hasOwnProperty.call(pl, 'projectId')).toBe(true);
    expect(pl['projectId']).toBeNull();
  });
});

describe('软删除', () => {
  it('remove 发 DEL op，且任务从列表中消失', async () => {
    const id = await actions.create('A');
    await actions.remove(id);

    const ops = await opsOf(id);
    expect(ops[ops.length - 1]!.opType).toBe(OpType.Delete);

    expect(actions.findTask(id)).toBeUndefined();
    expect(actions.listTasks().map((t) => t.id)).not.toContain(id);
  });

  it('删除后不能改名（已删除的任务不是可编辑对象）', async () => {
    const id = await actions.create('A');
    await actions.remove(id);
    await expect(actions.rename(id, 'B')).rejects.toThrow();
  });
});

describe('listTasks 的顺序', () => {
  it('按 createdAt 升序（而不是存储返回顺序）', async () => {
    const a = await actions.create('A');
    clock += 1000;
    const b = await actions.create('B');
    clock += 1000;
    const c = await actions.create('C');

    const listed = actions.listTasks().map((x) => x.id);
    expect(listed).toEqual([a, b, c]);
    // 而且必须真的是靠 createdAt 排的
    const times = actions.listTasks().map((x) => x.createdAt);
    expect(times).toEqual([...times].sort((x, y) => x - y));
  });

  it('🔴 同一 createdAt 时按 id 字典序 —— 且**不依赖建任务的先后**', async () => {
    // 时钟不推进：三条任务的 createdAt 完全相同。
    // id 用**逆序**前缀，这样"按 id 排"与"按创建先后排"必然不同 ——
    // 若实现退化成一个不排序的返回，这条会确定性地红（而不是 1/6 概率）。
    idPrefix = 'task-z';
    const a = await actions.create('A'); // task-z-001
    idPrefix = 'task-m';
    const b = await actions.create('B'); // task-m-002
    idPrefix = 'task-a';
    const c = await actions.create('C'); // task-a-003

    const listed = actions.listTasks().map((x) => x.id);
    expect(listed).toEqual([c, b, a]); // 按 id 升序，而不是创建顺序 [a, b, c]
    expect(listed).not.toEqual([a, b, c]);
  });

  it('已删除的不出现在列表里', async () => {
    const a = await actions.create('A');
    await actions.create('B');
    await actions.remove(a);
    expect(actions.listTasks()).toHaveLength(1);
  });
});

describe('其余字段', () => {
  it('rename / setPriority / setImportant 各产出一条 UPD op', async () => {
    const id = await actions.create('A');
    await actions.rename(id, 'B');
    await actions.setPriority(id, Priority.Medium);
    await actions.setImportant(id, true);

    const ops = await opsOf(id);
    const upd = ops.filter((o) => o.opType === OpType.Update);
    expect(upd.map((o) => Object.keys(payloadOf(o))[0])).toEqual([
      'title',
      'priority',
      'important',
    ]);

    const task = actions.findTask(id)!;
    expect(task.title).toBe('B');
    expect(task.priority).toBe(Priority.Medium);
  });
});
