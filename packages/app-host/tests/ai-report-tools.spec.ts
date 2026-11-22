import { describe, expect, it } from 'vitest';

import { aggregateWeekly, aggregateYearEnd, createReportAwareTransport, REPORT_TOOL_DESCRIPTORS } from '../src/ai-report-tools.js';
import type { CloudToolTransport } from '../src/ai-cloud-tools.js';

// 2026-11-18 是周三。本周一 = 11-16。
const NOW = new Date(2026, 10, 18, 12, 0, 0).getTime();
const ts = (m: number, d: number): number => new Date(2026, m - 1, d, 10, 0, 0).getTime();

const state = {
  tasks: {
    a: { title: 'A', completedAt: ts(11, 17), createdAt: ts(11, 16) },
    b: { title: 'B', completedAt: ts(11, 10) }, // 上周
    c: { title: 'C', createdAt: ts(11, 18) },
    d: { title: 'D', completedAt: ts(11, 18), deletedAt: ts(11, 18) }, // 已删
  },
  projects: { p1: { name: 'P', createdAt: ts(3, 1) } },
  habitLogs: { h1: { date: '2026-11-17' }, h2: { date: '2026-11-10' } },
  focusSessions: { f1: { startedAt: ts(11, 17), durationMinutes: 25 } },
};

describe('周报/年终聚合（Harness 工具）', () => {
  it('周报：只算本周、排除已删', () => {
    const r = aggregateWeekly(state, NOW);
    expect(r.startISO.startsWith('2026-11-1')).toBe(true); // 本周一的日期（按机器本地时区）
    expect(r.completedCount).toBe(1); // A（D 已删）
    expect(r.createdCount).toBe(2); // A、C
    expect(r.habitCheckins).toBe(1);
    expect(r.focusMinutes).toBe(25);
    expect(r.topCompletedTitles).toEqual(['A']);
  });

  it('年终：全年计数 + 逐月分布', () => {
    const r = aggregateYearEnd(state, NOW);
    expect(r.year).toBe(2026);
    expect(r.completedCount).toBe(2); // A、B（D 删）
    expect(r.completedByMonth.reduce((a, b) => a + b, 0)).toBe(2); // 逐月合计 = 全年完成
    expect(r.projectCount).toBe(1);
  });

  it('report-aware transport 拦截报表工具，其余透传', async () => {
    const inner: CloudToolTransport = { invoke: async (n) => ({ ok: true, data: { passthrough: n } }) };
    const t = createReportAwareTransport(inner, () => state, () => NOW);
    const w = await t.invoke('weekly_report', {});
    expect(w.ok && (w.data as { kind: string }).kind).toBe('weekly');
    const other = await t.invoke('list_tasks', {});
    expect(other).toEqual({ ok: true, data: { passthrough: 'list_tasks' } });
    expect(REPORT_TOOL_DESCRIPTORS.map((d) => d.name)).toEqual(['weekly_report', 'year_end_summary']);
  });
});
