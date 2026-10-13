import { describe, expect, it } from 'vitest';

import {
  hasTaskRepeatCompletionMarker,
  parseTaskRepeatCompletionOperation,
} from '../src/task-repeat-completion-contract';
import { reminderOwnerFromId, validateReminderOwnerOperation } from '../src/reminder-owner-contract';

describe('reminder owner contract', () => {
  it('uses the final colon so task ids may contain colons', () => {
    expect(reminderOwnerFromId('project:task:1799999900000')).toBe('project:task');
    expect(reminderOwnerFromId('project:task:not-a-trigger')).toBeUndefined();
  });

  it('rejects canonical create/update owner mismatches and permits legacy opaque ids', () => {
    expect(() => validateReminderOwnerOperation({
      entityType: 'REMINDER', opType: 'CRT', entityId: 'task-1:1', payload: { taskId: 'other-task' },
    })).toThrow('owner mismatch');
    expect(() => validateReminderOwnerOperation({
      entityType: 'REMINDER', opType: 'CRT', entityId: 'task-1:1', payload: {},
    })).toThrow('missing owner');
    expect(() => validateReminderOwnerOperation({
      entityType: 'REMINDER', opType: 'UPD', entityId: 'task-1:1', payload: { taskId: 'task-1' },
    })).not.toThrow();
    expect(() => validateReminderOwnerOperation({
      entityType: 'REMINDER', opType: 'UPD', entityId: 'task-1:1', entityIds: ['task-2:2'],
      payload: { taskId: 'task-1' },
    })).toThrow('multi-scope');
    expect(() => validateReminderOwnerOperation({
      entityType: 'REMINDER', opType: 'UPD', entityId: 'r1', payload: { taskId: 'legacy-task' },
    })).not.toThrow();
  });
});

const operation = (payload: unknown, over: Record<string, unknown> = {}) => ({
  entityType: 'TASK',
  opType: 'UPD',
  entityId: 'task-1',
  payload,
  ...over,
});

const payload = {
  heytaTaskRepeatCompletion: 1,
  task: { dueDate: 1_800_000_000_000, widgetCompletionReceipts: ['widget-v1:task-1:done:42'] },
  reminders: [{
    id: 'task-1:1799999900000',
    triggerAt: 1_799_999_990_000,
    dismissedAt: null,
    snoozedUntil: null,
  }],
};

describe('task repeat completion contract', () => {
  it('accepts one scoped task update plus reminder patches', () => {
    expect(parseTaskRepeatCompletionOperation(operation(payload))).toEqual(payload);
    expect(hasTaskRepeatCompletionMarker(payload)).toBe(true);
  });

  it('rejects malformed versions, duplicate ids, and cross-task reminder scope', () => {
    expect(hasTaskRepeatCompletionMarker({ heytaTaskRepeatCompletion: 2 })).toBe(true);
    expect(() => parseTaskRepeatCompletionOperation(operation({ ...payload, heytaTaskRepeatCompletion: 2 }))).toThrow();
    expect(() => parseTaskRepeatCompletionOperation(operation({
      ...payload,
      reminders: [payload.reminders[0], payload.reminders[0]],
    }))).toThrow();
    expect(() => parseTaskRepeatCompletionOperation(operation({
      ...payload,
      reminders: [{ ...payload.reminders[0], id: 'other-task:1' }],
    }))).toThrow('scope');
  });

  it('rejects entity fan-out and non-update routing', () => {
    expect(() => parseTaskRepeatCompletionOperation(operation(payload, { entityIds: ['task-2'] }))).toThrow();
    expect(() => parseTaskRepeatCompletionOperation(operation(payload, { opType: 'BATCH' }))).toThrow();
    expect(() => parseTaskRepeatCompletionOperation(operation(payload, { entityType: 'REMINDER' }))).toThrow();
  });

  it('uses the complete parent task id and a canonical numeric trigger suffix', () => {
    const nestedTask = {
      ...payload,
      reminders: [{ ...payload.reminders[0], id: 'task-1:nested:1799999990000' }],
    };
    expect(() => parseTaskRepeatCompletionOperation(operation(nestedTask))).toThrow('scope');
    expect(parseTaskRepeatCompletionOperation(operation(
      { ...payload, reminders: [{ ...payload.reminders[0], id: 'task-1:1799999900000' }] },
      { entityId: 'task-1' },
    ))).toEqual(payload);
    expect(() => parseTaskRepeatCompletionOperation(operation(
      { ...payload, reminders: [{ ...payload.reminders[0], id: 'task-1:bad' }] },
    ))).toThrow('scope');
  });
});
