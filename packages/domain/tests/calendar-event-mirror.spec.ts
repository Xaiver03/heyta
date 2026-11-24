/**
 * `CALENDAR_EVENT` 的投影 / 幂等键 / 删除判定（领域半）
 * ===================================================
 *
 * 这四条各钉一种"实现错了但什么都不报"的形态，正好对应用户能看见的四种症状：
 *
 *   · 幂等键不归一 ⇒ 同一行在两台设备上算出两个 id ⇒ **同一次会议闪两下**；
 *   · 上游键名泄漏 / 缺键抛异常 ⇒ **某条日程没标题，日历整块不更新**；
 *   · 内容比较把写入时刻算进去 ⇒ 每轮都判定"变了" ⇒ op-log 被只读镜像淹掉；
 *   · 删除判定不看窗口交集 ⇒ 窗口滑一格就**误删边界上的一天**。
 *
 * 夹具是**手写的上游行**（按 Hub `docs/api.md` 的字段写），不是抓一份真响应抄进来 ——
 * 抄产物当判据就是自我循环论证。
 */

import { describe, expect, it } from 'vitest';

import {
  CALENDAR_EVENT_CONTENT_FIELDS,
  calendarEventEquivalent,
  calendarEventFromHub,
  calendarEventId,
  calendarEventPatch,
  calendarEventShouldDelete,
  calendarEventWindowIntersection,
  calendarEventWindowKey,
  parseCalendarEventWindow,
  type CalendarEventFields,
  type CalendarEventWindow,
} from '../src/calendar-event.js';
import type { CalendarEvent } from '../src/entities.js';

/** 一条 Hub 行（`GET /api/v1/events`，字段按 `docs/api.md` 的响应样例）。 */
function hubRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  const startMs = Date.UTC(2026, 10, 24, 2);
  const endMs = startMs + 3_600_000;
  return {
    id: 'foundu:evt-1',
    orgId: 'foundu',
    orgLabel: '找到你',
    eventId: 'evt-1',
    calendarId: 'primary',
    calendar: { id: 'primary', summary: '主日历', type: '', color: '', role: '' },
    summary: '周会',
    description: '纯文本描述',
    location: '会议室 A',
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    startMs,
    endMs,
    allDay: false,
    timezone: 'Asia/Shanghai',
    status: 'confirmed',
    visibility: 'default',
    freeBusyStatus: 'busy',
    attendees: [
      { attendee_id: 'u1', display_name: '张三', rsvp_status: 'accept', is_optional: false, is_organizer: true },
    ],
    reminders: [{ minutes: 15 }],
    attachments: [{ file_token: 'f1', name: '议程.pdf' }],
    recurrence: '',
    recurringEventId: '',
    originalTime: 0,
    isException: false,
    meetingUrl: '',
    organizer: {},
    tags: [],
    ...over,
  };
}

function projected(row: unknown): CalendarEventFields {
  const projection = calendarEventFromHub(row);
  if (!projection.ok) throw new Error(`本该投影成功，却被拒：${projection.code}`);
  return projection.event;
}

describe('幂等键：同一行在任何设备上都算出同一个 id', () => {
  it('确定性 + 只用那四段', () => {
    const id = calendarEventId('foundu', 'primary', 'evt-1');
    expect(id).toBe(calendarEventId('foundu', 'primary', 'evt-1'));
    // 前缀 + sha256 全量 hex：幂等键的组成变了要能一次性换代，所以前缀带版本号。
    expect(id.startsWith('cev-')).toBe(true);
    expect(id.slice('cev-'.length)).toMatch(/^[0-9a-f]{64}$/);

    // 首尾空白不改变身份（手填 / 透传最常见的差异）。
    expect(calendarEventId(' foundu ', ' primary ', 'evt-1 ')).toBe(id);
    // 四段里任何一段变了就是另一条。
    expect(calendarEventId('foundu', 'primary', 'evt-2')).not.toBe(id);
    expect(calendarEventId('foundu', 'work', 'evt-1')).not.toBe(id);
    expect(calendarEventId('other', 'primary', 'evt-1')).not.toBe(id);
  });

  it('🔴 `originalTime` 的单位先归一：秒与毫秒必须是同一个 id', () => {
    // Hub 的文档写"Unix 秒"，它的解析正则同时接受 10/13 位，`expand.ts` 按 >1e12 猜单位。
    // 不归一 ⇒ 同一条例外在两种读法下得到两个 id ⇒ 被改过的那次会议出现两次。
    const seconds = 1_794_632_400;
    const millis = seconds * 1_000;
    expect(calendarEventId('o', 'c', 'e', seconds)).toBe(calendarEventId('o', 'c', 'e', millis));
    // `0`（Hub 的"不是例外"）与缺席同一种写法。
    expect(calendarEventId('o', 'c', 'e', 0)).toBe(calendarEventId('o', 'c', 'e'));
    expect(calendarEventId('o', 'c', 'e', 0)).toBe(calendarEventId('o', 'c', 'e', undefined));
    // 例外与非例外必须是两条：它们在同一次系列里并存。
    expect(calendarEventId('o', 'c', 'e', seconds)).not.toBe(calendarEventId('o', 'c', 'e'));
  });
});

