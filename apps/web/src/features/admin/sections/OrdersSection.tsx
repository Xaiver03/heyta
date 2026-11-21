import type { AdminOrderRow } from '@heyta/app-host';
import { useI18n, type MessageKey } from '@heyta/i18n/provider';

import {
  Badge,
  Button,
  DataTable,
  type BadgeTone,
  type DataTableColumn,
} from '../../../components/hta/index.js';

import { ADMIN_PAGE_SIZE, type AdminStoreState } from '../store.js';

import { Pager, formatMoney, formatTime } from './shared.js';

/**
 * 订单状态 → 徽标语义色。
 *
 * 🔴 状态码的词表住在支付通道（服务端投影原样搬回），这一层**不把它枚举成中文**：
 * 认识的那几枚给语义色，其余一律 `neutral` 并把码本身原样念出来 —— 一个没翻译的码
 * 是"这里要加词条"的响亮提示，编一个中文名是安静的错。补中文名属于 i18n 词条。
 */
function orderStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'paid':
      return 'success';
    case 'pending':
    case 'created':
      return 'warning';
    case 'refunded':
      return 'info';
    case 'failed':
    case 'closed':
      return 'danger';
    default:
      return 'neutral';
  }
}

/**
 * 订单（只读台账）。
 *
 * 迁移口径（`.local/admin-redesign/05-reuse-map.md` §10、`02-admin-ia.md` §3.5）：
 *   · 列表从"无表头 flex 行"换成 `DataTable`（表头/列/对齐），三态由它内部的
 *     `ListState` 承担（loading→Skeleton / error→ErrorState+retry / empty→EmptyState）；
 *   · 补齐原先几乎不展示的字段：`outTradeNo`、`originalAmountMinor/finalAmountMinor`、
 *     `paidAt`、`userId`；`status` 用 `Badge` 表达语义色，不再是一段裸文本；
 *   · 修 IA 硬伤"订单 → 退款断链"：行内给「去退款」，点了切到退款分区
 *     （跨 tab 预填 orderId 见行内 TODO —— store 目前没有这个能力）。
 */
export function OrdersSection({
  store,
}: {
  store: AdminStoreState;
}): React.JSX.Element | null {
  const { t } = useI18n();

  const orders = store.orders;
  // 首屏（还没拉过、也没有失败）→ 骨架；失败 → ErrorState。刷新已知条数时不叠骨架。
  const firstLoad = orders === null && store.errorKey === null;
  const listError =
    orders === null && store.errorKey !== null
      ? { title: t(store.errorKey as MessageKey), retryLabel: t('web.admin.retry') }
      : null;

  const columns: readonly DataTableColumn<AdminOrderRow>[] = [
    {
      key: 'outTradeNo',
      header: t('web.admin.refund.form.orderId'),
      render: (order) => order.outTradeNo,
    },
    {
      key: 'amount',
      // 一个「金额」列里放「原价 → 实付」：箭头本身说明哪个是折后价，
      // 既同时展示两个字段，又不必为「原价/实付」各造一个词条。
      header: t('web.admin.table.amount'),
      align: 'end',
      render: (order) =>
        `${formatMoney(order.originalAmountMinor, order.currency)} → ${formatMoney(
          order.finalAmountMinor,
          order.currency,
        )}`,
    },
    {
      key: 'status',
      header: t('web.admin.table.status'),
      render: (order) => <Badge tone={orderStatusTone(order.status)}>{order.status}</Badge>,
    },
    {
      key: 'paidAt',
      header: t('web.admin.order.paidAt'),
      render: (order) => formatTime(order.paidAt),
    },
    {
      key: 'userId',
      header: t('web.admin.table.owner'),
      render: (order) => t('web.admin.refund.user').replace('{user}', String(order.userId)),
    },
    {
      key: 'refund',
      // 动作列表头留空：按钮文字本身说明动作，不需要列标题。
      header: '',
      render: (order) => (
        <Button
          size="sm"
          tone="ghost"
          onClick={() => {
            // TODO: store 目前没有「订单 → 退款」的跨 tab 预填能力。
            // 现在只能切到退款分区；要真正把这一单带过去，需要 store 新增
            // 形如 openRefundForOrder(orderId) 的动作（参考 openGrantForUser），
            // 把 order.id（数字主键，正是退款表单要的 orderId）落到退款分区表单初值。
            store.setActiveTab('refunds');
          }}
        >
          {t('web.admin.order.goRefund')}
        </Button>
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={orders?.items ?? []}
        rowKey={(order) => String(order.id)}
        loading={firstLoad}
        error={listError}
        onRetry={() => {
          void store.loadOrders(orders?.offset ?? 0);
        }}
        emptyTitle={t('web.admin.list.none')}
        caption={t('web.admin.tab.orders')}
        testID="admin-orders"
      />
      {orders !== null && (
        <Pager
          total={orders.total}
          offset={orders.offset}
          onPrev={() => {
            void store.loadOrders(Math.max(0, orders.offset - ADMIN_PAGE_SIZE));
          }}
          onNext={() => {
            void store.loadOrders(orders.offset + ADMIN_PAGE_SIZE);
          }}
        />
      )}
    </>
  );
}
