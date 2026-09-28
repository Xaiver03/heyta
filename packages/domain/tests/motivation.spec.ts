/**
 * 激励与成长体系（今日进度 / 累计里程碑 / 周复盘 / 身份标签）测试
 * ==================================================================
 *
 * 这四块共享同一类风险：**口径漂移**。同一个数字在"今日进度条"
 * 与"周复盘"里算得不一样，界面上就会出现两个都对不上账的真相。
 * 所以这里除了各自的正例，还专门钉住跨模块一致的口径：
 *   - 只有**工作段**专注算专注（休息不算）
 *   - 只有**未删除**的记录算数（撤销 = 没发生）
 *   - "达成"用目标值判定，不是"打过卡就算"
 */

import { describe, expect, it } from 'vitest';

import type { FocusSession, Habit, HabitLog, Task } from '../src/entities.js';
import { computeActivityTotals, deriveMilestones } from '../src/milestones.js';
import { computeTodayProgress, isTaskPlannedForToday } from '../src/today-progress.js';
import { computeWeeklyReview, weekWindowOf } from '../src/weekly-review.js';
import { deriveIdentityTags, reachedIdentityTagIds } from '../src/identity-tags.js';

/** 本地时刻 → 时间戳。不要用 `Date.UTC`，否则测试会依赖运行机器时区。 */
function local(y: number, m: number, d: number, h = 12, min = 0): number {
  return new Date(y, m - 1, d, h, min, 0, 0).getTime();
}

function habit(over: Partial<Habit> = {}): Habit {
  return { id: 'h1', name: '喝水', target: 1, createdAt: 0, updatedAt: 0, ...over };
}

function log(date: string, over: Partial<HabitLog> = {}): HabitLog {
  return { id: `h1:${date}`, habitId: 'h1', date, createdAt: 0, updatedAt: 0, ...over };
}

function task(over: Partial<Task> = {}): Task {
  return { id: 't1', title: '写周报', createdAt: 0, updatedAt: 0, ...over };
}

function focus(over: Partial<FocusSession> = {}): FocusSession {
  // ⚠️ 默认落在 `TODAY`（本地时刻）—— `focusSessionDay` 取的是
  // `endedAt ?? createdAt`，默认时间戳为 0 会让记录落到 1970-01-01，
  // 于是"今天的专注"永远是 0，而测试会看起来像统计逻辑坏了。
  return {
    id: 'f1',
    kind: 'work',
    plannedMs: 25 * 60000,
    actualMs: 25 * 60000,
    createdAt: local(2026, 9, 24, 12),
    endedAt: local(2026, 9, 24, 12),
    updatedAt: 0,
    ...over,
  };
}

