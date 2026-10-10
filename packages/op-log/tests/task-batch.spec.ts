import { describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DbOpLogStore, MemoryDbAdapter, INDEXEDDB_SCHEMA, IndexedDbAdapter, SqliteAdapter, type DbAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType, type Operation } from '@heyta/sync-core';
import { OpLogEngine } from '../src/engine.js';
import { applyOperation, emptyState, replayOperations, serializeMaterializedState, deserializeMaterializedState } from '../src/state.js';

const source = { version: 1, eventId: 'event', ruleId: 'rule', ruleVersion: 1, parseVersion: 1, digest: 'a'.repeat(64) };
const batch = (): Operation<string> => ({
  id: 'inbound:event', clientId: 'a', entityType: 'TASK', entityId: 'inbound:event:0', entityIds: ['inbound:event:1'],
  opType: OpType.Batch, actionType: 'BATCH_TASK', vectorClock: { a: 1 }, timestamp: 100, schemaVersion: 1,
  payload: { heytaTaskBatch: 1, source, tasks: [
    { id: 'inbound:event:0', title: 'First', priority: 1, note: 'One' },
    { id: 'inbound:event:1', title: 'Second', priority: 3, startDate: 2000, durationMinutes: 90 },
  ] },
});

const factories: Record<string, () => DbAdapter> = {
  memory: () => new MemoryDbAdapter(INDEXEDDB_SCHEMA),
  indexeddb: () => {
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
    return new IndexedDbAdapter('inbound-batch');
  },
  sqlite: () => new SqliteAdapter({ schema: INDEXEDDB_SCHEMA, driverFactory: () => new NodeSqliteDriver(':memory:') }),
};

