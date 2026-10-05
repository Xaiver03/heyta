/**
 * `CalendarYearBoard` —— 年视图：**12 张缩略月卡**，一张卡里只回答"这月哪几天有事"
 * =====================================================================
 *
 * 产品负责人要的形状就是滴答那张"12 个月缩略"（`docs/plans/ui-review-fill-zh-timeline.md`
 * §9.4 批四的另一半）。这一档与月档的**分工**不是"更小的月档"：
 *
 * | | 月档 | 年档 |
 * |---|---|---|
 * | 问的问题 | 这个月里这天有什么事 | **这一年里哪几天有事** |
 * | 格子里 | 标题条（可读的一条件事） | 一个状态点（只回答"有没有 / 逾不逾期"） |
 * | 上限 | `MAX_CALENDAR_BARS` 条 + `+N` | 没有条数概念 —— 一格里画不下字 |
 *
 * ⇒ 所以年档**不画任务标题**，也不是"月档裁小"：把 `DayCell` 参数化会逼它同时
 *   承载两种格子（日期数字 / 标题条 / 点色 / 选中框 / 补白格淡化），
 *   而它的 props 全是"日"形状、`testIDOf` 写死 `calendar-cell-<日期>`（年格是 `YYYY-MM`）。
 *   新组件比"给老组件加第五个开关"便宜，也少一处会漂的条件分支。
 *
 * ## 🔴 点一张月卡 = 切到那一月的「月」档，而**选中那天不动**
 *
 * 年档是总览，总览点下去必须有去处；否则它是一条死胡同（只能 ±1 年）。
 * "翻去看别的月，不等于改选中的那天"是已有的裁决（`apps/web/src/features/calendar/store.ts`
 * 的 `setCursor` 注释），这里照用 —— 宿主的实现就是 `setView('month')` + `setCursor(...)`，
 * **不新增 store 原语**。
 *
 * 🔴 宿主**没给** `onPickMonth` 时，月卡整块**不渲染成可点**（连 `accessibilityRole` 都不给）。
 * 这是 §9.3「不摆点了没反应的菜单项」在这一档的落地形状：宁可少一个交互，
 * 也不摆一个按下去什么都不发生的格子。判据是那条"没有回调 ⇒ 没有按钮角色"。
 *
 * ## 颜色：语义只有一份，编码方式各是一张卡的事
 *
 * `calendarDayTone` 是唯一的判定（逾期 / 有待办 / 全做完 / 空），
 * `groupTasksByDueDate` 是唯一的天归属 —— 两者月档已经在用，这里**照用同一份**。
 * 变的只是"同一个 tone 画成什么"：月档画成日期数字的颜色（那里有标题条，
 * 点色说不清整格状态），年档画成点（没有别的东西可说）。
 * 把编码也焊成一个 `toneToColor()`，反而会把"月档 subtle 时数字是灰的"抄进年档，
 * 而年档的 subtle 点必须**看得见** —— 它说的是"这天做完了"，不是"这天没东西"。
 *
 * ## 🔴 列数量的是**容器**，不是窗口
 *
 * 与 `QuadrantBoard` 的 `twoColumns`（宿主传布尔）同一条立场：共享层不猜视口 ——
 * RNW 的 `Dimensions` 取的是物理屏（实测 660px 视口报 1728）。但这里量的是
 * **`onLayout` 的那块盒子**：`clientWidth` 把 rail 与侧栏算在外面，用窗口宽去除以
 * 卡片下限会**多算一列**，症状是每张月卡被压到比"侧栏里那张迷你月历"还窄。
 *
 * ⚠️ jsdom 不触发 `onLayout` ⇒ 组件级测试里恒为 **1 列**，那是**已知形状**不是缺陷；
 *   "12 张卡按约数分行"这条由共享纯函数 `calendarYearColumns` 的单测钉住，
 *   而"真浏览器里真的分了 4 行"由 `e2e/tests/calendar-year.spec.ts` 钉。
 *
 * ## 行里必须整除 12
 *
 * 见 `model.ts#calendarYearColumns`：12 张卡摆 5 列会把两张孤零零挂在最后一行，
 * 而日历上任何一处"看着像缺了什么"都会被读成"数据没了"。
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import type { HeytaNativeTokens } from '@heyta/design-system';
import {
  addDays,
  addMonths,
  monthGrid,
  monthsOfYear,
  startOfYear,
  type CountdownEvent,
  type LocalDate,
  type Task,
} from '@heyta/domain';

import { useHeytaText, useHeytaTokens } from '../theme.js';
import {
  calendarDayTone,
  calendarYearColumns,
  groupEventsByOccurrence,
  groupTasksByDueDate,
  type CalendarBoardLabels,
  type CalendarDayTone,
} from './model.js';

export interface CalendarYearBoardProps {
  /** 全部候选任务（已按范围筛过）。归属只看 `dueDate` 落在哪一天。 */
  readonly tasks: readonly Task[];
  /**
   * 第二个事件源（W6）。**必填**，理由见 `CalendarBoardProps.events`。
   * 年档按**这一年**（1 月 1 日 → 12 月 31 日，也就是这里真的画出来的那些格子）枚举，
   * 不复用月档那份按 42 格切的区间 —— 拿过去只会让另外 11 个月看不到倒数日。
   */
  readonly events: readonly CountdownEvent[];
  readonly today: LocalDate;
  /** **这一年里的任意一天**（游标约定，见 `monthsOfYear`）。 */
  readonly year: LocalDate;
  /**
   * 点某张月卡。🔴 不给 ⇒ 月卡不可点（见文件头那条立场）。
   *
   * 给出去的是那个月的 **1 号** —— 宿主拿到之后做什么（切档、把游标放过去）是宿主的组合，
   * 本层不替宿主决定"点下去要不要连选中一起改"。
   */
  readonly onPickMonth?: ((monthFirstDay: LocalDate) => void) | undefined;
  readonly labels: CalendarBoardLabels;
  readonly testID?: string;
}

