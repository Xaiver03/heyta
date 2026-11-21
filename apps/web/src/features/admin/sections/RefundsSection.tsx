import { useEffect, useState } from 'react';

import type { AdminRefundRow } from '@heyta/app-host';
import { ICON_SIZE } from '@heyta/design-system';
import { useI18n, type MessageKey } from '@heyta/i18n/provider';
import { Search } from 'lucide-react';

import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  IconButton,
  InlineFeedback,
  type BadgeTone,
  type DataTableColumn,
} from '../../../components/hta/index.js';

import {
  type AdminStoreState,
  type RefundRequestInput,
} from '../store.js';

import { DangerConfirmDialog } from '../../../lib/dialog/DangerConfirmDialog.js';
import { FormField } from '../../../lib/form/FormField.js';

import { formatMoney, formatTime } from './shared.js';

/** 退款申请表单的初值。同上：**不预填订单号**，也不默认勾上"例外"。 */
const EMPTY_REFUND_FORM: RefundRequestInput = {
  orderIdText: '',
  noteText: '',
  operatorApproved: false,
};

/**
 * 服务端 `listRefunds` 的投影**只有 9 个键**（`id,orderId,userId,provider,
 * outRefundNo,amountMinor,currency,periodDays,status`）。界面要念的
 * `note`（理由）/`providerRefundId`/`refundedAt` 三列目前在投影里**没有**，
 * 这里先按可选字段读，渲染成占位；等后端补齐后把这张声明收回到 `AdminRefundRow` 本体。
 *
 * TODO(server): `GET /api/admin/refunds` 的投影需补 `note`（操作理由）、
 *   `providerRefundId`（通道退款单号）、`refundedAt`（到账时刻，epoch ms）。
 *   后端补齐前，这三列只能显示 "—"，运营看不到"为什么退/通道号/何时到账"。
 */
interface RefundRowWithDetail extends AdminRefundRow {
  readonly note?: string | null;
  readonly providerRefundId?: string | null;
  readonly refundedAt?: number | null;
}

/**
 * 退款状态 → 徽标语义色。
 *
 * 🔴 词表住在服务端（`server/src/billing/refund-store.ts` 的 `REFUND_STATUSES`），
 * 这一层**不把它枚举成中文**：认识的那几枚给语义色，其余一律 `neutral` 并把码本身
 * 原样念出来 —— 一个没翻译的码是"这里要加词条"的响亮提示，编一个中文名是安静的错。
 * 补中文名属于 i18n 词条（见本文件 TODO(i18n)）。
 */
function refundStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'requested':
      return 'warning';
    case 'approved':
    case 'processing':
      return 'info';
    case 'success':
      return 'success';
    case 'rejected':
      return 'neutral';
    case 'abnormal':
    case 'failed':
    case 'closed':
    case 'channel-failed':
      return 'danger';
    default:
      return 'neutral';
  }
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
 * 只能再退一笔钱回去 —— 那是第二笔账），所以它必须过一次危险确认（`DangerConfirmDialog`，
 * 主按钮走 danger + commit）。驳回则相反：它是这条流程里唯一"什么都不发生"的出口，一步就够。
 *
 * ⚠️ 界面**没有**"已退款"这个结论：`success` 只由签名有效的微信回调认领（ADR-0053 §4）。
 * 批准之后列表里那一行徽标显示的是服务端给的状态原文（`approved` / `processing` / `failed`），
 * 而不是"退款完成"。
 *
 * 迁移口径（`.local/admin-redesign/05-reuse-map.md` §8/§10、`02-admin-ia.md` §3.11）：
 *   · 列表从"无表头 flex 行"换成 `DataTable`（表头/列/对齐），三态由它内部的
 *     `ListState` 承担（loading→Skeleton / error→ErrorState+retry / empty→EmptyState）；
 *   · `status` 从 `<code>` 裸文本换成 `Badge`（状态语义色，未知落 neutral 念原码）；
 *   · 补展示 `note`（理由）/`providerRefundId`/`refundedAt` 三列（投影缺失，见上 TODO(server)）；
 *   · 批准改走 `DangerConfirmDialog`；三枚写动作按钮按 `store.pending.*` 逐枚禁用；
 *   · 回执统一走 `InlineFeedback`，渲染 `store.feedback`（审计 R1 的唯一回执原语）。
 *
 * ⚠️ **无分页**：`GET /api/admin/refunds` 只有 `limit`、没有 `offset`（`admin-client.ts` 的
 * `AdminRefundList`）。所以这里只读最新一批，不画 `Pager`。
 * TODO(server): 需后端支持 offset 分页（并在响应里回 `total`），才能翻历史 ——
 *   否则运营只能看到最新 `ADMIN_PAGE_SIZE` 条，更早的退款无法在后台翻到。
 */
