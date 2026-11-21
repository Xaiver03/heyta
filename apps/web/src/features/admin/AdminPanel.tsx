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
 * ## 只读为主，外加会动数据的那几格
 *
 * | 那一格 | 动的是什么 | 依据 |
 * |---|---|---|
 * | 用户详情：解锁 / 配额 / 强制登出 | 账号状态，**不碰钱也不碰权益** | ADR-0038 §2 三 |
 * | 调休 / 补班 | 一份下发给全体的公共事实 | ADR-0052 |
 * | 公告 | 一条内容通道（明文，不进端到端加密） | ADR-0075 |
 * | 退款 | 🔴 **唯一真的动钱**的一组；批准要非空理由 | ADR-0053 |
 * | 发放 | 三种订阅发放（赠送 / 免费升级 / 收回）。只写 `provider='admin-grant'` 那一行，**不建订单行 ⇒ 不进营收** | ADR-0076 |
 *
 * ⚠️ 这一张表现在是活的：加一格就登记一格。它原先写的是"首版只读，外加三个动作，
 * 改订阅/退款/发券是独立的工作单元" —— 那句到 2026-10 已经三处为假，而它留在文件头
 * 的作用是让下一个人在这里再开一格时以为自己在破坏什么（其实那条线早就被 ADR 挪过了）。
 */

import { useEffect, useState } from 'react';

import { ICON_SIZE } from '@heyta/design-system';
import { useI18n, type MessageKey } from '@heyta/i18n/provider';
import { RefreshCw, ShieldCheck } from 'lucide-react';

import { useAdminStore } from './store.js';

import { ADMIN_TABS } from './nav.js';

import { AnnouncementsSection } from './sections/AnnouncementsSection.js';
import { CouponsSection } from './sections/CouponsSection.js';
import { GrantsSection } from './sections/GrantsSection.js';
import { HolidaysSection } from './sections/HolidaysSection.js';
import { InvitesSection } from './sections/InvitesSection.js';
import { OrdersSection } from './sections/OrdersSection.js';
import { OverviewSection } from './sections/OverviewSection.js';
import { RefundsSection } from './sections/RefundsSection.js';
import { RevenueSection } from './sections/RevenueSection.js';
import { SubscriptionsSection } from './sections/SubscriptionsSection.js';
import { UsersSection } from './sections/UsersSection.js';

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
      case 'grants':
        // 档位下拉与发放记录是**同一次读**（`loadGrantBoard` 里两把 GET 并发），
        // 所以这里只有一个"还没拉过"的判据。判 `grantHistory` 而不是 `grantBoard`：
        // 空档位列表是配置坏了的一种形状，而空历史是正常的初始状态 —— 前者不该重拉。
        if (store.grantHistory === null) void store.loadGrantBoard();
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

  // 探测失败或不是管理员 ⇒ 什么都不渲染。见文件头。
  if (store.access !== 'admin') return null;

  // 独立后台页的标题与导航在 `AdminConsolePage` 那一侧，这里只留内容。
  const bareChrome = chrome === 'console';

  return (
    <div
      className={bareChrome ? 'ht-settings__console-body' : 'ht-settings__section'}
      data-testid="admin-panel"
    >
      {!bareChrome && (
        <>
          <h3 className="ht-settings__h3 ht-type-row-title">
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
      {tab === 'overview' && <OverviewSection store={store} />}

      {/* ── 用户 ─────────────────────────────────────────────────── */}
      {tab === 'users' && (
        <UsersSection
          store={store}
          active={active}
          search={search}
          onSearchChange={setSearch}
          quotaMiB={quotaMiB}
          onQuotaChange={setQuotaMiB}
        />
      )}

      {/* ── 订阅 ─────────────────────────────────────────────────── */}
      {tab === 'subscriptions' && <SubscriptionsSection store={store} />}

      {/* ── 订阅发放（ADR-0076：三种动作 + 动作史）──────────────── */}
      {tab === 'grants' && <GrantsSection store={store} />}

      {/* ── 订单 ─────────────────────────────────────────────────── */}
      {tab === 'orders' && <OrdersSection store={store} />}

      {/* ── 优惠码 ───────────────────────────────────────────────── */}
      {tab === 'coupons' && <CouponsSection store={store} />}

      {/* ── 邀请 ─────────────────────────────────────────────────── */}
      {tab === 'invites' && <InvitesSection store={store} />}

      {/* ── 营收看板（只读聚合）────────────────────────────────── */}
      {tab === 'revenue' && <RevenueSection store={store} />}

      {/* ── 运营公告（ADR-0075 的内容通道写面）────────────────── */}
      {tab === 'announcements' && <AnnouncementsSection store={store} />}

      {/* ── 调休 / 补班（公共事实的唯一录入面）──────────────────── */}
      {tab === 'holidays' && <HolidaysSection store={store} />}

      {/* ── 退款（申请 / 批准 / 驳回）────────────────────────────── */}
      {tab === 'refunds' && <RefundsSection store={store} />}

    </div>
  );
}
