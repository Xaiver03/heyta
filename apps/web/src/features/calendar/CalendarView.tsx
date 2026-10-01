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

import { useCallback, useMemo, useState } from 'react';

import { isoWeek, scopeTasks, toLocalDate, addMonths, type LocalDate } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import {
  CalendarBoard as SharedCalendarBoard,
  formatDayTitleText,
  formatMonthTitleText,
  HeytaUiProvider,
  WEEKDAY_MESSAGE_KEYS,
} from '@heyta/ui';

import { useTaskStore } from '../tasks/store.js';
import { useWheelMonthNav } from './useWheelMonthNav.js';
import { useCalendarViewStore } from './store.js';

/**
 * 共享板的 testID 前缀。**提成常量**是因为滚轮的命中判据要写
 * `[data-testid="…-month-card"]` —— 两处各写一遍，改一处就会静默失效
 * （症状是"滚轮翻月忽然不灵了"，而选择器拼错不会有任何报错）。
 */
const BOARD_TEST_ID = 'calendar-board';

export function CalendarView(): React.JSX.Element {
  const { t } = useI18n();
  const store = useTaskStore();
  /**
   * 🔴 月/日与侧栏**共用这一份**，不是本地 `useState`。
   *
   * 原来它俩住在这里，于是加侧栏时只有两条路：把状态提到 `App.tsx`（外壳长出一份
   * 只服务一个视图的状态），或者各存一份（侧栏翻到 11 月、主区还停在 10 月，
   * 两边的圆点各指各的）。现在它在一个只装日历界面状态的 store 里。
   */
  const view = useCalendarViewStore();

  const today = toLocalDate(store.now);
  /** 正在写入的任务 id —— 防止连点产生两次 toggle。 */
  const [busyId, setBusyId] = useState<string | null>(null);

  /**
   * 主区画的是**范围内**的任务。
   *
   * ⚠️ 判据在 `@heyta/domain` 的 `scopeTasks`，这里只负责把它接上：
   * 「勾了清单 A 就只看 A 的任务」是产品语义，不属于外壳（AGENTS §3.5）。
   */
  const tasks = useMemo(
    () => scopeTasks(Object.values(store.entities.tasks), view.scope),
    [store.entities.tasks, view.scope],
  );

  const labels = useMemo(
    () => ({
      // 🔴 日期措辞来自**共享**的 `date-text.ts`（与 mobile 同一份实现）。
      //     web 与 mobile 各写一份的必然结果是同一个日子显示成
      //    「9月26日 星期五」和「9月26日 周五」—— 而没人会为此报 bug。
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
      // ⚠️ 单复数分两条词条：词条表**刻意没有 ICU**（见 `packages/i18n/src/types.ts`），
      //    所以英文的 "1 tasks" 只能靠调用方分支。
      dayWithTasks: ({ date, count }: { date: string; count: number }) =>
        count === 1
          ? t('web.calendar.a11y.dayWithTasksOne', { date, count })
          : t('web.calendar.a11y.dayWithTasks', { date, count }),
      dayNoTasks: ({ date }: { date: string }) => t('web.calendar.a11y.dayNoTasks', { date }),
      prevMonth: t('web.calendar.prevMonth'),
      nextMonth: t('web.calendar.nextMonth'),
      backToToday: t('web.calendar.backToToday'),
      // 🔴 周次列（滴答式"31周"）：ISO 周数由领域 `isoWeek` 算，这里只措辞。
      weekNumber: (d: LocalDate) => t('web.calendar.weekShort', { n: isoWeek(d) }),
      dayEmpty: t('web.calendar.dayEmpty'),
      footnote: t('web.calendar.footnote'),
      taskRow: {
        toggleOn: (row: { title: string }) => t('web.shell.tasks.complete', { title: row.title }),
        toggleOff: (row: { title: string }) =>
          t('web.shell.tasks.uncomplete', { title: row.title }),
      },
    }),
    [t],
  );

  /**
   * 滚轮翻月（产品负责人 2026-10-01：「上下滑动自由无限切换日历」）。
   *
   * 🔴 走的是**和侧栏迷你月历同一个** `setCursor` —— 只翻月、不动选中的那天。
   * 另写一份"翻月"逻辑的结局是滚轮翻完，侧栏还圈着上个月的格子。
   *
   * `within` 只圈月历卡片：卡片下面那份当天清单需要正常滚页，
   * 把它一起吃掉的话指针停在那儿就再也滚不动了。
   */
  const wheelHost = useWheelMonthNav(
    (step) => {
      view.setCursor(addMonths(view.cursor, step));
    },
    { within: `[data-testid="${BOARD_TEST_ID}-month-card"]` },
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
          // store 自己会把失败写进 status（见它的文件头）；这里只负责把忙碌标记放开，
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
      <div ref={wheelHost}>
        <SharedCalendarBoard
          tasks={tasks}
          today={today}
          cursor={view.cursor}
          selected={view.selected}
          onCursorChange={view.setCursor}
          onSelect={view.selectDay}
          onToday={() => {
            // 「今天」跳回：选中今天 + 月份跟过去（与迷你月历的 ○ 同一条路径）。
            view.goToToday(today);
          }}
          onToggleTask={onToggleTask}
          busyTaskId={busyId}
          labels={labels}
          testID={BOARD_TEST_ID}
        />
      </div>
    </HeytaUiProvider>
  );
}
