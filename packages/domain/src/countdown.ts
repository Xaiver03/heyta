/**
 * 时间可视化：剩余时间与进度
 * ============================
 *
 * 🔴 **这个文件里最重要的不是算法，是它刻意没做什么。**
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 背景：这一条是"用户提的需求"，而证据说它必须被降级成待验证假设
 *
 * 竞品调研（`docs/research/ai-competitive-and-architecture.md` §5.2）查到：
 *
 * 1. **滴答清单早就有任务级倒计时了** —— 任务列表可在 `Task time` ↔
 *    `Countdown Time` 之间切换，把 "Due Wednesday" 变成 "还剩 2 天"。
 *    Google Play **4.6★ / 164,748 条**，是这个品类里**唯一有规模证据**的
 *    时间可视化成功案例。→ **"任务级倒计时"不是空白，谈不上差异化。**
 *
 * 2. 🔴 **而且反面证据是硬的，且正对着"递减进度条"这个形状**：
 *    - **32 个实验的元分析**：当"前期投入感高"时，进度条**反而降低完成率**。
 *      "从 createdAt 到 dueDate 线性匀速递减"**正是这个形状**。
 *    - **Bisin & Hyndman（NBER w19874）**：人们**强烈想要** self-imposed
 *      deadline，**但 deadline 并没有提高完成率**。
 *    - **Bonezzi et al. (2011)**：动机随进度呈 **U 型，中点（50%）最低** ——
 *      而倒计时条恰好把注意力压在中段。
 *    - ✅ **找不到任何 RCT / A-B 检验"任务加倒计时条 → 完成率提升"**。
 *
 * 3. **独立产品重注这个形态的全部没做起来**：`Time Left`（2014 年钟面式
 *    任务管理器）已死、2 条评分；Deadliner 明确写着 circular progress bar，
 *    存活 6 年但只有 2 条评分；Deadline App 63 / Griply 197 / Deadline Bar 0。
 * ═════════════════════════════════════════════════════════════════════════
 *
 * ## 因此本模块的产品裁决
 *
 * - ✅ **实现"剩余时间"** —— 这是**已被规模验证**的形态（滴答清单那种：
 *   "还剩 2 天"/"已逾期 3 天"）。它是纯文本，零动画、零焦虑设计。
 * - ⚠️ **`progress` 只计算、不渲染。** 它是那个**有反面证据**的形状，
 *   所以在拿到自己的 A/B 数据之前不进 UI。保留计算是因为：
 *   ① 数学需要被钉住（测试）；② A/B 迟早要它；③ 成本就是几行。
 * - 🔴 **不得对外宣称它能治拖延。** 参见计划 `docs/plans/ai-capability-branches.md`
 *   §5.2.1 的三条强制约束：不得宣称疗效、必须先定 A/B 指标、不做成核心机制。
 *
 * > 一句话：**照抄被验证的形态，把没被验证的形态留在代码里但不给用户看。**
 * > "用户提了 + 成本低"正是最容易跳过验证的组合，所以这里刻意留了这道闸。
 */

import type { LocalDate } from './date.js';
import { diffDays, today } from './date.js';
import { dueLocalDateOf } from './date.js';
import type { Task } from './entities.js';

/**
 * 紧迫档位。
 *
 * ⚠️ **它是语义名，不是颜色名** —— UI 层负责把它映射到 token
 * （`--ht-color-danger` 等）。对照 AGENTS.md §5 第 2 条：
 * 组件只消费语义层，**不许用外观名**（`--ht-red` 那种）。
 * 这样暗色主题与对比度调整都不需要改本文件。
 */
export type CountdownUrgency = 'none' | 'overdue' | 'today' | 'soon' | 'later';

/** 「快到了」的阈值（天）。3 天是刻意的：一周内太宽，会整天在报警。 */
export const SOON_THRESHOLD_DAYS = 3;

export interface Countdown {
  /** 剩余天数。**负数 = 已逾期**。`null` = 该任务没有截止时间。 */
  remainingDays: number | null;
  /** 档位，供 UI 选语义色。 */
  urgency: CountdownUrgency;
  /**
   * 已过时间的比例，`0..1`（越接近 1 越接近截止）。
   *
   * ⚠️ **v1 不渲染它**，理由见文件头（32 个实验的元分析）。
   * `null` = 无法计算（缺 `createdAt`、缺 `dueDate`，或两者相同）。
   */
  progress: number | null;
  /**
   * 是否已逾期。等价于 `remainingDays !== null && remainingDays < 0`，
   * 单独给出是因为 UI 里这个判断出现得最多，且**必须包含"没有截止时间"这一例**。
   */
  overdue: boolean;
}

export interface CountdownOptions {
  /** 时间源（epoch ms）。默认 `Date.now`。可注入的理由同 `capture.ts`。 */
  now?: number;
  /** 「快到了」阈值，默认 `SOON_THRESHOLD_DAYS`。 */
  soonThresholdDays?: number;
}

