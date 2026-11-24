/**
 * 日历拖拽改期（`planCalendarDrop`）—— 业务语义的判据面
 * ======================================================
 *
 * 这一组钉四件事，每一条都对着一个"看起来对、跑起来会错"的坑：
 *
 * 1. **日期型任务改期 = 写 date-only**（`dueDateLocal` 跟上，`dueDate` 落本地零点），
 *    而不是把 `dueDate` 拍成某个带时刻的值 —— 否则跨时区会飘一天。
 * 2. **有时刻的任务换日子要搬运时刻**：拖到明天仍是同一时刻，不是变全天。
 *    不搬的症状是"提醒提前一整天"而界面看不出任何事发生。
 * 3. **落在同一天是 no-op**（返回 `undefined`）：不产生一条"值没变"的 op。
 * 4. **跨天排期任务不可拖**（`canRescheduleByCalendarDrag` 为 false）：
 *    拖一段该改 start 还是 due 没有唯一答案，属于刻意不做的边界。
 *
 * 🔴 判据能红：把 `planCalendarDrop` 的时刻搬运删掉（第 2 组红）；
 *    把 no-op 判断删掉（第 3 组红）；把 `canRescheduleByCalendarDrag` 的
 *    startDate 判断删掉（第 4 组红）。
 */

import { describe, expect, it } from 'vitest';

import { dueDateToEpoch } from '../src/capture.js';
import {
  canRescheduleByCalendarDrag,
  planCalendarDrop,
  planCalendarDropUndo,
  planCalendarTimeDrop,
} from '../src/calendar-drop.js';
import type { Task } from '../src/entities.js';

