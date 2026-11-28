/**
 * 日历（Web）
 * ============
 *
 * 月历 + 选中某天看当天任务 —— **渲染全部来自 `@heyta/ui` 的共享 `CalendarBoard`**，
 * 与 mobile 是同一份实现（`packages/ui/src/calendar/`）。
 *
 * ## 🔴 这一刀补的是"一端有、另一端没有"
 *
 * `apps/mobile` 从 2026-09 起就有月历，而 Web **一个都没有** ——
 * 产品负责人 2026-09-29 给的参考 IA 里，日历是 5 个主菜单之一
 *（任务 / 日历 / 四象限 / 习惯 / 搜索）。所以它不是"少一行入口"，
 * 是这一端缺了一整块功能。13 项幻觉复核里的第 5 项就是它。
 *
 * ⚠️ **但数学一行都不在这里**：`monthGrid` / `startOfMonth` / `addMonths` /
 * `isoWeekday` 全在 `@heyta/domain`，共享板上也没有第二份。
 * 日历里会**静默算错**的东西（补白格归哪个月、周一还是周日开头、
 * 1 月 31 日加一个月落到哪天）全集中在那几行 —— 两端各写一份的必然结果
 * 不是"某天崩了"，而是"网页上 3 号是周三、手机上是周四"。
 *
 * ## 这个文件只做四件事
 *
 * 1. **取数据并过一层范围**：`useTaskStore().entities.tasks` → `scopeTasks(…, view.scope)`；
 * 2. **把 i18n 翻成共享板要的 `labels`**（共享层不许 `import '@heyta/i18n'`）；
 * 3. **把动作转交 store**（勾选完成走 `toggleComplete`，不自己构造 op）；
 * 4. **把滚轮翻月接到同一个 cursor 上**（`useWheelMonthNav`；判据在 `wheel-month.ts`，
 *    这里只有绑定 —— 手势怎么折算成"一格"不是产品语义，是 DOM 的事）。
 *
 * ⚠️ 当前月 / 选中日**不在本文件里**（`useState` 时期已过期）：它们在
 * `features/calendar/store.ts`。原因是这一屏现在是**两列**——左边的迷你月历与右边的
 * 月历必须指着同一个地方，而 `useState` 只能被一个组件看见。
 * 共享板仍然只管画：翻月、选日都是宿主的事（手机上也许是手势翻月）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { adjustmentOn, canRescheduleByCalendarDrag, parseCategorySlot, planCalendarAllDayDrop, planCalendarDrop, planCalendarTimeDrop, scopeTasks, toLocalDate, type LocalDate, type LocalTime, type Task } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { CATEGORY_SLOT_TOKEN_BY_SLOT, type TokenName } from '@heyta/design-system';
import {
  CalendarBoard as SharedCalendarBoard,
  HeytaUiProvider,
  stepCalendarCursor,
} from '@heyta/ui';
import { resolveCalendarBarAccent } from './calendar-display-pref.js';

import { CalendarAgendaBoard } from './CalendarAgendaBoard.js';
import { CalendarCapturePopover } from './CalendarCapturePopover.js';
import { CalendarDragBar, CalendarDragProvider, CalendarDropAllDay, CalendarDropDay, CalendarDropHour, CalendarDropSlot } from './CalendarDnd.js';
import { CalendarTimetable } from './CalendarTimetable.js';
import { CalendarTimetableImport } from './CalendarTimetableImport.js';
import { CalendarDisplaySettingsModal } from './CalendarDisplaySettingsModal.js';
import { CalendarMultiDayBoard } from './CalendarMultiDayBoard.js';
import { useCountdownStore } from '../countdown/store.js';
import { useTaskStore } from '../tasks/store.js';
import { useProjectStore } from '../projects/store.js';
import { useCalendarLabels } from './useCalendarLabels.js';
import { useDragDayNav } from './useDragDayNav.js';
import { useWheelMonthNav } from './useWheelMonthNav.js';
import { useCalendarViewStore } from './store.js';

/**
 * 共享板的 testID 前缀。**提成常量**是因为滚轮的命中判据要写
 * `[data-testid="…-month-card"]` —— 两处各写一遍，改一处就会静默失效
 * （症状是"滚轮翻月忽然不灵了"，而选择器拼错不会有任何报错）。
 */