/** 月卡的 testID 用 `YYYY-MM`，不用 1..12 的序号 —— 序号跨年就没法稳定寻址。 */
const monthSuffix = (monthFirstDay: LocalDate): string => monthFirstDay.slice(0, 7);

/**
 * 一张缩略月卡里的格子**直接吃 `monthGrid`**（领域层那份 6×7）。
 *
 * 🔴 这里以前自己拼过一份"这个月有哪几天"（`daysInMonth` + 字符串补零），
 *   而那份**没有周的概念** —— 31 个格子被当成一维数组塞进一个
 *   `flexWrap` 容器，而每格是 `flexBasis: 0 + flexGrow: 1`：
 *   基宽为 0 ⇒ **永远换不了行**，于是 31 天全挤在同一行上互相压字。
 *   单测里数得出"2 月 28 格、10 月 31 格"，因为数的是**节点数**不是**位置**；
 *   这张图是截图才看见的（AGENTS §6.2 规定一）。
 *   正解不是"再写一份分行逻辑"，是用领域层那份已经管着补白格与周一开头的
 *   `monthGrid` —— 同一件事的第二份实现就是漂移的开始（AGENTS §3.5）。
 * ⚠️ 补白格（上月末/下月初）在这张缩略图里画**空格子**而不是数字：
 *   月档里点它是合法意图（那里格子可点），年档里卡才可点、格不可点 ⇒ 画数字只会
 *   让人把"2 月 30 日"读成这月真有这天。列对齐靠的是同一份 `flexBasis: 0` 槽位。
 */

