/**
 * 任务动态的宿主侧读路径（纯读，零写）
 * ====================================
 *
 * 判据全在 `@heyta/domain` 的 `projectTaskActivity`（那里是纯函数、有穷举测）。
 * 这一层只做两件事：取 op、问覆盖范围。
 *
 * 🔴 本文件**不发 op、不触发副作用**（AGENTS.md §3.4）。它连 `ActionContext` 都不吃 ——
 * 只吃 `TaskActivityOpSource` 那一小块引擎接口：一是让测试能用一个假源跑真断言，
 * 二是避免为了读一件事去依赖引擎的内部状态形状。
 *
 * ⚠️ `task.createdAt` 由**调用方**交进来而不是这里去查状态：宿主手上本来就有那条任务
 * （它来自 `listTasks()` / `taskOf()`），在这里再读一次等于给同一件事开第二个来源。
 */

import {
  projectTaskActivity,
  taskActivityCoverage,
  type TaskActivityEvent,
  type TaskActivityOp,
} from '@heyta/domain';
import type { EntityType } from '@heyta/shared-schema';
import type { Operation } from '@heyta/sync-core';

/** 本层需要的引擎那一小块。刻意窄。 */
export interface TaskActivityOpSource {
  getOpsForEntity(entityType: EntityType, entityId: string): Promise<Operation<string>[]>;
  getClientId(): string;
}

export type TaskActivityCoverage = ReturnType<typeof taskActivityCoverage>;

export interface TaskActivityRead {
  /** 最近在前。 */
  readonly events: readonly TaskActivityEvent[];
  /**
   * 这条流水**能说到什么程度**。
   *
   * 🔴 `'device-local-only'` 时宿主只许说"这台设备记录到的变更"，
   *   说成"完整历史"是不实陈述 —— 新设备的本地日志可能只有快照之后的增量。
   *   实测依据见 `packages/domain/src/task-activity.ts` 文件头。
   */
  readonly coverage: TaskActivityCoverage;
}

export interface ReadTaskActivityOptions {
  /** 默认 `true`。关掉后事件里不带旧值/新值（隐私敏感场景）。 */
  readonly includeValues?: boolean;
  /** 从最近往回数多少条。默认 50。 */
  readonly limit?: number;
}

export async function readTaskActivity(
  source: TaskActivityOpSource,
  task: { id: string; createdAt: number },
  options: ReadTaskActivityOptions = {},
): Promise<TaskActivityRead> {
  const rows = await source.getOpsForEntity('TASK', task.id);
  const ops: TaskActivityOp[] = rows.map((op) => ({
    id: op.id,
    opType: op.opType,
    timestamp: op.timestamp,
    clientId: op.clientId,
    entityId: op.entityId,
    entityIds: op.entityIds,
    payload: op.payload,
  }));
  const events = projectTaskActivity(ops, task.id, {
    localClientId: source.getClientId(),
    includeValues: options.includeValues,
    limit: options.limit,
  });
  return {
    events,
    /**
     * 🔴 覆盖范围问的是**最早那条**，而 `events` 是"最近在前" ⇒ 最早在**末尾**。
     * 这里写成 `events[0]` 会问成"最新那条"，于是几乎每台设备都被判成 `complete` ——
     * 一个不会报错的不实陈述。
     */
    coverage: taskActivityCoverage({
      taskCreatedAt: task.createdAt,
      earliestEventAt: events.length === 0 ? undefined : events[events.length - 1]?.at,
    }),
  };
}
