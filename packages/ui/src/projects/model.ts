/**
 * 清单 / 标签的**纯逻辑**层
 * ============================
 *
 * M3 第九刀（projects）的判断层：一个 Project / Tag 列表**怎么变成可渲染的行**
 * （顶层 vs 子级、每行挂几个未完成任务、哪些算已归档），以及"点某一行的
 * 结果是什么"。组件（`OrganizerList.tsx`）里因此没有分支，只负责摆。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这个文件里**不许 import `react-native`**
 *
 * 与 `task-list/model.ts` / `habits/model.ts` 同一条硬约束：
 * `packages/ui/vitest.config.ts` 跑在 **node** 环境，RN 是 Flow 源码、node 解析不了。
 * 一旦这里 import 了 RN，测试会立刻挂 —— 等于用测试免费钉住"宿主无关"。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 判断只有一份：这些选择器原先住在 `apps/web/src/features/projects/store.ts`
 *
 * 迁移前 `selectTopLevelProjects` / `selectChildProjects` 是**web store 里的两个
 * 导出**，而移动端的 `ListsSection` 直接把 `listProjects()` 的原数组渲染成一段
 * 平表 —— 于是"清单有且只有一层嵌套"这条领域规则在两个端上表现为
 * **两种不同的界面**（web 分层、mobile 不分层），而且差异不会让任何测试变红。
 * 现在两个选择器都在这里，两端共用；移动端因此第一次真的按层级渲染。
 *
 * ⚠️ **排序不在这里做。** "哪些算未删除、按什么顺序"由 `@heyta/app-host` 的
 * `listProjects()` 决定（`createdAt` 升序、同刻按 id）。这里只按**给定的顺序**
 * 拆层级，不重排 —— 两端各排一次就会出现"同样的数据两种顺序"。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 没装进共享层的（逐条写清：证据 + 影响 + 最小一步）
 *
 * 1. **"新建清单 / 标签"的输入框与按钮**留在各端。web 是 DOM `<form><input>`
 *    （要处理 iOS Safari 聚焦缩放：字号 ≥16px），mobile 是 kit 的
 *    `TextField` + `Button`（44px 字段高、label/placeholder 分离）。
 *    与 `habits` 那一刀同一条处置（HabitBoard 只管列表、composer 留宿主）：
 *    强行共享会逼一个端放弃自己的输入控件规范。
 *    · 影响：两处外观不同；但"能不能建"没有第二份判断（空名字由
 *      `@heyta/app-host#createProjectActions` 抛错，界面只判"空回车不做"）。
 *    · 最小一步：给 `packages/ui` 加一个 composer（`TextInput` + `Pressable`），
 *      两端各做一次截图验收。
 *
 * 2. **取色入口**留在各端（本组件给的是 `renderItemExtra` 插槽）。web 是
 *    `features/categories/ColorSlotPicker.tsx`（DOM，展开式 + `Esc`），
 *    mobile 目前**没有**清单/标签的取色入口（色是在分类屏设的）。
 *    "槽位 → 颜色 token"的映射只有一处（`categories/model.ts#categorySlotToken`）。
 *    · 最小一步：mobile 接上 `ui/slot-picker.tsx`（那一刀属于分类，不属于本刀）。
 *
 * 3. **删除确认**不在这里：web 的删除是**直接删**（无二次确认），mobile 也是。
 *    · 最小一步：行尾 `•••`（宿主插槽）或详情层，先要产品定"删除要不要确认"。
 *
 *    ✅ **「改名 / 归档界面从未接上」这句已过期（2026-10-03，多端第三批）**：
 *    行内编辑器在 `OrganizerList` 里，两端都已传 `onRename` / `onArchive`
 *    （`apps/mobile/src/screens/ListsSection.tsx`、`TagsSection.tsx`，
 *    web 的 `features/projects/ProjectsPanel.tsx`）。判据：
 *    `apps/mobile/tests/organizer-rename.spec.ts`。
 *    留原文是为了让后来者认得出"零件都在、没人接线"这个形状。
 *
 * 4. **`archived` 的显示开关**：本文件的 `aliveProjects` 一律**隐藏**归档清单
 *    （与迁移前的 web 选择器逐字一致）。判据本身在 `@heyta/domain` 的 `isArchived`，
 *    这里不写第二份 —— W9 之后动作层也要判同一件事（`listProjects()` 藏归档、
 *    `listArchivedProjects()` 只留归档），两份字面量迟早分叉。
 *    ⚠️ 正因为动作层从 W9 起会滤掉归档，宿主喂给本文件的必须是
 *    `listAllProjects()`（两路合并）而不是 `listProjects()` —— 只喂一路的话，
 *    这里的 `includeArchived` 就没有数据可放出来，开关按了什么都不出现。
 *    ✅ "显示已归档"这一刀**已做**（2026-10-03）：`toOrganizerTree(projects,
 *    { includeArchived })` + `archivedProjects()`，两端的开关都在
 *    `archivedCount > 0` 时才画出来 —— 没有已归档清单时不占一行。
 */

