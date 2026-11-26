/**
 * 任务模板（`TASK_TEMPLATE`）的动作层 —— 宿主无关
 * ==============================================
 *
 * 与 `filter-actions.ts` / `event-actions.ts` 同一个理由：**op 的构造只能有一份**
 * （AGENTS §3.5）。每个宿主各拼一遍 payload，就会出现"Web 上能存模板、Android 上不能"
 * 这种没有任何一层会报错的漂移。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这里独占的语义决定
 *
 * 1. 🔴 **一个用户手势 = 一个 op**（AGENTS §3.4）：
 *    · 保存任务为模板 = 一条 `TASK_TEMPLATE` Create（从任务抓来的那几格一次带上）；
 *    · 从模板建任务 = 一条 `TASK` Create（`taskFieldsFromTemplate` 算出的字段一次带上）；
 *    · 改名 / 排序 = 各自一条 `UPD`；删除 = 一条 `DEL`（软删，进回收站）。
 *
 * 2. 🔴 **抓哪些字段 / 建任务时搬哪些字段 = `@heyta/domain` 的
 *    `templatePayloadFromTask` / `taskFieldsFromTemplate` 一处定义**，本层不自己挑字段。
 *    在这里再列一遍，就会得到"Web 存模板抓了 tagIds、桌面端没抓"这种静默分叉。
 *
 * 3. **名校验在写侧**（领域层 `templateNameRejection`）：空名 / 超长名**抛错、零 op**，
 *    不降级成静默空操作。
 *
 * 4. **删除是软删（`DEL`）**，还原 = 清 `deletedAt`；彻底删除后还原**抛错**
 *    （"现在不用恢复"与"永远恢复不了"是两句不同的话，同 `filter-actions.restoreFilter`）。
 *
 * ⚠️ **`TASK_TEMPLATE` 永不进 share op-log**：个人数据（无 `projectId`、无 `shareId`），
 * 所有写入都经 `ctx.dispatch` 走**个人** op-log 单入口。
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  Priority,
  aliveTemplates,
  taskFieldsFromTemplate,
  templateNameRejection,
  templatePayloadFromTask,
  type TaskTemplate,
} from '@heyta/domain';
import type { EntityType } from '@heyta/shared-schema';
import { OpType } from '@heyta/sync-core';

import type { ActionContext } from './actions.js';
import { newTaskId, randomId } from './ids.js';

/** 保存任务为模板时可一并写入的可选字段。省略 = 用领域层默认/不写。 */
export interface TaskTemplateWriteFields {
  /** 模板列表排序键；省略 = 排在有 `order` 的模板之后。 */
  order?: number;
}

export interface TaskTemplateActionsOptions {
  /** 模板 id 生成器。可注入，理由见 `FilterActionsOptions.newFilterId`。 */
  newTemplateId?: () => string;
  /** 建任务时的任务 id 生成器。 */
  newTaskEntityId?: () => string;
  /** 建任务时给清单条目生成 id。 */
  newChecklistItemId?: () => string;
}

export interface TaskTemplateActions {
  /** 从一条已有任务快照出模板。任务不存在 / 已删 ⇒ 抛错（零 op）。返回新模板 id。 */
  saveTaskAsTemplate(taskId: string, name: string, over?: TaskTemplateWriteFields): Promise<string>;
  /** 改名。同名 ⇒ 不写 op。 */
  renameTemplate(entityId: string, name: string): Promise<void>;
  /** 排序键。`order` 必须是有限数。 */
  setTemplateOrder(entityId: string, order: number): Promise<void>;
  /** 软删除（进回收站）。 */
  removeTemplate(entityId: string): Promise<void>;
  /** 从回收站还原。不在回收站返回 `false` 且不写 op；已彻底删除 ⇒ 抛错。 */
  restoreTemplate(entityId: string): Promise<boolean>;
  /** 从模板建一条任务（一条 `TASK` Create op）。返回新任务 id。 */
  createTaskFromTemplate(templateId: string): Promise<string>;
  /** 一条活着的模板；不存在 / 已删 / 已彻底删 ⇒ `undefined`。 */
  templateOf(entityId: string): TaskTemplate | undefined;
  /** 活的模板，**规范顺序**（`aliveTemplates`：order → name → id）。 */
  listTemplates(): TaskTemplate[];
}

