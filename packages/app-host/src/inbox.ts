/**
 * 通知中心 / 活动（福利中心）的读取（**宿主无关**）
 * ==================================================
 *
 * 三个小请求，所有宿主共用同一份：
 *
 * | 函数 | 端点 | 用途 |
 * |---|---|---|
 * | {@link fetchAccountNotifications} | `GET  /api/notifications` | 通知列表 + 未读数 |
 * | {@link markNotificationsRead}      | `POST /api/notifications/read` | 标记已读 |
 * | {@link fetchActivityFeed}          | `GET  /api/activity` | 活动 + 邀请进度 |
 *
 * ## 🔴 这三个请求都不携带任何用户内容
 *
 * 与 `entitlement.ts` 的文件头同一条理由：服务端**看不到任务明文**（E2EE），
 * 所以通知里装的只能是账号级事实。这里的请求体里唯一的字段是**通知 id**
 * （一个我们自己下发的整数），没有任何任务 / 清单 / 标签数据。
 * 读通知**永远不会**顺带把任务发出去。
 *
 * ## fail-open：全都**不抛**
 *
 * 未配置 / 没令牌 / 断网 / 超时 / 非 2xx / 响应体畸形 —— 一律归一成
 * `unconfigured` 或 `unavailable` 两种结果之一。理由与权益探测一致：
 * 一个"看通知"的入口不该成为新的崩溃点，而"读不到"也**不能**被当成
 * "没有通知"（那会让用户以为自己没有未读）。
 *
 * ## 为什么解析层这么啰嗦
 *
 * 这是**数据边界**：响应体是 `unknown`，而 `payload` 在服务端是一个 JSON
 * 列（形状由历史写入决定，不由类型决定）。仓库既有的纪律是"数据边界上不做
 * 类型信任" —— 所以每一条都逐字段校验，而不是 `as AccountNotificationItem`。
 * 一个 `as` 会把"服务端换了字段名"变成界面上一条空白通知。
 */
import { joinEndpointUrl } from './endpoint-url.js';

/** 服务端端点。放在常量里，因为测试会拿它们当断言目标。 */
export const NOTIFICATIONS_PATH = '/api/notifications';
export const NOTIFICATIONS_READ_PATH = '/api/notifications/read';
export const ACTIVITY_PATH = '/api/activity';

/** 失败原因。分开是为了让"没登录"与"服务端坏了"在排查时能区分。 */
export type InboxUnavailableCause = 'no-token' | 'network' | 'http' | 'malformed';

/** 一条通知（**原始** kind + payload，由界面负责解释）。 */
export interface AccountNotificationItem {
  readonly id: number;
  readonly kind: string;
  /** 🔴 原始载荷。用 `parseNotificationPayload` 解释，不要直接读字段。 */
  readonly payload: unknown;
  /** epoch 毫秒。 */
  readonly createdAt: number;
  /** epoch 毫秒；`null` = 未读。 */
  readonly readAt: number | null;
}

export type InboxReading =
  | { readonly kind: 'unconfigured' }
  | { readonly kind: 'unavailable'; readonly cause: InboxUnavailableCause }
  | {
      readonly kind: 'ready';
      readonly notifications: readonly AccountNotificationItem[];
      readonly unreadCount: number;
    };

/** 一条邀请记录。 */
export interface ReferralItem {
  readonly code: string;
  readonly displayName: string | null;
  readonly createdAt: number;
  readonly activatedAt: number | null;
  readonly rewardDays: number | null;
}

/** 邀请活动的进度与地址。 */
export interface InviteActivity {
  readonly inviteCode: string;
  readonly rewardDays: number;
  readonly invited: number;
  readonly activated: number;
  readonly daysEarned: number;
  readonly windowInvited: number;
  readonly windowCap: number;
  readonly windowDays: number;
  readonly referrals: readonly ReferralItem[];
}

/** 活动目录里的一条。`invite` 只在 `kind === 'invite'` 时出现。 */
export interface CampaignItem {
  readonly id: string;
  readonly kind: string;
  readonly invite?: InviteActivity;
}

export type ActivityReading =
  | { readonly kind: 'unconfigured' }
  | { readonly kind: 'unavailable'; readonly cause: InboxUnavailableCause }
  | { readonly kind: 'ready'; readonly campaigns: readonly CampaignItem[] };

export type WriteOutcome =
  | { readonly kind: 'unconfigured' }
  | { readonly kind: 'unavailable'; readonly cause: InboxUnavailableCause }
  | { readonly kind: 'ok'; readonly updated: number; readonly unreadCount: number };

