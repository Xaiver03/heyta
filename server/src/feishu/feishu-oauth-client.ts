/**
 * 飞书网页应用登录（OAuth 2.0）的**协议层**。
 * ==========================================
 *
 * 只做三件事：拼授权页地址、用授权码换 user_access_token、用 token 取用户信息。
 * 不碰会话、不碰数据库 —— 那是 `feishu-auth-service.ts` 与 `feishu.routes.ts` 的事。
 * 与 x-c 的同名模块同源（同一套端点与返回形状），只是改成 TS 并接本项目配置。
 *
 * 官方文档（2026-11 现读）：
 *   - 发起授权：GET https://accounts.feishu.cn/open-apis/authen/v1/authorize
 *   - 换取 token：POST https://open.feishu.cn/open-apis/authen/v2/oauth/token
 *   - 获取用户：GET https://open.feishu.cn/open-apis/authen/v1/user_info
 *
 * 安全边界：
 *   - 只处理 user_access_token，**不落库、不打印**；它只在一次回调的生命周期里存在。
 *   - 上游返回的错误码只用于日志与内部映射，**绝不原样回显给用户**（避免泄漏应用信息）。
 */

import type { FeishuLoginConfig } from './feishu-config';

/** 协议层错误。`status` 是给 HTTP 层用的语义码，`code` 是上游机器码（仅日志）。 */
export class FeishuOAuthError extends Error {
  readonly code: number | null;
  readonly status: number;
  constructor(message: string, options: { code?: number | null; status?: number } = {}) {
    super(message);
    this.name = 'FeishuOAuthError';
    this.code = options.code ?? null;
    this.status = options.status ?? 502;
  }
}

/** 归一化后的飞书用户画像。`openId` 是唯一硬性字段。 */
export interface FeishuProfile {
  readonly openId: string;
  readonly unionId: string | null;
  readonly name: string | null;
  /** 飞书返回的邮箱（需 scope；未开通时为 null，登录改走 open_id）。 */
  readonly email: string | null;
  readonly tenantKey: string | null;
}

type FetchLike = typeof globalThis.fetch;

/**
 * 拼接授权页地址。scope 为空时**不传**该参数：飞书对未在应用后台开通的 scope
 * 会在授权页报 20027，所以在没开通 `contact:user.email:readonly` 之前，
 * 不传 scope 反而能正常登录（只是拿不到邮箱，open_id 仍可用于绑定）。
 */
export function buildAuthorizeUrl(
  config: FeishuLoginConfig,
  params: { redirectUri: string; state: string; scope?: string },
): string {
  let url: URL;
  try {
    url = new URL(config.authorizeEndpoint);
  } catch {
    throw new FeishuOAuthError('飞书登录地址配置不合法', { status: 500 });
  }
  url.searchParams.set('client_id', config.appId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', params.redirectUri);
  if (params.state) url.searchParams.set('state', params.state);
  const requestedScope = params.scope !== undefined ? params.scope : config.scope;
  if (requestedScope) url.searchParams.set('scope', requestedScope);
  return url.toString();
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await response.json();
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function upstreamCode(payload: Record<string, unknown> | null): number | null {
  if (payload && typeof payload.code === 'number') return payload.code;
  return null;
}

export interface ExchangedToken {
  readonly accessToken: string;
  readonly expiresIn: number | null;
  readonly scope: string | null;
  readonly refreshToken: string | null;
}

/** 用授权码换 user_access_token。 */
export async function exchangeCode(args: {
  config: FeishuLoginConfig;
  code: string;
  redirectUri: string;
  fetchImpl?: FetchLike;
}): Promise<ExchangedToken> {
  const { config, code, redirectUri } = args;
  if (!code) throw new FeishuOAuthError('缺少授权码', { status: 400 });
  const doFetch = args.fetchImpl ?? globalThis.fetch;

  const body: Record<string, string> = {
    grant_type: 'authorization_code',
    client_id: config.appId,
    client_secret: config.appSecret,
    code: String(code),
  };
  if (redirectUri) body.redirect_uri = redirectUri;

  let response: Response;
  try {
    response = await doFetch(config.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new FeishuOAuthError('无法连接飞书登录服务，请稍后重试', { status: 502 });
  }

  const payload = await readJson(response);
  const code$ = upstreamCode(payload);
  const accessToken = payload && typeof payload.access_token === 'string' ? payload.access_token : '';
  // 20003/20004/20065 = code 无效/过期/已用；20010 = 无应用使用权限（常见于非本企业用户）。
  if (!response.ok || !payload || (code$ !== null && code$ !== 0) || !accessToken) {
    throw new FeishuOAuthError('飞书授权校验失败，请重新登录', { code: code$, status: 401 });
  }

  return {
    accessToken,
    expiresIn: payload && typeof payload.expires_in === 'number' ? payload.expires_in : null,
    scope: payload && typeof payload.scope === 'string' ? payload.scope : null,
    refreshToken: payload && typeof payload.refresh_token === 'string' ? payload.refresh_token : null,
  };
}

function pick(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** 把 user_info 的 data 归一化成登录需要的最小画像。open_id 是唯一硬性字段。 */
export function normalizeProfile(data: unknown): FeishuProfile {
  if (data === null || typeof data !== 'object') {
    throw new FeishuOAuthError('飞书没有返回用户信息', { status: 502 });
  }
  const record = data as Record<string, unknown>;
  const openId = String(record.open_id ?? '').trim();
  if (!openId) throw new FeishuOAuthError('飞书没有返回用户标识', { status: 502 });
  return {
    openId,
    unionId: pick(record.union_id),
    name: pick(record.name) ?? pick(record.en_name),
    // email 需要 contact:user.email:readonly；没开通时为 null，登录改走 open_id。
    email: pick(record.email) ?? pick(record.enterprise_email),
    tenantKey: pick(record.tenant_key),
  };
}

/** 用 user_access_token 取用户信息。 */
export async function fetchUserInfo(args: {
  accessToken: string;
  config: FeishuLoginConfig;
  fetchImpl?: FetchLike;
}): Promise<FeishuProfile> {
  const { accessToken, config } = args;
  if (!accessToken) throw new FeishuOAuthError('缺少访问令牌', { status: 500 });
  const doFetch = args.fetchImpl ?? globalThis.fetch;

  let response: Response;
  try {
    response = await doFetch(config.userInfoEndpoint, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
  } catch {
    throw new FeishuOAuthError('无法连接飞书登录服务，请稍后重试', { status: 502 });
  }

  const payload = await readJson(response);
  const code$ = upstreamCode(payload);
  const data = payload ? payload.data : undefined;
  if (!response.ok || !payload || (code$ !== null && code$ !== 0) || data === undefined) {
    throw new FeishuOAuthError('读取飞书用户信息失败', { code: code$, status: 502 });
  }
  return normalizeProfile(data);
}
