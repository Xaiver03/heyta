import { OpType } from '@heyta/sync-core';
import { create } from 'zustand';

import { Priority, Quadrant, bucketByQuadrant, type Task } from '@heyta/domain';
import type { MaterializedState } from '@heyta/op-log';

import {
  __resetOpLogForTests as resetEngine,
  currentState,
  dispatchIntent,
  initOpLog as initShared,
  onEngineChange,
} from '../../lib/oplog.js';

export type TaskFilter =
  | { kind: 'all' }
  | { kind: 'today' }
  | { kind: 'completed' }
  | { kind: 'quadrant'; quadrant: Quadrant }
  | { kind: 'project'; projectId: string };

interface TaskState {
  /** 物化状态快照。**由 op-log 引擎提供，不是自建的真相。** */
  entities: MaterializedState;
  filter: TaskFilter;
  /** 当前时间，供象限归类。显式存下来避免渲染间漂移。 */
  now: number;
  ready: boolean;
  error?: string;

  addTask: (title: string, over?: Partial<Task>) => Promise<void>;
  toggleComplete: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  setPriority: (id: string, priority: number) => Promise<void>;
  setImportant: (id: string, important: boolean) => Promise<void>;
  setDueDate: (id: string, dueDate: number | undefined) => Promise<void>;
  moveToProject: (id: string, projectId: string | undefined) => Promise<void>;
  setFilter: (filter: TaskFilter) => void;
  refreshNow: () => void;
}

/**
 * 初始化 op-log（**委托给共享单例**）。
 *
 * ⚠️ 不在这里自己 new OpLogEngine：四个 feature store 各建一个引擎的话，
 * 它们会各自持有**不同的向量时钟** —— A store 写的 op 对 B store 的引擎
 * 是"没见过的因果"，冲突判定随即失真，并发写入会被误判。
 */
export function initOpLog(dbName = 'heyta'): Promise<void> {
  const p = initShared(dbName);
  return p.then(() => {
    useTaskStore.setState({ entities: currentState(), ready: true });
  });
}

/** 仅供测试。 */
export function __resetOpLogForTests(): void {
  resetEngine();
}

/** 引擎状态变化 → 同步进 store。 */
onEngineChange(() => {
  useTaskStore.setState({ entities: currentState() });
});

function nextTaskId(): string {
  taskCounter += 1;
  return `task-${String(Date.now())}-${String(taskCounter)}`;
}

let taskCounter = 0;

export const useTaskStore = create<TaskState>((set, get) => ({
  entities: {
    tasks: {},
    projects: {},
    tags: {},
    habits: {},
    habitLogs: {},
    focusSessions: {},
  },
  filter: { kind: 'all' },
  now: Date.now(),
  ready: false,

  addTask: async (title, over = {}) => {
    const trimmed = title.trim();
    if (trimmed === '') return; // 空标题不建任务，静默忽略（用户只是按了回车）

    const id = nextTaskId();
    // ⚠️ 唯一写入口（D4）。没有 set({ entities: ... }) 这种捷径。
    await dispatchIntent({
      entityType: 'TASK',
      entityId: id,
      opType: OpType.Create,
      payload: { title: trimmed, priority: Priority.None, ...over },
    });
  },

  toggleComplete: async (id) => {
    const task = get().entities.tasks[id];
    if (task === undefined) return;

    // 用 completedAt 的**有无**表示完成态，不另设 completed 布尔 ——
    // 两个字段必然会不一致。
    const completedAt = task.completedAt === undefined ? Date.now() : null;

    await dispatchIntent({
      entityType: 'TASK',
      entityId: id,
      opType: OpType.Update,
      // null 表示"显式清除该字段"。undefined 会被 JSON 丢掉，
      // 于是"取消完成"在另一端静默失效。reducer 负责把 null 变成删除。
      payload: { completedAt },
    });
  },

  deleteTask: async (id) => {
    // 软删除（墓碑）。DELETE op 由 reducer 转成 deletedAt。
    // 物理删除会让同步端永远看不到这次删除。
    await dispatchIntent({
      entityType: 'TASK',
      entityId: id,
      opType: OpType.Delete,
      payload: {},
    });
  },

  setPriority: async (id, priority) => {
    await dispatchIntent({
      entityType: 'TASK',
      entityId: id,
      opType: OpType.Update,
      payload: { priority },
    });
  },

  setImportant: async (id, important) => {
    // 四象限的"重要"维度。四象限矩阵的拖拽会改这个 + dueDate。
    await dispatchIntent({
      entityType: 'TASK',
      entityId: id,
      opType: OpType.Update,
      payload: { important },
    });
  },

  setDueDate: async (id, dueDate) => {
    await dispatchIntent({
      entityType: 'TASK',
      entityId: id,
      opType: OpType.Update,
      // undefined → null：null 表示"清除截止时间"，能穿过 JSON
      payload: { dueDate: dueDate ?? null },
    });
  },

  moveToProject: async (id, projectId) => {
    await dispatchIntent({
      entityType: 'TASK',
      entityId: id,
      opType: OpType.Update,
      payload: { projectId: projectId ?? null },
    });
  },

  setFilter: (filter) => set({ filter }),
  refreshNow: () => set({ now: Date.now() }),
}));

// ─────────────────────────────────────────────────────────────
// 选择器（纯读，不改状态）
// ─────────────────────────────────────────────────────────────

export function selectVisibleTasks(state: TaskState): Task[] {
  const alive = Object.values(state.entities.tasks).filter(
    (t) => t.deletedAt === undefined,
  );

  // ⚠️ 必须提取成局部常量。反复写 `state.filter.kind` / `state.filter.projectId`
  // 时 TypeScript **无法跨表达式保持 narrowing** —— 属性访问每次都会重新
  // 取一遍类型，判别联合的收窄就丢掉了。
  const filter = state.filter;

  switch (filter.kind) {
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
      return bucketByQuadrant(alive, { now: state.now })[filter.quadrant];
    case 'project':
      return alive.filter(
        (t) => t.completedAt === undefined && t.projectId === filter.projectId,
      );
  }
}

export function selectQuadrantCounts(state: TaskState): Record<Quadrant, number> {
  const buckets = bucketByQuadrant(Object.values(state.entities.tasks), {
    now: state.now,
  });
  return {
    [Quadrant.UrgentImportant]: buckets[Quadrant.UrgentImportant].length,
    [Quadrant.ImportantNotUrgent]: buckets[Quadrant.ImportantNotUrgent].length,
    [Quadrant.UrgentNotImportant]: buckets[Quadrant.UrgentNotImportant].length,
    [Quadrant.Neither]: buckets[Quadrant.Neither].length,
  };
}
