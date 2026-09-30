/**
 * `CalendarBoard` —— 月历 + 选中那天的任务，**四端同一份**
 * ==========================================================
 *
 * 「任务」页回答"现在该干什么"，这一页回答"哪天有什么事" —— 本地优先的任务
 * 应用里，这两件事都得有，否则安排一周的活只能靠翻列表。
 *
 * ## 它是从哪来的
 *
 * `apps/mobile` 从 2026-09 起就有一个 439 行的月历，而 `apps/web` **一个都没有**
 *（产品负责人给的参考 IA 里，日历是 5 个主菜单之一）。这一刀把**渲染**提上来，
 * 数学仍在 `@heyta/domain`（`monthGrid` / `startOfMonth` / `addMonths` / `isoWeekday`）。
 *
 * ## 🔴 当日列表**复用共享 `TaskList`**，不自己画行
 *
 * 这一条是刻意选的，不是一个省事的写法：`dida-view-unification.md` §4.2 的判据是
 * 「日历格里的行 = `<TaskRow density="minimal" />`。**不是三份 JSX。**」
 * 而在此之前 `minimal` 这一档**没有任何消费者** —— 它被定义、被测试、
 * 却没人用（"定义了但没人用"正是这一层最容易被误判成"已完成"的状态）。
 * 现在它有了。
 *
 * ## 本目录不许 `import '@heyta/i18n'`
 *
 * 文案全部由宿主的 `labels` 注入（理由见 `model.ts` 文件头）。
 */

import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { HeytaNativeTokens } from '@heyta/design-system';
import {
  addMonths,
  isoWeek,
  isoWeekday,
  monthGrid,
  startOfMonth,
  type LocalDate,
  type Task,
} from '@heyta/domain';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide';

import { EmptyState } from '../empty-state/EmptyState.js';
import { HeytaIcon } from '../icon/Icon.js';
import { TaskList } from '../task-list/TaskList.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import {
  MAX_CALENDAR_DOTS,
  calendarDayTone,
  groupTasksByDueDate,
  type CalendarBoardLabels,
  type CalendarDayTone,
} from './model.js';

export interface CalendarBoardProps {
  /** 全部候选任务。**没设截止时间的不会出现在日历上** —— 见 `labels.footnote`。 */
  readonly tasks: readonly Task[];
  /** 今天的本地日历日。 */
  readonly today: LocalDate;
  /** 正在显示的月份（用该月里任意一天表示）。 */
  readonly cursor: LocalDate;
  /** 选中的那一天。 */
  readonly selected: LocalDate;
  readonly onCursorChange: (date: LocalDate) => void;
  /**
   * 「今天」跳回（滴答式头部）。给了才渲染头部的「今天」按钮；
   * 宿主的实现通常是 `onSelect(today)` + `onCursorChange(startOfMonth(today))`。
   */
  readonly onToday?: (() => void) | undefined;
  /** 点某一天（宿主应当**同时**把月份跟过去，见下）。 */
  readonly onSelect: (date: LocalDate) => void;
  readonly onToggleTask: (taskId: string) => void;
  /**
   * 点整行。**不给时整行不可点**（共享 `TaskList` 的契约：
   * 它刻意不把"没给 onOpenTask"降级成"点行 = 切换完成"）。
   */
  readonly onOpenTask?: ((taskId: string) => void) | undefined;
  /** 正在写入的任务 id —— 防止连点产生两次 toggle。 */
  readonly busyTaskId?: string | null | undefined;
  readonly labels: CalendarBoardLabels;
  readonly testID?: string | undefined;
}

/**
 * 月历里的一个格子。
 *
 * ⚠️ 单独提出来是为了不让它随主组件重渲染而重新挂载 ——
 * 内联定义组件会让 React 每次渲染都当成一个**新类型**，
 * 于是 42 个格子的状态与 Pressable 的按下反馈每次都被丢掉。
 */
