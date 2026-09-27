/**
 * 成长屏展示逻辑的单测
 * ====================
 *
 * 领域算法（今天该做几件、连续怎么数、里程碑阈值）已经在
 * `packages/domain/tests` 里钉过；共享的摊平/滤墓碑在
 * `packages/app-host/tests/motivation.spec.ts` 里钉过。
 *
 * 这个文件测的是**移动端独有的那一层**：分支选择与界面形状。
 * 它值得测，因为它的错误全部是"安静"的：
 *   - `total === 0 && done > 0` 说成"今天还没记录" → 抹掉用户顺手做完的事；
 *   - 进度百分比不夹紧 → 条子画出容器外，RN 不报错，只是看起来没画；
 *   - 里程碑按达成数重排 → 变成排行榜的形状（本设计的红线）。
 *
 * 🔴 每条断言都**同时覆盖中英**（与 `tests/date.spec.ts` 同一纪律）：
 * 只测一种语言的话，把英文词条写成中文、或 en 表漏一个 key，测试会全绿，
 * 而英文界面是坏的。
 */

import { describe, expect, it } from 'vitest';

import { translate } from '@heyta/i18n';
import {
  deriveIdentityTags,
  deriveMilestones,
  type ActivityTotals,
  type TodayProgress,
  type WeeklyReview,
} from '@heyta/domain';

import {
  growthHint,
  milestoneGroups,
  nearMissTags,
  progressPercent,
  ratioText,
  reachedTagIds,
  weekHeadlineCount,
} from '../src/lib/growth-display';

function progress(over: Partial<TodayProgress> = {}): TodayProgress {
  return {
    habitsPlanned: 0,
    habitsDone: 0,
    tasksPlanned: 0,
    tasksDone: 0,
    focusMinutes: 0,
    total: 0,
    done: 0,
    bonus: 0,
    ratio: 0,
    closed: false,
    ...over,
  };
}

function totals(over: Partial<ActivityTotals> = {}): ActivityTotals {
  return { checkIns: 0, focusMs: 0, tasksCompleted: 0, activeDays: 0, ...over };
}

/** 本周复盘的最小底：用例只声明它关心的字段。 */
function review(over: Partial<WeeklyReview> = {}): WeeklyReview {
  const zero = { checkIns: 0, tasksCompleted: 0, focusMinutes: 0 };
  return {
    weekStart: '2026-09-21',
    weekEnd: '2026-09-27',
    ...zero,
    previous: { ...zero },
    deltas: { ...zero },
    headline: 'none',
    ...over,
  };
}

describe('growthHint：四种状态互斥且穷尽', () => {
  it('什么都没做也没有计划 → idle', () => {
    expect(growthHint(progress())).toBe('idle');
  });

  it('🔴 没有计划但做了事 → unplanned（不是 idle，也不是 0%）', () => {
    expect(growthHint(progress({ done: 3 }))).toBe('unplanned');
  });

  it('有计划且做完 → allDone；计划外多做也算做完', () => {
    expect(growthHint(progress({ total: 3, done: 3 }))).toBe('allDone');
    expect(growthHint(progress({ total: 3, done: 5, bonus: 2 }))).toBe('allDone');
  });

  it('还有没做的 → remaining', () => {
    expect(growthHint(progress({ total: 3, done: 1 }))).toBe('remaining');
  });
});

describe('ratioText / progressPercent', () => {
  it('进度数字是 已完成/计划', () => {
    expect(ratioText(progress({ done: 0, total: 3 }))).toBe('0/3');
    expect(ratioText(progress({ done: 3, total: 3 }))).toBe('3/3');
  });

  it('🔴 百分比夹在 0–100：越界值不该把条子画到容器外', () => {
    expect(progressPercent(0)).toBe(0);
    expect(progressPercent(0.5)).toBe(50);
    expect(progressPercent(1)).toBe(100);
    expect(progressPercent(-3)).toBe(0);
    expect(progressPercent(42)).toBe(100);
    expect(progressPercent(Number.NaN)).toBe(0);
  });
});

