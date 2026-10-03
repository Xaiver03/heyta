/**
 * 清单改父（动作层）的判据
 * ==========================
 *
 * 与 `project-actions.spec.ts` 同样的取舍：**真实引擎 + 真实 SQLite（`:memory:`）**。
 * 这里要证明的不是"我调了 dispatch"，而是三件更容易悄悄坏掉的事：
 *
 *   1. 改父是**一个 op**，载荷里**只有** `parentId` —— 顺带写别的字段就是第二个意图。
 *   2. 提为顶级写的是 `null`，不是"不放这个键"（文件头第 1 条：两台设备对同一次
 *      "移出文件夹"生成的 op 必须逐字节可比）。
 *   3. 🔴 被拒时**一条 op 都不许多写**。这一条是这条判据真正值钱的地方：
 *      守卫如果只 throw 而动作已经发出去了，界面上会显示"移动失败"而数据里
 *      多了一条第三层 —— 那比静默失败更难查。
 */

import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType, type Operation } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProjectActions, type ProjectActions } from '../src/project-actions.js';

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let actions: ProjectActions;
const clock = 1_700_000_000_000;

let idSeq = 0;
const makeProjectId = (): string => {
  idSeq += 1;
  return `project-p-${String(idSeq).padStart(3, '0')}`;
};

function payloadOf(op: Operation<string>): Record<string, unknown> {
  return op.payload as Record<string, unknown>;
}

/** 取带 `parentId` 的那条 op（不按"最后一条"挑 —— 同 sibling 判据的理由）。 */
async function parentOpOf(entityId: string): Promise<Operation<string>> {
  const ops = await engine.getOpsForEntity('PROJECT', entityId);
  const found = ops.filter((op) => 'parentId' in payloadOf(op)).at(-1);
  if (found === undefined) throw new Error(`${entityId} 没有带 parentId 的 op`);
  return found;
}

async function opCount(entityId: string): Promise<number> {
  return (await engine.getOpsForEntity('PROJECT', entityId)).length;
}

/** 建一棵一层的现场：文件夹 + 它下面一条 + 两条散装。 */
async function seed(): Promise<{ folder: string; inside: string; looseA: string; looseB: string }> {
  const folder = await actions.createProject('文件夹');
  const inside = await actions.createProject('文件夹里的清单', folder);
  const looseA = await actions.createProject('散装A');
  const looseB = await actions.createProject('散装B');
  return { folder, inside, looseA, looseB };
}

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  engine = new OpLogEngine({
    store: new DbOpLogStore<Operation<string>>(adapter),
    clientId: 'client-parent',
    now: () => clock,
  });
  idSeq = 0;
  actions = createProjectActions(engine, { newProjectId: makeProjectId });
});

afterEach(() => {
  adapter.close();
});

describe('setParent：允许的移动', () => {
  it('挂进文件夹 = 恰好一条 UPD，载荷只有 parentId', async () => {
    const { folder, looseA } = await seed();
    const before = await opCount(looseA);

    await actions.setParent(looseA, folder);

    const ops = await engine.getOpsForEntity('PROJECT', looseA);
    expect(ops.length).toBe(before + 1);
    const op = await parentOpOf(looseA);
    expect(op.opType).toBe(OpType.Update);
    expect(Object.keys(payloadOf(op))).toEqual(['parentId']);
    expect(payloadOf(op).parentId).toBe(folder);
  });

  it('🔴 提为顶级写 `parentId: null`，不是"不放这个键"', async () => {
    const { inside } = await seed();
    await actions.setParent(inside);

    const payload = payloadOf(await parentOpOf(inside));
    expect('parentId' in payload).toBe(true);
    expect(payload.parentId).toBeNull();
  });

  it('移动后本地物化状态真的是那棵树', async () => {
    const { folder, looseA } = await seed();
    await actions.setParent(looseA, folder);
    const moved = engine.getState().projects[looseA];
    expect(moved?.parentId).toBe(folder);
    // 清单没有因此消失或多出来：可见清单数不变（两条 → 还是四条都在）。
    expect(actions.listProjects().length).toBe(4);
  });

  it('层级穿过线协议：另一台设备 applyRemote 后读到同一个父', async () => {
    const { folder, looseA } = await seed();
    await actions.setParent(looseA, folder);

    const adapterB = new SqliteAdapter({
      schema: INDEXEDDB_SCHEMA,
      driverFactory: () => new NodeSqliteDriver(':memory:'),
    });
    await adapterB.init();
    const engineB = new OpLogEngine({
      store: new DbOpLogStore<Operation<string>>(adapterB),
      clientId: 'client-parent-b',
      now: () => clock,
    });
    await engineB.applyRemote(await engine.getPendingUpload());
    const onB = createProjectActions(engineB);

    expect(onB.listProjects().find((p) => p.id === looseA)?.parentId).toBe(folder);
    // 🔴 B 端用的是**同一份领域层守卫**：它对同一棵树的判断必须和 A 端一致，
    //    否则"两台设备各自的裁决标准不同"就是两份实现的老问题。
    await expect(onB.setParent(folder, looseA)).rejects.toThrow('改父被拒绝');
    expect(engineB.getState().projects[folder]?.parentId).toBeUndefined();
    adapterB.close();
  });
});

describe('setParent：被拒时一条 op 都不多写', () => {
  const cases: { name: string; target: string; parent: 'self' | 'inside' | 'looseB' }[] = [
    { name: 'self', target: 'looseA', parent: 'self' },
    { name: 'parent_not_top_level（挂进文件夹里的清单）', target: 'looseA', parent: 'inside' },
    { name: 'has_children（文件夹不能进文件夹）', target: 'folder', parent: 'looseB' },
    { name: 'cycle（挂进自己的子下面）', target: 'folder', parent: 'inside' },
  ];

  for (const { name, target, parent } of cases) {
    it(`${name}：rejects 且 op 数不变`, async () => {
      const tree = await seed();
      const entityId = tree[target];
      const parentId = parent === 'self' ? entityId : tree[parent];
      const before = await opCount(entityId);

      await expect(actions.setParent(entityId, parentId)).rejects.toThrow(/改父被拒绝/);

      expect(await opCount(entityId)).toBe(before);
      expect(engine.getState().projects[entityId]?.parentId ?? undefined).toBe(
        target === 'inside' ? tree.folder : undefined,
      );
    });
  }

  it('新父不存在：rejects parent_not_found，且不写出一个悬空引用', async () => {
    const { looseA } = await seed();
    const before = await opCount(looseA);
    await expect(actions.setParent(looseA, 'project-不存在')).rejects.toThrow('parent_not_found');
    expect(await opCount(looseA)).toBe(before);
  });

  it('被改的清单不存在：rejects project_not_found，其他清单一条都没被动', async () => {
    await seed();
    const total = (await engine.getPendingUpload()).length;
    await expect(actions.setParent('project-不存在', 'project-p-001')).rejects.toThrow(
      'project_not_found',
    );
    expect((await engine.getPendingUpload()).length).toBe(total);
  });
});
