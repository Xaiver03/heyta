/**
 * ICS 解析器判据
 * ==============
 * 每条对着一种"解析错了但界面只表现为少了/错了一条日程"的失败：时区、全天与排他、
 * 折行、DURATION、重复事件、非日历输入。
 */

import { describe, expect, it } from 'vitest';

import { parseIcs } from '../src/connectors/ics.js';

const wrap = (body: string): string =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//heyta//test//EN\r\n${body}\r\nEND:VCALENDAR\r\n`;

describe('parseIcs', () => {
  it('定时事件 + TZID：宋海 10:00 = UTC 02:00', () => {
    const text = wrap(
      [
        'BEGIN:VEVENT',
        'UID:evt-1',
        'SUMMARY:周会',
        'DTSTART;TZID=Asia/Shanghai:20261124T100000',
        'DTEND;TZID=Asia/Shanghai:20261124T110000',
        'LOCATION:3 楼',
        'DESCRIPTION:带原型\\n来',
        'STATUS:CONFIRMED',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const result = parseIcs(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toHaveLength(1);
    const event = result.events[0]!;
    expect(event.start).toBe(Date.UTC(2026, 10, 24, 2, 0, 0));
    expect(event.end).toBe(Date.UTC(2026, 10, 24, 3, 0, 0));
    expect(event.allDay).toBe(false);
    expect(event.timezone).toBe('Asia/Shanghai');
    expect(event.summary).toBe('周会');
    expect(event.location).toBe('3 楼');
    expect(event.description).toBe('带原型\n来');
    expect(event.status).toBe('confirmed');
  });

  it('全天事件：日期语义、DTEND 排他、时区兜底 UTC', () => {
    const text = wrap(
      ['BEGIN:VEVENT', 'UID:ad-1', 'SUMMARY:假期', 'DTSTART;VALUE=DATE:20261124', 'DTEND;VALUE=DATE:20261126', 'END:VEVENT'].join(
        '\r\n',
      ),
    );
    const result = parseIcs(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const event = result.events[0]!;
    expect(event.allDay).toBe(true);
    expect(event.start).toBe(Date.UTC(2026, 10, 24));
    expect(event.end).toBe(Date.UTC(2026, 10, 26));
    expect(event.timezone).toBe('UTC');
  });

  it('折行（续行以空格开头）与 DURATION 替代 DTEND', () => {
    const text = wrap(
      [
        'BEGIN:VEVENT',
        'UID:fold-1',
        'SUMMARY:很长的标题',
        ' 续行',
        'DTSTART:20261124T020000Z',
        'DURATION:PT1H30M',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const result = parseIcs(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const event = result.events[0]!;
    expect(event.summary).toBe('很长的标题续行');
    expect(event.end - event.start).toBe(90 * 60_000);
  });

  it('RRULE 计入 recurring；缺 SUMMARY 的行跳过', () => {
    const text = wrap(
      [
        'BEGIN:VEVENT',
        'UID:r-1',
        'SUMMARY:每周复盘',
        'DTSTART:20261124T020000Z',
        'RRULE:FREQ=WEEKLY;BYDAY=MO',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:bad-1',
        'DTSTART:20261124T020000Z',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const result = parseIcs(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.rrule).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(result.recurring).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('非 iCalendar 文本 → not-calendar', () => {
    const result = parseIcs('<html>not a calendar</html>');
    expect(result).toEqual({ ok: false, reason: 'not-calendar' });
  });
});
