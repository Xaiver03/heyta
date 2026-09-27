/**
 * 服务端认证客户端（**宿主无关**）
 * =================================
 *
 * 服务端**早就有完整认证**（邮箱验证 / 通行密钥注册与登录 / 恢复 / 登录链接），
 * 但在本文件之前**没有任何客户端调用过它** —— 用户唯一的凭据入口是同步设置里
 * 三个手填的输入框，而且没人告诉他令牌从哪来。
 *
 * 本文件是那份缺口的**协议一侧**：把服务端既有的 HTTP 契约收成一组**窄而显式**
 * 的函数，供三个宿主（Web / 移动 / 非 Web）共用。
 *
 * ## 🔴 为什么在 `packages/app-host`，不在 `apps/web`
 *
 * 每个函数都在决定"业务上该怎么做"（AGENTS.md §3.5 的判据）：
 *   - 哪个路径、发什么字段、成功长什么样；
 *   - 失败如何归类（400/401/403/429/5xx/断网/响应不像话）；
 *   - 凭据从哪里取出来（响应体里的 `token`，不是 cookie）。
 *
 * 这三件事必须**所有宿主逐字相同**：认证协议漂移的后果不是"某个平台少个按钮"，
 * 而是"某台设备永远登不进自己的服务器"。宿主只该决定"用什么网络实现"与
 * "怎么把 options 交给平台的人机接口"。
 *
 * ## 🔴 通行密钥只做协议，不做平台调用
 *
 * `beginPasskey*` 只负责**取 options**，`completePasskey*` 只负责**交 credential**。
 * 中间那一步 —— `navigator.credentials.create()` / `.get()` 或原生等价物 ——
 * **刻意留在宿主里**：浏览器与 Hermes（乃至未来的原生模块）差异极大，
 * 而且那一步调用的返回值形状是平台决定的。把平台调用塞进这里，
 * 等于让 app-host 依赖一个在非 Web 宿主上不存在的全局量。
 *
 * ## 凭据形式（以代码为准，不是猜的）
 *
 * 服务端**不发 cookie**。令牌在**响应体**里：
 *
 *   - `POST /api/login/magic-link/verify` → `{ token, user: { id, email } }`
 *   - `POST /api/login/passkey/verify`    → `{ token, user: { id, email } }`
 *
 * 也就是说 `completePasskeyLogin` / `verifyMagicLink` 是仅有的两个
 * 会产出 `HostedAuthSession` 的函数。
 *
 * ## 失败是可判定的结果，不是异常
 *
 * 全部函数返回 `{ ok: true, ... } | { ok: false, reason, status?, message? }`，
 * 与同目录的 `ai-*.ts`、`entitlement.ts` 同一形状。**任何路径都不抛错** ——
 * "登录失败"是正常状态，不是崩溃点。`message` 是服务端给的安全文案（**数据**，
 * 不翻译）；用户看到的句子由壳按 `reason` 取词条。
 *
 * 🔴 fail-safe 的两个具体动作：
 *   1. `baseUrl` 为空 → **一个请求都不发**（自托管/未配置不受影响）；
 *   2. 宿主没有 `fetch`（Hermes 某些配置下）→ 判 `network`，**不是**进程崩溃。
 *
 * `packages/app-host/tests/hosted-auth.spec.ts` 用注入的 `fetch` 把这些逐条钉住。
 */

import { joinEndpointUrl } from './endpoint-url.js';

/**
 * 服务端认证端点。
 *
 * 🔴 路径**只在这一次定义**，常量同时被测试当作断言目标。
 * 服务端注册在 `prefix: '/api'` 下（见 `server/src/server.ts`），
 * 所以这里的路径都带 `/api`。
 */
export const HOSTED_AUTH_PATHS = {
  verifyEmail: '/api/verify-email',
  magicLinkRegister: '/api/register/magic-link',
  magicLinkRequest: '/api/login/magic-link',
  magicLinkVerify: '/api/login/magic-link/verify',
  passkeyRegisterOptions: '/api/register/passkey/options',
  passkeyRegisterVerify: '/api/register/passkey/verify',
  passkeyLoginOptions: '/api/login/passkey/options',
  passkeyLoginVerify: '/api/login/passkey/verify',
  passkeyRecoverRequest: '/api/recover/passkey',
  passkeyRecoverOptions: '/api/recover/passkey/options',
  passkeyRecoverComplete: '/api/recover/passkey/complete',
} as const;

