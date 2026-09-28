/**
 * 子任务语义 —— **父子关系只有一个定义**
 * ==========================================
 *
 * 这个文件补的是 B1-3（`docs/plans/site-and-parity-alignment.md` §B1）的
 * **领域层**。`Task.parentId` 是一个**可选**字段（AGENTS.md §3.3），
 * `undefined` 就是「顶级任务」；加它**不需要 bump `CURRENT_SCHEMA_VERSION`**，
 * 也不需要动 `packages/op-log` 的 reducer（证据与推理见文件末尾的
 * 「为什么加一个可选字段不用 bump schema」）。
 *
 * ## 为什么这一层必须存在（AGENTS.md §3.5 的判据）
 *
 * "把扁平任务列表组装成父子树"「谁是谁的后代」「这个改父操作会不会造出环」——
 * 全是产品语义，而且 Web / 移动端 / 桌面端必须给出一模一样的答案。
 * 写在任何一个 `apps/*` 里，下一个宿主就会再写一遍并漂移（§3.5 已经因为
 * 同形状的漂移吃过两次 P0）。所以它住在 `packages/domain`，四端共用一份。
 *
 * ## 🔴 最容易漏、后果最严重的一条：循环防护
 *
 * 父子关系是**有向图**，而用户能自由改父。把 A 的父设成 A 的后代，
 * 就得到一个**环**。环的后果不是"显示不对"，而是：
 *
 *   - 树构建 / 折叠 / 计数**无限递归**（栈溢出，整屏打不开）；
 *   - "这个任务有几个祖先"没有答案，统计与排序全部失真。
 *
 * 所以 {@link validateParentChange} 把 `cycle` 做成**写前的硬拒绝**，
 * 而 {@link buildTaskTree} 还额外做**读时的兜底**（磁盘上可能已经有
 * 手改/旧版/跨端写入造成的环，读的时候不能让整棵树炸掉）。
 * 两道都要有：只做写前防护，历史数据里的环会炸；只做读时兜底，环会一直被写进去。
 *
 * ## 🔴 两件刻意不决定的事（不发明默认值）
 *
 * 1. **完成态传播** —— 父任务"完成"与子任务的关系（父完成是否自动完成子？
 *    子全完成是否自动完成父？父完成但子未完成时统计怎么算？）。
 *    实测：**仓库里现在没有任何 rollup / 聚合逻辑** ——
 *    `grep -rn "rollup|aggregate|子任务" packages/` 除本模块外零命中，
 *    `Task.completedAt` 只描述它自己。这是**产品决策**（滴答清单允许
 *    父子各自独立完成，但父的进度条按子任务完成比例显示），所以本轮
 *    **不提供** `isEffectivelyComplete()` 之类的函数 —— 提供就等于拍了一个
 *    默认值，而它会被 UI 当成既成事实。
 * 2. **删除 / 移动的级联** —— 删父任务时子任务是跟着删（级联）还是上提为
 *    顶级？改父时子树是否整体跟着走？实测：同样**没有任何逻辑**
 *    （`packages/app-host` 的 `createTaskActions.remove` 只写一条墓碑，
 *    完全不看 `parentId`）。两种选择都有真实代价（级联删除对用户是
 *    "一次操作删掉很多条"，上提会让清单突然多出一堆散任务），所以
 *    **留给产品决策**，本轮只提供 {@link descendantIds} 这种纯查询原语，
 *    让决策落地时不必再写第二份遍历。
 *
 * ## 与 `Task.order` 的关系
 *
 * 同级排序的**单点定义**是 {@link compareTaskSiblings}：
 * `order` 升序 → `createdAt` 升序 → `id` 字典序。`order` 目前是**死字段**
 * （没有任何一处写它，见 B0-5），所以今天的行为等价于 app-host 的
 * `byCanonicalOrder`；B0-5 把 `order` 接上拖拽之后**只需改这一个函数**，
 * 两端顺序就一起变。
 */

import type { Task } from './entities.js';

// ─────────────────────────────────────────────────────────────
// 上限：单点定义
// ─────────────────────────────────────────────────────────────

/**
 * 允许的最大**深度**。顶层任务的深度是 `0`，它的子任务是 `1`，依此类推。
 *
 * 所以 `3` = 最多 4 层：顶层 → 子 → 孙 → 曾孙。
 *
 * 为什么是 3 而不是"随便更深"：滴答清单的实际用法基本停在两层
 * （任务 + 子任务），三层给"子任务再拆"留了余量，同时把**环和超深数据
 * 的爆炸半径**钉死。更深不是能力，是"用户永远折叠不到底"。
 *
 * 🔴 **改这个值只改这里一处。** 校验、构建期的违规上报都读它。
 */
