import { useI18n } from '@heyta/i18n/provider';

import { ADMIN_PAGE_SIZE, type AdminStoreState } from '../store.js';

import { AdminEmpty, Pager } from './shared.js';

export function CouponsSection({
  store,
}: {
  store: AdminStoreState;
}): React.JSX.Element | null {
  const { t } = useI18n();
  if (store.coupons === null) return null;

  return (
    <>
          <ul className="ht-settings__admin-list" data-testid="admin-coupons">
            {store.coupons.items.map((coupon) => (
              <li key={coupon.id} className="ht-settings__admin-staticRow">
                <span className="ht-settings__admin-rowMain">
                  {coupon.code ?? coupon.name} · {coupon.kind}
                </span>
                <span className="ht-settings__admin-rowMeta">
                  {coupon.enabled ? '✓' : '✕'} · {coupon.redemptions}
                  {coupon.maxRedemptions === null ? '' : ` / ${String(coupon.maxRedemptions)}`}
                </span>
              </li>
            ))}
          </ul>
          {store.coupons.items.length === 0 && (
            <AdminEmpty titleKey="web.admin.list.none" />
          )}
          <Pager
            total={store.coupons.total}
            offset={store.coupons.offset}
            onPrev={() => {
              void store.loadCoupons(Math.max(0, store.coupons!.offset - ADMIN_PAGE_SIZE));
            }}
            onNext={() => {
              void store.loadCoupons(store.coupons!.offset + ADMIN_PAGE_SIZE);
            }}
          />
    </>
  );
}
