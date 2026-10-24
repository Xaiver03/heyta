import type { OpIntent } from '@heyta/op-log';
import { OpLogEngine } from '@heyta/op-log';
import { reminderIsFired, type Reminder } from '@heyta/domain';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppHost } from '../src/host.js';
import { createTaskActions } from '../src/actions.js';
import { createReminderActions } from '../src/reminder-actions.js';
import {
  deliverForegroundReminders,
  startForegroundReminderLoop,
  type ReminderForegroundPort,
} from '../src/reminder-foreground.js';

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let clock = 1_700_000_000_000;
const now = (): number => clock;
const labels = { title: 'heyta', body: (taskTitle: string) => `该做「${taskTitle}」了` };
const flush = (): Promise<void> => new Promise((resolve) => { setImmediate(resolve); });

function host(): AppHost {
  return {
    getState: () => engine.getState(),
    dispatch: (intent: OpIntent) => engine.dispatch(intent).then(() => undefined),
  } as unknown as AppHost;
}

function port(options: {
  permission?: 'granted' | 'denied' | 'default' | 'unsupported';
  show?: (request: { occurrenceId: string; title: string; body: string }) => boolean;
}): { reminderPort: ReminderForegroundPort; shown: { occurrenceId: string; title: string; body: string }[] } {
  const collected: { occurrenceId: string; title: string; body: string }[] = [];
  const reminderPort: ReminderForegroundPort = {
    authorizationStatus: async () => options.permission ?? 'granted',
    show: async (request) => {
      collected.push(request);
      return options.show === undefined ? true : options.show(request);
    },
  };
  return { reminderPort, shown: collected };
}

beforeEach(async () => {
  adapter = new SqliteAdapter({ schema: INDEXEDDB_SCHEMA, driverFactory: () => new NodeSqliteDriver(':memory:') });
  await adapter.init();
  clock = 1_700_000_000_000;
  engine = new OpLogEngine({ store: new DbOpLogStore(adapter), clientId: 'reminder-foreground-test', now });
});

afterEach(() => adapter.close());

async function reminderOn(taskTitle: string, triggerAt: number): Promise<{ taskId: string; id: string }> {
  const taskId = await createTaskActions(engine, { now, newTaskId: () => `task-${taskTitle}` }).create(taskTitle);
  const id = await createReminderActions(engine, { now }).createReminder(taskId, triggerAt);
  return { taskId, id };
}

describe('foreground reminder delivery', () => {
  it('does not show or write a receipt while the OS denies notifications', async () => {
    const { id } = await reminderOn('交周报', clock - 1_000);
    const { reminderPort, shown } = port({ permission: 'denied' });

    const result = await deliverForegroundReminders(host(), reminderPort, { labels, now });

    expect(result).toEqual({ delivered: [], reason: 'permission' });
    expect(shown).toHaveLength(0);
    // 没投递就不许写回执，否则用户永远失去这条提醒（ADR-0051 的拒绝语义）。
    const reminder = (engine.getState().reminders as Record<string, Reminder>)[id]!;
    expect(reminderIsFired(reminder)).toBe(false);
  });

  it('shows a due reminder once, writes the receipt, and never repeats it', async () => {
    const { id } = await reminderOn('交周报', clock - 1_000);
    const { reminderPort, shown } = port({});

    const first = await deliverForegroundReminders(host(), reminderPort, { labels, now });
    expect(first.delivered).toEqual([id]);
    expect(shown).toEqual([{ occurrenceId: `${id}|${clock - 1_000}`, title: 'heyta', body: '该做「交周报」了' }]);

    const reminder = (engine.getState().reminders as Record<string, Reminder>)[id]!;
    expect(reminderIsFired(reminder)).toBe(true);

    const second = await deliverForegroundReminders(host(), reminderPort, { labels, now });
    expect(second).toEqual({ delivered: [], reason: 'empty' });
    expect(shown).toHaveLength(1);
  });

  it('keeps the reminder pending when the OS refuses the post', async () => {
    const { id } = await reminderOn('交周报', clock - 1_000);
    let attempts = 0;
    const { reminderPort } = port({ show: () => ++attempts > 1 });

    const failed = await deliverForegroundReminders(host(), reminderPort, { labels, now });
    expect(failed).toEqual({ delivered: [], reason: 'failed' });

    // 投递失败不写回执 ⇒ 下一轮还会再试一次。
    const retried = await deliverForegroundReminders(host(), reminderPort, { labels, now });
    expect(retried.delivered).toEqual([id]);
    expect(attempts).toBe(2);
  });

  it('does not deliver a reminder whose task was deleted', async () => {
    const { taskId, id } = await reminderOn('交周报', clock - 1_000);
    await createTaskActions(engine, { now }).remove(taskId);
    const { reminderPort, shown } = port({});

    const result = await deliverForegroundReminders(host(), reminderPort, { labels, now });

    expect(result.delivered).toEqual([]);
    expect(shown).toHaveLength(0);
    expect((engine.getState().reminders as Record<string, never>)[id]).toBeDefined();
  });

  it('asks the OS only when something is actually pending, never on an empty pass', async () => {
    await reminderOn('交周报', clock + 60_000); // 还没到点
    let asked = 0;
    const { reminderPort } = port({ permission: 'default' });
    const asking: ReminderForegroundPort = {
      ...reminderPort,
      requestAuthorization: async () => { asked += 1; return 'default'; },
    };

    const notYet = await deliverForegroundReminders(host(), asking, { labels, now });
    expect(notYet.reason).toBe('empty');
    expect(asked).toBe(0); // 空跑一发不许换来一次系统弹窗

    clock += 60_000;
    const pending = await deliverForegroundReminders(host(), asking, { labels, now });
    expect(pending.reason).toBe('permission');
    expect(asked).toBe(1); // 有东西要投了才问，且只问这一次需要的量
  });

  it('delivers in the same pass once the OS grants the request', async () => {
    const { id } = await reminderOn('交周报', clock - 1_000);
    const { reminderPort, shown } = port({});
    const asking: ReminderForegroundPort = {
      ...reminderPort,
      authorizationStatus: async () => 'default',
      requestAuthorization: async () => 'granted',
    };

    const result = await deliverForegroundReminders(host(), asking, { labels, now });
    expect(result.delivered).toEqual([id]);
    expect(shown).toHaveLength(1);
  });

  it('wakes at the next trigger, delivers, and stops when cancelled', async () => {
    const { id } = await reminderOn('交周报', clock + 60_000);
    const { reminderPort } = port({});
    const sleeps: { delay: number; fire: () => void }[] = [];
    const deliveries: string[] = [];

    const cancel = startForegroundReminderLoop(host(), reminderPort, {
      labels,
      now,
      sleep: (delay, fire) => {
        sleeps.push({ delay, fire });
        return () => undefined;
      },
      onDelivery: (result) => deliveries.push(...result.delivered),
    });

    // 挂上时先问一遍有没有已过点的（这条还没有）⇒ 排到 60 秒后。
    // 排程发生在第一轮投递之后，所以要先让那条 Promise 链跑完。
    await flush();
    expect(sleeps[0]?.delay).toBe(60_000);
    clock += 60_000;
    sleeps[0]?.fire();
    await flush();
    expect(deliveries).toEqual([id]);

    const before = sleeps.length;
    cancel();
    clock += 60_000;
    expect(sleeps.length).toBe(before);
  });
});
