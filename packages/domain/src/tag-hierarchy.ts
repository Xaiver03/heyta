/**
 * 标签层级（父标签 / 子标签）的**两层**规则 —— 纯函数，不 import 任何框架。
 * =====================================================================
 *
 * 产品语义（ADR-0090）：标签是**横向属性**（一个任务可挂多个），层级只做
 * **分组 + 汇总筛选**，不承担"归属"。归属永远归清单/文件夹。
 *
 * 为什么这条规则要单独一层（与 `project-hierarchy.ts` 同一个理由）：
 * `Tag.parentId` 在 `entities.ts` 上写着「只允许两层」，但一条没有守卫的规则
 * 等于一条没有的规则 —— 下一个接界面的人会把第三层直接写进 op。
 *
 * ⚠️ 为什么不复用 `validateProjectParentChange`：两者语义不同（清单是文件夹 +
 * 其下清单；标签是父标签 + 子标签），但**形状**刻意保持一致（同一套拒绝码、
 * 同一种判序），这样两个实体的层级规则不会一个改了另一个没改。
 *
 * 与合并别名（`tags.ts` 的 `mergedInto`）的关系：
 *   - 本文件只算**结构**（父子、深度、环）；别名解析仍在 `tags.ts`。
 *   - 调用方应先做别名解析（`resolveTagIds`）再进本文件的结构判断，
 *     避免在同一处混入两套重定向语义。
 */

import { byCreatedAtOrder, isLive, type Tag } from './entities.js';

/**
 * 改父被拒绝的原因。**封闭集合**（界面要能逐条给出人话，而不是渲染一个字符串错误）。
 * 顺序即优先级，先报最根本的错 —— 见 `validateTagParentChange` 的判序。
 */
export type TagParentRejection =
  /** 被改的标签不存在（或已软删除 / 已彻底删除）。 */
  | 'tag_not_found'
  /** 新父不存在（或已软删除）。写进悬空 id 会让这条标签在任何视图里都查不到。 */
  | 'parent_not_found'
  /** 自己当自己的父。 */
  | 'self'
  /** 新父在自己的子树里（环）。 */
  | 'cycle'
  /** 新父自己就有父 —— 再往它下面挂会造出第三层。 */
  | 'parent_not_top_level'
  /** 被移动的标签自己有子 —— 它是父标签，父标签不能再进别的父。 */
  | 'has_children';

/** 改父校验结果。通过时**把 parentId 原样回传**，调用方据此构造 op。 */
export type TagParentResult =
  | { readonly ok: true; readonly parentId: string | undefined }
  | { readonly ok: false; readonly reason: TagParentRejection };

/**
 * 把 `tagId` 的父设成 `newParentId`（省略 = 提为顶层）是否合法。
 *
 * 判序（每条都必要，去掉任意一条都会有对应的坏数据写得进去）：
 * 1. `tag_not_found` —— 被改的标签不存在或已删除。
 * 2. 顶级（`undefined`）**永远合法**，直接返回 —— 提为顶层不产生层级风险。
 * 3. `self` —— 先于"新父是否存在"判：`setParent(x, x)` 里 x 一定存在。
 * 4. `parent_not_found` —— 新父必须真的存在且没被删。
 * 5. `cycle` —— 新父在自己的子树里。沿父链上走，带访问集：磁盘上可能已经躺着
 *    一条环（旧版本或别的宿主写进去的），没有访问集这里会死循环。
 * 6. `parent_not_top_level` —— 新父自己有父 ⇒ 挂到它下面就是第三层。
 * 7. `has_children` —— 被移动的标签自己有子 ⇒ 它是父标签，不能再进别的父。
 */
