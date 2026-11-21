import { useEffect, useState } from 'react';

import { useI18n, type MessageKey } from '@heyta/i18n/provider';

import type { AdminGrantRow } from '@heyta/app-host';

import {
  Button,
  DataTable,
  FilterBar,
  InlineFeedback,
  Select,
  type DataTableColumn,
  type SelectOption,
} from '../../../components/hta/index.js';

import { MenuItem, MenuSection } from '../../../lib/menu/AnchoredMenu.js';

import {
  ADMIN_PAGE_SIZE,
  EMPTY_GRANT_FORM,
  capabilityLabelKey,
  grantCodeKey,
  type AdminStoreState,
  type GrantFormInput,
} from '../store.js';

import { FormField } from '../../../lib/form/FormField.js';

import { Pager, formatTime } from './shared.js';

/**
 * 发放记录的 `action` 词 → 词条 key。**穷举**，漏一个编译期就红。
 *
 * 🔴 词表住服务端（`subscription-grant-store.ts` 的 `SUBSCRIPTION_GRANT_ACTIONS`），
 * 这里那份是**手抄的键表**：客户端类型 `AdminGrantRow['action']` 只有三个成员，
 * 服务端加第四个词时这一处会红在类型上，而**不是**运行时显示一个空白格。
 */
const ADMIN_GRANT_ACTION_KEY: Record<AdminGrantRow['action'], MessageKey> = {
  grant: 'web.admin.grant.action.grant',
  upgrade: 'web.admin.grant.action.upgrade',
  revoke: 'web.admin.grant.action.revoke',
};

/**
 * 「发放」面板 —— 三种订阅发放（ADR-0076）。
 * ============================================================================
 *
 * 🔴 **这里一片判定都没有。** 能不能发这一档、他有没有发放行、这次动作动没动时间，
 * 全部住在 `server/src/admin/subscription-grant-store.ts` 那三道闸门里。
 * 本面板只做机械的事：收集字符串 → 交给 store → 等一次读回 → 把读回的那几行念出来。
 *
 * 迁移口径（`.local/admin-redesign/05-reuse-map.md` §3/§4/§10/§12、
 * `02-admin-ia.md` §3.4）：
 *   · 三个动作共用**一张**表单（同一句话的三种时态），输入一律走 `FormField`；
 *   · 档位下拉换成 hta `Select`（`value` 仍是 `priceId`，但 `label` 念人类可读的档名，
 *     不可交付的那一档**留在列表里**、只多一个后缀）；
 *   · 三个动作按钮用 hta `Button` 区分主次（赠送 = primary，升级 = secondary，
 *     收回 = ghost），并按 `store.pending.*` 逐枚禁用；
 *   · 收回仍是**两步**：第一次点一个请求都不发，确认那枚走 danger + commit 实底；
 *   · 发放记录从「无表头 flex 行」换成 `DataTable`（表头/列/对齐 + 三态）；
 *   · 回执统一走 `InlineFeedback`，渲染 `store.feedback`（审计 R1 的唯一回执原语）。
 *
 * ## 🔴 档位下拉里**不裁掉**交付不了的那一档
 *
 * 服务端那一格 `sellable` 是**这一刻**的实例状态（两道开关都能在重启后变），
 * 提前把它从下拉里抹掉的症状是"这一档根本不存在"，而真实情况是"现在发不了"。
 * 它留在列表里、带一个说明，选了也照样能点 —— 那一次 409 会带着
 * `SKU_NOT_DELIVERABLE` 回来，界面说出为什么。**看不见不是禁用，说得出才是。**
 *
 * ⚠️ 这一格**不显示营收**：发放不建 `checkout_orders` 行，结构上进不了营收看板
 * （ADR-0076 §4.2）；把这两件事摆在同一屏会让人把赠送读成收入。
 */
