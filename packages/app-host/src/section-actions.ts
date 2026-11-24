/**
 * 清单内分组动作（宿主无关）—— `SECTION` op 的构造
 * =====================================================
 *
 * 实体形状在 `packages/domain/src/entities.ts` 的 {@link Section}（ADR-0091），
 * 纯逻辑（排序 / 悬空归未分组 / 标题校验）在 `packages/domain/src/sections.ts`；
 * 这里只把**一个用户意图**翻成**一条 op**，与 `project-actions.ts` / `tag-actions.ts`
 * 同一个分工（AGENTS.md §3.5：业务语义只在 `packages/`）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 由这里**独占**的几条语义决定：
 *
 * 1. 🔴 **一个用户意图 = 一条 op**（AGENTS.md §3.4）：
 *    · 建分组 —— `{ projectId, name, order }`；
 *    · 改名 —— 只有 `{ name }`；
 *    · 调序 —— 只有 `{ order }`（**不是**把整张分组表重写一遍）；
 *    · 把任务移进/移出分组 —— 只有 `{ sectionId }`（移出写 `null`）。
 *    绝不 fan-out 成"把该组所有任务逐条重写"。
 *
 * 2. 🔴 **删除是软删（`DEL` → 墓碑），不级联删任务**（ADR-0048 / ADR-0091 §6）。
 *    其下任务保留原 `sectionId`；读侧把悬空 / 已删除的 `sectionId` 归「未分组」
 *    （判据在 `sections.ts` 的 `resolveTaskSectionId` / `groupTasksBySection`，
 *    这里不重写）。还原 = 清 `deletedAt`，任务自动回到原组。
 *
 * 3. 🔴 **写入路由不在本文件判断**。当目标清单的 `Project.shareId` 在册时，
 *    `ctx.dispatch` 会被端壳装配成**路由派发器**（`share-routing.ts` 的
 *    `createShareRoutingDispatcher`），由它把 `SECTION` / `TASK` 的 op 送进
 *    share op-log。本文件只调 `ctx.dispatch`，**不读 `shareId`、不判共享**
 *    —— `apps/*` 更不判（ADR-0091 §7）。
 *
 * 4. **存在性 / 归属由动作层真的拦**，不是只靠界面不画按钮：本机 API / CLI
 *    也会调到这些方法。拒绝时抛错（与 `removeProject` 同形状），不静默空操作。
 *
 * ⚠️ **没有 `now` 选项**：本段的写动作一个时间戳都不往载荷里写
 * （`createdAt` / `updatedAt` 由 reducer 从 op 时间戳派生）。等真有
 * `purgeSection` 要写 `purgedAt` 时再加，而不是先留一个没人读的注入点。
 */

import {
  nextSectionOrder,
  normalizeSectionName,
  sectionRejection,
  sectionsOfProject,
  type Section,
  type Task,
} from '@heyta/domain';
import type { EntityType } from '@heyta/shared-schema';
import { OpType } from '@heyta/sync-core';

import type { ActionContext } from './actions.js';
import { randomId } from './ids.js';

export interface SectionActionsOptions {
  /** 分组 id 生成器。可注入，理由与 `TaskActionsOptions.newTaskId` 相同。 */
  newSectionId?: () => string;
}

export interface SectionActions {
  /**
   * 在某条清单下新建一个分组，返回新实体 id。
   *
   * @throws 清单不存在 / 已软删；名称空白或超长
   */
  createSection(projectId: string, name: string): Promise<string>;
  /** 改分组标题（同 id 的 `UPD`，载荷只有 `name`）。 */
  renameSection(sectionId: string, name: string): Promise<void>;
  /**
   * 调整分组在清单内的位置：写 `order`（一个意图一条 op）。
   *
   * @throws 分组不存在 / 已软删；order 不是非负整数
   */
  reorderSection(sectionId: string, order: number): Promise<void>;
  /**
   * 把一条任务移进某分组（`sectionId` 省略 = 移出到「未分组」）。
   *
   * 🔴 分组必须**存在、存活、且与任务属于同一条清单**；否则拒绝（不写 op）。
   * 移出走 `{ sectionId: null }` —— `null` 才能穿过 JSON 表达"清除"。
   */
  setTaskSection(taskId: string, sectionId?: string): Promise<void>;
  /** 软删除一个分组（`DEL` 墓碑）。**不级联删其下任务**。 */
  removeSection(sectionId: string): Promise<void>;
  /** 某条清单下存活的分组（按领域顺序；含空分组）。读不做写入路由判断。 */
  listSections(projectId: string): Section[];
}

