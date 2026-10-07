import { isLive } from '@heyta/domain';
import { OpType } from '@heyta/sync-core';
import { heytaTaskBatchPayloadSchema, parseTaskBatchOperation, type HeytaTaskBatchPayload, type TaskAutomationSource } from '@heyta/shared-schema';
import type { MaterializedState, OpIntent } from '@heyta/op-log';

/** Supplied by the authenticated worker, never inferred from a model response. */
export interface TaskBatchAuthorization {
  source: TaskAutomationSource;
  targetProjectId: string | undefined;
}

export interface TaskBatchContext {
  dispatchValidated(intent: OpIntent, validate: (state: MaterializedState) => void): Promise<unknown>;
}

function assertTargetAvailable(state: MaterializedState, targetProjectId: string | undefined): void {
  if (targetProjectId === undefined) return;
  const project = state.projects[targetProjectId];
  if (project === undefined || !isLive(project)) throw new Error('Task batch target is unavailable');
}

/** Build and validate one intent. Lease/permit coordination belongs to the worker. */
export function prepareTaskBatchIntent(
  payload: HeytaTaskBatchPayload,
  authorization: TaskBatchAuthorization,
): OpIntent {
  const parsed = heytaTaskBatchPayloadSchema.safeParse(payload);
  if (!parsed.success) throw new Error('Invalid task batch');
  payload = parsed.data;
  const intent: OpIntent = {
    entityType: 'TASK', opType: OpType.Batch,
    entityId: payload.tasks[0]?.id ?? '',
    entityIds: payload.tasks.slice(1).map((task) => task.id),
    payload,
  };
  const batch = parseTaskBatchOperation({ ...intent, payload });
  const source = authorization.source;
  if (batch.source.version !== source.version || batch.source.eventId !== source.eventId ||
      batch.source.ruleId !== source.ruleId || batch.source.ruleVersion !== source.ruleVersion ||
      batch.source.parseVersion !== source.parseVersion || batch.source.digest !== source.digest ||
      batch.tasks.some((task) => task.projectId !== authorization.targetProjectId)) {
    throw new Error('Task batch is outside the authorized scope');
  }
  // Existing IDs, tombstones and retry content are checked in the engine's
  // serialized dispatch against the original durable operation, not UI state.
  return { ...intent, payload: batch };
}

/** One local intent; not a distributed idempotency or authorization protocol. */
export async function createTaskBatch(
  ctx: TaskBatchContext,
  payload: HeytaTaskBatchPayload,
  authorization: TaskBatchAuthorization,
): Promise<readonly string[]> {
  const intent = prepareTaskBatchIntent(payload, authorization);
  const ids = (intent.payload as HeytaTaskBatchPayload).tasks.map((task) => task.id);
  const target = authorization.targetProjectId;
  await ctx.dispatchValidated(intent, (state) => assertTargetAvailable(state, target));
  return ids;
}
