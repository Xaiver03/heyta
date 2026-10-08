import { z } from 'zod';

/**
 * A local, additive marker for one atomic priority update across tasks.
 *
 * This deliberately has no source/event identity: unlike inbound automation,
 * it is a normal local op and gets the engine's ordinary op id, clock, and LWW
 * metadata. The marker tells current reducers how to interpret the batch.
 */
const identity = z.string().min(1).max(128).refine(
  (value) => value !== '__proto__' && value !== 'constructor' && value !== 'prototype',
  { message: 'Unsafe task identity' },
);
const priority = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const taskPriorityBatchItemSchema = z.object({
  id: identity,
  priority,
}).strict();

export const heytaTaskPriorityBatchPayloadSchema = z.object({
  heytaTaskPriorityBatch: z.literal(1),
  items: z.array(taskPriorityBatchItemSchema).min(1).max(50),
}).strict().superRefine(({ items }, ctx) => {
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    ctx.addIssue({ code: 'custom', message: 'Duplicate task identity' });
  }
});

export type TaskPriorityBatchItem = z.infer<typeof taskPriorityBatchItemSchema>;
export type HeytaTaskPriorityBatchPayload = z.infer<typeof heytaTaskPriorityBatchPayloadSchema>;

/** Detect the marker before ordinary UPDATE/BATCH fallback. */
export function hasTaskPriorityBatchMarker(payload: unknown): boolean {
  return payload !== null && typeof payload === 'object' && Object.hasOwn(payload, 'heytaTaskPriorityBatch');
}

/** Validate marker, operation kind, and the complete entity scope before reduction. */
export function parseTaskPriorityBatchOperation(op: {
  entityType: string;
  opType: string;
  entityId?: string;
  entityIds?: readonly string[];
  payload: unknown;
}): HeytaTaskPriorityBatchPayload {
  const parsed = heytaTaskPriorityBatchPayloadSchema.safeParse(op.payload);
  if (!parsed.success || op.entityType !== 'TASK' || op.opType !== 'BATCH') {
    throw new Error('Invalid or unsupported task priority batch');
  }
  const ids = parsed.data.items.map((item) => item.id);
  const scope = [op.entityId, ...(op.entityIds ?? [])];
  if (scope.length !== ids.length || scope.some((id, index) => id !== ids[index])) {
    throw new Error('Task priority batch scope mismatch');
  }
  return parsed.data;
}
