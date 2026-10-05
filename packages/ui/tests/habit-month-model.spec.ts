/**
 * 习惯月历的**格子逻辑**（工单 H4）
 * =================================
 *
 * `packages/ui` 的测试传统上是**只测模型不渲染**（渲染在 `apps/web/tests/*` 的 jsdom 里、
 * 真浏览器在 `e2e/*`）。这一族同一条路：这里钉"格子怎么排、哪格能点、按下去是打卡还是撤销"，
 * 接线在不在由 web/mobile 各自的宿主判据钉。
 *
 * 🔴 三件最容易错、且错了**不会报错**的事：
 *   1. 列头与网格的**起始日**不一致 ⇒ 整月错一天（用户看不出，只会觉得"今天怎么在昨天那列"）；
 *   2. 补白格被当成可点 ⇒ 在邻月写了一条记录，而界面显示的是这个月；
 *   3. "能不能点"在视图层再判一次 ⇒ 第二个裁决者（`packages/domain/tests/habit-backfill.spec.ts`
 *      的 B8 钉的就是这条，这里钉它的视图侧）。
 */

import { describe, expect, it } from 'vitest';

import {
  DAYS_PER_WEEK,
  MONTHS_PER_YEAR,
  isoWeekday,
  type Habit,
  type HabitLog,
  type LocalDate,
} from '@heyta/domain';
import {
  habitMonthCellAction,
  habitMonthCells,
  habitMonthWindowDays,
  isHabitMonthCellInteractive,
  isHabitMonthForwardCapped,
} from '../src/habits/month-model.js';

const TODAY: LocalDate = '2026-10-05'; // 周一
const OCT: LocalDate = '2026-10-01';

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  name: '读书',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const logOf = (date: LocalDate): HabitLog => ({
  id: `l-${date}`,
  habitId: 'h1',
  date,
  createdAt: 1,
  updatedAt: 1,
});

/** 把 6×7 摊平，只留本月那格。 */
const inMonth = (habit_: Habit, logs: readonly HabitLog[], month: LocalDate) =>
  habitMonthCells(habit_, logs, month, TODAY)
    .flat()
    .filter((cell) => cell.inMonth);

