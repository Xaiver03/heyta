/**
 * 习惯连续天数（Streak）
 * =========================
 *
 * 调研结论：**没有成熟的开源库**能用（closest 是 habitica 的服务端逻辑，
 * 与我们的数据模型不匹配且非独立包）。所以这里自研，但要写得可测。
 *
 * 最容易搞错的三件事，全部显式处理：
 *   1. **"今天还没打卡"不应该断掉连续天数。** 用户上午看应用，
 *      昨天打了、今天还没打，streak 不能显示 0 —— 那会让人以为记录丢了。
 *   2. **非每日习惯要按频率判断。** 每周一三五的习惯，周二没打卡不是断。
 *   3. **补打卡**要计入，但要有上限，否则连续天数失去意义。
 */

import type { Habit, HabitFrequency, HabitLog } from './entities.js';
import {
  addDays,
  daysInMonth,
  diffDays,
  isoWeekday,
  startOfMonth,
  toLocalDate,
  type LocalDate,
} from './date.js';

export interface StreakResult {
  /** 当前连续天数。 */
  current: number;
  /** 历史最长连续天数。 */
  longest: number;
  /** 最后一次打卡日期。从未打卡时为 undefined。 */
  lastDate?: LocalDate;
}

/** 某天是否应该是"该打卡的日子"。 */
export function isScheduledOn(frequency: HabitFrequency | undefined, date: LocalDate): boolean {
  // 未设置频率 = 每天
  if (frequency === undefined) return true;

  switch (frequency.type) {
    case 'daily':
      return true;
    case 'weekly':
      return frequency.daysOfWeek.includes(isoWeekday(date));
    case 'interval': {
      // 固定间隔：用天数序号取模。基准取 1970-01-01（周四），
      // 只要基准固定，间隔判定就是确定的。
      const every = Math.max(1, frequency.everyNDays);
      const days = diffDays('1970-01-01', date);
      return ((days % every) + every) % every === 0;
    }
  }
}

/**
 * 这一天**记了几格**（工单 W6 的那个数的唯一算法）。
 *
 * 🔴 规则只有一条：**一条存在的打卡记录没写 `value` 时按 `target` 算，不是按 0**。
 * 理由是写路径就是这么写的（`@heyta/app-host#checkIn` 缺省落进 `habit.target ?? 1`），
 * 而"打过卡"在界面上只能有一个意思。
 * 这条以前**没有所有者**：`isAchieved` 用 `?? target`、`completionRatio` 用 `?? 0`、
 * 移动端的详情自己写了一遍 `?? target ?? 1` —— 三份答案是同一条不变量的三个断面，
 * 症状是"连续天数说今天达成、完成度说 0 %"，而两边都不报错。
 *
 * ⚠️ **根本没有记录**时返回 0（不是 target）：那是"今天没做"，
 * 与"做了但没记量"是两件事，必须分开。
 */
export function habitLogValue(habit: Habit, log: HabitLog | undefined): number {
  if (log === undefined) return 0;
  return log.value ?? habit.target ?? 1;
}

/**
 * 打卡是否算"达成"。
 *
 * ⚠️ **导出**是刻意的：`habit-resilience.ts` 必须用同一套判据。
 * 两个模块各写一遍 `goalType` 的 switch，症状是"连续天数说达成、
 * 成就徽章说没达成"，且两边都不报错。
 */
export function isAchieved(habit: Habit, log: HabitLog): boolean {
  const target = habit.target ?? 1;
  const value = habitLogValue(habit, log);
  switch (habit.goalType ?? 'atLeast') {
    case 'atLeast':
      return value >= target;
    case 'atMost':
      return value <= target;
    case 'exactly':
      return value === target;
  }
}

/**
 * 计算连续天数。
 *
 * @param habit 习惯定义
 * @param logs 该习惯的打卡记录（可不排序）
 * @param today 今天（本地日历日）。**必须显式传入** —— 内部读 Date.now()
 *              会让这个函数不可测，而它的边界条件恰恰最需要测。
 */
