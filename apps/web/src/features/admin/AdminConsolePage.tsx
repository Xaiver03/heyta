/**
 * 独立后台页（`/admin`）。
 * =======================
 *
 * 依据：[`docs/adr/0038-admin-console-scope.md`](../../../../docs/adr/0038-admin-console-scope.md) §2 第一条
 * —— 后台是**主应用里的一个受保护子树**，不是第二个应用。这一页守的就是那条：
 * 复用同一个 bundle、同一份 design-system、同一个部署产物，
 * 只是给运营者一个**可以直接敲的地址**与一个全页的壳。
 *
 * ## 为什么不开一个独立 app / 独立子域名
 *
 * 那要再多一份要部署、要发版、要配 CORS 与证书的东西，而它换来的隔离是**假的**：
 * 真正的边界在服务端 `requireAdmin`（§4.3「服务端是唯一裁决者」）。
 * 前端拆成第二个应用，读到同一批数据的仍然是同一个账号的同一张表。
 *
 * ## 🔴 非管理员看到的不是空白
 *
 * 设置页里那个壳对非管理员**什么都不渲染**（`AdminPanel` 的 `return null`）——
 * 那里合理：普通用户不该在设置页里看见一格点进去全是 403 的面板。
 * 但这一页是**有人主动敲地址进来的**，空白会被读成"页面坏了"。
 * 所以这里按 `access` 给出原因，并把服务端那句原话念出来
 * （词条在 `web.admin.error.*`，界面不自己编一条更客气的说法）。
 *
 * ⚠️ 这些说明是**呈现**，不是安全措施：挡不住任何手工构造的请求，
 * 那本来由 `requireAdmin` 管。
 *
 * ## 探测由 `AdminPanel` 拥有，不在这里重复
 *
 * 内容区**总是**挂 `<AdminPanel chrome="console" />`：它对非管理员返回 `null`，
 * 而它挂载那一次负责唯一的 `probe()`。这里若也探一次，同一页会打两次
 * `/api/admin/overview`，`access` 会被第二趟打回 `'checking'` ——
 * 表现是界面在"加载中 → 内容 → 加载中"之间抖一下，而抖会被读成"这页不稳"。
 */

import { ICON_SIZE } from '@heyta/design-system';
import { useI18n, type MessageKey } from '@heyta/i18n/provider';
import { ArrowLeft, RefreshCw, ShieldCheck } from 'lucide-react';

import { AdminPanel } from './AdminPanel.js';
import { ADMIN_TABS } from './nav.js';
import { appEntryHref } from './route.js';
import { useAdminStore } from './store.js';
// 🔴 首启的隐私同意面板必须在这一页上也挂着 —— 见下面挂载点那条注释。
import { PrivacyConsentSheet } from '../privacy/PrivacyConsentSheet.js';
import { useNetworkAllowed } from '../privacy/use-network-allowed.js';

export function AdminConsolePage(): React.JSX.Element {
  const { t } = useI18n();
  const store = useAdminStore();
  const access = store.access;
  const networkAllowed = useNetworkAllowed();

  return (
    <div className="ht-settings__console" data-testid="admin-console">
      <header className="ht-settings__console-bar">
        <h1 className="ht-settings__console-title ht-type-screen-title">
          <ShieldCheck size={ICON_SIZE.sm} aria-hidden="true" /> {t('web.admin.console.title')}
        </h1>
        <div className="ht-settings__console-barActions">
          <button
            type="button"
            className="ht-settings__console-action"
            onClick={() => {
              void store.probe();
              void store.loadUsers({ offset: 0 });
            }}
          >
            <RefreshCw size={ICON_SIZE.xs} aria-hidden="true" /> {t('web.admin.retry')}
          </button>
          <a className="ht-settings__console-action" href={appEntryHref()}>
            <ArrowLeft size={ICON_SIZE.xs} aria-hidden="true" /> {t('web.admin.console.back')}
          </a>
        </div>
      </header>

      <div className="ht-settings__console-main">
        <nav className="ht-settings__console-nav" aria-label={t('web.admin.console.navLabel')}>
          {ADMIN_TABS.map((entry) => {
            const Icon = entry.icon;
            const current = store.activeTab === entry.key;
            return (
              <button
                key={entry.key}
                type="button"
                className={`ht-settings__console-navItem${
                  current ? ' ht-settings__console-navItem--current' : ''
                }`}
                aria-current={current ? 'page' : undefined}
                onClick={() => store.setActiveTab(entry.key)}
              >
                <Icon size={ICON_SIZE.xs} aria-hidden="true" />
                {t(entry.labelKey)}
              </button>
            );
          })}
        </nav>

        <main className="ht-settings__console-content">
          {(!networkAllowed || access !== 'admin') && (
            <div className="ht-settings__console-status" data-testid="admin-console-status">
              {!networkAllowed || access === 'unknown' || access === 'checking' ? (
                <p className="ht-settings__hint">{t('web.admin.loading')}</p>
              ) : (
                <>
                  <p className="ht-settings__hint">{t('web.admin.console.leadUnavailable')}</p>
                  {store.errorKey !== null && (
                    <p className="ht-settings__danger" data-testid="admin-console-reason">
                      {t(store.errorKey as MessageKey)}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
          {/* 同意闸门放行之后才挂载内容区（理由见 `useNetworkAllowed`）。
              非管理员时它自己返回 null —— 这一页由上面那块给出原因。 */}
          {networkAllowed && <AdminPanel chrome="console" />}
        </main>
      </div>

      {/*
       * 🔴 首启的隐私同意面板在这一页上**也**要挂着。
       *
       * 不是"顺手补一个浮层"，是一处会谎报故障的缺口：`App()` 里那个
       * "该问就 openSheet('first-launch')"的 effect 挂在**所有 hook 那一段**，
       * 我这页是在 hook 之后才整棵换掉的 —— 于是 store 里 `open` 已经是真，
       * 而面板没人画。表现是：全新浏览器打开 `/admin`，`window.fetch` 仍被
       * 同意闸门挡住（`features/privacy/consent-gate.ts`），后台于是报
       * 「连不上服务器，请检查网络后重试」—— 那是一句谎，真话是"你还没同意"。
       *
       * 复用同一个组件、同一个 store：这里**不重做**任何"要不要问"的判断。
       */}
      <PrivacyConsentSheet />
    </div>
  );
}
