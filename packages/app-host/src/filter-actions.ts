/**
 * 自定义保存筛选（`FILTER`）的动作层 —— 宿主无关
 * =================================================
 *
 * 与 `event-actions.ts` / `note-actions.ts` 同一个理由：**op 的构造只能有一份**
 * （AGENTS §3.5）。每个宿主各拼一遍 payload，就会出现"Web 上能改名、Android 上改不了"
 * 这种没有任何一层会报错的漂移。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 三条由这里独占的语义决定
 *
 * 1. 🔴 **一个用户手势 = 一个 op**（AGENTS §3.4）。所以：
 *    · 建筛选 = 一条 `CRT`（名字 + 规则 + 可选色槽/排序键一起带上）；
 *    · 改名 = 一条 `UPD { name }`；
 *    · 改规则 = 一条 `UPD { rule }`；
 *    · 排序 = 一条 `UPD { order }`（**一次只动一条**：拖一行的意图就是这一条；
 *      整列重排会变成 N 条 op，那是"一次手势作用在 N 行"的形状，本层不提供，
 *      UI 要重排就对被拖动的那一条调一次 `setFilterOrder`）。
 *
 * 2. 🔴 **规则与名字在写入侧就校验**（领域层的 `filterRuleRejection` /
 *    `filterNameRejection`）。界面不许手拼规则 —— 手拼一条带未知 `kind` 的规则
 *    不会报错，只会让**本机从此打不开这条筛选**（读侧 `compileFilterRule` 会降级）。
 *
 * 3. **删除是软删（`DEL`）**，还原 = 清 `deletedAt`（ADR-0048 四态）。
 *    彻底删除（`purgedAt`）之后还原**抛错**，不是返回 `false` —— "这条现在不用恢复"
 *    与"这条永远恢复不了"是两句不同的话。
 *
 * ⚠️ **`FILTER` 永不进 share op-log**：它是个人数据（没有 `projectId`、没有 `shareId`），
 * 所有写入都经 `ctx.dispatch` 走**个人** op-log 单入口。
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  aliveFilters,
  filterNameRejection,
  filterRuleRejection,
  type CategorySlot,
  type Filter,
  type FilterRule,
} from '@heyta/domain';
import type { EntityType } from '@heyta/shared-schema';
import { OpType } from '@heyta/sync-core';

import type { ActionContext } from './actions.js';
import { randomId } from './ids.js';

/** 新建筛选时可一并写入的可选字段。省略 = 用领域层的运行时默认值/不写。 */
export interface NewFilterFields {
  /** 色槽 1–8；省略 = 无色槽。 */
  color?: CategorySlot;
  /** 侧栏排序键；省略 = 排在有 `order` 的筛选之后。 */
  order?: number;
}

export interface FilterActionsOptions {
  /** 筛选 id 生成器。可注入，理由见 `NoteActionsOptions.newNoteId`。 */
  newFilterId?: () => string;
}

export interface FilterActions {
  /** 建一条保存筛选。返回新 id。名字为空 / 规则非法 ⇒ 抛错（零 op）。 */
  createFilter(name: string, rule: FilterRule, over?: NewFilterFields): Promise<string>;
  /** 改名。同名 ⇒ 不写 op（不推进 `updatedAt`，不扰动顺序）。 */
  renameFilter(entityId: string, name: string): Promise<void>;
  /** 改规则。与旧规则深度相等 ⇒ 不写 op。 */
  updateFilterRule(entityId: string, rule: FilterRule): Promise<void>;
  /** `null` = 用户明确"不要色槽"（写 `null`，不是省略键）。 */
  setFilterColor(entityId: string, color: CategorySlot | null): Promise<void>;
  /** 侧栏排序键。`order` 必须是有限数。 */
  setFilterOrder(entityId: string, order: number): Promise<void>;
  /** 软删除（进回收站）。 */
  removeFilter(entityId: string): Promise<void>;
  /** 从回收站还原。不在回收站返回 `false` 且不写 op；已彻底删除 ⇒ 抛错。 */
  restoreFilter(entityId: string): Promise<boolean>;
  /** 一条活着的筛选；不存在 / 已删 / 已彻底删 ⇒ `undefined`。 */
  filterOf(entityId: string): Filter | undefined;
  /** 活的筛选，**规范顺序**（`aliveFilters`：order → name → id）。 */
  listFilters(): Filter[];
}

