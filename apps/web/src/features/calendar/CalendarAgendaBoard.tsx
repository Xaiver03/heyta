/**
 * 日程视图（Web 壳，`CalendarAgendaBoard`）
 * =========================================
 *
 * 按日期纵向分组展示当前月起 60 天区间内所有有任务、倒数纪念日或节日的日期：
 *   · 左栏：大号日数字（今天用主蓝高亮）+ 星期几，点击选中该日，并作为拖拽投放目标（`CalendarDropDay`）；
 *   · 中栏：时间刻度（`HH:MM` 或「全天」）+ 纵向时间线连接线；
 *   · 右栏：彩色任务/事件卡片（`data-testid="calendar-agenda-task-${task.id}"`），支持拖拽改期与完成切换。
 *
 * 无任何日程项时渲染共享 `@heyta/ui` 的 `<EmptyState>`（`check:empty-state`）。
 * 🔴 零内联样式（`check:l4`），所有类名挂在 `.ht-content__cal-*` 族下（`check:row-single-source`）。
 */

import {
  addDays,
  canRescheduleByCalendarDrag,
  festivalsOn,
  isoWeekday,
  localTimeOf,
  startOfMonth,
  type CountdownEvent,
  type FestivalId,
  type LocalDate,
  type Task,
} from '@heyta/domain';
import { useI18n, type MessageKey } from '@heyta/i18n';
import {
  calendarEventBarTitle,
  EmptyState,
  groupEventsByOccurrence,
  groupTasksByCalendarDate,
  TaskList,
  type CalendarBoardLabels,
  type CalendarEventBarLabels,
} from '@heyta/ui';
import { useMemo } from 'react';

import { CalendarDragBar, CalendarDropDay } from './CalendarDnd.js';

export interface CalendarAgendaBoardProps {
  readonly tasks: readonly Task[];
  readonly tasksById: ReadonlyMap<string, Task>;
  readonly events: readonly CountdownEvent[];
  readonly eventLabels: CalendarEventBarLabels;
  readonly labels: CalendarBoardLabels;
  readonly today: LocalDate;
  readonly cursor: LocalDate;
  readonly selected: LocalDate;
  readonly busyTaskId: string | null;
  readonly onSelectDay: (date: LocalDate) => void;
  readonly onToggleTask: (taskId: string) => void;
}

const AGENDA_SPAN_DAYS = 60;

const FESTIVAL_KEYS: Record<FestivalId, MessageKey> = {
  'new-year': 'common.calendar.festival.newYear',
  'spring-festival': 'common.calendar.festival.springFestival',
  qingming: 'common.calendar.festival.qingming',
  'labour-day': 'common.calendar.festival.labourDay',
  'dragon-boat': 'common.calendar.festival.dragonBoat',
  'mid-autumn': 'common.calendar.festival.midAutumn',
  'national-day': 'common.calendar.festival.nationalDay',
};

function taskTimeLabel(task: Task, allDayLabel: string): string {
  if (task.dueDateLocal !== undefined || task.dueDate === undefined) return allDayLabel;
  return localTimeOf(task.dueDate) ?? allDayLabel;
}

