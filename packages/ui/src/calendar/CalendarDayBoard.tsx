/**
 * `CalendarDayBoard` —— 日视图：**全天带 + 24 小时轴铺满整面**
 * =============================================================
 *
 * 产品负责人 2026-10-03 给了一张滴答桌面端「日」的截图并说：
 * **"看一下日的定义就是这样子的，就是铺满整面的。"**
 *
 * ## 🔴 这张图回答了我先前登记的那个二选一
 *
 * `docs/plans/ui-review-fill-zh-timeline.md` §9.4 里写着：日视图要么先给任务
 * 一个"时刻"，要么把当天清单放大 —— 因为**全仓几乎没有带时刻的任务**
 * （`parseCapture` 不解析 `16:00`，`DueEditor` 只写本地零点，
 * 唯一的手工时刻输入在 AI 提案面板里）。
 *
 * 她给的形状是**第三种**，而且它把那个两难消掉了：
 *
 * | 带 | 放谁 |
 * |---|---|
 * | 顶部「全天」 | 这一天里**没有时刻**的（本地 0 点整）—— 也就是今天几乎所有的任务 |
 * | 下面 24 小时轴 | 只有**带了时刻**的才挂到对应那一行 |
 *
 * ⇒ 所以"轴上大片空白"**不是这一档没做完**：参考图里也一样（她那张是五条全在顶部带、
 *   轴上只有红色的现在线）。但"空白"与"没接上"在界面上长得一模一样，
 *   所以这一档**必须自己说一句**（`labels.dayNoTimed`）—— 见下面那条判据。
 *
 * ## 🔴 这一档**不重画**当天标题
 *
 * `‹ 10月3日 星期六 ›` 已经在 `CalendarToolbar` 里了（两种摆位都在：Web 挂页头、
 * 移动端挂卡片内）。板子里再来一遍就是"同一件事两个入口"——本轮 UX 审计刚在别处
 * 修掉过两类，而这里的重复还多一层：两处一旦口径不同（一处 `dayTitle`、一处新措辞），
 * 同一屏会出现两个不同的日子说法。所以这一档**只有**带与轴。
 *
 * ## 🔴 「有没有时刻」不在这里判
 *
 * 复用时间线那一份 `isAllDayMs`（`../timeline/board-model.ts`），分桶在
 * `model.ts#calendarDayBuckets`。两个 seam 各判一次"0 点整"的漂移形状是
 * "时间线把这条画在正午、日视图把它画在 00:00 那一行"，而两边看着都合理。
 *
 * ## 行高为什么复用 `size.row-min-height`
 *
 * 它不是一个新维度：一小时一行，而那一行**就是**一条可点的行
 * （下一步要把"点空白建任务带时刻"接进来 —— 那时它就是落点）。
 * §5 第三条"要新变量先加 token"的成本是逼问"这是不是一次性的"，这里答案是**不是**。
 * 24 × 56 = 1344px ⇒ 轴**必须可滚**，而"铺满整面"说的是这一档占满内容区高度
 * （`flexGrow`），不是"24 行挤进一屏"。
 */

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { HeytaNativeTokens } from '@heyta/design-system';
import { toLocalDate, type LocalDate, type Task } from '@heyta/domain';

import { EmptyState } from '../empty-state/EmptyState.js';
import { TaskList } from '../task-list/TaskList.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import { calendarDayBuckets, type CalendarBoardLabels } from './model.js';

export interface CalendarDayBoardProps {
  /** 全部候选任务（已按范围筛过）。分桶只看 `dueDate` 落在 `day` 的那些。 */
  readonly tasks: readonly Task[];
  /** 正在看的那一天。 */
  readonly day: LocalDate;
  /**
   * 当前时刻（epoch ms）。**不给就不画"现在"线** ——
   * 界面状态 store 不存时钟（存了就会漂），所以它由宿主从任务 store 的 `now` 透传。
   *
   * ⚠️ 这里**没有** `today` 这个 prop：日档唯一需要"今天"的地方就是这条线，
   *   而它问的是"`now` 落在不在 `day` 上"—— 再传一个"今天"就是同一件事两个来源，
   *   两者一旦不同步（宿主翻页时忘了刷 `today`），线会画在错的那一天上。
   */
  readonly now?: number | undefined;
  readonly onToggleTask: (taskId: string) => void;
  readonly onOpenTask?: ((taskId: string) => void) | undefined;
  readonly busyTaskId?: string | null | undefined;
  readonly labels: CalendarBoardLabels;
  readonly testID?: string;
}

