/**
 * GanttChart —— 四端共用的甘特图/时间线（共享层）
 * =================================================
 *
 * 与 AI 无关，也不该有关：它只把一份**已排好序、已算好偏移**的条目画成横向时间条。
 * 排程在 `@heyta/domain` 的 `buildTimeline`，规划在 `@heyta/app-host` 的
 * `planTimelineBlocks` —— 这里两个都不碰。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 条的宽度必须**看得出差别**
 *
 * 位置与宽度都是**百分比**（相对总跨度），所以 90 分钟的条**一定**是 30 分钟的
 * 3 倍宽，与容器宽度、与总跨度都无关。所以**不能**给条设一个"看起来还行"的
 * 最小宽度 —— 那会把短条全部抬到同一宽度。只用一根发丝线
 * （`border-width.thin`）兜底，它只在条细到亚像素时才生效。
 *
 * 🔴 不许只用颜色表达信息
 *
 * 色觉障碍用户看不出"这条是估的"或"这条依赖那条"。所以每一条**都带文字**：
 * 工期（估过/未估时）、依赖、与前置重叠、今天。彩色条与刻度线本身是
 * `aria-hidden` 的装饰；**读屏软件读到的是文字**。
 *
 * 🔴 文案全部由宿主注入（`labels`），本文件**不 import `@heyta/i18n`**
 * —— 理由见 `task-list/TaskList.tsx` 文件头（i18n 会拖进第二份 React）。
 *
 * 🔴 只用 RN 原语（`View` / `Text`），不 import 任何 DOM 标签。
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type DimensionValue } from 'react-native';
import {
  DEFAULT_DURATION_MINUTES,
  addDays,
  diffDays,
  formatCompactDate,
  parseLocalDate,
  type LocalDate,
  type TimelineEntry,
} from '@heyta/domain';

import { useHeytaText, useHeytaTokens } from '../theme.js';
import { EmptyState } from '../empty-state/EmptyState.js';
import {
  MINUTES_PER_DAY,
  MULTI_DAY_THRESHOLD_MINUTES,
  axisTicks,
  chartSpan,
  dayBands,
  formatClock,
  formatDuration,
  formatRange,
  formatRelativeRange,
  indexByTitle,
  normalizeClock,
  safeLocalDate,
  todayWindow,
  type GanttLabels,
} from './model.js';

/** 轴标签的固定宽度（dp）。用来给首/末刻度做贴近边缘的偏移。 */
const AXIS_LABEL_WIDTH = 64;

/**
 * 数字 → RN 的百分比维度。
 *
 * ⚠️ 必须走这个函数：RN 的 `DimensionValue` 是 `` `${number}%` `` 这个**模板字面量类型**，
 * 而 `${String(x)}%` 会被推断成宽泛的 `string`，编译期直接不过。
 */
function pct(value: number): DimensionValue {
  return `${value}%`;
}

export interface GanttChartProps {
  /** 已排好序、已算好偏移的条目。顺序 = 行序。 */
  readonly entries: readonly TimelineEntry[];
  /** 计划起始日。给了就显示真实日期与钟点；不给就只显示相对偏移。 */
  readonly startDate?: LocalDate;
  /** 计划从当天的第几分钟开始（0–1439）。只有同时给了 `startDate` 才有意义。 */
  readonly startTimeMinutes?: number;
  /** 今天的本地日历日。只有同时给了 `startDate` 时才画"今天"。 */
  readonly today?: LocalDate;
  /** 强制使用的总跨度（分钟）。多张图要对齐时用它（见 `model.chartSpan`）。 */
  readonly spanMinutes?: number;
  /** 用于 `formatCompactDate` 判断"今年"的时间戳。默认 `Date.now()`。 */
  readonly now?: number;
  /** 覆盖空态文案。 */
  readonly emptyHint?: string;
  /** 全部文案。**宿主注入**（见文件头）。 */
  readonly labels: GanttLabels;
  readonly testID?: string;
}

