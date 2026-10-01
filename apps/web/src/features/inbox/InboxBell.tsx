/**
 * 通知中心 / 活动 的侧栏入口与面板。
 *
 * ## 形态（照滴答清单的实测形态）
 *
 * ```
 *   rail 底部          点开之后
 *   ┌────────┐        ┌──────────────────────────────┐
 *   │ 🔔 通知 │  ──▶   │      [ 通知 | 活动 ]          │
 *   │    (3) │        ├──────────────────────────────┤
 *   │ ❓ 帮助 │        │ ✅ 邀请奖励已发放   09-26     │
 *   └────────┘        │    star 成功激活，5 天…       │
 *                     └──────────────────────────────┘
 * ```
 *
 * ## 🔴 三件必须做对、否则门禁/验收会红的事
 *
 * 1. **触发器不能是 `role="tab"`。** `e2e/tests/smoke.spec.ts` 与
 *    `motivation.spec.ts` 把 rail 上的 tab 数量与文案**逐字**钉住了
 *    （10 个、顺序固定）。这是一个**动作**（打开面板），不是"去哪看"，
 *    与旁边的「帮助」同类 —— 所以它是普通 `<button>`。
 *    面板里的「通知 / 活动」倒是真的 tablist，但面板关着时**不在 DOM 里**
 *    （条件渲染），所以那两条断言扫不到它。
 *
 * 2. **面板必须是 `position: fixed`。** `nav.ht-rail` 有 `overflow-y: auto`，
 *    也就是一个裁剪容器；`position: absolute` 的面板会被它切掉右侧。
 *    这里的面板宽得多，所以改用 fixed —— 锚点由 CSS 从
 *    `--ht-layout-rail-width` 算出来，不靠 JS 量尺寸。
 *    （`.ht-accountmenu__panel` 曾经就是这样被切 16px；2026-09-30 它也改成了
 *    fixed，但锚点是实测的 —— 那个菜单在塌缩态要向上弹，算不出固定坐标。）
 *
 * 3. **文案全部走词条表**，且不出现 `JSON` / `null` 这类被禁的词。
 *
 * ## 无障碍
 *
 * - 触发器：`aria-haspopup="dialog"` + `aria-expanded`，未读时把数量并进
 *   accessible name（徽标本身是 `aria-hidden` 的装饰）；
 * - 面板：`role="dialog"` + `aria-label`，里面是标准 `role="tablist"`，
 *   tab 与 `tabpanel` 用 `id`/`aria-controls`/`aria-labelledby` 成对关联；
 * - Escape **挂在 document 上**（而不是像 `AccountMenu` 那样只挂在元素上）：
 *    面板是一个对话框，点完一条通知后焦点可能已经不在里面了，
 *    这时 Escape 仍然应该能关掉它。
 */
import { useEffect, useRef, useState } from 'react';

import {
  formatCompactDate,
  parseNotificationPayload,
  type ReferralActivatedPayload,
} from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { EmptyState, HeytaUiProvider } from '@heyta/ui';
import { Bell, CheckCheck, X } from 'lucide-react';

import type { AccountNotificationItem, CampaignItem } from '@heyta/app-host';

import { InviteActivityCard } from './InviteActivityCard.js';
import { useInboxStore } from './store.js';

type InboxTab = 'notifications' | 'activity';

/** 面板里两个 Tab 的顺序。顺序变了 `data-testid` 也跟着变，测试能看见。 */
const TABS = ['notifications', 'activity'] as const satisfies readonly InboxTab[];

const TAB_LABEL_KEY = {
  notifications: 'web.inbox.tab.notifications',
  activity: 'web.inbox.tab.activity',
} as const;

/** 一条"能渲染出来"的通知：kind 已知且载荷通过了边界校验。 */
interface RenderableNotification {
  readonly item: AccountNotificationItem;
  readonly payload: ReferralActivatedPayload;
}

