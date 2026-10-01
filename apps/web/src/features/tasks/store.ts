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

import {
  Priority,
  Quadrant,
  bucketByQuadrant,
  filterTasks,
  type QuadrantDropPlan,
  type Task,
  type TaskFilter,
} from '@heyta/domain';
import { emptyState, type MaterializedState } from '@heyta/op-log';
import {
  createAiFeedbackActions,
  createLocalApiHost,
  createPreferenceCorrectionActions,
  createTaskActions,
  type ActionContext,
  type AiFeedbackInput,
  type NewTaskFields,
  type WidgetDrainTasks,
} from '@heyta/app-host';
import type { LocalApiHost } from '@heyta/local-api';

import {
  __resetOpLogForTests as resetEngine,
  currentState,
  dispatchIntent,
  initOpLog as initShared,
  onEngineChange,
} from '../../lib/oplog.js';

/**
 * 🔴 **类型与判据都来自 `@heyta/domain`，这里只做转发。**
 *
 * 它们原先就定义在这个文件里 —— 那是 M1 违规："哪些任务算今天的"
 * 是产品语义，而 `apps/web` 是壳。移动端拿不到，于是自己又写了一份分组
 * （见 `packages/domain/src/task-filter.ts` 文件头）。
 */
export type { TaskFilter } from '@heyta/domain';

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
  /**
   * 从回收站恢复。**走 op-log**（一条 `UPD { deletedAt: null }`），
   * 所以另一台设备回放后也会看到条目回来 —— 不是只改本地 UI 状态。
   */
  restoreTask: (id: string) => Promise<void>;
  /** 彻底删除（不可逆）。用户已二次确认。 */
  purgeTask: (id: string) => Promise<void>;
  setPriority: (id: string, priority: Priority) => Promise<void>;
  setImportant: (id: string, important: boolean) => Promise<void>;
  /**
   * 一次拖放 = 一条 op。计划来自领域层的 `planQuadrantDrop`。
   * 不要拆成 `setImportant` + `setDueDate` 两次 —— 那会写出两条 op。
   */
  setQuadrantDrop: (id: string, plan: QuadrantDropPlan) => Promise<void>;
  setDueDate: (id: string, dueDate: number | undefined) => Promise<void>;
  /**
   * 顺延：把**逾期**任务推到今天、保留时刻（滴答分组「顺延」同款）。
   *
   * 🔴 语义（推到哪、保不保留时刻）在 `app-host` 的 `postponeToToday`，
   * 界面只说"用户要顺延这一条"。幂等边界（已完成/无日期/不逾期不写 op）
   * 也由动作层钉死 —— 界面按钮会过时，动作层不会。
   */
  postponeToToday: (id: string) => Promise<void>;
  /** 写备注。AI 拆解出的清单就是经这里落到 `Task.note` 的。 */
  setNote: (id: string, note: string | undefined) => Promise<void>;
  moveToProject: (id: string, projectId: string | undefined) => Promise<void>;
  /**
   * 改任务的父（子任务）。
   *
   * `undefined` = 提为顶级。
   * 🔴 **失败会 `throw`**（环 / 超深 / 超子数 / 找不到）—— 界面要用
   * `@heyta/ui` 的 `subtaskRejectionMessageKey` 把它翻成人话，**不许吞掉**。
   */
  setParent: (id: string, parentId: string | undefined) => Promise<void>;
  /**
   * 覆盖式设置任务的标签集合（**一次调用 = 一条 op**）。
   *
   * ⚠️ 传的是**整组**，不是"加一个" —— 契约见
   * `packages/app-host/src/actions.ts` 的 `TaskActions.setTags`。
   * 算出"用户想要的那一组"是界面的事。
   */
  setTags: (id: string, tagIds: string[]) => Promise<void>;
  /**
   * 设置重复规则（RFC 5545 RRULE 串）；传 `undefined` 取消重复。
   *
   * 🔴 **规则串由调用方从 `Recurrence.*` / `repeatPresetRule()` 构造，不要手拼**
   * （契约见 `packages/app-host/src/actions.ts` 的 `TaskActions.setRepeat`）。
   * 锚点（`repeatDtstart`）由 app-host 钉一次，界面不许自己算。
   */
  setRepeat: (id: string, rule: string | undefined) => Promise<void>;
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
 * 小组件 drain 需要的那两个动作。
 *
 * 🔴 **在这里导出、不在 `pwa/` 里重新 `createTaskActions`。**
 * 再建一份的话，`findTask` 读的会是**当时**的 `currentState()`，
 * 而 `setCompleted` 走的是**同一个** dispatch —— 看起来一样，
 * 但第二份 `taskActions` 会在未来"动作层开始持有状态"时静默分叉。
 * 类型也**故意收窄**成 `WidgetDrainTasks`（见 app-host 的注释）：
 * 以后 `TaskActions` 长大时，小组件这条路的权限不会被顺手放宽。
 */
