/**
 * 习惯（共享模型）单测
 * ======================
 *
 * M3 第七刀（habits）。测的是 `packages/ui/src/habits/model.ts` 里**所有有判断的地方** ——
 * 组件里因此没有分支，不需要靠快照测试兜（与 `quadrant-model.spec.ts` 同一约定）。
 *
 * 🔴 这里**不 import `@heyta/app-host`**：`model.ts` 的接口是"配对函数由宿主注入"
 * （`HabitGrowthFn`），所以测试传一个**桩**就行 —— 这顺带证明"共享层不认识 app-host"
 * 这条边界真的成立（真的 import 了会在这里解析失败）。
 */

import { HEAT_TOKENS } from '@heyta/design-system';
import type { Habit, HabitLog, HabitPeriodStats, HabitResilienceView, LocalDate, StreakResult } from '@heyta/domain';
import { describe, expect, it } from 'vitest';

import {
  HABIT_HEATMAP_DAYS,
  HABIT_LIST_WEEK_DAYS,
  HEATMAP_WEEK_START,
  frozenDays,
  habitGoalSummaryKey,
  habitHeatLevel,
  habitHeatmap,
  hasCountableGoal,
  heatmapLevelToken,
  heatmapTotal,
  monthOfDate,
  shouldOfferFreshStart,
  shouldOfferRepair,
  toHabitProgressRows,
  toHeatmapWeeks,
  type HabitGrowthFn,
} from '../src/habits/model.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 一个**确定的**本地时刻。
 *
 * 2026-09-28 是**周一**（已用系统 `date` 核对）。选周一不是随意的：
 * 周日开头的一周里，周一是第 1 列，于是"首列补 1 个空格"这个判断
 * 才真的被演练到 —— 选周日会得到 0 个前导空格，那条断言就是空转。
 */
const NOW = new Date(2026, 8, 28, 12, 0, 0).getTime();

function habit(over: Partial<Habit> = {}): Habit {
  return { id: 'h1', name: '喝水', createdAt: 1, updatedAt: 1, ...over };
}

function log(date: LocalDate, over: Partial<HabitLog> = {}): HabitLog {
  return { id: `h1:${date}`, habitId: 'h1', date, createdAt: 1, updatedAt: 1, ...over };
}

/** 一个**只记录调用**的配对桩：证明 model 不自己算连续。 */
function stubGrowth(result?: {
  streak: StreakResult;
  resilience: HabitResilienceView;
  month?: HabitPeriodStats;
}): { fn: HabitGrowthFn; calls: Array<{ habitId: string; logCount: number; today: LocalDate }> } {
  const calls: Array<{ habitId: string; logCount: number; today: LocalDate }> = [];
  const fn: HabitGrowthFn = (h, logs, today) => {
    calls.push({ habitId: h.id, logCount: logs.length, today });
    return (
      // W8：`month` 与 streak/resilience 一样**原样透传**，桩默认给一份
      // 与 streak 数字处处不同的值，免得巧合相等时断言指错地方。
      {
        ...(result ?? {
          streak: { current: 3, longest: 9 },
          resilience: { resilience: { current: 3, longest: 9, total: 12, freezesHeld: 1, frozenDays: 2, frozenInCurrentRun: 0 } },
        }),
        month: result?.month ?? MONTH_STUB,
      }
    );
  };
  return { fn, calls };
}

const MONTH_STUB: HabitPeriodStats = {
  monthKey: '2026-09',
  achievedDays: 6,
  scheduledDays: 9,
  rate: 6 / 9,
  monthValue: 14,
  totalValue: 77,
  totalAchievedDays: 33,
};

describe('热度分档只有两档，且与迁移前的 web 口径逐字一致', () => {
  it('0 次 = 0 档，≥1 次 = 4 档（不发明中间档）', () => {
    expect(habitHeatLevel(0)).toBe(0);
    expect(habitHeatLevel(1)).toBe(4);
    // 未来若把 `value/target` 接进来，"打了一半"会变成中间档 ——
    // 在那之前这里必须**拒绝**猜一个中间值。
    expect(habitHeatLevel(99)).toBe(4);
  });

  it('档位 → token 来自设计系统唯一那份 `HEAT_TOKENS`（不手抄色阶）', () => {
    expect(heatmapLevelToken(0)).toBe(HEAT_TOKENS[0]);
    expect(heatmapLevelToken(4)).toBe(HEAT_TOKENS[4]);
    expect(HEAT_TOKENS).toHaveLength(5);
  });
});