import { isArchived, type Project, type Tag, type Task } from '@heyta/domain';

/* ========================================================================
 * 一、行模型
 * ====================================================================== */

/** 清单与标签共同的**最小**行字段集 —— 组件只认识这几样。 */
export interface OrganizerItem {
  readonly id: string;
  readonly name: string;
  /**
   * 这一行是不是**已归档**（只有清单有；`Tag` 没这个字段）。
   *
   * 🔴 它存在的理由不是"多显示一个标记"，而是**让取消归档可达**：归档位一旦按下，
   *    如果宿主不能把已归档的行也交回列表，那这条清单就再也回不来（两侧都没有
   *    已归档视图）。`OrganizerList.onArchive` 传的是**目标状态**，
   *    而目标状态要从这一行的真实状态推出来。
   * ⚠️ 默认 `undefined`（= 不是已归档），所以两端不传时渲染与从前逐字相同。
   */
  readonly archived?: boolean;
}

/**
 * 一行清单（顶层），带它的**一层**子清单。
 *
 * 🔴 领域层明确不支持任意深度（`Project.parentId` 的注释），所以这里的
 * `children` 是 `OrganizerItem[]` 而不是 `OrganizerNode[]` —— 类型本身就
 * 表达了"不能再嵌"。用递归类型会让"两层就够了"这条规则变成一个运行时约定。
 */
export interface OrganizerNode extends OrganizerItem {
  readonly children: readonly OrganizerItem[];
}

/* ========================================================================
 * 二、清单：拆层级
 * ====================================================================== */

/**
 * 默认只留**未归档**的清单（归档 = 隐藏但保留数据，`Project.archived` 的注释）。
 *
 * 🔴 `includeArchived` 不是"多显示一档"，是**让取消归档可达**：默认过滤掉归档行，
 *    而界面上又没有别的已归档视图，那么任何一次归档都是**单向门** ——
 *    数据还在、同步也正常，只是永远回不来。宿主开了这个开关，
 *    就必须同时给 `OrganizerList` 传 `onArchive`（它按行的 `archived` 决定传哪个目标值）。
 */
export function aliveProjects(
  projects: readonly Project[],
  includeArchived = false,
): Project[] {
  if (includeArchived) return [...projects];
  return projects.filter((project) => !isArchived(project));
}

/**
 * 已归档的清单（`archived === true` 那部分）。
 *
 * 🔴 有它是因为「要不要把『显示已归档』这个开关画出来」取决于**有没有已归档的清单**，
 * 而"哪几条算已归档"是领域判断。两端各写一遍 `filter(p => p.archived === true)`
 * 就是两份口径 —— 一边写 `=== true`、一边写 `!!p.archived`，
 * 在 `archived?: boolean` 上眼下等价，将来加第三种状态时只会有一边跟着变。
 */
export function archivedProjects(projects: readonly Project[]): Project[] {
  return projects.filter(isArchived);
}

/** 顶层清单（无 `parentId`）。 */
export function topLevelProjects(
  projects: readonly Project[],
  includeArchived = false,
): Project[] {
  return aliveProjects(projects, includeArchived).filter(
    (project) => project.parentId === undefined,
  );
}

/** 某个清单下的子清单（**一层**）。 */
export function childProjects(
  projects: readonly Project[],
  parentId: string,
  includeArchived = false,
): Project[] {
  return aliveProjects(projects, includeArchived).filter(
    (project) => project.parentId === parentId,
  );
}

