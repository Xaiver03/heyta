import { useI18n } from '@heyta/i18n/provider';

import { ADMIN_PAGE_SIZE, type AdminStoreState } from '../store.js';

import { AdminEmpty, Pager, formatTime } from './shared.js';

export function InvitesSection({
  store,
}: {
  store: AdminStoreState;
}): React.JSX.Element | null {
  const { t } = useI18n();
  if (store.invites === null) return null;

  return (
    <>
          {/* 🔴 一个响应两面：`codes` 是"谁手里有码"，`referrals` 是"码换来谁"。
              服务端用同一个 `?offset=` 裁两边 ⇒ 分页器只有一个。 */}
          <h5 className="ht-settings__admin-h5">{t('web.admin.invites.codes')}</h5>
          <ul className="ht-settings__admin-list" data-testid="admin-codes">
            {store.invites.codes.items.map((code) => (
              <li key={code.id} className="ht-settings__admin-staticRow">
                <span className="ht-settings__admin-rowMain">
                  {code.code} · {t('web.admin.table.owner')}: {code.email}
                </span>
                <span className="ht-settings__admin-rowMeta">
                  {code.disabled ? '✕' : '✓'} · {formatTime(code.createdAt)}
                </span>
              </li>
            ))}
          </ul>
          {store.invites.codes.items.length === 0 && (
            <AdminEmpty titleKey="web.admin.list.none" />
          )}

          <h5 className="ht-settings__admin-h5">{t('web.admin.invites.referrals')}</h5>
          <ul className="ht-settings__admin-list" data-testid="admin-referrals">
            {store.invites.referrals.items.map((referral) => (
              <li key={referral.id} className="ht-settings__admin-staticRow">
                <span className="ht-settings__admin-rowMain">
                  {t('web.admin.table.inviter')}: {referral.inviter.email} →{' '}
                  {t('web.admin.table.invitee')}: {referral.invitee.email}
                </span>
                <span className="ht-settings__admin-rowMeta">
                  {t('web.admin.table.reward')}: {referral.rewardDays ?? '—'} ·{' '}
                  {formatTime(referral.activatedAt)}
                </span>
              </li>
            ))}
          </ul>
          {store.invites.referrals.items.length === 0 && (
            <AdminEmpty titleKey="web.admin.list.none" />
          )}
          <Pager
            total={store.invites.referrals.total}
            offset={store.invites.referrals.offset}
            onPrev={() => {
              void store.loadInvites(Math.max(0, store.invites!.referrals.offset - ADMIN_PAGE_SIZE));
            }}
            onNext={() => {
              void store.loadInvites(store.invites!.referrals.offset + ADMIN_PAGE_SIZE);
            }}
          />
    </>
  );
}
