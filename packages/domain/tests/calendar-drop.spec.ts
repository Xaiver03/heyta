/**
 * 日历拖拽改期（`planCalendarDrop` / `planCalendarTimeDrop` / `planCalendarAllDayDrop`）
 * —— 业务语义的判据面
 * ==========================================================================
 *
 * 这一组钉七件事，每一条都对着一个"看起来对、跑起来会错"的坑：
 *
 * 1. **日期型任务改期 = 写 date-only**（`dueDateLocal` 跟上，`dueDate` 落本地零点），
 *    而不是把 `dueDate` 拍成某个带时刻的值 —— 否则跨时区会飘一天。
 * 2. **有时刻的任务换日子要搬运时刻**：拖到明天仍是同一时刻，不是变全天。
 *    不搬的症状是"提醒提前一整天"而界面看不出任何事发生。
 * 3. **落在同一天是 no-op**（返回 `undefined`）：不产生一条"值没变"的 op。
 * 4. **只有跨多天的连续条不可拖**（`canRescheduleByCalendarDrag` 为 false）：
 *    拖一段该改 start 还是 due 没有唯一答案，属于刻意不做的边界；
 *    无截止的新任务、带 `durationMinutes` / 单日 `startDate` 的任务都能拖。
 * 5. **无截止任务落到某天** = 给它一个 date-only 截止日。
 * 6. **小时轴落点精确到分钟**（`minute` 默认 0，必须是 0–59 整数）。
 * 7. **全天档把"带时刻 / 无截止"转成当天全天**，已经是当天全天则是 no-op。
 *
 * 🔴 判据能红：把 `planCalendarDrop` 的时刻搬运删掉（第 2 组红）；
 *    把 no-op 判断删掉（第 3、6、7 组红）；把 `canRescheduleByCalendarDrag` 的
 *    跨天判断删掉（第 4 组红）；把 `minute` 参数忽略掉（第 6 组红）；
 *    把 `planCalendarAllDayDrop` 的时刻判断删掉（第 7 组红）。
 */

import { describe, expect, it } from 'vitest';

