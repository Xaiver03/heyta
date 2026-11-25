/**
 * 课表导入数据链路 E2E：ICS 文本 → parseCourseICS → planCourseImport → importCourses → 习惯。
 * 用最小内存 ctx（dispatch 把 HABIT Create 写进 state.habits），不依赖真引擎/设备。
 * 守两件事：① 两门课真的变成两条习惯；② 同一份再导一次不重复（稳定 id 幂等）。
 */
import { describe, expect, it } from 'vitest';
import { parseCourseICS, planCourseImport } from '@heyta/domain';
import { createHabitActions } from '../src/habit-actions.js';

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:1',
  'SUMMARY:大学英语',
  'LOCATION:外语楼201',
  'DESCRIPTION:教师：赵六',
  'DTSTART:20260223T090000',
  'DTEND:20260223T094500',
  'RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20260615T000000Z',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:2',
  'SUMMARY:数据结构',
  'LOCATION:信息楼305',
  'DTSTART:20260224T140000',
  'DTEND:20260224T154000',
  'RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20260615T000000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

function fakeCtx() {
  const state: { habits: Record<string, unknown> } = { habits: {} };
  let seq = 1;
  return {
    getState: () => state,
    dispatch: async (intent: { entityType: string; entityId: string; payload: Record<string, unknown> }) => {
      if (intent.entityType === 'HABIT') {
        state.habits[intent.entityId] = { ...intent.payload, id: intent.entityId, createdAt: seq++, deletedAt: undefined };
      }
      return undefined;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('importCourses（ICS → 习惯，数据链路 E2E）', () => {
  it('两门课生成两条习惯，且重复导入幂等', async () => {
    const actions = createHabitActions(fakeCtx());
    const plan = planCourseImport(parseCourseICS(ICS));
    expect(plan.rows).toHaveLength(2);

    const first = await actions.importCourses(plan.rows);
    expect(first.created).toHaveLength(2);
    const names = actions
      .listHabits()
      .map((h) => h.name)
      .sort();
    expect(names).toEqual(['大学英语', '数据结构'].sort());

    const second = await actions.importCourses(plan.rows);
    expect(second.created).toHaveLength(0);
    expect(second.skipped).toHaveLength(2);
    expect(actions.listHabits()).toHaveLength(2);
  });
});