export function GanttChart(props: GanttChartProps): React.JSX.Element {
  const {
    entries,
    startDate,
    startTimeMinutes,
    today,
    spanMinutes,
    now,
    emptyHint,
    labels,
    testID,
  } = props;
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const clock = now ?? Date.now();

  // 坏日期 → 当作没给，而不是抛出去（见 model.safeLocalDate）。
  const safeStart = safeLocalDate(startDate);
  const safeToday = safeLocalDate(today);
  const startClock = normalizeClock(startTimeMinutes);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { gap: tokens['space.2'] },
        header: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          gap: tokens['space.2'],
        },
        axis: { position: 'relative', height: tokens['space.4'] },
        tick: {
          position: 'absolute',
          top: 0,
          bottom: 0,
          justifyContent: 'center',
          width: AXIS_LABEL_WIDTH,
        },
        axisLabel: { fontSize: tokens['font-size.2xs'], color: tokens['color.foreground-subtle'] },
        band: {
          position: 'absolute',
          top: 0,
          bottom: 0,
          justifyContent: 'center',
          paddingLeft: tokens['space.1'],
          overflow: 'hidden',
        },
        bandLabel: {
          fontSize: tokens['font-size.2xs'],
          color: tokens['color.foreground-subtle'],
        },
        list: { gap: tokens['space.2'] },
        row: { gap: tokens['space.1'] },
        rowMeta: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          gap: tokens['space.2'],
        },
        track: {
          position: 'relative',
          height: tokens['space.6'],
          backgroundColor: tokens['color.surface-sunken'],
          borderRadius: tokens['radius.sm'],
          overflow: 'hidden',
        },
        bar: {
          position: 'absolute',
          top: 0,
          bottom: 0,
          minWidth: tokens['border-width.thin'],
          backgroundColor: tokens['color.primary-subtle'],
          borderWidth: tokens['border-width.thin'],
          borderColor: tokens['color.primary'],
          borderRadius: tokens['radius.sm'],
        },
        todayLine: {
          position: 'absolute',
          top: 0,
          bottom: 0,
          width: tokens['border-width.thick'],
          backgroundColor: tokens['color.warning'],
        },
      }),
    [tokens],
  );

  // ── 空态：一句人话 ──────────────────────────────────────────────────
  if (entries.length === 0) {
    return (
      <View style={styles.root} role="group" aria-label={labels.title} testID={testID ?? 'gantt-chart'}>
        {/*
          🔴 用**共享** `EmptyState`，不手写一句 `<Text>` ——
          "空态只有一个实现"是仓库的判据（`check:empty-state`），
          而 `EmptyState` 的注释里就点名了 `gantt-empty` 这个 testID。
          `testID` 必须原样传进去：e2e 的定位钩子与门禁的登记项都靠它。
        */}
        <EmptyState title={emptyHint ?? labels.empty} testID="gantt-empty" />
      </View>
    );
  }

  const span = chartSpan(entries, spanMinutes);
  const byTitle = indexByTitle(entries);
  const unestimatedCount = entries.filter((e) => e.durationSource === 'default').length;
  const aiCount = entries.filter((e) => e.durationSource === 'ai').length;
  const multiDay = span > MULTI_DAY_THRESHOLD_MINUTES;
  const totalText = formatDuration(span, labels);

  const dayStart = todayWindow(safeStart, safeToday, startClock);
  // 与计划区间 [0, span) 有交集才画。**用区间相交**而不是"起点落在里面"。
  const todayVisible = dayStart !== undefined && dayStart < span && dayStart + MINUTES_PER_DAY > 0;
  const todayMarkerOffset = dayStart === undefined ? 0 : Math.max(0, dayStart);
  // 🔴 「第 N 天」按**日期差**算，不要按 `dayStart / 1440` 取整。
  const todayDayIndex =
    safeStart !== undefined && safeToday !== undefined ? diffDays(safeStart, safeToday) + 1 : 1;

  const ticks = axisTicks(span, startClock, safeStart !== undefined, labels);
  const bands = dayBands(span, startClock);

  return (
    <View
      style={styles.root}
      testID={testID ?? 'gantt-chart'}
      role="group"
      aria-label={labels.ariaGroup(entries.length, totalText)}
    >
      {/* ── 表头：文字承载全部关键信息 ─────────────────────────────── */}
      <View style={styles.header}>
        <Text style={[text.headline, { color: tokens['color.foreground'] }]}>{labels.title}</Text>
        <Text
          testID="gantt-span"
          style={[text.caption, { color: tokens['color.foreground-muted'] }]}
        >
          {labels.span(entries.length, totalText)}
        </Text>
        {safeStart !== undefined && (
          <Text
            testID="gantt-range"
            style={[text.caption, { color: tokens['color.foreground-muted'] }]}
          >
            {labels.rangeFrom(
              `${dateText(safeStart, clock)}${
                startClock > 0 ? ` ${formatClock(startClock)}` : ''
              }`,
            )}
          </Text>
        )}
        {todayVisible && (
          <Text
            testID="gantt-today"
            style={[text.caption, { color: tokens['color.warning-strong'] }]}
          >
            {labels.today(todayDayIndex)}
          </Text>
        )}
        {unestimatedCount > 0 && (
          <Text
            testID="gantt-unestimated-summary"
            style={[text.caption, { color: tokens['color.foreground-muted'] }]}
          >
            {labels.unestimated(unestimatedCount, formatDuration(DEFAULT_DURATION_MINUTES, labels))}
          </Text>
        )}
        {aiCount > 0 && (
          <Text
            testID="gantt-ai-summary"
            style={[text.caption, { color: tokens['color.foreground-muted'] }]}
          >
            {labels.aiSummary(aiCount)}
          </Text>
        )}
      </View>

      {/* ── 轴：与下面的条共享同一套百分比坐标 ─────────────────────── */}
      <View style={styles.axis} testID="gantt-axis" aria-hidden>
        {multiDay
          ? bands.map((band) => (
              <View
                key={band.dayIndex}
                testID={`gantt-day-${String(band.dayIndex)}`}
                style={[
                  styles.band,
                  {
                    left: pct((band.start / span) * 100),
                    width: pct(((band.end - band.start) / span) * 100),
                    // 第一天不画左边线：那是计划起点，不是"分隔"。
                    ...(band.start === 0
                      ? {}
                      : {
                          borderLeftWidth: tokens['border-width.thin'],
                          borderLeftColor: tokens['color.border'],
                        }),
                  },
                ]}
              >
                <Text style={styles.bandLabel} numberOfLines={1}>
                  {labels.day(band.dayIndex)}
                  {safeStart === undefined
                    ? ''
                    : ` · ${dateText(addDays(safeStart, band.dayIndex - 1), clock)}`}
                </Text>
              </View>
            ))
          : ticks.map((tick, index) => (
              <View
                key={tick.offset}
                testID={`gantt-tick-${String(tick.offset)}`}
                style={[
                  styles.tick,
                  {
                    left: pct((tick.offset / span) * 100),
                    // 首尾刻度贴边，否则标签会被容器切掉一半。
                    marginLeft:
                      index === 0 ? 0 : index === ticks.length - 1 ? -AXIS_LABEL_WIDTH : -AXIS_LABEL_WIDTH / 2,
                    alignItems:
                      index === 0 ? 'flex-start' : index === ticks.length - 1 ? 'flex-end' : 'center',
                  },
                ]}
              >
                <Text style={styles.axisLabel} numberOfLines={1}>
                  {tick.label}
                </Text>
              </View>
            ))}
      </View>

      {/* ── 每一条：文字在上，时间条在下 ───────────────────────────── */}
      <View style={styles.list} role="list">
        {entries.map((entry, index) => {
          // 🔴 百分比定位：90 分钟**一定**是 30 分钟的 3 倍宽（见文件头）。
          const left = (entry.startOffsetMinutes / span) * 100;
          const width = (entry.durationMinutes / span) * 100;

          // 依赖被违反：前置还没结束，它就开始了。
          const predecessor = entry.dependsOn === undefined ? undefined : byTitle.get(entry.dependsOn);
          const overlaps =
            predecessor !== undefined &&
            predecessor.startOffsetMinutes + predecessor.durationMinutes >
              entry.startOffsetMinutes;

          return (
            <View key={`${String(index)}-${entry.title}`} style={styles.row} testID={`gantt-row-${String(index)}`} role="listitem">
              <View style={styles.rowMeta}>
                <Text
                  testID={`gantt-title-${String(index)}`}
                  style={[text['row-title'], { color: tokens['color.foreground'] }]}
                >
                  {entry.title}
                </Text>

                {/* 工期：估过的说时长，没估的**必须**说"未估时"。 */}
                <Text
                  testID={`gantt-duration-${String(index)}`}
                  style={[text.caption, { color: tokens['color.foreground-muted'] }]}
                >
                  {entry.durationSource === 'default'
                    ? labels.durationDefault(formatDuration(entry.durationMinutes, labels))
                    : entry.durationSource === 'ai'
                      ? labels.durationAi(formatDuration(entry.durationMinutes, labels))
                      : labels.durationManual(formatDuration(entry.durationMinutes, labels))}
                </Text>

                <Text
                  testID={`gantt-dates-${String(index)}`}
                  style={[text.caption, { color: tokens['color.foreground-subtle'] }]}
                >
                  {safeStart === undefined
                    ? formatRelativeRange(entry.startOffsetMinutes, entry.durationMinutes, labels)
                    : formatRange(
                        safeStart,
                        startClock,
                        entry.startOffsetMinutes,
                        entry.durationMinutes,
                        clock,
                      )}
                </Text>

                {/* 依赖：文字，不是箭头颜色。 */}
                {entry.dependsOn !== undefined && (
                  <Text
                    testID={`gantt-dep-${String(index)}`}
                    style={[text.caption, { color: tokens['color.foreground-muted'] }]}
                  >
                    {labels.dependsOn(entry.dependsOn)}
                  </Text>
                )}

                {overlaps && (
                  <Text
                    testID={`gantt-overlap-${String(index)}`}
                    style={[text.caption, { color: tokens['color.warning-strong'] }]}
                  >
                    {labels.overlap}
                  </Text>
                )}
              </View>

              {/* 时间条本身是装饰：所有信息都在上面的文字里（见文件头）。 */}
              <View style={styles.track} aria-hidden>
                <View
                  testID={`gantt-bar-${String(index)}`}
                  style={[
                    styles.bar,
                    { left: pct(left), width: pct(width) },
                  ]}
                />
                {todayVisible && (
                  <View
                    testID="gantt-today-line"
                    style={[
                      styles.todayLine,
                      { left: pct((todayMarkerOffset / span) * 100) },
                    ]}
                  />
                )}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** `formatCompactDate` 只吃时间戳；这里把 `LocalDate` 转过去。日期本身来自领域层。 */
function dateText(date: LocalDate, now: number): string {
  return formatCompactDate(parseLocalDate(date).getTime(), now);
}
