/**
 * 日历（移动端）
 * ================
 *
 * 月视图 + 选中某天看当天任务。
 *
 * 「任务」页回答"现在该干什么"，这一页回答"哪天有什么事" —— 本地优先的任务
 * 应用里，这两件事都得有，否则安排一周的活只能靠翻列表。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 **这个文件现在只做三件事**：取数据、把 i18n 翻成 `labels`、把动作转交 action 层。
 *
 * 界面本身（月网格、42 个格子、当天的行）**全部来自 `@heyta/ui` 的共享
 * `CalendarBoard`** —— 与 Web 是同一份实现。在此之前这份渲染只存在于移动端，
 * 于是 Web 上**根本没有日历**（产品负责人 2026-09-29 给的参考 IA 里，
 * 日历是 5 个主菜单之一）。
 *
 * ⚠️ 日历**数学**一行都不在共享板、也不在这里：
 * `monthGrid` / `startOfMonth` / `addMonths` / `isoWeekday` 全部来自 `@heyta/domain`。
 * 会**静默算错**的东西全集中在那一处（补白格属于上月还是本月、周一还是周日开头、
 * 1 月 31 日加一个月落到哪天）。
 *
 * ⚠️ 日期**措辞**也不在这里了：`formatMonthTitleText` / `formatDayTitleText` /
 * `WEEKDAY_MESSAGE_KEYS` 已上移到 `@heyta/ui` 的 `calendar/date-text.ts`
 *（`lib/date.ts` 里那三个已删掉 —— 该文件头自己就写着"不要在本文件里转发一层，
 * 转发会让下一个人以为这里还是定义处"）。`DatePicker` 也改从那一边引。
 *
 * 🔴 **两个日期数据源**（W6）：任务按 `dueDate` 摆，倒数日按它自己的发生日摆。
 * 后者原先**只有面板（「我的 → 倒数纪念日」）有，日历一格都不画** ——
 * 共享板 2026-10-04 起有了可选的 `events` / `eventLabels` 两个 prop，而
 * "组件支持了"与"宿主真的接上了"是两件事（AGENTS §7 记过第五种同一面目）。
 * 哪一天真的发生（闰月三档、农历跨年、重复规则展开）**全在 `@heyta/domain`**，
 * 摆进哪一格、超出 3 条怎么折成 `+N` 全在 `@heyta/ui`，这一层只负责交数据。
 *
 * 🔴 写入只有一处：勾选完成，走 `createTaskActions`。
 * 这一层**不做**任何自己的 op 构造（AGENTS.md §3.5）。
 *
 * 🔴 **档位入口（月 / 周 / 日）在 2026-10-03 才补上**（§9.4「批三·补」）。
 * 在此之前这一屏永远只有月档 —— 共享板两端同一份，可入口只有一端有，
 * 于是"周视图/日视图已交付"在手机上其实只兑现了一半。
 * 形态为什么是一排按钮而不是下拉：见 `CalendarViewTabs` 文件头。
 * ─────────────────────────────────────────────────────────────────────────
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { startOfMonth, toLocalDate, type CountdownEvent, type LocalDate, type Task } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import {
  createEventActions,
  createTaskActions,
  type AppHost,
  type EventActions,
  type TaskActions,
} from '@heyta/app-host';
import {
  CalendarBoard,
  CalendarViewTabs,
  CALENDAR_VIEW_LABEL_KEYS,
  CALENDAR_VIEW_ORDER,
  calendarCursorFor,
  calendarHourMark,
  calendarMonthDrill,
  calendarSelectedForCursor,
  formatDayTitleText,
  formatMonthShortText,
  formatMonthTitleText,
  formatYearTitleText,
  WEEKDAY_MESSAGE_KEYS,
  type CalendarEventBarLabels,
  type CalendarViewKind,
} from '@heyta/ui';
import { useToday } from '../lib/use-today';

import { openTaskHost } from '../db/open-host';
import { useMobileSync } from '../sync/store';
import { Screen, Text } from '../ui/kit';

/**
 * 这一屏**真的能切过去**的档位 = 共享层那份 `CALENDAR_VIEW_ORDER`（R17 起这里不再写一份）。
 *
 * 🔴 刻意不含「时间线」：时间线在移动端是另一张屏（`TimelineScreen`），
 *   把它塞进这一屏的切换器就等于"同一个视图两个入口、两份当前态"——
 *   Web 那边为同一件事写成分叉（选它就 `goToView`，不写进日历 store），
 *   而移动端连那个分叉都没有，硬加只会多出一个"看着像档位其实是另一张屏"的东西。
 * ✅ 含「年」是因为 R13 把它真的做出来了（`CalendarYearBoard`）——
 *   那条"不许提前画一个点了没反应的选项"的立场由共享那份表统一守：
 *   **表里没有的档位，两端都画不出来**，而加一档不给键名会编译不过。
 */

