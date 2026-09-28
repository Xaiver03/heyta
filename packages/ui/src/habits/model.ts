/**
 * 习惯打卡（共享模型）
 * ======================
 *
 * M3 第七刀（habits）的**判断层**：一个习惯今天打没打、三个连续数字从哪来、
 * 近 90 天的格子怎么切、哪些格子是空的、补打卡/重新开始的入口该不该出现。
 * **组件里因此没有分支**，不需要靠快照测试兜。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 领域规则一条都不在这里重写
 *
 * 「怎么算连续」「冻结能保住几天」「补上之后是连续几天」全在 `@heyta/domain`
 * （`computeStreak` / `describeHabitResilience`），连续与韧性的**配对**在
 * `@heyta/app-host#habitGrowth`（那里写明了"两个数字必须用同一份日志、
 * 同一个 today"）。本文件刻意**不**自己调那两个领域函数：
 * 那会让配对出现第二个实现，而这正是 `habitGrowth` 文件头点名要防的漂移。
 * 所以配对**由宿主注入**（{@link HabitGrowthFn}）—— 两端都传
 * `habitGrowth`，测试传一个桩。这里只做**展示**上的事：
 *
 *   1. 把「今天有没有打卡」「今天那条 log」补上（宿主的两份投影都缺这一步）；
 *   2. 近 N 天格子怎么排（列 = 周、行 = 星期几、跨月在哪一列打月份标签）；
 *   3. 0/4 两档的强度 token 映射（`@heyta/design-system` 的 `HEAT_TOKENS`）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本文件**不 import `react-native`，也不 import `@heyta/i18n`**
 *
 * 前者：`packages/ui/vitest.config.ts` 跑在 **node** 环境，`react-native`
 * 是 Flow 源码，node 解析不了它。这条约束顺带钉住了"model 必须宿主无关"。
 * 后者：i18n 包自己带过一份 React，四端会同时中招（见 `TaskList.tsx` 文件头）。
 * 文案一律由宿主注入。
 */

import { HEAT_TOKENS } from '@heyta/design-system';
import {
  addDays,
  completionRatio,
  isoWeekday,
  toLocalDate,
  type Habit,
  type HabitLog,
  type HabitResilienceView,
  type LocalDate,
  type StreakResult,
} from '@heyta/domain';

/**
 * 热力图的默认窗口（天）。
 *
 * ⚠️ 它是**窗口长度**，不是"最近一年"：web 原来的热力图就是 90 天，
 * 成长页的年度视图是另一个窗口（365）。把两者合并成一个常量会让其中
 * 一个页面上的文案说谎。共享层的默认值只服务习惯卡片。
 */
export const HABIT_HEATMAP_DAYS = 90;

/**
 * 一周从星期几开始排（列）。
 *
 * `0` = 周日。与 web 原来那个日历库的默认值一致 —— 换成周一会让所有已有
 * 截图的列序变一次，而那不是这一刀要改的东西。
 */
export type HeatmapWeekStart = 0 | 1;
export const HEATMAP_WEEK_START: HeatmapWeekStart = 0;

/** 强度档位。与 `@heyta/domain#intensityLevel` 的返回类型同源（0 = 那天没打）。 */
export type HabitHeatLevel = 0 | 1 | 2 | 3 | 4;

/**
 * 热力图格子能用的**颜色 token 名**。
 *
 * 🔴 刻意不是 `TokenName`（那是全部 token 的联合，含间距/圆角等**数字** token）。
 * 标成 `TokenName` 会让 `tokens[token]` 的类型变成 `string | number`，
 * 喂给 `backgroundColor` 直接编译不过 —— 这个联合每一项都是**颜色**，
 * 与 `categories/model.ts` 同一个理由。
 */
export type HabitHeatToken = (typeof HEAT_TOKENS)[number];

/** 热力图里的一天。`count` 是**事实**（那天打了几次），`level` 是展示分档。 */
export interface HeatmapDay {
  readonly date: LocalDate;
  readonly count: number;
  readonly level: HabitHeatLevel;
}

/**
 * 热力图的一列 = 一周。
 *
 * `days` **恒为 7 项**（首尾用 `null` 补齐）—— 补齐后的网格才不会在
 * 第一列/最后一列塌掉。`month` 是这一列要打的月份标签（1–12），
 * `undefined` 表示这一列不打（月份与上一列相同）。
 */
export interface HeatmapWeek {
  readonly days: readonly (HeatmapDay | null)[];
  readonly month: number | undefined;
}

