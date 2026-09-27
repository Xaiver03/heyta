/**
 * 活动分类与分类时长归因测试
 * ============================
 *
 * 这一层最容易出的不是崩溃，而是**口径与别处对不上**：
 * 同一个番茄钟在「今日进度」「周复盘」「分类统计」里算出三个不同的分钟数，
 * 界面上就是三个互相矛盾的真相，而且没有任何一处报错。
 *
 * 所以这里除了各自的正确性，还专门钉住：
 *   - 只有 **work** 段算专注（与 `focus.ts` 一致）
 *   - 落在哪一天看 **结束时刻**（与 `focusSessionDay` 一致）
 *   - **软删除**的实体不算数（与 `milestones.ts` 一致）
 *   - `actualMs` 缺省**不当 0**，退到 `plannedMs`（与 `focusStatsForDay` 一致）
 *   - `weeklyMs` 的长度**永远等于** `weeks.length`（错位会看起来像"这周没做"）
 *   - 排序**确定性**：同一个输入两次算出的顺序逐项相同
 */

import { describe, expect, it } from 'vitest';

import type { FocusSession, Habit, HabitLog, Project, Task } from '../src/entities.js';
import {
  CATEGORY_SLOTS,
  DEFAULT_CATEGORY_WEEKS,
  computeCategoryReport,
  habitLogMinutes,
  intensityLevel,
  isMinuteUnit,
  parseCategorySlot,
  weekStartOf,
} from '../src/activity-categories.js';

/** 本地时刻 → 时间戳。不要用 `Date.UTC`，否则测试会依赖运行机器时区。 */
function local(y: number, m: number, d: number, h = 12, min = 0): number {
  return new Date(y, m - 1, d, h, min, 0, 0).getTime();
}

/**
 * 窗口末日（= 本周四）。2026-09-24 是周四，所以本周从 09-21（周一）开始。
 * 用固定时刻而不是 `Date.now()`：窗口一旦随"今天"漂移，
 * 断言就会在某些日子红、某些日子绿。
 */
const NOW = local(2026, 9, 24, 20, 0);
const THIS_WEEK_START = '2026-09-21';
const LAST_WEEK_START = '2026-09-14';

function project(over: Partial<Project> = {}): Project {
  return { id: 'p1', name: '深度工作', createdAt: 0, updatedAt: 0, ...over };
}

function task(over: Partial<Task> = {}): Task {
  return { id: 't1', title: '写方案', createdAt: 0, updatedAt: 0, ...over };
}

function habit(over: Partial<Habit> = {}): Habit {
  return { id: 'h1', name: '跑步', target: 30, unit: '分钟', createdAt: 0, updatedAt: 0, ...over };
}

function log(date: string, over: Partial<HabitLog> = {}): HabitLog {
  return { id: `h1:${date}`, habitId: 'h1', date, createdAt: 0, updatedAt: 0, ...over };
}

function focus(over: Partial<FocusSession> = {}): FocusSession {
  return {
    id: 'fs1',
    kind: 'work',
    plannedMs: 25 * 60_000,
    actualMs: 25 * 60_000,
    completed: true,
    endedAt: local(2026, 9, 22, 10, 0),
    createdAt: local(2026, 9, 22, 10, 0),
    updatedAt: 0,
    ...over,
  };
}

function report(over: Partial<Parameters<typeof computeCategoryReport>[0]> = {}) {
  return computeCategoryReport({
    projects: [project()],
    tasks: [task({ projectId: 'p1' })],
    habits: [],
    habitLogs: [],
    focusSessions: [],
    now: NOW,
    ...over,
  });
}

describe('色槽位：只认不变量', () => {
  it('接受裸槽位号（数字与字符串两种写入方）', () => {
    for (const slot of CATEGORY_SLOTS) {
      expect(parseCategorySlot(slot)).toBe(slot);
      expect(parseCategorySlot(String(slot))).toBe(slot);
    }
  });

  it('🔴 不认识的值当作"没有颜色"，不是回退到 1 号槽位', () => {
    // 回退到 1 号会把一堆互不相关的活动悄悄变成同一个颜色 —— 那比无色糟得多。
    for (const raw of ['#dc2626', 'red', '03', '9', '0', '', '  ', 'category-1', null, undefined, {}]) {
      expect(parseCategorySlot(raw), `不该认识 ${JSON.stringify(raw)}`).toBeUndefined();
    }
  });

  it('两端的空白不算错（手改数据里的 `" 3 "` 仍然认得）', () => {
    expect(parseCategorySlot(' 3 ')).toBe(3);
  });
});

