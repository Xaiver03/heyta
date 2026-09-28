/**
 * 甘特图 / 时间线 —— 纯展示
 * ============================
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这个组件**与 AI 无关，也不该有关**。
 *
 * 它只做一件事：把一份**已经排好序、已经算好偏移**的条目数组画成横向时间条。
 * 排程在 `buildTimeline.ts`（纯函数），估时在别处 —— 这里两个都不碰。
 *
 * `docs/reference/ai-architecture.md` §14 第 20 条：
 * 「🔴 `AiFeature` 不得加入可视化；甘特图与倒计时**不是 AI**」。
 * 所以本文件里没有 `request*`、没有 `routing`、没有 `consents`、没有网络。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## 🔴 单位是「分钟」，与 `buildTimeline.ts` / `ai-duration.ts` 一致
 *
 * 不用天：AI 估时的上限是 480 分钟（8 小时），按天排会把每条估时都压成
 * "1 天"，信号全丢（理由详见 `buildTimeline.ts` 文件头）。
 *
 * 好处之一是**轴可以自适应**：
 *   - 跨度 ≤ `MULTI_DAY_THRESHOLD_MINUTES`（12 小时）→ 按小时/分钟画刻度，
 *     给了 `startDate` 就显示真实钟点（`9:30` / `10:15`），否则显示相对偏移。
 *   - 跨度跨天 → 画**日期分隔带**并标「第 N 天 · 09-26」。
 *
 * ## 🔴 条的宽度必须**看得出差别**
 *
 * 位置与宽度都是**百分比**（相对总跨度），所以 90 分钟的条**一定**是
 * 30 分钟的 **3 倍宽**，与容器宽度、与总跨度都无关。
 *
 * ⚠️ 所以**不能**给条设一个"看起来还行"的最小宽度（比如 0.75rem）：
 * 那会把短条全部抬到同一个宽度，90 与 30 就变得一样宽 —— 恰好毁掉
 * 时间线唯一要表达的东西。这里只用一根**发丝线**（`border-width.thin`）
 * 兜底，它只在条细到亚像素时才生效，不会抹平比例。
 *
 * ## 🔴 不许只用颜色表达信息
 *
 * 色觉障碍用户看不出"这条是估的"或"这条依赖那条"。所以每一条**都带文字**：
 *
 *   - 工期 → `约 90 分钟`；退回默认值时 → `未估时（按 1 小时排）`
 *   - 依赖 → `依赖：<前置条目>`
 *   - 依赖被违反（前置还没结束它就开始了）→ `与前置重叠`
 *   - 今天 → 表头里的 `今天 · 第 N 天`（那根竖线只是装饰）
 *
 * 彩色条与轴的刻度线本身是 `aria-hidden` 的装饰；**屏幕阅读器读到的是文字**。
 *
 * ## 🔴 样式只用 tokens.css
 *
 * 不写裸 hex / px / ms / z-index（`pnpm check:design` 会拦）。
 *
 * ## 🔴 日期计算复用 `@heyta/domain`
 *
 * `addDays` / `diffDays` / `parseLocalDate` / `formatCompactDate` 全部来自
 * 领域层 —— **不要在这里再写一套**。理由见 `packages/domain/src/date.ts`：
 * "用户的今天"在三端必须是同一个概念，本地日历日与 UTC 的差异会静默错一天。
 */

import {
  DEFAULT_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  addDays,
  diffDays,
  formatCompactDate,
  parseLocalDate,
  type LocalDate,
  type TimelineEntry,
} from '@heyta/domain';
import { cssVar } from '@heyta/design-system';
import { useI18n, type I18nValue } from '@heyta/i18n';


/** 一天有多少分钟。轴的分日计算用它。 */
const MINUTES_PER_DAY = 1440;

/** 一小时有多少分钟。 */
const MINUTES_PER_HOUR = 60;

