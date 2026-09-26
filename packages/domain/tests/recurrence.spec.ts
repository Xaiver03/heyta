/**
 * 重复规则求值测试
 * ==================
 *
 * 重点覆盖计划里点名的三个经典难点：
 *   每周几 / 每月第几个周几 / 结束条件
 * 以及"完成后顺延"这个容易错成"永远今天到期"的地方。
 */

import { describe, expect, it } from 'vitest';

import {
  Recurrence,
  describeRecurrence,
  firstOccurrences,
  isFiniteRule,
  isValidRecurrenceRule,
  nextAfterCompletion,
  nextOccurrence,
  occurrencesInRange,
  occursOn,
} from '../src/recurrence.js';

describe('规则校验', () => {
  it('合法规则通过', () => {
    expect(isValidRecurrenceRule('FREQ=DAILY')).toBe(true);
    expect(isValidRecurrenceRule('FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5')).toBe(true);
    expect(isValidRecurrenceRule('FREQ=MONTHLY;BYDAY=+2TU')).toBe(true);
  });

  it('非法规则不通过（而不是抛错）', () => {
    expect(isValidRecurrenceRule('FREQ=NOPE')).toBe(false);
    expect(isValidRecurrenceRule('')).toBe(false);
    expect(isValidRecurrenceRule('   ')).toBe(false);
    expect(isValidRecurrenceRule('不是规则')).toBe(false);
  });

  it('结束条件识别正确', () => {
    expect(isFiniteRule('FREQ=DAILY')).toBe(false);
    expect(isFiniteRule('FREQ=DAILY;COUNT=3')).toBe(true);
    expect(isFiniteRule('FREQ=DAILY;UNTIL=20260305T000000')).toBe(true);
  });
});

describe('每周几', () => {
  it('每周一三五', () => {
    // 2026-03-02 是周一
    const got = firstOccurrences('FREQ=WEEKLY;BYDAY=MO,WE,FR', '2026-03-02', 5);
    expect(got).toEqual([
      '2026-03-02', // 一
      '2026-03-04', // 三
      '2026-03-06', // 五
      '2026-03-09', // 一
      '2026-03-11', // 三
    ]);
  });

  it('INTERVAL=2 隔周', () => {
    const got = firstOccurrences('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', '2026-03-02', 3);
    expect(got).toEqual(['2026-03-02', '2026-03-16', '2026-03-30']);
  });

  it('起始日不在 BYDAY 里时，第一次出现在之后的第一个匹配日', () => {
    // 2026-03-02 是周一，规则只要周三
    const got = firstOccurrences('FREQ=WEEKLY;BYDAY=WE', '2026-03-02', 2);
    expect(got).toEqual(['2026-03-04', '2026-03-11']);
  });
});

