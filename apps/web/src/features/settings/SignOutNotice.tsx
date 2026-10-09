import { ICON_SIZE } from '@heyta/design-system';
/**
 * 退出登录之后那句**实话**（挂在主区顶部）
 * ======================================
 *
 * `planSignOut()` 给出两个字段，这里兑现第二个：
 *
 *   - `clearLocalCredentials`（恒为 `true`）由 `signOutStore` 在**点击那一刻**执行，
 *     所以这个组件不负责登出，只负责把"登出之后还差什么"说出来；
 *   - `serverRevocationPending` ⇒ 本机已经退出了，但服务端上那一枚还活着。
 *     吞掉它就等于让「退出登录」在断网时**看起来完全成功** —— 而"我已经退出了"
 *     在共享电脑上正是本轮要修的那句谎。
 *
 * ⚠️ 这里**只**渲染，不判断：撤销结果的分诊在 `signOutStore`，
 * 网络与协议在 `@heyta/app-host`。文案是 `common.signOut.*`（+ 「退出所有设备」
 * 那句确认 `common.sessions.logoutAllDone`，它也在同一个出口呈现，因为点完那一下
 * 面板已经落到未登录态、没有别的地方可以放它）。
 */

import { useEffect } from 'react';

import { RotateCw } from 'lucide-react';

import { useI18n } from '@heyta/i18n';

import { useSyncStore } from '../sync/store.js';
import { useSignOutStore } from './signOutStore.js';
import { SettingsNotice } from './SettingsNotice.js';

export function SignOutNotice(): React.JSX.Element | null {
  const { t } = useI18n();

  const notice = useSignOutStore((s) => s.notice);
  const running = useSignOutStore((s) => s.running);
  const retry = useSignOutStore((s) => s.retryPendingRevocation);
  const clearDoneNotice = useSignOutStore((s) => s.clearDoneNotice);
  const token = useSyncStore((s) => s.token);

  /**
   * 「所有设备都已退出，包括这台。请重新登录。」的保质期 = **还没重新登录**。
   *
   * 🔴 用户真的登进来之后再挂这句话，界面就在说一件已经过期的事。
   * 而 `pending-revocation` 那一支**不**跟着消失 —— 那枚令牌还活着这件事
   * 不因为用户又登录了一次就变假。
   */
  useEffect(() => {
    if (notice !== 'signed-out-everywhere') return;
    if (token === undefined || token.trim() === '') return;
    clearDoneNotice();
  }, [notice, token, clearDoneNotice]);

  if (notice === 'pending-revocation') {
    return (
      <SettingsNotice
        tone="warning"
        live
        title={t('common.signOut.pending')}
        testId="sign-out-pending"
        actions={
          <button
            type="button"
            className="ht-btn ht-btn--ghost"
            data-testid="sign-out-retry"
            // 忙态用 guard（`retryPendingRevocation` 第一行），这里只是别让点第二下看着像两个请求。
            disabled={running !== undefined}
            onClick={() => {
              void retry();
            }}
          >
            <RotateCw size={ICON_SIZE.xs} aria-hidden="true" /> {t('common.signOut.retry')}
          </button>
        }
      />
    );
  }

  if (notice === 'signed-out-everywhere') {
    return (
      <SettingsNotice tone="success" live title={t('common.sessions.logoutAllDone')} testId="sign-out-all-done" />
    );
  }

  return null;
}
