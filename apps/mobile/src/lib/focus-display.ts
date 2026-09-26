/**
 * 专注屏的展示约定
 * ==================
 *
 * 只放**文案与呈现口径**，不放判断。三件事都刻意集中在这里：
 *
 *   1. **枚举 → 词条 key 的映射**（`work` → `mobile.focus.kind.work`）。
 *      与 `lib/priority.ts` 同一个理由：同一个枚举在多个组件里各写一遍 `switch`，
 *      漏掉一个分支就是空白文案，而空白文案不会报错，只会让界面看起来少了一块。
 *   2. **时长文案**。分钟数由 `focusDurationMs()` 的毫秒换算而来，
 *      **不自己建第二张"哪种类型多少分钟"的表**（见 `focus.ts` 里那条注释）。
 *   3. **按钮/状态文案**。区分"开始专注"与"开始休息" —— 一个写着"开始"的按钮
 *      在休息轮里会让用户以为自己按错了。
 *
 * 🔴 这些函数都是纯函数，`t` 由调用方传入（有单测直接调用）。
 */

import { focusDurationMs, type FocusConfig, type FocusSessionKind, type FocusState } from '@heyta/domain';
import type { MessageKey } from '@heyta/i18n';

import type { Translate } from '../i18n/translate';

const KIND_KEYS: Record<FocusSessionKind, MessageKey> = {
  work: 'mobile.focus.kind.work',
  shortBreak: 'mobile.focus.kind.shortBreak',
  longBreak: 'mobile.focus.kind.longBreak',
};

/** 类型 → 当前语言的名称。 */
export function kindLabel(kind: FocusSessionKind, t: Translate): string {
  return t(KIND_KEYS[kind]);
}

/**
 * 毫秒 → 人话（「25 分钟」/「1 小时 20 分钟」）。
 *
 * 🔴 换算是**表现层**，措辞走词条；但"哪种类型多少分钟"仍然是
 * `focusDurationMs()` 的语义，所以这里只做 `Math.floor(ms / 60000)` 这一步。
 */
export function formatFocusDurationText(ms: number, t: Translate): string {
  const totalMinutes = Math.round(Math.max(0, ms) / 60000);
  if (totalMinutes < 60) return t('mobile.focus.duration.minutes', { minutes: totalMinutes });
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0
    ? t('mobile.focus.duration.hours', { hours })
    : t('mobile.focus.duration.hoursMinutes', { hours, minutes });
}

/** 「25 分钟」。 */
export function kindDurationLabel(
  kind: FocusSessionKind,
  config: FocusConfig,
  t: Translate,
): string {
  return formatFocusDurationText(focusDurationMs(kind, config), t);
}

/** 计时卡上方那一行状态。 */
export function phaseLabel(state: FocusState, t: Translate): string {
  if (state.phase === 'paused') return t('mobile.focus.phase.paused');
  if (state.phase === 'idle') return t('mobile.focus.phase.idle');
  return state.kind === 'work' ? t('mobile.focus.phase.working') : t('mobile.focus.phase.breaking');
}

/**
 * 主按钮的文案。
 *
 * 🔴 运行中必须叫「暂停」而不是「停止」：用户按下去时最怕的是"我刚才那 20 分钟
 * 是不是白干了"。中止是另一个按钮，而且它自己讲清了后果。
 */
export function primaryActionLabel(state: FocusState, t: Translate): string {
  if (state.phase === 'running') return t('mobile.focus.action.pause');
  if (state.phase === 'paused') return t('mobile.focus.action.resume');
  return state.kind === 'work'
    ? t('mobile.focus.action.startWork')
    : t('mobile.focus.action.startBreak');
}

/** 主按钮的图标，与文案同源 —— 两者不能各判一次。 */
export function primaryActionIcon(state: FocusState): 'focus.play' | 'focus.pause' {
  return state.phase === 'running' ? 'focus.pause' : 'focus.play';
}

/** 计时卡与进度条的颜色。**语义名，不是外观名**（AGENTS.md §5）。 */
export function phaseColorToken(state: FocusState): 'color.focus-work' | 'color.focus-break' {
  return state.kind === 'work' ? 'color.focus-work' : 'color.focus-break';
}
