/**
 * 换绑登录邮箱 + 登录会话的**客户端协议层**（宿主无关）。工单 W3 / W4。
 *
 * 裁决在 [ADR-0063](../../../docs/adr/0063-email-rebinding-and-per-session-revocation.md)；
 * 路径与错误码的事实源在 `@heyta/shared-schema` 的 `email-change-contract.ts` 与
 * `session-contract.ts`，**这里不重述那些串**。
 *
 * ## 为什么在 `packages/app-host`，不在某个壳里
 *
 * AGENTS §3.5 的判据：下面每一个函数都在决定"业务上该怎么做" —— 哪个路径、
 * 带不带 Bearer、成功长什么样、失败归成哪一类。四个宿主（Web / 移动 / 桌面壳 / node-host）
 * 各写一份的话，漂移的症状不是"某个平台少个按钮"，而是"某台设备退出登录之后
 * 那枚令牌还在服务端活着"。
 *
 * `sendJson` 与 `failure` **来自 `hosted-auth.ts`**，这里不另建一份 fetch 包装 ——
 * 地址闸门（未配置 ⇒ 一个请求都不发）、隐私同意闸门、宿主没有 `fetch` 的兜底，
 * 每多一份实现就多一处会漏掉 `consent-required` 的地方。
 *
 * ## 🔴 这里**没有** `confirmEmailChange`
 *
 * 点那两封信的人**手上没有会话**（他可能在另一台电脑上），所以那一侧的出口是
 * **服务端渲染的凭据页** `/change-email?token=`（`server/src/pages.ts` +
 * `server/public/change-email.js`），与前几张凭据页同一条理由：
 * `/app/` 那道门要先登录才进得去，而把"点开信"放在需要登录的地方才是死循环。
 * 在客户端再开一条 confirm 通路只会造出第二个裁决点 —— 那两个收件箱各自点一次
 * 的时序判断（哪一边先、并发的最后一边）只能有一个地方做。
 */
import {
  EMAIL_CHANGE_PATHS,
  SESSION_PATHS,
  sessionRevokePath,
  type EmailChangeStatusResponse,
  type SessionSummary,
} from '@heyta/shared-schema';

import {
  failure,
  sendJson,
  type HostedAuthFailure,
  type HostedAuthLocale,
  type HostedAuthOptions,
  type HostedAuthOutcome,
} from './hosted-auth.js';

/**
 * 🔴 `/api` 那一层前缀**只在客户端存在**（服务端注册时用的是 `prefix: '/api'`，
 * 而契约里存的是相对路径）。这张表是它唯一的加法，与 `HOSTED_AUTH_PATHS` 同一条手法。
 * 判据在下面那份 spec 的"路径逐字等于契约"那两条：契约与实现漂移的症状是 404，不是报错。
 */
export const ACCOUNT_SECURITY_PATHS = {
  changeRequest: `/api/${EMAIL_CHANGE_PATHS.request}`,
  changeStatus: `/api/${EMAIL_CHANGE_PATHS.status}`,
  changeCancel: `/api/${EMAIL_CHANGE_PATHS.cancel}`,
  sessions: `/api/${SESSION_PATHS.list}`,
  sessionsRevokeAll: `/api/${SESSION_PATHS.revokeAll}`,
  logout: `/api/${SESSION_PATHS.logout}`,
  sessionRevoke: (sessionId: string): string => `/api/${sessionRevokePath(sessionId)}`,
} as const;

/** 发起成功。`resendAvailableAt` 就是"两封信都还在路上的那段时间"的终点。 */
export interface EmailChangeRequestResult {
  message: string;
  expiresAt: number;
  resendAvailableAt: number;
}

/** 访问令牌为空 ⇒ **不发请求**（与 `hosted-auth.ts` 同一条闸门）。 */
const bearer = (token: string): string | undefined => {
  const trimmed = token.trim();
  return trimmed === '' ? undefined : trimmed;
};

