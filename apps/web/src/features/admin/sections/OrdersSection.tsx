import { useI18n } from '@heyta/i18n/provider';

import { ADMIN_PAGE_SIZE, type AdminStoreState } from '../store.js';

import { AdminEmpty, Pager, formatMoney, formatTime } from './shared.js';

export function OrdersSection({
  store,
}: {
  store: AdminStoreState;
}): React.JSX.Element | null {
  const { t } = useI18n();
  if (store.orders === null) return null;

  return (
    <>
          <ul className="ht-settings__admin-list" data-testid="admin-orders">
            {store.orders.items.map((order) => (
              <li key={order.id} className="ht-settings__admin-staticRow">
                <span className="ht-settings__admin-rowMain">
                  {order.email} · {formatMoney(order.finalAmountMinor, order.currency)}
                </span>
                <span className="ht-settings__admin-rowMeta">
                  {order.status} · {formatTime(order.createdAt)}
                </span>
              </li>
            ))}
          </ul>
          {store.orders.items.length === 0 && (
            <AdminEmpty titleKey="web.admin.list.none" />
          )}
          <Pager
            total={store.orders.total}
            offset={store.orders.offset}
            onPrev={() => {
              void store.loadOrders(Math.max(0, store.orders!.offset - ADMIN_PAGE_SIZE));
            }}
            onNext={() => {
              void store.loadOrders(store.orders!.offset + ADMIN_PAGE_SIZE);
            }}
          />
    </>
  );
}