export function GrantsSection({ store }: { store: AdminStoreState }): React.JSX.Element {
  const { t } = useI18n();
  const [form, setForm] = useState<GrantFormInput>(EMPTY_GRANT_FORM);
  // 收回是两步：第一次点只出确认，一个请求都不发。
  const [pendingRevoke, setPendingRevoke] = useState(false);
  // 发放记录按账号编号筛选：`filterDraft` 是输入框草稿，`filterApplied` 是上一次已应用的值。
  const [filterDraft, setFilterDraft] = useState('');
  const [filterApplied, setFilterApplied] = useState('');

  // 🔴 统一反馈通道是全后台共用的一份（`store.feedback`），而 `setActiveTab` 目前只清
  // 五个 `*Notice`、**不清 feedback**。进入本格先清一次，免得上一格的回执漏到这里。
  // TODO(store): `setActiveTab` 应调用一次 `clearFeedback()`（见交付说明④），
  // 否则切到没有动作发生的分区时，上一格的回执仍会挂着。
  useEffect(() => {
    store.clearFeedback();
  }, [store.clearFeedback]);

  const board = store.grantBoard;
  const history = store.grantHistory;
  const feedback = store.feedback;
  const codeKey = store.grantCode === null ? null : grantCodeKey(store.grantCode);

  // 首屏（还没拉过、也没失败）→ 骨架；失败 → ErrorState。刷新已知条数时不叠骨架。
  const firstLoad = history === null && store.errorKey === null;
  const listError =
    history === null && store.errorKey !== null
      ? { title: t(store.errorKey as MessageKey), retryLabel: t('web.admin.retry') }
      : null;

  /**
   * 档位下拉项。
   *
   * 🔴 `value` 存 `priceId`（服务端按它找档），`label` 念**人类可读的档名**：
   * 把 `grants`（能力码）翻成 `ADMIN_CAPABILITY_KEY` 的中文，认不出的码原样念
   * （一个没翻译的码是"这里要加词条"的响亮提示，编一个中文名是安静的错）。
   * TODO(store): `AdminGrantSku` 目前只有 `priceId + grants + sellable`、没有独立的
   * 展示名字段；要一处给"档名"而不是靠能力名拼，需 app-host 的 SKU 投影补 `name`。
   */
  const skuOptions: readonly SelectOption[] =
    board === null
      ? []
      : board.skus.map((sku) => {
          const readable = sku.grants
            .map((grant) => {
              const key = capabilityLabelKey(grant);
              return key === null ? grant : t(key);
            })
            .join(' · ');
          const name = readable === '' ? sku.priceId : `${sku.priceId} · ${readable}`;
          return {
            value: sku.priceId,
            label: sku.sellable ? name : `${name} · ${t('web.admin.grant.skuUnsellable')}`,
          };
        });

  const submit = (action: 'grant' | 'upgrade' | 'revoke'): void => {
    void (async () => {
      const run =
        action === 'grant'
          ? store.grantSubscription(form)
          : action === 'upgrade'
            ? store.upgradeGrant(form)
            : store.revokeGrant(form);
      const ok = await run;
      // 只有**真的成了**才清表单；被拒时留着，运营改一格再点的应该是他刚填的那几格。
      if (ok) {
        setForm(EMPTY_GRANT_FORM);
        setPendingRevoke(false);
      }
    })();
  };

  /**
   * 应用「按账号编号筛选」。
   *
   * TODO(store): `loadGrantHistory` 目前只接受 `offset`，不发 `userId`；服务端与
   * `fetchAdminSubscriptionGrants` 都已支持 `userId` 参数，缺的是 store 把
   * `filterApplied` 透传进去（并保存该筛选值供翻页沿用，参考 `refundFilter`）。
   * 在 store 补齐之前，这里只按当前筛选重读第一页，**不发送 userId**（见交付说明④）。
   */
  const applyUserFilter = (): void => {
    setFilterApplied(filterDraft.trim());
    void store.loadGrantHistory(0);
  };

  const columns: readonly DataTableColumn<AdminGrantRow>[] = [
    {
      key: 'action',
      header: t('web.admin.table.action'),
      render: (row) => t(ADMIN_GRANT_ACTION_KEY[row.action]),
    },
    {
      key: 'user',
      header: t('web.admin.grant.user'),
      render: (row) => t('web.admin.grant.rowUser', { userId: String(row.userId) }),
    },
    {
      key: 'sku',
      header: t('web.admin.grant.sku'),
      render: (row) =>
        row.sku === null
          ? t('web.admin.grant.rowNoSku')
          : `${row.sku}${row.days === null ? '' : ` · ${t('web.admin.grant.rowDays', { days: String(row.days) })}`}`,
    },
    {
      key: 'createdAt',
      header: t('web.admin.table.created'),
      render: (row) => formatTime(row.createdAt),
    },
    {
      key: 'afterPeriodEnd',
      header: t('web.admin.table.expires'),
      render: (row) =>
        row.afterPeriodEnd === null
          ? '—'
          : t('web.admin.grant.rowUntil', { time: formatTime(row.afterPeriodEnd) }),
    },
    {
      key: 'reason',
      header: t('web.admin.table.reason'),
      render: (row) => row.reason,
    },
    {
      key: 'actor',
      header: t('web.admin.table.actor'),
      render: (row) => t('web.admin.grant.rowActor', { actor: String(row.actorUserId) }),
    },
  ];

  return (
    <div data-testid="admin-grants">
      {/* 🔴 这一句是**说明**，不是警告（用 `ht-settings__hint` 而不是红底那套）。 */}
      <p className="ht-settings__hint" data-testid="admin-grants-lead">
        {t('web.admin.grant.lead')}
      </p>
      {/* 🔴 前置与定义分开两格：这一格说"哪一格得先有东西"，它是 409 的唯一成因。 */}
      <p className="ht-settings__hint" data-testid="admin-grants-precondition">
        {t('web.admin.grant.precondition')}
      </p>

      <form
        className="ht-settings__admin-detail"
        onSubmit={(event) => {
          event.preventDefault();
          submit('grant');
        }}
      >
        <h4 className="ht-settings__admin-h4">{t('web.admin.grant.compose')}</h4>

        <FormField id="admin-grant-user" label={t('web.admin.grant.user')}>
          {(field) => (
            <input
              {...field}
              type="text"
              inputMode="numeric"
              value={store.grantTarget}
              onChange={(event) => {
                store.setGrantTarget(event.target.value);
              }}
            />
          )}
        </FormField>

        {board === null ? (
          <p className="ht-settings__hint">{t('web.admin.loading')}</p>
        ) : (
          <Select
            id="admin-grant-sku"
            label={t('web.admin.grant.sku')}
            value={form.sku}
            onChange={(value) => setForm({ ...form, sku: value })}
            options={skuOptions}
            placeholder={t('web.admin.grant.skuPick')}
          />
        )}

        <FormField id="admin-grant-days" label={t('web.admin.grant.days')}>
          {(field) => (
            <input
              {...field}
              type="text"
              inputMode="numeric"
              value={form.daysText}
              onChange={(event) => setForm({ ...form, daysText: event.target.value })}
            />
          )}
        </FormField>
        {/* 上界是**服务端随响应给的数**，不是这里抄的一份 —— 只用于说明，不用于拦截。 */}
        {board !== null && (
          <p className="ht-settings__hint" data-testid="admin-grants-daysHint">
            {t('web.admin.grant.daysHint', { max: String(board.daysMax) })}
          </p>
        )}

        <FormField id="admin-grant-reason" label={t('web.admin.grant.reason')}>
          {(field) => (
            <input
              {...field}
              type="text"
              value={form.reasonText}
              onChange={(event) => setForm({ ...form, reasonText: event.target.value })}
            />
          )}
        </FormField>

        <div className="ht-settings__admin-actions">
          {/* 唯一的那枚 submit：Enter 走的是"赠送订阅"，它是这一格的主动词。 */}
          <Button type="submit" tone="primary" disabled={store.pending.grant}>
            {t('web.admin.grant.publish')}
          </Button>
          <Button
            type="button"
            tone="secondary"
            disabled={store.pending.upgrade}
            onClick={() => submit('upgrade')}
          >
            {t('web.admin.grant.upgrade')}
          </Button>
          {pendingRevoke ? (
            <>
              <Button
                type="button"
                tone="danger"
                commit
                disabled={store.pending.revoke}
                onClick={() => submit('revoke')}
              >
                {t('web.admin.grant.revokeConfirm')}
              </Button>
              <Button type="button" tone="secondary" onClick={() => setPendingRevoke(false)}>
                {t('web.admin.close')}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              tone="ghost"
              disabled={store.pending.revoke}
              onClick={() => setPendingRevoke(true)}
            >
              {t('web.admin.grant.revoke')}
            </Button>
          )}
        </div>

        {feedback !== null && (
          <InlineFeedback tone={feedback.tone} testID="admin-grants-notice">
            {t(feedback.message as MessageKey) + (codeKey !== null ? ` ${t(codeKey)}` : '')}
          </InlineFeedback>
        )}
      </form>

      <h4 className="ht-settings__admin-h4">{t('web.admin.grant.history')}</h4>

      {/* 唯一筛选入口：按账号编号筛选发放记录（服务端已支持 `userId`）。
          TODO(store): 真正把筛选值送上去需要 store 支持（见 `applyUserFilter` 与交付说明④）。 */}
      <FilterBar
        label={t('web.admin.refund.filter')}
        activeCount={filterApplied === '' ? 0 : 1}
        testID="admin-grants-filter"
      >
        <MenuSection>{t('web.admin.grant.user')}</MenuSection>
        <FormField id="admin-grants-filter-user" label={t('web.admin.grant.user')} layout="inline">
          {(field) => (
            <input
              {...field}
              type="text"
              inputMode="numeric"
              value={filterDraft}
              onChange={(event) => setFilterDraft(event.target.value)}
              // 面板是 role="menu"，键要留给这个输入框，不能被菜单的方向键/类型查找截走。
              onKeyDown={(event) => event.stopPropagation()}
            />
          )}
        </FormField>
        <MenuItem onSelect={applyUserFilter} testID="admin-grants-filter-apply">
          {t('web.admin.filter.apply')}
        </MenuItem>
      </FilterBar>

      <DataTable<AdminGrantRow>
        columns={columns}
        rows={history ?? []}
        rowKey={(row) => String(row.id)}
        loading={firstLoad}
        error={listError}
        onRetry={() => {
          void store.loadGrantHistory(store.grantHistoryOffset);
        }}
        emptyTitle={t('web.admin.grant.noneFound')}
        caption={t('web.admin.grant.history')}
        testID="admin-grants-rows"
      />

      {/* 🔴 动作史是这一格里**唯一会长过一页**的列表；页坐标用服务端回显的那一份。 */}
      {history !== null && (
        <Pager
          total={store.grantHistoryTotal}
          offset={store.grantHistoryOffset}
          onPrev={() => {
            void store.loadGrantHistory(Math.max(0, store.grantHistoryOffset - ADMIN_PAGE_SIZE));
          }}
          onNext={() => {
            void store.loadGrantHistory(store.grantHistoryOffset + ADMIN_PAGE_SIZE);
          }}
        />
      )}
    </div>
  );
}
