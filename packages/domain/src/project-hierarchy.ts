/**
 * 清单层级（文件夹 / 其下清单）的**一层**规则 —— 纯函数，不 import 任何框架。
 * =====================================================================
 *
 * 为什么这一层存在（2026-10-03 实测，BLOCKED B52）：`Project.parentId` 在领域层
 * 就写着「只允许一层文件夹 + 其下清单，不支持任意深度嵌套」（`entities.ts`），
 * 但全仓库**没有任何一处代码在守这条规则** ——
 * `grep -rnw isFolder -e projectDepth packages/domain/src packages/app-host/src` = 0 命中，
 * 而清单侧连一个改父的动作都还没有（只有任务侧有 `validateParentChange`）。
 * 一条没有守卫的规则等于一条没有的规则：下一个接界面的人会把第三层直接写进 op。
 *
 * ⚠️ 为什么不复用任务侧的 `validateParentChange`：它的深度上限是
 * `MAX_SUBTASK_DEPTH = 3` 且按**整棵子树高度**计算，语义是"任意深度但有上限"；
 * 清单的语义是**只有一层**。把两种语义折进同一个函数，改一个会悄悄改掉另一个。
 */

import type { Project } from './entities.js';

/**
 * 改父被拒绝的原因。**封闭集合**（与任务侧 `ParentChangeRejection` 同一条取舍：
 * 界面要能逐条给出人话，而不是把一个字符串错误吞掉或原样渲染给用户）。
 *
 * 顺序即优先级，先报最根本的错 —— 见 `validateProjectParentChange` 的判序。
 */
export type ProjectParentRejection =
  /** 被改的清单不存在（或已软删除）。 */
  | 'project_not_found'
  /** 新父不存在（或已软删除）。写进悬空 id 会让这条清单**在任何视图里都查不到**。 */
  | 'parent_not_found'
  /** 自己当自己的父。 */
  | 'self'
  /** 新父在自己的子树里（环）。 */
  | 'cycle'
  /** 新父自己就在某个文件夹下 —— 再往它下面挂会造出第三层。 */
  | 'parent_not_top_level'
  /** 被移动的清单自己有子清单（它是文件夹），文件夹不能再进文件夹。 */
  | 'has_children';

/** 改父校验结果。通过时**把 parentId 原样回传**，调用方据此构造 op。 */
export type ProjectParentResult =
  | { readonly ok: true; readonly parentId: string | undefined }
  | { readonly ok: false; readonly reason: ProjectParentRejection };

/**
 * 把 `projectId` 的父设成 `newParentId`（省略 = 提为顶级）是否合法。
 *
 * 判序（每条都是**必要**的，去掉任意一条都会有对应的坏数据写得进去，
 * 而下面 `project-hierarchy.spec.ts` 逐条做过变异）：
 *
 * 1. `project_not_found` —— 被改的清单不存在或已删除（墓碑不算存在，
 *    与动作层 `projectOf` 同一条规则）。
 * 2. 顶级（`undefined`）**永远合法**，直接返回 —— 提为顶级不产生任何层级风险。
 * 3. `self` —— 先于"新父是否存在"判：`setParent(x, x)` 里 x 一定存在，
 *    不先拦它会走到后面的分支去。
 * 4. `parent_not_found` —— 新父必须真的存在且没被删。
 * 5. `cycle` —— 新父在自己的子树里。沿父链上走，**带访问集**：磁盘上可能已经
 *    躺着一条环（别的宿主或旧版本写进去的），没有访问集这里会死循环。
 * 6. `parent_not_top_level` —— 新父自己有父 ⇒ 它是"文件夹下的清单"，
 *    挂到它下面就是第三层。
 * 7. `has_children` —— 被移动的清单自己有子 ⇒ 它是文件夹，不能再进文件夹。
 *
 * 第 6/7 条分开而不是合成一个 `depth_exceeded`：任务侧可以合（那边真的只关心
 * "会不会超过上限"），这里不行 —— 界面要能说出**为什么不能移**，
 * 而"目标在文件夹里"与"你移的是个文件夹"是两句不同的话。
 */