describe('投影：窄映射，只收认识的键', () => {
  it('一条普通行 → 实体字段；上游独有的键不进载荷', () => {
    const event = projected(hubRow());

    expect(event).toMatchObject({
      accountId: 'foundu',
      calendarId: 'primary',
      sourceEventId: 'evt-1',
      summary: '周会',
      description: '纯文本描述',
      location: '会议室 A',
      allDay: false,
      timezone: 'Asia/Shanghai',
      status: 'confirmed',
      visibility: 'default',
      freeBusy: 'busy',
      attendees: [{ id: 'u1', name: '张三', rsvpStatus: 'accept', optional: false, organizer: true }],
      reminders: [{ minutesBefore: 15 }],
    });
    expect(event.id).toBe(calendarEventId('foundu', 'primary', 'evt-1'));

    // 上游的 orgLabel / calendar 内联对象 / attachments / meetingUrl / tags / sourceEventId
    // 都不是本实体的格子 —— 收进来只会在每一次全量快照里带上没人读的键。
    for (const leaked of ['orgLabel', 'calendar', 'attachments', 'meetingUrl', 'tags', 'orgId', 'eventId', 'startMs', 'endMs']) {
      expect(Object.hasOwn(event, leaked), `上游键 ${leaked} 泄漏进了载荷`).toBe(false);
    }
  });

  it('🔴 展开出来的实例行：身份取 `eventId`（带 #实例起点），不取 Hub 的 `sourceEventId`（那是母事件）', () => {
    const motherId = 'r1_0';
    const instanceStartMs = 1_794_632_400_000;
    const instance = projected(
      hubRow({ eventId: `${motherId}#${String(instanceStartMs)}`, sourceEventId: motherId, instanceStartMs }),
    );

    expect(instance.sourceEventId).toBe(`${motherId}#${String(instanceStartMs)}`);
    // 拿母事件 id 当身份会把一条周会的 20 个实例压成同一条，且没有任何一层报错。
    expect(instance.id).not.toBe(calendarEventId('foundu', 'primary', motherId));
  });

  it('全天日程：`startDate` / `endDateExclusive` 按**事件时区**算，且排他', () => {
    // 2026-11-24 00:00 Asia/Shanghai = 2026-11-23T16:00Z；两天会议 ⇒ 排他结束日是 11-26。
    const startMs = Date.UTC(2026, 10, 23, 16);
    const endMs = Date.UTC(2026, 10, 25, 16);
    const event = projected(hubRow({ allDay: true, startMs, endMs }));

    expect(event.startDate).toBe('2026-11-24');
    // Hub 的 endMs 已经是 ICS 排他语义（最后一天的次日零点），不需要再 +1 天。
    expect(event.endDateExclusive).toBe('2026-11-26');
  });

  it('缺键：带 code 拒绝、不抛；身份齐了就带上 id（宿主管道才能"跳过它但不判它消失"）', () => {
    const missingSummary = calendarEventFromHub(hubRow({ summary: '   ' }));
    expect(missingSummary).toMatchObject({ ok: false, code: 'missing-summary' });
    expect(missingSummary.ok === false ? missingSummary.id : undefined).toBe(
      calendarEventId('foundu', 'primary', 'evt-1'),
    );

    expect(calendarEventFromHub(hubRow({ startMs: undefined, start: undefined }))).toMatchObject({
      ok: false,
      code: 'missing-start',
    });
    expect(calendarEventFromHub(hubRow({ endMs: undefined, end: 'not-a-date' }))).toMatchObject({
      ok: false,
      code: 'missing-end',
    });
    expect(calendarEventFromHub(hubRow({ eventId: '' }))).toMatchObject({
      ok: false,
      code: 'missing-source-event-id',
    });
    expect(calendarEventFromHub(hubRow({ orgId: undefined }))).toMatchObject({
      ok: false,
      code: 'missing-account-id',
    });
    // 不是对象也不许抛。
    expect(calendarEventFromHub(null)).toMatchObject({ ok: false, code: 'missing-account-id' });
  });
});