/** 只带排期相关字段的任务（其余字段与这几个纯函数无关）。 */
function task(partial: Partial<Task>): Task {
  return {
    id: 't',
    title: 't',
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

describe('date-only 任务：改期写 dueDateLocal + 本地零点', () => {
  it('拖到另一天 ⇒ dueDateLocal 跟过去、dueDate 落那天零点', () => {
    const t = task({ dueDateLocal: '2026-11-20', dueDate: dueDateToEpoch('2026-11-20') });
    expect(planCalendarDrop(t, '2026-11-25')).toEqual({
      dueDate: dueDateToEpoch('2026-11-25'),
      dueDateLocal: '2026-11-25',
    });
  });

  it('只有 epoch、且是本地零点（无 dueDateLocal）的任务，按"只到日"处理', () => {
    const t = task({ dueDate: dueDateToEpoch('2026-11-20') });
    expect(planCalendarDrop(t, '2026-11-22')).toEqual({
      dueDate: dueDateToEpoch('2026-11-22'),
      dueDateLocal: '2026-11-22',
    });
  });
});

describe('有时刻的任务：换日子搬运时刻（不变全天）', () => {
  it('16:30 拖到 11-25 ⇒ 仍是 11-25 的 16:30，且不写 dueDateLocal', () => {
    const t = task({ dueDate: dueDateToEpoch('2026-11-20', '16:30') });
    const plan = planCalendarDrop(t, '2026-11-25');
    expect(plan).toEqual({ dueDate: dueDateToEpoch('2026-11-25', '16:30') });
    // 有时刻 ⇒ 不该出现 dueDateLocal 键（与 DueEditor 同一约定）。
    expect(plan !== undefined && 'dueDateLocal' in plan).toBe(false);
  });
});

describe('落在同一天是 no-op', () => {
  it('date-only 任务拖回自己那天 ⇒ undefined', () => {
    const t = task({ dueDateLocal: '2026-11-20', dueDate: dueDateToEpoch('2026-11-20') });
    expect(planCalendarDrop(t, '2026-11-20')).toBeUndefined();
  });

  it('有时刻任务拖回自己那天 ⇒ undefined', () => {
    const t = task({ dueDate: dueDateToEpoch('2026-11-20', '09:00') });
    expect(planCalendarDrop(t, '2026-11-20')).toBeUndefined();
  });
});

describe('不可拖的边界：跨天排期 / 无截止 / 非法落点', () => {
  it('有 startDate 的任务不可拖（拖一段该改哪个字段没有唯一答案）', () => {
    const t = task({ startDate: dueDateToEpoch('2026-11-18'), dueDate: dueDateToEpoch('2026-11-20') });
    expect(canRescheduleByCalendarDrag(t)).toBe(false);
    expect(planCalendarDrop(t, '2026-11-25')).toBeUndefined();
  });

  it('有 durationMinutes 的任务不可拖', () => {
    const t = task({ startDate: dueDateToEpoch('2026-11-18'), durationMinutes: 60, dueDate: dueDateToEpoch('2026-11-18') });
    expect(canRescheduleByCalendarDrag(t)).toBe(false);
  });

  it('没有截止时间的任务不可拖（本来也不在日历上）', () => {
    expect(canRescheduleByCalendarDrag(task({}))).toBe(false);
    expect(planCalendarDrop(task({}), '2026-11-25')).toBeUndefined();
  });

  it('落点形状非法 ⇒ undefined', () => {
    const t = task({ dueDateLocal: '2026-11-20', dueDate: dueDateToEpoch('2026-11-20') });
    expect(planCalendarDrop(t, '2026-13-40')).toBeUndefined();
    expect(planCalendarDrop(t, 'next friday')).toBeUndefined();
  });
});

describe('撤销：恢复拖拽前的截止形状', () => {
  it('date-only 任务撤销回原 dueDateLocal', () => {
    const before = task({ dueDateLocal: '2026-11-20', dueDate: dueDateToEpoch('2026-11-20') });
    expect(planCalendarDropUndo(before)).toEqual({
      dueDate: dueDateToEpoch('2026-11-20'),
      dueDateLocal: '2026-11-20',
    });
  });

  it('无截止的任务撤销 ⇒ 两个 null（穿过 JSON 表达清除）', () => {
    expect(planCalendarDropUndo(task({}))).toEqual({ dueDate: null, dueDateLocal: null });
  });
});

describe('日档：拖到某一小时改时刻（planCalendarTimeDrop）', () => {
  it('全天任务拖到 10:00 ⇒ dueDate 变成那天 10:00（date-only 由 setDueDate 清除）', () => {
    const t = task({ dueDateLocal: '2026-11-20', dueDate: dueDateToEpoch('2026-11-20') });
    expect(planCalendarTimeDrop(t, '2026-11-20', 10)).toEqual({
      dueDate: dueDateToEpoch('2026-11-20', '10:00'),
    });
  });

  it('有时刻任务拖到另一个小时 ⇒ 时刻平移（同一天）', () => {
    const t = task({ dueDate: dueDateToEpoch('2026-11-20', '09:30') });
    expect(planCalendarTimeDrop(t, '2026-11-20', 16)).toEqual({
      dueDate: dueDateToEpoch('2026-11-20', '16:00'),
    });
  });

  it('拖到它已经所在的那一小时是 no-op', () => {
    const t = task({ dueDate: dueDateToEpoch('2026-11-20', '10:00') });
    expect(planCalendarTimeDrop(t, '2026-11-20', 10)).toBeUndefined();
  });

  it('hour 越界 / 非整数 ⇒ undefined', () => {
    const t = task({ dueDate: dueDateToEpoch('2026-11-20', '09:00') });
    expect(planCalendarTimeDrop(t, '2026-11-20', -1)).toBeUndefined();
    expect(planCalendarTimeDrop(t, '2026-11-20', 24)).toBeUndefined();
    expect(planCalendarTimeDrop(t, '2026-11-20', 10.5)).toBeUndefined();
  });

  it('跨天排期任务不可拖 ⇒ undefined', () => {
    const t = task({ startDate: dueDateToEpoch('2026-11-18'), dueDate: dueDateToEpoch('2026-11-20') });
    expect(planCalendarTimeDrop(t, '2026-11-20', 10)).toBeUndefined();
  });
});
