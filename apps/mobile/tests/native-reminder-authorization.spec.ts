import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReminderActions, createTaskActions, type AppHost } from '@heyta/app-host';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';

const native = vi.hoisted(() => ({
  permission: 'default' as 'default' | 'granted' | 'denied',
  request: vi.fn(), schedule: vi.fn(), open: vi.fn(),
}));
vi.mock('../src/db/open-host', () => ({ openTaskHost: native.open }));
vi.mock('../src/lib/reminder-native', () => ({
  requestReminderAuthorization: native.request,
  reminderAuthorizationStatus: async () => native.permission,
  scheduleNativeReminder: native.schedule,
  consumeNativeDelivered: async () => [],
  acknowledgeNativeDelivered: async () => true,
  cancelStaleNativeReminders: async () => true,
  peekNativeUncertainReminders: async () => [],
}));
import { authorizeNativeReminders, reconcileNativeReminders, subscribeNativeReminderWrites } from '../src/lib/native-reminder-scheduler';
import { emitLocalWrite } from '../src/sync/write-signal';

let adapter: SqliteAdapter;
let engine: OpLogEngine;
beforeEach(async () => {
  vi.clearAllMocks();
  native.permission = 'default';
  native.schedule.mockResolvedValue(true);
  adapter = new SqliteAdapter({ schema: INDEXEDDB_SCHEMA, driverFactory: () => new NodeSqliteDriver(':memory:') });
  await adapter.init();
  engine = new OpLogEngine({ store: new DbOpLogStore(adapter), clientId: 'permission-test' });
  native.open.mockResolvedValue({
    getState: () => engine.getState(),
    dispatch: (intent) => engine.dispatch(intent).then(() => undefined),
  } satisfies Pick<AppHost, 'getState' | 'dispatch'>);
});
afterEach(async () => adapter.close());

async function createReminder() {
  const taskId = await createTaskActions(engine).create('Permission timing');
  return createReminderActions(engine).createReminder(taskId, Date.now() + 60_000);
}

describe('native authorization completion', () => {
  it('schedules after an offline write without sync or foreground events, and unsubscribes on cleanup', async () => {
    native.permission = 'granted';
    const errors = vi.fn();
    const unsubscribe = subscribeNativeReminderWrites(errors);
    try {
      await createReminder();
      emitLocalWrite();
      await vi.waitFor(() => expect(native.schedule).toHaveBeenCalledTimes(1));
      await reconcileNativeReminders();
      native.schedule.mockClear();
      unsubscribe();
      emitLocalWrite();
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(native.schedule).not.toHaveBeenCalled();
      expect(errors).not.toHaveBeenCalled();
    } finally { unsubscribe(); }
  });
  it('schedules an already saved reminder when permission resolves, without an AppState change', async () => {
    let grant!: () => void;
    native.request.mockImplementation(() => new Promise((resolve) => {
      grant = () => { native.permission = 'granted'; resolve('granted'); };
    }));
    const authorization = authorizeNativeReminders();
    const id = await createReminder();
    await reconcileNativeReminders(); // dataRevision arrives before the prompt is answered
    expect(engine.getState().reminders[id]).toBeDefined();
    expect(native.schedule).not.toHaveBeenCalled();
    grant();
    await authorization;
    expect(native.schedule).toHaveBeenCalledTimes(1);
    expect(native.schedule.mock.calls[0]?.[0]).toMatch(new RegExp(`^${id}\\|`));
    expect(engine.getState().reminders[id]?.firedAt).toBeUndefined();
  });

  it('leaves a denied reminder saved and unfired', async () => {
    const id = await createReminder();
    native.request.mockImplementation(async () => { native.permission = 'denied'; return 'denied'; });
    await authorizeNativeReminders();
    expect(native.schedule).not.toHaveBeenCalled();
    expect(engine.getState().reminders[id]?.firedAt).toBeUndefined();
  });

  it('schedules on the later data revision when permission was granted before the write', async () => {
    native.request.mockImplementation(async () => { native.permission = 'granted'; return 'granted'; });
    await authorizeNativeReminders();
    expect(native.schedule).not.toHaveBeenCalled();
    await createReminder();
    await reconcileNativeReminders();
    expect(native.schedule).toHaveBeenCalledTimes(1);
  });
});