/** 一次登录得到的会话。`token` 就是要填进同步设置的访问令牌。 */
export interface HostedAuthSession {
  token: string;
  user: { id: number; email: string };
}

/**
 * 通行密钥的 options / credential。
 *
 * 🔴 刻意是 `Record<string, unknown>` 而不是从 `@simplewebauthn` 引入的类型：
 * 那会变成 app-host 的新依赖（AGENTS.md §3.1–3.2 两道门），而这里
 * **一个字段都不消费** —— 原样取出来交给宿主的人机接口，再把宿主拿到的
 * credential 原样交回服务端。服务端才是校验它的人。
 */
export type HostedPasskeyOptions = Record<string, unknown>;
export type HostedPasskeyCredential = Record<string, unknown>;

/**
 * 失败原因。**封闭集合** —— 壳按它取词条，所以每加一条都要想清楚
 * "用户看到的句子会因此不同吗"。
 */
export type HostedAuthFailureReason =
  /** 没填服务端地址。**不发请求**。 */
  | 'unconfigured'
  /** 服务端说输入不合法（400）。含"要求同意法律条款但没勾"。 */
  | 'invalid-input'
  /** 该实例不允许这个邮箱注册（403）。 */
  | 'not-allowed'
  /** 令牌/链接无效或已过期（401）。 */
  | 'unauthorized'
  /** 请求太频繁（429）。 */
  | 'rate-limited'
  /** 其它 4xx。 */
  | 'request-rejected'
  /** 断网 / DNS / 证书 / 宿主没有 fetch。 */
  | 'network'
  /** 5xx。 */
  | 'server-error'
  /** 2xx 但响应体不是预期的 JSON 形状。**绝不当成功**。 */
  | 'malformed-response'
  /**
   * 这台设备/浏览器没有通行密钥能力（`navigator.credentials` 或
   * `PublicKeyCredential` 不存在），请求**一个都没发**。
   *
   * 🔴 与"用户拒绝"是**两句不同的话**：这个在这个设备上再试多少次都一样，
   * 用户该换设备或改用登录链接；而拒绝重试一次就行。
   */
  | 'passkey-unsupported'
  /**
   * 用户在系统弹窗里取消 / 超时 / 设备上没有可选凭据。
   *
   * 🔴 刻意**不复用** `not-allowed`：后者的契约是"服务端 403，该实例不允许
   * 这个邮箱注册"。拿它当"用户取消"，会让真正的 403 在界面上显示成
   * "你取消了通行密钥" —— 一句把服务端策略说成用户行为的假话。
   */
  | 'passkey-cancelled'
  /**
   * 这台设备上**已经有**这个账号的通行密钥了（WebAuthn 的 `InvalidStateError`，
   * 由服务端下发的 `excludeCredentials` 命中触发）。
   *
   * 🔴 同样不复用 `passkey-cancelled`：用户**什么都没取消**，
   * 该做的是改用"用通行密钥登录"，而不是"再试一次" —— 再试一次会永远同样失败。
   */
  | 'passkey-already-registered';

export interface HostedAuthFailure {
  ok: false;
  reason: HostedAuthFailureReason;
  /** HTTP 状态码。网络层失败 / 未发请求时为 `undefined`。 */
  status?: number;
  /** 服务端给的**安全**错误串。是数据，不是文案。 */
  message?: string;
}

/** 统一的返回形状：成功分支自己带字段，失败分支永远可判定。 */
export type HostedAuthOutcome<T> = (T & { ok: true }) | HostedAuthFailure;

export interface HostedAuthOptions {
  /** 服务端根地址，例如 `http://127.0.0.1:3000`。空串 = 未配置。 */
  baseUrl: string;
  /** 网络实现，宿主注入（浏览器 fetch / RN fetch / 测试替身）。 */
  fetchImpl?: typeof fetch;
}

/** 只报 2xx 主体，失败已归一成 `HostedAuthFailure`。 */
type PostResult = { ok: true; body: unknown } | HostedAuthFailure;

const failure = (
  reason: HostedAuthFailureReason,
  status?: number,
  message?: string,
): HostedAuthFailure => ({
  ok: false,
  reason,
  ...(status === undefined ? {} : { status }),
  ...(message === undefined ? {} : { message }),
});

