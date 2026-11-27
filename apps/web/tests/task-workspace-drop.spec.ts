/**
 * 跨工作区任务拖拽落点解析（`resolveWorkspaceDropTarget`）单元测试
 * ================================================================
 *
 * 验证 `resolveWorkspaceDropTarget` 对日历 15 分钟槽位、全天带、日格、
 * 侧栏范围/清单/标签、以及任务列表日期分组/Section 分组的 DOM 命中解析。
 */

import { describe, expect, it } from 'vitest';

import { resolveWorkspaceDropTarget } from '../src/features/tasks/task-workspace-drop.js';

function makeElementWithChild(tag: string, testId: string): { root: HTMLElement; child: HTMLElement } {
  const root = document.createElement(tag);
  root.setAttribute('data-testid', testId);
  const child = document.createElement('span');
  root.appendChild(child);
  return { root, child };
}

describe('resolveWorkspaceDropTarget', () => {
  const today = '2026-11-27';
  const calCursor = '2026-11-28';

  it('识别日历 15 分钟槽位 calendar-board-day-slot-14-15 → { kind: "time", hour: 14, minute: 15 }', () => {
    const { root, child } = makeElementWithChild('div', 'calendar-board-day-slot-14-15');
    const hit = resolveWorkspaceDropTarget(child, today, calCursor);
    expect(hit).toEqual({
      kind: 'time',
      date: calCursor,
      hour: 14,
      minute: 15,
      element: root,
    });
  });

  it('识别日历全天带 calendar-board-day-all-day → { kind: "allDay" }', () => {
    const { root, child } = makeElementWithChild('div', 'calendar-board-day-all-day');
    const hit = resolveWorkspaceDropTarget(child, today, calCursor);
    expect(hit).toEqual({
      kind: 'allDay',
      date: calCursor,
      element: root,
    });
  });

  it('识别日历日格 calendar-cell-2026-11-28 → { kind: "date", date: "2026-11-28" }', () => {
    const { root, child } = makeElementWithChild('div', 'calendar-cell-2026-11-28');
    // 即使内部嵌套了 calendar-cell-2026-11-28-bar-t1，也向上冒泡命中日格本身
    child.setAttribute('data-testid', 'calendar-cell-2026-11-28-bar-t1');
    const hit = resolveWorkspaceDropTarget(child, today);
    expect(hit).toEqual({
      kind: 'date',
      date: '2026-11-28',
      element: root,
    });
  });

  it('识别侧栏 nav-scope-today / nav-scope-tomorrow / nav-scope-all / project-p1-row / tag-t1-row', () => {
    const todayNode = makeElementWithChild('button', 'nav-scope-today');
    expect(resolveWorkspaceDropTarget(todayNode.child, today)).toEqual({
      kind: 'date',
      date: '2026-11-27',
      element: todayNode.root,
    });

    const tomorrowNode = makeElementWithChild('button', 'nav-scope-tomorrow');
    expect(resolveWorkspaceDropTarget(tomorrowNode.child, today)).toEqual({
      kind: 'date',
      date: '2026-11-28',
      element: tomorrowNode.root,
    });

    const allNode = makeElementWithChild('button', 'nav-scope-all');
    expect(resolveWorkspaceDropTarget(allNode.child, today)).toEqual({
      kind: 'project',
      projectId: undefined,
      element: allNode.root,
    });

    const projectNode = makeElementWithChild('div', 'project-p1-row');
    expect(resolveWorkspaceDropTarget(projectNode.child, today)).toEqual({
      kind: 'project',
      projectId: 'p1',
      element: projectNode.root,
    });

    const tagNode = makeElementWithChild('div', 'tag-t1-row');
    expect(resolveWorkspaceDropTarget(tagNode.child, today)).toEqual({
      kind: 'tag',
      tagId: 't1',
      element: tagNode.root,
    });
  });

  it('识别任务列表分组 task-group-today / task-group-no-date / task-section-s1', () => {
    const groupToday = makeElementWithChild('section', 'task-group-today');
    expect(resolveWorkspaceDropTarget(groupToday.child, today)).toEqual({
      kind: 'date',
      date: '2026-11-27',
      element: groupToday.root,
    });

    const groupNoDate = makeElementWithChild('section', 'task-group-no-date');
    expect(resolveWorkspaceDropTarget(groupNoDate.child, today)).toEqual({
      kind: 'clearDate',
      element: groupNoDate.root,
    });

    const sectionS1 = makeElementWithChild('section', 'task-section-s1');
    expect(resolveWorkspaceDropTarget(sectionS1.child, today)).toEqual({
      kind: 'section',
      sectionId: 's1',
      element: sectionS1.root,
    });
  });
});
