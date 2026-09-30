/**
 * 展厅（showcase）的**样例数据与派生**（纯数据，不 import React）
 * ================================================================
 *
 * 复现对象：`apps/web` 里喂给界面的任务集合 —— 它同时决定
 *   · 侧栏四象限的**计数**（`selectQuadrantCounts()` → `bucketByQuadrant()`）；
 *   · 四象限看板每一格里**有哪些卡**（同一个 `bucketByQuadrant`）；
 *   · 任务列表里**有哪些行**（同一批任务）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么需要它：三处「各自编一份」的漂移
 *
 * `docs/research/showcase-fidelity-audit.md` §2 #2 记录的漂移是
 * **「编造象限计数」**：复刻的四个象限各写死了 3 / 5 / 2 / 1，
 * 而真应用的计数是从同一批任务**算出来**的。审计当时把它读成
 * "真应用不显示计数"并**删掉了四个数** —— 那是一处**误判**：
 *
 *   · `apps/web/src/App.tsx:240` `const counts = useTaskStore(useShallow(selectQuadrantCounts));`
 *   · `apps/web/src/App.tsx:650` `count={entry.filter.kind === 'quadrant' ? counts[...] : undefined}`
 *   · `NavButton`（`:1044`）`{count !== undefined && count > 0 && <span className="ht-nav__count">{count}</span>}`
 *
 * 审计的截图里没看到数字，是因为**空账号的计数恒为 0**，而 `count > 0` 才渲染 ——
 * 不是"产品没有这个位"。所以正确的修法不是删掉它，而是**让它从同一份数据派生**，
 * 这也正是任务书对这条漂移的原话：「手写的，与真应用**算出来的**不一致」。
 *
 * 更麻烦的是：复刻的**任务列表**与**四象限**当时各用一份样例任务
 * （列表 7 条、看板 6 条，有两条只在一边），于是"计数该等于什么"根本没有唯一答案。
 * 本文件把两份合成**一份**：所有界面块从 `SHOWCASE_TASKS` 派生，
 * 于是"侧栏计数 = 看板卡片数 = 同一批任务的划分"是**结构上成立**的。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 `quadrant` 是**登记值**，由 spec 证明它等于领域层的计算结果
 *
 * 每条任务登记一个 `quadrant`，同时登记领域层算象限所需的输入
 * （`dueInDays` / `priority` / `important` / `done`）。
 * `apps/landing/tests/mockup-shell-shape.spec.tsx` 用**领域层自己的**
 * `bucketByQuadrant()` 重新算一遍，逐条比对：
 *
 *   - 登记的象限与领域层算出来的不一致 → 红；
 *   - 领域层改了判据（窗口天数 / 重要性推导）→ 红；
 *   - 有人把 `done` 的任务也算进计数 → 红（领域层明确排除已完成）。
 *
 * 因此**这里没有第二份"怎么算象限"的实现** —— 只是一组登记值，
 * 加上一条会红的证明。与 `packages/design-system/src/task-row-shape.ts` 同一个模式。
 *
 * ⚠️ 边界（明确留下的残差）：`dueKey` / `dueTone` 是**展示用的手写文案**，
 * 不是从 `@heyta/domain` 的 `computeCountdown()` 算的 —— 理由与代价见
 * `TaskList.tsx` 文件头"残差"一节（那是另一次取舍，不在本次四处漂移内）。
 */

import type { MessageKey } from '@heyta/i18n/provider';

/** 象限 id。与 `@heyta/domain` 的 `Quadrant` 一一对应（q1=重要且紧急）。 */
export type ShowcaseQuadrant = 'q1' | 'q2' | 'q3' | 'q4';

/** 截止徽标的紧迫度档位。与 `@heyta/domain` 的 `CountdownUrgency` 同名同义。 */
export type ShowcaseDueTone = 'overdue' | 'today' | 'soon' | 'later';

