/**
 * `TimelineBoard`（一根共轴的时间线板）的**纯函数与文案契约**
 * =====================================================
 *
 * 与 `model.ts`（旧甘特图的几何，现为详情预览服务）同一个分层：
 * 框架无关、可单测、文案由宿主注入（本目录不 import `@heyta/i18n`）。
 *
 * ## 本文件的存在理由（R4 §1.5 类 D 的正面解）
 *
 * 旧实现「每个任务一张图、各自归一化」的位置编码是死的。板上的一切
 * 都换算到**同一个窗口**（`boardWindow`）里：一根轴画一次，行与行、
 * 刻度与今天线全部对齐到它 —— **位置第一次携带信息**。
 *
 * 🔴 窗口**不截断**：本周（周一起）∪ 全部已排期任务的所在日。
 * 窗口外的边缘指示符是 P3（goal §4）；在它存在之前，宁可拉长窗口，
 * 也不许把落在外面的点画丢或画到边上假装它在里面。
 *
 * 🔴 刻度粒度按跨度自适应（日 → 周 → 月），mark 数封顶
 * `MAX_AXIS_MARKS`（复用 `model.ts` 的常量）：一条截止在明年的任务
 * 不能让渲染爆炸。
 */

import {
  DAY_MS,
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  addDays,
  addMonths,
  diffDays,
  formatCompactDate,
  isAllDayDueMs,
  isoWeekday,
  parseLocalDate,
  startOfDay,
  startOfMonth,
  toLocalDate,
  type LocalDate,
  type TaskTimePosition,
  type TimelineBoardRow,
} from '@heyta/domain';

import { MAX_AXIS_MARKS, formatClock } from './model.js';

/** 行头列占整行宽度的百分比。行头与轴/轨道按同一比例对齐。 */
export const BOARD_HEADER_PERCENT = 40;

/** 刻度粒度。跨度自适应：≤ 两周日刻度，≤ 半年周刻度，更远月刻度。 */
export type TickGranularity = 'day' | 'week' | 'month';

export interface BoardTick {
  readonly atMs: number;
  readonly granularity: TickGranularity;
  /** 只有**日**粒度的刻度才可能是今天（今天线另有标注）。 */
  readonly isToday: boolean;
}

/** 视图窗口（epoch ms）。`endMs` 是**排他**端点（次日 0 点），百分比的分母。 */
export interface BoardWindow {
  readonly startMs: number;
  readonly endMs: number;
}

/** 板的文案契约。语义见参数名；实现全部在宿主（用词条表填）。 */
export interface TimelineBoardLabels {
  readonly empty: string;
  readonly ariaEmpty: string;
  readonly ariaGroup: (count: number) => string;
  /** 星期名，**周一体**，7 项（`weekday.1` … `weekday.7`）。 */
  readonly weekdayNames: readonly string[];
  /** 月名，12 项（`month.1` … `month.12`）。 */
  readonly monthNames: readonly string[];
  readonly todayWord: string;
  /** 泳道标题：「未排期（N）」。 */
  readonly unscheduledLane: (count: number) => string;
  /** 行头的 AI 估时 badge：「AI 估 90 分钟」。参数是**原始分钟数**，措辞全在宿主。 */
  readonly aiBadge: (minutes: number) => string;
  /** 逾期标记（文字，不是只有颜色）。 */
  readonly overdue: string;
  /** 「点空白建任务」的默认标题（数据来自产品 ⇒ 仍走词条表，由宿主装配）。 */
  readonly untitledTask: string;
}

// ─────────────────────────────────────────────────────────────────────────
// 位置 → 几何
// ─────────────────────────────────────────────────────────────────────────

/**
 * 时刻是不是本地自然日的 0 点整（"全天"截止）。
 *
 * 🔴 判定本身住在 `@heyta/domain` 的 `isAllDayDueMs`：输入侧（`DueEditor` 要回答
 *   "这条截止有没有时刻"）与这里问的是**同一个问题**，抄第二份就是漂移的开始
 *   —— 两份对"0 点整"的口径一旦分叉，界面上会出现"时间线画在轴上、
 *   而编辑器说它是全天"。这个名字留着是因为它已经是本模块的导出口。
 */
export const isAllDayMs = isAllDayDueMs;

/**
 * 一个位置在轴上的**落笔时刻**。
 *
 * 🔴 全天截止（0 点整）画在当天**正午**（日格中央），不画在日界线上 ——
 * 那样"今天的截止"会看起来像"昨天最后一刻"。有时刻的按原时刻落笔。
 * `range` 取起点（条的左端）；`unscheduled` 没有（不落图）。
 */
