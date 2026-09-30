/**
 * 运营管理后台的数据访问（**宿主无关**）
 * =======================================
 *
 * 依据：[`docs/adr/0038-admin-console-scope.md`](../../../docs/adr/0038-admin-console-scope.md)。
 *
 * ## 为什么在 `packages/app-host` 而不是 `apps/web`
 *
 * AGENTS.md §3.5：`apps/*` 只允许有**一处**平台差异，其余管道一律在
 * `packages/app-host`。本仓库已有的先例是 `fetchHostedEntitlementReading`
 * （`./entitlement.ts`）与 `createSyncClient()`（`./sync-wiring.ts`）——
 * "怎么跟服务端说话"属于共享管道，不属于某个界面。
 *
 * ## 🔴 不抛异常，全部归一成返回值
 *
 * 与 `entitlement.ts` 同一条口径。后台面板的失败**必须可区分**：
 * "没登录"（401）、"不是管理员"（403）、"断网"、"服务端 500" 是四件不同的事，
 * 而它们对用户意味着完全不同的下一步。把 403 说成"网络错误"会让人一直重试。
 *
 * ## 🔴 这里**不做**任何权限判断
 *
 * 本文件拿到的 401/403 只是**呈现层**的事实。真正的授权在服务端
 * （`server/src/admin/admin.middleware.ts`）。前端把按钮藏起来不是安全措施 ——
 * 一个手工构造的请求绕得过去，而服务端绕不过去。
 *
 * ## 令牌从哪来
 *
 * 由调用方注入（`getToken`），与 `entitlement.ts` 一致 —— 这个包**不知道**
 * 令牌存在哪，那是宿主的事。
 */

import { joinEndpointUrl } from './endpoint-url.js';

/** 后台接口的统一前缀。放在常量里，测试可以断言它。 */
export const ADMIN_API_PREFIX = '/api/admin';

export interface AdminClientOptions {
  /** 服务端根地址，例如 `https://heyta.waytofuture.cn`。空串 = 未配置。 */
  readonly baseUrl: string;
  /** 取访问令牌。`undefined` = 未登录。 */
  readonly getToken: () => Promise<string | undefined>;
  /** 网络实现，便于测试注入。默认 `globalThis.fetch`。 */
  readonly fetchImpl?: typeof fetch;
}

/**
 * 失败原因。
 *
 * `forbidden` 与 `unauthorized` **分开**：前者是"这个账号没有后台权限"（重试无意义），
 * 后者是"令牌过期了"（重新登录就好）。合并成一个 `auth-error` 会让界面
 * 给用户一句"请重新登录"，而他其实登录着、只是永远不会有权限。
 */
export type AdminFailureReason =
  | 'unconfigured'
  | 'no-token'
  | 'network'
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'invalid'
  | 'server';

export type AdminResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly reason: AdminFailureReason;
      /** HTTP 状态码（`network` / `unconfigured` / `no-token` 时没有）。 */
      readonly status?: number;
    };

// ─────────────────────────────────────────────────────────────────────
// 响应形状（与服务端 `server/src/admin/admin.routes.ts` 一一对应）
// ─────────────────────────────────────────────────────────────────────

export interface AdminOverview {
  readonly users: { total: number; verified: number; admins: number; locked: number };
  readonly subscriptions: {
    total: number;
    active: number;
    entitledStatuses: string[];
    byStatus: { status: string | null; count: number }[];
  };
  readonly orders: {
    total: number;
    byStatus: { status: string; count: number }[];
    paidByCurrency: { currency: string; paidOrders: number; revenueMinor: number }[];
  };
  readonly coupons: { total: number; enabled: number; settledRedemptions: number };
  readonly invites: {
    codes: number;
    codesDisabled: number;
    referrals: number;
    referralsActivated: number;
    referralsRewarded: number;
  };
}

