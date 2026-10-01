/**
 * 任务列表的**纯逻辑**层
 * ======================
 *
 * 🔴 这个文件里**不许 import `react-native`**，这是硬约束而不是风格偏好：
 *
 * 1. `packages/ui/vitest.config.ts` 用 `environment: 'node'`。RN 是 Flow 源码，
 *    node 解析不了它 —— 一旦这里 import 了 RN，**测试会立刻挂**。
 *    等于用测试免费钉住了"宿主无关"这件事，不需要靠代码评审去记。
 * 2. 排序 / 取标题这类判断**与怎么画无关**。把它们留在组件里，
 *    就意味着"想验证排序规则"必须先起一个 RN 渲染环境 ——
 *    而真到了那一步，多数人不会去测，规则就此无人守。
 *
 * 组件（`TaskList.tsx`）只负责把这里的输出摆到 RN 原语上，那一段是**没有分支**的。
 */

import { sortTasks, sortTasksForDisplay } from '@heyta/domain';
import type { Task, TaskSortKey } from '@heyta/domain';

/**
 * 🔴 **`sortTasksForDisplay` 的实现在 `@heyta/domain/src/task-order.ts`，这里只是转出。**
 *
 * 为什么搬走：`packages/app-host`（桌面壳的窄门面 `native-bridge.ts` 就在那儿）
 * **够不到 `packages/ui`** —— ui 的 peer 依赖是 `react` / `react-native`，
 * 让 app-host 依赖它等于把 React 拖进一个今天零框架依赖的包。
 * 于是 app-host 当时自己写了一份 `(createdAt, id)` 排序，**两份排序并存**，
 * 结果是"同一个账号在桌面壳与 web/mobile 上任务顺序不同"。
 *
 * 放到 `packages/domain`（两个包都已经依赖它、且它零框架依赖）之后，
 * **只有一份实现**。这里转出是为了不破坏既有消费者
 * （`toTaskRows` 与各宿主的 `import { sortTasksForDisplay } from '@heyta/ui'`）。
 */
export { sortTasksForDisplay };

/** 列表渲染需要的**最小**字段集。刻意不是整个 `Task` 的展开。 */
export interface TaskRow {
  readonly id: string;
  readonly title: string;
  readonly done: boolean;
  readonly important: boolean;
  /** 截止时间（epoch ms）。没有截止时间是 `null`，不是 `0`。 */
  readonly dueAt: number | null;
  /**
   * 原始的 `Task`。
   *
   * 🔴 为什么把整个实体带进来，而不是只加几个字段：
   *
   * 宿主需要在插槽里渲染**本地化**的元信息（截止文案、优先级徽章、重复规则），
   * 而那些都要求拿到任务本体（`priority` 是数值枚举、`repeatOf` 还要按 id 查）。
   * 每多一个这样的需求就往 `TaskRow` 上加一个字段，等于让这个"最小字段集"
   * 无限膨胀，而且每加一次都要改这个文件 —— 却没有任何判断可复用。
   *
   * 把本体挂在这里，插槽就能自己取；`TaskRow` 自己那四个字段仍然是
   * **派生过、有测试钉着**的（见本文件的 `toTaskRow`），不是摆设。
   */
  readonly source: Task;
}

export interface ToTaskRowOptions {
  /**
   * 标题为空时的替代文案。
   *
   * 🔴 **空标题是真实存在的**：快速捕获允许用户先敲个空格/回车就建任务
   * （捕捉想法时不该先逼他写标题）。不处理的话，列表上会出现一行**点不着、
   * 也看不懂**的空白 —— 而它其实是条真数据。
   *
   * 默认值是空串而不是写死中文：本包不含 i18n（理由见 `TaskList.tsx` 文件头），
   * 所以文案必须由宿主给。
   */
  readonly fallbackTitle?: string;
  /**
   * 排序口径。**默认 `display`**（未完成在前 + 截止升序），不传就是原来的行为。
   *
   * 🔴 它是**宿主的界面偏好**，不是判断：判据（每一档怎么比、已完成永远沉底、
   * 同档保持原序）全在 `@heyta/domain` 的 `sortTasks`。这里只是把它透进去 ——
   * 在渲染层再写一遍比较逻辑，就是本文件上面记的那次「两份排序并存」事故。
   */
  readonly sort?: TaskSortKey;
}

