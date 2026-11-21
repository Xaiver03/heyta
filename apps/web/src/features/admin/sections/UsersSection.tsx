import { useCallback, useEffect, useState } from 'react';

import type { AdminUserRow } from '@heyta/app-host';
import { ICON_SIZE } from '@heyta/design-system';
import { useI18n, type MessageKey } from '@heyta/i18n/provider';
import { Search } from 'lucide-react';

import {
  ADMIN_PAGE_SIZE,
  capabilityLabelKey,
  entitlementReasonKey,
  providerLabelKey,
  type AdminStoreState,
} from '../store.js';

import { Badge } from '../../../components/hta/Badge.js';
import { Button } from '../../../components/hta/Button.js';
import { DataTable, type DataTableColumn } from '../../../components/hta/DataTable.js';
import { IconButton } from '../../../components/hta/IconButton.js';
import { InlineFeedback } from '../../../components/hta/InlineFeedback.js';
import { SideSheet } from '../../../components/hta/SideSheet.js';

import { FormField } from '../../../lib/form/FormField.js';

import { Pager, formatBytes, formatMoney, formatTime } from './shared.js';

/**
 * 三个会改到「别人账号」的写动作。它们共用一套两步确认：第一下把按钮换成
 * 「确认（`danger` + `commit`）/ 取消」这一对，第二下才真正发请求。
 *
 * 🔴 为什么是「就地两步」而不是再叠一层 `DangerConfirmDialog`：这三个动作的触发点都在
 *    **已经打开的抽屉（`SideSheet`，本身是一层 `WebModalShell`）**里 —— 抽屉已经是一个
 *    接管焦点的 `aria-modal` 浮层，再叠第二个模态会同时存在两层 `aria-modal`、两套焦点
 *    陷阱互相抢 Tab。任务口径允许「复杂就保留两步式，但用 hta Button `tone="danger"` `commit`」，
 *    这里正落在这一档：按钮重量仍取自中央表（`danger` + `commit`），只是不引入模态套模态。
 */
type UserWriteAction = 'unlock' | 'quota' | 'forceLogout';

