/**
 * 回收站的行（领域规则）
 * =========================
 *
 * 这一层回答的**不是**"回收站怎么画"，而是这三句产品语义：
 *
 *   1. **哪些类别在回收站里有行**（{@link TRASH_KINDS}）；
 *   2. **一行显示什么字**（任务/清单/习惯 = 名字原样，便签 = 首段非空行的摘要）；
 *   3. **多路并成一路时按什么序**（委托 {@link byDeletedOrder}，本文件不重写比较）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么住在领域层而不是 `packages/ui`
 *
 * 这三句原先在 `packages/ui/src/trash/model.ts` 里，而那是对的**一段时间** ——
 * 当时只有两个宿主（web、mobile），两个都是 UI 宿主。第三个宿主出现时它就不对了：
 * `apps/node-host` 的 CLI 要打印"这台设备回收站里有什么"，它**不能**依赖
 * `@heyta/ui`（那会把 `react-native` 拖进一个 node 进程），于是它只写了任务那一路。
 * 症状不是报错，而是**同一台设备的同一个回收站，CLI 少三类** —— 而验收脚本正是
 * 要靠 CLI 读笔记本侧（见 `scripts/verify-mobile-trash.sh` 判据 ④），
 * 少三类的那份输出会让"清单也跨设备进了回收站"这条根本没法证。
 *
 * 判断依据就是 AGENTS §3.5 那句：**这段代码里有没有任何一行在决定"业务上该怎么做"？**
 * 有。"便签这一行的标题是什么"与"清单算不算在回收站里"都是产品语义，
 * 所以它的家在这里，四个宿主（web / mobile / CLI / 验收脚本）都从这里取。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 规则一条都不在这里重写
 *
 * "什么算在回收站里" = {@link inTrash}；"回收站按什么序" = {@link byDeletedOrder}
 * （最近删除在前，同刻按 id 字典序）；"便签这行显示什么字" = {@link noteExcerpt}
 * 配上与便签列表**同一个**长度常量 {@link NOTE_EXCERPT_LENGTH}。
 * 本文件**只调用它们**：排序时把原实体带上、把比较委托过去，
 * 而不是在行形状上再写一遍 `bd - ad` + id 决胜。
 *
 * ⚠️ 但这里**确实又过了一遍 `inTrash`**，这不是"第二份答案"（同一个函数），
 * 而是 ADR-0048 的 I5 那条不变量的形状：**把原始物化表整张递进来也不许出现**。
 * 宿主已经滤过（动作层的 `listTrashed()`），所以正常情况下这是空操作；
 * 它挡的是下一次有人图省事直接 `Object.values(entities)` ——
 * 那一档的症状是"已彻底删除的条目又在回收站里躺着"。
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  byDeletedOrder,
  inTrash,
  isLive,
  type Habit,
  type Note,
  type Project,
  type Task,
} from './entities.js';
import { NOTE_EXCERPT_LENGTH, noteExcerpt } from './notes.js';

/**
 * 回收站能装哪几类 —— **这份数组就是那个集合的唯一所有者**。
 *
 * 类型从它派生（不是反过来），所以"加一类而忘了某一端"会在**编译期**红：
 * 宿主那张 `Record<TrashKind, …>` 少一路就过不了类型检查。
 * 它同时是一条对账判据的输入 —— 帮助文档那句"回收站里有什么"必须点名
 * 这里的**每一类**（`apps/landing/tests/trash-coverage-copy.spec.ts`）。
 *
 * 🔴 取值刻意与 `EntityType` 的字面量**同名**：徽标文案唯一的真源是
 * `common.entity.*` 那张表（`packages/ui/src/sync/model.ts` 的
 * `entityLabelKey`，它的键就是 `EntityType`）。这里另起一套 `'task' | 'note'`
 * 小写名，就会多一处需要长期维护的映射表。
 *
 * ⚠️ 加一种必须**同批**做三件事：
 *   1. 这里加字面量 + {@link TrashSources} 加一路 + 一个 `xxTrashItem`；
 *   2. 三个宿主的 `toTrashItems({...})` 调用点都补上那一路（web / mobile / CLI）；
 *   3. 两端 `run()` 的 `kind` 路由补上 restore/purge 两条。
 * 只加一半的症状**不是报错**，而是"这一类能还原却根本不出现在列表里"
 *（第 1、2 步漏一条），或"列表里有它但点还原什么都没发生"（第 3 步漏）。
 */
