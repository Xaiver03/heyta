import { useI18n } from '@heyta/i18n/provider';

import type { AdminStoreState } from '../store.js';

import { Stat, formatMoney } from './shared.js';

export function OverviewSection({
  store,
}: {
  store: AdminStoreState;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const overview = store.overview;
  if (overview === null) return null;

  return (
        <div className="ht-settings__admin-stats" data-testid="admin-overview">
          <Stat labelKey="web.admin.overview.users.total" value={overview.users.total} />
          <Stat labelKey="web.admin.overview.users.verified" value={overview.users.verified} />
          <Stat labelKey="web.admin.overview.users.admins" value={overview.users.admins} />
          <Stat labelKey="web.admin.overview.users.locked" value={overview.users.locked} />
          <Stat labelKey="web.admin.overview.subs.total" value={overview.subscriptions.total} />
          <Stat labelKey="web.admin.overview.subs.active" value={overview.subscriptions.active} />
          <Stat labelKey="web.admin.overview.orders.total" value={overview.orders.total} />
          {overview.orders.paidByCurrency.map((row) => (
            <div className="ht-settings__admin-stat" key={row.currency}>
              <span className="ht-settings__admin-statValue">
                {formatMoney(row.revenueMinor, row.currency)}
              </span>
              <span className="ht-settings__admin-statLabel">
                {t('web.admin.overview.orders.revenue')}
              </span>
            </div>
          ))}
          <Stat labelKey="web.admin.overview.coupons.enabled" value={overview.coupons.enabled} />
          <Stat labelKey="web.admin.overview.coupons.used" value={overview.coupons.settledRedemptions} />
          <Stat
            labelKey="web.admin.overview.invites.referrals"
            value={overview.invites.referrals}
          />
          <Stat
            labelKey="web.admin.overview.invites.activated"
            value={overview.invites.referralsActivated}
          />
        </div>
  );
}
