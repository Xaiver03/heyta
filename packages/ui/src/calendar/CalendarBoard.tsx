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
  isoWeek,
  isoWeekday,
  monthGrid,
  weekGrid,
  type LocalDate,
  type MonthGridCell,
  type Task,
} from '@heyta/domain';
import { CalendarDays } from 'lucide';

import { EmptyState } from '../empty-state/EmptyState.js';
import { HeytaIcon } from '../icon/Icon.js';
import { TaskList } from '../task-list/TaskList.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import { CalendarDayBoard } from './CalendarDayBoard.js';
import { CalendarYearBoard } from './CalendarYearBoard.js';
import { CalendarToolbar } from './CalendarToolbar.js';
import {
  calendarCellBars,
  calendarCursorFor,
  calendarDayTone,
  MAX_CALENDAR_BARS,
  MAX_WEEK_CALENDAR_BARS,
  groupTasksByDueDate,
  type CalendarBoardLabels,
  type CalendarCellBar,
  type CalendarViewKind,
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
  /**
   * 年档里点某一张月卡（R13）。**给的是那个月的 1 号。**
   *
   * ⚠️ 可选，而**不给时月卡整块不可点** —— 这不是偷懒，是 §9.3 那条立场
   *   （「不摆点了没反应的菜单项」）在年档的落地形状：共享层不知道宿主的
   *   "点一张月卡该去哪"，那就由宿主明说；宿主没说，界面就不假装能点。
   *   两个宿主目前都接了（切到那个月的月档、游标跟过去、**选中那天不动**）。
   */
  readonly onPickMonth?: ((monthFirstDay: LocalDate) => void) | undefined;
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
  /**
   * 工具栏（`‹ 月份 ›  今天`）摆在哪。
   *
   * 🔴 **默认 `'inline'`（画在月历卡片里）不是偏好，是兼容**：移动端没有页头插槽，
   * 而新 props 一律必须可选，否则两端同时红（§9.1）。
   * `'external'` 只把这一格**撤掉**，板子其余部分一字不改 ——
   * 宿主（Web）负责把**同一个** `CalendarToolbar` 挂到 `header.ht-header` 里。
   *
   * ⚠️ 选了 `'external'` 又不传 `onToday`，界面上就**没有任何**「回到今天」入口
   *      （页脚那颗会按下面的规则撤掉）。这两条是配在一起用的，不是两个独立开关。
   */
  readonly toolbar?: 'inline' | 'external' | undefined;
  /**
   * 看哪一段：**月**（6 行 42 格）还是**周**（1 行 7 格）。
   *
   * 默认 `'month'` 不是偏好，是**兼容** —— 移动端现在没有档位切换入口，
   * 新 props 一律可选，否则两端同时红（§9.1）。
   *
   * 🔴 周视图**不是**"把月视图裁一行"：两者的 `inMonth` 参照不同
   *   （月：这一格属于显示的那个月；周：属于锚点日那个月 —— 见 `weekGrid`），
   *   而且点格子时游标要跟去的地方也不同（见下面的 `pickDay`）。
   */
  readonly view?: CalendarViewKind | undefined;
  /**
   * 当前时刻（epoch ms）。**只在日档有用**：那条"现在"线要它才画得了。
   *
   * ⚠️ 可选且**不给就不画** —— 界面状态 store 里不存时钟（存了就会漂：刷新后
   *   那条线停在旧时刻，而它看着和"活的"一模一样）。宿主从任务 store 的 `now` 透传。
   */
  readonly now?: number | undefined;
  /**
   * 工具栏**末尾**那一格的内容（Web 用它挂视图档位下拉）。
   *
   * ⚠️ 只有 `toolbar='inline'` 时才会用到 —— `'external'` 时工具栏由宿主自己
   *    渲染，宿主直接把同一份内容传给 `CalendarToolbar` 的 `trailing`。
   *    这里不预先替宿主决定"那一格放什么"，共享层不认识同步、也不认识宿主的面包屑。
   */
  readonly toolbarTrailing?: React.ReactNode;
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
  bars,
  hidden,
  labels,
  onPress,
}: {
  date: LocalDate;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  tone: CalendarDayTone;
  bars: readonly CalendarCellBar[];
  hidden: number;
  labels: CalendarBoardLabels;
  onPress: (date: LocalDate) => void;
}): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  /*
   * 日期数字的颜色**继续吃 `calendarDayTone`**。圆点撤了，但"逾期这一天要被注意到"
   * 那个信号不能跟着消失 —— 它只是从"格子里一块 4px 的红"挪到"数字本身是红的"，
   * 后者在 3 条任务条都画出来之后反而更准：一格里有红条也有黑条时，
   * 点色说不清这一天整体是什么状态，数字色说的清。
   */
  const numberColor = isSelected
    ? tokens['color.on-primary']
    : tone === 'danger'
      ? tokens['color.danger']
      : inMonth
        ? tone === 'subtle'
          ? tokens['color.foreground-muted']
          : tokens['color.foreground']
        : // 补白格（上月/下月）视觉上次要，但**仍然可点** ——
          // "点上月 30 号"是合法意图，把它做成不可点才是意外。
          tokens['color.foreground-subtle'];

  // 读屏时一屏 42 个"数字"没有意义，必须念成一个完整的日期 + 有没有事。
  // 日期本身由宿主的 `dayTitle` 说成当前语言。
  const dayTitle = labels.dayTitle(date);
  const barCount = bars.length + hidden;

  return (
    <Pressable
      onPress={() => onPress(date)}
      accessibilityRole="button"
      /* 格子的稳定锚点（R11 批一的判据要按日期取格子；索引会随月份错位而变）。 */
      testID={testIDOf(date)}
      /* 🔴 平铺 `aria-selected`：对象形态的 `accessibilityState` 在 react-native-web 上
         会被**整个丢掉**（`check:rn-aria` 断言 B 拦下的就是这一处）。 */
      aria-selected={isSelected}
      accessibilityLabel={
        barCount > 0
          ? labels.dayWithTasks({ date: dayTitle, count: barCount })
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
      {/*
        任务条（R11 批一）。原来是 4px 圆点，**格子里没有一个字可读**。
        每条 = 一根 3px 的状态色条 + 标题一行。三处刻意的选择：

        · **`numberOfLines={1}` + 不画省略号以外的东西**：标题超长时 RN 会截成
          "评审登录页…"。这与"被裁一半"是两件事 —— 前者读得出"这里有一条"，
          后者读不出。判据是那条几何断言（任何条的底边都在格子内）。
        · **选中态下不换了文字颜色就看不见**：整格变主蓝底时，条的左侧色条
          改成 `on-primary` 半透明，标题保持 `on-primary`。
        · **`+N` 只在真的有隐藏条时出现**：`hidden` 由 `calendarCellBars` 从数据算，
          所以"3 条 + +0"这种废话在结构上写不出来。
      */}
      {bars.map((bar) => (
        <View
          key={bar.id}
          testID={`${testIDOf(date)}-bar`}
          style={[styles.bar, { gap: tokens['space.1'] }]}
        >
          <View
            style={{
              width: tokens['border-width.thick'],
              alignSelf: 'stretch',
              borderRadius: tokens['radius.full'],
              backgroundColor: bar.overdue
                ? isSelected
                  ? tokens['color.on-primary']
                  : tokens['color.danger']
                : bar.done
                  ? tokens['color.foreground-subtle']
                  : isSelected
                    ? tokens['color.on-primary']
                    : tokens['color.primary'],
            }}
          />
          <Text
            numberOfLines={1}
            /* 🔴 标题**自己带一个 testID**：RN-web 里 `Text` 和 `View` 都渲染成 `<div>`，
               判据要是靠"条里第一个 div"会正好抓到那根**没有字的色条**，
               量到的颜色跟"字读不读得出"毫无关系（这条真错过一次）。 */
            testID={`${testIDOf(date)}-bar-title`}
            style={[
              text['row-meta'],
              styles.barTitle,
              {
                color: isSelected
                  ? tokens['color.on-primary']
                  : bar.done
                    ? tokens['color.foreground-subtle']
                    : tokens['color.foreground'],
              },
            ]}
          >
            {bar.title}
          </Text>
        </View>
      ))}
      {hidden > 0 ? (
        <Text
          numberOfLines={1}
          accessibilityLabel={labels.moreTasks === undefined ? undefined : labels.moreTasks(hidden)}
          testID={`${testIDOf(date)}-more`}
          style={[
            text['row-meta'],
            { color: isSelected ? tokens['color.on-primary'] : tokens['color.foreground-muted'] },
          ]}
        >
          {`+${hidden}`}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** 格子的 testID 后缀用日期本身，不用索引 —— 索引会随月份错位而变。 */
const testIDOf = (date: LocalDate): string => `calendar-cell-${date}`;

export function CalendarBoard({
  tasks,
  today,
  cursor,
  selected,
  onCursorChange,
  onSelect,
  onPickMonth,
  onToday,
  onToggleTask,
  onOpenTask,
  busyTaskId,
  labels,
  testID = 'calendar-board',
  toolbar = 'inline',
  view = 'month',
  now,
  toolbarTrailing,
}: CalendarBoardProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  const byDate = useMemo(() => groupTasksByDueDate(tasks), [tasks]);
  // 🔴 周视图是**一行**，不是"把六行里的一行挑出来"：`weekGrid` 的 `inMonth`
  //    跟着锚点日走，而 `monthGrid` 的跟着显示月走（两者理由见 `@heyta/domain`）。
  const weeks = useMemo<MonthGridCell[][]>(
    () => (view === 'week' ? [weekGrid(cursor)] : monthGrid(cursor)),
    [cursor, view],
  );
  /** 周次列只在月视图有意义：那一列就是"第几周"，而周视图整屏只有**一个**周。 */
  const showWeekNumber = view === 'month' && labels.weekNumber !== undefined;
  const dayTasks = byDate.get(selected) ?? [];

  /**
   * 点某一天。
   *
   * 🔴 **必须同时把游标跟过去**：否则选了"上月 30 号"却还停在本月，
   * 下面列出的日子在网格里根本看不到 —— 用户会以为点错了。
   * 跟去哪里由档位决定：**月**档跟到"那个月的 1 号"（游标的表示），
   * **周与日**档跟到**那一天本身** —— 游标的约定是"这一段里的任意一天"，
   * 而日档那一段只有一天。跟到 `startOfMonth` 会把画面跳到月初，正是这条规则要防的事。
   */
  const pickDay = useCallback(
    (date: LocalDate) => {
      onSelect(date);
      // 🔴 归一化规则用 `calendarCursorFor`（`model.ts`），这里**不再写一遍**：
      //   同一条判断落在"共享板 + 两个宿主"三处，就是 §3.5 说的同形状的第二次。
      onCursorChange(calendarCursorFor(view, date));
    },
    [onSelect, onCursorChange, view],
  );

  return (
    <View style={styles.root} testID={testID}>
      {/* ── 日档（R11 批四）与年档（R13）：整屏换一块板，共用同一格工具栏 ──────
          日档：一天摊开成**全天带 + 24 小时轴**，形状由产品负责人 2026-10-03 的截图拍板。
          年档：12 张缩略月卡，见 `CalendarYearBoard` 文件头。
          🔴 这两档**都不画**下面那两块（当天标题 + 当天清单）：标题在工具栏里，
          而"当天清单"在日档已被摊开成带与轴、在年档根本不属于这一屏 ——
          留着就是同一屏两份当天的账。
          工具栏**照旧要**：`‹ ›` 与「今天」是这两档唯一的移动入口（配合宿主的
          横向拖拽），而移动端是 `toolbar='inline'`，撤掉卡片就等于撤掉导航。
          ⚠️ 那一格的 testID 是 `${view}-card`：日档那条判据钉的是 `-day-card`，
             合并成一个分支后它必须**逐字节还是那个名字** —— 所以这里让 `view` 直接拼，
             不另起一套命名（改名不是本次重构的目的，去掉第三份重复才是）。 */}
      {view === 'day' || view === 'year' ? (
        <>
          {toolbar === 'external' ? null : (
            <View style={[styles.card, styles.dayToolbarCard]} testID={`${testID}-${view}-card`}>
              <CalendarToolbar
                cursor={cursor}
                onCursorChange={onCursorChange}
                onToday={onToday}
                labels={labels}
                view={view}
                trailing={toolbarTrailing}
              />
            </View>
          )}
          {view === 'year' ? (
            <CalendarYearBoard
              tasks={tasks}
              today={today}
              // 🔴 与日档同一条理由：年档渲染的也是**游标**（`‹ ›` / 滚轮写的都是它）。
              year={cursor}
              onPickMonth={onPickMonth}
              labels={labels}
              testID={`${testID}-year`}
            />
          ) : (
            <CalendarDayBoard
              tasks={tasks}
              // 🔴 日档渲染的是**游标**：`‹ ›`、滚轮、横向拖拽写的都是游标，
              //   渲染 selected 的话宿主一旦没同步，箭头就"点了没反应"。
              //   宿主侧那条"游标与选中同一天"由 `cursorFor` / `setCursor` 保证
              //   （见 `apps/web/src/features/calendar/store.ts`）。
              day={cursor}
              now={now}
              onToggleTask={onToggleTask}
              onOpenTask={onOpenTask}
              busyTaskId={busyTaskId}
              labels={labels}
              testID={`${testID}-day`}
            />
          )}
        </>
      ) : (
        <>
          {/* ── 月历 ─────────────────────────────────────────────
              🔴 这张卡片有**自己的 testID**：宿主需要区分"指针在月历网格上"与
              "在下面那份当天清单上"。Web 的滚轮翻月只在卡片内接管滚轮，
              清单那一块仍要能正常滚页（见 `apps/web/.../useWheelMonthNav.ts`）。 */}
          <View testID={`${testID}-month-card`} style={[styles.monthCard, styles.card]}>
        {/*
          工具栏（`‹ 2026年10月 ›  今天`）。**同一份组件、两种摆位**：
          默认画在卡片里（移动端没有页头插槽），Web 传 `toolbar="external"`
          让宿主把它挂进 `header.ht-header`（见 `CalendarToolbar.tsx` 文件头）。
        */}
        {toolbar === 'external' ? null : (
          <CalendarToolbar
            cursor={cursor}
            onCursorChange={onCursorChange}
            onToday={onToday}
            labels={labels}
            view={view}
            trailing={toolbarTrailing}
          />
        )}

        {/* 列头顺序**必须**与 `monthGrid` 的周一开头一致（见 `labels.weekdays`）。
            写反了不会报错，只会让整个日历**整体错位一格**。
            今天所在的那一列，列头用主色 —— 滴答同款（"今天为蓝色，其余灰"）。 */}
        <View style={styles.weekRow}>
          {showWeekNumber ? <View style={styles.weekNumCell} /> : null}
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
          <View key={week[0]!.date} style={[styles.weekRow, styles.weekRowBody]}>
            {/* 周次列（滴答式"31周"）：宿主给格式化，周一是网格开头，
                同一行任何一天的 ISO 周数都相同 —— 取第一天的即可。 */}
            {showWeekNumber ? (
              <View style={styles.weekNumCell}>
                <Text
                  style={[text.caption, { color: tokens['color.foreground-subtle'] }]}
                  numberOfLines={1}
                >
                  {/* `?.` 不是防御：`showWeekNumber` 这个**布尔**不会帮 TS 收窄
                      `labels.weekNumber`，写 `labels.weekNumber(...)` 编译不过。 */}
                  {labels.weekNumber?.(week[0]!.date)}
                </Text>
              </View>
            ) : null}
            {week.map((cell) => {
              const cellTasks = byDate.get(cell.date) ?? [];
              const { bars, hidden } = calendarCellBars(
                cellTasks,
                today,
                cell.date,
                // 档位决定"这一格画得下几条"（理由见常量本身）。
                view === 'week' ? MAX_WEEK_CALENDAR_BARS : MAX_CALENDAR_BARS,
              );
              return (
                <DayCell
                  key={cell.date}
                  date={cell.date}
                  day={Number(cell.date.slice(8, 10))}
                  inMonth={cell.inMonth}
                  isToday={cell.date === today}
                  isSelected={cell.date === selected}
                  tone={calendarDayTone(cellTasks, today, cell.date)}
                  bars={bars}
                  hidden={hidden}
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
        style={[styles.daySection, styles.card]}
        testID={`${testID}-day-section`}
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
        </>
      )}

      {/*
        页脚那颗「回到今天」。**只在工具栏没有它的时候**才画。
        🔴 同一屏两个「回到今天」是"同一件事两个入口"（本轮 UX 审计刚在别处修掉一类），
        而它不能直接删：移动端**没传 `onToday`**，那里页脚这颗是唯一点得动的入口。
        所以规则是"谁有客人谁待客"：工具栏带得动就归工具栏，带不动才留页脚。
      */}
      {onToday === undefined ? (
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
      ) : null}

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
    /*
     * 🔴 **全高**（R11 批一，产品负责人："它那个日历是全高的，而不是只占一半"）。
     *
     * 原来 root 只有 `gap` ⇒ 高度由内容决定，而内容就是"一行数字 + 三个点"，
     * 于是月历卡片只占屏幕上半截，下面大片空白。
     *
     * 三件套**照抄同仓已实测过的先例** `QuadrantBoard.tsx` 的 `board`：
     * `flexGrow: 1 / flexShrink: 0 / flexBasis: 'auto'`。
     * ⚠️ 刻意**不是** `flex: 1`（= `1 1 0%`）：那等于"被母层裁到那么高"，
     * 而"铺满"要的是**至少长到母层给的空间**。任务多的时候内容比视口高，
     * 允许收缩就会把月历网格压扁 —— 那是另一种"看不见"。
     *
     * ⚠️ 母层必须**把确定高度传下来**，这一层才拿得到空间（只改共享层在两端都空转）：
     *   · RN 是 `Screen` 的 `contentContainerStyle`（`apps/mobile/src/ui/kit.tsx` 已声明 `flexGrow: 1`）；
     *   · web 是 `.ht-content` + 中间那层滚轮宿主 div（`main-area.css` 的
     *     `.ht-content__calendar-host`）—— 这一层 2026-10-03 才补上，缺它的症状
     *     就是"板子有 flexGrow 但还是只占一半"。
     */
    root: {
      flexGrow: 1,
      flexShrink: 0,
      flexBasis: 'auto',
      gap: tokens['space.4'],
    },
    /*
     * 卡片**不**跟着长（批二看图后改的）。
     *
     * 🔴 原来这里写 `flexGrow: 1`，于是"全高"被落实成**月历网格被拉高**：
     *    720 的视口上、今天有 5 条任务时，六行各长到 ~190px，整月要滚着看，
     *    而当天清单被顶到两屏之外（那张图就是这么拍的）。
     *    "全高"要的是**这一屏铺满**，不是**网格撑大**。剩余空间归当天那一格
     *    （`daySection`）—— 那是一个列表，它变高是"能多看几条"，
     *    网格变高只是把数字之间的空拉开。
     *    ⚠️ `flexShrink: 0` 保留：清单变长时不许把网格压扁（那才是"被裁一半"）。
     */
    monthCard: {
      flexShrink: 0,
      gap: tokens['space.2'],
    },
    /*
     * 卡片的外壳（内边距 / 圆角 / 边框 / 底色）**只写这一次**。
     *
     * 🔴 原来三处各写一份字面的 token 组合（月历卡、当天卡、日档的工具栏卡）。
     *    三份"看着一样"的边框就是 `check:design` 拦的那件事的起点：某天真要改
     *    卡片描边时，漏掉的那一处不会报错，只会**在那一屏上长得不一样**。
     */
    card: {
      padding: tokens['space.3'],
      borderRadius: tokens['radius.md'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
      backgroundColor: tokens['color.surface'],
    },
    /** 日档的那条工具栏卡：外壳与另两张相同，只需要"不许被压"。 */
    dayToolbarCard: { flexShrink: 0 },
    /* 板内头部已搬进 `CalendarToolbar`（批二）—— 原来这里的
       `monthRow` / `monthTitle` / `iconButton` / `todayButton` 四条跟着搬走，
       留着的下场就是"同一颗按钮两处定义"。 */
    /* 周次列：固定窄宽（不参与 7 列的 flex 平分），列头行留一个同宽空位。 */
    weekNumCell: {
      width: tokens['space.8'],
      alignItems: 'center',
      justifyContent: 'center',
    },
    weekRow: { flexDirection: 'row' },
    /*
     * 六行**只许"不许被压"**，不许"跟着涨"。
     * ⚠️ 刻意**没有** `flexGrow`：卡片现在是内容高度（见 `monthCard`），
     * 给行加 flexGrow 在卡片不涨时空转，而一旦哪天卡片又涨了，
     * 它就把"全高"再次实现成"每行 190px 的横幅"（批二看图拍出来的那个形状）。
     * `flexShrink: 0` 是另一件事：视口一紧也不许把格子压到内容以下 ——
     * 那才是"任务条被裁掉一半"的直接成因（判据在 `e2e/tests/calendar-cells.spec.ts`）。
     */
    /*
     * 🔴 **两档共用同一条**：行只许"不许被压"，不许"跟着涨"。
     *    批三第一版给周档那一行加了 `flexGrow`（理由写的是"那一行就是主体"），
     *    而**判据全绿、图是错的**：空日历时它变成一根 772px 的纯蓝立柱
     *    （选中格是实心主蓝，格子又被拉满整行）—— 见
     *    `docs/plans/ui-review-fill-zh-timeline.md` §9.9 与 §7 #144。
     *    剩余空间归当天那一格这条规则**不分档位**：它变高是"能多看几条"，
     *    网格变高只是把空拉开。
     */
    weekRowBody: { flexShrink: 0 },
    /* 当天那一格是**唯一吃剩余空间的**：它变高 = 能多看几条；网格变高 = 只是把空拉开。 */
    daySection: { flexGrow: 1, flexShrink: 0, flexBasis: 'auto' },
    weekCell: { flex: 1, alignItems: 'center' },
    /* 格子里现在**有文字**，所以必须顶对齐 + 左对齐：居中会让三行条
       在格子里上下浮，同一周里"有事的那天"和"没事的那天"文字不同高，
       读起来像表格错位。 */
    cell: {
      flex: 1,
      alignItems: 'stretch',
      justifyContent: 'flex-start',
      paddingHorizontal: tokens['space.1'],
      paddingBottom: tokens['space.1'],
    },
    bar: { flexDirection: 'row', alignItems: 'center' },
    barTitle: { flex: 1, minWidth: 0 },
    dayHeader: { flexDirection: 'row', alignItems: 'center', gap: tokens['space.2'] },
    dayTitle: { flex: 1 },
    footerRow: { flexDirection: 'row', alignItems: 'center' },
    ghostButton: { alignItems: 'center', justifyContent: 'center' },
  });
}
