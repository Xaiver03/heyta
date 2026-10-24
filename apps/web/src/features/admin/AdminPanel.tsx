import { ICON_SIZE } from '@heyta/design-system';
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
import { isHttpPaperUrl } from '@heyta/shared-schema';
import { EmptyState, HeytaUiProvider } from '@heyta/ui';
import { ChevronLeft, ChevronRight, RefreshCw, Search, ShieldCheck } from 'lucide-react';

import {
  ADMIN_HOLIDAY_NOTICE_KEY,
  ADMIN_PAGE_SIZE,
  ADMIN_REFUND_CODE_KEY,
  ADMIN_REFUND_NOTICE_KEY,
  EMPTY_ANNOUNCEMENT_FORM,
  useAdminStore,
  type AdminHolidayNotice,
  type AdminRefundNotice,
  type AdminStoreState,
  type AnnouncementFormInput,
  type HolidayYearInput,
  type RefundRequestInput,
} from './store.js';

import type { AdminAnnouncementRow } from '@heyta/app-host';

import { FormField } from '../../lib/form/FormField.js';

import { ADMIN_TABS } from './nav.js';

/** 录入表单的初值。全空 —— **不给默认年份**：默认值会让人提交自己没看过的数字。 */
const EMPTY_HOLIDAY_FORM: HolidayYearInput = {
  yearText: '',
  papersText: '',
  noteText: '',
  offDaysText: '',
  workDaysText: '',
};

/** 退款申请表单的初值。同上：**不预填订单号**，也不默认勾上"例外"。 */
const EMPTY_REFUND_FORM: RefundRequestInput = {
  orderIdText: '',
  noteText: '',
  operatorApproved: false,
};

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

/**
 * 后台的**内容区**，两种壳共用。
 *
 * - `chrome="settings"`（默认）：设置页里那一格，自带小标题与一排横向 tab。
 *   对非管理员**什么都不渲染**（见文件头）。
 * - `chrome="console"`：`/admin` 那个独立后台页里的内容区。标题、侧栏、
 *   「返回应用」都在 `AdminConsolePage`，这里只留表格与动作。
 *
 * 🔴 两种壳共用**同一份**内容：分区状态在 store（`activeTab`），导航清单在
 * `nav.ts`。分开写两份的表现不是"样式不一致"，是**其中一份会漏掉后来加的那一格**。
 */
export function AdminPanel({
  active = true,
  chrome = 'settings',
}: {
  active?: boolean;
  chrome?: 'settings' | 'console';
}): React.JSX.Element | null {
  const { t } = useI18n();
  const store = useAdminStore();
  const tab = store.activeTab;
  const [search, setSearch] = useState('');
  const [quotaMiB, setQuotaMiB] = useState('');

  // 挂载时探测一次。未登录的话 store 内部一个请求都不发（见 store.probe）。
  useEffect(() => {
    if (!active) return;
    void store.probe();
    // 只在挂载时探一次：`probe` 自身对 'denied' 短路，重复调用是安全的，
    // 但把它放进依赖数组会让每次 setState 都重跑一遍。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // 切标签页时按需拉数据（概览由 probe 顺手带回来，不重复拉）。
  useEffect(() => {
    if (!active || store.access !== 'admin') return;
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
      case 'revenue':
        // 聚合窗口不分页（一次把整段日界发回来），所以这一格没有 Pager ——
        // 与调休/退款那两格同一理由：造一个翻页按钮会点出一个假动作。
        if (store.revenue === null) void store.loadRevenue();
        break;
      case 'announcements':
        // 全量、不分页（一次最多 100 条，运营要看的就是现状）。
        if (store.announcements === null) void store.loadAnnouncements();
        break;
      case 'holidays':
        // 服务端那三条端点里只有列表是 GET，年度**不分页**（一年一次录入，
        // 区间 2007–2100 ⇒ 最多九十几行），所以没有 Pager。
        if (store.holidayYears === null) void store.loadHolidayYears();
        break;
      case 'refunds':
        // 同理没有 Pager：`GET /api/admin/refunds` 只有 `limit`，**没有 `offset`**。
        // 这里造一个"下一页"按钮会点出第二个请求，而它拿回来的还是同一批最新行 ——
        // 一个看起来在工作、实际上永远停在第一页的控件比没有控件更坏。
        if (store.refunds === null) void store.loadRefunds();
        break;
      case 'overview':
        break;
    }
    // 依赖里刻意只放 tab 与 access：store 的字段变化不该触发重新拉取。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, tab, store.access]);

  const submitSearch = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (!active) return;
      void store.loadUsers({ q: search, offset: 0 });
    },
    [active, search, store],
  );

  // 探测失败或不是管理员 ⇒ 什么都不渲染。见文件头。
  if (store.access !== 'admin') return null;

  const overview = store.overview;
  const users = store.users;
  const detail = store.detail;
  // 独立后台页的标题与导航在 `AdminConsolePage` 那一侧，这里只留内容。
  const bareChrome = chrome === 'console';

  return (
    <div
      className={bareChrome ? 'ht-settings__console-body' : 'ht-settings__section'}
      data-testid="admin-panel"
    >
      {!bareChrome && (
        <>
          <h3 className="ht-settings__h3 ht-type-headline">
            <ShieldCheck size={ICON_SIZE.xs} aria-hidden="true" /> {t('web.admin.title')}
          </h3>
          <p className="ht-settings__hint">{t('web.admin.lead')}</p>

          <div className="ht-settings__admin-tabs" role="tablist">
            {ADMIN_TABS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="tab"
                aria-selected={tab === entry.key}
                className={`ht-settings__admin-tab${tab === entry.key ? ' ht-settings__admin-tab--active' : ''}`}
                onClick={() => store.setActiveTab(entry.key)}
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
                if (!active) return;
                void store.probe();
                void store.loadUsers({ offset: 0 });
              }}
            >
              <RefreshCw size={ICON_SIZE.xs} aria-hidden="true" />
            </button>
          </div>
        </>
      )}

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
            <Search size={ICON_SIZE.xs} aria-hidden="true" />
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
                  setQuotaMiB(event.target.value);
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
      )}

      {/* ── 营收看板（只读聚合）────────────────────────────────── */}
      {tab === 'revenue' && <RevenuePanel store={store} />}

      {/* ── 运营公告（ADR-0075 的内容通道写面）────────────────── */}
      {tab === 'announcements' && <AnnouncementPanel store={store} />}

      {/* ── 调休 / 补班（公共事实的唯一录入面）──────────────────── */}
      {tab === 'holidays' && <HolidayPanel store={store} />}

      {/* ── 退款（申请 / 批准 / 驳回）────────────────────────────── */}
      {tab === 'refunds' && <RefundPanel store={store} />}
    </div>
  );
}

