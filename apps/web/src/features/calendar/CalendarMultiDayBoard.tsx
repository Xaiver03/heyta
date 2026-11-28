/**
 * 多日视图（Web 壳，`CalendarMultiDayBoard`）
 * ==========================================
 *
 * 从 `cursor` 起连续铺 `multiDayCount`（2..14）天的时间轴网格：
 *   · 顶栏：多日列头（今天数字使用实心主色圆）；
 *   · 全天带：每列展示当天的无时刻任务与倒数纪念日，支持拖拽落入（`CalendarDropAllDay`）与点击捕获；
 *   · 24 小时 × N 天网格：每小时划分为 4 个 15 分钟槽位（`00/15/30/45`），支持拖拽排期（`CalendarDropSlot`）
 *     与点击定位捕获（`☐ HH:MM` 草稿条）。
 *
 * 🔴 零内联样式（`check:l4`），所有类名挂在 `.ht-content__cal-*` 族下（`check:row-single-source`）。
 */

import {
  canRescheduleByCalendarDrag,
  isoWeekday,
  type CountdownEvent,
  type LocalDate,
  type LocalTime,
  type Task,
} from '@heyta/domain';
import {
  calendarDayBuckets,
  calendarEventBarTitle,
  DAY_SLOT_MINUTES,
  groupEventsByOccurrence,
  HOURS_IN_DAY,
  multiDayGrid,
  TaskList,
  type CalendarBoardLabels,
  type CalendarDayEvent,
  type CalendarEventBarLabels,
} from '@heyta/ui';
import { useMemo } from 'react';

import {
  CalendarDragBar,
  CalendarDropAllDay,
  CalendarDropHour,
  CalendarDropSlot,
} from './CalendarDnd.js';

export interface CalendarMultiDayBoardProps {
  readonly tasks: readonly Task[];
  readonly tasksById: ReadonlyMap<string, Task>;
  readonly events: readonly CountdownEvent[];
  readonly eventLabels: CalendarEventBarLabels;
  readonly labels: CalendarBoardLabels;
  readonly today: LocalDate;
  readonly cursor: LocalDate;
  readonly selected: LocalDate;
  readonly multiDayCount: number;
  readonly activeSlot?: { readonly day: LocalDate; readonly time: LocalTime } | undefined;
  readonly busyTaskId: string | null;
  readonly onSelectDay: (date: LocalDate) => void;
  readonly onSelectSlot: (day: LocalDate, time: LocalTime) => void;
  readonly onToggleTask: (taskId: string) => void;
}

const HOURS = Array.from({ length: HOURS_IN_DAY }, (_, i) => i);