/** 单条 `Task` → 渲染用的行模型。 */
export function toTaskRow(task: Task, options?: ToTaskRowOptions): TaskRow {
  const title = task.title.trim();
  return {
    id: task.id,
    title: title === '' ? (options?.fallbackTitle ?? '') : title,
    // 🔴 完成状态只认 `completedAt`。domain 里刻意**没有** `completed` 布尔
    // （见 entities.ts 的注释），这里再造一个就等于给自己留了两份会不一致的真相。
    // 注意判的是"存不存在"而不是真值：`completedAt: 0` 也是已完成。
    done: task.completedAt !== undefined,
    important: task.important === true,
    dueAt: task.dueDate ?? null,
    source: task,
  };
}

/** 一步到位的入口：排序 + 转行模型。 */
export function toTaskRows(
  tasks: readonly Task[],
  options?: ToTaskRowOptions,
): readonly TaskRow[] {
  return sortTasks(tasks, options?.sort).map((task) => toTaskRow(task, options));
}

/**
 * 一个分组。
 *
 * `meta` 是**宿主自己的**透传数据（图标名、色调、计数…），共享层完全不解释它，
 * 只在渲染分节头时原样交回给 `renderSectionHeader`。
 *
 * 🔴 为什么不把 `title` / `icon` / `count` 定死在这里：
 * `icon` 是**各端不同**的东西（mobile 用 `lucide-react-native` 的字形名，
 * web 用 `lucide-react`，两边的名字集合并不完全重合）。定死就等于
 * 让共享层去认识某个图标库 —— 那正是"一份 UI 代码"最容易被悄悄破坏的地方。
 * 泛型参数让它保持类型安全，而不是退化成 `unknown` + 强转。
 */
export interface TaskSection<TMeta = undefined> {
  readonly key: string;
  readonly tasks: readonly Task[];
  readonly meta: TMeta;
}

/** 分节列表展平后的一行：要么是分节头，要么是任务。 */
export type SectionRow<TMeta> =
  | { readonly kind: 'header'; readonly key: string; readonly section: TaskSection<TMeta> }
  | { readonly kind: 'task'; readonly key: string; readonly row: TaskRow };

/** 分节展平的选项。 */
export interface FlattenSectionsOptions extends ToTaskRowOptions {
  /**
   * 保留**空分组**。
   *
   * 默认 `false` —— 一个写着"已完成 0"的标题是纯噪音。
   *
   * ⚠️ 但**固定槽位**的布局是例外：四象限矩阵里"这一格是空的"本身
   * 就是信息，藏掉它会让人以为那个象限不存在，而矩阵的价值恰恰在于
   * 四个格子**同时**在那儿。这种布局显式传 `true`。
   */
  readonly keepEmpty?: boolean;
}

/**
 * 把分节展平成 `[头, 任务…, 头, 任务…]`。
 *
 * 🔴 **空分组默认不产生头。** 一个写着"已完成 0"的标题是纯噪音 ——
 * 它占了屏、把视线从真有的内容上引开，却没有任何信息。
 * mobile 原来的实现里这条是手写的（`if (list.length === 0) return;`），
 * 提上来之后四个端都不会再各写一次、也不会有人忘掉。
 *
 * ⚠️ **分组顺序永远不重排**（"今天 / 逾期 / 收集箱 / 已完成"这种次序不是
 * 按截止时间能推出来的），**组内顺序看传没传 `sort`**：
 *
 * - 没传 ⇒ 保持宿主给的顺序。老宿主（四象限矩阵、日历格）的行为逐字节不变。
 * - 传了 ⇒ 每一组各自过领域的 `sortTasks`。
 *
 * 为什么要有第二条：mobile 的任务屏原本在屏幕里手写 `groups.x.reverse()`，
 * 而 `packages/app-host` 曾经还有第三份 `(createdAt, id)` 排序 ——
 * 本文件头部记的那次「两份排序并存 ⇒ 同一账号在不同端顺序不同」就是同一个形状。
 * **比较规则只允许在 `@heyta/domain` 一份**，宿主只决定用哪一档、不决定怎么比。
 *
 * ⚠️ 排完只影响**行**的顺序；`kind:'header'` 那一条带的仍是宿主原来那个
 * `section` 对象，所以组头的计数与色调不会因为排序而变化。
 */
export function flattenSections<TMeta>(
  sections: readonly TaskSection<TMeta>[],
  options?: FlattenSectionsOptions,
): readonly SectionRow<TMeta>[] {
  const keepEmpty = options?.keepEmpty === true;
  const sort = options?.sort;
  const out: SectionRow<TMeta>[] = [];
  for (const section of sections) {
    if (section.tasks.length === 0 && !keepEmpty) continue;
    out.push({ kind: 'header', key: `h-${section.key}`, section });
    const ordered = sort === undefined ? section.tasks : sortTasks(section.tasks, sort);
    for (const task of ordered) {
      out.push({ kind: 'task', key: task.id, row: toTaskRow(task, options) });
    }
  }
  return out;
}
