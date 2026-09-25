/**
 * 任务列表 store
 * ===============
 *
 * ⚠️ **这是 P1 的临时实现，不是最终形态。**
 * 按 P1 计划 D4，**op-log 是唯一写入口**：UI 不得直接改状态。
 * 目前 op-log 引擎（任务 3.2）还没写，所以这里先用内存 store 把 UI 跑通。
 * 接上 op-log 时，下面每个 `dispatch` 都要改成产出一个 op —— 见文件末尾的 TODO。
 *
 * 用 Zustand 而不是 Redux：我们没有 SSE/时间旅行需求，
 * 而 Zustand 无样板、无 Provider、选择器天然细粒度，重渲染控制更简单。
 */

import { create } from 'zustand';

import {
  Priority,
  Quadrant,
  bucketByQuadrant,
  classifyQuadrant,
  type Task,
} from '@heyta/domain';

export type TaskFilter =
  | { kind: 'all' }
  | { kind: 'today' }
  | { kind: 'quadrant'; quadrant: Quadrant }
  | { kind: 'completed' };

interface TaskState {
  tasks: Task[];
  filter: TaskFilter;
  /** 当前时间。**存下来而不是每处调 Date.now()** —— 否则象限归类会在渲染中漂移。 */
  now: number;

  addTask: (title: string, over?: Partial<Task>) => void;
  toggleComplete: (id: string) => void;
  deleteTask: (id: string) => void;
  setFilter: (filter: TaskFilter) => void;
  refreshNow: () => void;
}

let idCounter = 0;
/** 生成 ID。真正的实现会用 crypto.randomUUID，这里保持确定性以便测试。 */
function nextId(): string {
  idCounter += 1;
  return `task-${idCounter}`;
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  filter: { kind: 'all' },
  now: Date.now(),

  addTask: (title, over = {}) => {
    const trimmed = title.trim();
    if (trimmed === '') return; // 空标题不建任务，也不报错（用户按回车而已）
    const ts = Date.now();
    const task: Task = {
      id: nextId(),
      title: trimmed,
      createdAt: ts,
      updatedAt: ts,
      priority: Priority.None,
      ...over,
    };
    // TODO(P1-3.2): 改为 `opLog.dispatch(createOp('TASK', task.id, task))`
    set((s) => ({ tasks: [...s.tasks, task] }));
  },

  toggleComplete: (id) => {
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== id) return t;
        // 完成/取消完成用 completedAt 的**有无**表示，
        // 不另设 completed 布尔 —— 两个字段必然会不一致。
        const completedAt = t.completedAt === undefined ? Date.now() : undefined;
        return { ...t, completedAt, updatedAt: Date.now() };
      }),
    }));
  },

  deleteTask: (id) => {
    // 软删除（墓碑）。硬删除会让同步端永远看不到这次删除。
    // TODO(P1-3.2): 墓碑清理策略由 op-log 的 compaction 负责。
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id ? { ...t, deletedAt: Date.now(), updatedAt: Date.now() } : t,
      ),
    }));
  },

  setFilter: (filter) => set({ filter }),

  refreshNow: () => set({ now: Date.now() }),
}));

/** 按当前筛选条件取出可见任务。 */
export function selectVisibleTasks(state: TaskState): Task[] {
  const alive = state.tasks.filter((t) => t.deletedAt === undefined);

  switch (state.filter.kind) {
    case 'all':
      return alive.filter((t) => t.completedAt === undefined);
    case 'completed':
      return alive.filter((t) => t.completedAt !== undefined);
    case 'today': {
      const todayStr = new Date(state.now).toDateString();
      return alive.filter(
        (t) =>
          t.completedAt === undefined &&
          t.dueDate !== undefined &&
          new Date(t.dueDate).toDateString() === todayStr,
      );
    }
    case 'quadrant':
      return bucketByQuadrant(alive, { now: state.now })[state.filter.quadrant];
  }
}

/** 各象限的任务数，用于侧栏徽标。 */
export function selectQuadrantCounts(
  state: TaskState,
): Record<Quadrant, number> {
  const buckets = bucketByQuadrant(state.tasks, { now: state.now });
  return {
    [Quadrant.UrgentImportant]: buckets[Quadrant.UrgentImportant].length,
    [Quadrant.ImportantNotUrgent]: buckets[Quadrant.ImportantNotUrgent].length,
    [Quadrant.UrgentNotImportant]: buckets[Quadrant.UrgentNotImportant].length,
    [Quadrant.Neither]: buckets[Quadrant.Neither].length,
  };
}

export { classifyQuadrant };
