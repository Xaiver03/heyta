import { describe, expect, it } from 'vitest';

import { Priority } from '@heyta/domain';
import { OpType, type Operation } from '@heyta/sync-core';
import { DbOpLogStore, INDEXEDDB_SCHEMA, MemoryDbAdapter } from '@heyta/storage';
import { OpLogEngine } from '../src/engine.js';

import { applyOperation, emptyState, replayOperations } from '../src/state.js';

function createTask(id: string, timestamp = 1): Operation<string> {
  return {
    id: `create-${id}`,
    opType: OpType.Create,
    actionType: 'CRT_TASK',
    entityType: 'TASK',
    entityId: id,
    payload: { title: id, priority: Priority.None },
    clientId: 'seed',
    vectorClock: { seed: timestamp },
    timestamp,
    schemaVersion: 1,
  };
}

function priorityBatch(
  id: string,
  clientId: string,
  vectorClock: Record<string, number>,
  timestamp: number,
  items: readonly { id: string; priority: Priority }[],
): Operation<string> {
  return {
    id,
    opType: OpType.Batch,
    actionType: 'BATCH_TASK',
    entityType: 'TASK',
    entityId: items[0]!.id,
    entityIds: items.slice(1).map((item) => item.id),
    payload: { heytaTaskPriorityBatch: 1, items },
    clientId,
    vectorClock,
    timestamp,
    schemaVersion: 1,
  };
}

describe('task priority batch marker', () => {
  it('updates multiple tasks with distinct priorities as one replayable operation', () => {
    const one = createTask('task-1');
    const two = createTask('task-2');
    const batch = priorityBatch('priority-1', 'client-a', { seed: 2, 'client-a': 1 }, 2, [
      { id: 'task-1', priority: Priority.Low },
      { id: 'task-2', priority: Priority.High },
    ]);

    let state = applyOperation(emptyState(), one);
    state = applyOperation(state, two);
    state = applyOperation(state, batch);
    expect(state.tasks['task-1']?.priority).toBe(Priority.Low);
    expect(state.tasks['task-2']?.priority).toBe(Priority.High);
    expect(replayOperations(emptyState(), [one, two, batch])).toEqual(state);
  });

  it('applies LWW independently per task and is order independent under concurrency', () => {
    const seedOne = createTask('task-1');
    const seedTwo = createTask('task-2');
    const older = priorityBatch('priority-a', 'client-a', { seed: 1, 'client-a': 1 }, 10, [
      { id: 'task-1', priority: Priority.High },
      { id: 'task-2', priority: Priority.Low },
    ]);
    const newer = priorityBatch('priority-b', 'client-b', { seed: 1, 'client-b': 1 }, 20, [
      { id: 'task-1', priority: Priority.Low },
      { id: 'task-2', priority: Priority.High },
    ]);

    const forward = replayOperations(emptyState(), [seedOne, seedTwo, older, newer]);
    const reverse = replayOperations(emptyState(), [seedOne, seedTwo, newer, older]);
    expect(forward.tasks['task-1']?.priority).toBe(Priority.Low);
    expect(forward.tasks['task-2']?.priority).toBe(Priority.High);
    expect(reverse).toEqual(forward);
  });

  it('rejects duplicate or mismatched scope before changing state', () => {
    const initial = applyOperation(emptyState(), createTask('task-1'));
    const invalid = priorityBatch('bad', 'client-a', { 'client-a': 1 }, 2, [
      { id: 'task-1', priority: Priority.High },
      { id: 'task-1', priority: Priority.Low },
    ]);
    expect(() => applyOperation(initial, invalid)).toThrow();
    expect(initial.tasks['task-1']?.priority).toBe(Priority.None);

    const mismatched = { ...priorityBatch('bad-scope', 'client-a', { 'client-a': 1 }, 2, [
      { id: 'task-1', priority: Priority.High },
    ]), entityId: 'other' };
    expect(() => applyOperation(initial, mismatched)).toThrow('scope');
    expect(initial.tasks['task-1']?.priority).toBe(Priority.None);
  });

  it('clones caller payloads before queueing and isolates state/store references', async () => {
    const db = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
    await db.init();
    const store = new DbOpLogStore<Operation<string>>(db);
    const engine = new OpLogEngine({ store, clientId: 'client-a', now: () => 1_000 });
    await engine.recover();
    await engine.dispatch({ entityType: 'TASK', entityId: 'task-1', opType: OpType.Create, payload: { title: '任务' } });

    const tagIds = ['tag-a'];
    const pending = engine.dispatch({
      entityType: 'TASK',
      entityId: 'task-1',
      opType: OpType.Update,
      payload: { tagIds },
    });
    tagIds.push('tag-b');
    const result = await pending;

    expect(engine.getState().tasks['task-1']?.tagIds).toEqual(['tag-a']);
    expect((result.ops[0]?.payload as { tagIds: string[] }).tagIds).toEqual(['tag-a']);
    (result.ops[0]?.payload as { tagIds: string[] }).tagIds.push('tag-c');
    expect(engine.getState().tasks['task-1']?.tagIds).toEqual(['tag-a']);
    expect(((await store.getAllOps()).at(-1)?.op.payload as { tagIds: string[] }).tagIds).toEqual(['tag-a']);
  });

  it('snapshots nested clocks and preserves a JSON __proto__ key as data', async () => {
    const db = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
    await db.init();
    const store = new DbOpLogStore<Operation<string>>(db);
    const engine = new OpLogEngine({ store, clientId: 'client-a', now: () => 1_000 });
    await engine.recover();

    const payload = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    const local = await engine.dispatch({
      entityType: 'GLOBAL_CONFIG',
      entityId: 'config',
      opType: OpType.Update,
      payload,
    });
    expect(Object.prototype.hasOwnProperty.call(local.ops[0]?.payload, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(local.ops[0]?.payload)).toBe(Object.prototype);

    const remote: Operation<string> = {
      id: 'remote-clock',
      opType: OpType.Update,
      actionType: 'UPD_TASK',
      entityType: 'TASK',
      entityId: 'task-1',
      payload: { title: '远端' },
      clientId: 'remote',
      vectorClock: { remote: 1 },
      timestamp: 2_000,
      schemaVersion: 1,
    };
    const applied = await engine.applyRemote([remote]);
    remote.vectorClock.remote = 99;
    const returned = applied.applied[0]!;
    returned.vectorClock.remote = 88;
    expect((await store.getAllOps()).at(-1)?.op.vectorClock).toEqual({ remote: 1 });
    expect((engine.getState().tasks['task-1'] as { _lastClock?: unknown })?._lastClock).toEqual({ remote: 1 });
  });
});
