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
 *
 * 🔴 `conflict`（409）也必须**独立于 `server`（5xx）**：409 说的是"请求本身没写错，
 * 是被操作那一行的当前状态拒绝了"，它的下一步是**换一个动作或换一单**，
 * 而 5xx 的下一步是重试。把它折进 `server`，运营会对着一条"已过 7 天的退款申请"
 * 反复点同一个按钮 —— 这正是 `admin.routes.ts` 里"409 而不是 400"那条注释要防的事，
 * 只是它防在了服务端，而界面这一半此前没人接。
 */
export type AdminFailureReason =
  | 'unconfigured'
  | 'no-token'
  | 'network'
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'invalid'
  | 'conflict'
  | 'server';

export type AdminResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly reason: AdminFailureReason;
      /** HTTP 状态码（`network` / `unconfigured` / `no-token` 时没有）。 */
      readonly status?: number;
      /**
       * 服务端在 4xx 响应体里带回来的**业务码**（`reason` 字段，原样交出去）。
       *
       * 🔴 传输层**不翻译、不裁决、不白名单** —— 它只做"把服务端给的那个码搬到返回值里"。
       * 哪些码存在、每个码对界面意味着什么，只有后台那一片知道
       * （`apps/web/src/features/admin/store.ts` 的 `ADMIN_REFUND_CODE_KEY`）。
       * 在这里写一份枚举就是 §3.5 那条"同一个判断抄两遍"。
       *
       * ⚠️ 之所以要有这一格：`{ok:false, reason, status}` 这三元组里，`reason` 是
       * **HTTP 的**原因（409 ⇒ conflict），它答不了"为什么这一单被拒"。
       * 退款恰恰是必须告诉运营**为什么**的这类操作（ADR-0053 §5 第 11 条）。
       */
      readonly serverReason?: string;
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
    /**
     * 同意时那一套对外文本的版本指纹。**null ≠ 没同意** —— 它说的是"这条记录只有
     * 时间戳，证明不了是哪一版"：迁移之前的老账号，或运营者自托管实例（那台机器发布
     * 的是它自己的文本，版本不由我们命名）。后台要把这两种情况和"没同意"分开显示。
     */
    readonly termsDocumentVersion: string | null;
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
  if (status === 409) return 'conflict';
  return 'server';
}

/**
 * 这一格为什么要带**上界**：`serverReason` 要进 DOM。
 *
 * 我们自己的服务端给的是短业务码（`WINDOW_PASSED` 这类）。但这一层读的是
 * **任意**非 2xx 响应体 —— 换过版本的服务端、挡在前面的反代、以及
 * 未来任何一条忘了带码的 4xx 都从这里过。长度上界是这条边界上唯一的形状约束，
 * 它不裁决"这个码合不合法"（那是后台那一片的事）。
 */
const MAX_SERVER_REASON_LENGTH = 80;

/** 从非 2xx 的响应体里取 `reason`。取不到就 `undefined` —— **不抛**。 */
async function readServerReason(response: Response): Promise<string | undefined> {
  if (typeof response.json !== 'function') return undefined;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // 反代给的 HTML / 空体：这一次失败仍然按状态码说话。
    return undefined;
  }
  if (body === null || typeof body !== 'object') return undefined;
  const value = (body as { readonly reason?: unknown }).reason;
  if (typeof value !== 'string') return undefined;
  const code = value.trim();
  return code === '' || code.length > MAX_SERVER_REASON_LENGTH ? undefined : code;
}

/**
 * 后台请求的方法集合。
 *
 * 🔴 只有**这一套**传输。后台新加一个动词 = 在这一处登记一种方法，
 * 不是另起一个 fetch（`AGENTS` §3.5 那条"同一个判断抄两遍"在传输层同样成立：
 * 第二份 fetch 意味着第二份令牌闸与第二份状态码映射，而漂移不会报错）。
 */
export type AdminRequestMethod = 'POST' | 'PUT' | 'DELETE';

