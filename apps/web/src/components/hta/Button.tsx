import { Slot } from '@radix-ui/react-slot';
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
  /**
   * 与 Radix `Slot` 的 `asChild` 同一语义：**不自己渲染 `<button>`**，
   * 而是把类名与行为合并到唯一那个子元素上。
   *
   * 用途只有一处：按钮长得像按钮、但语义必须是链接（`<a href>` / 路由 `<Link>`）。
   * 反过来**不许**用它绕开"一屏一枚 primary"这类判断 —— 那与包装无关。
   *
   * 🔴 `asChild` 时 `leadingIcon` / `loading` 的 spinner 不渲染：内容归子元素所有，
   * 组件不再替你拼结构（拼了就会在 `<a>` 里塞进两个并列节点，破坏排版）。
   */
  readonly asChild?: boolean;
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
    asChild = false,
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

  /*
    `Slot` 与原生 `'button'` 的 props 形状不同（Slot 不接受 `type`），
    所以走 `ElementType` 而不是联合类型 —— 联合会让 `type` / `disabled`
    在两个分支上互相打架，从而逼出 `as any`。
  */
  const Comp = (asChild ? Slot : 'button') as React.ElementType;

  return (
    <Comp
      ref={ref}
      {...(asChild ? {} : { type, disabled: disabled || loading })}
      className={classes}
      aria-busy={loading ? true : undefined}
      {...rest}
    >
      {asChild ? children : (
        <>
          {loading ? <Spinner size="xs" /> : leadingIcon}
          {children}
        </>
      )}
    </Comp>
  );
});
