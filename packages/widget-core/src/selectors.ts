/**
 * 选择器：从物化状态投影出四款组件要的数据。
 *
 * ## 这一层最重要的性质：**它不定义任何业务口径**
 *
 * 每一款组件的数据都来自 `packages/domain` 里**已经存在的**投影函数 ——
 * 本文件只做三件事：挑字段、排序、截断。
 *
 * | 组件 | 口径来自 | 本文件不做的事 |
 * |---|---|---|
 * | 今日任务 | `domain.isTaskPlannedForToday`（与今日进度**同一个**判据） | 不重写"什么算今天" |
 * | 四象限 | `domain.bucketByQuadrant`（ADR-0015 的派生视图） | 不重写紧迫性/重要性 |
 * | 今日习惯 | `domain.isScheduledOn` + `isAchieved` + `computeStreak` | 不重写频率与达成 |
 * | 今日专注 | `domain.remainingMs`（基于结束时间戳，不累加） | 不重写计时口径 |
 * | 清单颜色 | `domain.parseCategorySlot` + `design-system.CATEGORY_SLOT_TOKEN_BY_SLOT` | 不内置调色板 |
 *
 * 🔴 **为什么这一条值得写在最前面**：`M0-1` 花了一整轮才消灭掉"同一份取值有两个来源"，
 * 而小组件是**最容易重新引入它**的地方 —— 因为它的 UI 是四份手写原生代码，
 * 每写一份都会本能地想"我就在这儿顺手算一下"。
 * 那样做出来的症状是：网页说 5 件、组件列 4 件，而**两边都不报错**。
 *
 * ## 关于"零依赖"
 *
 * 本包依赖 `@heyta/domain` 与 `@heyta/design-system` —— 两者都是**纯 TS 的仓库内包**，
 * 不引入任何第三方许可证（`check:licenses` 零新增）。
 * 计划里写的"零运行时依赖"指的是**零第三方依赖**：本包不引 zod、不引日期库、不引调色板。
 */

import {
  CATEGORY_SLOT_TOKEN_BY_SLOT,
  tokensForTheme,
} from '@heyta/design-system';
import {
  Quadrant,
  bucketByQuadrant,
  computeStreak,
  isAchieved,
  isScheduledOn,
  isTaskPlannedForToday,
  parseCategorySlot,
  remainingMs,
  type FocusState,
  type Habit,
  type HabitLog,
  type LocalDate,
  type Project,
  type Task,
} from '@heyta/domain';

import {
  WIDGET_MAX_TASKS,
  type WidgetFocus,
  type WidgetHabit,
  type WidgetPayload,
  type WidgetProjectColor,
  type WidgetTask,
} from './contract.js';

/**
 * 选择器的输入 —— 就是**物化状态**加两个时间参数。
 *
 * 🔴 `today` 与 `now` **必须显式传入**，理由与 `domain` 里一样：
 * 内部读 `Date.now()` 会让这一层不可测，而这些函数的边界条件
 * （跨日、逾期、锁定）恰恰是最需要测的。
 */
export interface WidgetSelectorInput {
  tasks: readonly Task[];
  habits: readonly Habit[];
  logs: readonly HabitLog[];
  projects: readonly Project[];
  /**
   * 专注状态机的当前状态。
   *
   * 注意它**不是**物化状态的一部分 —— 正在跑的番茄钟只活在应用运行时里，
   * `FocusSession` 是结束之后才落盘的记录。所以它单独传来。
   * 应用没有专注功能时传 `undefined`，会得到一个 `{ active: false }`。
   */
  focus?: FocusState;
  /** 应用算出的"今天"（本地日历日）。 */
  today: LocalDate;
  /** 当前时刻（epoch ms）。 */
  now: number;
  /** 四象限的"多少天内算紧急"。省略则用 `domain` 的默认值。 */
  urgentWindowDays?: number;
}

/** `Task` → `WidgetTask`。**唯一**做这个映射的地方。 */
function toWidgetTask(task: Task): WidgetTask {
  const out: WidgetTask = {
    id: task.id,
    title: task.title,
    // 🔴 heyta 的任务没有 `isDone` 字段，完成语义是 `completedAt` 存在与否。
    // 组件契约里的布尔值在这里派生，而不是让四端各自去读时间戳。
    isDone: task.completedAt !== undefined,
  };
  // 🔴 **省略键，绝不写 `null`** —— 见 contract.ts 文件头规则 2。
  if (task.projectId !== undefined) out.projectId = task.projectId;
  return out;
}

