/**
 * 提醒列表的**判断层**测试（跑在 node）
 * ======================================
 *
 * M3 第十刀（reminders）。这里测的**不是"渲染得对不对"**（那由各端的真实
 * 渲染负责），而是那些"写错不会让界面报错、只会静默错"的判断：
 *
 *   1. **`phase` / `when` 与领域函数逐项相等** —— 这是本文件最重要的一条。
 *      共享层若自己写 `snoozedUntil ?? triggerAt`，就出现了"什么时候出发"的
 *      第二份定义，而它必然在某一端漏掉 snooze（症状：用户按了稍后提醒，
 *      到点又弹一次）。所以这里拿领域函数做**逐项对照**，不是只测几个数字。
 *   2. **已 snooze 的提醒 `when === snoozedUntil`**（而不是 `triggerAt`）——
 *      1 的反例：只对照一个"没 snooze 的提醒"会让错误实现照样绿。
 *   3. **结束态（`fired` / `dismissed`）不能再 snooze / dismiss**，
 *      只剩 remove —— 领域层的判定顺序就是语义（`dismissed` / `fired`
 *      排在 `due` 之前），共享层不许重排。
 *   4. `offsetPresets()` 与 `REMINDER_OFFSET_PRESETS_MS` 是**同一个数组**
 *      （`toBe`，不是 `toEqual`）—— 文案靠下标对齐，长度/顺序漂移会让
 *      "提前 30 分钟"的按钮点下去变成"提前 1 天"。
 */

import { describe, expect, it } from 'vitest';
import {
  REMINDER_OFFSET_PRESETS_MS,
  reminderEffectiveAt,
  reminderPhase,
  type Reminder,
} from '@heyta/domain';

import {
  canDismissReminder,
  canSnoozeReminder,
  offsetPresets,
  toReminderRows,
} from '../src/reminders/model.js';

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** 造一条提醒。默认未投递、未关闭、未 snooze。 */
function reminder(
  partial: Partial<Reminder> & { id: string; triggerAt: number },
): Reminder {
  return { createdAt: NOW, updatedAt: NOW, taskId: 'task-1', ...partial };
}

describe('toReminderRows：phase / when 逐项来自领域层', () => {
  const reminders = [
    reminder({ id: 'r-scheduled', triggerAt: NOW + HOUR }),
    // 关键构造：触发时刻**已经过去**，但被 snooze 到未来 ——
    // 正确实现给出 `phase: 'snoozed'`、`when: snoozedUntil`；
    // 自己写 `snoozedUntil ?? triggerAt` 漏掉 snooze 的实现会给出
    // `due` + `triggerAt`，下面两条断言都会红。
    reminder({
      id: 'r-snoozed',
      triggerAt: NOW - HOUR,
      snoozedUntil: NOW + HOUR,
    }),
    reminder({ id: 'r-due', triggerAt: NOW - 1 }),
    reminder({ id: 'r-fired', triggerAt: NOW + HOUR, firedAt: NOW - 1 }),
    reminder({ id: 'r-dismissed', triggerAt: NOW + HOUR, dismissedAt: NOW - 1 }),
  ];

  it('每一行的 phase / when 都与领域函数相等', () => {
    const rows = toReminderRows(reminders, NOW);
    expect(rows).toHaveLength(reminders.length);
    rows.forEach((row, index) => {
      const source = reminders[index] as Reminder;
      expect(row.phase).toBe(reminderPhase(source, NOW));
      expect(row.when).toBe(reminderEffectiveAt(source));
    });
  });

  it('snoozed 的那一行 when 是 snoozedUntil，不是 triggerAt', () => {
    const rows = toReminderRows(reminders, NOW);
    const snoozed = rows.find((row) => row.id === 'r-snoozed');
    expect(snoozed?.phase).toBe('snoozed');
    expect(snoozed?.when).toBe(NOW + HOUR);
    expect(snoozed?.when).not.toBe(NOW - HOUR);
  });

  it('entityId 是提醒自己的 id（宿主 action 按它查 state.reminders），不是 taskId', () => {
    const rows = toReminderRows([reminder({ id: 'r1', triggerAt: NOW, taskId: 't-9' })], NOW);
    expect(rows[0]?.id).toBe('r1');
    // 🔴 `@heyta/app-host#createReminderActions.snoozeReminder(entityId)` 会走
    // `reminderOf(entityId)`，而 `Reminder.id` 形如 `t-9:…`。这里刻意同时断言
    // "等于提醒 id"和"不等于 taskId" —— 后者是本文件曾经写错的那个值，
    // 只断言前者的话，将来把 entityId 改成 taskId 时前者也可能跟着漂。
    expect(rows[0]?.entityId).toBe('r1');
    expect(rows[0]?.entityId).not.toBe('t-9');
  });
});

describe('结束态只剩 remove', () => {
  const rows = toReminderRows(
    [
      reminder({ id: 'r-scheduled', triggerAt: NOW + HOUR }),
      reminder({ id: 'r-due', triggerAt: NOW - 1 }),
      reminder({ id: 'r-fired', triggerAt: NOW + HOUR, firedAt: NOW - 1 }),
      reminder({ id: 'r-dismissed', triggerAt: NOW + HOUR, dismissedAt: NOW - 1 }),
    ],
    NOW,
  );
  const byId = (id: string) => rows.find((row) => row.id === id);

  it('fired / dismissed 不能 snooze 也不能 dismiss', () => {
    for (const id of ['r-fired', 'r-dismissed']) {
      const row = byId(id);
      expect(row?.canSnooze).toBe(false);
      expect(row?.canDismiss).toBe(false);
      expect(canSnoozeReminder(row!)).toBe(false);
      expect(canDismissReminder(row!)).toBe(false);
    }
  });

  it('未到点的可以 dismiss（也可以 snooze）', () => {
    const row = byId('r-scheduled');
    expect(row?.canSnooze).toBe(true);
    expect(row?.canDismiss).toBe(true);
    expect(canSnoozeReminder(row!)).toBe(true);
    expect(canDismissReminder(row!)).toBe(true);
  });

  it('到点但还没投递的（due）仍然可以 snooze / dismiss', () => {
    const row = byId('r-due');
    expect(row?.phase).toBe('due');
    expect(row?.canSnooze).toBe(true);
    expect(row?.canDismiss).toBe(true);
  });

  it('任何存活状态都能 remove', () => {
    expect(rows.every((row) => row.canRemove)).toBe(true);
  });
});

describe('offsetPresets：转发领域层的同一个数组', () => {
  it('是同一个数组引用（toBe）', () => {
    expect(offsetPresets()).toBe(REMINDER_OFFSET_PRESETS_MS);
  });

  it('第一个预设是 0（"截止时"）', () => {
    expect(offsetPresets()[0]).toBe(0);
  });
});
