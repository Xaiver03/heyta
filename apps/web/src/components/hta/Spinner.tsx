import { ICON_SIZE } from '@heyta/design-system';
import { Loader2 } from 'lucide-react';

import './hta.css';

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg';

const ICON_SIZE_BY_NAME = {
  xs: ICON_SIZE.xs,
  sm: ICON_SIZE.sm,
  md: ICON_SIZE.md,
  lg: ICON_SIZE.lg,
} as const;

export interface SpinnerProps {
  /** 与 `ICON_SIZE` 同一阶梯；默认 `sm`。 */
  readonly size?: SpinnerSize;
  /** 给了就作为可访问名并发成 `role="status"`；纯装饰则应省略。 */
  readonly label?: string;
  readonly testID?: string;
}

/**
 * 局部在途转圈。**不承担整页加载**（首屏走 `ListState` 的 Skeleton）。
 *
 * 动画类复用既有 `.ht-settings__busy`（tokens.css 已在 reduced-motion 下把时长压掉），
 * 不新造一套旋转规则。
 */
export function Spinner({ size = 'sm', label, testID }: SpinnerProps): React.JSX.Element {
  return (
    <span
      className="hta-spinner"
      role={label === undefined ? undefined : 'status'}
      aria-label={label}
      data-testid={testID}
    >
      <Loader2 className="ht-settings__busy" size={ICON_SIZE_BY_NAME[size]} aria-hidden="true" />
    </span>
  );
}
