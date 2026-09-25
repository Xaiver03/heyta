/**
 * 任务 store —— **全部写入经由 op-log（P1 决策 D4）**
 * ======================================================
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 这个文件的每一条写入路径都必须走 `engine.dispatch()`。
 *
 * 为什么这不是形式主义：绕过去的话，改动看起来**完全正常**（界面立刻更新），
 * 但它不在 op-log 里 —— 于是永远不会同步到第二台设备，也没有向量时钟记录，
 * 后续与该实体的并发变更会被判成"无冲突"从而静默覆盖。
 * 用户只会在换设备时发现数据不见了，且无法归因。
 *
 * 因此本文件的纪律是：
 *   - `set(...)` 只用于**纯 UI 状态**（筛选器、草稿、加载标志）
 *   - 任何**实体数据**的变更都必须 `await engine.dispatch(...)`
 *   - 状态从 `engine.getState()` 读取（op-log 才是事实来源）
 * ═════════════════════════════════════════════════════════════════════════
 */

import { create } from 'zustand';

import { Priority, Quadrant, bucketByQuadrant, type Task } from '@heyta/domain';
import { OpLogEngine, type MaterializedState } from '@heyta/op-log';
import {
  IndexedDbAdapter,
  IndexedDbOpLogStore,
  META_KEYS,
  STORES,
} from '@heyta/storage';
import type { Operation } from '@heyta/sync-core';

export type TaskFilter =
  | { kind: 'all' }
  | { kind: 'today' }
  | { kind: 'completed' }
  | { kind: 'quadrant'; quadrant: Quadrant };

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
  setFilter: (filter: TaskFilter) => void;
  refreshNow: () => void;
}

/**
 * 引擎是模块级单例。
 *
 * 不放进 store 内部：它需要异步初始化（打开数据库、崩溃恢复），
 * 而 store 的创建是同步的。初始化完成后再把状态灌进 store。
 */
let engine: OpLogEngine | undefined;
let initPromise: Promise<void> | undefined;

/** 读取或生成稳定的设备 clientId。**一经生成不可更改**（LWW 决胜依据）。 */
async function resolveClientId(
  db: IndexedDbAdapter,
  key: string,
): Promise<string> {
  const existing = await db.get<{ key: string; value: string }>(STORES.META, key);
  if (existing !== undefined && typeof existing.value === 'string') {
    return existing.value;
  }
  const fresh =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `client-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
  await db.put(STORES.META, { key, value: fresh });
  return fresh;
}

/** 初始化引擎。幂等，可并发调用。 */
export function initOpLog(dbName = 'heyta'): Promise<void> {
  if (initPromise !== undefined) return initPromise;

  initPromise = (async () => {
    const db = new IndexedDbAdapter(dbName);
    await db.init();

    const store = new IndexedDbOpLogStore<Operation<string>>(db);
    const clientId = await resolveClientId(db, META_KEYS.CLIENT_ID);

    engine = new OpLogEngine({ store, clientId });

    // 🔴 崩溃恢复必须在接受任何新写入/同步之前完成。
    // 否则那些"已落盘未应用"的 op 占着 seq 却永不生效 —— 静默丢数据。
    await engine.recover();

    useTaskStore.setState({ entities: engine.getState(), ready: true });
  })().catch((error: unknown) => {
    // 初始化失败必须显式暴露，不能静默 —— 否则界面看起来正常但改动不落盘
    const message = error instanceof Error ? error.message : String(error);
    useTaskStore.setState({ ready: true, error: `存储初始化失败：${message}` });
    throw error;
  });

  return initPromise;
}

/** 仅供测试：重置模块级单例。 */
export function __resetOpLogForTests(): void {
  engine = undefined;
  initPromise = undefined;
}

function requireEngine(): OpLogEngine {
  if (engine === undefined) {
    throw new Error(
      'op-log 引擎尚未初始化。请先 await initOpLog()（应用入口应已完成）。',
    );
  }
  return engine;
}

/** dispatch 后把最新物化状态同步进 store。 */
function syncFromEngine(): void {
  const e = requireEngine();
  useTaskStore.setState({ entities: e.getState() });
}

let idCounter = 0;
function nextEntityId(): string {
  idCounter += 1;
  return `task-${String(Date.now())}-${String(idCounter)}`;
}

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

    const id = nextEntityId();
    // ⚠️ 这里是唯一写入口。没有 set({ entities: ... }) 这种捷径。
    await requireEngine().dispatch({
      entityType: 'TASK',
      entityId: id,
      opType: 'CREATE',
      payload: { title: trimmed, priority: Priority.None, ...over },
    });
    syncFromEngine();
  },

  toggleComplete: async (id) => {
    const task = get().entities.tasks[id];
    if (task === undefined) return;

    // 用 completedAt 的**有无**表示完成态，不另设 completed 布尔 ——
    // 两个字段必然会不一致。
    const completedAt = task.completedAt === undefined ? Date.now() : null;

    await requireEngine().dispatch({
      entityType: 'TASK',
      entityId: id,
      opType: 'UPDATE',
      // null 表示"显式清除该字段"。reducer 会把 undefined 跳过，
      // 所以要用 null 并让 reducer/序列化层处理成删除。
      payload: { completedAt },
    });
    syncFromEngine();
  },

  deleteTask: async (id) => {
    // 软删除（墓碑）。DELETE op 由 reducer 转成 deletedAt。
    // 物理删除会让同步端永远看不到这次删除。
    await requireEngine().dispatch({
      entityType: 'TASK',
      entityId: id,
      opType: 'DELETE',
      payload: {},
    });
    syncFromEngine();
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