export function computeStreak(
  habit: Habit,
  logs: readonly HabitLog[],
  today: LocalDate,
): StreakResult {
  // 只保留达成且未删除的记录
  const achievedDates = new Set(
    logs
      .filter((l) => l.deletedAt === undefined && l.habitId === habit.id)
      .filter((l) => isAchieved(habit, l))
      .map((l) => l.date),
  );

  if (achievedDates.size === 0) {
    return { current: 0, longest: 0 };
  }

  const sorted = [...achievedDates].sort();
  const lastDate = sorted[sorted.length - 1]!;

  // ── 历史最长 ────────────────────────────────────────────
  // 只数**该打卡的日子**，跳过不该打卡的日子（否则每周一次的习惯永远只有 1）
  let longest = 0;
  let run = 0;
  let cursor = sorted[0]!;
  const end = sorted[sorted.length - 1]!;
  // 防御：损坏数据可能产生荒谬范围，限制扫描长度
  const maxSpan = 365 * 20;
  let guard = 0;
  while (diffDays(cursor, end) >= 0 && guard++ < maxSpan) {
    if (isScheduledOn(habit.frequency, cursor)) {
      if (achievedDates.has(cursor)) {
        run++;
        longest = Math.max(longest, run);
      } else {
        run = 0;
      }
    }
    cursor = addDays(cursor, 1);
  }

  // ── 当前连续 ────────────────────────────────────────────
  /**
   * 从最后打卡日往回数。
   *
   * 关键判断：**如果最后打卡日不是今天，且今天本来该打卡但还没打，
   * 也不应该立刻断掉。** 只有"今天该打卡却空着"且已经过了今天才算断 ——
   * 但我们无法判断"一天结束"（用户可能晚上才打）。
   *
   * 所以规则是：从**最后打卡日**往回数，而不是从今天往回数。
   * 这样"昨天打了、今天还没打"会正确显示为昨天的连续数，
   * 而不是 0。
   */
  let current = 0;
  let c = lastDate;
  guard = 0;
  while (guard++ < maxSpan) {
    if (isScheduledOn(habit.frequency, c)) {
      if (achievedDates.has(c)) {
        current++;
      } else {
        break;
      }
    }
    c = addDays(c, -1);
  }

  /**
   * 但如果最后打卡日离今天太远（超过一个完整周期没打），连续就该归零。
   * 否则用户三个月没打卡，界面还显示"连续 5 天"。
   */
  if (!isStillAlive(habit, lastDate, today, achievedDates)) {
    current = 0;
  }

  return { current, longest, lastDate };
}

/**
 * 连续是否还"活着"：从最后打卡日到今天之间，
 * 有没有"该打卡却空着"的日子。
 *
 * 规则只有一条，且对**所有频率**都一样：
 *   - 只看**计划日**（按 `isScheduledOn`），不看自然日
 *   - **今天不算漏**（还没过完，晚上还有机会）
 *   - 漏掉哪怕一个计划日就断
 *
 * 所以"每日习惯允许昨天没打"与"每周一次允许一个完整周期"不是两条规则，
 * 而是同一条规则在不同频率下的样子 —— 每日习惯的"下一个计划日"就是今天，
 * 每周一次的"下一个计划日"在 7 天后，扫描自然会把这段时间放行。
 *
 * ⚠️ 曾经这里写着"其他频率允许一个完整周期（7 天）"，并为此引入了一个
 * `grace` 阈值。**那个阈值是错的**，因为它同时被当作日历日和"漏了几次"
 * 使用，导致每 7 天一次的习惯可以漏 7 次。见下面 🔴 注释与
 * `tests/domain.spec.ts` 里的守卫。
 */
function isStillAlive(
  habit: Habit,
  lastDate: LocalDate,
  today: LocalDate,
  achieved: Set<LocalDate>,
): boolean {
  const gap = diffDays(lastDate, today);
  if (gap <= 0) return true;

  /**
   * 判据只有一条：从最后打卡日到今天之间，有没有**该打卡却空着**的日子。
   * 有就断。**不含今天** —— 今天还没过完，晚上还有机会（`current` 也是
   * 从最后打卡日往回数，两边口径必须一致，见上面的注释）。
   *
   * 🔴 这里**不要**再引入"宽限几天"的第二个阈值。
   *
   * 旧实现拿同一个 `grace` 当两种单位用：先用它比**日历日**
   * （`gap <= grace`），再用它比**漏掉的计划日个数**（`missed >= grace`）。
   * 每日习惯两者恰好相等（grace = 1），所以这个混用完全看不出来；
   * 但频率是"每 7 天一次"时，第二个比较就变成了「可以漏 **7 次**」——
   * 而注释写的意图是「允许**一个**完整周期」。
   * 实测后果：每 7 天一次的习惯漏掉 1~6 个计划日，界面仍然显示连续。
   *
   * "允许一个完整周期"这句话本来就由**逐日扫描**表达：扫描走完没有
   * 漏掉的计划日，就等于"下一个计划日还没到"。不需要额外的时间阈值。
   */
  let c = lastDate;
  for (let i = 0; i < gap; i++) {
    c = addDays(c, 1);
    if (diffDays(c, today) === 0) break; // 今天不算漏
    if (isScheduledOn(habit.frequency, c) && !achieved.has(c)) return false;
  }
  return true;
}

