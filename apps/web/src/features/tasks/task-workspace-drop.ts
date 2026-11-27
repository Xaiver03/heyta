/**
 * 跨工作区任务拖拽落点解析与执行（Web 壳）
 * ==========================================
 *
 * 允许把任务行直接拖到左侧栏（今天 / 明天 / 最近 7 天 / 全部 / 各清单 / 各标签）、
 * 任务列表（各日期分组 / 各分节）或日历（月/周日格 / 日视图全天带 / 小时行 / 25 分钟槽位 / 迷你月历）
 * 上一步完成改期或归属调整。
 *
 * 🔴 业务语义（怎么算新截止日 / 时刻）全在 `@heyta/domain` 的 `planCalendarDrop` / `planCalendarTimeDrop`；
 * 本文件只做 DOM 命中目标解析与向 store 动作的薄转发。
 */

import {
  addDays,
  planCalendarAllDayDrop,
  planCalendarDrop,
  planCalendarTimeDrop,
  type LocalDate,
} from '@heyta/domain';

import { useTaskStore } from './store.js';

export const TASK_DRAG_MIME = 'application/x-heyta-task-id';

export type WorkspaceDropTarget =
  | { readonly kind: 'date'; readonly date: LocalDate; readonly element: HTMLElement }
  | { readonly kind: 'allDay'; readonly date: LocalDate; readonly element: HTMLElement }
  | {
      readonly kind: 'time';
      readonly date: LocalDate;
      readonly hour: number;
      readonly minute: number;
      readonly element: HTMLElement;
    }
  | { readonly kind: 'clearDate'; readonly element: HTMLElement }
  | { readonly kind: 'project'; readonly projectId: string | undefined; readonly element: HTMLElement }
  | { readonly kind: 'section'; readonly sectionId: string | undefined; readonly element: HTMLElement }
  | { readonly kind: 'tag'; readonly tagId: string; readonly element: HTMLElement };

export function resolveWorkspaceDropTarget(
  target: EventTarget | null,
  todayDate: LocalDate,
  calendarCursorDate?: LocalDate,
): WorkspaceDropTarget | undefined {
  if (!(target instanceof Element)) return undefined;
  const el = target;
  const activeCalDate = calendarCursorDate ?? todayDate;

  // 1. 日历日视图 25 分钟槽位 [data-testid^="calendar-board-day-slot-"]
  const slotEl = el.closest<HTMLElement>('[data-testid^="calendar-board-day-slot-"]');
  if (slotEl !== null) {
    const testId = slotEl.getAttribute('data-testid') ?? '';
    const match = /^calendar-board-day-slot-(\d{1,2})-(\d{1,2})$/.exec(testId);
    if (match !== null) {
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      if (Number.isInteger(hour) && hour >= 0 && hour <= 23 && Number.isInteger(minute) && minute >= 0 && minute <= 59) {
        return { kind: 'time', date: activeCalDate, hour, minute, element: slotEl };
      }
    }
  }

  // 2. 日历日视图小时行 [data-testid^="calendar-board-day-hour-"]
  const hourEl = el.closest<HTMLElement>('[data-testid^="calendar-board-day-hour-"]');
  if (hourEl !== null) {
    const testId = hourEl.getAttribute('data-testid') ?? '';
    const match = /^calendar-board-day-hour-(\d{1,2})$/.exec(testId);
    if (match !== null) {
      const hour = Number(match[1]);
      if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
        return { kind: 'time', date: activeCalDate, hour, minute: 0, element: hourEl };
      }
    }
  }

  // 3. 日历日视图全天带 [data-testid="calendar-board-day-all-day"]
  const allDayEl = el.closest<HTMLElement>('[data-testid="calendar-board-day-all-day"]');
  if (allDayEl !== null) {
    return { kind: 'allDay', date: activeCalDate, element: allDayEl };
  }

  // 4. 日历月/周日格 [data-testid^="calendar-cell-"]（排除 -more / -bar 子后缀）
  let cellCursor: HTMLElement | null = el.closest<HTMLElement>('[data-testid^="calendar-cell-"]');
  while (cellCursor !== null) {
    const testId = cellCursor.getAttribute('data-testid') ?? '';
    const match = /^calendar-cell-(\d{4}-\d{2}-\d{2})$/.exec(testId);
    if (match !== null && match[1] !== undefined) {
      return { kind: 'date', date: match[1] as LocalDate, element: cellCursor };
    }
    cellCursor = cellCursor.parentElement?.closest<HTMLElement>('[data-testid^="calendar-cell-"]') ?? null;
  }

  // 5. 日历侧栏迷你月历日格 [data-testid^="calendar-mini-day-"]
  const miniDayEl = el.closest<HTMLElement>('[data-testid^="calendar-mini-day-"]');
  if (miniDayEl !== null) {
    const testId = miniDayEl.getAttribute('data-testid') ?? '';
    const match = /^calendar-mini-day-(\d{4}-\d{2}-\d{2})$/.exec(testId);
    if (match !== null && match[1] !== undefined) {
      return { kind: 'date', date: match[1] as LocalDate, element: miniDayEl };
    }
  }

  // 6. 侧栏智能清单
  const navTodayEl = el.closest<HTMLElement>('[data-testid="nav-scope-today"]');
  if (navTodayEl !== null) {
    return { kind: 'date', date: todayDate, element: navTodayEl };
  }
  const navTomorrowEl = el.closest<HTMLElement>('[data-testid="nav-scope-tomorrow"]');
  if (navTomorrowEl !== null) {
    return { kind: 'date', date: addDays(todayDate, 1), element: navTomorrowEl };
  }
  const navNext7El = el.closest<HTMLElement>('[data-testid="nav-scope-next7Days"]');
  if (navNext7El !== null) {
    return { kind: 'date', date: addDays(todayDate, 7), element: navNext7El };
  }
  const navAllEl = el.closest<HTMLElement>('[data-testid="nav-scope-all"]');
  if (navAllEl !== null) {
    return { kind: 'project', projectId: undefined, element: navAllEl };
  }

  // 7. 侧栏清单行 [data-testid^="project-"][data-testid$="-row"]
  const projectRowEl = el.closest<HTMLElement>('[data-testid^="project-"][data-testid$="-row"]');
  if (projectRowEl !== null) {
    const testId = projectRowEl.getAttribute('data-testid') ?? '';
    const id = testId.slice('project-'.length, -'-row'.length);
    if (id.length > 0) {
      return { kind: 'project', projectId: id, element: projectRowEl };
    }
  }

  // 8. 侧栏标签行 [data-testid^="tag-"][data-testid$="-row"]
  const tagRowEl = el.closest<HTMLElement>('[data-testid^="tag-"][data-testid$="-row"]');
  if (tagRowEl !== null) {
    const testId = tagRowEl.getAttribute('data-testid') ?? '';
    const id = testId.slice('tag-'.length, -'-row'.length);
    if (id.length > 0) {
      return { kind: 'tag', tagId: id, element: tagRowEl };
    }
  }

  // 9. 任务列表日期分组 section[data-testid^="task-group-"]
  const groupEl = el.closest<HTMLElement>('section[data-testid^="task-group-"]');
  if (groupEl !== null) {
    const testId = groupEl.getAttribute('data-testid') ?? '';
    if (testId === 'task-group-today') {
      return { kind: 'date', date: todayDate, element: groupEl };
    }
    if (testId === 'task-group-tomorrow') {
      return { kind: 'date', date: addDays(todayDate, 1), element: groupEl };
    }
    if (
      testId === 'task-group-no-date' ||
      testId === 'task-group-nodate' ||
      testId === 'task-group-undated'
    ) {
      return { kind: 'clearDate', element: groupEl };
    }
    const dateMatch = /^task-group-date-(\d{4}-\d{2}-\d{2})$/.exec(testId);
    if (dateMatch !== null && dateMatch[1] !== undefined) {
      return { kind: 'date', date: dateMatch[1] as LocalDate, element: groupEl };
    }
  }

  // 10. 任务列表 Section 分组 section[data-testid^="task-section-"]
  const sectionEl = el.closest<HTMLElement>('section[data-testid^="task-section-"]');
  if (sectionEl !== null) {
    const testId = sectionEl.getAttribute('data-testid') ?? '';
    if (testId === 'task-section-ungrouped') {
      return { kind: 'section', sectionId: undefined, element: sectionEl };
    }
    const id = testId.slice('task-section-'.length);
    if (id.length > 0) {
      return { kind: 'section', sectionId: id, element: sectionEl };
    }
  }

  return undefined;
}