export interface ShowcaseTask {
  readonly id: string;
  readonly titleKey: MessageKey;
  /**
   * **登记的象限**。真值由领域层 `bucketByQuadrant()` 算出，
   * 本字段必须与它一致 —— spec 会重算并逐条比对。
   */
  readonly quadrant: ShowcaseQuadrant;
  /**
   * 相对 {@link SHOWCASE_NOW} 的**天**偏移（负=已过期）。
   * 这是领域层判紧迫性的输入（`dueDate = SHOWCASE_NOW + dueInDays 天`）。
   */
  readonly dueInDays?: number;
  /** 领域层判重要性的输入之一（`priority === 3` 视为重要）。 */
  readonly priority?: 1 | 2 | 3;
  /** 领域层判重要性的**显式**输入，优先于 `priority`。 */
  readonly important?: boolean;
  /** 已完成。领域层的 `bucketByQuadrant()` **排除**已完成任务 —— 计数与看板都不含它。 */
  readonly done?: boolean;
  /** 展示用的截止文案。**手工编排**，与 `dueInDays` 成对（见文件头残差）。 */
  readonly dueKey?: MessageKey;
  /** 展示用的紧迫度档位。**手工编排**（见文件头残差）。 */
  readonly dueTone?: ShowcaseDueTone;
  /** 展示用的「AI 拆解」入口。 */
  readonly ai?: boolean;
}

/**
 * 展厅的「现在」——**冻结一次**。
 *
 * 展厅是静态展示品：挂载那一刻的时间就是全部。固定成常量而不是 `Date.now()`，
 * 是因为 `dueInDays` 是相对它定义的，而**计数与象限分类必须可复现** ——
 * 否则同一天的不同时刻渲染，侧栏计数会变。
 */
export const SHOWCASE_NOW = Date.UTC(2026, 8, 28, 9, 0, 0);

/**
 * 展厅的**唯一一份**样例任务。所有界面块（侧栏计数 / 四象限 / 任务列表）从它派生。
 *
 * 编排目标：让四个紧迫度档位与三档优先级都能被看到，同时让侧栏计数
 * **恰好等于**看板上每一格的卡片数。挑的都是任务管理里典型的一天。
 */
export const SHOWCASE_TASKS: readonly ShowcaseTask[] = [
  {
    id: 'mk-quote',
    titleKey: 'landing.mock.task.quote',
    quadrant: 'q1',
    dueInDays: -2,
    priority: 3,
    dueKey: 'landing.mock.due.overdue2',
    dueTone: 'overdue',
  },
  {
    id: 'mk-weekly',
    titleKey: 'landing.mock.task.weeklyReport',
    quadrant: 'q1',
    dueInDays: 0,
    priority: 3,
    dueKey: 'landing.mock.due.today1800',
    dueTone: 'today',
    ai: true,
  },
  {
    id: 'mk-q4',
    titleKey: 'landing.mock.task.q4Draft',
    quadrant: 'q2',
    dueInDays: 3,
    priority: 2,
    important: true,
    dueKey: 'landing.mock.due.in3Days',
    dueTone: 'soon',
  },
  {
    id: 'mk-book',
    titleKey: 'landing.mock.task.bookChapter',
    quadrant: 'q2',
    dueInDays: 5,
    important: true,
    dueKey: 'landing.mock.due.in5Days',
    dueTone: 'later',
  },
  {
    id: 'mk-review',
    titleKey: 'landing.mock.task.quarterlyReview',
    quadrant: 'q2',
    dueInDays: 8,
    priority: 2,
    important: true,
    dueKey: 'landing.mock.due.in5Days',
    dueTone: 'later',
  },
  {
    id: 'mk-photo',
    titleKey: 'landing.mock.task.photoBackup',
    quadrant: 'q2',
    priority: 1,
    important: true,
  },
  {
    id: 'mk-dentist',
    titleKey: 'landing.mock.task.dentist',
    quadrant: 'q3',
    dueInDays: 1,
    priority: 2,
    dueKey: 'landing.mock.due.tomorrow',
    dueTone: 'soon',
  },
  {
    id: 'mk-expense',
    titleKey: 'landing.mock.task.expense',
    // ⚠️ 已完成任务在领域层里 `isUrgent()` 恒为 false（"它已经不需要做了"），
    // 所以即使 priority=3（重要），它也算 Q2 而不是 Q1。这里登记的就是
    // `classifyQuadrant()` 的答案 —— 而它对**计数与看板都没有影响**，
    // 因为 `bucketByQuadrant()` 明确排除已完成任务（spec 会验证这一点）。
    quadrant: 'q2',
    dueInDays: -1,
    priority: 3,
    done: true,
    dueKey: 'landing.mock.due.done',
    dueTone: 'later',
  },
];

