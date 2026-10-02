import { ICON_SIZE } from '@heyta/design-system';
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

import { computeCountdown, type Task } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';

import { URGENCY_CLASS, dueText, type DueDisplayMode } from '../../lib/due-display.js';

export type { DueDisplayMode };

/**
 * ⚠️ `formatRemaining()`（`@heyta/domain`）返回的是**写死的中文句子**，
 * 这里**不能**用它 —— 直接渲染就是"英文界面里冒出汉字"。
 * 天数仍由领域层算（`dueText()` 内部调 `computeCountdown`），
 * 说法由 `dueText()` 按当前语言给。详见 `apps/web/src/lib/due-display.ts`。
 */
export function DueBadge({
  task,
  mode,
  now,
}: {
  task: Task;
  mode: DueDisplayMode;
  now: number;
}): React.JSX.Element | null {
  const { t } = useI18n();

  if (task.dueDate === undefined) return null;

  const countdown = computeCountdown(task, { now });
  const Icon = mode === 'countdown' ? Timer : CalendarDays;
  const text = dueText(task, mode, now, t) ?? '';

  return (
    <span className={`ht-due${URGENCY_CLASS[countdown.urgency]}`}>
      <Icon size={ICON_SIZE.xs} aria-hidden="true" />
      {/* tabular-nums 已由 .ht-due 提供：倒计时数字宽度不跳 */}
      {text}
    </span>
  );
}