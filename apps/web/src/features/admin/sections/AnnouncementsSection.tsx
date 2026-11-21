import { useState } from 'react';

import { useI18n, type MessageKey } from '@heyta/i18n/provider';

import type { AdminAnnouncementRow } from '@heyta/app-host';

import {
  EMPTY_ANNOUNCEMENT_FORM,
  type AdminStoreState,
  type AnnouncementFormInput,
} from '../store.js';

import { FormField } from '../../../lib/form/FormField.js';

import { AdminEmpty, formatTime } from './shared.js';

/** 公告那一格的状态词 → 词条 key。**穷举**，漏一个编译期就红。 */
const ANNOUNCEMENT_STATE_KEY: Record<AdminAnnouncementRow['state'], MessageKey> = {
  pending: 'web.admin.announcements.state.pending',
  active: 'web.admin.announcements.state.active',
  expired: 'web.admin.announcements.state.expired',
};

/**
 * 运营公告的写面（ADR-0075）。
 *
 * 🔴 这一片界面**不判**任何一件事该不该发：长度、`level` 词表、
 * "失效要晚于生效"全部由服务端那一次 `safeParse` 裁决。
 * 表单里那两个时刻控件给的是**运营者墙上时钟**，换算成 epoch 毫秒发生在 store
 * （那是设备本地事实，只有这台机器知道）。
 *
 * 🔴 第一句必须是"这是明文"。ADR-0075 §5.1 写的正是：这条通道对**所有用户**
 * 可见且不走端到端加密，而"别把口令写进去"这条约束如果只躺在一份没人读的
 * 决策记录里，它就等于不存在。
 */
export function AnnouncementsSection({
  store,
}: {
  store: AdminStoreState;
}): React.JSX.Element {
  const { t } = useI18n();
  const [form, setForm] = useState<AnnouncementFormInput>(EMPTY_ANNOUNCEMENT_FORM);
  // 下架是**两步**：第一次点只出确认、一个请求都不发（与退款批准同一模式）。
  const [pendingWithdrawId, setPendingWithdrawId] = useState<number | null>(null);

  const rows = store.announcements;

  return (
    <div data-testid="admin-announcements">
      <p className="ht-settings__admin-notice" data-testid="admin-announcements-plaintext">
        {t('web.admin.announcements.plaintextWarning')}
      </p>

      <form
        className="ht-settings__admin-detail"
        onSubmit={(event) => {
          event.preventDefault();
          void (async () => {
            const ok = await store.publishAnnouncement(form);
            if (ok) setForm(EMPTY_ANNOUNCEMENT_FORM);
          })();
        }}
      >
        <h4 className="ht-settings__admin-h">{t('web.admin.announcements.compose')}</h4>
        <input
          className="ht-settings__admin-input"
          value={form.titleText}
          placeholder={t('web.admin.announcements.title')}
          aria-label={t('web.admin.announcements.title')}
          onChange={(event) => setForm({ ...form, titleText: event.target.value })}
        />
        <textarea
          className="ht-settings__admin-input"
          rows={3}
          value={form.bodyText}
          placeholder={t('web.admin.announcements.body')}
          aria-label={t('web.admin.announcements.body')}
          onChange={(event) => setForm({ ...form, bodyText: event.target.value })}
        />
        <div className="ht-settings__admin-badges">
          {(['info', 'warning'] as const).map((level) => (
            <label key={level} className="ht-settings__admin-quota">
              <input
                type="radio"
                name="announcement-level"
                checked={form.level === level}
                onChange={() => setForm({ ...form, level })}
              />
              {t(level === 'info' ? 'web.admin.announcements.levelInfo' : 'web.admin.announcements.levelWarning')}
            </label>
          ))}
        </div>
        <div className="ht-settings__admin-badges">
          <FormField id="admin-publishes-at" label={t('web.admin.announcements.publishesAt')}>
            {(fieldProps) => (
              /* `datetime-local` 给的是**本地墙上时钟**，换算发生在 store。 */
              <input
                {...fieldProps}
                className="ht-settings__admin-input"
                type="datetime-local"
                value={form.publishesAtText}
                onChange={(event) => setForm({ ...form, publishesAtText: event.target.value })}
              />
            )}
          </FormField>
          <FormField id="admin-expires-at" label={t('web.admin.announcements.expiresAt')}>
            {(fieldProps) => (
              <input
                {...fieldProps}
                className="ht-settings__admin-input"
                type="datetime-local"
                value={form.expiresAtText}
                onChange={(event) => setForm({ ...form, expiresAtText: event.target.value })}
              />
            )}
          </FormField>
        </div>
        <div className="ht-settings__admin-actions">
          <button type="submit" className="ht-settings__admin-btn">
            {t('web.admin.announcements.publish')}
          </button>
        </div>
        {store.announcementNotice !== null && (
          <p
            className={store.announcementNotice === 'done' ? 'ht-settings__hint' : 'ht-settings__danger'}
            data-testid="admin-announcements-notice"
          >
            {t(store.announcementNotice === 'done' ? 'web.admin.action.done' : 'web.admin.action.failed')}
          </p>
        )}
      </form>

      <h4 className="ht-settings__admin-h">{t('web.admin.announcements.list')}</h4>
      {rows === null ? (
        <p className="ht-settings__hint">{t('web.admin.loading')}</p>
      ) : rows.length === 0 ? (
        <AdminEmpty titleKey="web.admin.announcements.noneFound" />
      ) : (
        <div className="ht-settings__admin-list">
          {rows.map((row) => (
            <div key={row.id} className="ht-settings__admin-row">
              <span className="ht-settings__admin-rowMain">{row.title}</span>
              <span className="ht-settings__admin-badges">
                <span
                  className={`ht-settings__admin-badge${
                    row.state === 'active' ? '' : ' ht-settings__admin-badge--danger'
                  }`}
                >
                  {t(ANNOUNCEMENT_STATE_KEY[row.state])}
                </span>
              </span>
              <span className="ht-settings__admin-rowMeta">
                {formatTime(row.publishedAt)}
                {' → '}
                {row.expiresAt === null ? t('web.admin.announcements.neverExpires') : formatTime(row.expiresAt)}
              </span>
              {pendingWithdrawId === row.id ? (
                <span className="ht-settings__admin-actions">
                  <button
                    type="button"
                    className="ht-settings__admin-btn ht-settings__admin-btn--danger"
                    onClick={() => {
                      setPendingWithdrawId(null);
                      void store.withdrawAnnouncement(row.id);
                    }}
                  >
                    {t('web.admin.announcements.withdrawConfirm')}
                  </button>
                  <button
                    type="button"
                    className="ht-settings__admin-btn"
                    onClick={() => setPendingWithdrawId(null)}
                  >
                    {t('web.admin.close')}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="ht-settings__admin-btn"
                  onClick={() => setPendingWithdrawId(row.id)}
                >
                  {t('web.admin.announcements.withdraw')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