/**
 * 跨度超过这个值（12 小时）就按"跨天"画日期分隔带，否则按钟点画刻度。
 *
 * 12 小时不是魔法数：它大致是"一个工作日的量级"。再长还按钟点画，
 * 刻度会挤成一团，而用户真正关心的是"这件事落在哪一天"。
 */
const MULTI_DAY_THRESHOLD_MINUTES = 12 * MINUTES_PER_HOUR;

/** 日期分隔带 / 刻度线的数量上限。坏数据（跨度极大）时防止渲染爆炸。 */
const MAX_AXIS_MARKS = 60;

/** 时间条的最小可见宽度：一根发丝线。**刻意很小**，见文件头。 */
const BAR_MIN_WIDTH = cssVar('border-width.thin');

export interface GanttChartProps {
  /** 已排好序、已算好偏移的条目。顺序 = 行序。 */
  entries: readonly TimelineEntry[];
  /**
   * 计划起始日（本地日历日，`YYYY-MM-DD`）。
   *
   * 给了就显示真实日期与钟点；不给就只显示相对偏移。
   * ⚠️ 它是**内存里的展示参数**，不是持久化字段（见 `buildTimeline.ts` 文件头）。
   */
  startDate?: LocalDate;
  /**
   * 计划从当天的第几分钟开始（0–1439）。默认 0（当天 00:00）。
   *
   * 只有同时给了 `startDate` 才有意义 —— 它让轴显示 `9:30` 这样的真实钟点，
   * 而不是从午夜数起。同样是**内存里的展示参数**。
   */
  startTimeMinutes?: number;
  /** 今天的本地日历日。只有同时给了 `startDate` 时才画"今天"。 */
  today?: LocalDate;
  /**
   * 强制使用的总跨度（分钟）。**多张图要对齐时用它。**
   *
   * 🔴 为什么必须有这个口子：条宽是**相对本图跨度**的百分比。
   * `TimelineView` 给每个任务画一张自己的图，如果每张图各自归一化，
   * 一条 90 分钟的任务和一条 30 分钟的任务**都会占满整行**（各自 100%），
   * 用户反而看不出谁更长 —— 恰好毁掉时间线要表达的东西。
   * 传入所有任务里最大的跨度，各图的条就落在同一个尺度上，可以互相比。
   *
   * 给了就取 `max(本图实际跨度, spanMinutes)`：**只会变宽，不会截断** ——
   * 万一调用方算错了，条也不会溢出容器。
   */
  spanMinutes?: number;
  /** 用于 `formatCompactDate` 判断"今年"的时间戳。默认 `Date.now()`。 */
  now?: number;
  /** 覆盖空态文案。 */
  emptyHint?: string;
}

/**
 * 校验一个本地日历日。**不合法就当作没给** —— 一个坏日期不该让整个视图崩掉。
 *
 * `parseLocalDate` 对越界日期（2 月 30 日、13 月）**抛错**而不是静默进位，
 * 所以这里必须 `try`，否则界面会因为一个脏参数整块白掉。
 */
function safeLocalDate(value: LocalDate | undefined): LocalDate | undefined {
  if (value === undefined) return undefined;
  try {
    parseLocalDate(value);
    return value;
  } catch {
    return undefined;
  }
}

/** 把起始钟点夹进 [0, 1439]。非法值当 0（当天 00:00）。 */
function normalizeClock(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  if (rounded <= 0) return 0;
  if (rounded >= MINUTES_PER_DAY) return MINUTES_PER_DAY - 1;
  return rounded;
}

/**
 * 分钟数 → 人话（`90 分钟` / `1 小时` / `1 小时 30 分`）。
 *
 * 同一个函数既用于工期，也用于轴上的**相对**偏移 —— 两种语境下
 * "90 分钟"和"1 小时 30 分"都是对的读法，所以不写两套。
 *
 * ⚠️ 导出给 `TimelineView` 用（它要在块头里写「AI 估时：90 分钟」）。
 * 宁可从这里导出，也**不要**在那边再写一份格式化 —— 同一份业务语义
 * 只能有一个实现（`ai-architecture.md` §14 第 19 条）。
 *
 * 🔴 现在多带一个 `t`：单位词（分钟 / 小时 / 分）是**文案**，必须在壳里取。
 * 这个函数原先直接返回中文字符串，于是英文界面上会出现「90 分钟」。
 * 单位用缩写（`min` / `h`）而不是 `minutes`/`hours`：
 * 缩写不随数量变化，一个词条就够，不需要单复数兄弟。
 */
