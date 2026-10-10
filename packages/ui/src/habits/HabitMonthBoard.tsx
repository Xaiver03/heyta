/**
 * 习惯月历 + 可点补打卡（共享视图，工单 H4）
 * ==========================================
 *
 * ## 为什么是共享组件而不是"web 先做一版"
 *
 * 热力图（`HabitBoard` 里那 13 列 × 7 行）**只回答"打过没有"**，格子是 16px 的装饰性 `View`，
 * 不可点。而"补打卡"要的是**按日期点某一格**，那就必须有一张真的月历：
 * 格子要够高才点得着（44px；宽度在窄栏里按列分摊，理由见 `makeStyles().cell`）、
 * 要能翻月、要能说清"这天为什么不能点"。
 * 两端各写一张月历 = 两套"这天能不能补"的裁决（AGENTS §3.5），而判定已经在
 * `@heyta/domain#habitDayState` 收成一个了，视图没必要再分一次。
 *
 * ## 🔴 数学全部来自 `@heyta/domain#monthGrid`
 *
 * 本文件里没有一行"补白格属于哪个月""周一起头还是周日起头"。
 * 那些是 `monthGrid` 的活（`date-picker/DatePicker` 与 `calendar/CalendarBoard` 用的同一份）。
 *
 * ## 🔴 "不能点"要写 `disabled`，不要写平铺 `aria-disabled`，也不要写 `accessibilityState`
 *
 * 两条都是实测：
 *   · `accessibilityState` / `accessibilityValue` 这类**对象形态**在 RNW 0.21 上会被
 *     整个丢掉（`HabitBoard.tsx:764` 那条），所以选中态那类要写平铺 `aria-*`；
 *   · 而**禁用态**反过来：直接写平铺 `aria-disabled` 不落 DOM（本单第一版在 jsdom 里
 *     读到 `null`），要写 `disabled` —— RNW 的 `Pressable` 把它映射成
 *     `aria-disabled="true"`（`apps/web/tests/habits-board.spec.tsx:293` 早就钉过这条），
 *     RN 原生侧同时挡住按下。两边各要一种写法，是因为它们回答的是两件事：
 *     "现在是什么状态"（属性）与"这个控件还可不可以按"（行为）。
 *
 * ## 🔴 文案由宿主注入
 *
 * `packages/ui` 不许 `import '@heyta/i18n'`（会拖进第二份 React，见 `calendar/model.ts` 文件头）。
 * `labels` 全是**函数**：月标题、格子读数、窗口提示都是动态的。
 *
 * ## 为什么"不能点"也要说出来
 *
 * 三档不可点各有理由（还没到 / 这天本来不用打 / 超过补打卡窗口）。
 * 只把格子画灰而什么都不说，用户会以为应用坏了 —— 这正是本仓库反复栽过的
 * "点了没反应"那一族。所以每格的读数说得出它**为什么**不能点。
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { HEAT_TOKENS, type HeytaNativeTokens } from '@heyta/design-system';
import { addMonths, type Habit, type HabitDayState, type HabitLog, type LocalDate } from '@heyta/domain';

import { useHeytaText, useHeytaTokens } from '../theme.js';
import {
  habitMonthCells,
  habitMonthCellAction,
  habitMonthWindowDays,
  isHabitMonthCellInteractive,
  isHabitMonthForwardCapped,
  type HabitMonthCell,
} from './month-model.js';

export interface HabitMonthLabels {
  /** 整块月历的读数（带上习惯名与当月名）。 */
  readonly grid: (info: { readonly name: string; readonly month: string }) => string;
  /** 7 个列头，**周一起头** —— 顺序必须与 `monthGrid` 一致，错一位整月错一天。 */
  readonly weekdays: readonly string[];
  /** 当月标题（游标那个月说成人话）。 */
  readonly monthTitle: (date: LocalDate) => string;
  readonly prevMonth: string;
  readonly nextMonth: string;
  /** "可以往回补 N 天"那句提示。数字由领域层给（见 `habitMonthWindowDays`）。 */
  readonly windowHint: (days: number) => string;
  /**
   * 一格的读数：日期 + 它**为什么**可点/不可点。
   * 六档词表是 `@heyta/domain#HabitDayState`，宿主 switch 它，不许自己判日期。
   */
  readonly day: (info: { readonly date: LocalDate; readonly state: HabitDayState }) => string;
  /**
   * 补白格（邻月的那几天）的读数。
   *
   * 🔴 必须有这一句，不能只画灰：上一月视图里"今天"是一个**尾随补白格**，
   *    它按状态词表会说「今天还没打卡」，而它不可点 —— 读屏念一句"今天还没打卡"
   *    然后点下去没反应，就是本仓库反复栽过的"点了没反应"那一族。
   *    这句话回答的是"为什么这里不能点"：**这一格不属于这个月**。
   */
  readonly outOfMonth: (info: { readonly date: LocalDate }) => string;
  /**
   * 悬停提示（**只有 web 传**）。移动端没有鼠标，不传就完全不产出属性 ——
   * 与 `HabitBoard` 的 `cellTooltip` 同一条约定。
   * 拿到的 `text` 就是这一格的读数（同一个宿主句子在悬停时复用，不另判一次）。
   */
  readonly cellTitle?: (info: { readonly date: LocalDate; readonly text: string }) => string;
}

