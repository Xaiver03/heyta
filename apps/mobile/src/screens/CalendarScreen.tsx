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
import { Animated, PanResponder, View } from 'react-native';

import {
  addDays,
  addMonths,
  classifyQuadrant,
  dueLocalDateOf,
  isoWeek,
  Quadrant,
  startOfMonth,
  startOfWeek,
  isScheduledOn,
  toLocalDate,
  type CountdownEvent,
  type Habit,
  type HabitLog,
  type LocalDate,
  type Task,
} from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import {
  createEventActions,
  createHabitActions,
  createTaskActions,
  type AppHost,
  type EventActions,
  type HabitActions,
  type TaskActions,
} from '@heyta/app-host';
import {
  CalendarBoard,
  CalendarViewTabs,
  CALENDAR_VIEW_LABEL_KEYS,
  CALENDAR_VIEW_LABEL_KEYS_MOBILE,
  CALENDAR_VIEW_ORDER,
  calendarCursorFor,
  calendarHourMark,
  calendarMonthDrill,
  calendarSelectedForCursor,
  formatDayTitleText,
  formatMonthShortText,
  formatMonthTitleText,
  formatYearTitleText,
  formatWeekRangeText,
  WEEKDAY_MESSAGE_KEYS,
  type CalendarEventBarLabels,
  type CalendarViewKind,
} from '@heyta/ui';
import { useToday } from '../lib/use-today';

import { createProjectActions } from '@heyta/app-host';
import { useTaskHost } from '../db/use-task-host';
import { QUADRANT_TITLE_KEYS } from '../lib/quadrant-display';
import { useMobileSync } from '../sync/store';
import { Screen, Text } from '../ui/kit';
import { CalendarScopeSheet, SCOPE_INBOX, SCOPE_QUADRANT_PREFIX, type ScopeProject } from './CalendarScopeSheet';
import { TopBarMenu } from '../ui/top-bar-menu';
import { CalendarViewMenu } from './CalendarViewMenu';
import { CalendarWeekPager } from './CalendarWeekPager';
import { CalendarCapsuleHeader } from './CalendarCapsuleHeader';
import { CalendarWeekAgenda } from './CalendarWeekAgenda';
import { CalendarHabitEntry } from './CalendarHabitEntry';
import { useTokens } from '../theme';

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