export interface InboxRequestOptions {
  /** 服务端根地址，例如 `http://127.0.0.1:3000`。空串 = 未配置。 */
  readonly baseUrl: string;
  /** 取访问令牌。`undefined` = 未登录。 */
  readonly getToken: () => Promise<string | undefined>;
  /** 网络实现，便于测试注入。默认 `globalThis.fetch`。 */
  readonly fetchImpl?: typeof fetch;
}

// ── 小校验器（数据边界，不做类型信任）────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asFiniteInt = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
    ? value
    : null;

const asNonNegativeInt = (value: unknown): number | null => {
  const n = asFiniteInt(value);
  return n !== null && n >= 0 ? n : null;
};

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const asNullableMillis = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

/**
 * 一次带身份的 JSON 请求。
 *
 * 🔴 只有一处网络与错误处理 —— 三个端点共用它。抄三遍的后果在仓库里已经吃过
 * （见 AGENTS.md §3.5：同一个判断写三次，漂移就从那里开始）。
 */
const requestJson = async (
  options: InboxRequestOptions & {
    readonly path: string;
    readonly method: 'GET' | 'POST';
    readonly body?: unknown;
  },
): Promise<
  | { readonly kind: 'ok'; readonly body: unknown }
  | { readonly kind: 'unconfigured' }
  | { readonly kind: 'unavailable'; readonly cause: InboxUnavailableCause }