export function CalendarDayBoard({
  tasks,
  day,
  now,
  onToggleTask,
  onOpenTask,
  busyTaskId,
  labels,
  testID = 'calendar-day-board',
}: CalendarDayBoardProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  const buckets = useMemo(() => calendarDayBuckets(tasks, day), [tasks, day]);
  const rowHeight = tokens['size.row-min-height'];
  /**
   * 现在线：只在"看的就是今天"且宿主给了时钟时画。
   *
   * ⚠️ 偏移量**从 `HOURS_IN_DAY` 与行高推导**，不是量 DOM —— 判据要能在 jsdom 里算，
   *   而 jsdom 没有布局。线的正确性由 e2e 那条真浏览器判据兜（`calendar-day.spec.ts`）。
   */
  const nowOffset =
    now !== undefined && toLocalDate(now) === day
      ? new Date(now).getHours() * rowHeight + (new Date(now).getMinutes() / 60) * rowHeight
      : undefined;

  const taskListProps = {
    // 🔴 与月/周档同一行（§4.2 的判据：同一行在不同容器里不许不同高度）。
    density: 'minimal' as const,
    onToggleTask,
    onOpenTask,
    busyTaskId: busyTaskId ?? null,
    labels: labels.taskRow,
  };

  return (
    <View style={styles.root} testID={testID}>
      {/* ── 全天带：这一天里**没有时刻**的那些 ─────────────────── */}
      <View style={[styles.card, styles.allDay]} testID={`${testID}-all-day`}>
        {labels.dayAllDay !== undefined ? (
          <Text
            style={[text['group-label'], styles.muted]}
            testID={`${testID}-all-day-label`}
          >
            {labels.dayAllDay}
          </Text>
        ) : null}
        {buckets.allDay.length === 0 ? (
          // 🔴 空态走共享实现（`check:empty-state` 判据 3：不许在视图里手写空态）。
          <EmptyState
            /*
             * 🔴 两句各说各的范围，选哪句看**这一天到底有没有到期的任务**：
             *   · 整天都空 → 那句"这一天没有到期的任务"是对的；
             *   · 只有这条带空（轴上有东西）→ 同句就成了谎话，而它下面 20 行
             *     正挂着一条到期的任务（R14 之后这是常态）。
             * 判据在 `apps/web/tests/calendar-day-view.spec.tsx` 的两条里各钉一边。
             */
            title={buckets.timedCount > 0 ? (labels.dayAllDayEmpty ?? labels.dayEmpty) : labels.dayEmpty}
            testID={`${testID}-all-day-empty`}
          />
        ) : (
          <TaskList tasks={buckets.allDay} {...taskListProps} testID={`${testID}-all-day-list`} />
        )}
      </View>

      {/* ── 24 小时轴（可滚）───────────────────────────────────── */}
      <View style={[styles.card, styles.axisWrap]} testID={`${testID}-axis-card`}>
        <ScrollView style={styles.axis} testID={`${testID}-axis`}>
          {buckets.hours.map((bucket, hour) => (
            <View
              key={`hour-${String(hour)}`}
              style={[
                styles.hourRow,
                { minHeight: rowHeight, borderTopWidth: hour === 0 ? 0 : tokens['border-width.thin'] },
              ]}
              testID={`${testID}-hour-${String(hour).padStart(2, '0')}`}
            >
              {/*
                🔴 这一列必须**整屏读得出"这一格是几点"**。它此前定宽 `space.8`（32px），
                  而 `row-meta` 是 14px 的 sm，「23:00」在 tabular-nums 下量出来比列宽还宽
                  ⇒ 浏览器把它折成「23:0」+「0」两行（真浏览器截图里 10:00 之后每一行都这样，
                  单行的小时 0–9 却正常）。判据在 `e2e/tests/calendar-day.spec.ts`：
                  jsdom 里所有 rect 都是 0，这条**只能**在真浏览器里量。

                ⚠️ testID 的**前缀**不能是 `-hour-`：那一串是**行**的名字，
                  而日档那条判据数的是"轴上有 `HOURS_IN_DAY` 行"（`^calendar-board-day-hour-`）。
                  第一次把它写成 `-hour-label-` 时，行判据当场从 24 变 48 —— 前缀共用就是它报的。
                  所以时刻列叫 `-clock-`，那一小时的任务列表叫 `-timed-`（原来也是 `-hour-list-`，
                  同一处撞号，零消费者所以直接改名）。
              */}
              <Text
                style={[text['row-meta'], styles.hourLabel]}
                testID={`${testID}-clock-${String(hour).padStart(2, '0')}`}
              >
                {labels.hourLabel?.(hour) ?? ''}
              </Text>
              <View style={styles.hourBody}>
                {bucket.length > 0 ? (
                  <TaskList
                    tasks={bucket}
                    {...taskListProps}
                    testID={`${testID}-timed-${String(hour).padStart(2, '0')}`}
                  />
                ) : null}
              </View>
            </View>
          ))}
          {nowOffset !== undefined ? (
            // 现在线：她那张参考图里唯一画在轴上的东西。
            <View
              style={[styles.nowLine, { top: nowOffset, backgroundColor: tokens['color.danger'] }]}
              testID={`${testID}-now-line`}
            />
          ) : null}
        </ScrollView>
      </View>

      {/*
        🔴 轴空着而**上面那条带有东西**时必须说一句。
        不说，"这一天没定到具体时刻"与"这一档没接上数据"在界面上是同一张图 ——
        而后者本仓为它记过一整页账（零件都在、最后一米没接）。
        反过来，两条带都空的时候**不说**：那时全天带里已经是那句
        「这一天没有到期的任务」，再来一句就是同一件事两个说法。
      */}
      {buckets.timedCount === 0 && buckets.allDay.length > 0 && labels.dayNoTimed !== undefined ? (
        <Text style={[text['row-meta'], styles.muted]} testID={`${testID}-no-timed`}>
          {labels.dayNoTimed}
        </Text>
      ) : null}
    </View>
  );
}

