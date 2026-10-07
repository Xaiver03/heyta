import { z } from 'zod';

/** Shared scheduling bounds. Domain/UI must consume these same values. */
export const TASK_MIN_DURATION_MINUTES = 5;
export const TASK_MAX_DURATION_MINUTES = 480;
export const TASK_BATCH_MAX_ITEMS = 50;
export const TASK_BATCH_MAX_TITLE_LENGTH = 500;
export const TASK_BATCH_MAX_NOTE_LENGTH = 10_000;

const identity = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/)
  .refine((value) => value !== 'constructor' && value !== 'prototype');
const epoch = z.number().int().min(-8_640_000_000_000_000).max(8_640_000_000_000_000);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const taskAutomationSourceSchema = z.object({
  version: z.literal(1),
  eventId: identity.refine((value) => value.length <= 64),
  ruleId: identity,
  ruleVersion: revision,
  parseVersion: revision,
  digest: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export const taskBatchItemSchema = z.object({
  id: identity,
  title: z.string().min(1).max(TASK_BATCH_MAX_TITLE_LENGTH)
    .refine((value) => value.trim() === value && value.length > 0),
  priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  note: z.string().max(TASK_BATCH_MAX_NOTE_LENGTH).optional(),
  projectId: identity.optional(),
  dueDate: epoch.optional(),
  startDate: epoch.optional(),
  durationMinutes: z.number().int().min(TASK_MIN_DURATION_MINUTES).max(TASK_MAX_DURATION_MINUTES).optional(),
}).strict();

export const heytaTaskBatchPayloadSchema = z.object({
  heytaTaskBatch: z.literal(1),
  source: taskAutomationSourceSchema,
  tasks: z.array(taskBatchItemSchema).min(1).max(TASK_BATCH_MAX_ITEMS),
}).strict().superRefine(({ tasks, source }, ctx) => {
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) {
    ctx.addIssue({ code: 'custom', message: 'Duplicate task identity' });
  }
  if (tasks.some((task) => task.projectId !== tasks[0]?.projectId)) {
    ctx.addIssue({ code: 'custom', message: 'A batch must have one target project' });
  }
  if (tasks.some((task, index) => task.id !== taskBatchItemId(source.eventId, index))) {
    ctx.addIssue({ code: 'custom', message: 'Task identity must belong to the event and item position' });
  }
});

/** Identity helpers only; they neither authorize nor dispatch an operation. */
export function taskBatchOperationId(eventId: string): string { return `inbound:${eventId}`; }
export function taskBatchItemId(eventId: string, index: number): string { return `inbound:${eventId}:${index}`; }

export type TaskAutomationSource = z.infer<typeof taskAutomationSourceSchema>;
export type TaskBatchItem = z.infer<typeof taskBatchItemSchema>;
export type HeytaTaskBatchPayload = z.infer<typeof heytaTaskBatchPayloadSchema>;

/** Detect the marker, including unsupported/malformed versions, before fallback. */
export function hasTaskBatchMarker(payload: unknown): boolean {
  return payload !== null && typeof payload === 'object' && Object.hasOwn(payload, 'heytaTaskBatch');
}

/** Validation errors deliberately exclude user content and raw Zod issues. */
export function parseTaskBatchOperation(op: {
  id?: string; entityType: string; opType: string; entityId?: string;
  entityIds?: readonly string[]; payload: unknown;
}): HeytaTaskBatchPayload {
  const parsed = heytaTaskBatchPayloadSchema.safeParse(op.payload);
  if (!parsed.success || op.entityType !== 'TASK' || op.opType !== 'BATCH') {
    throw new Error('Invalid or unsupported task batch');
  }
  if (op.id !== undefined && op.id !== taskBatchOperationId(parsed.data.source.eventId)) {
    throw new Error('Task batch operation identity mismatch');
  }
  const ids = parsed.data.tasks.map((task) => task.id);
  const scope = [op.entityId, ...(op.entityIds ?? [])];
  if (scope.length !== ids.length || scope.some((id, index) => id !== ids[index])) {
    throw new Error('Task batch scope mismatch');
  }
  return parsed.data;
}
