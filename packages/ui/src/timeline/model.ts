/**
 * 时间线/甘特图的**纯函数与文案契约**（共享层）
 * =================================================
 *
 * 这一层有两个内容，都刻意与框架无关：
 *
 *   1. **几何与格式化**：跨度、轴刻度、日期分隔带、`90 分钟` / `1 小时 30 分`。
 *      它们是纯函数，所以能被单测钉死（`tests/timeline-model.spec.ts`）。
 *   2. **文案契约**（`GanttLabels` / `TimelineViewLabels`）：共享组件**不 import
 *      `@heyta/i18n`**（那个包会拖进第二份 React，Android 产物里出现过两个实例，
 *      见 `task-list/TaskList.tsx` 文件头），所以每一句文案都由宿主以**函数**注入。
 *
 * 🔴 为什么标签是函数而不是字符串：文案依赖运行时数据（几条、多少分钟、第几天）。
 * 单复数在**宿主**那一侧决定（它认识词条表），共享层只负责"该显示了"。
 * 这样中英各一套复数规则不会渗进共享层，而共享层也不必假装认识语言。
 *
 * ⚠️ 日期计算全部复用 `@heyta/domain` 的 `addDays` / `diffDays` /
 * `parseLocalDate` / `formatCompactDate` —— **不要在这里再写一套**："用户的今天"
 * 在三端必须是同一个概念，本地日历日与 UTC 的差异会静默错一天。
 */

import {
  MIN_DURATION_MINUTES,
  addDays,
  diffDays,
  formatCompactDate,
  parseLocalDate,
  type LocalDate,
  type TimelineEntry,
} from '@heyta/domain';

/** 一天有多少分钟。轴的分日计算用它。 */
export const MINUTES_PER_DAY = 1440;

/** 一小时有多少分钟。 */
export const MINUTES_PER_HOUR = 60;

/** 跨度超过这个值（12 小时）就按"跨天"画日期分隔带，否则按钟点画刻度。 */
export const MULTI_DAY_THRESHOLD_MINUTES = 12 * MINUTES_PER_HOUR;

/** 日期分隔带 / 刻度线的数量上限。坏数据（跨度极大）时防止渲染爆炸。 */
export const MAX_AXIS_MARKS = 60;

/**
 * 甘特图的文案契约。
 *
 * ⚠️ 每一项的**语义**写在参数名里，实现留在宿主 —— 宿主用词条表填。
 */
export interface GanttLabels {
  /** 图表标题（"时间线"）。 */
  readonly title: string;
  /** 没有条目时的空态。 */
  readonly empty: string;
  readonly minutes: (count: number) => string;
  readonly hours: (count: number) => string;
  readonly hoursMinutes: (hours: number, minutes: number) => string;
  /** 跨天时的日期分隔带（"第 2 天"）。 */
  readonly day: (day: number) => string;
  /** 表头：几条、总跨度。**单复数由宿主在这里选词条**。 */
  readonly span: (count: number, total: string) => string;
  /** 表头：计划从什么时候开始。 */
  readonly rangeFrom: (when: string) => string;
  /** 表头：今天在计划里的第几天。 */
  readonly today: (day: number) => string;
  /** 表头：有几条按默认工期排的（要如实说"未估时"）。 */
  readonly unestimated: (count: number, duration: string) => string;
  /** 表头：有几条的工期来自 AI 估时。 */
  readonly aiSummary: (count: number) => string;
  /** 单条：工期来自默认值。 */
  readonly durationDefault: (duration: string) => string;
  /** 单条：工期来自 AI 估时。 */
  readonly durationAi: (duration: string) => string;
  /** 单条：工期是调用方给的。 */
  readonly durationManual: (duration: string) => string;
  /** 单条：依赖哪一条。 */
  readonly dependsOn: (title: string) => string;
  /** 单条：与前置重叠（依赖被违反）。 */
  readonly overlap: string;
  /** 整图的组名（读屏读到的是它，条本身是装饰）。 */
  readonly ariaGroup: (count: number, total: string) => string;
}

/**
 * 🔴 `TimelineViewLabels` 已随 `TimelineView` 删除（2026-10-01 重画，goal：
 * `docs/plans/goal-timeline-rework.md`）：板的文案契约是 `board-model.ts` 的
 * `TimelineBoardLabels`；详情预览的是 `ChecklistPlanPreview.tsx` 的
 * `ChecklistPlanLabels`。本文件只剩 `GanttLabels`（`GanttChart` ＝ 详情预览的图）。
 */

/**
 * 分钟数 → 人话（`90 分钟` / `1 小时` / `1 小时 30 分`）。
 *
 * 单位词来自 `labels`（是文案），数字是数据。同一个函数既用于工期，
 * 也用于轴上的**相对**偏移 —— 两种语境下读法相同，所以不写两套。
 */
export function formatDuration(minutes: number, labels: GanttLabels): string {
  if (minutes < MINUTES_PER_HOUR) return labels.minutes(minutes);
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;
  return rest === 0 ? labels.hours(hours) : labels.hoursMinutes(hours, rest);
}

/**
 * 校验一个本地日历日。**不合法就当作没给** —— 一个坏日期不该让整个视图崩掉。
 *
 * `parseLocalDate` 对越界日期（2 月 30 日、13 月）**抛错**而不是静默进位，
 * 所以这里必须 `try`，否则界面会因为一个脏参数整块白掉。
 */
export function safeLocalDate(value: LocalDate | undefined): LocalDate | undefined {
  if (value === undefined) return undefined;
  try {
    parseLocalDate(value);
    return value;
  } catch {
    return undefined;
  }
}