export function createTaskTemplateActions(
  ctx: ActionContext,
  options: TaskTemplateActionsOptions = {},
): TaskTemplateActions {
  const makeTemplateId = options.newTemplateId ?? ((): string => `tpl-${randomId()}`);
  const makeTaskId = options.newTaskEntityId ?? newTaskId;
  const makeItemId = options.newChecklistItemId ?? ((): string => `chk-${randomId()}`);

  const assertName = (name: string): string => {
    const rejection = templateNameRejection(name);
    if (rejection === 'empty') throw new Error('模板名字不能为空。');
    if (rejection === 'too-long') throw new Error('模板名字过长。');
    return name.trim();
  };

  const templateOf = (entityId: string): TaskTemplate | undefined => {
    const template = ctx.getState().taskTemplates[entityId];
    if (template === undefined || template.deletedAt !== undefined || template.purgedAt !== undefined) {
      return undefined;
    }
    return template;
  };

  return {
    async saveTaskAsTemplate(taskId, name, over = {}) {
      const trimmed = assertName(name);
      const task = ctx.getState().tasks[taskId];
      if (task === undefined || task.deletedAt !== undefined) {
        throw new Error(`找不到任务「${taskId}」`);
      }
      const fields = templatePayloadFromTask(task, trimmed);
      const entityId = makeTemplateId();
      await ctx.dispatch({
        entityType: 'TASK_TEMPLATE' as EntityType,
        entityId,
        opType: OpType.Create,
        payload: {
          ...fields,
          // `null` 而不是省略：CRT 是合并语义，新建时没有东西可保留
          // （同 `filter-actions.createFilter` 的写法）。领域层读取侧把 `order`
          // 缺席/`null` 都当"排在有 order 的后面"。
          order: over.order ?? null,
        },
      });
      return entityId;
    },

    async renameTemplate(entityId, name) {
      const current = templateOf(entityId);
      if (current === undefined) throw new Error(`找不到模板「${entityId}」`);
      const trimmed = assertName(name);
      if (trimmed === current.name) return;
      await ctx.dispatch({
        entityType: 'TASK_TEMPLATE' as EntityType,
        entityId,
        opType: OpType.Update,
        payload: { name: trimmed },
      });
    },

    async setTemplateOrder(entityId, order) {
      if (templateOf(entityId) === undefined) throw new Error(`找不到模板「${entityId}」`);
      if (!Number.isFinite(order)) throw new Error('模板的排序键必须是有限数值。');
      await ctx.dispatch({
        entityType: 'TASK_TEMPLATE' as EntityType,
        entityId,
        opType: OpType.Update,
        payload: { order },
      });
    },

    async removeTemplate(entityId) {
      if (templateOf(entityId) === undefined) throw new Error(`找不到模板「${entityId}」`);
      await ctx.dispatch({
        entityType: 'TASK_TEMPLATE' as EntityType,
        entityId,
        opType: OpType.Delete,
        payload: {},
      });
    },

    async restoreTemplate(entityId) {
      const raw = ctx.getState().taskTemplates[entityId];
      if (raw === undefined) throw new Error(`找不到模板「${entityId}」`);
      if (raw.purgedAt !== undefined) {
        throw new Error(`模板「${entityId}」已被彻底删除，无法恢复`);
      }
      if (raw.deletedAt === undefined) return false;
      await ctx.dispatch({
        entityType: 'TASK_TEMPLATE' as EntityType,
        entityId,
        opType: OpType.Update,
        // `null` 而不是 `undefined`：`undefined` 会被 JSON 丢掉，对端既不清也不设。
        payload: { deletedAt: null },
      });
      return true;
    },

    async createTaskFromTemplate(templateId) {
      const template = templateOf(templateId);
      if (template === undefined) throw new Error(`找不到模板「${templateId}」`);
      const fields = taskFieldsFromTemplate(template, makeItemId);
      const title = typeof fields['title'] === 'string' ? fields['title'].trim() : '';
      if (title === '') throw new Error('模板没有可用的任务标题。');
      const taskEntityId = makeTaskId();
      await ctx.dispatch({
        entityType: 'TASK' as EntityType,
        entityId: taskEntityId,
        opType: OpType.Create,
        // 默认优先级兜底，与 `task-actions.dispatchCreate` 同一条。
        payload: { priority: Priority.None, ...fields },
      });
      return taskEntityId;
    },

    templateOf,

    listTemplates() {
      return aliveTemplates(Object.values(ctx.getState().taskTemplates));
    },
  };
}
