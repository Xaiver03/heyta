import { useI18n } from '@heyta/i18n/provider';

import { MetricGrid, StatCard } from '../../../components/hta/index.js';

import type { AdminStoreState } from '../store.js';

import { formatMoney } from './shared.js';

/**
 * 概览：按域（用户 / 订阅 / 订单 / 优惠码 / 邀请）分组的**只读**统计卡。
 *
 * 🔴 这里一个数都不算：全部来自 `GET /api/admin/overview`（`AdminOverview`）。
 * 纯只读页 —— 没有任何写操作。
 *
 * 布局：每个域是一段 `ht-settings__admin-revenueGroup`（`display:flex;
 * flex-direction:column; gap`）纵向分组容器，组标题走 `ht-settings__admin-h5`，
 * 指标卡走共享 `MetricGrid` + `StatCard`。本仓没有通用的「纵向栈」类，分组容器
 * 只能复用既有分组类 —— 不在 features 里写内联样式，也不在此单文件改动范围内新增 CSS。
 */
export function OverviewSection({
  store,
}: {
  store: AdminStoreState;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const overview = store.overview;
  if (overview === null) return null;

  const { users, subscriptions, orders, coupons, invites } = overview;

  return (
    <div data-testid="admin-overview">
      {/* 用户 */}
      <section className="ht-settings__admin-revenueGroup">
        <h5 className="ht-settings__admin-h5">{t('web.admin.tab.users')}</h5>
        <MetricGrid>
          <StatCard label={t('web.admin.overview.users.total')} value={users.total} />
          <StatCard label={t('web.admin.overview.users.verified')} value={users.verified} />
          <StatCard label={t('web.admin.overview.users.admins')} value={users.admins} />
          <StatCard label={t('web.admin.overview.users.locked')} value={users.locked} />
        </MetricGrid>
      </section>

      {/* 订阅 */}
      <section className="ht-settings__admin-revenueGroup">
        <h5 className="ht-settings__admin-h5">{t('web.admin.tab.subscriptions')}</h5>
        <MetricGrid>
          <StatCard label={t('web.admin.overview.subs.total')} value={subscriptions.total} />
          <StatCard label={t('web.admin.overview.subs.active')} value={subscriptions.active} />
        </MetricGrid>
        {subscriptions.byStatus.length === 0 ? null : (
          <>
            <p className="ht-settings__hint">{t('web.admin.overview.byStatus')}</p>
            <MetricGrid>
              {subscriptions.byStatus.map((row) => (
                <StatCard
                  key={row.status ?? '—'}
                  label={row.status ?? '—'}
                  value={row.count}
                />
              ))}
            </MetricGrid>
          </>
        )}
      </section>

      {/* 订单 */}
      <section className="ht-settings__admin-revenueGroup">
        <h5 className="ht-settings__admin-h5">{t('web.admin.tab.orders')}</h5>
        <MetricGrid>
          <StatCard label={t('web.admin.overview.orders.total')} value={orders.total} />
        </MetricGrid>
        {orders.byStatus.length === 0 ? null : (
          <>
            <p className="ht-settings__hint">{t('web.admin.overview.byStatus')}</p>
            <MetricGrid>
              {orders.byStatus.map((row) => (
                <StatCard key={row.status} label={row.status} value={row.count} />
              ))}
            </MetricGrid>
          </>
        )}
        {orders.paidByCurrency.length === 0 ? null : (
          <>
            <p className="ht-settings__hint">{t('web.admin.overview.paidByCurrency')}</p>
            <MetricGrid>
              {orders.paidByCurrency.map((row) => (
                <StatCard
                  key={row.currency}
                  label={t('web.admin.overview.orders.revenue')}
                  value={formatMoney(row.revenueMinor, row.currency)}
                />
              ))}
            </MetricGrid>
          </>
        )}
      </section>

      {/* 优惠码 */}
      <section className="ht-settings__admin-revenueGroup">
        <h5 className="ht-settings__admin-h5">{t('web.admin.tab.coupons')}</h5>
        <MetricGrid>
          <StatCard label={t('web.admin.overview.coupons.total')} value={coupons.total} />
          <StatCard label={t('web.admin.overview.coupons.enabled')} value={coupons.enabled} />
          <StatCard
            label={t('web.admin.overview.coupons.used')}
            value={coupons.settledRedemptions}
          />
        </MetricGrid>
      </section>

      {/* 邀请 */}
      <section className="ht-settings__admin-revenueGroup">
        <h5 className="ht-settings__admin-h5">{t('web.admin.tab.invites')}</h5>
        <MetricGrid>
          <StatCard label={t('web.admin.overview.invites.codes')} value={invites.codes} />
          {/* TODO(i18n): 邀请码「停用数」专用词条（当前复用「关闭」） */}
          <StatCard label={t('web.admin.close')} value={invites.codesDisabled} />
          <StatCard label={t('web.admin.overview.invites.referrals')} value={invites.referrals} />
          <StatCard
            label={t('web.admin.overview.invites.activated')}
            value={invites.referralsActivated}
          />
          {/* TODO(i18n): 「已奖励推荐数」专用词条（当前复用「奖励」） */}
          <StatCard label={t('web.admin.table.reward')} value={invites.referralsRewarded} />
        </MetricGrid>
      </section>
    </div>
  );
}