/** 把起始钟点夹进 [0, 1439]。非法值当 0（当天 00:00）。 */
export function normalizeClock(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  if (rounded <= 0) return 0;
  if (rounded >= MINUTES_PER_DAY) return MINUTES_PER_DAY - 1;
  return rounded;
}

/** 当天第几分钟 → `9:30`。超过一天就绕回来（轴上的绝对钟点）。 */
export function formatClock(minutesSinceMidnight: number): string {
  const wrapped =
    ((Math.round(minutesSinceMidnight) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(wrapped / MINUTES_PER_HOUR);
  const minutes = wrapped % MINUTES_PER_HOUR;
  return `${String(hours)}:${minutes < 10 ? '0' : ''}${String(minutes)}`;
}

/** 「09-26 9:30 → 11:00」。日期计算全部走领域层。 */
export function formatRange(
  startDate: LocalDate,
  startClock: number,
  startOffsetMinutes: number,
  durationMinutes: number,
  now: number,
): string {
  const fromAbsolute = startClock + startOffsetMinutes;
  // 结束时刻是**起点 + 时长**（不减 1）：时长是一个区间长度，不是"第几天"。
  const toAbsolute = fromAbsolute + durationMinutes;

  const fromDay = Math.floor(fromAbsolute / MINUTES_PER_DAY);
  const toDay = Math.floor(toAbsolute / MINUTES_PER_DAY);

  const fromText = formatCompactDate(parseLocalDate(addDays(startDate, fromDay)).getTime(), now);
  const toText = formatCompactDate(parseLocalDate(addDays(startDate, toDay)).getTime(), now);

  const fromClock = formatClock(fromAbsolute);
  const toClock = formatClock(toAbsolute);

  return fromDay === toDay
    ? `${fromText} ${fromClock} → ${toClock}`
    : `${fromText} ${fromClock} → ${toText} ${toClock}`;
}

/** 相对偏移的区间：「0 分钟 → 1 小时 30 分」。没有起始日时用它。 */
export function formatRelativeRange(
  startOffsetMinutes: number,
  durationMinutes: number,
  labels: GanttLabels,
): string {
  return `${formatDuration(startOffsetMinutes, labels)} → ${formatDuration(
    startOffsetMinutes + durationMinutes,
    labels,
  )}`;
}

/** 条目名的键。用 `title` 是因为 `TimelineEntry.dependsOn` 就是按它引用的。 */
export function indexByTitle(entries: readonly TimelineEntry[]): Map<string, TimelineEntry> {
  const map = new Map<string, TimelineEntry>();
  for (const entry of entries) map.set(entry.title, entry);
  return map;
}

/**
 * 跨天时的日期分隔带。
 *
 * 边界落在**真实午夜**上：计划从 9:30 开始时，第一天只有 14.5 小时。
 * 所以不能简单按 `1440` 切 —— 那样"第 1 天"会从 9:30 数到次日 9:30，
 * 与用户日历上的"天"错开。
 */
export function dayBands(
  span: number,
  startClock: number,
): readonly { readonly start: number; readonly end: number; readonly dayIndex: number }[] {
  const bands: { start: number; end: number; dayIndex: number }[] = [];
  let cursor = 0;
  let dayIndex = 1;
  let nextMidnight = MINUTES_PER_DAY - startClock;

  while (cursor < span && bands.length < MAX_AXIS_MARKS) {
    const end = Math.min(span, nextMidnight);
    bands.push({ start: cursor, end, dayIndex });
    cursor = end;
    dayIndex += 1;
    nextMidnight += MINUTES_PER_DAY;
  }

  return bands;
}

/** 单日内的刻度：按跨度选 30 / 60 / 120 分钟一格。 */
export function axisTicks(
  span: number,
  startClock: number,
  hasStart: boolean,
  labels: GanttLabels,
): readonly { readonly offset: number; readonly label: string }[] {
  const step = span <= 2 * MINUTES_PER_HOUR ? 30 : span <= 6 * MINUTES_PER_HOUR ? 60 : 120;
  const ticks: { offset: number; label: string }[] = [];

  for (let offset = 0; offset <= span && ticks.length < MAX_AXIS_MARKS; offset += step) {
    ticks.push({
      offset,
      label: hasStart ? formatClock(startClock + offset) : formatDuration(offset, labels),
    });
  }

  return ticks;
}

/**
 * 一张图的跨度（分钟）。至少一条最短工期，否则百分比会除零。
 *
 * `spanMinutes` 是**多图对齐**的口子：条宽是相对本图跨度的百分比，
 * 各图各自归一化会让 90 与 30 分钟都占满整行。给了就取 `max(本图, spanMinutes)`
 * —— **只放宽，不截断**（调用方算错时条也不会溢出容器）。
 */
export function chartSpan(entries: readonly TimelineEntry[], spanMinutes?: number): number {
  let span = MIN_DURATION_MINUTES;
  for (const entry of entries) {
    span = Math.max(span, entry.startOffsetMinutes + entry.durationMinutes);
  }
  if (typeof spanMinutes === 'number' && Number.isFinite(spanMinutes) && spanMinutes > 0) {
    span = Math.max(span, spanMinutes);
  }
  return span;
}

/** 今天那一整天在计划里的区间（分钟）。计划起点是 `startDate` 的 `startClock` 分。 */
export function todayWindow(
  startDate: LocalDate | undefined,
  today: LocalDate | undefined,
  startClock: number,
): number | undefined {
  if (startDate === undefined || today === undefined) return undefined;
  return diffDays(startDate, today) * MINUTES_PER_DAY - startClock;
}