export function CalendarMultiDayBoard({
  tasks,
  tasksById,
  events,
  eventLabels,
  labels,
  today,
  cursor,
  selected,
  multiDayCount,
  activeSlot,
  busyTaskId,
  onSelectDay,
  onSelectSlot,
  onToggleTask,
}: CalendarMultiDayBoardProps): React.JSX.Element {
  const days = useMemo(() => multiDayGrid(cursor, multiDayCount), [cursor, multiDayCount]);

  const bucketsByDay = useMemo(() => {
    const map = new Map<LocalDate, ReturnType<typeof calendarDayBuckets>>();
    for (const day of days) {
      map.set(day, calendarDayBuckets(tasks, day));
    }
    return map;
  }, [days, tasks]);

  const eventsByDate = useMemo(() => {
    const first = days[0];
    const last = days[days.length - 1];
    if (first === undefined || last === undefined) return new Map<LocalDate, CalendarDayEvent[]>();
    return groupEventsByOccurrence(events, today, first, last);
  }, [days, events, today]);

  return (
    <div className="ht-content__cal-multiday" data-testid="calendar-board-multiday">
      {/* ── 顶部日期列头 ─────────────────────────────────────── */}
      <div className="ht-content__cal-multiday-head">
        <div className="ht-content__cal-multiday-gutter" />
        {days.map((day) => {
          const isToday = day === today;
          const isSelected = day === selected;
          const weekdayLabel = labels.weekdays[isoWeekday(day) - 1] ?? '';
          const dayNum = Number(day.slice(8, 10));
          return (
            <button
              key={day}
              type="button"
              className="ht-content__cal-multiday-colhead"
              data-testid={`calendar-multiday-header-${day}`}
              data-today={isToday ? 'true' : 'false'}
              data-selected={isSelected ? 'true' : 'false'}
              onClick={() => onSelectDay(day)}
            >
              <span className="ht-content__cal-multiday-weekday ht-type-caption">{weekdayLabel}</span>
              <span className="ht-content__cal-multiday-daynum ht-type-body-sm">{dayNum}</span>
            </button>
          );
        })}
      </div>

      {/* ── 全天事项带 ───────────────────────────────────────── */}
      <div className="ht-content__cal-multiday-allday-row">
        <div className="ht-content__cal-multiday-gutter ht-type-caption">
          {labels.dayAllDay ?? ''}
        </div>
        {days.map((day) => {
          const bucket = bucketsByDay.get(day);
          const allDayTasks = bucket?.allDay ?? [];
          const dayEvents = eventsByDate.get(day) ?? [];
          return (
            <CalendarDropAllDay key={day} date={day}>
              <div
                className="ht-content__cal-multiday-allday-cell"
                data-testid={`calendar-multiday-allday-${day}`}
                onClick={(e) => {
                  if (e.target === e.currentTarget) onSelectDay(day);
                }}
              >
                {allDayTasks.length > 0 ? (
                  <TaskList
                    tasks={allDayTasks}
                    density="minimal"
                    onToggleTask={onToggleTask}
                    busyTaskId={busyTaskId}
                    labels={labels.taskRow}
                    renderRowWrapper={(row, node) => {
                      const task = tasksById.get(row.id);
                      if (task === undefined || !canRescheduleByCalendarDrag(task)) return node;
                      return <CalendarDragBar id={row.id}>{node}</CalendarDragBar>;
                    }}
                    testID={`calendar-multiday-allday-list-${day}`}
                  />
                ) : null}
                {dayEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="ht-content__cal-multiday-event ht-type-caption"
                    data-testid={`calendar-multiday-event-${day}-${ev.id}`}
                  >
                    {calendarEventBarTitle(ev, eventLabels)}
                  </div>
                ))}
              </div>
            </CalendarDropAllDay>
          );
        })}
      </div>

      {/* ── 24 小时 × N 天滚动轴 ─────────────────────────────── */}
      <div className="ht-content__cal-multiday-body">
        {HOURS.map((hour) => {
          const pad = String(hour).padStart(2, '0');
          return (
            <div
              key={pad}
              className="ht-content__cal-multiday-hour-row"
              data-testid={`calendar-multiday-hour-${pad}`}
            >
              <div className="ht-content__cal-multiday-gutter ht-type-caption">
                {labels.hourLabel?.(hour) ?? ''}
              </div>
              {days.map((day) => {
                const hourTasks = bucketsByDay.get(day)?.hours[hour] ?? [];
                return (
                  <CalendarDropHour key={`${day}-${pad}`} date={day} hour={hour}>
                    <div className="ht-content__cal-multiday-hour-cell">
                      {hourTasks.length > 0 ? (
                        <TaskList
                          tasks={hourTasks}
                          density="minimal"
                          onToggleTask={onToggleTask}
                          busyTaskId={busyTaskId}
                          labels={labels.taskRow}
                          renderRowWrapper={(row, node) => {
                            const task = tasksById.get(row.id);
                            if (task === undefined || !canRescheduleByCalendarDrag(task)) return node;
                            return <CalendarDragBar id={row.id}>{node}</CalendarDragBar>;
                          }}
                          testID={`calendar-multiday-timed-${day}-${pad}`}
                        />
                      ) : null}
                      {DAY_SLOT_MINUTES.map((minute) => {
                        const minPad = String(minute).padStart(2, '0');
                        const slotTime = `${pad}:${minPad}` as LocalTime;
                        const slotTestID = `calendar-multiday-slot-${day}-${pad}-${minPad}`;
                        const isActive =
                          activeSlot !== undefined &&
                          activeSlot.day === day &&
                          activeSlot.time === slotTime;
                        return (
                          <CalendarDropSlot
                            key={slotTestID}
                            date={day}
                            hour={hour}
                            minute={minute}
                          >
                            <button
                              type="button"
                              className="ht-content__cal-multiday-slot"
                              data-testid={slotTestID}
                              onClick={() => onSelectSlot(day, slotTime)}
                            >
                              {isActive ? (
                                <span
                                  className="ht-content__cal-multiday-draft ht-type-caption"
                                  data-testid="calendar-multiday-draft-slot"
                                >
                                  {`☐ ${slotTime}`}
                                </span>
                              ) : null}
                            </button>
                          </CalendarDropSlot>
                        );
                      })}
                    </div>
                  </CalendarDropHour>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