describe('computeTodayProgress', () => {
  const TODAY = '2026-09-24'; // 周四

  it('空的一天：没有计划也没有完成，不算闭环', () => {
    const p = computeTodayProgress({
      habits: [],
      logs: [],
      tasks: [],
      focusSessions: [],
      today: TODAY,
    });
    expect(p.total).toBe(0);
    expect(p.done).toBe(0);
    expect(p.ratio).toBe(0);
    expect(p.closed).toBe(false);
  });

  it('今天该做的习惯与到期任务都算进计划量', () => {
    const p = computeTodayProgress({
      habits: [habit()],
      logs: [log(TODAY)],
      tasks: [
        task({ id: 't1', dueDate: local(2026, 9, 24, 18) }), // 今天到期
        task({ id: 't2', dueDate: local(2026, 9, 22, 18) }), // 已逾期
      ],
      focusSessions: [],
      today: TODAY,
    });
    expect(p.habitsPlanned).toBe(1);
    expect(p.habitsDone).toBe(1);
    expect(p.tasksPlanned).toBe(2);
    expect(p.tasksDone).toBe(0);
    expect(p.total).toBe(3);
    expect(p.done).toBe(1);
    expect(p.closed).toBe(false);
  });

  it('已完成的任务不再算进"今天该做的"', () => {
    const p = computeTodayProgress({
      habits: [],
      logs: [],
      tasks: [
        // 昨天就完成了，虽然截止日是今天
        task({ id: 't1', dueDate: local(2026, 9, 24, 18), completedAt: local(2026, 9, 23, 9) }),
      ],
      focusSessions: [],
      today: TODAY,
    });
    expect(p.tasksPlanned).toBe(0);
    expect(p.tasksDone).toBe(0);
  });

  it('计划外完成的事也计入完成量（顺手的成果必须被看见）', () => {
    const p = computeTodayProgress({
      habits: [],
      logs: [],
      tasks: [task({ id: 't9', completedAt: local(2026, 9, 24, 10) })], // 无截止日
      focusSessions: [],
      today: TODAY,
    });
    expect(p.total).toBe(0);
    expect(p.tasksDone).toBe(1);
    expect(p.bonus).toBe(1);
    expect(p.done).toBe(1);
    // 没有计划却做了一件事 —— 那是 100%，不是 0%
    expect(p.ratio).toBe(1);
    expect(p.closed).toBe(true);
  });

  it('进度封顶在 1，不会因为超额完成而溢出', () => {
    const p = computeTodayProgress({
      habits: [],
      logs: [],
      tasks: [
        task({ id: 't1', dueDate: local(2026, 9, 24, 18) }),
        task({ id: 't2', completedAt: local(2026, 9, 24, 9) }),
        task({ id: 't3', completedAt: local(2026, 9, 24, 10) }),
        task({ id: 't4', completedAt: local(2026, 9, 24, 11) }),
      ],
      focusSessions: [],
      today: TODAY,
    });
    expect(p.done).toBe(3);
    // 其中 3 件都算计划外（t1 到期未完成，仍在计划里）
    expect(p.bonus).toBe(3);
    expect(p.ratio).toBe(1);
    expect(p.closed).toBe(true);
  });

  it('打卡但没到目标值不算今天完成（与连续天数同口径）', () => {
    const p = computeTodayProgress({
      habits: [habit({ target: 8, unit: '杯' })],
      logs: [log(TODAY, { value: 3 })],
      tasks: [],
      focusSessions: [],
      today: TODAY,
    });
    expect(p.habitsPlanned).toBe(1);
    expect(p.habitsDone).toBe(0);
  });

  it('今天不用打卡的习惯不进计划量（每周一次的习惯不该天天压着人）', () => {
    const p = computeTodayProgress({
      habits: [habit({ frequency: { type: 'weekly', daysOfWeek: [1] } })],
      logs: [],
      tasks: [],
      focusSessions: [],
      today: TODAY, // 周四
    });
    expect(p.habitsPlanned).toBe(0);
  });

  it('专注分钟只算工作段，休息不算', () => {
    const p = computeTodayProgress({
      habits: [],
      logs: [],
      tasks: [],
      focusSessions: [
        focus({ id: 'f1', kind: 'work', actualMs: 25 * 60000 }),
        focus({ id: 'f2', kind: 'shortBreak', actualMs: 5 * 60000 }),
      ],
      today: TODAY,
    });
    expect(p.focusMinutes).toBe(25);
  });

  it('跨零点的那一轮算在**结束**的那天', () => {
    const p = computeTodayProgress({
      habits: [],
      logs: [],
      tasks: [],
      focusSessions: [
        focus({ id: 'f1', startedAt: local(2026, 9, 23, 23, 50), endedAt: local(2026, 9, 24, 0, 15) }),
      ],
      today: TODAY,
    });
    expect(p.focusMinutes).toBe(25);
  });

  it('软删除的专注记录不计入（撤销就是没发生）', () => {
    const p = computeTodayProgress({
      habits: [],
      logs: [],
      tasks: [],
      focusSessions: [focus({ id: 'f1', deletedAt: 1 })],
      today: TODAY,
    });
    expect(p.focusMinutes).toBe(0);
  });
});

