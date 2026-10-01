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
  FULL_SCOPE,
  groupTasksByDate,
  isCompleted,
  isScopeEmpty,
  pendingCount,
  scopeTasks,
  sectionTasks,
  type TaskFilter,
} from '../src/task-filter.js';
import { toLocalDate } from '../src/date.js';

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

describe('groupTasksByDate', () => {
  it('🔴 组序固定：逾期 → 日期升序 → 无截止时间', () => {
    // 🔴 刻意**乱序**传入（后建的日期更近、无日期的夹在中间）：
    //    组序是本函数的输出契约，不能跟着输入的运气走。
    const groups = groupTasksByDate(
      [
        task({ id: 'far', dueDate: LOCAL_NOON + 3 * DAY }),
        task({ id: 'none' }),
        task({ id: 'tomorrow', dueDate: LOCAL_NOON + DAY }),
        task({ id: 'over2', dueDate: LOCAL_NOON - 2 * DAY }),
        task({ id: 'today', dueDate: LOCAL_NOON }),
        task({ id: 'over1', dueDate: LOCAL_NOON - DAY }),
      ],
      ctx,
    );
    expect(groups.map((g) => g.kind)).toEqual(['overdue', 'date', 'date', 'date', 'undated']);
    expect(groups[0]?.tasks.map((t) => t.id)).toEqual(['over2', 'over1']);
    expect(groups[1]?.date).toBe(toLocalDate(LOCAL_NOON));
    expect(groups[2]?.date).toBe(toLocalDate(LOCAL_NOON + DAY));
    expect(groups[3]?.date).toBe(toLocalDate(LOCAL_NOON + 3 * DAY));
    expect(groups[4]?.tasks.map((t) => t.id)).toEqual(['none']);
  });

  it('🔴 逾期的日界与 `sectionTasks` 完全一致：今天 00:30 不算逾期', () => {
    const dawn = new Date(2026, 8, 28, 0, 30, 0).getTime();
    const groups = groupTasksByDate([task({ id: 'a', dueDate: dawn })], ctx);
    // 只有一组，且不是 overdue —— "今天清晨"归今天，不是逾期。
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe('date');
  });

  it('组内保持传入顺序（顺序规范在 app-host，这里不插手）', () => {
    const groups = groupTasksByDate(
      [task({ id: 'b', dueDate: LOCAL_NOON }), task({ id: 'a', dueDate: LOCAL_NOON })],
      ctx,
    );
    expect(groups[0]?.tasks.map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('已完成的跳过（调用方要展示已完成走 `completed` 筛选平铺）', () => {
    const groups = groupTasksByDate(
      [task({ id: 'done', dueDate: LOCAL_NOON, completedAt: LOCAL_NOON }), task({ id: 'a' })],
      ctx,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe('undated');
  });

  it('软删除的不进任何组', () => {
    expect(groupTasksByDate([task({ id: 'x', deletedAt: LOCAL_NOON })], ctx)).toEqual([]);
  });

  it('全部无逾期、无未来时只剩无截止组；空输入给空数组', () => {
    expect(groupTasksByDate([task({ id: 'a' })], ctx).map((g) => g.kind)).toEqual(['undated']);
    expect(groupTasksByDate([], ctx)).toEqual([]);
  });
});

/**
 * 日历侧栏的多选范围（`scopeTasks`）。
 *
 * 三条判据各自对应一个**反转了不会报错**的裁决，所以逐条钉：
 * 空 = 全部（不是空集）、含已完成（与 `filterTasks` 每条分支都相反）、
 * 清单与标签取并集（取交集会让"勾第二个"经常把结果清成 0 条）。
 */
describe('scopeTasks（日历侧栏多选）', () => {
  const tasks = [
    task({ id: 'p1', projectId: 'pa' }),
    task({ id: 'p1-done', projectId: 'pa', completedAt: LOCAL_NOON }),
    task({ id: 'p2', projectId: 'pb' }),
    task({ id: 'child', projectId: 'pa-child' }),
    task({ id: 'tagged', tagIds: ['ta'] }),
    task({ id: 'both', projectId: 'pb', tagIds: ['tb'] }),
    task({ id: 'inbox' }),
    task({ id: 'dead', projectId: 'pa', deletedAt: LOCAL_NOON }),
  ];
  const ids = (projectIds: string[], tagIds: string[]) =>
    scopeTasks(tasks, { projectIds, tagIds }).map((t) => t.id);

  it('空选择 = 全部（「所有」那一行的语义），墓碑仍然不进', () => {
    expect(isScopeEmpty(FULL_SCOPE)).toBe(true);
    expect(ids([], [])).toEqual(['p1', 'p1-done', 'p2', 'child', 'tagged', 'both', 'inbox']);
    expect(ids([], [])).not.toContain('dead');
  });

  it('🔴 已完成**不**被丢掉 —— 一勾完就从日历格子里消失是不可接受的', () => {
    expect(ids(['pa'], [])).toEqual(['p1', 'p1-done']);
  });

  it('清单与标签是**并集**，不是交集', () => {
    expect(ids(['pb'], ['ta'])).toEqual(['p2', 'tagged', 'both']);
  });

  it('父清单只匹配自己的任务（子清单要单独勾）；非空选择 `isScopeEmpty` 为 false', () => {
    expect(ids(['pa'], [])).not.toContain('child');
    expect(isScopeEmpty({ projectIds: ['pa'], tagIds: [] })).toBe(false);
    expect(isScopeEmpty({ projectIds: [], tagIds: ['ta'] })).toBe(false);
  });
});