/**
 * 清单 → 可渲染的树（顶层 + 一层子级），**保持输入顺序**。
 *
 * ⚠️ 默认（不开 `includeArchived`）时，父 id 指向一条**已归档 / 不存在**的清单，
 * 子清单会从界面上消失 —— 与迁移前的 web 选择器逐字一致。这是已知取舍：
 * 一个孤儿清单不显示，比把它当成顶层清单**冒充**一个用户没设过的位置更好。
 * ✅ 开了 `includeArchived` 就没有这个副作用：归档的父也在树上，子级跟着它。
 */
export function toOrganizerTree(
  projects: readonly Project[],
  options?: { readonly includeArchived?: boolean },
): OrganizerNode[] {
  const includeArchived = options?.includeArchived === true;
  return topLevelProjects(projects, includeArchived).map((project) => ({
    id: project.id,
    name: project.name,
    archived: project.archived === true,
    children: childProjects(projects, project.id, includeArchived).map((child) => ({
      id: child.id,
      name: child.name,
      archived: child.archived === true,
    })),
  }));
}

/* ========================================================================
 * 三、任务计数
 * ====================================================================== */

/**
 * 某个清单下**未完成、未删除**的任务数。
 *
 * 🔴 三个条件缺一不可，而它们的组合就是"用户在清单里还看得见几条"：
 *   · `deletedAt === undefined` —— 回收站里的不算；
 *   · `completedAt === undefined` —— 完成的不算（与 `filterTasks` 的
 *     `project` 分支同一条语义，见 `@heyta/domain#task-filter`）；
 *   · `projectId === id`。
 *
 * ⚠️ 迁移前 web 的 `countIn` 是**每渲染一个清单就遍历一次全部任务**
 * （O(清单 × 任务)）。这里额外给 `openTaskCounts` 一次遍历出整张表 ——
 * 计数口径与单条版**共用同一个 `countsTowardProject`**，不会漂。
 */
function countsTowardProject(task: Task, projectId: string): boolean {
  return (
    task.deletedAt === undefined &&
    task.completedAt === undefined &&
    task.projectId === projectId
  );
}

export function openTaskCount(tasks: readonly Task[], projectId: string): number {
  let count = 0;
  for (const task of tasks) {
    if (countsTowardProject(task, projectId)) count += 1;
  }
  return count;
}

/**
 * 一次遍历算出所有清单的未完成任务数。
 *
 * 返回普通对象而不是 `Map`：组件的 prop 是 `Readonly<Record<string, number>>`，
 * 而 `Map` 会让"传进来的到底是什么"多一种可能（`Map` 也能当对象索引，
 * 但取不到就是 `undefined` —— 那正是"计数位静默消失"的形状）。
 */
export function openTaskCounts(tasks: readonly Task[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const task of tasks) {
    const projectId = task.projectId;
    if (projectId === undefined) continue;
    if (!countsTowardProject(task, projectId)) continue;
    counts[projectId] = (counts[projectId] ?? 0) + 1;
  }
  return counts;
}

/**
 * 这条任务**属于哪条清单**（行内归属徽章的文案）。
 *
 * 🔴 判断只有一份：web 原先在 `TaskOrganizer` 的 chip 里自己查一次名字，
 * 移动端则**根本不显示归属**（要点开详情才看得见）。同一件信息一端常驻、
 * 一端藏起来，就是 §3.5 那条"两处实现迟早漂移"的形状。
 *
 * 三条取值规则，逐条都是**界面上看得出来的**决定：
 *
 * - `projectId === undefined` → **`inboxLabel`（照显示徽章）**。
 *   依据是参照图那一行写的是「收集箱 · 昨天」—— 归属位不是"挂了哪条清单"，
 *   而是"这条在哪"，收集箱也是答案。
 *   ⚠️ 这一条**改过一轮**：原先给的是 `null`，理由是"无归属与悬空 id 会看起来
 *   一样"。那个理由不成立 —— 悬空 id 走下面那条分支给 `null`，两种状态在界面上
 *   本来就分得开（有徽章 / 没徽章），而"收集箱不出现在行上"却让 web 与移动端
 *   都和参照图不一致。**记下来是因为它差点被当成显然的事。**
 * - 查不到（悬空 id）→ `null`：**不猜**。清单被删掉时任务留在收集箱是
 *   `app-host` 的判断，这里不重复它 —— 所以也不给一个"看起来像收集箱"的徽章。
 * - 命中但 `name` 是空串 → `null`：一个没有字的徽章只是图标，
 *   而图标在行内没有无障碍名就是噪音。
 *
 * ⚠️ `inboxLabel` 由**宿主**传而不是在这里取词条：`@heyta/ui` 的依赖里没有
 * `@heyta/i18n`（见本包 `package.json`）。这符合本仓库既有分工 ——
 * **判断只有一份，说法各端各写**（`apps/web/src/lib/due-display.ts` 先例）：
 * "该显示什么"仍然只在这里决定，宿主只交一个名词。
 *
 * ⚠️ **不在这里过滤 `archived`**："这条属于哪条清单"与"这条清单还在不在列表里"
 * 是两件事 —— 归档清单里的任务仍然属于它，把徽章藏起来等于抹掉一条真信息。
 */
