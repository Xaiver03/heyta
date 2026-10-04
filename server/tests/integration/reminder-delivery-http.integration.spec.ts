/**
 * Two independent SQLite hosts, encrypted HTTP sync and real PostgreSQL.
 * The notification port is a controlled observer: this proves receipt transport
 * and scheduling decisions, not delivery by Android/iOS notification centers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as jwt from 'jsonwebtoken';
import {
  openAppHost, createTaskActions, createReminderActions, reconcileReminderDelivery,
  type AppHost, type ReminderDeliveryPort,
} from '@heyta/app-host';
import { reminderIsFired } from '@heyta/domain';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';

function notificationObserver() {
  const pending = new Set<string>();
  const scheduled: string[] = [];
  const acknowledged: string[] = [];
  let delivered: string[] = [];
  const port: ReminderDeliveryPort = {
    authorizationStatus: async () => 'granted',
    peekDelivered: async () => [...delivered],
    acknowledgeDelivered: async (ids) => {
      acknowledged.push(...ids);
      delivered = delivered.filter((id) => !ids.includes(id));
      return true;
    },
    cancelStale: async (_visible, keepPending) => {
      for (const id of pending) if (!keepPending.includes(id)) pending.delete(id);
      return true;
    },
    schedule: async (id) => { pending.add(id); scheduled.push(id); return true; },
  };
  return { port, pending, scheduled, acknowledged, deliver: (id: string) => { delivered.push(id); } };
}

describe.skipIf(!process.env.DATABASE_URL)('reminder receipts over encrypted HTTP and independent SQLite hosts', () => {
  const db = new PrismaClient();
  const app = Fastify();
  const priorSecret = process.env.JWT_SECRET;
  const hosts = new Set<AppHost>();
  let userId: number;
  let token: string;
  let base: string;
  let directory: string;
  const passphrase = 'reminder-http-test-passphrase';

  async function openDevice(name: string): Promise<AppHost> {
    const dbPath = join(directory, `${name}.sqlite`);
    const host = await openAppHost({
      dbPath, driverFactory: () => new NodeSqliteDriver(dbPath),
      clientId: `reminder-http-${name}`, serverUrl: base, token,
      accountId: String(userId),
    });
    hosts.add(host);
    return host;
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = 'reminder-http-isolated-integration-secret-32';
    const { initSyncService } = await import('../../src/sync/sync.service');
    const { syncRoutes } = await import('../../src/sync/sync.routes');
    initSyncService();
    directory = await mkdtemp(join(tmpdir(), 'heyta-reminder-http-'));
    await app.register(syncRoutes, { prefix: '/api/sync' });
    base = await app.listen({ host: '127.0.0.1', port: 0 });
  }, 30000);

  beforeEach(async () => {
    const user = await db.user.create({ data: { email: `reminder-${randomUUID()}@test.local`, isVerified: 1 } });
    userId = user.id;
    token = jwt.sign({ userId, email: user.email, tokenVersion: 0 }, process.env.JWT_SECRET!);
  });

  afterEach(async () => {
    for (const host of hosts) host.close();
    hosts.clear();
    if (userId !== undefined) await db.user.delete({ where: { id: userId } });
  });

  afterAll(async () => {
    await app.close();
    await db.$disconnect();
    const { disconnectDb } = await import('../../src/db');
    await disconnectDb();
    if (directory) await rm(directory, { recursive: true, force: true });
    if (priorSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = priorSecret;
  });

  it('downloads the fired occurrence, cancels B pending work, survives reopen and permits a new occurrence', async () => {
    const a = await openDevice('a');
    const vault = (await a.getVaultSession())!;
    const creation = await vault.beginCreation(passphrase);
    await vault.confirmAndPublish(creation, creation.recoveryCode, a.getVaultKeyPackageRemote());
    const taskId = await createTaskActions(a).create('reminder HTTP transport sentinel');
    const triggerAt = Date.now() + 60_000;
    const actions = createReminderActions(a);
    const reminderId = await actions.createReminder(taskId, triggerAt);
    const occurrence = `${reminderId}|${triggerAt}`;
    expect(await a.sync()).toMatchObject({ kind: 'synced' });

    let b = await openDevice('b');
    await (await b.getVaultSession())!.unlockWithPassphrase(passphrase);
    expect(await b.sync()).toMatchObject({ kind: 'synced' });
    const notificationsB = notificationObserver();
    await reconcileReminderDelivery(b, notificationsB.port);
    // Positive control: the same B host actually scheduled before the receipt.
    expect([...notificationsB.pending]).toEqual([occurrence]);
    expect(notificationsB.scheduled).toEqual([occurrence]);

    const notificationsA = notificationObserver();
    notificationsA.deliver(occurrence);
    await reconcileReminderDelivery(a, notificationsA.port);
    expect(notificationsA.acknowledged).toEqual([occurrence]);
    const fired = (await a.engine.getAllOps()).find((op) => op.entityId === reminderId &&
      (op.payload as { firedForTriggerAt?: number }).firedForTriggerAt === triggerAt)!;
    expect(fired).toBeDefined();
    expect(await a.sync()).toMatchObject({ kind: 'synced' });
    const stored = await db.operation.findUniqueOrThrow({ where: { id: fired.id } });
    expect(stored.isPayloadEncrypted).toBe(true);
    expect(typeof stored.payload).toBe('string');
    expect(stored.payload).not.toContain('firedForTriggerAt');

    // B has never received a local notification receipt. Its fired state must
    // arrive through authenticated HTTP, decrypt, reduce and persist on disk.
    expect(await b.sync()).toMatchObject({ kind: 'synced' });
    expect((await b.engine.getAllOps()).find((op) => op.id === fired.id)).toMatchObject({
      clientId: a.clientId, payload: { firedForTriggerAt: triggerAt },
    });
    await reconcileReminderDelivery(b, notificationsB.port);
    expect(notificationsB.pending.size).toBe(0);
    expect(notificationsB.scheduled).toEqual([occurrence]);
    expect(notificationsB.acknowledged).toEqual([]);

    b.close(); hosts.delete(b);
    b = await openDevice('b');
    expect(reminderIsFired(b.getState().reminders[reminderId]!)).toBe(true);
    const restartedNotifications = notificationObserver();
    await reconcileReminderDelivery(b, restartedNotifications.port);
    expect(restartedNotifications.scheduled).toEqual([]);

    const nextTrigger = triggerAt + 60_000;
    await actions.rescheduleReminder(reminderId, nextTrigger);
    expect(await a.sync()).toMatchObject({ kind: 'synced' });
    await (await b.getVaultSession())!.unlockWithPassphrase(passphrase);
    expect(await b.sync()).toMatchObject({ kind: 'synced' });
    restartedNotifications.deliver(occurrence); // late OS callback for old trigger
    await reconcileReminderDelivery(b, restartedNotifications.port);
    expect(restartedNotifications.acknowledged).toEqual([occurrence]);
    expect(restartedNotifications.scheduled).toEqual([`${reminderId}|${nextTrigger}`]);
    expect(reminderIsFired(b.getState().reminders[reminderId]!)).toBe(false);
    const count = await b.engine.countStoredOps();
    restartedNotifications.deliver(`${reminderId}|${nextTrigger}`);
    await reconcileReminderDelivery(b, restartedNotifications.port);
    expect(b.getState().reminders[reminderId]?.firedForTriggerAt).toBe(nextTrigger);
    expect(await b.engine.countStoredOps()).toBe(count + 1);
    await reconcileReminderDelivery(b, restartedNotifications.port);
    expect(await b.engine.countStoredOps()).toBe(count + 1);
  }, 30000);

  it('transports snooze and daily completion without applying a late receipt to the next occurrence', async () => {
    const a = await openDevice('snooze-repeat-a');
    const b = await openDevice('snooze-repeat-b');
    const vault = (await a.getVaultSession())!;
    const creation = await vault.beginCreation(passphrase);
    await vault.confirmAndPublish(creation, creation.recoveryCode, a.getVaultKeyPackageRemote());
    await (await b.getVaultSession())!.unlockWithPassphrase(passphrase);
    const tasks = createTaskActions(a);
    const actions = createReminderActions(a);
    const taskId = await tasks.create('snooze transport');
    const triggerAt = Date.now() + 60_000;
    const reminderId = await actions.createReminder(taskId, triggerAt);
    const oldOccurrence = `${reminderId}|${triggerAt}`;
    expect(await a.sync()).toMatchObject({ kind: 'synced' });
    expect(await b.sync()).toMatchObject({ kind: 'synced' });
    const nativeB = notificationObserver();
    await reconcileReminderDelivery(b, nativeB.port);
    expect([...nativeB.pending]).toEqual([oldOccurrence]);

    const snoozedUntil = triggerAt + 600_000;
    expect(await actions.snoozeReminder(reminderId, snoozedUntil)).toBe(true);
    expect(await a.sync()).toMatchObject({ kind: 'synced' });
    expect(await b.sync()).toMatchObject({ kind: 'synced' });
    nativeB.deliver(oldOccurrence);
    await reconcileReminderDelivery(b, nativeB.port);
    const snoozedOccurrence = `${reminderId}|${snoozedUntil}`;
    expect([...nativeB.pending]).toEqual([snoozedOccurrence]);
    expect(nativeB.acknowledged).toEqual([oldOccurrence]);
    expect(reminderIsFired(b.getState().reminders[reminderId]!)).toBe(false);
    nativeB.deliver(snoozedOccurrence);
    await reconcileReminderDelivery(b, nativeB.port);
    expect(await b.sync()).toMatchObject({ kind: 'synced' });
    expect(await a.sync()).toMatchObject({ kind: 'synced' });
    expect(a.getState().reminders[reminderId]?.firedForTriggerAt).toBe(snoozedUntil);

    const due = new Date(); due.setDate(due.getDate() + 2); due.setHours(0, 0, 0, 0);
    const nextDue = new Date(due); nextDue.setDate(nextDue.getDate() + 1);
    const repeatingTask = await tasks.create('daily repeat transport', { dueDate: due.getTime() });
    await tasks.setRepeat(repeatingTask, 'FREQ=DAILY');
    const repeatingReminder = await actions.createReminderBeforeDue(repeatingTask, 0);
    const repeatOccurrence = `${repeatingReminder}|${due.getTime()}`;
    expect(await a.sync()).toMatchObject({ kind: 'synced' });
    expect(await b.sync()).toMatchObject({ kind: 'synced' });
    await reconcileReminderDelivery(b, nativeB.port);
    expect([...nativeB.pending]).toEqual([repeatOccurrence]);
    const nativeA = notificationObserver();
    nativeA.deliver(repeatOccurrence);
    await reconcileReminderDelivery(a, nativeA.port);
    expect(await a.sync()).toMatchObject({ kind: 'synced' });
    expect(await b.sync()).toMatchObject({ kind: 'synced' });
    await reconcileReminderDelivery(b, nativeB.port);
    expect(nativeB.pending.size).toBe(0);

    await tasks.setCompleted(repeatingTask, true);
    expect(a.getState().tasks[repeatingTask]?.dueDate).toBe(nextDue.getTime());
    expect(await a.sync()).toMatchObject({ kind: 'synced' });
    expect(await b.sync()).toMatchObject({ kind: 'synced' });
    nativeB.deliver(repeatOccurrence);
    await reconcileReminderDelivery(b, nativeB.port);
    expect(b.getState().tasks[repeatingTask]?.dueDate).toBe(nextDue.getTime());
    expect([...nativeB.pending]).toEqual([`${repeatingReminder}|${nextDue.getTime()}`]);
    expect(reminderIsFired(b.getState().reminders[repeatingReminder]!)).toBe(false);
    expect(nativeB.acknowledged).toContain(repeatOccurrence);
  }, 30000);
});
