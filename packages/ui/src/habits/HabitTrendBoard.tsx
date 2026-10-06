/**
 * 习惯详情面里的「月 ⇄ 年」容器（工单 H7）
 * ========================================
 *
 * 它只做三件事：持有**一枚游标**、持有**一个档位**、把这两样交给两块板。
 *
 * ## 🔴 为什么游标住在这里，而不是两块板各持一枚
 *
 * 点一张年卡要"翻到那一月的格子"，而翻月要留在年这一档看别的月 ——
 * 两件事说的是**同一个游标**。两块板各持一枚的写法不需要任何错误就会漂：
 * 年在 2026、月在 2025，标题与格子各讲一个故事。
 * 这也是 `HabitMonthBoard` 这一版改成**受控**（`month` + `onMonthChange` 必填）的原因：
 * 可选的"受控 prop"会把"宿主根本没接"伪装成"做完了"（§7 第 195 条），
 * 必填 ⇒ 两端不接就编译不过。
 *
 * ## 🔴 为什么切换器住在这里，而**不**在中栏
 *
 * 见 [`docs/plans/habits-alignment.md`](../../../docs/plans/habits-alignment.md) §5 的 P-5：
 * 中栏那一列是**跨习惯**的，而这两档都是**单条习惯**的。切换器摆在它切的东西旁边。
 *
 * ## 档位词表不另立一份
 *
 * `HabitTrendView` 是 `CalendarViewKind` 的**子集**（只有 `month` 与 `year`）：
 * 日历那边添一档（比如"十年"）不会自动出现在习惯这一侧，
 * 而这里也长不出第二套"档位叫什么"。档位名走 `CALENDAR_VIEW_LABEL_KEYS`
 * （宿主 `t()` 那枚关名），所以**没有新增词条**，也就没有中英不同步的可能。
 */

import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { HeytaNativeTokens } from '@heyta/design-system';
import type { Habit, HabitLog, LocalDate } from '@heyta/domain';
import { addMonths, firstOfMonthKey } from '@heyta/domain';
import type { CalendarViewKind } from '../calendar/model.js';
import { CalendarViewTabs, type CalendarViewTabsLabels } from '../calendar/CalendarViewTabs.js';
import { useHeytaTokens } from '../theme.js';

import { HabitMonthBoard, type HabitMonthLabels } from './HabitMonthBoard.js';
import { HabitYearBoard, type HabitYearLabels } from './HabitYearBoard.js';

/** 习惯这一侧真的能用的两档 —— 从日历那一份词表里**取子集**，不是另建一份。 */
export type HabitTrendView = Extract<CalendarViewKind, 'month' | 'year'>;

/** 两档的固定顺序。它是一枚常量而不是参数：一个目的地只允许一个控件。 */
const TREND_VIEWS: readonly HabitTrendView[] = ['month', 'year'];

export interface HabitTrendLabels {
  readonly tabs: CalendarViewTabsLabels;
  readonly month: HabitMonthLabels;
  readonly year: HabitYearLabels;
}

export interface HabitTrendBoardProps {
  readonly habit: Habit;
  readonly logs: readonly HabitLog[];
  readonly today: LocalDate;
  readonly labels: HabitTrendLabels;
  readonly onCheckIn: (habitId: string, date: LocalDate) => void;
  readonly onUndoCheckIn: (habitId: string, date: LocalDate) => void;
  readonly busy?: boolean;
  readonly testID: string;
}

/** 间距全部走 token（`check:design` 拦裸值），所以样式在组件里造。 */
function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    wrap: {
      gap: tokens['space.2'],
    },
  });
}

export function HabitTrendBoard({
  habit,
  logs,
  today,
  labels,
  onCheckIn,
  onUndoCheckIn,
  busy = false,
  testID,
}: HabitTrendBoardProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const styles = makeStyles(tokens);
  /* 换了一条习惯就把游标与档位归位：停在上一条约习惯的 2019 年，
     而新习惯的"今天"根本不在屏幕上 —— 那一格恰恰最该看见。 */
  const [state, setState] = useState<{
    id: string;
    view: HabitTrendView;
    cursor: LocalDate;
  }>(() => ({ id: habit.id, view: 'month', cursor: today }));
  const view = state.id === habit.id ? state.view : 'month';
  const cursor = state.id === habit.id ? state.cursor : today;

  const year = useMemo(() => Number(cursor.slice(0, 4)), [cursor]);

  return (
    <View style={styles.wrap} testID={testID}>
      <CalendarViewTabs
        view={view}
        options={TREND_VIEWS}
        onViewChange={(next) => {
          // 不写 `next as HabitTrendView`：`options` 只有两档，但**类型**上它给得出四档。
          // 这里显式收敛成两档，第三/第四档永远落不进来（落进来就是有人往
          // `TREND_VIEWS` 里加了日历那一侧的档位，而那一档在习惯这边没有实现）。
          setState({ id: habit.id, view: next === 'year' ? 'year' : 'month', cursor });
        }}
        labels={labels.tabs}
        testID={`${testID}-tabs`}
      />
      {view === 'month' ? (
        <HabitMonthBoard
          habit={habit}
          logs={logs}
          today={today}
          month={cursor}
          onMonthChange={(next) => {
            setState({ id: habit.id, view, cursor: next });
          }}
          labels={labels.month}
          onCheckIn={onCheckIn}
          onUndoCheckIn={onUndoCheckIn}
          busy={busy}
          testID={`${testID}-month`}
        />
      ) : (
        <HabitYearBoard
          habit={habit}
          logs={logs}
          today={today}
          year={year}
          labels={labels.year}
          onPickMonth={(monthKey) => {
            // 点年卡 = 换到月那一档并翻到那一月（两件事一次做完，不留中间态）。
            setState({ id: habit.id, view: 'month', cursor: firstOfMonthKey(monthKey) });
          }}
          onYearChange={(nextYear) => {
            setState({
              id: habit.id,
              view,
              cursor: addMonths(cursor, (nextYear - year) * 12),
            });
          }}
          busy={busy}
          testID={`${testID}-year`}
        />
      )}
    </View>
  );
}
