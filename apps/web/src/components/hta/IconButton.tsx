import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { Button, type ButtonSize, type ButtonTone } from './Button.js';

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label' | 'type'> {
  /** 🔴 必填：纯图标没有可读文字名，`aria-label` 是它唯一的可访问名。 */
  readonly label: string;
  readonly icon: ReactNode;
  readonly tone?: ButtonTone;
  readonly size?: ButtonSize;
  readonly type?: 'button' | 'submit' | 'reset';
}

/**
 * 工具栏 / 行内图标动作。默认 `ghost`，图标由 `lucide-react` 传入并自带 `ICON_SIZE`。
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, tone = 'ghost', size = 'default', className, ...rest },
  ref,
): React.JSX.Element {
  return (
    <Button
      ref={ref}
      tone={tone}
      size={size}
      aria-label={label}
      className={['hta-icon-btn', className].filter((part) => part !== undefined && part !== '').join(' ')}
      {...rest}
    >
      {icon}
    </Button>
  );
});
