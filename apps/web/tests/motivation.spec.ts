/**
 * 激励体系在 Web 壳里的接线测试
 * ==============================
 *
 * 领域层的算法已经在 `packages/domain/tests/motivation.spec.ts` 里钉过了。
 * 这个文件只测**接线**——也就是"物化状态 → 领域函数"这一段，
 * 而它恰恰是那种**单测全绿、界面却是错的**的地方：
 *
 *   1. `Record<id, Entity>` 忘记摊成数组 → 所有统计恒为 0，且不报错
 *   2. 忘记滤掉软删除 → 撤销过的打卡继续计数
 *   3. `now` 换算成日期时口径不一致 → 同一个界面两个"今天"
 *   4. 习惯的连续天数走 `computeStreak`，而韧性走另一条路 →
 *      两个数字在同一个卡片上对不上账
 *
 * 这些都不会抛异常，只会让用户看到一个安静的错误数字。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { translate } from '@heyta/i18n';
import type { FocusSession, Habit, HabitLog, Task } from '@heyta/domain';

import { selectHabitProgress, useHabitStore } from '../src/features/habits/store.js';
import { buildShareSummary } from '../src/features/motivation/copy.js';
import {
  selectIdentityTags,
  selectMilestones,
  selectTodayProgress,
  selectTotals,
  selectWeeklyReview,
  selectYearActivity,
  type MotivationInput,
} from '../src/features/motivation/selectors.js';

/** 稳定的"现在"：2026-09-24（周四）10:00 本地时间。 */
const NOW = new Date(2026, 8, 24, 10, 0, 0).getTime();
const TODAY = '2026-09-24';

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

