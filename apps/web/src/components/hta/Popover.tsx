import * as PopoverPrimitive from '@radix-ui/react-popover';
import type { ReactElement, ReactNode } from 'react';

import './hta.css';

export interface PopoverProps {
  /** 触发元素（单个可接 ref 的元素，Radix 以 `asChild` 挂到它上面）。 */
  readonly trigger: ReactElement;
  /** 浮层内容。 */
  readonly children: ReactNode;
  /** 受控开合；不传则非受控。 */
  readonly open?: boolean;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly side?: 'top' | 'right' | 'bottom' | 'left';
  readonly align?: 'start' | 'center' | 'end';
  readonly testID?: string;
}

/**
 * 点开式浮层（Radix `Popover`）。开合态外观走 `data-state="open|closed"`（见 hta.css）。
 */
export function Popover({
  trigger,
  children,
  open,
  defaultOpen,
  onOpenChange,
  side = 'bottom',
  align = 'start',
  testID,
}: PopoverProps): React.JSX.Element {
  return (
    <PopoverPrimitive.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          className="hta-popover"
          side={side}
          align={align}
          sideOffset={6}
          data-testid={testID}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
