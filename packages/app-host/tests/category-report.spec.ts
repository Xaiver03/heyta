/**
 * 分类时长：物化状态 → 报告（共享那一段）的测试
 * =============================================
 *
 * 这一层薄，但它薄得**危险** —— 它做的三件事都是"漏一处就静默出错"的类型：
 *
 *   1. 滤墓碑（撤销就是没发生）—— 漏了，删掉的时间会回到统计里；
 *   2. 注入 `now` —— 宿主自己读 `Date.now()` 的话，同一次渲染可能跨午夜；
 *   3. 窗口周数走默认配置 —— 各宿主自己写字面量，改配置时就会漏掉一处。
 *
 * 所以三条各有一个用例，而且每条都**能失败**（不是"调用了就对"）。
 */

import { DEFAULT_CATEGORY_WEEKS, toLocalDate } from '@heyta/domain';
import type { FocusSession, Habit, HabitLog, Project, Task } from '@heyta/domain';
import { describe, expect, it } from 'vitest';

import { aliveRecords, categoryReportFromState, categoryReportFromTables } from '../src/category-report.js';

/** 固定时钟：`now` 一律注入，测试里绝不出现 `Date.now()`。 */
const NOW = new Date(2026, 8, 24, 20, 0).getTime(); // 2026-09-24 周四（本地时区）
const HOUR = 3_600_000;

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: '深度工作',
    createdAt: NOW - HOUR,
    updatedAt: NOW - HOUR,
    ...over,
  };
}

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: '写方案',
    createdAt: NOW - HOUR,
    updatedAt: NOW - HOUR,
    projectId: 'p1',
    ...over,
  };
}

function session(over: Partial<FocusSession> = {}): FocusSession {
  return {
    id: 'f1',
    kind: 'work',
    taskId: 't1',
    plannedMs: 25 * 60 * 1000,
    actualMs: 25 * 60 * 1000,
    completed: true,
    // ⚠️ 至少要有一个「今天」的结束时间，否则记录落在窗口里还是窗口外
    // 就取决于跑测试的那一天 —— 那是一条会随日期变红的断言。
    createdAt: NOW - 30 * 60 * 1000,
    updatedAt: NOW - 5 * 60 * 1000,
    startedAt: NOW - 30 * 60 * 1000,
    endedAt: NOW - 5 * 60 * 1000,
    ...over,
  };
}

function habit(over: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    name: '阅读',
    unit: '分钟',
    createdAt: NOW - HOUR,
    updatedAt: NOW - HOUR,
    ...over,
  };
}

function habitLog(over: Partial<HabitLog> = {}): HabitLog {
  return {
    id: 'hl1',
    habitId: 'h1',
    date: toLocalDate(NOW),
    value: 30,
    createdAt: NOW - HOUR,
    updatedAt: NOW - HOUR,
    ...over,
  };
}

/** 五张表的空底：用例只声明它关心的那一张。 */
const empty = {
  projects: {},
  tasks: {},
  habits: {},
  habitLogs: {},
  focusSessions: {},
};