export function markerMs(position: TaskTimePosition): number | undefined {
  if (position.kind === 'unscheduled') return undefined;
  if (position.kind === 'range') return position.startMs;
  return isAllDayMs(position.atMs) ? startOfDay(position.atMs) + DAY_MS / 2 : position.atMs;
}

/** 逾期（文字标注 + 警示色共用这一份判定）：全天看**日**，有时刻看**时刻**。 */
export function isOverdue(position: TaskTimePosition, now: number): boolean {
  if (position.kind === 'unscheduled') return false;
  if (position.kind === 'range') return position.endMs < now;
  return isAllDayMs(position.atMs)
    ? startOfDay(position.atMs) < startOfDay(now)
    : position.atMs < now;
}

/**
 * 视图窗口：今天所在周（周一起）∪ 全部已排期任务的所在日，**按自然日对齐**。
 *
 * 日期算术全部走领域层（`addDays` / `isoWeekday` / `startOfDay`）——
 * 夏令时那天用 `± DAY_MS` 硬算会错一小时，这里不犯（见 `date.ts` 的警告）。
 */
export function boardWindow(today: LocalDate, rows: readonly TimelineBoardRow[]): BoardWindow {
  const todayMs = parseLocalDate(today).getTime();
  const weekday = isoWeekday(today); // 1=周一 … 7=周日
  let startMs = startOfDay(todayMs - (weekday - 1) * DAY_MS);
  // 周一的 0 点 = 排他端点（本周 [+ 可能延伸的逾期/远期] 的分母）
  let endMs = parseLocalDate(addDays(today, 8 - weekday)).getTime();

  for (const row of rows) {
    const p = row.position;
    if (p.kind === 'unscheduled') continue;
    const fromMs = p.kind === 'point' ? p.atMs : p.startMs;
    const toMs = p.kind === 'point' ? p.atMs : p.endMs;
    const fromDayStart = startOfDay(fromMs);
    if (fromDayStart < startMs) startMs = fromDayStart;
    const toDayEnd = parseLocalDate(addDays(toLocalDate(toMs), 1)).getTime();
    if (toDayEnd > endMs) endMs = toDayEnd;
  }

  return { startMs, endMs };
}

/**
 * 时刻 → 窗口内的百分比横坐标（0–100，夹紧）。
 *
 * 同一窗口内**单调**：两条任务截止相差 N 分钟，横坐标差与 N 同号 ——
 * 这正是 R4 判据 2 的数学侧（旧实现里它是恒 0，所以位置不携带信息）。
 */
export function percentAt(ms: number, window: BoardWindow): number {
  const total = window.endMs - window.startMs;
  if (total <= 0) return 0;
  const pct = ((ms - window.startMs) / total) * 100;
  return Math.min(100, Math.max(0, pct));
}

/** 今天线横坐标；今天不在窗口内 ⇒ `undefined`（不画，画出来只会误导）。 */
export function todayPercent(window: BoardWindow, now: number): number | undefined {
  if (now < window.startMs || now >= window.endMs) return undefined;
  return percentAt(now, window);
}

/**
 * 轴刻度：粒度按自然日数自适应（≤14 日刻度、≤ 半年周刻度、更远月刻度），
 * 数量封顶 `MAX_AXIS_MARKS`。刻度落在**真实日界 / 周一 / 1 号**的本地 0 点。
 */
export function axisTicksForWindow(window: BoardWindow, today: LocalDate): readonly BoardTick[] {
  const dayCount = Math.round((window.endMs - window.startMs) / DAY_MS);
  const granularity: TickGranularity =
    dayCount <= 14 ? 'day' : dayCount <= 7 * 26 ? 'week' : 'month';

  const startDay = toLocalDate(window.startMs);
  const endDay = toLocalDate(window.endMs); // 排他
  const ticks: BoardTick[] = [];

  if (granularity === 'month') {
    let cursor = startOfMonth(startDay);
    if (cursor !== startDay) cursor = addMonths(cursor, 1); // 首个**完整**月的 1 号
    while (diffDays(cursor, endDay) > 0 && ticks.length < MAX_AXIS_MARKS) {
      ticks.push({ atMs: parseLocalDate(cursor).getTime(), granularity, isToday: false });
      cursor = addMonths(cursor, 1);
    }
    return ticks;
  }

  let cursor = startDay;
  if (granularity === 'week') {
    const weekday = isoWeekday(startDay);
    cursor = weekday === 1 ? startDay : addDays(startDay, 8 - weekday); // 第一个周一
  }
  const step = granularity === 'day' ? 1 : 7;
  while (diffDays(cursor, endDay) > 0 && ticks.length < MAX_AXIS_MARKS) {
    ticks.push({
      atMs: parseLocalDate(cursor).getTime(),
      granularity,
      isToday: granularity === 'day' && cursor === today,
    });
    cursor = addDays(cursor, step);
  }
  return ticks;
}