function DayCell({
  date,
  day,
  inMonth,
  isToday,
  isSelected,
  tone,
  dotCount,
  labels,
  onPress,
}: {
  date: LocalDate;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  tone: CalendarDayTone;
  dotCount: number;
  labels: CalendarBoardLabels;
  onPress: (date: LocalDate) => void;
}): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  const numberColor = isSelected
    ? tokens['color.on-primary']
    : inMonth
      ? tokens['color.foreground']
      : // 补白格（上月/下月）视觉上次要，但**仍然可点** ——
        // "点上月 30 号"是合法意图，把它做成不可点才是意外。
        tokens['color.foreground-subtle'];

  const dotColor =
    tone === 'danger'
      ? tokens['color.danger']
      : tone === 'primary'
        ? tokens['color.primary']
        : tone === 'subtle'
          ? tokens['color.foreground-subtle']
          : 'transparent';

  // 读屏时一屏 42 个"数字"没有意义，必须念成一个完整的日期 + 有没有事。
  // 日期本身由宿主的 `dayTitle` 说成当前语言。
  const dayTitle = labels.dayTitle(date);

  return (
    <Pressable
      onPress={() => onPress(date)}
      accessibilityRole="button"
      /* 🔴 平铺 `aria-selected`：对象形态的 `accessibilityState` 在 react-native-web 上
         会被**整个丢掉**（`check:rn-aria` 断言 B 拦下的就是这一处）。 */
      aria-selected={isSelected}
      accessibilityLabel={
        dotCount > 0
          ? labels.dayWithTasks({ date: dayTitle, count: dotCount })
          : labels.dayNoTasks({ date: dayTitle })
      }
      style={[
        styles.cell,
        {
          minHeight: tokens['touch-target.min'],
          gap: tokens['space.1'],
          borderRadius: tokens['radius.md'],
          borderWidth:
            isToday && !isSelected ? tokens['border-width.thick'] : tokens['border-width.thin'],
          borderColor: isSelected
            ? tokens['color.primary']
            : isToday
              ? tokens['color.primary']
              : 'transparent',
          backgroundColor: isSelected ? tokens['color.primary'] : 'transparent',
        },
      ]}
    >
      <Text style={[text['numeric-body'], { color: numberColor }]}>{day}</Text>
      <View style={[styles.dots, { gap: tokens['space.1'], height: tokens['size.badge-dot'] }]}>
        {Array.from({ length: Math.min(dotCount, MAX_CALENDAR_DOTS) }, (_, i) => (
          <View
            key={i}
            style={{
              width: tokens['size.badge-dot'],
              height: tokens['size.badge-dot'],
              borderRadius: tokens['radius.full'],
              backgroundColor: dotColor,
            }}
          />
        ))}
      </View>
    </Pressable>
  );
}

