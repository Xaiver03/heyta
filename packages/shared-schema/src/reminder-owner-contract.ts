/**
 * The stable owner encoded in a task reminder id.
 *
 * Reminder ids produced by app-host are `${taskId}:${triggerAt}`.  Task ids
 * may themselves contain colons, so the final colon is the only separator.
 * Older imported data used opaque ids; those remain readable and are outside
 * this contract until an owner is explicitly written.
 */
export function reminderOwnerFromId(id: string): string | undefined {
  const separator = id.lastIndexOf(':');
  if (separator <= 0 || separator === id.length - 1) return undefined;
  const triggerText = id.slice(separator + 1);
  if (!/^-?(?:0|[1-9][0-9]*)$/.test(triggerText)) return undefined;
  const triggerAt = Number(triggerText);
  if (!Number.isSafeInteger(triggerAt)) return undefined;
  return id.slice(0, separator);
}

/**
 * Validate the immutable owner whenever a REMINDER create/update writes one.
 *
 * This is deliberately a narrow ingress check.  Legacy opaque reminder ids
 * remain valid, while every canonical id used by repeating-task markers gets
 * one deterministic owner rule at all persistence boundaries.
 */
export function validateReminderOwnerOperation(operation: {
  entityType: string;
  opType: string;
  entityId?: string;
  entityIds?: readonly string[];
  payload?: unknown;
}): void {
  if (operation.entityType !== 'REMINDER' ||
      (operation.opType !== 'CRT' && operation.opType !== 'UPD')) return;
  const ids = [
    ...(operation.entityId === undefined ? [] : [operation.entityId]),
    ...(operation.entityIds ?? []),
  ];
  if (ids.length === 0) {
    throw new Error('REMINDER operation missing entity id');
  }
  if (new Set(ids).size > 1) {
    throw new Error('REMINDER multi-scope owner write is unsupported');
  }
  if (operation.payload === null || typeof operation.payload !== 'object' || Array.isArray(operation.payload)) {
    if (operation.opType === 'CRT') throw new Error('REMINDER operation payload must be an object');
    return;
  }
  const payload = operation.payload as Record<string, unknown>;
  if (!Object.hasOwn(payload, 'taskId')) {
    if (operation.opType === 'CRT' && ids.some((id) => reminderOwnerFromId(id) !== undefined)) {
      throw new Error('REMINDER create missing owner');
    }
    return;
  }
  if (typeof payload.taskId !== 'string' || ids.some((id) => {
    const owner = reminderOwnerFromId(id);
    return owner !== undefined && payload.taskId !== owner;
  })) {
    throw new Error('REMINDER owner mismatch');
  }
}