export async function executeWorkspaceTaskDrop(
  taskId: string,
  drop: WorkspaceDropTarget,
): Promise<void> {
  const store = useTaskStore.getState();
  const task = store.entities.tasks[taskId];
  if (!task) return;

  if (drop.kind === 'date') {
    const plan = planCalendarDrop(task, drop.date);
    if (plan) {
      await store.setDueDate(taskId, plan.dueDate, plan.dueDateLocal);
    }
    return;
  }

  if (drop.kind === 'allDay') {
    const plan = planCalendarAllDayDrop(task, drop.date);
    if (plan) {
      await store.setDueDate(taskId, plan.dueDate, plan.dueDateLocal);
    }
    return;
  }

  if (drop.kind === 'time') {
    const plan = planCalendarTimeDrop(task, drop.date, drop.hour, drop.minute);
    if (plan) {
      await store.setDueDate(taskId, plan.dueDate);
    }
    return;
  }

  if (drop.kind === 'clearDate') {
    if (task.dueDate !== undefined || task.dueDateLocal !== undefined) {
      await store.setDueDate(taskId, undefined);
    }
    return;
  }

  if (drop.kind === 'project') {
    if ((task.projectId ?? undefined) !== drop.projectId) {
      await store.moveToProject(taskId, drop.projectId);
    }
    return;
  }

  if (drop.kind === 'section') {
    if ((task.sectionId ?? undefined) !== drop.sectionId) {
      const storeWithSection = store as typeof store & {
        moveToSection?: (id: string, sectionId: string | undefined) => Promise<void>;
      };
      if (typeof storeWithSection.moveToSection === 'function') {
        await storeWithSection.moveToSection(taskId, drop.sectionId);
      }
    }
    return;
  }

  if (drop.kind === 'tag') {
    const cur = task.tagIds ?? [];
    if (!cur.includes(drop.tagId)) {
      await store.setTags(taskId, [...cur, drop.tagId]);
    }
  }
}