describe('isTaskPlannedForToday —— 单一判据（小组件与今日进度必须同源）', () => {
  const TODAY = '2026-09-24'; // 周四
  const YESTERDAY = '2026-09-23';

  it('今天到期 → 是', () => {
    expect(isTaskPlannedForToday(task({ dueDate: local(2026, 9, 24) }), TODAY)).toBe(true);
  });

  it('已逾期 → 是（"今天该做的"在用户心里包含逾期未完成的）', () => {
    expect(isTaskPlannedForToday(task({ dueDate: local(2026, 9, 20) }), TODAY)).toBe(true);
  });

  it('明天到期 → 否', () => {
    expect(isTaskPlannedForToday(task({ dueDate: local(2026, 9, 25) }), TODAY)).toBe(false);
  });

  it('没有截止日 → 否', () => {
    expect(isTaskPlannedForToday(task(), TODAY)).toBe(false);
  });

  it('今天完成 → 仍是（已完成也要占今天的位置，界面上才看得到进度）', () => {
    expect(
      isTaskPlannedForToday(
        task({ dueDate: local(2026, 9, 24), completedAt: local(2026, 9, 24, 15) }),
        TODAY,
      ),
    ).toBe(true);
  });

  it('🔴 今天之前就完成 → 否，即使截止日就是今天', () => {
    // 昨天做完的任务不该再占今天的位置。这一条把 completedAt 与 dueDate 解耦，
    // 是最容易在别处被漏掉的分支。
    expect(
      isTaskPlannedForToday(
        task({ dueDate: local(2026, 9, 24), completedAt: local(2026, 9, 23, 20) }),
        TODAY,
      ),
    ).toBe(false);
  });

  it('已删除 → 否（即使到期且未完成）', () => {
    expect(
      isTaskPlannedForToday(task({ dueDate: local(2026, 9, 24), deletedAt: 1 }), TODAY),
    ).toBe(false);
  });

  it('🔴 与 computeTodayProgress 的 tasksPlanned 逐一等价（防回退）', () => {
    // ─────────────────────────────────────────────────────────────
    // 这条测试的全部价值在于**将来会有人把判据重新内联回 computeTodayProgress**。
    // 那一刻它不会报错、不会崩、界面上也看不出问题 ——
    // 只会让"今日进度说 5 件"与"小组件列了 4 件"同时存在，而两边都不报错。
    //
    // 今天它必然通过（两边调的是同一个函数）。但它**能**失败 ——
    // 只要有人把那份判据fork 出去，它立刻红。这正是 §5 要的那种检查。
    // ─────────────────────────────────────────────────────────────
    const Y = (d: number) => local(2026, 9, d);
    const corpus: Task[] = [
      task({ id: 'a', dueDate: Y(24) }),                                 // 今天到期
      task({ id: 'b', dueDate: Y(20) }),                                 // 逾期
      task({ id: 'c', dueDate: Y(25) }),                                 // 明天
      task({ id: 'd' }),                                                 // 无截止日
      task({ id: 'e', dueDate: Y(24), completedAt: local(2026, 9, 24, 9) }),  // 今天完成
      task({ id: 'f', dueDate: Y(24), completedAt: local(2026, 9, 23, 9) }),  // 昨天完成
      task({ id: 'g', dueDate: Y(24), deletedAt: 1 }),                   // 已删除
      task({ id: 'h', dueDate: Y(24), purgedAt: 1, deletedAt: 1 }),      // 已彻底删除
      task({ id: 'i', completedAt: local(2026, 9, 24, 9) }),             // 计划外今天完成
    ];

    const byPredicate = corpus.filter((t) => isTaskPlannedForToday(t, TODAY)).length;
    const p = computeTodayProgress({ habits: [], logs: [], tasks: corpus, focusSessions: [], today: TODAY });

    expect(p.tasksPlanned).toBe(byPredicate);
    // 独立定值，防止"两边一起错"：今天到期 a、逾期 b、今天完成的 e、昨天完成的 f 不算、
    // 删除的 g/h 不算、明天的 c 不算、无截止日 d 不算。→ 3 件
    expect(p.tasksPlanned).toBe(3);
    // `tasksDone` 的口径更宽：含计划外（i）→ a? 否。e + i = 2
    expect(p.tasksDone).toBe(2);
  });

  it('昨天的日期参数不影响判据（同一批任务换"今天"就换结果）', () => {
    const t = task({ dueDate: local(2026, 9, 24) });
    expect(isTaskPlannedForToday(t, TODAY)).toBe(true);
    // 站在昨天看，"明天到期"的任务不算今天该做
    expect(isTaskPlannedForToday(t, YESTERDAY)).toBe(false);
  });
});

