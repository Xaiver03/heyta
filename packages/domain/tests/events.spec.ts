/**
 * 倒数日（共享模型）单测
 * ======================
 *
 * 钉的是 `packages/domain/src/events.ts` 里**所有有判断的地方**：
 * 下一次 / 上一次发生日、两副面孔的那个符号、闰月三个档位、
 * 置顶与归档的"一个字段一件事"、以及写入侧的合法性判定。
 *
 * 🔴 农历**月表本身不在这里验**（那是 `check:calendar` 三条反证链的活）。
 * 这里只验"给定档位挑哪一个"，所以期望值一律由 `lunarToSolar` / `leapMonthOf` /
 * `daysInLunarMonth` **现推**，而不是我手抄一个日期 —— 抄来的期望值会把表的
 * 漂移读成"通过"。
 */

import { addDays } from '../src/date.js';
import { daysInLunarMonth, leapMonthOf, lunarToSolar, solarToLunar } from '../src/lunar.js';
import { Recurrence } from '../src/recurrence.js';
import { describe, expect, it } from 'vitest';

import type { CountdownEvent } from '../src/entities.js';
import {
  aliveEvents,
  archivedEvents,
  eventDaysFromToday,
  eventAgeInDays,
  eventKindOf,
  eventLeapMonthPolicy,
  eventRejection,
  eventTitleRejection,
  isEventPinned,
  isEventRepeating,
  nextEventOccurrence,
  sortEventsForDisplay,
} from '../src/events.js';

let seq = 0;
/** 造一条倒数日。默认：公历、一次性、不置顶、不归档。 */
function ev(over: Partial<CountdownEvent> & { title?: string; date?: string }): CountdownEvent {
  seq += 1;
  return {
    id: `event-${String(seq).padStart(3, '0')}`,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    title: over.title ?? '测试',
    date: over.date ?? '2026-05-01',
    ...(over.kind === undefined ? {} : { kind: over.kind }),
    ...(over.isLunar === undefined ? {} : { isLunar: over.isLunar }),
    ...(over.leapMonthPolicy === undefined ? {} : { leapMonthPolicy: over.leapMonthPolicy }),
    ...(over.recurrence === undefined ? {} : { recurrence: over.recurrence }),
    ...(over.pinnedAt === undefined ? {} : { pinnedAt: over.pinnedAt }),
    ...(over.archivedAt === undefined ? {} : { archivedAt: over.archivedAt }),
    ...(over.deletedAt === undefined ? {} : { deletedAt: over.deletedAt }),
  };
}

describe('一次性倒数日', () => {
  it('还没到：下一次就是它自己，天数为正', () => {
    const e = ev({ date: '2026-12-31' });
    expect(isEventRepeating(e)).toBe(false);
    expect(nextEventOccurrence(e, '2026-10-03')).toBe('2026-12-31');
    expect(eventDaysFromToday(e, '2026-10-03')).toBe(89);
  });

  it('已经过了：没有下一次，天数带负号，kind 兜底成"纪念"', () => {
    const e = ev({ date: '2026-01-01' });
    expect(nextEventOccurrence(e, '2026-10-03')).toBeUndefined();
    expect(eventDaysFromToday(e, '2026-10-03')).toBe(-275);
    expect(eventKindOf(e, '2026-10-03')).toBe('anniversary');
    expect(eventAgeInDays(e, '2026-10-03')).toBe(275);
  });

  it('正日子当天算"就是今天"，不是"还有 0 天所以没了"', () => {
    const e = ev({ date: '2026-10-03' });
    expect(nextEventOccurrence(e, '2026-10-03')).toBe('2026-10-03');
    expect(eventDaysFromToday(e, '2026-10-03')).toBe(0);
    expect(eventKindOf(e, '2026-10-03')).toBe('countdown');
  });

  it('用户选过类型就照用户说的，日期方向不得覆盖它', () => {
    const past = ev({ date: '2020-02-02', kind: 'birthday' });
    expect(eventKindOf(past, '2026-10-03')).toBe('birthday');
  });
});