export function listNameFor(
  projects: readonly Project[],
  projectId: string | undefined,
  inboxLabel: string,
): string | null {
  if (projectId === undefined) return inboxLabel;
  const hit = projects.find((project) => project.id === projectId);
  if (hit === undefined || hit.name === '') return null;
  return hit.name;
}

/* ========================================================================
 * 四、标签
 * ====================================================================== */

/**
 * 未删除的标签 → 行模型。
 *
 * ⚠️ `Tag` **没有** `archived`（与 `Project` 不同）—— 所以这里不过滤归档，
 * 只把 `id` / `name` 投影出来。凭直觉给它加一个 `archived` 过滤会静默
 * 隐藏所有标签（字段不存在 → `!== true` → 全留；若写反则全丢）。
 */
export function toTagItems(tags: readonly Tag[]): OrganizerItem[] {
  return tags.map((tag) => ({ id: tag.id, name: tag.name }));
}

/**
 * 一次遍历算出所有标签的未完成任务数。
 *
 * 🔴 **口径必须与 `countsTowardProject` 逐字相同**（未删除 + 未完成），
 * 否则侧栏两节（清单 / 标签）的同一个数字会长成两种含义 —— 而这两节在同一个
 * `OrganizerList` 里，用户只会看出"对不上"，说不出哪一层错。
 * 一条任务可以挂多个标签，所以它给**每个**标签各加一（不是加总数）——
 * 标签那节的数字是"这个标签下有几件没做完"，不是"这批任务有几件"。
 *
 * 返回普通对象而不是 `Map`：理由同 `openTaskCounts`（取不到就是 `undefined`，
 * 那正是"计数位静默消失"的形状）。
 */
export function openTagCounts(tasks: readonly Task[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const task of tasks) {
    if (task.deletedAt !== undefined || task.completedAt !== undefined) continue;
    for (const tagId of task.tagIds ?? []) {
      counts[tagId] = (counts[tagId] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * 平铺的行模型 → 树（每行都没有子级）。
 *
 * 标签用它：`Tag` 没有父子关系，但**必须**与清单走同一个 `OrganizerList`
 * （那是本刀的全部意义）。留一个"宿主可以自己拼"的口子，下一个端就会自己拼 ——
 * 而那种漂移不会让任何测试变红。
 */
export function toOrganizerNodes(items: readonly OrganizerItem[]): OrganizerNode[] {
  // 整条 spread 而不是逐字段挑：漏一个字段（这里是 `archived`）的表现是
  // "那一行永远显示成未归档"，而归档按钮于是永远说「归档」。
  return items.map((item) => ({ ...item, children: [] }));
}

/* ========================================================================
 * 五、稳定 key
 * ====================================================================== */

/**
 * 行的 React key。
 *
 * 🔴 清单与标签是**两个实体**，id 由同一个 `randomId()` 生成、理论上可能撞。
 * 而它们会被渲染在同一个父节点下（宿主把两块放进同一棵树的相邻位置时），
 * 撞 key 会让 React 复用错的那一行 —— 表现为"删了一个，另一个闪了一下"。
 * 所以 key 带前缀，而不是裸 id。
 */
export function organizerRowKey(kind: 'project' | 'tag', id: string): string {
  return `${kind}-${id}`;
}
