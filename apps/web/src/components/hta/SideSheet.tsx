import type { ReactNode } from 'react';

import { WebModalShell } from '../../lib/dialog/WebModalShell.js';
import './hta.css';

export interface SideSheetProps {
  /** testID 前缀：`${testId}` 落面板、`${testId}-scrim` 落遮罩。 */
  readonly testId: string;
  /** `aria-labelledby` 指向标题 id（标题由本组件渲染，或由 children 自带同 id 的标题）。 */
  readonly labelledBy: string;
  /** 给了就由本组件渲染 `<h2 id={labelledBy}>`；不给则要求 children 自带该标题。 */
  readonly title?: string;
  readonly onCancel: () => void;
  readonly onDismissAttempt?: (via: 'scrim' | 'escape') => void;
  readonly busy?: boolean;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}

/**
 * 右侧抽屉（只读详情）。复用 `WebModalShell policy="drawer"`：三条关闭通道全部查
 * `@heyta/ui` 的 dismissal 表，焦点接管与遮罩由壳给，本组件只排头部 / 内容 / 底部动作。
 *
 * 🔴 不自绘 `role="dialog"` / `aria-modal`（那是 `check:overlay` 的红线），一切走壳。
 */
export function SideSheet({
  testId,
  labelledBy,
  title,
  onCancel,
  onDismissAttempt,
  busy = false,
  footer,
  children,
}: SideSheetProps): ReactNode {
  return (
    <WebModalShell
      policy="drawer"
      testId={testId}
      labelledBy={labelledBy}
      onCancel={onCancel}
      onDismissAttempt={onDismissAttempt}
      busy={busy}
      overlayClass="hta-sheet__overlay"
      dialogClass="hta-sheet__panel"
    >
      <div className="hta-sheet__body">
        {title === undefined ? null : (
          <h2 id={labelledBy} className="hta-sheet__title">
            {title}
          </h2>
        )}
        <div className="hta-sheet__content">{children}</div>
        {footer === undefined ? null : <div className="hta-sheet__footer">{footer}</div>}
      </div>
    </WebModalShell>
  );
}