describe('每年重复（公历）', () => {
  const yearly = (month: number, day: number): string => Recurrence.yearly(month, day);

  it('今年还没到 → 今年；已过 → 明年', () => {
    const later = ev({ date: '2000-12-31', recurrence: yearly(12, 31) });
    expect(nextEventOccurrence(later, '2026-10-03')).toBe('2026-12-31');
    const earlier = ev({ date: '2000-01-05', recurrence: yearly(1, 5) });
    expect(nextEventOccurrence(earlier, '2026-10-03')).toBe('2027-01-05');
  });

  it('重复的只说"还有 N 天"；"已经 N 天"的分母是锚点，不是上一次发生日', () => {
    const e = ev({ date: '2000-01-05', recurrence: yearly(1, 5) });
    expect(eventDaysFromToday(e, '2026-10-03')).toBe(94);
    expect(eventAgeInDays(e, '2026-10-03')).toBe(9768);
  });

  it('锚点还在未来时 eventAgeInDays 给 0，不给负数（界面不许拼出"已经 -12 天"）', () => {
    expect(eventAgeInDays(ev({ date: '2026-12-31' }), '2026-10-03')).toBe(0);
  });

  it('2 月 29 日的锚点：平年没有那一天，必须钉成一种口径（不许界面自己判）', () => {
    const e = ev({ date: '2000-02-29', recurrence: yearly(2, 29) });
    // 平年 2/29 不存在 → 下一次是闰年 2028-02-29。"退到 2/28"是另一种成立的口径，
    // 但两种里只能有一种，所以写成断言（改动它必须连带改这条用例与它的注释）。
    expect(nextEventOccurrence(e, '2026-03-01')).toBe('2028-02-29');
  });
});

describe('每年重复（农历）与闰月三个档位', () => {
  // 前提检查：档位分支只在"该年真有闰月"时才有区别。前提不成立时下面几条会
  // 全部退化成同一条，所以先把闰月年断言出来（不能失败的判据没有价值）。
  const leapYear = 2025;
  const leapMonth = leapMonthOf(leapYear);
  it(leapYear + ' 年确实有闰月（前提），否则这组用例证明不了任何档位', () => {
    expect(leapMonth).toBeGreaterThan(0);
  });

  const lunarAnchor = lunarToSolar({ year: 2001, month: leapMonth, day: 12, leap: false });
  const anchorParts = solarToLunar(lunarAnchor);

  const lunarYearly = (policy: 'first' | 'last' | 'both'): CountdownEvent =>
    ev({
      date: lunarAnchor,
      isLunar: true,
      leapMonthPolicy: policy,
      recurrence: Recurrence.yearly(anchorParts.month, anchorParts.day),
    });

  it('锚点存的是公历，读出来才是农历月日（农历不是第二种日期字段）', () => {
    expect(/^\d{4}-\d{2}-\d{2}$/.test(lunarAnchor)).toBe(true);
    expect(anchorParts.month).toBe(leapMonth);
    expect(anchorParts.day).toBe(12);
  });

  it('档位缺席 = first（ADR-0044 D2 的默认值）', () => {
    expect(eventLeapMonthPolicy(ev({ date: lunarAnchor }))).toBe('first');
  });

  it('first：闰月那年过同名正月', () => {
    const next = nextEventOccurrence(lunarYearly('first'), leapYear + '-01-01');
    expect(next).toBeDefined();
    const got = solarToLunar(next as string);
    expect(got.month).toBe(leapMonth);
    expect(got.day).toBe(12);
    expect(got.leap).toBe(false);
  });

  it('last：闰月那年过闰月；没有闰月的年份回落到正月（不是"不过"）', () => {
    const inLeapYear = nextEventOccurrence(lunarYearly('last'), leapYear + '-01-01');
    expect(solarToLunar(inLeapYear as string).leap).toBe(true);
    const plain = nextEventOccurrence(lunarYearly('last'), addDays(inLeapYear as string, 1));
    const plainParts = solarToLunar(plain as string);
    expect(plainParts.leap).toBe(false);
    expect(leapMonthOf(plainParts.year)).not.toBe(plainParts.month);
  });

  it('both：同一年两个发生日，正月在前、闰月在后，下一次取较早的那个', () => {
    const first = nextEventOccurrence(lunarYearly('both'), leapYear + '-01-01');
    expect(solarToLunar(first as string).leap).toBe(false);
    const second = nextEventOccurrence(lunarYearly('both'), addDays(first as string, 1));
    const secondParts = solarToLunar(second as string);
    expect(secondParts.leap).toBe(true);
    expect(secondParts.month).toBe(leapMonth);
    expect(second > (first as string)).toBe(true);
  });

  it('该农历月没有那一天 → 退到该月最后一天，不滚进下一个月', () => {
    let year = 0;
    let month = 0;
    let days = 30;
    for (let y = 2024; y < 2045 && days === 30; y += 1) {
      for (let m = 1; m <= 12; m += 1) {
        const d = daysInLunarMonth(y, m, false);
        if (d < 30 && leapMonthOf(y) !== m) {
          year = y;
          month = m;
          days = d;
          break;
        }
      }
    }
    // 前提：真找到一个月历上不存在"三十"的月份，否则这条什么都没测
    expect(month).toBeGreaterThan(0);
    expect(days).toBeLessThan(30);
    const anchor = lunarToSolar({ year: 2001, month, day: 30, leap: false });
    const e = ev({ date: anchor, isLunar: true, recurrence: Recurrence.yearly(month, 30) });
    const parts = solarToLunar(nextEventOccurrence(e, year + '-01-01') as string);
    expect(parts.month).toBe(month);
    expect(parts.day).toBe(days);
  });
});

