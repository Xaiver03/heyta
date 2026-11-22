/**
 * Harness 层「周报 / 年终总结」工具（**零 C 端入口**）。
 *
 * 产品裁决：所有工具/功能收敛到 Harness/产品层，由 AI 助手按需调用，**不新增任何界面/按钮**。
 * 于是"生成周报"不是一个新的页面，而是助手的一个**工具**：
 *   用户对助手说"帮我写本周周报" → 模型调用 `weekly_report`（本文件聚合数据）
 *   → 模型据此成文 → 返回 Markdown。
 *
 * 数据来自**本机 op-log 物化状态**（`getState()`），只在设备端聚合；
 * 交给模型的是**必要摘要**（计数 + 少量标题），不是全量原始数据。
 */
import type { CloudToolDescriptor, CloudToolTransport } from './ai-cloud-tools.js';

/** 只依赖需要的字段，避免把整个 MaterializedState 类型拖进来。 */
export interface ReportState {
  readonly tasks?: Readonly<Record<string, { title?: string; completedAt?: number; createdAt?: number; deletedAt?: number; purgedAt?: number }>>;
  readonly projects?: Readonly<Record<string, { name?: string; createdAt?: number; deletedAt?: number; purgedAt?: number }>>;
  readonly habitLogs?: Readonly<Record<string, { date?: string; value?: number }>>;
  readonly focusSessions?: Readonly<Record<string, { startedAt?: number; durationMinutes?: number }>>;
}

export interface WeeklyReportData {
  readonly kind: 'weekly';
  readonly startISO: string;
  readonly endISO: string;
  readonly completedCount: number;
  readonly createdCount: number;
  readonly habitCheckins: number;
  readonly focusMinutes: number;
  readonly topCompletedTitles: readonly string[];
}
export interface YearEndReportData {
  readonly kind: 'year-end';
  readonly year: number;
  readonly completedCount: number;
  readonly createdCount: number;
  readonly projectCount: number;
  readonly habitCheckins: number;
  readonly focusMinutes: number;
  readonly completedByMonth: readonly number[];
}

function alive(t: { deletedAt?: number; purgedAt?: number }): boolean {
  return (t.deletedAt === undefined || t.deletedAt === null) && (t.purgedAt === undefined || t.purgedAt === null);
}
function inRange(ts: number | undefined, from: number, to: number): boolean {
  return ts !== undefined && ts !== null && ts >= from && ts < to;
}

/** 本周（周一起算）。 */
export function aggregateWeekly(state: ReportState, now: number): WeeklyReportData {
  const d = new Date(now);
  const day = (d.getDay() + 6) % 7; // 周一=0
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day).getTime();
  const nextMonday = monday + 7 * 24 * 3600 * 1000;
  let completedCount = 0;
  let createdCount = 0;
  const titles: string[] = [];
  for (const t of Object.values(state.tasks ?? {})) {
    if (!alive(t)) continue;
    if (inRange(t.completedAt, monday, nextMonday)) {
      completedCount += 1;
      if (typeof t.title === 'string') titles.push(t.title);
    }
    if (inRange(t.createdAt, monday, nextMonday)) createdCount += 1;
  }
  let habitCheckins = 0;
  for (const h of Object.values(state.habitLogs ?? {})) {
    if (typeof h.date === 'string') {
      const ts = Date.parse(`${h.date}T00:00:00`);
      if (ts >= monday && ts < nextMonday) habitCheckins += 1;
    }
  }
  let focusMinutes = 0;
  for (const f of Object.values(state.focusSessions ?? {})) {
    if (inRange(f.startedAt, monday, nextMonday)) focusMinutes += f.durationMinutes ?? 0;
  }
  const localDate = (ms: number): string => {
    const x = new Date(ms);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${String(x.getFullYear())}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  };
  return {
    kind: 'weekly',
    startISO: localDate(monday),
    endISO: localDate(nextMonday - 1),
    completedCount,
    createdCount,
    habitCheckins,
    focusMinutes,
    topCompletedTitles: titles.slice(0, 5),
  };
}

/** 本年（自然年）。 */
export function aggregateYearEnd(state: ReportState, now: number): YearEndReportData {
  const y = new Date(now).getFullYear();
  const from = new Date(y, 0, 1).getTime();
  const to = new Date(y + 1, 0, 1).getTime();
  const byMonth = new Array<number>(12).fill(0);
  let completedCount = 0;
  let createdCount = 0;
  for (const t of Object.values(state.tasks ?? {})) {
    if (!alive(t)) continue;
    if (inRange(t.completedAt, from, to)) {
      completedCount += 1;
      const mi = new Date(t.completedAt as number).getMonth();
      byMonth[mi] = (byMonth[mi] ?? 0) + 1;
    }
    if (inRange(t.createdAt, from, to)) createdCount += 1;
  }
  let projectCount = 0;
  for (const p of Object.values(state.projects ?? {})) {
    if (alive(p) && inRange(p.createdAt, from, to)) projectCount += 1;
  }
  let habitCheckins = 0;
  for (const h of Object.values(state.habitLogs ?? {})) {
    if (typeof h.date === 'string') {
      const ts = Date.parse(`${h.date}T00:00:00`);
      if (ts >= from && ts < to) habitCheckins += 1;
    }
  }
  let focusMinutes = 0;
  for (const f of Object.values(state.focusSessions ?? {})) {
    if (inRange(f.startedAt, from, to)) focusMinutes += f.durationMinutes ?? 0;
  }
  return { kind: 'year-end', year: y, completedCount, createdCount, projectCount, habitCheckins, focusMinutes, completedByMonth: byMonth };
}

/** 给模型看的工具描述（只读、无副作用）。 */
export const REPORT_TOOL_DESCRIPTORS: readonly CloudToolDescriptor[] = [
  {
    name: 'weekly_report',
    description: '聚合本周（周一起）已完成/新建任务数、习惯打卡数、专注分钟与少量完成标题，用于撰写周报。只读。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    egressFields: ['kind', 'startISO', 'endISO', 'completedCount', 'createdCount', 'habitCheckins', 'focusMinutes', 'topCompletedTitles'],
  },
  {
    name: 'year_end_summary',
    description: '聚合本年已完成/新建任务数、新建清单数、习惯打卡、专注分钟与逐月完成分布，用于撰写年终总结。只读。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    egressFields: ['kind', 'year', 'completedCount', 'createdCount', 'projectCount', 'habitCheckins', 'focusMinutes', 'completedByMonth'],
  },
];

/** 在既有传输上叠加两个报表工具（其余工具原样透传）。 */
export function createReportAwareTransport(
  inner: CloudToolTransport,
  getState: () => ReportState,
  now: () => number = Date.now,
): CloudToolTransport {
  return {
    async invoke(name, args, signal, options) {
      if (name === 'weekly_report') return { ok: true, data: aggregateWeekly(getState(), now()) };
      if (name === 'year_end_summary') return { ok: true, data: aggregateYearEnd(getState(), now()) };
      return inner.invoke(name, args, signal, options);
    },
  };
}