for (const [name, create] of Object.entries(factories)) {
  describe(`atomic task batch / ${name}`, () => {
    async function fixture(run: (engine: OpLogEngine, store: DbOpLogStore<Operation<string>>) => Promise<void>) {
      const db = create();
      await db.init();
      const store = new DbOpLogStore<Operation<string>>(db, 0);
      const engine = new OpLogEngine({ store, clientId: 'a', now: () => 100, nextOpId: () => 'inbound:event' });
      try { await run(engine, store); } finally { db.close(); }
    }

    it('persists one operation with distinct items, restarts, checkpoints and replays without extra ops', async () => {
      await fixture(async (engine, store) => {
        const op = batch();
        await engine.dispatch({ entityType: 'TASK', entityId: op.entityId!, entityIds: op.entityIds, opType: OpType.Batch, payload: op.payload });
        expect(await store.getAllOps()).toHaveLength(1);
        expect(engine.getState().tasks['inbound:event:0']).toMatchObject({ title: 'First', note: 'One', createdAt: 100, automationSource: { eventId: 'event', itemIndex: 0 } });
        expect(engine.getState().tasks['inbound:event:1']).toMatchObject({ title: 'Second', startDate: 2000, durationMinutes: 90, automationSource: { itemIndex: 1 } });
        await engine.checkpoint();
        await store.markUploaded(new Map([['inbound:event', 1]]));
        await store.archiveUpTo(1);
        const reboot = new OpLogEngine({ store, clientId: 'a' });
        await reboot.recover();
        expect(reboot.getState()).toEqual(engine.getState());
        await reboot.applyRemote([op, op]);
        // The same *local* intent recovers its archived row without scanning.
        const noScan = vi.spyOn(store, 'getAllOps').mockRejectedValue(new Error('unexpected full scan'));
        const retry = await reboot.dispatch({ entityType: 'TASK', entityId: op.entityId!, entityIds: op.entityIds, opType: OpType.Batch, payload: op.payload });
        expect(retry.ops[0]?.id).toBe('inbound:event');
        noScan.mockRestore();
        expect(await store.getAllOps()).toHaveLength(1);
        expect(reboot.getState()).toEqual(engine.getState());
        expect(deserializeMaterializedState(serializeMaterializedState(reboot.getState()))).toEqual(reboot.getState());
      });
    });

    it('rejects a bad member before local, remote or imported persistence', async () => {
      await fixture(async (engine, store) => {
        const op = batch();
        const invalid = { ...op, payload: { ...(op.payload as object), tasks: [
          { id: 'inbound:event:0', title: 'Valid first member', priority: 0 },
          { id: 'inbound:event:1', title: '', priority: 0 },
        ] } };
        await expect(engine.dispatch({ entityType: 'TASK', entityId: 'inbound:event:0', entityIds: ['inbound:event:1'], opType: OpType.Batch, payload: invalid.payload })).rejects.toThrow();
        await expect(engine.applyRemote([invalid])).rejects.toThrow();
        await expect(engine.importOperations([invalid])).rejects.toThrow();
        expect(await store.getAllOps()).toHaveLength(0);
        expect(engine.getState()).toEqual(emptyState());
      });
    });

    it('storage failure leaves neither in-memory member visible', async () => {
      await fixture(async (engine, store) => {
        const fail = vi.spyOn(store, 'appendLocal').mockRejectedValueOnce(new Error('injected storage failure'));
        const op = batch();
        await expect(engine.dispatch({ entityType: 'TASK', entityId: 'inbound:event:0', entityIds: ['inbound:event:1'], opType: OpType.Batch, payload: op.payload })).rejects.toThrow('injected');
        expect(engine.getState()).toEqual(emptyState());
        expect(await store.getAllOps()).toHaveLength(0);
        fail.mockRestore();
      });
    });

    it('coalesces two independent engine instances through the unique index and refuses changed content', async () => {
      await fixture(async (engine, store) => {
        const second = new OpLogEngine({ store, clientId: 'a', now: () => 900 });
        const op = batch();
        const intent = { entityType: 'TASK' as const, entityId: op.entityId!, entityIds: op.entityIds, opType: OpType.Batch, payload: op.payload };
        const results = await Promise.all([engine.dispatch(intent), second.dispatch(intent)]);
        expect(results[0]?.ops).toEqual(results[1]?.ops);
        expect(await store.getAllOps()).toHaveLength(1);
        expect(engine.getState()).toEqual(second.getState());
        const changed = structuredClone(op.payload) as { tasks: Array<{ title: string }> };
        changed.tasks[0]!.title = 'Changed';
        await expect(second.dispatch({ ...intent, payload: changed })).rejects.toThrow('identity conflict');
        const foreign = new OpLogEngine({ store, clientId: 'b' });
        await expect(foreign.dispatch(intent)).rejects.toThrow('identity conflict');
        expect(await store.getAllOps()).toHaveLength(1);
      });
    });
  });
}

it('preserves edits and tombstones for fixed-seed remote delivery permutations', async () => {
  const original = batch();
  const edit: Operation<string> = { ...original, id: 'edit', entityId: 'inbound:event:0', entityIds: undefined, clientId: 'b', opType: OpType.Update, payload: { title: 'Edited' }, vectorClock: { a: 1, b: 1 }, timestamp: 200 };
  const deletion: Operation<string> = { ...edit, id: 'delete', entityId: 'inbound:event:1', opType: OpType.Delete, payload: {}, vectorClock: { a: 1, b: 2 }, timestamp: 300 };
  const canonical = replayOperations(emptyState(), [original, edit, deletion]);
  for (const seed of [1, 7, 23, 97]) {
    let value = seed;
    const ops = [original, edit, deletion, original, edit];
    for (let i = ops.length - 1; i > 0; i--) {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      const j = value % (i + 1);
      [ops[i], ops[j]] = [ops[j]!, ops[i]!];
    }
    for (const delivery of [ops, [...ops].reverse()]) {
      const db = new MemoryDbAdapter(INDEXEDDB_SCHEMA); await db.init();
      const store = new DbOpLogStore<Operation<string>>(db, 0);
      const engine = new OpLogEngine({ store, clientId: `observer-${seed}` });
      try {
        for (const op of delivery) await engine.applyRemote([op]);
        expect(engine.getState(), `seed=${seed}`).toEqual(canonical);
        expect(engine.getClock(), `seed=${seed}`).toEqual({ a: 1, b: 2 });
        expect(await store.getAllOps(), `seed=${seed}`).toHaveLength(3);
      } finally { db.close(); }
    }
  }
  expect(canonical.tasks['inbound:event:0']?.title).toBe('Edited');
  expect(canonical.tasks['inbound:event:1']?.deletedAt).toBe(300);
});

