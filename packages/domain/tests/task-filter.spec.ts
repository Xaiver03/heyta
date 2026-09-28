/**
 * 任务筛选与分节语义
 * ====================
 *
 * 🔴 这个文件钉的是**一处 M1 违规的修复**：这些判据原先写在
 * `apps/web/src/features/tasks/store.ts`（一个壳）里，移动端因此又写了一遍
 * 分组逻辑。现在它们住在 `packages/domain`，四端共用一份。
 *
 * 最值得钉住的两条：
 *
 *   1. **`completed` 与其它分支的语义差别**：只有它会返回已完成的任务，
 *      其余（含 `all`）都只返回未完成的。写反的症状是"任务勾完之后
 *      从清单里消失、用户以为丢了"。
 *   2. **"今天"用本地时区**，不是 UTC。跨端一致的前提是两端都调同一个函数 ——
 *      这条如果各写一遍，表现是"同一个任务在网页的今天里、在手机的逾期里"。
 */

import { describe, expect, it } from 'vitest';

import { Priority, Quadrant, type Task } from '../src/entities.js';
import {
  filterTasks,
  isCompleted,
  pendingCount,
  sectionTasks,
  type TaskFilter,
} from '../src/task-filter.js';

/** 本地时间构造，避免测试自身引入时区漂移。 */
const LOCAL_NOON = new Date(2026, 8, 28, 12, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

function task(over: Partial<Task> & { id: string }): Task {
  return { title: over.id, createdAt: 0, updatedAt: 0, ...over } as Task;
}

const ctx = { now: LOCAL_NOON };

describe('filterTasks', () => {
  it('🔴 `all` 只给未完成的 —— 勾完就从清单里消失是最坏的那种"丢数据感"', () => {
    const tasks = [
      task({ id: 'a' }),
      task({ id: 'b', completedAt: LOCAL_NOON }),
    ];
    expect(filterTasks(tasks, { kind: 'all' }, ctx).map((t) => t.id)).toEqual(['a']);
  });

  it('🔴 `completed` 只给已完成的（它是唯一会返回已完成的分支）', () => {
    const tasks = [
      task({ id: 'a' }),
      task({ id: 'b', completedAt: LOCAL_NOON }),
    ];
    expect(filterTasks(tasks, { kind: 'completed' }, ctx).map((t) => t.id)).toEqual(['b']);
  });

  it('软删除的任务在任何筛选里都不出现', () => {
    const tasks = [task({ id: 'a', deletedAt: LOCAL_NOON })];
    for (const f of [
      { kind: 'all' },
      { kind: 'completed' },
      { kind: 'today' },
      { kind: 'project', projectId: 'p1' },
      { kind: 'tag', tagId: 't1' },
    ] as TaskFilter[]) {
      expect(filterTasks(tasks, f, ctx), `筛选 ${f.kind}`).toEqual([]);
    }
  });

  it('🔴 `today` 用**本地**日界：今天中午与今天清晨算同一天', () => {
    const dawn = new Date(2026, 8, 28, 0, 30, 0).getTime();
    const tasks = [task({ id: 'a', dueDate: dawn })];
    expect(filterTasks(tasks, { kind: 'today' }, ctx).map((t) => t.id)).toEqual(['a']);
  });

  it('🔴 昨天与明天都**不**算今天（差一天是这条最容易错的地方）', () => {
    const tasks = [
      task({ id: 'yesterday', dueDate: LOCAL_NOON - DAY }),
      task({ id: 'tomorrow', dueDate: LOCAL_NOON + DAY }),
    ];
    expect(filterTasks(tasks, { kind: 'today' }, ctx)).toEqual([]);
  });

  it('`today` 不含已完成的（今天做完的不该继续占着今天）', () => {
    const tasks = [task({ id: 'a', dueDate: LOCAL_NOON, completedAt: LOCAL_NOON })];
    expect(filterTasks(tasks, { kind: 'today' }, ctx)).toEqual([]);
  });

  it('`project` 与 `tag` 都只看未完成的，且按 id 精确匹配', () => {
    const tasks = [
      task({ id: 'a', projectId: 'p1', tagIds: ['t1'] }),
      task({ id: 'b', projectId: 'p2', tagIds: ['t1'] }),
      task({ id: 'c', projectId: 'p1', tagIds: ['t2'] }),
      task({ id: 'done', projectId: 'p1', tagIds: ['t1'], completedAt: LOCAL_NOON }),
    ];
    expect(filterTasks(tasks, { kind: 'project', projectId: 'p1' }, ctx).map((t) => t.id)).toEqual(['a', 'c']);
    expect(filterTasks(tasks, { kind: 'tag', tagId: 't1' }, ctx).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('没有 tagIds 的任务不会因为 `tag` 筛选崩溃（老数据没有这个字段）', () => {
    const tasks = [task({ id: 'a' })];
    expect(filterTasks(tasks, { kind: 'tag', tagId: 't1' }, ctx)).toEqual([]);
  });

  it('`quadrant` 走的是派生的四象限（ADR-0015）', () => {
    const tasks = [
      task({ id: 'q1', important: true, dueDate: LOCAL_NOON, priority: Priority.High }),
      task({ id: 'q4' }),
    ];
    const q1 = filterTasks(tasks, { kind: 'quadrant', quadrant: Quadrant.UrgentImportant }, ctx);
    expect(q1.map((t) => t.id)).toContain('q1');
    expect(q1.map((t) => t.id)).not.toContain('q4');
  });
});

describe('sectionTasks', () => {
  it('四组的归属规则：逾期 / 今天 / 收集箱 / 已完成', () => {
    const s = sectionTasks(
      [
        task({ id: 'over', dueDate: LOCAL_NOON - DAY }),
        task({ id: 'today', dueDate: LOCAL_NOON }),
        task({ id: 'future', dueDate: LOCAL_NOON + 3 * DAY }),
        task({ id: 'none' }),
        task({ id: 'done', completedAt: LOCAL_NOON }),
      ],
      ctx,
    );
    expect(s.overdue.map((t) => t.id)).toEqual(['over']);
    expect(s.dueToday.map((t) => t.id)).toEqual(['today']);
    // 未来到期的归收集箱（完整的"未来"分组留给日历）
    expect(s.inbox.map((t) => t.id).sort()).toEqual(['future', 'none']);
    expect(s.completed.map((t) => t.id)).toEqual(['done']);
  });

  it('🔴 已完成的**不**进前三组 —— 否则"已完成"会同时出现在两处', () => {
    const s = sectionTasks([task({ id: 'done', dueDate: LOCAL_NOON, completedAt: LOCAL_NOON })], ctx);
    expect(s.dueToday).toEqual([]);
    expect(s.completed.map((t) => t.id)).toEqual(['done']);
  });

  it('软删除的不进任何一组', () => {
    const s = sectionTasks([task({ id: 'x', deletedAt: LOCAL_NOON })], ctx);
    expect([...s.overdue, ...s.dueToday, ...s.inbox, ...s.completed]).toEqual([]);
  });

  it('🔴 待办数 = 三组之和（分节与计数共用同一个定义）', () => {
    const s = sectionTasks(
      [
        task({ id: 'over', dueDate: LOCAL_NOON - DAY }),
        task({ id: 'today', dueDate: LOCAL_NOON }),
        task({ id: 'none' }),
        task({ id: 'done', completedAt: LOCAL_NOON }),
      ],
      ctx,
    );
    expect(pendingCount(s)).toBe(3);
  });

  it('不排序：顺序与传入顺序一致（规范顺序由 app-host 定，这里不插手）', () => {
    const s = sectionTasks(
      [task({ id: 'b' }), task({ id: 'a' })],
      ctx,
    );
    expect(s.inbox.map((t) => t.id)).toEqual(['b', 'a']);
  });
});

describe('isCompleted', () => {
  it('只有一个判据：completedAt 有值', () => {
    expect(isCompleted(task({ id: 'a' }))).toBe(false);
    expect(isCompleted(task({ id: 'a', completedAt: LOCAL_NOON }))).toBe(true);
    // 0 也是有效的完成时间戳，不能被当作"没有"
    expect(isCompleted(task({ id: 'a', completedAt: 0 }))).toBe(true);
  });
});