export const MAX_SUBTASK_DEPTH = 3;

/**
 * 单个父任务允许的**直接子任务**数上限。
 *
 * 这不是产品玩法上的限制，而是**病态数据的闸门**：一个父挂一万个子任务时，
 * 折叠/展开与计数都会卡住，而没有任何一处会报错。`100` 足够覆盖真实用法。
 *
 * 🔴 **改这个值只改这里一处。**
 */
export const MAX_SUBTASK_CHILDREN = 100;

// ─────────────────────────────────────────────────────────────
// 基础查询
// ─────────────────────────────────────────────────────────────

/**
 * 任务的父任务 ID；`undefined` = 顶级任务。
 *
 * 🔴 这是「什么是顶级」的**唯一**定义处。各端不要自己写
 * `task.parentId ?? undefined`（它看着等价，但它把语义复制了一份，
 * 将来加"父亲已删除也算顶级"时必然漂移）。
 */
export function parentIdOf(task: Task): string | undefined {
  return task.parentId;
}

/** 该任务是不是顶级任务（没有父）。 */
export function isTopLevel(task: Task): boolean {
  return parentIdOf(task) === undefined;
}

/**
 * 同级排序：`order` 升序 → `createdAt` 升序 → `id` 字典序。
 *
 * 三级决胜缺一不可：`order` 未接线时前一级全部相等；`createdAt` 来自
 * 毫秒时钟，同一台设备连续建两条经常落在同一毫秒；最后必须用 `id`
 * 打破平局，否则顺序退化成 `Object.values` 的枚举顺序 —— 那是
 * **各端不同**的（IndexedDB 按索引键、SQLite 按主键）。
 *
 * `order` 为 `undefined` 的任务排在已显式排序的任务**之后**
 * （而不是当成 `0`）：把一个没排过序的新任务当成"最前面"会让它在
 * 用户拖拽过任何东西之后莫名插队。
 */
