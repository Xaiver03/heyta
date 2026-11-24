/**
 * 标签层级动作（ADR-0090）—— 父子写入路径的判据面
 * =================================================
 *
 * 钉住 app-host 这一层对"两级标签"的写入语义：
 *   1. `createTag(name, parentId)` 建子标签；父必须是顶层（三层被拒）；
 *   2. **同层唯一**：同一 parentId 下不能重名，不同父下可同名；
 *   3. `setTagParent` 走 `validateTagParentChange`，非法即拒、合法即一条 UPD op，
 *      提为顶层写 `parentId: null`；
 *   4. 撤销/读侧由 domain 侧测试覆盖，这里只管"写进去的形状"。
 */

import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType, type Operation } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProjectActions, type ProjectActions } from '../src/project-actions.js';

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let projects: ProjectActions;
let clock = 1_790_000_000_000;
const now = (): number => clock;

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  engine = new OpLogEngine({
    store: new DbOpLogStore<Operation<string>>(adapter),
    clientId: 'client-tag-hierarchy-test',
    now,
  });
  const ctx = {
    dispatch: (intent: Parameters<OpLogEngine['dispatch']>[0]) => engine.dispatch(intent),
    getState: () => engine.getState(),
  };
  projects = createProjectActions(ctx as never, { now });
  clock = 1_790_000_000_000;
});

afterEach(() => {
  adapter.close();
});

async function lastTagOp(entityId: string): Promise<Operation<string>> {
  const ops = await engine.getOpsForEntity('TAG', entityId);
  const op = ops[ops.length - 1];
  if (op === undefined) throw new Error('没有 TAG op');
  return op;
}

describe('createTag：父子与同层唯一', () => {
  it('建顶层标签 payload 写 parentId: null', async () => {
    const id = await projects.createTag('工作');
    const op = await lastTagOp(id);
    expect(op.opType).toBe(OpType.Create);
    expect((op.payload as Record<string, unknown>).parentId).toBeNull();
    expect(engine.getState().tags[id]?.parentId).toBeUndefined();
  });

  it('建子标签：parentId 落到实体上', async () => {
    const parent = await projects.createTag('工作');
    const child = await projects.createTag('客户A', parent);
    expect(engine.getState().tags[child]?.parentId).toBe(parent);
    expect(((await lastTagOp(child)).payload as Record<string, unknown>).parentId).toBe(parent);
  });

  it('父不是顶层（父自己有父）⇒ 拒绝（不能造第三层）', async () => {
    const root = await projects.createTag('工作');
    const child = await projects.createTag('客户A', root);
    await expect(projects.createTag('更细', child)).rejects.toThrow();
  });

  it('同层重名 ⇒ 拒绝；不同父下同名 ⇒ 允许', async () => {
    const root = await projects.createTag('工作');
    await projects.createTag('客户A', root);
    await expect(projects.createTag('客户A', root)).rejects.toThrow();
    const other = await projects.createTag('生活');
    await expect(projects.createTag('客户A', other)).resolves.toBeTypeOf('string');
  });
});

describe('setTagParent：结构守卫与 op 形状', () => {
  it('把顶层标签挂进另一个顶层标签下 ⇒ 一条 UPD op，载荷只有 parentId', async () => {
    const work = await projects.createTag('工作');
    const life = await projects.createTag('生活');
    await projects.setTagParent(life, work);
    const op = await lastTagOp(life);
    expect(op.opType).toBe(OpType.Update);
    expect(op.payload).toEqual({ parentId: work });
    expect(engine.getState().tags[life]?.parentId).toBe(work);
  });

  it('提为顶层写 parentId: null', async () => {
    const work = await projects.createTag('工作');
    const life = await projects.createTag('生活', work);
    await projects.setTagParent(life, undefined);
    expect((await lastTagOp(life)).payload).toEqual({ parentId: null });
    expect(engine.getState().tags[life]?.parentId).toBeUndefined();
  });

  it('挂到"自己有子的父"下面再想把它挂进去 ⇒ 拒绝（父标签不能再进父）', async () => {
    const work = await projects.createTag('工作');
    await projects.createTag('客户A', work);
    const life = await projects.createTag('生活');
    // work 有子 ⇒ 它是父标签，不能再被挂进 life
    await expect(projects.setTagParent(work, life)).rejects.toThrow();
  });

  it('挂到自己 ⇒ 拒绝', async () => {
    const work = await projects.createTag('工作');
    await expect(projects.setTagParent(work, work)).rejects.toThrow();
  });

  it('重挂造成同层重名 ⇒ 拒绝', async () => {
    const work = await projects.createTag('工作');
    const life = await projects.createTag('生活');
    await projects.createTag('生活', work); // work 下已有 "生活"
    // 把顶层 "生活" 也挂到 work 下 ⇒ 同层两个 "生活"
    await expect(projects.setTagParent(life, work)).rejects.toThrow();
  });
});