/**
 * 把原始列表过滤成**能渲染的**那些。
 *
 * 🔴 未知 `kind`（服务端新加的事件，老客户端看不懂）与坏载荷都**整条丢掉**，
 * 而不是画出一张标题正文全空的卡片 —— 那看起来像界面坏了，
 * 而真实原因只是"这条我看不懂"。
 *
 * ⚠️ 因此**不能拿 `notifications.length` 当"有没有内容"的判据**：
 * 一个全是未知 kind 的列表长度是 3，而屏幕上一条都渲染不出来。
 */
function toRenderable(
  notifications: readonly AccountNotificationItem[],
): readonly RenderableNotification[] {
  const out: RenderableNotification[] = [];
  for (const item of notifications) {
    const payload = parseNotificationPayload(item.kind, item.payload);
    if (payload !== null) out.push({ item, payload });
  }
  return out;
}

function NotificationRow({
  entry,
  testID,
}: {
  entry: RenderableNotification;
  testID: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const { item, payload } = entry;

  const body =
    payload.displayName === null
      ? t('web.inbox.notification.referral.bodyUnknownActor', { days: payload.days })
      : t('web.inbox.notification.referral.body', {
          name: payload.displayName,
          days: payload.days,
        });

  return (
    <li
      className={`ht-inbox__item${item.readAt === null ? ' ht-inbox__item--unread' : ''}`}
      data-testid={testID}
      data-read={item.readAt === null ? 'false' : 'true'}
    >
      <span className="ht-inbox__item-icon" aria-hidden="true">
        <CheckCheck size={18} />
      </span>
      <div className="ht-inbox__item-main">
        <div className="ht-inbox__item-head">
          <span className="ht-inbox__item-title">
            {t('web.inbox.notification.referral.title')}
          </span>
          <span className="ht-inbox__item-date">
            {formatCompactDate(item.createdAt, Date.now())}
          </span>
        </div>
        <p className="ht-inbox__item-body">{body}</p>
      </div>
    </li>
  );
}

/**
 * 「读不到」的提示。
 *
 * 🔴 `unconfigured`（没配服务器）与 `unavailable`（配了但读不到）**分开说**。
 * 合并成一句"加载失败"会让一个自托管用户去排查一个根本不存在的故障 ——
 * 他的问题其实是"还没填地址"。
 */
function LoadNotice({
  state,
  testID,
  onRetry,
}: {
  state: 'unconfigured' | 'unavailable';
  testID: string;
  onRetry: () => void;
}): React.JSX.Element {
  const { t } = useI18n();

  if (state === 'unconfigured') {
    return (
      <p className="ht-inbox__notice" data-testid={`${testID}-unconfigured`}>
        {t('web.inbox.unconfigured')}
      </p>
    );
  }

  return (
    <div className="ht-inbox__notice" data-testid={`${testID}-unavailable`}>
      <span>{t('web.inbox.error')}</span>
      <button
        type="button"
        className="ht-inbox__action"
        data-testid={`${testID}-retry`}
        onClick={onRetry}
      >
        {t('web.inbox.retry')}
      </button>
    </div>
  );
}

function NotificationsTab({
  testID,
  notifications,
  state,
  loading,
  onRetry,
}: {
  testID: string;
  notifications: readonly AccountNotificationItem[];
  state: 'ready' | 'unconfigured' | 'unavailable' | null;
  loading: boolean;
  onRetry: () => void;
}): React.JSX.Element {
  const { t } = useI18n();

  if (state === 'unconfigured' || state === 'unavailable') {
    return <LoadNotice state={state} testID={testID} onRetry={onRetry} />;
  }

  if (state === null && loading) {
    return (
      <p className="ht-inbox__notice" data-testid={`${testID}-loading`}>
        {t('web.inbox.loading')}
      </p>
    );
  }

  const rows = toRenderable(notifications);

  if (rows.length === 0) {
    // 🔴 空态走**共享那一个实现**（`packages/ui` 的 `EmptyState`），
    // 不在视图里手写骨架与文案（`check:empty-state` 的判据 3）。
    // ⚠️ 这里传的是共享组件的 `testID` **属性**，不是自己写的 testid 字面量：
    // `check:empty-state` 用字面形态识别"手写站点"，而收编后的站点
    // 应当把原来的定位钩子（`…-empty`）传进 `testID`。
    // （这条注释本身也不能把那串字面量写出来 —— 那道门禁是**纯文本**匹配的。）
    return (
      // ⚠️ 刻意**不传 `icon`**：共享 `EmptyState` 的四个槽位里只有 `title`
      // 必填，而"居中一句"正是滴答空态的实测形态（`model.ts` 的文件头）。
      // 传图标要 `lucide` 的图标**数据**（`packages/ui` 用的那个包），
      // 而本项目只依赖 `lucide-react`（组件）—— 为一句空态多引一个依赖不值。
      <EmptyState title={t('web.inbox.notifications.empty')} testID={`${testID}-empty`} />
    );
  }

  return (
    <ul className="ht-inbox__list" data-testid={`${testID}-list`}>
      {rows.map((entry) => (
        <NotificationRow
          key={entry.item.id}
          entry={entry}
          testID={`${testID}-item-${String(entry.item.id)}`}
        />
      ))}
    </ul>
  );
}

function ActivityTab({
  testID,
  campaigns,
  state,
  loading,
  onRetry,
}: {
  testID: string;
  campaigns: readonly CampaignItem[];
  state: 'ready' | 'unconfigured' | 'unavailable' | null;
  loading: boolean;
  onRetry: () => void;
}): React.JSX.Element {
  const { t } = useI18n();

  if (state === 'unconfigured' || state === 'unavailable') {
    return <LoadNotice state={state} testID={testID} onRetry={onRetry} />;
  }

  if (state === null && loading) {
    return (
      <p className="ht-inbox__notice" data-testid={`${testID}-activity-loading`}>
        {t('web.inbox.loading')}
      </p>
    );
  }

  const invite = campaigns.find((c) => c.kind === 'invite' && c.invite !== undefined);

  if (invite?.invite === undefined) {
    return (
      <EmptyState
        title={t('web.inbox.activity.empty')}
        testID={`${testID}-activity-empty`}
      />
    );
  }

  return <InviteActivityCard activity={invite.invite} testID={`${testID}-invite`} />;
}

export function InboxBell({
  testID = 'inbox',
}: {
  testID?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<InboxTab>('notifications');
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const notifications = useInboxStore((s) => s.notifications);
  const unreadCount = useInboxStore((s) => s.unreadCount);
  const notificationsState = useInboxStore((s) => s.notificationsState);
  const campaigns = useInboxStore((s) => s.campaigns);
  const activityState = useInboxStore((s) => s.activityState);
  const loadingNotifications = useInboxStore((s) => s.loadingNotifications);
  const loadingActivity = useInboxStore((s) => s.loadingActivity);
  const refreshNotifications = useInboxStore((s) => s.refreshNotifications);
  const refreshActivity = useInboxStore((s) => s.refreshActivity);
  const markAllRead = useInboxStore((s) => s.markAllRead);

  // 挂载时拉一次：**徽标在面板关着的时候也要显示未读数**。
  useEffect(() => {
    void refreshNotifications();
  }, [refreshNotifications]);

  // 每次打开都刷新一次通知（面板是用户主动打开的，看到旧数据没有意义）。
  useEffect(() => {
    if (!open) return;
    void refreshNotifications();
  }, [open, refreshNotifications]);

  // 🔴 活动**只在「活动」Tab 真的被打开时**才拉。服务端那次 GET 会惰性创建
  //    这个账号的邀请码，所以"每个用户每次打开应用都拉一次活动"等于
  //    "给每个用户都写一行邀请码" —— 包括永远不邀请人的人。
  useEffect(() => {
    if (!open || tab !== 'activity') return;
    void refreshActivity();
  }, [open, tab, refreshActivity]);

  // 点外面关掉。用 `mousedown` 而不是 `click`（拖动选中文本时不会触发 click）。
  // ⚠️ 这里要判**两个** ref：触发器与面板是兄弟节点（没有共同的外层 div），
  // 见下面"为什么不套一层 wrapper"的说明。
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      const inside =
        triggerRef.current?.contains(target) === true ||
        panelRef.current?.contains(target) === true;
      if (!inside) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  // Escape 关掉。挂在 document 上 —— 见文件头"无障碍"一节。
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const triggerLabel =
    unreadCount > 0
      ? `${t('web.inbox.trigger')} (${t('web.inbox.badge.aria', { count: unreadCount })})`
      : t('web.inbox.trigger');

  const panelId = `${testID}-panel-region`;

  /**
   * 🔴 **刻意不套一层 wrapper `div`。**
   *
   * `nav.ht-rail` 的"贴底"是靠 `.ht-rail__tab--tool:first-of-type { margin-top: auto }`
   * 实现的：它选中父元素里**第一个 `<button>`**。如果把触发器包进一个 div，
   * 那个 div 不是 button，于是拿到 `margin-top: auto` 的仍然是后面的「帮助」——
   * 铃铛就会被留在列表正下方、和帮助按钮之间裂开一大块空白。
   *
   * 作为**直接子按钮**，铃铛自己就吃到了 `:first-of-type`（它在帮助之前），
   * 两个一起贴底，且不需要我去覆盖任何既有规则。
   */
  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        data-testid={`${testID}-trigger`}
        className="ht-rail__tab ht-rail__tab--tool"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={triggerLabel}
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        <Bell size={16} aria-hidden="true" />
        {/* rail 是纯图标：这个名字在 hover / 聚焦时才显示（`app.css` 的 `.ht-rail__label`）。
            未读数走右上角的徽标，accessible name 由上面的 `aria-label` 给出。 */}
        <span className="ht-rail__label">{t('web.inbox.trigger')}</span>
        {unreadCount > 0 ? (
          <span
            className="ht-inbox__badge"
            data-testid={`${testID}-badge`}
            aria-hidden="true"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          ref={panelRef}
          aria-label={t('web.inbox.aria')}
          className="ht-inbox__panel"
          data-testid={`${testID}-panel`}
        >
          <div className="ht-inbox__head">
            <div
              role="tablist"
              aria-label={t('web.inbox.tabs.aria')}
              className="ht-inbox__tabs"
            >
              {TABS.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  id={`${testID}-tab-${key}`}
                  aria-selected={tab === key}
                  aria-controls={panelId}
                  data-testid={`${testID}-tab-${key}`}
                  className={`ht-inbox__tab${tab === key ? ' ht-inbox__tab--active' : ''}`}
                  onClick={() => {
                    setTab(key);
                  }}
                >
                  {t(TAB_LABEL_KEY[key])}
                </button>
              ))}
            </div>

            <div className="ht-inbox__actions">
              {tab === 'notifications' && unreadCount > 0 ? (
                <button
                  type="button"
                  className="ht-inbox__action"
                  data-testid={`${testID}-mark-all-read`}
                  onClick={() => {
                    void markAllRead();
                  }}
                >
                  {t('web.inbox.markAllRead')}
                </button>
              ) : null}
              <button
                type="button"
                className="ht-inbox__action ht-inbox__action--icon"
                data-testid={`${testID}-close`}
                aria-label={t('web.inbox.close')}
                onClick={() => {
                  setOpen(false);
                }}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          </div>

          {/*
            🔴 共享组件（`EmptyState`）必须挂在 `<HeytaUiProvider>` 之内 ——
            它 `useHeytaUiTokens()`，缺了会**主动抛错**。rail 在应用的最外层，
            而 App 里那个 Provider 只包住主内容区，所以这里自带一个。
            见 `scripts/check-ui-provider.mjs`（它检查的就是这件事）。
          */}
          <HeytaUiProvider>
            <div
              className="ht-inbox__body"
              id={panelId}
              role="tabpanel"
              aria-labelledby={`${testID}-tab-${tab}`}
            >
              {tab === 'notifications' ? (
                <NotificationsTab
                  testID={testID}
                  notifications={notifications}
                  state={notificationsState}
                  loading={loadingNotifications}
                  onRetry={() => {
                    void refreshNotifications();
                  }}
                />
              ) : (
                <ActivityTab
                  testID={testID}
                  campaigns={campaigns}
                  state={activityState}
                  loading={loadingActivity}
                  onRetry={() => {
                    void refreshActivity();
                  }}
                />
              )}
            </div>
          </HeytaUiProvider>
        </div>
      ) : null}
    </>
  );
}
