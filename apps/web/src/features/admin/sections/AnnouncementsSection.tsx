import { useState } from 'react';

import { useI18n, type MessageKey } from '@heyta/i18n/provider';

import type { AdminAnnouncementRow } from '@heyta/app-host';

import {
  EMPTY_ANNOUNCEMENT_FORM,
  type AdminStoreState,
  type AnnouncementFormInput,
} from '../store.js';

import {
  Badge,
  Button,
  DataTable,
  InlineFeedback,
  Select,
  type BadgeTone,
  type DataTableColumn,
  type SelectOption,
} from '../../../components/hta/index.js';

import { FormField } from '../../../lib/form/FormField.js';

import { formatTime } from './shared.js';

/** 公告那一格的状态词 → 词条 key。**穷举**，漏一个编译期就红。 */
const ANNOUNCEMENT_STATE_KEY: Record<AdminAnnouncementRow['state'], MessageKey> = {
  pending: 'web.admin.announcements.state.pending',
  active: 'web.admin.announcements.state.active',
  expired: 'web.admin.announcements.state.expired',
};

/**
 * 公告那一格的状态词 → 徽标语义色。**三态三色，不再两色合流**：
 *
 *   · `active`（挂着）→ `success`：它此刻对所有用户可见，是"生效中"的肯定态；
 *   · `pending`（还没生效）→ `warning`：排期已定但还没上线，是"等一等"的过渡态；
 *   · `expired`（已过期）→ `neutral`：历史归档，既不危险也不在途，是中性态。
 *
 * 🔴 旧实现里 `pending` 与 `expired` 都套 `--danger`，三态只用两色 —— 语义上把
 * "将要生效"和"已经失效"念成了同一种坏消息。这里按 `state` **穷举**映射：
 * `AdminAnnouncementRow['state']` 加第四个词时，这张表会在编译期红。
 */