/** 把时间戳归到本地日历日，再算天数差。 */
function daysUntil(task: Task, now: number): number | undefined {
  const due = dueLocalDateOf(task);
  return due === undefined ? undefined : diffDays(today(now), due);
}

/**
 * 计算一个任务的剩余时间。
 *
 * ⚠️ **已完成的任务一律返回 `urgency: 'none'`。**
 * 对已完成的任务显示"已逾期 3 天"是纯粹的噪音 —— 它已经不需要做了。
 * 这与 `quadrant.ts` 的 `isUrgent` 是同一条规则（"已完成的永不紧急"），
 * 保持两处一致是有意的：否则同一个任务会在象限里不紧急、在倒计时里报警。
 */
export function computeCountdown(task: Task, options: CountdownOptions = {}): Countdown {
  const now = options.now ?? Date.now();
  const soonDays = options.soonThresholdDays ?? SOON_THRESHOLD_DAYS;

  const remainingDays = daysUntil(task, now);
  if (remainingDays === undefined) {
    return { remainingDays: null, urgency: 'none', progress: null, overdue: false };
  }

  if (task.completedAt !== undefined) {
    return { remainingDays, urgency: 'none', progress: null, overdue: false };
  }

  const urgency: CountdownUrgency =
    remainingDays < 0 ? 'overdue' : remainingDays === 0 ? 'today' : remainingDays <= soonDays ? 'soon' : 'later';

  return {
    remainingDays,
    urgency,
    progress: task.dueDate === undefined ? null : computeProgress(task.createdAt, task.dueDate, now),
    overdue: remainingDays < 0,
  };
}

/**
 * 进度 = 已过时间 / 总时间，夹到 `0..1`。
 *
 * 边界处理（每条都有测试）：
 *   - `dueDate <= createdAt` → `null`，**不做除零**，也不返回 `1`。
 *     返回 `1` 会让"同一天创建、同一天到期"的任务显示成"已经到头了"，
 *     而它其实只是今天的事。`null` 让 UI 有权什么都不显示。
 *   - `now < createdAt`（时钟回拨）→ `0`，不返回负数。
 *   - `now > dueDate` → `1`（已逾期，进度封顶）。
 *
 * 🔴 再次强调：**v1 不渲染这个值。** 见文件头。
 */
export function computeProgress(createdAt: number, dueDate: number, now: number): number | null {
  if (dueDate <= createdAt) return null;
  const ratio = (now - createdAt) / (dueDate - createdAt);
  if (ratio <= 0) return 0;
  if (ratio >= 1) return 1;
  return ratio;
}

/**
 * 剩余时间的中文文案。
 *
 * 这是**实际渲染的那一层**（滴答清单验证过的形态）。
 * 文案按"人怎么说话"写，不按"程序怎么方便"写：
 *   - 今天到期 → `今天`（而不是"还剩 0 天"）
 *   - 明天     → `明天`（而不是"还剩 1 天"）
 *   - 逾期     → `已逾期 N 天`
 *
 * 时间单位只用"天"：本模块的输入是**日历日**，说"还剩 5 小时"会假装
 * 我们知道一个具体时刻，而 `Task.dueDate` 的约定是本地零点，它不表达时刻。
 *
 * ⚠️ 入参刻意是**裸数字**而不是 `Countdown` 对象：这样"给一个
 * 还没有 `Task` 的日期算文案"（捕获预览那一步）不需要伪造一个 Task
 * 去满足类型 —— 上一版就是那么写的，靠 `as Task` 骗过编译器。
 * **类型谎言会让真实的不变量失去保护**，而这里根本不需要它。
 */
export function formatRemaining(remainingDays: number | null): string | null {
  if (remainingDays === null) return null;
  const d = remainingDays;
  if (d < 0) return `已逾期 ${Math.abs(d)} 天`;
  if (d === 0) return '今天';
  if (d === 1) return '明天';
  if (d === 2) return '后天';
  return `还剩 ${d} 天`;
}

/** 便捷：直接由任务得到文案。UI 用这个，避免它自己拼字符串。 */
export function formatTaskRemaining(task: Task, options: CountdownOptions = {}): string | null {
  return formatRemaining(computeCountdown(task, options).remainingDays);
}

/**
 * 便捷：由 `LocalDate` 得到文案。
 *
 * 给"捕获预览"用 —— 那时用户刚打完字，屏幕上还**没有** Task 实体。
 * 直接用 `diffDays`，因此不需要构造任何对象。
 */
export function formatRemainingUntil(date: LocalDate, options: CountdownOptions = {}): string {
  const now = options.now ?? Date.now();
  // 非空断言是安全的：diffDays 永远返回有限数，不会是 null。
  return formatRemaining(diffDays(today(now), date))!;
}
