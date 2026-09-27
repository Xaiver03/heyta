/**
 * 激励体系：物化状态 → 领域输入（共享那一段）的测试
 * =================================================
 *
 * 这一层与 `category-report` **同形状**，也就同一种危险：它薄，但漏一处就是
 * "安静地算错"。而且它现在被**两个宿主**共用 —— 移动端成长屏与 Web 成长视图
 * 画的是同一批数字，所以这里漏一处会在两个地方同时错，且都不报错。
 *
 * 每条用例都**能失败**，并在文件末尾列了实际跑过的变异（把实现改坏 → 哪条红）。
 * 没有变异验证的"接线测试"很容易退化成"调用了就对"。
 *
 * 🔴 `now` 一律注入，测试里绝不出现 `Date.now()`：否则用例会随运行日期变红
 * （本仓库已经因此吃过一次 flaky 的亏）。
 */

import { describe, expect, it } from 'vitest';

import { toLocalDate, type FocusSession, type Habit, type HabitLog, type Project, type Task } from '@heyta/domain';

import {
  bestCurrentStreak,
  dailyActivityCountsFromState,
  habitGrowth,
  habitGrowthFromState,
  identityTagsFromState,
  todayProgressFromState,
  weeklyReviewFromState,
  type MotivationTables,
} from '../src/motivation.js';

/** 固定时钟：2026-09-24（周四）10:00 本地时间。 */
const NOW = new Date(2026, 8, 24, 10, 0, 0).getTime();
const TODAY = toLocalDate(NOW);
const MINUTE = 60_000;

/** 某天的本地正午 —— 用它构造"落在哪一天"的时间戳，避开夏令时边界。 */
function at(y: number, m: number, d: number, h = 12): number {
  return new Date(y, m - 1, d, h, 0, 0, 0).getTime();
}

function habit(over: Partial<Habit> = {}): Habit {
  return { id: 'h1', name: '喝水', target: 1, createdAt: 0, updatedAt: 0, ...over };
}

function log(habitId: string, date: string, over: Partial<HabitLog> = {}): HabitLog {
  return { id: `${habitId}:${date}`, habitId, date, createdAt: 0, updatedAt: 0, ...over };
}

function task(over: Partial<Task> = {}): Task {
  return { id: 't1', title: '写周报', createdAt: 0, updatedAt: 0, ...over };
}

function project(over: Partial<Project> = {}): Project {
  return { id: 'p1', name: '深度工作', createdAt: 0, updatedAt: 0, ...over };
}

function session(over: Partial<FocusSession> = {}): FocusSession {
  return {
    id: 'f1',
    kind: 'work',
    plannedMs: 25 * MINUTE,
    actualMs: 25 * MINUTE,
    createdAt: at(2026, 9, 24),
    endedAt: at(2026, 9, 24),
    updatedAt: 0,
    ...over,
  };
}

