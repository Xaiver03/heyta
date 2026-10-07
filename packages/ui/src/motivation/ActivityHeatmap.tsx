/**
 * 年度活动热力图（共享视图，L3 中周期）
 * =======================================
 *
 * 「我一直是个在做事的人吗」的出口：滚动一年、每天一格，颜色深浅代表那天做了几件
 * （打卡 + 完成任务 + 专注轮次）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这一块是 web **独有**的能力，mobile 迁移前没有
 *
 * web 的 `GrowthView.tsx` 用 `react-activity-calendar`（MIT）画它，数据来自
 * `selectYearActivity(entities, now, 365)`；而 `apps/mobile/src/screens/GrowthScreen.tsx`
 * 里**没有年度视图**（它只有 L1 / L2 / 里程碑 / 身份）。
 * 所以与 `HabitStreakList` 对称：这次是把 web 的能力补进共享层。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 自绘（RN 原语），不是 `react-activity-calendar`
 *
 * 那个库是 **DOM 库**，装进共享层等于让 iOS/鸿蒙去画 DOM —— 与"只用 RN 原语"
 * 直接冲突（`packages/ui` 也不允许新增依赖）。与 `habits/HabitBoard.tsx`
 * 的热力图同一个决定：53 列 × 7 格的方块用 `View` 就够，**连 SVG 都不用**。
 *
 * ⚠️ 由此带来的**真实落差**：`react-activity-calendar` 的悬停提示随之消失。
 * 补回来的方式沿用 `CategoryReportView` / `HabitBoard` 那条路 ——
 * `cellTooltip` 写 `data-cell-title`，由**宿主 CSS** 的 `::after` 显示；
 * mobile 没有鼠标就不传（不产出属性）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 格子布局**复用习惯热力图的唯一实现**（`habits/model.ts#toHeatmapWeeks`）
 *
 * "一维日期序列 → 二维周列 + 跨月打标签"这件事已经有一份实现，而且它的文件头
 * 把"补齐首尾"与"月份只在变了的列打"写成了契约。这里再写一遍就是第二份，
 * 两份一定会在某一处漂移（补 null 的时机最难对齐），而症状是"网格看起来是斜的"
 * —— 不报错。颜色映射同理走 `habits/model.ts#heatmapLevelToken`。
 *
 * ⚠️ 唯一的口径差异在**分档**：习惯卡是二值（打过 = 4，没打 = 0），
 * 而这里是 0 / 1 / 2 / 3 / 4+（`model.ts#activityLevel`）。档位色阶
 * （`HEAT_TOKENS`）两者共用。
 *
 * 🔴 文案一律由宿主注入（理由见 `TodayProgressCard`）；本文件不 import `@heyta/i18n`
 * 🔴 只用 RN 原语（`View` / `Text` / `StyleSheet`）
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type ViewProps } from 'react-native';
import type { HeytaNativeTokens } from '@heyta/design-system';
import type { LocalDate } from '@heyta/domain';
import { heatmapLevelToken, toHeatmapWeeks } from '../habits/model.js';
import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import { activityHeatmapTotal, toActivityHeatmapDays, type ActivityDayCount } from './model.js';

/**
 * 把提示文案变成 `data-cell-title` 属性（不给就返回空对象）。
 *
 * ⚠️ **为什么必须 cast**：`dataSet` 是 **react-native-web 专有**的 prop，
 * `react-native` 自己的 `ViewProps` 里没有它 —— 不 cast 过不了 TS。
 * 与 `habits/HabitBoard.tsx` 逐字同一个理由与写法。
 */
function dataCellTitle(value: string | undefined): ViewProps {
  return value === undefined ? {} : ({ dataSet: { cellTitle: value } } as unknown as ViewProps);
}

/** 面板全部文案，**每一项都由宿主注入**（与 `HabitHeatmapLabels` 同形状）。 */
export interface ActivityHeatmapLabels {
  /** 月份标签（`1`–`12`）。只在"月份变了"的那一列调用。 */
  readonly month: (month: number) => string;
  /** 整块热力图给屏幕阅读器的那一句（含窗口长度与总数）。 */
  readonly grid: (info: { readonly total: number; readonly days: number }) => string;
  /** 每一格的确切数字（悬停提示）。省略 = 不产出 `data-cell-title`。 */
  readonly cellTooltip?: (info: {
    readonly date: LocalDate;
    readonly count: number;
  }) => string;
  /** 图例两端的字。**两项都给**才渲染图例整行。 */
  readonly less?: string;
  readonly more?: string;
  /** 窄容器中提示用户横向滚动，并作为滚动区域的无障碍提示。 */
  readonly scrollHint?: string;
}

export interface ActivityHeatmapProps {
  /**
   * `@heyta/app-host#dailyActivityCountsFromState` 的输出（结构同
   * {@link ActivityDayCount}）—— 已按旧 → 新排好、并补齐了窗口内每一天。
   */
  readonly days: readonly ActivityDayCount[];
  readonly labels: ActivityHeatmapLabels;
  readonly testID?: string;
}

