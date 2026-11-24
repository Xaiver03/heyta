/**
 * 清单内分组动作层的测试（ADR-0091 的"最后一米"）
 * ==================================================
 *
 * 与 `project-actions.spec.ts` / `comment-actions.spec.ts` 同一个取舍：
 * **真实引擎 + 真实 SQLite（`:memory:`）**，状态与 reducer 语义都不 mock
 * （`createdAt` 由 op 时间戳派生、`DEL` 落墓碑、`{ sectionId: null }` 清字段 ——
 * 这些都要真的跑一遍才算数）。
 *
 * 盯三件事：
 *   1. **一个用户意图 = 一条 op**，载荷逐字只有该带的那些格（不 fan-out、不顺手重写别的字段）。
 *   2. **软删不级联**：删分组后其下任务保留 `sectionId`，读侧归「未分组」。
 *   3. **写入路由不在动作层判断**：目标清单 `shareId` 在册时，op 由路由派发器送进 share 通道，
 *      个人 op-log 一格都不写（照 `share-routing.spec.ts` 的写法）。
 */

import { OpLogEngine } from '@heyta/op-log';
import type { EntityType } from '@heyta/shared-schema';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType, type Operation } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTaskActions, type TaskActions } from '../src/actions.js';
import { createProjectActions, type ProjectActions } from '../src/project-actions.js';
import { createSectionActions, type SectionActions } from '../src/section-actions.js';
import { createShareRoutingDispatcher, type ShareWriteChannel } from '../src/share-routing.js';
import type { ShareOpDispatchIntent } from '../src/share-client.js';
import { groupTasksBySection, sectionsOfProject } from '@heyta/domain';

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let tasks: TaskActions;
let projects: ProjectActions;
let sections: SectionActions;

let clock = 1_700_000_000_000;
const now = (): number => clock;

let seq = 0;
const makeSectionId = (): string => {
  seq += 1;
  return `section-t-${String(seq).padStart(3, '0')}`;
};
const makeProjectId = (): string => {
  seq += 1;
  return `proj-t-${String(seq).padStart(3, '0')}`;
};
const makeTaskId = (): string => {
  seq += 1;
  return `task-t-${String(seq).padStart(3, '0')}`;
};

async function opsOf(entityType: 'SECTION' | 'TASK', entityId: string): Promise<Operation<string>[]> {
  return engine.getOpsForEntity(entityType, entityId);
}

async function lastOp(entityType: 'SECTION' | 'TASK', entityId: string): Promise<Operation<string>> {
  const ops = await opsOf(entityType, entityId);
  const last = ops.at(-1);
  if (last === undefined) throw new Error(`没找到 ${entityId} 的 op`);
  return last;
}

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  engine = new OpLogEngine({ store: new DbOpLogStore(adapter), clientId: 'client-section', now });
  clock = 1_700_000_000_000;
  seq = 0;
  tasks = createTaskActions(engine, { now, newTaskId: makeTaskId });
  projects = createProjectActions(engine, { newProjectId: makeProjectId });
  sections = createSectionActions(engine, { newSectionId: makeSectionId });
});

afterEach(() => {
  adapter.close();
});

const state = () => engine.getState();

describe('建分组：一条 CRT，载荷逐字 { projectId, name, order }', () => {
  it('新建分组 → 一条 SECTION CRT；载荷逐字三格；返回新 id', async () => {
    const projectId = await projects.createProject('读书');
    const id = await sections.createSection(projectId, '  新手入门  ');

    const op = await lastOp('SECTION', id);
    expect(op.opType).toBe(OpType.Create);
    // 🔴 `toEqual`（不是 `toMatchObject`）：多带一格（例如客户端自己算的 createdAt）必须红。
    expect(op.payload).toEqual({ projectId, name: '新手入门', order: 0 });
    expect(Object.keys(op.payload as object).sort()).toEqual(['name', 'order', 'projectId']);
    expect(sections.listSections(projectId).map((s) => s.id)).toEqual([id]);
  });

  it('两个分组按顺序拿到 order 0 / 1（nextSectionOrder 递增）', async () => {
    const projectId = await projects.createProject('读书');
    const a = await sections.createSection(projectId, '第一组');
    const b = await sections.createSection(projectId, '第二组');
    expect((await lastOp('SECTION', a)).payload).toMatchObject({ order: 0 });
    expect((await lastOp('SECTION', b)).payload).toMatchObject({ order: 1 });
    expect(sections.listSections(projectId).map((s) => s.id)).toEqual([a, b]);
  });

  it('空白名称被拒绝，且零 op', async () => {
    const projectId = await projects.createProject('读书');
    await expect(sections.createSection(projectId, '   ')).rejects.toThrow(/名称不能为空/);
    expect(Object.keys(state().sections)).toEqual([]);
  });

  it('清单不存在 / 已软删 ⇒ 抛错且零 op', async () => {
    await expect(sections.createSection('proj-不存在', '分组')).rejects.toThrow(/找不到清单/);
    const projectId = await projects.createProject('临时');
    await projects.removeProject(projectId);
    await expect(sections.createSection(projectId, '分组')).rejects.toThrow(/找不到清单/);
    expect(Object.keys(state().sections)).toEqual([]);
  });
});