export function CalendarScreen({ active = true }: { active?: boolean } = {}): React.JSX.Element {
  const { t } = useI18n();
  // 🔴 走钩子取宿主：本机数据被销毁后（主动注销 / 别的设备注销）宿主会换代，
  // 这个钩子自动重取；原来的一次性 effect 在换代后会让本屏永久拿着已作废的
  // adapter（崩溃审计 §H.4 第 2 层）。
  const { host } = useTaskHost({ onError: (message) => setError(message) });
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
  const [cursor, setCursor] = useState<LocalDate>(() => toLocalDate(Date.now()));
  /** 选中的那一天。 */
  const [selected, setSelected] = useState<LocalDate>(() => toLocalDate(Date.now()));
  /** 这一屏看的是哪一档（月 / 周 / 日 / 年）。 */
  const [view, setView] = useState<CalendarViewKind>('day');
  /**
   * 🔴 2026-11-16：**显示范围**（按清单筛）。`undefined` = 所有清单。
   *
   * 形状照滴答的 `⋯ → 显示范围`：面板里多选、右上 ✓ 才落定。
   * ⚠️ 现在只活在内存里（App 重启回到「所有」）—— 本机没有可用的偏好存储依赖，
   * 新引一个要走依赖两道门，留到下一轮；界面上不假装它记住了。
   */
  const [scope, setScope] = useState<readonly string[] | undefined>(undefined);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  /**
   * 视图菜单贴哪一边，由**触发它的那颗按钮**决定。
   * 左上角的标题 / 月胶囊 → 贴左；右上角的「视图」图标 → 贴右。
   * 写死一边就会出现"点右上角、卡片却出在左边"。
   */
  const [viewMenuAnchor, setViewMenuAnchor] = useState<'left' | 'right'>('left');
  const openViewMenu = useCallback((anchor: 'left' | 'right') => {
    setViewMenuAnchor(anchor);
    setViewMenuOpen(true);
  }, []);

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
      setCursor(today);
    }
    prevToday.current = today;
  }, [today, selected]);

  
  const actions = useMemo<TaskActions | null>(
    () => (host ? createTaskActions(host) : null),
    [host],
  );
  // 与 `CountdownScreen` 同一个动作集来源：宿主派生，界面里不新造（AGENTS §3.5）。
  const eventActions = useMemo<EventActions | null>(
    () => (host ? createEventActions(host) : null),
    [host],
  );
  const habitActions = useMemo<HabitActions | null>(
    () => (host ? createHabitActions(host) : null),
    [host],
  );

  const projectActions = useMemo(
    () => (host ? createProjectActions(host) : null),
    [host],
  );
  const [projects, setProjects] = useState<ScopeProject[]>([]);
  /** 习惯 + 打卡记录（日历的第三个数据源）：存全量活数据，按选中日过滤后再画。 */
  const [habits, setHabits] = useState<Habit[]>([]);
  const [habitLogs, setHabitLogs] = useState<HabitLog[]>([]);
  const [busyHabitId, setBusyHabitId] = useState<string | null>(null);

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
    if (habitActions) {
      setHabits(habitActions.listHabits());
      setHabitLogs(habitActions.listLogs());
    }
    if (projectActions) {
      setProjects(
        projectActions.listProjects().map((p) => ({ id: p.id, name: p.name })),
      );
    }
  }, [actions, eventActions, habitActions, projectActions, today]);

  useEffect(() => {
    if (!host) return;
    // 🔴 必须等 `recover()` 走完再读 —— openTaskHost 已经保证了这一点
    // （AGENTS.md §7 第 9 条）。
    refresh();
    // 🔴 `dataRevision`：同步完成后重读。少了它，日历屏会一直显示同步前的快照。
  }, [host, refresh, dataRevision]);

  /**
   * 🔴 2026-11-16：**每次切回日历都重读**。
   *
   * 标签页用 `display: 'none'` 保活（`App.tsx`），所以这一屏在别处改了数据之后
   * 不会自己知道 —— `dataRevision` 只跟**同步**走，本地写入不经过它。
   * 真机症状：在任务页给一条任务设了「今天」，切回日历，今天那格仍写着
   * 「这一天没有到期的任务」，标题也不带计数。
   */
  useEffect(() => {
    if (!active || !host) return;
    refresh();
  }, [active, host, refresh]);

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

  /** 这一天该做的习惯。`isScheduledOn` 在领域层判"哪天该做"，这里只过滤。 */
  const scheduledHabits = useMemo(
    () => habits.filter((habit) => isScheduledOn(habit.frequency, selected)),
    [habits, selected],
  );

  /** 选中那天已打卡的习惯 id 集合。 */
  const doneHabitIds = useMemo(
    () =>
      new Set(
        habitLogs
          .filter((log) => log.date === selected && log.deletedAt === undefined)
          .map((log) => log.habitId),
      ),
    [habitLogs, selected],
  );
  /** 习惯 → 日历条目：有定时点落对应小时，无定时点落"全天"（hour=null）。 */
  const habitEntries = useMemo(
    () =>
      scheduledHabits.map((habit) => {
        const raw = habit.time;
        const h = raw === undefined ? NaN : Number(raw.slice(0, 2));
        return { id: habit.id, hour: Number.isFinite(h) && h >= 0 && h <= 23 ? h : null };
      }),
    [scheduledHabits],
  );
  const habitById = useMemo(
    () => new Map(scheduledHabits.map((habit) => [habit.id, habit])),
    [scheduledHabits],
  );

  /** 点一下习惯：今天没打卡就打卡，已打卡就取消（`undoCheckIn` 是软删除）。 */
  const onToggleHabit = useCallback(
    (habitId: string) => {
      if (!habitActions || busyHabitId !== null) return;
      const done = habitLogs.some(
        (log) => log.habitId === habitId && log.date === selected && log.deletedAt === undefined,
      );
      setBusyHabitId(habitId);
      void (done ? habitActions.undoCheckIn(habitId, selected) : habitActions.checkIn(habitId, selected))
        .then(() => {
          refresh();
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          setBusyHabitId(null);
        });
    },
    [habitActions, busyHabitId, habitLogs, selected, refresh],
  );

  const renderHabitEntry = useCallback(
    (id: string) => {
      const habit = habitById.get(id);
      if (habit === undefined) return null;
      return (
        <CalendarHabitEntry
          habit={habit}
          done={doneHabitIds.has(id)}
          busy={busyHabitId === id}
          onToggle={onToggleHabit}
        />
      );
    },
    [habitById, doneHabitIds, busyHabitId, onToggleHabit],
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

  /**
   * 整周平移（周历条滑动切周用）。`weeks` 可正可负、可多周（快甩一次跨多周）。
   *
   * 保留「星期几」：选中日跟着平移 `7 × weeks` 天，任何档位都成立。
   * 🔴 多周用乘法不是循环调用 —— 一次 state 更新，避免连点/快甩时多次 setState 互踩。
   */
  const shiftWeek = useCallback(
    (weeks: number) => {
      if (weeks === 0) return;
      const next = addDays(selected, 7 * weeks);
      setSelected(next);
      setCursor(calendarCursorFor(view, next));
    },
    [selected, view],
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

  /**
   * 🔴 2026-11-16：**换档的过渡**（让"跳"看起来像"缩"）。
   *
   * 四个档是四套完全不同的渲染，做不到真正的连续变形（见台账 §40）。
   * 但可以在换档那一刻做 180ms 的**淡入 + 轻微缩放**：
   *   · 进更细的档（年→月→周→日）从略微放大（1.04）收回来 —— 读起来像"放大看"
   *   · 进更粗的档反过来从 0.96 展开 —— 像"缩小看回去"
   * 这样手势（捏合）与视觉（缩放方向）就一致了，而不是"啪一下换一张脸"。
   */
  const viewAnim = useRef(new Animated.Value(1)).current;
  const viewScaleFrom = useRef(1);
  const ZOOM_ORDER_REF = useMemo(() => ['year', 'month', 'week', 'day'] as const, []);

  const changeView = useCallback(
    (next: CalendarViewKind) => {
      const from = ZOOM_ORDER_REF.indexOf(view);
      const to = ZOOM_ORDER_REF.indexOf(next);
      viewScaleFrom.current = to > from ? 1.04 : to < from ? 0.96 : 1;
      setView(next);
      // 换档不换"选中哪天"，只把游标挪到那一天所在的那一段（与 Web 的 `setView` 同一条）。
      setCursor(calendarCursorFor(next, selected));
      viewAnim.setValue(0);
      Animated.timing(viewAnim, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();
    },
    [view, ZOOM_ORDER_REF, selected, viewAnim],
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
      dayCount: (count: number) => t('mobile.calendar.dayCount', { count }),
      footnote: t('mobile.calendar.footnote'),
      // 月档左侧周数列（滴答式「W48」）：共享板只在 view==='month' 时渲染该列。
      weekNumber: (d: LocalDate) => t('web.calendar.weekShort', { n: isoWeek(d) }),
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

  /**
   * 🔴 2026-11-15：**左右滑切换周期**（产品负责人：手势要纳入 UX）。
   *
   * 形状与滴答一致：在网格上左滑去下一段、右滑回上一段，按当前档位步进
   *（月 ±1 月 / 周 ±7 天 / 日 ±1 天 / 年 ±1 年）。
   *
   * 与"点日期格"的仲裁：只有**横向位移压过纵向 1.5 倍、且过 `space.8`（32dp）**
   * 才认成滑动；否则交还给内部的 `Pressable`。松手时不足 `space.8` 视为点击，
   * 不做任何跳转 —— 手指抖一下不该翻月。
   */
  const tokens = useTokens();
  const shiftPeriod = useCallback(
    (direction: 1 | -1) => {
      if (view === 'week') {
        shiftWeek(direction);
        return;
      }
      const next =
        view === 'month'
          ? addMonths(cursor, direction)
          : view === 'day'
            ? addDays(cursor, direction)
            : addMonths(cursor, 12 * direction);
      stepCursor(next);
    },
    [cursor, shiftWeek, stepCursor, view],
  );
  /**
   * 🔴 2026-11-16：**捏合切档**（双指）。
   *
   * 依据：TimeZoom（CHI 2006, TU Dresden）把时间档位做成**可缩放**而非离散跳档
   *（"arbitrary granularity"）。移动端日历没有一家做 —— 滴答是顶栏下拉、
   * Google 是菜单，都要"先想清楚某个档，再去点"。
   *
   * 我们做**半连续**：双指张开 = 更细（年→月→周→日），捏合 = 更粗，
   * 一次手势只跳一档（`fired` 防重复触发），跳完保留游标位置（`stepCursor` 的老规则）。
   *
   * ⚠️ **不是布局插值**：四个档是四套完全不同的渲染（月格 / 周条 / 日时间轴 / 年卡），
   * 真要"连续变形"得重写渲染层，这一轮不做。所以是"手势连续、档位离散"。
   */
  const ZOOM_ORDER = useMemo<readonly CalendarViewKind[]>(() => ['year', 'month', 'week', 'day'], []);
  const pinchState = useRef({ start: 0, fired: false });
  /**
   * 捏合**过程中的档位预告**（松手才真的切）。
   *
   * 🔴 为什么要有它：四个档是离散的，捏合只在越过阈值那一刻"啪"地换一张脸 ——
   * 用户不知道自己正在往哪一档去、也不知道还要捏多远。给一个实时提示
   *（「→ 周视图」）就把"离散跳变"变成了"有方向的连续动作"。
   * 这是"连续感"能做到的边界（真正的布局插值要重写渲染层，见台账 §40）。
   */
  const [pinchHint, setPinchHint] = useState<CalendarViewKind | null>(null);
  /**
   * 🔴 **捏合时日历跟手缩放** —— 这才是真正的"连续反馈"。
   *
   * 之前的版本只在越过阈值那一刻跳档（视觉上"啪"一下）。现在把整块日历的
   * scale 直接绑到双指距离比上（夹在 0.9–1.1，免得缩没了），松手弹簧回 1 并换档。
   * 于是"连续"发生在**视觉层**，"离散"只发生在**档位那一跳** ——
   * 四个档是四套渲染，这个分工是当前架构下能做到的上限。
   */
  const pinchScale = useRef(new Animated.Value(1)).current;
  const zoomView = useCallback(
    (direction: 1 | -1) => {
      const index = ZOOM_ORDER.indexOf(view);
      const next = ZOOM_ORDER[Math.min(ZOOM_ORDER.length - 1, Math.max(0, index + direction))];
      if (next === undefined || next === view) return;
      changeView(next);
    },
    [ZOOM_ORDER, changeView, view],
  );

  const swipe = useMemo(
    () =>
      PanResponder.create({
        /**
         * 双指 ⇒ 捏合（缩放档位）；单指横滑 ⇒ 切周期。
         * 两者用 `touches.length` 分开，不会互相抢。
         */
        onMoveShouldSetPanResponder: (e, g) => {
          if (e.nativeEvent.touches.length === 2) return true;
          return Math.abs(g.dx) > tokens['space.8'] && Math.abs(g.dx) > Math.abs(g.dy) * 1.5;
        },
        onPanResponderGrant: (e) => {
          const touches = e.nativeEvent.touches;
          if (touches.length !== 2) return;
          const [a, b] = touches;
          if (a === undefined || b === undefined) return;
          const dx = a.pageX - b.pageX;
          const dy = a.pageY - b.pageY;
          pinchState.current = { start: Math.hypot(dx, dy), fired: false };
        },
        onPanResponderMove: (e) => {
          const touches = e.nativeEvent.touches;
          if (touches.length !== 2 || pinchState.current.fired) return;
          const [a, b] = touches;
          if (a === undefined || b === undefined) return;
          const distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
          if (pinchState.current.start <= 0) return;
          const ratio = distance / pinchState.current.start;
          // 跟手缩放（连续反馈）：夹在 0.9–1.1，越界的手感由弹簧收回。
          pinchScale.setValue(Math.min(1.1, Math.max(0.9, ratio)));
          // 1.35 / 0.75 是"确实在捏"的门槛，避免两指并拢时手抖就跳档。
          if (ratio > 1.35) {
            zoomView(1);
            pinchState.current.fired = true;
            setPinchHint(null);
          } else if (ratio < 0.75) {
            zoomView(-1);
            pinchState.current.fired = true;
            setPinchHint(null);
          } else if (ratio > 1.18) {
            // 已过"一半"但还没到阈值：预告下一档（更细）。
            const next = ZOOM_ORDER[ZOOM_ORDER.indexOf(view) + 1];
            setPinchHint(next ?? null);
          } else if (ratio < 0.88) {
            const next = ZOOM_ORDER[ZOOM_ORDER.indexOf(view) - 1];
            setPinchHint(next ?? null);
          } else {
            setPinchHint(null);
          }
        },
        onPanResponderRelease: (_e, g) => {
          setPinchHint(null);
          Animated.spring(pinchScale, { toValue: 1, useNativeDriver: true, friction: 7 }).start();
          // 双指手势结束时不当作"切周期"（两指也会产生 dx）。
          if (pinchState.current.start > 0) {
            pinchState.current = { start: 0, fired: false };
            return;
          }
          if (Math.abs(g.dx) < tokens['space.8']) return;
          shiftPeriod(g.dx < 0 ? 1 : -1);
        },
        onPanResponderTerminate: () => {
          pinchState.current = { start: 0, fired: false };
          setPinchHint(null);
          Animated.spring(pinchScale, { toValue: 1, useNativeDriver: true, friction: 7 }).start();
        },
      }),
    [shiftPeriod, tokens, view, zoomView, ZOOM_ORDER, pinchScale],
  );

  /**
   * 显示范围落到数据上：`scope === undefined` 不筛；否则只留选中清单里的任务。
   *
   * ⚠️ **不过滤倒数日**：范围说的是"哪些清单的任务"，纪念日不属于任何清单
   * （它有自己的归档），把两者混在一起筛会得到"选了某个清单，纪念日全消失"。
   */
  const scopedTasks = useMemo(
    () =>
      scope === undefined
        ? tasks
        : tasks.filter((task) => {
            const byProject =
              task.projectId === undefined
                ? scope.includes(SCOPE_INBOX)
                : scope.includes(task.projectId);
            if (byProject) return true;
            /*
             * 🔴 2026-11-16：**象限也是一个可筛的维度**，与清单是**并集**。
             * 这一格是 hepta 结构上独有的（四象限与日历是同一批任务的两种投影），
             * 用途：「只看马上做的那几件事落在哪天」。
             * 与清单取并集而不是交集：面板是"我看哪些"，不是"同时满足"。
             */
            const quadrantId = `${SCOPE_QUADRANT_PREFIX}${String(classifyQuadrant(task, { now }))}`;
            return scope.includes(quadrantId);
          }),
    [scope, tasks],
  );

  /** 周条小圆点：这天有没有内容（任务 / 习惯）。日期判断走领域 `isScheduledOn`。 */
  const taskDates = useMemo(() => {
    const set = new Set<string>();
    for (const task of scopedTasks) {
      const d = dueLocalDateOf(task);
      if (d !== undefined) set.add(d);
    }
    return set;
  }, [scopedTasks]);
  const hasContentOn = useCallback(
    (date: LocalDate) =>
      taskDates.has(date) || habits.some((habit) => isScheduledOn(habit.frequency, date)),
    [taskDates, habits],
  );

  /** 象限筛选的四个选项（顺序与四象限屏一致，值用 `q:N` 编码）。 */
  const QUADRANT_SCOPE = useMemo(
    () =>
      [Quadrant.UrgentImportant, Quadrant.ImportantNotUrgent, Quadrant.UrgentNotImportant, Quadrant.Neither].map(
        (quadrant) => ({
          id: `${SCOPE_QUADRANT_PREFIX}${String(quadrant)}`,
          label: t(QUADRANT_TITLE_KEYS[quadrant]),
        }),
      ),
    [t],
  );

  /**
   * 顶栏标题 = 当前范围（月档「2026年11月」/ 周档「11月16日 – 11月22日」/
   * 日档「11月16日 星期一」/ 年档「2026年」）。四个档各自有既有的措辞函数，
   * 这里不另写一套格式化。
   */
  const rangeTitleBase = useMemo(() => {
    if (view === 'month') return formatMonthTitleText(startOfMonth(cursor), t);
    if (view === 'day') return formatDayTitleText(selected, t);
    if (view === 'year') return formatYearTitleText(cursor, t);
    /*
     * 🔴 周档标题用**既有那条短格式**（`common.date.weekRangeTitle`：`M月D日 - M月D日`）。
     * 原来拼的是两次 `formatDayTitleText`（带"星期X"），两周拼起来把顶栏挤满、
     * `⋯` 被推到屏幕边缘（真机可见）。
     */
    return formatWeekRangeText(selected, t);
  }, [cursor, selected, t, view]);

  /**
   * 🔴 2026-11-16：**这一段里有多少事**，直接写进标题（「· 12 项」）。
   *
   * 依据：UX Patterns Guide 的 calendar-view 模式要求把 **event count** 作为文字暴露
   *（与 visible range、selected date 并列）—— 它属于"我在看什么"的一部分，
   * 不该藏在别处。这一屏原来的那行「11 项待办，1 项已完成」是**页头装饰**
   *（产品负责人：「这些东西我总觉得……」），真正该说的是"我正看的这段有多少"。
   *
   * ⚠️ 数量按**当前显示范围**（`scope`）算，与网格里画的是同一批任务 ——
   * 否则标题说 12 项、格子里只有 3 条，这行字立刻变成不可信的数字。
   * ⚠️ 为 0 时**不显示**：`0 项` 是噪音（网格本身已经空着）。
   */
  const rangeCount = useMemo(() => {
    const inRange = (date: string | undefined): boolean => {
      if (date === undefined) return false;
      if (view === 'month') return date.startsWith(startOfMonth(cursor).slice(0, 7));
      if (view === 'year') return date.startsWith(String(startOfMonth(cursor).slice(0, 4)));
      if (view === 'day') return date === selected;
      const end = addDays(selected, 6);
      return date >= selected && date <= end;
    };
    return scopedTasks.filter((task) => inRange(dueLocalDateOf(task))).length;
  }, [cursor, scopedTasks, selected, view]);

  const rangeTitle =
    rangeCount === 0 ? rangeTitleBase : `${rangeTitleBase} · ${t('mobile.calendar.rangeCount', { count: rangeCount })}`;

  return (
    /*
      🔴 2026-11-15：日历是**看板**（chrome="board"）—— 内容铺满、顶栏随滚动收起。
      档位切换器与月历网格是同一件事（"我在看哪一段时间"），所以它们一起铺满；
      只有底部那句说明（脚注）留在 16dp 轴线上。
    */
    <Screen
      /*
       * 🔴 2026-11-16：**标题就是当前时间范围**（「2026年11月」），点它切档。
       *
       * 滴答的顶栏是「十一月」+ 3 枚图标（事件源 / 视图 / ⋯）；我们把"视图"
       * 收到标题上（Canonical 的日历重构就是这么做的），于是顶栏只剩两枚：
       * 可点的标题 + ⋯。顺带把原来那一排四格分段控件（约 56dp 高）整行省掉。
       *
       * ⚠️ 「日历」这两个字不再出现在顶栏 —— 底部 tab 已经标着它，
       * 而这一屏真正需要一眼看到的是"我在看哪段时间"。
       */
      title={rangeTitle}
      chrome="board"
      /* 月档是整面看板：去掉底部 88dp 的 bottomInset 占位，让月格真正贴到底（对齐滴答）。其它档保留。 */
      bottomInset={view !== 'month'}
      header={
        <CalendarCapsuleHeader
          monthLabel={labels.monthTitle(cursor)}
          onMonthPress={() => {
            openViewMenu('left');
          }}
          onViewPress={() => {
            openViewMenu('right');
          }}
          onMorePress={() => {
            setMoreOpen(true);
          }}
          monthA11y={t('mobile.calendar.title')}
          viewA11y={t('common.calendar.view.aria')}
          moreA11y={t('mobile.calendar.scope.entry')}
          onToday={() => {
            pickDay(today);
          }}
          todayLabel={t('mobile.calendar.today')}
        />
      }
      onTitlePress={() => { openViewMenu('left'); }}
      actions={[
        {
          icon: 'action.more',
          label: t('mobile.calendar.scope.entry'),
          onPress: () => { setMoreOpen(true); },
          testID: 'calendar-more',
        },
      ]}
    >
      {error !== null ? (
        <Text variant="row-meta" tone="danger">
          {error}
        </Text>
      ) : null}

      {/* 日历条（Apple 式横向周历）：只在单日档显示；一周档本身是整周列，不再叠一条。 */}
      {view === 'day' ? (
        <CalendarWeekPager
          weekStart={startOfWeek(selected)}
          selected={selected}
          today={today}
          weekdays={labels.weekdays}
          onSelect={(date) => {
            pickDay(date);
          }}
          onShiftWeeks={shiftWeek}
          hasContent={hasContentOn}
        />
      ) : null}

      {/* Apple 式：周历条下方、内容上方居中显示当天标题。 */}
      {view === 'day' ? (
        <View style={{ alignItems: 'center' }}>
          <Text variant="headline">{labels.dayTitle(cursor)}</Text>
        </View>
      ) : null}

      <Animated.View
        {...swipe.panHandlers}
        style={{
          flex: 1,
          /*
           * 2026-11-16：页边距**改由外壳统一给**——`Screen` 的 `board` 档现在是
           * 响应式 gutter（手机 16 / 平板及更宽 24，见 `ui/kit.tsx` 的 `boardGutter`）。
           * 这里不再自己补 `space.4`，否则与外壳 gutter 叠加成双倍留白。
           * 网格仍在 gutter 之内铺满，内容卡（当日清单/脚注）自然继承同一条轴线。
           */
          opacity: viewAnim.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
          transform: [
            {
              scale: Animated.multiply(
                viewAnim.interpolate({ inputRange: [0, 1], outputRange: [viewScaleFrom.current, 1] }),
                pinchScale,
              ),
            },
          ],
        }}
      >
      {/* 一周档：Apple「列表」形态的周议程（7 天分段 + 各天任务），替代共享周板（其无 7 列时间轴）。 */}
      {view === 'week' ? (
        <CalendarWeekAgenda
          weekStart={startOfWeek(selected)}
          today={today}
          selected={selected}
          tasks={scopedTasks}
          weekdays={labels.weekdays}
          taskRow={labels.taskRow}
          onSelectDay={(date) => {
            pickDay(date);
          }}
          onToggleTask={onToggleTask}
          busyTaskId={busyId}
          habits={habits}
          habitLogs={habitLogs}
          onToggleHabit={onToggleHabit}
          busyHabitId={busyHabitId}
        />
      ) : (
      <CalendarBoard
        tasks={scopedTasks}
        // 月份已经在顶栏标题里（点它切档）—— 板内不再重复一行。
        hideToolbarTitle
        /*
         * 🔴 2026-11-19：手机端把板内工具栏改成 external —— 顶部胶囊导航 + 周历条
         * 已经承担了翻页/选日，板内那条「‹ › 回到今天」的带框卡片是 Apple 日历没有的
         * （Apple 靠滑动翻页、日历条选日）。web 本来就是 external，不受影响。
         */
        toolbar="external"
        /* Apple 形态：日档扁平化（无边框无白底卡），全天带与小时轴直接铺在页面上。 */
        boardAppearance="flat"
        /* 月档撑满整面（与 Web 同一条）：共享板靠它给周格加上 flexGrow、卡片吃满高度。 */
        fillMonth
        /* 月档：格内已有任务条，网格下不再重复一份日期头+当天清单（Apple 亦如此）。 */
        showSelectedDayList={view !== 'month'}
        /* 月格周末（六/日）数字用周末色（Apple 月格周末红）。 */
        weekendAccent
        /* 月格数字下显示农历日名（Apple 月格）。 */
        showLunar={view === 'month'}
        /*
         * 🔴 2026-11-16：**月格里的任务条按象限着色**。
         *
         * 这一格是 hepta 结构上独有的：四象限与日历是**同一批任务的两种投影**，
         * 所以日历上能直接看出"这周是不是全在救火"（红=马上做）。
         * 滴答做不到 —— 它的四象限和日历是两个互不相识的模块。
         *
         * ⚠️ 逾期仍然优先用红色（那是"要注意"，不是分类），见 `CalendarBoard` 里的优先级。
         */
        colorByQuadrant
        today={today}
        /**
         * 🔴 「回到今天」原来**在页脚**（日历网格下面），因为移动端没传 `onToday`，
         * 共享板就走 `onToday === undefined` 那条分支，把它画在 `footerRow` 里。
         * 后果：月网格六行 264dp + 表头之后，那颗按钮落在**首屏之外** ——
         * 真机 dump（`heyta-calendar-month.xml`）48 个可点行里根本没有它。
         * 也就是说"回今天"这个能力**在移动端等于不存在**，只能反向连点箭头。
         *
         * 传了之后共享板把它挪进工具栏（`‹ 2026年11月 › 今天`，与 web 同一个组件），
         * 页脚那颗按注释里的规则自动撤 —— 不会出现两个入口。
         * `pickDay` 已经在里面处理了 cursor，不需要在这里再算一遍。
         */
        onToday={() => {
          pickDay(today);
        }}
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
        habitEntries={habitEntries}
        renderHabitEntry={renderHabitEntry}
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
      )}
      </Animated.View>

      {/*
        捏合过程中的档位预告。只在双指移动且越过"一半阈值"时出现，
        松手/取消即消失 —— 它不是常驻 UI，是一条**临时的意图确认**。
      */}
      {pinchHint === null ? null : (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '42%',
            alignItems: 'center',
          }}
        >
          <View
            style={{
              backgroundColor: tokens['color.foreground'],
              paddingHorizontal: tokens['space.4'],
              paddingVertical: tokens['space.2'],
              borderRadius: tokens['radius.full'],
            }}
          >
            <Text variant="row-title" tone="on-primary" testID="calendar-pinch-hint">
              {t(CALENDAR_VIEW_LABEL_KEYS[pinchHint])}
            </Text>
          </View>
        </View>
      )}

      {/*
        🔴 2026-11-16：入口放在 `⋯` 里，**不在顶栏再加一枚图标**。
        滴答是三个图标（事件源 / 视图 / ⋯），我们把"显示范围"收进 ⋯ ——
        见 `docs/agents/screen-chrome.md` 的顶栏预算（≤3 枚、低频进菜单）。
      */}
      <CalendarViewMenu
        visible={viewMenuOpen}
        current={view}
        order={CALENDAR_VIEW_ORDER}
        labelOf={(kind) => t(CALENDAR_VIEW_LABEL_KEYS_MOBILE[kind])}
        onPick={(kind) => {
          setViewMenuOpen(false);
          changeView(kind);
        }}
        onClose={() => { setViewMenuOpen(false); }}
        anchor={viewMenuAnchor}
        anchorTop={96}
      />

      <TopBarMenu
        visible={moreOpen}
        label={t('mobile.calendar.title')}
        onClose={() => { setMoreOpen(false); }}
        items={[
          {
            id: 'scope',
            label: t('mobile.calendar.scope.entry'),
            value:
              scope === undefined
                ? t('mobile.calendar.scope.all')
                : t('mobile.calendar.scope.count', { count: scope.length }),
            onPress: () => {
              setMoreOpen(false);
              setScopeOpen(true);
            },
          },
        ]}
      />

      <CalendarScopeSheet
        visible={scopeOpen}
        projects={projects}
        quadrants={QUADRANT_SCOPE}
        selected={scope}
        onCancel={() => { setScopeOpen(false); }}
        onConfirm={(next) => {
          setScope(next);
          setScopeOpen(false);
        }}
      />
    </Screen>
  );
}
