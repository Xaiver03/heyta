/**
 * `CALENDAR_EVENT` 的**形状**门禁
 * ===============================
 *
 * 这个实体在阶段 A 只有形状（谓词 / 投影校验 / 重复展开随 connector 一起进来，
 * 见 `docs/adr/0089-calendar-events-are-a-mirror-entity.md`），所以这里钉的是
 * 三件**以后会被顺手改坏**的事 —— 每一件都有一种"typecheck 会绿、运行时才炸"
 * 或者"绿得很久、炸在别人的设备上"的失败形态（AGENTS §3.3）：
 *
 *   1. **全部字段可选**：只给 `EntityBase` 那三格就能构造一条。谁把
 *      `start` / `sourceEventId` / `summary` 改成必填，下面第一个对象立刻编译不过。
 *      （反向：真必填了会让"某条老数据在 hydration 时炸掉整个日历"，而构建绿。）
 *   2. **窄形状不是上游原文**：`attendees` / `reminders` 的元素只认自己那几个键，
 *      把飞书 `snake_case` 原文塞进去必须是**类型错**。这一条用 `@ts-expect-error`
 *      反向钉住：谁把类型放宽成"透传上游"，那条指令就变成"未使用"，`typecheck`
 *      立刻报 TS2578（同形先例：`packages/ai/tests/egress.spec.ts:309`）。
 *   3. **重复的两态都由 `recurrence` 分流**：母事件带 `recurrence`，具体化的实例行
 *      带 `recurringEventId` + `originalTime`。两种都得是合法载荷 —— 幂等键
 *      `(accountId, calendarId, sourceEventId, originalTime)` 已经两种都覆盖。
 *
 * 🔴 这里**不**断言"哪一档该显示成什么"：那是 connector 与视图的事，
 * 本文件只回答"这份载荷能不能存在"。
 */

import { describe, expect, it } from 'vitest';

import type { CalendarEvent } from '../src/index.js';

/** 一条日历行**最少**要有什么：只有 `EntityBase` 那三格（id / createdAt / updatedAt）。 */
const minimal: CalendarEvent = { id: 'ce:minimal', createdAt: 1, updatedAt: 1 };

/** 一条定时日程的典型载荷（字段全给）。 */
const timed = {
  id: 'ce:timed',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  accountId: 'org-foundu',
  calendarId: 'primary',
  sourceEventId: 'evt-1',
  summary: '周会',
  description: '纯文本，详情面板不渲染 HTML',
  location: '会议室 A',
  start: 1_700_000_600_000,
  end: 1_700_003_600_000,
  allDay: false,
  timezone: 'Asia/Shanghai',
  status: 'confirmed',
  visibility: 'default',
  freeBusy: 'busy',
  sourceUpdatedAt: 1_700_000_000_000,
  tagIds: ['tag-1'],
  attendees: [{ id: 'u1', name: '张三', rsvpStatus: 'accept', optional: false, organizer: true }],
  reminders: [{ minutesBefore: 15 }],
} satisfies CalendarEvent;

/** 一条重复日程的**母事件**：带 RRULE、不带例外信息。 */
const recurringMaster = {
  id: 'ce:master',
  createdAt: 1,
  updatedAt: 1,
  accountId: 'org-foundu',
  calendarId: 'primary',
  sourceEventId: 'evt-master',
  summary: '每周一/三/五',
  start: 1_700_000_000_000,
  end: 1_700_003_600_000,
  allDay: false,
  recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
} satisfies CalendarEvent;

/** 一条已经具体化的**实例行**：没有 RRULE，靠 `recurringEventId` 指回母事件。 */
const materializedInstance = {
  id: 'ce:instance',
  createdAt: 1,
  updatedAt: 1,
  accountId: 'org-foundu',
  calendarId: 'primary',
  sourceEventId: 'evt-master_1700000000',
  summary: '每周一/三/五',
  start: 1_700_086_400_000,
  end: 1_700_090_000_000,
  allDay: false,
  recurringEventId: 'evt-master',
  originalTime: 1_700_086_400,
} satisfies CalendarEvent;

/** 一条全天日程：两天，`endDateExclusive` 是**次日**（ICS DTEND 排他语义）。 */
const allDay = {
  id: 'ce:allday',
  createdAt: 1,
  updatedAt: 1,
  accountId: 'org-foundu',
  calendarId: 'primary',
  sourceEventId: 'evt-allday',
  summary: '出差',
  start: 1_700_006_400_000,
  end: 1_700_179_200_000,
  startDate: '2026-11-24',
  endDateExclusive: '2026-11-26',
  allDay: true,
  timezone: 'Asia/Shanghai',
} satisfies CalendarEvent;

