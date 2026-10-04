/**
 * 习惯韧性：三指标 + 冻结 + 续接 + 重新开始
 * ==========================================
 *
 * 这份文件补的是 `habit-streak.ts` 缺的那一半：**中断之后会怎样**。
 *
 * 心理学依据（见 `docs/research/motivation-psychology.md`）：
 * 一次中断会触发「全或无」思维（abstinence violation effect），
 * 而"连续归零"恰好是这个思维在界面上的化身 —— 它在用户最脆弱的那天
 * 把人推走。所以本模块的设计目标不是"算得更准"，而是**让中断不等于失去**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 两条设计红线（后面改这个文件的人请先读）
 *
 * 1. **全部派生，零新增持久化字段。**
 *    冻结余额、被冻结的天数、可补的日期，全部由 `(habit, logs, today)`
 *    三个输入**纯函数推导**出来。不写进 Habit、不新增实体、不进 op-log。
 *    理由在 `AGENTS.md` §3.3（schema 与持久化字段）与 §8「不要擅自做的事」：
 *    默认不 bump `CURRENT_SCHEMA_VERSION`（"近乎单向的栅栏"），
 *    且新增持久化字段一律写成可选、并在 hydration 时给运行时默认值。
 *    派生式还有一条更强的理由：**它天然跨设备一致** ——
 *    两台设备算出同一个数，因为输入本来就一致，不需要任何冲突解决策略。
 *    （🔴 这里原先写的是"理由见 ADR-0014"，那是**引错了**：
 *     ADR-0014 讲的是记忆偏好层的两个闸门，与 schema 无关。
 *     引用要指到真正支持这句话的那一份，否则下一个人会照着错的去找。）
 *
 * 2. **不惩罚、不羞辱。**
 *    没有扣分、没有"你失去了 X"。`longest` 与 `total` 只增不减，
 *    中断之后屏幕上**一定还有一个没变小的数字**。
 *
 * 与 `computeStreak` 的分工：那个函数是"严格的连续"（有宽限期、无冻结），
 * 保留不动、继续被别处使用；本模块是"带韧性的连续"。
 * **不要**把两者合并成一个带开关的函数 —— 开关会让调用点看不出差异。
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { Habit, HabitLog } from './entities.js';
import { addDays, diffDays, type LocalDate } from './date.js';
import { isAchieved, isScheduledOn } from './habit-streak.js';

/**
 * 同时最多持有的冻结数。
 *
 * 上限的存在意义：让冻结是**保险**而不是**免打卡通行证**。
 * 参考值来自 Duolingo 公开的"允许同时装备 2 个"（见
 * `docs/research/competitor-incentive-teardown.md`），它是同类机制里少数
 * 有公开数据的参数。**但 heyta 不卖它** —— 每连续 7 个计划日自动发一个。
 */
export const FREEZE_MAX_HELD = 2;

/** 每连续 N 个计划日达成，自动获得 1 个冻结。 */
export const FREEZE_EARN_EVERY = 7;

/** 中断超过这么多天，才提供"重新开始"入口（而不是每天劝一次）。 */
export const RESTART_AFTER_DAYS = 7;

/** "补回来"的时间窗：只允许补**昨天**，即 24 小时口径。 */
export const REPAIR_WINDOW_DAYS = 1;

/**
 * 一个习惯的韧性连续性。
 *
 * 三个数字是**并存**的，不是替代关系：
 *   - `current` 会中断 → 损失厌恶（前进动力）
 *   - `longest` 只增不减 → 中断时的缓冲垫
 *   - `total`   只增不减 → 最终兜底，永远不会归零
 * 界面规则：任何一个习惯视图上，至少有一个只增不减的数字是**可见的**。
 */
export interface HabitResilience {
  /** 计入冻结吸收后的当前连续（单位为"计划日达成数"）。 */
  current: number;
  /** 历史最长连续。**只增不减**。 */
  longest: number;
  /** 累计达成**天数**（`achieved.size`）。**只增不减**。 */
  total: number;
  /** 当前可用冻结数（0–`FREEZE_MAX_HELD`）。 */
  freezesHeld: number;
  /** 历史上被冻结吸收的缺口天数（用于解释"为什么没断"）。**只增不减**。 */
  frozenDays: number;
  /**
   * **眼下这段连续**里有几天是被冻结吸收的（0–`current`）。
   *
   * 与 `frozenDays` 的区别是口径：那个是累计，这个是当前。
   * 界面上"我现在的连续里有几天是补的"只能用它，**不能**用
   * `current − streak.current` 去减 —— 见 `computeHabitResilience` 里的说明。
   */
  frozenInCurrentRun: number;
  /** 最后一次达成日期。从未达成时为 undefined。 */
  lastDate?: LocalDate;
  /** 最近一次被冻结吸收的日期（用于文案"上周三用掉了一个冻结"）。 */
  lastFrozenDate?: LocalDate;
}

