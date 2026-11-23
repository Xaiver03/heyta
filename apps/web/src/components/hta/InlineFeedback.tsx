import type { ReactNode } from 'react';

import './hta.css';

export type FeedbackTone = 'success' | 'error' | 'info';

export interface InlineFeedbackProps {
  readonly tone?: FeedbackTone;
  readonly children: ReactNode;
  readonly className?: string;
  readonly testID?: string;
}

/**
 * 就地回执（表单旁/区块内）。**唯一回执原语的一半**：成功用 `role="status"` +
 * `aria-live="polite"`，错误用 `role="alert"`（正文走 `--ht-color-danger-strong`）。
 * 另一半是 `Toast`（全局浮层）。两者都不各自计时 —— 计时归宿主。
 */
export function InlineFeedback({
  tone = 'info',
  children,
  className,
  testID,
}: InlineFeedbackProps): React.JSX.Element {
  const isError = tone === 'error';
  const classes = ['hta-feedback', `hta-feedback--${tone}`, className]
    .filter((part) => part !== undefined && part !== '')
    .join(' ');
  return (
    <div
      className={classes}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? undefined : 'polite'}
      data-testid={testID}
    >
      {children}
    </div>
  );
}