const ACTION_LABEL_KEY: Readonly<Record<UserWriteAction, MessageKey>> = {
  unlock: 'web.admin.action.unlock',
  quota: 'web.admin.action.quota',
  forceLogout: 'web.admin.action.logout',
};

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
  const [confirmAction, setConfirmAction] = useState<UserWriteAction | null>(null);

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
  const rows = users?.items ?? [];
  // 三个写动作在途互斥：任一在跑时，三枚写按钮一起禁用（`AdminPendingKey` 的 R2 口径）。
  const writePending =
    store.pending.userUnlock || store.pending.userQuota || store.pending.userForceLogout;

  // 抽屉关掉（Esc / 点遮罩 / 关闭 / 切换用户）时，不能把「待确认」留在下一次打开上。
  useEffect(() => {
    if (detail === null) setConfirmAction(null);
  }, [detail]);

  const runConfirmed = useCallback(
    (action: UserWriteAction) => {
      if (detail === null) return;
      if (action === 'unlock') {
        void store.unlockUser(detail.user.id);
      } else if (action === 'quota') {
        const mib = Number(quotaMiB);
        if (!Number.isFinite(mib) || mib < 1) return;
        void store.setUserQuota(detail.user.id, Math.round(mib * 1024 * 1024));
      } else {
        void store.forceLogout(detail.user.id);
      }
    },
    [detail, quotaMiB, store],
  );

  const pendingOf = (action: UserWriteAction): boolean =>
    action === 'unlock'
      ? store.pending.userUnlock
      : action === 'quota'
        ? store.pending.userQuota
        : store.pending.userForceLogout;

  // 两步确认的第二击：就地换出「确认（danger + commit）/ 取消」，不新开模态（见文件头注释）。
  const confirmPair = (action: UserWriteAction): React.JSX.Element => (
    <>
      <Button
        tone="danger"
        commit
        disabled={writePending}
        loading={pendingOf(action)}
        onClick={() => {
          // 先收起确认态再写：写失败不该把确认按钮永远留在屏幕上（失败由 `feedback` 说）。
          setConfirmAction(null);
          runConfirmed(action);
        }}
      >
        {t(ACTION_LABEL_KEY[action])}
      </Button>
      <Button
        tone="secondary"
        onClick={() => {
          setConfirmAction(null);
        }}
      >
        {t('web.rowMenu.cancel')}
      </Button>
    </>
  );

  const columns: DataTableColumn<AdminUserRow>[] = [
    {
      key: 'id',
      header: t('web.admin.grant.user'),
      align: 'end',
      render: (user) => user.id,
    },
    {
      key: 'email',
      header: t('common.profile.email.label'),
      render: (user) => user.email,
    },
    {
      key: 'status',
      header: t('web.admin.table.status'),
      render: (user) => (
        <span className="ht-settings__admin-badges">
          {user.isAdmin && <Badge tone="info">{t('web.admin.badge.admin')}</Badge>}
          {user.locked && <Badge tone="danger">{t('web.admin.badge.locked')}</Badge>}
          {!user.isVerified && <Badge tone="warning">{t('web.admin.badge.unverified')}</Badge>}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: t('web.admin.table.created'),
      align: 'end',
      render: (user) => formatTime(user.createdAt),
    },
  ];

  return (
    <>
      <form onSubmit={submitSearch}>
        <FormField id="admin-user-search" label={t('web.admin.users.search')} layout="inline">
          {(fieldProps) => (
            <div className="ht-input-field__fieldrow">
              <input
                {...fieldProps}
                className="ht-input"
                type="search"
                value={search}
                onChange={(event) => {
                  onSearchChange(event.target.value);
                }}
              />
              <IconButton
                type="submit"
                label={t('web.admin.users.search')}
                icon={<Search size={ICON_SIZE.xs} aria-hidden="true" />}
              />
            </div>
          )}
        </FormField>
      </form>

      {/* 列表用 `DataTable`（内建 `ListState` 三态）。testID 挂在外层单一节点：
          `DataTable` 内部给 `ListState` 包裹层和 `<table>` 都会打同一 testID，
          直接传会把 `admin-users` 变成两个节点（Playwright 严格模式会判重复）。 */}
      <div data-testid="admin-users">
        <DataTable<AdminUserRow>
          columns={columns}
          rows={rows}
          rowKey={(user) => String(user.id)}
          loading={users === null && store.errorKey === null}
          error={
            users === null && store.errorKey !== null
              ? { title: t(store.errorKey as MessageKey) }
              : null
          }
          onRetry={() => {
            void store.loadUsers({ q: search, offset: 0 });
          }}
          emptyTitle={t('web.admin.users.noneFound')}
          onRowClick={(user) => {
            void store.openUser(user.id);
          }}
        />
      </div>

      {users !== null && (
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
      )}

      {detail !== null && (
        <SideSheet
          testId="admin-user-detail"
          labelledBy="admin-user-sheet-title"
          title={detail.user.email}
          onCancel={store.closeUser}
          busy={writePending}
          footer={
            <div className="ht-settings__admin-actions">
              {/* 搬运入口放在「这个人此刻能用什么」旁边：下一步就是发他一份，
                  中间不许有「把编号抄下来」这一步。它只带「是谁」，其余留给发放格。 */}
              <Button
                tone="secondary"
                data-testid="admin-grant-for-user"
                onClick={() => {
                  store.openGrantForUser(detail.user.id);
                }}
              >
                {t('web.admin.users.grantFor')}
              </Button>
              {confirmAction === 'unlock' ? (
                confirmPair('unlock')
              ) : (
                <Button
                  tone="secondary"
                  disabled={writePending}
                  loading={store.pending.userUnlock}
                  onClick={() => {
                    setConfirmAction('unlock');
                  }}
                >
                  {t('web.admin.action.unlock')}
                </Button>
              )}
              {confirmAction === 'forceLogout' ? (
                confirmPair('forceLogout')
              ) : (
                <Button
                  tone="danger"
                  disabled={writePending}
                  loading={store.pending.userForceLogout}
                  onClick={() => {
                    setConfirmAction('forceLogout');
                  }}
                >
                  {t('web.admin.action.logout')}
                </Button>
              )}
              <Button tone="secondary" onClick={store.closeUser}>
                {t('web.admin.close')}
              </Button>
            </div>
          }
        >
          <p className="ht-settings__hint">
            {t('web.admin.grant.user')}: {detail.user.id} · {t('web.admin.user.created')}:{' '}
            {formatTime(detail.user.createdAt)} · {t('web.admin.user.storage')}:{' '}
            {formatBytes(detail.user.storageUsedBytes)} /{' '}
            {formatBytes(detail.user.storageQuotaBytes)} · {t('web.admin.user.failedLogins')}:{' '}
            {detail.user.failedLoginAttempts}
          </p>
          <p className="ht-settings__hint">
            {t('web.admin.user.passkeys')}: {detail.counts.passkeys} ·{' '}
            {t('web.admin.user.operations')}: {detail.counts.operations} ·{' '}
            {t('web.inbox.tab.notifications')}: {detail.counts.notifications} ·{' '}
            {t('web.admin.user.devices')}: {detail.devices.length}
          </p>

          {/* 🔴 并集读数：回答的是"他**此刻**实际能用什么"，不是"库里有哪些行"。
              判定住在服务端（`admin.routes.ts::projectEntitlements` 调的就是守卫那批函数），
              所以后台念的与线上拦的是同一次裁决。下面「订阅」那一节仍保留逐行 ——
              它答的是"哪一行的问题"，两格不互相替代。 */}
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
                {labelKey === null ? item.capability : t(labelKey)} {item.allowed ? '✓' : '✕'}
                {tail}
              </p>
            );
          })}

          {/* 同意留痕：对外文本承诺"记下当时那一套的版本指纹"，后台必须能一眼答出
              "什么时候、哪一版"，并把"证明不了版本"与"根本没同意"分成两种显示。 */}
          <p className="ht-settings__hint" data-testid="admin-user-consent">
            {t('web.admin.user.consent')}:{' '}
            {detail.user.termsAcceptedAt === null
              ? t('web.admin.user.consentNone')
              : `${formatTime(detail.user.termsAcceptedAt)} · ${
                  detail.user.termsDocumentVersion ?? t('web.admin.user.consentNoVersion')
                }`}
          </p>

          {/* 统一回执（审计 R1）：写动作成功/失败都折进 `store.feedback`，这里只按
              `tone` 渲染 —— 计时归宿主，回执字段只有一个来源。 */}
          {store.feedback !== null && (
            <InlineFeedback tone={store.feedback.tone} testID="admin-action-notice">
              {t(store.feedback.message as MessageKey)}
            </InlineFeedback>
          )}

          {/* 配额那一行是**一整行**：`FormField` 的控件格只放输入框，保存按钮跟着它排在
              同一行的动作位（`.ht-input-field__fieldrow`）。不再把按钮塞进标签里，
              避免「点按钮把焦点送进输入框」和旧版那种被压成窄格溢出到隔壁按钮底下。 */}
          <FormField id="admin-quota-mib" label={t('web.admin.quota.label')} layout="inline">
            {(fieldProps) => (
              <div className="ht-input-field__fieldrow">
                <input
                  {...fieldProps}
                  className="ht-input"
                  type="number"
                  min={1}
                  value={quotaMiB}
                  onChange={(event) => {
                    onQuotaChange(event.target.value);
                  }}
                />
                {confirmAction === 'quota' ? (
                  confirmPair('quota')
                ) : (
                  <Button
                    tone="secondary"
                    disabled={writePending}
                    loading={store.pending.userQuota}
                    onClick={() => {
                      const mib = Number(quotaMiB);
                      if (!Number.isFinite(mib) || mib < 1) return;
                      setConfirmAction('quota');
                    }}
                  >
                    {t('web.admin.quota.submit')}
                  </Button>
                )}
              </div>
            )}
          </FormField>

          {/* 同步设备明细：后端一直返回 `deviceName/appVersion/lastSeenAt`，
              旧版只念了个数量。设备名做主文（布局自会说明它是什么），版本与最近活动
              走已有的 `web.profile.overview.version` / `web.sync.devices.lastSeen` 词条。 */}
          <h5 className="ht-settings__admin-h5">{t('web.admin.user.devices')}</h5>
          {detail.devices.length === 0 ? (
            <p className="ht-settings__hint">{t('web.admin.user.none')}</p>
          ) : (
            <ul className="ht-settings__admin-list" data-testid="admin-user-devices">
              {detail.devices.map((device) => (
                <li key={device.clientId} className="ht-settings__admin-staticRow">
                  <span className="ht-settings__admin-rowMain">{device.deviceName ?? '—'}</span>
                  <span className="ht-settings__admin-rowMeta">
                    {t('web.profile.overview.version')}: {device.appVersion ?? '—'} ·{' '}
                    {t('web.sync.devices.lastSeen', { date: formatTime(device.lastSeenAt) })}
                  </span>
                </li>
              ))}
            </ul>
          )}

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
        </SideSheet>
      )}
    </>
  );
}
