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

  /**
   * 🔴 这一格是**回归判据**，不是新功能：`taskPatch` 当初是 `.strict()` 且只有 `dueDate`，
   * 而生产侧在任务带 `dueDateLocal` 时会把它一起塞进来 ⇒ `.strict()` 拒掉整个 op ⇒
   * **任何"带本地日期（全天）的重复任务"一勾完成就抛
   * `Invalid or unsupported task repeat completion`。**
   *
   * 本条与下面两条一起把这件事钉住：① 同一天时接受；② 错开 7 天时拒绝；
   * ③ 日历上不存在的日子拒绝（`2026-02-30`）。
   */
  it('accepts an optional dueDateLocal that falls on the same day as dueDate', () => {
    const withLocal = {
      ...payload,
      task: { dueDate: 1_800_000_000_000, dueDateLocal: '2027-01-15' },
    };
    // 1_800_000_000_000 = 2027-01-15T08:00:00.000Z ⇒ 同一天（任意时区的本地零点都在 24h 内）
    expect(parseTaskRepeatCompletionOperation(operation(withLocal)).task).toEqual({
      dueDate: 1_800_000_000_000,
      dueDateLocal: '2027-01-15',
    });
  });

  it('rejects a dueDateLocal that drifts a whole period away from dueDate', () => {
    const drifted = {
      ...payload,
      task: { dueDate: 1_800_000_000_000, dueDateLocal: '2027-01-22' },
    };
    expect(() => parseTaskRepeatCompletionOperation(operation(drifted))).toThrow(
      'Invalid or unsupported task repeat completion',
    );
  });

  /**
   * ⚠️ **这一条必须让"日期不存在"与"同日"两条校验互相独立**，否则它会为错误的理由而绿。
   *
   * 第一次写这条时我用的是 `dueDateLocal: '2027-02-30'` + 原来的 `dueDate`：
   * `2027-02-30` 会被 `Date.parse` 归一化成 `2027-03-02`，于是"同日"那条先把它拒了 ——
   * **把 `localDateSchema` 换成 `z.string()` 这条测试照样绿**（实测：变异后仍 9 passed）。
   * 所以这里把 `dueDate` 设成 **2/30 归一化后的那一天**（`2027-03-02` = 1803945600000），
   * 让同日校验无话可说，只剩"这一天真的存在吗"这一条在判。
   */
  it('rejects a dueDateLocal that is not a real calendar day（与同日校验相互独立）', () => {
    const impossible = {
      ...payload,
      task: { dueDate: 1_803_945_600_000, dueDateLocal: '2027-02-30' },
    };
    expect(() => parseTaskRepeatCompletionOperation(operation(impossible))).toThrow(
      'Invalid or unsupported task repeat completion',
    );
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
