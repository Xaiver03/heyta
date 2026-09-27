/**
 * 清单与标签动作（宿主无关）
 * ============================
 *
 * 与 `actions.ts`（任务）同一个理由：**op 的构造只能有一份**。
 * `PROJECT` / `TAG` 的 op 构造此前只存在于
 * `apps/web/src/features/projects/store.ts`（6 处），移动端要做清单时
 * 必然变成第二份 —— 而"第二份"在本仓库已经漂移过三次（见 AGENTS.md §3.5）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 三个由这里**独占**的语义决定：
 *
 * 1. **无父清单写 `parentId: null`，不写"不放这个键"。**
 *    旧实现写成"`parentId` 为 undefined 时不要放进 payload"，注释里还专门
 *    解释了一遍。两种写法在 reducer 上**等价**（`null` 会被转成删除该字段），
 *    但同一件事只能有一种写法 —— 否则"两台设备对同一操作生成的 op 是否相同"
 *    就只能靠人肉比对，而那是会漏的。选 `null` 的理由与 `actions.ts` 文件头
 *    第 2 条一致：载荷里"键存在且为 null"能穿过 JSON 表达"清除"。
 *
 * 2. **删除清单不级联删除任务。** 任务只是变成"无清单"。
 *    级联删除会让"误删清单"从**可恢复**变成**不可恢复** —— 而清单是用户
 *    用来分组的，删一个分组不该毁掉里面的东西。
 *
 * 3. **删除发 `DEL` op，不是改标志位。** 与任务一致：物理删除会让同步端
 *    永远看不到这次删除。
 *
 * ⚠️ 标签（TAG）与清单（PROJECT）放在同一个动作集里，是因为在**数据模型**上
 * 它们是两个独立实体，但在**产品**上是同一件事的两个面（组织任务）。
 * 分成两个文件会让人以为它们的语义可以各自演化。
 * ─────────────────────────────────────────────────────────────────────────
 */

import { parseCategorySlot, type CategorySlot, type Project, type Tag } from '@heyta/domain';
import type { EntityType } from '@heyta/shared-schema';
import { OpType } from '@heyta/sync-core';

import type { ActionContext } from './actions.js';
import { randomId } from './ids.js';

export interface ProjectActionsOptions {
  /** 清单 id 生成器。可注入，理由见 `TaskActionsOptions.newTaskId`。 */
  newProjectId?: () => string;
  /** 标签 id 生成器。 */
  newTagId?: () => string;
}

export interface ProjectActions {
  /** 新建清单。`parentId` 省略表示顶层清单。返回新实体 id。 */
  createProject(name: string, parentId?: string): Promise<string>;
  renameProject(entityId: string, name: string): Promise<void>;
  /**
   * 给清单指定一个**分类色槽位**（1–8），或 `undefined` 表示清掉。
   *
   * 🔴 存的是**槽位号**，不是颜色本身。
   *
   * 理由（见 `docs/plans/activity-categories-and-colors.md` §6）：颜色会随主题与
   * 设计系统调整，而用户的**语义**（"这条清单是我用来标记那一类事的"）不该跟着变。
   * 存 `"3"` 的话换配色不动数据；存 `"#0d9488"` 的话，历史数据里写死的是旧配色，
   * 而它在新主题下可能根本看不清 —— 那是一次没法收场的迁移。
   *
   * 🔴 这里**不做**任何健康度判断：槽位是我们给的，含义是用户赋的。
   * 动作层永远不知道 3 号是"学习"还是"刷手机"。
   */
  setProjectColor(entityId: string, slot?: CategorySlot): Promise<void>;
  /** 归档：隐藏但**保留数据**，可以再取消归档。 */
  archiveProject(entityId: string): Promise<void>;
  /** 软删除。⚠️ 不级联删除其下的任务（见文件头第 2 条）。 */
  removeProject(entityId: string): Promise<void>;

  createTag(name: string): Promise<string>;
  removeTag(entityId: string): Promise<void>;

  /** 未删除的清单，按 (createdAt, id) 升序 —— 与 `listTasks()` 同一条规则。 */
  listProjects(): Project[];
  /** 未删除的标签，顺序同上。 */
  listTags(): Tag[];
}

/** 未软删除的记录（顺序未定义，调用方自己 sort）。 */
function aliveOf<T extends { deletedAt?: number }>(record: Record<string, T>): T[] {
  return Object.values(record).filter((item) => item.deletedAt === undefined);
}

