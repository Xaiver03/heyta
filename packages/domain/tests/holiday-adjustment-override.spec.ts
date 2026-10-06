import { afterEach, describe, expect, it } from 'vitest';

import {
  adjustmentOn,
  clearHolidayAdjustmentOverrides,
  holidayAdjustmentSource,
  holidayPapersFor,
  installedHolidayAdjustmentYears,
  installHolidayAdjustmentOverrides,
} from '../src/holidays.js';

/**
 * W4b 那条**接缝**：`adjustmentOn()` 怎么读到部署方下发的覆盖表。
 *
 * 计划工单点名的就是这一步，因为它是那条"后台全绿、客户端读的仍是随包表"
 * 的断链（`countdown-anniversary.md` §8 W4b「🔴 真正的接缝」）。
 * 所以这里钉的是判据④的**三条分支各一条**，外加两条把分支之间的边界钉死的：
 *
 * | 分支 | 断言的形状 |
 * |---|---|
 * | 有覆盖用覆盖 | `adjustmentOn` 变了 **且** `holidayAdjustmentSource` 说是 `override` |
 * | 无覆盖退回随包 | `clear` 之后同一个日期回到随包值，source 回 `bundled` |
 * | 覆盖里日期非法 ⇒ **整年**拒绝 | 被拒的那一年**一条都没装进去**（source 仍是 `bundled`），合法那年照常生效 |
 *
 * 🔴 为什么每条都要带 `holidayAdjustmentSource`：光比返回值的话，
 * "有覆盖用覆盖"只能靠挑一个随包表里没有的日期来**间接**推断。
 * 那种断言在 vendor 多打包一年之后会**悄悄变成恒真**（仓库元规则：
 * 一条永远通过的判据比没有判据更糟）。source 是让分支本身可观测的那一步。
 */

const PAPERS = ['https://www.gov.cn/gongbao/content/2026/content_6543210.htm'];

afterEach(() => {
  clearHolidayAdjustmentOverrides();
});

describe('分支一：有覆盖用覆盖', () => {
  it('2027（随包根本没有的一年）装了覆盖之后答得出来，而来源是 override', () => {
    // 前提：随包表覆盖不到 2027 —— 这条断言的是**输入**，不是被测对象。
    expect(holidayAdjustmentSource('2027-01-01')).toBe('none');
    expect(adjustmentOn('2027-01-01')).toBeUndefined();

    const results = installHolidayAdjustmentOverrides([
      { year: 2027, offDays: ['2027-01-01', '2027-01-03'], workDays: ['2027-01-02'], papers: PAPERS },
    ]);
    expect(results).toEqual([{ kind: 'accepted', year: 2027 }]);

    expect(adjustmentOn('2027-01-01')).toBe('off');
    expect(adjustmentOn('2027-01-02')).toBe('work');
    expect(adjustmentOn('2027-01-03')).toBe('off');
    expect(adjustmentOn('2027-01-04')).toBeUndefined();
    expect(holidayAdjustmentSource('2027-01-01')).toBe('override');
  });

  it('🔴 覆盖是**整年替换**，不是合并：随包表说"休"而覆盖没说的那一天，答案是 undefined', () => {
    // 2026-01-01 随包表里是放假日。装一份"2026 年只有 1 月 2 日放假"的覆盖，
    // 正确结果是 1 月 1 日**不再**被标注 —— 否则运营永远无法更正一条已公布的安排，
    // 而那正是这条通道存在的理由（国务院会发调整公告）。
    expect(adjustmentOn('2026-01-01')).toBe('off');
    installHolidayAdjustmentOverrides([
      { year: 2026, offDays: ['2026-01-02'], workDays: [], papers: PAPERS },
    ]);
    expect(adjustmentOn('2026-01-01')).toBeUndefined();
    expect(adjustmentOn('2026-01-02')).toBe('off');
    expect(holidayAdjustmentSource('2026-01-01')).toBe('override');
  });

  it('papers 跟着数据一起进来，而覆盖那年的出处优先于随包那份', () => {
    installHolidayAdjustmentOverrides([
      { year: 2026, offDays: ['2026-05-01'], workDays: [], papers: PAPERS },
    ]);
    expect(holidayPapersFor(2026)).toEqual(PAPERS);
    // 没被覆盖的年份仍然给随包那份（2007 是 vendor 的第一年）。
    expect(holidayPapersFor(2007)?.[0]).toContain('gov.cn');
  });

  it('重复 install 是整年替换（同一年来第二次，旧的那一份不残留）', () => {
    installHolidayAdjustmentOverrides([
      { year: 2027, offDays: ['2027-01-01'], workDays: ['2027-01-02'], papers: PAPERS },
    ]);
    installHolidayAdjustmentOverrides([
      { year: 2027, offDays: ['2027-05-01'], workDays: [], papers: PAPERS },
    ]);
    expect(adjustmentOn('2027-01-01')).toBeUndefined();
    expect(adjustmentOn('2027-01-02')).toBeUndefined();
    expect(adjustmentOn('2027-05-01')).toBe('off');
    expect(installedHolidayAdjustmentYears()).toEqual([2027]);
  });

  it('papers 省略时不擦掉已装的那一份（下发逐日更正、出处没变）', () => {
    installHolidayAdjustmentOverrides([
      { year: 2027, offDays: ['2027-01-01'], workDays: [], papers: PAPERS },
    ]);
    installHolidayAdjustmentOverrides([{ year: 2027, offDays: ['2027-01-01'], workDays: [] }]);
    expect(holidayPapersFor(2027)).toEqual(PAPERS);
  });
});

