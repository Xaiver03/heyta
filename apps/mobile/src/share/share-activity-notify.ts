/**
 * 共享清单活动的**投递面**（M6 移动端）。形状照 web 的
 * `features/share/share-activity-notify.ts`：选哪几条是纯的、闸门在共享层、只有投出去那一下不纯。
 * ==========================================================================================
 *
 * ## 🔴 这里**不判**「该不该响」
 *
 * 那是 `@heyta/ui` 的 `selectNotifiedActivities(prefs, kinds)`（ADR-0062 决策 7：
 * 偏好是本机事实，判断只许有一份）。本文件收到的 kinds 会**先过那道闸**再落地 ——
 * 在壳里再写一遍"onAdded 为真才响"就是第二份判断，而两份判断必漂一处。
 *
 * ## 🔴 系统横幅这一格，移动端今天**做不到**（不是没做，是做不了）
 *
 * 本机唯一的原生通知通道是提醒链那套（`apps/mobile/ios/Heyta/HeytaReminderModule.swift`），
 * 而它按 **`categoryIdentifier == "heyta.reminder"` 认领**该 category 下的**全部**通知：
 * `cancelStale`（同文件 234 行起）每轮回收都会把"不在本轮排程清单里"的那些
 * `removeDeliveredNotifications` 掉。活动通知借这条 channel 投出去的结果是
 * **被提醒链当场抹掉** —— 用户看到它取决于他什么时候勾了提醒，那比不投更糟。
 *
 * 做到它需要的那一步（登记在册，本文件不抢）：给原生模块**新开一个 category**
 * （`HeytaReminderModule.swift` + 安卓那侧的 `ReminderModule.kt` 各一处）并**重装两端**，
 * 而那是别的会话正在飞的资产。所以这里的端口设计成**可注入**：
 * `ShareActivityDeliveryPorts.systemBanner` 留了口子，将来接原生只换端口实现，
 * 这一层的判据与界面一行都不用动。
 *
 * ## 今天投得出去的那一格：应用内
 *
 * 「未读计数」+「共享动态」条目 —— **消费的就是通知中心那一档**
 * （`screens/NotificationsScreen.tsx` 第三个 tab 订阅动态、入口读未读数）。
 * ⚠️ 这份清单**只活在本机内存**：web 那端的投递对象是操作系统通知中心，
 * 而移动端的这一格今天只有应用内 —— 冷启动后动态清零是**已知边界**，不是丢数据
 * （内容本身在 share 日志里，重进评论区就看得见）。
 */

// 🔴 闸门函数值导入走 `@heyta/ui/node`：本文件的判据（无订阅偏好 ⇒ 零打扰）要在
// node 里**真跑** `deliverShareActivities`，主入口会把 `react-native` 拖进来
// （`lib/habits-display.ts` 同一先例；类型仍指主入口，同一形状）。
import { selectNotifiedActivities } from '@heyta/ui/node';
import type { ShareActivityKind, ShareNotificationPrefs } from '@heyta/ui';

import {
  shareRosterTargetShareIds,
  subscribeShareActivity,
} from '../share/share-signals';

/** 一条已投递的活动读数（界面画它、判据数它）。 */
export interface ShareActivityFeedEntry {
  readonly shareId: string;
  readonly kind: ShareActivityKind;
  readonly seq: number;
  readonly at: number;
  /** 这份共享在本机对应哪条清单行（`''` = 还没绑定，例如刚入群那台设备）。 */
  readonly projectId: string;
  /**
   * 投递那一刻**已经组装好**的那句话（ADR-0071：清单名（可缺）+ 活动种类，条目内容不进）。
   * 界面只画它、不再拼句子 —— 拼句子这一步归 `@heyta/ui` 的 `shareActivityNotificationBody`，
   * 由宿主把词表喂进去（与 web 的 `use-share-activity-signal` 同一分层）。
   */
  readonly body: string;
}

export interface ShareActivityNotifyLabels {
  readonly title: string;
  /**
   * 正文：给**这一份共享**（`shareId`）与这一类活动组装那句话。
   * 🔴 签名带 `shareId` 是因为清单名要按 share 查本机那一行 —— 不带它，宿主拿不到名字，
   *    动态就只能永远说"有人动了共享清单"，那是 ADR-0071 里回落那一档被误当成默认档。
   */
  readonly body: (shareId: string, kind: ShareActivityKind) => string;
}

/**
 * 投递端口。**每一格都可换**：
 * - `inApp` 缺省 = 本模块那份内存动态（界面订阅它）；
 * - `systemBanner` 缺省 = 没有实现者（见文件头那一格 🔴），传进来才会真投。
 */
export interface ShareActivityDeliveryPorts {
  readonly readPrefs: () => ShareNotificationPrefs;
  readonly projectIdFor: (shareId: string) => string;
  readonly inApp?: (entry: ShareActivityFeedEntry) => void;
  readonly systemBanner?: (entry: ShareActivityFeedEntry) => void;
}

export interface ShareActivityDelivery {
  readonly delivered: number;
  readonly reason?: 'empty' | 'prefs-off' | 'no-port';
}

/** 动态最多留这么多条（只影响这张临时清单，不影响内容本身）。 */
export const SHARE_ACTIVITY_FEED_LIMIT = 20;

/* ── 应用内那一格：内存动态 + 未读数（本壳的"通知中心"读它） ─────────────── */

let feed: ShareActivityFeedEntry[] = [];
let unread = 0;
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      /* 一枚监听器抛错不许带走其余的（与 share-signals 的重画通道同一口径）。 */
    }
  }
};

