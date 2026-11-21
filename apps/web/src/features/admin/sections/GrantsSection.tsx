import { useState } from 'react';

import { useI18n, type MessageKey } from '@heyta/i18n/provider';

import type { AdminGrantRow } from '@heyta/app-host';

import {
  ADMIN_GRANT_NOTICE_KEY,
  ADMIN_PAGE_SIZE,
  EMPTY_GRANT_FORM,
  grantCodeKey,
  type AdminStoreState,
  type GrantFormInput,
} from '../store.js';

import { FormField } from '../../../lib/form/FormField.js';

import { AdminEmpty, Pager, formatTime } from './shared.js';

/**
 * 发放记录的 `action` 词 → 词条 key。**穷举**，漏一个编译期就红。
 *
 * 🔴 词表住服务端（`subscription-grant-store.ts` 的 `SUBSCRIPTION_GRANT_ACTIONS`），
 * 这里那份是**手抄的键表**：客户端类型 `AdminGrantRow['action']` 只有三个成员，
 * 服务端加第四个词时这一处会红在类型上，而**不是**运行时显示一个空白格 ——
 * 这是这一族"客户端手抄服务端词表"里少数能被编译期抓住的一处。
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
 * 本面板只做四件机械的事：收集字符串 → 交给 store → 等一次读回 → 把读回的那几行念出来。
 *
 * ## 三个动作共用**一张**表单，因为它们是同一句话的三种时态
 *
 * 「送给这个人 30 天」「把他升到那一档」「收回这次发放」作用在**同一行**上。
 * 分三张表单会让运营在三处各填一次账号编号，而填错一次就发给错的人。
 *
 * ## 🔴 档位下拉里**不裁掉**交付不了的那一档
 *
 * 服务端那一格 `sellable` 是**这一刻**的实例状态（两道开关都能在重启后变），
 * 提前把它从下拉里抹掉的症状是"这一档根本不存在"，而真实情况是"现在发不了"。
 * 所以它留在列表里、带一个说明，选了也照样能点 —— 那一次 409 会带着
 * `SKU_NOT_DELIVERABLE` 回来，界面说出为什么。**看不见不是禁用，说得出才是。**
 *
 * ## 收回是**两步**
 *
 * 它会让一个人立刻失去一项他现在能用的能力。第一次点只出确认、一个请求都不发
 * （与公告下架、退款批准同一模式，`docs/agents/overlay-feedback.md` 危险那四档里的
 * 第三档：可逆但会打扰别人）。
 *
 * ⚠️ 这一格**不显示营收**。发放不建 `checkout_orders` 行，所以它结构上进不了
 * 营收看板（ADR-0076 §4.2）；把这两件事摆在同一屏会让人把赠送读成收入。
 */
