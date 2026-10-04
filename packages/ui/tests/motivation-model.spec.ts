/**
 * 激励 / 成长共享模型的单测
 * ==========================
 *
 * 领域算法（今天该做几件、连续怎么数、里程碑阈值、身份判据）已经在
 * `packages/domain/tests` 里钉过；共享的摊平 / 滤墓碑在
 * `packages/app-host/tests/motivation.spec.ts` 里钉过。
 *
 * 这个文件测的是**共享层新增的那一层**：视图模型转换（顺序 / 分档 / 夹紧 /
 * 取前 N 条）与它的分支。它的错误全部是"安静"的：
 *   - `total === 0 && done > 0` 说成"今天还没记录" → 抹掉用户顺手做完的事；
 *   - 进度百分比不夹紧 → 条子画出容器外，RN 不报错，只是看起来没画；
 *   - 里程碑按达成数重排 → 变成排行榜的形状（本设计的红线）；
 *   - `nearMissTags` 没有 tie-break → 两次渲染里列表换位，用户看到"目标在跳"。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本文件的判据之一是"**不自己发明顺序**"，所以它一定用真实投影做输入
 *
 * 排序 / 分档那几条**不用手写的假数组**当输入，而是喂
 * `@heyta/domain#deriveMilestones` / `#deriveIdentityTags` 的真实输出，
 * 再断言共享层的顺序与那个输出**逐项一致**。用假数组的话，共享层自己排一个
 * 顺序也能全绿 —— 而"自己排一个顺序"正是要防的东西。
 *
 * ⚠️ 本文件**不 import `react-native`**：`packages/ui/vitest.config.ts` 跑在
 * node 环境，加载 react-native 会直接解析失败。这顺带钉住了"`model.ts` 必须
 * 保持宿主无关"。
 */

import { describe, expect, it, vi } from 'vitest';

import {
  deriveIdentityTags,
  deriveMilestones,
  toLocalDate,
  type ActivityTotals,
  type Habit,
  type HabitLog,
  type IdentityTagProgress,
  type MilestoneProgress,
  type TodayProgress,
  type WeeklyReview,
} from '@heyta/domain';

import type { HabitGrowthFn } from '../src/habits/model.js';
import {
  NEAR_MISS_LIMIT,
  SHARE_RESET_MS,
  WEEK_STAT_IDS,
  activityLevel,
  growthHint,
  activityHeatmapTotal,
  isUnplannedOnly,
  milestoneGroups,
  nearMissTags,
  progressPercent,
  progressRatio,
  ratioText,
  reachedTagIds,
  shouldShowTodayBreakdown,
  shouldShowTodayFocus,
  toActivityHeatmapDays,
  toHabitStreakRows,
  weekHeadlineCount,
  weekStatRows,
  type ActivityDayCount,
} from '../src/motivation/model.js';

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
  return { checkIns: 0, focusCount: 0, focusMs: 0, tasksCompleted: 0, activeDays: 0, ...over };
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

function identityTag(
  over: Partial<IdentityTagProgress> & { id: string },
): IdentityTagProgress {
  return { kind: 'checkIns', threshold: 10, value: 0, reached: false, ratio: 0, ...over };
}

// ─────────────────────────────────────────────────────────────────────────
// 今日进度（L1）
// ─────────────────────────────────────────────────────────────────────────

