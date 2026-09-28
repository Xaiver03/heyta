/**
 * 激励 / 成长（共享模型）
 * ======================
 *
 * M3「motivation」这一刀的**判断层**：今日进度该说哪一句话、周复盘的三个数字
 * 是哪三个、里程碑怎么按维度压成块、身份标签哪几个算"最近能拿到的"、
 * 热力图每一天落在几档。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 一个业务数字都不在这里重算 —— 这里只做**视图模型转换**
 *
 * 「今天该做几件」「连续怎么数」「里程碑阈值多少」「身份判据」「周窗口」
 * 全在 `@heyta/domain`；「把物化状态摊平、滤墓碑、注入 now」全在
 * `@heyta/app-host#motivation`（它的文件头把"怎么算今日 / 怎么算四象限只能有
 * 一份实现"写成了硬契约）。`packages/ui` **不能 import `@heyta/app-host`**
 * （那是宿主接线层），所以投影结果一律**由宿主注入**。
 *
 * 于是本文件里每一个函数都只接受"已经算好的数字"作为输入：
 *
 *   - `growthHint` / `ratioText` / `progressPercent`  ← `TodayProgress`
 *   - `weekStatRows` / `weekHeadlineCount`             ← `WeeklyReview`
 *   - `milestoneGroups`                                ← `MilestoneProgress[]`
 *   - `reachedTagIds` / `nearMissTags`                 ← `IdentityTagProgress[]`
 *   - `activityLevel` / `toActivityHeatmapDays`        ← `ActivityDayCount[]`
 *   - `toHabitStreakRows`                              ← 宿主注入的 `HabitGrowthFn`
 *
 * 本文件新增的只有**展示口径**（顺序 / 分档 / 夹紧 / 取前 N 条）与它们的分支。
 * 那些恰恰是"安静出错"的重灾区，所以它们集中在这里、有名字、能被 node 单测
 * 跑穿（`packages/ui/vitest.config.ts` 用的是 node 环境）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 「活动总量」（`ActivityTotals`）在本文件里**没有对应的组件**
 *
 * web 与 mobile 都**不**把累计总量画成一块界面：web 只在"复制周小结"的纯文本里
 * 用到它，mobile 完全没用到（里程碑的分档已经是它的展示形态）。给它补一块
 * 常驻界面是**产品改动**，不是这次迁移该顺手做的事。
 * · 证据：`apps/web/src/features/motivation/copy.ts#buildShareSummary` 是
 *   全仓唯一读 `totals` 的界面代码；`apps/mobile/src/screens/GrowthScreen.tsx`
 *   `grep` 0 处 `activityTotals`。
 * · 影响：无（累计量仍然通过里程碑可见）。
 * · 最小一步：在 `GrowthBoard` 里加一个 `ActivityTotalsRow` 区块，
 *   两端的文案各出一条词条。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本文件**不 import `react-native`，也不 import `@heyta/i18n`**
 *
 * 前者：`packages/ui/vitest.config.ts` 跑在 **node** 环境，`react-native` 是
 * Flow 源码，node 解析不了它。这条约束顺带钉住了"model 必须宿主无关"。
 * 后者：i18n 包自己带过一份 React，四端会同时中招（`check:mobile-bundle` 盯着）。
 * 文案一律由宿主注入，依赖行内容的项写成函数。
 */

import {
  toLocalDate,
  type Habit,
  type HabitLog,
  type IdentityTagKind,
  type IdentityTagProgress,
  type LocalDate,
  type MilestoneKind,
  type MilestoneProgress,
  type TodayProgress,
  type WeeklyReview,
} from '@heyta/domain';
import type { HabitGrowthFn } from '../habits/model.js';

/**
 * 热力图上"一天做了几件"的**事实**。
 *
 * 🔴 刻意在这里**重新声明**而不是从 `@heyta/app-host` 转出：共享层不能 import
 * 宿主接线层（见文件头）。它的结构与
 * `app-host#dailyActivityCountsFromState` 的返回项（`DailyActivityCount`）
 * **逐字段相同**，所以宿主可以直接把那个函数的返回值传进来，不需要适配层。
 * 一旦 app-host 那边改了字段名，这里会**编译报错**（宿主传参处不匹配），
 * 而不是静默画出空的热力图。
 */