/**
 * 习惯在给定日期的完成进度（0–1）。
 * UI 用来画环形进度，避免在组件里重复实现这个除法。
 *
 * 🔴 分子走 {@link habitLogValue}，与 `isAchieved` **同一个缺省**。
 * 这里曾经是 `log?.value ?? 0` —— 于是"打过一条没写量的卡"会同时
 * 「算达成」（`isAchieved` 缺 target）与「完成度 0 %」（这里缺 0），
 * 而这两句话说的是同一格。W6 把"今天记了几格"定成只有一个答案之后，
 * 这条缺省就是那个唯一算法的第二个断面。
 */
export function completionRatio(habit: Habit, log: HabitLog | undefined): number {
  const target = habit.target ?? 1;
  if (target <= 0) return 0;
  return Math.min(1, habitLogValue(habit, log) / target);
}

// ─────────────────────────────────────────────────────────────
// 习惯统计的读侧（工单 W8）：本月四格 + 历史两格
// ─────────────────────────────────────────────────────────────

/**
 * 一个自然月的打卡统计 + 两个历史总量。**全部从 op-log 物化状态推导**，
 * 不落任何新字段（AGENTS §3.3；ADR-0022 的"派生不上库存"同一条纪律）。
 *
 * 口径是**已拍板的裁决**（工单 W8 的 A/B/C/D 四条，证据见
 * `docs/research/detail-pane-alignment-and-spaced-review.md` C1b-Q2），
 * 不是外部事实的复刻 —— 改这里任何一条前先看注释里的理由。
 */
export interface HabitPeriodStats {
  /** `'YYYY-MM'`：传入 `today` 所在的**自然月**（裁决 B：不用滚动 30 天）。 */
  monthKey: string;
  /**
   * 该月**达成天数**（裁决 C：天 = 唯一的连续性单位）。
   * 一条存在的 log 没写 `value` 时按 {@link habitLogValue} 的缺省算，
   * 未达标的那天不记分数天，但它的量照记进 {@link monthValue}。
   */
  achievedDays: number;
  /**
   * 该月**已到期**的计划日数（分母，见 {@link computeHabitPeriodStats} 的 🔴 注释）。
   * 0 表示"这个月还没有'率'可言"—— 界面此时必须显示占位符而不是 0%。
   */
  scheduledDays: number;
  /**
   * 完成率 = 到期计划日中达成的天数 / {@link scheduledDays}。
   * 🔴 `scheduledDays === 0` 时**必须是 0**（绝不产生 NaN / Infinity），
   * 由界面按 `scheduledDays === 0` 显示占位符。
   */
  rate: number;
  /** 该月完成量 = `Σ habitLogValue`（含未达标的那天；裁决 C 的另一条腿）。 */
  monthValue: number;
  /** 历史总完成量 = `Σ habitLogValue`，**不限当月**（裁决 D：`unit` 只做显示，求和按纯数）。 */
  totalValue: number;
  /**
   * 历史达成天数。与 `computeHabitResilience().total` **同一口径**
   * （同是"未删除且达成的去重日期数"），供"总打卡 N 天"那一格消费。
   */
  totalAchievedDays: number;
}