/**
 * 今日任务。
 *
 * 判据是 `domain.isTaskPlannedForToday` —— **与「今日进度」用的是同一个函数**。
 * 这正是本文件存在的第一个理由：如果在这里重写一遍判据，两边迟早会分叉。
 *
 * ## 排序：未完成在前 → 逾期在前 → 优先级高的在前
 *
 * 组件通常只能显示 3–5 行，所以**顺序就是信息**。
 * 先按完成状态分组的理由：已完成的任务在"今天要做什么"这个问题上没有价值，
 * 它们只是进度证据，应该沉底。
 *
 * ## 关于 `quadrant` 字段
 *
 * 契约里 `WidgetTask.quadrant` 是可选的，但**这里故意不填**：
 * 今日列表回答的是"什么时候做"，四象限回答的是"值不值得做"。
 * 在今日列表上再叠一层象限色，两个视图的区分度会同时下降；
 * 而且那会让本函数必须依赖象限选项，两个选择器就不再独立了。
 * 四象限那条数据由 `selectQuadrant` 单独提供。
 */
export function selectTodayTasks(input: WidgetSelectorInput): WidgetTask[] {
  const planned = input.tasks.filter((task) => isTaskPlannedForToday(task, input.today));

  planned.sort((a, b) => {
    const aDone = a.completedAt !== undefined ? 1 : 0;
    const bDone = b.completedAt !== undefined ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;

    // 无截止日的排最后（它们在"今天"里是逾期态，但排序上不该挤掉有明确时间的）
    const byDue = (a.dueDate ?? Number.MAX_SAFE_INTEGER) - (b.dueDate ?? Number.MAX_SAFE_INTEGER);
    if (byDue !== 0) return byDue;
    return (b.priority ?? 0) - (a.priority ?? 0);
  });

  // 截断在**应用侧**做（契约只拒绝超限，不修补）—— 这里就是应用侧。
  return planned.slice(0, WIDGET_MAX_TASKS).map(toWidgetTask);
}

/**
 * 四象限。
 *
 * 口径完全来自 `domain.bucketByQuadrant`（ADR-0015：象限是 TASK 的派生视图），
 * 它已经做了：排除已完成与已删除、按紧迫性+重要性分桶、桶内按截止日与优先级排序。
 *
 * 🔴 **四个键永远都在**（哪怕是空数组）。理由：四端是**手写的**解析器，
 * "键缺失"和"该象限为空"在渲染上是同一件事，但如果键会消失，
 * 每端都要多写一条分支 —— 而分支越多，某一端漏写的机会越大。
 * 固定形状让四端只有一条代码路径。
 */
export function selectQuadrant(input: WidgetSelectorInput): Record<string, WidgetTask[]> {
  const buckets = bucketByQuadrant(input.tasks, {
    now: input.now,
    urgentWindowDays: input.urgentWindowDays,
  });

  const out: Record<string, WidgetTask[]> = {};
  // 显式列出四个槽位，不用 Object.values —— 后者会把类型宽化成 any[]
  for (const slot of [
    Quadrant.UrgentImportant,
    Quadrant.ImportantNotUrgent,
    Quadrant.UrgentNotImportant,
    Quadrant.Neither,
  ]) {
    out[String(slot)] = buckets[slot].slice(0, WIDGET_MAX_TASKS).map((task) => {
      const widgetTask = toWidgetTask(task);
      // 象限视图里这一项是**已知的**（我们正在遍历那个桶），填上它让原生不必再算
      widgetTask.quadrant = slot;
      return widgetTask;
    });
  }
  return out;
}

/**
 * 今日习惯。
 *
 * ⚠️ **字段名不是照抄**：`Habit` 上叫 `name`，契约里叫 `title`
 * （因为任务与习惯在组件里是同一排列表，字段名统一才好渲染）。
 * 这个映射只在这里做一次。
 *
 * `doneToday` 的判据用 `domain.isAchieved` —— 与连续天数、里程碑**同源**。
 * "打过卡就算"是错的：`8 杯水只喝了 3 杯`不算达成，
 * 否则会出现"进度条满了但连续天数没涨"这种查起来极贵的矛盾（见 domain 注释）。
 */
export function selectHabits(input: WidgetSelectorInput): WidgetHabit[] {
  const out: WidgetHabit[] = [];

  for (const habit of input.habits) {
    if (habit.deletedAt !== undefined) continue;
    if (!isScheduledOn(habit.frequency, input.today)) continue;

    const doneToday = input.logs.some(
      (log) =>
        log.deletedAt === undefined &&
        log.habitId === habit.id &&
        log.date === input.today &&
        isAchieved(habit, log),
    );

    out.push({
      id: habit.id,
      title: habit.name,
      doneToday,
      // `computeStreak` 要求显式传今天（内部读 Date.now() 会让它不可测）
      streak: computeStreak(habit, input.logs, input.today).current,
    });
  }

  return out.slice(0, WIDGET_MAX_TASKS);
}

/**
 * 专注状态。
 *
 * ## 🔴 这里**故意**与应用内的显示口径不同，理由必须写下来
 *
 * 应用内有 `domain.focusDisplayMs`，它在**空闲时返回计划时长**（显示 `25:00`）——
 * 那是对的：一个静止的 `00:00` 在应用里看起来像坏了。
 *
 * 但组件不是这个语境：组件空闲时要显示的是**「开始专注」按钮**。
 * 如果这里也用 `focusDisplayMs`，空闲的组件就会显示一个 `25:00` ——
 * 用户会以为计时正在跑，而它没跑。所以：
 *
 *   - `active === false` → **不输出任何秒数**，由原生渲染入口；
 *   - `active === true`  → 用 `remainingMs`（暂停时它来自 `remainingMsOnPause`）。
 *
 * 两者不矛盾：`focusDisplayMs` 回答"计时器上该画什么数字"，
 * 这里回答"现在有没有在专注"。混用才会出问题。
 */