describe('改名：一条 UPD，载荷逐字 { name }', () => {
  it('改名只写 name，且首尾空白被 trim', async () => {
    const projectId = await projects.createProject('读书');
    const id = await sections.createSection(projectId, '旧名');
    const before = (await opsOf('SECTION', id)).length;

    await sections.renameSection(id, '  新名  ');
    const ops = await opsOf('SECTION', id);
    expect(ops.length).toBe(before + 1);
    const last = ops.at(-1)!;
    expect(last.opType).toBe(OpType.Update);
    expect(last.payload).toEqual({ name: '新名' });
    expect(sections.listSections(projectId)[0]?.name).toBe('新名');
  });

  it('分组不存在 / 已软删 ⇒ 抛错且零 op', async () => {
    await expect(sections.renameSection('sec-不存在', '新名')).rejects.toThrow(/找不到分组/);
    const projectId = await projects.createProject('读书');
    const id = await sections.createSection(projectId, '旧名');
    await sections.removeSection(id);
    const countAfterDelete = (await opsOf('SECTION', id)).length;
    await expect(sections.renameSection(id, '新名')).rejects.toThrow(/找不到分组/);
    expect((await opsOf('SECTION', id)).length).toBe(countAfterDelete);
  });

  it('空白名称被拒绝，且零 op', async () => {
    const projectId = await projects.createProject('读书');
    const id = await sections.createSection(projectId, '旧名');
    const before = (await opsOf('SECTION', id)).length;
    await expect(sections.renameSection(id, '')).rejects.toThrow(/名称不能为空/);
    expect((await opsOf('SECTION', id)).length).toBe(before);
  });
});

describe('调序：一条 UPD，载荷逐字 { order }', () => {
  it('调序只写 order', async () => {
    const projectId = await projects.createProject('读书');
    const id = await sections.createSection(projectId, '分组');
    const before = (await opsOf('SECTION', id)).length;

    await sections.reorderSection(id, 3);
    const ops = await opsOf('SECTION', id);
    expect(ops.length).toBe(before + 1);
    expect(ops.at(-1)!.opType).toBe(OpType.Update);
    expect(ops.at(-1)!.payload).toEqual({ order: 3 });
  });

  it('order 不是非负整数 ⇒ 抛错且零 op', async () => {
    const projectId = await projects.createProject('读书');
    const id = await sections.createSection(projectId, '分组');
    const before = (await opsOf('SECTION', id)).length;
    await expect(sections.reorderSection(id, -1)).rejects.toThrow(/非负整数/);
    await expect(sections.reorderSection(id, 1.5)).rejects.toThrow(/非负整数/);
    expect((await opsOf('SECTION', id)).length).toBe(before);
  });

  it('调序后 listSections 顺序跟着 order 变', async () => {
    const projectId = await projects.createProject('读书');
    const a = await sections.createSection(projectId, 'A');
    const b = await sections.createSection(projectId, 'B');
    await sections.reorderSection(a, 10);
    expect(sections.listSections(projectId).map((s) => s.id)).toEqual([b, a]);
  });
});