const BOARD_TEST_ID = 'calendar-board';

export function CalendarView(): React.JSX.Element {
  const store = useTaskStore();
  /**
   * 🔴 月/日与侧栏**共用这一份**，不是本地 `useState`。
   *
   * 原来它俩住在这里，于是加侧栏时只有两条路：把状态提到 `App.tsx`（外壳长出一份
   * 只服务一个视图的状态），或者各存一份（侧栏翻到 11 月、主区还停在 10 月，
   * 两边的圆点各指各的）。现在它在一个只装日历界面状态的 store 里。
   */
  const view = useCalendarViewStore();

  /**
   * 清单/文件夹的颜色（用于把月格任务条"按所属清单着色"——彩色日历）。
   * `CategorySlot` 是色槽号，真值在设计系统；这里只把"清单 id → token 名"建成表。
   */
  const projects = useProjectStore((s) => s.projects);
  const projectAccentToken = useMemo(() => {
    const map = new Map<string, TokenName>();
    for (const project of projects) {
      const slot = parseCategorySlot(project.color);
      if (slot !== undefined) {
        map.set(project.id, CATEGORY_SLOT_TOKEN_BY_SLOT[slot]);
      }
    }
    return map;
  }, [projects]);

  /**
   * 显示设置「配色」：任务条强调色怎么取（覆盖图谱 #40）。
   *
   * - `list`（默认）—— 按所属清单的颜色（上面那张 `projectAccentToken` 表）；
   * - `priority` —— 按优先级语义色，**复用 `@heyta/ui` 的 `priorityColorToken`**
   *   （全仓唯一一份优先级→色映射，见 `task-list/priority-color.ts` 文件头）；
   * - `off` —— 恒 `undefined`（共享板退回默认色）。
   *
   * 🔴 判断只有一份：这里只把"用户选了哪种"翻成回调，颜色取值仍由 token 唯一决定。
   */
  const barAccentOf = useCallback(
    (task: Task): TokenName | undefined =>
      resolveCalendarBarAccent(view.colorBy, task, (projectId) => projectAccentToken.get(projectId)),
    [view.colorBy, projectAccentToken],
  );

  const today = toLocalDate(store.now);
  /** 正在写入的任务 id —— 防止连点产生两次 toggle。 */
  const [busyId, setBusyId] = useState<string | null>(null);

  /**
   * 主区画的是**范围内**的任务。
   *
   * ⚠️ 判据在 `@heyta/domain` 的 `scopeTasks`，这里只负责把它接上：
   * 「勾了清单 A 就只看 A 的任务」是产品语义，不属于外壳（AGENTS §3.5）。
   */
  const tasks = useMemo(() => {
    const scoped = scopeTasks(Object.values(store.entities.tasks), view.scope);
    // 「显示设置 → 显示已完成」：只筛掉 `completedAt` 存在的条目（这是阅读偏好，
    // 不触碰存储与同步）。默认 `showCompleted=true` 时逐字节等于补这个开关之前。
    return view.showCompleted ? scoped : scoped.filter((task) => task.completedAt === undefined);
  }, [store.entities.tasks, view.scope, view.showCompleted]);

  /** id → 任务，供拖拽落点查"这条能不能改期、改成什么"（纯查表，不改动事实源）。 */
  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);

  /**
   * 拖拽改期的接线：落点 → `planCalendarDrop`（**业务语义在领域层**）→ 一次 `setDueDate`。
   *
   * 🔴 一次拖放 = 一条 op：`setDueDate` 本身就把 dueDate 与 dueDateLocal 一次写完
   * （见 `packages/app-host/src/actions.ts`），这里**不许**拆成两次调用。
   * 失败不吞：交给 store 写进 status（与 `toggleComplete` 同一条路径），这里只收尾。
   */
  const onReschedule = useCallback(
    (taskId: string, targetDate: LocalDate) => {
      const task = tasksById.get(taskId);
      if (task === undefined) return;
      const plan = planCalendarDrop(task, targetDate);
      if (plan === undefined) return;
      void store.setDueDate(taskId, plan.dueDate, plan.dueDateLocal).catch(() => {
        /* store 会把失败写进 TaskState.error；这里只防未处理的 rejection。 */
      });
    },
    [store, tasksById],
  );

  /** 日档拖到某小时/槽位：落点 → `planCalendarTimeDrop` → 一次 `setDueDate`（带时刻、清 date-only）。 */
  const onSetTime = useCallback(
    (taskId: string, targetDate: LocalDate, hour: number, minute = 0) => {
      const task = tasksById.get(taskId);
      if (task === undefined) return;
      const plan = planCalendarTimeDrop(task, targetDate, hour, minute);
      if (plan === undefined) return;
      void store.setDueDate(taskId, plan.dueDate).catch(() => {
        /* 同上，只防未处理的 rejection。 */
      });
    },
    [store, tasksById],
  );

  /** 日档拖回全天区：落点 → `planCalendarAllDayDrop` → 一次 `setDueDate`（清时刻、设 date-only）。 */
  const onSetAllDay = useCallback(
    (taskId: string, targetDate: LocalDate) => {
      const task = tasksById.get(taskId);
      if (!task) return;
      const plan = planCalendarAllDayDrop(task, targetDate);
      if (!plan) return;
      void store.setDueDate(taskId, plan.dueDate, plan.dueDateLocal).catch(() => {});
    },
    [store, tasksById],
  );

  /** 🔴 文案抽进 `useCalendarLabels()`：页头那个工具栏（批二）要的是**同一份**，
   *  两处各构造一遍就是"同一句文案的两份事实源"（AGENTS §3.5）。 */
  const labels = useCalendarLabels();

  /**
   * 「休 / 班」标记（W4b 公共事实，ADR-0052 §2.6）。
   *
   * 🔴 这里**只有一条读**：`adjustmentOn(date)` —— 判断（有覆盖用覆盖、没覆盖退回随包表、
   * 覆盖里日期非法整年拒绝）全在 `@heyta/domain`，而"什么时候去拉、拉回来存哪"
   * 全在 `@heyta/app-host`。宿主这一层要是能自己决定"这天算不算休"，
   * 那就是 AGENTS §3.5 那条分界线上的一次后退。
   *
   * ⚠️ 函数身份挂在 `publicFactsEpoch` 上：覆盖表是领域层的模块级状态，React 看不见它，
   * 换一次函数身份才保证那 42 个格子**无论有没有被 memo 包住**都会重读。
   */
  const markerEpoch = view.publicFactsEpoch;
  const dayMarker = useCallback(
    (date: LocalDate): 'off' | 'work' | undefined => adjustmentOn(date),
    [markerEpoch],
  );

  const { t } = useI18n();
  /** 词表没给时共享层会退化成一颗点 —— 而"用颜色说话"违反 AGENTS §5，所以必须给。 */
  const dayMarkerLabels = useMemo(
    () => ({
      off: t('common.calendar.dayMarker.off'),
      work: t('common.calendar.dayMarker.work'),
    }),
    [t],
  );

  /**
   * 倒数日：日历的**第二个日期数据源**（W6）。
   *
   * 🔴 宿主在这里只做两件事：把 store 里那份活的事件交给板子，并把三个说法注入。
   * "哪一天真的发生"是 `@heyta/domain` 的 `eventOccurrencesInRange`，
   * "折成几条 +N"是共享层的 `calendarCellBars` —— 这里再算一遍就是第二份数学。
   *
   * ⚠️ `syncToday` 这一句不是客套：那份 store 的"今天"原先**只由倒数日页播种**，
   *   没进过倒数日页就直接开日历时它是 `undefined`，而 `refresh()` 在拿到
   *   "今天"之前**不猜**（故意的）。后果不是报错，是日历上安静地一个倒数日都没有 ——
   *   "共享组件支持了"与"宿主真的接上了"是两件事，这条就是那条坑的第五种面目。
   */
  const events = useCountdownStore((s) => s.events);
  const syncCountdownToday = useCountdownStore((s) => s.syncToday);
  useEffect(() => {
    syncCountdownToday(today);
  }, [syncCountdownToday, today]);

  /**
   * 「显示设置 → 显示倒数纪念日」关掉时，把倒数日这个**第二数据源**整体撤掉
   * （传 `[]` 而不是 `undefined`：`undefined` 会让共享板跳过投影，
   *  语义变成"这端没接倒数日"，而这里要的是"接了、用户选择不显示"）。
   */
  const boardEvents = view.showCountdown ? events : [];

  const eventLabels = useMemo(
    () => ({
      today: t('common.calendar.event.today'),
      until: (days: number) => t('common.calendar.event.until', { days }),
      since: (days: number) => t('common.calendar.event.since', { days }),
    }),
    [t],
  );

  /**
   * 月格点击是一次完整的新建意图：先选中日期，再打开同一条捕获浮层；
   * 若当前捕获框已开且点击的正是当前选中的日期格，则收起捕获框。
   * 草稿仍由 `CaptureComposer` 自己持有，取消或关闭只卸载草稿，不触发任何 op。
   */
  const onSelectDay = useCallback(
    (date: LocalDate) => {
      if (view.captureOpen && view.selected === date && view.captureTime === undefined) {
        view.toggleCapture();
        return;
      }
      view.selectDay(date);
      if (view.view !== 'year' && !view.captureOpen) view.toggleCapture();
    },
    [view.captureOpen, view.captureTime, view.selectDay, view.selected, view.toggleCapture, view.view],
  );

  /**
   * 日档 / 多日档 15 分钟槽位点击：捕获浮层已开时点击任意槽位收起浮层，
   * 未开时定位到该日期与时刻打开捕获浮层。
   */
  const onSelectSlot = useCallback(
    (day: LocalDate, time: LocalTime) => {
      if (view.captureOpen) {
        view.toggleCapture();
        return;
      }
      view.openCaptureAtSlot(day, time);
    },
    [view.captureOpen, view.openCaptureAtSlot, view.toggleCapture],
  );

  /**
   * 滚轮翻月 / 翻周（产品负责人 2026-10-01：「上下滑动自由无限切换日历」）。
   *
   * 🔴 走的是**和页头那两个箭头同一个** `stepCalendarCursor` ——
   *   两边各算一遍"下一段"的结局是"点箭头翻一周、滚轮翻一月"。
   *   落到 store 上也只有 `setCursor` 这一个口子：只翻段、不动选中的那天，
   *   所以滚完之后侧栏与主区仍指着同一段（另写一份的结局见 `store.ts` 文件头）。
   *
   * `within` 只圈月历卡片：卡片下面那份当天清单需要正常滚页，
   * 把它一起吃掉的话指针停在那儿就再也滚不动了。
   */
  const wheelHost = useWheelMonthNav(
    (step) => {
      view.setCursor(stepCalendarCursor(view.view, view.cursor, step));
    },
    { within: `[data-testid="${BOARD_TEST_ID}-month-card"]` },
  );

  /**
   * 横向拖拽换天（R11 批四，产品负责人："鼠标在这里左右滑动…就是上一天和下一天的切换"）。
   *
   * 🔴 走多远仍然只有 `stepCalendarCursor` 一个来源 —— 与页头那两个箭头、
   *   与滚轮**同一个函数**，只是 `segments` 来自横向位移。
   *   只在日档挂这个监听（`enabled`）：在月档里"横拖一下"不是任何人的意图，
   *   而它会和"点某一格"抢同一次按下。
   */
  useDragDayNav(
    wheelHost,
    (step) => {
      view.setCursor(stepCalendarCursor('day', view.cursor, step));
    },
    { within: `[data-testid="${BOARD_TEST_ID}-day"]`, enabled: view.view === 'day' },
  );

  const onToggleTask = useCallback(
    (taskId: string) => {
      // 与象限板同一条规矩：忙碌时**直接丢掉**这一次点击，而不是排队 ——
      // 排队会让连点攒成一串变更，而用户以为自己只点了一下。
      if (busyId !== null) return;
      setBusyId(taskId);
      void store
        .toggleComplete(taskId)
        .catch(() => {
          // 这一句以前写的是"store 自己会把失败写进 status"—— **当时那句是假的**：
          // `TaskState.error` 有声明、没有一处写它。现在它真的会被写
          // （`store.ts` 的 `withActionFailure`），显示的地方是 `TaskActionError`
          // 挂在内容列顶部那一行。这里只负责把忙碌标记放开，
          // 否则那一条会永远置灰。
        })
        .finally(() => {
          setBusyId(null);
        });
    },
    [busyId, store],
  );

  return (
    <HeytaUiProvider>
      <CalendarDragProvider tasksById={tasksById} onReschedule={onReschedule} onSetTime={onSetTime} onSetAllDay={onSetAllDay}>
      {/*
        🔴 这一层**必须把 `.ht-content` 的确定高度传下去**（R11 批一"日历只占一半"的宿主那一刀）。
        共享板的根有 `flexGrow: 1`，但 `flexGrow` 只在**弹性容器**里生效 ——
        这一层原来是裸 `<div>`（块容器），于是板子只按内容长高，整月画在半屏里。
        样式挂在 `.ht-content__calendar-host`（见 `styles/app/main-area.css`），
        **不写内联 style**（`check:l4` 的内联样式棘轮只许降不许升）。
      */}
      <div ref={wheelHost} className="ht-content__calendar-host">
        {/*
          「说一句话落进选中那一格」（R11 批五，§9.3 差异化第 2 条）。
          滴答的 `+` 只能新建、落不进你正指着的那一格 —— 这里能，
          因为**本地优先**：选中哪天是这一屏的状态，捕获框就在同一屏拿得到它。

          🔴 落点由 `anchorDate` 交给共享层，**不在这里换算日期**
             （`toCaptureSubmitPlan` 那条优先级：输入里写了「明天」以输入为准）。
             也不叫 AI：这条是纯规则解析，零模型、不出境（ADR-0013 的
             `retention-undecided` 仍然挡着 `managed`，而这条根本不需要它）。
        */}
        {view.extraView === 'timetable' ? (
          <>
            <CalendarTimetableImport />
            <CalendarTimetable
              cursor={view.cursor}
              today={today}
              weekdays={labels.weekdays}
              habits={Object.values(store.entities.habits)}
            />
          </>
        ) : (
          <>
        {view.captureOpen ? (
          <CalendarCapturePopover date={view.selected} time={view.captureTime} title={labels.dayTitle(view.selected)} onClose={view.toggleCapture} />
        ) : null}
        {view.extendedView === 'agenda' ? (
          <CalendarAgendaBoard
            tasks={tasks}
            tasksById={tasksById}
            events={boardEvents}
            eventLabels={eventLabels}
            labels={labels}
            today={today}
            cursor={view.cursor}
            selected={view.selected}
            busyTaskId={busyId}
            onSelectDay={onSelectDay}
            onToggleTask={onToggleTask}
          />
        ) : view.extendedView === 'multiDay' ? (
          <CalendarMultiDayBoard
            tasks={tasks}
            tasksById={tasksById}
            events={boardEvents}
            eventLabels={eventLabels}
            labels={labels}
            today={today}
            cursor={view.cursor}
            selected={view.selected}
            multiDayCount={view.multiDayCount}
            activeSlot={view.captureOpen && view.captureTime !== undefined ? { day: view.selected, time: view.captureTime } : undefined}
            busyTaskId={busyId}
            onSelectDay={onSelectDay}
            onSelectSlot={onSelectSlot}
            onToggleTask={onToggleTask}
          />
        ) : (
        <SharedCalendarBoard
          tasks={tasks}
          today={today}
          cursor={view.cursor}
          selected={view.selected}
          onCursorChange={view.setCursor}
          onSelect={onSelectDay}
          onSelectSlot={onSelectSlot}
          activeSlot={view.captureOpen && view.captureTime !== undefined ? { day: view.selected, time: view.captureTime } : undefined}
          /*
            年档里点一张月卡（R13）。🔴 宿主**只做接线**，"去哪"由共享层决定
            （`calendarMonthDrill`）—— 移动端接同一档时抄的是同一个函数，
            而不是"两边都试过、看着都对"的两套状态迁移。
          */
          onPickMonth={view.drillIntoMonth}
          /* 🔴 批二：工具栏搬到**页头**（`CalendarHeaderToolbar`），板子里那份撤掉。
             与下面的 `onToday` 是**一对**：宿主接了跳回，工具栏才有那颗「今天」；
             两处不同时改，结局是"整屏没有回到今天的入口"或"同一屏两个入口"。 */
          toolbar="external"
          /* 档位由页头那个下拉决定（store 里唯一一份），板子只照它画；多周档透传 multiWeekCount。 */
          view={view.extendedView === 'multiWeek' ? 'month' : view.view}
          multiWeekCount={view.extendedView === 'multiWeek' ? view.multiWeekCount : undefined}
          todayHighlight="circle"
          showSelectedDayList={false}
          fillMonth
          /* 🔴 日档那条"现在"线的时钟**只有一个来源**：任务 store 的 `now`。
             界面 store 刻意不存时钟（存了就会漂 —— 放着不动的一屏，线还在走才算"现在"）。 */
          now={store.now}
          /* 彩色日历：每条任务条按所选**配色模式**上强调色（按清单 / 按优先级 / 不着色）。 */
          barAccentOf={barAccentOf}
          onToday={() => {
            // 「今天」跳回：选中今天 + 月份跟过去（与迷你月历的 ○ 同一条路径）。
            view.goToToday(today);
          }}
          onToggleTask={onToggleTask}
          busyTaskId={busyId}
          labels={labels}
          dayMarker={dayMarker}
          dayMarkerLabels={dayMarkerLabels}
          events={boardEvents}
          eventLabels={eventLabels}
          /* 显示设置 → 颜色（按清单 / 按象限）与事件条样式（经典 / 现代）。 */
          colorByQuadrant={view.colorMode === 'quadrant'}
          displayStyle={view.displayStyle}
          /*
            拖拽改期（Web 独有）。三个注入点全在 `CalendarDnd.tsx`：
            每格日期包成投放目标、每条任务条包成拖拽源。共享层不认识 dnd-kit。
            · 倒数日条（`bar.event`）不可拖 —— 它不是任务；
            · 跨天排期任务不可拖（`canRescheduleByCalendarDrag` 判）—— 拖一段该改哪个字段没有唯一答案。
          */
          renderDayCellWrapper={(date, node) => <CalendarDropDay date={date}>{node}</CalendarDropDay>}
          renderBarWrapper={(bar, node) => {
            if (bar.event === true) return node;
            const task = tasksById.get(bar.id);
            if (task === undefined || !canRescheduleByCalendarDrag(task)) return node;
            return <CalendarDragBar id={bar.id}>{node}</CalendarDragBar>;
          }}
          /* 日档：任务行可拖、小时行可放，落到某小时就改截止时刻（同一天）。 */
          renderDayTaskRowWrapper={(row, node) => {
            const task = tasksById.get(row.id);
            if (task === undefined || !canRescheduleByCalendarDrag(task)) return node;
            return <CalendarDragBar id={row.id}>{node}</CalendarDragBar>;
          }}
          renderHourRowWrapper={(hour, node) => (
            <CalendarDropHour date={view.cursor} hour={hour}>
              {node}
            </CalendarDropHour>
          )}
          renderSlotWrapper={(hour, minute, node) => (
            <CalendarDropSlot date={view.cursor} hour={hour} minute={minute}>
              {node}
            </CalendarDropSlot>
          )}
          renderAllDayWrapper={(node) => (
            <CalendarDropAllDay date={view.cursor}>
              {node}
            </CalendarDropAllDay>
          )}
          testID={BOARD_TEST_ID}
        />
          </>
        )}
      </div>
      </CalendarDragProvider>
      {/* 分层卡片式「显示设置」弹窗：由 ⋮ 菜单的 entry 置 `displaySettingsOpen` 打开。 */}
      <CalendarDisplaySettingsModal />
    </HeytaUiProvider>
  );
}