describe('分支二：无覆盖退回随包', () => {
  it('清空之后，同一个日期回到随包值，来源回到 bundled', () => {
    // 前提（实测自 generated/holiday-cn.generated.ts）：
    // 2026-01-01 随包=off、2026-01-02 随包=off、2026-06-15 随包**两条都不在**。
    // 挑 06-15 当"覆盖独有"的那一天，才能测出"覆盖撤了它也跟着消失"——
    // 用 01-02 那种随包本来就放假日子做这件事，清完仍然是 'off'，断言恒真。
    installHolidayAdjustmentOverrides([
      { year: 2026, offDays: ['2026-06-15'], workDays: [], papers: PAPERS },
    ]);
    expect(adjustmentOn('2026-01-01')).toBeUndefined(); // 被整年覆盖掉了
    expect(adjustmentOn('2026-06-15')).toBe('off'); // 覆盖独有的一条

    clearHolidayAdjustmentOverrides();
    expect(adjustmentOn('2026-01-01')).toBe('off'); // 随包表的原答案回来了
    expect(adjustmentOn('2026-06-15')).toBeUndefined(); // 覆盖里那条跟着消失
    expect(holidayAdjustmentSource('2026-01-01')).toBe('bundled');
    expect(installedHolidayAdjustmentYears()).toEqual([]);
  });

  it('覆盖某一年**不影响**别的年份（这是"退回随包"最容易写错成"全局退回"的地方）', () => {
    installHolidayAdjustmentOverrides([
      { year: 2027, offDays: ['2027-01-01'], workDays: [], papers: PAPERS },
    ]);
    expect(holidayAdjustmentSource('2026-10-01')).toBe('bundled');
    expect(adjustmentOn('2026-10-01')).toBe('off');
    // 补班日那条尤其不许被覆盖语义带跑：2026-02-14 在随包表里是"要上班的周末"。
    expect(adjustmentOn('2026-02-14')).toBe('work');
  });

  it('既不在覆盖里、也不在随包区间里的年份：undefined + source=none（不抛）', () => {
    expect(() => adjustmentOn('2099-01-01')).not.toThrow();
    expect(adjustmentOn('2099-01-01')).toBeUndefined();
    expect(holidayAdjustmentSource('2099-01-01')).toBe('none');
  });
});