/** 达成日期的集合。**未删除**且**真的达成**才算（口径与 `computeStreak` 一致）。 */
function achievedDates(habit: Habit, logs: readonly HabitLog[]): Set<LocalDate> {
  const out = new Set<LocalDate>();
  for (const log of logs) {
    if (log.deletedAt !== undefined) continue;
    if (log.habitId !== habit.id) continue;
    if (!isAchieved(habit, log)) continue;
    out.add(log.date);
  }
  return out;
}

/**
 * 计算带韧性的连续性。
 *
 * 算法是**一次从左到右的扫描**：逐个计划日看"这天达成了没有"，
 * 没达成就看当时手里有没有冻结 —— 有就消耗一个、连续不断；
 * 没有就归零。因为冻结余额是扫描过程中推出来的，所以整个函数
 * 是 `(habit, logs, today)` 的纯函数，结果可复现。
 *
 * @param today 今天（本地日历日）。**必须显式传入** —— 内部读 `Date.now()`
 *              会让这个函数不可测，而它全是边界条件。
 */
export function computeHabitResilience(
  habit: Habit,
  logs: readonly HabitLog[],
  today: LocalDate,
): HabitResilience {
  const achieved = achievedDates(habit, logs);
  if (achieved.size === 0) {
    return {
      current: 0,
      longest: 0,
      total: 0,
      freezesHeld: 0,
      frozenDays: 0,
      frozenInCurrentRun: 0,
    };
  }

  const sorted = [...achieved].sort();
  const first = sorted[0]!;
  const lastDate = sorted[sorted.length - 1]!;

  let run = 0;
  let longest = 0;
  let held = 0;
  let frozenDays = 0;
  /**
   * **当前这段连续**里被冻结保住的天数。
   *
   * 🔴 它与 `frozenDays` 是两个不同的数，界面两处都要用，不能合并：
   *   - `frozenDays` 是**累计**（历史上一共吸收了多少次中断）—— 那天数只增不减
   *   - `frozenInCurrentRun` 是**眼下这段**里吸收了几次 —— 它回答的是
   *     "我现在的连续天数里有几天其实是补的"
   *
   * 我一开始没存这个数，而是让界面做 `resilience.current − streak.current`。
   * 那个减法**会算出错的答案**：`computeStreak` 在"昨天漏了"时会把
   * `current` 直接归零（它的 `isStillAlive` 判定），于是 7 − 0 = 7，
   * 界面会说"冻结保住了 7 天"—— 而实际只保住了 1 天。
   * 教训：**两个来自不同口径的差值不是事实**，哪怕它们看起来都叫"连续天数"。
   */
  let frozenInCurrentRun = 0;
  let lastFrozenDate: LocalDate | undefined;

  let cursor = first;
  // 防御：损坏数据可能产生荒谬范围，限制扫描长度（与 computeStreak 同口径）。
  const maxSpan = 365 * 20;
  let guard = 0;

  while (diffDays(cursor, today) >= 0 && guard++ < maxSpan) {
    if (isScheduledOn(habit.frequency, cursor)) {
      if (achieved.has(cursor)) {
        run += 1;
        if (run > longest) longest = run;
        // 每连续 FREEZE_EARN_EVERY 个计划日，自动发一个冻结（不超过上限）。
        if (run % FREEZE_EARN_EVERY === 0) {
          held = Math.min(held + 1, FREEZE_MAX_HELD);
        }
      } else if (diffDays(cursor, today) > 0) {
        // 计划日没达成，且**不是今天**（today − cursor > 0）—— 今天还有机会，不算缺口。
        // ⚠️ 方向别写反：`diffDays(a, b)` 返回 `b − a`。
        if (held > 0) {
          held -= 1;
          frozenDays += 1;
          frozenInCurrentRun += 1;
          lastFrozenDate = cursor;
        } else {
          run = 0;
          // 这段连续结束了，它里面用掉的冻结不再属于"眼下这段"。
          // （`frozenDays` 不清 —— 那是累计口径。）
          frozenInCurrentRun = 0;
        }
      }
      // 今天未达成：既不推进也不打断（这是 `habit-streak.ts` 文件头第 1 条
      // 那条不变量的同一条规则 —— 上午打开界面不该看到"连续 0 天"）。
    }
    cursor = addDays(cursor, 1);
  }

  return {
    current: run,
    longest,
    total: achieved.size,
    freezesHeld: held,
    frozenDays,
    frozenInCurrentRun,
    lastDate,
    ...(lastFrozenDate === undefined ? {} : { lastFrozenDate }),
  };
}

