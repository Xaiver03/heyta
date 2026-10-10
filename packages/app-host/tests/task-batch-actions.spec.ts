import { describe, expect, it } from 'vitest';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, MemoryDbAdapter } from '@heyta/storage';
import { OpType, type Operation } from '@heyta/sync-core';
import type { HeytaTaskBatchPayload } from '@heyta/shared-schema';
import { createTaskBatch } from '../src/task-batch-actions.js';

const payload = (): HeytaTaskBatchPayload => ({
  heytaTaskBatch: 1,
  source: { version: 1, eventId: 'event', ruleId: 'rule', ruleVersion: 1, parseVersion: 1, digest: 'a'.repeat(64) },
  tasks: [
    { id: 'inbound:event:0', title: 'First', priority: 0, note: 'One', projectId: 'project' },
    { id: 'inbound:event:1', title: 'Second', priority: 3, startDate: 1000, durationMinutes: 60, projectId: 'project' },
  ],
});

async function fixture(run: (engine: OpLogEngine, store: DbOpLogStore<Operation<string>>) => Promise<void>) {
  const db = new MemoryDbAdapter(INDEXEDDB_SCHEMA); await db.init();
  const store = new DbOpLogStore<Operation<string>>(db, 0);
  let id = 0;
  const engine = new OpLogEngine({ store, clientId: 'a', now: () => 100, nextOpId: () => `op-${++id}` });
  try {
    await engine.dispatch({ entityType: 'PROJECT', entityId: 'project', opType: OpType.Create, payload: { title: 'Target' } });
    await run(engine, store);
  } finally { db.close(); }
}

describe('authorized heterogeneous batch creation', () => {
  it('rechecks a target deleted ahead of the batch in the engine write queue', async () => {
    await fixture(async (engine, store) => {
      const batch = payload();
      const deletion = engine.dispatch({ entityType: 'PROJECT', entityId: 'project', opType: OpType.Delete });
      const creation = createTaskBatch({ dispatchValidated: engine.dispatchValidated.bind(engine) }, batch, { source: batch.source, targetProjectId: 'project' });
      await deletion;
      await expect(creation).rejects.toThrow('target is unavailable');
      expect(engine.getState().tasks).toEqual({});
      expect(await store.getAllOps()).toHaveLength(2);
    });
  });
  it('creates two different tasks in one op and recovers reuse without changing a tombstone', async () => {
    await fixture(async (engine, store) => {
      const ctx = { dispatchValidated: engine.dispatchValidated.bind(engine) };
      const batch = payload();
      const auth = { source: batch.source, targetProjectId: 'project' };
      expect(await createTaskBatch(ctx, batch, auth)).toEqual(['inbound:event:0', 'inbound:event:1']);
      expect(await store.getAllOps()).toHaveLength(2); // one project + one batch
      expect(engine.getState().tasks['inbound:event:1']).toMatchObject({ title: 'Second', startDate: 1000, durationMinutes: 60 });
      await engine.dispatch({ entityType: 'TASK', entityId: 'inbound:event:0', opType: OpType.Delete });
      expect(await createTaskBatch(ctx, batch, auth)).toEqual(['inbound:event:0', 'inbound:event:1']);
      expect(await store.getAllOps()).toHaveLength(3);
      expect(engine.getState().tasks['inbound:event:0']?.deletedAt).toBe(100);
      await engine.dispatch({ entityType: 'PROJECT', entityId: 'project', opType: OpType.Delete });
      expect(await createTaskBatch(ctx, batch, auth)).toEqual(['inbound:event:0', 'inbound:event:1']);
      expect(await store.getAllOps()).toHaveLength(4); // recovery is not a new creation
    });
  });

  it.each(['wrong-rule', 'wrong-revision', 'wrong-event', 'wrong-digest', 'wrong-target', 'deleted-target', 'missing-target'])(
    'refuses %s without a task op', async (scenario) => {
      await fixture(async (engine, store) => {
        const batch = payload();
        const auth = { source: { ...batch.source }, targetProjectId: 'project' };
        if (scenario === 'wrong-rule') auth.source.ruleId = 'other';
        if (scenario === 'wrong-revision') auth.source.ruleVersion++;
        if (scenario === 'wrong-event') auth.source.eventId = 'other';
        if (scenario === 'wrong-digest') auth.source.digest = 'b'.repeat(64);
        if (scenario === 'wrong-target') auth.targetProjectId = 'other';
        if (scenario === 'deleted-target') await engine.dispatch({ entityType: 'PROJECT', entityId: 'project', opType: OpType.Delete });
        if (scenario === 'missing-target') { auth.targetProjectId = 'missing'; batch.tasks.forEach((task) => { task.projectId = 'missing'; }); }
        const before = (await store.getAllOps()).length;
        await expect(createTaskBatch({ dispatchValidated: engine.dispatchValidated.bind(engine) }, batch, auth)).rejects.toThrow();
        expect(await store.getAllOps()).toHaveLength(before);
        expect(engine.getState().tasks).toEqual({});
      });
    },
  );
});