describe('CALENDAR_EVENT 的字段可选性', () => {
  it('只给 EntityBase 那三格就能构造（全部自有字段可选）', () => {
    // 编译期：`minimal` 那行的注解本身就是判据。运行时再确认它**没有**被塞默认值 ——
    // 读侧要靠"缺席"区分"老数据没写"与"上游写了空串"，自动补默认值会把这一档抹掉。
    expect(Object.keys(minimal).sort()).toEqual(['createdAt', 'id', 'updatedAt']);
  });

  it('满字段的定时日程是合法载荷', () => {
    expect(timed.start).toBeLessThan(timed.end);
    expect(timed.allDay).toBe(false);
    expect(timed.timezone).toBe('Asia/Shanghai');
  });

  it('空数组与缺席不是同一份载荷，但两者都合法', () => {
    // 缺席 = "不知道"；`[]` = "上游明确说没有"。读侧把两者降级成同一个读数（空列表），
    // 但**载荷上不许互相替换** —— 替换了就等于替上游回答了"到底是没人参加还是没拉到"。
    const explicitEmpty = { ...minimal, attendees: [], reminders: [] } satisfies CalendarEvent;
    expect(Array.isArray(explicitEmpty.attendees)).toBe(true);
    expect(explicitEmpty.attendees).toHaveLength(0);
    expect('attendees' in minimal).toBe(false);
  });

  it('经一次 JSON 往返（op 载荷的形状）后空数组仍是空数组，不会塌成 undefined', () => {
    const roundTripped = JSON.parse(
      JSON.stringify({ ...minimal, attendees: [], reminders: [] }),
    ) as CalendarEvent;
    expect(roundTripped.attendees).toEqual([]);
    expect(roundTripped.reminders).toEqual([]);
  });
});

describe('CALENDAR_EVENT 的重复两态', () => {
  it('母事件：有 RRULE、没有例外字段', () => {
    expect(recurringMaster.recurrence).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR');
    // 一份 RRULE 不展开成实体行 —— 实例在渲染时算（否则一条 FREQ=DAILY 会写进上千条）。
    expect('recurringEventId' in recurringMaster).toBe(false);
    expect('originalTime' in recurringMaster).toBe(false);
  });

  it('具体化实例：没有 RRULE、指回母事件并带原始时刻', () => {
    expect('recurrence' in materializedInstance).toBe(false);
    expect(materializedInstance.recurringEventId).toBe('evt-master');
    expect(materializedInstance.originalTime).toBeGreaterThan(0);
  });

  it('两种形态的幂等键不同（`sourceEventId` 含实例后缀），不会互相串行', () => {
    expect(recurringMaster.sourceEventId).not.toBe(materializedInstance.sourceEventId);
  });
});

describe('CALENDAR_EVENT 的全天日程是"哪一天"而不是"哪个时刻"', () => {
  it('`startDate` / `endDateExclusive` 都在，且结束日是排他的次日', () => {
    expect(allDay.allDay).toBe(true);
    expect(allDay.startDate).toBe('2026-11-24');
    // 🔴 排他：两天出差（24、25）的结束日是 **26**。差一天是这类字段的经典错，
    // 而它错了界面只会多画一格，不会有任何一层报错。
    expect(allDay.endDateExclusive).toBe('2026-11-26');
  });
});

describe('窄形状不许透传上游（飞书 snake_case 原文）', () => {
  it('参会人的键名是 heyta 自己的，不是 `attendee_id` / `rsvp_status`', () => {
    // @ts-expect-error 飞书原文键名不是本实体的形状（放宽类型 ⇒ 这条指令变成"未使用" ⇒ typecheck 红）
    const raw: CalendarEvent = { ...minimal, attendees: [{ attendee_id: 'u1', rsvp_status: 'accept' }] };
    void raw;
    // 正例：同一个人的窄形状 —— 键名映射发生在 connector 里。
    const narrow: CalendarEvent = { ...minimal, attendees: [{ id: 'u1', rsvpStatus: 'accept' }] };
    expect(narrow.attendees?.[0]?.rsvpStatus).toBe('accept');
  });

  it('提醒只有"提前多少分钟"，没有上游的其它键', () => {
    // @ts-expect-error 飞书 `reminders` 的元素带别的键（如 `reminder_id`），这里只收 minutesBefore
    const raw: CalendarEvent = { ...minimal, reminders: [{ reminder_id: 'r1' }] };
    void raw;
    expect({ minutesBefore: 15 } satisfies NonNullable<CalendarEvent['reminders']>[number]).toEqual({
      minutesBefore: 15,
    });
  });

  it('参会人的每个键（含空对象）都可缺席 —— 上游少给一个键不该让整行落不下去', () => {
    expect({} satisfies NonNullable<CalendarEvent['attendees']>[number]).toEqual({});
  });
});
