import { describe, expect, it } from 'vitest';

import {
  hasTaskPriorityBatchMarker,
  parseTaskPriorityBatchOperation,
} from '../src/task-priority-batch-contract';

const operation = (payload: unknown, over: Record<string, unknown> = {}) => ({
  entityType: 'TASK',
  opType: 'BATCH',
  entityId: 'task-1',
  entityIds: ['task-2'],
  payload,
  ...over,
});

describe('task priority batch contract', () => {
  it('requires the additive marker and validates complete scope', () => {
    const parsed = parseTaskPriorityBatchOperation(operation({
      heytaTaskPriorityBatch: 1,
      items: [
        { id: 'task-1', priority: 1 },
        { id: 'task-2', priority: 3 },
      ],
    }));
    expect(parsed.items).toEqual([
      { id: 'task-1', priority: 1 },
      { id: 'task-2', priority: 3 },
    ]);
    expect(hasTaskPriorityBatchMarker(parsed)).toBe(true);
  });

  it('rejects duplicate ids, invalid priorities, and partial scope', () => {
    expect(() => parseTaskPriorityBatchOperation(operation({
      heytaTaskPriorityBatch: 1,
      items: [{ id: 'task-1', priority: 1 }, { id: 'task-1', priority: 3 }],
    }))).toThrow();
    expect(() => parseTaskPriorityBatchOperation(operation({
      heytaTaskPriorityBatch: 1,
      items: [{ id: 'task-1', priority: 9 }, { id: 'task-2', priority: 1 }],
    }))).toThrow();
    expect(() => parseTaskPriorityBatchOperation(operation({
      heytaTaskPriorityBatch: 1,
      items: [{ id: 'task-1', priority: 1 }],
    }))).toThrow('scope');
  });

  it('detects malformed marker versions before ordinary update fallback', () => {
    expect(hasTaskPriorityBatchMarker({ heytaTaskPriorityBatch: 2 })).toBe(true);
    expect(() => parseTaskPriorityBatchOperation(operation({ heytaTaskPriorityBatch: 2, items: [] }))).toThrow();
  });

  it('rejects prototype-sensitive task identities', () => {
    expect(() => parseTaskPriorityBatchOperation(operation({
      heytaTaskPriorityBatch: 1,
      items: [{ id: '__proto__', priority: 1 }, { id: 'task-2', priority: 3 }],
    }))).toThrow();
  });
});