export interface ActivityDayCount {
  readonly date: LocalDate;
  readonly count: number;
}

/** 热力图强度档位。与 `@heyta/design-system#HEAT_TOKENS` 的下标域同源。 */
export type ActivityHeatLevel = 0 | 1 | 2 | 3 | 4;

/** 热力图里的一天：事实 + 展示分档。 */
export interface ActivityHeatmapDay {
  readonly date: LocalDate;
  readonly count: number;
  readonly level: ActivityHeatLevel;
}

/**
 * 今日进度该说哪句话。
 *
 * 四种状态**互斥且穷尽**，顺序即优先级：
 *   - `idle`：今天什么都没做、也没有计划 —— 不安慰也不指责，只陈述；
 *   - `unplanned`：没有计划但做了事 —— 这正是小胜原则要的那种反馈，
 *     **不能**因为"计划是 0"就说成 0%；
 *   - `allDone`：有计划且做完了 —— 闭环态；
 *   - `remaining`：还有没做的 —— 只报数量，不催。
 *
 * 🔴 这个分支原来在 `apps/mobile/src/lib/growth-display.ts`，而 web 的
 * `TodayProgressCard.tsx` 里有**逐字相同**的第二份（`hintText`）。合并到
 * 共享层正是这一刀的目的：两端说相反的话（`total === 0` 时一边说"今天没事"
 * 一边说"还剩 -1 件"，实测原文见 web 那个文件的注释）不会再发生。
 */
export type GrowthHint = 'idle' | 'unplanned' | 'allDone' | 'remaining';

export function growthHint(progress: TodayProgress): GrowthHint {
  if (progress.total === 0) {
    return progress.done > 0 ? 'unplanned' : 'idle';
  }
  return progress.done >= progress.total ? 'allDone' : 'remaining';
}

/** 进度数字 `已完成/计划`（纯数字与斜杠，不含语言）。 */
export function ratioText(progress: TodayProgress): string {
  return `${String(progress.done)}/${String(progress.total)}`;
}

/**
 * 进度条宽度百分比，夹在 0–100。
 *
 * 🔴 必须夹紧：`ratio` 由领域层给出时理论上已在 0–1，但进度条是**渲染**层，
 * 一个越界的值在这里表现为"条子不见了"或"条子盖住整行"，而没有任何报错。
 * 夹紧是一次廉价的防御，测试能证明它在。
 */
export function progressPercent(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.max(0, Math.min(1, ratio)) * 100;
}

/**
 * 进度条的**比例**（0–1），供 RN 的 `scaleX` 用。
 *
 * ⚠️ 与 `progressPercent` 并存不是重复：`scaleX` 的定义域是比例，
 * 百分比是画宽度的旧写法。两个都留着是因为 web 迁移前两处各自在用，
 * 而它们**共用同一段夹紧**（`progressPercent` 转个手就是它）。
 */
export function progressRatio(ratio: number): number {
  return progressPercent(ratio) / 100;
}

/**
 * 没有计划、却有完成 —— 最容易做错的一种状态。
 *
 * 按 `done / total` 算会得到 0/0，界面上只能显示"0%"或"空"，而用户刚刚
 * 明明做完了一件事。领域层把它算成 `ratio = 1`（见 `today-progress.ts`），
 * 这里只负责把它**认出来**，好让界面说清楚那个 100% 哪来的。
 */
export function isUnplannedOnly(progress: TodayProgress): boolean {
  return progress.total === 0 && progress.done > 0;
}

/**
 * 明细清单（习惯 / 任务 / 计划外）只在该展开时展开。
 *
 * 🔴 没有计划时铺一行 `0 / 0 / 0` 除了让人以为自己漏了什么，没有任何信息量。
 * 这条判据原来在 web 的 `TodayProgressCard` 里（`progress.total > 0 &&`），
 * 而 mobile **没有**这条 —— 手机上空计划也会画出三行 0。合并时取 web 的口径。
 */