/**
 * 「退款」面板 —— ADR-0053 §5 第 10 条点名的那五件事里的**面板**那一件
 * （传输在 `packages/app-host/src/admin-client.ts`，状态在 `./store.ts`）。
 * ============================================================================
 *
 * 🔴 **一片判定都不在这里。** 能不能退、退多少、这一跳状态机走不走得通，
 * 全部住在服务端（`refund-policy.ts` + `refund-store.ts`，三条 CHECK 在迁移里）。
 * 这里只收集输入、发请求、把结果读回来显示。多判一次就是 `AGENTS §3.5`
 * 那条"同一个判断抄两遍"，而两遍的标准迟早分叉。
 *
 * 🔴 **"批准"是两步**，"驳回"是一步。区别只有一件事：**批准会把钱发给通道**。
 * 一次点击就动钱、而点下去之后**收不回来**（通道那侧没有"撤销退款请求"这种东西，
 * 只能再退一笔钱回去 —— 那是第二笔账），所以它必须有一次明确的再确认。
 * 驳回则相反：它是这条流程里唯一"什么都不发生"的出口，一步就够。
 *
 * ⚠️ 界面**没有**"已退款"这个结论：`success` 只由签名有效的微信回调认领（ADR-0053 §4）。
 * 批准之后列表里那一行显示的是服务端给的状态原文（`approved` / `processing` / `failed`），
 * 而不是"退款完成"。
 */