/** 服务端的错误体形如 `{ error: string, details?: ... }`。只取可展示的那一段。 */
function readServerError(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const error = (body as Record<string, unknown>)['error'];
  return typeof error === 'string' && error !== '' ? error : undefined;
}

function readServerMessage(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const message = (body as Record<string, unknown>)['message'];
  return typeof message === 'string' && message !== '' ? message : undefined;
}

/** HTTP 状态 → 原因。分类只按**用户能做的动作**分，不按服务端实现分。 */
function classifyStatus(status: number): HostedAuthFailureReason {
  if (status >= 500) return 'server-error';
  switch (status) {
    case 400:
      return 'invalid-input';
    case 401:
      return 'unauthorized';
    case 403:
      return 'not-allowed';
    case 429:
      return 'rate-limited';
    default:
      return 'request-rejected';
  }
}

/**
 * 发一次 POST 并归一结果。
 *
 * 🔴 **不抛错**。三种失败各有归宿：地址没配（不发请求）、网络层抛错（`network`）、
 * 宿主根本没有 `fetch`（同样是 `network` —— Hermes 上"没有这个全局量"是
 * 一种环境事实，不是产品崩溃）。
 */
async function postJson(
  options: HostedAuthOptions,
  path: string,
  payload: unknown,
): Promise<PostResult> {
  if (options.baseUrl.trim() === '') return failure('unconfigured');

  const impl =
    options.fetchImpl ??
    (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined);
  // 没有可用的网络实现：判成 network，而不是让 "undefined is not a function" 炸出去。
  if (impl === undefined) return failure('network');

  let response: Response;
  try {
    response = await impl(joinEndpointUrl(options.baseUrl, path), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    return failure('network');
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // 响应体不是 JSON（或为空）。状态码仍然有效 —— 别因为解析失败丢掉结论。
    body = undefined;
  }

  if (!response.ok) {
    return failure(classifyStatus(response.status), response.status, readServerError(body));
  }

  // 🔴 2xx 但没有可解析的主体 = **不能当成功**。
  // 把这一步写成"没有就忽略"，会让"服务端返回了 HTML（比如反代配错）"
  // 看起来像"登录成功但令牌是空的" —— 而空的令牌会让同步静默失败。
  if (body === undefined) return failure('malformed-response', response.status);

  return { ok: true, body };
}

/** 邮箱归一：服务端自己做格式校验（唯一事实源），这里只挡"空的"这一种。 */
function normalizedEmail(email: string): string | undefined {
  const trimmed = email.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** 从响应体里取出会话。缺任何一项都判 `malformed-response`。 */
function parseSession(body: unknown): HostedAuthSession | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const record = body as Record<string, unknown>;
  const token = record['token'];
  if (typeof token !== 'string' || token === '') return undefined;

  const user = record['user'];
  if (user === null || typeof user !== 'object' || Array.isArray(user)) return undefined;
  const userRecord = user as Record<string, unknown>;
  const id = userRecord['id'];
  const email = userRecord['email'];
  if (typeof id !== 'number' || typeof email !== 'string') return undefined;

  return { token, user: { id, email } };
}

/** options / credential 这类"宿主负责解释"的 JSON 对象。 */
function parsePasskeyObject(value: unknown): HostedPasskeyOptions | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as HostedPasskeyOptions;
}

// ── 登录链接（magic link）─────────────────────────────────────

/**
 * 发一封登录链接邮件。
 *
 * 🔴 服务端**永远**回同一句中性文案（防邮箱枚举），所以成功**不代表**
 * "该邮箱存在" —— 界面不许把它渲染成"已登录"。
 */
export async function requestMagicLink(
  options: HostedAuthOptions,
  email: string,
): Promise<HostedAuthOutcome<{ message: string }>> {
  const normalized = normalizedEmail(email);
  if (normalized === undefined) return failure('invalid-input');

  const result = await postJson(options, HOSTED_AUTH_PATHS.magicLinkRequest, {
    email: normalized,
  });
  if (!result.ok) return result;
  return { ok: true, message: readServerMessage(result.body) ?? '' };
}

