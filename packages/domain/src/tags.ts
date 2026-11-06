/**
 * 标签的**合并别名**：把"原始 tagIds"变成"有效标签"的唯一入口
 * =================================================================
 *
 * ## 它解决的是什么
 *
 * 标签合并（`docs/plans/package-b-2026-11.md` R8）的产品语义是：
 * **把 A 上所有任务换成 B，然后删掉 A。**
 *
 * 而"换成"有两种实现方式，它们在 op-log 纪律下**不是等价的**：
 *
 * | 做法 | op 条数 | 并发冲突面 | 半截状态 |
 * |---|---|---|---|
 * | 逐条改写 `task.tagIds` | **N 条**（N = 挂着 A 的任务数） | N 行任务各自打架 | 崩在第 k 条 ⇒ 一半任务换过去了，A 还没删 |
 * | `Tag.mergedInto` + 读侧解析（**本文件**） | **1 条** | **1 行标签**（LWW 决胜） | 没有：一条 op 要么全生效要么全不生效 |
 *
 * 所以采用后者。代价写在这里，因为这个代价是**永久的**：
 *
 * 🔴 **`task.tagIds` 里仍然留着被合并掉的 id。** 我们不重写它（那就是 N 条 op）。
 *    于是"这条任务有哪些标签"这个问题**只有本文件能回答** ——
 *    任何地方自己写 `task.tagIds.includes(id)` 都会漏掉别名，而漏掉的表现
 *    **不是报错**，是"合并之后我的任务不见了"（按 B 筛不到只挂着 A 的任务）。
 *    这条设计的失败方式就是"漏一处、不报错"，所以它有两条判据盯着：
 *    `packages/domain/tests/tags.spec.ts`（行为）与
 *    `scripts/check-tag-resolution.mjs`（形状：别处不许直接判 `tagIds`）。
 *
 * ## 三条不变量
 *
 * 1. **解析只读。** 不许在解析里写回任何东西 —— 那会把一次读变成 N 条 op。
 * 2. **链要跟到底，环要停。** `A→B→C` ∧ `C` 活着 ⇒ `A` 解析成 `C`；
 *    `A→B→A` 是个坏链 ⇒ 返回 `undefined`（**不是**把 A 当活的，也不是死循环）。
 * 3. **删掉的标签不算有效**（否则"删了重建"这条路会在解析层被重新打开）。
 */

import type { Tag } from './entities.js';

/** 只看"这条标签被合并到了哪"所需的字段（测试与部分调用方只有这么多）。 */
export type TagAliasView = Pick<Tag, 'id'> & { readonly mergedInto?: string; readonly deletedAt?: number };

/**
 * 别名链的深度上限。
 *
 * 环已经由"seen"集合挡住；这个数字挡的是**病态长链**（1000 条标签互相合并成一个环状
 * 长链，每读一条任务都要走 1000 步）。超过上限按"坏链"处理（`undefined`）——
 * 与环同一个处置，因为它同样意味着数据已经坏了。
 */
const MAX_ALIAS_DEPTH = 32;

/**
 * `tagId` 最终指向哪一条（可能还是它自己）。
 *
 * 返回 `undefined` = **这条链坏了**：环、超深、或指向一个不存在的 id。
 * ⚠️ 它**不判断目标是否已删除** —— 那是 {@link resolveTagId} 的事，两者刻意分开：
 * 合并目标本身可能也被合并了，但"链坏了"与"目标被删了"是两种不同的坏。
 */
export function followTagAlias(
  tagId: string,
  tags: Readonly<Record<string, Pick<Tag, 'id'> & { readonly mergedInto?: string }>>,
): string | undefined {
  let current = tagId;
  const seen = new Set<string>();
  for (let depth = 0; depth < MAX_ALIAS_DEPTH; depth += 1) {
    if (seen.has(current)) return undefined; // 环
    seen.add(current);
    const tag = tags[current];
    if (tag === undefined) return undefined; // 指向一个不存在的 id
    const next = tag.mergedInto;
    if (next === undefined || next === '') return current;
    current = next;
  }
  return undefined; // 超深
}

