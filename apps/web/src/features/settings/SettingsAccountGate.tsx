import { LogIn } from 'lucide-react';

import { ICON_SIZE } from '@heyta/design-system';
import { useI18n, type MessageKey } from '@heyta/i18n';

import { useSyncStore } from '../sync/store.js';

/**
 * 账号设置的统一未登录状态。
 *
 * 设置里的账号能力不能只留下“请登录”的静态提示：用户需要在当前上下文
 * 直接进入同一条登录流程。这个组件只负责导航，不拥有认证状态或请求逻辑，
 * 因而不会为每个面板再长出一条登录实现。
 */
export function SettingsAccountGate(props: {
  messageKey: MessageKey;
  testId: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const openSignIn = useSyncStore((state) => state.openSignIn);

  return (
    <div className="ht-settings__account-gate" data-testid={`${props.testId}-gate`} role="status">
      <div className="ht-settings__account-gate-content">
        <span className="ht-settings__account-gate-icon" aria-hidden="true">
          <LogIn size={ICON_SIZE.sm} />
        </span>
        <div>
          <p className="ht-settings__account-gate-title">{t('common.auth.form.signIn')}</p>
          <p className="ht-settings__hint" data-testid={props.testId}>
            {t(props.messageKey)}
          </p>
        </div>
      </div>
      <button
        type="button"
        className="ht-btn ht-btn--primary"
        data-testid={`${props.testId}-action`}
        onClick={() => openSignIn()}
      >
        <LogIn size={ICON_SIZE.xs} aria-hidden="true" />
        {t('common.auth.form.signIn')}
      </button>
    </div>
  );
}
