/**
 * 分类共享模型的测试
 * ====================
 *
 * 这里挑的都是**不报错、只会画错**的边界：什么算"空"、未设色落到哪个颜色、
 * 堆叠条的段序、以及"峰值那一周"被误当成"每行各自的峰值"。
 * 它们全都能编译、能运行，只会在屏幕上呈现成另一件事。
 *
 * ⚠️ 这个测试跑在 **node** 环境（`vitest.config.ts` 文件头有理由）：
 * `packages/ui` 不引入 DOM 测试栈，所以"有判断"的部分必须留在 `model.ts`。
 * 一旦有人在 `model.ts` 里 import 了 `react-native`，这里会立刻失败。
 */

import { describe, expect, it } from 'vitest';
import {
  CATEGORY_SLOT_TOKEN_BY_SLOT,
  HEAT_TOKENS,
  UNSET_CATEGORY_TOKEN,
} from '@heyta/design-system';
import type { CategoryReport, CategorySeries } from '@heyta/domain';

import {
  categoryBarSegments,
  categoryHeatToken,
  categorySlotToken,
  hasUnsetCategorySlot,
  isEmptyCategoryReport,
} from '../src/categories/model.js';

function row(over: Partial<CategorySeries> = {}): CategorySeries {
  return {
    key: 'project:p1',
    kind: 'project',
    id: 'p1',
    name: '深度工作',
    totalMs: 0,
    focusMs: 0,
    habitMs: 0,
    weeklyMs: [],
    ...over,
  };
}

function report(over: Partial<CategoryReport> = {}): CategoryReport {
  return {
    weeks: [],
    series: [],
    unassignedMs: 0,
    totalMs: 0,
    peakWeeklyMs: 0,
    ...over,
  };
}

describe('categorySlotToken：未设色不许落到某个分类色上', () => {
  it('undefined → 中性的 UNSET token（不是 1 号色，也不是"没有颜色"）', () => {
    // 🔴 借用一个分类色会让"没设过色"看起来像用户选过的某个类别 ——
    // 那是一个**不会报错**的语义错误。
    expect(categorySlotToken(undefined)).toBe(UNSET_CATEGORY_TOKEN);
    expect(Object.values(CATEGORY_SLOT_TOKEN_BY_SLOT)).not.toContain(UNSET_CATEGORY_TOKEN);
  });

  it('1–8 各自落到自己的槽位 token', () => {
    for (const slot of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
      expect(categorySlotToken(slot)).toBe(CATEGORY_SLOT_TOKEN_BY_SLOT[slot]);
    }
  });

  it('八个槽位指向**八个不同**的颜色', () => {
    const tokens = ([1, 2, 3, 4, 5, 6, 7, 8] as const).map((slot) => categorySlotToken(slot));
    expect(new Set(tokens).size).toBe(8);
  });
});

describe('categoryHeatToken：0 档是"没记录"的中性色', () => {
  it('0–4 与设计系统的 HEAT_TOKENS 逐项一致', () => {
    for (const level of [0, 1, 2, 3, 4] as const) {
      expect(categoryHeatToken(level)).toBe(HEAT_TOKENS[level]);
    }
  });

  it('五个档位互不相同（深浅必须真的分得开）', () => {
    const tokens = ([0, 1, 2, 3, 4] as const).map((level) => categoryHeatToken(level));
    expect(new Set(tokens).size).toBe(5);
  });
});

describe('isEmptyCategoryReport：只看行数会把"有 3 小时但没归类"判成空', () => {
  it('没有行、也没有未归类时间 → 空', () => {
    expect(isEmptyCategoryReport(report())).toBe(true);
  });

  it('🔴 没有行、但有未归类时间 → **不是**空（那一刻该说"没归到清单"）', () => {
    expect(isEmptyCategoryReport(report({ unassignedMs: 50 * 60_000 }))).toBe(false);
  });

  it('有行 → 不是空（哪怕总时长为 0）', () => {
    expect(isEmptyCategoryReport(report({ series: [row()] }))).toBe(false);
  });
});

describe('hasUnsetCategorySlot：提示只在真的有行没设色时出现', () => {
  it('所有行都设了色 → 不给提示', () => {
    expect(hasUnsetCategorySlot(report({ series: [row({ slot: 1 }), row({ key: 'x', slot: 8 })] }))).toBe(
      false,
    );
  });

  it('任一行未设色 → 给提示', () => {
    expect(hasUnsetCategorySlot(report({ series: [row({ slot: 1 }), row({ key: 'x' })] }))).toBe(
      true,
    );
  });
});

describe('categoryBarSegments：段序 = 行序，且跨周固定', () => {
  it('段序就是 `report.series` 的序（不按当周数值临时排序）', () => {
    const big = row({ key: 'project:big', name: '深度工作', slot: 1, weeklyMs: [10, 1_000] });
    const small = row({ key: 'project:small', name: '杂事', slot: 2, weeklyMs: [500, 10] });
    const r = report({ series: [big, small], peakWeeklyMs: 1_000 });

    // 第 0 周：small（500）> big（10），但两段的**顺序仍是行序** big → small。
    expect(categoryBarSegments(r, 0).map((s) => s.key)).toEqual(['project:big', 'project:small']);
    // 第 1 周：big（1000）> small（10），顺序不变。
    expect(categoryBarSegments(r, 1).map((s) => s.key)).toEqual(['project:big', 'project:small']);
  });

  it('时长为 0 的行不产生段（不画看不见的 0 高线）', () => {
    const r = report({
      series: [
        row({ key: 'a', slot: 1, weeklyMs: [0] }),
        row({ key: 'b', slot: 2, weeklyMs: [5] }),
      ],
      peakWeeklyMs: 5,
    });
    expect(categoryBarSegments(r, 0).map((s) => s.key)).toEqual(['b']);
  });

  it('比例的分母是窗口峰值（跨行共享），不是这一行自己的峰值', () => {
    const a = row({ key: 'a', slot: 1, weeklyMs: [1_000] });
    const b = row({ key: 'b', slot: 2, weeklyMs: [250] });
    const r = report({ series: [a, b], peakWeeklyMs: 1_000 });
    const segments = categoryBarSegments(r, 0);
    expect(segments[0]?.ratio).toBe(1);
    // 🔴 若按"每行各自归一"，这里会是 1 —— 两行看起来就一样高了。
    expect(segments[1]?.ratio).toBe(0.25);
  });

  it('每段带的是**它自己那一行**的颜色 token', () => {
    const r = report({ series: [row({ slot: 3, weeklyMs: [1] })], peakWeeklyMs: 1 });
    expect(categoryBarSegments(r, 0)[0]?.token).toBe(CATEGORY_SLOT_TOKEN_BY_SLOT[3]);
  });

  it('峰值为 0 时不会算出 Infinity%', () => {
    // 分母为 0 会得到 `Infinity%`，而它在 RN/CSS 里是**静默无效** ——
    // 柱子直接消失。真实数据里不该出现（峰值是单格最大值），但要拦住算错。
    const r = report({ series: [row({ slot: 1, weeklyMs: [7] })], peakWeeklyMs: 0 });
    expect(categoryBarSegments(r, 0)[0]?.ratio).toBe(0);
  });
});
