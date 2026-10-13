import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { DbOpLogStore, INDEXEDDB_SCHEMA, MemoryDbAdapter, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType, type Operation } from '@heyta/sync-core';

import { OpLogEngine } from '../src/engine.js';
import {
  applyOperation,
  deserializeMaterializedState,
  emptyState,
  replayOperations,
  serializeMaterializedState,
} from '../src/state.js';

const taskId = 'task-repeat-1';
const reminderId = `${taskId}:1799999900000`;

function createTask(timestamp = 1): Operation<string> {
  return {
    id: 'create-task-repeat-1',
    clientId: 'seed',
    entityType: 'TASK',
    entityId: taskId,
    opType: OpType.Create,
    actionType: 'CRT_TASK',
    vectorClock: { seed: timestamp },
    timestamp,
    schemaVersion: 1,
    payload: { title: '每日复盘', dueDate: 1_799_999_900_000, repeatRule: 'FREQ=DAILY' },
  };
}

function createReminder(timestamp = 2): Operation<string> {
  return {
    id: 'create-reminder-repeat-1',
    clientId: 'seed',
    entityType: 'REMINDER',
    entityId: reminderId,
    opType: OpType.Create,
    actionType: 'CRT_REMINDER',
    vectorClock: { seed: timestamp },
    timestamp,
    schemaVersion: 1,
    payload: {
      taskId,
      triggerAt: 1_799_999_890_000,
      dismissedAt: 1_799_999_880_000,
      snoozedUntil: 1_799_999_870_000,
      firedForTriggerAt: 1_799_999_890_000,
    },
  };
}

function completion(over: Partial<Operation<string>> = {}): Operation<string> {
  return {
    id: 'repeat-completion-1',
    clientId: 'device-a',
    entityType: 'TASK',
    entityId: taskId,
    opType: OpType.Update,
    actionType: 'UPD_TASK',
    vectorClock: { seed: 2, 'device-a': 1 },
    timestamp: 3,
    schemaVersion: 1,
    payload: {
      heytaTaskRepeatCompletion: 1,
      task: { dueDate: 1_800_000_000_000, widgetCompletionReceipts: ['widget-v1:task-repeat-1:done:1'] },
      reminders: [{
        id: reminderId,
        triggerAt: 1_799_999_990_000,
        dismissedAt: null,
        snoozedUntil: null,
        firedForTriggerAt: 1_799_999_990_000,
      }],
    },
    ...over,
  };
}

