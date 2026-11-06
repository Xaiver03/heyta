/**
 * 「跳过这一次」的求值层（R3）—— `exDates` 在五个求值点上都必须生效
 * ==================================================================
 *
 * 这一组是 R3-①的**判据面**：`docs/plans/package-b-2026-11.md` 写的是
 * 「跳过某一次 ⇒ 该次不再出现、其它次不受影响」，而"该次不再出现"这句话
 * 落在 `recurrence.ts` 的五个导出函数上 —— 少一个，那条路径就会把
 * 被跳过的那一天**又还回来**，而且**不会报错**。
 *
 * 🔴 判据能红：把 `recurrence.ts` 里 `exDates?.has(date)` 那几个条件注掉，
 * 这一整个文件会红一大片（实测读数写在计划文档里）。
 *
 * ⚠️ 为什么每个函数都要一条：它们的实现**不是同一个循环**（`occurrencesInRange`
 * 是窗口扫描、`nextOccurrence` 是早退、`firstOccurrences` 有 count 预算），
 * 所以"给其中一个加了过滤"不等于另外几个也有。
 */

import { describe, expect, it } from 'vitest';

import { Recurrence } from '../src/recurrence.js';
import {
  MAX_EX_DATES,
  firstOccurrences,
  isExDate,
  nextAfterCompletion,
  nextOccurrence,
  normalizeExDates,
  occurrencesInRange,
  occursOn,
  withExDate,
  withoutExDate,
} from '../src/recurrence.js';

/** 2026-09 的周一：14 / 21 / 28；10 月的头两个：5 / 12。 */
const MONDAY = '2026-09-14';
const SECOND = '2026-09-21';
const THIRD = '2026-09-28';
const FOURTH = '2026-10-05';
const EVERY_MONDAY = Recurrence.weekly(['MO']);

describe('occurrencesInRange：窗口里跳过一次，其它次不动', () => {
  it('跳过 9/21 ⇒ 9 月只剩 9/14 与 9/28', () => {
    expect(occurrencesInRange(EVERY_MONDAY, MONDAY, MONDAY, '2026-09-30')).toEqual([MONDAY, SECOND, THIRD]);
    expect(occurrencesInRange(EVERY_MONDAY, MONDAY, MONDAY, '2026-09-30', { exDates: [SECOND] })).toEqual([
      MONDAY,
      THIRD,
    ]);
  });

  it('跳过第一次（= 锚点那天）也生效 —— 锚点不是"永远必出现"', () => {
    expect(occurrencesInRange(EVERY_MONDAY, MONDAY, MONDAY, THIRD, { exDates: [MONDAY] })).toEqual([SECOND, THIRD]);
  });

  it('不在规则上的日期进了 exDates 也不影响任何东西（排除集不该改变窗口）', () => {
    // 2026-09-16 是周三，本来就不出现。
    expect(occurrencesInRange(EVERY_MONDAY, MONDAY, MONDAY, '2026-09-30', { exDates: ['2026-09-16'] })).toEqual([
      MONDAY,
      SECOND,
      THIRD,
    ]);
  });

  it('空集合 / undefined 与不传完全一致（"没跳过"只有一个含义）', () => {
    const plain = occurrencesInRange(EVERY_MONDAY, MONDAY, MONDAY, '2026-09-30');
    expect(occurrencesInRange(EVERY_MONDAY, MONDAY, MONDAY, '2026-09-30', { exDates: [] })).toEqual(plain);
    expect(occurrencesInRange(EVERY_MONDAY, MONDAY, MONDAY, '2026-09-30', { exDates: undefined })).toEqual(plain);
  });
});

describe('nextOccurrence：跳过的那一天不许被当成"下一次"', () => {
  it('从 9/14 之后找下一次，9/21 被跳过 ⇒ 9/28', () => {
    expect(nextOccurrence(EVERY_MONDAY, MONDAY, MONDAY)).toBe(SECOND);
    expect(nextOccurrence(EVERY_MONDAY, MONDAY, MONDAY, { exDates: [SECOND] })).toBe(THIRD);
  });

  it('连续跳过两次也能穿过去（不是只跳一次就放弃）', () => {
    expect(nextOccurrence(EVERY_MONDAY, MONDAY, MONDAY, { exDates: [SECOND, THIRD] })).toBe(FOURTH);
  });

  it('所有出现都被跳过 ⇒ 返回 undefined（调用方据此说"没有下一次"）', () => {
    // COUNT=2 ⇒ 规则只有 9/14 与 9/21 两次。
    const rule = 'FREQ=WEEKLY;BYDAY=MO;COUNT=2';
    expect(nextOccurrence(rule, MONDAY, '2026-09-01', { exDates: [MONDAY, SECOND] })).toBeUndefined();
  });

  it('迭代预算数的是**规则的产出**，不是过滤后的条数（跳 900 次不该把预算烧光）', () => {
    // 一条每日规则 + 前 30 天全跳过：必须在 32 次迭代内给出第 31 天。
    const daily = Recurrence.daily();
    const exDates = Array.from({ length: 30 }, (_item, index) => {
      const day = new Date(Date.UTC(2026, 8, 1 + index));
      return day.toISOString().slice(0, 10);
    });
    expect(nextOccurrence(daily, '2026-09-01', '2026-08-31', { exDates, maxIterations: 40 })).toBe('2026-10-01');
  });
});