function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    root: {
      // 🔴 与月档同一条全高契约（§9.6）：`flexGrow` + `flexShrink: 0` + `flexBasis: auto`。
      // 写 `flex: 1` 会让它在内容超高时缩回去，症状就是她最初抱怨的"只占半屏"。
      flexGrow: 1,
      flexShrink: 0,
      flexBasis: 'auto',
      gap: tokens['space.3'],
    },
    /* 两张卡的边框/圆角/底色只在这里写一次（板子里两处共用，不各写一份）。 */
    card: {
      padding: tokens['space.3'],
      borderRadius: tokens['radius.md'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
      backgroundColor: tokens['color.surface'],
    },
    muted: { color: tokens['color.foreground-muted'] },
    allDay: { flexShrink: 0, gap: tokens['space.1'] },
    // 轴吃掉剩余高度；`overflow: hidden` 是**裁圆角**用的，滚动本身在 ScrollView 里。
    // ⚠️ 这一条**不**共用上面 `card` 的 `flexShrink: 0`：轴是"能滚的那一块"，
    //    视口紧的时候必须让它收缩，否则整屏被 1344px 的轴顶出去（那才是"看不见"）。
    axisWrap: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
    axis: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
    hourRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: tokens['space.2'],
      paddingHorizontal: tokens['space.1'],
      paddingVertical: tokens['space.1'],
      borderColor: tokens['color.border-subtle'],
    },
    hourLabel: {
      // 🔴 定宽一列：`0:00` 与 `23:00` 差一个字符（`formatClock` 的小时**不补零**，
      //    那是时间线那根轴已有的形状，不在这里另发明一种）。
      //    补偿放在**列宽**上而不是放在数字里补一个 0 —— 与月档周次列同一档位
      //    （`CalendarBoard` 的 `weekNumCell: width = space.8`），不新造 token。
      //
      // ⚠️ 这里以前是 `space.8`（32px），而**它对 32px 不够**：14px 的 sm 下
      //    「10:00」～「23:00」十四行全部折成两行（真浏览器实测 height 42 / lineHeight 21，
      //    单行小时 0–9 正常）。折行不是"不好看"，是**这一格读不出是几点**。
      //    取 `space.12`（48px）而不是 40：40 只比实测所需宽度多一点，
      //    字体一旦换（暗色/缩放/其它平台）就再折回去，而这列不该依赖"刚好够"。
      //    判据：`e2e/tests/calendar-day.spec.ts` 那条"时刻列不许折行"（逐行量）。
      width: tokens['space.12'],
      flexShrink: 0,
      color: tokens['color.foreground-muted'],
      fontVariant: ['tabular-nums'],
    },
    hourBody: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
    nowLine: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: tokens['border-width.thick'],
    },
  });
}
