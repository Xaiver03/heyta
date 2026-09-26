/**
 * 专注动作（宿主无关）
 * =====================
 *
 * 与 `actions.ts`（任务动作）同一个理由：**op 的构造只能有一份**。
 *
 * 专注记录看起来只是"写一条日志"，但它同样有三个必须全端一致的语义决定：
 *
 *   1. **一次专注 = 一条 `FOCUS_SESSION` op。** 不是"开始写一条、结束再改一条" ——
 *      那样中途杀进程会留下一条永远不结束的记录，而"哪些记录算完成"就没人说得清。
 *   2. **`completed` 必须有值。** 自然完成与中途放弃是**两种不同的东西**，
 *      统计时要分开。缺省它会让"完成了 3 个"把放弃的也算进去。
 *   3. **可清除字段写 `null`，不写 `undefined`**（同 `actions.ts` 文件头第 2 条）：
 *      `undefined` 会被 `JSON.stringify` 丢掉，于是载荷里那个键根本不存在，
 *      对端既不会设置也不会清除。这里 `taskId` 就是这种字段 ——
 *      不关联任务的专注，和"关联任务被取消"必须能被区分。
 *
 * 🔴 之所以放在 `packages/app-host` 而不是移动端的 FocusScreen 里：
 * 见 AGENTS.md §3.5 —— 判断方法是"这段代码里有没有一行在决定业务上该怎么做"。
 * "一次专注该记哪些字段"显然是。
 */

import type { FocusSession } from '@heyta/domain';
import type { EntityType } from '@heyta/shared-schema';
import { OpType } from '@heyta/sync-core';

import type { ActionContext } from './actions.js';
import { randomId } from './ids.js';

export interface FocusActionsOptions {
  /** 注入 id 生成器（测试用）。默认带 RN 安全回退的 `randomId()`。 */
  newFocusId?: () => string;
}

export interface FocusActions {
  /**
   * 记录一次已结束的专注轮（完成或中止）。
   *
   * 只接受**已经结束**的轮次：状态机（`packages/domain` 的 `advance` / `abort`）
   * 负责在结束时产出这个对象。计时中的状态**不落盘** ——
   * 见文件头第 1 条，避免留下永远不结束的记录。
   *
   * 返回新记录的 entityId。
   */
  log(session: FocusSession): Promise<string>;
  /**
   * 未删除的专注记录，按创建时间排序（同刻按 id 字典序）。
   *
   * 顺序与 `listTasks()` 用同一条规则：**必须在所有端一致**，
   * 否则同一份数据在两台设备上显示不同顺序。
   */
  listSessions(): FocusSession[];
}

/** 合法的专注类型。与 `FocusSessionKind` 同集合 —— 两边一起改。 */
const KINDS: ReadonlySet<string> = new Set(['work', 'shortBreak', 'longBreak']);

export function createFocusActions(
  ctx: ActionContext,
  options: FocusActionsOptions = {},
): FocusActions {
  const makeId = options.newFocusId ?? ((): string => `focus-${randomId()}`);

  const isDeleted = (session: FocusSession): boolean => session.deletedAt !== undefined;

  return {
    async log(session) {
      if (!KINDS.has(session.kind)) {
        throw new Error(`未知的专注类型：${String(session.kind)}`);
      }
      // 🔴 时长必须是**正数**。0 或负数记录下来会污染统计，
      // 而且在界面上表现为"今天专注了 0 分钟"——看起来像功能坏了。
      if (!Number.isFinite(session.plannedMs) || session.plannedMs <= 0) {
        throw new Error(`专注时长必须为正数，收到 ${String(session.plannedMs)}`);
      }
      if (!Number.isFinite(session.createdAt) || session.createdAt <= 0) {
        throw new Error(`专注记录必须有 createdAt，收到 ${String(session.createdAt)}`);
      }

      const entityId = makeId();
      await ctx.dispatch({
        entityType: 'FOCUS_SESSION' as EntityType,
        entityId,
        opType: OpType.Create,
        payload: {
          kind: session.kind,
          // null 而不是省略 —— 见文件头第 3 条。
          taskId: session.taskId ?? null,
          plannedMs: session.plannedMs,
          // 负数夹到 0：状态机已经 `Math.max(0, ...)` 过一次，
          // 这里再兜一次是因为别的写入方（将来的手表端？）不一定照做。
          actualMs: session.actualMs === undefined ? null : Math.max(0, session.actualMs),
          // 必须有值 —— 见文件头第 2 条。缺省视为"未完成"而不是"完成"。
          completed: session.completed ?? false,
          startedAt: session.startedAt ?? null,
          endedAt: session.endedAt ?? null,
        },
      });
      return entityId;
    },

    listSessions(): FocusSession[] {
      return Object.values(ctx.getState().focusSessions)
        .filter((session) => !isDeleted(session))
        .sort((a, b) => {
          if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
          // 与 listTasks 同样的确定性决胜 —— 跨端顺序必须一致。
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
    },
  };
}