describe('热力图窗口', () => {
  it('长度 = days，最后一天是"今天"，顺序从旧到新', () => {
    const days = habitHeatmap([], 'h1', NOW, 7);
    expect(days).toHaveLength(7);
    expect(days[0]?.date).toBe('2026-09-22');
    expect(days[6]?.date).toBe('2026-09-28');
  });

  it('默认窗口是 90 天（不是 365 —— 那是成长页的年度视图）', () => {
    expect(habitHeatmap([], 'h1', NOW)).toHaveLength(HABIT_HEATMAP_DAYS);
    expect(HABIT_HEATMAP_DAYS).toBe(90);
  });

  it('只数**这个习惯**的打卡，别的习惯的记录不算', () => {
    const days = habitHeatmap(
      [log('2026-09-28'), log('2026-09-27', { id: 'h2:2026-09-27', habitId: 'h2' })],
      'h1',
      NOW,
      3,
    );
    expect(days.map((d) => d.count)).toEqual([0, 0, 1]);
  });

  it('总数 = 窗口内打卡次数之和', () => {
    const days = habitHeatmap([log('2026-09-28'), log('2026-09-26')], 'h1', NOW, 7);
    expect(heatmapTotal(days)).toBe(2);
  });
});

describe('周列排法（列 = 周、行 = 星期几）', () => {
  it('每一列恒为 7 项，首尾用 null 补齐', () => {
    const weeks = toHeatmapWeeks(habitHeatmap([], 'h1', NOW, 7));
    for (const week of weeks) expect(week.days).toHaveLength(7);
  });

  it('周日开头时，周一的日期落在第 1 行（首列补 1 个空格）', () => {
    // 2026-09-22 是周二；窗口 2026-09-22..2026-09-28（周二→周一）。
    const weeks = toHeatmapWeeks(habitHeatmap([], 'h1', NOW, 7), HEATMAP_WEEK_START);
    expect(weeks).toHaveLength(2);
    // 第一列：周日 + 周一（空）+ 周二…周六 → 前两个是 null，第三个是 09-22。
    expect(weeks[0]?.days[0]).toBeNull();
    expect(weeks[0]?.days[1]).toBeNull();
    expect(weeks[0]?.days[2]?.date).toBe('2026-09-22');
    // 第二列：周日 09-27、周一 09-28，其余补齐。
    expect(weeks[1]?.days[0]?.date).toBe('2026-09-27');
    expect(weeks[1]?.days[1]?.date).toBe('2026-09-28');
    expect(weeks[1]?.days[6]).toBeNull();
  });

  it('一周从周一开始排时，同一个窗口的列会变（`weekStartsOn` 不是装饰参数）', () => {
    const sunday = toHeatmapWeeks(habitHeatmap([], 'h1', NOW, 7), 0);
    const monday = toHeatmapWeeks(habitHeatmap([], 'h1', NOW, 7), 1);
    // 周一起排时，2026-09-22（周二）落在第 2 行（首列补 1 个空格）。
    expect(monday[0]?.days[1]?.date).toBe('2026-09-22');
    expect(sunday[0]?.days[2]?.date).toBe('2026-09-22');
    expect(monday).not.toEqual(sunday);
  });

  it('月份标签只在"月份变了"的那一列出现，且第一列一定有', () => {
    const weeks = toHeatmapWeeks(habitHeatmap([], 'h1', NOW, 90));
    const labelled = weeks.filter((w) => w.month !== undefined);
    // 90 天跨 3–4 个月 → 标签数必须在 (0, 列数) 之间，不能每列都有。
    expect(labelled.length).toBeGreaterThan(0);
    expect(labelled.length).toBeLessThan(weeks.length);
    expect(weeks[0]?.month).toBe(monthOfDate('2026-07-01'));
    // 相邻两个标签不重复同一个月份（重复 = "1月 1月 1月"）。
    const months = labelled.map((w) => w.month);
    for (let i = 1; i < months.length; i += 1) {
      expect(months[i]).not.toBe(months[i - 1]);
    }
  });

  it('空输入不产出任何列（不会凭空造一个 7 格全空的热力图）', () => {
    expect(toHeatmapWeeks([])).toEqual([]);
  });
});