export function shouldShowTodayBreakdown(progress: TodayProgress): boolean {
  return progress.total > 0;
}

/** 今日专注时长 > 0 才展示那一项（0 分钟不是一则信息）。 */
export function shouldShowTodayFocus(progress: TodayProgress): boolean {
  return progress.focusMinutes > 0;
}

/** 周复盘的三个维度。顺序 = 展示顺序，**不按大小重排**。 */
export const WEEK_STAT_IDS = ['checkIns', 'tasksCompleted', 'focusMinutes'] as const;
export type WeekStatId = (typeof WEEK_STAT_IDS)[number];

/** 周复盘里的一行：本周值 + 上周值。`previous` 是中性呈现，不带涨跌色。 */
export interface WeekStatRow {
  readonly id: WeekStatId;
  readonly value: number;
  readonly previous: number;
}

/**
 * 周复盘的三个数字。
 *
 * 🔴 顺序固定（打卡 → 任务 → 专注），**不按数值大小排** —— 那是排行榜的形状，
 * 而这一屏的红线是"只与自己比"。
 *
 * ⚠️ `weekHeadlineCount` 单独一个函数而不是在这里挑：主标题讲哪个维度是
 * **领域层**选的（`WeeklyReview['headline']`），这里只把三个数字摆出来。
 */
export function weekStatRows(review: WeeklyReview): WeekStatRow[] {
  return WEEK_STAT_IDS.map((id) => ({ id, value: review[id], previous: review.previous[id] }));
}

/** 周复盘主标题（`WeeklyReview['headline']` 去掉 `none`）。 */
export type HeadlineKind = Exclude<WeeklyReview['headline'], 'none'>;

/**
 * 本周主标题要讲的那个数字。
 *
 * `headline` 由领域层选出"本周最活跃的维度"，这里的映射必须**穷尽**它 ——
 * 否则会出现"标题在讲打卡，数字却是专注分钟"。用 `switch` 而不是查表，
 * 是为了让领域层将来多一个维度时这里**编译报错**，而不是默默取到 0。
 */
export function weekHeadlineCount(review: WeeklyReview): number {
  switch (review.headline) {
    case 'checkIns':
      return review.checkIns;
    case 'tasksCompleted':
      return review.tasksCompleted;
    case 'focusMinutes':
      return review.focusMinutes;
    case 'none':
      return 0;
  }
}

/** 里程碑里的一个档位。 */
export interface MilestoneTier {
  readonly threshold: number;
  readonly reached: boolean;
}

/** 里程碑里一个维度压成的一块。 */
export interface MilestoneGroup {
  readonly kind: MilestoneKind;
  /** 当前值（`focusHours` 已是小时数，与领域层一致）。 */
  readonly current: number;
  /** 已达成档数 / 总档数。 */
  readonly reached: number;
  readonly total: number;
  /** 下一档阈值；该维度全部达成时为 undefined。 */
  readonly next?: number;
  /** 距离下一档的进度 0–1；全部达成时为 1。 */
  readonly ratio: number;
  readonly maxed: boolean;
  /** 全部档位（阈值升序，含各自是否达成）—— 界面据此画那一排档位。 */
  readonly tiers: MilestoneTier[];
}

/**
 * 把领域层"每一档一条"的列表压成"每个维度一块"。
 *
 * 维度顺序 = 输入里首次出现的顺序（即 `MILESTONE_DEFINITIONS` 的顺序），
 * **刻意不按达成数重排** —— 那是排行榜的形状，而本设计的红线是"只与自己比"。
 *
 * ⚠️ web 的 `MilestoneMap.tsx` 原本自己内联了一段"连续出现即分块"的循环
 * （它依赖 `kind` 成组出现），而 mobile 用的是 `growth-display#milestoneGroups`。
 * 两个实现在**输入不成组**（领域层将来改了排序）时的行为不同：内联版会把
 * 同一维度拆成两块，而这里是先分桶再按首次出现定序 —— 后者才是稳的。
 *
 * @param milestones `@heyta/app-host#milestonesFromState` 的输出。
 */
