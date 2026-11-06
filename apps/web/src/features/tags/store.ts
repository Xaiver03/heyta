/**
 * 标签管理（R8）—— 合并 / 批量 / 改名的**唯一写入口**
 * =====================================================
 *
 * 这个文件只做两件事：
 *   1. 把 `@heyta/app-host` 的 `createTagManagementActions` 接到本端的 op-log 上下文；
 *   2. 把"改名"复用 `createProjectActions().renameTag` —— **不在这里再实现一份**。
 *
 * 🔴 **为什么合并走 `app-host` 而不是在这里拼 op**
 * `apps/*` 不许有任何一行决定"业务上该怎么做"（AGENTS §3.5）：合并写哪几个字段、
 * 什么情况拒绝、链怎么解析，全是产品语义。这里是壳，只转发。
 *
 * 🔴 **合并 = 一条 op**。它写的是**被合并掉的那条标签**（`{ deletedAt, mergedInto }`），
 * **不重写任何任务的 `tagIds`** —— 理由与代价写在
 * `packages/app-host/src/tag-actions.ts` 的文件头，以及
 * `packages/domain/src/tags.ts`（读侧解析的**唯一入口**）。
 * 一次合并如果写成 N 条任务 op，崩在第 k 条就会留下"一半任务换过去了、原标签还没删"。
 */

import { createProjectActions, createTagManagementActions, type ActionContext } from '@heyta/app-host';

import { currentState, dispatchChecked, dispatchIntent } from '../../lib/oplog.js';

const actionContext: ActionContext = {
  dispatch: dispatchIntent,
  dispatchChecked,
  getState: currentState,
};

const tagActions = createTagManagementActions(actionContext);
const projectActions = createProjectActions(actionContext);

export interface TagManagerApi {
  /** 改名：一条 op（载荷只有 `name`）。引用它的任务**一个都不碰**（它们存的是 id）。 */
  rename(id: string, name: string): Promise<void>;
  /** 合并：把 `sourceId` 上的一切归到 `targetId`，并删掉 `sourceId`。**一条 op**。 */
  merge(sourceId: string, targetId: string): Promise<void>;
  /** 多选合并：每个源各一条 op（载荷里的 `mergedInto` 各不相同，不能伪装成一条批量 op）。 */
  mergeMany(sourceIds: readonly string[], targetId: string): Promise<void>;
  /** 批量删除：**一条 `DEL` op 带 `entityIds`**（同类型同载荷，本仓既有的批量形状）。 */
  removeMany(ids: readonly string[]): Promise<void>;
  /** 合并前的影响面（确认框里的人话靠它，别在界面里现算一遍）。 */
  mergeImpact(sourceId: string, targetId: string): ReturnType<typeof tagActions.mergeImpact>;
  /** 一条标签上有效挂着多少条任务（含已完成、含别名指过来的）。 */
  usageCount(tagId: string): number;
}

export const tagManager: TagManagerApi = {
  rename: (id, name) => projectActions.renameTag(id, name),
  merge: (sourceId, targetId) => tagActions.merge(sourceId, targetId),
  mergeMany: (sourceIds, targetId) => tagActions.mergeMany(sourceIds, targetId),
  removeMany: (ids) => tagActions.removeMany(ids),
  mergeImpact: (sourceId, targetId) => tagActions.mergeImpact(sourceId, targetId),
  usageCount: (tagId) => tagActions.usageCount(tagId),
};