export function validateTagParentChange(
  tags: readonly Tag[],
  tagId: string,
  newParentId: string | undefined,
): TagParentResult {
  const byId = new Map<string, Tag>();
  for (const tag of tags) {
    if (isLive(tag)) byId.set(tag.id, tag);
  }

  if (byId.get(tagId) === undefined) return { ok: false, reason: 'tag_not_found' };

  if (newParentId === undefined) return { ok: true, parentId: undefined };

  if (newParentId === tagId) return { ok: false, reason: 'self' };

  const newParent = byId.get(newParentId);
  if (newParent === undefined) return { ok: false, reason: 'parent_not_found' };

  const seen = new Set<string>([tagId]);
  let cursor: string | undefined = newParent.parentId;
  while (cursor !== undefined) {
    if (cursor === tagId) return { ok: false, reason: 'cycle' };
    if (seen.has(cursor)) break; // 数据里本来就有一条与本次移动无关的环：停下
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId;
  }

  if (newParent.parentId !== undefined) return { ok: false, reason: 'parent_not_top_level' };

  for (const candidate of byId.values()) {
    if (candidate.parentId === tagId) return { ok: false, reason: 'has_children' };
  }

  return { ok: true, parentId: newParentId };
}

/** 某个父下的直接子标签 id（按传入顺序）。 */
export function childTagIdsOf(tags: readonly Tag[], parentId: string): string[] {
  return tags.filter((tag) => isLive(tag) && tag.parentId === parentId).map((tag) => tag.id);
}

/**
 * 把 `tagId` 移父时**合法的目标集**（两端共用的候选集，`FolderPicker` 的 `candidates`）。
 *
 * 与 `project-hierarchy.ts#folderTargetsFor` 同形：逐个候选跑一遍
 * `validateTagParentChange`，只留 `ok` 的；按 `byCreatedAtOrder` 规范排序。
 * 这样"能挂到哪"只有一个所有者，界面与动作层不会出现两套标准。
 */
export function tagTargetsFor(tags: readonly Tag[], tagId: string): Tag[] {
  const alive = tags.filter((tag) => isLive(tag));
  return alive
    .filter(
      (candidate) =>
        candidate.id !== tagId && validateTagParentChange(alive, tagId, candidate.id).ok,
    )
    .sort(byCreatedAtOrder);
}

/**
 * `rootId` 的全部存活后代 id（不含 root 自己）。
 *
 * 设计上只有两层，但这里**按任意深度收**并带环防护：磁盘上若已被写进更深的结构
 *（旧版本 / 别的宿主），求值时也不能死循环或漏算 —— 结构上仍是"能收多少收多少"。
 */
export function descendantTagIds(tags: readonly Tag[], rootId: string): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const tag of tags) {
    if (!isLive(tag) || tag.parentId === undefined) continue;
    const list = childrenByParent.get(tag.parentId);
    if (list === undefined) childrenByParent.set(tag.parentId, [tag.id]);
    else list.push(tag.id);
  }

  const out: string[] = [];
  const seen = new Set<string>([rootId]);
  const stack = [...(childrenByParent.get(rootId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const child of childrenByParent.get(id) ?? []) stack.push(child);
  }
  return out;
}

/**
 * 把一组标签 id 展开成「它们自己 + 各自后代」—— 筛选 **roll-up** 的唯一形状。
 *
 * 🔴 调用方先做别名解析（`resolveTagIds`）再进来：本文件不 import `tags.ts`
 *    （避免循环依赖），两套重定向语义（合并 / 父子）在调用点按顺序组合。
 *
 * 例：`expandTagIdsWithDescendants(['工作'], tags)` ⇒ `['工作', '工作/客户A', '工作/客户B']`，
 * 于是"按工作筛"能带出所有子标签下的任务 —— 这正是树相对平铺**唯一**多出来的价值。
 */
export function expandTagIdsWithDescendants(
  tagIds: readonly string[],
  tags: readonly Tag[],
): string[] {
  const out = new Set<string>();
  for (const id of tagIds) {
    out.add(id);
    for (const descendant of descendantTagIds(tags, id)) out.add(descendant);
  }
  return [...out];
}
