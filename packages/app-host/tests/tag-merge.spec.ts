/**
 * 标签合并 / 批量删（R8）—— 一条 op 的判据面
 * =============================================
 *
 * 这一组钉四件事（`docs/plans/package-b-2026-11.md` R8）：
 *
 *   1. **合并 = 一条 op**：`{ deletedAt, mergedInto }` 落在**源标签**上，
 *      任务一条都不写。N 条任务被"改写"的做法与 §3.4 冲突（顺序/载荷都会整片覆盖），
 *      而且崩在第 k 条会留下半截状态。
 *   2. **合并之后没有任何任务还挂着被合并掉的那条** —— 按**有效**标签算
 *      （`resolveTagIds`）。这是判据 R8-②的前半句。
 *   3. **可撤销**：它是普通单实体 `UPD` ⇒ `history.ts` 的 `undo()` 算得出反向意图
 *      （清掉 `mergedInto` 与 `deletedAt`），撤销后那张标签与所有引用一起回来。
 *   4. **批量删 = 一条 DEL op 带 `entityIds`**（同类型同载荷的既有批量形状）。
 */

import { resolveTagIds } from '@heyta/domain';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType, type Operation } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTaskActions, type TaskActions } from '../src/actions.js';
import { createProjectActions, type ProjectActions } from '../src/project-actions.js';
import { createTagManagementActions, type TagManagementActions } from '../src/tag-actions.js';

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let tasks: TaskActions;
let projects: ProjectActions;
let tags: TagManagementActions;
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
    clientId: 'client-tag-test',
    now,
  });
  const ctx = { dispatch: (intent: Parameters<OpLogEngine['dispatch']>[0]) => engine.dispatch(intent), getState: () => engine.getState() };
  tasks = createTaskActions(ctx as never, { now });
  projects = createProjectActions(ctx as never, { now });
  tags = createTagManagementActions(ctx as never, { now });
  clock = 1_790_000_000_000;
});

afterEach(() => {
  adapter.close();
});

function payloadOf(op: Operation<string>): Record<string, unknown> {
  return op.payload as Record<string, unknown>;
}

async function opsOf(entityType: 'TAG' | 'TASK', entityId: string): Promise<Operation<string>[]> {
  return engine.getOpsForEntity(entityType, entityId);
}

/** A、B 两条标签；三条任务里两条挂着 A。 */
async function seed(): Promise<{ a: string; b: string; t1: string; t2: string; t3: string }> {
  const a = await projects.createTag('会议');
  const b = await projects.createTag('工作');
  const t1 = await tasks.create('周一例会');
  const t2 = await tasks.create('整理会议记录');
  const t3 = await tasks.create('买菜');
  await tasks.setTags(t1, [a]);
  await tasks.setTags(t2, [a]);
  await tasks.setTags(t3, [b]);
  return { a, b, t1, t2, t3 };
}