const ANNOUNCEMENT_STATE_TONE: Record<AdminAnnouncementRow['state'], BadgeTone> = {
  pending: 'warning',
  active: 'success',
  expired: 'neutral',
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
 *
 * 结构（`.local/admin-redesign/05-reuse-map.md`、`02-admin-ia.md` §3.9）：
 *   · 表单：标题/正文走 `FormField`（不再手写 `.ht-settings__admin-input` + 裸 `<label>`），
 *     `level` 用 hta `Select`（info/warning，替代原来那组原生 radio）；
 *   · 列表：换成 hta `DataTable`（表头/列/对齐，三态由它内部 `ListState` 承担），
 *     `state` 徽标改用 `Badge` 语义色区分；
 *   · 下架：仍走**两步确认**（第一次点只出确认、一个请求都不发），确认按钮 `danger` + `commit`；
 *   · 发布/下架的成败回执：`InlineFeedback` 渲染 store 的统一 `feedback` 通道。
 */
export function AnnouncementsSection({
  store,
}: {
  store: AdminStoreState;
}): React.JSX.Element {
  const { t } = useI18n();
  const [form, setForm] = useState<AnnouncementFormInput>(EMPTY_ANNOUNCEMENT_FORM);
  // 下架是**两步**：第一次点只出确认、一个请求都不发（与退款批准同一模式）。
  // ⚠️ 变量名 `pendingWithdrawId` 已登记在 `check-selection-single-source` 的
  //    行 id 类别表（confirm-gate），改名会让那条豁免变成"过期豁免"而判红。
  const [pendingWithdrawId, setPendingWithdrawId] = useState<number | null>(null);

  const announcements = store.announcements;
  // 首屏（还没拉过、也没有失败）→ 骨架；失败 → ErrorState。刷新已知条数时不叠骨架。
  const firstLoad = announcements === null && store.errorKey === null;
  const listError =
    announcements === null && store.errorKey !== null
      ? { title: t(store.errorKey as MessageKey), retryLabel: t('web.admin.retry') }
      : null;

  const levelOptions: readonly SelectOption[] = [
    { value: 'info', label: t('web.admin.announcements.levelInfo') },
    { value: 'warning', label: t('web.admin.announcements.levelWarning') },
  ];

  const columns: readonly DataTableColumn<AdminAnnouncementRow>[] = [
    {
      key: 'title',
      header: t('web.admin.announcements.title'),
      render: (row) => row.title,
    },
    {
      key: 'body',
      header: t('web.admin.announcements.body'),
      render: (row) => row.body,
    },
    {
      key: 'state',
      header: t('web.admin.table.status'),
      render: (row) => (
        <Badge tone={ANNOUNCEMENT_STATE_TONE[row.state]}>
          {t(ANNOUNCEMENT_STATE_KEY[row.state])}
        </Badge>
      ),
    },
    {
      key: 'publishedAt',
      header: t('web.admin.announcements.liveFrom'),
      render: (row) => formatTime(row.publishedAt),
    },
    {
      key: 'expiresAt',
      header: t('web.admin.table.expires'),
      render: (row) =>
        row.expiresAt === null
          ? t('web.admin.announcements.neverExpires')
          : formatTime(row.expiresAt),
    },
    {
      key: 'actions',
      // 动作列表头留空：按钮文字本身说明动作，不需要列标题。
      header: '',
      align: 'end',
      render: (row) =>
        pendingWithdrawId === row.id ? (
          <span className="ht-settings__admin-actions">
            <Button
              size="sm"
              tone="danger"
              commit
              disabled={store.pending.announcementWithdraw}
              onClick={() => {
                setPendingWithdrawId(null);
                void store.withdrawAnnouncement(row.id);
              }}
            >
              {t('web.admin.announcements.withdrawConfirm')}
            </Button>
            <Button size="sm" tone="secondary" onClick={() => setPendingWithdrawId(null)}>
              {t('web.admin.close')}
            </Button>
          </span>
        ) : (
          <Button size="sm" tone="danger" onClick={() => setPendingWithdrawId(row.id)}>
            {t('web.admin.announcements.withdraw')}
          </Button>
        ),
    },
  ];

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
        <h4 className="ht-settings__admin-h5">{t('web.admin.announcements.compose')}</h4>

        <FormField id="admin-announcement-title" label={t('web.admin.announcements.title')}>
          {(fieldProps) => (
            <input
              {...fieldProps}
              type="text"
              value={form.titleText}
              onChange={(event) => setForm({ ...form, titleText: event.target.value })}
            />
          )}
        </FormField>

        <FormField id="admin-announcement-body" label={t('web.admin.announcements.body')}>
          {(fieldProps) => (
            <textarea
              {...fieldProps}
              rows={3}
              value={form.bodyText}
              onChange={(event) => setForm({ ...form, bodyText: event.target.value })}
            />
          )}
        </FormField>

        <Select
          id="admin-announcement-level"
          label={t('web.admin.announcements.level')}
          value={form.level}
          options={levelOptions}
          onChange={(value) => setForm({ ...form, level: value === 'warning' ? 'warning' : 'info' })}
        />

        <FormField id="admin-publishes-at" label={t('web.admin.announcements.publishesAt')}>
          {(fieldProps) => (
            /* `datetime-local` 给的是**本地墙上时钟**，换算发生在 store。 */
            <input
              {...fieldProps}
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
              type="datetime-local"
              value={form.expiresAtText}
              onChange={(event) => setForm({ ...form, expiresAtText: event.target.value })}
            />
          )}
        </FormField>

        <div className="ht-settings__admin-actions">
          <Button type="submit" tone="primary" disabled={store.pending.announcementPublish}>
            {t('web.admin.announcements.publish')}
          </Button>
        </div>

        {/* 回执只有一个来源：store 的统一 `feedback`（写动作成功/失败时与旧 `announcementNotice`
            同时写入）。用 `announcementNotice` 作门，避免把别的分区的 feedback 串到这里来。 */}
        {store.announcementNotice !== null && store.feedback !== null && (
          <InlineFeedback tone={store.feedback.tone} testID="admin-announcements-notice">
            {t(store.feedback.message as MessageKey)}
          </InlineFeedback>
        )}
      </form>

      <h4 className="ht-settings__admin-h5">{t('web.admin.announcements.list')}</h4>
      <DataTable
        columns={columns}
        rows={announcements ?? []}
        rowKey={(row) => String(row.id)}
        loading={firstLoad}
        error={listError}
        onRetry={() => {
          void store.loadAnnouncements();
        }}
        emptyTitle={t('web.admin.announcements.noneFound')}
        caption={t('web.admin.announcements.list')}
        testID="admin-announcements-table"
      />
    </div>
  );
}
