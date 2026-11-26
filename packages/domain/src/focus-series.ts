/**
 * 专注统计序列（覆盖图谱 #50：按日/周/月图表的数据来源）
 * =======================================================
 *
 * 「专注统计屏」要的是**能画成图的多点序列**，而不是一张四格卡。
 * 这一层把已结束的专注记录切成日/周/月三档桶，每桶给出专注时长与自然完成段数。
 *
 * 🔴 口径与 `focusStatsForDay` / `activityTotalsFromState` 严格同源：
 *   · 只数**工作段**（`shouldPersistSession`，休息不算专注成果）；
 *   · 一条记录算在**哪一天**用 `focusSessionDay`（`endedAt ?? createdAt`），
 *     不是 `startedAt`（跨零点归属的唯一不重不漏口径，见 `focus.ts`）；
 *   · 时长缺 `actualMs` 时退回 `plannedMs`（同统计层那条兜底），绝不按 0 算。
 *
 * ⚠️ `today` 由调用方传入（可测）；窗口右端恒为 `today`。
 */

import type { FocusSession } from './entities.js';
import {
  addDays,
  addMonths,
  daysInMonth,
  startOfMonth,
  toLocalDate,
  type LocalDate,
} from './date.js';
import { focusSessionDay, shouldPersistSession } from './focus.js';

/** 专注图表的三种时间粒度。 */
export type FocusSeriesBucket = 'day' | 'week' | 'month';

/** 专注序列里的一格。 */
export interface FocusSeriesPoint {
  /** 该格首日（含）。 */
  readonly start: LocalDate;
  /** 该格末日（含）。 */
  readonly end: LocalDate;
  /** 该格专注时长（ms，含中途放弃的那部分 —— 那是真实坐下来的时间）。 */
  readonly focusMs: number;
  /** 该格自然完成的专注段数（不含休息、不含放弃）。 */
  readonly completedCount: number;
}

/** 一条专注记录的"实际时长"，与统计层同一句兜底。 */
function actualMsOf(session: FocusSession): number {
  return session.actualMs ?? session.plannedMs;
}

/** 某个本地日期是否落在 `[start, end]`（含端点）。 */
function within(date: LocalDate, start: LocalDate, end: LocalDate): boolean {
  return date >= start && date <= end;
}

/** 月桶的末日（该月最后一天）。 */
function endOfMonth(monthStart: LocalDate): LocalDate {
  const year = Number(monthStart.slice(0, 4));
  const month = Number(monthStart.slice(5, 7));
  return `${monthStart.slice(0, 7)}-${String(daysInMonth(year, month)).padStart(2, '0')}`;
}

/**
 * 近 `count` 个粒度的专注序列，**旧 → 新**（最后一格含今天）。
 *
 * · `day`   —— 连续 `count` 天，右端贴今天；
 * · `week`  —— 连续 `count` 个 7 天窗口，右端贴今天；
 * · `month` —— 连续 `count` 个**自然月**，最后一格是今天所在月（右端裁到今天）。
 */
export function focusSeries(
  sessions: readonly FocusSession[],
  today: LocalDate,
  bucket: FocusSeriesBucket,
  count: number,
): FocusSeriesPoint[] {
  const n = Math.max(1, Math.floor(count));

  // 先把"工作段 + 其所属本地日 + 时长"摊平一次，避免每个桶重复扫全量。
  const work = sessions
    .filter((session) => shouldPersistSession(session))
    .map((session) => ({
      date: toLocalDate(focusSessionDay(session)),
      ms: actualMsOf(session),
      completed: session.completed === true,
    }));

  const out: FocusSeriesPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    let start: LocalDate;
    let end: LocalDate;
    if (bucket === 'day') {
      end = addDays(today, -(n - 1 - i));
      start = end;
    } else if (bucket === 'week') {
      end = addDays(today, -(n - 1 - i) * 7);
      start = addDays(end, -6);
    } else {
      const monthStart = startOfMonth(addMonths(today, -(n - 1 - i)));
      start = monthStart;
      const monthEnd = endOfMonth(monthStart);
      end = monthEnd < today ? monthEnd : today;
    }

    let focusMs = 0;
    let completedCount = 0;
    for (const item of work) {
      if (!within(item.date, start, end)) continue;
      focusMs += item.ms;
      if (item.completed) completedCount += 1;
    }
    out.push({ start, end, focusMs, completedCount });
  }
  return out;
}