/** 一个习惯要渲染的全部内容。**全部由纯函数算出来**，组件只负责摆。 */
export interface HabitProgressRow {
  readonly habit: Habit;
  /** 今天是否已打卡。 */
  readonly doneToday: boolean;
  /**
   * 今日完成比例（0–1）。
   *
   * 🔴 它由 `@heyta/domain#completionRatio` 算（`log.value / (habit.target ?? 1)`），
   * 不是"打过就是 1" —— 目标 8 杯水、今天喝了 4 杯时它是 0.5。
   * 共享层带上它，是为了让"今天完成了多少"在两端只有一个答案。
   */
  readonly todayRatio: number;
  /** 今日打卡记录（未删除；可能不存在）。 */
  readonly todayLog: HabitLog | undefined;
  /** 连续天数结果（current / longest / lastDate）。**日历口径**。 */
  readonly streak: StreakResult;
  /**
   * 韧性与修复机会（冻结 / 续接 / 重新开始）。**算上冻结之后的口径**，
   * 界面上显示的是它（与 `streak` 并存，但**不许相减** —— ADR-0022）。
   */
  readonly resilience: HabitResilienceView;
}

/**
 * 连续 + 韧性的配对函数。**宿主注入**，共享层不认识 `@heyta/app-host`。
 *
 * 两端都传 `habitGrowth`（`packages/app-host/src/motivation.ts`）——
 * 那里是配对的唯一实现。测试传一个桩，就能在不碰领域层的前提下把
 * 本文件的每一个分支跑到。
 */
export type HabitGrowthFn = (
  habit: Habit,
  logs: readonly HabitLog[],
  today: LocalDate,
) => { readonly streak: StreakResult; readonly resilience: HabitResilienceView };

/**
 * 习惯 + 全部打卡记录 → 每个习惯一行的进度。
 *
 * 🔴 `now` 显式传入而不是读 `Date.now()`：否则同一次渲染里不同习惯可能跨过
 * 午夜，显示不一致；而且测试无法稳定断言。
 *
 * ⚠️ 传进来的 `logs` 必须已经滤掉墓碑（`habitActions.listLogs()` 已经是）。
 * 这里**不再滤一遍**：两处都滤会让"撤销打卡之后今天到底算不算打过"
 * 出现两个答案，而 `computeStreak` 内部自己按 `deletedAt` 判定。
 */
export function toHabitProgressRows(
  habits: readonly Habit[],
  logs: readonly HabitLog[],
  now: number,
  growth: HabitGrowthFn,
): HabitProgressRow[] {
  const today = toLocalDate(now);
  return habits.map((habit) => {
    const todayLog = logs.find((log) => log.habitId === habit.id && log.date === today);
    const { streak, resilience } = growth(habit, logs, today);
    return {
      habit,
      todayLog,
      doneToday: todayLog !== undefined,
      // 传 `undefined` 表示"今天还没打卡" —— 领域层会按 value 0 算。
      todayRatio: completionRatio(habit, todayLog),
      streak,
      resilience,
    };
  });
}

/**
 * 打卡一次算几档。
 *
 * 🔴 现状是**二值**（打过 = 4，没打 = 0），与 web 迁移前逐字一致。
 * 习惯有 `target`、log 有 `value`，所以"打了一半"在数据上是存在的 ——
 * 把它画成中间档是**产品改动**，不是这次迁移该顺手做的事：那会让所有
 * 历史热力图的观感变一次，而没有任何判据要求这么做。
 * ⇒ 记账在此，最小一步：先给 `HabitLog.value / habit.target` 定一个分档口径
 * （领域层），再改这一个函数。
 */
export function habitHeatLevel(count: number): HabitHeatLevel {
  return count === 0 ? 0 : 4;
}

/** 强度档位 → heat token 名。0 档是"没有记录"的中性色，不是"没有颜色"。 */
export function heatmapLevelToken(level: HabitHeatLevel): HabitHeatToken {
  return HEAT_TOKENS[level];
}

/** 窗口内一共打了几次。给整块热力图的无障碍名与可选的图例用。 */
export function heatmapTotal(days: readonly HeatmapDay[]): number {
  return days.reduce((sum, day) => sum + day.count, 0);
}

/** `YYYY-MM-DD` → 月份（1–12）。不 new Date：字符串本身已经够用，且不涉时区。 */
export function monthOfDate(date: LocalDate): number {
  return Number(date.slice(5, 7));
}

/**
 * 月份标签的词条 key（1–12 月，按序）。
 *
 * 🔴 与 `sync/model.ts` 的 `ENTITY_LABEL_KEYS` 同一个形状：**共享层只拥有
 * key 的字符串本身**（一个字符串字面量联合），不 import `@heyta/i18n`；
 * 宿主拿它去自己的词条表取文案。两端各写一份 12 项的表就是漂移的起点 ——
 * 改一处不会让任何测试变红，只会让一个端少一个月。
 *
 * ⚠️ 命名残差：这 12 个键在 `web.heatmap.*` 命名空间下（成长页的年度视图
 * 与习惯热力图本来共用它们），而热力图这件事四端完全同义 ——
 * 正确的命名空间是 `common.heatmap.*`。合并命名空间时这是纯改名。
 */