describe('习惯月历的格子（month-model）', () => {
  it('U1 🔴 网格是 6 行 × 每行 7 格，且**第一列是周一**', () => {
    const weeks = habitMonthCells(habit(), [], OCT, TODAY);
    expect(weeks.length).toBe(6);
    for (const week of weeks) expect(week.length).toBe(DAYS_PER_WEEK);
    // 每一行的第一格必须是周一：这与 `WEEKDAY_MESSAGE_KEYS` 的列头同序，
    // 列头一旦写成周日起头，整月错一天而两边都不报错。
    for (const week of weeks) {
      const first = week[0]!;
      expect(isoWeekday(first.date), `${first.date} 不是周一`).toBe(1);
    }
  });

  it('U2 十月那 31 天全部出现，且不混进别月的日子', () => {
    const days = inMonth(habit(), [], OCT);
    expect(days.length).toBe(31);
    for (const cell of days) expect(cell.date.startsWith('2026-10')).toBe(true);
  });

  it('U3 🔴 补白格不可点、不动作（点它 = 在邻月写记录，而界面显示的是这个月）', () => {
    /* 🔴 窗口必须**盖住那几天**（`backfillDays: 7`）：默认窗口只有 1 天，而十月的
       尾随/前置补白是九月底那几天 —— 它们本来就因为"超过窗口"点不动，于是把
       `inMonth` 那一层判据整个摘掉也照样全绿。
       臂台 `mutate-habit-month.mjs` 的 MA1 第一次就是这么活的（"存活"读数原话：
       "这批判据对这份坏没有牙"）。这条用例要钉的是**那一层**，不是"总之点不动"。 */
    const pad = habitMonthCells(habit({ backfillDays: 7 }), [], OCT, TODAY)
      .flat()
      .filter((cell) => !cell.inMonth);
    expect(pad.length).toBeGreaterThan(0); // 阳性对照：这个月**确实**有补白格
    /* 阳性对照（第二层）：**至少有一格补白处在 `backfillable`** —— 状态本身点得动，
       于是"它点不动"只能来自 `inMonth` 那一层。不写"每一格都点得动"：这张历的
       尾随补白是十一月的日子，它们的天然状态是 `future`，那不能反证这条判据。
       （这里把状态名写成字面量而不是调 `isHabitDayTappable`，因为拿被检的那把尺
         去证明它自己，就是 §7 第 33 条"永远通过的判据"。） */
    expect(
      pad.filter((cell) => cell.state === 'backfillable').length,
      '补白格里没有一格是"本来可以补"的 ⇒ 这条用例没走到 inMonth 那一层',
    ).toBeGreaterThan(0);
    for (const cell of pad) {
      expect(isHabitMonthCellInteractive(cell), `${cell.date} 是补白格`).toBe(false);
      expect(habitMonthCellAction(cell)).toBe('none');
    }
  });

  it('U4 三档不可点各有名字（未来 / 本来不用打 / 超过窗口）', () => {
    const days = inMonth(habit({ backfillDays: 2 }), [], OCT);
    const byDate = new Map(days.map((cell) => [cell.date, cell]));
    const tooOld = byDate.get('2026-10-01' as LocalDate)!;
    const backfillable = byDate.get('2026-10-04' as LocalDate)!;
    const today = byDate.get(TODAY)!;
    const future = byDate.get('2026-10-20' as LocalDate)!;
    expect(tooOld.state).toBe('too-old');
    expect(isHabitMonthCellInteractive(tooOld)).toBe(false);
    expect(backfillable.state).toBe('backfillable');
    expect(habitMonthCellAction(backfillable)).toBe('check-in');
    expect(today.state).toBe('today');
    expect(habitMonthCellAction(today)).toBe('check-in');
    expect(future.state).toBe('future');
    expect(isHabitMonthCellInteractive(future)).toBe(false);
  });

  it('U5 已打过的那格按下去是**撤销**，早已超窗也照样能撤', () => {
    const longAgo: LocalDate = '2026-09-01';
    const cells = habitMonthCells(habit(), [logOf(longAgo)], longAgo, TODAY).flat();
    const cell = cells.find((c) => c.date === longAgo)!;
    expect(cell.state).toBe('logged');
    expect(habitMonthCellAction(cell)).toBe('undo');
    expect(isHabitMonthCellInteractive(cell)).toBe(true);
  });

  it('U6 🔴 非频次日不可点（每周一的习惯不该在周三"补"出一个要求）', () => {
    const weekly = habit({ frequency: { type: 'weekly', daysOfWeek: [1] }, backfillDays: 7 });
    const cells = inMonth(weekly, [], '2026-09-01' as LocalDate);
    const byDate = new Map(cells.map((cell) => [cell.date, cell]));
    // 2026-09-30 是周三、09-28 是周一，两者都在 7 天窗口内 —— 差别只在频次。
    expect(habitMonthCellAction(byDate.get('2026-09-30' as LocalDate)!)).toBe('none');
    expect(isHabitMonthCellInteractive(byDate.get('2026-09-30' as LocalDate)!)).toBe(false);
    expect(habitMonthCellAction(byDate.get('2026-09-28' as LocalDate)!)).toBe('check-in');
    // 阳性对照：格子总数仍是 6×7（有人改了网格形状的话，上面按日期取值会静默取到 undefined）。
    expect(cells.length).toBeGreaterThanOrEqual(28);
    expect(habitMonthCells(weekly, [], '2026-09-15' as LocalDate, TODAY).flat().length).toBe(42);
  });

  it('U7 窗口提示的那个数字来自领域层，不是这里拍的', () => {
    expect(habitMonthWindowDays(habit())).toBe(1); // 默认 = 只能补昨天
    expect(habitMonthWindowDays(habit({ backfillDays: 7 }))).toBe(7);
  });

  it('U8 翻月不许越过当前月（未来没有"补打卡"这件事）', () => {
    expect(isHabitMonthForwardCapped(OCT, TODAY)).toBe(true);
    expect(isHabitMonthForwardCapped('2026-09-01' as LocalDate, TODAY)).toBe(false);
    /* 🔴 跨年那一档比较的是 `YYYY-MM` **前缀**，不是"月份数字"：
       拿月份数字比的话，12 月看 1 月会得出"1 在 12 之前 ⇒ 可以再往前翻一年"，
       而那正好是"能翻到未来"的反面。（本条第一版写成 `('2026-12-01', TODAY)` ——
       TODAY 是 2026-10-05，十二月**就在未来**，说 `false` 是把判据写在了错误的世界观上。） */
    expect(isHabitMonthForwardCapped('2027-01-01' as LocalDate, '2026-12-15' as LocalDate)).toBe(
      true,
    );
    expect(isHabitMonthForwardCapped('2026-12-01' as LocalDate, '2027-01-05' as LocalDate)).toBe(
      false,
    );
    expect(MONTHS_PER_YEAR).toBe(12);
  });
});