export function milestoneGroups(
  milestones: readonly MilestoneProgress[],
): MilestoneGroup[] {
  const order: MilestoneKind[] = [];
  const byKind = new Map<MilestoneKind, MilestoneProgress[]>();

  for (const item of milestones) {
    let bucket = byKind.get(item.kind);
    if (bucket === undefined) {
      bucket = [];
      byKind.set(item.kind, bucket);
      order.push(item.kind);
    }
    bucket.push(item);
  }

  return order.map((kind) => {
    const items = byKind.get(kind)!;
    // 同一个维度的每一档共享同一个 `value`，取第一条即可（领域层保证）。
    const current = items[0]?.value ?? 0;
    const reached = items.filter((i) => i.reached).length;
    const next = items.find((i) => !i.reached)?.threshold;
    return {
      kind,
      current,
      reached,
      total: items.length,
      ...(next === undefined ? {} : { next }),
      ratio: next === undefined ? 1 : Math.max(0, Math.min(1, current / next)),
      maxed: next === undefined,
      // 领域层的顺序即定义表顺序；**不在这里重排**（重排就是排行榜的形状）。
      tiers: items.map((i) => ({ threshold: i.threshold, reached: i.reached })),
    };
  });
}

/** 已达成的身份标签 id（顺序与定义表一致，不重排）。 */
export function reachedTagIds(tags: readonly IdentityTagProgress[]): string[] {
  return tags.filter((tag) => tag.reached).map((tag) => tag.id);
}

/** 一个"还差多少"的标签。 */
export interface TagNearMiss {
  readonly id: string;
  /** 还差多少（`threshold - value`）。 */
  readonly gap: number;
  readonly kind: IdentityTagKind;
}

/**
 * 未达成的身份标签最多显示几个。
 *
 * 🔴 2 这个数字是**产品决定**，两端迁移前各自硬写过一次
 * （web 的 `NEAR_MISS_COUNT`、mobile 的 `nearMissTags(tags, 2)`）。
 * 全部铺开（8 个里 7 个是灰的）传达的是"你差得远"；按距离取最近的两个，
 * 传达的是"下一个就在前面"。现在只有一处。
 */
export const NEAR_MISS_LIMIT = 2;

/**
 * 最接近达成的未获得标签（最多 `limit` 个）。
 *
 * 🔴 按**距达标的比例**从近到远，不是按绝对值：`"还差 2 小时"` 与
 * `"还差 500 件"` 在绝对值上不可比，比例才可比。
 *
 * 🔴 **并列时按 id 字典序**（`localeCompare`）。随机顺序会让每次渲染的列表
 * 跳动，而"目标梯度"要的恰恰是"下一个就在眼前"的稳定感。
 * ⚠️ web 迁移前的实现**没有**这个 tie-break（`sort((a,b) => b.ratio - a.ratio)`
 * 单独一行），于是比例相等的两个标签在两次渲染里可能换位 —— 共享层补上它，
 * 这是相对 web 的一个**可见修正**（列表不再抖）。
 *
 * ⚠️ `limit <= 0` 时回空数组。这一行早退**只对负数承重**，对 `0` 不承重 ——
 * 故障注入实测（MV-B0）：把这一行删掉，`limit = 0` 的全部断言**依然全绿**
 * （`slice(0, 0)` 本来就是 `[]`），只有 `slice(0, -1)` 会返回前 N-1 条。
 * 所以单测里补了负数那两条边界；没有它们，这就是一行没人验证过的代码
 * （这正是本仓库反复踩的"假绿"，记录见 `tests/motivation-model.spec.ts` 文件尾）。
 */
