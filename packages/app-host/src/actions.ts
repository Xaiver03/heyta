/**
 * 任务动作（宿主无关）
 * =====================
 *
 * 🔴 这个文件修的是一个**真实的架构违规**，不是"顺手整理"。
 *
 * ADR-0003 §2.1 说业务逻辑必须在 `packages/` 里。但"新建任务"到底是哪些字段、
 * "完成"是写 `completedAt` 还是 `completed`、软删除该发 `DEL` 还是改标志位 ——
 * 这些**全是产品语义**，而它们原本在应用壳里各写了一份：
 *
 *   apps/web/src/features/tasks/store.ts   7 处 op 构造
 *   apps/node-host/src/host.ts             3 处 op 构造
 *
 * 两边的行为**已经不一致了**（例如 entityId 的生成方式），而且移动端落地
 * 就会变成第三份。分歧本身不一定立刻出 bug，但它保证了**同一个操作在不同
 * 平台上产生不同的 op** —— 而这正是同步系统里最难查的一类问题：
 * 两台设备看起来在做同一件事，op 日志里却不是同一种东西。
 *
 * 所以：**op 的构造只有这里一份。** 宿主的 UI 层只负责收集用户输入并调用它。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 两个不能改的细节（都是踩过的坑，不是风格偏好）：
 *
 * 1. **"完成"用 `completedAt` 的有无表示，不另设 `completed` 布尔。**
 *    两个字段必然会在某个路径上不一致，而那时没有"对的"那个。
 *
 * 2. **清除类字段要写 `null`，不能写 `undefined`。**
 *    `undefined` 会被 `JSON.stringify` 丢掉，于是载荷里那个键**根本不存在**，
 *    对端收到后既不会设置也不会清除 —— 「取消完成」/「清除截止时间」在另一端
 *    **静默失效**（本地看起来是对的，因为本地状态还留着旧值）。
 *    reducer 负责把 `null` 变成真正的字段删除。
 * ─────────────────────────────────────────────────────────────────────────
 */

import { Priority, type Task } from '@heyta/domain';
import type { MaterializedState, OpIntent } from '@heyta/op-log';
import type { EntityType } from '@heyta/shared-schema';
import { OpType } from '@heyta/sync-core';

import { newTaskId } from './ids.js';

/**
 * 动作层需要引擎能力的最小面。
 *
 * 刻意**不用**具体的 `OpLogEngine` 类型：动作层只该知道"我能派发 intent、
 * 我能读状态"。收窄接口让这个文件能在不搭起整个引擎的情况下被测试，
 * 也让它不可能不小心绕开 op-log 去改状态（它压根没有 `setState`）。
 */
export interface ActionContext {
  dispatch(intent: OpIntent): Promise<unknown>;
  getState(): MaterializedState;
}

/** 建任务时可覆盖的字段。与 `addTask` 的 `over` 参数同义。 */
export interface NewTaskFields {
  priority?: Priority;
  dueDate?: number;
  projectId?: string;
  important?: boolean;
  notes?: string;
}

export interface TaskActionsOptions {
  /**
   * 时间源。默认 `Date.now`。
   *
   * 可注入的理由与 `OpLogEngine.now` 相同：`completedAt` 是**写进载荷的数据**，
   * 不是日志元数据；若它来自真实时钟而引擎用注入时钟，测试里两者会不一致，
   * 于是"完成时间"这类断言只能靠容忍误差 —— 那等于没断言。
   */
  now?: () => number;
  /**
   * 实体 id 生成器。默认 `newTaskId()`。
   *
   * 可注入的理由和 `now` 一样，但更硬：**不注入就没法稳定地断言顺序**。
   * 列表按 (createdAt, id) 排序，而 id 是随机的 —— 三条随机 id 恰好已经是
   * 升序的概率是 1/6，于是"排序真的生效了吗"这类断言会**随机变红**。
   * 一个随机失败的测试比没有测试更糟：它教人忽略红色。
   */
  newTaskId?: () => string;
}