/** 空的计数表，用作派生的起点。 */
function emptyCounts(): Record<ShowcaseQuadrant, number> {
  return { q1: 0, q2: 0, q3: 0, q4: 0 };
}

/**
 * 侧栏四象限的计数。
 *
 * 与真应用同一条语义：**已完成的任务不计入**（`bucketByQuadrant()` 排除它），
 * 数值是"这一格里有多少张卡"。这是**纯粹的计数**，不含任何"怎么算象限"的判据 ——
 * 象限本身是每条任务上登记的字段，由 spec 用领域层证明。
 */
export function showcaseQuadrantCounts(
  tasks: readonly ShowcaseTask[] = SHOWCASE_TASKS,
): Record<ShowcaseQuadrant, number> {
  const counts = emptyCounts();
  for (const task of tasks) {
    if (task.done === true) continue;
    counts[task.quadrant] += 1;
  }
  return counts;
}

/**
 * 「今天进度卡」上的数字（产品决策 P5）。
 *
 * 🔴 **它是编的，而且这里说明为什么它只能编** —— 免得下一个人以为"派生一下就好了"：
 *
 *   · 真应用那一张卡的数字来自 `@heyta/domain` 的 `computeTodayProgress()`，
 *     它的入参是 **habits + habitLogs + tasks + focusSessions + today**（五个）；
 *   · 而展厅**只编排了任务**（`SHOWCASE_TASKS`，8 条）—— 没有习惯、没有习惯日志、
 *     没有专注记录。派生的前提数据**不存在**；
 *   · 就算只按任务算也对不上：`dueInDays <= 0` 且未完成的只有 **3** 条（−2 / 0 / −1），
 *     而卡上写的是 `total: 5` —— 因为真应用把**习惯**也算进计划量。
 *   · `ShowcaseTask` 也**没有完成时间**字段（只有 `done` 布尔），
 *     所以"今天完成了几件"同样派不出来。
 * ⇒ **加 `@heyta/domain` 依赖解决不了这件事**（原决策 P5 的前提是错的，已修订）。
 *
 * 它与被删掉又补回的"象限计数"**性质不同**：象限计数是**可派生的**（有样例任务就够），
 * 所以那里必须派生；这张卡是**往真有的数字位里填样例值**，只能编。
 *
 * ⚠️ 但它**不是**"随手写的魔数"：集中登记在这里，且
 * `mockup-shell-shape.spec.tsx` 钉住内部一致性（`remaining === total - done`、
 * `0 < done <= total`）—— 一个自相矛盾的数字（比如 done > total）会红。
 */
export const SHOWCASE_TODAY_PROGRESS = { done: 2, total: 5, remaining: 3 } as const;

/** 四象限看板每一格里的任务（同样排除已完成）。 */
export function showcaseTasksByQuadrant(
  tasks: readonly ShowcaseTask[] = SHOWCASE_TASKS,
): Record<ShowcaseQuadrant, ShowcaseTask[]> {
  const buckets: Record<ShowcaseQuadrant, ShowcaseTask[]> = {
    q1: [],
    q2: [],
    q3: [],
    q4: [],
  };
  for (const task of tasks) {
    if (task.done === true) continue;
    buckets[task.quadrant].push(task);
  }
  return buckets;
}