export interface HabitMonthBoardProps {
  readonly habit: Habit;
  readonly logs: readonly HabitLog[];
  /** 今天。**显式传入**，否则跨午夜与测试都不可复现（与 `HabitBoard` 的 `now` 同一条理由）。 */
  readonly today: LocalDate;
  /**
   * 🔴 看哪一月（游标）—— **受控**，必填。
   *
   * 年那一档点一张年卡要"翻到那一月"，而翻月要留在年那一档看别的月：
   * 两件事说的是同一枚游标。它若住在这里，年那块板只能各持一枚，
   * 于是"年在 2026、月在 2025"这种两个标题各讲一个故事的状态不需要任何错误就会出现。
   * 游标因此上收到 `HabitTrendBoard`。**做成可选 prop 会更省事，但那正是
   * §7 第 195 条**：宿主没接的时候界面照样画得出来，只是永远停在今天那一月。
   */
  readonly month: LocalDate;
  readonly onMonthChange: (next: LocalDate) => void;
  readonly labels: HabitMonthLabels;
  readonly onCheckIn: (habitId: string, date: LocalDate) => void;
  readonly onUndoCheckIn: (habitId: string, date: LocalDate) => void;
  /** 正在处理中的那条习惯 —— 置灰整块板，避免连点发出两条 op。 */
  readonly busy?: boolean;
  readonly testID?: string;
}

/** 一格的底色与文字色（全部是 token 名，没有一个裸值 —— `check:design` 会拦）。 */
function cellColors(
  cell: HabitMonthCell,
  tokens: HeytaNativeTokens,
): { backgroundColor: string; color: string } {
  if (!cell.inMonth) {
    return {
      backgroundColor: tokens['color.surface'],
      color: tokens['color.foreground-subtle'],
    };
  }
  switch (cell.state) {
    case 'logged':
      // 与热力图**最高档**同一个色：同一个"打过"在两个视图里必须长一个样，
      // 否则用户要先猜"这两块说的是不是一件事"。
      return {
        backgroundColor: tokens[HEAT_TOKENS[4]],
        color: tokens['color.on-primary'],
      };
    case 'today':
      return {
        backgroundColor: tokens['color.surface'],
        color: tokens['color.foreground'],
      };
    case 'backfillable':
      return {
        backgroundColor: tokens['color.primary-subtle'],
        color: tokens['color.foreground'],
      };
    case 'too-old':
    case 'future':
      return {
        backgroundColor: tokens['color.disabled-bg'],
        color: tokens['color.disabled-fg'],
      };
    case 'not-scheduled':
      return {
        backgroundColor: tokens['color.surface'],
        color: tokens['color.foreground-muted'],
      };
  }
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
    },
    weekdays: {
      flexDirection: 'row',
      gap: tokens['space.1'],
    },
    weekday: {
      // 列头跟格子同一条横向规矩（见 `cell`）：它俩必须分同一份宽度，
      // 否则列头与它底下的那一列会错开。
      flex: 1,
      textAlign: 'center',
    },
    weeks: {
      gap: tokens['space.1'],
    },
    week: {
      flexDirection: 'row',
      gap: tokens['space.1'],
    },
    cell: {
      /* 🔴 高度守 44px 硬下限，**宽度按行分摊、不设下限** —— 与 `CalendarBoard.tsx:270`
         同一条例子（那张历也在同一个窄栏里画 7 列）。理由不是省事：
         `tokens.css:323` 明写"44px 是可访问性硬下限，不许调小"，而 7×44 + 6×4 = 332
         在 288px 的中栏里**装不下** —— 两边同时满足的唯一办法是让一轴 flex。
         真浏览器把它照出来了（`e2e/tests/habit-month.spec.ts` R1 第一版：332 > 288，
         右边那一列整列被裁）。选"高度保 44"而不是"宽度保 44"，是因为行与行之间还有
         `space.1` 的间隔，纵向留得下命中区；横向留不下，而它还要让给列数。
         ⚠️ 于是这一格在窄栏里是 37×44，**不是**方形：它过 WCAG 2.5.8（24×24），
            过不了 Apple 那条 44 的建议 —— 这是一个**记录在案的取舍**，不是漏掉。 */
      flex: 1,
      minHeight: tokens['touch-target.min'],
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: tokens['radius.sm'],
    },
    cellToday: {
      backgroundColor: tokens['color.primary-subtle'],
    },
    hint: {
      textAlign: 'left',
    },
  });
}

