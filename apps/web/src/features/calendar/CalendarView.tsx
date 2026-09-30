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
 * ## 这个文件只做三件事
 *
 * 1. **取数据**：`useTaskStore().entities.tasks`；
 * 2. **把 i18n 翻成共享板要的 `labels`**（共享层不许 `import '@heyta/i18n'`）；
 * 3. **把动作转交 store**（勾选完成走 `toggleComplete`，不自己构造 op）。
 *
 * 状态（当前月 / 选中日）留在这里而不是共享板里：它是**宿主自己的界面状态**
 *（手机上也许是手势翻月、Web 上是两个按钮），而共享板只负责画。
 */

import { useCallback, useMemo, useState } from 'react';

import { isoWeek, startOfMonth, toLocalDate, type LocalDate } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import {
  CalendarBoard as SharedCalendarBoard,
  formatDayTitleText,
  formatMonthTitleText,
  HeytaUiProvider,
  WEEKDAY_MESSAGE_KEYS,
} from '@heyta/ui';

import { useTaskStore } from '../tasks/store.js';

export function CalendarView(): React.JSX.Element {
  const { t } = useI18n();
  const store = useTaskStore();

  const today = toLocalDate(store.now);
  /** 正在显示的月份（用该月里任意一天表示）。 */
  const [cursor, setCursor] = useState<LocalDate>(() => startOfMonth(toLocalDate(Date.now())));
  /** 选中的那一天。 */
  const [selected, setSelected] = useState<LocalDate>(() => toLocalDate(Date.now()));
  /** 正在写入的任务 id —— 防止连点产生两次 toggle。 */
  const [busyId, setBusyId] = useState<string | null>(null);

  const tasks = useMemo(() => Object.values(store.entities.tasks), [store.entities.tasks]);

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
      <SharedCalendarBoard
        tasks={tasks}
        today={today}
        cursor={cursor}
        selected={selected}
        onCursorChange={setCursor}
        onSelect={setSelected}
        onToday={() => {
          // 「今天」跳回：选中今天 + 月份跟过去（与 pickDay 同一条纪律）。
          setSelected(today);
          setCursor(startOfMonth(today));
        }}
        onToggleTask={onToggleTask}
        busyTaskId={busyId}
        labels={labels}
        testID="calendar-board"
      />
    </HeytaUiProvider>
  );
}