describe('习惯时长：单位必须真的是分钟', () => {
  it('认得出常见写法，且大小写无关', () => {
    for (const unit of ['分钟', '分', 'min', 'MINS', 'Minute', 'minutes']) {
      expect(isMinuteUnit(unit), unit).toBe(true);
    }
  });

  it('🔴 不认识的单位不贡献时长（不猜换算）', () => {
    for (const unit of ['杯', '页', '次', '小时', 'km', '', undefined]) {
      expect(isMinuteUnit(unit), String(unit)).toBe(false);
      expect(habitLogMinutes(habit({ unit }), log('2026-09-22'))).toBeUndefined();
    }
  });

  it('没填 value 时退到 target，不当 0', () => {
    expect(habitLogMinutes(habit({ target: 30 }), log('2026-09-22'))).toBe(30);
    expect(habitLogMinutes(habit({ target: 30 }), log('2026-09-22', { value: 45 }))).toBe(45);
  });

  it('value 与 target 都没有 → 没有时长（不是 0 分钟的一条记录）', () => {
    expect(habitLogMinutes(habit({ target: undefined }), log('2026-09-22'))).toBeUndefined();
  });
});

describe('归因链', () => {
  it('专注经任务归到清单', () => {
    const r = report({
      projects: [project({ id: 'p1', name: '深度工作', color: '1' })],
      tasks: [task({ id: 't1', projectId: 'p1' })],
      focusSessions: [focus({ taskId: 't1', actualMs: 50 * 60_000 })],
    });
    expect(r.series).toHaveLength(1);
    expect(r.series[0]?.key).toBe('project:p1');
    expect(r.series[0]?.name).toBe('深度工作');
    expect(r.series[0]?.slot).toBe(1);
    expect(r.series[0]?.focusMs).toBe(50 * 60_000);
    expect(r.series[0]?.habitMs).toBe(0);
    expect(r.totalMs).toBe(50 * 60_000);
    expect(r.unassignedMs).toBe(0);
  });

  it('习惯按分钟归到自己', () => {
    const r = report({
      projects: [],
      tasks: [],
      habits: [habit({ id: 'h1', name: '跑步', color: '3', target: 30, unit: '分钟' })],
      habitLogs: [log('2026-09-22'), log('2026-09-23')],
    });
    expect(r.series).toHaveLength(1);
    expect(r.series[0]?.key).toBe('habit:h1');
    expect(r.series[0]?.slot).toBe(3);
    expect(r.series[0]?.habitMs).toBe(60 * 60_000);
    expect(r.series[0]?.focusMs).toBe(0);
  });

  it('🔴 归不了的记进 unassignedMs，不塞进某个分类、也不假装不存在', () => {
    const r = report({
      focusSessions: [
        focus({ id: 'a', taskId: undefined, actualMs: 10 * 60_000 }), // 纯计时
        focus({ id: 'b', taskId: 't1', actualMs: 20 * 60_000 }),
      ],
      tasks: [task({ id: 't1', projectId: undefined })], // 不属于任何清单
    });
    expect(r.series).toHaveLength(0);
    expect(r.unassignedMs).toBe(30 * 60_000);
    expect(r.totalMs).toBe(0);
  });

  it('清单存在但没设过色 → 这一行照样在，只是 slot 为 undefined', () => {
    const r = report({ focusSessions: [focus({ taskId: 't1' })] });
    expect(r.series[0]?.slot).toBeUndefined();
    expect(r.series[0]?.totalMs).toBe(25 * 60_000);
  });

  it('🔴 清单的 color 是脏值 → 无色，但时长一分不丢', () => {
    const r = report({
      projects: [project({ color: '#dc2626' })],
      focusSessions: [focus({ taskId: 't1' })],
    });
    expect(r.series[0]?.slot).toBeUndefined();
    expect(r.series[0]?.totalMs).toBe(25 * 60_000);
  });
});

