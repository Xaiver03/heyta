import type { AdminSubscriptionRow } from '@heyta/app-host';
import { useI18n, type MessageKey } from '@heyta/i18n/provider';

import {
  Badge,
  DataTable,
  type BadgeTone,
  type DataTableColumn,
} from '../../../components/hta/index.js';

import {
  ADMIN_PAGE_SIZE,
  capabilityLabelKey,
  providerLabelKey,
  type AdminStoreState,
} from '../store.js';

import { Pager, formatTime } from './shared.js';

/**
 * 订阅状态 → 徽标语义色。
 *
 * 🔴 状态码由支付通道给出、服务端原样搬回，这一层**不把它枚举成中文**：
 * 认识的那几枚给语义色，其余一律 `neutral` 并念出码本身 —— 一个没翻译的码
 * 是"这里要加词条"的响亮提示，编一个中文名是安静的错。
 */
function statusTone(status: string | null): BadgeTone {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'success';
    case 'past_due':
    case 'incomplete':
    case 'unpaid':
      return 'warning';
    case 'canceled':
    case 'expired':
    case 'revoked':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** `grants[]` → 可读能力名。码表外的能力念裸码、不编中文名。 */
function grantsLabel(grants: readonly string[], t: (key: MessageKey) => string): string {
  if (grants.length === 0) return '—';
  return grants
    .map((grant) => {
      const key = capabilityLabelKey(grant);
      return key === null ? grant : t(key);
    })
    .join(' · ');
}

/**
 * 订阅（只读台账）。
 *
 * 迁移口径（`.local/admin-redesign/05-reuse-map.md` §10、`02-admin-ia.md` §3.3）：
 *   · 列表从"无表头 flex 行"换成 `DataTable`（表头/列/对齐），三态由它内部的
 *     `ListState` 承担（loading→Skeleton / error→ErrorState+retry / empty→EmptyState）；
 *   · 补齐原先全不展示的字段：`userId`、`provider`、`priceId`、`grants[]`、`createdAt`
 *     （原来只念 email/status/expires）；`status` 用 `Badge` 表达语义色，不再是裸文本。
 *   · 仍只读：无详情、无动作、无批量、无筛选（与 IA 一致）。
 */
export function SubscriptionsSection({
  store,
}: {
  store: AdminStoreState;
}): React.JSX.Element {
  const { t } = useI18n();

  const subscriptions = store.subscriptions;
  // 首屏（还没拉过、也没有失败）→ 骨架；失败 → ErrorState。刷新已知条数时不叠骨架。
  const firstLoad = subscriptions === null && store.errorKey === null;
  const listError =
    subscriptions === null && store.errorKey !== null
      ? { title: t(store.errorKey as MessageKey), retryLabel: t('web.admin.retry') }
      : null;

  const columns: readonly DataTableColumn<AdminSubscriptionRow>[] = [
    {
      key: 'email',
      header: t('web.admin.table.owner'),
      render: (row) => row.email,
    },
    {
      key: 'userId',
      header: t('web.admin.grant.user'),
      align: 'end',
      render: (row) => row.userId,
    },
    {
      key: 'provider',
      // TODO(i18n): 缺「通道」表头词条（建议 `web.admin.table.provider`）。
      // 后端 provider 码：admin-grant / invite / wechat / paycenter，码表外念裸码。
      header: 'Provider',
      render: (row) => {
        const key = providerLabelKey(row.provider);
        return key === null ? (row.provider ?? '—') : t(key);
      },
    },
    {
      key: 'priceId',
      // TODO(i18n): 缺「档位」专用表头（当前复用发放分区的「档位」词条）。
      header: t('web.admin.grant.sku'),
      render: (row) => row.priceId ?? '—',
    },
    {
      key: 'grants',
      // TODO(i18n): 缺「授予能力」列头词条；先复用「此刻能用」。精确到这一行时，
      // 它指的是该行 `grants[]` 授予的能力（hosting / ai / automation）。
      header: t('web.admin.user.entitlements'),
      render: (row) => grantsLabel(row.grants, t),
    },
    {
      key: 'status',
      header: t('web.admin.table.status'),
      render: (row) => <Badge tone={statusTone(row.status)}>{row.status ?? '—'}</Badge>,
    },
    {
      key: 'currentPeriodEnd',
      header: t('web.admin.table.expires'),
      align: 'end',
      render: (row) => formatTime(row.currentPeriodEnd),
    },
    {
      key: 'createdAt',
      header: t('web.admin.table.created'),
      align: 'end',
      render: (row) => formatTime(row.createdAt),
    },
  ];

  return (
    <>
      {/* 外层保留 `data-testid`（e2e 的定位钩子），不把它交给 DataTable，
          否则 ListState 与 <table> 会各带一份同名 testid（strict mode 命中两个）。 */}
      <div data-testid="admin-subscriptions">
        <DataTable
          columns={columns}
          rows={subscriptions?.items ?? []}
          rowKey={(row) => String(row.id)}
          loading={firstLoad}
          error={listError}
          onRetry={() => {
            void store.loadSubscriptions(subscriptions?.offset ?? 0);
          }}
          emptyTitle={t('web.admin.list.none')}
          caption={t('web.admin.tab.subscriptions')}
        />
      </div>
      {subscriptions !== null && (
        <Pager
          total={subscriptions.total}
          offset={subscriptions.offset}
          onPrev={() => {
            void store.loadSubscriptions(Math.max(0, subscriptions.offset - ADMIN_PAGE_SIZE));
          }}
          onNext={() => {
            void store.loadSubscriptions(subscriptions.offset + ADMIN_PAGE_SIZE);
          }}
        />
      )}
    </>
  );
}