export function subscribeShareActivityFeed(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function shareActivityFeed(): readonly ShareActivityFeedEntry[] {
  return feed;
}

/** 未读数（入口徽标与「共享动态」那一档共用同一个数 —— 只有一处真相）。 */
export function shareActivityUnreadCount(): number {
  return unread;
}

/** 打开那一档即已读（与移动壳通知中心「打开即已读」那条既有裁决同一个形状）。 */
export function markShareActivityRead(): void {
  if (unread === 0) return;
  unread = 0;
  emit();
}

/**
 * 摘掉整张动态（登出/换账号）。
 *
 * 🔴 条目本身只含 kind/时间/清单行 id（没有内容明文），但**归属**会换人：
 * 上一个人的共享动态留在下一个登录者的通知中心里，哪怕只写着"有人新增了内容"
 * 也是把"你有过协作"这件事泄露给另一个人。登出清它是隐私纪律，不是卫生偏好。
 */
export function clearShareActivityFeed(): void {
  if (feed.length === 0 && unread === 0) return;
  feed = [];
  unread = 0;
  emit();
}

export function appendShareActivityFeed(entry: ShareActivityFeedEntry): void {
  feed = [entry, ...feed].slice(0, SHARE_ACTIVITY_FEED_LIMIT);
  unread += 1;
  emit();
}

/** 只给判据：回到干净状态（多枚 spec 共用一个进程模块实例）。 */
export function __resetShareActivityFeedForTests(): void {
  feed = [];
  unread = 0;
  listeners.clear();
}

/* ── 投递：闸门在 `@heyta/ui`，这里只负责"投出去" ────────────────────────── */

export function deliverShareActivities(
  args: {
    shareId: string;
    latestSeq: number;
    kinds: readonly ShareActivityKind[];
    labels: ShareActivityNotifyLabels;
    ports: ShareActivityDeliveryPorts;
    now?: number;
  },
): ShareActivityDelivery {
  if (args.kinds.length === 0) return { delivered: 0, reason: 'empty' };
  // 🔴 闸门只有这一处：`selectNotifiedActivities` 返回空 ⇒ 一次都不投。
  const allowed = selectNotifiedActivities(args.ports.readPrefs(), args.kinds);
  if (allowed.length === 0) return { delivered: 0, reason: 'prefs-off' };

  const now = args.now ?? Date.now();
  let delivered = 0;
  for (const kind of allowed) {
    const entry: ShareActivityFeedEntry = {
      shareId: args.shareId,
      kind,
      seq: args.latestSeq,
      at: now,
      projectId: args.ports.projectIdFor(args.shareId),
      body: args.labels.body(args.shareId, kind),
    };
    if (args.ports.inApp !== undefined) {
      args.ports.inApp(entry);
      delivered += 1;
    }
    // 今天没有实现者 ⇒ 这一格永远不计入 `delivered`（文件头那格 🔴）。
    // 有了实现者也只是多投一次，判断与动态那两格都不用改。
    if (args.ports.systemBanner !== undefined) args.ports.systemBanner(entry);
  }
  if (delivered === 0) return { delivered: 0, reason: 'no-port' };
  return { delivered };
}

/* ── 消费者装配（入口调；重复调用只换标签与端口，通道上仍只有一个消费者） ─── */

let unsubscribe: (() => void) | undefined;

/**
 * 把「信号拉回来的活动」接到投递面上。
 *
 * 🔴 它同时保证**两条 sink 已经装上**（`installMobileShareSignals`）——
 * 装配存在但没有调用点正是"零件都在、线没接"那一类失效：实时信号一路打进垫片、
 * 垫片没人订 ⇒ 评论不重画、动态不响，而**一个错都不报**。所以这里连同
 * `installMobileShareSignals()` 一起调，判据盯 `hasShareSinks()`。
 */
export function installMobileShareActivityDelivery(
  args: {
    labels: ShareActivityNotifyLabels;
    ports: ShareActivityDeliveryPorts;
  },
): void {
  // 懒 import：`share-signals` 静态引 `wiring`（个人 op-log 那条腿），
  // 而这一格只在真装配时才需要；判据里换成值导入也不碰原生。
  void shareRosterTargetShareIds;
  const { installMobileShareSignals } = requireModule();
  installMobileShareSignals();
  // 🔴 **每次装配都换一份标签与端口**：先摘旧订阅再订新的，所以通道上永远只有一个消费者，
  // 而闭包里的 `args` 就是当下那一份。早先这里是"装过就直接 return"，注释却写着
  // "换的是标签与端口" —— 代码没兑现：语言切换后 `tr` 换了人，effect 重跑却被那道
  // 早退丢掉，之后的每一条动态仍在说**切换前**的语言。
  unsubscribe?.();
  unsubscribe = subscribeShareActivity((shareId, latestSeq, activities) => {
    deliverShareActivities({
      shareId,
      latestSeq,
      kinds: activities,
      labels: args.labels,
      ports: args.ports,
    });
  });
}

export function uninstallMobileShareActivityDelivery(): void {
  unsubscribe?.();
  unsubscribe = undefined;
}

/** 只给判据：回到"没装过"。 */
export function __resetShareActivityDeliveryForTests(): void {
  uninstallMobileShareActivityDelivery();
}

/**
 * `share-signals` 的取法单独抽出来：判据把这一格换成替身，
 * 就能在**不触发 `wiring` 那条 op-log 依赖链**的前提下验"装完之后有人在收"。
 */
function requireModule(): typeof import('./share-delivery-deps') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return requireShareDeliveryDeps();
}

let requireShareDeliveryDeps: () => typeof import('./share-delivery-deps') = () => {
  throw new Error('共享投递依赖未装配');
};

/** 入口在装配前把依赖交进来（生产走静态图，判据走替身）。 */
export function bindShareDeliveryDeps(next: typeof import('./share-delivery-deps')): void {
  requireShareDeliveryDeps = () => next;
}
