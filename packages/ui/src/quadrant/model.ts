/**
 * 四象限（共享模型）
 * ==================
 *
 * M3 第六刀（quadrant）的**判断层**：象限的展示顺序、象限 → 颜色 token、
 * 一批任务怎么切成四张卡。**组件里因此没有分支**，不需要靠快照测试兜。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 领域规则一条都不在这里重写
 *
 * 「什么算紧急」「什么算重要」「怎么分桶」「桶里怎么排序」全部来自
 * `@heyta/domain`（`bucketByQuadrant` / `classifyQuadrant`）。这里只做三件
 * **展示**上的事：
 *
 *   1. 定死四个象限的**展示顺序**（Q1 → Q2 → Q3 → Q4）；
 *   2. 把象限映射到 `--ht-color-quadrant-*` 语义 token；
 *   3. 给每个象限一个**稳定的测试标识**（`quadrant-cell-N`），
 *      让宿主与测试能按"格"寻址，而不是靠 DOM 顺序。
 *
 * 为什么顺序写在这里而不是 `Object.values(buckets)`：后者的顺序取决于对象
 * 键的插入顺序 —— 换个地方构造桶就会**悄悄**改变展示顺序，而象限的排序
 * 就是它的语义（移动端 `TasksScreen` 里同样写了这一条）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本文件**不 import `react-native`，也不 import `@heyta/i18n`**
 *
 * 前者：`packages/ui/vitest.config.ts` 跑在 **node** 环境，`react-native`
 * 是 Flow 源码，node 解析不了它。这条约束顺带钉住了"model 必须宿主无关"。
 * 后者：i18n 包自己带过一份 React，四端会同时中招（见 `TaskList.tsx` 文件头）。
 * 文案一律由宿主注入。
 */

import { Quadrant, bucketByQuadrant, type Task } from '@heyta/domain';

/**
 * 四个象限的展示顺序。
 *
 * 🔴 刻意是**显式数组**而不是 `Object.values(QUADRANT_META)`：
 * 顺序是产品语义（紧急且重要的事排最前），不是对象键的偶然顺序。
 */
export const QUADRANT_ORDER = [
  Quadrant.UrgentImportant,
  Quadrant.ImportantNotUrgent,
  Quadrant.UrgentNotImportant,
  Quadrant.Neither,
] as const;

/**
 * 象限能用的**颜色 token 名**。
 *
 * 🔴 刻意不是 `TokenName`（那是全部 token 的联合，含间距/圆角等**数字** token）。
 * 标成 `TokenName` 会让 `tokens[token]` 的类型变成 `string | number`，
 * 喂给 `backgroundColor` 直接编译不过 —— 而这个联合每一项都是**颜色**，
 * `tokens[token]` 因此能窄化成 `string`（与 `categories/model.ts` 同一个理由）。
 */
export type QuadrantColorToken =
  | 'color.quadrant-1'
  | 'color.quadrant-2'
  | 'color.quadrant-3'
  | 'color.quadrant-4';

/**
 * 象限 → 颜色 token。**全仓唯一的一处映射**（web 组件里不再散写）。
 *
 * 取值只有设计系统已经有的一族（`tokens.css` 的 `--ht-color-quadrant-1..4`），
 * 这里不新定任何颜色。`QUADRANT_META[q].tokenPrefix` 是领域层给的名字
 * （`quadrant-1`…），与这一族 token 同源 —— 但这里仍写成字面量，
 * 因为 `TokenName` 的校验只能在编译期对**字面量**生效：写成模板拼接
 * （`color.${prefix}`）就退化成 `string`，拼错一个字母不会有任何提示。
 */
const QUADRANT_SLOT_TOKEN: Record<Quadrant, QuadrantColorToken> = {
  [Quadrant.UrgentImportant]: 'color.quadrant-1',
  [Quadrant.ImportantNotUrgent]: 'color.quadrant-2',
  [Quadrant.UrgentNotImportant]: 'color.quadrant-3',
  [Quadrant.Neither]: 'color.quadrant-4',
};

/** 象限 → 该象限的语义色 token。 */
export function quadrantSlotToken(quadrant: Quadrant): QuadrantColorToken {
  return QUADRANT_SLOT_TOKEN[quadrant];
}

/**
 * 象限 → 展示槽位号（`1`…`4`）。
 *
 * 🔴 与 `@heyta/domain` 的 `QUADRANT_META[q].tokenPrefix`（`quadrant-1`…）**同源**，
 * 但**不是**从它字符串切出来的：`slice` / `replace` 的结果是 `string`，
 * 拼进 `testID` 之后拼错一个字母不会有任何提示。两者的对应关系由
 * `tests/quadrant-model.spec.ts` 里的一条断言钉住（只改一边会红）。
 */
const QUADRANT_SLOT: Record<Quadrant, 1 | 2 | 3 | 4> = {
  [Quadrant.UrgentImportant]: 1,
  [Quadrant.ImportantNotUrgent]: 2,
  [Quadrant.UrgentNotImportant]: 3,
  [Quadrant.Neither]: 4,
};

/** 象限 → 展示槽位号。 */
export function quadrantSlot(quadrant: Quadrant): 1 | 2 | 3 | 4 {
  return QUADRANT_SLOT[quadrant];
}

/** 一个象限里的任务。`tasks` 的顺序 = 领域层给的分桶顺序（截止升序、优先级降序）。 */
export interface QuadrantBucket {
  readonly quadrant: Quadrant;
  /** 排除已完成与已删除之后、落进这一格的任务。 */
  readonly tasks: readonly Task[];
}

/** 一张象限卡渲染需要的东西。**全部由纯函数算出来**，组件只负责摆。 */
export interface QuadrantCardModel extends QuadrantBucket {
  /** 这一格的颜色 token（趋势/表头色块共用）。 */
  readonly token: QuadrantColorToken;
  /** 计数。`tasks.length` 的显式投影 —— 宿主直接读数，不用再 `.length`。 */
  readonly count: number;
  /**
   * 稳定的测试标识：`quadrant-cell-1` … `quadrant-cell-4`。
   *
   * 🔴 用**槽位号**（{@link quadrantSlot}）而不是数组下标：下标会随展示顺序
   * 调整而变，于是"第 3 格"在两个版本里指的不是同一件事。
   */
  readonly testID: string;
}

/**
 * 一批任务 → 四张卡。**按 {@link QUADRANT_ORDER} 的顺序**，固定四张（空格也在）。
 *
 * 🔴 空格必须保留：矩阵的价值就在四个格子**同时**在场 —— 藏掉空格会让人以为
 * 那个象限不存在（`flattenSections` 的 `keepEmpty` 注释记的是同一条）。
 *
 * ⚠️ `now` 显式传入而不是读 `Date.now()`：紧迫性窗口以它为基准，
 * 不显式传这个函数就不可测（与 `@heyta/domain#bucketByQuadrant` 同一约定）。
 */
export function toQuadrantCards(
  tasks: readonly Task[],
  now: number,
): QuadrantCardModel[] {
  const buckets = bucketByQuadrant(tasks, { now });
  return QUADRANT_ORDER.map((quadrant) => {
    const bucketTasks = buckets[quadrant];
    return {
      quadrant,
      tasks: bucketTasks,
      token: quadrantSlotToken(quadrant),
      count: bucketTasks.length,
      testID: `quadrant-cell-${String(QUADRANT_SLOT[quadrant])}`,
    };
  });
}
