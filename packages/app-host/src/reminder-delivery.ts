import { reminderEffectiveAt, reminderIsFired, type Reminder, type Task } from '@heyta/domain';

import type { AppHost } from './host.js';
import { createReminderActions } from './reminder-actions.js';
import { planNativeReminders } from './reminder-scheduler.js';

export type ReminderAuthorization = 'granted' | 'denied' | 'default' | 'unsupported';

/** Platform port for the system notification center. No platform API belongs here. */
export interface ReminderDeliveryPort {
  authorizationStatus(): Promise<ReminderAuthorization>;
  schedule(id: string, atMs: number, title: string, body: string): Promise<boolean>;
  cancelStale(keepIds: readonly string[], pendingIds: readonly string[]): Promise<boolean>;
  peekDelivered(): Promise<readonly string[]>;
  acknowledgeDelivered(ids: readonly string[]): Promise<boolean>;
}

export interface ReminderDeliveryOptions {
  now?: () => number;
  maxPending?: number;
}

function parseOccurrenceId(value: string): { id: string; triggerAt: number } | undefined {
  const separator = value.lastIndexOf('|');
  if (separator <= 0) return undefined;
  const id = value.slice(0, separator);
  const triggerAt = Number(value.slice(separator + 1));
  return Number.isInteger(triggerAt) && triggerAt > 0 ? { id, triggerAt } : undefined;
}

/**
 * Reconcile one host with one platform notification center.
 *
 * This is the business protocol: receipts are accepted only for the occurrence
 * they belong to. The occurrence marker persists as data so replay order stays convergent.
 */
export async function reconcileReminderDelivery(
  host: AppHost,
  delivery: ReminderDeliveryPort,
  options: ReminderDeliveryOptions = {},
): Promise<void> {
  const now = options.now ?? Date.now;
  const actions = createReminderActions(host, { now });
  const delivered = await delivery.peekDelivered();
  const acknowledged: string[] = [];
  const currentReminders = host.getState().reminders as Record<string, Reminder>;

  for (const occurrenceId of delivered) {
    const occurrence = parseOccurrenceId(occurrenceId);
    const current = occurrence === undefined ? undefined : currentReminders[occurrence.id];
    // Unknown/malformed receipts and terminal reminders are stale native state.
    if (
      occurrence === undefined ||
      current === undefined ||
      current.deletedAt !== undefined ||
      current.dismissedAt !== undefined ||
      reminderIsFired(current) ||
      reminderEffectiveAt(current) !== occurrence.triggerAt
    ) {
      acknowledged.push(occurrenceId);
      continue;
    }

    try {
      // Store the observed occurrence as data; a queued snooze leaves the old
      // receipt in history without making the new occurrence fired.
      await actions.markReminderFired(occurrence.id, occurrence.triggerAt);
      acknowledged.push(occurrenceId);
    } catch {
      // Keep the receipt for a later retry if the local op could not be written.
    }
  }
  await delivery.acknowledgeDelivered(acknowledged);

  const reminders = Object.values(host.getState().reminders) as Reminder[];
  const tasks = host.getState().tasks as Record<string, Task>;
  const pending = planNativeReminders(reminders, tasks, now(), options.maxPending);
  // Keep the current occurrence for fired reminders too. The system notification
  // may still be visible after the firedAt op is acknowledged; only a deletion,
  // dismissal, or a changed snooze/trigger makes that native request stale.
  const keepIds = reminders
    .filter((reminder) => {
      const task = tasks[reminder.taskId];
      return task !== undefined && task.deletedAt === undefined && reminder.deletedAt === undefined && reminder.dismissedAt === undefined;
    })
    .map((reminder) => `${reminder.id}|${reminderEffectiveAt(reminder)}`);
  if (!await delivery.cancelStale(keepIds, pending.map((reminder) => reminder.occurrenceId))) {
    throw new Error('Reminder reconciliation could not cancel stale requests');
  }
  if (pending.length === 0) return;

  const permission = await delivery.authorizationStatus();
  if (permission !== 'granted') return;
  for (const reminder of pending) {
    await delivery.schedule(reminder.occurrenceId, reminder.atMs, 'heyta', reminder.title);
  }
}

/**
 * Coalesce overlapping startup/foreground triggers while guaranteeing one
 * fresh pass after a trigger arrives during an in-flight pass.
 */
export function createReminderReconciler(run: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | undefined;
  let dirty = false;

  return () => {
    dirty = true;
    if (running !== undefined) return running;
    running = (async () => {
      while (dirty) {
        dirty = false;
        await run();
      }
    })().finally(() => {
      running = undefined;
    });
    return running;
  };
}