describe('aliveRecords：撤销就是没发生', () => {
  it('滤掉软删除的记录（墓碑不算数）', () => {
    const rows = aliveRecords({
      a: { id: 'a', deletedAt: undefined },
      b: { id: 'b', deletedAt: 123 },
      c: { id: 'c' },
    });
    expect(rows.map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('🔴 墓碑的专注记录不计入 —— 否则"删掉的时间"会回到统计里', () => {
    const live = categoryReportFromTables(
      { ...empty, projects: { p1: project() }, tasks: { t1: task() }, focusSessions: { f1: session() } },
      NOW,
    );
    const withTombstone = categoryReportFromTables(
      {
        ...empty,
        projects: { p1: project() },
        tasks: { t1: task() },
        focusSessions: { f1: session({ deletedAt: NOW }) },
      },
      NOW,
    );
    expect(live.series).toHaveLength(1);
    expect(live.series[0]?.totalMs).toBe(25 * 60 * 1000);
    // 删掉之后：既没有那一行，也不假装它变成了"未归类"
    expect(withTombstone.series).toHaveLength(0);
    expect(withTombstone.unassignedMs).toBe(0);
  });
});

describe('categoryReportFromTables：只摊平，不判断', () => {
  it('专注时间沿着 任务 → 清单 归到那一行', () => {
    const report = categoryReportFromTables(
      { ...empty, projects: { p1: project() }, tasks: { t1: task() }, focusSessions: { f1: session() } },
      NOW,
    );
    expect(report.series[0]?.name).toBe('深度工作');
    expect(report.series[0]?.kind).toBe('project');
    expect(report.totalMs).toBe(25 * 60 * 1000);
    expect(report.unassignedMs).toBe(0);
  });

  it('🔴 任务被删掉时，它的时间进"未归类"而不是消失（不编造归因）', () => {
    const report = categoryReportFromTables(
      {
        ...empty,
        projects: { p1: project() },
        tasks: { t1: task({ deletedAt: NOW }) },
        focusSessions: { f1: session() },
      },
      NOW,
    );
    expect(report.series).toHaveLength(0);
    expect(report.unassignedMs).toBe(25 * 60 * 1000);
  });

  it('习惯按分钟归因（与清单同一张报告）', () => {
    const report = categoryReportFromTables(
      { ...empty, habits: { h1: habit() }, habitLogs: { hl1: habitLog() } },
      NOW,
    );
    expect(report.series[0]?.kind).toBe('habit');
    expect(report.series[0]?.habitMs).toBe(30 * 60 * 1000);
  });

  it('🔴 `weeks` 省略时窗口长度 = 领域层的默认常量（不在这里写字面量）', () => {
    const report = categoryReportFromTables(empty, NOW);
    // ⚠️ 不写死 12：窗口长度是**配置**。写死的边界断言会在改配置后静默空转，
    // 而那正是本仓库 §7 第 33 条的形状。
    expect(report.weeks).toHaveLength(DEFAULT_CATEGORY_WEEKS);
    expect(report.weeklyPeak?.length ?? report.weeks.length).toBe(DEFAULT_CATEGORY_WEEKS);
  });
});

describe('categoryReportFromState / now 是注入的', () => {
  it('同一个状态 + 不同的 now → 不同的窗口（宿主不许自己读时钟）', () => {
    const tables = {
      ...empty,
      projects: { p1: project() },
      tasks: { t1: task() },
      focusSessions: { f1: session() },
    };
    const thisWeek = categoryReportFromState(tables, NOW);
    // ⚠️ 要**跨过整个窗口**（12 周）。第一版我写的 +30 天 —— 那还在窗口里，
    // 于是断言红了，而红的原因是"我以为 30 天就出窗口了"。窗口是配置，别在用例里赌它。
    const manyWeeksLater = categoryReportFromState(tables, NOW + (DEFAULT_CATEGORY_WEEKS + 1) * 7 * 24 * HOUR);

    // ⚠️ `weeks` 是**从旧到新**的：最后一格才是当前周。
    // （我第一版写成 `weeks[0]` 并断言它等于 2026-09-21 —— 实测拿到 2026-07-06，
    //   即 12 周窗口的最早那一周。这条断言就是这么错的，留着它比删掉有用。）
    expect(thisWeek.weeks.at(-1)?.start).toBe('2026-09-21');
    // 六周之后再看：那条记录已经掉出窗口 —— 它**哪儿都不出现**，
    // 而不是"被算进某个格子里"（窗口外的历史不伪造）
    expect(manyWeeksLater.series).toHaveLength(0);
    expect(manyWeeksLater.unassignedMs).toBe(0);
  });

  it('五张表以外的字段被无视（`MaterializedState` 天然可赋）', () => {
    const state = {
      ...empty,
      projects: { p1: project() },
      tasks: { t1: task() },
      focusSessions: { f1: session() },
      // 与分类无关的表 —— 结构可赋，且不该影响结果
      aiFeedback: { x: { id: 'x' } },
      preferenceCorrections: { y: { id: 'y' } },
    };
    const report = categoryReportFromState(state, NOW);
    expect(report.series).toHaveLength(1);
    expect(report.totalMs).toBe(25 * 60 * 1000);
  });
});