export function selectFocus(input: WidgetSelectorInput): WidgetFocus {
  const state = input.focus;
  if (state === undefined || state.phase === 'idle') {
    return { active: false };
  }

  const out: WidgetFocus = {
    active: true,
    remainingSeconds: Math.ceil(remainingMs(state, input.now) / 1000),
    targetSeconds: Math.round(state.plannedMs / 1000),
  };

  if (state.taskId !== undefined) {
    const task = input.tasks.find((candidate) => candidate.id === state.taskId);
    if (task !== undefined) out.sessionTitle = task.title;
  }

  // 🔴 **绝对**结束时刻 —— 灵动岛 / Live Activity 的前提（见 `WidgetFocus.endsAt`）。
  //
  // ⚠️ 只在 `phase === 'running'` 时输出。暂停时 `endsAt` **仍然有值**，
  //    但那个值已经不代表"会在那时结束"了（暂停会往前推）。
  //    输出它 = 灵动岛会按一个**错的**时刻倒计时，而且会有进度条在一格一格走 ——
  //    错得**有症状但看起来像在正常工作**，是最坏的一种。
  //    暂停 → 不输出 → 灵动岛不启动（或按"已暂停"渲染），这是真话。
  if (state.phase === 'running') {
    out.endsAt = state.endsAt;
  }

  return out;
}

/**
 * 被引用到的清单 → **已解析**的颜色。
 *
 * 链路（每一步都在既有单源里，本函数不新增任何取值）：
 *
 * ```
 * Project.color（槽位号字符串，如 "3"）
 *   → domain.parseCategorySlot          校验 1–8
 *   → design-system.CATEGORY_SLOT_TOKEN_BY_SLOT   槽位 → token 名
 *   → design-system.tokensForTheme(light|dark)    token → 十六进制
 * ```
 *
 * 🔴 **为什么要把明暗两套都解析出来**：实测 `HeytaTokens.swift` 里**一个类别色都没有**
 * （`grep -c category` = 0），原生拿不到调色板。与其让四端各自内置一份 8 色表
 * （那就是设计系统之外的第二真源，M0-1 刚消灭掉的东西），
 * 不如由应用侧解析好、把最终颜色交给原生 —— 原生连查表都不用做。
 *
 * 只解析**被实际引用**的清单：快照要塞进共享容器，没必要带上用户全部清单的颜色。
 */
export function selectProjectColors(
  projects: readonly Project[],
  usedProjectIds: ReadonlySet<string>,
): Record<string, WidgetProjectColor> {
  if (usedProjectIds.size === 0) return {};

  const light = tokensForTheme('light');
  const dark = tokensForTheme('dark');

  const out: Record<string, WidgetProjectColor> = {};
  for (const id of usedProjectIds) {
    const project = projects.find((candidate) => candidate.id === id);
    if (project === undefined) continue;

    // 没设过色（或存的值非法）→ 不放进表里。原生查不到就用自己的中性色，
    // 这与"用户没为这个清单选颜色"的语义一致。
    const slot = parseCategorySlot(project.color);
    if (slot === undefined) continue;

    const token = CATEGORY_SLOT_TOKEN_BY_SLOT[slot];
    out[id] = { light: light[token], dark: dark[token] };
  }
  return out;
}

/** 收集一组任务里引用到的 projectId。 */
function collectProjectIds(tasks: readonly WidgetTask[]): Set<string> {
  const ids = new Set<string>();
  for (const task of tasks) {
    if (task.projectId !== undefined) ids.add(task.projectId);
  }
  return ids;
}

/**
 * 组装完整载荷 —— 写快照时调这个。
 *
 * 🔴 **五个字段永远都在**（`today` / `quadrant` / `habits` / `focus` / `projectColors`），
 * 即使是空数组或空对象。理由与 `selectQuadrant` 一样：四端是手写解析器，
 * 固定形状 = 一条代码路径。
 *
 * 契约里它们仍标为可选 —— 那是给**将来**的变体留的余地，
 * （比如只上"今日任务"一款时不必带习惯），不是给现在偷懒用的。
 */
export function buildWidgetPayload(input: WidgetSelectorInput): WidgetPayload {
  const today = selectTodayTasks(input);
  const quadrant = selectQuadrant(input);
  const habits = selectHabits(input);

  const used = collectProjectIds(today);
  for (const list of Object.values(quadrant)) {
    for (const id of collectProjectIds(list)) used.add(id);
  }

  return {
    today,
    quadrant,
    habits,
    focus: selectFocus(input),
    projectColors: selectProjectColors(input.projects, used),
  };
}