describe('computeActivityTotals', () => {
  it('按维度累计，并统计有活动的不同天数', () => {
    const totals = computeActivityTotals({
      logs: [log('2026-09-01'), log('2026-09-02')],
      tasks: [
        task({ id: 't1', completedAt: local(2026, 9, 2, 10) }),
        task({ id: 't2', completedAt: local(2026, 9, 3, 10) }),
        task({ id: 't3' }),
      ],
      focusSessions: [
        focus({ id: 'f1', endedAt: local(2026, 9, 3, 11), actualMs: 30 * 60000 }),
        focus({ id: 'f2', kind: 'longBreak', endedAt: local(2026, 9, 4, 11) }),
      ],
    });
    expect(totals.checkIns).toBe(2);
    expect(totals.tasksCompleted).toBe(2);
    // 休息不算专注时长
    expect(totals.focusMs).toBe(30 * 60000);
    // 09-01 / 09-02 / 09-03 三天（09-04 只有休息）
    expect(totals.activeDays).toBe(3);
  });

  it('已删除的记录一律不计入', () => {
    const totals = computeActivityTotals({
      logs: [{ ...log('2026-09-01'), deletedAt: 1 }],
      tasks: [task({ id: 't1', completedAt: local(2026, 9, 1, 10), deletedAt: 1 })],
      focusSessions: [],
    });
    expect(totals).toEqual({ checkIns: 0, focusMs: 0, tasksCompleted: 0, activeDays: 0 });
  });
});

describe('deriveMilestones', () => {
  it('未达标时给"到这一档"的进度，已达标时给"到下一档"的进度', () => {
    const milestones = deriveMilestones({
      checkIns: 25,
      focusMs: 0,
      tasksCompleted: 0,
      activeDays: 0,
    });
    const ten = milestones.find((m) => m.id === 'checkIns:10')!;
    const fifty = milestones.find((m) => m.id === 'checkIns:50')!;

    expect(ten.reached).toBe(true);
    // 已达 10：进度改为靠近下一档 50（25/50）
    expect(ten.ratio).toBeCloseTo(0.5, 5);

    expect(fifty.reached).toBe(false);
    // 未达 50：进度是 25/50
    expect(fifty.ratio).toBeCloseTo(0.5, 5);
  });

  it('最高档达成后进度封顶，不再造出假目标', () => {
    const milestones = deriveMilestones({
      checkIns: 99999,
      focusMs: 0,
      tasksCompleted: 0,
      activeDays: 0,
    });
    const top = milestones.find((m) => m.id === 'checkIns:1000')!;
    expect(top.reached).toBe(true);
    expect(top.ratio).toBe(1);
  });

  it('专注小时数向下取整（没满一小时不能说成满）', () => {
    const milestones = deriveMilestones({
      checkIns: 0,
      focusMs: 9.9 * 60 * 60 * 1000,
      tasksCompleted: 0,
      activeDays: 0,
    });
    expect(milestones[0]!.kind).toBe('checkIns');
    const focusTen = milestones.find((m) => m.id === 'focusHours:10')!;
    expect(focusTen.value).toBe(9);
    expect(focusTen.reached).toBe(false);
  });

  it('每个维度的每一档都在结果里（界面需要"下一档还差多少"）', () => {
    const milestones = deriveMilestones({
      checkIns: 0,
      focusMs: 0,
      tasksCompleted: 0,
      activeDays: 0,
    });
    // 5 + 4 + 4 + 4
    expect(milestones).toHaveLength(17);
    expect(milestones.every((m) => !m.reached && m.ratio === 0)).toBe(true);
  });
});

describe('weekWindowOf', () => {
  it('一周从周一开始（2026-09-24 是周四）', () => {
    expect(weekWindowOf('2026-09-24')).toEqual({ start: '2026-09-21', end: '2026-09-27' });
  });

  it('周日属于这一周的最后一天，而不是下一周的第一天', () => {
    expect(weekWindowOf('2026-09-27')).toEqual({ start: '2026-09-21', end: '2026-09-27' });
  });
});

