/**
 * 习惯**年**视图：12 张月卡（工单 H7）
 * ===================================
 *
 * 它回答的是"这一年里，这条习惯哪几个月真的在过、过成什么样"。
 * 与月历那块板的分工不是"更小的月历"：
 *
 * | | 月那一档 | 年那一档 |
 * |---|---|---|
 * | 问的问题 | 这一天能不能补 | 这一月过成了什么样 |
 * | 一格里 | 一个可点的日子 | 一个月的三个数 |
 * | 上限 | 42 格 | 12 张卡（`MONTHS_PER_YEAR`） |
 *
 * 🔴 **数全部来自 `@heyta/domain#habitYearRows`**，而那一层又只是逐月调用
 * `computeHabitPeriodStats`。本文件里没有一行"这个月打了几天"的算术 ——
 * 那是第二套裁决（AGENTS §3.5），也是 Y3 那条判据专门挡的东西。
 *
 * 🔴 **未来那几个月画"还没到"，不画 0%**。分母为 0 时率是 0 是领域层的既有裁决
 * （`HabitPeriodStats.rate` 的注释），但"0%"与"还没开始"在界面上是两句话 ——
 * 把后者写成前者就是界面在说谎。
 *
 * ## 点一张年卡 = 把游标交给月那一档
 *
 * 与日历年档同一条立场（`CalendarYearBoard` 文件头）：总览点下去必须有去处，
 * 否则它是一条死胡同。游标由**容器** `HabitTrendBoard` 持有，所以这里只需要
 * `onPickMonth(monthKey)`；而**未来那几个月不可点**（去了也没有可补的日子）。
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { HeytaNativeTokens } from '@heyta/design-system';
import {
  habitYearRows,
  habitYearSummary,
  type Habit,
  type HabitLog,
  type HabitYearRow,
  type LocalDate,
} from '@heyta/domain';

import { useHeytaText, useHeytaTokens } from '../theme.js';

export interface HabitYearLabels {
  /** 整块年视图的读数（习惯名 + 年）。 */
  readonly grid: (info: { readonly name: string; readonly year: string }) => string;
  /** 标题里那一年（"2026 年"）。 */
  readonly yearTitle: (year: number) => string;
  /** 月份名：领域层给 `'YYYY-MM'`，宿主决定念成"3月"还是"Mar"。 */
  readonly monthName: (monthKey: string) => string;
  /** 卡上那行"达成 N 天"。 */
  readonly achieved: (days: number) => string;
  /** 卡上那行完成率（整数百分比）。 */
  readonly rate: (percent: number) => string;
  /** 分母为 0 且**不是**未来月（这月一天都不归它管 / 还没创建）：界面画这个，不画 0%。 */
  readonly noDenominator: string;
  /** 这一整月还没到。 */
  readonly future: string;
  /** 一张卡的完整读数（三个数 + 状态），给读屏一次念完。 */
  readonly card: (info: {
    readonly monthName: string;
    readonly achievedDays: number;
    readonly scheduledDays: number;
    readonly rateText: string;
  }) => string;
  /** 上一 / 下一年那颗按钮的名字。 */
  readonly prevYear: string;
  readonly nextYear: string;
  /** 年汇总那一行。 */
  readonly summary: (info: {
    readonly achievedDays: number;
    /** 已经算好的那半句（"完成率 42%" / "这个月还没有可算的日" / "还没到这个月"）。 */
    readonly rateText: string;
  }) => string;
}