/**
 * 已排期行的**显示序**：按落笔时刻升序、稳定（同刻保持输入序）。
 * 时间线按时间读；输入序是产品筛选的顺序，不是时间的顺序。
 */
export function sortRowsForBoard(rows: readonly TimelineBoardRow[]): readonly TimelineBoardRow[] {
  return rows
    .map((row, index) => ({ row, index, at: markerMs(row.position) ?? 0 }))
    .sort((a, b) => {
      const delta = a.at - b.at;
      return delta !== 0 ? delta : a.index - b.index;
    })
    .map((entry) => entry.row);
}

/**
 * 刻度文字。措辞全部来自宿主：星期名 / 月名 / 「今天」。
 * 组合形状（"周三 09-30"）在共享层 —— 与滴答的日刻度同构；紧凑档只留日期
 * （移动端 7 列放不下两段）。
 */
export function tickText(
  tick: BoardTick,
  labels: TimelineBoardLabels,
  compact: boolean,
  now: number,
): string {
  if (tick.granularity === 'month') {
    const month = new Date(tick.atMs).getMonth();
    return labels.monthNames[month] ?? '';
  }
  const dateText = formatCompactDate(tick.atMs, now);
  if (compact) {
    // 🔴 紧凑档剥掉星期名，但**今天的前缀要留** —— 否则“哪天是今天”
    // 就只剩颜色一个载体（WCAG 1.4.1 不许）。
    return tick.isToday ? `${labels.todayWord} ${dateText}` : dateText;
  }
  const weekday = labels.weekdayNames[isoWeekday(toLocalDate(tick.atMs)) - 1] ?? '';
  return tick.isToday ? `${labels.todayWord} ${dateText}` : `${weekday} ${dateText}`;
}

/**
 * 行头的截止文字：全天只写日期；有时刻补钟点（`09-26 15:00`）。
 * 🔴 这个文字**只来自 `dueDate`** —— R4 判据 4 的数据来源就在这一行。
 */
export function dueText(atMs: number, now: number): string {
  const base = formatCompactDate(atMs, now);
  if (isAllDayMs(atMs)) return base;
  const d = new Date(atMs);
  return `${base} ${formatClock(d.getHours() * 60 + d.getMinutes())}`;
}

// ─────────────────────────────────────────────────────────────────────────
// 拖拽几何（P2 排期面）：像素 ↔ 时间。全部纯函数，Responder 只是搬运数字。
// ─────────────────────────────────────────────────────────────────────────

/** 轨道列在**行区**宽度里的占比（行头列之外的剩余部分）。 */
export const TRACK_FRACTION = 1 - BOARD_HEADER_PERCENT / 100;

/**
 * 行区像素坐标 → 时间戳（epoch ms）。
 *
 * `regionX` 以**行区左缘**为原点（含行头列 —— 指针事件给的是 pageX，
 * 减去行区的页面 x 之后就是它）。落点夹进窗口，不会拖出两端。
 */
export function msAtRegionX(
  regionX: number,
  regionWidth: number,
  window: BoardWindow,
): number {
  if (regionWidth <= 0) return window.startMs;
  const frac = Math.min(
    1,
    Math.max(0, (regionX / regionWidth - BOARD_HEADER_PERCENT / 100) / TRACK_FRACTION),
  );
  return window.startMs + frac * (window.endMs - window.startMs);
}

/**
 * 拖条移动：起点随像素位移**平移**（整分钟对齐；时长不动 —— 那是 resize 的事）。
 *
 * ⚠️ `pxPerMs` 是**每毫秒的像素数**（轨道宽 ÷ 窗口跨度，周视图下 ~1e-6）——
 * 换算是**除**：`dx / pxPerMs` = 位移的毫秒数。乘除方向写反的话，拖一屏只会
 * 挪几毫秒（整分钟对齐后等于没动），而且不会报错。
 */
export function moveStartMs(origStartMs: number, dxPx: number, pxPerMs: number): number {
  return origStartMs + Math.round(dxPx / pxPerMs / 60_000) * 60_000;
}

/** 拖右缘改时长：**夹取到 [MIN, MAX] 整分钟**（与 `buildTimeline` 同一档）。 */
export function resizeMinutes(origMinutes: number, dxPx: number, pxPerMs: number): number {
  const next = origMinutes + dxPx / pxPerMs / 60_000;
  return Math.min(MAX_DURATION_MINUTES, Math.max(MIN_DURATION_MINUTES, Math.round(next)));
}

/** 板拖拽回调给宿主的**变更**：只带调用方点名的字段（与 `setSchedule` 的语义对齐）。 */
export interface TimelineScheduleChange {
  readonly startDate?: number;
  readonly durationMinutes?: number;
}