/**
 * 发起换绑：**当前邮箱与新邮箱各发一封信**，两边都点才生效。
 *
 * `locale` 走 `body.locale` —— 邮件是**为收件人**渲染的，而旧地址那一侧的语言
 * 只有这个人知道（服务端的兜底顺序是 `body.locale` > 账号语言 > 默认中文）。
 */
export const requestEmailChange = async (
  options: HostedAuthOptions,
  token: string,
  newEmail: string,
): Promise<HostedAuthOutcome<EmailChangeRequestResult>> => {
  const credentials = bearer(token);
  if (credentials === undefined) return failure('invalid-input');
  const trimmedEmail = newEmail.trim();
  if (trimmedEmail === '') return failure('invalid-input');

  const locale: HostedAuthLocale | undefined = options.locale;
  const result = await sendJson(
    options,
    'POST',
    ACCOUNT_SECURITY_PATHS.changeRequest,
    { newEmail: trimmedEmail, ...(locale === undefined ? {} : { locale }) },
    credentials,
  );
  if (!result.ok) return result;

  const body = asRecord(result.body);
  const expiresAt = asFiniteNumber(body?.expiresAt);
  const resendAvailableAt = asFiniteNumber(body?.resendAvailableAt);
  // 🔴 两个时间戳缺任何一个都算**响应不像话**，不能"缺省成 0"：
  // 界面拿 0 会把"还等哪一边"渲染成"已经过期"，而那张请求在服务端还活得好好的。
  if (body === undefined || expiresAt === undefined || resendAvailableAt === undefined) {
    return failure('malformed-response');
  }
  return {
    ok: true,
    message: asString(body.message) ?? '',
    expiresAt,
    resendAvailableAt,
  };
};

/**
 * 读到"这张活请求还等哪一边"。界面上那句实话只有这一个来源 ——
 * **不许**由壳自己记"我刚才点了哪一边"（刷新一次就丢，而它会说出一句假话）。
 */
export const getEmailChangeStatus = async (
  options: HostedAuthOptions,
  token: string,
): Promise<HostedAuthOutcome<EmailChangeStatusResponse>> => {
  const credentials = bearer(token);
  if (credentials === undefined) return failure('invalid-input');

  const result = await sendJson(options, 'GET', ACCOUNT_SECURITY_PATHS.changeStatus, undefined, credentials);
  if (!result.ok) return result;

  const body = asRecord(result.body);
  const pending = asBoolean(body?.pending);
  const awaitingOld = asBoolean(body?.awaitingOld);
  const awaitingNew = asBoolean(body?.awaitingNew);
  if (body === undefined || pending === undefined || awaitingOld === undefined || awaitingNew === undefined) {
    return failure('malformed-response');
  }
  const pendingEmail = asString(body.pendingEmail);
  const expiresAt = asFiniteNumber(body.expiresAt);
  const resendAvailableAt = asFiniteNumber(body.resendAvailableAt);
  // 🔴 这个白名单解析器**会丢掉它不认识的键**，所以新字段必须在这里点名，
  //    否则服务端给了也到不了界面（症状是"界面还是旧地址，而响应里明明有"）。
  // ⚠️ 它**不能**和 `pending` 一起门控：换绑生效之后 `pending` 是 false，
  //    而那正是界面最需要读到真地址的一刻。空串按"没给"处理（不给界面留一个能显示的空值）。
  const currentEmailRaw = asString(body.currentEmail);
  const currentEmail = currentEmailRaw === undefined || currentEmailRaw === '' ? undefined : currentEmailRaw;
  return {
    ok: true,
    pending,
    awaitingOld,
    awaitingNew,
    ...(pending === true && pendingEmail !== undefined ? { pendingEmail } : {}),
    ...(currentEmail !== undefined ? { currentEmail } : {}),
    ...(pending === true && expiresAt !== undefined ? { expiresAt } : {}),
    ...(pending === true && resendAvailableAt !== undefined ? { resendAvailableAt } : {}),
  };
};