export const TRASH_KINDS = ['TASK', 'NOTE', 'PROJECT', 'HABIT'] as const;

export type TrashKind = (typeof TRASH_KINDS)[number];

/** 回收站里的一行。 */
export interface TrashItem {
  /** 实体 id：同时是 React key、`onRestore` / `onPurge` 的参数与 testID 后缀。 */
  readonly id: string;
  readonly kind: TrashKind;
  /** 这一行显示的字。任务 = 标题原样；便签 = {@link noteExcerpt}（首段非空行，超长带 `…`）。 */
  readonly title: string;
  /**
   * 删除时刻（epoch ms）。
   *
   * 🔴 类型上是**必填**的：它由类型谓词 {@link inTrash} 保证
   * （"算在回收站里"就意味着 `deletedAt` 有值）。原来这一格靠两端各自写
   * 一句 `deletedAt ?? updatedAt` 兜着，而注释说"两端必须一致" ——
   * 一个靠人记住的一致性就是没一致过。现在要么编译期过不了，要么走到这里。
   */
  readonly deletedAt: number;
}

/** 四路数据源，每一路都可以省略。 */
export interface TrashSources {
  readonly tasks?: readonly Task[];
  readonly notes?: readonly Note[];
  readonly projects?: readonly Project[];
  readonly habits?: readonly Habit[];
}

/**
 * 一条（躺在回收站里的）清单**现在装着几条活的任务**。
 *
 * 🔴 这句要出现在"彻底删除这条清单"的确认框里（W4 / P-1）：删清单**不级联删任务**
 *   （`project-actions.ts` 文件头第 2 条），所以用户必须知道"清单没了、里面的东西还在"，
 *   否则他会以为连着 N 条一起没了 —— 那是一个会让人**不敢点**的确认框。
 *
 * ⚠️ 数的是**活的任务**（{@link isLive}）：已删除与已彻底删除的都不算。
 *   用 `!inTrash()` 数会把已彻底删除的那几条算进来（它不在回收站、但也不活着）。
 */
export function liveTaskCountOfProject(tasks: readonly Task[], projectId: string): number {
  return tasks.filter((task) => task.projectId === projectId && isLive(task)).length;
}

/** 只收"确实带着 `deletedAt`"的那一条 —— 由 {@link inTrash} 的谓词保证。 */
function taskTrashItem(task: Task & { deletedAt: number }): TrashItem {
  return { id: task.id, kind: 'TASK', title: task.title, deletedAt: task.deletedAt };
}

function projectTrashItem(project: Project & { deletedAt: number }): TrashItem {
  return { id: project.id, kind: 'PROJECT', title: project.name, deletedAt: project.deletedAt };
}

function habitTrashItem(habit: Habit & { deletedAt: number }): TrashItem {
  return { id: habit.id, kind: 'HABIT', title: habit.name, deletedAt: habit.deletedAt };
}

function noteTrashItem(note: Note & { deletedAt: number }): TrashItem {
  return {
    id: note.id,
    // ⚠️ 摘要长度用 {@link NOTE_EXCERPT_LENGTH} —— 与便签列表**同一个常量**。
    // 在回收站里另写一个数字，同一条便签会在两个地方截在不同位置。
    kind: 'NOTE',
    title: noteExcerpt(note, NOTE_EXCERPT_LENGTH),
    deletedAt: note.deletedAt,
  };
}

/**
 * 把若干路回收站数据源并成**一个顺序确定**的列表（新数组，不改入参）。
 *
 * 宿主只并自己已有的那几路 —— 但"并"与"排"不许在宿主里各写一遍。
 */
export function toTrashItems(sources: TrashSources = {}): TrashItem[] {
  const rows: {
    readonly item: TrashItem;
    readonly entity: Habit | Note | Project | Task;
  }[] = [];
  for (const task of sources.tasks ?? []) {
    if (inTrash(task)) rows.push({ item: taskTrashItem(task), entity: task });
  }
  for (const note of sources.notes ?? []) {
    if (inTrash(note)) rows.push({ item: noteTrashItem(note), entity: note });
  }
  for (const project of sources.projects ?? []) {
    if (inTrash(project)) rows.push({ item: projectTrashItem(project), entity: project });
  }
  for (const habit of sources.habits ?? []) {
    if (inTrash(habit)) rows.push({ item: habitTrashItem(habit), entity: habit });
  }
  return rows.sort((a, b) => byDeletedOrder(a.entity, b.entity)).map((row) => row.item);
}