describe('computeWeeklyReview', () => {
  it('统计本周三个维度，并算出与上周的差', () => {
    const review = computeWeeklyReview({
      logs: [
        log('2026-09-21'),
        log('2026-09-22'),
        // 上周
        log('2026-09-14'),
      ],
      tasks: [
        task({ id: 't1', completedAt: local(2026, 9, 22, 10), projectId: 'p1' }),
        task({ id: 't2', completedAt: local(2026, 9, 23, 10), projectId: 'p1' }),
        task({ id: 't3', completedAt: local(2026, 9, 24, 10), projectId: 'p2' }),
        task({ id: 't4', completedAt: local(2026, 9, 15, 10) }),
      ],
      focusSessions: [
        focus({ id: 'f1', endedAt: local(2026, 9, 22, 11), actualMs: 50 * 60000 }),
        focus({ id: 'f2', endedAt: local(2026, 9, 23, 11), actualMs: 70 * 60000 }),
      ],
      today: '2026-09-24',
    });

    expect(review.weekStart).toBe('2026-09-21');
    expect(review.weekEnd).toBe('2026-09-27');
    expect(review.checkIns).toBe(2);
    expect(review.tasksCompleted).toBe(3);
    expect(review.focusMinutes).toBe(120);

    // 上周：1 次打卡 / 1 件任务 / 0 分钟
    expect(review.previous).toEqual({ checkIns: 1, tasksCompleted: 1, focusMinutes: 0 });
    expect(review.deltas).toEqual({ checkIns: 1, tasksCompleted: 2, focusMinutes: 120 });

    expect(review.bestFocusDay).toEqual({ date: '2026-09-23', minutes: 70 });
    expect(review.topProjectId).toBe('p1');
  });

  it('主标题由数据自己决定：专注最多的那周不会被告知"没有产出"', () => {
    const review = computeWeeklyReview({
      logs: [],
      tasks: [],
      focusSessions: [focus({ id: 'f1', endedAt: local(2026, 9, 22, 11), actualMs: 90 * 60000 })],
      today: '2026-09-24',
    });
    expect(review.headline).toBe('focusMinutes');
  });

  it('一周什么都没有时 headline 为 none，而不是随便挑一个维度', () => {
    const review = computeWeeklyReview({
      logs: [],
      tasks: [],
      focusSessions: [],
      today: '2026-09-24',
    });
    expect(review.headline).toBe('none');
    expect(review.bestFocusDay).toBeUndefined();
    expect(review.topProjectId).toBeUndefined();
  });

  it('上周的数字可以是负数差（比上周少也要如实说）', () => {
    const review = computeWeeklyReview({
      logs: [log('2026-09-15'), log('2026-09-16')],
      tasks: [],
      focusSessions: [],
      today: '2026-09-24',
    });
    expect(review.checkIns).toBe(0);
    expect(review.deltas.checkIns).toBe(-2);
  });
});

describe('deriveIdentityTags', () => {
  it('按累计量给身份，未达标时给进度', () => {
    const tags = deriveIdentityTags({
      totals: { checkIns: 100, focusMs: 60 * 60 * 1000, tasksCompleted: 0, activeDays: 30 },
      bestCurrentStreak: 5,
    });

    const byId = new Map(tags.map((t) => [t.id, t]));
    expect(byId.get('started')!.reached).toBe(true);
    expect(byId.get('routine')!.reached).toBe(true);
    expect(byId.get('steady')!.reached).toBe(false);
    expect(byId.get('checkin-hundred')!.reached).toBe(true);
    expect(byId.get('deep-fifty')!.reached).toBe(false);
    expect(byId.get('deep-fifty')!.ratio).toBeCloseTo(1 / 50, 5);
    expect(byId.get('streak-thirty')!.reached).toBe(false);
  });

  it('当前连续天数可以单独支撑一个身份标签', () => {
    const ids = reachedIdentityTagIds({
      totals: { checkIns: 0, focusMs: 0, tasksCompleted: 0, activeDays: 0 },
      bestCurrentStreak: 30,
    });
    expect(ids).toEqual(['streak-thirty']);
  });

  it('什么都没有时一个身份都不给', () => {
    const ids = reachedIdentityTagIds({
      totals: { checkIns: 0, focusMs: 0, tasksCompleted: 0, activeDays: 0 },
      bestCurrentStreak: 0,
    });
    expect(ids).toEqual([]);
  });
});