/**
 * 间隔复习（`HabitFrequency` 的 `spaced` 那一档）—— 规则与词表
 * ==========================================================
 *
 * ## 为什么是一个新的频次档，而不是"每隔几天"
 *
 * 复习的间隔**不等距**：第 1、2、4、7、15、30 天。`{type:'interval', everyNDays}`
 * 只能表达等距，用它去凑这六个日子，一开始就会多出一个"每 1 天"的普通习惯 ——
 * 那是另一种东西（每天打卡 ≠ 某天该复习）。
 *
 * ## 三条形状约束（每条都能被破坏，并且破坏后不会报错）
 *
 * 1. **起点固定**：`anchor` 是创建那天，**不随"今天"漂移**。
 *    按"今天 + 间隔"滚动重排的话，一次没复习就把整张计划推后 ——
 *    那等于"忘了就自动延期"，而这张表存在的理由正是不让它延期。
 * 2. **只数命中日**：`isScheduledOn` 对 `spaced` 只在 `anchor + offsets` 那几天为真。
 *    于是连续天数、完成率的分母都自动跟着变成"该复习的日子"，
 *    不必再给这两个算式各加一条分支（多一条分支就多一份会漂的口径）。
 * 3. **规则存规矩、实例不落库**：磁盘上是 `offsets + anchor`，
 *    具体是哪几个日期**每次读时算**（ADR-0014「推断不持久化」）。
 *
 * ## 🔴 文案红线（来自调研，不许越）
 *
 * [`docs/research/detail-pane-alignment-and-spaced-review.md`](../../../docs/research/detail-pane-alignment-and-spaced-review.md)
 * §B2：复现论文（Murre & Dros 2015）自己说曲线在复现数据上**不是平滑幂函数**，
 * 拟合最好的是带一次上跳的形式。⇒ 界面上**不得**出现"符合艾宾浩斯遗忘曲线 /
 * 科学记忆 / 记忆最牢固"这类**形状层面**的背书；可以说的是**事实口径**：
 * "在第 1、2、4、7、15、30 天提醒复习"。同文 §B2 还钉了一条：首次复习不应早于 24 小时 ——
 * 这也是 `DEFAULT_REVIEW_OFFSETS` 从 1 起而不是从 0 起的原因（0 = 当天，被排除）。
 */

import type { HabitFrequency } from './entities.js';
import { addDays, diffDays, type LocalDate } from './date.js';

/** `spaced` 那一档的形状（`HabitFrequency` 的成员，单独取个名字方便签名）。 */
export type SpacedHabitFrequency = Extract<HabitFrequency, { type: 'spaced' }>;

/**
 * 新建时的默认复习节奏：第 1、2、4、7、15、30 天。
 *
 * ⚠️ 它是**默认值**，不是"唯一正确的那组数"：界面上可改（`offsets` 是数组）。
 *    写成导出常量而不是在三个宿主里各写一份，是同 `HABIT_ICONS` 同一条理由 ——
 *    抄一份，四端就有四张会各自漂移的表。
 */
export const DEFAULT_REVIEW_OFFSETS: readonly number[] = [1, 2, 4, 7, 15, 30] as const;

/** 上限：一张复习表最多几档。30 档已经远超任何真实节奏，且能挡住脏数据撑爆热力图。 */
export const MAX_REVIEW_OFFSETS = 30;

/** 这一档是不是间隔复习（类型守卫，宿主里不许再写 `frequency.type === 'spaced'` 比较）。 */
export function isSpacedFrequency(
  frequency: HabitFrequency | undefined,
): frequency is SpacedHabitFrequency {
  return frequency?.type === 'spaced';
}

/**
 * 校验 + 归一 `offsets`：**去重、升序、只留 ≥1 的整数**。
 *
 * 🔴 非法值在这里 `throw`，与 `normalizeHabitFrequency` 的其余三档同一条纪律：
 *    界面里再判一遍就是第二份所有者。**空表也抛** —— 空表 = 没有一天该复习，
 *    连续天数恒 0、完成率分母为 0，而界面上只会显示"0%"。
 */
export function normalizeReviewOffsets(input: readonly number[]): number[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('间隔复习至少要有一个第几天（空表没有一天该复习，连续天数会恒为 0）');
  }
  const unique = new Set<number>();
  for (const offset of input) {
    if (!Number.isInteger(offset) || offset < 1) {
      throw new Error(`复习的"第几天"必须是 ≥1 的整数，收到 ${JSON.stringify(offset)}`);
    }
    unique.add(offset);
  }
  if (unique.size > MAX_REVIEW_OFFSETS) {
    throw new Error(`复习表最多 ${MAX_REVIEW_OFFSETS} 档，收到 ${unique.size} 档`);
  }
  return [...unique].sort((a, b) => a - b);
}

/** 这一天是**从起点算起的第几天**；早于起点返回 `undefined`。 */
export function reviewOffsetOf(
  frequency: SpacedHabitFrequency,
  date: LocalDate,
): number | undefined {
  const delta = diffDays(frequency.anchor, date);
  return delta < 0 ? undefined : delta;
}

/**
 * 下一次该复习的日期（含今天）。
 *
 * `horizonDays` 之外返回 `undefined`：这条习惯的计划**已经走完了**。
 * 界面上要能说"计划走完了"，而不是画一个永远不来的日期。
 *
 * ⚠️ 落日之前先比 `offsets` 的最大值，避免为了找下一个日子把整段日历走一遍。
 */
export function nextReviewDate(
  frequency: SpacedHabitFrequency,
  today: LocalDate,
  horizonDays = 400,
): LocalDate | undefined {
  const lastOffset = frequency.offsets.reduce((max, value) => (value > max ? value : max), 0);
  for (let delta = Math.max(0, diffDays(frequency.anchor, today)); delta <= lastOffset; delta += 1) {
    if (frequency.offsets.includes(delta)) return addDays(frequency.anchor, delta);
    if (delta > horizonDays) return undefined;
  }
  return undefined;
}

/**
 * 计划里的全部日期（升序）。给详情面那排"这一轮复习有哪些天"用。
 *
 * 🔴 只算 `offsets` 里那几天，**不补今天**：把"今天"塞进来会让计划看起来
 *    比它实际承诺的多一天。
 */
export function reviewDates(frequency: SpacedHabitFrequency): LocalDate[] {
  return [...frequency.offsets]
    .sort((a, b) => a - b)
    .map((offset) => addDays(frequency.anchor, offset));
}