export interface HabitYearBoardProps {
  readonly habit: Habit;
  readonly logs: readonly HabitLog[];
  /** 今天：**显式传入**，与月历那块板同一条理由（跨午夜与测试都要可复现）。 */
  readonly today: LocalDate;
  /** 看哪一年。由容器从游标推出来（`Number(cursor.slice(0,4))`），宿主不另存一份。 */
  readonly year: number;
  readonly labels: HabitYearLabels;
  /** 点一张年卡 ⇒ 交给月那一档。必填：不给就没有"点了没反应"这条路。 */
  readonly onPickMonth: (monthKey: string) => void;
  /**
   * 换看另一年。与 {@link onPickMonth} **分开的两枚回调**，
   * 因为它们是两件不同的事：点卡是"我要去看这一月的日子"（换档 + 换游标），
   * 按 ‹ › 是"我还在年这一档，只是换一年"（不换档）。
   * 合成一枚 `onCursorChange` 会让容器猜哪一种是哪种。
   */
  readonly onYearChange: (year: number) => void;
  readonly busy?: boolean;
  readonly testID: string;
}

/** 一格的三个色（全部是 token 名，没有一个裸值 —— `check:design` 会拦）。 */
function cardColors(
  row: HabitYearRow,
  tokens: HeytaNativeTokens,
): { backgroundColor: string; titleColor: string; metaColor: string } {
  /* 🔴 编码**跟着月历那一档走**，不跟"到期没到期"走。
     `HabitMonthBoard` 的 `cellColors` 里 `primary-subtle` 说的是"这一格还能补"，
     `disabled-bg` + `disabled-fg` 说的是"还没到 / 已超过窗口"。年这一档若把
     `primary-subtle` 用来标"这是过去的月"，同一个色就在两个视图里说了两件事
     （月历文件头自己写着"同一个'打过'在两个视图里必须长一个样"）。
     ⇒ 未来那几张沿用 `disabled-*`（两块板里的"还没到"长得一样），
       过去的卡用 `surface` + 边框：颜色不承载声明，声明由那三个数字说。 */
  if (row.inFuture) {
    return {
      backgroundColor: tokens['color.disabled-bg'],
      titleColor: tokens['color.disabled-fg'],
      metaColor: tokens['color.disabled-fg'],
    };
  }
  return {
    backgroundColor: tokens['color.surface'],
    titleColor: tokens['color.foreground'],
    metaColor: tokens['color.foreground-muted'],
  };
}

function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    board: {
      gap: tokens['space.2'],
    },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: tokens['space.2'],
    },
    nav: {
      flexDirection: 'row',
      gap: tokens['space.1'],
    },
    navButton: {
      minWidth: tokens['touch-target.min'],
      minHeight: tokens['touch-target.min'],
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: tokens['radius.md'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
    },
    /* 一排几枚由 `card` 那一条定（百分比），这里只负责"能换行"。
       为什么不是定宽轨道：频次面板那一排（H5）与图标那一排（H3）为"定宽轨道在窄窗格里
       溢出"各记过一次账，而年这一档有 12 枚，正是最容易再犯一次的形状。
       e2e 那条判据量的是"每枚的右边界都在窗格内"，另加一条"12 枚全在折叠线以上"。 */
    cards: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: tokens['space.2'],
    },
    card: {
      /* 🔴 两枚一排，宽度是**百分比**而不是定宽轨道：`47% × 2 + 一枚 space.2 的空隙`
         永远不超过 100%，所以它**溢出不了自己那一格**（H3/H5 记过的那笔是定宽轨道
         溢出窄窗格，这一版不犯同一条），`flexGrow` 再把余下的 6% 摊平。
       🔴 `minWidth: 0` 是这条布局**承重**的那一项，少了它就退化成一排一枚：
         flex 项默认 `min-width: auto` = 不许收缩到 min-content 以下，而这一格最长的
         那行字在 288px 的详情栏里 min-content ≈ 200px，于是第二枚挤不进同一行
         ⇒ 12 枚摞成一列 ≈ 1020px 高，而视口只有 720px。那不只是难看：
         年视图那张**元素截图**拍到第 7 枚就被视口裁掉，而 S4 断言的「当前那一月」
         根本不在图上 —— 图证与判据各说一套（AGENTS §6.2 规定一）。 */
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: '47%',
      minWidth: 0,
      gap: tokens['space.1'],
      padding: tokens['space.2'],
      borderRadius: tokens['radius.md'],
      borderWidth: tokens['border-width.thin'],
    },
    cardCurrent: {
      borderWidth: tokens['border-width.thick'],
    },
    summary: {
      textAlign: 'left',
    },
  });
}

