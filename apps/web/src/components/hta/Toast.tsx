import type { ReactNode } from 'react';

import { Button } from './Button.js';
import type { FeedbackTone } from './InlineFeedback.js';
import './hta.css';

export interface ToastProps {
  readonly tone?: FeedbackTone;
  readonly children: ReactNode;
  /** 关闭动作与文案成对给；只给一个不画关闭按钮（不做假动作）。 */
  readonly onDismiss?: () => void;
  readonly dismissLabel?: string;
  readonly testID?: string;
}

/**
 * 全局浮层回执。与 `InlineFeedback` 同一条语义分工：
 * 成功/信息 `role="status"` + `aria-live="polite"`，错误 `role="alert"`。
 *
 * 🔴 **这里不带任何计时器**：自动消失的时长归宿主（唯一回执原则 —— 计时器只有一份）。
 * 浮层位置与层级用 `--ht-z-toast`，不手写 z 数字。
 */
export function Toast({
  tone = 'info',
  children,
  onDismiss,
  dismissLabel,
  testID,
}: ToastProps): React.JSX.Element {
  const isError = tone === 'error';
  const showDismiss = onDismiss !== undefined && dismissLabel !== undefined;
  return (
    <div
      className={`hta-toast hta-toast--${tone}`}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? undefined : 'polite'}
      data-testid={testID}
    >
      <span className="hta-toast__message">{children}</span>
      {showDismiss ? (
        <span className="hta-toast__dismiss">
          <Button tone="ghost" size="sm" onClick={onDismiss}>
            {dismissLabel}
          </Button>
        </span>
      ) : null}
    </div>
  );
}