export function compareTaskSiblings(a: Task, b: Task): number {
  const ao = a.order;
  const bo = b.order;
  if (ao !== undefined || bo !== undefined) {
    if (ao === undefined) return 1;
    if (bo === undefined) return -1;
    if (ao !== bo) return ao - bo;
  }
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ─────────────────────────────────────────────────────────────
// 树
// ─────────────────────────────────────────────────────────────

/** 树里的一个节点。 */
export interface TaskTreeNode {
  readonly task: Task;
  /** 顶层为 `0`。 */
  readonly depth: number;
  readonly children: readonly TaskTreeNode[];
}

/** 构建期发现的、违反上限的数据（**只上报，不截断**）。 */
export interface TaskTreeLimitViolation {
  readonly kind: 'depth' | 'children';
  /** 违规的父任务 id（`depth` 时是那个太深的节点自身）。 */
  readonly taskId: string;
  readonly actual: number;
  readonly limit: number;
}

/**
 * 扁平任务列表 → 森林。
 *
 * 返回的 `roots` / `children` 都按 {@link compareTaskSiblings} **稳定排序**，
 * 于是同一份数据在任何设备上得到逐节点相同的树。
 *
 * 三种**异常数据**都不会被静默吞掉，也不会让构建失败，而是被提到顶级并
 * 记录在报告里：
 *
 *   - `detached`：`parentId` 指向**根本不存在**的任务；
 *   - `promotedFromDeletedParent`：`parentId` 指向一个**已软删除**的任务；
 *   - `brokenCycles`：数据里存在环（或自指），被强制打断的节点；
 *   - `limitViolations`：深度 / 直接子数超限（**保留子树，只上报**）。
 *
 * 🔴 **`promotedFromDeletedParent` 不是"删除级联"这个产品决策的答案。**
 * 它只是**不一致数据的读时安全网**：删除动作（`packages/app-host` 的
 * `remove`）目前只写墓碑、**完全不看 `parentId`**，所以"父已删除但子还活着"
 * 这种数据现在就可能出现。这里选择把它**提到顶级显示**（保守做法：
 * 绝不把用户还活着的数据藏起来），并把事实**如实上报**。产品决策落地后
 * （选级联 → 子任务自己也会有墓碑；选上提 → 删除时把 `parentId` 清掉），
 * 这条路径就只会为历史数据服务。
 *
 * 已软删除（`deletedAt !== undefined`）的任务**自身不进树** ——
 * 墓碑是同步用的，不是给用户看的。
 */
export interface TaskTree {
  readonly roots: readonly TaskTreeNode[];
  readonly nodeById: ReadonlyMap<string, TaskTreeNode>;
  readonly detached: readonly string[];
  readonly promotedFromDeletedParent: readonly string[];
  readonly brokenCycles: readonly string[];
  readonly limitViolations: readonly TaskTreeLimitViolation[];
}

export function buildTaskTree(tasks: readonly Task[]): TaskTree {
  const alive: Task[] = [];
  const byId = new Map<string, Task>();
  const deletedIds = new Set<string>();
  for (const task of tasks) {
    if (task.deletedAt !== undefined) {
      deletedIds.add(task.id);
      continue;
    }
    // 同一 id 出现两次是上游数据问题；后者覆盖前者，只为让构建可终止。
    if (!byId.has(task.id)) alive.push(task);
    byId.set(task.id, task);
  }

  const parentOf = new Map<string, string | undefined>();
  const detached: string[] = [];
  const promotedFromDeletedParent: string[] = [];
  for (const task of alive) {
    const parentId = parentIdOf(task);
    if (parentId === undefined) {
      parentOf.set(task.id, undefined);
    } else if (parentId === task.id) {
      // 自指也是环，统一走 brokenCycles。
      parentOf.set(task.id, task.id);
    } else if (!byId.has(parentId)) {
      parentOf.set(task.id, undefined);
      if (deletedIds.has(parentId)) promotedFromDeletedParent.push(task.id);
      else detached.push(task.id);
    } else {
      parentOf.set(task.id, parentId);
    }
  }

  const brokenCycles = breakCycles(alive, parentOf);
  const depth = computeDepths(alive, parentOf);

  // 组装：迭代而不是递归 —— 深度上限是给"正常数据"定的，
  // 而这里要能扛住磁盘上已有的任意深度数据而不爆栈。
  const childIdsOf = new Map<string, string[]>();
  for (const task of alive) {
    const parentId = parentOf.get(task.id);
    if (parentId === undefined) continue;
    const bucket = childIdsOf.get(parentId);
    if (bucket === undefined) childIdsOf.set(parentId, [task.id]);
    else bucket.push(task.id);
  }
  for (const bucket of childIdsOf.values()) {
    bucket.sort((x, y) => compareTaskSiblings(byId.get(x) as Task, byId.get(y) as Task));
  }

  const nodeById = new Map<string, TaskTreeNode>();
  const roots: TaskTreeNode[] = [];
  const buildOrder: string[] = [];
  for (const task of alive) {
    if (parentOf.get(task.id) === undefined) buildOrder.push(task.id);
  }
  buildOrder.sort((x, y) => compareTaskSiblings(byId.get(x) as Task, byId.get(y) as Task));

  /**
   * 先把所有节点对象一次性建出来（children 数组先填好），再回填 `roots`。
   * `children` 用可变数组填充，返回类型是只读的 —— 调用方拿不到写入口，
   * 但构建过程不需要 `as` 转换。
   */
  const mutableNodeById = new Map<string, { task: Task; depth: number; children: TaskTreeNode[] }>();
  for (const task of alive) {
    mutableNodeById.set(task.id, {
      task,
      depth: depth.get(task.id) ?? 0,
      children: [],
    });
  }
  // 🔴 组装必须走**已排序**的 childIdsOf，不能走 `alive` 的插入顺序 ——
  //    插入顺序是 `Object.values` / 输入的枚举顺序，各端不同。
  for (const [parentId, childIds] of childIdsOf) {
    const parent = mutableNodeById.get(parentId);
    if (parent === undefined) continue;
    for (const childId of childIds) {
      const child = mutableNodeById.get(childId);
      if (child !== undefined) parent.children.push(child);
    }
  }
  for (const id of buildOrder) {
    const node = mutableNodeById.get(id);
    if (node !== undefined) roots.push(node);
  }
  for (const [id, node] of mutableNodeById) nodeById.set(id, node);

  return {
    roots,
    nodeById,
    detached,
    promotedFromDeletedParent,
    brokenCycles,
    limitViolations: collectLimitViolations(alive, depth, childIdsOf),
  };
}

/**
 * 打断数据里已存在的环。
 *
 * 做法：对每个节点沿父链向上走，遇到本次路径上已出现过的节点 = 环，
 * 把**环的入口**的父指针清掉并记录。每次打断都让图少一个环，所以
 * 外层循环最多跑 `n` 轮，不存在死循环。
 *
 * 为什么放在读路径而不是只靠写前校验：磁盘上/服务端库里可能已经有
 * 手改数据（或老版本写入）造成的环，只做写前校验的话，这些数据一打开
 * 就让 UI 无限递归。
 */
function breakCycles(
  tasks: readonly Task[],
  parentOf: Map<string, string | undefined>,
): string[] {
  const broken: string[] = [];
  const seenBroken = new Set<string>();
  for (let round = 0; round <= tasks.length; round += 1) {
    let foundThisRound = false;
    for (const task of tasks) {
      const onPath = new Set<string>();
      let current: string | undefined = task.id;
      while (current !== undefined) {
        if (onPath.has(current)) {
          parentOf.set(current, undefined);
          foundThisRound = true;
          if (!seenBroken.has(current)) {
            seenBroken.add(current);
            broken.push(current);
          }
          break;
        }
        onPath.add(current);
        current = parentOf.get(current);
      }
    }
    if (!foundThisRound) break;
  }
  return broken;
}

/** 每个节点的深度（顶层 0）。调用前必须已经打断环，否则父链上会绕圈。 */
function computeDepths(
  tasks: readonly Task[],
  parentOf: ReadonlyMap<string, string | undefined>,
): Map<string, number> {
  const depth = new Map<string, number>();
  for (const task of tasks) {
    let current = task.id;
    let steps = 0;
    for (;;) {
      const parent: string | undefined = parentOf.get(current);
      if (parent === undefined) break;
      current = parent;
      steps += 1;
      // 兜底：打断环之后不该再发生；真发生了也不能死循环。
      if (steps > tasks.length) break;
    }
    depth.set(task.id, steps);
  }
  return depth;
}

/**
 * 上限违规**只上报不截断**：树里保留超限的子树，用户的数据一条不少。
 * "静默截断"在这里是最坏的选项 —— 它会让任务凭空消失且不报错。
 */
function collectLimitViolations(
  tasks: readonly Task[],
  depth: ReadonlyMap<string, number>,
  childIdsOf: ReadonlyMap<string, readonly string[]>,
): TaskTreeLimitViolation[] {
  const violations: TaskTreeLimitViolation[] = [];
  for (const task of tasks) {
    const actualDepth = depth.get(task.id) ?? 0;
    if (actualDepth > MAX_SUBTASK_DEPTH) {
      violations.push({
        kind: 'depth',
        taskId: task.id,
        actual: actualDepth,
        limit: MAX_SUBTASK_DEPTH,
      });
    }
    const childCount = childIdsOf.get(task.id)?.length ?? 0;
    if (childCount > MAX_SUBTASK_CHILDREN) {
      violations.push({
        kind: 'children',
        taskId: task.id,
        actual: childCount,
        limit: MAX_SUBTASK_CHILDREN,
      });
    }
  }
  return violations;
}

// ─────────────────────────────────────────────────────────────
// 后代查询
// ─────────────────────────────────────────────────────────────

/**
 * `rootId` 的整棵子树（**含它自己**），按父先于子的顺序稳定排序。
 *
 * 纯查询原语：**它不决定删除怎么级联、移动是否带子树** —— 那些是未决的
 * 产品决策（见文件头）。它只是让那些决策落地时不必再写第二份遍历。
 */
export function descendantIds(tasks: readonly Task[], rootId: string): string[] {
  const byId = new Map<string, Task>();
  for (const task of tasks) {
    if (task.deletedAt === undefined && !byId.has(task.id)) byId.set(task.id, task);
  }
  if (!byId.has(rootId)) return [];

  const childrenOf = new Map<string, string[]>();
  for (const task of byId.values()) {
    const parentId = parentIdOf(task);
    if (parentId === undefined || !byId.has(parentId)) continue;
    const bucket = childrenOf.get(parentId);
    if (bucket === undefined) childrenOf.set(parentId, [task.id]);
    else bucket.push(task.id);
  }

  const result: string[] = [];
  const visited = new Set<string>();
  const stack: string[] = [rootId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (visited.has(id)) continue; // 数据里有环时的兜底
    visited.add(id);
    result.push(id);
    const children = childrenOf.get(id) ?? [];
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const child = children[i];
      if (child !== undefined) stack.push(child);
    }
  }
  return result;
}