/**
 * 哪些方法**不带请求体**。
 *
 * 判据是从这里推导的，不是拍的：`DELETE /api/admin/holiday-adjustments/years`
 * 的年份按契约住在**查询串**里（`HOLIDAY_ADJUSTMENT_PATHS.adminDelete` 写清了
 * 为什么不许走路径参数），而请求体里再放一份年分会凭空造出
 * "body 说 2026、query 说 2027"这种必须**额外写一条守卫**才拦得住的请求
 * —— 那条守卫的缺失是静默的。所以这一类方法在类型上就不接受载荷。
 *   （`POST /users/:id/unlock` 传的是 `{}`：它带请求头与空体，语义上没有载荷，
 *    但**形状上仍是 POST**，所以留在"带体"那一侧 —— 改它会动既有三条端点的字节。）
 */
const ADMIN_METHODS_WITHOUT_BODY: readonly AdminRequestMethod[] = ['DELETE'];

function methodCarriesBody(method: AdminRequestMethod): boolean {
  return !ADMIN_METHODS_WITHOUT_BODY.includes(method);
}

/**
 * 发一个后台请求。
 *
 * 🔴 **不抛**。断网、DNS、证书、平台策略拦截全部落成 `network`。
 */
async function adminRequest<T>(
  options: AdminClientOptions,
  path: string,
  init?: { method: AdminRequestMethod; body?: unknown },
): Promise<AdminResult<T>> {
  if (options.baseUrl.trim() === '') return { ok: false, reason: 'unconfigured' };

  const token = await options.getToken();
  if (token === undefined || token === '') return { ok: false, reason: 'no-token' };

  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  const withBody = init !== undefined && methodCarriesBody(init.method);
  if (withBody) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetchImpl(joinEndpointUrl(options.baseUrl, path), {
      method: init?.method ?? 'GET',
      headers,
      ...(withBody ? { body: JSON.stringify(init?.body ?? {}) } : {}),
    });
  } catch {
    return { ok: false, reason: 'network' };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: reasonFromStatus(response.status),
      status: response.status,
      serverReason: await readServerReason(response),
    };
  }

  try {
    return { ok: true, data: (await response.json()) as T };
  } catch {
    // 2xx 但不是 JSON —— 服务端坏了，别把它说成"网络问题"。
    return { ok: false, reason: 'server', status: response.status };
  }
}

// ─────────────────────────────────────────────────────────────────────
// 调休 / 补班（公共事实）—— 与 `server/src/admin/admin.routes.ts` 那三条端点一一对应。
//
// 🔴 载荷与响应的**合法性规则不在这里**：它们只有一份，在
// `packages/shared-schema/src/holiday-adjustment-contract.ts` 的
// `holidayYearPutSchema`。本文件只做传输（照文件头那条纪律：这里不做判断）。
// 界面把"一行一个值"拆成数组属于**收集输入**，不是裁决 —— 真正拦下
// "2026-02-30"、"`isOffDay` 不是布尔"、"同一天出现两次"的是服务端那一次 `safeParse`。
// ─────────────────────────────────────────────────────────────────────

/** 一年：出处链接 + 逐日表 + 服务端算出的元信息。 */
export interface AdminHolidayYear {
  readonly year: number;
  /** 公告原文链接（后台渲染成可点链接 = 判据②要的"回显"）。 */
  readonly papers: string[];
  readonly days: { day: string; isOffDay: boolean }[];
  /** 库里实际行数：界面用它核对"存进去的 == 显示出来的"。 */
  readonly dayCount: number;
  readonly updatedAt: number;
  readonly updatedBy: string | null;
  readonly note: string | null;
}

export interface AdminHolidayYears {
  /** 内容版本令牌 `<max(updated_at)>.<年数>.<行数>`（契约里写明它不是校验和）。 */
  readonly version: string;
  readonly years: AdminHolidayYear[];
}