/** 把数组包成物化状态要的 `Record<id, T>` 形状。 */
function byId<T extends { id: string }>(rows: T[]): Record<string, T> {
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

/** 五张表的空底：用例只声明它关心的那几张。 */
function flat(over: Partial<MotivationTables> = {}): MotivationTables {
  return {
    habits: {},
    habitLogs: {},
    tasks: {},
    projects: {},
    focusSessions: {},
    ...over,
  };
}

describe('todayProgressFromState：摊平 + 滤墓碑 + 注入 today', () => {
  it('习惯 / 任务 / 专注三张表都参与', () => {
    const p = todayProgressFromState(
      flat({
        habits: byId([habit()]),
        habitLogs: byId([log('h1', TODAY)]),
        // 09-22 到期、今天是 09-24 → 已逾期，仍算"今天该做的"
        tasks: byId([task({ dueDate: at(2026, 9, 22) })]),
        focusSessions: byId([session()]),
      }),
      NOW,
    );

    expect(p.habitsPlanned).toBe(1);
    expect(p.habitsDone).toBe(1);
    expect(p.tasksPlanned).toBe(1);
    expect(p.focusMinutes).toBe(25);
    expect(p.done).toBe(1);
  });

  /**
   * ⚠️ **这条用例钉的是端到端契约，不是本层的滤墓碑实现。**
   *
   * 变异验证实测（MV1）：把 `todayProgressFromState` 里的 `aliveRecords`
   * 换成 `Object.values`，**这条依然是绿的** —— 因为 `computeTodayProgress`
   * 自己就会跳过 `deletedAt` 的实体。所以它证明的是"撤销就是没发生"这个
   * **用户可见的结论**，而不是"本层滤了墓碑"。
   *
   * 本层真正承重的那处滤墓碑在 `dailyActivityCountsFromState`（见下面那条
   * 用例，MV1b 能变红）。两处都留着：一处防领域函数忘了滤，一处是本层自己累加。
   */
  it('🔴 墓碑不进任何统计 —— 撤销就是没发生', () => {
    const p = todayProgressFromState(
      flat({
        habits: byId([habit()]),
        habitLogs: byId([log('h1', TODAY, { deletedAt: NOW })]),
        tasks: byId([task({ completedAt: NOW, deletedAt: NOW })]),
        focusSessions: byId([session({ deletedAt: NOW })]),
      }),
      NOW,
    );

    // 打卡撤销了 → 今天没达成；任务撤销了 → 不算完成；专注撤销了 → 0 分钟。
    expect(p.habitsDone).toBe(0);
    expect(p.tasksDone).toBe(0);
    expect(p.focusMinutes).toBe(0);
  });

  it('🔴 认哪一天由注入的 now 决定，而不是跑测试那天', () => {
    // 昨天打过卡。用 NOW 算：今天没达成；用"昨天"作为 now 算：达成。
    const state = flat({
      habits: byId([habit()]),
      habitLogs: byId([log('h1', toLocalDate(at(2026, 9, 23)))]),
    });

    expect(todayProgressFromState(state, NOW).habitsDone).toBe(0);
    expect(todayProgressFromState(state, at(2026, 9, 23)).habitsDone).toBe(1);
  });
});

describe('bestCurrentStreak / identityTagsFromState：只与自己比，且比的是"现在"', () => {
  /**
   * 07-01 起连续 30 天（longest = 30），中间断掉，今天只打了 1 天。
   * 于是 current = 1、longest = 30 —— 两个数字**刻意不同**，
   * 用来区分实现取的是哪一个。
   */
  const brokenThenRestarted = byId([
    ...Array.from({ length: 30 }, (_, i) => log('h1', `2026-07-${String(i + 1).padStart(2, '0')}`)),
    log('h1', TODAY),
  ]);

  it('🔴 取的是当前连续，不是历史最长', () => {
    expect(bestCurrentStreak([habit()], Object.values(brokenThenRestarted), TODAY)).toBe(1);
  });

  it('🔴 历史最长够 30 天也不能发 streak-thirty —— 那说的是"过去"', () => {
    const tags = identityTagsFromState(flat({ habits: byId([habit()]), habitLogs: brokenThenRestarted }), NOW);
    const streakTag = tags.find((tag) => tag.id === 'streak-thirty');
    expect(streakTag?.reached).toBe(false);
    // 前提断言：这条用例只有在 longest 真的 ≥ 30 时才有意义。
    const row = habitGrowth(habit(), Object.values(brokenThenRestarted), TODAY);
    expect(row.streak.longest).toBeGreaterThanOrEqual(30);
  });
});

describe('habitGrowth：连续与韧性共用同一份日志、同一个 today', () => {
  it('断在昨天时给出可补回来的一天（韧性口径）', () => {
    const logs = [
      log('h1', '2026-09-20'),
      log('h1', '2026-09-21'),
      log('h1', '2026-09-22'),
      // 昨天（09-23）漏了
    ];

    const row = habitGrowth(habit(), logs, TODAY);

    expect(row.streak.current).toBe(0);
    expect(row.resilience.repair).toEqual({ date: '2026-09-23', streakIfRepaired: 4 });
  });

  it('只统计自己的打卡：别的习惯的日志不参与', () => {
    const logs = [log('h1', '2026-09-23'), log('h2', TODAY)];
    const row = habitGrowth(habit({ id: 'h1' }), logs, TODAY);
    // h2 今天打了卡，但 h1 没有 —— 昨天那条也只属于 h1。
    expect(row.resilience.resilience.lastDate).toBe('2026-09-23');
  });

  it('habitGrowthFromState 只回未删除的习惯', () => {
    const rows = habitGrowthFromState(
      flat({
        habits: byId([habit({ id: 'h1' }), habit({ id: 'h9', deletedAt: NOW })]),
        habitLogs: byId([log('h1', TODAY), log('h9', TODAY)]),
      }),
      NOW,
    );
    expect(rows.map((r) => r.habit.id)).toEqual(['h1']);
  });
});

describe('dailyActivityCountsFromState：事实是"每天几件"', () => {
  it('打卡 + 完成任务 + 工作专注各算一件；休息不算', () => {
    const counts = dailyActivityCountsFromState(
      flat({
        habitLogs: byId([log('h1', TODAY)]),
        tasks: byId([task({ completedAt: at(2026, 9, 24) })]),
        focusSessions: byId([
          session({ id: 'f1' }),
          // 休息不是专注成果 —— 与今日进度同口径（见 focus.ts 的 shouldPersistSession）。
          session({ id: 'f2', kind: 'shortBreak' }),
        ]),
      }),
      NOW,
      3,
    );

    expect(counts).toHaveLength(3);
    expect(counts.map((c) => c.date)).toEqual(['2026-09-22', '2026-09-23', TODAY]);
    expect(counts[2]).toEqual({ date: TODAY, count: 3 });
  });

  /**
   * 🔴 这是本层**唯一承重**的滤墓碑：`dailyActivityCountsFromState` 是自己
   * 累加的，没有领域函数兜底。变异验证 MV1b：把那里的 `aliveRecords` 换成
   * `Object.values` → 恰好这一条变红（1 failed / 446 passed）。
   */
  it('🔴 墓碑的活动不算 —— 否则"删掉的那天"会重新亮起来', () => {
    const counts = dailyActivityCountsFromState(
      flat({
        habitLogs: byId([log('h1', TODAY, { deletedAt: NOW })]),
        tasks: byId([task({ completedAt: at(2026, 9, 24), deletedAt: NOW })]),
        focusSessions: byId([session({ deletedAt: NOW })]),
      }),
      NOW,
      1,
    );
    expect(counts[0]).toEqual({ date: TODAY, count: 0 });
  });
});

describe('weeklyReviewFromState：窗口由注入的 today 决定', () => {
  it('2026-09-24（周四）所在的周是 09-21 ～ 09-27', () => {
    const review = weeklyReviewFromState(flat(), NOW);
    expect(review.weekStart).toBe('2026-09-21');
    expect(review.weekEnd).toBe('2026-09-27');
    expect(review.headline).toBe('none');
  });

  it('项目 / 专注都摊平（累计总量参与里程碑）', () => {
    const review = weeklyReviewFromState(
      flat({
        projects: byId([project()]),
        tasks: byId([task({ projectId: 'p1', completedAt: at(2026, 9, 24) })]),
        focusSessions: byId([session()]),
      }),
      NOW,
    );
    expect(review.tasksCompleted).toBe(1);
    expect(review.focusMinutes).toBe(25);
    expect(review.topProjectId).toBe('p1');
  });
});

/**
 * 变异验证记录（真的跑过，不是声明）
 * ==================================
 *
 * | 编号 | 把实现改成 | 结果 |
 * |---|---|---|
 * | MV1  | `todayProgressFromState` 的 `aliveRecords(logs)` → `Object.values` | **全绿（无效变异）** |
 * | MV1b | `dailyActivityCountsFromState` 的 `aliveRecords(logs)` → `Object.values` | 1 red / 446 passed |
 * | MV2  | `bestCurrentStreak` 取 `.current` → `.longest` | 2 red / 445 passed |
 * | MV3  | `dailyActivityCountsFromState` 去掉 `shouldPersistSession` 判定 | 1 red / 446 passed |
 *
 * MV1 **没红，而这是有用的信息**：它证明 `computeTodayProgress` 自己也滤墓碑，
 * 于是本层那处 `aliveRecords` 是冗余的（保留理由与承重处见源码注释与
 * `todayProgressFromState` 上方那段说明）。**一条不会红的断言要改掉说法，
 * 而不是删掉了事** —— 它仍然在钉"撤销就是没发生"这个用户可见结论。
 */