describe('内容比较：写入时刻不算内容', () => {
  const fields = projected(hubRow());
  const materialized = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...fields,
    ...over,
  });

  it('内容相同 ⇒ 等价（哪怕 updatedAt / sourceUpdatedAt 完全不同）', () => {
    expect(calendarEventEquivalent(materialized({ updatedAt: 1, sourceUpdatedAt: 999 }), fields)).toBe(true);
    expect(calendarEventPatch(materialized({ updatedAt: 1, sourceUpdatedAt: 999 }), fields)).toBeUndefined();
  });

  it('一个字段变了 ⇒ 不等价；差异载荷只带变了的那一格', () => {
    const current = materialized();
    const next = projected(hubRow({ summary: '周会（改期）' }));

    expect(calendarEventEquivalent(current, next)).toBe(false);
    expect(calendarEventPatch(current, next)).toEqual({ summary: '周会（改期）' });
  });

  it('🔴 源侧清空某一格 ⇒ 差异里必须是 `null`（写 undefined 会被 JSON 丢掉，对端既不清也不设）', () => {
    const current = materialized();
    const next = projected(hubRow({ location: '', description: '' }));

    const patch = calendarEventPatch(current, next);
    expect(patch).toMatchObject({ location: null, description: null });
  });

  it('内容字段清单不含写入时刻', () => {
    for (const ignored of ['createdAt', 'updatedAt', 'sourceUpdatedAt', 'deletedAt']) {
      expect(CALENDAR_EVENT_CONTENT_FIELDS as readonly string[]).not.toContain(ignored);
    }
  });
});

describe('删除判定：只在两轮窗口的交集里', () => {
  const from = Date.UTC(2026, 10, 10);
  const previous: CalendarEventWindow = { fromMs: from, toMs: from + 74 * 86_400_000 };
  // 滑一天：上一轮 [T-14d, T+60d]，这一轮 [T-13d, T+61d]。
  const current: CalendarEventWindow = { fromMs: from + 86_400_000, toMs: from + 75 * 86_400_000 };
  const intersection = calendarEventWindowIntersection(previous, current);

  const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
    id: calendarEventId('foundu', 'primary', 'evt-1'),
    createdAt: 1,
    updatedAt: 1,
    start: from + 5 * 86_400_000,
    end: from + 5 * 86_400_000 + 3_600_000,
    ...over,
  });

  it('交集：第一次运行（没有上一轮）⇒ 不许判删；相邻而不重叠 ⇒ 也没有交集', () => {
    expect(calendarEventWindowIntersection(undefined, current)).toBeUndefined();
    expect(
      calendarEventWindowIntersection({ fromMs: from, toMs: from + 10 }, { fromMs: from + 10, toMs: from + 20 }),
    ).toBeUndefined();
    expect(intersection).toEqual({ fromMs: current.fromMs, toMs: previous.toMs });
    expect(calendarEventWindowKey(current)).toBe(`${String(current.fromMs)}:${String(current.toMs)}`);
    expect(parseCalendarEventWindow(JSON.stringify(current))).toEqual(current);
    expect(parseCalendarEventWindow('not json')).toBeUndefined();
  });

  it('交集内上轮在、本轮不在 ⇒ 删', () => {
    expect(calendarEventShouldDelete(event(), { presentIds: new Set(), window: intersection! })).toBe(true);
  });

  it('🔴 窗口滑出去的那些不删（它们与交集不重叠 —— 这一条就是"每天误删一天"的反面）', () => {
    const slidOut = event({ start: from + 3_600_000, end: from + 3_600_000 + 3_600_000 });
    expect(slidOut.start).toBeLessThan(intersection!.fromMs);
    expect(calendarEventShouldDelete(slidOut, { presentIds: new Set(), window: intersection! })).toBe(false);

    // 本轮新扩出来那一侧同理：那里只做 upsert，不参与删除判定。
    const newStrip = event({ start: previous.toMs + 86_400_000, end: previous.toMs + 86_400_000 + 3_600_000 });
    expect(calendarEventShouldDelete(newStrip, { presentIds: new Set(), window: intersection! })).toBe(false);
  });

  it('🔴 母事件不参与删除；本轮见过的不删；已有墓碑的不重复写', () => {
    const mother = event({ recurrence: 'FREQ=WEEKLY;BYDAY=MO' });
    expect(calendarEventShouldDelete(mother, { presentIds: new Set(), window: intersection! })).toBe(false);

    const septic = event();
    expect(calendarEventShouldDelete(septic, { presentIds: new Set([septic.id]), window: intersection! })).toBe(false);

    const tombstoned = event({ deletedAt: 1_700_000_000_000 });
    expect(calendarEventShouldDelete(tombstoned, { presentIds: new Set(), window: intersection! })).toBe(false);
  });
});
