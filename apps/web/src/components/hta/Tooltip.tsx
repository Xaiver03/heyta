import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ReactElement, ReactNode } from 'react';

import './hta.css';

export interface TooltipProps {
  /** 气泡里的内容。 */
  readonly content: ReactNode;
  /** 触发元素（单个可接 ref 的元素，Radix 以 `asChild` 挂到它上面）。 */
  readonly children: ReactElement;
  readonly side?: 'top' | 'right' | 'bottom' | 'left';
  readonly align?: 'start' | 'center' | 'end';
  /** 悬停多久后出现（毫秒）。 */
  readonly delayDuration?: number;
  readonly testID?: string;
}

/**
 * 轻量提示气泡（Radix `Tooltip`）。
 *
 * 组件内部自带 `TooltipProvider`，调用方**不用**再在外面包一层；若调用方已有
 * Provider，内层 Provider 会以自己的 `delayDuration` 生效（Radix 允许嵌套）。
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  delayDuration = 200,
  testID,
}: TooltipProps): React.JSX.Element {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            className="hta-tooltip"
            side={side}
            align={align}
            sideOffset={6}
            data-testid={testID}
          >
            {content}
            <TooltipPrimitive.Arrow className="hta-tooltip__arrow" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