describe('任务归组：一条 TASK UPD，载荷逐字 { sectionId }', () => {
  it('移进分组 → 一条 TASK UPD，载荷逐字 { sectionId }', async () => {
    const projectId = await projects.createProject('读书');
    const sectionId = await sections.createSection(projectId, '分组');
    const taskId = await tasks.create('买书');
    await tasks.moveToProject(taskId, projectId);
    const before = (await opsOf('TASK', taskId)).length;

    await sections.setTaskSection(taskId, sectionId);
    const ops = await opsOf('TASK', taskId);
    expect(ops.length).toBe(before + 1);
    expect(ops.at(-1)!.opType).toBe(OpType.Update);
    expect(ops.at(-1)!.payload).toEqual({ sectionId });
    expect(state().tasks[taskId]?.sectionId).toBe(sectionId);
  });

  it('🔴 移出到未分组 → 载荷写 `null`（`undefined` 会被 JSON 丢掉，清除失效）', async () => {
    const projectId = await projects.createProject('读书');
    const sectionId = await sections.createSection(projectId, '分组');
    const taskId = await tasks.create('买书');
    await tasks.moveToProject(taskId, projectId);
    await sections.setTaskSection(taskId, sectionId);

    await sections.setTaskSection(taskId);
    expect((await lastOp('TASK', taskId)).payload).toEqual({ sectionId: null });
    expect(state().tasks[taskId]?.sectionId).toBeUndefined();
  });

  it('🔴 分组属于别的清单 ⇒ 拒绝且零 op（不能把任务挂到别人清单的分组上）', async () => {
    const p1 = await projects.createProject('清单一');
    const p2 = await projects.createProject('清单二');
    const sectionInP2 = await sections.createSection(p2, '二的分组');
    const taskId = await tasks.create('任务');
    await tasks.moveToProject(taskId, p1);
    const before = (await opsOf('TASK', taskId)).length;

    await expect(sections.setTaskSection(taskId, sectionInP2)).rejects.toThrow(/不属于分组/);
    expect((await opsOf('TASK', taskId)).length).toBe(before);
  });

  it('分组不存在 / 任务不存在 ⇒ 抛错且零 op', async () => {
    const projectId = await projects.createProject('读书');
    const taskId = await tasks.create('任务');
    await tasks.moveToProject(taskId, projectId);
    await expect(sections.setTaskSection(taskId, 'sec-不存在')).rejects.toThrow(/找不到分组/);
    await expect(sections.setTaskSection('task-不存在', 'sec-x')).rejects.toThrow(/找不到任务/);
  });
});

describe('删分组：软删（DEL 墓碑），不级联删任务', () => {
  it('删除写一条 DEL；其下任务保留 sectionId；分组从列表消失、任务归「未分组」', async () => {
    const projectId = await projects.createProject('读书');
    const sectionId = await sections.createSection(projectId, '分组');
    const taskId = await tasks.create('买书');
    await tasks.moveToProject(taskId, projectId);
    await sections.setTaskSection(taskId, sectionId);

    await sections.removeSection(sectionId);
    const last = await lastOp('SECTION', sectionId);
    expect(last.opType).toBe(OpType.Delete);
    expect(last.payload).toEqual({});

    // 前提：墓碑落到物化状态（不是本地筛掉）。
    expect(state().sections[sectionId]?.deletedAt).toBeTypeOf('number');
    // 任务没被级联清除，sectionId 仍在。
    expect(state().tasks[taskId]?.sectionId).toBe(sectionId);
    // 读侧：分组不再列出。
    expect(sections.listSections(projectId)).toEqual([]);
    // 读侧：任务归入「未分组」，不丢。
    const groups = groupTasksBySection(
      Object.values(state().tasks),
      Object.values(state().sections),
      projectId,
    );
    const ungrouped = groups.find((g) => g.sectionId === undefined);
    expect(ungrouped?.tasks.map((t) => t.id)).toContain(taskId);
  });

  it('分组不存在 / 已软删 ⇒ 抛错且零 op', async () => {
    await expect(sections.removeSection('sec-不存在')).rejects.toThrow(/找不到分组/);
    const projectId = await projects.createProject('读书');
    const id = await sections.createSection(projectId, '分组');
    await sections.removeSection(id);
    const count = (await opsOf('SECTION', id)).length;
    await expect(sections.removeSection(id)).rejects.toThrow(/找不到分组/);
    expect((await opsOf('SECTION', id)).length).toBe(count);
  });
});