describe('task repeat completion marker', () => {
  it('materializes TASK and REMINDER from one logical operation', () => {
    const state = replayOperations(emptyState(), [createTask(), createReminder(), completion()]);
    expect(state.tasks[taskId]).toMatchObject({
      title: '每日复盘',
      dueDate: 1_800_000_000_000,
      widgetCompletionReceipts: ['widget-v1:task-repeat-1:done:1'],
    });
    expect(state.reminders[reminderId]).toMatchObject({
      taskId,
      triggerAt: 1_799_999_990_000,
      firedForTriggerAt: 1_799_999_990_000,
    });
    expect(state.reminders[reminderId]).not.toHaveProperty('dismissedAt');
    expect(state.reminders[reminderId]).not.toHaveProperty('snoozedUntil');
  });

  it('the same marker is order independent and a newer reminder tombstone wins', () => {
    const tombstone: Operation<string> = {
      id: 'delete-reminder-newer',
      clientId: 'device-b',
      entityType: 'REMINDER',
      entityId: reminderId,
      opType: OpType.Delete,
      actionType: 'DEL_REMINDER',
      vectorClock: { seed: 2, 'device-b': 2 },
      timestamp: 4,
      schemaVersion: 1,
      payload: {},
    };
    const forward = replayOperations(emptyState(), [createTask(), createReminder(), completion(), tombstone]);
    const reverse = replayOperations(emptyState(), [tombstone, completion(), createReminder(), createTask()]);
    expect(reverse).toEqual(forward);
    expect(forward.reminders[reminderId]?.deletedAt).toBe(4);
    expect(forward.reminders[reminderId]?.triggerAt).toBe(1_799_999_990_000);
  });

  it('allows marker-before-create while rejecting an existing reminder owned by another task', () => {
    const markerFirst = applyOperation(emptyState(), completion());
    const afterCreate = applyOperation(markerFirst, createReminder());
    expect(afterCreate.reminders[reminderId]?.taskId).toBe(taskId);
    expect(afterCreate.reminders[reminderId]?.triggerAt).toBe(1_799_999_990_000);

    const malformedCreate = {
      ...createReminder(),
      id: 'create-wrong-owner',
      payload: { ...(createReminder().payload as Record<string, unknown>), taskId: 'other-task' },
    };
    expect(applyOperation(emptyState(), malformedCreate).reminders[reminderId]?.taskId).toBe(taskId);
    expect(replayOperations(emptyState(), [malformedCreate]).reminders[reminderId]?.taskId).toBe(taskId);
    expect(markerFirst.reminders[reminderId]?.taskId).toBe(taskId);
    expect(applyOperation(markerFirst, malformedCreate).reminders[reminderId]?.taskId).toBe(taskId);
  });

  it('normalizes a hydrated canonical reminder owner instead of throwing on marker replay', () => {
    const malformed = emptyState();
    malformed.reminders[reminderId] = {
      id: reminderId,
      taskId: 'other-task',
      triggerAt: 1_799_999_890_000,
      createdAt: 1,
      updatedAt: 2,
    };
    const next = applyOperation(malformed, completion());
    expect(next.reminders[reminderId]?.taskId).toBe(taskId);
    expect(next.reminders[reminderId]?.triggerAt).toBe(1_799_999_990_000);
  });

  it('normalizes a legacy malformed owner while hydrating a checkpoint', () => {
    const encoded = serializeMaterializedState(applyOperation(emptyState(), createReminder()));
    encoded.buckets.reminders[reminderId]!.data.taskId = 'other-task';
    const hydrated = deserializeMaterializedState(encoded);
    expect(hydrated?.reminders[reminderId]?.taskId).toBe(taskId);
  });

  it('persists exactly one local op for a real SQLite marker and replays remotely without writing another', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heyta-repeat-completion-'));
    const dbPath = join(dir, 'state.db');
    const open = async () => {
      const db = new SqliteAdapter({ schema: INDEXEDDB_SCHEMA, driverFactory: () => new NodeSqliteDriver(dbPath) });
      await db.init();
      return db;
    };
    let db = await open();
    try {
      const store = new DbOpLogStore<Operation<string>>(db);
      const engine = new OpLogEngine({ store, clientId: 'device-a', now: () => 10 });
      await engine.dispatch({
        entityType: 'TASK', entityId: taskId, opType: OpType.Create, payload: createTask().payload,
      });
      await engine.dispatch({
        entityType: 'REMINDER', entityId: reminderId, opType: OpType.Create, payload: createReminder().payload,
      });
      const before = await store.getAllOps();
      const local = await engine.dispatch({
        entityType: 'TASK', entityId: taskId, opType: OpType.Update, payload: completion().payload,
      });
      expect(local.ops).toHaveLength(1);
      expect((await store.getAllOps()).length - before.length).toBe(1);
      expect(engine.getState().tasks[taskId]?.dueDate).toBe(1_800_000_000_000);
      expect(engine.getState().reminders[reminderId]?.triggerAt).toBe(1_799_999_990_000);
      const marker = local.ops[0]!;

      const remoteDb = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
      await remoteDb.init();
      try {
        const remoteStore = new DbOpLogStore<Operation<string>>(remoteDb);
        const remote = new OpLogEngine({ store: remoteStore, clientId: 'device-b' });
        const sourceOps = (await store.getAllOps()).map((row) => row.op);
        await remote.applyRemote(sourceOps);
        const duplicate = await remote.applyRemote([marker]);
        expect(duplicate.applied).toHaveLength(0);
        expect(await remoteStore.getAllOps()).toHaveLength(3);
        expect(remote.getState()).toEqual(engine.getState());
      } finally {
        remoteDb.close();
      }

      await engine.checkpoint();
      db.close();
      db = await open();
      const rebootStore = new DbOpLogStore<Operation<string>>(db);
      const reboot = new OpLogEngine({ store: rebootStore, clientId: 'device-a' });
      expect(await reboot.recover()).toEqual({ replayed: 0 });
      expect(reboot.getState().tasks[taskId]?.dueDate).toBe(1_800_000_000_000);
      expect(reboot.getState().reminders[reminderId]?.triggerAt).toBe(1_799_999_990_000);
      await reboot.applyRemote([marker]);
      expect(await rebootStore.getAllOps()).toHaveLength(3);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('task repeat completion marker validation before persistence', () => {
  const malformed = (over: Partial<Operation<string>> = {}): Operation<string> => ({
    ...completion(),
    ...over,
    payload: {
      ...(completion().payload as Record<string, unknown>),
      // Prefix-only validation would incorrectly accept this for task-1.
      reminders: [{ id: 'task-1:nested:1', triggerAt: 1, dismissedAt: null, snoozedUntil: null }],
    },
  });

  it('rejects malicious scope and malformed marker on local, remote, and import paths', async () => {
    const db = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
    await db.init();
    try {
      const store = new DbOpLogStore<Operation<string>>(db);
      const engine = new OpLogEngine({ store, clientId: 'device-a' });
      await expect(engine.dispatch({ entityType: 'TASK', entityId: taskId, opType: OpType.Update, payload: malformed().payload })).rejects.toThrow('scope');
      await expect(engine.applyRemote([malformed({ id: 'remote-bad' })])).rejects.toThrow('scope');
      await expect(engine.importOperations([malformed({ id: 'import-bad' })])).rejects.toThrow('scope');
      expect(await store.getAllOps()).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('rejects a canonical reminder owner mismatch before local, remote, or import append', async () => {
    const malformedOwner: Operation<string> = {
      ...createReminder(),
      id: 'malformed-reminder-owner',
      payload: { ...(createReminder().payload as Record<string, unknown>), taskId: 'other-task' },
    };
    const db = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
    await db.init();
    try {
      const store = new DbOpLogStore<Operation<string>>(db);
      const engine = new OpLogEngine({ store, clientId: 'device-a' });
      await expect(engine.dispatch({
        entityType: 'REMINDER', entityId: reminderId, opType: OpType.Create,
        payload: malformedOwner.payload,
      })).rejects.toThrow('owner mismatch');
      await expect(engine.applyRemote([malformedOwner])).rejects.toThrow('owner mismatch');
      await expect(engine.importOperations([malformedOwner])).rejects.toThrow('owner mismatch');
      const multiScope = {
        ...malformedOwner,
        id: 'malformed-reminder-owner-multi-scope',
        entityIds: ['other-task:2'],
      };
      await expect(engine.applyRemote([multiScope])).rejects.toThrow('multi-scope');
      const missingOwnerMultiScope = {
        ...malformedOwner,
        id: 'missing-reminder-owner-multi-scope',
        entityIds: ['other-task:2'],
        opType: OpType.Update,
        payload: { triggerAt: 999 },
      };
      await expect(engine.dispatch({
        entityType: 'REMINDER', entityId: reminderId, entityIds: missingOwnerMultiScope.entityIds,
        opType: OpType.Update, payload: missingOwnerMultiScope.payload,
      })).rejects.toThrow('multi-scope');
      await expect(engine.applyRemote([missingOwnerMultiScope])).rejects.toThrow('multi-scope');
      await expect(engine.importOperations([missingOwnerMultiScope])).rejects.toThrow('multi-scope');
      expect(await store.getAllOps()).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('keeps marker-first state recoverable when a malformed create arrives later', async () => {
    const malformedOwner: Operation<string> = {
      ...createReminder(),
      id: 'malformed-reminder-owner-after-marker',
      payload: { ...(createReminder().payload as Record<string, unknown>), taskId: 'other-task' },
    };
    const db = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
    await db.init();
    try {
      const store = new DbOpLogStore<Operation<string>>(db);
      const engine = new OpLogEngine({ store, clientId: 'device-a' });
      await engine.applyRemote([completion({ id: 'remote-repeat-marker' })]);
      await expect(engine.applyRemote([malformedOwner])).rejects.toThrow('owner mismatch');
      expect(await store.getAllOps()).toHaveLength(1);
      expect(engine.getState().reminders[reminderId]?.taskId).toBe(taskId);

      const reboot = new OpLogEngine({ store, clientId: 'device-b' });
      await expect(reboot.recover()).resolves.toEqual({ replayed: 1 });
      expect(reboot.getState().reminders[reminderId]?.taskId).toBe(taskId);
      expect(await store.getAllOps()).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