/**
 * 可补回来的那一天（24 小时口径）。
 *
 * **不需要任何额外状态**：补打卡就是给昨天写一条 `HabitLog`，
 * 而"昨天是否有缺口"完全可以从日志推导。所以"续接"这个功能
 * 在数据层是零成本的 —— 它只是把已存在的补打卡能力**在对的时机说出来**。
 */
export interface RepairOpportunity {
  /** 可以补回来的日期（昨天）。 */
  date: LocalDate;
  /** 补回来之后当前连续会变成多少（用于文案，如"补回来就是 12 天"）。 */
  streakIfRepaired: number;
}

/**
 * 找出可续接的机会。没有缺口时返回 undefined。
 *
 * 只在**链条真的断了**（`current === 0`）时才提示 —— 如果冻结已经替用户
 * 兜住了昨天，那就没有"断了"这件事，此时再劝人补打卡是在制造不存在的焦虑。
 */
export function findRepairOpportunity(
  habit: Habit,
  logs: readonly HabitLog[],
  today: LocalDate,
  resilience?: HabitResilience,
): RepairOpportunity | undefined {
  const current = resilience ?? computeHabitResilience(habit, logs, today);
  // 没断就没得补（见函数注释）。
  if (current.current > 0) return undefined;
  // 从来没做过，谈不上"补回来"。
  if (current.total === 0) return undefined;

  const date = addDays(today, -REPAIR_WINDOW_DAYS);
  if (!isScheduledOn(habit.frequency, date)) return undefined;
  if (achievedDates(habit, logs).has(date)) return undefined;

  // 用一条**虚拟**打卡记录预览"补回来会怎样"。
  // 它只用在这里算一个数字，不会被写进任何地方。
  const preview = computeHabitResilience(
    habit,
    [
      ...logs,
      { id: 'repair-preview', habitId: habit.id, date, createdAt: 0, updatedAt: 0 },
    ],
    today,
  );

  /**
   * 🔴 只在"断链就发生在昨天"时才提供续接。
   *
   * 判据是补回来之后有**真的链条**被接上（≥2 天）。理由：如果断链发生在
   * 好几天前，补昨天只能得到"连续 1 天" —— 那不是续接，那是把用户的
   * 失败重新摆到他面前。那种情况该走"重新开始"（`findFreshStartOffer`），
   * 而不是在这里假装挽回。
   */
  if (preview.current < 2) return undefined;

  return { date, streakIfRepaired: preview.current };
}

/** "重新开始"入口的触发条件与它会保留的东西。 */
export interface FreshStartOffer {
  /** 距最后一次达成过了多少天。 */
  daysSinceLast: number;
  /** 会**原样保留**的历史最长（只增不减）。 */
  longest: number;
  /** 会**原样保留**的累计达成天数。 */
  total: number;
}

/**
 * 是否该给"重新开始"入口。
 *
 * 依据是新鲜开始效应（Dai, Milkman & Riis 2014）：时间地标能把过去的
 * 失败与"新的我"在心理上切开。所以中断不是要藏起来的事实，
 * 而是要**主动提供一个干净的起点**，并且明确告诉用户他没有失去任何东西。
 */
export function findFreshStartOffer(
  resilience: HabitResilience,
  today: LocalDate,
): FreshStartOffer | undefined {
  if (resilience.current > 0) return undefined;
  if (resilience.lastDate === undefined || resilience.total === 0) return undefined;

  const daysSinceLast = diffDays(resilience.lastDate, today);
  if (daysSinceLast <= RESTART_AFTER_DAYS) return undefined;

  return { daysSinceLast, longest: resilience.longest, total: resilience.total };
}

/**
 * 一次算齐某个习惯的韧性状态。
 *
 * 界面用这个而不是分别调用三个函数：三次调用 = 三次 `achievedDates` 扫描，
 * 而且三次之间可能跨过午夜、得出互相矛盾的结果（同 `selectHabitProgress`
 * 显式传 `now` 的理由）。
 */
export interface HabitResilienceView {
  resilience: HabitResilience;
  repair?: RepairOpportunity;
  freshStart?: FreshStartOffer;
}

export function describeHabitResilience(
  habit: Habit,
  logs: readonly HabitLog[],
  today: LocalDate,
): HabitResilienceView {
  const resilience = computeHabitResilience(habit, logs, today);
  const repair = findRepairOpportunity(habit, logs, today, resilience);
  const freshStart = findFreshStartOffer(resilience, today);

  return {
    resilience,
    ...(repair === undefined ? {} : { repair }),
    ...(freshStart === undefined ? {} : { freshStart }),
  };
}