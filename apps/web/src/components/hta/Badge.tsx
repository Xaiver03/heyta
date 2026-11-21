import type { ReactNode } from 'react';

import './hta.css';

/** 语义色调：只用 token，不用临时色。 */
export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly children: ReactNode;
  readonly className?: string;
  readonly testID?: string;
}

/**
 * 状态徽标（可归档的状态标签）。**不是可变状态的开关**（那用 `Switch`/`Checkbox`）。
 */
export function Badge({ tone = 'neutral', children, className, testID }: BadgeProps): React.JSX.Element {
  const classes = ['hta-badge', `hta-badge--${tone}`, className]
    .filter((part) => part !== undefined && part !== '')
    .join(' ');
  return (
    <span className={classes} data-testid={testID}>
      {children}
    </span>
  );
}
