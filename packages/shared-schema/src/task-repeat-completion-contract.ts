import { z } from 'zod';

/**
 * One narrowly-scoped cross-entity operation for completing a repeating task.
 *
 * It is intentionally a payload marker rather than a new entity type or a
 * general transaction language. The op is still routed as TASK/UPD; the
 * reducer knows this one marker also carries the reminder field patches that
 * belong to the same occurrence.
 */
const identity = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/)
  .refine((value) => value !== 'constructor' && value !== 'prototype' && value !== '__proto__');
const epoch = z.number().int().min(-8_640_000_000_000_000).max(8_640_000_000_000_000);
const receipt = z.string().min(1).max(256);

const taskPatch = z.object({
  dueDate: epoch,
  widgetCompletionReceipts: z.array(receipt).max(100).optional(),
}).strict();

const reminderPatch = z.object({
  id: identity,
  triggerAt: epoch,
  dismissedAt: epoch.nullable(),
  snoozedUntil: epoch.nullable(),
  firedForTriggerAt: epoch.optional(),
}).strict();

export const heytaTaskRepeatCompletionPayloadSchema = z.object({
  heytaTaskRepeatCompletion: z.literal(1),
  task: taskPatch,
  reminders: z.array(reminderPatch).max(50),
}).strict();

export type TaskRepeatCompletionTaskPatch = z.infer<typeof taskPatch>;
export type TaskRepeatCompletionReminderPatch = z.infer<typeof reminderPatch>;
export type HeytaTaskRepeatCompletionPayload = z.infer<typeof heytaTaskRepeatCompletionPayloadSchema>;

/** Detect the marker before ordinary TASK/UPD fallback. */
export function hasTaskRepeatCompletionMarker(payload: unknown): boolean {
  return payload !== null && typeof payload === 'object' && Object.hasOwn(payload, 'heytaTaskRepeatCompletion');
}

/**
 * Validate the complete scoped shape. Reminder ids are constrained to the
 * task's id prefix so this marker cannot become a generic arbitrary
 * cross-entity executor.
 */
export function parseTaskRepeatCompletionOperation(op: {
  entityType: string;
  opType: string;
  entityId?: string;
  entityIds?: readonly string[];
  payload: unknown;
}): HeytaTaskRepeatCompletionPayload {
  const parsed = heytaTaskRepeatCompletionPayloadSchema.safeParse(op.payload);
  if (!parsed.success || op.entityType !== 'TASK' || op.opType !== 'UPD' ||
      op.entityId === undefined || (op.entityIds?.length ?? 0) !== 0) {
    throw new Error('Invalid or unsupported task repeat completion');
  }
  const ids = parsed.data.reminders.map((reminder) => reminder.id);
  const validReminderId = (id: string): boolean => {
    const separator = id.lastIndexOf(':');
    if (separator <= 0 || separator === id.length - 1) return false;
    const parentTaskId = id.slice(0, separator);
    const triggerText = id.slice(separator + 1);
    if (!/^-?(?:0|[1-9][0-9]*)$/.test(triggerText)) return false;
    const triggerAt = Number(triggerText);
    // The suffix is the reminder's creation trigger. Repeating-task
    // rescheduling deliberately keeps the reminder entity id stable while
    // changing its current `triggerAt`, so it must not equal the patch value.
    return parentTaskId === op.entityId && Number.isSafeInteger(triggerAt);
  };
  if (new Set(ids).size !== ids.length || ids.some((id) => !validReminderId(id))) {
    throw new Error('Task repeat completion reminder scope mismatch');
  }
  return parsed.data;
}
