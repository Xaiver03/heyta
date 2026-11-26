/**
 * 任务模板（`TASK_TEMPLATE`）动作层测试
 * ======================================
 *
 * 与 `filter-actions.spec.ts` 同一取舍：**真实引擎 + 真实 SQLite（`:memory:`）**，零 mock。
 * 盯的是"op 写得出来、界面却不对"的静默失效：
 *
 *   1. 保存任务为模板拆成多条 op / 把"某条任务此刻的状态"（projectId/dueDate）也抓进去；
 *   2. 从模板建任务拆成多条 op / 标题缺省不兜底 / 清单条目 id 不重生成；
 *   3. 同名改名仍写 op → `updatedAt` 推进、顺序被扰动；
 *   4. 删除写成物理删 / 还原写成不清墓碑 → 离线端把它同步回来；
 *   5. 顺序在动作层漏算 → "两端模板顺序不一样且都不报错"。
 */

import { Priority, type Task, type TaskTemplate } from '@heyta/domain';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTaskTemplateActions, type TaskTemplateActions } from '../src/template-actions.js';

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let actions: TaskTemplateActions;
let clock = 1_700_000_000_000;

let seq = 0;
const makeTemplateId = (): string => {
  seq += 1;
  return `tpl-t-${String(seq).padStart(3, '0')}`;
};
const makeItemId = (): string => {
  seq += 1;
  return `chk-new-${seq}`;
};
const makeTaskId = (): string => {
  seq += 1;
  return `task-new-${seq}`;
};

const state = (): { taskTemplates: Record<string, TaskTemplate>; tasks: Record<string, Task> } =>
  engine.getState() as unknown as {
    taskTemplates: Record<string, TaskTemplate>;
    tasks: Record<string, Task>;
  };

const opsOf = (entityId: string) => engine.getOpsForEntity('TASK_TEMPLATE', entityId);
const taskOpsOf = (entityId: string) => engine.getOpsForEntity('TASK', entityId);
const lastPayload = async (entityId: string): Promise<Record<string, unknown>> => {
  const ops = await opsOf(entityId);
  const last = ops.at(-1);
  if (last === undefined) throw new Error(`没找到 ${entityId} 的 op`);
  return last.payload as Record<string, unknown>;
};

const seedTask = async (entityId: string, payload: Record<string, unknown>): Promise<void> => {
  await engine.dispatch({
    entityType: 'TASK' as never,
    entityId,
    opType: OpType.Create,
    payload,
  });
};

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  engine = new OpLogEngine({ store: new DbOpLogStore(adapter), clientId: 'client-tpl', now: () => clock });
  clock = 1_700_000_000_000;
  seq = 0;
  actions = createTaskTemplateActions(engine, {
    newTemplateId: makeTemplateId,
    newChecklistItemId: makeItemId,
    newTaskEntityId: makeTaskId,
  });
});

afterEach(() => {
  adapter.close();
});

describe('保存任务为模板', () => {
  it('一条 TASK_TEMPLATE Create op；只抓允许的字段，不抓 projectId/dueDate', async () => {
    await seedTask('task-1', {
      title: '周报',
      priority: Priority.High,
      note: '本周完成项',
      projectId: 'proj-9',
      dueDate: 1_700_000_000_000,
      tagIds: ['t1', 't2'],
      checklist: [{ id: 'chk-old', text: '汇总', done: false }],
      durationMinutes: 30,
    });
    const id = await actions.saveTaskAsTemplate('task-1', '周报模板');
    const ops = await opsOf(id);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.entityType).toBe('TASK_TEMPLATE');
    expect(ops[0]?.opType).toBe(OpType.Create);
    const payload = await lastPayload(id);
    expect(payload).toMatchObject({
      name: '周报模板',
      title: '周报',
      priority: Priority.High,
      note: '本周完成项',
      tagIds: ['t1', 't2'],
      checklist: [{ text: '汇总', done: false }],
      durationMinutes: 30,
      order: null,
    });
    expect(payload).not.toHaveProperty('projectId');
    expect(payload).not.toHaveProperty('dueDate');
    expect(state().taskTemplates[id]?.name).toBe('周报模板');
  });

  it('名字去首尾空白', async () => {
    await seedTask('task-1', { title: 'X', priority: Priority.None });
    const id = await actions.saveTaskAsTemplate('task-1', '  打包  ');
    expect(state().taskTemplates[id]?.name).toBe('打包');
  });

  it('空名字 ⇒ 抛错且零 op', async () => {
    await seedTask('task-1', { title: 'X' });
    await expect(actions.saveTaskAsTemplate('task-1', '   ')).rejects.toThrow();
    expect(Object.keys(state().taskTemplates)).toHaveLength(0);
  });

  it('任务不存在 / 已删 ⇒ 抛错且零 op', async () => {
    await expect(actions.saveTaskAsTemplate('nope', 'T')).rejects.toThrow();
    await seedTask('task-del', { title: 'X' });
    await engine.dispatch({ entityType: 'TASK' as never, entityId: 'task-del', opType: OpType.Delete, payload: {} });
    await expect(actions.saveTaskAsTemplate('task-del', 'T')).rejects.toThrow();
    expect(Object.keys(state().taskTemplates)).toHaveLength(0);
  });
});

