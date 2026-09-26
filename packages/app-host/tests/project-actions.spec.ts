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