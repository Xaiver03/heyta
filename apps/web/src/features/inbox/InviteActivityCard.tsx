/**
 * 「邀请好友」活动卡（活动 Tab 里的第一张，也是目前唯一一张）。
 *
 * ## 它由**服务端下发的进度**驱动，不在本地算
 *
 * 已邀请 / 已激活 / 累计天数 / 本窗口剩余名额，全部来自 `GET /api/activity`。
 * 本地只负责把它们摆出来 —— 尤其是**上限**：它只该有一个定义
 * （`INVITE_CAP_PER_WINDOW`，在 `@heyta/domain`），界面自己猜一个数字
 * 就会在运营改了上限之后继续显示旧值，而两个数字都"看起来对"。
 *
 * ## 措辞：对外叫「会员」，代码里叫 `hosting`
 *
 * 奖励实际授予的是 `hosting` 这项能力（见 `docs/reference/pricing-and-entitlements.md`）。
 * 界面上说「会员」是因为那是用户能懂的说法；**不**在这里发明一个新的档位名
 * （价格表里恰好只有两个 SKU，见 ADR-0020）。
 */
import { useState } from 'react';

import { INVITE_QUERY_PARAM, formatCompactDate } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { EmptyState } from '@heyta/ui';
import { Gift } from 'lucide-react';

import type { InviteActivity } from '@heyta/app-host';

/**
 * 拼出可以被别人打开的邀请链接。
 *
 * 用**当前页面的** origin + pathname，而不是服务端地址：
 * 自托管场景下应用与同步服务端可能不同源，而"邀请别人来用"要指向**应用**。
 * （服务端地址是 API，点进去只会得到一个 404。）
 */
export const buildInviteLink = (code: string, location: Location): string =>
  `${location.origin}${location.pathname}?${INVITE_QUERY_PARAM}=${encodeURIComponent(code)}`;

/** 复制结果。`copied` 只用来短暂显示"已复制"，不做成全局 toast。 */
type CopyState = 'idle' | 'copied' | 'failed';

export function InviteActivityCard({
  activity,
  testID = 'inbox-invite',
}: {
  activity: InviteActivity;
  testID?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const [copyState, setCopyState] = useState<CopyState>('idle');

  const inviteLink = buildInviteLink(activity.inviteCode, window.location);
  const remaining = Math.max(0, activity.windowCap - activity.windowInvited);

  const copy = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
      return;
    } catch {
      // 剪贴板可能因为权限、非安全上下文、或用户拒绝而不可用。
      // 这里不静默失败：提示"请手动选中"，因为**码本身就在界面上**
      // （`user-select` 没有被禁用），所以手动这条路真的走得通。
      setCopyState('failed');
    }
  };

  return (
    <section className="ht-inbox__card" data-testid={testID}>
      <header className="ht-inbox__card-head">
        <Gift size={16} aria-hidden="true" />
        <h3 className="ht-inbox__card-title">
          {t('web.inbox.activity.invite.title')}
        </h3>
      </header>

      <p className="ht-inbox__card-body">
        {t('web.inbox.activity.invite.body', { days: activity.rewardDays })}
      </p>

      <div className="ht-inbox__field">
        <span className="ht-inbox__field-label">
          {t('web.inbox.activity.invite.codeLabel')}
        </span>
        <code className="ht-inbox__field-value" data-testid={`${testID}-code`}>
          {activity.inviteCode}
        </code>
        <button
          type="button"
          className="ht-inbox__copy"
          data-testid={`${testID}-copy-code`}
          onClick={() => {
            void copy(activity.inviteCode);
          }}
        >
          {t('web.inbox.activity.invite.copyCode')}
        </button>
      </div>

      <div className="ht-inbox__field">
        <button
          type="button"
          className="ht-inbox__copy"
          data-testid={`${testID}-copy-link`}
          onClick={() => {
            void copy(inviteLink);
          }}
        >
          {t('web.inbox.activity.invite.copyLink')}
        </button>
        {copyState === 'copied' ? (
          <span className="ht-inbox__status" data-testid={`${testID}-copied`}>
            {t('web.inbox.activity.invite.copied')}
          </span>
        ) : null}
        {copyState === 'failed' ? (
          <span className="ht-inbox__status ht-inbox__status--warn">
            {t('web.inbox.activity.invite.copyFailed')}
          </span>
        ) : null}
      </div>

      <p className="ht-inbox__stats" data-testid={`${testID}-stats`}>
        {t('web.inbox.activity.invite.stats', {
          invited: activity.invited,
          activated: activity.activated,
          days: activity.daysEarned,
        })}
      </p>

      {/*
        剩余名额只在**真的快到上限时**才说 —— 平时那是一个用户不需要知道的
        数字，常驻显示会让一张福利卡读起来像一份配额说明。
      */}
      {remaining <= 5 ? (
        <p className="ht-inbox__muted" data-testid={`${testID}-remaining`}>
          {t('web.inbox.activity.invite.remaining', { remaining })}
        </p>
      ) : null}

      <h4 className="ht-inbox__sublist-title">
        {t('web.inbox.activity.invite.listTitle')}
      </h4>

      {activity.referrals.length === 0 ? (
        // 空态走共享 `EmptyState`（与上面两处同一条纪律）。
        <EmptyState
          title={t('web.inbox.activity.invite.empty')}
          testID={`${testID}-empty`}
        />
      ) : (
        <ul className="ht-inbox__sublist" data-testid={`${testID}-list`}>
          {activity.referrals.map((referral) => (
            <li key={referral.code + String(referral.createdAt)} className="ht-inbox__subitem">
              <span className="ht-inbox__subitem-name">
                {referral.displayName ?? t('web.inbox.activity.invite.unknownName')}
              </span>
              <span className="ht-inbox__subitem-status">
                {referral.activatedAt !== null
                  ? t('web.inbox.activity.invite.status.activated', {
                      days: referral.rewardDays ?? 0,
                    })
                  : t('web.inbox.activity.invite.status.pending')}
              </span>
              <span className="ht-inbox__subitem-date">
                {formatCompactDate(referral.createdAt, Date.now())}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