describe('R8-② 合并：一条 op，且没有任何任务还挂着被合并掉的那条', () => {
  it('合并 A→B 只写**源标签**的一条 op，任务的 `tagIds` 一个字都不动', async () => {
    const { a, b, t1, t2 } = await seed();
    const before = await opsOf('TAG', a);
    const taskOpsBefore = (await opsOf('TASK', t1)).length + (await opsOf('TASK', t2)).length;

    await tags.merge(a, b);

    const after = await opsOf('TAG', a);
    expect(after.length, '合并只允许产生一条 op（落在源标签上）').toBe(before.length + 1);
    const op = after.find((item) => 'mergedInto' in payloadOf(item))!;
    expect(op).toBeDefined();
    expect(payloadOf(op)['mergedInto']).toBe(b);
    expect(payloadOf(op)['deletedAt'], '墓碑与去向必须在同一条 op 里').toBe(clock);
    // 🔴 任务一条 op 都没多 —— 这就是"合并 = 一条 op"的现量读数。
    expect((await opsOf('TASK', t1)).length + (await opsOf('TASK', t2)).length).toBe(taskOpsBefore);
    // 而且任务上的原始引用**仍然留着**（读侧解析，见 domain/tags.ts）。
    expect(engine.getState().tasks[t1]?.tagIds).toEqual([a]);
  });

  it('合并之后"有效标签"里没有任何任务还挂着 A', async () => {
    const { a, b, t1, t2 } = await seed();
    await tags.merge(a, b);
    const state = engine.getState();
    const t1Tags = resolveTagIds(state.tasks[t1]?.tagIds, state.tags);
    const t2Tags = resolveTagIds(state.tasks[t2]?.tagIds, state.tags);
    expect(t1Tags, 'A 已经不存在了：它合并进了 B').toEqual([b]);
    expect(t2Tags).toEqual([b]);
    // A 本身从"活着的标签"里消失（侧栏/筛选/统计都不会再列出它）。
    expect(state.tags[a]?.deletedAt).toBe(clock);
    expect(Object.values(state.tags).filter((tag) => tag.deletedAt === undefined).map((tag) => tag.id).sort()).toEqual(
      [b].sort(),
    );
  });

  it('usageCount 把别名指过来的任务算到目标头上（界面别自己数 tagIds）', async () => {
    const { a, b } = await seed();
    expect(tags.usageCount(a)).toBe(2);
    await tags.merge(a, b);
    expect(tags.usageCount(b), 'A 上的两条现在算 B 的').toBe(3);
  });

  it('拒绝的形状：合并进自己 / 已经在链上 / 目标不存在 —— 全部零 op', async () => {
    const { a, b } = await seed();
    const before = (await opsOf('TAG', a)).length;
    await expect(tags.merge(a, a)).rejects.toThrow(/自己/);
    await expect(tags.merge(a, 'tag-nope')).rejects.toThrow(/找不到标签/);
    await tags.merge(a, b);
    // 再合一次：源已经进墓碑 ⇒ 它现在就是"不存在的标签"（`aliveTag` 判它不在）。
    await expect(tags.merge(a, b)).rejects.toThrow(/找不到标签/);
    expect((await opsOf('TAG', a)).length, '拒绝时只多出那一条成功的').toBe(before + 1);
  });

  it('mergeImpact 给的是**有效**任务数（确认框里的人话不能自己算）', async () => {
    const { a, b } = await seed();
    const impact = tags.mergeImpact(a, b)!;
    expect(impact.taskCount).toBe(2);
    expect(impact.sourceName).toBe('会议');
    expect(impact.targetName).toBe('工作');
    expect(tags.mergeImpact(a, 'tag-nope')).toBeUndefined();
  });
});

describe('R8-② 合并可撤销：一条 op 的逆', () => {
  it('undo() 之后标签与所有引用一起回来', async () => {
    const { a, b, t1 } = await seed();
    await tags.merge(a, b);
    expect(engine.getState().tags[a]?.deletedAt).toBe(clock);

    const outcome = await engine.undo();
    expect(outcome.status, '合并必须可撤销（否则"合错了"无法退）').toBe('applied');
    const state = engine.getState();
    expect(state.tags[a]?.deletedAt).toBeUndefined();
    expect(state.tags[a]?.mergedInto).toBeUndefined();
    // 任务上的引用一直是 A，所以撤销之后它立刻又显示 A —— 不需要修任何任务。
    expect(resolveTagIds(state.tasks[t1]?.tagIds, state.tags)).toEqual([a]);
  });
});

describe('批量删：一条 DEL op 带 entityIds', () => {
  it('删两条标签只写一条 op，且两条都进墓碑', async () => {
    const a = await projects.createTag('甲');
    const b = await projects.createTag('乙');
    const before = (await opsOf('TAG', a)).length;

    await tags.removeMany([a, b]);

    const after = await opsOf('TAG', a);
    expect(after.length, '批量删是一条 op（同类型同载荷的既有批量形状）').toBe(before + 1);
    const del = after.find((item) => item.opType === OpType.Delete)!;
    expect(del.entityIds, '批量域里带上了第二条').toEqual([b]);
    expect(engine.getState().tags[a]?.deletedAt).not.toBeUndefined();
    expect(engine.getState().tags[b]?.deletedAt).not.toBeUndefined();
  });

  it('空集合 / 不存在的 id：不写 op / 抛错', async () => {
    const a = await projects.createTag('甲');
    const before = (await opsOf('TAG', a)).length;
    await tags.removeMany([]);
    expect((await opsOf('TAG', a)).length).toBe(before);
    await expect(tags.removeMany(['tag-nope'])).rejects.toThrow(/找不到标签/);
    expect((await opsOf('TAG', a)).length).toBe(before);
  });
});

describe('改名：一条 op，引用它的任务一个都不碰', () => {
  it('改名只写 `name`，任务的 tagIds 不变', async () => {
    const { a, t1 } = await seed();
    const before = (await opsOf('TASK', t1)).length;
    await projects.renameTag(a, '例会');
    expect(engine.getState().tags[a]?.name).toBe('例会');
    expect(engine.getState().tasks[t1]?.tagIds).toEqual([a]);
    expect((await opsOf('TASK', t1)).length, '改名不碰任何任务').toBe(before);
    const rename = (await opsOf('TAG', a)).find(
      (op) => op.opType === OpType.Update && 'name' in payloadOf(op),
    )!;
    expect(payloadOf(rename), '改名只写 name 一个字段').toEqual({ name: '例会' });
  });
});