export function validateProjectParentChange(
  projects: readonly Project[],
  projectId: string,
  newParentId: string | undefined,
): ProjectParentResult {
  const byId = new Map<string, Project>();
  for (const project of projects) {
    if (project.deletedAt === undefined) byId.set(project.id, project);
  }

  if (byId.get(projectId) === undefined) return { ok: false, reason: 'project_not_found' };

  if (newParentId === undefined) return { ok: true, parentId: undefined };

  if (newParentId === projectId) return { ok: false, reason: 'self' };

  const newParent = byId.get(newParentId);
  if (newParent === undefined) return { ok: false, reason: 'parent_not_found' };

  const seen = new Set<string>([projectId]);
  let cursor: string | undefined = newParent.parentId;
  while (cursor !== undefined) {
    if (cursor === projectId) return { ok: false, reason: 'cycle' };
    // 数据里本来就有一条与本次移动无关的环：停下来，别顺着它走。
    if (seen.has(cursor)) break;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId;
  }

  if (newParent.parentId !== undefined) return { ok: false, reason: 'parent_not_top_level' };

  for (const candidate of byId.values()) {
    if (candidate.parentId === projectId) return { ok: false, reason: 'has_children' };
  }

  return { ok: true, parentId: newParentId };
}

/**
 * 某条清单**现在能移进哪些清单**（= 领域层允许的合法目标，按输入顺序返回）。
 *
 * 🔴 它存在的唯一理由是：**两端的选择器必须用同一份候选集**。界面如果自己筛一遍
 * （"看起来是顶级的就能选"），那第二份标准迟早和守卫不一致 —— 本仓为"同一条规则
 * 两处实现"付过三次学费（AGENTS.md §3.5）。所以：
 *   界面 **只画** 这个函数给的东西，**不自己判断能不能移**；
 *   动作层 `setParent` 仍然会再判一次（写侧才是唯一能拦住坏数据的地方）。
 *
 * 直接复用 `validateProjectParentChange`，不重述规则 —— 两条路径因此不可能漂移。
 *
 * ⚠️ 已归档的清单**不进候选**，理由与墓碑那条同源但**不是同一条**：
 * `toOrganizerTree` 在没开 `includeArchived` 时（= 侧栏默认），父 id 指向一条已归档
 * 清单的子级**整条从界面上消失**（那个文件把它写成"已知取舍：宁可当孤儿，不冒充顶层"）。
 * 所以"移进一条归档清单"在默认视图里表现为：这条清单点了一下就没了 —— 用户既看不见它，
 * 也点不回它。要移进去只有一条路：先取消归档，让它重新出现在候选里。
 *
 * ⚠️ 写侧（`validateProjectParentChange`）**不拦**归档父 —— 因为"归档一条有子的文件夹"
 * 本身是合法操作，拦了会让已有的 子→归档父 结构变成没法解释的数据。
 * 这里的差别是刻意的：**界面不给入口，不代表这个状态非法**。
 *
 * 🔴 归档只从**候选**里排除，不从**被移动的那条**里排除：侧栏开着「显示已归档」时，
 * 归档那一行照样画出来、照样带这个入口，此时它必须还能移出去（移到一条没归档的文件夹里）。
 * 若把它一起排除，`folderTargetsFor(归档行)` 会因"被改的清单不存在"返回空候选，
 * 那一行的菜单就只剩一个点不动的「不放进文件夹」—— 一个看着能点、点了没反应的入口。
 */
export function folderTargetsFor(
  projects: readonly Project[],
  projectId: string,
): Project[] {
  const alive = projects.filter((project) => project.deletedAt === undefined);
  return alive
    .filter(
      (candidate) =>
        candidate.archived !== true &&
        candidate.id !== projectId &&
        validateProjectParentChange(alive, projectId, candidate.id).ok,
    )
    // 同一条规则里 `parentId` 可能是"没这个键"（reducer 把 null 翻成删除），
    // 而排序要确定性 —— 按创建时间、同刻按 id，与 `listProjects()` 同一条规范顺序。
    .sort((a, b) =>
      a.createdAt !== b.createdAt
        ? a.createdAt - b.createdAt
        : a.id < b.id
          ? -1
          : a.id > b.id
            ? 1
            : 0,
    );
}