describe('进度投影：连续/韧性由注入的配对函数给，model 不自己算', () => {
  it('每个习惯调用一次配对，且把**全部**日志原样传进去', () => {
    const { fn, calls } = stubGrowth();
    const logs = [log('2026-09-28'), log('2026-09-27')];
    toHabitProgressRows([habit(), habit({ id: 'h2', name: '跑步' })], logs, NOW, fn);
    expect(calls).toHaveLength(2);
    // ⚠️ 不做 per-habit 预过滤：`habitGrowth` 自己按 habitId 过滤。
    // 共享层替它过滤一次，会让"配对函数看到什么"出现两个版本。
    expect(calls.every((c) => c.logCount === 2)).toBe(true);
    expect(calls[0]?.today).toBe('2026-09-28');
  });

  it('今天的 log 决定 `doneToday`；没有就是 false', () => {
    const { fn } = stubGrowth();
    const rows = toHabitProgressRows(
      [habit(), habit({ id: 'h2', name: '跑步' })],
      [log('2026-09-28')],
      NOW,
      fn,
    );
    expect(rows[0]?.doneToday).toBe(true);
    expect(rows[0]?.todayLog?.date).toBe('2026-09-28');
    expect(rows[1]?.doneToday).toBe(false);
    expect(rows[1]?.todayLog).toBeUndefined();
  });

  it('昨天的 log 不算"今天打过"（跨午夜不能靠时间戳近似）', () => {
    const { fn } = stubGrowth();
    const rows = toHabitProgressRows([habit()], [log('2026-09-27')], NOW, fn);
    expect(rows[0]?.doneToday).toBe(false);
  });

  it('`todayRatio` 由领域层的完成比例算（目标 8、打了 4 = 0.5，不是"打过就是 1"）', () => {
    const { fn } = stubGrowth();
    const rows = toHabitProgressRows(
      [habit({ target: 8, unit: '杯' })],
      [log('2026-09-28', { value: 4 })],
      NOW,
      fn,
    );
    expect(rows[0]?.todayRatio).toBeCloseTo(0.5, 5);
  });

  it('今天没打卡时 `todayRatio` 是 0（不是 undefined）', () => {
    const { fn } = stubGrowth();
    const rows = toHabitProgressRows([habit({ target: 8 })], [], NOW, fn);
    expect(rows[0]?.todayRatio).toBe(0);
  });

  it('`streak` 与 `resilience` 原样来自配对函数（不在 model 里重算）', () => {    const streak: StreakResult = { current: 1, longest: 30, lastDate: '2026-09-28' };
    const resilience: HabitResilienceView = {
      resilience: {
        current: 4,
        longest: 30,
        total: 44,
        freezesHeld: 0,
        frozenDays: 3,
        frozenInCurrentRun: 1,
      },
      repair: { date: '2026-09-27', streakIfRepaired: 5 },
    };
    const { fn } = stubGrowth({ streak, resilience, month: MONTH_STUB });
    const rows = toHabitProgressRows([habit()], [], NOW, fn);
    expect(rows[0]?.streak).toBe(streak);
    expect(rows[0]?.resilience).toBe(resilience);
    // W8：月统计同一条纪律 —— 由注入函数给，共享层不重算。
    expect(rows[0]?.month).toBe(MONTH_STUB);
  });
});

describe('冻结 / 补打卡 / 重新开始的入口判据', () => {
  const base: HabitResilienceView = {
    resilience: {
      current: 0,
      longest: 0,
      total: 0,
      freezesHeld: 0,
      frozenDays: 0,
      frozenInCurrentRun: 0,
    },
  };

  it('领域层给了 `repair` 才显示"补上"入口', () => {
    expect(shouldOfferRepair(base)).toBe(false);
    expect(
      shouldOfferRepair({ ...base, repair: { date: '2026-09-27', streakIfRepaired: 5 } }),
    ).toBe(true);
  });

  it('领域层给了 `freshStart` 才显示"重新开始"入口', () => {
    expect(shouldOfferFreshStart(base)).toBe(false);
    expect(
      shouldOfferFreshStart({
        ...base,
        freshStart: { daysSinceLast: 9, longest: 21, total: 40 },
      }),
    ).toBe(true);
  });

  it('冻结天数取自 `frozenInCurrentRun`，**不是** current − streak.current', () => {
    // 实测过的那种错：两个口径相减会把 1 天算成 7 天（ADR-0022）。
    const view: HabitResilienceView = {
      resilience: {
        current: 8,
        longest: 8,
        total: 8,
        freezesHeld: 0,
        frozenDays: 7,
        frozenInCurrentRun: 1,
      },
    };
    expect(frozenDays(view)).toBe(1);
    const streakCurrent = 1;
    expect(frozenDays(view)).not.toBe(8 - streakCurrent);
  });

  it('没有冻结时是 0（组件据此不渲染那一行）', () => {
    expect(frozenDays(base)).toBe(0);
  });
});

