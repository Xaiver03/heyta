/**
 * 课表网格归并（`timetable.ts`）—— 纯函数单测
 * ============================================
 *
 * 这一层是「导入的课程 → 星期 × 时段格」唯一的归并实现。它一旦算错，症状不是崩溃，而是
 * "课程安静地落错节次 / 落错星期 / 从网格里消失"。所以每条断言都钉**具体格子里的具体
 * 课程 id**，而不是"非空 / 有长度"——后者在实现把两天串位时照样绿。
 */

import { describe, expect, it } from 'vitest';

import type { Habit } from '../src/entities.js';
import { isoWeek, type LocalDate } from '../src/date.js';
import {
  buildTimetableGrid,
  courseOccursInWeek,
  DEFAULT_TIMETABLE_PERIODS,
  periodIndexForTime,
  type TimetablePeriod,
} from '../src/timetable.js';

function habit(over: Partial<Habit> & { id: string }): Habit {
  return {
    createdAt: 0,
    updatedAt: 0,
    name: over.id,
    ...over,
  } as Habit;
}

/** 2026-11-16 是周一。 */
const MONDAY: LocalDate = '2026-11-16';

const PERIODS: readonly TimetablePeriod[] = DEFAULT_TIMETABLE_PERIODS;

describe('periodIndexForTime', () => {
  it('归到「开始时间不晚于它」的最后一节', () => {
    expect(periodIndexForTime(PERIODS, '08:00')).toBe(0);
    expect(periodIndexForTime(PERIODS, '08:50')).toBe(0); // >08:00 且 <08:55
    expect(periodIndexForTime(PERIODS, '10:10')).toBe(2); // 10:00 那一节
    expect(periodIndexForTime(PERIODS, '14:00')).toBe(4);
  });

  it('早于第一节贴到首节、晚于最后一节贴到末节（不丢课）', () => {
    expect(periodIndexForTime(PERIODS, '07:00')).toBe(0);
    expect(periodIndexForTime(PERIODS, '23:30')).toBe(PERIODS.length - 1);
  });

  it('节次为空返回 -1；非法时刻退首节', () => {
    expect(periodIndexForTime([], '08:00')).toBe(-1);
    expect(periodIndexForTime(PERIODS, 'not-a-time')).toBe(0);
  });
});

describe('courseOccursInWeek', () => {
  it('周次范围外为 false', () => {
    const c = habit({ id: 'c', weeks: { start: 3, end: 5 } });
    expect(courseOccursInWeek(c, 2)).toBe(false);
    expect(courseOccursInWeek(c, 3)).toBe(true);
    expect(courseOccursInWeek(c, 5)).toBe(true);
    expect(courseOccursInWeek(c, 6)).toBe(false);
  });

  it('单双周：odd 只在奇数周、even 只在偶数周、all 每周', () => {
    const odd = habit({ id: 'o', parity: 'odd' });
    const even = habit({ id: 'e', parity: 'even' });
    const all = habit({ id: 'a', parity: 'all' });
    expect(courseOccursInWeek(odd, 3)).toBe(true);
    expect(courseOccursInWeek(odd, 4)).toBe(false);
    expect(courseOccursInWeek(even, 4)).toBe(true);
    expect(courseOccursInWeek(even, 3)).toBe(false);
    expect(courseOccursInWeek(all, 4)).toBe(true);
  });
});

describe('buildTimetableGrid', () => {
  it('周一/周三 08:00 的课，只落在周一与周三的第 1 节', () => {
    const math = habit({
      id: 'math',
      name: '高等数学',
      frequency: { type: 'weekly', daysOfWeek: [1, 3] },
      time: '08:00',
      endTime: '09:40',
      location: '教三-201',
    });
    const grid = buildTimetableGrid([math], MONDAY, PERIODS);
    expect(grid.days).toHaveLength(7);
    // 周一(0) 第 1 节(0)
    expect(grid.days[0]!.cells[0]!.map((e) => e.habitId)).toEqual(['math']);
    // 周三(2) 第 1 节
    expect(grid.days[2]!.cells[0]!.map((e) => e.habitId)).toEqual(['math']);
    // 周二(1) 无
    expect(grid.days[1]!.cells.flat().map((e) => e.habitId)).toEqual([]);
    expect(grid.days[0]!.cells[0]![0]!.location).toBe('教三-201');
  });

  it('周次范围外的课整周不出现', () => {
    const thisWeek = isoWeek(MONDAY);
    const other = habit({
      id: 'out',
      frequency: { type: 'weekly', daysOfWeek: [1] },
      time: '08:00',
      weeks: { start: thisWeek + 1, end: thisWeek + 3 },
    });
    const grid = buildTimetableGrid([other], MONDAY, PERIODS);
    expect(grid.days.flatMap((d) => d.cells.flat()).map((e) => e.habitId)).toEqual([]);
  });

  it('没有定时点、但有课程字段的课进 untimed，不塞进任何时段', () => {
    const lab = habit({
      id: 'lab',
      frequency: { type: 'weekly', daysOfWeek: [5] },
      teacher: '李四',
    });
    const grid = buildTimetableGrid([lab], MONDAY, PERIODS);
    expect(grid.days[4]!.untimed.map((e) => e.habitId)).toEqual(['lab']);
    expect(grid.days[4]!.cells.flat().map((e) => e.habitId)).toEqual([]);
  });

  it('既无定时点、又无课程字段的普通习惯不进课表', () => {
    const water = habit({ id: 'water', frequency: { type: 'daily' } });
    const grid = buildTimetableGrid([water], MONDAY, PERIODS);
    expect(grid.days.flatMap((d) => d.cells.flat()).map((e) => e.habitId)).toEqual([]);
    expect(grid.days.flatMap((d) => d.untimed).map((e) => e.habitId)).toEqual([]);
  });

  it('同一节两门课按开始时刻、再按课名稳定排序', () => {
    const a = habit({ id: 'a', name: 'B课', frequency: { type: 'weekly', daysOfWeek: [1] }, time: '08:00' });
    const b = habit({ id: 'b', name: 'A课', frequency: { type: 'weekly', daysOfWeek: [1] }, time: '08:00' });
    const c = habit({ id: 'c', name: 'C课', frequency: { type: 'weekly', daysOfWeek: [1] }, time: '08:05' });
    const grid = buildTimetableGrid([a, b, c], MONDAY, PERIODS);
    // 08:00 同刻 → 按名 A<B；08:05 在后
    expect(grid.days[0]!.cells[0]!.map((e) => e.habitId)).toEqual(['b', 'a', 'c']);
  });

  it('空输入不抛，7 天 × 每节一个空数组', () => {
    const grid = buildTimetableGrid([], MONDAY, PERIODS);
    expect(grid.days).toHaveLength(7);
    for (const day of grid.days) {
      expect(day.cells).toHaveLength(PERIODS.length);
      expect(day.cells.every((c) => c.length === 0)).toBe(true);
    }
  });
});
