/**
 * 课表视图（Web）—— 星期 × 时段网格
 * ==================================
 *
 * 对照滴答「课表」：左侧是节次（带开始时刻），横向 7 天，每格列出落在该时段里的课程
 *（课程名 / 地点 / 时段）。它**不是**新开的一个一级入口，而是日历的一档视图
 *（覆盖图谱 #54：「课表是日历的一个视图模式」）。
 *
 * ## 🔴 这一层只画，不做归并
 *
 * 「哪些课落在周几 / 哪一节」全在 `@heyta/domain#buildTimetableGrid`（纯函数、有单测）。
 * 这里只把它的输出摆成网格：不写任何日期算术、不判断"这天该不该上"。
 *
 * ## 空态只写事实
 *
 * 一周里没有任何课程时，用共享 `EmptyState` 居中一句「本周没有课程」——不加引导语。
 */

import { useMemo } from 'react';

import {
  buildTimetableGrid,
  DEFAULT_TIMETABLE_PERIODS,
  startOfWeek,
  type Habit,
  type LocalDate,
  type TimetableEntry,
} from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { EmptyState } from '@heyta/ui';

export interface CalendarTimetableProps {
  /** 这一周里的任意一天（通常是日历游标；组件自己回到周一）。 */
  readonly cursor: LocalDate;
  readonly today: LocalDate;
  /** 周一..周日的显示名（宿主从 i18n 取）。 */
  readonly weekdays: readonly string[];
  readonly habits: readonly Habit[];
}

function CourseChip({ entry }: { readonly entry: TimetableEntry }): React.JSX.Element {
  const timeText =
    entry.start === undefined ? undefined : entry.end === undefined ? entry.start : `${entry.start}–${entry.end}`;
  return (
    <div className="ht-content__cal-timetable-card" data-testid={`timetable-course-${entry.habitId}`}>
      <span className="ht-content__cal-timetable-name">{entry.name}</span>
      {timeText === undefined ? null : <span className="ht-content__cal-timetable-meta">{timeText}</span>}
      {entry.location === undefined ? null : <span className="ht-content__cal-timetable-meta">{entry.location}</span>}
      {entry.teacher === undefined ? null : <span className="ht-content__cal-timetable-meta">{entry.teacher}</span>}
    </div>
  );
}

export function CalendarTimetable({ cursor, today, weekdays, habits }: CalendarTimetableProps): React.JSX.Element {
  const { t } = useI18n();
  const weekStart = startOfWeek(cursor);
  const grid = useMemo(
    () => buildTimetableGrid(habits, weekStart, DEFAULT_TIMETABLE_PERIODS),
    [habits, weekStart],
  );

  const hasAny = grid.days.some((day) => day.cells.some((cell) => cell.length > 0) || day.untimed.length > 0);
  if (!hasAny) {
    return (
      <div className="ht-content__cal-timetable" data-testid="calendar-timetable">
        <EmptyState title={t('web.calendar.timetable.empty')} testID="calendar-timetable-empty" />
      </div>
    );
  }

  const hasUntimed = grid.days.some((day) => day.untimed.length > 0);
  const dayNumber = (date: LocalDate): number => Number(date.slice(8, 10));

  return (
    <div className="ht-content__cal-timetable" data-testid="calendar-timetable">
      <div className="ht-content__cal-timetable-scroll">
        <div
          className="ht-content__cal-timetable-grid"
          role="grid"
          aria-label={t('web.calendar.view.timetable')}
        >
          {/* 表头：左上角空一格，横向 7 天 */}
          <div className="ht-content__cal-timetable-corner" aria-hidden="true" />
          {grid.days.map((day, di) => (
            <div
              key={`head-${day.date}`}
              className={
                day.date === today
                  ? 'ht-content__cal-timetable-head ht-content__cal-timetable-head--today'
                  : 'ht-content__cal-timetable-head'
              }
              data-testid={`calendar-timetable-head-${day.date}`}
            >
              <span className="ht-content__cal-timetable-weekday">{weekdays[di]}</span>
              <span className="ht-content__cal-timetable-dom">{dayNumber(day.date)}</span>
            </div>
          ))}

          {/* 无时段的课：单独一条带，不塞进任何节次冒充有时间 */}
          {hasUntimed ? (
            <>
              <div className="ht-content__cal-timetable-period" aria-hidden="true" />
              {grid.days.map((day) => (
                <div key={`untimed-${day.date}`} className="ht-content__cal-timetable-cell">
                  {day.untimed.map((entry) => (
                    <CourseChip key={`u-${entry.habitId}`} entry={entry} />
                  ))}
                </div>
              ))}
            </>
          ) : null}

          {/* 每一节一行：节次标签 + 7 天 */}
          {grid.periods.map((period, pi) => (
            <div key={`period-${period.start}`} className="ht-content__cal-timetable-row" role="row">
              <div className="ht-content__cal-timetable-period">
                <span className="ht-content__cal-timetable-period-num">
                  {t('web.calendar.timetable.period', { n: pi + 1 })}
                </span>
                <span className="ht-content__cal-timetable-period-time">{period.start}</span>
              </div>
              {grid.days.map((day, di) => (
                <div key={`cell-${pi}-${di}`} className="ht-content__cal-timetable-cell" role="gridcell">
                  {day.cells[pi]!.map((entry) => (
                    <CourseChip key={entry.habitId} entry={entry} />
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