> => {
  if (options.baseUrl.trim() === '') {
    // 没配服务器 → 连请求都不发。自托管/未登录用户不会产生任何流量。
    return { kind: 'unconfigured' };
  }

  const token = await options.getToken();
  if (token === undefined || token === '') {
    return { kind: 'unavailable', cause: 'no-token' };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  let response: Response;
  try {
    response = await fetchImpl(joinEndpointUrl(options.baseUrl, options.path), {
      method: options.method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch {
    // 断网 / DNS / 证书 / 平台策略拦截。
    return { kind: 'unavailable', cause: 'network' };
  }

  if (!response.ok) {
    return { kind: 'unavailable', cause: 'http' };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: 'unavailable', cause: 'malformed' };
  }
  return { kind: 'ok', body };
};

/** 解析一条通知。形状不对就丢掉**这一条**，不影响其余。 */
const parseNotification = (value: unknown): AccountNotificationItem | null => {
  if (!isRecord(value)) return null;
  const id = asFiniteInt(value.id);
  const kind = asNonEmptyString(value.kind);
  const createdAt = asNullableMillis(value.createdAt);
  if (id === null || kind === null || createdAt === null) return null;

  return {
    id,
    kind,
    payload: value.payload,
    createdAt,
    readAt: asNullableMillis(value.readAt),
  };
};

const parseReferral = (value: unknown): ReferralItem | null => {
  if (!isRecord(value)) return null;
  const code = asNonEmptyString(value.code);
  const createdAt = asNullableMillis(value.createdAt);
  if (code === null || createdAt === null) return null;

  const displayName = typeof value.displayName === 'string' ? value.displayName : null;
  const rewardDays = asNonNegativeInt(value.rewardDays);

  return {
    code,
    displayName,
    createdAt,
    activatedAt: asNullableMillis(value.activatedAt),
    rewardDays,
  };
};

const parseInviteActivity = (value: unknown): InviteActivity | null => {
  if (!isRecord(value)) return null;

  const inviteCode = asNonEmptyString(value.inviteCode);
  const rewardDays = asNonNegativeInt(value.rewardDays);
  const invited = asNonNegativeInt(value.invited);
  const activated = asNonNegativeInt(value.activated);
  const daysEarned = asNonNegativeInt(value.daysEarned);
  const windowInvited = asNonNegativeInt(value.windowInvited);
  const windowCap = asNonNegativeInt(value.windowCap);
  const windowDays = asNonNegativeInt(value.windowDays);

  if (
    inviteCode === null ||
    rewardDays === null ||
    invited === null ||
    activated === null ||
    daysEarned === null ||
    windowInvited === null ||
    windowCap === null ||
    windowDays === null
  ) {
    return null;
  }

  const rawReferrals = Array.isArray(value.referrals) ? value.referrals : [];
  const referrals = rawReferrals
    .map(parseReferral)
    .filter((r): r is ReferralItem => r !== null);

  return {
    inviteCode,
    rewardDays,
    invited,
    activated,
    daysEarned,
    windowInvited,
    windowCap,
    windowDays,
    referrals,
  };
};

const parseCampaign = (value: unknown): CampaignItem | null => {
  if (!isRecord(value)) return null;
  const id = asNonEmptyString(value.id);
  const kind = asNonEmptyString(value.kind);
  if (id === null || kind === null) return null;

  const rawInvite = value.invite;

  if (kind === 'invite') {
    // ⚠️ 声明了 kind='invite' 却解析不出进度 → **整条丢弃**，而不是渲染一张
    // 只有标题、没有任何可操作内容的活动卡。后者看起来像"活动坏了"，
    // 而真实原因是响应形状变了。
    const invite = parseInviteActivity(rawInvite);
    return invite === null ? null : { id, kind, invite };
  }

  // 将来会有别的 kind。若它也带了 `invite`（或服务端多发了这个字段），
  // 同样按"解析不出来就整条丢弃"处理 —— 不把 `null` 塞进可选字段。
  if (rawInvite !== undefined) {
    const invite = parseInviteActivity(rawInvite);
    return invite === null ? null : { id, kind, invite };
  }

  return { id, kind };
};

/**
 * 拉通知列表与未读数。
 *
 * `limit` 省略时由服务端决定默认值（30）—— 客户端不复制那个数字。
 */
export async function fetchAccountNotifications(
  options: InboxRequestOptions & { readonly limit?: number },
): Promise<InboxReading> {
  const path =
    options.limit === undefined
      ? NOTIFICATIONS_PATH
      : `${NOTIFICATIONS_PATH}?limit=${String(options.limit)}`;

  const outcome = await requestJson({ ...options, path, method: 'GET' });
  if (outcome.kind !== 'ok') {
    return outcome.kind === 'unconfigured'
      ? { kind: 'unconfigured' }
      : { kind: 'unavailable', cause: outcome.cause };
  }

  if (!isRecord(outcome.body)) return { kind: 'unavailable', cause: 'malformed' };

  const rawList = outcome.body.notifications;
  const unreadCount = asNonNegativeInt(outcome.body.unreadCount);
  if (!Array.isArray(rawList) || unreadCount === null) {
    return { kind: 'unavailable', cause: 'malformed' };
  }

  const notifications = rawList
    .map(parseNotification)
    .filter((n): n is AccountNotificationItem => n !== null);

  return { kind: 'ready', notifications, unreadCount };
}

/**
 * 标记已读。
 *
 * 🔴 `ids` 为 `undefined` 表示**全部标记**，而它对应的是请求体里的
 * `{ all: true }` —— **不是**空体。服务端刻意不接受"缺省即全部"：
 * 一个客户端 bug 让 ids 变成 undefined 时，空体会得到 400（可见），
 * 而不是静默清空用户的未读徽标。
 */
export async function markNotificationsRead(
  options: InboxRequestOptions & { readonly ids?: readonly number[] },
): Promise<WriteOutcome> {
  const body = options.ids === undefined ? { all: true } : { ids: [...options.ids] };

  const outcome = await requestJson({
    ...options,
    path: NOTIFICATIONS_READ_PATH,
    method: 'POST',
    body,
  });
  if (outcome.kind !== 'ok') {
    return outcome.kind === 'unconfigured'
      ? { kind: 'unconfigured' }
      : { kind: 'unavailable', cause: outcome.cause };
  }

  if (!isRecord(outcome.body)) return { kind: 'unavailable', cause: 'malformed' };
  const updated = asNonNegativeInt(outcome.body.updated);
  const unreadCount = asNonNegativeInt(outcome.body.unreadCount);
  if (updated === null || unreadCount === null) {
    return { kind: 'unavailable', cause: 'malformed' };
  }

  return { kind: 'ok', updated, unreadCount };
}

/** 拉活动目录与邀请进度。 */
export async function fetchActivityFeed(
  options: InboxRequestOptions,
): Promise<ActivityReading> {
  const outcome = await requestJson({ ...options, path: ACTIVITY_PATH, method: 'GET' });
  if (outcome.kind !== 'ok') {
    return outcome.kind === 'unconfigured'
      ? { kind: 'unconfigured' }
      : { kind: 'unavailable', cause: outcome.cause };
  }

  if (!isRecord(outcome.body) || !Array.isArray(outcome.body.campaigns)) {
    return { kind: 'unavailable', cause: 'malformed' };
  }

  const campaigns = outcome.body.campaigns
    .map(parseCampaign)
    .filter((c): c is CampaignItem => c !== null);

  return { kind: 'ready', campaigns };
}