export const widgetDrainTasks: WidgetDrainTasks = {
  findTask: (entityId) => taskActions.findTask(entityId),
  setCompleted: (entityId, completed) => taskActions.setCompleted(entityId, completed),
};

/**
 * 内置 AI 调工具用的**进程内**宿主。
 *
 * 🔴 复用 `createLocalApiHost()` —— 与 MCP 侧是**同一份**工具执行语义
 * （受保护条目投影、参数校验、`submit` → `dispatch`）。这里不重写任何一条：
 * 重写就会出现"同一个 `list_tasks` 在 AI 路径与 MCP 路径返回不同的东西"。
 *
 * ⚠️ `isReadable: () => true` 是**如实**的：heyta 目前没有"受保护条目"这个产品概念
 * （ADR-0011 §6.1 与 `ai-open-decisions.md` 决策 1：先不做）。
 * 将来接解密失败那条路径时，只需要改这一处。
 */
export function createAiToolHost(): LocalApiHost {
  return createLocalApiHost(actionContext, taskActions, { isReadable: () => true });
}
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

  restoreTask: async (id) => {
    // 恢复同样是一次 op（`UPD { deletedAt: null }`）。这里**不碰 entities** ——
    // 绕开 op-log 直接改状态就同步不出去，也会在下次同步时被墓碑覆盖回来。
    await taskActions.restore(id);
  },

  purgeTask: async (id) => {
    // 写 `purgedAt` 标记（可加性字段，不 bump schema）。墓碑保留 ——
    // 清掉它会让离线端把这条旧数据又同步回来。
    await taskActions.purge(id);
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
  postponeToToday: async (id) => {
    await taskActions.postponeToToday(id);
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

  setParent: async (id, parentId) => {
    // 🔴 **不 catch、不吞**：拒绝原因要一路冒到界面去说清楚。
    // 领域层把"为什么不行"做成了封闭集合（cycle / depth / …），
    // 在这里降级成静默空操作就等于把它扔了 —— 而症状是
    // "用户以为移好了，树没变"，本仓吃过这一类。
    await taskActions.setParent(id, parentId);
  },

  setTags: async (id, tagIds) => {
    await taskActions.setTags(id, tagIds);
  },

  setRepeat: async (id, rule) => {
    await taskActions.setRepeat(id, rule);
  },

  setFilter: (filter) => set({ filter }),
  refreshNow: () => set({ now: Date.now() }),
}));

// ─────────────────────────────────────────────────────────────
// 选择器（纯读，不改状态）
// ─────────────────────────────────────────────────────────────

export function selectVisibleTasks(state: TaskState): Task[] {
  /**
   * 🔴 **一行委派，不再自己 switch。**
   *
   * 这里原先是一段 `switch (filter.kind)`，与移动端 `TasksScreen` 的分组
   * 是**两份互不校验的实现**。判据现在只有一份（`@heyta/domain`），
   * 加一个筛选分支（例如 `tag`）时，四端同时拿到它。
   */
  const filtered = filterTasks(Object.values(state.entities.tasks), state.filter, {
    now: state.now,
  });
  /**
   * 🔴 2026-10-01：这里**不再"先筛再搜"** —— 列表只按 `filter` 出，
   * 搜索搬到了跨实体的浮层（`SearchPanel`，宿主用 `searchTasks` 扫**全部**任务）。
   *
   * 为什么可以搬走：浮层是"我记得有个东西，去找它"，它不该受"当前正在看哪个视图"
   * 约束 —— 一个 Spotlight 不会只在你当前打开的文件夹里找。
   * 顶栏那个内联输入框是另一件事（当前列表收窄），产品负责人拍板删掉，
   * 一个应用只留**一个**搜索入口。
   */
  return filtered;
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

/**
 * 回收站列表：**已软删除且未彻底删除**的任务，最近删除的在前（同刻按 id）。
 *
 * ⚠️ 判据与顺序必须与 `@heyta/app-host` 的 `TaskActions.listTrashed()` 一致 ——
 * 那是同一份产品语义的规范定义。selector 在这里重写一遍，是因为它只能读
 * **传入的 state**：去读引擎单例会破坏 zustand 的引用稳定性约定
 * （见 `App.tsx` 里 `useShallow` 那段记录的真实崩溃）。
 */
export function selectTrashedTasks(state: TaskState): Task[] {
  return Object.values(state.entities.tasks)
    .filter((t) => t.deletedAt !== undefined && t.purgedAt === undefined)
    .sort((a, b) => {
      const ad = a.deletedAt ?? 0;
      const bd = b.deletedAt ?? 0;
      if (ad !== bd) return bd - ad;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}