export interface AdminUserRow {
  readonly id: number;
  readonly email: string;
  readonly isVerified: boolean;
  readonly isAdmin: boolean;
  readonly locked: boolean;
  readonly lockedUntil: number | null;
  readonly createdAt: number;
  readonly storageUsedBytes: number;
  readonly storageQuotaBytes: number;
}

export interface AdminPage<T> {
  readonly items: T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface AdminUserDetail {
  readonly user: AdminUserRow & {
    readonly failedLoginAttempts: number;
    readonly termsAcceptedAt: number | null;
    readonly tokenVersion: number;
  };
  readonly counts: { passkeys: number; operations: number; notifications: number };
  readonly subscriptions: {
    id: number;
    provider: string | null;
    priceId: string | null;
    status: string | null;
    grants: string[];
    currentPeriodEnd: number | null;
    createdAt: number;
    updatedAt: number;
  }[];
  readonly orders: {
    id: number;
    outTradeNo: string;
    provider: string;
    priceId: string;
    currency: string;
    finalAmountMinor: number;
    discountMinor: number;
    status: string;
    createdAt: number;
    paidAt: number | null;
  }[];
  readonly devices: {
    clientId: string;
    deviceName: string | null;
    appVersion: string | null;
    lastSeenAt: number;
  }[];
}

export interface AdminSubscriptionRow {
  readonly id: number;
  readonly userId: number;
  readonly email: string;
  readonly provider: string | null;
  readonly priceId: string | null;
  readonly status: string | null;
  readonly grants: string[];
  readonly currentPeriodEnd: number | null;
  readonly createdAt: number;
}

export interface AdminOrderRow {
  readonly id: number;
  readonly outTradeNo: string;
  readonly userId: number;
  readonly email: string;
  readonly provider: string;
  readonly priceId: string;
  readonly currency: string;
  readonly region: string;
  readonly originalAmountMinor: number;
  readonly discountMinor: number;
  readonly finalAmountMinor: number;
  readonly status: string;
  readonly createdAt: number;
  readonly paidAt: number | null;
}

export interface AdminCouponRow {
  readonly id: string;
  readonly code: string | null;
  readonly name: string;
  readonly kind: string;
  readonly percentOffBp: number | null;
  readonly amountOffMinor: number | null;
  readonly currency: string;
  readonly enabled: boolean;
  readonly validFrom: number;
  readonly validUntil: number | null;
  readonly maxRedemptions: number | null;
  readonly redemptions: number;
}

export interface AdminInvites {
  readonly codes: AdminPage<{
    id: number;
    code: string;
    disabled: boolean;
    createdAt: number;
    userId: number;
    email: string;
  }>;
  readonly referrals: AdminPage<{
    id: number;
    code: string;
    createdAt: number;
    activatedAt: number | null;
    rewardDays: number | null;
    rewardedAt: number | null;
    inviter: { id: number; email: string };
    invitee: { id: number; email: string };
  }>;
}

// ─────────────────────────────────────────────────────────────────────
// 传输
// ─────────────────────────────────────────────────────────────────────

/** HTTP 状态码 → 失败原因。`0` 表示请求根本没发出去（网络层）。 */
function reasonFromStatus(status: number): AdminFailureReason {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 400) return 'invalid';
  return 'server';
}

/**
 * 发一个后台请求。
 *
 * 🔴 **不抛**。断网、DNS、证书、平台策略拦截全部落成 `network`。
 */
