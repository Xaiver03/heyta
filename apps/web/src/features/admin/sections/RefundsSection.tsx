import { useState } from 'react';

import { ICON_SIZE } from '@heyta/design-system';
import { useI18n, type MessageKey } from '@heyta/i18n/provider';
import { Search } from 'lucide-react';

import {
  ADMIN_REFUND_CODE_KEY,
  ADMIN_REFUND_NOTICE_KEY,
  type AdminStoreState,
  type RefundRequestInput,
} from '../store.js';

import { FormField } from '../../../lib/form/FormField.js';

import { AdminEmpty, formatMoney, formatTime } from './shared.js';

/** 退款申请表单的初值。同上：**不预填订单号**，也不默认勾上"例外"。 */
const EMPTY_REFUND_FORM: RefundRequestInput = {
  orderIdText: '',
  noteText: '',
  operatorApproved: false,
};

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
export function RefundsSection(props: { store: AdminStoreState }): React.JSX.Element {
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
