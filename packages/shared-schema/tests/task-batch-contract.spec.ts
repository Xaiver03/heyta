import { describe, expect, it } from 'vitest';
import { heytaTaskBatchPayloadSchema, parseTaskBatchOperation } from '../src/task-batch-contract';

const payload = () => ({
  heytaTaskBatch: 1,
  source: { version: 1, eventId: 'event', ruleId: 'rule', ruleVersion: 1, parseVersion: 1, digest: 'a'.repeat(64) },
  tasks: [{ id: 'inbound:event:0', title: 'Task', priority: 0 }],
});

describe('task batch wire contract', () => {
  it('accepts exact limits, and rejects limit + 1', () => {
    const value = payload();
    value.tasks = Array.from({ length: 50 }, (_, i) => ({ id: `inbound:event:${i}`, title: 'a'.repeat(500), priority: 0 }));
    expect(heytaTaskBatchPayloadSchema.safeParse(value).success).toBe(true);
    expect(heytaTaskBatchPayloadSchema.safeParse({ ...value, tasks: [...value.tasks, { id: 'inbound:event:50', title: 'Task', priority: 0 }] }).success).toBe(false);
    expect(heytaTaskBatchPayloadSchema.safeParse({ ...payload(), tasks: [{ id: 'inbound:event:0', title: 'a'.repeat(501), priority: 0 }] }).success).toBe(false);
    for (const length of [10_000, 10_001]) {
      expect(heytaTaskBatchPayloadSchema.safeParse({ ...payload(), tasks: [{ ...payload().tasks[0], note: 'a'.repeat(length) }] }).success).toBe(length === 10_000);
    }
    for (const durationMinutes of [5, 480]) {
      expect(heytaTaskBatchPayloadSchema.safeParse({ ...payload(), tasks: [{ ...payload().tasks[0], durationMinutes }] }).success).toBe(true);
    }
  });

  it.each([
    { tasks: [] }, { heytaTaskBatch: 2 }, { extraTool: 'delete_task' },
    { tasks: [payload().tasks[0], payload().tasks[0]] },
    { tasks: [{ ...payload().tasks[0], title: ' ' }] },
    { tasks: [{ ...payload().tasks[0], id: '__proto__' }] },
    { tasks: [{ ...payload().tasks[0], completedAt: 1 }] },
    { tasks: [{ ...payload().tasks[0], dueDate: Number.NaN }] },
    { tasks: [{ ...payload().tasks[0], durationMinutes: 481 }] },
    { tasks: [{ ...payload().tasks[0], durationMinutes: 4 }] },
    { tasks: [{ ...payload().tasks[0], priority: 4 }] },
    { tasks: [{ ...payload().tasks[0], projectId: 'a' }, { id: 'inbound:event:1', title: 'Two', priority: 0, projectId: 'b' }] },
  ])('rejects malformed or out-of-scope shape %#', (override) => {
    expect(heytaTaskBatchPayloadSchema.safeParse({ ...payload(), ...override }).success).toBe(false);
  });

  it('requires exact ordered scope and refuses the marker on other operations', () => {
    const op = { entityType: 'TASK', opType: 'BATCH', entityId: 'inbound:event:0', payload: payload() };
    expect(parseTaskBatchOperation(op).tasks).toHaveLength(1);
    for (const override of [{ entityType: 'PROJECT' }, { opType: 'UPD' }, { entityId: 'other' }, { entityIds: ['inbound:event:0'] }]) {
      expect(() => parseTaskBatchOperation({ ...op, ...override })).toThrow();
    }
  });
});
