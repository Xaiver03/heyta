/**
 * 清单 / 标签动作层的测试
 * ==========================
 *
 * 与 `actions.spec.ts` 同样的取舍：**真实引擎 + 真实 SQLite（`:memory:`）**。
 * 要证明的是"动作确实产出了一种可同步的 op"，而假探针只能证明"我调了 dispatch"。
 *
 * 重点盯三类**静默失效**：
 *   1. 无父清单写成"不放 parentId 键" → 与另一端的写法不同，op 比对不出来
 *   2. 软删除写成物理删除 → 另一端永远看不到这次删除
 *   3. 删清单**级联**删任务 → "误删清单"从可恢复变成不可恢复
 */

import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType, type Operation } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProjectActions, type ProjectActions } from '../src/project-actions.js';
import { createTaskActions } from '../src/actions.js';

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let actions: ProjectActions;
let clock = 1_700_000_000_000;
const now = (): number => clock;

/** 可控 id：顺序断言不能靠随机 id。 */
let idSeq = 0;
const makeProjectId = (): string => {
  idSeq += 1;
  return `project-t-${String(idSeq).padStart(3, '0')}`;
};
const makeTagId = (): string => {
  idSeq += 1;
  return `tag-t-${String(idSeq).padStart(3, '0')}`;
};

async function opOf(
  entityType: 'PROJECT' | 'TAG',
  entityId: string,
): Promise<Operation<string>> {
  const ops = await engine.getOpsForEntity(entityType, entityId);
  const last = ops.at(-1);
  if (last === undefined) throw new Error(`没找到 ${entityId} 的 op`);
  return last;
}

/**
 * 取**载荷里带某个字段**的那条 op。
 *
 * ⚠️ 两个看着更省事、实际都会骗人的写法：
 *   - "最后一条"（`getOpsForEntity(...).at(-1)`）：返回顺序在接口上是
 *     **未定义**的（AGENTS.md §7 #16），而且改名 + 归档之后最后一条是归档那条。
 *   - "按 opType 取"：改名和归档**都是 `UPD`**，挑出来还是可能没有 `name`。
 *
 * 两种都会让断言读到 `undefined`，看起来像"改名没生效"，其实是挑错了 op。
 */
async function opWithField(
  entityType: 'PROJECT' | 'TAG',
  entityId: string,
  field: string,
): Promise<Operation<string>> {
  const ops = await engine.getOpsForEntity(entityType, entityId);
  const found = ops.filter((op) => field in payloadOf(op)).at(-1);
  if (found === undefined) throw new Error(`${entityId} 没有带 ${field} 的 op`);
  return found;
}

/** `payload` 在 `Operation` 上是 `unknown` —— 显式收窄，不用 `as any`。 */
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
    clientId: 'client-project',
    now,
  });
  clock = 1_700_000_000_000;
  idSeq = 0;
  actions = createProjectActions(engine, { newProjectId: makeProjectId, newTagId: makeTagId });
});

afterEach(() => {
  adapter.close();
});

describe('新建清单', () => {
  it('产出一条可同步的 PROJECT Create op', async () => {
    const id = await actions.createProject('工作');
    expect(id).toBe('project-t-001');

    const op = await opOf('PROJECT', id);
    expect(op.entityType).toBe('PROJECT');
    expect(op.opType).toBe(OpType.Create);
    expect(payloadOf(op).name).toBe('工作');
  });

  it('🔴 顶层清单写 `parentId: null`，而不是"不放这个键"', async () => {
    // 两种写法在 reducer 上等价，但**同一件事只能有一种写法** ——
    // 否则"两台设备对同一操作生成的 op 是否相同"只能靠人肉比对。
    const id = await actions.createProject('工作');
    const op = await opOf('PROJECT', id);

    expect('parentId' in payloadOf(op)).toBe(true);
    expect(payloadOf(op).parentId).toBeNull();
  });

  it('有父清单时写的是那个 id', async () => {
    const parent = await actions.createProject('文件夹');
    const child = await actions.createProject('子清单', parent);

    const op = await opOf('PROJECT', child);
    expect(payloadOf(op).parentId).toBe(parent);
  });

  it('名称两端空白会被去掉', async () => {
    const id = await actions.createProject('  工作  ');
    expect(payloadOf(await opOf('PROJECT', id)).name).toBe('工作');
  });

  it('空名称抛错，**不静默返回**，且不留下任何 op', async () => {
    await expect(actions.createProject('   ')).rejects.toThrow();
    expect(actions.listProjects()).toEqual([]);
  });
});

