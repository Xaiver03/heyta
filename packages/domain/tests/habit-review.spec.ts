/**
 * 间隔复习（`HabitFrequency` 的 `spaced` 那一档）
 * ==============================================
 *
 * 判据分三层，各挡对方挡不住的那一半：
 *
 *   R1–R3 **判定**：`isScheduledOn` 只在那几天为真，且**起点之前一律不为真**。
 *     起点那条不是细节 —— 少了它，"创建之前的那几天"会凭空变成该复习的日子，
 *     连续天数与完成率的分母一起变，而界面上只会显示一个奇怪的百分比。
 *   R4–R6 **校验/归一**：去重、升序、拒绝 0 与负数、空表抛。
 *     空表必须抛：它意味着"一天都不该复习"，判定侧会恒 false，
 *     界面表现为"这个习惯永远不用做"。
 *   R7–R8 **派生**：`reviewDates` / `nextReviewDate` 只做加法，不写库
 *     （ADR-0014「推断不持久化」）。
 *
 * ⚠️ 这一族**不测**"文案"：界面上那句话的红线（不许宣称"符合遗忘曲线"）
 *    在 `packages/domain/src/habit-review.ts` 的文件头，属于文案审阅，不是算式。
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REVIEW_OFFSETS,
  isScheduledOn,
  nextReviewDate,
  normalizeReviewOffsets,
  reviewDates,
  type HabitFrequency,
  type LocalDate,
} from '../src/index.js';

const spaced = (
  offsets: number[],
  anchor: LocalDate = '2026-01-01',
): HabitFrequency => ({ type: 'spaced', offsets, anchor });

describe('间隔复习：判定（R1–R3）', () => {
  it('R1 只在 anchor + offsets 那几天算计划日', () => {
    const plan = spaced([1, 2, 4]);
    expect(isScheduledOn(plan, '2026-01-02')).toBe(true); // 第 1 天
    expect(isScheduledOn(plan, '2026-01-03')).toBe(true); // 第 2 天
    expect(isScheduledOn(plan, '2026-01-05')).toBe(true); // 第 4 天
    expect(isScheduledOn(plan, '2026-01-04')).toBe(false); // 第 3 天，不在表里
    expect(isScheduledOn(plan, '2026-01-08')).toBe(false); // 第 7 天，不在表里
  });

  it('R2 起点当天不是计划日（默认表从第 1 天起，首次复习不早于 24h）', () => {
    const plan = spaced([...DEFAULT_REVIEW_OFFSETS]);
    expect(isScheduledOn(plan, '2026-01-01')).toBe(false);
    expect(DEFAULT_REVIEW_OFFSETS[0]).toBe(1);
  });

  it('R3 起点之前一律不是计划日（不能凭空长出历史）', () => {
    const plan = spaced([1, 2, 4], '2026-01-10');
    // 2025-12-31 与 2026-01-09 都在起点之前；若把 diff 取绝对值，
    // 2026-01-09 会被算成"第 1 天"而变成计划日 —— 那正是这一条挡的坏。
    expect(isScheduledOn(plan, '2026-01-09')).toBe(false);
    expect(isScheduledOn(plan, '2025-12-31')).toBe(false);
    expect(isScheduledOn(plan, '2026-01-11')).toBe(true);
  });
});

describe('间隔复习：校验与归一（R4–R6）', () => {
  it('R4 去重 + 升序', () => {
    expect(normalizeReviewOffsets([7, 1, 7, 2])).toEqual([1, 2, 7]);
  });

  it('R5 拒绝 0、负数、小数', () => {
    expect(() => normalizeReviewOffsets([0])).toThrow(/≥1/);
    expect(() => normalizeReviewOffsets([-3])).toThrow(/≥1/);
    expect(() => normalizeReviewOffsets([1.5])).toThrow(/≥1/);
  });

  it('R6 空表抛（空表 = 一天都不该复习，连续天数会恒 0）', () => {
    expect(() => normalizeReviewOffsets([])).toThrow(/至少要有一个/);
  });
});

describe('间隔复习：派生（R7–R8）', () => {
  it('R7 reviewDates 只做加法，且升序', () => {
    expect(reviewDates({ type: 'spaced', offsets: [4, 1, 2], anchor: '2026-01-01' })).toEqual([
      '2026-01-02',
      '2026-01-03',
      '2026-01-05',
    ]);
  });

  it('R8 nextReviewDate 含今天，且计划走完后给 undefined（不是画一个永远不来的日期）', () => {
    const plan = { type: 'spaced' as const, offsets: [1, 3], anchor: '2026-01-01' };
    expect(nextReviewDate(plan, '2026-01-01')).toBe('2026-01-02');
    expect(nextReviewDate(plan, '2026-01-02')).toBe('2026-01-02');
    expect(nextReviewDate(plan, '2026-01-03')).toBe('2026-01-04');
    expect(nextReviewDate(plan, '2026-01-05')).toBeUndefined();
  });
});