/**
 * 注册新账号（只凭邮箱）。
 *
 * `termsAccepted` 只在**用户真的勾了**的时候才传 —— 服务端在这条字段上
 * 用的是 `z.literal(true)`，缺键即类型错误。我们**不替用户发明同意**
 * （服务端自己的注释写得很清楚：`Never invent an acceptance`）。
 *
 * 实例没提供法律页面时该字段是可选的，不传也能注册。
 */
export async function registerWithMagicLink(
  options: HostedAuthOptions,
  input: { email: string; termsAccepted?: boolean },
): Promise<HostedAuthOutcome<{ message: string }>> {
  const normalized = normalizedEmail(input.email);
  if (normalized === undefined) return failure('invalid-input');

  const result = await postJson(options, HOSTED_AUTH_PATHS.magicLinkRegister, {
    email: normalized,
    ...(input.termsAccepted === undefined ? {} : { termsAccepted: input.termsAccepted }),
  });
  if (!result.ok) return result;
  return { ok: true, message: readServerMessage(result.body) ?? '' };
}

/**
 * 用登录链接里的令牌换会话。
 *
 * 🔴 这是**产出令牌的入口之一**。服务端把 JWT 放在响应体里（不发 cookie）。
 */
export async function verifyMagicLink(
  options: HostedAuthOptions,
  token: string,
): Promise<HostedAuthOutcome<{ session: HostedAuthSession }>> {
  const trimmed = token.trim();
  if (trimmed === '') return failure('invalid-input');

  const result = await postJson(options, HOSTED_AUTH_PATHS.magicLinkVerify, { token: trimmed });
  if (!result.ok) return result;

  const session = parseSession(result.body);
  if (session === undefined) return failure('malformed-response');
  return { ok: true, session };
}

/**
 * 验证邮箱。
 *
 * 这一步**不产出令牌**：它只是把账号标成已验证，之后用户还要走一次登录。
 * 界面必须如实区分"已验证"与"已登录"。
 */
export async function verifyEmailAddress(
  options: HostedAuthOptions,
  token: string,
): Promise<HostedAuthOutcome<{ message: string }>> {
  const trimmed = token.trim();
  if (trimmed === '') return failure('invalid-input');

  const result = await postJson(options, HOSTED_AUTH_PATHS.verifyEmail, { token: trimmed });
  if (!result.ok) return result;
  return { ok: true, message: readServerMessage(result.body) ?? '' };
}

/**
 * 从用户粘贴的东西里取出令牌。
 *
 * 接受两种输入，别的都返回 `undefined`：
 *   1. 完整/相对链接：`https://host/magic-login?token=abc`、`/verify-email?token=abc`
 *   2. 裸令牌：一封邮件里那串十六进制
 *
 * ⚠️ 这是**协议知识**（链接长什么样、参数叫什么），所以在这里而不在界面里。
 * 返回 `undefined` 是"这段文本里没有令牌"，不是错误 —— 界面据此提示用户重贴。
 */
export function extractAuthLinkToken(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed === '') return undefined;

  const queryIndex = trimmed.indexOf('?');
  if (queryIndex !== -1) {
    for (const pair of trimmed.slice(queryIndex + 1).split('&')) {
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      if (pair.slice(0, eq) !== 'token') continue;
      const value = pair.slice(eq + 1);
      if (value === '') continue;
      try {
        return decodeURIComponent(value);
      } catch {
        // 非法百分号编码：原样返回比丢掉好 —— 服务端会给出权威判定。
        return value;
      }
    }
    return undefined;
  }

  // 裸令牌：带空白就不是令牌（多半是用户粘了一整段话）。
  if (/\s/.test(trimmed)) return undefined;
  return trimmed;
}

// ── 通行密钥（协议一半：取 options / 交 credential）──────────

/** 取注册 options。`credential` 由宿主用平台 API 产出，不在本层。 */
export async function beginPasskeyRegistration(
  options: HostedAuthOptions,
  input: { email: string; termsAccepted?: boolean },
): Promise<HostedAuthOutcome<{ options: HostedPasskeyOptions }>> {
  const normalized = normalizedEmail(input.email);
  if (normalized === undefined) return failure('invalid-input');

  const result = await postJson(options, HOSTED_AUTH_PATHS.passkeyRegisterOptions, {
    email: normalized,
    ...(input.termsAccepted === undefined ? {} : { termsAccepted: input.termsAccepted }),
  });
  if (!result.ok) return result;

  const passkeyOptions = parsePasskeyObject(result.body);
  if (passkeyOptions === undefined) return failure('malformed-response');
  return { ok: true, options: passkeyOptions };
}

