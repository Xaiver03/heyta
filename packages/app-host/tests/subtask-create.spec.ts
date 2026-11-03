/**
 * 就地新建子任务（`createSubtask`）
 * =================================
 *
 * 这一族钉的是**两件静默失效**，它们都不报错：
 *
 *   1. 🔴 **拆成两条 op** 会让新任务先以顶级任务的身份出现在列表里；而如果第二条
 *      `setParent` 被上限拒绝，op-log 没有"撤回上一条"这回事 —— 用户看到"失败了"，
 *      库里却多出一条**永远挂不上的顶级任务**。所以判据是 `ops.length === 1`，
 *      而且被拒时要连着量"列表里没多东西"。
 *   2. 🔴 **不校验上限**就成了绕过 `MAX_SUBTASK_DEPTH` 的后门：界面上能建出第 4 层，
 *      `buildTaskTree` 只把它记进 `limitViolations` 上报、不截断，于是非法数据长期留在库里。
 *
 * ⚠️ vitest 不做类型检查（AGENTS §3.5 那条实测记录）：这个文件证明不了
 * `NewTaskFields` 里确实没有 `parentId`。那一格由 `tsc` 守 ——
 * 如果有人把 `parentId` 加回 `NewTaskFields`，`create(title, {parentId})`
 * 这条绕过路径就重新出现了，而**这里的测试仍然全绿**。
 */

import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import type { Operation } from '@heyta/sync-core';
import { beforeEach, describe, expect, it } from 'vitest';

import { MAX_SUBTASK_DEPTH } from '@heyta/domain';
import { createTaskActions, type TaskActions } from '../src/actions.js';

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let actions: TaskActions;
const clock = 1_700_000_000_000;

let idSeq = 0;
const makeId = (): string => {
  idSeq += 1;
  return `sub-t-${String(idSeq).padStart(3, '0')}`;
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
    now: () => clock,
  });
  idSeq = 0;
  actions = createTaskActions(engine, { now: () => clock, newTaskId: makeId });
});

function payloadOf(op: Operation<string>): Record<string, unknown> {
  return op.payload as Record<string, unknown>;
}

const opsOf = (entityId: string): Promise<Operation<string>[]> =>
  engine.getOpsForEntity('TASK', entityId);

const taskById = (id: string) => actions.listTasks().find((t) => t.id === id);

describe('createSubtask 只发一条 op', () => {
  it('🔴 载荷里就带 parentId，且这条任务名下**只有 1 条 op**', async () => {
    const parentId = await actions.create('父任务');
    const childId = await actions.createSubtask(parentId, '  子任务  ');

    const ops = await opsOf(childId);
    expect(ops, '建子任务被拆成了两条 op').toHaveLength(1);
    expect(ops[0]!.entityType).toBe('TASK');
    expect(payloadOf(ops[0]!).parentId).toBe(parentId);
    // trim 与默认优先级由共用的那条 CREATE 发射负责，不重新实现一遍。
    expect(payloadOf(ops[0]!).title).toBe('子任务');

    expect(taskById(childId)?.parentId).toBe(parentId);
  });

  it('标题为空 ⇒ throw（与 `create` 同一条规则，不是静默建出一条空任务）', async () => {
    const parentId = await actions.create('父任务');
    await expect(actions.createSubtask(parentId, '   ')).rejects.toThrow(/标题/);
    expect(actions.listTasks()).toHaveLength(1);
  });
});

describe('子任务继承父所在的清单', () => {
  it('父在项目里 ⇒ 子任务的载荷带同一个 projectId', async () => {
    const parentId = await actions.create('项目里的父', { projectId: 'p-1' });
    const childId = await actions.createSubtask(parentId, '子任务');

    expect(payloadOf((await opsOf(childId))[0]!).projectId).toBe('p-1');
    expect(taskById(childId)?.projectId).toBe('p-1');
  });

  it('🔴 父在收集箱 ⇒ 载荷里**没有** projectId，而不是写成 null', async () => {
    // '没有这个字段' 与 '显式清除' 是两回事（actions.ts 文件头第 2 条）。
    // CREATE 载荷里写 `projectId: null` 会被读成"这条任务显式不属于任何清单"，
    // 而它其实只是"跟父一样没归类"。
    const parentId = await actions.create('收集箱里的父');
    const childId = await actions.createSubtask(parentId, '子任务');

    const payload = payloadOf((await opsOf(childId))[0]!);
    expect('projectId' in payload).toBe(false);
    expect(taskById(childId)?.projectId).toBeUndefined();
  });
});

describe('上限校验（深度后门被堵住）', () => {
  it('一层层建到最深仍放行，再往下建 ⇒ 拒绝且原因可机读', async () => {
    const chain: string[] = [await actions.create('第 0 层')];
    // 顶层 depth=0，MAX_SUBTASK_DEPTH=3 ⇒ 最深可建到第 3 层，共 4 个节点。
    for (let level = 1; level <= MAX_SUBTASK_DEPTH; level += 1) {
      chain.push(await actions.createSubtask(chain[level - 1]!, `第 ${level} 层`));
    }
    expect(taskById(chain[MAX_SUBTASK_DEPTH]!)?.parentId).toBe(chain[MAX_SUBTASK_DEPTH - 1]);

    const before = actions.listTasks().length;
    await expect(actions.createSubtask(chain[MAX_SUBTASK_DEPTH]!, '第 4 层')).rejects.toThrow(
      /（depth_exceeded）/,
    );
    // 🔴 这一格才是"两条 op"方案真正会坏的地方：拒绝之后**库里不许多出一条**。
    expect(actions.listTasks()).toHaveLength(before);
  });

  it('父不存在 ⇒ parent_not_found，同样不留脏数据', async () => {
    await expect(actions.createSubtask('ghost', '孤儿')).rejects.toThrow(/（parent_not_found）/);
    expect(actions.listTasks()).toHaveLength(0);
  });

  it('🔴 已软删除的父也不能挂孩子（原因串与改父同词表）', async () => {
    const parentId = await actions.create('要被删掉的父');
    await actions.remove(parentId);
    await expect(actions.createSubtask(parentId, '挂上来的子')).rejects.toThrow(
      /（parent_not_found）/,
    );
  });

  it('括号里的原因串形状与 `setParent` 一致', async () => {
    // 界面只有一份「原因 → 人话」映射表（`packages/ui/src/subtasks/model.ts`），
    // 它用 `/（([a-z_]+)）/` 取原因。两个写入口若有一方换了形状，
    // 用户在界面上看到的就只剩"操作无效"那句兜底文案。
    const parentId = await actions.create('父任务');
    const message = await actions
      .createSubtask('ghost', '子任务')
      .then(() => '')
      .catch((cause: unknown) => (cause as Error).message);
    const match = /（([a-z_]+)）/.exec(message);
    expect(match?.[1]).toBe('parent_not_found');
  });
});
