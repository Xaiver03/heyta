/**
 * 任务 store（Web 壳）
 * ======================
 *
 * 这里只做两件事：
 *   1. 把 op-log 引擎的物化状态同步进 zustand（`onEngineChange`）
 *   2. 把界面意图转交给 `@heyta/app-host` 的 `createTaskActions`
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本文件被**改造过**，改的是一处真实的架构违规（AGENTS.md §3.5）：
 *
 * 它原先自己拼 `TASK` 的 op，7 处 `entityType: 'TASK'` 字面量就写在这里。
 * 而 `createTaskActions` **早就存在**、移动端一直在用 ——
 * 也就是说"重复"在文件头被记了一笔之后**还活了很久**，因为当时没有门禁钉住它
 * （现在有了：`pnpm check:layering` 的 `no-op-construction-in-apps`）。
 *
 * 收编时对齐了这些**已经漂移**的地方：
 *
 * | 行为 | 旧（自己拼） | 新（app-host 单一实现） |
 * |---|---|---|
 * | 新任务 id | `task-${Date.now()}-${counter}`（**每刷新页面计数器归零**）| `newTaskId()`（带 Hermes 回退）|
 * | 空标题 | 静默 return | 动作层**抛错**；"按键时空回车什么都不做"由界面判断 |
 * | 任务不存在时 `toggleComplete` | 静默 return | **抛错**（见下）|
 *
 * 关于最后一条：静默 return 会掩盖"界面上摆着一个已经被删掉的任务"这类真问题，
 * 让它在用户点下去之后**什么都不发生、也不报错**。方向判断（完成 → 取消完成）
 * 现在由动作层负责，这一层连读都不用读，也就没有理由再吞掉错误。
 * ─────────────────────────────────────────────────────────────────────────
 */

import { create } from 'zustand';

import { Priority, Quadrant, bucketByQuadrant, type QuadrantDropPlan, type Task } from '@heyta/domain';
import { emptyState, type MaterializedState } from '@heyta/op-log';
import {
  createAiFeedbackActions,
  createPreferenceCorrectionActions,
  createTaskActions,
  type ActionContext,
  type AiFeedbackInput,
  type NewTaskFields,
} from '@heyta/app-host';

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

  addTask: (title: string, over?: NewTaskFields) => Promise<void>;
  toggleComplete: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  setPriority: (id: string, priority: Priority) => Promise<void>;
  setImportant: (id: string, important: boolean) => Promise<void>;
  /**
   * 一次拖放 = 一条 op。计划来自领域层的 `planQuadrantDrop`。
   * 不要拆成 `setImportant` + `setDueDate` 两次 —— 那会写出两条 op。
   */
  setQuadrantDrop: (id: string, plan: QuadrantDropPlan) => Promise<void>;
  setDueDate: (id: string, dueDate: number | undefined) => Promise<void>;
  /** 写备注。AI 拆解出的清单就是经这里落到 `Task.note` 的。 */
  setNote: (id: string, note: string | undefined) => Promise<void>;
  moveToProject: (id: string, projectId: string | undefined) => Promise<void>;
  /**
   * 覆盖式设置任务的标签集合（**一次调用 = 一条 op**）。
   *
   * ⚠️ 传的是**整组**，不是"加一个" —— 契约见
   * `packages/app-host/src/actions.ts` 的 `TaskActions.setTags`。
   * 算出"用户想要的那一组"是界面的事。
   */
  setTags: (id: string, tagIds: string[]) => Promise<void>;
  /**
   * 记录用户对一次 AI 建议的处置（采用 / 改后采用 / 拒绝）。
   *
   * 🔴 走 op-log，因此**跨设备同步** —— 换台设备 AI 不必重新学一遍。
   * 只记计数与枚举，不记内容（见 `AiFeedback`）。
   */
  recordAiFeedback: (input: AiFeedbackInput) => Promise<void>;
  /**
   * 忘掉一条偏好（用户纠正）。写 op-log，因此跨设备同步。
   *
   * 🔴 必须持久化：不持久化的话每次打开设置都要再删一遍，
   * 而"删了又回来"会让整个记忆层失去可信度。
   */
  suppressPreference: (preferenceId: string) => Promise<void>;
  /** 撤销一次「忘掉」。 */
  restorePreference: (correctionId: string) => Promise<void>;
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