export interface TaskActions {
  /**
   * 新建任务。返回新实体 id。
   *
   * 空标题**抛错**而不静默忽略：这个 API 的调用方是程序（测试、CLI、脚本），
   * 静默返回会让调用方以为建成功了。UI 层要"用户按了空回车就什么都不做"，
   * 应当自己在调用前判断 —— 那是**交互**决策，不是**数据**决策。
   */
  create(title: string, over?: NewTaskFields): Promise<string>;
  /** 改标题。 */
  rename(entityId: string, title: string): Promise<void>;
  /** 显式设置完成态（幂等，不像 `toggle` 依赖当前状态）。 */
  setCompleted(entityId: string, completed: boolean): Promise<void>;
  /** 在完成/未完成之间切换。 */
  toggleCompleted(entityId: string): Promise<void>;
  /** 软删除（发 `DEL` op，由 reducer 转成墓碑 `deletedAt`）。 */
  remove(entityId: string): Promise<void>;
  setPriority(entityId: string, priority: Priority): Promise<void>;
  /** 四象限的"重要"维度。 */
  setImportant(entityId: string, important: boolean): Promise<void>;
  /** 传 `undefined` 表示清除截止时间（会写成 `null`，见文件头第 2 条）。 */
  setDueDate(entityId: string, dueDate: number | undefined): Promise<void>;
  /** 传 `undefined` 表示移出项目（会写成 `null`）。 */
  moveToProject(entityId: string, projectId: string | undefined): Promise<void>;

  /** 未删除的任务，按创建时间排序（同刻按 id 字典序，保证跨端顺序一致）。 */
  listTasks(): Task[];
  /** 取单个未删除任务；不存在或已删除返回 `undefined`。 */
  findTask(entityId: string): Task | undefined;
}

export function createTaskActions(
  ctx: ActionContext,
  options: TaskActionsOptions = {},
): TaskActions {
  const now = options.now ?? Date.now;
  const makeId = options.newTaskId ?? newTaskId;

  const taskOf = (entityId: string): Task | undefined => {
    const task = ctx.getState().tasks[entityId];
    if (task === undefined || task.deletedAt !== undefined) return undefined;
    return task;
  };

  const update = async (entityId: string, payload: Record<string, unknown>): Promise<void> => {
    await ctx.dispatch({
      entityType: 'TASK' as EntityType,
      entityId,
      opType: OpType.Update,
      payload,
    });
  };

  return {
    async create(title, over = {}) {
      const trimmed = title.trim();
      if (trimmed === '') throw new Error('任务标题不能为空');

      const entityId = makeId();
      await ctx.dispatch({
        entityType: 'TASK' as EntityType,
        entityId,
        opType: OpType.Create,
        payload: { title: trimmed, priority: Priority.None, ...over },
      });
      return entityId;
    },

    async rename(entityId, title) {
      const trimmed = title.trim();
      if (trimmed === '') throw new Error('任务标题不能为空');
      if (taskOf(entityId) === undefined) throw new Error(`找不到任务「${entityId}」`);
      await update(entityId, { title: trimmed });
    },

    async setCompleted(entityId, completed) {
      if (taskOf(entityId) === undefined) throw new Error(`找不到任务「${entityId}」`);
      // null 而不是 undefined —— 见文件头第 2 条。
      await update(entityId, { completedAt: completed ? now() : null });
    },

    async toggleCompleted(entityId) {
      const task = taskOf(entityId);
      if (task === undefined) throw new Error(`找不到任务「${entityId}」`);
      await update(entityId, {
        completedAt: task.completedAt === undefined ? now() : null,
      });
    },

    async remove(entityId) {
      // 软删除（墓碑）。物理删除会让同步端永远看不到这次删除。
      await ctx.dispatch({
        entityType: 'TASK' as EntityType,
        entityId,
        opType: OpType.Delete,
        payload: {},
      });
    },

    setPriority(entityId, priority) {
      return update(entityId, { priority });
    },

    setImportant(entityId, important) {
      return update(entityId, { important });
    },

    setDueDate(entityId, dueDate) {
      // undefined → null：null 能穿过 JSON 表达"清除"。
      return update(entityId, { dueDate: dueDate ?? null });
    },

    moveToProject(entityId, projectId) {
      return update(entityId, { projectId: projectId ?? null });
    },

    listTasks(): Task[] {
      return Object.values(ctx.getState().tasks)
        .filter((task) => task.deletedAt === undefined)
        .sort((a, b) => {
          if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
          // 顺序必须在所有端一致 —— 否则同一份数据在两台设备上显示不同顺序。
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
    },

    findTask: taskOf,
  };
}
