/**
 * 年视图的三条共享规则（R13）
 * ============================
 *
 * 这一档加进来的不是像素，是**三条会被两处以上问到的判断**：
 *
 * | 规则 | 被谁问 | 写两遍的漂移形状 |
 * |---|---|---|
 * | `stepCalendarCursor('year', …)` | 工具栏两个箭头、Web 滚轮、日档拖拽同一份 | 年档点 `›` 只翻一个月：12 张卡一张没换，看着像"这一档坏了" |
 * | `calendarYearColumns(…)` | 共享板自己 | 12 张卡摆成 5 列，最后孤零零两张 —— 日历上任何"像缺了什么"都会被读成"数据没了" |
 * | `calendarMonthDrill(…)` | **两个宿主**的状态迁移 | 一端点月卡切到月档、另一端只挪游标，而两边都自洽 |
 *
 * 🔴 所以三条都在 `packages/ui`，`apps/*` 只接线（AGENTS §3.5）。
 * 这里的判据不是"算得对"那么简单 —— 每一条都要能区分**它和它最容易混成的那一条**。
 */

import { describe, expect, it } from 'vitest';

import {
  calendarCursorFor,
  calendarMonthDrill,
  calendarSelectedForCursor,
  calendarYearColumns,
  stepCalendarCursor,
} from '../src/calendar/model.js';
import { MONTHS_PER_YEAR } from '@heyta/domain';

describe('stepCalendarCursor 的年档', () => {
  it('🔴 一段 = 一整年（12 个月），而不是一个月', () => {
    // 这一条就是 `case 'year'` 的牙：漏写那个 case 会掉进 `default`（按月走），
    // 而 `default` 的返回值在这里**也是个合法日期** —— 界面不会崩，只会一动不动。
    expect(stepCalendarCursor('year', '2026-10-03', 1)).toBe('2027-10-03');
    expect(stepCalendarCursor('year', '2026-10-03', -1)).toBe('2025-10-03');
  });

  it('🔴 与月档明显不同：同一个游标各走一步，落点必须差 11 个月', () => {
    const byMonth = stepCalendarCursor('month', '2026-10-03', 1);
    const byYear = stepCalendarCursor('year', '2026-10-03', 1);
    expect(byMonth).toBe('2026-11-03');
    expect(byYear).toBe('2027-10-03');
    expect(byYear).not.toBe(byMonth);
  });

  it('走的月数从 `MONTHS_PER_YEAR` 推，不抄一个 12', () => {
    expect(stepCalendarCursor('year', '2026-01-31', 1)).toBe('2027-01-31');
    // 两段：走 N 段就是 N 年，而不是 N 个月。
    expect(stepCalendarCursor('year', '2026-03-15', 2)).toBe('2028-03-15');
  });

  it('月末那条：1-31 走一年还是 1-31（`addMonths` 的夹紧按年整步走不会误触）', () => {
    expect(stepCalendarCursor('year', '2028-01-31', -1)).toBe('2027-01-31');
  });
});

describe('calendarYearColumns', () => {
  it('🔴 只返回能整除 12 的列数 —— 12 张卡不许剩半行', () => {
    for (const fits of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 40]) {
      const columns = calendarYearColumns(fits);
      expect(MONTHS_PER_YEAR % columns, `${String(fits)} 列时给了 ${String(columns)}`).toBe(0);
      expect(columns).toBeLessThanOrEqual(Math.max(1, fits));
    }
  });

  it('5 列降到 4、7 列降到 6、13 列封顶 12', () => {
    expect(calendarYearColumns(5)).toBe(4);
    expect(calendarYearColumns(7)).toBe(6);
    expect(calendarYearColumns(13)).toBe(12);
    expect(calendarYearColumns(40)).toBe(12);
  });

  it('窄到放不下、0、负数、NaN 一律给 1（**不能给 0**：0 列 = 一个空的年视图）', () => {
    // 空的年视图与"这一档没接上"在界面上是同一张图 —— 本仓为那一类症状记过一整页。
    expect(calendarYearColumns(0)).toBe(1);
    expect(calendarYearColumns(-3)).toBe(1);
    expect(calendarYearColumns(Number.NaN)).toBe(1);
    expect(calendarYearColumns(1.9)).toBe(1);
  });
});

describe('calendarMonthDrill（点一张月卡之后）', () => {
  it('切到月档，游标落进那个月的月首', () => {
    const drill = calendarMonthDrill('2026-03-01');
    expect(drill.view).toBe('month');
    expect(drill.cursor).toBe('2026-03-01');
  });

  it('🔴 传进来的若不是月首，游标仍然被归到月首（用的是月档那条游标规则本身）', () => {
    expect(calendarMonthDrill('2026-03-17').cursor).toBe('2026-03-01');
    // 与 `calendarCursorFor('month', …)` 逐字相同 —— 这条钉的是"这里没另写一份归一化"。
    expect(calendarMonthDrill('2026-03-17').cursor).toBe(
      calendarCursorFor('month', '2026-03-17'),
    );
  });

  it('🔴 返回值里**没有** `selected` —— "点月卡不换选中那天"靠结构成立，不靠调用方记得', () => {
    const drill = calendarMonthDrill('2026-03-01') as Record<string, unknown>;
    expect(Object.keys(drill).sort()).toEqual(['cursor', 'view']);
    expect('selected' in drill).toBe(false);
  });
});

describe('年档的游标与选中', () => {
  it('游标就是"这一年里的任意一天"，不归到 1 月（归一化交给 `monthsOfYear`）', () => {
    expect(calendarCursorFor('year', '2026-10-03')).toBe('2026-10-03');
    // 🔴 与月档相反：月档会把 10-03 归到 10-01。年档若也归，`‹ ›` 走一年后会
    //    指着 1 月，而用户点的是"下一年的同一个位置"。
    expect(calendarCursorFor('year', '2026-10-03')).not.toBe(calendarCursorFor('month', '2026-10-03'));
  });

  it('翻年**不换**选中的那一天（与月/周同一立场）', () => {
    expect(calendarSelectedForCursor('year', '2027-05-01', '2026-10-03')).toBe('2026-10-03');
  });
});
