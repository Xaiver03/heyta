/**
 * 标签管理动作（合并 / 批量 / 改名）
 * ===================================
 *
 * 出处：`docs/plans/ticktick-parity-prd-2026-11.md` R8（P0 缺口：web 只有侧栏逐行改名）。
 * 本文件只放**这次新加的那一部分**：`merge`（合并）与 `removeMany`（批量删）。
 * **改名不在这里** —— 它是 `createProjectActions().renameTag` 的既有动作，
 * 再写一遍就是第二份裁决（`AGENTS.md` §3.5）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 合并为什么是**一条 op**，以及那条 op 长什么样
 *
 * 产品语义：**把 A 上所有任务换成 B，然后删掉 A。**
 *
 * "换成"有两种实现，在 op-log 纪律下不等价：
 *
 * | 做法 | op 条数 | 半截状态 |
 * |---|---|---|
 * | 逐条改写 `task.tagIds` | N 条（N = 挂着 A 的任务数） | 崩在第 k 条 ⇒ 一半换过去了、A 还没删 |
 * | `Tag.mergedInto` + 读侧解析（**本文件**） | **1 条** | 没有 |
 *
 * 跨实体"一条 op"在本仓只有两条既有路径：
 *   ① `entityIds` 同类型批量（`packages/shared-schema/src/task-batch-contract.ts:82-93`：
 *      一个 `payload` 扇给所有成员 ⇒ **每实体载荷不同时用不了**）；
 *   ② `payload marker + reducer 扇出`（`heytaTaskRepeatCompletion` 那种）——
 *      要改 `packages/shared-schema` 与 `packages/op-log/src/state.ts`，两处都是不可逆层。
 * 所以走 ①的等价形：**只动标签这一行**，载荷 `{ deletedAt, mergedInto }`。
 *
 * 代价（永久、已登记）：`task.tagIds` 里仍然留着被合并掉的 id。
 * ⇒ "这条任务有哪些标签"**只有** `@heyta/domain` 的 `resolveTagIds()` / `resolveTags()`
 * 能回答。任何地方自己写 `tagIds.includes(...)` 都会漏掉别名，而漏掉的表现
 * **不是报错**，是"合并之后我的任务不见了"。
 *
 * 那为什么不写成一条 `DEL`？因为 `DEL` 的载荷只有 `{}` —— 它表达不了
 * "并进了谁"。要表达就必须同一个 op 里带 `mergedInto`，而 `DEL` 的逆
 *（`UPD { deletedAt: null }`，见 `history.ts` 的反向规则表）也清不掉它。
 * 写成 `UPD { deletedAt, mergedInto }` 之后：**一条 op**、**一条 op 就能撤销**
 *（逆 = 逐键写回旧值），且两台设备并发合并时冲突面只有这一行（LWW）。
 */

import type { Tag } from '@heyta/domain';
import { resolveTagId, tagUsageCount } from '@heyta/domain';
import type { MaterializedState, OpIntent } from '@heyta/op-log';
import type { EntityType } from '@heyta/shared-schema';
import { OpType } from '@heyta/sync-core';

import type { ActionContext } from './actions.js';

/** 合并前的**影响面**：界面拿它在确认框里说人话（不要自己现算一遍）。 */
export interface TagMergeImpact {
  /** 源标签上**有效挂着**的任务条数（含已完成 —— 它们也会跟着变）。 */
  readonly taskCount: number;
  /** 合并之后会被删掉的那条标签名。 */
  readonly sourceName: string;
  /** 合并目标的名字。 */
  readonly targetName: string;
}

export interface TagManagementActions {
  /**
   * 合并两条标签：`sourceId` 上的任务全部归到 `targetId`，并删掉 `sourceId`。
   *
   * 🔴 **一条 op**（见文件头）。调用方**不许**再自己补一条"把任务 tagIds 改一遍"的
   * 写入 —— 那就是 N 条 op，也正是这条设计要避免的东西。
   *
   * 拒绝（**零 op**）：源/目标不存在或已删、源 = 目标、
   * 源或目标已经在另一条合并链上（`A→B` 之后再 `B→C` 会让"读侧解析"依赖链长，
   * 用户也说不清自己合并了几次 —— 要做就先 `mergedInto` 一条一条来，别叠）。
   */
  merge(sourceId: string, targetId: string): Promise<void>;

  /**
   * 把 `sourceIds` **依次**合并进 `targetId`。
   *
   * ⚠️ 每个源**各一条 op**：它们是**互相独立的意图**（每个源自己的合并历史），
   * 与 `bulkSetCompleted`（同一载荷扇给 N 条）不是同一形状 ——
   * 刻意不伪装成"一条批量 op"，因为载荷里每个源的 `mergedInto` 都不同。
   * 界面上的多次勾选合并因此会写 N 条 op，这个数字写在计划文档里。
   */
  mergeMany(sourceIds: readonly string[], targetId: string): Promise<void>;