describe('每月第几个周几', () => {
  it('每月第 2 个周二', () => {
    const got = firstOccurrences('FREQ=MONTHLY;BYDAY=+2TU', '2026-01-13', 3);
    // 2026-01-13 是 1 月第 2 个周二
    expect(got[0]).toBe('2026-01-13');
    expect(got[1]).toBe('2026-02-10');
    expect(got[2]).toBe('2026-03-10');
  });

  it('每月最后一天（BYMONTHDAY=-1）', () => {
    const got = firstOccurrences('FREQ=MONTHLY;BYMONTHDAY=-1', '2026-01-31', 4);
    expect(got).toEqual([
      '2026-01-31',
      '2026-02-28', // 2026 不是闰年
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('闰年 2 月最后一天是 29 号', () => {
    const got = firstOccurrences('FREQ=MONTHLY;BYMONTHDAY=-1', '2028-01-31', 2);
    expect(got[1]).toBe('2028-02-29');
  });
});

describe('结束条件', () => {
  it('COUNT 精确截断', () => {
    expect(firstOccurrences('FREQ=DAILY;COUNT=3', '2026-03-02', 10)).toEqual([
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
    ]);
  });

  it('UNTIL 精确截断（含当天）', () => {
    const got = firstOccurrences('FREQ=DAILY;UNTIL=20260304T000000', '2026-03-02', 10);
    expect(got).toEqual(['2026-03-02', '2026-03-03', '2026-03-04']);
  });

  it('🔴 无限规则必须被迭代上限截住（否则会卡死界面）', () => {
    const got = firstOccurrences('FREQ=DAILY', '2026-03-02', 10_000);
    // 上限内正常返回，不会无限跑
    expect(got.length).toBeGreaterThan(0);
    expect(got.length).toBeLessThanOrEqual(1000);
  });

  it('SECONDLY 这类高频无限规则不会挂住', () => {
    const got = firstOccurrences('FREQ=SECONDLY', '2026-03-02', 5000);
    expect(got.length).toBeLessThanOrEqual(1000);
  });
});

describe('区间求值', () => {
  it('闭区间：含两端', () => {
    const got = occurrencesInRange('FREQ=DAILY', '2026-03-01', '2026-03-02', '2026-03-04');
    expect(got).toEqual(['2026-03-02', '2026-03-03', '2026-03-04']);
  });

  it('窗口在起始日之前 → 空', () => {
    expect(
      occurrencesInRange('FREQ=DAILY', '2026-03-10', '2026-03-01', '2026-03-05'),
    ).toEqual([]);
  });

  it('to < from → 空（不抛错）', () => {
    expect(occurrencesInRange('FREQ=DAILY', '2026-03-01', '2026-03-05', '2026-03-01')).toEqual([]);
  });

  it('🔴 非法规则返回空数组，不抛错（用户输入不该炸掉整个列表）', () => {
    expect(occurrencesInRange('FREQ=NOPE', '2026-03-01', '2026-03-01', '2026-03-31')).toEqual([]);
    expect(nextOccurrence('FREQ=NOPE', '2026-03-01', '2026-03-01')).toBeUndefined();
    expect(firstOccurrences('FREQ=NOPE', '2026-03-01', 5)).toEqual([]);
  });

  it('结果升序且无重复', () => {
    const got = occurrencesInRange(
      'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      '2026-03-02',
      '2026-03-01',
      '2026-03-31',
    );
    expect(got).toEqual([...got].sort());
    expect(new Set(got).size).toBe(got.length);
  });
});

describe('下一次出现', () => {
  it('🔴 严格晚于 after（不是 >=）', () => {
    // 这条是"完成后顺延"的命门：
    // 用 >= 的话，在到期日当天完成后会顺延到**同一天**，
    // 于是任务永远"今天到期"，用户怎么点都消不掉。
    const next = nextOccurrence('FREQ=DAILY', '2026-03-01', '2026-03-05');
    expect(next).toBe('2026-03-06');
  });

  it('after 在 dtstart 之前时返回第一次出现', () => {
    expect(nextOccurrence('FREQ=WEEKLY;BYDAY=MO', '2026-03-02', '2026-01-01')).toBe('2026-03-02');
  });

  it('有限规则耗尽后返回 undefined', () => {
    expect(nextOccurrence('FREQ=DAILY;COUNT=3', '2026-03-01', '2026-03-10')).toBeUndefined();
  });
});

describe('完成后顺延', () => {
  it('每周一的任务在周一完成后顺延到下周', () => {
    const next = nextAfterCompletion(
      Recurrence.weekly(['MO']),
      '2026-03-02',
      '2026-03-02', // 周一当天完成
    );
    expect(next).toBe('2026-03-09');
  });

  it('🔴 必须用原始 dtstart 作基准，不能用完成日', () => {
    // 每月第 2 个周二的任务，第 2 个完成得晚（第 3 个周二才点完成）
    const rule = Recurrence.monthlyOnNthWeekday(2, 'TU');
    // 用完成日当基准会漂到"4 月第 2 个周二"，用原始基准才对
    const next = nextAfterCompletion(rule, '2026-01-13', '2026-02-17');
    expect(next).toBe('2026-03-10');
  });

  it('提前完成也顺延到下一次计划日', () => {
    const next = nextAfterCompletion(Recurrence.daily(), '2026-03-01', '2026-03-03');
    expect(next).toBe('2026-03-04');
  });
});

describe('occursOn', () => {
  it('命中 / 未命中', () => {
    const rule = 'FREQ=WEEKLY;BYDAY=MO,WE';
    expect(occursOn(rule, '2026-03-02', '2026-03-04')).toBe(true); // 周三
    expect(occursOn(rule, '2026-03-02', '2026-03-03')).toBe(false); // 周二
  });

  it('dtstart 之前一律不命中', () => {
    expect(occursOn('FREQ=DAILY', '2026-03-10', '2026-03-05')).toBe(false);
  });

  it('dtstart 当天命中', () => {
    expect(occursOn('FREQ=DAILY', '2026-03-10', '2026-03-10')).toBe(true);
  });
});

describe('规则构造助手', () => {
  it('生成的规则本身合法', () => {
    for (const rule of [
      Recurrence.daily(),
      Recurrence.daily(3),
      Recurrence.weekly(['MO', 'WE']),
      Recurrence.monthlyOnDay(15),
      Recurrence.monthlyOnNthWeekday(2, 'TU'),
      Recurrence.monthlyOnNthWeekday(-1, 'FR'),
      Recurrence.yearly(3, 2),
    ]) {
      expect(isValidRecurrenceRule(rule)).toBe(true);
    }
  });

  it('每月最后一个周五', () => {
    const got = firstOccurrences(Recurrence.monthlyOnNthWeekday(-1, 'FR'), '2026-01-30', 3);
    // 2026-01-30 是 1 月最后一个周五
    expect(got[0]).toBe('2026-01-30');
    expect(got[1]).toBe('2026-02-27');
    expect(got[2]).toBe('2026-03-27');
  });
});

describe('人类可读描述', () => {
  /**
   * 🔴 **这两条断言改过，改的理由不是"实现变了"。**
   *
   * 它们原来是 `toBe('天')` 和 `toBe('周一、三')` —— 也就是把实现的输出**复述**了一遍。
   * 实现里 `interval === 1 ? '' : ...` 把「每」吞了，于是最常见的那条路径拼出
   * 「天」「周六」，测试**照样是绿的**。它是绿的，因为它断言的是"代码输出了什么"，
   * 而不是"用户该看到什么"。
   *
   * 这是 AGENTS.md §8.4 的反面用法：那条规则说"不要为了让测试变绿而改测试"，
   * 而这里**必须**改测试 —— 因为坏的是测试（它把一个 bug 固定成了契约）。
   * 判据是：新断言能不能在实现退回旧行为时变红。能（`每天` ≠ `天`），
   * 所以它现在是一道真的门。
   *
   * 下面每条都同时覆盖 **interval=1（坏过的那个分支）** 与 **interval>1**，
   * 因为只测后者正是它当初活下来的原因。
   */
  it('常见规则', () => {
    expect(describeRecurrence('FREQ=DAILY')).toBe('每天');
    expect(describeRecurrence('FREQ=DAILY;INTERVAL=2')).toBe('每 2 天');
    expect(describeRecurrence('FREQ=WEEKLY')).toBe('每周');
    expect(describeRecurrence('FREQ=WEEKLY;BYDAY=MO,WE')).toBe('每周一、三');
    expect(describeRecurrence('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR')).toBe(
      '每周一、二、三、四、五',
    );
  });

  it('🔴 默认间隔（interval=1）也必须带「每」—— 它曾经只有「天」「周六」', () => {
    // 这条单独写出来，是因为 bug 恰好只在这个分支：
    // interval>1 时 `every` 自带「每」，所以「每 2 天」一直是对的。
    for (const rule of ['FREQ=DAILY', 'FREQ=WEEKLY;BYDAY=SA', 'FREQ=MONTHLY', 'FREQ=YEARLY']) {
      expect(describeRecurrence(rule), rule).toContain('每');
    }
  });

  it('每月要说出**是哪一天**，只说「每月」用户无法判断', () => {
    expect(describeRecurrence('FREQ=MONTHLY;BYMONTHDAY=14')).toBe('每月 14 日');
    expect(describeRecurrence('FREQ=MONTHLY;BYMONTHDAY=-1')).toBe('每月最后一天');
    expect(describeRecurrence('FREQ=MONTHLY;BYMONTHDAY=14,-1')).toBe('每月 14 日、最后一天');
    expect(describeRecurrence('FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=1')).toBe('每 2 月 1 日');
  });

  it('每月的"第 N 个周几"不能退化成"每个周几"', () => {
    // 旧实现把序数剥掉，于是「每月第 2 个周三」显示成「周三」——
    // 那不是不精确，是**另一条规则**。
    expect(describeRecurrence('FREQ=MONTHLY;BYDAY=+2WE')).toBe('每月第 2 个周三');
    expect(describeRecurrence('FREQ=MONTHLY;BYDAY=-1FR')).toBe('每月最后一个周五');
  });

  it('每年带上月和日', () => {
    expect(describeRecurrence('FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=26')).toBe('每年 9 月 26 日');
    expect(describeRecurrence('FREQ=YEARLY;BYMONTH=9')).toBe('每年 9 月');
    expect(describeRecurrence('FREQ=YEARLY')).toBe('每年');
  });

  it('无法解析时回退到原始串（不抛错）', () => {
    expect(describeRecurrence('FREQ=NOPE')).toBe('FREQ=NOPE');
  });
});