describe('月份解析', () => {
  it('字符串切片，不经 `Date`（不涉时区）', () => {
    expect(monthOfDate('2026-01-01')).toBe(1);
    expect(monthOfDate('2026-12-31')).toBe(12);
  });
});

describe('窗口长度是"天"不是"毫秒"的隐式假设', () => {
  it('90 天窗口向前推 89 天，正好是第 0 格', () => {
    const days = habitHeatmap([], 'h1', NOW, 90);
    const first = new Date(NOW - 89 * MS_PER_DAY);
    expect(days[0]?.date).toBe(
      `${String(first.getFullYear())}-${String(first.getMonth() + 1).padStart(2, '0')}-${String(first.getDate()).padStart(2, '0')}`,
    );
  });
});

/**
 * 清单窗口（2026-10-01：「列表 + 窗格」的左列）
 * =============================================
 *
 * 🔴 **单独一组**，不并进上面的「热力图窗口」：7 与 90 是两个不同的东西 ——
 * 一个是"扫一眼最近一周打没打"，一个是"这块记录的完整历史"。写在同一组里，
 * 下次有人"顺手统一成一个常量"就会把右窗格缩成 7 格 —— 而缩完**它看起来仍然
 * 是一张正常的热力图**，界面上没人会看出少了 83 天。
 *
 * 变异验证（2026-10-01）：把 `HABIT_LIST_WEEK_DAYS` 改成 `90` ⇒ **恰好这三条红**
 * （`expected 90 to be 7` / 首格日期变成 `2026-07-01` / level 数组多 83 项）。
 * ⚠️ 注入是在**原地**做的（`packages/ui` 是共享工作树，改完立刻还原，
 * 并用 `diff -q` 确认字节一致）—— 这条判据没有只读接缝可用，
 * 因为它是值判据，不是源码文本判据。
 */
describe('清单窗口 HABIT_LIST_WEEK_DAYS', () => {
  it('是 7，且**不等于**热力图窗口 —— 两个数各自有名字', () => {
    expect(HABIT_LIST_WEEK_DAYS).toBe(7);
    expect(HABIT_LIST_WEEK_DAYS).not.toBe(HABIT_HEATMAP_DAYS);
  });

  it('取的是以**今天**结尾的连续 7 天，顺序从旧到新', () => {
    const days = habitHeatmap([], 'h1', NOW, HABIT_LIST_WEEK_DAYS);
    expect(days).toHaveLength(HABIT_LIST_WEEK_DAYS);
    // 末格是今天，不是明天（`now` 是 12:00，跨不跨午夜的判据在 `toHabitProgressRows` 那组）。
    expect(days.at(-1)?.date).toBe('2026-09-28');
    expect(days[0]?.date).toBe('2026-09-22');
  });

  it('清单里"打过的那天"是 4 档、没打的是 0 档 —— 那排点的颜色就来自这里', () => {
    const days = habitHeatmap([log('2026-09-26')], 'h1', NOW, HABIT_LIST_WEEK_DAYS);
    expect(days.map((day) => day.level)).toEqual([0, 0, 0, 0, 4, 0, 0]);
  });
});

/**
 * 目标摘要：口径 → 词条 key
 * ============================
 *
 * 🔴 收在共享层一份的理由：web（`HabitGoalEditor`）与 mobile（`HabitGoalSlot`）
 * **各有一个目标编辑器**，而"哪种口径说哪句话"是同一个判断。
 * 各写一份的症状是"同一个 `atMost`，web 说『最多』、移动端说『不超过』"，
 * 而两边都不报错 —— 与 `authFailureMessageKey` / `subtaskRejectionMessageKey`
 * 是同一种收编。
 */