  /**
   * 批量删除（真的会从所有任务上消失）。**一条 `DEL` op 带 `entityIds`** ——
   * 同类型同载荷，这是本仓既有的批量形状（`actions.ts` 的 `bulkRemove` 同一个）。
   *
   * ⚠️ 软删除（墓碑）：可恢复。彻底删除是回收站那一档，不在本动作里。
   */
  removeMany(entityIds: readonly string[]): Promise<void>;

  /** 合并前的影响面（确认框用）。源/目标不存在时返回 `undefined`（不抛）。 */
  mergeImpact(sourceId: string, targetId: string): TagMergeImpact | undefined;

  /** 一条标签上**有效**挂着多少条任务（含已完成、含被别名指过来的那些）。 */
  usageCount(tagId: string): number;
}

export interface TagManagementOptions {
  /** 时间源。注入以便测试（与其余动作同一个理由）。 */
  readonly now?: () => number;
}

/**
 * `packages/app-host` 里的**唯一**标签合并实现。
 *
 * 与 `createTaskActions` / `createProjectActions` 同一个分工：动作层只把
 * "一个用户意图"翻成一条 op；判断（能不能合并、影响多少条任务）都在领域层。
 */
export function createTagManagementActions(
  ctx: ActionContext,
  options: TagManagementOptions = {},
): TagManagementActions {
  const now = options.now ?? Date.now;

  const aliveTag = (entityId: string): Tag | undefined => {
    const tag = ctx.getState().tags[entityId];
    if (tag === undefined || tag.deletedAt !== undefined || tag.purgedAt !== undefined) return undefined;
    return tag;
  };

  const dispatch = async (intent: OpIntent): Promise<void> => {
    await ctx.dispatch(intent);
  };

  const mergeOne = async (sourceId: string, targetId: string): Promise<void> => {
    if (sourceId === targetId) throw new Error('不能把一条标签合并进它自己');
    const source = aliveTag(sourceId);
    if (source === undefined) throw new Error(`找不到标签「${sourceId}」`);
    const target = aliveTag(targetId);
    if (target === undefined) throw new Error(`找不到标签「${targetId}」`);
    if (source.mergedInto !== undefined) throw new Error(`标签「${source.name}」已经被合并过，不能再合并`);
    if (target.mergedInto !== undefined) throw new Error(`标签「${target.name}」已经被合并过，不能作为合并目标`);

    // 🔴 一条 op：墓碑 + 去向。两者必须同一条 op ——
    // 只写墓碑就丢掉"并进了谁"（任务上的引用解析不出来，等于删标签而不是合并）；
    // 只写去向就删不掉它（标签列表里会出现两条同义标签）。
    await dispatch({
      entityType: 'TAG' as EntityType,
      entityId: sourceId,
      opType: OpType.Update,
      payload: { deletedAt: now(), mergedInto: targetId },
    });
  };

  return {
    merge: mergeOne,

    async mergeMany(sourceIds, targetId) {
      // 先去重 + 去掉"把目标自己也列进来"（否则第一枪就抛"不能合并进自己"）。
      const unique = [...new Set(sourceIds)].filter((id) => id !== targetId);
      if (unique.length === 0) return;
      // 串行：op-log 引擎的向量时钟按派发序递增，并发派发会让回放顺序不确定。
      for (const id of unique) await mergeOne(id, targetId);
    },

    async removeMany(entityIds) {
      const unique = [...new Set(entityIds)];
      if (unique.length === 0) return;
      for (const id of unique) {
        if (aliveTag(id) === undefined) throw new Error(`找不到标签「${id}」`);
      }
      const [first, ...rest] = unique;
      if (first === undefined) return;
      await dispatch({
        entityType: 'TAG' as EntityType,
        entityId: first,
        ...(rest.length === 0 ? {} : { entityIds: rest }),
        opType: OpType.Delete,
        payload: {},
      });
    },

    mergeImpact(sourceId, targetId) {
      const source = aliveTag(sourceId);
      const target = aliveTag(targetId);
      if (source === undefined || target === undefined) return undefined;
      return {
        taskCount: tagUsageCount(Object.values(ctx.getState().tasks), sourceId, ctx.getState().tags),
        sourceName: source.name,
        targetName: target.name,
      };
    },

    usageCount(tagId) {
      return tagUsageCount(Object.values(ctx.getState().tasks), tagId, ctx.getState().tags);
    },
  };
}

/**
 * 合并目标的**规范形**：如果 `tagId` 已经在一条合并链上，取链条末端。
 *
 * 界面用它把"用户选的那一条"变成"真正该写进 `mergedInto` 的那一条" ——
 * 否则 `A→B` 之后再 `A→C` 会造出一条 `A→C` 而 `B` 静默丢链。
 * 链坏了（环/超深）返回 `undefined`：调用方**不许**猜一个目标出来。
 */
export function canonicalMergeTarget(
  state: MaterializedState,
  tagId: string,
): string | undefined {
  return resolveTagId(tagId, state.tags);
}