export function createSectionActions(
  ctx: ActionContext,
  options: SectionActionsOptions = {},
): SectionActions {
  const makeSectionId = options.newSectionId ?? ((): string => `section-${randomId()}`);

  const liveProjectOf = (projectId: string): void => {
    const project = ctx.getState().projects[projectId];
    if (project === undefined || project.deletedAt !== undefined) {
      throw new Error(`找不到清单「${projectId}」`);
    }
  };

  const liveSectionOf = (sectionId: string): Section => {
    const section = ctx.getState().sections[sectionId];
    if (section === undefined || section.deletedAt !== undefined) {
      throw new Error(`找不到分组「${sectionId}」`);
    }
    return section;
  };

  const liveTaskOf = (taskId: string): Task => {
    const task = ctx.getState().tasks[taskId];
    if (task === undefined || task.deletedAt !== undefined) {
      throw new Error(`找不到任务「${taskId}」`);
    }
    return task;
  };

  const assertName = (name: string): string => {
    const rejection = sectionRejection(name);
    if (rejection === undefined) return normalizeSectionName(name);
    const detail =
      rejection === 'empty'
        ? '名称不能为空（空白也算空）'
        : `名称超过 ${String(name.length)} 字符，上限见 domain/src/sections.ts`;
    throw new Error(`分组名称不合法：${detail}`);
  };

  const dispatch = async (
    entityType: EntityType,
    entityId: string,
    opType: OpType,
    payload: Record<string, unknown>,
  ): Promise<void> => {
    await ctx.dispatch({ entityType, entityId, opType, payload });
  };

  return {
    async createSection(projectId, name) {
      liveProjectOf(projectId);
      const trimmed = assertName(name);
      const order = nextSectionOrder(Object.values(ctx.getState().sections), projectId);
      const entityId = makeSectionId();
      await dispatch('SECTION' as EntityType, entityId, OpType.Create, {
        projectId,
        name: trimmed,
        order,
      });
      return entityId;
    },

    async renameSection(sectionId, name) {
      liveSectionOf(sectionId);
      const trimmed = assertName(name);
      await dispatch('SECTION' as EntityType, sectionId, OpType.Update, { name: trimmed });
    },

    async reorderSection(sectionId, order) {
      liveSectionOf(sectionId);
      if (!Number.isInteger(order) || order < 0) {
        throw new Error(`分组顺序必须是非负整数，收到 ${JSON.stringify(order)}`);
      }
      await dispatch('SECTION' as EntityType, sectionId, OpType.Update, { order });
    },

    async setTaskSection(taskId, sectionId) {
      const task = liveTaskOf(taskId);
      if (sectionId === undefined) {
        // 移出到未分组：写 `null` 表达清除（`undefined` 会被 JSON 丢掉）。
        await dispatch('TASK' as EntityType, taskId, OpType.Update, { sectionId: null });
        return;
      }
      const section = liveSectionOf(sectionId);
      // 分组必须与任务属于同一条清单 —— 否则任务会挂到别的清单的分组上，
      // 读侧归组时又把它当悬空丢回未分组，用户看到的是"拖过去了又弹回来"。
      if (task.projectId === undefined || task.projectId !== section.projectId) {
        throw new Error(
          `任务「${taskId}」不属于分组「${sectionId}」所在清单（任务清单 ${task.projectId ?? '无'} / 分组清单 ${section.projectId}）`,
        );
      }
      await dispatch('TASK' as EntityType, taskId, OpType.Update, { sectionId });
    },

    async removeSection(sectionId) {
      liveSectionOf(sectionId);
      // 软删（墓碑）：不级联删任务，不 fan-out 改任务的 `sectionId`。
      await dispatch('SECTION' as EntityType, sectionId, OpType.Delete, {});
    },

    listSections(projectId) {
      return sectionsOfProject(Object.values(ctx.getState().sections), projectId);
    },
  };
}
