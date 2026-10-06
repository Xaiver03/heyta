/**
 * 习惯年视图的取数（工单 H7，领域层）
 * ====================================
 *
 * 这一族要证明的不是"能算出 12 个数"，而是**年视图没有变成第二套算式**：
 * 每一行的数都必须是从 `computeHabitPeriodStats` 那一份月度裁决里读出来的（Y3），
 * 而"年"这一格自己只允许做**加法**与**按分母加权**（Y6）。
 *
 * ⚠️ 固定的"今天"是 `2026-10-05`（周一），与 `habit-backfill.spec.ts` 同一枚 ——
 *    两族共用一个"今天"，跨年那几条才不会各说各话。
 */

import { describe, expect, it } from 'vitest';

import {
  computeHabitPeriodStats,
  firstOfMonthKey,
  habitYearRows,
  habitYearSummary,
  type Habit,
  type HabitLog,
  type HabitYearRow,
  type LocalDate,
} from '../src/index.js';

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  name: '读书',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const log = (date: LocalDate): HabitLog => ({
  id: `l-${date}`,
  habitId: 'h1',
  date,
  createdAt: 1,
  updatedAt: 1,
});

const TODAY: LocalDate = '2026-10-05'; // 周一
const rowOf = (rows: readonly HabitYearRow[], monthKey: string): HabitYearRow => {
  const found = rows.find((r) => r.monthKey === monthKey);
  expect(found, `年视图里没有 ${monthKey} 这一行`).toBeDefined();
  return found as HabitYearRow;
};

