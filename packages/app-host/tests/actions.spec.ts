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

import { Priority, Quadrant, isImportant, planQuadrantDrop, planQuadrantDropUndo, startOfDay } from '@heyta/domain';
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

describe('批量任务动作', () => {
  it('批量完成只写一条 BATCH op，并物化到全部任务', async () => {
    const a = await actions.create('A');
    const b = await actions.create('B');
    await actions.bulkSetCompleted([a, b], true);
    const opsA = await opsOf(a);
    expect(opsA.at(-1)?.opType).toBe(OpType.Batch);
    expect(opsA.at(-1)?.entityIds).toEqual([b]);
    expect(actions.findTask(a)?.completedAt).toBe(clock);
    expect(actions.findTask(b)?.completedAt).toBe(clock);
  });

  it('批量删除可由一个反向批量更新恢复', async () => {
    const a = await actions.create('A');
    const b = await actions.create('B');
    await actions.bulkRemove([a, b]);
    expect(actions.findTask(a)).toBeUndefined();
    expect(actions.findTask(b)).toBeUndefined();
    await actions.bulkRestore([a, b]);
    expect(actions.findTask(a)?.deletedAt).toBeUndefined();
    expect(actions.findTask(b)?.deletedAt).toBeUndefined();
  });

  it('重复任务拒绝批量完成，避免跳过重复规则语义', async () => {
    const id = await actions.create('每周复盘');
    await actions.setRepeat(id, 'FREQ=WEEKLY');
    await expect(actions.bulkSetCompleted([id], true)).rejects.toThrow('重复任务请逐条完成');
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

describe('listPendingTasks（未完成）', () => {
  it('只给未完成的，且 listTasks 仍然给全部（两件事不能混）', async () => {
    const a = await actions.create('A');
    clock += 1000;
    const b = await actions.create('B');
    clock += 1000;
    const c = await actions.create('C');

    await actions.setCompleted(b, true);

    expect(actions.listPendingTasks().map((x) => x.id)).toEqual([a, c]);
    expect(actions.listTasks().map((x) => x.id)).toEqual([a, b, c]);
  });

  it('顺序与 listTasks 用同一条规则（createdAt 升序、同刻按 id）', async () => {
    idPrefix = 'task-z';
    const a = await actions.create('A');
    idPrefix = 'task-a';
    const b = await actions.create('B');
    // createdAt 相同 → 按 id 升序，与创建先后无关
    expect(actions.listPendingTasks().map((x) => x.id)).toEqual([b, a]);
  });

  it('全部完成时是空数组，不是 undefined', async () => {
    const a = await actions.create('A');
    await actions.setCompleted(a, true);
    expect(actions.listPendingTasks()).toEqual([]);
  });

  it('已删除的不算待办', async () => {
    const a = await actions.create('A');
    await actions.remove(a);
    expect(actions.listPendingTasks()).toEqual([]);
  });

  it('🔴 取消完成后会重新出现（不是单向过滤）', async () => {
    const a = await actions.create('A');
    await actions.setCompleted(a, true);
    expect(actions.listPendingTasks()).toHaveLength(0);
    await actions.setCompleted(a, false);
    expect(actions.listPendingTasks().map((x) => x.id)).toEqual([a]);
  });
});

describe('四象限移动撤销', () => {
  it.each([undefined, false, true])('保留 important=%s 的原始语义，移动和撤销各写一条 op', async (important) => {
    const id = await actions.create('优先级驱动的重要任务');
    await actions.setPriority(id, Priority.High);
    await actions.setDueDate(id, now() + 60_000);
    if (important !== undefined) await actions.setImportant(id, important);
    const before = actions.findTask(id)!;
    const drop = planQuadrantDrop(before, Quadrant.Neither, { now: now() });
    const undo = planQuadrantDropUndo(before, drop);
    const beforeCount = (await opsOf(id)).length;
    await actions.setQuadrantDrop(id, drop);
    expect(actions.findTask(id)!.dueDate).toBeUndefined();
    await actions.setQuadrantDrop(id, undo);
    const ops = await opsOf(id);
    expect(ops.length).toBe(beforeCount + 2);
    expect(JSON.parse(JSON.stringify(ops.at(-1)!.payload))).toEqual({
      important: important ?? null,
      dueDate: before.dueDate,
    });
    await engine.recover();
    expect(actions.findTask(id)!.important).toBe(important);
    expect(actions.findTask(id)!.dueDate).toBe(before.dueDate);
    // 撤销后再改优先级：隐式重要性仍跟随优先级，显式选择保持不变。
    await actions.setPriority(id, Priority.Low);
    expect(isImportant(actions.findTask(id)!)).toBe(important ?? false);
  });

  it('移动未改截止时间时，撤销不会覆盖之后的日期编辑', async () => {
    const id = await actions.create('无日期任务');
    const before = actions.findTask(id)!;
    const drop = planQuadrantDrop(before, Quadrant.ImportantNotUrgent, { now: now() });
    const undo = planQuadrantDropUndo(before, drop);
    expect(undo).not.toHaveProperty('dueDate');
    await actions.setQuadrantDrop(id, drop);
    await actions.setDueDate(id, now() + 60_000);
    await actions.setQuadrantDrop(id, undo);
    expect(actions.findTask(id)!.dueDate).toBe(now() + 60_000);
    expect(actions.findTask(id)!.important).toBeUndefined();
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

describe('bulkSetPriorities', () => {
  it('不同优先级一次写一条 BATCH op，并物化到每条任务', async () => {
    const low = await actions.create('低优先级');
    const high = await actions.create('高优先级');
    const before = await engine.getAllOps();

    await actions.bulkSetPriorities([
      { id: low, priority: Priority.Low },
      { id: high, priority: Priority.High },
    ]);

    const after = await engine.getAllOps();
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)?.opType).toBe(OpType.Batch);
    expect(after.at(-1)?.entityIds).toEqual([high]);
    expect(payloadOf(after.at(-1)!)).toEqual({
      heytaTaskPriorityBatch: 1,
      items: [
        { id: low, priority: Priority.Low },
        { id: high, priority: Priority.High },
      ],
    });
    expect(actions.findTask(low)?.priority).toBe(Priority.Low);
    expect(actions.findTask(high)?.priority).toBe(Priority.High);
  });

  it('全量预校验失败时不写任何任务', async () => {
    const first = await actions.create('第一条');
    const before = await engine.getAllOps();
    await expect(
      actions.bulkSetPriorities([
        { id: first, priority: Priority.High },
        { id: 'missing-task', priority: Priority.Low },
      ]),
    ).rejects.toThrow('找不到任务');
    expect(await engine.getAllOps()).toHaveLength(before.length);
    expect(actions.findTask(first)?.priority).toBe(Priority.None);
  });

  it('重复 id 与非法优先级在 dispatch 前拒绝', async () => {
    const id = await actions.create('任务');
    const before = await engine.getAllOps();
    await expect(
      actions.bulkSetPriorities([
        { id, priority: Priority.High },
        { id, priority: Priority.Low },
      ]),
    ).rejects.toThrow('重复');
    await expect(
      actions.bulkSetPriorities([{ id, priority: 99 as Priority }]),
    ).rejects.toThrow('优先级无效');
    expect(await engine.getAllOps()).toHaveLength(before.length);
  });
});

/**
 * `setNote` —— 备注的写入路径
 *
 * 🔴 **为什么单开一节。** 在它存在之前，`note` 只能通过 `create` 写一次，
 * 于是所有"事后生成内容"的功能（AI 拆解出的清单、模板、导入的笔记）
 * **都没有落点**。这是一个"缺一个动作"的洞，不是"少一个字段"。
 *
 * ⚠️ 字段名必须是 `note`（单数）。历史上写成 `notes` 时，
 * 数据同步到了每一台设备，而**没有任何视图读得到它** ——
 * 载荷键与实体字段对不上，静默失效。所以下面的断言**读的是 `Task.note`**，
 * 而不是"载荷里有 note 这个键"。
 */
describe('setNote', () => {
  it('🔴 备注真的落到 `Task.note`（不是载荷里有个 note 键就算数）', async () => {
    const id = await actions.create('写文档');
    await actions.setNote(id, '第一行\n第二行');

    const task = actions.findTask(id);
    expect(task?.note).toBe('第一行\n第二行');
    // 反向确认没有写出一个叫 notes 的幽灵字段
    expect((task as Record<string, unknown> | undefined)?.['notes']).toBeUndefined();
  });

  it('🔴 传 undefined 表示清除，且清除要能穿过 JSON', async () => {
    const id = await actions.create('写文档', { note: '原来的' });
    expect(actions.findTask(id)?.note).toBe('原来的');

    await actions.setNote(id, undefined);
    // 关键：清除之后读回来必须是 undefined，而不是 "null" 或空串
    expect(actions.findTask(id)?.note).toBeUndefined();

    // 载荷里写的是 null（undefined 会被 JSON 丢掉，见文件头第 2 条）
    const ops = await opsOf(id);
    const last = ops[ops.length - 1];
    expect(payloadOf(last!)['note']).toBeNull();
  });

  it('空字符串是一个合法的备注（区别于"清除"）', async () => {
    const id = await actions.create('x', { note: '有内容' });
    await actions.setNote(id, '');
    expect(actions.findTask(id)?.note).toBe('');
  });

  it('产出一条 UPD op，不是 CRT', async () => {
    const id = await actions.create('x');
    await actions.setNote(id, 'y');
    const ops = await opsOf(id);
    expect(ops.filter((o) => o.opType === OpType.Update)).toHaveLength(1);
  });

  it('🔴 覆盖已有备注时是替换，不是追加（合并逻辑在调用方，不在这里）', async () => {
    const id = await actions.create('x', { note: '旧的' });
    await actions.setNote(id, '新的');
    expect(actions.findTask(id)?.note).toBe('新的');
  });
});

describe('postponeToToday（分组「顺延」的写路径）', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const NINE_AM = 9 * 60 * 60 * 1000;

  it('🔴 逾期任务推到**今天**且**保留时刻**：昨天 09:00 → 今天 09:00', async () => {
    const id = await actions.create('逾期的');
    // 昨天 09:00（相对可控时钟的"今天"零点）。
    const yesterdayNine = startOfDay(clock) - DAY + NINE_AM;
    await actions.setDueDate(id, yesterdayNine);

    await actions.postponeToToday(id);

    const task = actions.findTask(id);
    expect(task?.dueDate).toBe(startOfDay(clock) + NINE_AM);
    const ops = await opsOf(id);
    const last = ops[ops.length - 1]!;
    expect(payloadOf(last)['dueDate']).toBe(startOfDay(clock) + NINE_AM);
  });

  it('🔴 幂等边界不产生 op：已完成 / 无截止 / 今天到期 / 未来 —— 一条都不写', async () => {
    const done = await actions.create('已完成');
    await actions.setDueDate(done, startOfDay(clock) - DAY);
    await actions.setCompleted(done, true);
    const doneOps = (await opsOf(done)).length;

    const undated = await actions.create('没日期');
    const undatedOps = (await opsOf(undated)).length;

    const todayTask = await actions.create('今天到期');
    await actions.setDueDate(todayTask, startOfDay(clock) + NINE_AM);
    const todayOps = (await opsOf(todayTask)).length;

    const future = await actions.create('未来');
    await actions.setDueDate(future, startOfDay(clock) + 3 * DAY);
    const futureOps = (await opsOf(future)).length;

    await actions.postponeToToday(done);
    await actions.postponeToToday(undated);
    await actions.postponeToToday(todayTask);
    await actions.postponeToToday(future);

    expect((await opsOf(done)).length).toBe(doneOps);
    expect((await opsOf(undated)).length).toBe(undatedOps);
    expect((await opsOf(todayTask)).length).toBe(todayOps);
    expect((await opsOf(future)).length).toBe(futureOps);
  });

  it('任务不存在时 throw（界面接住显示，动作层不吞）', async () => {
    await expect(actions.postponeToToday('no-such-task')).rejects.toThrow(/找不到任务/);
  });
});