import { dueDateToEpoch } from '../src/capture.js';
import {
  canRescheduleByCalendarDrag,
  planCalendarAllDayDrop,
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

describe('无截止任务：拖到某天就是给它一个截止日', () => {
  it('没有任何日期的任务落到 11-25 ⇒ 写那天的 date-only', () => {
    const t = task({});
    expect(canRescheduleByCalendarDrag(t)).toBe(true);
    expect(planCalendarDrop(t, '2026-11-25')).toEqual({
      dueDate: dueDateToEpoch('2026-11-25'),
      dueDateLocal: '2026-11-25',
    });
  });

  it('只有单日 startDate、没有截止的任务 ⇒ 落成那天的 date-only', () => {
    const t = task({ startDate: dueDateToEpoch('2026-11-18'), startDateLocal: '2026-11-18' });
    expect(canRescheduleByCalendarDrag(t)).toBe(true);
    expect(planCalendarDrop(t, '2026-11-25')).toEqual({
      dueDate: dueDateToEpoch('2026-11-25'),
      dueDateLocal: '2026-11-25',
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

describe('可拖 / 不可拖的边界', () => {
  it('跨多天的连续条不可拖（拖一段该改哪个字段没有唯一答案）', () => {
    const t = task({
      startDate: dueDateToEpoch('2026-11-18'),
      startDateLocal: '2026-11-18',
      dueDate: dueDateToEpoch('2026-11-20'),
      dueDateLocal: '2026-11-20',
    });
    expect(canRescheduleByCalendarDrag(t)).toBe(false);
    expect(planCalendarDrop(t, '2026-11-25')).toBeUndefined();
    expect(planCalendarTimeDrop(t, '2026-11-20', 10)).toBeUndefined();
    expect(planCalendarAllDayDrop(t, '2026-11-25')).toBeUndefined();
  });

  it('startDate 与 dueDate 是同一天（单日排期）⇒ 可拖', () => {
    const t = task({
      startDate: dueDateToEpoch('2026-11-18', '09:00'),
      startDateLocal: '2026-11-18',
      dueDate: dueDateToEpoch('2026-11-18', '10:00'),
      dueDateLocal: '2026-11-18',
    });
    expect(canRescheduleByCalendarDrag(t)).toBe(true);
  });

  it('带 durationMinutes 的单日任务可拖', () => {
    const t = task({
      startDate: dueDateToEpoch('2026-11-18', '09:00'),
      startDateLocal: '2026-11-18',
      durationMinutes: 60,
      dueDate: dueDateToEpoch('2026-11-18', '10:00'),
    });
    expect(canRescheduleByCalendarDrag(t)).toBe(true);
  });

  it('dueDateLocal 与 epoch 的本地日不一致时，按 dueDateLocal 判定（跨天）', () => {
    const t = task({
      startDate: dueDateToEpoch('2026-11-18'),
      dueDate: dueDateToEpoch('2026-11-20'),
      // 显式的本地日优先于 epoch 的本地换算。
      dueDateLocal: '2026-11-21',
    });
    expect(canRescheduleByCalendarDrag(t)).toBe(false);
    expect(planCalendarDrop(t, '2026-11-25')).toBeUndefined();
  });

  it('有 startDate 但无 dueDate ⇒ 仍可拖（不是连续条）', () => {
    const t = task({ startDate: dueDateToEpoch('2026-11-18'), startDateLocal: '2026-11-18' });
    expect(canRescheduleByCalendarDrag(t)).toBe(true);
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

  it('无截止任务拖到 10:00 ⇒ 它就是那天 10:00', () => {
    expect(planCalendarTimeDrop(task({}), '2026-11-25', 10)).toEqual({
      dueDate: dueDateToEpoch('2026-11-25', '10:00'),
    });
  });

  it('有时刻任务拖到另一个小时 ⇒ 时刻平移（同一天）', () => {
    const t = task({ dueDate: dueDateToEpoch('2026-11-20', '09:30') });
    expect(planCalendarTimeDrop(t, '2026-11-20', 16)).toEqual({
      dueDate: dueDateToEpoch('2026-11-20', '16:00'),
    });
  });

  it('第四参 minute 生效：16:45 就写 16:45', () => {
    const t = task({ dueDate: dueDateToEpoch('2026-11-20', '09:30') });
    expect(planCalendarTimeDrop(t, '2026-11-20', 16, 45)).toEqual({
      dueDate: dueDateToEpoch('2026-11-20', '16:45'),
    });
  });

  it('minute 省略等价于 0', () => {
    const t = task({ dueDate: dueDateToEpoch('2026-11-20', '09:30') });
    expect(planCalendarTimeDrop(t, '2026-11-20', 16)).toEqual(
      planCalendarTimeDrop(t, '2026-11-20', 16, 0),
    );
  });

  it('拖到它已经所在的那一刻是 no-op（含分钟）', () => {
    const t = task({ dueDate: dueDateToEpoch('2026-11-20', '10:00') });
    expect(planCalendarTimeDrop(t, '2026-11-20', 10)).toBeUndefined();

    const withMinute = task({ dueDate: dueDateToEpoch('2026-11-20', '10:05') });
    expect(planCalendarTimeDrop(withMinute, '2026-11-20', 10, 5)).toBeUndefined();
  });

  it('时刻变了就不算 no-op', () => {
    const t = task({ dueDate: dueDateToEpoch('2026-11-20', '10:05') });
    expect(planCalendarTimeDrop(t, '2026-11-20', 10, 6)).toEqual({
      dueDate: dueDateToEpoch('2026-11-20', '10:06'),
    });
  });

  it('hour 越界 / 非整数 ⇒ undefined', () => {
    const t = task({ dueDate: dueDateToEpoch('2026-11-20', '09:00') });
    expect(planCalendarTimeDrop(t, '2026-11-20', -1)).toBeUndefined();
    expect(planCalendarTimeDrop(t, '2026-11-20', 24)).toBeUndefined();
    expect(planCalendarTimeDrop(t, '2026-11-20', 10.5)).toBeUndefined();
  });

  it('minute 越界 / 非整数 ⇒ undefined', () => {
    const t = task({ dueDate: dueDateToEpoch('2026-11-20', '09:00') });
    expect(planCalendarTimeDrop(t, '2026-11-20', 10, -1)).toBeUndefined();
    expect(planCalendarTimeDrop(t, '2026-11-20', 10, 60)).toBeUndefined();
    expect(planCalendarTimeDrop(t, '2026-11-20', 10, 30.5)).toBeUndefined();
  });

  it('落点日期非法 ⇒ undefined', () => {
    const t = task({ dueDate: dueDateToEpoch('2026-11-20', '09:00') });
    expect(planCalendarTimeDrop(t, '2026-13-40', 10)).toBeUndefined();
  });
});

describe('全天档：转成某天的全天任务（planCalendarAllDayDrop）', () => {
  it('有时刻的任务 ⇒ 抹掉时刻、写那天的 date-only', () => {
    const t = task({ dueDate: dueDateToEpoch('2026-11-20', '16:30') });
    expect(planCalendarAllDayDrop(t, '2026-11-25')).toEqual({
      dueDate: dueDateToEpoch('2026-11-25'),
      dueDateLocal: '2026-11-25',
    });
  });

  it('无截止任务 ⇒ 写那天的 date-only', () => {
    expect(planCalendarAllDayDrop(task({}), '2026-11-25')).toEqual({
      dueDate: dueDateToEpoch('2026-11-25'),
      dueDateLocal: '2026-11-25',
    });
  });

  it('date-only 任务换到另一天 ⇒ 仍写那天的 date-only', () => {
    const t = task({ dueDateLocal: '2026-11-20', dueDate: dueDateToEpoch('2026-11-20') });
    expect(planCalendarAllDayDrop(t, '2026-11-25')).toEqual({
      dueDate: dueDateToEpoch('2026-11-25'),
      dueDateLocal: '2026-11-25',
    });
  });

  it('已经是这一天的全天 ⇒ undefined（不写空 op）', () => {
    const dateOnly = task({ dueDateLocal: '2026-11-20', dueDate: dueDateToEpoch('2026-11-20') });
    expect(planCalendarAllDayDrop(dateOnly, '2026-11-20')).toBeUndefined();

    // 只有本地零点 epoch（无 dueDateLocal）同样是"那天全天"。
    const midnightOnly = task({ dueDate: dueDateToEpoch('2026-11-20') });
    expect(planCalendarAllDayDrop(midnightOnly, '2026-11-20')).toBeUndefined();
  });

  it('同一天但带时刻 ⇒ 仍要写（时刻要被抹掉）', () => {
    const t = task({ dueDate: dueDateToEpoch('2026-11-20', '08:00') });
    expect(planCalendarAllDayDrop(t, '2026-11-20')).toEqual({
      dueDate: dueDateToEpoch('2026-11-20'),
      dueDateLocal: '2026-11-20',
    });
  });

  it('落点形状非法 ⇒ undefined', () => {
    const t = task({ dueDate: dueDateToEpoch('2026-11-20', '16:30') });
    expect(planCalendarAllDayDrop(t, '2026-13-40')).toBeUndefined();
    expect(planCalendarAllDayDrop(t, 'next friday')).toBeUndefined();
  });
});
