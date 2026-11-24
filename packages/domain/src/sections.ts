/**
 * 清单内分组的领域规则 —— **"哪些分组、按什么序、任务归哪一组"只有一个定义**
 * ==========================================================================
 *
 * 实体形状在 `entities.ts` 的 {@link Section}（ADR-0091 定案：分组是**独立实体**，
 * 一层归属到清单），op 的构造在 `packages/app-host/src/section-actions.ts`；
 * 这里只有**纯函数**。
 *
 * ## 为什么这些判定必须住在这里
 *
 * 三条判定跨端必须一致，任何一条写在组件里，第二个宿主（本机 API / CLI /
 * 移动端）要用就得抄一遍：
 *
 * 1. **分组顺序**（`bySectionOrder`）：`order` 升序，缺席的排在显式值之后，
 *    同序按 `createdAt` 升序、再按 id 字典序。缺了 id 那一段，同一份数据在
 *    两台设备上顺序可能不同（`createdAt` 来自毫秒时钟，同一毫秒很常见）。
 * 2. **悬空 `sectionId` 归「未分组」**（{@link groupTasksBySection}）：
 *    分组被软删 / 从不存在 / 属于别的清单时，其下任务必须归入「未分组」，
 *    **不丢**。这是 ADR-0048 四态在分组上的落点，也是 ADR-0091 §6 明写
 *    "任何读分组的地方都要做"的那一条。判据写两处，就会出现"电脑上删掉的分组、
 *    手机上的任务凭空消失"。
 * 3. **分组标题校验**（{@link sectionRejection}）：空白算空、超长拒绝。
 *
 * ## 为什么 `inTrash` / `byDeletedOrder` 在这里**不被复用**
 *
 * 它们在 `entities.ts` 里管的是**回收站**（最近删除在前、要求有墓碑）。
 * 分组排序要的是**存活 + 升序**，方向相反。这里只复用实体级的 {@link isLive}。
 *
 * 🔴 **彻底删除（`purgedAt`）不需要另判**：purge 只作用在已软删的实体上，
 * `purgedAt !== undefined` 必然伴随 `deletedAt !== undefined`，被 {@link isLive}
 * 一并滤掉（与 `comments.ts` 文件头同一条依赖）。
 */

import { isLive, type Section } from './entities.js';

/**
 * 分组标题的长度上限（字符数）。
 *
 * 🔴 **常量只有这一份定义**：`packages/ui` 与动作层都从这里取，不再各写一个字面量。
 * 两份上限的表现是"界面允许提交、动作层拒绝"（或反过来），两边都不报错。
 */
export const SECTION_NAME_MAX_LENGTH = 60;

/** 建分组 / 改名的拒绝原因。**返回原因而不是抛错** —— 调用方要能给出提示。 */
export type SectionRejection = 'empty' | 'too-long';

/**
 * 校验分组标题。合法则返回 `undefined`。
 *
 * 🔴 **空白算空**（`trim()` 后判断）：一个全是空格的分组标题在清单上是一行
 * 看不见的字，而它会占掉一个分组头与它的计数。
 */
export function sectionRejection(name: string): SectionRejection | undefined {
  if (name.trim().length === 0) return 'empty';
  if (name.length > SECTION_NAME_MAX_LENGTH) return 'too-long';
  return undefined;
}

/**
 * 分组的最小读面：排序与归组只用到这几格。
 *
 * 泛型到 `SectionLike` 而不是死盯 `Section`，是因为调用方除了真实体，
 * 还会递进 `MaterializedState['sections']` 的值与 UI 的视图模型。
 * **多出来的字段一律不读。**
 */
export interface SectionLike {
  id: string;
  /** 归属清单。 */
  projectId: string;
  /** 标题；排序不读，归组之外的展示用。 */
  name?: string;
  /** 排序键；缺席排在显式值之后。 */
  order?: number;
  /** 创建时刻（epoch ms）。缺席按 0。 */
  createdAt?: number;
  /** 软删除墓碑。在 = 这个分组不可见。 */
  deletedAt?: number;
  /** 彻底删除标记（必然伴随 `deletedAt`，见文件头）。 */
  purgedAt?: number;
}

/**
 * 分组顺序：`order` 升序（缺席排在显式值之后），同序按 `createdAt` 升序，
 * 再同刻按 id 字典序。
 *
 * 单独导出，让"分组清单"与"归组结果"两个出口共用同一个比较器 ——
 * 比较器写两遍，两遍的决胜项就可能不一样。
 */
