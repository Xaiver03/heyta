/**
 * 通知中心 / 活动（福利中心）的状态
 * ====================================
 *
 * ## 职责边界（与 `features/subscription/store.ts` 同一条纪律）
 *
 * 这里**不做业务判断**：什么算未读、一条通知该怎么措辞、邀请还差几个人到上限 ——
 * 全部在 `@heyta/domain`（`parseNotificationPayload` / `CAMPAIGN_CATALOG`）与
 * 渲染层。这个文件只负责"什么时候去问一次服务端"以及把结果放进 state。
 *
 * ## 🔴 未配置时**连请求都不发**
 *
 * 与权益探测一致：`baseUrl` 为空（自托管用户还没填地址、或没登录）时
 * `fetchAccountNotifications` 自己就返回 `unconfigured`，一个字节都不发。
 * 所以"没配服务器"和"服务器挂了"在界面上是**两种不同的提示**，
 * 而不是同一个"加载失败"。
 *
 * ## 🔴 通知与活动**分开加载**，这不是优化而是语义
 *
 * 拉通知列表是为了**未读徽标** —— 它在应用一挂载就得知道，用户不必打开面板。
 * 而 `GET /api/activity` 会**惰性创建这个账号的邀请码**（服务端的
 * get-or-create）。如果徽标那次加载顺带把活动也拉了，那么**每一个用户
 * 每次打开应用都会写一行邀请码** —— 包括那些永远不会去邀请人的人。
 *
 * 所以：通知在挂载时拉；活动**只在「活动」Tab 真的被打开时**才拉。
 * 这也是"邀请码惰性生成"这个设计在客户端这一侧的对应动作。
 *
 * ## 为什么读不到时**不清空**已有数据
 *
 * `unavailable` 只改状态，不把 `notifications` 清成空数组。清空的后果是
 * 用户看到"还没有通知"，而真相是"这次没读到" —— 前者是**一个结论**，
 * 后者是**一次失败**，把后者显示成前者会让人以为自己错过了什么。
 */
import { create } from 'zustand';

import {
  fetchAccountNotifications,
  fetchActivityFeed,
  markNotificationsRead,
  type AccountNotificationItem,
  type CampaignItem,
  type InboxUnavailableCause,
} from '@heyta/app-host';

import { useSyncStore } from '../sync/store.js';

/** 一次加载的状态。`null` = 还没加载过。 */
export type LoadState = 'ready' | 'unconfigured' | 'unavailable';

export interface InboxStoreState {
  /** 最近一页通知。🔴 读失败时**保留**旧值（见文件头）。 */
  notifications: readonly AccountNotificationItem[];
  unreadCount: number;
  /** 通知那次加载的状态。 */
  notificationsState: LoadState | null;
  /** 通知读不到的原因（`notificationsState === 'unavailable'` 时有意义）。 */
  notificationsCause?: InboxUnavailableCause;
  /** 活动目录。 */
  campaigns: readonly CampaignItem[];
  activityState: LoadState | null;
  activityCause?: InboxUnavailableCause;
  /** 正在加载通知 / 活动（分别标，界面各自显示骨架）。 */
  loadingNotifications: boolean;
  loadingActivity: boolean;
  /** 拉通知列表与未读数。**永不抛。** */
  refreshNotifications: () => Promise<void>;
  /** 拉活动与邀请进度。**永不抛。** */
  refreshActivity: () => Promise<void>;
  /**
   * 全部标记已读。**永不抛。**
   *
   * 失败时**不动本地状态**：未读徽标继续亮着。宁可让用户再点一次，
   * 也不要出现"徽标清了但服务端没清" —— 那会在下一次加载时凭空跳回来。
   */
  markAllRead: () => Promise<void>;
}

/**
 * 读取当前的服务端地址与令牌。
 *
 * ⚠️ 抽成函数而不是在两处各写一遍：`baseUrl`/`token` 的来源以后可能变
 * （比如多账号），而"两个 action 读到的凭据不一致"会表现为
 * "通知能拉到、活动拉不到" —— 一个很难归因的现象。
 */
const credentials = (): { baseUrl: string; getToken: () => Promise<string | undefined> } => {
  const { baseUrl, token } = useSyncStore.getState();
  return { baseUrl, getToken: async () => token };
};

export const useInboxStore = create<InboxStoreState>((set) => ({
  notifications: [],
  unreadCount: 0,
  notificationsState: null,
  campaigns: [],
  activityState: null,
  loadingNotifications: false,
  loadingActivity: false,

  refreshNotifications: async () => {
    set({ loadingNotifications: true });
    const reading = await fetchAccountNotifications(credentials());

    if (reading.kind === 'ready') {
      set({
        notifications: reading.notifications,
        unreadCount: reading.unreadCount,
        notificationsState: 'ready',
        notificationsCause: undefined,
        loadingNotifications: false,
      });
      return;
    }

    set({
      notificationsState: reading.kind === 'unconfigured' ? 'unconfigured' : 'unavailable',
      notificationsCause: reading.kind === 'unavailable' ? reading.cause : undefined,
      loadingNotifications: false,
    });
  },

  refreshActivity: async () => {
    set({ loadingActivity: true });
    const reading = await fetchActivityFeed(credentials());

    if (reading.kind === 'ready') {
      set({
        campaigns: reading.campaigns,
        activityState: 'ready',
        activityCause: undefined,
        loadingActivity: false,
      });
      return;
    }

    set({
      activityState: reading.kind === 'unconfigured' ? 'unconfigured' : 'unavailable',
      activityCause: reading.kind === 'unavailable' ? reading.cause : undefined,
      loadingActivity: false,
    });
  },

  markAllRead: async () => {
    // 先把**已经读到的**那些 id 记下来：失败时它们不该被标成已读。
    const { unreadCount } = useInboxStore.getState();
    const outcome = await markNotificationsRead(credentials());
    if (outcome.kind !== 'ok') {
      // 失败什么都不改。徽标继续亮着，用户能再点一次。
      return;
    }

    const now = Date.now();
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.readAt === null ? { ...n, readAt: now } : n,
      ),
      // 用服务端回来的未读数，而不是本地减一：它是权威值，而且能顺带
      // 修正"本地漏了一条"这类偏差。
      unreadCount: outcome.unreadCount,
    }));

    // `unreadCount` 只在日志/调试里有意义，但它能回答"刚才那次点击真的生效了吗"。
    if (unreadCount > 0 && outcome.updated === 0) {
      // 服务端说一条都没改，而本地以为有未读 —— 说明我们的列表**过期**了。
      // 重新拉一次（一次自愈），而不是让徽标永远亮着。
      await useInboxStore.getState().refreshNotifications();
    }
  },
}));

/**
 * 测试用重置。
 *
 * 命名与 `__resetSubscriptionForTests` 一致（仓库惯例）——
 * 跨用例残留的状态是"随机变红"最常见的来源。
 */
export function __resetInboxForTests(): void {
  useInboxStore.setState({
    notifications: [],
    unreadCount: 0,
    notificationsState: null,
    notificationsCause: undefined,
    campaigns: [],
    activityState: null,
    activityCause: undefined,
    loadingNotifications: false,
    loadingActivity: false,
  });
}