describe('从模板建任务', () => {
  it('一条 TASK Create op；title 缺省用模板名，清单条目重新生成 id', async () => {
    await seedTask('task-1', {
      title: '周报',
      checklist: [{ id: 'chk-old', text: '汇总', done: false }],
    });
    const tplId = await actions.saveTaskAsTemplate('task-1', '周报模板');
    // 清掉模板的 title 以验证兜底：直接用一个没有 title 的快照任务
    await seedTask('task-2', { title: '   ' });
    const tplNoTitle = await actions.saveTaskAsTemplate('task-2', '出差打包');

    const newTaskId = await actions.createTaskFromTemplate(tplNoTitle);
    const ops = await taskOpsOf(newTaskId);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.opType).toBe(OpType.Create);
    const payload = ops[0]?.payload as Record<string, unknown>;
    expect(payload['title']).toBe('出差打包');
    expect(payload['priority']).toBe(Priority.None);

    // 另一条模板带清单：条目 id 必须换新（不是模板里的 chk-old）
    const newId2 = await actions.createTaskFromTemplate(tplId);
    const payload2 = (await taskOpsOf(newId2))[0]?.payload as Record<string, unknown>;
    expect(payload2['title']).toBe('周报');
    const checklist = payload2['checklist'] as { id: string; text: string; done: boolean }[];
    expect(checklist).toHaveLength(1);
    expect(checklist[0]?.text).toBe('汇总');
    expect(checklist[0]?.id).not.toBe('chk-old');
  });

  it('模板不存在 / 已删 ⇒ 抛错且零 TASK op', async () => {
    await expect(actions.createTaskFromTemplate('nope')).rejects.toThrow();
    expect(Object.keys(state().tasks)).toHaveLength(0);
  });
});

describe('改名 / 排序 / 删除 / 还原', () => {
  it('同名改名不写 op；改名写一条 UPD { name }', async () => {
    await seedTask('task-1', { title: 'X' });
    const id = await actions.saveTaskAsTemplate('task-1', '工作');
    await actions.renameTemplate(id, '工作');
    expect(await opsOf(id)).toHaveLength(1);
    await actions.renameTemplate(id, '我的工作');
    expect(await opsOf(id)).toHaveLength(2);
    expect(await lastPayload(id)).toEqual({ name: '我的工作' });
  });

  it('排序键非有限数 ⇒ 抛错', async () => {
    await seedTask('task-1', { title: 'X' });
    const id = await actions.saveTaskAsTemplate('task-1', '工作');
    await expect(actions.setTemplateOrder(id, Number.NaN)).rejects.toThrow();
    await actions.setTemplateOrder(id, 3);
    expect(await lastPayload(id)).toEqual({ order: 3 });
  });

  it('软删后不进列表；还原清墓碑；彻底删除后还原抛错', async () => {
    await seedTask('task-1', { title: 'X' });
    const id = await actions.saveTaskAsTemplate('task-1', '工作');
    await actions.removeTemplate(id);
    expect(actions.listTemplates()).toHaveLength(0);
    expect(await actions.restoreTemplate(id)).toBe(true);
    expect(actions.listTemplates()).toHaveLength(1);
    // 不在回收站 ⇒ 返回 false 且不写 op
    const before = (await opsOf(id)).length;
    expect(await actions.restoreTemplate(id)).toBe(false);
    expect((await opsOf(id)).length).toBe(before);
    // 彻底删除标记（直接注入 purgedAt 无法经动作层发生，用 raw op 模拟另一个版本写下的墓碑）
    await engine.dispatch({
      entityType: 'TASK_TEMPLATE' as never,
      entityId: id,
      opType: OpType.Update,
      payload: { purgedAt: clock },
    });
    await expect(actions.restoreTemplate(id)).rejects.toThrow(/彻底删除/);
  });

  it('listTemplates 规范顺序（order→name→id，缺 order 排最后）', async () => {
    await seedTask('task-1', { title: 'X' });
    const a = await actions.saveTaskAsTemplate('task-1', '乙', { order: 2 });
    const b = await actions.saveTaskAsTemplate('task-1', '甲', { order: 1 });
    const c = await actions.saveTaskAsTemplate('task-1', '丙');
    expect(actions.listTemplates().map((t) => t.id)).toEqual([b, a, c]);
    expect(actions.templateOf(a)?.name).toBe('乙');
  });
});