export function CalendarBoard({
  tasks,
  today,
  cursor,
  selected,
  onCursorChange,
  onSelect,
  onToday,
  onToggleTask,
  onOpenTask,
  busyTaskId,
  labels,
  testID = 'calendar-board',
}: CalendarBoardProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  const byDate = useMemo(() => groupTasksByDueDate(tasks), [tasks]);
  const weeks = useMemo(() => monthGrid(cursor), [cursor]);
  const dayTasks = byDate.get(selected) ?? [];

  /**
   * 点某一天。
   *
   * 🔴 **必须同时把月份跟过去**（点到补白格时）：否则选了"上月 30 号"
   * 却还停在本月，下面列出的日子在网格里根本看不到 —— 用户会以为点错了。
   */
  const pickDay = useCallback(
    (date: LocalDate) => {
      onSelect(date);
      onCursorChange(startOfMonth(date));
    },
    [onSelect, onCursorChange],
  );

  return (
    <View style={styles.root} testID={testID}>
      {/* ── 月历 ───────────────────────────────────────────── */}
      <View
        style={[
          {
            gap: tokens['space.2'],
            padding: tokens['space.3'],
            borderRadius: tokens['radius.md'],
            borderWidth: tokens['border-width.thin'],
            borderColor: tokens['color.border'],
            backgroundColor: tokens['color.surface'],
          },
        ]}
      >
        <View style={styles.monthRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={labels.prevMonth}
            onPress={() => {
              onCursorChange(addMonths(cursor, -1));
            }}
            style={styles.iconButton}
          >
            <HeytaIcon data={ChevronLeft} size={tokens['icon.sm']} color={tokens['color.foreground-muted']} />
          </Pressable>
          <Text style={[text['section-title'], styles.monthTitle]} testID={`${testID}-month`}>
            {labels.monthTitle(cursor)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={labels.nextMonth}
            onPress={() => {
              onCursorChange(addMonths(cursor, 1));
            }}
            style={styles.iconButton}
          >
            <HeytaIcon
              data={ChevronRight}
              size={tokens['icon.sm']}
              color={tokens['color.foreground-muted']}
            />
          </Pressable>
          {/*
            🔴 「今天」跳回（滴答式头部：`< 今天 >`）。给 onToday 才渲染 ——
            跳回动作宿主已经会了（页脚那个 backToToday 同一条路径），这里只是
            把它提到**月历头部**：滴答的用户心智里"回到今天"在翻页那组里，
            放页脚要滚到底才看得见。
          */}
          {onToday === undefined ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={labels.backToToday}
              onPress={onToday}
              style={styles.todayButton}
              testID={`${testID}-today-header`}
            >
              <Text style={[text['row-meta'], { color: tokens['color.primary'] }]}>
                {labels.backToToday}
              </Text>
            </Pressable>
          )}
        </View>

        {/* 列头顺序**必须**与 `monthGrid` 的周一开头一致（见 `labels.weekdays`）。
            写反了不会报错，只会让整个日历**整体错位一格**。
            今天所在的那一列，列头用主色 —— 滴答同款（"今天为蓝色，其余灰"）。 */}
        <View style={styles.weekRow}>
          {labels.weekNumber === undefined ? null : <View style={styles.weekNumCell} />}
          {labels.weekdays.map((label, i) => (
            <View key={`wd-${i}`} style={styles.weekCell}>
              <Text
                style={[
                  text['row-meta'],
                  {
                    color:
                      today !== undefined && isoWeekday(today) - 1 === i
                        ? tokens['color.primary']
                        : tokens['color.foreground-subtle'],
                  },
                ]}
              >
                {label}
              </Text>
            </View>
          ))}
        </View>

        {weeks.map((week) => (
          <View key={week[0]!.date} style={styles.weekRow}>
            {/* 周次列（滴答式"31周"）：宿主给格式化，周一是网格开头，
                同一行任何一天的 ISO 周数都相同 —— 取第一天的即可。 */}
            {labels.weekNumber === undefined ? null : (
              <View style={styles.weekNumCell}>
                <Text
                  style={[text.caption, { color: tokens['color.foreground-subtle'] }]}
                  numberOfLines={1}
                >
                  {labels.weekNumber(week[0]!.date)}
                </Text>
              </View>
            )}
            {week.map((cell) => {
              const cellTasks = byDate.get(cell.date) ?? [];
              return (
                <DayCell
                  key={cell.date}
                  date={cell.date}
                  day={Number(cell.date.slice(8, 10))}
                  inMonth={cell.inMonth}
                  isToday={cell.date === today}
                  isSelected={cell.date === selected}
                  tone={calendarDayTone(cellTasks, today, cell.date)}
                  dotCount={cellTasks.length}
                  labels={labels}
                  onPress={pickDay}
                />
              );
            })}
          </View>
        ))}
      </View>

      {/* ── 选中那天的清单 ─────────────────────────────────── */}
      <View style={styles.dayHeader}>
        <HeytaIcon data={CalendarDays} size={tokens['icon.sm']} color={tokens['color.foreground-muted']} />
        <Text style={[text['section-title'], styles.dayTitle]} testID={`${testID}-day-title`}>
          {labels.dayTitle(selected)}
        </Text>
        <Text style={[text['row-meta'], { color: tokens['color.foreground-muted'] }]}>
          {dayTasks.length}
        </Text>
      </View>

      <View
        style={[
          {
            padding: tokens['space.3'],
            borderRadius: tokens['radius.md'],
            borderWidth: tokens['border-width.thin'],
            borderColor: tokens['color.border'],
            backgroundColor: tokens['color.surface'],
          },
        ]}
      >
        {dayTasks.length === 0 ? (
          // 🔴 空态走**共享那一个实现**（`check:empty-state` 的判据 3：
          // 新的空态不许在视图里手写）。这里只是把宿主的文案转交进去。
          <EmptyState title={labels.dayEmpty} testID={`${testID}-day-empty`} />
        ) : (
          <TaskList
            tasks={dayTasks}
            // 🔴 日历格那一档（§4.2 的判据）。**不要**改成 comfortable：
            // 那样这一页的行会比其他列表高一大截，而"同一行在不同容器里不同高度"
            // 正是 density 这一档要消灭的东西。
            density="minimal"
            onToggleTask={onToggleTask}
            onOpenTask={onOpenTask}
            busyTaskId={busyTaskId ?? null}
            labels={labels.taskRow}
            testID={`${testID}-day-list`}
          />
        )}
      </View>

      <View style={styles.footerRow}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            pickDay(today);
          }}
          style={[
            styles.ghostButton,
            {
              minHeight: tokens['touch-target.min'],
              paddingHorizontal: tokens['space.3'],
              borderRadius: tokens['radius.sm'],
              borderWidth: tokens['border-width.thin'],
              borderColor: tokens['color.border'],
            },
          ]}
          testID={`${testID}-today`}
        >
          <Text style={[text['row-title'], { color: tokens['color.primary'] }]}>
            {labels.backToToday}
          </Text>
        </Pressable>
      </View>

      {/* 如实说明这一页看不到什么 —— 否则"任务没设截止时间"会被读成"任务丢了"。
          见 `groupTasksByDueDate` 的说明。 */}
      <Text
        style={[text['row-meta'], { color: tokens['color.foreground-subtle'] }]}
        testID={`${testID}-footnote`}
      >
        {labels.footnote}
      </Text>
    </View>
  );
}