describe('置顶 / 归档 / 墓碑是三个互不表达对方的状态', () => {
  it('置顶只有一个字段（§2.4）', () => {
    expect(isEventPinned(ev({}))).toBe(false);
    expect(isEventPinned(ev({ pinnedAt: 1_700_000_000_001 }))).toBe(true);
  });

  it('归档项不在主列表、在归档视图；两者都不含已删除', () => {
    const alive = ev({ title: '在列表' });
    const archived = ev({ title: '归档了', archivedAt: 1_700_000_000_002 });
    const trashed = ev({ title: '回收站', deletedAt: 1_700_000_000_003 });
    const both = ev({
      title: '归档后删除',
      archivedAt: 1_700_000_000_004,
      deletedAt: 1_700_000_000_005,
    });
    const all = [alive, archived, trashed, both];
    expect(aliveEvents(all).map((e) => e.title)).toEqual(['在列表']);
    expect(archivedEvents(all).map((e) => e.title)).toEqual(['归档了']);
  });

  it('排序三段：置顶 → 距下一次 → id 字典序（第三段抓的是同刻并列）', () => {
    const far = ev({ date: '2026-10-13', title: '远' });
    const near = ev({ date: '2026-10-06', title: '近' });
    const pinned = ev({ date: '2026-12-31', title: '钉住的更远也必须在前', pinnedAt: 1 });
    expect(sortEventsForDisplay([far, near, pinned], '2026-10-03').map((e) => e.title)).toEqual([
      '钉住的更远也必须在前',
      '近',
      '远',
    ]);
    const x = ev({ date: '2026-10-06', title: '同距离甲' });
    const y = ev({ date: '2026-10-06', title: '同距离乙' });
    const ordered = sortEventsForDisplay([y, x], '2026-10-03').map((e) => e.id);
    expect(ordered).toEqual([...ordered].sort());
  });
});

describe('写入侧的合法性判定', () => {
  it('标题：空白与超长各自独立拒绝', () => {
    expect(eventTitleRejection('   ')).toBe('empty-title');
    expect(eventTitleRejection('x'.repeat(121))).toBe('too-long-title');
    expect(eventTitleRejection('结婚纪念日')).toBeUndefined();
  });

  it('日期：不存在的日子必须被挡（new Date 会静默滚成下一个月）', () => {
    expect(eventRejection('ok', '2026-02-30')).toBe('invalid-date');
    expect(eventRejection('ok', '2026-13-01')).toBe('invalid-date');
    expect(eventRejection('ok', '2026/01/02')).toBe('invalid-date');
    expect(eventRejection('ok', '')).toBe('invalid-date');
    expect(eventRejection('ok', '2026-03-05')).toBeUndefined();
    expect(eventRejection('ok', '2024-02-29')).toBeUndefined();
    expect(eventRejection('   ', '2026-03-05')).toBe('empty-title');
  });
});
