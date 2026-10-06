import { describe, expect, it } from 'vitest';
import { DbOpLogStore, MemoryDbAdapter, INDEXEDDB_SCHEMA } from '@heyta/storage';
import { OpType, type Operation } from '@heyta/sync-core';
import { OpLogEngine } from '../src/engine.js';
import { applyOperation, emptyState, serializeMaterializedState } from '../src/state.js';

async function device(clientId: string) {
  const db = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
  await db.init();
  const store = new DbOpLogStore<Operation<string>>(db);
  let id = 0;
  const engine = new OpLogEngine({ store, clientId, now: () => 10, nextOpId: () => `${clientId}-${++id}` });
  return { db, store, engine };
}
const edit = (entityId: string, payload: unknown, opType = OpType.Update) => ({ entityType: 'TASK' as const, entityId, opType, payload });

async function snapshot() {
  const source = await device('source');
  await source.engine.dispatch(edit('alive', { title: 'snapshot', priority: 2 }));
  await source.engine.dispatch(edit('gone', { title: 'trash content' }));
  await source.engine.dispatch(edit('gone', {}, OpType.Delete));
  await source.store.markUploaded(new Map((await source.engine.getPendingUpload()).map((op, i) => [op.id, i + 1])));
  await source.store.setLastServerSeq(3);
  return { source, op: (await source.engine.createSyncCheckpoint()).ops[0]! };
}

describe('D causal full-state recovery', () => {
  it('hydrates a fresh device from a single retained full-state op, including metadata and tombstones', async () => {
    const { source, op } = await snapshot();
    const target = await device('target');
    expect(op).toMatchObject({ opType: 'REPAIR', entityType: 'ALL', payload: { repairBaseServerSeq: 3 } });
    await target.engine.applyRemote([JSON.parse(JSON.stringify(op))]);
    expect(serializeMaterializedState(target.engine.getState())).toEqual(serializeMaterializedState(source.engine.getState()));
    expect(target.engine.getState().tasks.gone).toMatchObject({ title: 'trash content', deletedAt: 10 });
    expect(await target.engine.getPendingUpload()).toEqual([]);
    await target.engine.checkpoint();
    const reboot = new OpLogEngine({ store: target.store, clientId: 'target' });
    expect(await reboot.recover()).toEqual({ replayed: 0 });
    expect(serializeMaterializedState(reboot.getState())).toEqual(serializeMaterializedState(source.engine.getState()));
    await reboot.rebuildFromLog();
    expect(reboot.getState()).toEqual(source.engine.getState());
  });

  it('preserves offline concurrent edits in either snapshot delivery order and on duplicate replay', async () => {
    const { op } = await snapshot();
    const offline: Operation<string> = { id: 'offline-1', clientId: 'offline', timestamp: 20,
      vectorClock: { offline: 1 }, entityType: 'TASK', entityId: 'alive', opType: 'UPD',
      actionType: 'UPD_TASK', schemaVersion: 1, payload: { title: 'offline edit' } };
    const first = applyOperation(applyOperation(emptyState(), op), offline);
    const last = applyOperation(applyOperation(emptyState(), offline), op);
    expect(serializeMaterializedState(first)).toEqual(serializeMaterializedState(last));
    expect(first.tasks.alive).toMatchObject({ title: 'offline edit', priority: 2 });
    expect(applyOperation(last, op)).toEqual(last);
  });

  it('rejects unsupported snapshots before persisting or advancing state', async () => {
    const { op } = await snapshot();
    const target = await device('target');
    for (const payload of [{}, { isFullState: true, heytaStateVersion: 99 }, { isFullState: true, heytaStateVersion: 1, repairBaseServerSeq: 3, state: {} }]) {
      await expect(target.engine.applyRemote([{ ...op, payload }])).rejects.toThrow(/full-state/);
      expect(await target.store.getAllOps()).toEqual([]);
      expect(target.engine.getClock()).toEqual({});
      await expect(target.engine.importOperations([{ ...op, payload }])).rejects.toThrow(/full-state/);
      expect(await target.store.getAllOps()).toEqual([]);
    }
  });

  it('refuses snapshots whose version metadata invents a causal dependency', async () => {
    const { op } = await snapshot();
    const target = await device('target');
    await expect(target.engine.applyRemote([{ ...op, vectorClock: {} }])).rejects.toThrow('causal boundary');
    expect(await target.store.getAllOps()).toEqual([]);
  });

  it('requires a drained upload queue before constructing the server compaction boundary', async () => {
    const local = await device('local');
    await local.engine.dispatch(edit('pending', { title: 'not on server yet' }));
    await expect(local.engine.createSyncCheckpoint()).rejects.toThrow('drained');
    expect(await local.store.getAllOps()).toHaveLength(1);
  });

  it('refuses a compaction snapshot after skipped history, including after restart', async () => {
    const { source } = await snapshot();
    await source.store.markUploaded(new Map((await source.engine.getPendingUpload()).map((op) => [op.id, 4])));
    await source.engine.markHistoryIncomplete();
    const reboot = new OpLogEngine({ store: source.store, clientId: 'source' });
    await reboot.recover();
    await expect(reboot.createSyncCheckpoint()).rejects.toThrow('completely materialized');
  });

  it('refuses to claim persisted but unrecovered history is an empty snapshot', async () => {
    const { source } = await snapshot();
    await source.store.markUploaded(new Map((await source.engine.getPendingUpload()).map((op) => [op.id, 4])));
    const unrecovered = new OpLogEngine({ store: source.store, clientId: 'source' });
    await expect(unrecovered.createSyncCheckpoint()).rejects.toThrow('completely materialized');
  });

  it('does not authorize erasure of retained but unmodeled future entities', async () => {
    const { source, op } = await snapshot();
    await source.store.markUploaded(new Map((await source.engine.getPendingUpload()).map((op) => [op.id, 4])));
    await source.engine.applyRemote([{ ...op, id: 'future-event', opType: 'UPD', entityType: 'FUTURE_EVENT',
      entityId: 'event', payload: { important: 'retained for a newer client' } }]);
    await expect(source.engine.createSyncCheckpoint()).rejects.toThrow('cannot represent entity type');
  });

  it('refuses a snapshot with unknown buckets instead of silently losing them', async () => {
    const { op } = await snapshot();
    const payload = JSON.parse(JSON.stringify(op.payload));
    payload.state.buckets.futureEvents = { important: {} };
    const target = await device('target');
    await expect(target.engine.applyRemote([{ ...op, payload }])).rejects.toThrow('Invalid full-state');
    expect(await target.store.getAllOps()).toEqual([]);
  });

  it.each(['import', 'rejected'] as const)('does not publish %s facts through maintenance', async (source) => {
    const local = await device('local');
    const op: Operation<string> = { id: 'local-only', clientId: 'local', timestamp: 10,
      vectorClock: { local: 1 }, entityType: 'TASK', entityId: 'private', opType: 'UPD',
      actionType: 'UPD_TASK', schemaVersion: 1, payload: { title: 'not published' } };
    if (source === 'import') await local.engine.importOperations([op]);
    else {
      const result = await local.engine.dispatch(edit('private', { title: 'not published' }));
      await local.engine.markRejected(result.ops.map((op) => op.id));
    }
    expect(await local.engine.getPendingUpload()).toEqual([]);
    await expect(local.engine.createSyncCheckpoint()).rejects.toThrow('server-accepted history');
    expect(await local.store.getAllOps()).toHaveLength(1);
  });
});