export type HeatmapMonthKey =
  | 'web.heatmap.month.1'
  | 'web.heatmap.month.2'
  | 'web.heatmap.month.3'
  | 'web.heatmap.month.4'
  | 'web.heatmap.month.5'
  | 'web.heatmap.month.6'
  | 'web.heatmap.month.7'
  | 'web.heatmap.month.8'
  | 'web.heatmap.month.9'
  | 'web.heatmap.month.10'
  | 'web.heatmap.month.11'
  | 'web.heatmap.month.12';

/** 1 月 → 12 月的词条 key，**下标 = 月份 − 1**。 */
export const HEATMAP_MONTH_KEYS: readonly HeatmapMonthKey[] = [
  'web.heatmap.month.1',
  'web.heatmap.month.2',
  'web.heatmap.month.3',
  'web.heatmap.month.4',
  'web.heatmap.month.5',
  'web.heatmap.month.6',
  'web.heatmap.month.7',
  'web.heatmap.month.8',
  'web.heatmap.month.9',
  'web.heatmap.month.10',
  'web.heatmap.month.11',
  'web.heatmap.month.12',
];

/**
 * 某一天落在**第几列**（0 = 该周的第一天）。
 *
 * ISO 的 `isoWeekday` 是 1=周一 … 7=周日；这里把它折成"按 `weekStartsOn`
 * 排列的 0–6"。周日开头时周一落在第 1 列 —— 这是热力图的标准排法。
 */
function weekdayColumn(date: LocalDate, weekStartsOn: HeatmapWeekStart): number {
  const zeroBased = isoWeekday(date) - 1; // 0=周一 … 6=周日
  return weekStartsOn === 1 ? zeroBased : (zeroBased + 1) % 7;
}

/**
 * 近 N 天的打卡数据。供热力图消费。
 *
 * 与 web 迁移前的 `selectHeatmap` 逐字同口径：从 `today-(days-1)` 到 `today`，
 * 每天 `count` 为 0/1，`level` 走 {@link habitHeatLevel}。
 */
export function habitHeatmap(
  logs: readonly HabitLog[],
  habitId: string,
  now: number,
  days: number = HABIT_HEATMAP_DAYS,
): HeatmapDay[] {
  const today = toLocalDate(now);
  const done = new Set(
    logs.filter((log) => log.habitId === habitId).map((log) => log.date),
  );

  const out: HeatmapDay[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    const count = done.has(date) ? 1 : 0;
    out.push({ date, count, level: habitHeatLevel(count) });
  }
  return out;
}

/**
 * 一维的日期序列 → 二维的周列。
 *
 * 🔴 **补齐首尾**：第一列前面缺的天、最后一列后面缺的天都补 `null`。
 * 不补的话第一列会从"今天是周三"开始往上顶，整个网格看起来像斜的，
 * 而且"同一列 = 同一周"这件事就不成立了 —— 用户横向读趋势的前提没了。
 *
 * 🔴 **月份标签只在"月份变了"的那一列打**。每一列都打会让 13 列里出现
 * 一串重复的「1月 1月 1月」，标签比数据还密；一列都不打则彻底失去时间轴。
 *
 * `now` 不在这里出现：`days` 的顺序已经是"旧 → 新"，排法只依赖日期本身。
 */
export function toHeatmapWeeks(
  days: readonly HeatmapDay[],
  weekStartsOn: HeatmapWeekStart = HEATMAP_WEEK_START,
): HeatmapWeek[] {
  const columns: (HeatmapDay | null)[][] = [];
  let current: (HeatmapDay | null)[] = [];

  const first = days[0];
  if (first !== undefined) {
    const lead = weekdayColumn(first.date, weekStartsOn);
    for (let i = 0; i < lead; i += 1) current.push(null);
  }

  for (const day of days) {
    current.push(day);
    if (current.length === 7) {
      columns.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    while (current.length < 7) current.push(null);
    columns.push(current);
  }

  let lastMonth: number | undefined;
  return columns.map((column) => {
    const firstDay = column.find((day): day is HeatmapDay => day !== null);
    if (firstDay === undefined) return { days: column, month: undefined };
    const month = monthOfDate(firstDay.date);
    if (month === lastMonth) return { days: column, month: undefined };
    lastMonth = month;
    return { days: column, month };
  });
}

/**
 * 有没有"可以补回来的那一天"。判据在领域层（`describeHabitResilience` 只在
 * `streakIfRepaired ≥ 2` 时给出 `repair`），这里只做取反。
 */
export function shouldOfferRepair(resilience: HabitResilienceView): boolean {
  return resilience.repair !== undefined;
}

/** 有没有"重新开始"的提示。同上，判据在领域层。 */
export function shouldOfferFreshStart(resilience: HabitResilienceView): boolean {
  return resilience.freshStart !== undefined;
}

/**
 * 这段连续里被冻结保住的天数。0 表示不显示那一行。
 *
 * ⚠️ 它**不是** `resilience.current - streak.current` —— 两个数字口径不同，
 * 相减不是事实（ADR-0022 记着实测：会把 1 天算成 7 天）。
 */
export function frozenDays(resilience: HabitResilienceView): number {
  return resilience.resilience.frozenInCurrentRun;
}
