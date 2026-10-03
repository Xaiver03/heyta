/**
 * 日历顶部工具栏（共享层）
 * ==========================
 *
 * R11 批二（产品负责人 2026-10-02 对标滴答："它那个顶栏设计得非常好"）。
 * 值得抄的不是按钮排布，是**分工**：
 * 标题说"我在看哪一段"，`< 今天 >` 说"在这段里移动"。
 *
 * 🔴 这一层是**同一份实现、两种摆位**：
 *   · `CalendarBoard` 默认把它画在月历卡片**里面**（移动端 —— 那里没有页头插槽）；
 *   · Web 传 `toolbar="external"`，由宿主把同一个组件挂进 `header.ht-header`
 *     （AGENTS §6.2 的锚点，任务排序下拉就住在那儿）。
 *   两端 testID 因此**完全一致**（`calendar-toolbar-*`）——
 *   如果摆位一变就换一套 ID，判据就得跟着摆位分叉，那是漂移的开始。
 *
 * ⚠️ 视图档位（月 / 周）走 `trailing` 插槽，**不在共享层里画**：
 *   Web 用原生 `<select>`（与页头那个任务排序下拉同一模式，理由抄在那儿 ——
 *   暗色下不必自绘弹层），而 RN 侧没有 `<select>`。
 *   把控件本体放进共享层就等于替两端决定"这一格长什么样"，
 *   而共享层认识的只有"日历"这一件事。
 *   🔴 下拉里**只出现真的能用的档位**（§9.3 那条明确不做的事）。
 */

import type { LocalDate } from '@heyta/domain';
import { ChevronLeft, ChevronRight } from 'lucide';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens, type HeytaNativeTokens } from '../theme.js';
import {
  stepCalendarCursor,
  type CalendarToolbarLabels,
  type CalendarViewKind,
} from './model.js';

export interface CalendarToolbarProps {
  readonly cursor: LocalDate;
  readonly onCursorChange: (cursor: LocalDate) => void;
  /** 不给 = 不画「今天」（移动端目前没接这条，见 `CalendarBoard` 的 `onToday`）。 */
  readonly onToday?: (() => void) | undefined;
  readonly labels: CalendarToolbarLabels;
  readonly testID?: string;
  /**
   * 决定 `<` `>` **走多远**、标题说什么。默认 `'month'`（同 §9.1 的新 props 纪律）。
   *
   * 🔴 步进放在这里而不是宿主里：周视图"走 7 天"与月视图"走 1 个月"是**同一件事**
   *   （"到下一段"），两个宿主各写一遍就会一个走自然周、一个走 7 天。
   */
  readonly view?: CalendarViewKind | undefined;
  /**
   * 宿主追加在工具栏**末尾**的那一格（Web 用它挂同步状态）。
   *
   * 🔴 共享层**不认识**同步：这里只留一个插槽，不 import 任何状态源，
   * 否则就把"日历"和"同步"焊在一起，别的宿主想要别的格子就没位置放了。
   */
  readonly trailing?: React.ReactNode;
}

export function CalendarToolbar({
  cursor,
  onCursorChange,
  onToday,
  labels,
  testID = 'calendar-toolbar',
  view = 'month',
  trailing,
}: CalendarToolbarProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  /**
   * 走一步。
   *
   * 🔴 周视图用 `addDays(±7)` 而不是 `addWeeks`：**同一个游标语义**要求它落在
   *   与当前游标同星期几的那一天上，而 `startOfWeek` 那一套已经在 `weekGrid` 里了。
   *   游标始终是"正在显示的这一周（这个月）里的任意一天"，两端一致。
   */
  const step = (dir: number): void => {
    onCursorChange(stepCalendarCursor(view, cursor, dir));
  };

  // 周视图没给 `weekTitle` 时**退回月份**，而不是渲染 `undefined`（那会画出一个空标题）。
  // 这条退回是"看着像坏了"，所以由判据兜住 —— 见 `model.ts` 里那段。
  const title = view === 'week' ? (labels.weekTitle?.(cursor) ?? labels.monthTitle(cursor)) : labels.monthTitle(cursor);
  const prevLabel = view === 'week' ? (labels.prevWeek ?? labels.prevMonth) : labels.prevMonth;
  const nextLabel = view === 'week' ? (labels.nextWeek ?? labels.nextMonth) : labels.nextMonth;

  return (
    <View style={styles.root}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={prevLabel}
        onPress={() => {
          step(-1);
        }}
        style={styles.iconButton}
        testID={`${testID}-prev`}
      >
        <HeytaIcon data={ChevronLeft} size={tokens['icon.sm']} color={tokens['color.foreground-muted']} />
      </Pressable>

      <Text style={[text['section-title'], styles.title]} testID={`${testID}-month`}>
        {title}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={nextLabel}
        onPress={() => {
          step(1);
        }}
        style={styles.iconButton}
        testID={`${testID}-next`}
      >
        <HeytaIcon data={ChevronRight} size={tokens['icon.sm']} color={tokens['color.foreground-muted']} />
      </Pressable>

      {onToday === undefined ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.backToToday}
          onPress={onToday}
          style={styles.todayButton}
          testID={`${testID}-today`}
        >
          <Text style={[text['row-meta'], { color: tokens['color.primary'] }]}>
            {labels.backToToday}
          </Text>
        </Pressable>
      )}

      {trailing}
    </View>
  );
}

function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    root: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.1'],
    },
    /**
     * 月份标题留一段**最小宽度**：`2026年9月` 与 `2026年10月` 差一个字的宽度，
     * 不钉住的话翻月时左右两个箭头会跟着横移一格 —— 那是"界面在动"而不是"数据在变"。
     * ⚠️ 不用 `space.4 * 8` 这类乘出来的数：`check:design` 拦的就是这种"看起来用了 token
     * 其实是现编的长度"。这里用 `text.*` 之外唯一合适的现成档位 `touch-target.min`。
     */
    title: { minWidth: tokens['touch-target.min'], textAlign: 'center' },
    iconButton: {
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: tokens['touch-target.min'],
      minHeight: tokens['touch-target.min'],
    },
    todayButton: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: tokens['touch-target.min'],
      paddingHorizontal: tokens['space.3'],
      marginInlineStart: tokens['space.2'],
    },
  });
}