/** 取一份 token 表，建出这套样式。**一个裸值都没有**（`check:design` 会拦）。 */
function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    wrap: {
      gap: tokens['space.1'],
      padding: tokens['space.3'],
      borderRadius: tokens['radius.lg'],
      backgroundColor: tokens['color.surface'],
    },
    months: {
      flexDirection: 'row',
      gap: tokens['space.1'],
    },
    monthCell: {
      width: tokens['icon.xs'],
    },
    grid: {
      flexDirection: 'row',
      gap: tokens['space.1'],
    },
    week: {
      flexDirection: 'column',
      gap: tokens['space.1'],
    },
    cell: {
      width: tokens['icon.xs'],
      height: tokens['icon.xs'],
      borderRadius: tokens['radius.sm'],
    },
    cellSelected: {
      backgroundColor: tokens['color.primary-subtle'],
    },
    legend: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.1'],
    },
    legendCell: {
      width: tokens['space.3'],
      height: tokens['space.3'],
      borderRadius: tokens['radius.sm'],
    },
    scrollContent: {
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: tokens['space.1'],
    },
    scrollHint: {
      color: tokens['color.foreground-subtle'],
    },
    selection: {
      color: tokens['color.foreground-muted'],
    },
  });
}

type HeatmapKeyEvent = {
  readonly key: string;
  readonly preventDefault: () => void;
};

/** `onKeyDown` is a web-only enhancement; native hosts ignore the cast prop. */
function keyboardProps(onKeyDown: (event: HeatmapKeyEvent) => void): ViewProps {
  return { onKeyDown } as unknown as ViewProps;
}

/** `onWheel` is a web-only enhancement; native hosts ignore the cast prop. */
function wheelProps(onWheel: () => void): ViewProps {
  return { onWheel } as unknown as ViewProps;
}

type HeatmapLayoutEvent = {
  readonly nativeEvent: {
    readonly layout: {
      readonly width: number;
    };
  };
};