export function HabitYearBoard({
  habit,
  logs,
  today,
  year,
  labels,
  onPickMonth,
  onYearChange,
  busy = false,
  testID,
}: HabitYearBoardProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = makeStyles(tokens);

  const rows = useMemo(
    () => habitYearRows(habit, logs, today, year),
    [habit, logs, today, year],
  );
  const summary = useMemo(() => habitYearSummary(rows), [rows]);
  const currentMonthKey = today.slice(0, 7);
  // 不许翻进未来那一年：那里 12 张卡全是"还没到"，是一条只能看不能用的死胡同。
  const nextCapped = year >= Number(today.slice(0, 4));
  const summaryRateText =
    summary.scheduledDays === 0 ? labels.noDenominator : labels.rate(Math.round(summary.rate * 100));

  return (
    <View
      style={styles.board}
      testID={testID}
      accessibilityRole="summary"
      accessibilityLabel={labels.grid({ name: habit.name, year: labels.yearTitle(year) })}
    >
      <View style={styles.head}>
        <Text style={[text['section-title'], { color: tokens['color.foreground'] }]}>
          {labels.yearTitle(year)}
        </Text>
        <View style={styles.nav}>
          <Pressable
            onPress={() => {
              onYearChange(year - 1);
            }}
            accessibilityRole="button"
            accessibilityLabel={labels.prevYear}
            testID={`${testID}-prev`}
            style={styles.navButton}
          >
            <Text style={[text['row-meta'], { color: tokens['color.foreground'] }]}>‹</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              if (nextCapped) return;
              onYearChange(year + 1);
            }}
            accessibilityRole="button"
            accessibilityLabel={labels.nextYear}
            disabled={busy || nextCapped}
            testID={`${testID}-next`}
            style={styles.navButton}
          >
            <Text style={[text['row-meta'], { color: tokens['color.foreground'] }]}>›</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.cards}>
        {rows.map((row) => {
          const name = labels.monthName(row.monthKey);
          const rateText = row.inFuture
            ? labels.future
            : row.scheduledDays === 0
              ? labels.noDenominator
              : labels.rate(Math.round(row.rate * 100));
          const tappable = !row.inFuture && !busy;
          const colors = cardColors(row, tokens);
          return (
            <Pressable
              key={row.monthKey}
              onPress={() => {
                if (!tappable) return;
                onPickMonth(row.monthKey);
              }}
              accessibilityRole="button"
              accessibilityLabel={labels.card({
                monthName: name,
                achievedDays: row.achievedDays,
                scheduledDays: row.scheduledDays,
                rateText,
              })}
              disabled={!tappable}
              testID={`${testID}-month-${row.monthKey}`}
              style={[
                styles.card,
                {
                  backgroundColor: colors.backgroundColor,
                  borderColor:
                    row.monthKey === currentMonthKey
                      ? tokens['color.primary']
                      : tokens['color.border-subtle'],
                },
                row.monthKey === currentMonthKey ? styles.cardCurrent : undefined,
              ]}
            >
              <Text style={[text['row-title'], { color: colors.titleColor }]}>{name}</Text>
              <Text
                style={[text['row-meta'], { color: colors.metaColor }]}
                testID={`${testID}-achieved-${row.monthKey}`}
              >
                {labels.achieved(row.achievedDays)}
              </Text>
              <Text
                style={[text['row-meta'], { color: colors.metaColor }]}
                testID={`${testID}-rate-${row.monthKey}`}
              >
                {rateText}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[text['row-meta'], styles.summary, { color: tokens['color.foreground-muted'] }]}>
        {labels.summary({ achievedDays: summary.achievedDays, rateText: summaryRateText })}
      </Text>
    </View>
  );
}
