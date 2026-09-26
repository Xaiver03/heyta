/**
 * 专注屏的展示约定
 * ==================
 *
 * 只放**文案与呈现口径**，不放判断。三件事都刻意集中在这里：
 *
 *   1. **中文标签的映射**（`work` → 「专注」）。与 `lib/priority.ts` 同一个理由：
 *      同一个枚举在多个组件里各写一遍 `switch`，漏掉一个分支就是空白文案，
 *      而空白文案不会报错，只会让界面看起来少了一块。
 *   2. **时长文案**。用领域层的 `focusDurationMs()` 换算，**不自己建第二张表**
 *      （见 `focus.ts` 里那条注释）。
 *   3. **按钮/状态文案**。区分"开始专注"与"开始休息" —— 一个写着"开始"的按钮
 *      在休息轮里会让用户以为自己按错了。
 */

import {
  focusDurationMs,
  formatFocusDuration,
  type FocusConfig,
  type FocusSessionKind,
  type FocusState,
} from '@heyta/domain';

export const KIND_LABELS: Record<FocusSessionKind, string> = {
  work: '专注',
  shortBreak: '短休息',
  longBreak: '长休息',
};

/** 「25 分钟」。 */
export function kindDurationLabel(
  kind: FocusSessionKind,
  config: FocusConfig,
): string {
  return formatFocusDuration(focusDurationMs(kind, config));
}

/** 计时卡上方那一行状态。 */
export function phaseLabel(state: FocusState): string {
  if (state.phase === 'paused') return '已暂停';
  if (state.phase === 'idle') return '准备好了就开始';
  return state.kind === 'work' ? '专注中' : '休息中';
}

/**
 * 主按钮的文案。
 *
 * 🔴 运行中必须叫「暂停」而不是「停止」：用户按下去时最怕的是"我刚才那 20 分钟
 * 是不是白干了"。中止是另一个按钮，而且它自己讲清了后果。
 */
export function primaryActionLabel(state: FocusState): string {
  if (state.phase === 'running') return '暂停';
  if (state.phase === 'paused') return '继续';
  return state.kind === 'work' ? '开始专注' : '开始休息';
}

/** 主按钮的图标，与文案同源 —— 两者不能各判一次。 */
export function primaryActionIcon(state: FocusState): 'focus.play' | 'focus.pause' {
  return state.phase === 'running' ? 'focus.pause' : 'focus.play';
}

/** 计时卡与进度条的颜色。**语义名，不是外观名**（AGENTS.md §5）。 */
export function phaseColorToken(state: FocusState): 'color.focus-work' | 'color.focus-break' {
  return state.kind === 'work' ? 'color.focus-work' : 'color.focus-break';
}