/** 撤销那张活请求（"我填错了 / 不想换了"）。 */
export const cancelEmailChange = async (
  options: HostedAuthOptions,
  token: string,
): Promise<HostedAuthOutcome<{ message: string }>> => {
  const credentials = bearer(token);
  if (credentials === undefined) return failure('invalid-input');

  const result = await sendJson(options, 'POST', ACCOUNT_SECURITY_PATHS.changeCancel, {}, credentials);
  if (!result.ok) return result;
  return { ok: true, message: asString(asRecord(result.body)?.message) ?? '' };
};

/**
 * 列出本人当前有效的登录会话。
 *
 * 🔴 服务端只列"版本号还等于账号上那个"的行，所以**改过密码 / 登出过全部设备之后**，
 * 这个列表自己就空掉了 —— 界面不需要、也不许自己记"哪些设备早就失效了"。
 */
export const listHostedSessions = async (
  options: HostedAuthOptions,
  token: string,
): Promise<HostedAuthOutcome<{ sessions: SessionSummary[] }>> => {
  const credentials = bearer(token);
  if (credentials === undefined) return failure('invalid-input');

  const result = await sendJson(options, 'GET', ACCOUNT_SECURITY_PATHS.sessions, undefined, credentials);
  if (!result.ok) return result;

  const rows = asRecord(result.body)?.sessions;
  if (!Array.isArray(rows)) return failure('malformed-response');
  const sessions: SessionSummary[] = [];
  for (const row of rows) {
    const item = asRecord(row);
    const sessionId = asString(item?.sessionId);
    const createdAt = asFiniteNumber(item?.createdAt);
    const lastSeenAt = asFiniteNumber(item?.lastSeenAt);
    const current = asBoolean(item?.current);
    // 🔴 一行里**任何**必需字段不认识就整份判 malformed，而不是丢掉那一行：
    // 少一行是"看不见那台设备"，而它还在登录着 —— 那比一次报错危险得多。
    if (sessionId === undefined || createdAt === undefined || lastSeenAt === undefined || current === undefined) {
      return failure('malformed-response');
    }
    sessions.push({
      sessionId,
      createdAt,
      lastSeenAt,
      current,
      deviceName: asNullableString(item?.deviceName),
      userAgent: asNullableString(item?.userAgent),
    });
  }
  return { ok: true, sessions };
};

/**
 * 撤销**指定那一台**的会话。不存在 / 不是你的 / 已经撤过 ⇒ 同一个 `unknown-session`，
 * 界面对这三者的处置都是"刷新这个列表"。
 */
export const revokeHostedSession = async (
  options: HostedAuthOptions,
  token: string,
  sessionId: string,
): Promise<HostedAuthOutcome<{ sessionId: string }>> => {
  const credentials = bearer(token);
  if (credentials === undefined) return failure('invalid-input');
  // 会话 id 是 SHA-256 hex。形状先拦一道，别让任意字符串进 URL 路径段。
  if (!/^[0-9a-f]{64}$/.test(sessionId)) return failure('invalid-input');

  const result = await sendJson(
    options,
    'DELETE',
    ACCOUNT_SECURITY_PATHS.sessionRevoke(sessionId),
    undefined,
    credentials,
  );
  if (!result.ok) return result;
  if (asRecord(result.body)?.success !== true) return failure('malformed-response');
  // 带回那一枚的 id：界面可以就地摘掉这一行，而不必为了"看起来生效了"再拉一次列表。
  return { ok: true, sessionId };
};

/**
 * 「登出所有设备」。
 *
 * 🔴 这一发之后**手上这一枚也失效**（服务端删全部会话行 + `tokenVersion++`，
 * 后者是为了让本轮之前那些没有 `jti`、按枚撤销撤不掉的令牌也一起作废）。
 * 所以调用方必须接着清本机凭据 —— 用 {@link planSignOut}，别在壳里各判一次。
 */