/** `PUT` 成功回的就是"存进去的那份坐标"，界面拿它做回显核对。 */
export interface AdminHolidayYearPutResult {
  readonly ok: true;
  readonly year: number;
  readonly papers: string[];
  readonly dayCount: number;
}

/** `PUT /api/admin/holiday-adjustments/years` 的载荷：**一次一个年度、整年替换**。 */
export interface AdminHolidayYearPut {
  readonly year: number;
  readonly papers: readonly string[];
  readonly note?: string | null;
  readonly days: readonly { readonly day: string; readonly isOffDay: boolean }[];
}

/** `GET /api/admin/holiday-adjustments` —— 已录入的年度，含 papers。 */
export const fetchAdminHolidayYears = (
  options: AdminClientOptions,
): Promise<AdminResult<AdminHolidayYears>> =>
  adminRequest<AdminHolidayYears>(options, `${ADMIN_API_PREFIX}/holiday-adjustments`);

/** `PUT /api/admin/holiday-adjustments/years` —— **整年替换**某一年。 */
export const adminPutHolidayYear = (
  options: AdminClientOptions,
  payload: AdminHolidayYearPut,
): Promise<AdminResult<AdminHolidayYearPutResult>> =>
  adminRequest<AdminHolidayYearPutResult>(options, `${ADMIN_API_PREFIX}/holiday-adjustments/years`, {
    method: 'PUT',
    body: payload,
  });

/**
 * `DELETE /api/admin/holiday-adjustments/years?year=` —— **撤销那一年的录入**。
 *
 * 产品语义（`docs/plans/countdown-anniversary.md` W4b 判据④那条分支）是
 * "无覆盖 ⇒ **退回随包表**"，**不是**"那一年没有任何安排"。
 * 年份走查询串：契约 `HOLIDAY_ADJUSTMENT_PATHS.adminDelete` 写清了为什么
 * 它不许住进路径（两个来源 = 一条必须额外写的守卫）。
 */
export const adminDeleteHolidayYear = (
  options: AdminClientOptions,
  year: number,
): Promise<AdminResult<{ ok: true; year: number; deleted: number }>> =>
  adminRequest<{ ok: true; year: number; deleted: number }>(
    options,
    `${ADMIN_API_PREFIX}/holiday-adjustments/years${query({ year })}`,
    { method: 'DELETE' },
  );

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

// ─────────────────────────────────────────────────────────────────────
// 退款（申请 / 批准 / 驳回）—— 与 `server/src/admin/admin.routes.ts` 那四条端点一一对应。
//
// 决策依据在 [`docs/adr/0053-refunds-only-for-countable-segments.md`]
// （../../../docs/adr/0053-refunds-only-for-countable-segments.md）。本文件只做传输：
//
// 🔴 **能退不该退、退多少，一个都不在这里判。** 三条 CHECK、7×24 窗口、
// "金额只能等于结算冻下的实付"、"同一单不许有第二条开着的退款"全部住在服务端
// （`server/src/billing/refund-policy.ts` + `refund-store.ts`）。界面这一侧多判一次
// 就是两套标准，而漂移表现为"界面放行了、服务端 409"或反过来。
//
// 🔴 **这里也不枚举 `status`**。词表在 `REFUND_STATUSES`（服务端）。抄一份进客户端
// 就有了第二份词表；订单与订阅那两列同样是原样显示服务端码，退款这一列跟着做。
// ─────────────────────────────────────────────────────────────────────

/**
 * 列表行：与服务端 `listRefunds` 的投影**逐键对齐**（判据钉在
 * `apps/web/tests/admin-panel.spec.tsx` 的「列表投影键集合」那一条）。
 *
 * ⚠️ 投影里**没有** `note`、`reason`、`refundedAt`、`providerRefundId` ——
 * 库里都有，但 `listRefunds` 没选。所以这一片界面**说不出**"谁写的理由"和
 * "通道那头的单号"，只能列出这 9 个键。要显示就得先扩服务端投影（独立的一步）。
 */
