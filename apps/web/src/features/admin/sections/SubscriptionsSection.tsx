import { useI18n } from '@heyta/i18n/provider';

import { ADMIN_PAGE_SIZE, type AdminStoreState } from '../store.js';

import { AdminEmpty, Pager, formatTime } from './shared.js';

export function SubscriptionsSection({
  store,
}: {
  store: AdminStoreState;
}): React.JSX.Element | null {
  const { t } = useI18n();
  if (store.subscriptions === null) return null;

  return (
    <>
          <ul className="ht-settings__admin-list" data-testid="admin-subscriptions">
            {store.subscriptions.items.map((sub) => (
              <li key={sub.id} className="ht-settings__admin-staticRow">
                <span className="ht-settings__admin-rowMain">
                  {sub.email} · {sub.status ?? '—'}
                </span>
                <span className="ht-settings__admin-rowMeta">
                  {t('web.admin.table.expires')}: {formatTime(sub.currentPeriodEnd)}
                </span>
              </li>
            ))}
          </ul>
          {store.subscriptions.items.length === 0 && (
            <AdminEmpty titleKey="web.admin.list.none" />
          )}
          <Pager
            total={store.subscriptions.total}
            offset={store.subscriptions.offset}
            onPrev={() => {
              void store.loadSubscriptions(
                Math.max(0, store.subscriptions!.offset - ADMIN_PAGE_SIZE),
              );
            }}
            onNext={() => {
              void store.loadSubscriptions(store.subscriptions!.offset + ADMIN_PAGE_SIZE);
            }}
          />
    </>
  );
}