export function HabitMonthBoard({
  habit,
  logs,
  today,
  month,
  onMonthChange,
  labels,
  onCheckIn,
  onUndoCheckIn,
  busy = false,
  testID,
}: HabitMonthBoardProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = makeStyles(tokens);

  // 游标是**受控**的（见 props 上那条注释）：这里只读，不改。
  const cursor = month;

  const weeks = useMemo(
    () => habitMonthCells(habit, logs, cursor, today),
    [habit, logs, cursor, today],
  );
  const monthName = labels.monthTitle(cursor);
  const nextCapped = isHabitMonthForwardCapped(cursor, today);

  const press = (cell: HabitMonthCell): void => {
    const action = habitMonthCellAction(cell);
    if (action === 'check-in') onCheckIn(habit.id, cell.date);
    if (action === 'undo') onUndoCheckIn(habit.id, cell.date);
  };

  /** 一格的读数：本月的按**六档**说，邻月的补白格按"不属于这个月"说（见 `labels.outOfMonth`）。 */
  const readOf = (cell: HabitMonthCell): string =>
    cell.inMonth
      ? labels.day({ date: cell.date, state: cell.state })
      : labels.outOfMonth({ date: cell.date });

  return (
    <View
      style={styles.board}
      testID={testID}
      accessibilityRole="summary"
      accessibilityLabel={labels.grid({ name: habit.name, month: monthName })}
    >
      <View style={styles.head}>
        <Text style={[text['section-title'], { color: tokens['color.foreground'] }]}>
          {monthName}
        </Text>
        <View style={styles.nav}>
          <Pressable
            onPress={() => {
              onMonthChange(addMonths(cursor, -1));
            }}
            accessibilityRole="button"
            accessibilityLabel={labels.prevMonth}
            testID={testID === undefined ? undefined : `${testID}-prev`}
            style={styles.navButton}
          >
            <Text style={[text['row-meta'], { color: tokens['color.foreground'] }]}>‹</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              // 不能翻到当前月之后：那里没有"补打卡"这件事，只有一张空历在等人预支。
              if (nextCapped) return;
              onMonthChange(addMonths(cursor, 1));
            }}
            accessibilityRole="button"
            accessibilityLabel={labels.nextMonth}
            // 🔴 写 `disabled`，不写平铺 `aria-disabled`：RNW 的 `Pressable` 把
            //    `disabled` 映射成 DOM 上的 `aria-disabled="true"`（实测见
            //    `apps/web/tests/habits-board.spec.tsx:293`），而直接写平铺属性**不落 DOM**
            //    （本单一开始就栽在这里：jsdom 里读到 `null`）。RN 原生侧同样靠它挡住按下。
            disabled={busy || nextCapped}
            testID={testID === undefined ? undefined : `${testID}-next`}
            style={styles.navButton}
          >
            <Text style={[text['row-meta'], { color: tokens['color.foreground'] }]}>›</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.weekdays}>
        {labels.weekdays.map((head) => (
          <Text
            key={head}
            style={[text['row-meta'], styles.weekday, { color: tokens['color.foreground-muted'] }]}
          >
            {head}
          </Text>
        ))}
      </View>

      <View style={styles.weeks}>
        {weeks.map((week, weekIndex) => (
          <View key={`w-${weekIndex}`} style={styles.week}>
            {week.map((cell) => {
              const colors = cellColors(cell, tokens);
              const interactive = isHabitMonthCellInteractive(cell);
              const read = readOf(cell);
              return (
                <Pressable
                  key={cell.date}
                  onPress={() => {
                    if (!interactive || busy) return;
                    press(cell);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={read}
                  // 同上一条：`disabled` 才是让两边都读得到"不能点"的那个 prop。
                  disabled={!interactive || busy}
                  testID={testID === undefined ? undefined : `${testID}-cell-${cell.date}`}
                  style={[
                    styles.cell,
                    { backgroundColor: colors.backgroundColor },
                    cell.state === 'today' ? styles.cellToday : undefined,
                  ]}
                  // web 的悬停提示走 `data-cell-title`（宿主 CSS 的 ::after 显示），
                  // 与 `HabitBoard` 的 `HeatCell` 同一条路；移动端不传就没有这个属性。
                  {...(labels.cellTitle === undefined
                    ? {}
                    : ({
                        dataSet: {
                          cellTitle: labels.cellTitle({ date: cell.date, text: read }),
                        },
                      } as object))}
                >
                  <Text
                    style={[
                      text['row-meta'],
                      { color: colors.color, textAlign: 'center' },
                      cell.state === 'today' ? text['row-title'] : undefined,
                    ]}
                  >
                    {Number(cell.date.slice(8, 10))}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      <Text style={[text['row-meta'], styles.hint, { color: tokens['color.foreground-muted'] }]}>
        {/* 这句是 `backfillDays` 那条 P1 承诺在界面上的兑现：窗口多宽由领域层说。 */}
        {labels.windowHint(habitMonthWindowDays(habit))}
      </Text>
    </View>
  );
}
