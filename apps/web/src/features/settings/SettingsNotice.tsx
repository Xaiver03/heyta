import type { ReactNode } from 'react';
import { CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { ICON_SIZE } from '@heyta/design-system';
import './settings-notice.css';

/** A setting's current state or constraint, separate from its editable fields. */
export function SettingsNotice({ title, children, tone = 'info', actions, testId, live = false }: {
  title: ReactNode;
  children?: ReactNode;
  tone?: 'info' | 'success' | 'warning' | 'danger';
  actions?: ReactNode;
  testId?: string;
  live?: boolean;
}): React.JSX.Element {
  const Icon = tone === 'success' ? CircleCheck : tone === 'info' ? Info : TriangleAlert;
  return <div className={`ht-settings__notice ht-settings__notice--${tone}`} data-testid={testId}
    role={live ? (tone === 'danger' ? 'alert' : 'status') : undefined}>
    <Icon size={ICON_SIZE.sm} aria-hidden="true" />
    <div className="ht-settings__notice-body">
      <div className="ht-type-headline">{title}</div>
      {children ? <div className="ht-settings__notice-detail">{children}</div> : null}
      {actions ? <div className="ht-settings__actions">{actions}</div> : null}
    </div>
  </div>;
}