describe('读取：只读存活分组、按领域顺序', () => {
  it('listSections 与 domain `sectionsOfProject` 逐项相等（不是第二份实现）', async () => {
    const projectId = await projects.createProject('读书');
    const b = await sections.createSection(projectId, 'B');
    const a = await sections.createSection(projectId, 'A');
    await sections.reorderSection(a, 0);
    await sections.reorderSection(b, 1);
    expect(sections.listSections(projectId).map((s) => s.id)).toEqual(
      sectionsOfProject(Object.values(state().sections), projectId).map((s) => s.id),
    );
  });
});

describe('写入路由：目标清单 shareId 在册 ⇒ 走 share 通道，个人 op-log 零写入（ADR-0091 §7）', () => {
  interface Calls {
    readonly personal: Operation<string>[];
    readonly share: { shareId: string; intent: ShareOpDispatchIntent }[];
  }
  function routedHarness(): { calls: Calls; dispatched: SectionActions } {
    const calls: Calls = { personal: [], share: [] };
    const channel: ShareWriteChannel = {
      dispatch: async (shareId, intent) => {
        calls.share.push({ shareId, intent });
      },
      stateFor: () => engine.getState(),
    };
    // 🔴 路由派发器就是生产里端壳交给动作层的那一枚（`ctx.dispatch`）。
    const dispatch = createShareRoutingDispatcher({
      personalDispatch: async (intent) => {
        await engine.dispatch(intent);
        calls.personal.push(intent as unknown as Operation<string>);
      },
      channel: () => channel,
      getState: () => engine.getState(),
    });
    const ctx = { dispatch, getState: () => engine.getState() };
    return {
      calls,
      dispatched: createSectionActions(ctx, { newSectionId: makeSectionId }),
    };
  }

  it('在共享清单下建分组 ⇒ SECTION op 进 share，个人零写入', async () => {
    const projectId = await projects.createProject('协作清单');
    const shareId = `share-${projectId}`;
    await projects.setProjectShareId(projectId, shareId);
    const { calls, dispatched } = routedHarness();

    const id = await dispatched.createSection(projectId, '新手入门');
    expect(calls.share).toHaveLength(1);
    expect(calls.share[0]?.shareId).toBe(shareId);
    expect(calls.share[0]?.intent.entityType).toBe('SECTION');
    expect(calls.share[0]?.intent.opType).toBe(OpType.Create);
    expect(calls.share[0]?.intent.payload).toEqual({ projectId, name: '新手入门', order: 0 });
    expect(calls.personal).toEqual([]);
    expect(id).toBeTruthy();
  });

  it('把共享清单里的任务移进分组 ⇒ TASK op 进 share，个人零写入', async () => {
    const projectId = await projects.createProject('协作清单');
    const shareId = `share-${projectId}`;
    await projects.setProjectShareId(projectId, shareId);
    const taskId = await tasks.create('评审');
    await tasks.moveToProject(taskId, projectId);
    // 分组也建在共享清单里（直接经个人引擎物化一笔，模拟 share 通道回放后的状态）。
    const sectionId = `section-seeded`;
    await engine.dispatch({
      entityType: 'SECTION' as EntityType,
      entityId: sectionId,
      opType: OpType.Create,
      payload: { projectId, name: '分组', order: 0 },
    });
    const { calls, dispatched } = routedHarness();

    await dispatched.setTaskSection(taskId, sectionId);
    expect(calls.share).toHaveLength(1);
    expect(calls.share[0]?.shareId).toBe(shareId);
    expect(calls.share[0]?.intent.entityType).toBe('TASK');
    expect(calls.share[0]?.intent.payload).toEqual({ sectionId });
    expect(calls.personal).toEqual([]);
  });

  it('个人清单下建分组 ⇒ 走个人 op-log，share 零调用', async () => {
    const projectId = await projects.createProject('私人清单');
    const { calls, dispatched } = routedHarness();
    await dispatched.createSection(projectId, '分组');
    expect(calls.share).toEqual([]);
    expect(calls.personal).toHaveLength(1);
    expect(calls.personal[0]?.entityType).toBe('SECTION');
  });
});