export function CalendarAgendaBoard({
  tasks,
  tasksById,
  events,
  eventLabels,
  labels,
  today,
  cursor,
  selected,
  busyTaskId,
  onSelectDay,
  onToggleTask,
}: CalendarAgendaBoardProps): React.JSX.Element {
  const { t } = useI18n();
  const allDayLabel = labels.dayAllDay ?? t('common.calendar.dayAllDay');

  const dayGroups = useMemo(() => {
    const start = startOfMonth(cursor);
    const end = addDays(start, AGENDA_SPAN_DAYS - 1);
    const rangeFrom = selected < start ? selected : start;
    const rangeTo = selected > end ? selected : end;
    const tasksByDate = groupTasksByCalendarDate(tasks, rangeFrom, rangeTo);
    const eventsByDate = groupEventsByOccurrence(events, today, rangeFrom, rangeTo);

    const candidateDates = new Set<LocalDate>();
    for (let i = 0; i < AGENDA_SPAN_DAYS; i += 1) {
      candidateDates.add(addDays(start, i));
    }
    candidateDates.add(selected);

    const sortedDates = [...candidateDates].sort();
    const groups: {
      readonly date: LocalDate;
      readonly tasks: readonly Task[];
      readonly events: ReturnType<typeof eventsByDate.get> & {};
      readonly festivals: readonly FestivalId[];
    }[] = [];

    for (const date of sortedDates) {
      const dayTasks = tasksByDate.get(date) ?? [];
      const dayEvents = eventsByDate.get(date) ?? [];
      const fests = festivalsOn(date);
      if (dayTasks.length > 0 || dayEvents.length > 0 || fests.length > 0) {
        groups.push({
          date,
          tasks: dayTasks,
          events: dayEvents,
          festivals: fests,
        });
      }
    }
    return groups;
  }, [cursor, events, selected, tasks, today]);

  if (dayGroups.length === 0) {
    return (
      <div className="ht-content__cal-agenda" data-testid="calendar-board-agenda">
        <EmptyState
          illustration="calendar"
          title={t('web.calendar.dayEmpty')}
          testID="calendar-agenda-empty"
        />
      </div>
    );
  }

  return (
    <div className="ht-content__cal-agenda" data-testid="calendar-board-agenda">
      {dayGroups.map((group) => {
        const isToday = group.date === today;
        const isSelected = group.date === selected;
        const dayNum = Number(group.date.slice(8, 10));
        const weekdayLabel = labels.weekdays[isoWeekday(group.date) - 1] ?? '';

        return (
          <CalendarDropDay key={group.date} date={group.date}>
            <section
              className="ht-content__cal-agenda-day"
              data-testid={`calendar-agenda-day-${group.date}`}
              data-today={isToday ? 'true' : 'false'}
              data-selected={isSelected ? 'true' : 'false'}
            >
              {/* 左栏：大号日数字 + 星期 */}
              <button
                type="button"
                className="ht-content__cal-agenda-date"
                onClick={() => onSelectDay(group.date)}
              >
                <span className="ht-content__cal-agenda-daynum ht-type-headline">{dayNum}</span>
                <span className="ht-content__cal-agenda-weekday ht-type-caption">{weekdayLabel}</span>
              </button>

              {/* 中栏 + 右栏：按条目对齐的时间轴与卡片 */}
              <div className="ht-content__cal-agenda-items">
                {group.tasks.map((task) => {
                  const timeText = taskTimeLabel(task, allDayLabel);
                  const singleList = [task];
                  return (
                    <div
                      key={task.id}
                      className="ht-content__cal-agenda-item"
                      data-testid={`calendar-agenda-task-${task.id}`}
                    >
                      <div className="ht-content__cal-agenda-timeline">
                        <span className="ht-content__cal-agenda-time ht-type-caption">{timeText}</span>
                        <span className="ht-content__cal-agenda-dot" aria-hidden="true" />
                      </div>
                      <div className="ht-content__cal-agenda-card">
                        <TaskList
                          tasks={singleList}
                          density="minimal"
                          onToggleTask={onToggleTask}
                          busyTaskId={busyTaskId}
                          labels={labels.taskRow}
                          renderRowWrapper={(row, node) => {
                            const fullTask = tasksById.get(row.id);
                            if (fullTask === undefined || !canRescheduleByCalendarDrag(fullTask)) return node;
                            return <CalendarDragBar id={row.id}>{node}</CalendarDragBar>;
                          }}
                          testID={`calendar-agenda-tasklist-${task.id}`}
                        />
                      </div>
                    </div>
                  );
                })}

                {group.events.map((ev) => (
                  <div
                    key={`event-${ev.id}`}
                    className="ht-content__cal-agenda-item"
                    data-testid={`calendar-agenda-event-${group.date}-${ev.id}`}
                  >
                    <div className="ht-content__cal-agenda-timeline">
                      <span className="ht-content__cal-agenda-time ht-type-caption">{allDayLabel}</span>
                      <span className="ht-content__cal-agenda-dot" aria-hidden="true" />
                    </div>
                    <div className="ht-content__cal-agenda-card ht-content__cal-agenda-card--event ht-type-body-sm">
                      {calendarEventBarTitle(ev, eventLabels)}
                    </div>
                  </div>
                ))}

                {group.festivals.map((festId) => (
                  <div
                    key={`fest-${festId}`}
                    className="ht-content__cal-agenda-item"
                    data-testid={`calendar-agenda-festival-${group.date}-${festId}`}
                  >
                    <div className="ht-content__cal-agenda-timeline">
                      <span className="ht-content__cal-agenda-time ht-type-caption">{allDayLabel}</span>
                      <span className="ht-content__cal-agenda-dot" aria-hidden="true" />
                    </div>
                    <div className="ht-content__cal-agenda-card ht-content__cal-agenda-card--event ht-type-body-sm">
                      {t(FESTIVAL_KEYS[festId])}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </CalendarDropDay>
        );
      })}
    </div>
  );
}