/**
 * 计算某个自然月的习惯统计。
 *
 * @param habit 习惯定义
 * @param logs  该习惯的、**或未经过滤的全集**都行：函数内部按
 *              `habitId === habit.id` 收窄，并按 `deletedAt === undefined`
 *              滤墓碑。🔴 **这里必须自己滤**，而
 *              `@heyta/app-host#habitGrowth` 那层不滤 —— 因为 `computeStreak`
 *              内部各自判墓碑，而这里的**求和路径不经过它们**。漏掉这层过滤
 *              就是一个真 bug：一条已撤销的打卡量会留在"本月完成量"里。
 *              谓词与 `computeStreak`/`achievedDates` 逐字同一
 *              （`deletedAt === undefined` 才算活着），两份判据不许长两个样子。
 * @param today 今天（本地日历日）。**必须显式传入**（本文件既有纪律：内部读
 *              `Date.now()` 会让"月中/月末"这类边界条件不可测）。
 *
 * 🔴 **分母只数"已经到期"的计划日** —— 这条是**本线 2026-10-05 拍的裁决**（产品负责人把
 * 仓库内的产品决策权交了下来，原话与代价记在工单 §8.119 与调研 C1b-Q2 的拍板记录），
 * 外部竞品没有一手对照（滴答《成就值》只支撑"分母是安排量而非自然日"那一半）。
 * 即：`scheduledDays` 数的是 `date <= min(today, 该月末)` 且
 * `date >= max(该月首日, 该习惯创建日)` 的计划日。理由有三：
 *   1. 未完成的本月剩余天数不是"做得不好"。用全月当分母会得到一个
 *      **只有到月末才等于真实值、每天自己往下掉**的数 —— 那是倒计时，不是完成率；
 *   2. heyta 的激励体系红线是"从不制造愧疚"（`docs/plans/roadmap.md` §1.2），
 *      一个必然从 100% 起步往下掉的百分比违反它；
 *   3. 该月还没有任何计划日到期时**没有"率"可言**：`scheduledDays` 返回 0、
 *      `rate` 返回 0，由界面显示占位符（这也是 `rate` 在 0 分母时不取 NaN 的原因）。
 *
 * 分母用**该年该月的实际计划日数**（2 月/闰年/跨月都算对，`daysInMonth` 交给
 * 原生 `Date`）—— 调研 C1b-Q2 点名了 Loop 那处"卡片按日历月截断、区间标签写死
 * 30/91/365"的名实错位，这一层不许复发。
 *
 * `rate` 的**分子**只数"到期计划日中达成"的天（分母裁决的同一把尺）。
 * 它与 {@link achievedDays} 在"达成日全落在计划日"时相等（绝大多数情形）；
 * 若某条达成记录写在**非计划日**（用户手动补了个周日之外的日子），
 * `achievedDays` 会包含它而分子不包含 —— 于是"本月打卡 10 天"与"完成率 9/9"
 * 并存是**事实**而不是矛盾，两边各自有定义。
 */
export function computeHabitPeriodStats(
  habit: Habit,
  logs: readonly HabitLog[],
  today: LocalDate,
): HabitPeriodStats {
  const monthKey = today.slice(0, 7);
  const first = startOfMonth(today);
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const last = `${monthKey}-${String(daysInMonth(year, month)).padStart(2, '0')}`;
  /**
   * 下界取"该月首日与该习惯创建日的较晚者"。
   * `Habit.createdAt` 在 `EntityBase` 上是**必填**的 epoch ms
   * （`entities.ts` 文件头：LWW 要确定性比较），所以这里没有"缺创建日"的分支 ——
   * 若哪个宿主造出 `createdAt: 0` 的数据，下界落到 1970-01-01，
   * 与"该月首日"取较晚者后仍是该月首日，行为不变。
   */
  const created = toLocalDate(habit.createdAt);
  const lower = created > first ? created : first;
  // `monthKey` 就是从 `today` 切的，所以 `upper` 恒等于 `today`；
  // 写成 `min(today, 月末)` 是把裁决的**定义**原样落地，不是多余分支。
  const upper = today < last ? today : last;

  // 逐日扫描收集"已到期计划日"。一个月至多 31 个刻度；`lower > upper`
  // （比如数据里 created 在未来）时循环一次都不进，分母自然为 0。
  const dueScheduled: LocalDate[] = [];
  if (lower <= upper) {
    let cursor = lower;
    // 防御：损坏的日期串（如 `2024-02-30`）会让 addDays 抛；循环上界由
    // diffDays 钉死，最多一个月。
    const steps = diffDays(lower, upper);
    for (let i = 0; i <= steps; i += 1) {
      if (isScheduledOn(habit.frequency, cursor)) dueScheduled.push(cursor);
      cursor = addDays(cursor, 1);
    }
  }
  const scheduledDays = dueScheduled.length;

  const alive = logs.filter(
    (l) => l.habitId === habit.id && l.deletedAt === undefined,
  );

  let monthValue = 0;
  let totalValue = 0;
  const achievedInMonth = new Set<LocalDate>();
  const achievedAll = new Set<LocalDate>();
  for (const log of alive) {
    const value = habitLogValue(habit, log);
    totalValue += value;
    const inMonth = log.date.slice(0, 7) === monthKey;
    if (inMonth) {
      monthValue += value;
    }
    if (isAchieved(habit, log)) {
      achievedAll.add(log.date);
      if (inMonth) achievedInMonth.add(log.date);
    }
  }

  const achievedDays = achievedInMonth.size;
  // 分子与分母同一把尺：只数"到期计划日里达成"的天。
  let achievedDue = 0;
  for (const day of dueScheduled) {
    if (achievedInMonth.has(day)) achievedDue += 1;
  }
  const rate = scheduledDays === 0 ? 0 : achievedDue / scheduledDays;

  return {
    monthKey,
    achievedDays,
    scheduledDays,
    rate,
    monthValue,
    totalValue,
    totalAchievedDays: achievedAll.size,
  };
}