export function formatMinutes(minutes: number, t: I18nValue['t']): string {
  if (minutes < MINUTES_PER_HOUR) return t('web.gantt.minutes', { count: minutes });
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;
  return rest === 0
    ? t('web.gantt.hours', { count: hours })
    : t('web.gantt.hoursMinutes', { hours, minutes: rest });
}

/** 当天第几分钟 → `9:30`。超过一天就绕回来（轴上的绝对钟点）。 */
function formatClock(minutesSinceMidnight: number): string {
  const wrapped =
    ((Math.round(minutesSinceMidnight) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(wrapped / MINUTES_PER_HOUR);
  const minutes = wrapped % MINUTES_PER_HOUR;
  return `${String(hours)}:${minutes < 10 ? '0' : ''}${String(minutes)}`;
}

/** 「09-26 9:30 → 11:00」。日期计算全部走领域层。 */
function formatRange(
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
function formatRelativeRange(
  startOffsetMinutes: number,
  durationMinutes: number,
  t: I18nValue['t'],
): string {
  return `${formatMinutes(startOffsetMinutes, t)} → ${formatMinutes(
    startOffsetMinutes + durationMinutes,
    t,
  )}`;
}

/** 条目名的键。用 `title` 是因为 `TimelineEntry.dependsOn` 就是按它引用的。 */
function indexByTitle(entries: readonly TimelineEntry[]): Map<string, TimelineEntry> {
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
function dayBands(
  span: number,
  startClock: number,
): { start: number; end: number; dayIndex: number }[] {
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
function axisTicks(
  span: number,
  startClock: number,
  hasStart: boolean,
  t: I18nValue['t'],
): { offset: number; label: string }[] {
  const step = span <= 2 * MINUTES_PER_HOUR ? 30 : span <= 6 * MINUTES_PER_HOUR ? 60 : 120;
  const ticks: { offset: number; label: string }[] = [];

  for (let offset = 0; offset <= span && ticks.length < MAX_AXIS_MARKS; offset += step) {
    ticks.push({
      offset,
      label: hasStart ? formatClock(startClock + offset) : formatMinutes(offset, t),
    });
  }

  return ticks;
}

/** 轴：单日画钟点刻度，跨天画日期分隔带。刻度线本身是装饰。 */
function TimelineAxis(props: {
  span: number;
  startClock: number;
  startDate: LocalDate | undefined;
  multiDay: boolean;
  now: number;
}): React.JSX.Element {
  const { span, startClock, startDate, multiDay, now } = props;
  const { t } = useI18n();

  if (multiDay) {
    return (
      <div
        data-testid="gantt-axis"
        aria-hidden="true"
        style={{ position: 'relative', height: cssVar('space.4') }}
      >
        {dayBands(span, startClock).map((band) => (
          <div
            key={band.dayIndex}
            data-testid={`gantt-day-${String(band.dayIndex)}`}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${String((band.start / span) * 100)}%`,
              width: `${String(((band.end - band.start) / span) * 100)}%`,
              // 第一天不画左边线：那是计划起点，不是"分隔"。
              ...(band.start === 0
                ? {}
                : { borderLeft: `${cssVar('border-width.thin')} solid ${cssVar('color.border')}` }),
              display: 'flex',
              alignItems: 'center',
              paddingLeft: cssVar('space.1'),
              fontSize: cssVar('font-size.2xs'),
              color: cssVar('color.foreground-subtle'),
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            {t('web.gantt.dayBand', { day: band.dayIndex })}
            {startDate === undefined
              ? ''
              : ` · ${formatCompactDate(
                  parseLocalDate(addDays(startDate, band.dayIndex - 1)).getTime(),
                  now,
                )}`}
          </div>
        ))}
      </div>
    );
  }

  const ticks = axisTicks(span, startClock, startDate !== undefined, t);
  return (
    <div
      data-testid="gantt-axis"
      aria-hidden="true"
      style={{ position: 'relative', height: cssVar('space.4') }}
    >
      {ticks.map((tick, index) => (
        <div
          key={tick.offset}
          data-testid={`gantt-tick-${String(tick.offset)}`}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${String((tick.offset / span) * 100)}%`,
            // 首尾刻度贴边，否则标签会被容器切掉一半。
            transform:
              index === 0
                ? 'translateX(0)'
                : index === ticks.length - 1
                  ? 'translateX(-100%)'
                  : 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            fontSize: cssVar('font-size.2xs'),
            color: cssVar('color.foreground-subtle'),
            whiteSpace: 'nowrap',
          }}
        >
          {tick.label}
        </div>
      ))}
    </div>
  );
}

export function GanttChart(props: GanttChartProps): React.JSX.Element {
  const { entries, startDate, startTimeMinutes, today, spanMinutes, now, emptyHint } = props;
  const { t } = useI18n();
  const clock = now ?? Date.now();

  // 坏日期 → 当作没给，而不是抛出去（见 safeLocalDate）。
  const safeStart = safeLocalDate(startDate);
  const safeToday = safeLocalDate(today);
  const startClock = normalizeClock(startTimeMinutes);

  // ── 空态：一句人话 ──────────────────────────────────────────────────
  if (entries.length === 0) {
    return (
      <div
        className="ht-gantt"
        data-testid="gantt-chart"
        role="group"
        aria-label={t('web.gantt.title')}
      >
        <p
          data-testid="gantt-empty"
          style={{
            margin: 0,
            color: cssVar('color.foreground-muted'),
            fontSize: cssVar('font-size.xs'),
          }}
        >
          {emptyHint ?? t('web.gantt.empty')}
        </p>
      </div>
    );
  }

  // 计划总跨度。至少一条最短工期，否则下面的百分比会除零。
  let span = MIN_DURATION_MINUTES;
  for (const entry of entries) {
    span = Math.max(span, entry.startOffsetMinutes + entry.durationMinutes);
  }
  // 多图对齐：只放宽，不截断（见 spanMinutes 的说明）。
  if (typeof spanMinutes === 'number' && Number.isFinite(spanMinutes) && spanMinutes > 0) {
    span = Math.max(span, spanMinutes);
  }

  const byTitle = indexByTitle(entries);
  const unestimatedCount = entries.filter((e) => e.durationSource === 'default').length;
  const aiCount = entries.filter((e) => e.durationSource === 'ai').length;
  const multiDay = span > MULTI_DAY_THRESHOLD_MINUTES;
  const totalText = formatMinutes(span, t);

  // 今天那一整天在计划里的区间（分钟）。计划起点是 startDate 的 startClock 分。
  const todayDayStart =
    safeStart !== undefined && safeToday !== undefined
      ? diffDays(safeStart, safeToday) * MINUTES_PER_DAY - startClock
      : undefined;
  // 与计划区间 [0, span) 有交集才画。**用区间相交**而不是"起点落在里面"：
  // 计划从今天 9:30 开始时，今天那一天的起点是负的，但它显然该被标出来。
  const todayVisible =
    todayDayStart !== undefined && todayDayStart < span && todayDayStart + MINUTES_PER_DAY > 0;
  const todayMarkerOffset = todayDayStart === undefined ? 0 : Math.max(0, todayDayStart);
  // 🔴 「第 N 天」按**日期差**算，不要按 `todayDayStart / 1440` 取整：
  // 计划从 9:30 起时 todayDayStart 是 -570，floor(-570/1440) = -1，会算出"第 0 天"。
  const todayDayIndex =
    safeStart !== undefined && safeToday !== undefined ? diffDays(safeStart, safeToday) + 1 : 1;

  return (
    <div
      className="ht-gantt"
      data-testid="gantt-chart"
      role="group"
      // 1 条要分支到单数词条：词条表没有 ICU（见 `web.gantt.spanOne`）。
      // ⚠️ 三元写在 `t(...)` 外面 —— 门禁只认"字面量紧跟 t("。
      aria-label={
        entries.length === 1
          ? t('web.gantt.aria.groupOne', { count: entries.length, total: totalText })
          : t('web.gantt.aria.group', { count: entries.length, total: totalText })
      }
      style={{ display: 'grid', gap: cssVar('space.2') }}
    >
      {/* ── 表头：文字承载全部关键信息 ─────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          gap: cssVar('space.2'),
        }}
      >
        <strong style={{ fontSize: cssVar('font-size.sm'), color: cssVar('color.foreground') }}>
          {t('web.gantt.title')}
        </strong>
        <span
          data-testid="gantt-span"
          style={{ fontSize: cssVar('font-size.xs'), color: cssVar('color.foreground-muted') }}
        >
          {entries.length === 1
            ? t('web.gantt.spanOne', { count: entries.length, total: totalText })
            : t('web.gantt.span', { count: entries.length, total: totalText })}
        </span>
        {safeStart !== undefined && (
          <span
            data-testid="gantt-range"
            style={{ fontSize: cssVar('font-size.xs'), color: cssVar('color.foreground-muted') }}
          >
            {t('web.gantt.rangeFrom', {
              when: `${formatCompactDate(parseLocalDate(safeStart).getTime(), clock)}${
                startClock > 0 ? ` ${formatClock(startClock)}` : ''
              }`,
            })}
          </span>
        )}
        {todayVisible && todayDayStart !== undefined && (
          <span
            data-testid="gantt-today"
            style={{ fontSize: cssVar('font-size.xs'), color: cssVar('color.warning') }}
          >
            {t('web.gantt.today', { day: todayDayIndex })}
          </span>
        )}
        {unestimatedCount > 0 && (
          <span
            data-testid="gantt-unestimated-summary"
            style={{ fontSize: cssVar('font-size.xs'), color: cssVar('color.foreground-muted') }}
          >
            {unestimatedCount === 1
              ? t('web.gantt.unestimatedSummaryOne', {
                  count: unestimatedCount,
                  duration: formatMinutes(DEFAULT_DURATION_MINUTES, t),
                })
              : t('web.gantt.unestimatedSummary', {
                  count: unestimatedCount,
                  duration: formatMinutes(DEFAULT_DURATION_MINUTES, t),
                })}
          </span>
        )}
        {aiCount > 0 && (
          <span
            data-testid="gantt-ai-summary"
            style={{ fontSize: cssVar('font-size.xs'), color: cssVar('color.foreground-muted') }}
          >
            {aiCount === 1
              ? t('web.gantt.aiSummaryOne', { count: aiCount })
              : t('web.gantt.aiSummary', { count: aiCount })}
          </span>
        )}
      </div>

      {/* ── 轴：与下面的条共享同一套百分比坐标 ─────────────────────── */}
      <TimelineAxis
        span={span}
        startClock={startClock}
        startDate={safeStart}
        multiDay={multiDay}
        now={clock}
      />

      {/* ── 每一条：文字在上，时间条在下 ───────────────────────────── */}
      <ol
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'grid',
          gap: cssVar('space.2'),
        }}
      >
        {entries.map((entry, index) => {
          // 🔴 百分比定位：90 分钟**一定**是 30 分钟的 3 倍宽（见文件头）。
          const left = (entry.startOffsetMinutes / span) * 100;
          const width = (entry.durationMinutes / span) * 100;

          // 依赖被违反：前置还没结束，它就开始了。
          // `buildTimeline` 不会产出这种数据，但本组件接受任意数组 —— 所以如实标出来。
          const predecessor =
            entry.dependsOn === undefined ? undefined : byTitle.get(entry.dependsOn);
          const overlaps =
            predecessor !== undefined &&
            predecessor.startOffsetMinutes + predecessor.durationMinutes >
              entry.startOffsetMinutes;

          return (
            <li
              key={`${String(index)}-${entry.title}`}
              data-testid={`gantt-row-${String(index)}`}
              style={{ display: 'grid', gap: cssVar('space.1') }}
            >
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'baseline',
                  gap: cssVar('space.2'),
                }}
              >
                <span
                  data-testid={`gantt-title-${String(index)}`}
                  style={{ fontSize: cssVar('font-size.sm'), color: cssVar('color.foreground') }}
                >
                  {entry.title}
                </span>

                {/* 工期：估过的说时长，没估的**必须**说"未估时"。 */}
                <span
                  data-testid={`gantt-duration-${String(index)}`}
                  style={{
                    fontSize: cssVar('font-size.xs'),
                    color: cssVar('color.foreground-muted'),
                  }}
                >
                  {/* 工期：估过的说时长，没估的**必须**说"未估时"。 */}
                  {entry.durationSource === 'default'
                    ? t('web.gantt.durationDefault', {
                        duration: formatMinutes(entry.durationMinutes, t),
                      })
                    : entry.durationSource === 'ai'
                      ? t('web.gantt.durationAi', {
                          duration: formatMinutes(entry.durationMinutes, t),
                        })
                      : t('web.gantt.durationManual', {
                          duration: formatMinutes(entry.durationMinutes, t),
                        })}
                </span>

                <span
                  data-testid={`gantt-dates-${String(index)}`}
                  style={{
                    fontSize: cssVar('font-size.xs'),
                    color: cssVar('color.foreground-subtle'),
                  }}
                >
                  {safeStart === undefined
                    ? formatRelativeRange(
                        entry.startOffsetMinutes,
                        entry.durationMinutes,
                        t,
                      )
                    : formatRange(
                        safeStart,
                        startClock,
                        entry.startOffsetMinutes,
                        entry.durationMinutes,
                        clock,
                      )}
                </span>

                {/* 依赖：文字，不是箭头颜色。 */}
                {entry.dependsOn !== undefined && (
                  <span
                    data-testid={`gantt-dep-${String(index)}`}
                    style={{
                      fontSize: cssVar('font-size.xs'),
                      color: cssVar('color.foreground-muted'),
                    }}
                  >
                    {t('web.gantt.dependsOn', { title: entry.dependsOn })}
                  </span>
                )}

                {overlaps && (
                  <span
                    data-testid={`gantt-overlap-${String(index)}`}
                    style={{ fontSize: cssVar('font-size.xs'), color: cssVar('color.warning') }}
                  >
                    {t('web.gantt.overlap')}
                  </span>
                )}
              </div>

              {/* 时间条本身是装饰：所有信息都在上面的文字里（见文件头）。 */}
              <div
                aria-hidden="true"
                style={{
                  position: 'relative',
                  height: cssVar('space.6'),
                  background: cssVar('color.surface-sunken'),
                  borderRadius: cssVar('radius.sm'),
                  overflow: 'hidden',
                }}
              >
                <div
                  data-testid={`gantt-bar-${String(index)}`}
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: `${String(left)}%`,
                    width: `${String(width)}%`,
                    minWidth: BAR_MIN_WIDTH,
                    background: cssVar('color.primary-subtle'),
                    border: `${cssVar('border-width.thin')} solid ${cssVar('color.primary')}`,
                    borderRadius: cssVar('radius.sm'),
                  }}
                />
                {todayVisible && (
                  <div
                    data-testid="gantt-today-line"
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: `${String((todayMarkerOffset / span) * 100)}%`,
                      width: cssVar('border-width.thick'),
                      background: cssVar('color.warning'),
                    }}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
