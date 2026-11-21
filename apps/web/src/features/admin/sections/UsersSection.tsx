import { useCallback } from 'react';

import { ICON_SIZE } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n/provider';
import { Search } from 'lucide-react';

import {
  ADMIN_PAGE_SIZE,
  capabilityLabelKey,
  entitlementReasonKey,
  providerLabelKey,
  type AdminStoreState,
} from '../store.js';

import { FormField } from '../../../lib/form/FormField.js';

import { AdminEmpty, Pager, formatBytes, formatMoney, formatTime } from './shared.js';

export function UsersSection({
  store,
  active,
  search,
  onSearchChange,
  quotaMiB,
  onQuotaChange,
}: {
  store: AdminStoreState;
  active: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  quotaMiB: string;
  onQuotaChange: (value: string) => void;
}): React.JSX.Element {
  const { t } = useI18n();

  const submitSearch = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (!active) return;
      void store.loadUsers({ q: search, offset: 0 });
    },
    [active, search, store],
  );

  const users = store.users;
  const detail = store.detail;

  return (
    <>
          <form className="ht-settings__admin-search" onSubmit={submitSearch}>
            <Search size={ICON_SIZE.xs} aria-hidden="true" />
            <input
              className="ht-settings__admin-input"
              type="search"
              value={search}
              placeholder={t('web.admin.users.search')}
              aria-label={t('web.admin.users.search')}
              onChange={(event) => {
                onSearchChange(event.target.value);
              }}
            />
            <button type="submit" className="ht-settings__admin-btn">
              {t('web.admin.users.search')}
            </button>
          </form>

          {users !== null && (
            <>
              <p className="ht-settings__hint">
                {t('web.admin.users.total').replace('{total}', String(users.total))}
              </p>
              {users.items.length === 0 ? (
                <AdminEmpty titleKey="web.admin.users.noneFound" />
              ) : (
                <ul className="ht-settings__admin-list" data-testid="admin-users">
                  {users.items.map((user) => (
                    <li key={user.id}>
                      <button
                        type="button"
                        className="ht-settings__admin-row"
                        onClick={() => {
                          void store.openUser(user.id);
                        }}
                      >
                        <span className="ht-settings__admin-rowMain">{user.email}</span>
                        <span className="ht-settings__admin-badges">
                          {user.isAdmin && (
                            <span className="ht-settings__admin-badge ht-settings__admin-badge--admin">
                              {t('web.admin.badge.admin')}
                            </span>
                          )}
                          {user.locked && (
                            <span className="ht-settings__admin-badge ht-settings__admin-badge--danger">
                              {t('web.admin.badge.locked')}
                            </span>
                          )}
                          {!user.isVerified && (
                            <span className="ht-settings__admin-badge">
                              {t('web.admin.badge.unverified')}
                            </span>
                          )}
                        </span>
                        <span className="ht-settings__admin-rowMeta">{formatTime(user.createdAt)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Pager
                total={users.total}
                offset={users.offset}
                onPrev={() => {
                  void store.loadUsers({ offset: Math.max(0, users.offset - ADMIN_PAGE_SIZE) });
                }}
                onNext={() => {
                  void store.loadUsers({ offset: users.offset + ADMIN_PAGE_SIZE });
                }}
              />
            </>
          )}

          {detail !== null && (
            <div className="ht-settings__admin-detail" data-testid="admin-user-detail">
              <h4 className="ht-settings__admin-h4 ht-type-headline">{detail.user.email}</h4>
              <p className="ht-settings__hint">
                {t('web.admin.user.created')}: {formatTime(detail.user.createdAt)} ·{' '}
                {t('web.admin.user.storage')}: {formatBytes(detail.user.storageUsedBytes)} /{' '}
                {formatBytes(detail.user.storageQuotaBytes)} ·{' '}
                {t('web.admin.user.failedLogins')}: {detail.user.failedLoginAttempts}
              </p>
              <p className="ht-settings__hint">
                {t('web.admin.user.passkeys')}: {detail.counts.passkeys} ·{' '}
                {t('web.admin.user.operations')}: {detail.counts.operations} ·{' '}
                {t('web.admin.user.devices')}: {detail.devices.length}
              </p>
              {/* 🔴 并集读数：回答的是"他**此刻**实际能用什么"，不是"库里有哪些行"。
                  判定不住在界面 —— 服务端那一格（`admin.routes.ts::projectEntitlements`）
                  调的就是守卫那批函数，所以后台念的与线上拦的是同一次裁决。
                  这一格存在的理由正是运营自己数不出并集：两条行都合法、都 active，
                  挑错一条就把已付时长读没了（`evaluateCapabilityAcross` 头注释里那条事故）。
                  下面「订阅」那一节仍然保留逐行 —— 它答的是"哪一行的问题"，两格不互相替代。 */}
              <p className="ht-settings__hint" data-testid="admin-user-entitlements">
                {t('web.admin.user.entitlements')}
              </p>
              {detail.entitlements.map((item) => {
                const labelKey = capabilityLabelKey(item.capability);
                const reasonKey = entitlementReasonKey(item.reason);
                const sources = item.sources.map((source) => {
                  const providerKey = providerLabelKey(source.provider);
                  return t('web.admin.user.entitlementSource', {
                    provider: providerKey === null ? (source.provider ?? '—') : t(providerKey),
                    priceId: source.priceId ?? '—',
                    until: formatTime(source.currentPeriodEnd),
                  });
                });
                const tail = item.allowed
                  ? sources.length === 0
                    ? ` ${t('web.admin.user.entitlementNoRowSource')}`
                    : ` ${sources.join(' · ')}`
                  : reasonKey === null
                    ? ''
                    : ` ${t(reasonKey)}`;
                return (
                  <p
                    key={item.capability}
                    className="ht-settings__hint"
                    data-testid={`admin-user-entitlement-${item.capability}`}
                  >
                    {labelKey === null ? item.capability : t(labelKey)}
                    {' '}
                    {item.allowed ? '✓' : '✕'}
                    {tail}
                  </p>
                );
              })}
              {/* 同意留痕：对外文本已经承诺"记下当时那一套的版本指纹"，
                  所以后台必须能一眼答出"什么时候、哪一版"，并把"证明不了版本"
                  与"根本没同意"分成两种显示 —— 混在一起就是让运营者替数据库说谎。 */}
              <p className="ht-settings__hint" data-testid="admin-user-consent">
                {t('web.admin.user.consent')}:{' '}
                {detail.user.termsAcceptedAt === null
                  ? t('web.admin.user.consentNone')
                  : `${formatTime(detail.user.termsAcceptedAt)} · ${
                      detail.user.termsDocumentVersion ??
                      t('web.admin.user.consentNoVersion')
                    }`}
              </p>

              {store.actionNotice !== null && (
                <p
                  className={
                    store.actionNotice === 'done' ? 'ht-settings__notice' : 'ht-settings__danger'
                  }
                  data-testid="admin-action-notice"
                >
                  {t(
                    store.actionNotice === 'done'
                      ? 'web.admin.action.done'
                      : 'web.admin.action.failed',
                  )}
                </p>
              )}

              {/* 🔴 配额那一行是**一整行**，放在动作行**外面**。
                  上一版它被生成在 `.ht-settings__admin-actions`（一行 flex）里面 ——
                  于是 `FormField` 的网格控件列被压成一个窄格子，里面的「保存」
                  溢出到后面那枚「关闭」底下（Playwright 实测：
                  `关闭` intercepts pointer events，真人点也点不到保存）。 */}
        <FormField id="admin-quota-mib" label={t('web.admin.quota.label')}>
          {(fieldProps) => (
            <div className="ht-settings__admin-inline">
              <input
                {...fieldProps}
                className="ht-settings__admin-input"
                type="number"
                min={1}
                value={quotaMiB}
                onChange={(event) => {
                  onQuotaChange(event.target.value);
                }}
              />
              {/* 提交按钮**不在** `FormField` 里：它是这一行旁边的动作，不是字段的一部分。
                  上一版它嵌在 `<label>` 里 —— 点按钮也会把焦点送进输入框，
                  而且读屏会把按钮念成标签的一部分。 */}
              <button
                type="button"
                className="ht-settings__admin-btn"
                onClick={() => {
                  const mib = Number(quotaMiB);
                  if (!Number.isFinite(mib) || mib < 1) return;
                  void store.setUserQuota(detail.user.id, Math.round(mib * 1024 * 1024));
                }}
              >
                {t('web.admin.quota.submit')}
              </button>
            </div>
          )}
        </FormField>

              <div className="ht-settings__admin-actions">
                {/* 🔴 搬运入口放在**这一格**而不是搜索结果的那一行：运营刚看完"他此刻
                    能用 ✕"，下一个动作就是给他发一份 —— 中间不许有"把编号抄下来"这一步。
                    它只搬「是谁」：档位、天数、理由留给这一笔自己填（见 store 的 `grantTarget`）。 */}
                <button
                  type="button"
                  className="ht-settings__admin-btn"
                  data-testid="admin-grant-for-user"
                  onClick={() => {
                    store.openGrantForUser(detail.user.id);
                  }}
                >
                  {t('web.admin.users.grantFor')}
                </button>
                <button
                  type="button"
                  className="ht-settings__admin-btn"
                  onClick={() => {
                    void store.unlockUser(detail.user.id);
                  }}
                >
                  {t('web.admin.action.unlock')}
                </button>
                <button
                  type="button"
                  className="ht-settings__admin-btn ht-settings__admin-btn--danger"
                  onClick={() => {
                    void store.forceLogout(detail.user.id);
                  }}
                >
                  {t('web.admin.action.logout')}
                </button>
                <button
                  type="button"
                  className="ht-settings__admin-btn"
                  onClick={() => {
                    store.closeUser();
                  }}
                >
                  {t('web.admin.close')}
                </button>
              </div>

              <h5 className="ht-settings__admin-h5">{t('web.admin.user.subscriptions')}</h5>
              {detail.subscriptions.length === 0 ? (
                <p className="ht-settings__hint">{t('web.admin.user.none')}</p>
              ) : (
                <ul className="ht-settings__admin-list">
                  {detail.subscriptions.map((sub) => (
                    <li key={sub.id} className="ht-settings__admin-staticRow">
                      <span className="ht-settings__admin-rowMain">
                        {sub.priceId ?? '—'} · {sub.status ?? '—'}
                      </span>
                      <span className="ht-settings__admin-rowMeta">
                        {t('web.admin.table.expires')}: {formatTime(sub.currentPeriodEnd)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <h5 className="ht-settings__admin-h5">{t('web.admin.user.orders')}</h5>
              {detail.orders.length === 0 ? (
                <p className="ht-settings__hint">{t('web.admin.user.none')}</p>
              ) : (
                <ul className="ht-settings__admin-list">
                  {detail.orders.map((order) => (
                    <li key={order.id} className="ht-settings__admin-staticRow">
                      <span className="ht-settings__admin-rowMain">
                        {formatMoney(order.finalAmountMinor, order.currency)} · {order.status}
                      </span>
                      <span className="ht-settings__admin-rowMeta">{formatTime(order.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
    </>
  );
}