export function RefundsSection(props: { store: AdminStoreState }): React.JSX.Element {
  const { t } = useI18n();
  const store = props.store;
  const refunds = store.refunds;
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState<RefundRequestInput>(EMPTY_REFUND_FORM);
  /** 每一行的理由（`id → 文本`）。那是**输入**，不是状态，所以不进 store。 */
  const [notes, setNotes] = useState<Record<number, string>>({});
  /** 待危险确认的那一条退款 id（两步式"批准"）。 */
  const [pendingApproveId, setPendingApproveId] = useState<number | null>(null);

  const feedback = store.feedback;
  // 占位符填充用的坐标：`store.feedback.message` 是词条键，正文里的 {id}/{order}/
  // {status}/{code} 由动作回显填（与旧 notice 同一条取法，见 store 的 `AdminRefundEcho`）。
  const echo = store.refundEcho;
  const code = store.refundCode;

  // 🔴 统一反馈通道是全后台共用的一份（`store.feedback`），`setActiveTab` 不清它。
  // 本分区切进来时才挂载，这里清一次，免得上一格的回执漏到这一格（与 GrantsSection 同一处理）。
  // TODO(store): 更彻底的做法是 `setActiveTab` 里调用一次 `clearFeedback()`（见交付说明④）。
  useEffect(() => {
    store.clearFeedback();
  }, [store.clearFeedback]);

  // 首屏（还没拉过、也没有失败）→ 骨架；失败 → ErrorState。刷新已知条数时不叠骨架。
  const firstLoad = refunds === null && store.errorKey === null;
  const listError =
    refunds === null && store.errorKey !== null
      ? { title: t(store.errorKey as MessageKey), retryLabel: t('web.admin.retry') }
      : null;

  const columns: readonly DataTableColumn<RefundRowWithDetail>[] = [
    {
      key: 'refundNo',
      // TODO(i18n): 「退款单号」列头（当前无专用词条，英文占位，同 OrdersSection 的 'Paid at'）。
      header: 'Refund',
      render: (refund) => `#${String(refund.id)} · ${refund.outRefundNo}`,
    },
    {
      key: 'order',
      header: t('web.admin.refund.form.orderId'),
      render: (refund) => t('web.admin.refund.order').replace('{order}', String(refund.orderId)),
    },
    {
      key: 'user',
      header: t('web.admin.grant.user'),
      render: (refund) => t('web.admin.refund.user').replace('{user}', String(refund.userId)),
    },
    {
      key: 'amount',
      header: t('web.admin.table.amount'),
      align: 'end',
      render: (refund) => formatMoney(refund.amountMinor, refund.currency),
    },
    {
      key: 'period',
      // TODO(i18n): 「退款天数」列头（当前无专用词条，英文占位）。
      header: 'Days',
      align: 'end',
      render: (refund) => t('web.admin.refund.period').replace('{days}', String(refund.periodDays)),
    },
    {
      key: 'provider',
      // TODO(i18n): 「支付通道」列头（当前无专用词条，英文占位）。
      header: 'Provider',
      render: (refund) => refund.provider,
    },
    {
      key: 'status',
      header: t('web.admin.table.status'),
      render: (refund) => <Badge tone={refundStatusTone(refund.status)}>{refund.status}</Badge>,
    },
    {
      key: 'note',
      // TODO(i18n): 「理由」列头（`web.admin.refund.note` 是动作输入框的长句，
      // 不适合当列头；列头专用词条待补，英文占位）。
      header: 'Reason',
      // TODO(server): 投影补 `note` 后删掉 `?? '—'` 兜底。
      render: (refund) =>
        refund.note === undefined || refund.note === null || refund.note === '' ? '—' : refund.note,
    },
    {
      key: 'providerRefundId',
      // TODO(i18n): 「通道退款单号」列头（待补词条，英文占位）。
      header: 'Provider refund ID',
      // TODO(server): 投影补 `providerRefundId` 后删掉 `?? '—'` 兜底。
      render: (refund) =>
        refund.providerRefundId === undefined || refund.providerRefundId === null
          ? '—'
          : refund.providerRefundId,
    },
    {
      key: 'refundedAt',
      // TODO(i18n): 「到账时刻」列头（待补词条，英文占位）。
      header: 'Refunded at',
      align: 'end',
      // TODO(server): 投影补 `refundedAt`（epoch ms）后删掉 `?? null` 兜底。
      render: (refund) => formatTime(refund.refundedAt ?? null),
    },
    {
      key: 'actions',
      // 动作列表头留空：按钮文字本身说明动作，不需要列标题。
      header: '',
      render: (refund) => {
        // 🔴 只有 `requested` 给按钮：状态机只认这一档，其余档点下去必然 409。
        // 这不是安全措施（服务端才是裁决者），是**不制造一次注定失败的点击**。
        if (refund.status !== 'requested') return null;
        return (
          <div className="ht-settings__admin-actions">
            <input
              className="ht-input"
              data-testid={`admin-refund-note-${String(refund.id)}`}
              value={notes[refund.id] ?? ''}
              placeholder={t('web.admin.refund.note')}
              aria-label={t('web.admin.refund.note')}
              onChange={(event) => {
                setNotes((previous) => ({ ...previous, [refund.id]: event.target.value }));
              }}
            />
            <Button
              tone="secondary"
              disabled={store.pending.refundApprove}
              data-testid={`admin-refund-approve-${String(refund.id)}`}
              onClick={() => {
                setPendingApproveId(refund.id);
              }}
            >
              {t('web.admin.refund.approve')}
            </Button>
            <Button
              tone="ghost"
              disabled={store.pending.refundReject}
              data-testid={`admin-refund-reject-${String(refund.id)}`}
              onClick={() => {
                setPendingApproveId(null);
                void store.rejectRefund(refund.id, notes[refund.id] ?? '');
              }}
            >
              {t('web.admin.refund.reject')}
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <>
      <p className="ht-settings__hint">{t('web.admin.refund.lead')}</p>

      {/* 唯一回执（审计 R1）：三枚写动作的成功/失败都折进 `store.feedback`，
          这里只按 `tone` 渲染 —— 计时归宿主，回执字段只有一个来源。占位符由动作回显填。 */}
      {feedback !== null && (
        <InlineFeedback tone={feedback.tone} testID="admin-refund-notice">
          {t(feedback.message as MessageKey)
            .replace('{id}', String(echo?.id ?? '—'))
            .replace('{order}', String(echo?.orderId ?? '—'))
            .replace('{status}', echo?.detail ?? '—')
            .replace('{code}', code ?? '—')}
        </InlineFeedback>
      )}

      {/* ── 列表 ─────────────────────────────────────────────────── */}
      <h5 className="ht-settings__admin-h5">{t('web.admin.refund.list')}</h5>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setPendingApproveId(null);
          store.clearRefundNotice();
          store.clearFeedback();
          void store.loadRefunds({ userId: filter });
        }}
      >
        <FormField id="admin-refund-filter" label={t('web.admin.refund.filter')} layout="inline">
          {(fieldProps) => (
            <div className="ht-input-field__fieldrow">
              <input
                {...fieldProps}
                className="ht-input"
                type="search"
                inputMode="numeric"
                data-testid="admin-refund-filter"
                value={filter}
                placeholder={t('web.admin.refund.filter')}
                onChange={(event) => {
                  setFilter(event.target.value);
                }}
              />
              <IconButton
                type="submit"
                label={t('web.admin.refund.filter.submit')}
                icon={<Search size={ICON_SIZE.xs} aria-hidden="true" />}
              />
            </div>
          )}
        </FormField>
      </form>

      {/* 无 offset ⇒ 不分页，只读最新一批。TODO(server): 需后端支持 offset 分页（见文件头）。 */}
      <DataTable<RefundRowWithDetail>
        columns={columns}
        rows={refunds ?? []}
        rowKey={(refund) => String(refund.id)}
        loading={firstLoad}
        error={listError}
        onRetry={() => {
          void store.loadRefunds({ userId: filter });
        }}
        emptyTitle={t('web.admin.refund.list.none')}
        caption={t('web.admin.refund.list')}
        testID="admin-refunds"
      />

      {/* ── 开一张新申请 ─────────────────────────────────────────── */}
      <h5 className="ht-settings__admin-h5">{t('web.admin.refund.form.title')}</h5>
      <p className="ht-settings__hint">{t('web.admin.refund.form.lead')}</p>
      <form
        className="ht-settings__admin-detail"
        onSubmit={(event) => {
          event.preventDefault();
          setPendingApproveId(null);
          void store.requestRefund(form).then((accepted) => {
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
              className="ht-input"
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
              className="ht-input"
              rows={2}
              data-testid="admin-refund-request-note"
              value={form.noteText}
              onChange={(event) => {
                setForm((previous) => ({ ...previous, noteText: event.target.value }));
              }}
            />
          )}
        </FormField>
        {/* 「例外」是**选项**不是字段：走 `Checkbox`（复选），不走 `FormField`（判据见 `check:form-anatomy`）。 */}
        <Checkbox
          label={t('web.admin.refund.form.exception')}
          checked={form.operatorApproved}
          onChange={(checked) => {
            setForm((previous) => ({ ...previous, operatorApproved: checked }));
          }}
          testID="admin-refund-exception"
        />
        <div className="ht-settings__admin-actions">
          <Button
            type="submit"
            tone="primary"
            disabled={store.pending.refundRequest}
            data-testid="admin-refund-request"
          >
            {t('web.admin.refund.form.submit')}
          </Button>
        </div>
      </form>

      {/* 批准的危险确认：动钱、不可撤销，主按钮走 danger + commit（`check:danger-confirm` 口径）。 */}
      {pendingApproveId !== null && (
        <DangerConfirmDialog
          testId="admin-refund-approve-confirm"
          labelledBy="admin-refund-approve-title"
          confirmLabel={t('web.admin.refund.approve.yes')}
          cancelLabel={t('web.admin.close')}
          onCancel={() => {
            setPendingApproveId(null);
          }}
          onConfirm={() => {
            const id = pendingApproveId;
            // 先关确认框再写：写失败不该把确认框永远卡在屏幕上（失败由 `store.feedback` 说）。
            setPendingApproveId(null);
            if (id !== null) void store.approveRefund(id, notes[id] ?? '');
          }}
        >
          <h2 id="admin-refund-approve-title" className="hta-sheet__title">
            {t('web.admin.refund.approve')} · #{pendingApproveId}
          </h2>
          <p>{t('web.admin.refund.approve.confirm')}</p>
        </DangerConfirmDialog>
      )}
    </>
  );
}