async function adminRequest<T>(
  options: AdminClientOptions,
  path: string,
  init?: { method: 'POST'; body: unknown },
): Promise<AdminResult<T>> {
  if (options.baseUrl.trim() === '') return { ok: false, reason: 'unconfigured' };

  const token = await options.getToken();
  if (token === undefined || token === '') return { ok: false, reason: 'no-token' };

  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (init !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetchImpl(joinEndpointUrl(options.baseUrl, path), {
      method: init?.method ?? 'GET',
      headers,
      ...(init === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch {
    return { ok: false, reason: 'network' };
  }

  if (!response.ok) {
    return { ok: false, reason: reasonFromStatus(response.status), status: response.status };
  }

  try {
    return { ok: true, data: (await response.json()) as T };
  } catch {
    // 2xx 但不是 JSON —— 服务端坏了，别把它说成"网络问题"。
    return { ok: false, reason: 'server', status: response.status };
  }
}

/** 把分页/搜索拼成查询串。`undefined` 的项不出现（服务端有默认值）。 */
function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const asString = search.toString();
  return asString === '' ? '' : `?${asString}`;
}

// ─────────────────────────────────────────────────────────────────────
// 接口
// ─────────────────────────────────────────────────────────────────────

export const fetchAdminOverview = (options: AdminClientOptions): Promise<AdminResult<AdminOverview>> =>
  adminRequest<AdminOverview>(options, `${ADMIN_API_PREFIX}/overview`);

export const fetchAdminUsers = (
  options: AdminClientOptions,
  params: { q?: string; limit?: number; offset?: number } = {},
): Promise<AdminResult<AdminPage<AdminUserRow>>> =>
  adminRequest<AdminPage<AdminUserRow>>(
    options,
    `${ADMIN_API_PREFIX}/users${query({ q: params.q, limit: params.limit, offset: params.offset })}`,
  );

export const fetchAdminUser = (
  options: AdminClientOptions,
  id: number,
): Promise<AdminResult<AdminUserDetail>> =>
  adminRequest<AdminUserDetail>(options, `${ADMIN_API_PREFIX}/users/${String(id)}`);

export const adminUnlockUser = (
  options: AdminClientOptions,
  id: number,
): Promise<AdminResult<{ ok: true; user: { id: number; email: string } }>> =>
  adminRequest(options, `${ADMIN_API_PREFIX}/users/${String(id)}/unlock`, {
    method: 'POST',
    body: {},
  });

export const adminSetUserQuota = (
  options: AdminClientOptions,
  id: number,
  quotaBytes: number,
): Promise<AdminResult<{ ok: true }>> =>
  adminRequest(options, `${ADMIN_API_PREFIX}/users/${String(id)}/quota`, {
    method: 'POST',
    body: { quotaBytes },
  });

export const adminForceUserLogout = (
  options: AdminClientOptions,
  id: number,
): Promise<AdminResult<{ ok: true }>> =>
  adminRequest(options, `${ADMIN_API_PREFIX}/users/${String(id)}/logout`, {
    method: 'POST',
    body: {},
  });

export const fetchAdminSubscriptions = (
  options: AdminClientOptions,
  params: { limit?: number; offset?: number } = {},
): Promise<AdminResult<AdminPage<AdminSubscriptionRow>>> =>
  adminRequest<AdminPage<AdminSubscriptionRow>>(
    options,
    `${ADMIN_API_PREFIX}/subscriptions${query({ limit: params.limit, offset: params.offset })}`,
  );

export const fetchAdminOrders = (
  options: AdminClientOptions,
  params: { limit?: number; offset?: number } = {},
): Promise<AdminResult<AdminPage<AdminOrderRow>>> =>
  adminRequest<AdminPage<AdminOrderRow>>(
    options,
    `${ADMIN_API_PREFIX}/orders${query({ limit: params.limit, offset: params.offset })}`,
  );

export const fetchAdminCoupons = (
  options: AdminClientOptions,
  params: { limit?: number; offset?: number } = {},
): Promise<AdminResult<AdminPage<AdminCouponRow>>> =>
  adminRequest<AdminPage<AdminCouponRow>>(
    options,
    `${ADMIN_API_PREFIX}/coupons${query({ limit: params.limit, offset: params.offset })}`,
  );

export const fetchAdminInvites = (
  options: AdminClientOptions,
  params: { limit?: number; offset?: number } = {},
): Promise<AdminResult<AdminInvites>> =>
  adminRequest<AdminInvites>(
    options,
    `${ADMIN_API_PREFIX}/invites${query({ limit: params.limit, offset: params.offset })}`,
  );