it('recovers a real SQLite file when append completed but the caller lost its response', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-inbound-batch-'));
  const open = () => new SqliteAdapter({ schema: INDEXEDDB_SCHEMA, driverFactory: () => new NodeSqliteDriver(join(dir, 'state.db')) });
  let db = open();
  try {
    await db.init();
    const store = new DbOpLogStore<Operation<string>>(db, 0);
    const append = store.appendLocal.bind(store);
    vi.spyOn(store, 'appendLocal').mockImplementation(async (ops) => { await append(ops); throw new Error('response lost'); });
    const engine = new OpLogEngine({ store, clientId: 'a', now: () => 100, nextOpId: () => 'inbound:event' });
    await expect(engine.dispatch({ entityType: 'TASK', entityId: 'inbound:event:0', entityIds: ['inbound:event:1'], opType: OpType.Batch, payload: batch().payload })).rejects.toThrow('response lost');
    expect(engine.getState()).toEqual(emptyState());
    await engine.dispatch({ entityType: 'TASK', entityId: 'inbound:event:0', entityIds: ['inbound:event:1'], opType: OpType.Batch, payload: batch().payload });
    expect(Object.keys(engine.getState().tasks)).toHaveLength(2);
    db.close(); db = open(); await db.init();
    const reopenedStore = new DbOpLogStore<Operation<string>>(db, 0);
    const reboot = new OpLogEngine({ store: reopenedStore, clientId: 'a' });
    await reboot.recover();
    await reboot.dispatch({ entityType: 'TASK', entityId: 'inbound:event:0', entityIds: ['inbound:event:1'], opType: OpType.Batch, payload: batch().payload });
    expect(Object.keys(reboot.getState().tasks)).toEqual(['inbound:event:0', 'inbound:event:1']);
    expect(await reopenedStore.getAllOps()).toHaveLength(1);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('refuses to recreate a receipt recovered only from a full-state snapshot', async () => {
  const db = new MemoryDbAdapter(INDEXEDDB_SCHEMA); await db.init();
  const sourceDb = new MemoryDbAdapter(INDEXEDDB_SCHEMA); await sourceDb.init();
  const sourceStore = new DbOpLogStore<Operation<string>>(sourceDb, 0);
  const store = new DbOpLogStore<Operation<string>>(db, 0);
  const op = batch();
  const original = new OpLogEngine({ store: sourceStore, clientId: 'a' });
  const engine = new OpLogEngine({ store, clientId: 'a' });
  try {
    await original.applyRemote([op]);
    const checkpoint = await original.createSyncCheckpoint();
    await engine.applyRemote(checkpoint.ops);
    expect(engine.getState().tasks['inbound:event:0']?.automationSource?.eventId).toBe('event');
    await expect(engine.dispatch({ entityType: 'TASK', entityId: op.entityId!, entityIds: op.entityIds, opType: OpType.Batch, payload: op.payload })).rejects.toThrow('reconciliation');
    expect(await store.getAllOps()).toHaveLength(1); // only the REPAIR, no recreated batch
  } finally { db.close(); sourceDb.close(); }
});

it('rejects unknown markers without corrupting ordinary batches or old tasks', () => {
  const op = batch();
  expect(() => applyOperation(emptyState(), { ...op, payload: { heytaTaskBatch: 2 } })).toThrow();
  const shared = applyOperation(emptyState(), { ...op, payload: { title: 'Shared' } });
  expect(shared.tasks['inbound:event:0']?.title).toBe('Shared');
  expect(shared.tasks['inbound:event:1']?.automationSource).toBeUndefined();
});
