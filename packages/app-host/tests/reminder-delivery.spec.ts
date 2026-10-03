import type { AppHost } from '../src/host.js';
import { reminderIsFired } from '@heyta/domain';
import { createReminderReconciler, reconcileReminderDelivery, type ReminderDeliveryPort } from '../src/reminder-delivery.js';
import { createReminderActions } from '../src/reminder-actions.js';
import { createTaskActions } from '../src/actions.js';
import { OpLogEngine } from '@heyta/op-log';
import type { OpIntent } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let clock = 1_700_000_000_000;
const now = (): number => clock;

function host(): AppHost {
  return {
    getState: () => engine.getState(),
    dispatch: (intent: OpIntent) => engine.dispatch(intent).then(() => undefined),
  } as unknown as AppHost;
}

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  clock = 1_700_000_000_000;
  engine = new OpLogEngine({
    store: new DbOpLogStore(adapter),
    clientId: 'reminder-delivery-test',
    now,
  });
});

afterEach(() => adapter.close());

describe('reminder delivery protocol', () => {
  it('does not fire an old receipt after a snooze, and schedules the new occurrence', async () => {
    const taskActions = createTaskActions(engine, { now, newTaskId: () => 'task-1' });
    const taskId = await taskActions.create('任务');
    const reminderActions = createReminderActions(engine, { now });
    const triggerAt = clock + 10_000;
    const id = await reminderActions.createReminder(taskId, triggerAt);
    const oldOccurrence = `${id}|${triggerAt}`;
    await reminderActions.snoozeReminder(id, triggerAt + 20_000);

    const acknowledged: string[] = [];
    const scheduled: string[] = [];
    const cancelled: string[][] = [];
    const delivery: ReminderDeliveryPort = {
      authorizationStatus: async () => 'granted',
      peekDelivered: async () => [oldOccurrence],
      acknowledgeDelivered: async (ids) => { acknowledged.push(...ids); return true; },
      cancelStale: async (ids) => { cancelled.push([...ids]); return true; },
      schedule: async (occurrenceId) => { scheduled.push(occurrenceId); return true; },
    };

    await reconcileReminderDelivery(host(), delivery, { now });

    expect((engine.getState().reminders[id] as { firedAt?: number }).firedAt).toBeUndefined();
    expect(acknowledged).toEqual([oldOccurrence]);
    expect(scheduled).toEqual([`${id}|${triggerAt + 20_000}`]);
    expect(cancelled).toEqual([[`${id}|${triggerAt + 20_000}`]]);
  });

  it('keeps a queued receipt on its original occurrence without state-dependent replay', async () => {
    const taskActions = createTaskActions(engine, { now, newTaskId: () => 'task-2' });
    const taskId = await taskActions.create('竞态');
    const reminderActions = createReminderActions(engine, { now });
    const triggerAt = clock + 10_000;
    const id = await reminderActions.createReminder(taskId, triggerAt);

    // Both actions observe the old state before the engine queue runs. Snooze
    // is queued first; the receipt remains associated with the old occurrence.
    const snooze = reminderActions.snoozeReminder(id, triggerAt + 20_000);
    const fired = reminderActions.markReminderFired(id, triggerAt);
    await Promise.all([snooze, fired]);

    const reminder = engine.getState().reminders[id]!;
    expect(reminder.firedAt).toBeDefined();
    expect(reminder.firedForTriggerAt).toBe(triggerAt);
    expect(reminder.snoozedUntil).toBe(triggerAt + 20_000);
    expect(reminderIsFired(reminder)).toBe(false);
  });
});

describe('reminder capacity and failure boundaries', () => {
  it('separates the pending capacity window from notifications that may remain visible', async () => {
    const taskId = await createTaskActions(engine, { now, newTaskId: () => 'capacity-task' }).create('窗口');
    const actions = createReminderActions(engine, { now });
    const first = await actions.createReminder(taskId, clock + 1000);
    const second = await actions.createReminder(taskId, clock + 2000);
    const third = await actions.createReminder(taskId, clock + 3000);
    await actions.markReminderFired(first);
    let visible: readonly string[] = [];
    let pending: readonly string[] = [];
    const scheduled: string[] = [];
    await reconcileReminderDelivery(host(), {
      authorizationStatus: async () => 'granted', peekDelivered: async () => [],
      acknowledgeDelivered: async () => true,
      cancelStale: async (keep, window) => { visible = keep; pending = window; return true; },
      schedule: async (id) => { scheduled.push(id); return true; },
    }, { now, maxPending: 1 });
    expect(visible).toEqual([`${first}|${clock + 1000}`, `${second}|${clock + 2000}`, `${third}|${clock + 3000}`]);
    expect(pending).toEqual([`${second}|${clock + 2000}`]);
    expect(scheduled).toEqual(pending);
  });

  it('keeps a receipt unacknowledged when the op cannot be persisted', async () => {
    const taskId = await createTaskActions(engine, { now, newTaskId: () => 'failure-task' }).create('失败');
    const id = await createReminderActions(engine, { now }).createReminder(taskId, clock);
    const acknowledged: string[] = [];
    const failingHost = { ...host(), dispatch: async () => { throw new Error('disk full'); } } as AppHost;
    await reconcileReminderDelivery(failingHost, {
      authorizationStatus: async () => 'denied', peekDelivered: async () => [`${id}|${clock}`],
      acknowledgeDelivered: async (ids) => { acknowledged.push(...ids); return true; },
      cancelStale: async () => true, schedule: async () => { throw new Error('must not schedule without permission'); },
    }, { now });
    expect(acknowledged).toEqual([]);
    expect(reminderIsFired(engine.getState().reminders[id]!)).toBe(false);
  });

  it('does not schedule when notification permission is still undetermined', async () => {
    const taskId = await createTaskActions(engine, { now, newTaskId: () => 'permission-task' }).create('权限');
    await createReminderActions(engine, { now }).createReminder(taskId, clock);
    await reconcileReminderDelivery(host(), {
      authorizationStatus: async () => 'default', peekDelivered: async () => [],
      acknowledgeDelivered: async () => true, cancelStale: async () => true,
      schedule: async () => { throw new Error('must not schedule before permission grant'); },
    }, { now });
  });
});

describe('reminder reconciler concurrency', () => {
  it('runs a dirty second pass when a trigger arrives during the first pass', async () => {
    let calls = 0;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reconciler = createReminderReconciler(async () => {
      calls += 1;
      if (calls === 1) await started;
    });

    const first = reconciler();
    await Promise.resolve();
    const second = reconciler();
    expect(second).toBe(first);
    release();
    await first;
    expect(calls).toBe(2);
  });
});
