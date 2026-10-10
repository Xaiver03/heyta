/**
 * 截止时间的显示（Web 端）
 * ==========================
 *
 * 🔴 **这里不重新实现"还剩几天"。** 天数的计算全部来自 `@heyta/domain` 的
 * `computeCountdown` / `diffDays` —— 与移动端 `apps/mobile/src/lib/due-display.ts`
 * 用的是同一份规则。本文件只负责把**已经算好的天数**说成当前语言。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么这层必须存在（它修的是一个真 bug）
 *
 * `packages/domain` 是纯函数层，**依赖不了词条表**（`packages/i18n` 是另一个包），
 * 所以它的 `formatRemaining()` / `formatRemainingUntil()` 返回的是**写死的中文句子**。
 * 在中文界面里看不出问题，切到英文就露出来了 —— 而且不是"少翻译一条"，
 * 是**界面里直接冒出汉字**：
 *
 *   - `DueBadge`            —— 任务行上的截止徽标："还剩 3 天" / "明天"
 *   - `CaptureComposer`     —— 捕获预览里的日期芯片："2026-09-26（明天）"
 *
 * ⚠️ 这两处此前在注释里被登记为"已知、本轮不迁"。登记不是修复：
 * 英文用户看到的是中文。本文件把**措辞**收进壳里，`packages/domain` 一个字节没动。
 *
 * ⚠️ 反面例子，别照抄：`formatDuration()`（领域层，专注计时用的 `MM:SS`）
 * **本来是语言中立的**，一度被当成同类问题 —— 它不是。只有真的输出
 * 自然语言句子的函数才属于这一类（`formatRemaining` / `formatFocusDuration` /
 * `describeRecurrence` / `describeHabitResilience` 的 `label` 字段…）。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 🔴 阈值语义**照搬** `@heyta/domain` 的 `formatRemaining`（今天 / 明天 / 后天 /
 * 还剩 N 天 / 已逾期 N 天），因为那是**产品语义**而不是措辞：
 * 自己发明一套"几天算后天"，同一个任务在两个端上就会显示成两句话，
 * 而用户会以为那是两个不同的状态（移动端真踩过，见
 * `apps/mobile/src/lib/due-display.ts` 文件头那张漂移对照表）。
 *
 * 措辞**各端各写一份**是刻意的，与 `apps/mobile/src/lib/recurrence-display.ts`
 * 同一个先例：解析/算数只有一份，说法各写各的。所以本文件与移动端那份是
 * **同构而不是同一份** —— 分档由 `apps/web/tests/due-display.spec.ts` 逐日
 * 与领域层对账，措辞由词条表的中英对账兜住。
 */

import {
  computeCountdown,
  formatCompactDate,
  formatCompactLocalDate,
  type CountdownUrgency,
  type Task,
} from '@heyta/domain';
import type { I18nValue } from '@heyta/i18n';

/** 两种呈现读的是**同一个** `dueDate` 字段，只是换了说法。 */
export type DueDisplayMode = 'date' | 'countdown';

/** 界面用的取词函数。与 `features/categories/copy.ts` 同一个约定。 */
type T = I18nValue['t'];

/**
 * 剩余天数 → 当前语言的句子。`null` 表示"没有截止时间"，返回空串。
 *
 * 分档（**与领域层逐条对齐**，改动前先改 `packages/domain` 的实现与测试）：
 *
 *   | 输入            | 中文           | 英文                 |
 *   |---|---|---|
 *   | `null`          | （空串）       | (empty)              |
 *   | `< 0`，绝对值 1 | `已逾期 1 天`  | `1 day overdue`      |
 *   | `< 0`，其余     | `已逾期 N 天`  | `N days overdue`     |
 *   | `0`             | `今天`         | `Today`              |
 *   | `1`             | `明天`         | `Tomorrow`           |
 *   | `2`             | `后天`         | `Day after tomorrow` |
 *   | `>= 3`          | `还剩 N 天`    | `N days left`        |
 *
 * ⚠️ 英文有单复数、中文没有 —— 词条表刻意不支持 ICU（见
 * `packages/i18n/src/types.ts`），所以按数量在**这里**分支到单数兄弟词条。
 * `remainingDays === -1`（昨天到期）是可达的：没有这条分支，英文会渲染成
 * `1 days overdue`。
 *
 * ⚠️ `>= 3` 那条**不需要**单数兄弟：`1` 与 `2` 已经在上面被 `明天` /
 * `后天` 拿走了，所以 `还剩 {days} 天` 只可能在 `days >= 3` 时被说到。
 */
export function remainingText(remainingDays: number | null, t: T): string {
  if (remainingDays === null) return '';
  if (remainingDays < 0) {
    const days = Math.abs(remainingDays);
    return t(days === 1 ? 'web.due.overdueOne' : 'web.due.overdue', { days });
  }
  if (remainingDays === 0) return t('web.due.today');
  if (remainingDays === 1) return t('web.due.tomorrow');
  if (remainingDays === 2) return t('web.due.dayAfterTomorrow');
  return t('web.due.remaining', { days: remainingDays });
}

/**
 * 任务 → 徽标文案。**没有截止时间返回 `null`**（UI 据此不渲染徽标）。
 *
 * `now` 必须由调用方传，不从 `Date.now()` 取：一次渲染里的所有行
 * 必须用**同一个"现在"**，否则跨零点时同一屏上的两行会算出不同的日期。
 * 这与移动端 `TasksScreen` 冻结 `now` 是同一条纪律。
 */
export function dueText(
  task: Task,
  mode: DueDisplayMode,
  now: number,
  t: T,
): string | null {
  if (task.dueDateLocal === undefined && task.dueDate === undefined) return null;
  const countdown = computeCountdown(task, { now });
  return mode === 'countdown'
    ? remainingText(countdown.remainingDays, t)
    : task.dueDateLocal !== undefined
      ? formatCompactLocalDate(task.dueDateLocal, now)
      : formatCompactDate(task.dueDate!, now);
}

/**
 * 档位 → 语义色类名。**语义名到样式名的映射只在这一处。**
 *
 * ⚠️ 只有真正需要注意的两档给颜色：`overdue` 是"出错了"，`today` 是
 * "今天要做"（不是错误）。其余不给色。
 * 已完成的任务永远是 `none`（`computeCountdown` 里定的），所以
 * "勾掉一个逾期任务后它还在报警"这件事不会发生。
 */
export const URGENCY_CLASS: Record<CountdownUrgency, string> = {
  none: '',
  overdue: ' ht-due--overdue',
  today: ' ht-due--today',
  soon: ' ht-due--soon',
  later: '',
};