/** 交回宿主产出的注册 credential。成功只表示"账号建好了"，**令牌还要登录拿**。 */
export async function completePasskeyRegistration(
  options: HostedAuthOptions,
  input: { email: string; credential: HostedPasskeyCredential },
): Promise<HostedAuthOutcome<{ message: string }>> {
  const normalized = normalizedEmail(input.email);
  if (normalized === undefined) return failure('invalid-input');

  const result = await postJson(options, HOSTED_AUTH_PATHS.passkeyRegisterVerify, {
    email: normalized,
    credential: input.credential,
  });
  if (!result.ok) return result;
  return { ok: true, message: readServerMessage(result.body) ?? '' };
}

/** 取登录 options。 */
export async function beginPasskeyLogin(
  options: HostedAuthOptions,
  email: string,
): Promise<HostedAuthOutcome<{ options: HostedPasskeyOptions }>> {
  const normalized = normalizedEmail(email);
  if (normalized === undefined) return failure('invalid-input');

  const result = await postJson(options, HOSTED_AUTH_PATHS.passkeyLoginOptions, {
    email: normalized,
  });
  if (!result.ok) return result;

  const passkeyOptions = parsePasskeyObject(result.body);
  if (passkeyOptions === undefined) return failure('malformed-response');
  return { ok: true, options: passkeyOptions };
}

/** 交回登录 credential。**另一个产出令牌的入口。** */
export async function completePasskeyLogin(
  options: HostedAuthOptions,
  input: { email: string; credential: HostedPasskeyCredential },
): Promise<HostedAuthOutcome<{ session: HostedAuthSession }>> {
  const normalized = normalizedEmail(input.email);
  if (normalized === undefined) return failure('invalid-input');

  const result = await postJson(options, HOSTED_AUTH_PATHS.passkeyLoginVerify, {
    email: normalized,
    credential: input.credential,
  });
  if (!result.ok) return result;

  const session = parseSession(result.body);
  if (session === undefined) return failure('malformed-response');
  return { ok: true, session };
}

/** 申请恢复：让服务端把恢复链接发到邮箱。成功文案与登录链接同样是中性的。 */
export async function requestPasskeyRecovery(
  options: HostedAuthOptions,
  email: string,
): Promise<HostedAuthOutcome<{ message: string }>> {
  const normalized = normalizedEmail(email);
  if (normalized === undefined) return failure('invalid-input');

  const result = await postJson(options, HOSTED_AUTH_PATHS.passkeyRecoverRequest, {
    email: normalized,
  });
  if (!result.ok) return result;
  return { ok: true, message: readServerMessage(result.body) ?? '' };
}

/** 用恢复链接里的令牌取新通行密钥的注册 options。 */
export async function getPasskeyRecoveryOptions(
  options: HostedAuthOptions,
  token: string,
): Promise<HostedAuthOutcome<{ email: string; options: HostedPasskeyOptions }>> {
  const trimmed = token.trim();
  if (trimmed === '') return failure('invalid-input');

  const result = await postJson(options, HOSTED_AUTH_PATHS.passkeyRecoverOptions, {
    token: trimmed,
  });
  if (!result.ok) return result;

  if (result.body === null || typeof result.body !== 'object' || Array.isArray(result.body)) {
    return failure('malformed-response');
  }
  const record = result.body as Record<string, unknown>;
  const email = record['email'];
  const passkeyOptions = parsePasskeyObject(record['options']);
  if (typeof email !== 'string' || passkeyOptions === undefined) {
    return failure('malformed-response');
  }
  return { ok: true, email, options: passkeyOptions };
}

/** 完成恢复：交回新通行密钥的 credential。同样不产出令牌。 */
export async function completePasskeyRecovery(
  options: HostedAuthOptions,
  input: { token: string; credential: HostedPasskeyCredential },
): Promise<HostedAuthOutcome<{ message: string }>> {
  const trimmed = input.token.trim();
  if (trimmed === '') return failure('invalid-input');

  const result = await postJson(options, HOSTED_AUTH_PATHS.passkeyRecoverComplete, {
    token: trimmed,
    credential: input.credential,
  });
  if (!result.ok) return result;
  return { ok: true, message: readServerMessage(result.body) ?? '' };
}