/**
 * 动作层的宿主上下文。
 *
 * 与专注 store 用的是同一个形状 —— 两个 store 各写一份 `{dispatch, getState}`
 * 是可以接受的，因为它只是**两个函数引用**，不含任何判断；
 * 一旦它开始包含判断（比如"离线时排队"），就该抽走。
 */
const actionContext: ActionContext = {
  dispatch: dispatchIntent,
  getState: currentState,
};

const taskActions = createTaskActions(actionContext);
/**
 * 反馈动作。**与任务动作分开**：它写的不是用户内容，而是"用户怎么用 AI"。
 * 混在一起会让"任务写入"这个语义变得不清晰。
 */
const aiFeedbackActions = createAiFeedbackActions(actionContext);
const correctionActions = createPreferenceCorrectionActions(actionContext);

/** 引擎状态变化 → 同步进 store。 */
onEngineChange(() => {
  useTaskStore.setState({ entities: currentState() });
});

export const useTaskStore = create<TaskState>((set) => ({
  entities: emptyState(),
  filter: { kind: 'all' },
  now: Date.now(),
  ready: false,

  addTask: async (title, over) => {
    // ⚠️ 这条判断是**交互**决策（用户按了空回车），不是数据决策 ——
    // 所以它留在这里，而动作层对空标题抛错（见 `TaskActions.create` 的注释）。
    if (title.trim() === '') return;

    // ⚠️ 唯一写入口（D4）。没有 `set({ entities: ... })` 这种捷径 ——
    // 现在连"自己拼 op"这条捷径也没有了。
    await taskActions.create(title, over);
  },

  toggleComplete: async (id) => {
    // 方向（完成 ↔ 取消完成）由动作层决定，这一层不读状态、也不吞错。
    await taskActions.toggleCompleted(id);
  },

  deleteTask: async (id) => {
    // 软删除（墓碑）。`DEL` op 由 reducer 转成 `deletedAt` ——
    // 物理删除会让同步端永远看不到这次删除。
    await taskActions.remove(id);
  },

  setPriority: async (id, priority) => {
    await taskActions.setPriority(id, priority);
  },

  setImportant: async (id, important) => {
    // 四象限的"重要"维度。四象限矩阵的拖拽会改这个 + dueDate。
    await taskActions.setImportant(id, important);
  },

  setQuadrantDrop: async (id, plan) => {
    // 一次拖放 = 一条 op。投放计划由领域层的 `planQuadrantDrop` 算出来
    // （4 象限 × 3 种截止时间状态的穷举测试在 packages/domain）。
    // 这里**只写一次**，不拆成 setImportant + setDueDate 两次 ——
    // 那会产生两条 op，且中间态"重要已改、期限还没改"是可见的。
    await taskActions.setQuadrantDrop(id, plan);
  },

  setDueDate: async (id, dueDate) => {
    // `undefined` → 动作层写成 `null`。null 表示"清除截止时间"，
    // 能穿过 JSON；undefined 会在 `JSON.stringify` 时被丢掉，
    // 于是"清除"在另一端静默失效。
    await taskActions.setDueDate(id, dueDate);
  },

  recordAiFeedback: async (input) => {
    await aiFeedbackActions.record(input);
  },
  suppressPreference: async (preferenceId) => {
    await correctionActions.suppress(preferenceId);
  },
  restorePreference: async (correctionId) => {
    await correctionActions.restore(correctionId);
  },
  setNote: async (id, note) => {
    await taskActions.setNote(id, note);
  },

  moveToProject: async (id, projectId) => {
    await taskActions.moveToProject(id, projectId);
  },

  setTags: async (id, tagIds) => {
    await taskActions.setTags(id, tagIds);
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