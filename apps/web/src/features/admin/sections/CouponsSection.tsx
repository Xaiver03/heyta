import type { AdminCouponRow } from '@heyta/app-host';
import { useI18n } from '@heyta/i18n/provider';

import { Badge, DataTable, type DataTableColumn } from '../../../components/hta/index.js';

import { ADMIN_PAGE_SIZE, type AdminStoreState } from '../store.js';

import { Pager, formatMoney, formatTime } from './shared.js';

/** 折扣力度：`percentOffBp`（基点为 1/100 %）优先，否则 `amountOffMinor` + `currency`；都没有就占位。 */
function formatDiscount(coupon: AdminCouponRow): string {
  if (coupon.percentOffBp !== null) return `${String(coupon.percentOffBp / 100)}%`;
  if (coupon.amountOffMinor !== null) return formatMoney(coupon.amountOffMinor, coupon.currency);
  return '—';
}

export function CouponsSection({
  store,
}: {
  store: AdminStoreState;
}): React.JSX.Element | null {
  const { t } = useI18n();

  const columns: readonly DataTableColumn<AdminCouponRow>[] = [
    {
      key: 'item',
      header: t('web.admin.table.item'),
      render: (coupon) => `${coupon.code ?? coupon.name} · ${coupon.kind}`,
    },
    {
      key: 'status',
      header: t('web.admin.table.status'),
      render: (coupon) => (
        <Badge tone={coupon.enabled ? 'success' : 'neutral'}>
          {coupon.enabled ? t('web.admin.overview.coupons.enabled') : t('web.admin.coupon.disabled')}
        </Badge>
      ),
    },
    {
      key: 'discount',
      header: t('web.admin.coupon.discount'),
      align: 'end',
      render: (coupon) => formatDiscount(coupon),
    },
    {
      key: 'validity',
      header: t('web.admin.coupon.validity'),
      render: (coupon) => `${formatTime(coupon.validFrom)} – ${formatTime(coupon.validUntil)}`,
    },
    {
      key: 'redemptions',
      header: t('web.admin.overview.coupons.used'),
      align: 'end',
      render: (coupon) =>
        coupon.maxRedemptions === null
          ? String(coupon.redemptions)
          : `${String(coupon.redemptions)} / ${String(coupon.maxRedemptions)}`,
    },
  ];

  const coupons = store.coupons;

  return (
    <>
      <div data-testid="admin-coupons">
        <DataTable
          columns={columns}
          rows={coupons?.items ?? []}
          rowKey={(coupon) => coupon.id}
          loading={coupons === null}
          emptyTitle={t('web.admin.list.none')}
        />
      </div>
      {coupons !== null && (
        <Pager
          total={coupons.total}
          offset={coupons.offset}
          onPrev={() => {
            void store.loadCoupons(Math.max(0, coupons.offset - ADMIN_PAGE_SIZE));
          }}
          onNext={() => {
            void store.loadCoupons(coupons.offset + ADMIN_PAGE_SIZE);
          }}
        />
      )}
    </>
  );
}