describe('改名 / 归档 / 删除', () => {
  it('各产出一条 UPD / UPD / DEL', async () => {
    const id = await actions.createProject('工作');
    clock += 1000;
    await actions.renameProject(id, '工作2');
    clock += 1000;
    await actions.archiveProject(id);

    // ⚠️ 按载荷字段取，不按"最后一条"也不按 opType —— 见 `opWithField` 的注释。
    expect(payloadOf(await opWithField('PROJECT', id, 'name')).name).toBe('工作2');
    expect(payloadOf(await opWithField('PROJECT', id, 'archived')).archived).toBe(true);

    clock += 1000;
    await actions.removeProject(id);
    // DEL 的载荷是空的，没有可用来定位的字段 —— 所以在**全部 op 的类型集合**上断言，
    // 而不是硬挑一条（挑错了会得到一条看着像通过的断言）。
    const allTypes = (await engine.getOpsForEntity('PROJECT', id)).map((op) => op.opType);
    expect(allTypes).toContain(OpType.Delete);
    expect(actions.listProjects().map((p) => p.id)).not.toContain(id);
  });

  it('对不存在的清单操作会抛错，不静默 no-op', async () => {
    await expect(actions.renameProject('project-不存在', 'X')).rejects.toThrow();
    await expect(actions.archiveProject('project-不存在')).rejects.toThrow();
    await expect(actions.removeProject('project-不存在')).rejects.toThrow();
  });

  it('🔴 删清单**不**级联删任务 —— 任务只是变成"无清单"', async () => {
    // 级联删除会让"误删清单"从可恢复变成不可恢复。
    const projectId = await actions.createProject('工作');
    const tasks = createTaskActions(engine, { now });
    const taskId = await tasks.create('写文档', { projectId });

    await actions.removeProject(projectId);

    // 清单没了……
    expect(actions.listProjects()).toEqual([]);
    // ……但任务还在，而且仍然指向那个（已删除的）清单 id ——
    // reducer 不做跨实体清理，任务不会凭空消失。
    const task = tasks.findTask(taskId);
    expect(task).toBeDefined();
    expect(task!.projectId).toBe(projectId);
  });
});

describe('标签', () => {
  it('新建与删除各产出一条 CRT / DEL', async () => {
    const id = await actions.createTag('紧急');
    expect(payloadOf(await opOf('TAG', id)).name).toBe('紧急');

    await actions.removeTag(id);
    expect((await opOf('TAG', id)).opType).toBe(OpType.Delete);
    expect(actions.listTags()).toEqual([]);
  });

  it('空名称抛错；删除不存在的标签也抛错', async () => {
    await expect(actions.createTag('')).rejects.toThrow();
    await expect(actions.removeTag('tag-不存在')).rejects.toThrow();
  });
});

