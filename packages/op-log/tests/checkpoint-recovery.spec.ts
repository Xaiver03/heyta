/** D: cache corruption and concurrency must never change the authoritative log. */
import { describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DbOpLogStore, MemoryDbAdapter, INDEXEDDB_SCHEMA, IndexedDbAdapter,
  SqliteAdapter, checkpointChecksum, type DbAdapter,
} from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType, type Operation } from '@heyta/sync-core';
import { OpLogEngine } from '../src/engine.js';
import { serializeMaterializedState } from '../src/state.js';

const factories: Record<string, () => DbAdapter> = {
  memory: () => new MemoryDbAdapter(INDEXEDDB_SCHEMA),
  indexeddb: () => {
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
    return new IndexedDbAdapter('checkpoint-tests');
  },
  sqlite: () => new SqliteAdapter({ schema: INDEXEDDB_SCHEMA, driverFactory: () => new NodeSqliteDriver(':memory:') }),
};
const intent = (i: number) => ({
  entityType: 'TASK' as const, entityId: 'task', opType: OpType.Update,
  payload: { title: `title-${i}`, priority: i % 4 },
});

for (const [name, create] of Object.entries(factories)) {
  describe(`D checkpoint recovery / ${name}`, () => {
    const fixture = async (run: (db: DbAdapter, store: DbOpLogStore<Operation<string>>, engine: OpLogEngine) => Promise<void>) => {
      const db = create();
      await db.init();
      const store = new DbOpLogStore<Operation<string>>(db, 0);
      let id = 0;
      const engine = new OpLogEngine({ store, clientId: 'device', now: () => 10, nextOpId: () => `op-${++id}` });
      try { await run(db, store, engine); } finally { db.close(); }
    };

    it('serializes concurrent dispatch and checkpoint at the actual applied boundary', async () => {
      await fixture(async (_db, store, engine) => {
        const first = engine.dispatch(intent(1));
        const checkpoint = engine.checkpoint();
        const second = engine.dispatch(intent(2));
        await Promise.all([first, checkpoint, second]);
        expect((await store.readCheckpoint())?.coveredSeq).toBe(1);
        expect((await store.getAllOps()).map((r) => r.op.vectorClock.device)).toEqual([1, 2]);
        const reboot = new OpLogEngine({ store, clientId: 'device' });
        expect(await reboot.recover()).toEqual({ replayed: 1 });
        expect(reboot.getState()).toEqual(engine.getState());
        expect(reboot.getClock()).toEqual({ device: 2 });
      });
    });

    it('never checkpoints persisted remote operations that this engine has not applied', async () => {
      await fixture(async (_db, store, engine) => {
        await engine.dispatch(intent(1));
        await store.appendBatchSkipDuplicates([{
          id: 'pending', clientId: 'peer', entityType: 'TASK', entityId: 'pending-task',
          vectorClock: { peer: 1 }, timestamp: 20, opType: OpType.Create,
          actionType: 'CRT_TASK', schemaVersion: 1, payload: { title: 'recover me' },
        }], 'remote', { pendingApply: true });
        await engine.checkpoint();
        expect((await store.readCheckpoint())?.coveredSeq).toBe(1);
        const reboot = new OpLogEngine({ store, clientId: 'device' });
        expect(await reboot.recover()).toEqual({ replayed: 1 });
        expect(reboot.getState().tasks['pending-task']?.title).toBe('recover me');
        expect(await store.findPendingApply()).toEqual([]);
      });
    });

    it('falls back for malformed, incomplete, future and checksum-corrupt caches even after archival', async () => {
      await fixture(async (db, store, engine) => {
        await engine.dispatch(intent(1));
        await engine.dispatch(intent(2));
        await engine.checkpoint();
        await store.markUploaded(new Map([['op-1', 1], ['op-2', 2]]));
        expect(await store.archiveUpTo(2)).toBe(1);
        const valid = (await store.readCheckpoint())!;
        const { checksum: _checksum, ...base } = valid;
        const missingBuckets = { ...base, state: { formatVersion: 1, buckets: {} } };
        const corrupt: unknown[] = [null, {}, { ...valid, checksum: 'bad' },
          { ...valid, coveredSeq: 99 }, { ...valid, appliedOpIds: undefined },
          { ...missingBuckets, checksum: checkpointChecksum(missingBuckets) }];
        for (const value of corrupt) {
          await db.put('meta', { key: 'materializedCheckpoint', value });
          const reboot = new OpLogEngine({ store, clientId: 'device' });
          expect(await reboot.recover()).toEqual({ replayed: 2 });
          expect(reboot.getState()).toEqual(engine.getState());
          expect(reboot.getClock()).toEqual(engine.getClock());
        }
        expect((await store.appendBatchSkipDuplicates([(await store.getAllOps())[0]!.op], 'remote', { pendingApply: true })).skippedCount).toBe(1);
        expect(await store.getAllOps()).toHaveLength(2);
      });
    });

    it('does not advance a checkpoint across an unapplied hole after a later dispatch', async () => {
      await fixture(async (_db, store, engine) => {
        await engine.dispatch(intent(1));
        await engine.checkpoint();
        await store.appendBatchSkipDuplicates([{
          id: 'pending-hole', clientId: 'peer', entityType: 'TASK', entityId: 'missing',
          vectorClock: { peer: 1 }, timestamp: 20, opType: OpType.Create,
          actionType: 'CRT_TASK', schemaVersion: 1, payload: { title: 'must survive' },
        }], 'remote', { pendingApply: true });
        await engine.dispatch(intent(2));
        await engine.checkpoint();
        expect((await store.readCheckpoint())?.coveredSeq).toBe(1);
        const reboot = new OpLogEngine({ store, clientId: 'device' });
        expect(await reboot.recover()).toEqual({ replayed: 2 });
        expect(reboot.getState().tasks.missing?.title).toBe('must survive');
      });
    });

    it('treats a checkpoint read failure as a cache miss', async () => {
      await fixture(async (_db, store, engine) => {
        await engine.dispatch(intent(1));
        vi.spyOn(store, 'readCheckpoint').mockRejectedValueOnce(new Error('unreadable cache'));
        const reboot = new OpLogEngine({ store, clientId: 'device' });
        expect(await reboot.recover()).toEqual({ replayed: 1 });
        expect(reboot.getState()).toEqual(engine.getState());
      });
    });

    it('recovers snapshot-only clock dimensions even if the materialized cache is lost', async () => {
      await fixture(async (db, store, engine) => {
        await engine.dispatch(intent(1));
        await engine.checkpoint();
        await engine.observeRemoteClockDurably({ archivedDevice: 7 });
        for (const dropCache of [false, true]) {
          if (dropCache) await db.delete('meta', 'materializedCheckpoint');
          const reboot = new OpLogEngine({ store, clientId: 'device', nextOpId: () => `after-${dropCache}` });
          await reboot.recover();
          expect(reboot.getClock().archivedDevice).toBe(7);
          const next = await reboot.dispatch(intent(2));
          expect(next.ops[0]!.vectorClock.archivedDevice).toBe(7);
          await reboot.rebuildFromLog();
          expect(reboot.getClock().archivedDevice).toBe(7);
        }
      });
    });

    it('finishes a duplicate pending operation after markApplied fails without restarting', async () => {
      await fixture(async (_db, store, engine) => {
        const op: Operation<string> = {
          id: 'retry-pending', clientId: 'peer', entityType: 'TASK', entityId: 'retry',
          vectorClock: { peer: 1 }, timestamp: 20, opType: OpType.Create,
          actionType: 'CRT_TASK', schemaVersion: 1, payload: { title: 'once' },
        };
        vi.spyOn(store, 'markApplied').mockRejectedValueOnce(new Error('temporary write failure'));
        await expect(engine.applyRemote([op])).rejects.toThrow('temporary write failure');
        expect(await store.findPendingApply()).toHaveLength(1);
        await engine.applyRemote([op]);
        expect(await store.findPendingApply()).toEqual([]);
        expect(await store.getAllOps()).toHaveLength(1);
        expect(engine.getState().tasks.retry?.title).toBe('once');
      });
    });

    it('reports all changed members of a concurrent batch, excluding losing remote writes', async () => {
      await fixture(async (_db, _store, engine) => {
        await engine.dispatch({ ...intent(1), entityIds: ['task', 'second'] });
        const remote: Operation<string> = {
          id: 'batch-win', entityId: 'task', entityIds: ['second'], entityType: 'TASK',
          clientId: 'peer', timestamp: 20, vectorClock: { peer: 1 }, schemaVersion: 1,
          actionType: 'UPD_TASK', opType: OpType.Update, payload: { title: 'winner' },
        };
        expect((await engine.applyRemote([remote])).overwritten).toEqual([
          { entityType: 'TASK', entityId: 'task' }, { entityType: 'TASK', entityId: 'second' },
        ]);
        expect((await engine.applyRemote([{ ...remote, id: 'loser', clientId: 'loser',
          timestamp: 1, vectorClock: { loser: 1 }, payload: { title: 'loser' } }])).overwritten).toEqual([]);
      });
    });

    it('uses bounded tail pages and keeps sequential version metadata bounded', async () => {
      await fixture(async (_db, store, engine) => {
        await engine.dispatch(intent(0));
        await engine.checkpoint();
        const base = (await store.getAllOps())[0]!.op;
        await store.appendImported(Array.from({ length: 601 }, (_, i) => ({
          ...base, id: `tail-${i}`, vectorClock: { device: i + 2 }, payload: { title: `tail-${i}` },
        })));
        const scan = vi.spyOn(store, 'getAllOps');
        const pages = vi.spyOn(store, 'getOpsSince');
        const reboot = new OpLogEngine({ store, clientId: 'device' });
        expect(await reboot.recover()).toEqual({ replayed: 601 });
        expect(pages.mock.calls.map((args) => args.slice(0, 2))).toEqual([[1, 250], [251, 250], [501, 250], [602, 250]]);
        expect(scan.mock.calls.every((args) => args[1] === 250)).toBe(true);
        expect(reboot.getState().tasks.task?.title).toBe('tail-600');
        const encoded = serializeMaterializedState(reboot.getState()).buckets.tasks.task!;
        expect(encoded.entityVersions).toHaveLength(1);
        expect(encoded.fieldVersions.title).toHaveLength(1);
      });
    });
  });
}

it('SQLite checkpoint survives closing and reopening a real file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-checkpoint-'));
  const open = async () => {
    const db = new SqliteAdapter({ schema: INDEXEDDB_SCHEMA, driverFactory: () => new NodeSqliteDriver(join(dir, 'state.db')) });
    await db.init();
    return db;
  };
  let db = await open();
  try {
    let store = new DbOpLogStore<Operation<string>>(db);
    const first = new OpLogEngine({ store, clientId: 'device' });
    await first.dispatch(intent(1));
    await first.checkpoint();
    db.close();
    db = await open();
    store = new DbOpLogStore<Operation<string>>(db);
    const reboot = new OpLogEngine({ store, clientId: 'device' });
    expect(await reboot.recover()).toEqual({ replayed: 0 });
    expect(reboot.getState()).toEqual(first.getState());
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
