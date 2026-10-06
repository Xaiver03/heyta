import { reminderEffectiveAt, reminderIsFired, type Reminder, type Task } from '@heyta/domain';

export interface NativeReminderPlan {
  readonly id: string;
  readonly occurrenceId: string;
  readonly atMs: number;
  readonly title: string;
}

/** 纯决策层：错过的提醒立即补发；墓碑/关闭/已投递不进入系统队列。 */
export function planNativeReminders(
  reminders: readonly Reminder[], tasks: Readonly<Record<string, Task>>, now: number,
  maxCount?: number,
): NativeReminderPlan[] {
  const plans = reminders.filter((reminder) => {
    const task = tasks[reminder.taskId];
    return task !== undefined && task.deletedAt === undefined && reminder.deletedAt === undefined
      && reminder.dismissedAt === undefined && !reminderIsFired(reminder);
  }).map((reminder) => {
    const effectiveAt = reminderEffectiveAt(reminder);
    const atMs = Math.max(now + 250, effectiveAt);
    return {
      id: reminder.id,
      // The occurrence identifies the logical trigger, not the delivery time.
      // A missed reminder is delivered immediately, but must keep the same ID
      // across every startup/foreground reconciliation.
      occurrenceId: `${reminder.id}|${effectiveAt}`,
      atMs,
      title: tasks[reminder.taskId]!.title,
    };
  }).sort((a, b) => a.atMs - b.atMs || (a.occurrenceId < b.occurrenceId ? -1 : a.occurrenceId > b.occurrenceId ? 1 : 0));
  return maxCount === undefined ? plans : plans.slice(0, Math.max(0, maxCount));
}
