/**
 * 按钮类名的**唯一出口**（纯模块，不 import React、不 import CSS）
 * ==============================================================
 *
 * 为什么单独一个文件：`Button.tsx` 要 import `./hta.css` 与 `Spinner`，
 * 而**非 React 的命令式 DOM 代码**（例如 `features/auth/desktop-handoff.ts`
 * 用 `document.createElement('a')` 造一个引导链接）也需要同一套类名。
 * 让它去 import `Button.tsx` 会把 React 组件和 CSS 拖进一个纯逻辑模块。
 *
 * 所以类名映射放在这里：`Button.tsx` 与命令式调用方都从这里取，
 * **类名只在文件里出现一次**（迁移前这段字符串在 .tsx 里手写了 207 次、
 * 外加 desktop-handoff 里的 1 次）。
 */

import type { ControlTone } from '@heyta/ui';

export type ButtonTone = ControlTone;
export type ButtonSize = 'sm' | 'default';

/**
 * 🔴 逐档显式映射，**不能用模板串拼** `ht-btn--${tone}`：
 *   · tone 词表由 `packages/ui/src/control/states.ts` 一处说了算；
 *   · `check:control-semantics` 的 A4 反查「界面写了、中央 CSS 没有」的幻影类时，
 *     按源码里的字面量名取候选 —— 显式映射让每一档都出现在扫描面上，拼出来的看不到。
 */
export const TONE_CLASS: Readonly<Record<ButtonTone, string>> = {
  primary: 'ht-btn ht-btn--primary',
  secondary: 'ht-btn ht-btn--secondary',
  ghost: 'ht-btn ht-btn--ghost',
  danger: 'ht-btn ht-btn--danger',
};

/** 拼出按钮的完整 className；`extra` 追加在最后（与 `<Button className>` 同序）。 */
export function buttonClassName(
  tone: ButtonTone,
  options?: { readonly commit?: boolean; readonly size?: ButtonSize; readonly extra?: string | undefined },
): string {
  return [
    TONE_CLASS[tone],
    options?.commit === true && tone === 'danger' ? 'ht-btn--commit' : '',
    options?.size === 'sm' ? 'hta-btn--sm' : '',
    options?.extra ?? '',
  ]
    .filter((part) => part !== '')
    .join(' ');
}