/**
 * `candidateId` 是不是 `ancestorId` 的**严格**后代（不含它自己）。
 *
 * 这是循环防护的底座判据：`A` 的父能不能设成 `X`，等价于
 * 「`X` 是不是 `A` 的后代」。沿父链向上走，带访问集防止数据里已有环时死循环。
 */
export function isDescendantOf(
  tasks: readonly Task[],
  candidateId: string,
  ancestorId: string,
): boolean {
  if (candidateId === ancestorId) return false;
  const parentById = new Map<string, string | undefined>();
  for (const task of tasks) {
    if (task.deletedAt === undefined) parentById.set(task.id, parentIdOf(task));
  }
  const visited = new Set<string>();
  let current = parentById.get(candidateId);
  while (current !== undefined) {
    if (current === ancestorId) return true;
    if (visited.has(current)) return false; // 已有环，走不到结论
    visited.add(current);
    current = parentById.get(current);
  }
  return false;
}

// ─────────────────────────────────────────────────────────────
// 写前校验：循环 / 上限
// ─────────────────────────────────────────────────────────────

/** 改父被拒绝的原因。**每个取值都要有测试**，且必须是可给用户看的（i18n 由 UI 层做）。 */
export type ParentChangeRejection =
  | 'task_not_found'
  | 'parent_not_found'
  | 'self'
  | 'cycle'
  | 'depth_exceeded'
  | 'children_exceeded';