/**
 * 跨端一致的规范顺序：创建时间升序，同刻按 id 字典序。
 *
 * 与 `actions.ts` 的 `byCanonicalOrder` 是**同一条规则**，这里重写一遍是因为
 * 泛型不同（那边是 `Task`）。规则本身只有一条，别在这里改。
 */
function byCanonicalOrder<T extends { createdAt: number; id: string }>(a: T, b: T): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function createProjectActions(
  ctx: ActionContext,
  options: ProjectActionsOptions = {},
): ProjectActions {
  const makeProjectId = options.newProjectId ?? ((): string => `project-${randomId()}`);
  const makeTagId = options.newTagId ?? ((): string => `tag-${randomId()}`);

  const projectOf = (entityId: string): Project | undefined => {
    const project = ctx.getState().projects[entityId];
    if (project === undefined || project.deletedAt !== undefined) return undefined;
    return project;
  };

  const updateProject = async (
    entityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> => {
    if (projectOf(entityId) === undefined) throw new Error(`找不到清单「${entityId}」`);
    await ctx.dispatch({
      entityType: 'PROJECT' as EntityType,
      entityId,
      opType: OpType.Update,
      payload,
    });
  };

  return {
    async createProject(name, parentId) {
      const trimmed = name.trim();
      // 空名字**抛错**而不静默忽略：与 `createTaskActions.create` 同一个理由 ——
      // 静默返回会让调用方以为建成功了。"用户按了空回车什么都不做"是**交互**决策，
      // 由界面自己判断。
      if (trimmed === '') throw new Error('清单名称不能为空');

      const entityId = makeProjectId();
      await ctx.dispatch({
        entityType: 'PROJECT' as EntityType,
        entityId,
        opType: OpType.Create,
        // 无父时显式写 null —— 见文件头第 1 条。不做 `parentId === undefined`
        // 的分支：那正是"同一件事两种写法"的来源。
        payload: { name: trimmed, parentId: parentId ?? null },
      });
      return entityId;
    },

    async renameProject(entityId, name) {
      const trimmed = name.trim();
      if (trimmed === '') throw new Error('清单名称不能为空');
      await updateProject(entityId, { name: trimmed });
    },

    async setProjectColor(entityId, slot) {
      // 边界上真的验一次，而不是靠类型：`slot` 来自界面，而界面很容易传成
      // **数组下标**（`CATEGORY_SLOTS.map((s, i) => …)` 里传 `i`）——
      // 那是 0 起算的，于是第 1 个色块会静默写成 `"0"`（一个不存在的槽位）。
      // 读的时候 `parseCategorySlot` 会把它当"没设过色"，所以症状是
      // "点了 1 号但颜色没生效"，而且永远不报错。
      const clean = slot === undefined ? undefined : parseCategorySlot(slot);
      if (slot !== undefined && clean === undefined) {
        throw new Error(`分类色槽位必须是 1–8 的整数，收到 ${JSON.stringify(slot)}`);
      }
      // 清除写 `null` 而不是"不放这个键"或 `undefined` —— 与文件头第 1 条同一条规则：
      // `null` 能穿过 JSON 表达"清除"；`undefined` 会让整个键在 JSON 里消失，
      // 两台设备对同一次"清掉颜色"生成的 op 于是长得不一样。
      await updateProject(entityId, { color: clean === undefined ? null : String(clean) });
    },

    async archiveProject(entityId) {
      await updateProject(entityId, { archived: true });
    },

    async removeProject(entityId) {
      if (projectOf(entityId) === undefined) throw new Error(`找不到清单「${entityId}」`);
      // 软删除（墓碑）—— 见文件头第 3 条。
      await ctx.dispatch({
        entityType: 'PROJECT' as EntityType,
        entityId,
        opType: OpType.Delete,
        payload: {},
      });
    },

    async createTag(name) {
      const trimmed = name.trim();
      if (trimmed === '') throw new Error('标签名称不能为空');

      const entityId = makeTagId();
      await ctx.dispatch({
        entityType: 'TAG' as EntityType,
        entityId,
        opType: OpType.Create,
        payload: { name: trimmed },
      });
      return entityId;
    },

    async removeTag(entityId) {
      const tag = ctx.getState().tags[entityId];
      if (tag === undefined || tag.deletedAt !== undefined) {
        throw new Error(`找不到标签「${entityId}」`);
      }
      await ctx.dispatch({
        entityType: 'TAG' as EntityType,
        entityId,
        opType: OpType.Delete,
        payload: {},
      });
    },

    listProjects() {
      return aliveOf(ctx.getState().projects).sort(byCanonicalOrder);
    },

    listTags() {
      return aliveOf(ctx.getState().tags).sort(byCanonicalOrder);
    },
  };
}