function ruleEquals(a: FilterRule, b: FilterRule): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createFilterActions(
  ctx: ActionContext,
  options: FilterActionsOptions = {},
): FilterActions {
  const makeFilterId = options.newFilterId ?? ((): string => `filter-${randomId()}`);

  const assertName = (name: string): string => {
    const rejection = filterNameRejection(name);
    if (rejection === 'empty') throw new Error('筛选名字不能为空。');
    if (rejection === 'too-long') throw new Error('筛选名字过长。');
    return name.trim();
  };

  const assertRule = (rule: FilterRule): void => {
    const rejection = filterRuleRejection(rule);
    if (rejection !== undefined) {
      throw new Error(`筛选规则不合法（${rejection}）。`);
    }
  };

  const filterOf = (entityId: string): Filter | undefined => {
    const filter = ctx.getState().filters[entityId];
    if (filter === undefined || filter.deletedAt !== undefined || filter.purgedAt !== undefined) {
      return undefined;
    }
    return filter;
  };

  return {
    async createFilter(name, rule, over = {}) {
      const trimmed = assertName(name);
      assertRule(rule);
      const entityId = makeFilterId();
      await ctx.dispatch({
        entityType: 'FILTER' as EntityType,
        entityId,
        opType: OpType.Create,
        payload: {
          name: trimmed,
          rule,
          // `null` 而不是省略：CRT 是合并语义，省略一个键等于"不动它"，
          // 而新建时没有任何东西可保留（同 `note-actions.createNote` 的写法）。
          color: over.color ?? null,
          order: over.order ?? null,
        },
      });
      return entityId;
    },

    async renameFilter(entityId, name) {
      const current = filterOf(entityId);
      if (current === undefined) throw new Error(`找不到筛选「${entityId}」`);
      const trimmed = assertName(name);
      if (trimmed === current.name) return;
      await ctx.dispatch({
        entityType: 'FILTER' as EntityType,
        entityId,
        opType: OpType.Update,
        payload: { name: trimmed },
      });
    },

    async updateFilterRule(entityId, rule) {
      const current = filterOf(entityId);
      if (current === undefined) throw new Error(`找不到筛选「${entityId}」`);
      assertRule(rule);
      if (ruleEquals(rule, current.rule)) return;
      await ctx.dispatch({
        entityType: 'FILTER' as EntityType,
        entityId,
        opType: OpType.Update,
        payload: { rule },
      });
    },

    async setFilterColor(entityId, color) {
      if (filterOf(entityId) === undefined) throw new Error(`找不到筛选「${entityId}」`);
      await ctx.dispatch({
        entityType: 'FILTER' as EntityType,
        entityId,
        opType: OpType.Update,
        payload: { color },
      });
    },

    async setFilterOrder(entityId, order) {
      if (filterOf(entityId) === undefined) throw new Error(`找不到筛选「${entityId}」`);
      if (!Number.isFinite(order)) throw new Error('筛选的排序键必须是有限数值。');
      await ctx.dispatch({
        entityType: 'FILTER' as EntityType,
        entityId,
        opType: OpType.Update,
        payload: { order },
      });
    },

    async removeFilter(entityId) {
      if (filterOf(entityId) === undefined) throw new Error(`找不到筛选「${entityId}」`);
      await ctx.dispatch({
        entityType: 'FILTER' as EntityType,
        entityId,
        opType: OpType.Delete,
        payload: {},
      });
    },

    async restoreFilter(entityId) {
      const raw = ctx.getState().filters[entityId];
      if (raw === undefined) throw new Error(`找不到筛选「${entityId}」`);
      if (raw.purgedAt !== undefined) {
        throw new Error(`筛选「${entityId}」已被彻底删除，无法恢复`);
      }
      if (raw.deletedAt === undefined) return false;
      await ctx.dispatch({
        entityType: 'FILTER' as EntityType,
        entityId,
        opType: OpType.Update,
        // `null` 而不是 `undefined`：`undefined` 会被 JSON 丢掉，对端既不清也不设。
        payload: { deletedAt: null },
      });
      return true;
    },

    filterOf,

    listFilters() {
      return aliveFilters(Object.values(ctx.getState().filters));
    },
  };
}