/** 改父校验结果。 */
export type ParentChangeResult =
  | { readonly ok: true; readonly parentId: string | undefined }
  | { readonly ok: false; readonly reason: ParentChangeRejection };

/**
 * 把 `taskId` 的父设成 `newParentId`（`undefined` = 提为顶级）是否合法。
 *
 * 这是**唯一**的改父校验入口。判据（按检查顺序，先报最根本的错）：
 *
 * 1. `task_not_found` —— 被改的任务不存在（或已删除）。
 * 2. `parent_not_found` —— 新父不存在（或已删除）。
 * 3. `self` —— 自己当自己的父。
 * 4. 🔴 `cycle` —— 新父是**自己的后代**。这一条漏了会让树无限递归，
 *    是整个模块最关键的判据。
 * 5. `depth_exceeded` —— 移动后**子树最深节点**的深度会超过
 *    {@link MAX_SUBTASK_DEPTH}。注意用的是**整棵子树的高度**，不是只看
 *    被移动的那个节点 —— 只看它会让"把一棵 3 层深的子树挂到第 3 层下"
 *    悄悄造出 6 层数据。
 * 6. `children_exceeded` —— 新父的直接子任务数已达
 *    {@link MAX_SUBTASK_CHILDREN}（已经是它的子任务时不算重增）。
 *
 * 全部通过返回 `{ ok: true, parentId }` —— **`parentId` 原样回传**，
 * 调用方据此构造 op（`undefined` 表示清除字段，见 op-log 的 `null` 语义：
 * 真正写 op 时要用 `null` 表达"清除"，那是 `packages/app-host` 的事）。
 */
export function validateParentChange(
  tasks: readonly Task[],
  taskId: string,
  newParentId: string | undefined,
): ParentChangeResult {
  const byId = new Map<string, Task>();
  for (const task of tasks) {
    if (task.deletedAt === undefined) byId.set(task.id, task);
  }

  const task = byId.get(taskId);
  if (task === undefined) return { ok: false, reason: 'task_not_found' };

  if (newParentId === undefined) return { ok: true, parentId: undefined };

  if (newParentId === taskId) return { ok: false, reason: 'self' };
  const newParent = byId.get(newParentId);
  if (newParent === undefined) return { ok: false, reason: 'parent_not_found' };

  if (isDescendantOf(tasks, newParentId, taskId)) {
    return { ok: false, reason: 'cycle' };
  }

  const parentOf = new Map<string, string | undefined>();
  for (const candidate of byId.values()) parentOf.set(candidate.id, parentIdOf(candidate));

  const movedHeight = subtreeHeight(parentOf, taskId);
  const newParentDepth = depthOf(parentOf, newParentId);
  if (newParentDepth + 1 + movedHeight > MAX_SUBTASK_DEPTH) {
    return { ok: false, reason: 'depth_exceeded' };
  }

  const alreadyChild = parentIdOf(task) === newParentId;
  if (!alreadyChild && countDirectChildren(parentOf, newParentId) >= MAX_SUBTASK_CHILDREN) {
    return { ok: false, reason: 'children_exceeded' };
  }

  return { ok: true, parentId: newParentId };
}