export function bySectionOrder(a: SectionLike, b: SectionLike): number {
  const ao = typeof a.order === 'number' ? a.order : Number.POSITIVE_INFINITY;
  const bo = typeof b.order === 'number' ? b.order : Number.POSITIVE_INFINITY;
  if (ao !== bo) return ao < bo ? -1 : 1;
  const ac = a.createdAt ?? 0;
  const bc = b.createdAt ?? 0;
  if (ac !== bc) return ac - bc;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 某个清单下**存活**的分组，按 {@link bySectionOrder} 排序（含空分组）。 */
export function sectionsOfProject<T extends SectionLike>(
  sections: readonly T[],
  projectId: string,
): T[] {
  return sections
    .filter((section) => section.projectId === projectId && isLive(section))
    .sort(bySectionOrder);
}

/**
 * 这个清单下一个新分组应该用的 `order`：现有显式值的最大值 + 1。
 *
 * 全都没设过 `order` 时返回 0（而不是按个数算）—— 个数会把"删掉中间一个"
 * 也算进去，导致新旧分组撞序；只看显式最大值是确定的。
 */
export function nextSectionOrder(sections: readonly SectionLike[], projectId: string): number {
  let max = -1;
  for (const section of sectionsOfProject(sections, projectId)) {
    if (typeof section.order === 'number' && section.order > max) max = section.order;
  }
  return max + 1;
}

/** 归组读面需要的最小任务字段。 */
export interface SectionTaskLike {
  id: string;
  projectId?: string;
  sectionId?: string;
  deletedAt?: number;
  purgedAt?: number;
}

/**
 * 一条任务**实际归到哪个分组**：`sectionId` 指向的分组必须「存活 + 属于同一条清单」，
 * 否则返回 `undefined`（= 未分组）。
 *
 * 🔴 这是"悬空 `sectionId` 归未分组"这条判定的**唯一实现**。读侧不要各写一遍
 * `task.sectionId && sections[...]` —— 那样删了分组之后任务可能既不在原组
 * 也不在未分组，直接消失。
 */
export function resolveTaskSectionId<T extends SectionLike>(
  task: SectionTaskLike,
  sections: readonly T[],
): string | undefined {
  const sectionId = task.sectionId;
  if (sectionId === undefined) return undefined;
  const section = sections.find((candidate) => candidate.id === sectionId);
  if (section === undefined || !isLive(section)) return undefined;
  if (section.projectId !== task.projectId) return undefined;
  return sectionId;
}

/** 一条任务分组：`section` 缺席的那个就是「未分组」。 */
export interface TaskSectionGroup<TTask extends SectionTaskLike, TSection extends SectionLike> {
  /** 分组 id；`undefined` = 未分组。 */
  readonly sectionId: string | undefined;
  /** 分组实体；`undefined` = 未分组。 */
  readonly section: TSection | undefined;
  /** 组内任务（**未排序** —— 组内顺序由调用方按 `sortTasks` 决定）。 */
  readonly tasks: readonly TTask[];
}

/**
 * 把一条清单的任务按分组归好：**每个存活分组一组（含空组），未分组在最后**。
 *
 * 规则：
 * - 只算这条清单下、存活的（`isLive`）任务；
 * - `sectionId` 悬空 / 已删 / 属于别的清单 ⇒ 归「未分组」（{@link resolveTaskSectionId}）；
 * - **未分组那一组只在有任务时出现** —— 一条都没有时画一个「未分组 0」是纯噪音；
 * - 空分组**保留**（ADR-0091：用户建完组还没拖任务进去，组不能消失）。
 *
 * ⚠️ 组内任务**不排序**：调用方按自己那档 `sortTasks` 排（与 `flattenSections`
 * 同一条分工 —— 比较规则只在 `@heyta/domain` 一份）。
 */
export function groupTasksBySection<TTask extends SectionTaskLike, TSection extends SectionLike>(
  tasks: readonly TTask[],
  sections: readonly TSection[],
  projectId: string,
): TaskSectionGroup<TTask, TSection>[] {
  const liveSections = sectionsOfProject(sections, projectId);
  const bySectionId = new Map<string, TaskSectionGroup<TTask, TSection>>();
  const groups: TaskSectionGroup<TTask, TSection>[] = liveSections.map((section) => {
    const group: TaskSectionGroup<TTask, TSection> = {
      sectionId: section.id,
      section,
      tasks: [],
    };
    bySectionId.set(section.id, group);
    return group;
  });
  const ungrouped: TTask[] = [];

  for (const task of tasks) {
    if (task.projectId !== projectId || !isLive(task)) continue;
    const resolved = resolveTaskSectionId(task, liveSections);
    const target = resolved === undefined ? undefined : bySectionId.get(resolved);
    if (target === undefined) {
      ungrouped.push(task);
    } else {
      (target.tasks as TTask[]).push(task);
    }
  }

  if (ungrouped.length > 0) {
    groups.push({ sectionId: undefined, section: undefined, tasks: ungrouped });
  }
  return groups;
}

/** 归一化一个分组标题（用于写载荷）：去掉首尾空白。校验仍走 {@link sectionRejection}。 */
export function normalizeSectionName(name: string): string {
  return name.trim();
}

/** 仅用于让 `Section` 的类型参与类型检查（避免 `SectionLike` 与真实体漂移）。 */
export type SectionEntity = Section;