/**
 * `tagId` 的**有效标签 id**。
 *
 * 返回 `undefined` = 这条引用不该被看见：
 *   · 链坏了（环 / 超深 / 指向不存在的 id）；
 *   · 目标标签已删除（`deletedAt`）；
 *   · 目标已彻底删除（`purgedAt`，回收站那一档）。
 */
export function resolveTagId(
  tagId: string,
  tags: Readonly<Record<string, Tag>>,
): string | undefined {
  const id = followTagAlias(tagId, tags);
  if (id === undefined) return undefined;
  const tag = tags[id];
  if (tag === undefined) return undefined;
  if (tag.deletedAt !== undefined || tag.purgedAt !== undefined) return undefined;
  return id;
}

/**
 * 一条任务的**有效标签 id 集合**：去别名、去重、丢掉看不见的引用。
 *
 * 🔴 顺序保持"第一次出现"的顺序（用户加标签的顺序有意义），**不去按 id 排** ——
 * 排了会让界面上的 chip 顺序在合并之后整体换一遍。
 *
 * 🔴 同一个有效标签只出现一次：`task.tagIds = [A, B]` 而 `A` 合并进了 `B` ⇒ `[B]`，
 * 不是 `[B, B]`。界面与计数都靠这一条。
 */
export function resolveTagIds(
  tagIds: readonly string[] | undefined,
  tags: Readonly<Record<string, Tag>>,
): string[] {
  if (tagIds === undefined || tagIds.length === 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tagIds) {
    const id = resolveTagId(raw, tags);
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** 有效标签的**实体**（按 `resolveTagIds` 的顺序）。查不到的引用被丢掉。 */
export function resolveTags(
  tagIds: readonly string[] | undefined,
  tags: Readonly<Record<string, Tag>>,
): Tag[] {
  return resolveTagIds(tagIds, tags).flatMap((id) => {
    const tag = tags[id];
    return tag === undefined ? [] : [tag];
  });
}

/** 一条任务的**有效**标签里有没有 `tagId`（筛选/勾选状态用这一条，不要自己 includes）。 */
export function taskHasTag(
  task: { readonly tagIds?: readonly string[] | undefined },
  tagId: string,
  tags: Readonly<Record<string, Tag>>,
): boolean {
  return resolveTagIds(task.tagIds, tags).includes(tagId);
}

/**
 * 删掉一条标签 / 合并一条标签时，**当前有多少条任务真的挂着它**
 *（用有效标签算，所以"只挂着被合并 id 的任务"会被算到合并目标头上）。
 *
 * `includeCompleted` 由调用方决定：确认框里的"它挂在 N 条任务上"要含已完成
 * （否则界面说"没有任务受影响"，而实际上有一堆已完成任务带着它）。
 */
export function tagUsageCount(
  tasks: readonly { readonly tagIds?: readonly string[] | undefined; readonly deletedAt?: number }[],
  tagId: string,
  tags: Readonly<Record<string, Tag>>,
): number {
  let count = 0;
  for (const task of tasks) {
    if (task.deletedAt !== undefined) continue;
    if (taskHasTag(task, tagId, tags)) count += 1;
  }
  return count;
}

/**
 * `Tag[]` → `Record<id, Tag>`（解析函数要的形状）。
 *
 * 存在的理由：物化状态里是 `Record`，而界面 store 里到处是数组。两边各转一次
 * 就会出现两种"id 查标签"的实现（数组 `find` vs 记录 `[]`）—— 前者 O(n)、
 * 后者 O(1)，但真正的差别是**删掉的标签在两种形状里的可见性**：
 * 数组那条路会自然带上墓碑之外的一切。这里统一在领域层转，别处只拿 `Record`。
 */
export function indexTags(tags: readonly Tag[]): Record<string, Tag> {
  const out: Record<string, Tag> = {};
  for (const tag of tags) out[tag.id] = tag;
  return out;
}