describe('🔴 分支三：覆盖里日期非法 ⇒ 整年拒绝（不接受半套数据）', () => {
  it('一条非法日期：那一年**一条都没装进去**，而合法那年照常生效', () => {
    const results = installHolidayAdjustmentOverrides([
      // 2028 里混了一个 `2028-02-30`（形状对但那天不存在）
      { year: 2028, offDays: ['2028-01-01', '2028-02-30'], workDays: ['2028-01-02'], papers: PAPERS },
      { year: 2029, offDays: ['2029-01-01'], workDays: [], papers: PAPERS },
    ]);

    expect(results.map((r) => r.kind)).toEqual(['rejected', 'accepted']);
    if (results[0]!.kind === 'rejected') {
      expect(results[0]!.reason).toBe('not-a-date');
      expect(results[0]!.detail).toContain('2028-02-30');
    }

    // 这一条是"整年"的含义：被拒的 2028 里，**连合法的那两条**也不生效。
    expect(adjustmentOn('2028-01-01')).toBeUndefined();
    expect(adjustmentOn('2028-01-02')).toBeUndefined();
    expect(holidayAdjustmentSource('2028-01-01')).toBe('none');
    expect(installedHolidayAdjustmentYears()).toEqual([2029]);
    expect(adjustmentOn('2029-01-01')).toBe('off');
  });

  it('月份越界 / 非日期字符串都拒', () => {
    for (const bad of ['2028-13-01', 'not-a-date', '2028/01/01', '', '2028-1-1']) {
      clearHolidayAdjustmentOverrides();
      const results = installHolidayAdjustmentOverrides([
        { year: 2028, offDays: [bad], workDays: [], papers: PAPERS },
      ]);
      expect(results[0]!.kind, bad).toBe('rejected');
      expect(installedHolidayAdjustmentYears(), bad).toEqual([]);
    }
  });

  it('日期跨年 ⇒ 拒（同一天不该同时进两张年）', () => {
    const results = installHolidayAdjustmentOverrides([
      { year: 2028, offDays: ['2027-12-31'], workDays: [], papers: PAPERS },
    ]);
    expect(results[0]!.kind).toBe('rejected');
    if (results[0]!.kind === 'rejected') expect(results[0]!.reason).toBe('date-in-wrong-year');
    expect(installedHolidayAdjustmentYears()).toEqual([]);
  });

  it('同一天既休又补班 ⇒ 拒（两个值都存进去时"谁生效"没有任何一层能决定）', () => {
    const results = installHolidayAdjustmentOverrides([
      { year: 2028, offDays: ['2028-10-09'], workDays: ['2028-10-09'], papers: PAPERS },
    ]);
    expect(results[0]!.kind).toBe('rejected');
    if (results[0]!.kind === 'rejected') expect(results[0]!.reason).toBe('same-day-twice');
    expect(adjustmentOn('2028-10-09')).toBeUndefined();
  });

  it('同一条列表里重复一天 ⇒ 拒', () => {
    const results = installHolidayAdjustmentOverrides([
      { year: 2028, offDays: ['2028-05-01', '2028-05-01'], workDays: [], papers: PAPERS },
    ]);
    expect(results[0]!.kind).toBe('rejected');
    expect(installedHolidayAdjustmentYears()).toEqual([]);
  });

  it('两条列表都空 ⇒ 拒（那等于用空白抹掉已公布的一年，不是降级）', () => {
    const results = installHolidayAdjustmentOverrides([
      { year: 2026, offDays: [], workDays: [] },
    ]);
    expect(results[0]!.kind).toBe('rejected');
    if (results[0]!.kind === 'rejected') expect(results[0]!.reason).toBe('both-lists-empty');
    // 🔴 随包表**没被抹掉** —— 这条断言的就是"拒绝是真的没装"。
    expect(adjustmentOn('2026-01-01')).toBe('off');
  });

  it('年份越界 ⇒ 拒（2006 / 2101 / 非整数）', () => {
    for (const year of [2006, 2101, 2028.5, Number.NaN]) {
      const results = installHolidayAdjustmentOverrides([
        { year, offDays: ['2028-01-01'], workDays: [], papers: PAPERS },
      ]);
      expect(results[0]!.kind, String(year)).toBe('rejected');
      if (results[0]!.kind === 'rejected') expect(results[0]!.reason).toBe('year-out-of-range');
    }
    expect(installedHolidayAdjustmentYears()).toEqual([]);
  });

  it('🔴 一次非法 install 之后，**之前**已装的合法年度不许被顺手清掉', () => {
    // 这条抓的是"实现里用 `overrides = new Map()` 重建整张表"那种写法 ——
    // 它的症状是自托管某次下发带错数据 ⇒ 把上一次成功下发的整批好数据一起丢掉，
    // 而界面看起来只是"节假日标注没了"，报不出来。
    installHolidayAdjustmentOverrides([
      { year: 2027, offDays: ['2027-01-01'], workDays: [], papers: PAPERS },
    ]);
    installHolidayAdjustmentOverrides([
      { year: 2028, offDays: ['2028-02-30'], workDays: [], papers: PAPERS },
    ]);
    expect(adjustmentOn('2027-01-01')).toBe('off');
    expect(holidayAdjustmentSource('2027-01-01')).toBe('override');
  });

  it('install 空数组 ⇒ 什么都不改（不是"清空"）', () => {
    installHolidayAdjustmentOverrides([
      { year: 2027, offDays: ['2027-01-01'], workDays: [], papers: PAPERS },
    ]);
    expect(installHolidayAdjustmentOverrides([])).toEqual([]);
    expect(adjustmentOn('2027-01-01')).toBe('off');
  });

  it('非法日期的格子**不许抛**（抛异常 = 界面整个月空白，正是判据①要防的）', () => {
    // install 拦住了脏数据，所以快照里不可能有非法日期；
    // 而 `adjustmentOn` 自己对非法输入的口径不变：`assertDate` 响亮抛。
    expect(() => adjustmentOn('2026-13-40')).toThrow();
  });
});
