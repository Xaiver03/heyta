import { useI18n } from '@heyta/i18n/provider';

import { ADMIN_PAGE_SIZE, type AdminStoreState } from '../store.js';

import {
  Badge,
  DataTable,
  Pager,
  type DataTableColumn,
  type PagerLabels,
} from '../../../components/hta/index.js';

import { formatTime } from './shared.js';

type InviteBundle = NonNullable<AdminStoreState['invites']>;
type InviteCodeRow = InviteBundle['codes']['items'][number];
type ReferralRow = InviteBundle['referrals']['items'][number];

export function InvitesSection({
  store,
}: {
  store: AdminStoreState;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const invites = store.invites;
  if (invites === null) return null;

  // 两张表各自的列定义：**不合并**，各自的表头/单元格在本表内自洽。
  const codeColumns: readonly DataTableColumn<InviteCodeRow>[] = [
    {
      key: 'code',
      header: t('web.admin.invites.codes'),
      render: (code) => code.code,
    },
    {
      key: 'owner',
      header: t('web.admin.table.owner'),
      render: (code) => code.email,
    },
    {
      key: 'status',
      header: t('web.admin.table.status'),
      // 状态走 Badge（语义 tone），不再用裸 ✓/✕ 字符。
      render: (code) => (
        <Badge tone={code.disabled ? 'danger' : 'success'}>
          {code.disabled ? t('web.admin.badge.locked') : t('web.admin.overview.coupons.enabled')}
        </Badge>
      ),
    },
    {
      key: 'created',
      header: t('web.admin.table.created'),
      render: (code) => formatTime(code.createdAt),
    },
  ];

  const referralColumns: readonly DataTableColumn<ReferralRow>[] = [
    {
      key: 'code',
      header: t('web.admin.invites.codes'),
      // 补齐：此前 `referrals.code` 未展示。
      render: (referral) => referral.code,
    },
    {
      key: 'inviter',
      header: t('web.admin.table.inviter'),
      render: (referral) => referral.inviter.email,
    },
    {
      key: 'invitee',
      header: t('web.admin.table.invitee'),
      render: (referral) => referral.invitee.email,
    },
    {
      key: 'reward',
      header: t('web.admin.table.reward'),
      // TODO(i18n): `rewardedAt` 没有独立的「发放时间」表头词条，暂把奖励天数与发放时间并入本列。
      // 补齐：此前 `rewardedAt` 未展示。
      render: (referral) => (
        <>
          {referral.rewardDays ?? '—'}
          {' · '}
          {formatTime(referral.rewardedAt)}
        </>
      ),
    },
    {
      key: 'status',
      header: t('web.admin.table.status'),
      // 推荐关系状态：已发放奖励 → 已激活 → 待激活。全部走语义 Badge。
      render: (referral) => {
        if (referral.rewardedAt !== null) {
          return <Badge tone="success">{t('web.inbox.notification.referral.title')}</Badge>;
        }
        if (referral.activatedAt !== null) {
          return (
            <Badge tone="info">
              {t('web.inbox.activity.invite.status.activated', { days: referral.rewardDays ?? 0 })}
            </Badge>
          );
        }
        return <Badge tone="neutral">{t('web.inbox.activity.invite.status.pending')}</Badge>;
      },
    },
    {
      key: 'created',
      header: t('web.admin.table.created'),
      render: (referral) => formatTime(referral.createdAt),
    },
  ];

  const pagerLabels: PagerLabels = {
    total: (total) => t('web.admin.users.total', { total }),
    // 未传 `onPageSizeChange` ⇒ 每页条数选择器不渲染，此标签仅满足类型。
    pageSize: t('web.admin.table.status'),
    previous: t('web.admin.prev'),
    next: t('web.admin.next'),
  };

  return (
    <>
      {/* 🔴 一个响应两面：`codes` 是"谁手里有码"，`referrals` 是"码换来谁"。 */}
      <h5 className="ht-settings__admin-h5">{t('web.admin.invites.codes')}</h5>
      <DataTable
        testID="admin-codes"
        rows={invites.codes.items}
        columns={codeColumns}
        rowKey={(code) => String(code.id)}
        emptyTitle={t('web.admin.list.none')}
      />
      <Pager
        testID="admin-codes-pager"
        total={invites.codes.total}
        pageSize={ADMIN_PAGE_SIZE}
        offset={invites.codes.offset}
        onOffsetChange={(offset) => {
          void store.loadInvites(offset);
        }}
        labels={pagerLabels}
      />

      <h5 className="ht-settings__admin-h5">{t('web.admin.invites.referrals')}</h5>
      <DataTable
        testID="admin-referrals"
        rows={invites.referrals.items}
        columns={referralColumns}
        rowKey={(referral) => String(referral.id)}
        emptyTitle={t('web.admin.list.none')}
      />
      {/* TODO(store): `GET /invites` 对 codes 与 referrals **共用同一组 limit/offset**
          （服务端一次 take/skip 切两张表）。两个 Pager 现各自按本表 `total` 计算边界，
          已修掉「短表显得还有下一页」；但点下一页仍会同时改动两表窗口。
          要真正按表独立翻页，需 store/接口支持分别传 `codesOffset` / `referralsOffset`
          （或拆成两个端点）—— 这需要改 `packages/app-host` 的 `fetchAdminInvites` 与 store，
          不在本次单文件改动范围内。 */}
      <Pager
        testID="admin-referrals-pager"
        total={invites.referrals.total}
        pageSize={ADMIN_PAGE_SIZE}
        offset={invites.referrals.offset}
        onOffsetChange={(offset) => {
          void store.loadInvites(offset);
        }}
        labels={pagerLabels}
      />
    </>
  );
}
