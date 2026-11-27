/**
 * 专注统计序列（覆盖图谱 #50）：`focusSeries` 的口径判据。
 *
 * 🔴 期望值手算。这些断言必须能红：把休息段算进 focusMs、把 aborted 算成
 * completedCount、把日期归属从 `endedAt` 换成 `startedAt`、把缺 actualMs
 * 当 0、把 week/month 窗口切错 —— 都会红掉其中一条。
 */

import { describe, expect, it } from 'vitest';

import type { FocusSession } from '../src/entities.js';
import { focusSeries } from '../src/focus-series.js';

function at(y: number, m: number, d: number, h = 10): number {
  return new Date(y, m - 1, d, h).getTime();
}

const MIN = 60_000;

function session(over: Partial<FocusSession> & { createdAt: number }): FocusSession {
  return {
    id: `s-${String(over.createdAt)}-${String(Math.random())}`,
    kind: 'work',
    plannedMs: 25 * MIN,
    updatedAt: over.createdAt,
    ...over,
  };
}

describe('focusSeries · day', () => {
  it('按 endedAt 归属到本地日；只数工作段，休息不算', () => {
    const sessions: FocusSession[] = [
      session({ createdAt: at(2024, 6, 10, 9), endedAt: at(2024, 6, 10, 9), actualMs: 25 * MIN, completed: true }),
      session({ createdAt: at(2024, 6, 10, 10), endedAt: at(2024, 6, 10, 11), actualMs: 30 * MIN, completed: false }),
      // 休息段：不计入 focusMs
      session({ kind: 'shortBreak', createdAt: at(2024, 6, 10, 11), endedAt: at(2024, 6, 10, 12), actualMs: 5 * MIN }),
      session({ createdAt: at(2024, 6, 9, 9), endedAt: at(2024, 6, 9, 9), actualMs: 25 * MIN, completed: true }),
    ];
    const series = focusSeries(sessions, '2024-06-10', 'day', 2);
    // 旧→新：[06-09, 06-10]
    expect(series.map((p) => p.start)).toEqual(['2024-06-09', '2024-06-10']);
    // 06-10：工作段 25+30 = 55 分钟；休息不算；完成段只 1 个（aborted 不算）。
    expect(series[1]?.focusMs).toBe(55 * MIN);
    expect(series[1]?.completedCount).toBe(1);
    expect(series[0]?.focusMs).toBe(25 * MIN);
    expect(series[0]?.completedCount).toBe(1);
  });

  it('缺 actualMs 时退回 plannedMs（不按 0 算）', () => {
    const sessions = [session({ createdAt: at(2024, 6, 10), endedAt: at(2024, 6, 10), plannedMs: 20 * MIN, completed: true })];
    const series = focusSeries(sessions, '2024-06-10', 'day', 1);
    expect(series[0]?.focusMs).toBe(20 * MIN);
  });
});

describe('focusSeries · week', () => {
  it('最后一格是贴住 today 的 7 天窗口', () => {
    const sessions = [
      session({ createdAt: at(2024, 6, 8), endedAt: at(2024, 6, 8), actualMs: 10 * MIN, completed: true }),
      session({ createdAt: at(2024, 6, 14), endedAt: at(2024, 6, 14), actualMs: 20 * MIN, completed: true }),
      session({ createdAt: at(2024, 6, 1), endedAt: at(2024, 6, 1), actualMs: 99 * MIN, completed: true }), // 落在上一格
    ];
    const series = focusSeries(sessions, '2024-06-14', 'week', 2);
    // 最后一格 = [06-08, 06-14] ⇒ 10+20 = 30 分钟；上一格含 06-01 ⇒ 99。
    expect(series[1]?.start).toBe('2024-06-08');
    expect(series[1]?.end).toBe('2024-06-14');
    expect(series[1]?.focusMs).toBe(30 * MIN);
    expect(series[0]?.focusMs).toBe(99 * MIN);
  });
});

describe('focusSeries · month', () => {
  it('按自然月分桶，最后一格右端裁到今天', () => {
    const sessions = [
      session({ createdAt: at(2024, 5, 20), endedAt: at(2024, 5, 20), actualMs: 40 * MIN, completed: true }),
      session({ createdAt: at(2024, 6, 10), endedAt: at(2024, 6, 10), actualMs: 15 * MIN, completed: true }),
    ];
    const series = focusSeries(sessions, '2024-06-14', 'month', 2);
    expect(series[0]?.start).toBe('2024-05-01');
    expect(series[0]?.end).toBe('2024-05-31');
    expect(series[0]?.focusMs).toBe(40 * MIN);
    // 今天所在月：右端裁到 06-14（不是 06-30）。
    expect(series[1]?.start).toBe('2024-06-01');
    expect(series[1]?.end).toBe('2024-06-14');
    expect(series[1]?.focusMs).toBe(15 * MIN);
  });
});