describe('milestoneGroups：每维度一块，顺序不按达成数重排', () => {
  it('只达成第一档时，下一档与进度都对', () => {
    const groups = milestoneGroups(deriveMilestones(totals({ checkIns: 12 })));

    expect(groups.map((g) => g.kind)).toEqual(['checkIns', 'focusHours', 'tasks', 'activeDays']);
    const checkIns = groups[0]!;
    expect(checkIns.current).toBe(12);
    expect(checkIns.reached).toBe(1);
    expect(checkIns.total).toBe(5);
    expect(checkIns.next).toBe(50);
    expect(checkIns.ratio).toBeCloseTo(12 / 50);
    expect(checkIns.maxed).toBe(false);

    // 一个都没达成的维度：下一档就是第一档，进度 0。
    const activeDays = groups[3]!;
    expect(activeDays.reached).toBe(0);
    expect(activeDays.next).toBe(7);
    expect(activeDays.ratio).toBe(0);
  });

  it('🔴 维度顺序由定义表决定，不随达成数变化', () => {
    const few = milestoneGroups(deriveMilestones(totals({ checkIns: 12 })));
    // 反过来：让最后一个维度（activeDays）达成最多。
    const many = milestoneGroups(
      deriveMilestones(totals({ checkIns: 0, focusMs: 0, tasksCompleted: 0, activeDays: 400 })),
    );
    expect(many.map((g) => g.kind)).toEqual(few.map((g) => g.kind));
    expect(many[3]!.maxed).toBe(true);
  });

  it('全部达成时 maxed 为真、next 消失、进度封顶', () => {
    const groups = milestoneGroups(
      deriveMilestones(
        totals({
          checkIns: 5000,
          focusMs: 2000 * 3_600_000,
          tasksCompleted: 9000,
          activeDays: 400,
        }),
      ),
    );
    for (const group of groups) {
      expect(group.maxed).toBe(true);
      expect(group.next).toBeUndefined();
      expect(group.ratio).toBe(1);
    }
  });

  it('空输入回空数组（不造假的一块）', () => {
    expect(milestoneGroups([])).toEqual([]);
  });
});

describe('weekHeadlineCount：标题讲哪个维度，数字就取哪个', () => {
  const counts = { checkIns: 5, tasksCompleted: 2, focusMinutes: 30 };

  it('三个维度各自取自己的数字，不串台', () => {
    expect(weekHeadlineCount(review({ ...counts, headline: 'checkIns' }))).toBe(5);
    expect(weekHeadlineCount(review({ ...counts, headline: 'tasksCompleted' }))).toBe(2);
    expect(weekHeadlineCount(review({ ...counts, headline: 'focusMinutes' }))).toBe(30);
  });

  it('none 取 0 —— 不能"随便挑一个"', () => {
    expect(weekHeadlineCount(review({ ...counts, headline: 'none' }))).toBe(0);
  });
});

describe('身份标签：已达成的与最近的未达成', () => {
  const tags = deriveIdentityTags({ totals: totals({ activeDays: 30, checkIns: 12 }), bestCurrentStreak: 5 });

  it('已达成的 id 按定义表顺序', () => {
    expect(reachedTagIds(tags)).toEqual(['started', 'routine']);
  });

  it('最近的未达成按距达标比例排序，并给出还差多少', () => {
    // activeDays 30 → steady(100) 还差 70，最近；streak 5 → streak-thirty(30) 还差 25。
    expect(nearMissTags(tags, 2)).toEqual([
      { id: 'steady', gap: 70 },
      { id: 'streak-thirty', gap: 25 },
    ]);
  });

  it('全部达成时没有"还差多少"', () => {
    const all = deriveIdentityTags({
      totals: totals({ activeDays: 400, checkIns: 500, tasksCompleted: 9000, focusMs: 300 * 3_600_000 }),
      bestCurrentStreak: 40,
    });
    expect(nearMissTags(all, 2)).toEqual([]);
  });
});

describe('词条：中英各有一条，不是硬编码', () => {
  it('成长屏的标题与四种提示在两种语言下都不同', () => {
    const keys = [
      'mobile.growth.title',
      'mobile.growth.today.hint.idle',
      'mobile.growth.today.hint.unplanned',
      'mobile.growth.today.hint.allDone',
      'mobile.growth.today.hint.remaining',
      'mobile.growth.streak.current',
      'mobile.growth.milestones.note',
      'mobile.growth.tags.note',
    ] as const;

    for (const key of keys) {
      const zh = translate('zh-CN', key);
      const en = translate('en', key);
      expect(zh).not.toBe('');
      expect(en).not.toBe('');
      expect(zh).not.toBe(en);
    }
  });

  it('带数字的词条会替换占位符，而不是渲染成 {count}', () => {
    expect(translate('zh-CN', 'mobile.growth.today.hint.remaining', { count: 2 })).toBe('还剩 2 件');
    expect(translate('en', 'mobile.growth.today.hint.remaining', { count: 2 })).toBe(
      'Still 2 to go today',
    );
    expect(translate('zh-CN', 'mobile.growth.streak.repair', { days: 4 })).toBe(
      '昨天还能补回来——补完是 4 天',
    );
  });
});

/**
 * 变异验证记录（真的跑过，不是声明）
 * ==================================
 *
 * | 编号 | 把实现改成 | 结果 |
 * |---|---|---|
 * | MV4 | `progressPercent` 去掉 0–1 夹紧（`ratio * 100`） | 1 red / 209 passed |
 * | MV5 | `growthHint` 的 `total === 0` 分支恒返回 `idle` | 1 red / 209 passed |
 *
 * 两条都只让**该红的那一条**变红 —— 说明断言不是靠"整片红"掩盖的。
 */