function session(over: Partial<FocusSession> = {}): FocusSession {
  return {
    id: 'f1',
    kind: 'work',
    plannedMs: 25 * 60000,
    actualMs: 25 * 60000,
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

function input(over: Partial<MotivationInput> = {}): MotivationInput {
  return {
    habits: {},
    habitLogs: {},
    tasks: {},
    // 清单是**分类时长**那一块的输入（专注会话 → 任务 → 清单）。
    // 加上它意味着 `MotivationInput` 从"四张表"变成"五张表" ——
    // 每个用例都必须在场，否则漏掉的表会让统计恒为 0 而不报错。
    projects: {},
    focusSessions: {},
    ...over,
  };
}

beforeEach(() => {
  // 习惯 store 是模块级单例，用例之间必须清空 ——
  // 否则"上一条用例留下的打卡"会让下一条的连续天数凭空多一天。
  useHabitStore.setState({ habits: [], logs: [] });
});

describe('selectTodayProgress（接线）', () => {
  it('把三张表都摊开：习惯 / 任务 / 专注都参与', () => {
    const p = selectTodayProgress(
      input({
        habits: byId([habit()]),
        habitLogs: byId([log('h1', TODAY)]),
        tasks: byId([task({ id: 't1', dueDate: at(2026, 9, 22) })]),
        focusSessions: byId([session()]),
      }),
      NOW,
    );

    expect(p.habitsPlanned).toBe(1);
    expect(p.habitsDone).toBe(1);
    expect(p.tasksPlanned).toBe(1);
    expect(p.focusMinutes).toBe(25);
    expect(p.total).toBe(2);
    expect(p.done).toBe(1);
  });

  it('软删除的打卡不进任何统计（撤销就是没发生）', () => {
    const p = selectTodayProgress(
      input({
        habits: byId([habit()]),
        habitLogs: byId([log('h1', TODAY, { deletedAt: 1 })]),
      }),
      NOW,
    );

    expect(p.habitsDone).toBe(0);
  });
});

describe('selectWeeklyReview / selectTotals（接线）', () => {
  it('只统计本周窗口内的记录，并给出上周对照', () => {
    const review = selectWeeklyReview(
      input({
        habitLogs: byId([
          log('h1', '2026-09-22'),
          log('h1', '2026-09-23'),
          // 上周
          log('h1', '2026-09-15'),
        ]),
        tasks: byId([
          task({ id: 't1', completedAt: at(2026, 9, 23) }),
          task({ id: 't2', completedAt: at(2026, 9, 16) }),
        ]),
      }),
      NOW,
    );

    expect(review.weekStart).toBe('2026-09-21');
    expect(review.checkIns).toBe(2);
    expect(review.tasksCompleted).toBe(1);
    expect(review.previous.checkIns).toBe(1);
    expect(review.deltas.checkIns).toBe(1);
  });

  it('累计口径覆盖全部历史，不受本周窗口影响', () => {
    const totals = selectTotals(
      input({
        habitLogs: byId([log('h1', '2025-01-01'), log('h1', '2026-09-23')]),
        tasks: byId([task({ id: 't1', completedAt: at(2026, 9, 23) })]),
        focusSessions: byId([session({ id: 'f1', endedAt: at(2026, 9, 23) })]),
      }),
    );

    expect(totals.checkIns).toBe(2);
    expect(totals.tasksCompleted).toBe(1);
    // 09-23 一天同时有打卡、完成、专注 → 只算一天
    expect(totals.activeDays).toBe(2);
  });
});

describe('selectMilestones / selectIdentityTags（接线）', () => {
  it('里程碑跟着累计量走，且每一档都在结果里', () => {
    const logs = Array.from({ length: 12 }, (_, i) =>
      log('h1', `2026-09-${String(i + 1).padStart(2, '0')}`),
    );

    const milestones = selectMilestones(input({ habitLogs: byId(logs) }));

    expect(milestones.find((m) => m.id === 'checkIns:10')?.reached).toBe(true);
    expect(milestones.find((m) => m.id === 'checkIns:50')?.reached).toBe(false);
    expect(milestones).toHaveLength(17);
  });

  it('身份标签的"当前连续"取自习惯，而不是历史最长', () => {
    // 连续 3 天（截到今天），但很久以前还有一段 10 天 —— 不该被算进来
    const logs = [
      log('h1', '2025-01-01'),
      ...Array.from({ length: 9 }, (_, i) => log('h1', `2025-01-${String(i + 2).padStart(2, '0')}`)),
      log('h1', '2026-09-22'),
      log('h1', '2026-09-23'),
      log('h1', '2026-09-24'),
    ];

    const tags = selectIdentityTags(
      input({ habits: byId([habit()]), habitLogs: byId(logs) }),
      NOW,
    );

    // 30 天连续远未到达，而"活跃天数"也不够 7 天里那些老日期只有 10 天…
    // 这里断言的是**没有**因为历史那段 10 天而误判成连续 —— 见下一个断言。
    expect(tags.find((t) => t.id === 'streak-thirty')?.reached).toBe(false);
    expect(tags.find((t) => t.id === 'streak-thirty')?.value).toBe(3);
  });
});

describe('selectYearActivity（接线）', () => {
  it('格子数等于天数，最后一格是今天', () => {
    const year = selectYearActivity(input(), NOW, 30);
    expect(year).toHaveLength(30);
    expect(year.at(-1)?.date).toBe(TODAY);
  });

  it('打卡 / 完成任务 / 工作段专注都会点亮，休息不会', () => {
    const year = selectYearActivity(
      input({
        habitLogs: byId([log('h1', '2026-09-24')]),
        tasks: byId([task({ id: 't1', completedAt: at(2026, 9, 24, 9) })]),
        focusSessions: byId([
          session({ id: 'f1', endedAt: at(2026, 9, 24, 14) }),
          // 休息不算 —— 它与今日进度、累计专注使用同一条判据
          session({ id: 'f2', kind: 'shortBreak', endedAt: at(2026, 9, 24, 15) }),
          session({ id: 'f3', endedAt: at(2026, 9, 23, 14), deletedAt: 1 }),
        ]),
      }),
      NOW,
      30,
    );

    const today = year.at(-1);
    // 打卡 + 完成任务 + 一轮工作段专注 = 3
    expect(today?.count).toBe(3);
    expect(today?.level).toBe(3);
  });
});

describe('buildShareSummary', () => {
  it('带上窗口与三块数字，且不含任何标识符', () => {
    const review = selectWeeklyReview(
      input({ habitLogs: byId([log('h1', '2026-09-23')]) }),
      NOW,
    );
    const totals = selectTotals(input({ habitLogs: byId([log('h1', '2026-09-23')]) }));

    // 🔴 摘要**跟着语言走**（它会进剪贴板、离开界面），所以显式传 zh 的 `t` ——
    // 这也是它在组件里收 `t` 参数而不是自己读 hook 的原因。
    const out = buildShareSummary(review, totals, (key, vars) => translate('zh-CN', key, vars));

    expect(out).toContain('本周小结（2026-09-21 至 2026-09-27）');
    expect(out).toContain('打卡 1 次');
    expect(out).toContain('累计：打卡 1 次');
    // 纯文本，且不夹带设备 / 账号痕迹
    expect(out).not.toMatch(/@|clientId|设备/);
  });
});

describe('习惯的连续天数与韧性同源', () => {
  it('冻结吸收了一天的中断：韧性连续 > 日历连续，且两个数字都在', () => {
    useHabitStore.setState({
      habits: [habit()],
      logs: [
        log('h1', '2026-09-01'),
        log('h1', '2026-09-02'),
        log('h1', '2026-09-03'),
        log('h1', '2026-09-04'),
        log('h1', '2026-09-05'),
        log('h1', '2026-09-06'),
        log('h1', '2026-09-07'),
        // 09-08 漏了 —— 由冻结吸收
      ],
    });

    const [p] = selectHabitProgress(useHabitStore.getState(), at(2026, 9, 9));
    expect(p).toBeDefined();

    // 🔴 日历口径上它**确实断了**：`computeStreak` 的 `isStillAlive` 在
    // "昨天漏了"时会把 current 直接归零。这个 0 不是 bug，是"昨天没打"的事实。
    expect(p!.streak.current).toBe(0);
    // 算上冻结之后仍然连着 —— 这正是冻结存在的意义
    expect(p!.resilience.resilience.current).toBe(7);
    // 而"这段连续里有几天是冻结保住的"必须是**数出来的**，不是两个数相减：
    // 7 − 0 会得到 7，而实际只保住了 1 天。
    expect(p!.resilience.resilience.frozenInCurrentRun).toBe(1);
    expect(p!.resilience.resilience.frozenDays).toBe(1);
    // 累计只增不减
    expect(p!.resilience.resilience.total).toBe(7);
  });

  it('昨天漏了且补上能接回去时给出续接机会', () => {
    useHabitStore.setState({
      habits: [habit()],
      logs: [
        log('h1', '2026-09-20'),
        log('h1', '2026-09-21'),
        log('h1', '2026-09-22'),
        // 昨天（09-23）漏了
      ],
    });

    const [p] = selectHabitProgress(useHabitStore.getState(), NOW);

    expect(p!.resilience.repair).toEqual({ date: '2026-09-23', streakIfRepaired: 4 });
    expect(p!.resilience.freshStart).toBeUndefined();
  });

  it('中断超过一周时改为提供重新开始，并保留最长与累计', () => {
    useHabitStore.setState({
      habits: [habit()],
      logs: [
        log('h1', '2026-09-01'),
        log('h1', '2026-09-02'),
        log('h1', '2026-09-03'),
      ],
    });

    const [p] = selectHabitProgress(useHabitStore.getState(), NOW);

    expect(p!.resilience.repair).toBeUndefined();
    expect(p!.resilience.freshStart).toEqual({ daysSinceLast: 21, longest: 3, total: 3 });
  });
});