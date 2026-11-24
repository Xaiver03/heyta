/**
 * 保存筛选（`FILTER`）动作层测试
 * ==============================
 *
 * 与 `event-actions.spec.ts` 同一取舍：**真实引擎 + 真实 SQLite（`:memory:`）**，零 mock。
 * 盯的是五类"op 写得出来、界面却不对"的静默失效：
 *
 *   1. 建筛选拆成多条 op / 名字与规则分两次写 → 两端看到半条筛选；
 *   2. 改名成同名、规则没变仍写 op → `updatedAt` 推进、顺序被扰动；
 *   3. 非法规则（未知 kind / 结构畸形）被接受 → 构建绿、本机再也打不开这条筛选；
 *   4. 删除写成物理删 / 还原写成不清墓碑 → 离线端把它同步回来；
 *   5. 顺序在动作层漏算 → "两端筛选结果一样、顺序不一样"。
 */

import type { Filter } from '@heyta/domain';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFilterActions, type FilterActions } from '../src/filter-actions.js';

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let actions: FilterActions;
let clock = 1_700_000_000_000;

let seq = 0;
const makeFilterId = (): string => {
  seq += 1;
  return `filter-t-${String(seq).padStart(3, '0')}`;
};

const state = (): { filters: Record<string, Filter> } =>
  engine.getState() as unknown as { filters: Record<string, Filter> };

const opsOf = async (entityId: string) => engine.getOpsForEntity('FILTER', entityId);
const lastPayload = async (entityId: string): Promise<Record<string, unknown>> => {
  const ops = await opsOf(entityId);
  const last = ops.at(-1);
  if (last === undefined) throw new Error(`没找到 ${entityId} 的 op`);
  return last.payload as Record<string, unknown>;
};

const highPriorityRule = { match: 'all', conditions: [{ kind: 'priority', values: [3] }] } as const;

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  engine = new OpLogEngine({ store: new DbOpLogStore(adapter), clientId: 'client-filter', now: () => clock });
  clock = 1_700_000_000_000;
  seq = 0;
  actions = createFilterActions(engine, { newFilterId: makeFilterId });
});

afterEach(() => {
  adapter.close();
});

describe('新建', () => {
  it('一条 FILTER Create op；名字 + 规则 + 空色槽/排序一起落库', async () => {
    const id = await actions.createFilter('我的高优先级', highPriorityRule as never);
    const ops = await opsOf(id);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.entityType).toBe('FILTER');
    expect(ops[0]?.opType).toBe(OpType.Create);
    expect(await lastPayload(id)).toMatchObject({
      name: '我的高优先级',
      rule: highPriorityRule,
      color: null,
      order: null,
    });
    expect(state().filters[id]?.name).toBe('我的高优先级');
  });

  it('名字去首尾空白', async () => {
    const id = await actions.createFilter('  工作  ', highPriorityRule as never);
    expect(state().filters[id]?.name).toBe('工作');
  });

  it('空名字 ⇒ 抛错且零 op（不建空名筛选）', async () => {
    await expect(actions.createFilter('   ', highPriorityRule as never)).rejects.toThrow();
    expect(Object.keys(state().filters)).toHaveLength(0);
  });

  it('🔴 未知 kind 的规则 ⇒ 抛错且零 op（本机打不开的规则不许落库）', async () => {
    const futureRule = { match: 'all', conditions: [{ kind: 'geoFence' }] } as never;
    await expect(actions.createFilter('未来规则', futureRule)).rejects.toThrow(/不合法/);
    expect(Object.keys(state().filters)).toHaveLength(0);
  });
});

describe('改名 / 改规则', () => {
  it('同名改名不写 op（不扰动 updatedAt 与顺序）', async () => {
    const id = await actions.createFilter('工作', highPriorityRule as never);
    await actions.renameFilter(id, '工作');
    expect(await opsOf(id)).toHaveLength(1);
    await actions.renameFilter(id, '我的工作');
    expect(await opsOf(id)).toHaveLength(2);
    expect(await lastPayload(id)).toEqual({ name: '我的工作' });
  });

  it('规则没变不写 op；变了写一条 UPD 且只带 rule', async () => {
    const id = await actions.createFilter('工作', highPriorityRule as never);
    await actions.updateFilterRule(id, highPriorityRule as never);
    expect(await opsOf(id)).toHaveLength(1);

    const nextRule = { match: 'any', conditions: [{ kind: 'today' }] } as const;
    await actions.updateFilterRule(id, nextRule as never);
    expect(await opsOf(id)).toHaveLength(2);
    expect(await lastPayload(id)).toEqual({ rule: nextRule });
  });

  it('改规则时非法结构 ⇒ 抛错且不写 op', async () => {
    const id = await actions.createFilter('工作', highPriorityRule as never);
    await expect(
      actions.updateFilterRule(id, { match: 'all', conditions: [{ kind: 'project', projectIds: [] }] } as never),
    ).rejects.toThrow();
    expect(await opsOf(id)).toHaveLength(1);
  });

  it('色槽 null = 明确清除（写 null，不是省略键）', async () => {
    const id = await actions.createFilter('工作', highPriorityRule as never, { color: 3 as never });
    await actions.setFilterColor(id, null);
    expect(await lastPayload(id)).toEqual({ color: null });
  });

  it('不存在的筛选 ⇒ 抛错（改名 / 改规则 / 排序 / 删除都挡在门口）', async () => {
    await expect(actions.renameFilter('nope', 'x')).rejects.toThrow();
    await expect(actions.updateFilterRule('nope', highPriorityRule as never)).rejects.toThrow();
    await expect(actions.setFilterOrder('nope', 1)).rejects.toThrow();
    await expect(actions.removeFilter('nope')).rejects.toThrow();
  });
});

describe('删除 / 还原（软删，ADR-0048 四态）', () => {
  it('删除发 DEL；还原清墓碑；不在回收站时返回 false 且不写 op', async () => {
    const id = await actions.createFilter('工作', highPriorityRule as never);
    await actions.removeFilter(id);
    expect((await opsOf(id)).at(-1)?.opType).toBe(OpType.Delete);
    expect(actions.filterOf(id)).toBeUndefined();

    expect(await actions.restoreFilter(id)).toBe(true);
    expect(await lastPayload(id)).toEqual({ deletedAt: null });
    expect(actions.filterOf(id)?.name).toBe('工作');

    // 第二次还原：本来就不在回收站 ⇒ false，不写 op。
    const before = (await opsOf(id)).length;
    expect(await actions.restoreFilter(id)).toBe(false);
    expect((await opsOf(id)).length).toBe(before);
  });
});

describe('listFilters 规范顺序', () => {
  it('order 升序；缺 order 的排在有 order 之后；同 order 按名字、再按 id', async () => {
    const a = await actions.createFilter('b-name', highPriorityRule as never, { order: 2 as never });
    const b = await actions.createFilter('a-name', highPriorityRule as never, { order: 2 as never });
    const c = await actions.createFilter('zzz', highPriorityRule as never); // 无 order
    const d = await actions.createFilter('first', highPriorityRule as never, { order: 1 as never });

    expect(actions.listFilters().map((f) => f.id)).toEqual([d, b, a, c]);
  });

  it('已删除的不出现在列表里', async () => {
    const a = await actions.createFilter('a', highPriorityRule as never);
    await actions.removeFilter(a);
    expect(actions.listFilters()).toEqual([]);
  });
});