describe('口径与既有模块对齐', () => {
  it('🔴 休息段不算（与 focus.ts 同口径，休息不是专注成果）', () => {
    const r = report({
      focusSessions: [focus({ kind: 'shortBreak', taskId: 't1' })],
    });
    expect(r.totalMs).toBe(0);
    expect(r.unassignedMs).toBe(0);
  });

  it('🔴 跨零点的那一轮算在**结束**那一天（与 focusSessionDay 一致）', () => {
    // 周日 23:50 开始、周一 00:15 结束 → 算本周，不算上一周。
    const r = report({
      focusSessions: [
        focus({
          taskId: 't1',
          startedAt: local(2026, 9, 20, 23, 50),
          endedAt: local(2026, 9, 21, 0, 15),
          createdAt: local(2026, 9, 20, 23, 50),
        }),
      ],
    });
    const thisWeek = r.weeks.findIndex((w) => w.start === THIS_WEEK_START);
    expect(r.series[0]?.weeklyMs[thisWeek]).toBe(25 * 60_000);
  });

  it('🔴 actualMs 缺省时退到 plannedMs，不当 0', () => {
    const r = report({
      focusSessions: [focus({ taskId: 't1', actualMs: undefined, plannedMs: 25 * 60_000 })],
    });
    expect(r.totalMs).toBe(25 * 60_000);
  });

  it('🔴 软删除的清单 / 任务 / 习惯 / 打卡都不算数', () => {
    const r = report({
      projects: [project({ deletedAt: 1 })],
      tasks: [task({ projectId: 'p1' })],
      focusSessions: [focus({ taskId: 't1' })],
      habits: [habit({ deletedAt: 1 })],
      habitLogs: [log('2026-09-22')],
    });
    expect(r.series).toHaveLength(0);
    // 清单被删了 → 那条专注归不了类，如实进 unassigned（不是凭空消失）。
    expect(r.unassignedMs).toBe(25 * 60_000);
  });
});

describe('窗口与格子对齐', () => {
  it('默认 12 周，最后一格是本周', () => {
    const r = report();
    expect(r.weeks).toHaveLength(DEFAULT_CATEGORY_WEEKS);
    expect(r.weeks.at(-1)?.start).toBe(THIS_WEEK_START);
    expect(r.weeks.at(-1)?.end).toBe('2026-09-27');
    // 每周恰好 7 天，且首尾相接（错一天就会让整张图整体偏移）。
    for (let i = 1; i < r.weeks.length; i += 1) {
      const prev = r.weeks[i - 1];
      const cur = r.weeks[i];
      expect(prev?.end).toBeDefined();
      expect(cur?.start).toBeDefined();
      expect(weekStartOf(cur!.start)).toBe(cur!.start);
      expect(prev!.end < cur!.start).toBe(true);
    }
  });

  it('🔴 weeklyMs 的长度永远等于 weeks.length（短数组会让格子与周标签错位）', () => {
    const r = report({
      focusSessions: [focus({ taskId: 't1' })],
      habitLogs: [log('2026-09-22')],
      habits: [habit()],
      weeks: 3,
    });
    expect(r.weeks).toHaveLength(3);
    for (const row of r.series) {
      expect(row.weeklyMs).toHaveLength(3);
    }
  });

  it('本周与上一周落在不同的格子，且周合计对得上', () => {
    const r = report({
      focusSessions: [
        focus({ id: 'a', taskId: 't1', endedAt: local(2026, 9, 22, 10, 0), actualMs: 30 * 60_000 }),
        focus({ id: 'b', taskId: 't1', endedAt: local(2026, 9, 15, 10, 0), actualMs: 60 * 60_000 }),
      ],
    });
    const row = r.series[0]!;
    const thisWeek = r.weeks.findIndex((w) => w.start === THIS_WEEK_START);
    const lastWeek = r.weeks.findIndex((w) => w.start === LAST_WEEK_START);
    expect(row.weeklyMs[thisWeek]).toBe(30 * 60_000);
    expect(row.weeklyMs[lastWeek]).toBe(60 * 60_000);
    expect(r.weeks[thisWeek]?.totalMs).toBe(30 * 60_000);
    expect(r.weeks[lastWeek]?.totalMs).toBe(60 * 60_000);
  });

  it('窗口外的历史不进任何一格（也不进 totalMs）', () => {
    const r = report({
      weeks: 2,
      focusSessions: [focus({ taskId: 't1', endedAt: local(2026, 8, 1, 10, 0) })],
    });
    expect(r.series).toHaveLength(0);
    expect(r.totalMs).toBe(0);
  });

  it('窗口内每一格之和 === totalMs（两处口径必须对得上账）', () => {
    const r = report({
      focusSessions: [
        focus({ id: 'a', taskId: 't1', endedAt: local(2026, 9, 22, 10, 0) }),
        focus({ id: 'b', taskId: 't1', endedAt: local(2026, 9, 15, 10, 0) }),
      ],
    });
    for (const row of r.series) {
      const sum = row.weeklyMs.reduce((a, b) => a + b, 0);
      expect(sum).toBe(row.totalMs);
    }
  });
});