export function ActivityHeatmap({
  days,
  labels,
  testID,
}: ActivityHeatmapProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  // 分档与周列排布全部由纯函数给，这里只负责摆。
  const mapped = useMemo(() => toActivityHeatmapDays(days), [days]);
  const weeks = useMemo(() => toHeatmapWeeks(mapped), [mapped]);
  const total = activityHeatmapTotal(mapped);
  const { less, more, scrollHint } = labels;
  const scrollRef = useRef<ScrollView>(null);
  const [selectedDate, setSelectedDate] = useState<LocalDate | null>(null);
  const [isHorizontallyScrollable, setIsHorizontallyScrollable] = useState(false);
  const viewportWidth = useRef(0);
  const contentWidth = useRef(0);
  const initialPositioned = useRef(false);
  const manualNavigation = useRef(false);

  const updateOverflowAndInitialPosition = useCallback(() => {
    const nextScrollable = contentWidth.current > viewportWidth.current;
    setIsHorizontallyScrollable((current) => (current === nextScrollable ? current : nextScrollable));

    // The source is ordered oldest → newest. Keep the latest weeks discoverable
    // after both dimensions are known, exactly once. Later responsive layout
    // changes must not pull the user back to the end of the year.
    if (
      initialPositioned.current ||
      manualNavigation.current ||
      viewportWidth.current <= 0 ||
      contentWidth.current <= 0 ||
      scrollRef.current === null
    ) return;
    initialPositioned.current = true;
    scrollRef.current.scrollToEnd({ animated: false });
  }, []);

  const disableAutomaticPositioning = useCallback(() => {
    manualNavigation.current = true;
  }, []);

  const handleLayout = useCallback((event: HeatmapLayoutEvent) => {
    viewportWidth.current = event.nativeEvent.layout.width;
    updateOverflowAndInitialPosition();
  }, [updateOverflowAndInitialPosition]);

  const handleContentSizeChange = useCallback((width: number) => {
    contentWidth.current = width;
    updateOverflowAndInitialPosition();
  }, [updateOverflowAndInitialPosition]);

  useEffect(() => {
    if (selectedDate !== null && mapped.some((day) => day.date === selectedDate)) return;
    setSelectedDate(null);
  }, [mapped, selectedDate]);

  const selectDateAt = useCallback(
    (index: number) => {
      const day = mapped[index];
      if (day === undefined) return;
      disableAutomaticPositioning();
      setSelectedDate(day.date);
      const weekIndex = weeks.findIndex((week) => week.days.some((candidate) => candidate?.date === day.date));
      if (weekIndex >= 0) {
        scrollRef.current?.scrollTo({
          x: weekIndex * (Number(tokens['icon.xs']) + Number(tokens['space.1'])),
          animated: false,
        });
      }
    },
    [disableAutomaticPositioning, mapped, weeks, tokens],
  );

  const onHeatmapKeyDown = useCallback(
    (event: HeatmapKeyEvent) => {
      if (mapped.length === 0) return;
      const current = selectedDate === null ? mapped.length - 1 : mapped.findIndex((day) => day.date === selectedDate);
      const index = current < 0 ? mapped.length - 1 : current;
      // Weeks are columns and days are rows: horizontal movement crosses one
      // full week, while vertical movement crosses one day in the same column.
      const delta = event.key === 'ArrowLeft' ? -7 : event.key === 'ArrowRight' ? 7 : event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
      const target = event.key === 'Home' ? 0 : event.key === 'End' ? mapped.length - 1 : Math.max(0, Math.min(mapped.length - 1, index + delta));
      if (delta === 0 && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      selectDateAt(target);
    },
    [mapped, selectedDate, selectDateAt],
  );

  const selectedDay = selectedDate === null ? undefined : mapped.find((day) => day.date === selectedDate);

  return (
    <View style={styles.wrap} testID={testID}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator
        contentContainerStyle={styles.scrollContent}
        role="region"
        tabIndex={0}
        accessibilityLabel={labels.grid({ total, days: mapped.length })}
        accessibilityHint={isHorizontallyScrollable ? scrollHint : undefined}
        {...keyboardProps(onHeatmapKeyDown)}
        {...wheelProps(disableAutomaticPositioning)}
        onLayout={handleLayout}
        onContentSizeChange={handleContentSizeChange}
        onScrollBeginDrag={disableAutomaticPositioning}
        testID={testID === undefined ? undefined : `${testID}-scroll`}
      >
        <View>
          {/* 月份标签与格子**同一套列宽**，否则标签会与它标注的那一列错开。 */}
          <View style={styles.months} accessible={false}>
            {weeks.map((week, index) => (
              <View key={`m-${String(index)}`} style={styles.monthCell}>
                {week.month === undefined ? null : (
                  <Text
                    numberOfLines={1}
                    testID="growth-heatmap-month"
                    style={[text.caption, {
                      color: tokens['color.foreground-muted'],
                      width: tokens['space.8'],
                      minWidth: tokens['space.8'],
                      marginLeft: Math.min(0,
                        (weeks.length - index) * (Number(tokens['icon.xs']) + Number(tokens['space.1']))
                        - Number(tokens['space.1']) - Number(tokens['space.8'])),
                    }]}
                  >
                    {labels.month(week.month)}
                  </Text>
                )}
              </View>
            ))}
          </View>

          <View style={styles.grid}>
            {weeks.map((week, weekIndex) => (
              <View key={`w-${String(weekIndex)}`} style={styles.week}>
                {week.days.map((day, dayIndex) =>
                  day === null ? (
                    // 补齐的空位：它不是"那天活动为 0"，是"那一格不属于这个窗口"。
                    <View key={`e-${String(dayIndex)}`} style={styles.cell} />
                  ) : (
                    <Pressable
                      key={day.date}
                      style={[
                        styles.cell,
                        day.date === selectedDate ? styles.cellSelected : null,
                        { backgroundColor: tokens[heatmapLevelToken(day.level)] },
                      ]}
                      // The region owns the single keyboard stop. Cells stay
                      // touchable without adding 365 tab stops on web.
                      accessible={false}
                      focusable={false}
                      tabIndex={-1}
                      onPress={() => {
                        disableAutomaticPositioning();
                        setSelectedDate(day.date);
                      }}
                      testID={`activity-cell-${day.date}`}
                      {...dataCellTitle(
                        labels.cellTooltip === undefined
                          ? undefined
                          : labels.cellTooltip({ date: day.date, count: day.count }),
                      )}
                    />
                  ),
                )}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      {selectedDay === undefined || labels.cellTooltip === undefined ? null : (
        <Text
          style={[text.caption, styles.selection]}
          accessibilityLiveRegion="polite"
          testID={testID === undefined ? undefined : `${testID}-selection`}
        >
          {labels.cellTooltip({ date: selectedDay.date, count: selectedDay.count })}
        </Text>
      )}

      {!isHorizontallyScrollable || scrollHint === undefined ? null : (
        <Text style={[text.caption, styles.scrollHint]} testID="growth-heatmap-scroll-hint">
          {scrollHint}
        </Text>
      )}

      {/*
        图例（少 → 多）。🔴 它与格子用**同一个**「档位 → heat token」映射，
        不另抄一份色阶（抄一份就会在改色时只改一处）。
      */}
      {less === undefined || more === undefined ? null : (
        <View style={styles.legend}>
          <Text style={[text.caption, { color: tokens['color.foreground-muted'] }]}>{less}</Text>
          {([0, 1, 2, 3, 4] as const).map((level) => (
            <View
              key={`legend-${String(level)}`}
              style={[styles.legendCell, { backgroundColor: tokens[heatmapLevelToken(level)] }]}
            />
          ))}
          <Text style={[text.caption, { color: tokens['color.foreground-muted'] }]}>{more}</Text>
        </View>
      )}
    </View>
  );
}