describe('habitGoalSummaryKey —— 口径 → 摘要词条', () => {
  it('三种口径各给各的一句', () => {
    expect(habitGoalSummaryKey('atLeast')).toBe('web.habits.goal.summaryAtLeast');
    expect(habitGoalSummaryKey('atMost')).toBe('web.habits.goal.summaryAtMost');
    expect(habitGoalSummaryKey('exactly')).toBe('web.habits.goal.summaryExactly');
  });

  it('🔴 三条 key 互不相同（合并成一句会让"最多"看起来像"至少"）', () => {
    const keys = new Set([
      habitGoalSummaryKey('atLeast'),
      habitGoalSummaryKey('atMost'),
      habitGoalSummaryKey('exactly'),
    ]);
    expect(keys.size).toBe(3);
  });

  it('没设口径 ⇒ 默认 atLeast（与 isAchieved 的 ?? atLeast 对齐）', () => {
    expect(habitGoalSummaryKey(undefined)).toBe('web.habits.goal.summaryAtLeast');
  });

  it('认不出来的值也落 `atLeast`，不编一句新话', () => {
    expect(habitGoalSummaryKey('some-future-goal')).toBe('web.habits.goal.summaryAtLeast');
  });
});

/**
 * 工单 W6：`todayValue`（今天记了几格）与"该不该出现数量行"的判据。
 *
 * 这两件事都必须**在判断层**：组件里不许有分支（本文件文件头的约定），
 * 而"几格"的缺省算法在领域层（`@heyta/domain#habitLogValue`）——
 * 这里验的是**共享行带上了它**，以及**什么时候该显示**。
 */
describe('todayValue / hasCountableGoal（W6）', () => {
  const rowsOf = (h: Habit, logs: HabitLog[]) => toHabitProgressRows([h], logs, NOW, stubGrowth().fn);

  it('🔴 目标 8、今天记 5 ⇒ 行上是 5（不是 1、不是 0.625）', () => {
    const rows = rowsOf(habit({ target: 8 }), [log('2026-09-28', { value: 5 })]);
    expect(rows[0]?.todayValue).toBe(5);
    // 同一个数在比例那一腿上是 0.625 —— 两个字段说的是同一格，必须互相自洽。
    expect(rows[0]?.todayRatio).toBeCloseTo(0.625, 5);
  });

  it('今天没有记录 ⇒ 0（不是 undefined，界面上不许出现"今天 /8"）', () => {
    expect(rowsOf(habit({ target: 8 }), [])[0]?.todayValue).toBe(0);
  });

  it('打过卡但那条没写量 ⇒ 落 target，与 `isAchieved` 同一个读法', () => {
    const rows = rowsOf(habit({ target: 8 }), [log('2026-09-28')]);
    expect(rows[0]?.todayValue).toBe(8);
    expect(rows[0]?.todayRatio).toBe(1);
  });

  it('🔴 超目标时 `todayValue` 不等于比例反算值（记 10 / 目标 8 要显示 10，不是 8）', () => {
    const rows = rowsOf(habit({ target: 8 }), [log('2026-09-28', { value: 10 })]);
    expect(rows[0]?.todayValue).toBe(10);
    // 比例被 `Math.min(1, …)` 截断过 —— 这条同时证明两个字段**不能互换**。
    expect(rows[0]?.todayRatio).toBe(1);
  });

  it('hasCountableGoal：只有"做过一次"这一档的习惯**不**出现数量行', () => {
    // `createHabit` 给每条习惯都写 `target: 1`，所以判据不能是"填过目标没有" ——
    // 那会让每条纯打卡型习惯多一行「1/1」。
    expect(hasCountableGoal(habit())).toBe(false);
    expect(hasCountableGoal(habit({ target: 1 }))).toBe(false);
    expect(hasCountableGoal(habit({ target: 1, unit: '分钟' }))).toBe(false);
  });

  it('🔴 计数 / 时长 / **小数目标** / 目标 0 / `atMost`+1 五种都要出现', () => {
    expect(hasCountableGoal(habit({ target: 8, unit: '杯' }))).toBe(true);
    expect(hasCountableGoal(habit({ target: 30, unit: '分钟' }))).toBe(true);
    // 判据第一版写的是 `target > 1`，被一条界面用例照出来：0.5 小时的目标
    // 也是多格的（能记 0.25 / 0.5 / 1），却会整行不显示。合法域由 `setHabitGoal`
    // 决定 —— 它只拦负数与非有限数，所以 `!== 1` 才是那个判据。
    expect(hasCountableGoal(habit({ target: 0.5, unit: '小时' }))).toBe(true);
    // "一次都不碰"与"最多 1 杯"要的正是能记下**破戒**那个数。
    expect(hasCountableGoal(habit({ target: 0, goalType: 'atMost' }))).toBe(true);
    expect(hasCountableGoal(habit({ target: 1, goalType: 'atMost' }))).toBe(true);
    expect(hasCountableGoal(habit({ target: 1, goalType: 'exactly' }))).toBe(true);
  });
});