export interface AdminRefundRow {
  readonly id: number;
  readonly orderId: number;
  readonly userId: number;
  readonly provider: string;
  readonly outRefundNo: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly periodDays: number;
  readonly status: string;
}

/** `GET /api/admin/refunds` 的响应（**不分页**：只有 `limit`，没有 `offset`）。 */
export interface AdminRefundList {
  readonly refunds: AdminRefundRow[];
}

/** `POST /api/admin/refunds` 成功（201）回的就是这三件事。被拒走 409，不落在这里。 */
export interface AdminRefundRequestResult {
  readonly ok: true;
  readonly outcome: 'requested';
  readonly refundId: number;
  readonly outRefundNo: string;
  readonly amountMinor: number;
}

/**
 * `POST /refunds/:id/approve` 的 2xx 响应体。
 *
 * 🔴 四个臂都可能是 **200**：批准这个**决定**已经成立，通道那一步是**下一步**的事实，
 * 所以通道失败不报 5xx（服务端注释写明了理由）。界面因此**不许**把这一条读成
 * "退款已经完成" —— 完成只由签名有效的回调认领。
 */
export type AdminRefundApproveBody =
  | { readonly ok: true; readonly outcome: 'submitted'; readonly status: string; readonly providerRefundId: string | null }
  | { readonly ok: true; readonly outcome: 'channel-failed'; readonly reason: string }
  | { readonly ok: true; readonly outcome: 'not-submittable'; readonly status: string }
  | { readonly ok: true; readonly outcome: 'not-found' };

/** `POST /refunds/:id/reject` 的 2xx 响应体（拒绝**不碰钱也不碰权益**）。 */
export interface AdminRefundRejectBody {
  readonly ok: true;
  readonly outcome: 'decided';
  readonly status: string;
}

/** `GET /api/admin/refunds` —— 最新的若干条退款行。 */
export const fetchAdminRefunds = (
  options: AdminClientOptions,
  params: { userId?: number; limit?: number } = {},
): Promise<AdminResult<AdminRefundList>> =>
  adminRequest<AdminRefundList>(
    options,
    `${ADMIN_API_PREFIX}/refunds${query({ userId: params.userId, limit: params.limit })}`,
  );

/**
 * `POST /api/admin/refunds` —— 为某一条**已付订单**开一张退款申请。
 *
 * ⚠️ `note` 在服务端是可选的，但 `operatorApproved: true` 时**必须**非空
 * （一次没有理由的例外批准，事后与"运营手滑"无法区分）。界面把这一条交给服务端，
 * 不在这里预先禁用按钮。
 */
export const adminCreateRefundRequest = (
  options: AdminClientOptions,
  input: { readonly orderId: number; readonly note?: string; readonly operatorApproved?: boolean },
): Promise<AdminResult<AdminRefundRequestResult>> =>
  adminRequest<AdminRefundRequestResult>(options, `${ADMIN_API_PREFIX}/refunds`, {
    method: 'POST',
    body: input,
  });

/** `POST /api/admin/refunds/:id/approve` —— 批准并**这一步就把退款发给通道**。 */
export const adminApproveRefund = (
  options: AdminClientOptions,
  id: number,
  note: string,
): Promise<AdminResult<AdminRefundApproveBody>> =>
  adminRequest<AdminRefundApproveBody>(options, `${ADMIN_API_PREFIX}/refunds/${String(id)}/approve`, {
    method: 'POST',
    body: { note },
  });

/** `POST /api/admin/refunds/:id/reject` —— 驳回。钱与权益都不动。 */
export const adminRejectRefund = (
  options: AdminClientOptions,
  id: number,
  note: string,
): Promise<AdminResult<AdminRefundRejectBody>> =>
  adminRequest<AdminRefundRejectBody>(options, `${ADMIN_API_PREFIX}/refunds/${String(id)}/reject`, {
    method: 'POST',
    body: { note },
  });