/** 一张缩略月卡里的一个格子：日期数字 + 有事时一个状态点。 */
function MiniDay({
  date,
  dayTasks,
  dayEvents,
  today,
  isToday,
  labels,
  styles,
  tokens,
  text,
  testIDBase,
}: {
  date: LocalDate;
  dayTasks: readonly Task[];
  /** 这一天落得的倒数日（第二个事件源，W6）。 */
  dayEvents: readonly CountdownEvent[];
  today: LocalDate;
  isToday: boolean;
  labels: CalendarBoardLabels;
  styles: ReturnType<typeof makeStyles>;
  tokens: HeytaNativeTokens;
  text: ReturnType<typeof useHeytaText>;
  testIDBase: string;
}): React.JSX.Element {
  const tone: CalendarDayTone = calendarDayTone(dayTasks, dayEvents, today, date);
  const dotColor =
    tone === 'danger'
      ? tokens['color.danger']
      : tone === 'primary'
        ? tokens['color.primary']
        : tone === 'subtle'
          ? tokens['color.foreground-muted']
          : 'transparent';

  return (
    <View
      style={[styles.day, isToday ? styles.dayToday : null]}
      testID={`${testIDBase}-day-${date}`}
      /*
        🔴 平铺 `aria-current="date"`，与月格那条 `aria-selected`（`CalendarBoard.tsx:203`）
        同一写法：今天这一格在**视觉上**只靠一圈边框/主色区分，读屏用户念得到日期、
        念不出"这是今天"。一屏三百多个数字里找今天不该靠肉眼，也不该靠猜。
        ⚠️ 对象形态的 `accessibilityState` 在 react-native-web 上会被整个丢掉，
        所以它必须是平铺属性（`check:rn-aria` 断言 B 拦的就是这个）。
      */
      aria-current={isToday ? 'date' : undefined}
      /*
        读屏名**照月档那两条**（`dayWithTasks` / `dayNoTasks`）：一屏三百多个数字
        对读屏用户没有任何意义，而"这天有没有事"正是这一档唯一的增量信息。
        日期由宿主的 `dayTitle` 说成当前语言，数量是**真的那一条**（不是 1 个占位）。
        🔴 那个数是**两个来源加起来**的，与月档格子（`bars.length + hidden`）、
        当天那块 header 同一条口径 —— 年档漏掉倒数日的话，"这天 3 件事"点进去
        只剩 2 件，而三个界面各自都"看起来对"。
      */
      accessibilityLabel={
        dayTasks.length + dayEvents.length > 0
          ? labels.dayWithTasks({
              date: labels.dayTitle(date),
              count: dayTasks.length + dayEvents.length,
            })
          : labels.dayNoTasks({ date: labels.dayTitle(date) })
      }
    >
      <Text
        style={[
          text['row-meta'],
          styles.number,
          {
            color: isToday
              ? tokens['color.primary']
              : tone === 'danger'
                ? tokens['color.danger']
                : tokens['color.foreground'],
          },
        ]}
      >
        {Number(date.slice(8, 10))}
      </Text>
      {/*
        `plain` 那一档**什么都不画**（点色 `transparent` 也不画 —— 省掉一个透明节点）。
        于是"有事的格子"数字下面多一个记号，而"没事的格子"只有数字；
        数字本身两行都钉在同一基线上（`justifyContent: flex-start` + 定高），
        所以不会画成"有事的那几天字往上跳了一格"。
      */}
      {tone === 'plain' ? null : (
        <View
          style={[styles.dot, { backgroundColor: dotColor }]}
          testID={`${testIDBase}-day-${date}-dot`}
        />
      )}
    </View>
  );
}