describe('firstOccurrences：「接下来 N 次」里也不许出现被跳过的那次', () => {
  it('跳过 9/21 ⇒ 前三次是 9/14 / 9/28 / 10/5（条数不缩水）', () => {
    expect(firstOccurrences(EVERY_MONDAY, MONDAY, 3)).toEqual([MONDAY, SECOND, THIRD]);
    expect(firstOccurrences(EVERY_MONDAY, MONDAY, 3, { exDates: [SECOND] })).toEqual([MONDAY, THIRD, FOURTH]);
  });

  it('预算够不够：跳过 k 次仍要给出 count 条（预算是 count + k，不是 count）', () => {
    const daily = Recurrence.daily();
    // 连跳 5 天，仍要 3 条。
    const exDates = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'];
    expect(firstOccurrences(daily, '2026-09-01', 3, { exDates })).toEqual(['2026-09-06', '2026-09-07', '2026-09-08']);
  });
});

describe('nextAfterCompletion / occursOn 也走同一套排除集', () => {
  it('"完成后顺延"：完成日之后的第一次如果是被跳过的，要继续往后找', () => {
    expect(nextAfterCompletion(EVERY_MONDAY, MONDAY, '2026-09-15')).toBe(SECOND);
    expect(nextAfterCompletion(EVERY_MONDAY, MONDAY, '2026-09-15', { exDates: [SECOND] })).toBe(THIRD);
  });

  it('occursOn：被跳过的那一天不再命中，其它天照旧', () => {
    expect(occursOn(EVERY_MONDAY, MONDAY, SECOND)).toBe(true);
    expect(occursOn(EVERY_MONDAY, MONDAY, SECOND, { exDates: [SECOND] })).toBe(false);
    expect(occursOn(EVERY_MONDAY, MONDAY, THIRD, { exDates: [SECOND] })).toBe(true);
  });
});

describe('exDates 的读写助手：规范形只有一种', () => {
  it('normalizeExDates：去重 + 升序 + 丢掉非法格式', () => {
    expect(normalizeExDates(['2026-09-28', '2026-09-21', '2026-09-21', '2026/09/14', ''])).toEqual([
      '2026-09-21',
      '2026-09-28',
    ]);
    expect(normalizeExDates(undefined)).toEqual([]);
  });

  it('withExDate 幂等：已经在集合里就**不产生新的内容**（不会攒出一串重复）', () => {
    const once = withExDate(undefined, SECOND);
    expect(once).toEqual([SECOND]);
    expect(withExDate(once, SECOND)).toEqual([SECOND]);
  });

  it('withoutExDate：撤销一次跳过', () => {
    expect(withoutExDate([SECOND, THIRD], SECOND)).toEqual([THIRD]);
    expect(withoutExDate([SECOND], MONDAY)).toEqual([SECOND]);
  });

  it('超过上限时丢**最旧**的那一端（近期才是在意的）', () => {
    const many = Array.from({ length: MAX_EX_DATES + 5 }, (_item, index) => {
      const day = new Date(Date.UTC(2026, 0, 1 + index));
      return day.toISOString().slice(0, 10);
    });
    const normalized = normalizeExDates(many);
    expect(normalized).toHaveLength(MAX_EX_DATES);
    expect(normalized[0]).toBe(many[5]);
    expect(normalized[normalized.length - 1]).toBe(many[many.length - 1]);
  });

  it('isExDate 与集合内容一致', () => {
    expect(isExDate([SECOND], SECOND)).toBe(true);
    expect(isExDate([SECOND], THIRD)).toBe(false);
    expect(isExDate(undefined, SECOND)).toBe(false);
  });
});
