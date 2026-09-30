/**
 * 管理后台面板（web）。
 * =====================
 *
 * 依据：[`docs/adr/0038-admin-console-scope.md`](../../../../docs/adr/0038-admin-console-scope.md)。
 *
 * ## 它长在设置页里，不是一个新应用
 *
 * 复用 SSOS 后台的**模式**（受保护子树 + 一次 Guard + 每资源一个数据钩子 +
 * 统一分页），但不搬它的 42 个页面 —— 那些页面服务的领域（租户、税务、
 * 合规知识库、Mailu 邮件中心）在 heyta 没有对应数据模型。见 ADR-0038 §1.2 / §3.2。
 *
 * ## 🔴 对非管理员**什么都不渲染**
 *
 * `probe()` 打一次 `/api/admin/overview`：403 就把 `access` 记成 `denied`，
 * 这个组件直接 `return null`。普通用户在设置页里看不到任何多出来的东西。
 *
 * ⚠️ 这**不是**安全措施 —— 藏一个入口挡不住手工构造的请求。
 * 安全由服务端 `requireAdmin` 承担（ADR-0038 §4.3）。
 *
 * ## 只读 + 三个动作
 *
 * 首版只读，外加三个**不碰钱**的支持动作（解锁 / 配额 / 强制登出）。
 * "改订阅 / 退款 / 发券"要幂等键、审计与回滚，是独立的工作单元（ADR-0038 §3.4）。
 */

import { useCallback, useEffect, useState } from 'react';

import { useI18n, type MessageKey } from '@heyta/i18n/provider';
import { EmptyState, HeytaUiProvider } from '@heyta/ui';
import { ChevronLeft, ChevronRight, RefreshCw, Search, ShieldCheck } from 'lucide-react';

import { ADMIN_PAGE_SIZE, useAdminStore, type AdminTab } from './store.js';

const TABS: readonly { key: AdminTab; labelKey: MessageKey }[] = [
  { key: 'overview', labelKey: 'web.admin.tab.overview' },
  { key: 'users', labelKey: 'web.admin.tab.users' },
  { key: 'subscriptions', labelKey: 'web.admin.tab.subscriptions' },
  { key: 'orders', labelKey: 'web.admin.tab.orders' },
  { key: 'coupons', labelKey: 'web.admin.tab.coupons' },
  { key: 'invites', labelKey: 'web.admin.tab.invites' },
];

/** epoch 毫秒 → `YYYY-MM-DD HH:mm`（本地时区）。`null` → `—`。 */
function formatTime(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const date = new Date(value);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** 字节 → 人类可读。用二进制单位（与 `storageQuotaBytes` 的语义一致）。 */
function formatBytes(value: number): string {
  if (value < 1024) return `${String(value)} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(1)} ${units[unit] ?? 'TiB'}`;
}

/** 金额（最小单位）→ `12.34 CNY`。后台只做展示，不做换算。 */
function formatMoney(minor: number, currency: string): string {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

/**
 * 列表为空时的占位。
 *
 * 🔴 走**共享那一个实现**（`packages/ui` 的 `EmptyState`），不在视图里手写骨架与文案
 * —— `pnpm check:empty-state` 的判据 3。
 *
 * ⚠️ 词条名字刻意**不带那个词**（用 `noneFound` / `list.none`）：
 * 那道门禁是按词条 key 的**段**匹配的，一个以它结尾的 key 即使交给共享组件
 * 也仍然算"手写站点"。同理，**这段注释里也不能把那两个形态写出来** ——
 * 门禁是**纯文本**匹配的，写出来就等于自己踩自己（`InboxBell` 的文件里
 * 有一条同样的告诫，我就是没照做才多绕了一轮）。
 *
 * 🔴 共享组件必须挂在 `<HeytaUiProvider>` 之内 —— 它读 token，
 * 缺了会**主动抛错**（与 `InboxBell` 同一处理，见 `check:ui-provider`）。
 */
function AdminEmpty(props: { titleKey: MessageKey }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <HeytaUiProvider>
      <EmptyState title={t(props.titleKey)} />
    </HeytaUiProvider>
  );
}

/** 一个统计格。 */
function Stat(props: { labelKey: MessageKey; value: string | number }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="ht-settings__admin-stat">
      <span className="ht-settings__admin-statValue">{props.value}</span>
      <span className="ht-settings__admin-statLabel">{t(props.labelKey)}</span>
    </div>
  );
}