/**
 * 版式。
 *
 * 🔴 **不是 `StyleSheet.create` 常量，而是 `tokens => styles` 的函数**：
 * 唯一的间距（`space.4`）也必须来自设计 token —— `check:design` 会拦下
 * 组件里的裸数字，而它拦得对："这个间距"与"那个间距"各写各的，
 * 正是"同一行在不同容器里长得不一样"的起点。
 */
function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    root: { gap: tokens['space.4'] },
    monthRow: { flexDirection: 'row', alignItems: 'center' },
    monthTitle: { flex: 1, textAlign: 'center' },
    iconButton: {
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: tokens['touch-target.min'],
      minHeight: tokens['touch-target.min'],
    },
    /* 「今天」跳回按钮（滴答式头部）。文字按钮：主色文字 + 细边框胶囊。 */
    todayButton: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: tokens['touch-target.min'],
      paddingHorizontal: tokens['space.2'],
      borderRadius: tokens['radius.sm'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
    },
    /* 周次列：固定窄宽（不参与 7 列的 flex 平分），列头行留一个同宽空位。 */
    weekNumCell: {
      width: tokens['space.8'],
      alignItems: 'center',
      justifyContent: 'center',
    },
    weekRow: { flexDirection: 'row' },
    weekCell: { flex: 1, alignItems: 'center' },
    cell: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    dots: { flexDirection: 'row' },
    dayHeader: { flexDirection: 'row', alignItems: 'center', gap: tokens['space.2'] },
    dayTitle: { flex: 1 },
    footerRow: { flexDirection: 'row', alignItems: 'center' },
    ghostButton: { alignItems: 'center', justifyContent: 'center' },
  });
}