export function CalendarScreen(): React.JSX.Element {
  const { t } = useI18n();
  const [host, setHost] = useState<AppHost | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  /**
   * 倒数日（W6）：日历的**第二个日期数据源**。
   *
   * 🔴 这里存的是**全量活的事件**，刻意不按可见月筛：哪几天落在这一屏由共享板的
   * `groupEventsByOccurrence` 算（它取的是 42 格里首末格那段区间，含补白格）。
   * 宿主先筛一遍月就是第二份数学，症状是"5 月 3 日那条纪念日在 10 月屏的补白列里
   * 不出现"，而没有任何一层会报错。
   */
  const [events, setEvents] = useState<CountdownEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** 正在写入的任务 id —— 防止连点产生两次 toggle。 */
  const [busyId, setBusyId] = useState<string | null>(null);

  // 🔴 "现在"由 `useToday` 提供：回到前台与跨过本地零点时会刷新。
  // 原来的 `useMemo(() => Date.now(), [])` 会让"今天"永远停在打开应用的那一天。
  // ⚠️ `now` 同一个来源：日档那根现在线读的也是它 —— 在这里另写一次 `Date.now()`
  //    就是"两个时钟"，症状是轴上那根线停在打开应用的那一刻。
  const { now, today } = useToday();
  // 同步完成 → `dataRevision` 变 → 上面的 effect 重读物化状态。
  const { dataRevision } = useMobileSync();

  /** 正在显示的月份（用该月里任意一天表示）。 */
  const [cursor, setCursor] = useState<LocalDate>(() => startOfMonth(toLocalDate(Date.now())));
  /** 选中的那一天。 */
  const [selected, setSelected] = useState<LocalDate>(() => toLocalDate(Date.now()));
  /** 这一屏看的是哪一档（月 / 周 / 日 / 年）。 */
  const [view, setView] = useState<CalendarViewKind>('month');

  /** 上一次的"今天"，用来判断跨零点时选中框要不要跟着走。 */
  const prevToday = useRef(today);

  useEffect(() => {
    // 🔴 跨零点后，若选中框还停在**上一个"今天"**（说明用户没手动挑过别的日子），
    // 就把它带到新的今天。否则第二天打开时选中框仍框着昨天、下面列表还是昨天那一列，
    // 而「回到今天」按钮看起来毫无反应。
    //
    // ⚠️ 这个 effect 必须放在 `selected` / `cursor` **声明之后** ——
    // 放在 `useToday()` 旁边会引用尚未初始化的 `selected`，
    // 而这正是 `pnpm typecheck` 抓到的（TS2448 / TS2454）。
    if (prevToday.current !== today && selected === prevToday.current) {
      setSelected(today);
      setCursor(startOfMonth(today));
    }
    prevToday.current = today;
  }, [today, selected]);

  useEffect(() => {
    let alive = true;
    // 🔴 驱动是工厂不是实例：`SqliteAdapter` 会在 close 后靠它重开。
    void openTaskHost()
      .then((h) => {
        if (alive) setHost(h);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const actions = useMemo<TaskActions | null>(
    () => (host ? createTaskActions(host) : null),
    [host],
  );
  // 与 `CountdownScreen` 同一个动作集来源：宿主派生，界面里不新造（AGENTS §3.5）。
  const eventActions = useMemo<EventActions | null>(
    () => (host ? createEventActions(host) : null),
    [host],
  );

  const refresh = useCallback(() => {
    if (!actions || !eventActions) return;
    // ⚠️ 两个 list 都是**同步**的（读已物化的内存状态），不是 Promise。
    setTasks(actions.listTasks());
    /**
     * 🔴 `listEvents(today)` 只给**未归档、未删除**的那些（`aliveEvents` 同一个口径）。
     * 归档的留在「我的 → 倒数纪念日」那个视图里，不进日历 ——
     * 传错了列表的症状是"删掉的日子还在日历上"，读作"没删干净"。
     *
     * ⚠️ Web 那边要额外 `syncToday(today)` 播种，因为它的 countdown store 在拿到
     * "今天"之前**不猜**；移动端没有那份 store —— `today` 就在这一次调用里给到
     * 动作层，所以这一侧不需要播种（也**不许**为"对齐 web"新写一份 store）。
     */
    setEvents(eventActions.listEvents(today));
  }, [actions, eventActions, today]);

  useEffect(() => {
    if (!host) return;
    // 🔴 必须等 `recover()` 走完再读 —— openTaskHost 已经保证了这一点
    // （AGENTS.md §7 第 9 条）。
    refresh();
    // 🔴 `dataRevision`：同步完成后重读。少了它，日历屏会一直显示同步前的快照。
  }, [host, refresh, dataRevision]);

  const onToggleTask = useCallback(
    (taskId: string) => {
      if (!actions || busyId !== null) return;
      setBusyId(taskId);
      void actions
        .toggleCompleted(taskId)
        .then(() => {
          refresh();
        })
        .catch((e: unknown) => {
          // 必须让用户看见：否则点一下什么都没发生，看起来像按钮坏了。
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          setBusyId(null);
        });
    },
    [actions, busyId, refresh],
  );

  /**
   * 游标动了（`‹ ›`、滚轮、以及日档的横向拖拽都走这里）。
   *
   * 🔴 两条规则**不在本文件**：归一化在 `calendarCursorFor`、
   *   "日档里游标带走选中"在 `calendarSelectedForCursor`（都在 `@heyta/ui`）——
   *   Web 那份 store 用的是同一对。写成两份的下场是两端各指一天。
   *
   * ⚠️ `setSelected` 走**函数式更新**：共享板的 `pickDay` 是连着调
   *   `onSelect(date)` + `onCursorChange(date)` 两个 setter，React 会批处理它们，
   *   而闭包里的 `selected` 还是**上一次渲染**的那个 —— 直接读它就会把刚点的那一天
   *   写回成旧的（症状：月档点格子没选中、日档点了没反应）。
   */
  const stepCursor = useCallback(
    (date: LocalDate) => {
      setCursor(calendarCursorFor(view, date));
      setSelected((prev) => calendarSelectedForCursor(view, date, prev));
    },
    [view],
  );

  const pickDay = useCallback(
    (date: LocalDate) => {
      setSelected(date);
      setCursor(calendarCursorFor(view, date));
    },
    [view],
  );

  /**
   * 年档里点了一张月卡。
   *
   * 🔴 "去哪"不在这里判：`calendarMonthDrill`（`@heyta/ui`）给的就是"要改哪几项"，
   *   而它的返回值里**没有 `selected`** —— 所以"点月卡不换选中那天"这条
   *   在类型上成立，不靠我记得别写它。Web 那边接的是同一个函数
   *   （`store.drillIntoMonth`），两端各写一套状态迁移就是 AGENTS §3.5 那一刀。
   */
  const pickMonth = useCallback((monthFirstDay: LocalDate) => {
    const drill = calendarMonthDrill(monthFirstDay);
    setView(drill.view);
    setCursor(drill.cursor);
  }, []);

  const changeView = useCallback(
    (next: CalendarViewKind) => {
      setView(next);
      // 换档不换"选中哪天"，只把游标挪到那一天所在的那一段（与 Web 的 `setView` 同一条）。
      setCursor(calendarCursorFor(next, selected));
    },
    [selected],
  );

  /**
   * 共享板要的全部文案。
   *
   * 🔴 共享层**不许 `import '@heyta/i18n'`**（会拖进第二份 React），
   * 所以文案由宿主注入 —— 而日期措辞走的是**共享**的 `date-text.ts`，
   * 不是这里另写一份（两端各写一份的必然结果是同一个日子显示成
   * 「9月26日 星期五」和「9月26日 周五」，而没人会为此报 bug）。
   */
  const labels = useMemo(
    () => ({
      monthTitle: (d: LocalDate) => formatMonthTitleText(d, t),
      dayTitle: (d: LocalDate) => formatDayTitleText(d, t),
      weekdays: WEEKDAY_MESSAGE_KEYS.map((k) => t(k)) as unknown as readonly [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ],
      // 英文单复数在调用方分支：恰好 1 个走 `…One` 兄弟词条，
      // 否则英文会渲染成 "1 tasks"（词条表刻意没有 ICU）。
      dayWithTasks: ({ date, count }: { date: string; count: number }) =>
        count === 1
          ? t('mobile.calendar.a11y.dayWithTasksOne', { date, count })
          : t('mobile.calendar.a11y.dayWithTasks', { date, count }),
      dayNoTasks: ({ date }: { date: string }) => t('mobile.calendar.a11y.dayNoTasks', { date }),
      // `+3` 读屏会念成"加三"，给它一句人话（视觉不变，两端同一份词条）。
      moreTasks: (count: number) => t('mobile.calendar.a11y.moreTasks', { count }),
      prevMonth: t('mobile.common.prevMonth'),
      nextMonth: t('mobile.common.nextMonth'),
      // 🔴 周/日两档的词与 Web **同一份**（`common.calendar.*`）。留在 `web.*` 里
      //    就是逼移动端另抄一套 —— 而两套的必然下场是同一个按钮在两端说法不同，
      //    且没有任何一层会报错（词条对账只比中英，不比 web 与 mobile）。
      prevWeek: t('common.calendar.prevWeek'),
      nextWeek: t('common.calendar.nextWeek'),
      prevDay: t('common.calendar.prevDay'),
      nextDay: t('common.calendar.nextDay'),
      // 年档（R13）：标题、两个箭头、月卡顶上的短月份名 —— 三条都走共享的
      // `date-text.ts` / 同一批词条，移动端一份都不新写。
      yearTitle: (d: LocalDate) => formatYearTitleText(d, t),
      yearMonthTitle: (d: LocalDate) => formatMonthShortText(d, t),
      prevYear: t('common.calendar.prevYear'),
      nextYear: t('common.calendar.nextYear'),
      dayAllDay: t('common.calendar.dayAllDay'),
      dayNoTimed: t('common.calendar.dayNoTimed'),
      // 🔴 与 web 同一句：「全天」带的空态只管这条带，不管"这一天有没有到期的任务"。
      dayAllDayEmpty: t('common.calendar.dayAllDayEmpty'),
      // 时刻刻度也只有一份：`calendarHourMark`（与时间线同源），这里不另写格式。
      hourLabel: (hour: number) => calendarHourMark(hour),
      backToToday: t('mobile.calendar.backToToday'),
      dayEmpty: t('mobile.calendar.dayEmpty'),
      footnote: t('mobile.calendar.footnote'),
      taskRow: {
        toggleOn: (row: { title: string }) => t('mobile.calendar.a11y.markDone', { title: row.title }),
        toggleOff: (row: { title: string }) =>
          t('mobile.calendar.a11y.unmarkDone', { title: row.title }),
      },
    }),
    [t],
  );

  /**
   * 倒数日那一行**怎么写**（W6，与 Web 同三条词条）。
   *
   * 🔴 共享层不许 `import '@heyta/i18n'`，所以"还有 N 天 / 就是今天 / 已经 N 天"
   * 这句话只能由宿主注入。不给的话那一行**只剩标题** —— 类型合法、格子看着不空，
   * 而"看不出这是好日子还是已经过去的日子"没人会报 bug。所以两条都要传，
   * 判据在 `apps/mobile/tests/calendar-event-source.spec.ts`。
   *
   * ⚠️ 天数（`days`）由共享层从 `diffDays(today, 格子那天)` 算好后传进来，
   *   这里只负责把它说成一句话；本文件一次都不做日期算术。
   */
  const eventLabels = useMemo<CalendarEventBarLabels>(
    () => ({
      today: t('common.calendar.event.today'),
      until: (days: number) => t('common.calendar.event.until', { days }),
      since: (days: number) => t('common.calendar.event.since', { days }),
    }),
    [t],
  );

  /**
   * 档位切换器要的词。
   *
   * ⚠️ 共享层不许 `import '@heyta/i18n'`（会拖进第二份 React），所以**翻译动作**仍然在这里；
   *   但"哪一档叫什么名字"这张表 R17 起也**不在这里**了 —— 它和 web 的下拉是同一件事，
   *   原先两边各写一份，加一档要人记着改两处。唯一事实源：
   *   `@heyta/ui` 的 `CALENDAR_VIEW_LABEL_KEYS` / `CALENDAR_VIEW_ORDER`。
   */
  const viewLabels = useMemo(
    () => ({
      group: t('common.calendar.view.aria'),
      /*
        🔴 原来是三层嵌套三元，而它的**兜底那一支是「日」** —— 加一档时不改这里，
        年那一格就会念成「日」（类型上完全合法、词条也都在、界面上看着是个正常的
        切换器）。守卫现在搬到共享层那份 `Record<CalendarViewKind, …>` 上：
        少一条就**编译不过**，而且 web 那边同时拿到这颗牙。
      */
      name: (kind: CalendarViewKind) => t(CALENDAR_VIEW_LABEL_KEYS[kind]),
    }),
    [t],
  );

  return (
    <Screen title={t('mobile.calendar.title')}>
      {error !== null ? (
        <Text variant="row-meta" tone="danger">
          {error}
        </Text>
      ) : null}

      {/*
        🔴 档位入口挂在**板子外面**（不是 `toolbarTrailing`）：共享板内部每加一个
        `role=button`/`role=tab`，Web 那两条"按 role 数格子"的判据就会打爆
        （§9.5 第一条点名的就是这件事）。挂在外面还有一层好处：
        这一组控件在月/周/日三档里长得一模一样，不随档位换布局。
      */}
      <CalendarViewTabs
        view={view}
        options={CALENDAR_VIEW_ORDER}
        onViewChange={changeView}
        labels={viewLabels}
        testID="calendar-view-tabs"
      />

      <CalendarBoard
        tasks={tasks}
        today={today}
        cursor={cursor}
        selected={selected}
        // 🔴 不直接给 `setCursor` / `setSelected`：游标的归一化、日档里"选中跟着游标走"、
        //   以及"换档不换选中"三条判断都在上面的 handler 里（规则本体在 `@heyta/ui`）。
        onCursorChange={stepCursor}
        onSelect={pickDay}
        /* 年档点月卡。不给的话共享板会把月卡画成**不可点** —— 那条立场写在板子里。 */
        onPickMonth={pickMonth}
        onToggleTask={onToggleTask}
        busyTaskId={busyId}
        labels={labels}
        view={view}
        now={now}
        /* 🔴 倒数日那两个 prop 是**一对**（与 web 的 `dayMarker` / `dayMarkerLabels` 同理）：
           只给 `events` 不给词表，那一行只剩标题；只给词表不给 `events`，
           共享板连投影都不做一次（默认 `undefined` = 一条都不画，正是"接之前"的形状）。
           少接任何一个的症状都不是报错，是日历上**安静地一个倒数日都没有**。 */
        events={events}
        eventLabels={eventLabels}
        testID="calendar-board"
      />
    </Screen>
  );
}