describe('排序与峰值', () => {
  it('按总时长降序，时长相同按 key 升序（确定性）', () => {
    const r = report({
      projects: [
        project({ id: 'p1', name: '甲' }),
        project({ id: 'p2', name: '乙' }),
        project({ id: 'p3', name: '丙' }),
      ],
      tasks: [
        task({ id: 't1', projectId: 'p1' }),
        task({ id: 't2', projectId: 'p2' }),
        task({ id: 't3', projectId: 'p3' }),
      ],
      focusSessions: [
        focus({ id: 'a', taskId: 't2', actualMs: 10 * 60_000 }),
        focus({ id: 'b', taskId: 't1', actualMs: 10 * 60_000 }),
        focus({ id: 'c', taskId: 't3', actualMs: 30 * 60_000 }),
      ],
    });
    expect(r.series.map((s) => s.key)).toEqual(['project:p3', 'project:p1', 'project:p2']);
    // 再算一次，顺序必须逐项相同（不是靠 sort 的稳定性碰巧对）。
    const again = report({
      projects: [
        project({ id: 'p1', name: '甲' }),
        project({ id: 'p2', name: '乙' }),
        project({ id: 'p3', name: '丙' }),
      ],
      tasks: [
        task({ id: 't1', projectId: 'p1' }),
        task({ id: 't2', projectId: 'p2' }),
        task({ id: 't3', projectId: 'p3' }),
      ],
      focusSessions: [
        focus({ id: 'a', taskId: 't2', actualMs: 10 * 60_000 }),
        focus({ id: 'b', taskId: 't1', actualMs: 10 * 60_000 }),
        focus({ id: 'c', taskId: 't3', actualMs: 30 * 60_000 }),
      ],
    });
    expect(again.series.map((s) => s.key)).toEqual(r.series.map((s) => s.key));
  });

  it('🔴 peakWeeklyMs 是**跨行共享**的峰值，不是每行各自的峰值', () => {
    const r = report({
      projects: [project({ id: 'p1' }), project({ id: 'p2' })],
      tasks: [task({ id: 't1', projectId: 'p1' }), task({ id: 't2', projectId: 'p2' })],
      focusSessions: [
        focus({ id: 'a', taskId: 't1', endedAt: local(2026, 9, 22, 10, 0), actualMs: 20 * 60_000 }),
        focus({ id: 'b', taskId: 't2', endedAt: local(2026, 9, 22, 11, 0), actualMs: 5 * 60_000 }),
      ],
    });
    expect(r.peakWeeklyMs).toBe(20 * 60_000);
  });
});

describe('强度分档', () => {
  it('0 表示没记录，与"有一点"必须明显不同', () => {
    expect(intensityLevel(0, 100)).toBe(0);
    expect(intensityLevel(-1, 100)).toBe(0);
    expect(intensityLevel(1, 0)).toBe(0);
  });

  it('四等分边界（含端点）', () => {
    expect(intensityLevel(1, 100)).toBe(1);
    expect(intensityLevel(25, 100)).toBe(1);
    expect(intensityLevel(26, 100)).toBe(2);
    expect(intensityLevel(50, 100)).toBe(2);
    expect(intensityLevel(51, 100)).toBe(3);
    expect(intensityLevel(75, 100)).toBe(3);
    expect(intensityLevel(76, 100)).toBe(4);
    expect(intensityLevel(100, 100)).toBe(4);
  });

  it('超过峰值也不会溢出到第 5 档（永远落在 1..4）', () => {
    expect(intensityLevel(500, 100)).toBe(4);
  });
});