function RefundPanel(props: { store: AdminStoreState }): React.JSX.Element {
  const { t } = useI18n();
  const refunds = props.store.refunds;
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState<RefundRequestInput>(EMPTY_REFUND_FORM);
  /** 每一行的理由（`id → 文本`）。那是**输入**，不是状态，所以不进 store。 */
  const [notes, setNotes] = useState<Record<number, string>>({});
  /** 待确认的那一条退款 id（两步式"批准"）。 */
  const [pendingApproveId, setPendingApproveId] = useState<number | null>(null);

  const notice = props.store.refundNotice;
  const code = props.store.refundCode;
  const echo = props.store.refundEcho;

  // 有专属措辞的码用专属措辞；没有的落回通用那一句，而通用那一句会**把原码打出来** ——
  // 降级成"看得见码"，不降级成"编一个原因"。
  const noticeKey =
    notice === null
      ? null
      : notice === 'denied' && code !== null && ADMIN_REFUND_CODE_KEY[code] !== undefined
        ? ADMIN_REFUND_CODE_KEY[code]
        : ADMIN_REFUND_NOTICE_KEY[notice];

  const failed = notice === 'denied' || notice === 'conflict' || notice === 'unknown';

  return (
    <>
      <p className="ht-settings__hint">{t('web.admin.refund.lead')}</p>

      {notice !== null && noticeKey !== null && (
        <p
          className={failed ? 'ht-settings__danger' : 'ht-settings__notice'}
          data-testid="admin-refund-notice"
        >
          {t(noticeKey as MessageKey)
            .replace('{id}', String(echo?.id ?? '—'))
            .replace('{order}', String(echo?.orderId ?? '—'))
            .replace('{status}', echo?.detail ?? '—')
            .replace('{code}', code ?? '—')}
        </p>
      )}

      {/* ── 列表 ─────────────────────────────────────────────────── */}
      <h5 className="ht-settings__admin-h5">{t('web.admin.refund.list')}</h5>
      <form
        className="ht-settings__admin-search"
        onSubmit={(event) => {
          event.preventDefault();
          props.store.clearRefundNotice();
          setPendingApproveId(null);
          void props.store.loadRefunds({ userId: filter });
        }}
      >
        <Search size={ICON_SIZE.xs} aria-hidden="true" />
        <input
          className="ht-settings__admin-input ht-settings__admin-input--filter"
          type="search"
          inputMode="numeric"
          data-testid="admin-refund-filter"
          value={filter}
          placeholder={t('web.admin.refund.filter')}
          aria-label={t('web.admin.refund.filter')}
          onChange={(event) => {
            setFilter(event.target.value);
          }}
        />
        <button type="submit" className="ht-settings__admin-btn">
          {t('web.admin.refund.filter.submit')}
        </button>
      </form>

      {refunds === null ? (
        <p className="ht-settings__hint">{t('web.admin.loading')}</p>
      ) : (
        <>
          {refunds.length === 0 ? (
            <AdminEmpty titleKey="web.admin.refund.list.none" />
          ) : (
            <ul className="ht-settings__admin-list" data-testid="admin-refunds">
              {refunds.map((refund) => (
                <li key={refund.id} className="ht-settings__admin-staticRow ht-settings__admin-staticRow--stack">
                  <span className="ht-settings__admin-rowMain">
                    {`#${String(refund.id)}`} ·{' '}
                    {t('web.admin.refund.order').replace('{order}', String(refund.orderId))} ·{' '}
                    {t('web.admin.refund.user').replace('{user}', String(refund.userId))} ·{' '}
                    {refund.outRefundNo}
                  </span>
                  <span className="ht-settings__admin-rowMeta">
                    {formatMoney(refund.amountMinor, refund.currency)} ·{' '}
                    {t('web.admin.refund.period').replace('{days}', String(refund.periodDays))} ·{' '}
                    {refund.provider} · <code>{refund.status}</code>
                  </span>

                  {/* 🔴 只有 `requested` 给按钮：状态机只认这一档，其余档点下去必然 409。
                      这不是安全措施（服务端才是裁决者），是**不制造一次注定失败的点击**。 */}
                  {refund.status === 'requested' && (
                    <div className="ht-settings__admin-actions">
                      <input
                        className="ht-settings__admin-input"
                        data-testid={`admin-refund-note-${String(refund.id)}`}
                        value={notes[refund.id] ?? ''}
                        placeholder={t('web.admin.refund.note')}
                        aria-label={t('web.admin.refund.note')}
                        onChange={(event) => {
                          setNotes((previous) => ({ ...previous, [refund.id]: event.target.value }));
                        }}
                      />
                      <button
                        type="button"
                        className="ht-settings__admin-btn"
                        data-testid={`admin-refund-approve-${String(refund.id)}`}
                        onClick={() => {
                          props.store.clearRefundNotice();
                          setPendingApproveId(refund.id);
                        }}
                      >
                        {t('web.admin.refund.approve')}
                      </button>
                      <button
                        type="button"
                        className="ht-settings__admin-btn ht-settings__admin-btn--danger"
                        data-testid={`admin-refund-reject-${String(refund.id)}`}
                        onClick={() => {
                          setPendingApproveId(null);
                          void props.store.rejectRefund(refund.id, notes[refund.id] ?? '');
                        }}
                      >
                        {t('web.admin.refund.reject')}
                      </button>
                      {pendingApproveId === refund.id && (
                        <span className="ht-settings__danger" data-testid="admin-refund-approve-confirm">
                          {t('web.admin.refund.approve.confirm')}
                          <button
                            type="button"
                            className="ht-settings__admin-btn ht-settings__admin-btn--danger"
                            data-testid={`admin-refund-approve-yes-${String(refund.id)}`}
                            onClick={() => {
                              setPendingApproveId(null);
                              void props.store.approveRefund(refund.id, notes[refund.id] ?? '');
                            }}
                          >
                            {t('web.admin.refund.approve.yes')}
                          </button>
                          <button
                            type="button"
                            className="ht-settings__admin-btn"
                            onClick={() => {
                              setPendingApproveId(null);
                            }}
                          >
                            {t('web.admin.close')}
                          </button>
                        </span>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* ── 开一张新申请 ─────────────────────────────────────────── */}
      <h5 className="ht-settings__admin-h5">{t('web.admin.refund.form.title')}</h5>
      <p className="ht-settings__hint">{t('web.admin.refund.form.lead')}</p>
      <form
        className="ht-settings__admin-detail"
        onSubmit={(event) => {
          event.preventDefault();
          setPendingApproveId(null);
          void props.store.requestRefund(form).then((accepted) => {
            // 只有服务端**收了**才清输入（与调休表单同一处理）：被 409 拒了还清空，
            // 运营就不知道自己刚才填的是哪一单了。
            if (accepted) setForm(EMPTY_REFUND_FORM);
          });
        }}
      >
                <FormField id="admin-refund-order-input" label={t('web.admin.refund.form.orderId')}>
          {(fieldProps) => (
  <input
    {...fieldProps}
              className="ht-settings__admin-input"
              type="number"
              inputMode="numeric"
              data-testid="admin-refund-order-input"
              value={form.orderIdText}
              onChange={(event) => {
                setForm((previous) => ({ ...previous, orderIdText: event.target.value }));
              }}
            />
          )}
        </FormField>
                <FormField id="admin-refund-request-note" label={t('web.admin.refund.form.note')}>
          {(fieldProps) => (
  <textarea
    {...fieldProps}
              className="ht-settings__admin-input"
              rows={2}
              data-testid="admin-refund-request-note"
              value={form.noteText}
              onChange={(event) => {
                setForm((previous) => ({ ...previous, noteText: event.target.value }));
              }}
            />
          )}
        </FormField>
        <label className="ht-settings__admin-quota">
          <span className="ht-settings__hint">{t('web.admin.refund.form.exception')}</span>
          <input
            type="checkbox"
            data-testid="admin-refund-exception"
            checked={form.operatorApproved}
            onChange={(event) => {
              setForm((previous) => ({ ...previous, operatorApproved: event.target.checked }));
            }}
          />
        </label>
        <div className="ht-settings__admin-actions">
          <button type="submit" className="ht-settings__admin-btn" data-testid="admin-refund-request">
            {t('web.admin.refund.form.submit')}
          </button>
        </div>
      </form>
    </>
  );
}

/**
 * 「调休 / 补班」面板。W4b 的最后一层（服务端与契约早已就绪，缺的就是这一块）。
 * ============================================================================
 *
 * 🔴 **这一块不做任何合法性判断。** 日期存不存在、`isOffDay` 是不是布尔、
 * 同一天有没有出现两次、年份在不在 2007–2100 —— 全部由
 * `packages/shared-schema` 的 `holidayYearPutSchema` 在服务端裁决
 * （那是**唯一一份**规则，见该文件头"为什么形状被钉成 days[] 这一种"）。
 * 这里多判一次就是 §3.5 那条"同一个判断抄两遍"，而两遍的标准迟早会分叉：
 * 表现是"界面放行了、服务端 400"或反过来，两种都让人以为对方坏了。
 *
 * 所以本组件只有三件事：
 *   1. **回显**已录入的年度**连同 papers**（判据② —— 出处链接是这件事的举证入口，
 *      看不见链接的后台等于让运营替数据背书）；
 *   2. 收集一整年的输入并**一次 PUT**（一个用户意图 = 一次请求；
 *      "整年替换"与"要么全收要么全不收"都在服务端那一层保证）；
 *   3. 撤销某一年 —— 语义是**退回随包表**，不是"清空那一年"，
 *      措辞必须说清，否则运营会以为撤销之后日历上什么都不标。
 *
 * ⚠️ 表单是**受控组件**，字段留在本地 state：每次键入都进 store 会让
 * 整块后台随字符重渲染，而 store 是各标签页共用的。
 */
function HolidayPanel(props: { store: AdminStoreState }): React.JSX.Element {
  const { t } = useI18n();
  const years = props.store.holidayYears;
  const [form, setForm] = useState<HolidayYearInput>(EMPTY_HOLIDAY_FORM);
  /** 两步式撤销：`null` = 没有待确认的年份。见下面 `revoke` 那段注释。 */
  const [pendingRevokeYear, setPendingRevokeYear] = useState<number | null>(null);

  const field = (key: keyof HolidayYearInput) => (event: { target: { value: string } }): void => {
    setForm((previous) => ({ ...previous, [key]: event.target.value }));
  };

  const notice = props.store.holidayNotice;
  const echo = props.store.holidayEcho;

  return (
    // 🔴 返回**片段**而不是再套一层 `ht-settings__section`：外层那一节已经是
    // 一个带边框与内边距的盒子，套第二层会画成"框里有框"（其余标签页同样是片段）。
    <>
      <p className="ht-settings__hint">{t('web.admin.holiday.lead')}</p>

      {notice !== null && (
        <p
          className={notice === 'failed' ? 'ht-settings__danger' : 'ht-settings__notice'}
          data-testid="admin-holiday-notice"
        >
          {t(ADMIN_HOLIDAY_NOTICE_KEY[notice] as MessageKey)
            .replace('{year}', String(echo?.year ?? '—'))
            .replace('{count}', String(echo?.dayCount ?? '—'))}
        </p>
      )}

      {/* ── 已录入的年度（判据②：papers 必须**回显成可点的链接**）───── */}
      <h5 className="ht-settings__admin-h5">{t('web.admin.holiday.list')}</h5>
      {years === null ? (
        <p className="ht-settings__hint">{t('web.admin.loading')}</p>
      ) : (
        <>
          <p className="ht-settings__hint">
            {t('web.admin.holiday.version').replace('{version}', years.version)}
          </p>
          {years.years.length === 0 ? (
            <AdminEmpty titleKey="web.admin.holiday.list.none" />
          ) : (
            <ul className="ht-settings__admin-list" data-testid="admin-holiday-years">
              {years.years.map((year) => (
                <li key={year.year} className="ht-settings__admin-staticRow">
                  <span className="ht-settings__admin-rowMain ht-settings__admin-rowMain--wrap">
                    {year.year} ·{' '}
                    {t('web.admin.holiday.dayCount').replace('{count}', String(year.dayCount))}
                    {year.note === null ? '' : ` · ${year.note}`}
                  </span>
                  <span className="ht-settings__admin-rowMeta">
                    {formatTime(year.updatedAt)} · {year.updatedBy ?? '—'}
                  </span>
                  {/* 🔴 出处链接**必须渲染出来**。契约把 papers 限定成 http/https
                      的唯一理由就是这里要把它做成 `<a href>`（见
                      `isHttpPaperUrl` 的注释：`z.string().url()` 放行 `javascript:`）。
                      所以这三条同时是判据与防线：链接本身、它的文字、以及
                      `rel` 防止被打开的站点反向拿到后台这一页的 window。 */}
                  <span
                    className="ht-settings__admin-badges ht-settings__admin-badges--papers"
                    data-testid="admin-holiday-papers"
                  >
                    {year.papers.map((paper) =>
                      /*
                       * 🔴 渲染层这一道是**第二道**，不是装饰。
                       * 迁移 SQL 的「手工补充 2/3」写的就是"http/https 由契约层 + 渲染层两处钉"，
                       * 而只钉契约层的说法不成立：绕过 PUT 进来的行（运维直接跑 SQL、
                       * 将来的导入通道、库里已存在的旧值）都不会再过 zod，于是后台的
                       * `href` 里就是一条 `javascript:`。同一串还经公开 GET 原样下发，
                       * 所以这里按**取到值的样子**判，不按"入库时应当合法"判。
                       */
                      isHttpPaperUrl(paper) ? (
                        <a
                          key={paper}
                          className="ht-settings__admin-badge"
                          href={paper}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          {paper}
                        </a>
                      ) : (
                        <span key={paper} className="ht-settings__admin-badge" data-testid="admin-holiday-paper-rejected">
                          {paper}
                        </span>
                      ),
                    )}
                  </span>
                  <div className="ht-settings__admin-actions">
                    <button
                      type="button"
                      className="ht-settings__admin-btn ht-settings__admin-btn--danger"
                      data-testid="admin-holiday-revoke"
                      onClick={() => {
                        props.store.clearHolidayNotice();
                        setPendingRevokeYear(year.year);
                      }}
                    >
                      {t('web.admin.holiday.revoke')}
                    </button>
                    {pendingRevokeYear === year.year && (
                      // 🔴 撤销是**两步**：服务端语义是"删掉这一年的覆盖行 ⇒ 客户端
                      // 退回随包表"，不是"那一年没有任何安排"。一次点击就删掉一整年、
                      // 而且措辞写成"清空"，会让运营在错误的理解上做出正确的点击。
                      <span
                        className="ht-settings__danger"
                        data-testid="admin-holiday-revoke-confirm"
                      >
                        {t('web.admin.holiday.revoke.confirm')}
                        <button
                          type="button"
                          className="ht-settings__admin-btn ht-settings__admin-btn--danger"
                          data-testid="admin-holiday-revoke-yes"
                          onClick={() => {
                            setPendingRevokeYear(null);
                            void props.store.deleteHolidayYear(year.year);
                          }}
                        >
                          {t('web.admin.holiday.revoke.yes')}
                        </button>
                        <button
                          type="button"
                          className="ht-settings__admin-btn"
                          data-testid="admin-holiday-revoke-cancel"
                          onClick={() => {
                            setPendingRevokeYear(null);
                          }}
                        >
                          {t('web.admin.close')}
                        </button>
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* ── 录入一整年 ───────────────────────────────────────────── */}
      <h5 className="ht-settings__admin-h5">{t('web.admin.holiday.form.title')}</h5>
      <p className="ht-settings__hint">{t('web.admin.holiday.form.lead')}</p>
      <form
        className="ht-settings__admin-detail"
        onSubmit={(event) => {
          event.preventDefault();
          setPendingRevokeYear(null);
          void props.store.saveHolidayYear(form).then((saved) => {
            // 只有服务端**收了**才清输入：失败了还清空，等于把运营刚敲的一整年
            // 逐日表丢掉，而他要从头再打一遍。
            if (saved) setForm(EMPTY_HOLIDAY_FORM);
          });
        }}
      >
                <FormField id="admin-holiday-year-input" label={t('web.admin.holiday.form.year')}>
          {(fieldProps) => (
  <input
    {...fieldProps}
              className="ht-settings__admin-input"
              type="number"
              inputMode="numeric"
              data-testid="admin-holiday-year-input"
              value={form.yearText}
              onChange={field('yearText')}
            />
          )}
        </FormField>
                <FormField id="admin-holiday-papers-input" label={t('web.admin.holiday.form.papers')}>
          {(fieldProps) => (
  <textarea
    {...fieldProps}
              className="ht-settings__admin-input"
              rows={2}
              data-testid="admin-holiday-papers-input"
              value={form.papersText}
              onChange={field('papersText')}
            />
          )}
        </FormField>
                <FormField id="admin-holiday-off-input" label={t('web.admin.holiday.form.offDays')}>
          {(fieldProps) => (
  <textarea
    {...fieldProps}
              className="ht-settings__admin-input"
              rows={4}
              data-testid="admin-holiday-off-input"
              value={form.offDaysText}
              onChange={field('offDaysText')}
            />
          )}
        </FormField>
                <FormField id="admin-holiday-work-input" label={t('web.admin.holiday.form.workDays')}>
          {(fieldProps) => (
  <textarea
    {...fieldProps}
              className="ht-settings__admin-input"
              rows={4}
              data-testid="admin-holiday-work-input"
              value={form.workDaysText}
              onChange={field('workDaysText')}
            />
          )}
        </FormField>
                <FormField id="admin-holiday-note-input" label={t('web.admin.holiday.form.note')}>
          {(fieldProps) => (
  <input
    {...fieldProps}
              className="ht-settings__admin-input"
              data-testid="admin-holiday-note-input"
              value={form.noteText}
              onChange={field('noteText')}
            />
          )}
        </FormField>
        <div className="ht-settings__admin-actions">
          <button type="submit" className="ht-settings__admin-btn" data-testid="admin-holiday-save">
            {t('web.admin.holiday.save')}
          </button>
        </div>
      </form>
    </>
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
        <ChevronLeft size={ICON_SIZE.xs} aria-hidden="true" /> {t('web.admin.prev')}
      </button>
      <button
        type="button"
        className="ht-settings__admin-btn"
        disabled={props.offset + ADMIN_PAGE_SIZE >= props.total}
        onClick={props.onNext}
      >
        {t('web.admin.next')} <ChevronRight size={ICON_SIZE.xs} aria-hidden="true" />
      </button>
    </div>
  );
}

/** `formatTime` 的前十个字符 = 本地日 `YYYY-MM-DD`。 */
function formatDay(ms: number): string {
  return formatTime(ms).slice(0, 10);
}

/** 分钟偏移 → `UTC+8` / `UTC-5` / `UTC+0`。界面要说的是"哪一天算一天"，不是符号学。 */
function utcOffsetLabel(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  return `UTC${sign}${String(Math.abs(offsetMinutes) / 60)}`;
}

/** 可选的聚合窗口。三档是刻意的窄集：再多一档就没人点了。 */
const REVENUE_WINDOWS: readonly number[] = [30, 90, 365];

/** 明细表最多列这么多天（有活动的那些）。 */
const REVENUE_DETAIL_ROWS = 14;

/**
 * 营收看板。
 *
 * 🔴 这里**一个数都不算**。逐日分桶、日界按哪个时区裁、净收入怎么折、
 * 币种能不能相加 —— 全部来自 `/api/admin/revenue` 的响应体
 * （`server/src/admin/admin.routes.ts`）。本组件只做两件事：把服务端给的
 * 数字画出来，以及把"窗口"这个参数发回去。
 *
 * ⚠️ **没有跨币种合计**，因为那不是一个合法的数（混币求和是"错得很像真的"
 * 那一类）。界面因此按币种各一段，而不是给一个大总数。
 */
function RevenuePanel({ store }: { store: AdminStoreState }): React.JSX.Element {
  const { t } = useI18n();
  const revenue = store.revenue;

  // `null` 是"还没问"，不是"没有营收" —— 这一格只可能出现在切过来的那一瞬。
  if (revenue === null) return <p className="ht-settings__hint">{t('web.admin.loading')}</p>;

  if (revenue.series.length === 0) {
    return <AdminEmpty titleKey="web.admin.revenue.noneFound" />;
  }

  return (
    <div data-testid="admin-revenue">
      <div className="ht-settings__admin-tabs" role="group" aria-label={t('web.admin.revenue.window')}>
        {REVENUE_WINDOWS.map((days) => (
          <button
            key={days}
            type="button"
            className={`ht-settings__admin-tab${store.revenueDays === days ? ' ht-settings__admin-tab--active' : ''}`}
            aria-pressed={store.revenueDays === days}
            onClick={() => void store.loadRevenue(days)}
          >
            {t('web.admin.revenue.days', { count: days })}
          </button>
        ))}
      </div>

      {/* 日界是按这台设备的时区裁的 —— 这句话必须写在图上，
          否则读图的人会默认它是服务器那个时区，而两者差几个小时。 */}
      <p className="ht-settings__hint">
        {t('web.admin.revenue.tzNote', { offset: utcOffsetLabel(revenue.window.offsetMinutes) })}
      </p>

      {revenue.series.map((series) => {
        const peak = Math.max(
          1,
          ...series.points.map((point) => Math.max(point.paidMinor, point.refundedMinor)),
        );
        const activeDays = series.points
          .filter((point) => point.paidMinor > 0 || point.refundedMinor > 0)
          .slice(-REVENUE_DETAIL_ROWS)
          .reverse();
        const barHeight = (value: number): number => (value / peak) * 100;

        return (
          <section
            key={series.currency}
            className="ht-settings__admin-revenueGroup"
            data-testid={`admin-revenue-${series.currency}`}
          >
            <h4 className="ht-settings__admin-h">{series.currency}</h4>

            <div className="ht-settings__admin-stats">
              <Stat
                labelKey="web.admin.revenue.paid"
                value={formatMoney(series.totalPaidMinor, series.currency)}
              />
              <Stat
                labelKey="web.admin.revenue.refunded"
                value={formatMoney(series.totalRefundedMinor, series.currency)}
              />
              <Stat
                labelKey="web.admin.revenue.net"
                value={formatMoney(series.totalNetMinor, series.currency)}
              />
              <Stat labelKey="web.admin.revenue.paidOrders" value={series.totalPaidOrders} />
              <Stat
                labelKey="web.admin.revenue.refundedOrders"
                value={series.totalRefundedOrders}
              />
            </div>

            <svg
              className="ht-settings__admin-revenueChart"
              viewBox={`0 0 ${String(series.points.length)} 100`}
              preserveAspectRatio="none"
              role="img"
              aria-label={t('web.admin.revenue.chartLabel', {
                currency: series.currency,
                days: String(revenue.window.days),
              })}
            >
              {series.points.map((point, index) => (
                // 一根柱子两窄条：左进账、右退款。不叠在一起 —— 叠加会把
                // "退了 30%"读成"收了 130%"，而这两件事的差才是净收入。
                <g key={point.dayMs}>
                  <rect
                    className="ht-settings__admin-revenueBarPaid"
                    x={index + 0.12}
                    y={100 - barHeight(point.paidMinor)}
                    width={0.36}
                    height={barHeight(point.paidMinor)}
                  >
                    <title>
                      {t('web.admin.revenue.day', {
                        day: formatDay(point.dayMs),
                        paid: formatMoney(point.paidMinor, series.currency),
                        refunded: formatMoney(point.refundedMinor, series.currency),
                      })}
                    </title>
                  </rect>
                  <rect
                    className="ht-settings__admin-revenueBarRefunded"
                    x={index + 0.52}
                    y={100 - barHeight(point.refundedMinor)}
                    width={0.36}
                    height={barHeight(point.refundedMinor)}
                  />
                </g>
              ))}
            </svg>

            {activeDays.length === 0 ? (
              <p className="ht-settings__hint">{t('web.admin.revenue.noneFound')}</p>
            ) : (
              <div className="ht-settings__admin-list" data-testid={`admin-revenue-rows-${series.currency}`}>
                {activeDays.map((point) => (
                  <div key={point.dayMs} className="ht-settings__admin-row">
                    <span className="ht-settings__admin-rowMain">{formatDay(point.dayMs)}</span>
                    <span className="ht-settings__admin-static">
                      {t('web.admin.revenue.rowPaid', {
                        paid: formatMoney(point.paidMinor, series.currency),
                        orders: String(point.paidOrders),
                      })}
                    </span>
                    <span className="ht-settings__admin-static">
                      {t('web.admin.revenue.rowRefunded', {
                        refunded: formatMoney(point.refundedMinor, series.currency),
                        orders: String(point.refundedOrders),
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** 公告那一格的状态词 → 词条 key。**穷举**，漏一个编译期就红。 */
const ANNOUNCEMENT_STATE_KEY: Record<AdminAnnouncementRow['state'], MessageKey> = {
  pending: 'web.admin.announcements.state.pending',
  active: 'web.admin.announcements.state.active',
  expired: 'web.admin.announcements.state.expired',
};

/**
 * 运营公告的写面（ADR-0075）。
 *
 * 🔴 这一片界面**不判**任何一件事该不该发：长度、`level` 词表、
 * "失效要晚于生效"全部由服务端那一次 `safeParse` 裁决。
 * 表单里那两个时刻控件给的是**运营者墙上时钟**，换算成 epoch 毫秒发生在 store
 * （那是设备本地事实，只有这台机器知道）。
 *
 * 🔴 第一句必须是"这是明文"。ADR-0075 §5.1 写的正是：这条通道对**所有用户**
 * 可见且不走端到端加密，而"别把口令写进去"这条约束如果只躺在一份没人读的
 * 决策记录里，它就等于不存在。
 */
function AnnouncementPanel({
  store,
}: {
  store: AdminStoreState;
}): React.JSX.Element {
  const { t } = useI18n();
  const [form, setForm] = useState<AnnouncementFormInput>(EMPTY_ANNOUNCEMENT_FORM);
  // 下架是**两步**：第一次点只出确认、一个请求都不发（与退款批准同一模式）。
  const [pendingWithdrawId, setPendingWithdrawId] = useState<number | null>(null);

  const rows = store.announcements;

  return (
    <div data-testid="admin-announcements">
      <p className="ht-settings__admin-notice" data-testid="admin-announcements-plaintext">
        {t('web.admin.announcements.plaintextWarning')}
      </p>

      <form
        className="ht-settings__admin-detail"
        onSubmit={(event) => {
          event.preventDefault();
          void (async () => {
            const ok = await store.publishAnnouncement(form);
            if (ok) setForm(EMPTY_ANNOUNCEMENT_FORM);
          })();
        }}
      >
        <h4 className="ht-settings__admin-h">{t('web.admin.announcements.compose')}</h4>
        <input
          className="ht-settings__admin-input"
          value={form.titleText}
          placeholder={t('web.admin.announcements.title')}
          aria-label={t('web.admin.announcements.title')}
          onChange={(event) => setForm({ ...form, titleText: event.target.value })}
        />
        <textarea
          className="ht-settings__admin-input"
          rows={3}
          value={form.bodyText}
          placeholder={t('web.admin.announcements.body')}
          aria-label={t('web.admin.announcements.body')}
          onChange={(event) => setForm({ ...form, bodyText: event.target.value })}
        />
        <div className="ht-settings__admin-badges">
          {(['info', 'warning'] as const).map((level) => (
            <label key={level} className="ht-settings__admin-quota">
              <input
                type="radio"
                name="announcement-level"
                checked={form.level === level}
                onChange={() => setForm({ ...form, level })}
              />
              {t(level === 'info' ? 'web.admin.announcements.levelInfo' : 'web.admin.announcements.levelWarning')}
            </label>
          ))}
        </div>
        <div className="ht-settings__admin-badges">
          <FormField id="admin-publishes-at" label={t('web.admin.announcements.publishesAt')}>
            {(fieldProps) => (
              /* `datetime-local` 给的是**本地墙上时钟**，换算发生在 store。 */
              <input
                {...fieldProps}
                className="ht-settings__admin-input"
                type="datetime-local"
                value={form.publishesAtText}
                onChange={(event) => setForm({ ...form, publishesAtText: event.target.value })}
              />
            )}
          </FormField>
          <FormField id="admin-expires-at" label={t('web.admin.announcements.expiresAt')}>
            {(fieldProps) => (
              <input
                {...fieldProps}
                className="ht-settings__admin-input"
                type="datetime-local"
                value={form.expiresAtText}
                onChange={(event) => setForm({ ...form, expiresAtText: event.target.value })}
              />
            )}
          </FormField>
        </div>
        <div className="ht-settings__admin-actions">
          <button type="submit" className="ht-settings__admin-btn">
            {t('web.admin.announcements.publish')}
          </button>
        </div>
        {store.announcementNotice !== null && (
          <p
            className={store.announcementNotice === 'done' ? 'ht-settings__hint' : 'ht-settings__danger'}
            data-testid="admin-announcements-notice"
          >
            {t(store.announcementNotice === 'done' ? 'web.admin.action.done' : 'web.admin.action.failed')}
          </p>
        )}
      </form>

      <h4 className="ht-settings__admin-h">{t('web.admin.announcements.list')}</h4>
      {rows === null ? (
        <p className="ht-settings__hint">{t('web.admin.loading')}</p>
      ) : rows.length === 0 ? (
        <AdminEmpty titleKey="web.admin.announcements.noneFound" />
      ) : (
        <div className="ht-settings__admin-list">
          {rows.map((row) => (
            <div key={row.id} className="ht-settings__admin-row">
              <span className="ht-settings__admin-rowMain">{row.title}</span>
              <span className="ht-settings__admin-badges">
                <span
                  className={`ht-settings__admin-badge${
                    row.state === 'active' ? '' : ' ht-settings__admin-badge--danger'
                  }`}
                >
                  {t(ANNOUNCEMENT_STATE_KEY[row.state])}
                </span>
              </span>
              <span className="ht-settings__admin-rowMeta">
                {formatTime(row.publishedAt)}
                {' → '}
                {row.expiresAt === null ? t('web.admin.announcements.neverExpires') : formatTime(row.expiresAt)}
              </span>
              {pendingWithdrawId === row.id ? (
                <span className="ht-settings__admin-actions">
                  <button
                    type="button"
                    className="ht-settings__admin-btn ht-settings__admin-btn--danger"
                    onClick={() => {
                      setPendingWithdrawId(null);
                      void store.withdrawAnnouncement(row.id);
                    }}
                  >
                    {t('web.admin.announcements.withdrawConfirm')}
                  </button>
                  <button
                    type="button"
                    className="ht-settings__admin-btn"
                    onClick={() => setPendingWithdrawId(null)}
                  >
                    {t('web.admin.close')}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="ht-settings__admin-btn"
                  onClick={() => setPendingWithdrawId(row.id)}
                >
                  {t('web.admin.announcements.withdraw')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
