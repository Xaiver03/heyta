import { describe, expect, it } from 'vitest';

import { courseKey, parseCourseCSV, parseCourseICS, planCourseImport } from '../src/course-import.js';

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:1',
  'SUMMARY:高等数学',
  'LOCATION:教三-201',
  'DESCRIPTION:教师：张三',
  'DTSTART:20260223T080000',
  'DTEND:20260223T084500',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20260615T000000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('parseCourseICS', () => {
  it('解析出课程名/教师/教室/星期/起止/周次', () => {
    const rows = parseCourseICS(ICS);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.name).toBe('高等数学');
    expect(r.teacher).toBe('张三');
    expect(r.location).toBe('教三-201');
    expect(r.daysOfWeek).toEqual([1, 3]); // 周一、周三
    expect(r.startTime).toBe('08:00');
    expect(r.endTime).toBe('08:45');
    expect(r.weeks?.start).toBeGreaterThanOrEqual(1);
  });
});

describe('parseCourseCSV', () => {
  it('按表头识别列并归一', () => {
    const csv = ['课程名称,教师,教室,星期,开始时间,结束时间,周次', '线性代数,李四,综合楼101,周二,10:00,10:45,1-16周'].join('\n');
    const rows = parseCourseCSV(csv);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.name).toBe('线性代数');
    expect(r.teacher).toBe('李四');
    expect(r.daysOfWeek).toEqual([2]);
    expect(r.startTime).toBe('10:00');
    expect(r.endTime).toBe('10:45');
    expect(r.weeks).toEqual({ start: 1, end: 16 });
  });

  it('星期支持中文数字与「星期X」', () => {
    const csv = ['课程名称,星期,开始时间', '英语,星期三,14:00'].join('\n');
    expect(parseCourseCSV(csv)[0]!.daysOfWeek).toEqual([3]);
  });
});

describe('planCourseImport', () => {
  it('守恒律 total = ok + skipped，且按 key 去重', () => {
    const rows = [
      { name: 'A', daysOfWeek: [1], startTime: '08:00' },
      { name: 'A', daysOfWeek: [1], startTime: '08:00' }, // 重复
      { name: 'B', daysOfWeek: [] }, // 缺星期
      { name: '', daysOfWeek: [2] }, // 缺名
    ];
    const plan = planCourseImport(rows);
    expect(plan.report.total).toBe(4);
    expect(plan.report.ok).toBe(1);
    expect(plan.report.skipped).toBe(3);
    expect(plan.report.ok + plan.report.skipped).toBe(plan.report.total);
  });

  it('courseKey 对同内容稳定、不同内容不同', () => {
    const a = { name: 'X', daysOfWeek: [1], startTime: '08:00' };
    expect(courseKey(a)).toBe(courseKey({ ...a }));
    expect(courseKey(a)).not.toBe(courseKey({ ...a, startTime: '09:00' }));
  });
});