export function CalendarYearBoard({
  tasks,
  events,
  today,
  year,
  onPickMonth,
  labels,
  testID = 'calendar-year-board',
}: CalendarYearBoardProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const [width, setWidth] = useState(0);

  // 🔴 与月档同一份归属函数：年档要的是"这天有没有 / 逾不逾期"，
  //   而那两个判断的输入就是这一份按天分好的任务。另数一遍计数 = 第二套口径。
  const byDate = useMemo(() => groupTasksByDueDate(tasks), [tasks]);
  /*
   * 倒数日按**这一年**分组（`[1 月 1 日, 12 月 31 日]`）。
   *
   * ⚠️ 区间的两端都从 `startOfYear` 推，不写 `'…-12-31'` 这种字符串：
   *   `addMonths(1 月 1 日, 12)` 再退一天 = 这一年的最后一天，闰年与月份天数
   *   都由 `@heyta/domain` 那一份说了算（在这里自己拼 31 就是第二套日历数学）。
   * 🔴 归属判断本身在 `groupEventsByOccurrence`（月/周/日/年四档共用），这里不重判。
   */
  const eventsByDate = useMemo(() => {
    const from = startOfYear(year);
    return groupEventsByOccurrence(events, from, addDays(addMonths(from, 12), -1));
  }, [events, year]);
  const months = useMemo(() => monthsOfYear(year), [year]);

  /**
   * 一行几张：量到的宽度 ÷ 一张迷你月历的下限，再**向下取到 12 的约数**。
   *
   * 下限取 `layout.sidebar-min-width` —— 🔴 它不是随手挑的数：侧栏里那张迷你月历
   * **长期就以这个宽度渲染并被验收过**，也就是说"这个宽度下迷你月历还读得出来"
   * 是仓里已经付过证据的唯一一个值。再定一个新宽度就是再造一顶没人验证过的帽。
   * 加上的那份 `space.3` 是行内 gap：`columns` 张卡之间有 (columns-1) 条缝，
   * 用"每张卡 + 一条缝"去除是**保守估法**（宁可少一列，不可压到读不出）。
   */
  const columns = calendarYearColumns(
    width > 0
      ? Math.floor((width + tokens['space.3']) / (tokens['layout.sidebar-min-width'] + tokens['space.3']))
      : 1,
  );

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setWidth((previous) => (previous === next ? previous : next));
  }, []);

  const rows: LocalDate[][] = [];
  for (let i = 0; i < months.length; i += columns) rows.push(months.slice(i, i + columns));

  return (
    <View style={styles.root} testID={testID} onLayout={onLayout}>
      <ScrollView style={styles.scroll} testID={`${testID}-scroll`}>
        {rows.map((row, rowIndex) => (
          <View
            key={`row-${String(rowIndex)}`}
            style={styles.row}
            testID={`${testID}-row-${String(rowIndex)}`}
          >
            {row.map((monthFirstDay) => {
              const suffix = monthSuffix(monthFirstDay);
              /*
                可不可点**只取决于宿主给没给回调**（文件头那条立场）。
                用 `Pressable` 包一个什么都不做的卡，就是"点了没反应"的字面形状。
              */
              /*
                🔴 月卡那个 testID 挂在**最外面那一层**（可点时是 `Pressable`，
                不可点时是 `View`），里面那层叫 `-body`。挂在里面那一层的症状：
                判据想数"有几张卡能点"时，`[role=button]` 与 `[data-testid]`
                落在**两个节点**上，于是"接了回调也测出 0 张可点卡"——
                一个稳定的锚点必须是**能被点的那一个**，否则测的永远是壳。
              */
              const body = (
                <View style={styles.monthBody} testID={`${testID}-month-${suffix}-body`}>
                  <Text
                    style={[text['group-label'], styles.monthTitle]}
                    testID={`${testID}-month-${suffix}-title`}
                  >
                    {labels.yearMonthTitle?.(monthFirstDay) ?? labels.monthTitle(monthFirstDay)}
                  </Text>
                  {/*
                    列头是这张卡的**刻度**，不是装饰：`monthGrid` 周一开头，而没有
                    "一二三四五六日"就没人能核对第一列是周几。顺序直接吃
                    `labels.weekdays`（宿主给的就是周一开头的 7 个）—— 在这一层重排一次，
                    就是"同一屏两个日历差一格"的开始（见 `model.ts` 那里同一条警告）。
                  */}
                  <View style={styles.weekRow} testID={`${testID}-month-${suffix}-weekdays`}>
                    {labels.weekdays.map((weekday, index) => (
                      <Text key={`wd-${String(index)}`} style={[text['row-meta'], styles.weekday]}>
                        {weekday}
                      </Text>
                    ))}
                  </View>
                  <View style={styles.dayGrid}>
                    {monthGrid(monthFirstDay).map((week, weekIndex) => (
                      <View
                        key={`week-${String(weekIndex)}`}
                        style={styles.weekRow}
                        testID={`${testID}-month-${suffix}-week-${String(weekIndex)}`}
                      >
                        {week.map((cell) =>
                          cell.inMonth ? (
                            <MiniDay
                              key={cell.date}
                              date={cell.date}
                              dayTasks={byDate.get(cell.date) ?? []}
                              dayEvents={eventsByDate.get(cell.date) ?? []}
                              today={today}
                              isToday={cell.date === today}
                              labels={labels}
                              styles={styles}
                              tokens={tokens}
                              text={text}
                              testIDBase={testID}
                            />
                          ) : (
                            /*
                              补白格用的是**同一份 `styles.day`**（空的），不是另一套
                              "同样 flex"的样式 —— 这不是重复，是让它没法漂的唯一办法：
                              真浏览器实测，换成 `flexGrow/flexShrink/flexBasis` 三个值
                              相同但没有边框的另一套样式后，行与行之间会错开 2~4px
                              （机制见 `day` 那里）。
                            */
                            <View key={`blank-${cell.date}`} style={styles.day} />
                          ),
                        )}
                      </View>
                    ))}
                  </View>
                </View>
              );

              if (onPickMonth === undefined) {
                return (
                  <View
                    key={monthFirstDay}
                    style={styles.monthCell}
                    testID={`${testID}-month-${suffix}`}
                  >
                    {body}
                  </View>
                );
              }

              return (
                <Pressable
                  key={monthFirstDay}
                  style={styles.monthCell}
                  testID={`${testID}-month-${suffix}`}
                  accessibilityRole="button"
                  onPress={() => onPickMonth(monthFirstDay)}
                >
                  {body}
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    root: {
      // 🔴 与月/日档同一条全高契约（§9.6）：`flexGrow` + `flexShrink: 0` + `flexBasis: auto`。
      flexGrow: 1,
      flexShrink: 0,
      flexBasis: 'auto',
      gap: tokens['space.3'],
    },
    // 12 张卡必然超一屏 ⇒ 滚的是这里，而 `root` 保持撑满。
    scroll: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
    row: {
      // 🔴 按行摆、每格 `flexBasis: 0`：与四象限那条同一个教训 ——
      //   `flexWrap` + `minWidth: '50%'` + `gap` 在 web 上**必然**塌成一列通栏卡
      //   （50% + 50% + gap > 100%）。这里结构上不给它塌的机会。
      flexDirection: 'row',
      gap: tokens['space.3'],
      marginBottom: tokens['space.3'],
    },
    monthCell: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
    monthBody: {
      gap: tokens['space.1'],
      padding: tokens['space.2'],
      borderRadius: tokens['radius.md'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border-subtle'],
      backgroundColor: tokens['color.surface'],
    },
    monthTitle: { color: tokens['color.foreground'] },
    weekRow: { flexDirection: 'row' },
    weekday: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      textAlign: 'center',
      color: tokens['color.foreground-muted'],
    },
    /*
      🔴 `dayGrid` 是**行的容器**（纵向排 6 行），横向那 7 列在每一行里等分。
      以前这里是 `flexDirection:'row' + flexWrap:'wrap'` 而每格 `flexBasis:0` ——
      基宽 0 意味着"永远塞得下"，`flexWrap` 于是**从不生效**，31 天挤成一行。
      结构上按周分行之后，塌不塌由不了 `flexWrap` 说了算。
    */
    dayGrid: { gap: tokens['space.1'] },
    day: {
      // 7 列等分：`flexBasis: 0` + `flexGrow: 1`（与 `weekRow` 同一形状，
      // 而不是 `width: '14.28%'` —— 后者与 gap 打架，就是四象限塌成一列那个坑）。
      //
      // 🔴 这一档样式**也**给补白格用（`styles.day` 空的），不要另立一套"看着一样"的
      //   flex 样式：`flexBasis: 0` 在 `box-sizing: border-box` 下不能小于该盒的
      //   边框+内边距，于是**带 1px 边框的格子基宽是 2px、没有边框的是 0** ——
      //   同一行里两者分到的宽度差约 2px，缺格越多差得越多。实测（1280 视口，相邻格的
      //   x 差）：整行都有日子时 29.3，月末那行（6 格）29.6，月初那行（4 格）30.3，
      //   ⇒ 第一行的 1 号落在 x=656 而表头那一列在 660.3。这不是舍入（舍入只有 ±1px）。
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      alignItems: 'center',
      justifyContent: 'flex-start',
      paddingVertical: tokens['space.1'],
      borderRadius: tokens['radius.sm'],
      borderWidth: tokens['border-width.thin'],
      borderColor: 'transparent',
    },
    dayToday: {
      borderColor: tokens['color.primary'],
      backgroundColor: tokens['color.primary-subtle'],
    },
    number: { textAlign: 'center', fontVariant: ['tabular-nums'] },
    dot: {
      width: tokens['size.badge-dot'],
      height: tokens['size.badge-dot'],
      borderRadius: tokens['radius.full'],
    },
  });
}
