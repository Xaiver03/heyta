/**
 * 截止时间徽标（两种呈现）
 * ==========================
 *
 * 🔴 **这是一个视图开关，不是功能。** 两种呈现读的是**同一个 `dueDate`**
 * 字段，只是换了说法：
 *
 *   - `date`      → `09-26`        （绝对日期）
 *   - `countdown` → `明天` / `还剩 3 天` / `已逾期 2 天`（剩余时间）
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 为什么做成"开关"而不是"直接替换成倒计时"
 *
 * 竞品调研的证据说得很清楚（`docs/research/ai-competitive-and-architecture.md` §5.2）：
 *
 * 1. **滴答清单就是这么做的** —— 任务列表在 `Task time` ↔ `Countdown Time`
 *    之间切换。那是这个品类里**唯一有规模证据**的时间可视化成功案例
 *    （Google Play 4.6★ / 164,748 条）。→ **照抄被验证的形态。**
 * 2. 🔴 **而"递减进度条"是有反面证据的形态**：32 个实验的元分析发现
 *    前期投入感高时进度条**反向降低完成率**；且**不存在任何检验本场景的 RCT**。
 *    → **所以这里不渲染进度条**，哪怕 `@heyta/domain` 的 `computeProgress`
 *    已经能算它。**算出来了不等于要显示。**
 * 3. 做成开关的第三个理由：它是**可回退、可 A/B** 的。
 *    如果哪天要验证"倒计时是否真的有用"，开关本身就是一个实验臂 ——
 *    而不做成开关，就没有对照组。
 * ═════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ **不得对外宣称它能治拖延。** 见计划 §5.2.1 的三条强制约束。
 */

import { CalendarDays, Timer } from 'lucide-react';

import {
  computeCountdown,
  formatCompactDate,
  formatRemaining,
  type CountdownUrgency,
  type Task,
} from '@heyta/domain';

export type DueDisplayMode = 'date' | 'countdown';

/** 档位 → CSS 类。**语义名到样式名的映射只在这一处。** */
const URGENCY_CLASS: Record<CountdownUrgency, string> = {
  none: '',
  overdue: ' ht-due--overdue',
  today: ' ht-due--today',
  soon: ' ht-due--soon',
  later: '',
};

export function DueBadge({
  task,
  mode,
  now,
}: {
  task: Task;
  mode: DueDisplayMode;
  now: number;
}): React.JSX.Element | null {
  if (task.dueDate === undefined) return null;

  const countdown = computeCountdown(task, { now });
  const Icon = mode === 'countdown' ? Timer : CalendarDays;

  const text =
    mode === 'countdown'
      ? (formatRemaining(countdown.remainingDays) ?? '')
      : formatCompactDate(task.dueDate, now);

  return (
    <span className={`ht-due${URGENCY_CLASS[countdown.urgency]}`}>
      <Icon size={12} aria-hidden="true" />
      {/* tabular-nums 已由 .ht-due 提供：倒计时数字宽度不跳 */}
      {text}
    </span>
  );
}