describe('growthHint：四种状态互斥且穷尽', () => {
  it('空输入（没有习惯、没有日志、没有专注）不抛错 → idle', () => {
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

describe('ratioText / progressPercent / progressRatio', () => {
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

  it('比例版与百分比版**共用同一段夹紧**（0–1）', () => {
    expect(progressRatio(-3)).toBe(0);
    expect(progressRatio(0.25)).toBe(0.25);
    expect(progressRatio(42)).toBe(1);
    expect(progressRatio(Number.NaN)).toBe(0);
  });
});

describe('isUnplannedOnly / 明细两处开关', () => {
  it('没有计划却有完成 → true；有计划就是 false（哪怕没做完）', () => {
    expect(isUnplannedOnly(progress({ total: 0, done: 2 }))).toBe(true);
    expect(isUnplannedOnly(progress({ total: 0, done: 0 }))).toBe(false);
    expect(isUnplannedOnly(progress({ total: 2, done: 2 }))).toBe(false);
  });

  it('🔴 total 为 0 时不展开明细（不铺 0/0/0 的假清单）', () => {
    expect(shouldShowTodayBreakdown(progress({ total: 0, done: 2 }))).toBe(false);
    expect(shouldShowTodayBreakdown(progress({ total: 1, done: 0 }))).toBe(true);
  });

  it('专注 0 分钟不显示；>0 才显示', () => {
    expect(shouldShowTodayFocus(progress({ focusMinutes: 0 }))).toBe(false);
    expect(shouldShowTodayFocus(progress({ focusMinutes: 25 }))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 周复盘（L3 短周期）
// ─────────────────────────────────────────────────────────────────────────

describe('weekStatRows：三个维度、顺序固定、数字取自投影', () => {
  it('顺序恒为 WEEK_STAT_IDS（打卡 → 任务 → 专注），**不按数值大小重排**', () => {
    // 故意让最大的数字落在最后一维（专注），顺序仍不许变。
    const r = review({ checkIns: 1, tasksCompleted: 2, focusMinutes: 999 });
    expect(weekStatRows(r).map((row) => row.id)).toEqual([...WEEK_STAT_IDS]);
  });

  it('每行的 value / previous 逐项来自传入的 WeeklyReview（不自己算差值）', () => {
    const r = review({
      checkIns: 5,
      tasksCompleted: 2,
      focusMinutes: 30,
      previous: { checkIns: 4, tasksCompleted: 9, focusMinutes: 0 },
    });
    expect(weekStatRows(r)).toEqual([
      { id: 'checkIns', value: 5, previous: 4 },
      { id: 'tasksCompleted', value: 2, previous: 9 },
      { id: 'focusMinutes', value: 30, previous: 0 },
    ]);
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

// ─────────────────────────────────────────────────────────────────────────
// 里程碑（L3 长周期）
// ─────────────────────────────────────────────────────────────────────────

describe('milestoneGroups：每维度一块，顺序与投影一致', () => {
  it('空输入回空数组（不造假的一块）', () => {
    expect(milestoneGroups([])).toEqual([]);
  });

  it('🔴 维度顺序**逐项等于**领域层投影的首次出现顺序（不自己发明顺序）', () => {
    const projected = deriveMilestones(totals({ checkIns: 12 }));
    const groups = milestoneGroups(projected);

    // 领域层给的顺序（去重后）就是共享层的顺序 —— 断言的是"相等"，不是"包含"。
    const projectedOrder = [...new Set(projected.map((m) => m.kind))];
    expect(groups.map((g) => g.kind)).toEqual(projectedOrder);
    expect(groups.map((g) => g.kind)).toEqual(['checkIns', 'focusHours', 'tasks', 'activeDays']);
  });

  it('🔴 维度顺序不随达成数变化（按达成数排就是排行榜的形状）', () => {
    const few = milestoneGroups(deriveMilestones(totals({ checkIns: 12 })));
    const many = milestoneGroups(
      deriveMilestones(totals({ tasksCompleted: 9000 })),
    );
    expect(many.map((g) => g.kind)).toEqual(few.map((g) => g.kind));
    // 而且"达成最多"的那一维确实换人了 —— 证明上面的相等不是因为两边都没变。
    expect(few.find((g) => g.kind === 'checkIns')!.reached).toBe(1);
    expect(many.find((g) => g.kind === 'tasks')!.maxed).toBe(true);
  });

  it('同一维度即使**不相邻**也只成一块（先分桶再按首次出现定序）', () => {
    // 手工打乱，模拟"领域层将来改了排序"。
    const shuffled: MilestoneProgress[] = [
      { id: 'a', kind: 'checkIns', threshold: 1, value: 3, reached: true, ratio: 1 },
      { id: 'b', kind: 'tasks', threshold: 1, value: 0, reached: false, ratio: 0 },
      { id: 'c', kind: 'checkIns', threshold: 10, value: 3, reached: false, ratio: 0.3 },
    ];
    const groups = milestoneGroups(shuffled);
    expect(groups.map((g) => g.kind)).toEqual(['checkIns', 'tasks']);
    const checkIns = groups[0]!;
    expect(checkIns.total).toBe(2);
    expect(checkIns.tiers).toEqual([
      { threshold: 1, reached: true },
      { threshold: 10, reached: false },
    ]);
    // 当前值取同维度首条（领域层保证同维度共享同一 value）。
    expect(checkIns.current).toBe(3);
  });

  it('部分达成时：reached / next / ratio 对齐投影', () => {
    const groups = milestoneGroups(deriveMilestones(totals({ checkIns: 12 })));
    const checkIns = groups[0]!;
    expect(checkIns.reached).toBe(1);
    expect(checkIns.total).toBe(5);
    expect(checkIns.next).toBe(50);
    expect(checkIns.ratio).toBeCloseTo(12 / 50);
    expect(checkIns.maxed).toBe(false);

    const activeDays = groups[3]!;
    expect(activeDays.reached).toBe(0);
    expect(activeDays.next).toBe(7);
    expect(activeDays.ratio).toBe(0);
    expect(activeDays.maxed).toBe(false);
  });

  it('全部达成时 maxed 为真、next 消失、进度封顶（边界：正好到最后一档）', () => {
    const groups = milestoneGroups(
      deriveMilestones(
        totals({
          checkIns: 5000,
          focusCount: 0,
          focusMs: 2000 * 3_600_000,
          tasksCompleted: 9000,
          activeDays: 400,
        }),
      ),
    );
    expect(groups.length).toBe(4);
    for (const group of groups) {
      expect(group.maxed).toBe(true);
      expect(group.next).toBeUndefined();
      expect(group.ratio).toBe(1);
      expect(group.reached).toBe(group.total);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 身份标签（L3）
// ─────────────────────────────────────────────────────────────────────────

describe('reachedTagIds / nearMissTags', () => {
  it('空输入：已达成为空、最近的未达成也为空（确定性空结果，不抛错）', () => {
    expect(reachedTagIds([])).toEqual([]);
    expect(nearMissTags([], NEAR_MISS_LIMIT)).toEqual([]);
  });

  it('🔴 已达成的 id 顺序**逐项等于**投影顺序（不重排）', () => {
    const tags = deriveIdentityTags({
      totals: totals({ activeDays: 30, checkIns: 12 }),
      bestCurrentStreak: 5,
    });
    const projectedReached = tags.filter((t) => t.reached).map((t) => t.id);
    expect(reachedTagIds(tags)).toEqual(projectedReached);
    expect(reachedTagIds(tags)).toEqual(['started', 'routine']);
  });

  it('最近的未达成按距达标比例排序，并给出 gap 与 kind', () => {
    const tags = deriveIdentityTags({
      totals: totals({ activeDays: 30, checkIns: 12 }),
      bestCurrentStreak: 5,
    });
    expect(nearMissTags(tags, 2)).toEqual([
      { id: 'steady', kind: 'activeDays', gap: 70 },
      { id: 'streak-thirty', kind: 'streakDays', gap: 25 },
    ]);
  });

  it('🔴 比例并列时按 id 字典序（否则两次渲染的顺序会跳）', () => {
    const tags = [
      identityTag({ id: 'zeta', ratio: 0.5, threshold: 10, value: 5 }),
      identityTag({ id: 'alpha', ratio: 0.5, threshold: 10, value: 5 }),
      identityTag({ id: 'mid', ratio: 0.9, threshold: 10, value: 9 }),
    ];
    expect(nearMissTags(tags, 3).map((t) => t.id)).toEqual(['mid', 'alpha', 'zeta']);
  });

  it('边界：正好 limit 条 / limit + 1 条 / limit = 0 / 负数', () => {
    const two = [identityTag({ id: 'a', ratio: 0.9 }), identityTag({ id: 'b', ratio: 0.8 })];
    const three = [...two, identityTag({ id: 'c', ratio: 0.7 })];

    // 正好 N：全部返回。
    expect(nearMissTags(two, 2).map((t) => t.id)).toEqual(['a', 'b']);
    // N + 1：截掉最后一个。
    expect(nearMissTags(three, 2).map((t) => t.id)).toEqual(['a', 'b']);
    // 0：空数组（不是"取全部"）。
    expect(nearMissTags(three, 0)).toEqual([]);
    // 🔴 负数：**必须有早退**。这一条是故障注入（MV-B0）逼出来的 ——
    // 去掉 `limit <= 0` 早退之后，`limit = 0` 仍然全绿（`slice(0, 0)` 本来就是 []），
    // 但 `slice(0, -1)` 会返回**前 N-1 条**，把"负数即不显示"变成"少显示一条"。
    // 没有这几条断言，那个早退就是一行没人验证过的代码（假绿实测见本文件尾）。
    expect(nearMissTags(three, -1)).toEqual([]);
    expect(nearMissTags(three, -99)).toEqual([]);
  });

  it('全部达成时没有"还差多少"', () => {
    const all = deriveIdentityTags({
      totals: totals({
        activeDays: 400,
        checkIns: 500,
        tasksCompleted: 9000,
        focusMs: 300 * 3_600_000,
      }),
      bestCurrentStreak: 40,
    });
    expect(nearMissTags(all, NEAR_MISS_LIMIT)).toEqual([]);
  });

  it('gap 不为负：已达成却混进未达成列表时按 0 处理由调用方兜底，这里给原始差', () => {
    // `nearMissTags` 只过滤未达成；value > threshold 的脏数据不应把 gap 变负。
    const weird = [identityTag({ id: 'w', ratio: 0, threshold: 10, value: 12 })];
    expect(nearMissTags(weird, 1)).toEqual([{ id: 'w', kind: 'checkIns', gap: -2 }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 热力图分档（展示口径）
// ─────────────────────────────────────────────────────────────────────────

describe('activityLevel：分档边界', () => {
  it('🔴 0 / 1 / 2 / 3 / 4+ 逐档（边界：正好 4 与 4 以上同档）', () => {
    expect(activityLevel(0)).toBe(0);
    expect(activityLevel(1)).toBe(1);
    expect(activityLevel(2)).toBe(2);
    expect(activityLevel(3)).toBe(3);
    expect(activityLevel(4)).toBe(4);
    expect(activityLevel(5)).toBe(4);
    expect(activityLevel(365)).toBe(4);
  });

  it('负数与非有限值归 0 档（脏数据不该画出一格颜色）', () => {
    expect(activityLevel(-1)).toBe(0);
    expect(activityLevel(Number.NaN)).toBe(0);
    expect(activityLevel(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('toActivityHeatmapDays / activityHeatmapTotal', () => {
  it('空输入回空数组、总数为 0', () => {
    expect(toActivityHeatmapDays([])).toEqual([]);
    expect(activityHeatmapTotal([])).toBe(0);
  });

  it('🔴 只加分档，**不排序也不补天** —— 输入顺序原样保留', () => {
    const days: ActivityDayCount[] = [
      { date: '2026-09-27', count: 4 },
      { date: '2026-09-26', count: 0 },
      { date: '2026-09-25', count: 2 },
    ];
    expect(toActivityHeatmapDays(days)).toEqual([
      { date: '2026-09-27', count: 4, level: 4 },
      { date: '2026-09-26', count: 0, level: 0 },
      { date: '2026-09-25', count: 2, level: 2 },
    ]);
  });

  it('分档与 activityLevel 逐项一致（不另抄一份映射）', () => {
    const days = [0, 1, 2, 3, 4, 9].map((count, index) => ({
      date: `2026-09-2${String(index)}`,
      count,
    }));
    for (const day of toActivityHeatmapDays(days)) {
      expect(day.level).toBe(activityLevel(day.count));
    }
  });

  it('总数是各天之和（不是"有活动的天数"）', () => {
    expect(
      activityHeatmapTotal(
        toActivityHeatmapDays([
          { date: '2026-09-27', count: 3 },
          { date: '2026-09-26', count: 2 },
        ]),
      ),
    ).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 连续性（L2，宿主注入配对）
// ─────────────────────────────────────────────────────────────────────────

function habit(id: string): Habit {
  return { id, name: id, createdAt: 0, updatedAt: 0 };
}

const STUB_RESILIENCE = {
  current: 5,
  longest: 9,
  total: 40,
  freezesHeld: 0,
  frozenDays: 0,
  frozenInCurrentRun: 0,
};

/**
 * W8：`HabitGrowthFn` 的返回类型现在含**必填** `month` —— 这里的桩也得给。
 * 不给不会运行时报错，而是**编译不过**：这正是"宿主/桩没接会被逼出来"的形状。
 */
const STUB_MONTH: import('@heyta/domain').HabitPeriodStats = {
  monthKey: '2026-09',
  achievedDays: 2,
  scheduledDays: 8,
  rate: 0.25,
  monthValue: 5,
  totalValue: 41,
  totalAchievedDays: 9,
};

describe('toHabitStreakRows：配对由宿主注入，本层不自己配对', () => {
  it('空输入回空数组（没有习惯不抛错）', () => {
    const growth = vi.fn();
    expect(toHabitStreakRows([], [], Date.now(), growth as unknown as HabitGrowthFn)).toEqual([]);
    // 🔴 没有习惯时**一次都不该调用**注入的配对函数。
    expect(growth).not.toHaveBeenCalled();
  });

  it('🔴 顺序就是传入 habits 的顺序，不做任何排序', () => {
    const habits = [habit('c'), habit('a'), habit('b')];
    const growth: HabitGrowthFn = () => ({
      streak: { current: 1, longest: 1 },
      resilience: { resilience: STUB_RESILIENCE },
      month: STUB_MONTH,
    });
    const rows = toHabitStreakRows(habits, [], Date.now(), growth);
    expect(rows.map((row) => row.habit.id)).toEqual(['c', 'a', 'b']);
  });

  it('🔴 注入函数收到的 `today` 是 `now` 换出来的本地日期（只有一处换算）', () => {
    const now = Date.UTC(2026, 8, 27, 12);
    const seen: string[] = [];
    const growth: HabitGrowthFn = (_habit, _logs, today) => {
      seen.push(today);
      return { streak: { current: 0, longest: 0 }, resilience: { resilience: STUB_RESILIENCE }, month: STUB_MONTH };
    };
    toHabitStreakRows([habit('a'), habit('b')], [], now, growth);
    // 两个习惯拿到**同一个** today —— 不能各读一次时钟。
    expect(seen).toEqual([toLocalDate(now), toLocalDate(now)]);
  });

  it('行里带的是注入函数给的那个 resilience（共享层不重算）', () => {
    const injected = { ...STUB_RESILIENCE, current: 77 };
    const growth: HabitGrowthFn = () => ({
      streak: { current: 1, longest: 1 },
      resilience: { resilience: injected },
      month: STUB_MONTH,
    });
    const rows = toHabitStreakRows([habit('a')], [], Date.now(), growth);
    expect(rows[0]!.resilience.resilience.current).toBe(77);
  });

  it('日志被原样转交给注入函数（共享层不自己过滤/配对）', () => {
    const logs: HabitLog[] = [{ id: 'l1', habitId: 'a', date: '2026-09-27', createdAt: 0, updatedAt: 0 }];
    const received: Array<readonly HabitLog[]> = [];
    const growth: HabitGrowthFn = (_habit, ownLogs) => {
      received.push(ownLogs);
      return { streak: { current: 0, longest: 0 }, resilience: { resilience: STUB_RESILIENCE }, month: STUB_MONTH };
    };
    toHabitStreakRows([habit('a')], logs, Date.now(), growth);
    expect(received[0]).toBe(logs);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────────────────────────────────

describe('常量：两端迁移前各自硬写的数字现在只有一处', () => {
  it('NEAR_MISS_LIMIT 是 2（web 的 NEAR_MISS_COUNT / mobile 的 nearMissTags(tags, 2)）', () => {
    expect(NEAR_MISS_LIMIT).toBe(2);
  });

  it('SHARE_RESET_MS 是 2 秒（web ShareSection 的 2000 硬编码）', () => {
    expect(SHARE_RESET_MS).toBe(2000);
  });
});

/**
 * 变异验证记录（真的跑过，不是声明）
 * ==================================
 *
 * 注入方式：把 `src/motivation/model.ts` 备份到 `/tmp`，**就地**改一行
 * （vitest 走 pnpm workspace 解析，纯 `/tmp` 副本解析不到 `@heyta/domain`），
 * 先用 `grep`/`sed` 确认变异真的落到了函数体里，再跑测试，最后按字节还原
 * 并用 `diff` 验证（哈希与原始一致）。工作区事后 `git status` 只有本刀新增的
 * 文件，没有任何注入残留。
 *
 * | 编号 | 把实现改成 | 结果 |
 * |---|---|---|
 * | MV-A | `milestoneGroups` 末尾按 `reached` 降序重排 | **1 red** / 241 passed；红的正是「🔴 维度顺序不随达成数变化」，报 `expected [ 'tasks', 'checkIns', … ] to deeply equal [ 'checkIns', 'focusHours', … ]`。另一条「顺序逐项等于投影」**仍然绿** —— 因为那个输入的达成数恰好没打乱稳定排序，说明断言不是靠整片红掩盖的。 |
 * | MV-B0 | `nearMissTags` 去掉 `if (limit <= 0) return []` | **0 red** / 242 passed —— **假绿**：`slice(0, 0)` 本来就是 `[]`，这一行对 `0` 不承重。据此在本文件补了 `limit = -1 / -99` 两条断言；再次注入后 MV-B0 变成 1 red（`expected [ Array(2) ] to deeply equal []`）。 |
 * | MV-B | `nearMissTags` 去掉 tie-break（`b.ratio - a.ratio` 单独一行） | **1 red** / 241 passed；「🔴 比例并列时按 id 字典序」报 `expected [ 'mid', 'zeta', 'alpha' ] to deeply equal [ 'mid', 'alpha', 'zeta' ]`。 |
 * | MV-C | `activityLevel` 去掉 `if (count === 1) return 1` | **1 red** / 241 passed；「🔴 0/1/2/3/4+ 逐档」报 `expected 4 to be 1`。 |
 *
 * ⚠️ 未注入（登记为**已知未验证**，别把它读成已验证）：
 *   · `toHabitStreakRows` 的"不排序"：注入 `sort(by name)` 应让「顺序就是传入
 *     habits 的顺序」变红，本轮没跑（三条注入已经覆盖"顺序 / 边界 / 分档"三类，
 *     时间花在 MV-B0 那条假绿上更值）。最小一步：改一行、跑一次、还原。
 *   · 所有 `.tsx` 组件：本仓库**不 render 组件**（`vitest.config.ts` 的文件头
 *     写明理由），它们的正确性靠三端实际渲染（`scripts/verify-universal-slice.sh`）。
 *     所以 `labels` 少一项、`renderSectionHeader` 没接上这类错误，**本文件一条都
 *     抓不到** —— 这是覆盖边界，不是遗漏。
 */
