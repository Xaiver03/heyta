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

import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type ViewProps } from 'react-native';
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
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
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
  });
}

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
  const { less, more } = labels;

  return (
    <View style={styles.wrap} testID={testID}>
      {/* 月份标签与格子**同一套列宽**，否则标签会与它标注的那一列错开。 */}
      <View
        style={styles.months}
        accessible
        accessibilityLabel={labels.grid({ total, days: mapped.length })}
      >
        {weeks.map((week, index) => (
          <View key={`m-${String(index)}`} style={styles.monthCell}>
            {week.month === undefined ? null : (
              <Text style={[text.caption, { color: tokens['color.foreground-muted'] }]}>
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
                <View
                  key={day.date}
                  style={[
                    styles.cell,
                    { backgroundColor: tokens[heatmapLevelToken(day.level)] },
                  ]}
                  // 格子本身对读屏是装饰性的：整块有一句总述，
                  // 365 个格子的逐条读数只会把信息埋掉。
                  accessible={false}
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