/** 布尔便捷版；需要向用户解释原因时用 {@link validateParentChange}。 */
export function canSetParent(
  tasks: readonly Task[],
  taskId: string,
  newParentId: string | undefined,
): boolean {
  return validateParentChange(tasks, taskId, newParentId).ok;
}

/** 节点到根的距离；顶层为 0。带访问集，数据里有环也不会死循环。 */
function depthOf(parentOf: ReadonlyMap<string, string | undefined>, id: string): number {
  const visited = new Set<string>();
  let current: string | undefined = id;
  let steps = 0;
  while (true) {
    const parent = parentOf.get(current);
    if (parent === undefined) return steps;
    if (visited.has(parent)) return steps; // 有环时的兜底
    visited.add(parent);
    current = parent;
    steps += 1;
  }
}

/** 子树里最深的那个后代相对 `id` 的距离（`id` 自己是 0）。 */
function subtreeHeight(
  parentOf: ReadonlyMap<string, string | undefined>,
  id: string,
): number {
  const childrenOf = new Map<string, string[]>();
  for (const [childId, parentId] of parentOf) {
    if (parentId === undefined) continue;
    const bucket = childrenOf.get(parentId);
    if (bucket === undefined) childrenOf.set(parentId, [childId]);
    else bucket.push(childId);
  }
  let height = 0;
  const visited = new Set<string>();
  const stack: Array<{ id: string; level: number }> = [{ id, level: 0 }];
  while (stack.length > 0) {
    const { id: currentId, level } = stack.pop() as { id: string; level: number };
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    if (level > height) height = level;
    for (const child of childrenOf.get(currentId) ?? []) {
      stack.push({ id: child, level: level + 1 });
    }
  }
  return height;
}

/** `parentId` 的直接子任务数（只算未删除的）。 */
function countDirectChildren(
  parentOf: ReadonlyMap<string, string | undefined>,
  parentId: string,
): number {
  let count = 0;
  for (const candidate of parentOf.values()) {
    if (candidate === parentId) count += 1;
  }
  return count;
}

// ─────────────────────────────────────────────────────────────
// 为什么加一个可选字段不用 bump schema（实测证据）
// ─────────────────────────────────────────────────────────────
/**
 * 结论：**不需要**。`parentId` 只是 `TASK` op 的 payload 里多一个字段。
 *
 *   1. **reducer 是逐字段合并**。`packages/op-log/src/state.ts` 的
 *      `applyOperation`（CREATE/UPDATE 分支）形状是
 *      `{ ...(existing ?? {}), ...incoming, ... }`，注释原文：
 *      "CREATE / UPDATE 合并语义：只覆盖 payload 里出现的字段"。
 *      它按字段名合并，**没有任何按实体类型写死的字段白名单 / 校验表** ——
 *      所以未知字段会被原样物化，老客户端读到带 `parentId` 的 op 也不会报错。
 *   2. **线协议对 payload 字段是开放的**。`packages/shared-schema/src/
 *      supersync-http-contract.ts` 的 payload schema 全是 `.passthrough()`
 *      （该文件 218–346 行连续 14 处），未知字段不会被 zod 剥掉。
 *   3. **`Task` 的其它可选字段走的就是同一条路**。`repeatRule` /
 *      `repeatDtstart` / `purgedAt` 都是"直接加在 `Task` 上、不 bump"
 *      的既有先例（`entities.ts` 里各自写着理由），本字段与它们同形。
 *   4. **可选 + 运行时默认值**：`parentId?: string`，`undefined` = 顶级。
 *      已落盘的数据没有这个字段，读出来就是 `undefined` = 顶级 —— 语义正确，
 *      不需要迁移（AGENTS.md §3.3）。
 *
 * 因此本轮**没有**改 `packages/shared-schema` / `packages/op-log` /
 * `server/`。真正需要 host 侧配合的是"把 `parentId: null` 写进 op 才能表达
 * 清除"（op-log 的 `null` = 删字段语义），那是 `packages/app-host` 的活。
 */