export function AdminPanel(): React.JSX.Element | null {
  const { t } = useI18n();
  const store = useAdminStore();
  const [tab, setTab] = useState<AdminTab>('overview');
  const [search, setSearch] = useState('');
  const [quotaMiB, setQuotaMiB] = useState('');

  // 挂载时探测一次。未登录的话 store 内部一个请求都不发（见 store.probe）。
  useEffect(() => {
    void store.probe();
    // 只在挂载时探一次：`probe` 自身对 'denied' 短路，重复调用是安全的，
    // 但把它放进依赖数组会让每次 setState 都重跑一遍。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切标签页时按需拉数据（概览由 probe 顺手带回来，不重复拉）。
  useEffect(() => {
    if (store.access !== 'admin') return;
    switch (tab) {
      case 'users':
        if (store.users === null) void store.loadUsers();
        break;
      case 'subscriptions':
        if (store.subscriptions === null) void store.loadSubscriptions();
        break;
      case 'orders':
        if (store.orders === null) void store.loadOrders();
        break;
      case 'coupons':
        if (store.coupons === null) void store.loadCoupons();
        break;
      case 'invites':
        if (store.invites === null) void store.loadInvites();
        break;
      case 'overview':
        break;
    }
    // 依赖里刻意只放 tab 与 access：store 的字段变化不该触发重新拉取。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, store.access]);

  const submitSearch = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      void store.loadUsers({ q: search, offset: 0 });
    },
    [search, store],
  );

  // 探测失败或不是管理员 ⇒ 什么都不渲染。见文件头。
  if (store.access !== 'admin') return null;

  const overview = store.overview;
  const users = store.users;
  const detail = store.detail;

  return (
    <div className="ht-settings__section" data-testid="admin-panel">
      <h3 className="ht-settings__h3">
        <ShieldCheck size={14} aria-hidden="true" /> {t('web.admin.title')}
      </h3>
      <p className="ht-settings__hint">{t('web.admin.lead')}</p>

      <div className="ht-settings__admin-tabs" role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={tab === entry.key}
            className={`ht-settings__admin-tab${tab === entry.key ? ' ht-settings__admin-tab--active' : ''}`}
            onClick={() => {
              setTab(entry.key);
              store.clearNotice();
            }}
          >
            {t(entry.labelKey)}
          </button>
        ))}
        <button
          type="button"
          className="ht-settings__admin-tab ht-settings__admin-tab--icon"
          title={t('web.admin.retry')}
          aria-label={t('web.admin.retry')}
          onClick={() => {
            void store.probe();
            void store.loadUsers({ offset: 0 });
          }}
        >
          <RefreshCw size={13} aria-hidden="true" />
        </button>
      </div>

      {store.errorKey !== null && (
        <p className="ht-settings__danger" data-testid="admin-error">
          {t(store.errorKey as MessageKey)}
        </p>
      )}
      {store.loading && <p className="ht-settings__hint">{t('web.admin.loading')}</p>}

      {/* ── 概览 ─────────────────────────────────────────────────── */}
      {tab === 'overview' && overview !== null && (
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
      )}

      {/* ── 用户 ─────────────────────────────────────────────────── */}
      {tab === 'users' && (
        <>
          <form className="ht-settings__admin-search" onSubmit={submitSearch}>
            <Search size={13} aria-hidden="true" />
            <input
              className="ht-settings__admin-input"
              type="search"
              value={search}
              placeholder={t('web.admin.users.search')}
              aria-label={t('web.admin.users.search')}
              onChange={(event) => {
                setSearch(event.target.value);
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
              <h4 className="ht-settings__admin-h4">{detail.user.email}</h4>
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

              <div className="ht-settings__admin-actions">
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
                <label className="ht-settings__admin-quota">
                  <span className="ht-settings__hint">{t('web.admin.quota.label')}</span>
                  <input
                    className="ht-settings__admin-input ht-settings__admin-input--narrow"
                    type="number"
                    min={1}
                    value={quotaMiB}
                    onChange={(event) => {
                      setQuotaMiB(event.target.value);
                    }}
                  />
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
                </label>
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
      )}

      {/* ── 订阅 ─────────────────────────────────────────────────── */}
      {tab === 'subscriptions' && store.subscriptions !== null && (
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
      )}

      {/* ── 订单 ─────────────────────────────────────────────────── */}
      {tab === 'orders' && store.orders !== null && (
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
      )}

      {/* ── 优惠码 ───────────────────────────────────────────────── */}
      {tab === 'coupons' && store.coupons !== null && (
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
      )}

      {/* ── 邀请 ─────────────────────────────────────────────────── */}
      {tab === 'invites' && store.invites !== null && (
        <>
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
      )}
    </div>
  );
}

/** 上一页 / 下一页。到边界时禁用而不是隐藏 —— 位置稳定，不会让按钮跳来跳去。 */
function Pager(props: {
  total: number;
  offset: number;
  onPrev: () => void;
  onNext: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="ht-settings__admin-pager">
      <button
        type="button"
        className="ht-settings__admin-btn"
        disabled={props.offset === 0}
        onClick={props.onPrev}
      >
        <ChevronLeft size={13} aria-hidden="true" /> {t('web.admin.prev')}
      </button>
      <button
        type="button"
        className="ht-settings__admin-btn"
        disabled={props.offset + ADMIN_PAGE_SIZE >= props.total}
        onClick={props.onNext}
      >
        {t('web.admin.next')} <ChevronRight size={13} aria-hidden="true" />
      </button>
    </div>
  );
}