export function nearMissTags(
  tags: readonly IdentityTagProgress[],
  limit: number,
): TagNearMiss[] {
  if (limit <= 0) return [];
  return tags
    .filter((tag) => !tag.reached)
    .slice()
    .sort((a, b) => b.ratio - a.ratio || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((tag) => ({ id: tag.id, kind: tag.kind, gap: tag.threshold - tag.value }));
}

/**
 * 一天做了几件 → 热力图档位。
 *
 * 🔴 它是**展示**参数，不是业务判据 —— 换一个图表库这份映射就要改。
 * web 迁移前它叫 `levelOf`，藏在 `features/motivation/selectors.ts` 里
 * （那个文件的注释已经写明"刻意留在壳里"）。现在两端共用这一份。
 *
 * 分档：0 → 0；1 → 1；2 → 2；3 → 3；4 及以上 → 4。
 */
export function activityLevel(count: number): ActivityHeatLevel {
  if (!Number.isFinite(count) || count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count === 3) return 3;
  return 4;
}

/**
 * 每日事实 → 带分档的格子。
 *
 * ⚠️ 只加 `level`，**不排序也不补天**：日期序列（含"有没有这一天"）由
 * `@heyta/app-host#dailyActivityCountsFromState` 负责 —— 它已经按
 * 旧 → 新排好、并补齐了窗口内每一天。在这里再排一次就是第二个真相。
 */
export function toActivityHeatmapDays(
  days: readonly ActivityDayCount[],
): ActivityHeatmapDay[] {
  return days.map(({ date, count }) => ({ date, count, level: activityLevel(count) }));
}

/** 窗口内一共做了几件。给整块热力图的无障碍名与图例用。 */
export function activityHeatmapTotal(days: readonly ActivityHeatmapDay[]): number {
  return days.reduce((sum, day) => sum + day.count, 0);
}

/**
 * 一个习惯的连续性行（L2）。
 *
 * 🔴 只有 `habit` + 领域层算好的两个视图，**没有排序** ——
 * 顺序就是传进来的 `habits` 顺序（`listHabits()` 已经是稳定顺序）。
 */
export interface HabitStreakRow {
  readonly habit: Habit;
  readonly resilience: ReturnType<HabitGrowthFn>['resilience'];
}

/**
 * 习惯 + 日志 → 每个习惯一行的连续性。
 *
 * 🔴 连续与韧性的**配对由宿主注入**（{@link HabitGrowthFn}）：
 * `@heyta/app-host#habitGrowth` 的文件头把"两个数字必须用同一份日志、
 * 同一个 `today` 算出来"写成了硬契约，这里自己调 `computeStreak` +
 * `describeHabitResilience` 就会让配对出现第二个实现。
 * 与 `habits/model.ts#toHabitProgressRows` 同一个手法（照抄那个模式）。
 *
 * ⚠️ `now` 显式传入而不是读 `Date.now()`：否则同一次渲染里不同习惯可能跨过
 * 午夜，显示不一致；而且测试无法稳定断言。
 * 与 `habits/model.ts#toHabitProgressRows` 逐字同一个约定（`now` 进，
 * 内部换一次 `LocalDate`）—— 宿主因此不必自己换算，也就不会有两处换算漂移。
 */
export function toHabitStreakRows(
  habits: readonly Habit[],
  logs: readonly HabitLog[],
  now: number,
  growth: HabitGrowthFn,
): HabitStreakRow[] {
  const today = toLocalDate(now);
  return habits.map((habit) => ({
    habit,
    resilience: growth(habit, logs, today).resilience,
  }));
}

/**
 * 分享小结复制结果的复位延迟（毫秒）。
 *
 * 🔴 2 秒后回到常态，避免"已复制"永久停在那里看起来像状态卡住了。
 * 它原来硬写在 web 的 `GrowthView.tsx#ShareSection` 里（`2000`），
 * 现在有名字、也只该有一处。
 */
export const SHARE_RESET_MS = 2000;

/** 分享按钮的状态机（三态，互斥）。 */
export type ShareState = 'idle' | 'copied' | 'failed';
