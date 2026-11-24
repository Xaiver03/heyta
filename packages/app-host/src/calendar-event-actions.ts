/**
 * 外部日历日程（`CALENDAR_EVENT`）的**本地写动作**
 * ================================================
 *
 * 阶段 A 的日程是**只读镜像**（ADR-0089）：内容、时间、参会人全部来自 Hub，
 * heyta 不提供"改标题 / 改时间 / 完成"这类动作。唯一可写的是**本地标签** ——
 * 它属于 heyta 的语义、要跨设备，所以进 op-log；但它**不回写飞书**。
 *
 * 正因为这里只剩一个写入口，才更要把 op 的构造收在这一处：
 * 每个宿主各拼一遍 `{tagIds}`，就会出现"Web 上勾一个标签、另一台设备上标签消失"
 * 这种没有任何一层会报错的漂移（AGENTS §3.5 记着同形状的代价）。
 *
 * ## 三条决定
 *
 * 1. 🔴 **一个手势 = 一条 op**（AGENTS §3.4）：勾一个标签 = 算出**整组** →
 *    一条 `UPD {tagIds}`。不按"加一个 / 删一个"拆成两条，也不在界面里攒批。
 * 2. 🔴 **空集合写 `null`，不写 `[]`**。reducer 对 UPD 是合并语义，`[]` 与
 *    "这个字段不存在"在比较与清空上不是一回事（`calendarEventPatch` 也按
 *    `null` = 清空这一档写的）。写 `[]` 只会让"标签被清空"变成"标签里有个空数组"。
 * 3. 🔴 **写入侧拦住悬空引用**：实体必须存在且没被删；每个 tagId 也必须指向一条
 *    未删除的 `TAG`。悬空 id 的后果是"日程上挂着一个任何视图都查不到的标签"，
 *    而 op-log 里只有一条看起来完全正常的 UPD —— 这类"数据有引用、视图找不到目标"
 *    最难查，所以和 `createTaskActions.setTags` 用同一条判据。
 *
 * ⚠️ 与镜像管道的分工：管道（`calendar-mirror.ts`）只写**源侧内容**，
 * 从不碰 `tagIds`；本动作只写 `tagIds`，从不碰内容。两个写者各管一格，
 * 于是"每轮同步把用户标签冲掉"这件事在结构上不可能发生。
 */

import type { EntityType } from '@heyta/shared-schema';
import { OpType } from '@heyta/sync-core';

import type { ActionContext } from './actions.js';

/** `dispatch` 用的实体类型字面量（`shared-schema` 的 `ENTITY_TYPES` 里有它）。 */
const CALENDAR_EVENT_ENTITY = 'CALENDAR_EVENT' as EntityType;

/**
 * 把一条日程的本地标签**整组**写成给定的这一组。
 *
 * `tagIds` 允许重复（界面上"点两次同一个标签"很常见）；这里去重后写入，
 * 因为 `[a, a]` 会让"标签数"比"标签数上限"更早触发，且没有任何一处会报错。
 *
 * 抛错的三种情形都是**调用方真的写错了**（界面在正常路径上走不到）：
 * 日程不存在 / 已被删、标签不存在 / 已被删。让它们抛，而不是静默 return ——
 * 静默 return 会让"界面上摆着一条已经不存在的日程"永远显示成"保存成功"。
 */
export async function setCalendarEventTags(
  ctx: ActionContext,
  entityId: string,
  tagIds: readonly string[],
): Promise<void> {
  const event = ctx.getState().calendarEvents[entityId];
  if (event === undefined || event.deletedAt !== undefined) {
    throw new Error(`找不到日程「${entityId}」`);
  }

  // 顺序保持调用方给的顺序（标签 chip 按用户勾的先后排），只去掉重复。
  const unique = [...new Set(tagIds)];
  const tags = ctx.getState().tags;
  for (const id of unique) {
    const tag = tags[id];
    if (tag === undefined || tag.deletedAt !== undefined) {
      throw new Error(`找不到标签「${id}」`);
    }
  }

  await ctx.dispatch({
    entityType: CALENDAR_EVENT_ENTITY,
    entityId,
    opType: OpType.Update,
    payload: { tagIds: unique.length === 0 ? null : unique },
  });
}
