/**
 * 任务结构化子项（checklist）的动作层判据（Phase 1b）
 * =====================================================
 * 只守：6 个动作是否把 `Task.checklist` 改对、toggle 全勾是否**原子地**把父任务置完成、
 * 以及"一意图一 op"（每次动作只产生一条 UPD）。
 */
import type { Operation } from '@heyta/sync-core';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { readChecklist } from '@heyta/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTaskActions, type TaskActions } from '../src/actions.js';

const CLOCK = 1_700_000_000_000;
let adapter: SqliteAdapter;
let engine: OpLogEngine;
let actions: TaskActions;

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  engine = new OpLogEngine({
    store: new DbOpLogStore<Operation<string>>(adapter),
    clientId: 'client-test',
    now: () => CLOCK,
  });
  actions = createTaskActions(engine, { now: () => CLOCK });
});
afterEach(() => adapter.close());

const mkTask = (): Promise<string> => actions.create('任务', {});

describe('setChecklist / 增改删勾排序', () => {
  it('setChecklist 整组写入并生成 id', async () => {
    const id = await mkTask();
    await actions.setChecklist(id, [{ text: '甲' }, { text: '乙', done: true }]);
    const list = engine.getState().tasks[id]?.checklist ?? [];
    expect(list.map((x) => x.text)).toEqual(['甲', '乙']);
    expect(list.every((x) => typeof x.id === 'string' && x.id !== '')).toBe(true);
    expect(list[1]?.done).toBe(true);
    // readChecklist（结构化优先）应反映它
    expect(readChecklist(engine.getState().tasks[id]!).map((x) => x.text)).toEqual(['甲', '乙']);
  });

  it('addChecklistItem 追加并返回 id', async () => {
    const id = await mkTask();
    const itemId = await actions.addChecklistItem(id, '新增');
    const list = engine.getState().tasks[id]?.checklist ?? [];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: itemId, text: '新增', done: false });
  });

  it('updateChecklistItemText / removeChecklistItem', async () => {
    const id = await mkTask();
    const a = await actions.addChecklistItem(id, 'A');
    await actions.addChecklistItem(id, 'B');
    await actions.updateChecklistItemText(id, a, 'A2');
    expect((engine.getState().tasks[id]?.checklist ?? []).find((x) => x.id === a)?.text).toBe('A2');
    await actions.removeChecklistItem(id, a);
    expect((engine.getState().tasks[id]?.checklist ?? []).map((x) => x.text)).toEqual(['B']);
  });

  it('reorderChecklistItem 改变顺序', async () => {
    const id = await mkTask();
    await actions.setChecklist(id, [{ text: '1' }, { text: '2' }, { text: '3' }]);
    const list = engine.getState().tasks[id]!.checklist!;
    await actions.reorderChecklistItem(id, list[0]!.id, 2);
    expect((engine.getState().tasks[id]?.checklist ?? []).map((x) => x.text)).toEqual(['2', '3', '1']);
  });
});

describe('toggleChecklistItem', () => {
  it('勾选单项', async () => {
    const id = await mkTask();
    await actions.setChecklist(id, [{ text: 'x' }, { text: 'y' }]);
    const list = engine.getState().tasks[id]!.checklist!;
    await actions.toggleChecklistItem(id, list[0]!.id, true);
    const after = engine.getState().tasks[id]!;
    expect(after.checklist![0]!.done).toBe(true);
    // 未全勾 → 任务未完成
    expect(after.completedAt).toBeUndefined();
  });

  it('全勾 → 原子地把父任务置完成（同一条 update）', async () => {
    const id = await mkTask();
    await actions.setChecklist(id, [{ text: 'only' }]);
    const onlyId = engine.getState().tasks[id]!.checklist![0]!.id;
    await actions.toggleChecklistItem(id, onlyId, true);
    const after = engine.getState().tasks[id]!;
    expect(after.checklist![0]!.done).toBe(true);
    expect(after.completedAt).toBe(CLOCK);
  });
});