export function GrantsSection({ store }: { store: AdminStoreState }): React.JSX.Element {
  const { t } = useI18n();
  const [form, setForm] = useState<GrantFormInput>(EMPTY_GRANT_FORM);
  // 收回是两步：第一次点只出确认，一个请求都不发。
  const [pendingRevoke, setPendingRevoke] = useState(false);

  const board = store.grantBoard;
  const history = store.grantHistory;
  const notice = store.grantNotice;
  const codeKey = store.grantCode === null ? null : grantCodeKey(store.grantCode);

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

  return (
    <div data-testid="admin-grants">
      {/* 🔴 这一句是**说明**，不是警告：用 `admin-notice` 那套红底会把它读成
          "现在有一个问题"。公告那一格用红色是对的（它说的真是危险：往所有人界面写明文），
          这一格说的只是"这三个动作各动什么"。同一套颜色在两格里必须是同一件事。 */}
      <p className="ht-settings__hint" data-testid="admin-grants-lead">
        {t('web.admin.grant.lead')}
      </p>
      {/* 🔴 前置与定义分开两格：上一格说"三种动作各动什么"，这一格说"哪一格得先有东西"。
          合成一长句的话，第二句会被读成修辞 —— 而它是 409 的唯一成因，
          运营要是在第一屏读不到它，就只能撞一次报错才知道顺序错了。 */}
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
        <h4 className="ht-settings__admin-h">{t('web.admin.grant.compose')}</h4>

        <FormField id="admin-grant-user" label={t('web.admin.grant.user')}>
          {(fieldProps) => (
            <input
              {...fieldProps}
              className="ht-settings__admin-input"
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
          <FormField id="admin-grant-sku" label={t('web.admin.grant.sku')}>
            {(fieldProps) => (
              <select
                {...fieldProps}
                className="ht-settings__admin-input"
                value={form.sku}
                onChange={(event) => setForm({ ...form, sku: event.target.value })}
              >
                <option value="">{t('web.admin.grant.skuPick')}</option>
                {board.skus.map((sku) => (
                  <option key={sku.priceId} value={sku.priceId}>
                    {sku.priceId}
                    {' · '}
                    {sku.grants.join(' / ')}
                    {/* 🔴 交付不了的那一档**留在列表里**，只多一个后缀（见文件头）。 */}
                    {sku.sellable ? '' : ` · ${t('web.admin.grant.skuUnsellable')}`}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        )}

        <FormField id="admin-grant-days" label={t('web.admin.grant.days')}>
          {(fieldProps) => (
            <input
              {...fieldProps}
              className="ht-settings__admin-input"
              type="text"
              inputMode="numeric"
              value={form.daysText}
              onChange={(event) => setForm({ ...form, daysText: event.target.value })}
            />
          )}
        </FormField>
        {/* 上界是**服务端随响应给的数**，不是这里抄的一份 —— 抄一份就是给下一次
            改上界时只改一处留一处留的位置。它只用于**说明**，不用于拦截。 */}
        {board !== null && (
          <p className="ht-settings__hint" data-testid="admin-grants-daysHint">
            {t('web.admin.grant.daysHint', { max: String(board.daysMax) })}
          </p>
        )}

        <FormField id="admin-grant-reason" label={t('web.admin.grant.reason')}>
          {(fieldProps) => (
            <input
              {...fieldProps}
              className="ht-settings__admin-input"
              type="text"
              value={form.reasonText}
              onChange={(event) => setForm({ ...form, reasonText: event.target.value })}
            />
          )}
        </FormField>

        <div className="ht-settings__admin-actions">
          {/* 唯一的那枚 submit：Enter 走的是"赠送订阅"，它是这一格的主动词。 */}
          <button type="submit" className="ht-settings__admin-btn">
            {t('web.admin.grant.publish')}
          </button>
          <button
            type="button"
            className="ht-settings__admin-btn"
            onClick={() => submit('upgrade')}
          >
            {t('web.admin.grant.upgrade')}
          </button>
          {pendingRevoke ? (
            <>
              <button
                type="button"
                className="ht-settings__admin-btn ht-settings__admin-btn--danger"
                onClick={() => submit('revoke')}
              >
                {t('web.admin.grant.revokeConfirm')}
              </button>
              <button
                type="button"
                className="ht-settings__admin-btn"
                onClick={() => setPendingRevoke(false)}
              >
                {t('web.admin.close')}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="ht-settings__admin-btn"
              onClick={() => setPendingRevoke(true)}
            >
              {t('web.admin.grant.revoke')}
            </button>
          )}
        </div>

        {notice !== null && (
          <p
            className={notice === 'denied' || notice === 'conflict' ? 'ht-settings__danger' : 'ht-settings__hint'}
            data-testid="admin-grants-notice"
          >
            {t(ADMIN_GRANT_NOTICE_KEY[notice])}
            {codeKey !== null ? ` ${t(codeKey)}` : ''}
          </p>
        )}
      </form>

      <h4 className="ht-settings__admin-h">{t('web.admin.grant.history')}</h4>
      {history === null ? (
        <p className="ht-settings__hint">{t('web.admin.loading')}</p>
      ) : history.length === 0 ? (
        <AdminEmpty titleKey="web.admin.grant.noneFound" />
      ) : (
        <div className="ht-settings__admin-list" data-testid="admin-grants-rows">
          {history.map((row) => (
            <div key={row.id} className="ht-settings__admin-row">
              <span className="ht-settings__admin-rowMain">
                {t(ADMIN_GRANT_ACTION_KEY[row.action])}
              </span>
              <span className="ht-settings__admin-static">
                {t('web.admin.grant.rowUser', { userId: String(row.userId) })}
              </span>
              <span className="ht-settings__admin-static">
                {row.sku === null
                  ? t('web.admin.grant.rowNoSku')
                  : `${row.sku}${row.days === null ? '' : ` · ${t('web.admin.grant.rowDays', { days: String(row.days) })}`}`}
              </span>
              <span className="ht-settings__admin-rowMeta">
                {formatTime(row.createdAt)}
                {' → '}
                {row.afterPeriodEnd === null
                  ? '—'
                  : t('web.admin.grant.rowUntil', { time: formatTime(row.afterPeriodEnd) })}
              </span>
              {/* 理由与操作者：这一格存在的意义就是"谁在什么时候为什么动过"，
                  少了这两样它就退化成一条状态流水。 */}
              <span className="ht-settings__admin-static">{row.reason}</span>
              <span className="ht-settings__admin-static">
                {t('web.admin.grant.rowActor', { actor: String(row.actorUserId) })}
              </span>
            </div>
          ))}
        </div>
      )}
      {/* 🔴 动作史是这一格里**唯一会长过一页**的列表（其余几格都是配置项，几十行封顶）。
          没有翻页时它的症状不是报错，是"看起来只有 50 条" —— 运营会以为一个人
          只被动过一次，而第 51 条正是他要查的那一次。页坐标用服务端回显的那一份。 */}
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