export const logoutEveryDevice = async (
  options: HostedAuthOptions,
  token: string,
): Promise<HostedAuthOutcome<{ count: number }>> => {
  const credentials = bearer(token);
  if (credentials === undefined) return failure('invalid-input');

  const result = await sendJson(options, 'POST', ACCOUNT_SECURITY_PATHS.sessionsRevokeAll, {}, credentials);
  if (!result.ok) return result;
  const count = asFiniteNumber(asRecord(result.body)?.count);
  if (count === undefined) return failure('malformed-response');
  return { ok: true, count };
};

/**
 * 「退出登录」真正该做的事：撤销**手上这一枚**。之后客户端清本机凭据。
 *
 * 在这一笔之前它什么都不撤销 —— 那枚令牌在服务端**仍然有效一整年**，
 * 而在共享电脑上"我已经退出了"是一句界面在说谎。
 */
export const logoutCurrentDevice = async (
  options: HostedAuthOptions,
  token: string,
): Promise<HostedAuthOutcome<{ message: string }>> => {
  const credentials = bearer(token);
  if (credentials === undefined) return failure('invalid-input');

  const result = await sendJson(options, 'POST', ACCOUNT_SECURITY_PATHS.logout, {}, credentials);
  if (!result.ok) return result;
  return { ok: true, message: asString(asRecord(result.body)?.message) ?? '' };
};

/**
 * 🔴 **退出这一步之后本机该怎么办**的唯一判定（两个动作共用一条规则）。
 *
 * `clearLocalCredentials` 是**恒为 true** 的常量，而且刻意由共享层说、不由界面决定：
 * 服务端撤销失败时把令牌留在本机是更坏的结果（那台设备继续以用户身份活着，
 * 而用户以为"我点了退出"）。撤销失败是**我们的**问题，不该拿用户的设备当抵押。
 *
 * `serverRevocationPending` 决定的是界面要不要老实说一句：
 * "这台设备已退出，但服务器上的那一枚暂时没能撤销"，并给一个重试入口。
 * 把它吞掉就等于让"退出登录"在断网时**看起来成功了** —— 而那正是本轮要修的那句话。
 */
export interface SignOutPlan {
  readonly clearLocalCredentials: true;
  readonly serverRevocationPending: boolean;
}

export const planSignOut = (
  result: { ok: true } | HostedAuthFailure,
): SignOutPlan =>
  result.ok
    ? { clearLocalCredentials: true, serverRevocationPending: false }
    : { clearLocalCredentials: true, serverRevocationPending: true };

/**
 * 换绑界面上那句"还等谁点"。
 *
 * 写成纯函数、放在这里，是因为三个壳都要同一句判断，而它的**输入只有 status**：
 * 一旦各壳自己拼布尔，就会出现"web 说等另一边、移动说已生效"那种漂移。
 */
export type EmailChangeStage = 'idle' | 'awaiting-both' | 'awaiting-old' | 'awaiting-new' | 'invalid';

export const emailChangeStage = (status: EmailChangeStatusResponse): EmailChangeStage => {
  if (!status.pending) return 'idle';
  // 🔴 `pending` 为真而两边都不等 ⇒ 服务端的行处在一种本不该存在的状态
  //（生效那一步会整行删掉）。说"等另一边"是假话，说"已生效"也是假话 ⇒ 老实报 invalid。
  if (status.awaitingOld && status.awaitingNew) return 'awaiting-both';
  if (status.awaitingNew) return 'awaiting-new';
  if (status.awaitingOld) return 'awaiting-old';
  return 'invalid';
};

// ── 读取响应体的那几个小工具（不认识的值一律给 undefined，不猜）──────

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

/** `null` 与"没有这个键"在界面上是**两件事**：一个是"服务端说了它没有"，一个是响应不像话。 */
const asNullableString = (value: unknown): string | null =>
  value === null ? null : (asString(value) ?? null);