describe('🔴 把标签打到任务上（setTags）', () => {
  /** 建一条任务，返回 id。 */
  async function makeTask(title: string): Promise<string> {
    const taskActions = createTaskActions(engine, {
      now,
      newTaskId: () => `task-t-${title}`,
    });
    return taskActions.create(title);
  }

  function taskOf(engineToRead: OpLogEngine, entityId: string): Record<string, unknown> {
    const state = engineToRead.getState();
    return state.tasks[entityId] as unknown as Record<string, unknown>;
  }

  it('一次调用 = **一条** UPD op，载荷里是整组 tagIds', async () => {
    const taskActions = createTaskActions(engine, { now, newTaskId: () => 'task-t-1' });
    const taskId = await taskActions.create('写周报');
    const a = await actions.createTag('紧急');
    const b = await actions.createTag('工作');

    const before = (await engine.getPendingUpload()).length;
    clock += 1000;
    await taskActions.setTags(taskId, [a, b]);

    // 一个用户意图 = 一条 op（AGENTS.md §3.4）。两条 op 会留下可见的中间态。
    expect((await engine.getPendingUpload()).length).toBe(before + 1);

    const ops = await engine.getOpsForEntity('TASK', taskId);
    const withTags = ops.filter((o) => 'tagIds' in payloadOf(o));
    expect(withTags).toHaveLength(1);
    expect(payloadOf(withTags[0]!).tagIds).toEqual([a, b]);
    // 写进去的是整组，不是"只加了一个"。
    expect(taskOf(engine, taskId).tagIds).toEqual([a, b]);
  });

  it('重复的标签会被去掉 —— 不写出 `[a, a]`', async () => {
    const taskActions = createTaskActions(engine, { now, newTaskId: () => 'task-t-2' });
    const taskId = await taskActions.create('写周报');
    const a = await actions.createTag('紧急');

    await taskActions.setTags(taskId, [a, a, a]);
    const ops = await engine.getOpsForEntity('TASK', taskId);
    expect(payloadOf(ops.filter((o) => 'tagIds' in payloadOf(o))[0]!).tagIds).toEqual([a]);
  });

  it('传空数组 = 清空，写的是 `null`，物化后字段**消失**（不是留个 `[]`）', async () => {
    const taskActions = createTaskActions(engine, { now, newTaskId: () => 'task-t-3' });
    const taskId = await taskActions.create('写周报');
    const a = await actions.createTag('紧急');

    await taskActions.setTags(taskId, [a]);
    expect(taskOf(engine, taskId).tagIds).toEqual([a]);

    clock += 1000;
    await taskActions.setTags(taskId, []);
    const ops = await engine.getOpsForEntity('TASK', taskId);
    const last = ops.filter((o) => 'tagIds' in payloadOf(o)).at(-1)!;
    // `[]` 和"没有这个字段"是同一件事的两种表示，只留一种。
    expect(payloadOf(last).tagIds).toBeNull();
    expect('tagIds' in taskOf(engine, taskId)).toBe(false);
  });

  it('🔴 悬空标签 id **抛错**，而且**一条 op 都不留**', async () => {
    const taskActions = createTaskActions(engine, { now, newTaskId: () => 'task-t-4' });
    const taskId = await taskActions.create('写周报');
    const before = (await engine.getPendingUpload()).length;

    await expect(taskActions.setTags(taskId, ['tag-从未存在'])).rejects.toThrow(/找不到标签/);

    // 只断言"抛了错"是不够的：**要证明没有留下半截状态**。
    expect((await engine.getPendingUpload()).length).toBe(before);
    expect('tagIds' in taskOf(engine, taskId)).toBe(false);
  });

  it('🔴 已被删除的标签也不能再挂上去', async () => {
    const taskActions = createTaskActions(engine, { now, newTaskId: () => 'task-t-5' });
    const taskId = await taskActions.create('写周报');
    const a = await actions.createTag('临时');

    await actions.removeTag(a);
    await expect(taskActions.setTags(taskId, [a])).rejects.toThrow(/找不到标签/);
  });

  it('🔴 反静默丢弃：A 打标签 → B 应用远端 → B 的任务上真的挂着那两个标签', async () => {
    const adapterB = new SqliteAdapter({
      schema: INDEXEDDB_SCHEMA,
      driverFactory: () => new NodeSqliteDriver(':memory:'),
    });
    await adapterB.init();
    const engineB = new OpLogEngine({
      store: new DbOpLogStore<Operation<string>>(adapterB),
      clientId: 'client-tags-other',
      now,
    });

    const taskActions = createTaskActions(engine, { now, newTaskId: () => 'task-t-6' });
    const taskId = await taskActions.create('写周报');
    const a = await actions.createTag('紧急');
    const b = await actions.createTag('工作');
    await taskActions.setTags(taskId, [a, b]);

    const pending = await engine.getPendingUpload();
    const result = await engineB.applyRemote(pending);
    expect(result.applied).toHaveLength(pending.length);

    const onB = createTaskActions(engineB, { now });
    expect(onB.findTask(taskId)?.tagIds).toEqual([a, b]);
    // 标签实体本身也要在 B 上物化出来 —— 否则任务指着两个查不到的 id。
    const tagsOnB = createProjectActions(engineB).listTags();
    expect(tagsOnB.map((t) => t.id).sort()).toEqual([a, b].sort());

    adapterB.close();
  });
});

