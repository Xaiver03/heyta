/**
 * 日历这一屏的文案（Web 宿主）
 * ==============================
 *
 * 🔴 从 `CalendarView.tsx` 里**抽出来**的唯一原因：这一屏现在有两个地方要同一份文案 ——
 * 主区的月历板，和页头那个工具栏（`CalendarHeaderToolbar.tsx`）。
 * 各写一份的结局就是本仓反复记的那件事：改了一处、另一处还旧着，
 * 而两边都是"合法"的中文（AGENTS §3.5）。
 *
 * 日期措辞仍然来自**共享**的 `date-text.ts`（与 mobile 同一份实现）：
 * web 与 mobile 各写一份的必然结果是同一个日子显示成
 * 「9月26日 星期五」和「9月26日 周五」—— 而没人会为此报 bug。
 */

import { isoWeek, type LocalDate } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import {
  calendarHourMark,
  formatDayTitleText,
  formatMonthShortText,
  formatMonthTitleText,
  formatWeekRangeText,
  formatYearTitleText,
  WEEKDAY_MESSAGE_KEYS,
  type CalendarBoardLabels,
} from '@heyta/ui';
import { useMemo } from 'react';

export function useCalendarLabels(): CalendarBoardLabels {
  const { t } = useI18n();
  return useMemo(
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
      // ⚠️ 单复数分两条词条：词条表**刻意没有 ICU**（见 `packages/i18n/src/types.ts`），
      //    所以英文的 "1 tasks" 只能靠调用方分支。
      dayWithTasks: ({ date, count }: { date: string; count: number }) =>
        count === 1
          ? t('web.calendar.a11y.dayWithTasksOne', { date, count })
          : t('web.calendar.a11y.dayWithTasks', { date, count }),
      dayNoTasks: ({ date }: { date: string }) => t('web.calendar.a11y.dayNoTasks', { date }),
      // `+3` 这个符号读屏会被念成"加三"，所以给它一句人话（视觉不变）。
      moreTasks: (count: number) => t('web.calendar.a11y.moreTasks', { count }),
      prevMonth: t('web.calendar.prevMonth'),
      nextMonth: t('web.calendar.nextMonth'),
      // 周视图（批三）：标题与两个箭头的读屏名。措辞在共享的 `formatWeekRangeText`
      // 里，移动端以后接同一档时不必再写一份"周一到周日怎么念"。
      weekTitle: (d: LocalDate) => formatWeekRangeText(d, t),
      prevWeek: t('common.calendar.prevWeek'),
      nextWeek: t('common.calendar.nextWeek'),
      // 日档（批四）：箭头读屏名 + 顶部那条带的名字。
      prevDay: t('common.calendar.prevDay'),
      nextDay: t('common.calendar.nextDay'),
      // 年档（R13）：标题、两个箭头、月卡顶上的短月份名。
      // 🔴 `yearMonthTitle` 复用仓里**唯一一份**月份名（`web.board.month.*`，
      //    时间线两端都读它），不给它开第三套抄件（AGENTS §3.5）。
      yearTitle: (d: LocalDate) => formatYearTitleText(d, t),
      yearMonthTitle: (d: LocalDate) => formatMonthShortText(d, t),
      prevYear: t('common.calendar.prevYear'),
      nextYear: t('common.calendar.nextYear'),
      dayAllDay: t('common.calendar.dayAllDay'),
      // 🔴 轴整列空着时必须说一句 —— 否则"这天没定到时刻"与"这档没接上数据"同形。
      dayNoTimed: t('common.calendar.dayNoTimed'),
      // 🔴 「全天」带自己的空态不能说"这一天没有到期的任务"：定在 16:00 的任务
      //    就在下面那条轴上，同屏两句互相打脸（R14 之后这是常态）。
      dayAllDayEmpty: t('common.calendar.dayAllDayEmpty'),
      // ⚠️ 时刻刻度**不新写一份 `HH:mm`**：走共享的 `calendarHourMark`（它复用时间线
      //    那一份 `formatClock`）。两根轴各拼一次的漂移形状是同一屏两种时刻写法。
      hourLabel: (hour: number) => calendarHourMark(hour),
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
}