describe('习惯年视图的 12 行（habit-year）', () => {
  it('Y1 恰好 12 行，键是 `YYYY-01`…`YYYY-12` 且顺序稳定', () => {
    const rows = habitYearRows(habit(), [], TODAY, 2026);
    expect(rows.length).toBe(12);
    expect(rows.map((r) => r.monthKey)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
  });

  it('Y2 🔴 未来那几个月**没有分母**（算成"计划 30 天达成 0 天"就是界面在说谎）', () => {
    const rows = habitYearRows(habit(), [], TODAY, 2026);
    for (const key of ['2026-11', '2026-12']) {
      const row = rowOf(rows, key);
      expect(row.inFuture, `${key} 在未来}`).toBe(true);
      expect(row.scheduledDays, `${key} 不许有分母`).toBe(0);
      expect(row.rate).toBe(0);
    }
    // 当月：10-01…10-05 五天已到期（`daily` 档期）。
    const october = rowOf(rows, '2026-10');
    expect(october.inFuture).toBe(false);
    expect(october.scheduledDays).toBe(5);
    // 过去的一月：整月 31 天都是分母。
    expect(rowOf(rows, '2026-01').scheduledDays).toBe(31);
  });

  it('Y3 🔴 当月那一行**逐字段等于**月视图读到的那份（不许有第二套算式）', () => {
    const h = habit();
    const logs = [log('2026-10-01'), log('2026-10-03'), log('2026-09-30')];
    const month = computeHabitPeriodStats(h, logs, TODAY);
    const row = rowOf(habitYearRows(h, logs, TODAY, 2026), '2026-10');
    expect(row.achievedDays).toBe(month.achievedDays);
    expect(row.scheduledDays).toBe(month.scheduledDays);
    expect(row.rate).toBe(month.rate);
    expect(row.monthValue).toBe(month.monthValue);
    // 九月那条不许漏进当月（分母与分子都不许）。
    expect(rowOf(habitYearRows(h, logs, TODAY, 2026), '2026-09').achievedDays).toBe(1);
  });

  it('Y4 跨年不串数：2025-12 的记录不许出现在 2026 的任何一行里', () => {
    const logs = [log('2025-12-20'), log('2026-01-10')];
    const in2026 = habitYearRows(habit(), logs, TODAY, 2026);
    expect(rowOf(in2026, '2026-01').achievedDays).toBe(1);
    expect(rowOf(in2026, '2026-12').achievedDays).toBe(0);
    expect(in2026.reduce((sum, r) => sum + r.achievedDays, 0)).toBe(1);

    const in2025 = habitYearRows(habit(), logs, TODAY, 2025);
    expect(rowOf(in2025, '2025-12').achievedDays).toBe(1);
    expect(rowOf(in2025, '2025-01').achievedDays).toBe(0);
    // 2025 整年都在今天之前 ⇒ 一行都不许被标成"还没到"。
    expect(in2025.filter((r) => r.inFuture).length).toBe(0);
  });

  it('Y5 档期外的补打：进 `achievedDays`，**不进分母**（与月度裁决同一把尺）', () => {
    // 每周一只做 ⇒ 2026-01 的档期是 5/12/19/26 那四个周一；`today = 10-05` 之前整年到期 40 个周一。
    const weekly = habit({ frequency: { type: 'weekly', daysOfWeek: [1] } });
    const rows = habitYearRows(weekly, [log('2026-01-05'), log('2026-01-07')], TODAY, 2026);
    const january = rowOf(rows, '2026-01');
    expect(january.scheduledDays).toBe(4);
    expect(january.achievedDays).toBe(2); // 1-05 与 1-07 都打了
    expect(january.rate).toBeCloseTo(1 / 4, 12); // 分子只认档期上的那一天
    const year = habitYearSummary(rows);
    expect(year.scheduledDays).toBe(40);
    expect(year.achievedDays).toBe(2);
    // 🔴 阳性对照：年率是**月度分子的加权和**（40 个到期周一里只达成 1-05 = 1/40）。
    //   拿 `ΣachievedDays / ΣscheduledDays` 会得到 2/40 —— 档期外那天被算进了分子，
    //   于是"年率比它下面任何一个月都高"，而两处的字都叫"完成率"。
    expect(year.rate).toBeCloseTo(1 / 40, 12);
    expect(year.rate).not.toBeCloseTo(2 / 40, 12);
  });

  it('Y6 🔴 年率是**按分母加权**，不是十二个率的平均', () => {
    const rows = habitYearRows(habit(), [], TODAY, 2026);
    // 其余十个月清空分母，让这一族只由那两个月裁决（否则它们会把加权和稀释掉，
    // 读数变成"整年 249 天"，那条经典错反而看不出来）。
    const empty = (r: HabitYearRow): HabitYearRow => ({
      ...r,
      achievedDays: 0,
      scheduledDays: 0,
      rate: 0,
      monthValue: 0,
    });
    const synthetic: HabitYearRow[] = [
      { monthKey: '2026-01', achievedDays: 1, scheduledDays: 1, rate: 1, monthValue: 1, inFuture: false },
      {
        monthKey: '2026-02',
        achievedDays: 0,
        scheduledDays: 29,
        rate: 0,
        monthValue: 0,
        inFuture: false,
      },
      ...rows.slice(2).map(empty),
    ];
    const summary = habitYearSummary(synthetic);
    expect(summary.scheduledDays).toBe(30);
    expect(summary.achievedDays).toBe(1);
    expect(summary.rate).toBeCloseTo(1 / 30, 12);
    // 🔴 阳性对照：这里两种错都钉住 —— **简单平均十二个率** = 1/12 ≈ 8.3%，
    //   而"只把有数的那两个月平均" = 50%（一月 100%、二月 0%）。真相是 30 个计划日里成了 1 天。
    const meanOfTwelve = synthetic.reduce((s, r) => s + r.rate, 0) / synthetic.length;
    expect(meanOfTwelve).toBeCloseTo(1 / 12, 12);
    expect(summary.rate).not.toBeCloseTo(meanOfTwelve, 6);
    expect(summary.rate).not.toBeCloseTo(0.5, 6);
  });

  it('Y7 整年都在未来：12 行全 `inFuture`，率是 0 而不是 NaN', () => {
    const rows = habitYearRows(habit(), [log('2027-03-01')], TODAY, 2027);
    expect(rows.every((r) => r.inFuture)).toBe(true);
    const summary = habitYearSummary(rows);
    expect(summary.scheduledDays).toBe(0);
    expect(Number.isNaN(summary.rate)).toBe(false);
    expect(summary.rate).toBe(0);
    // 阳性对照：数据不是没读进来，是"还没到期"—— 同一条 log 落在 2026 年时读得到。
    expect(rowOf(habitYearRows(habit(), [log('2026-03-01')], TODAY, 2026), '2026-03').achievedDays).toBe(
      1,
    );
  });

  it('Y8 `firstOfMonthKey` 落回该月（点一张年卡要交给月历的那个游标）', () => {
    const first = firstOfMonthKey('2026-03');
    expect(first).toBe('2026-03-01');
    expect(first.slice(0, 7)).toBe('2026-03');
  });
});
