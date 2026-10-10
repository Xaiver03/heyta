/**
 * 截止时间的显示
 * ================
 *
 * 🔴 **这里不重新实现"还剩几天"。** 计算与文案全部来自
 * `@heyta/domain` 的 `computeCountdown` / `formatRemaining` ——
 * 那是 Web 端 `DueBadge` 用的同一份规则。
 *
 * 为什么必须共用：在此之前移动端有自己的 `lib/date.ts#formatDue`，
 * 而它与共享实现**已经漂移了**：
 *
 *   | 场景 | `formatDue`（移动端旧） | `formatRemaining`（共享） |
 *   |---|---|---|
 *   | 逾期 | `已过期 3 天` | `已逾期 3 天` |
 *   | 2 天后 | `2 天后` | `后天` |
 *   | 8 天后 | `9月26日`（变成绝对日期） | `还剩 8 天` |
 *
 * 同一个任务在两个平台上说两种话，用户会以为是两个不同的状态。
 * 这类漂移单元测试**各自都过** —— 只有把两端的期望放在一起看才发现。
 *
 * 显示模式（`date` / `countdown`）与 Web 端一致，也默认 `date`：
 * 那个开关是竞品调研里**唯一有规模证据**的时间可视化形态
 * （见 `docs/research/ai-competitive-and-architecture.md` §5.2）；
 * 本文件只负责把同一个 `dueDate` 按两种说法渲染出来。
 */

import {
  computeCountdown,
  formatCompactDate,
  formatCompactLocalDate,
  type CountdownUrgency,
  type Task,
} from '@heyta/domain';

import type { Translate } from '../i18n/translate';

/** 两种呈现读的是**同一个** `dueDate` 字段，只是换了说法。 */
export type DueDisplayMode = 'date' | 'countdown';

export interface DueDisplay {
  text: string;
  /** 档位，供 UI 选语义色。**不要把 `overdue` 当成唯一判断依据。** */
  urgency: CountdownUrgency;
  overdue: boolean;
}

/**
 * 剩余天数 → 当前语言的句子。
 *
 * 🔴 阈值语义**照搬** `@heyta/domain` 的 `formatRemaining`（今天 / 明天 /
 * 后天 / 还剩 N 天），因为那是**产品语义**，不是措辞：
 * 自己发明一套"几天算后天"会让同一个任务在两个端上显示成两句话。
 * 搬过来的只有**怎么把已经算好的天数说出来**这一层，算天数的
 * `computeCountdown` 仍然只有领域层一份。
 */
export function remainingText(remainingDays: number | null, t: Translate): string {
  if (remainingDays === null) return '';
  if (remainingDays < 0) {
    /**
     * 🔴 英文有单复数，中文没有 —— 词条表刻意不支持 ICU（见 `types.ts`），
     * 所以按数量在**调用方**分支到单数兄弟词条。`remainingDays === -1`
     * 是可达的（昨天到期），没有这条分支英文会渲染成 `1 days overdue`。
     */
    const days = Math.abs(remainingDays);
    return t(days === 1 ? 'mobile.due.overdueOne' : 'mobile.due.overdue', { days });
  }
  if (remainingDays === 0) return t('mobile.common.today');
  if (remainingDays === 1) return t('mobile.due.tomorrow');
  if (remainingDays === 2) return t('mobile.due.dayAfterTomorrow');
  return t('mobile.due.remaining', { days: remainingDays });
}

/**
 * 任务 → 徽标内容。**没有截止时间返回 `null`**（UI 据此不渲染）。
 *
 * `now` 必须由调用方传，不从 `Date.now()` 取：一次渲染里的所有行
 * 必须用**同一个"现在"**，否则跨零点时同一屏上的两行会算出不同的日期。
 * 这与 `TasksScreen` 冻结 `now` 是同一条纪律。
 */
export function toDueDisplay(
  task: Task,
  mode: DueDisplayMode,
  now: number,
  t: Translate,
): DueDisplay | null {
  if (task.dueDateLocal === undefined && task.dueDate === undefined) return null;

  const countdown = computeCountdown(task, { now });

  const text =
    mode === 'countdown'
      ? // `remainingDays` 在 dueDate 存在时必为数字，这里只是不让类型裸露
        remainingText(countdown.remainingDays, t)
      : task.dueDateLocal !== undefined
        ? formatCompactLocalDate(task.dueDateLocal, now)
        : formatCompactDate(task.dueDate!, now);

  return { text, urgency: countdown.urgency, overdue: countdown.overdue };
}

/**
 * 档位 → `TextTone`。
 *
 * 只有真正需要注意的两档给颜色：
 *   - `overdue` → `danger`
 *   - `today`   → `primary`（今天要做，但不是"出错"）
 *   - 其余      → `subtle`
 *
 * ⚠️ **已完成的任务永远是 `none`**（`computeCountdown` 里定的），
 * 所以"勾掉一个逾期任务后它还在报警"这件事不会发生。
 */
export function dueTone(urgency: CountdownUrgency): 'danger' | 'primary' | 'subtle' {
  if (urgency === 'overdue') return 'danger';
  if (urgency === 'today') return 'primary';
  return 'subtle';
}