describe('列表顺序', () => {
  it('按 createdAt 升序（而不是存储返回顺序）', async () => {
    const a = await actions.createProject('A');
    clock += 1000;
    const b = await actions.createProject('B');
    clock += 1000;
    const c = await actions.createProject('C');

    expect(actions.listProjects().map((p) => p.id)).toEqual([a, b, c]);
  });

  it('🔴 同一 createdAt 时按 id 字典序 —— 且不依赖创建先后', async () => {
    // 时钟不推进：三条的 createdAt 完全相同。
    // id 用**逆序**前缀，这样"按 id 排"与"按创建先后排"必然不同 ——
    // 若实现退化成不排序，这条会确定性地红（而不是 1/6 概率）。
    let seq = 0;
    const weird = { newProjectId: (): string => (seq += 1) === 1 ? 'p-z' : seq === 2 ? 'p-m' : 'p-a' };
    const w = createProjectActions(engine, weird);

    const first = await w.createProject('第一');
    const second = await w.createProject('第二');
    const third = await w.createProject('第三');

    // 按 id 升序 → p-a, p-m, p-z（即 third, second, first）
    expect(actions.listProjects().map((p) => p.id)).toEqual([third, second, first]);
    expect(actions.listProjects().map((p) => p.id)).not.toEqual([first, second, third]);
  });

  it('已删除的不出现在列表里', async () => {
    const a = await actions.createProject('A');
    await actions.createProject('B');
    await actions.removeProject(a);
    expect(actions.listProjects()).toHaveLength(1);
  });
});

describe('分类色槽位', () => {
  it('存的是**槽位号字符串**，不是颜色本身', async () => {
    const id = await actions.createProject('深度工作');
    await actions.setProjectColor(id, 3);

    const op = await opWithField('PROJECT', id, 'color');
    expect(op.opType).toBe(OpType.Update);
    // 🔴 存 "3" 而不是 "#0d9488"：换配色不该动用户数据。
    // 写成裸 hex 的话，历史数据里就是旧配色，而它在新主题下可能看不清。
    expect(payloadOf(op).color).toBe('3');
  });

  it('清除写 `color: null`（键在、值为 null），而不是"键消失"', async () => {
    const id = await actions.createProject('深度工作');
    await actions.setProjectColor(id, 3);
    await actions.setProjectColor(id, undefined);

    const op = await opWithField('PROJECT', id, 'color');
    expect('color' in payloadOf(op)).toBe(true);
    expect(payloadOf(op).color).toBeNull();
    // 物化之后字段真的没了 —— 于是它在分类时长里回到"无颜色"
    expect(engine.getState().projects[id]?.color).toBeUndefined();
  });

  it('🔴 非法槽位**抛错**，不静默写进去', async () => {
    const id = await actions.createProject('深度工作');
    // 0 是最可能的真实错误：界面很容易把数组下标（0 起算）传进来，
    // 而 `"0"` 读回来会被当成"没设过色" —— 症状是"点了 1 号却没颜色"。
    await expect(actions.setProjectColor(id, 0 as never)).rejects.toThrow(/1–8/);
    await expect(actions.setProjectColor(id, 9 as never)).rejects.toThrow(/1–8/);
    expect(engine.getState().projects[id]?.color).toBeUndefined();
  });

  it('找不到（或已删除）的清单不能上色', async () => {
    await expect(actions.setProjectColor('不存在', 1)).rejects.toThrow(/找不到清单/);

    const id = await actions.createProject('深度工作');
    await actions.removeProject(id);
    await expect(actions.setProjectColor(id, 1)).rejects.toThrow(/找不到清单/);
  });

  it('另一台设备能读到这个槽位（真的物化了，而不是丢在同步里）', async () => {
    const adapterB = new SqliteAdapter({
      schema: INDEXEDDB_SCHEMA,
      driverFactory: () => new NodeSqliteDriver(':memory:'),
    });
    await adapterB.init();
    const engineB = new OpLogEngine({
      store: new DbOpLogStore<Operation<string>>(adapterB),
      clientId: 'client-color',
      now,
    });

    const id = await actions.createProject('深度工作');
    await actions.setProjectColor(id, 6);

    await engineB.applyRemote(await engine.getPendingUpload());
    expect(engineB.getState().projects[id]?.color).toBe('6');

    adapterB.close();
  });
});

describe('🔴 反静默丢弃：另一台设备真的能物化它', () => {
  it('A 写入清单与标签 → B 应用远端 → B 的状态里查得到', async () => {
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

    const projectId = await actions.createProject('工作');
    const tagId = await actions.createTag('紧急');

    const pending = await engine.getPendingUpload();
    expect(pending).toHaveLength(2);

    const result = await engineB.applyRemote(pending);
    // 两条都被接受 —— 而不是"不知道这个实体于是优雅跳过"（§7 #20）
    expect(result.applied).toHaveLength(2);

    const onB = createProjectActions(engineB);
    expect(onB.listProjects().map((p) => p.id)).toEqual([projectId]);
    expect(onB.listTags().map((t) => t.id)).toEqual([tagId]);

    adapterB.close();
  });
});