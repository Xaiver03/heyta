import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import type { ControlTone } from '@heyta/ui';

import { Spinner } from './Spinner.js';
import './hta.css';

/**
 * 按钮色调 = 共享表的 `ControlTone`（`@heyta/ui` 的 `CONTROL_TONES`）。
 * 这里只是把色调名翻成 `controls.css` 里已有的类，**不复制任何配方**。
 */
export type ButtonTone = ControlTone;
export type ButtonSize = 'sm' | 'default';

/**
 * 🔴 逐档显式映射，**不能用模板串拼** `ht-btn--${tone}`：
 *   · tone 词表由 `packages/ui/src/control/states.ts` 一处说了算；
 *   · `check:control-semantics` 的 A4 反查「界面写了、中央 CSS 没有」的幻影类时，
 *     按源码里的字面量名取候选 —— 显式映射让每一档都出现在扫描面上，拼出来的看不到。
 */
const TONE_CLASS: Readonly<Record<ButtonTone, string>> = {
  primary: 'ht-btn ht-btn--primary',
  secondary: 'ht-btn ht-btn--secondary',
  ghost: 'ht-btn ht-btn--ghost',
  danger: 'ht-btn ht-btn--danger',
};

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled' | 'type'> {
  /** 四档，默认 `secondary`（与 `DEFAULT_CONTROL_TONE` 一致）。 */
  readonly tone?: ButtonTone;
  /** `sm` 只缩视觉（内距/字号），命中区仍由 `.ht-btn` 的 `--ht-touch-target-min` 保底。 */
  readonly size?: ButtonSize;
  readonly disabled?: boolean;
  /** 在途：自动 `disabled` + `aria-busy`，并在文字前放一枚 Spinner。 */
  readonly loading?: boolean;
  /** 不可逆破坏动作的「实底」档：仅对 `danger` 生效（`hasCommitOverride` 只认 danger）。 */
  readonly commit?: boolean;
  readonly leadingIcon?: ReactNode;
  readonly children?: ReactNode;
  readonly type?: 'button' | 'submit' | 'reset';
}

/**
 * 动作按钮。**不能当导航链接用**（外部跳转请用 `<a>`）；一屏只该有一枚 `primary`。
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    tone = 'secondary',
    size = 'default',
    disabled = false,
    loading = false,
    commit = false,
    leadingIcon,
    children,
    className,
    type = 'button',
    ...rest
  },
  ref,
): React.JSX.Element {
  const classes = [
    TONE_CLASS[tone],
    commit && tone === 'danger' ? 'ht-btn--commit' : '',
    size === 'sm' ? 'hta-btn--sm' : '',
    className,
  ]
    .filter((part) => part !== '')
    .join(' ');

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading ? true : undefined}
      {...rest}
    >
      {loading ? <Spinner size="xs" /> : leadingIcon}
      {children}
    </button>
  );
});
