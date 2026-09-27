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
  /**
   * 已认证地给**当前账号**再添一条凭据。
   *
   * 🔴 与上面的 `passkeyRegister*`（公开注册新账号）是**两条不同的协议**：
   * 公开注册的完成端点在"email 已属于一个已验证账号"时**故意**提前返回成功
   * 而**不写任何凭据**（防账号枚举）。已登录用户走那条路只会得到一次
   * 静默空操作。这两条路径带 Bearer 令牌，归属由令牌决定。
   */
  passkeyEnrollOptions: '/api/passkeys/registration/options',
  passkeyEnrollComplete: '/api/passkeys/registration/complete',
  /** 自助管理：列出 / 删除当前账号自己的通行密钥。 */
  passkeys: '/api/passkeys',
} as const;

/**
 * 删除单条凭据的路径。
 *
 * 🔴 `encodeURIComponent` 不是装饰：id 会原样进 URL 路径。
 * 服务端那边的行 id 是 cuid（不含特殊字符），但这里**不假设**它安全 ——
 * 拼接属于协议，协议在 app-host 里只有一份，不能指望每个调用方都记得转义。
 */
export function passkeyDeletePath(id: string): string {
  return `${HOSTED_AUTH_PATHS.passkeys}/${encodeURIComponent(id)}`;
}

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
  | 'passkey-already-registered'
  /**
   * 这条通行密钥服务端**已经不认了**（多半是在别处删掉了的陈旧凭据）。
   *
   * 🔴 与 `unauthorized` 分开是缺口 B 的全部目的：以前两者都是
   * "Authentication failed"，用户分不清"这条旧密钥失效了，请重新注册或
   * 换登录方式"与"刚建的新密钥坏了"。服务端给出稳定的
   * `code: 'passkey_not_found'`，这里把它翻成一句**可执行**的话。
   */
  | 'passkey-not-found'
  /**
   * 服务端**认得**这条凭据，但这次断言没验过（签名 / 计数器 / 来源）。
   *
   * 🔴 与 `passkey-not-found` 分开：这种情况"再试一次"是有意义的，
   * 而陈旧凭据再试多少次都一样。两句不同的话对应两个不同的动作。
   */
  | 'passkey-rejected'
  /**
   * 这是账号上最后一条通行密钥，服务端**拒绝**删除（409）。
   *
   * 🔴 删掉它可能把用户永久锁在门外（`User.passwordHash` 可空，
   * 纯通行密钥账号没有别的登录方式）。界面该说的是"先添加一条新的"，
   * 而不是"操作失败，请重试" —— 后者会让用户一直重试同一个不可能成功的操作。
   */
  | 'last-passkey';

export interface HostedAuthFailure {
  ok: false;
  reason: HostedAuthFailureReason;
  /** HTTP 状态码。网络层失败 / 未发请求时为 `undefined`。 */
  status?: number;
  /** 服务端给的**安全**错误串。是数据，不是文案。 */
  message?: string;
  /**
   * 服务端给的稳定机器码（`{ code }` 字段），原样透传。
   *
   * 🔴 判别**只**按它，不按对 `message` 做字符串匹配：文案一改，
   * 匹配就悄悄失效，而失败会静默退化成笼统的一类。
   */
  code?: string;
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
  code?: string,
): HostedAuthFailure => ({
  ok: false,
  reason,
  ...(status === undefined ? {} : { status }),
  ...(message === undefined ? {} : { message }),
  ...(code === undefined ? {} : { code }),
});

/** 服务端的错误体形如 `{ error: string, details?: ... }`。只取可展示的那一段。 */
function readServerError(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const error = (body as Record<string, unknown>)['error'];
  return typeof error === 'string' && error !== '' ? error : undefined;
}

/** 服务端的稳定机器码（`{ code: string }`）。缺了就是 `undefined`，不猜。 */
function readServerCode(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const code = (body as Record<string, unknown>)['code'];
  return typeof code === 'string' && code !== '' ? code : undefined;
}

function readServerMessage(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const message = (body as Record<string, unknown>)['message'];
  return typeof message === 'string' && message !== '' ? message : undefined;
}

/**
 * 服务端的 `code` → 本层的封闭原因。
 *
 * 🔴 白名单，不是"有 code 就用"。服务端以后加一个新码，客户端**不会**
 * 悄悄把它当成某一种已知失败 —— 它会退回按状态码分类（最保守的结论），
 * 而不是猜一个可能错的动作。
 */
const FAILURE_REASON_BY_SERVER_CODE: Readonly<Record<string, HostedAuthFailureReason>> = {
  // 登录时出示的凭据服务端不认得（缺口 B）。
  passkey_not_found: 'passkey-not-found',
  // 登录时凭据认得但断言没通过（缺口 B 的另一半）。
  passkey_verification_failed: 'passkey-rejected',
  // 删除时目标凭据不是自己的 / 不存在 —— 服务端故意与上一条分开命名，
  // 但对用户来说是同一件事："这条凭据不在你的账号上了"。
  passkey_not_found_for_user: 'passkey-not-found',
  // 删除最后一条被拒绝。
  last_passkey_required: 'last-passkey',
  // 已认证"再加一条"时，这条凭据已经在服务端登记过（P2002）。
  // 前端正常会被 excludeCredentials 先挡在设备侧（InvalidStateError，
  // 同样映射到这个原因），这是绕过前端时的服务端守卫给出的码。
  passkey_already_registered: 'passkey-already-registered',
};

/** 由服务端 `code` 与 HTTP 状态共同决定原因；只有白名单里的码会覆盖状态分类。 */
function classifyFailure(
  status: number,
  code: string | undefined,
): HostedAuthFailureReason {
  if (code !== undefined) {
    const mapped = FAILURE_REASON_BY_SERVER_CODE[code];
    if (mapped !== undefined) return mapped;
  }
  return classifyStatus(status);
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
 * 发一次请求并归一结果。
 *
 * 🔴 **不抛错**。三种失败各有归宿：地址没配（不发请求）、网络层抛错（`network`）、
 * 宿主根本没有 `fetch`（同样是 `network` —— Hermes 上"没有这个全局量"是
 * 一种环境事实，不是产品崩溃）。
 *
 * `token` 是**访问令牌**（服务端发的是 Bearer，不是 cookie）。带上它时
 * 请求就是"以某个已登录用户的名义"发的 —— 列 / 删自己的凭据走这条。
 */
async function sendJson(
  options: HostedAuthOptions,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  payload?: unknown,
  token?: string,
): Promise<PostResult> {
  if (options.baseUrl.trim() === '') return failure('unconfigured');

  const impl =
    options.fetchImpl ??
    (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined);
  // 没有可用的网络实现：判成 network，而不是让 "undefined is not a function" 炸出去。
  if (impl === undefined) return failure('network');

  const headers: Record<string, string> = {};
  if (payload !== undefined) headers['content-type'] = 'application/json';
  if (token !== undefined) headers['authorization'] = `Bearer ${token}`;

  let response: Response;
  try {
    response = await impl(joinEndpointUrl(options.baseUrl, path), {
      method,
      headers,
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
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
    const code = readServerCode(body);
    return failure(
      classifyFailure(response.status, code),
      response.status,
      readServerError(body),
      code,
    );
  }

  // 🔴 2xx 但没有可解析的主体 = **不能当成功**。
  // 把这一步写成"没有就忽略"，会让"服务端返回了 HTML（比如反代配错）"
  // 看起来像"登录成功但令牌是空的" —— 而空的令牌会让同步静默失败。
  if (body === undefined) return failure('malformed-response', response.status);

  return { ok: true, body };
}

/** 发一次 POST。既有调用方全部走它，行为与重构前逐字相同。 */
async function postJson(
  options: HostedAuthOptions,
  path: string,
  payload: unknown,
): Promise<PostResult> {
  return sendJson(options, 'POST', path, payload);
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

// ── 自助管理通行密钥（列 / 删）────────────────────────────────
//
// 服务端此前只有注册 / 登录 / 恢复，用户**没有任何自助管理凭据的能力**。
// 这两个函数是那半边的协议一侧：路径、方法、令牌怎么带、响应怎么验。
//
// 🔴 「最后一条能不能删」不是这里决定的 —— 服务端拒绝并给出
// `last_passkey_required`，这里只把它翻成 `last-passkey` 这个
// 结构化原因。把守卫写在客户端等于没有守卫（旧版本客户端、直接调 API 都绕过）。

/**
 * 一条通行密钥的**用户可见**投影。
 *
 * 🔴 只有这三个字段，**没有** `credentialId` / `publicKey`：
 * 这不是"服务端顺手少给"，而是接口契约 —— 列表接口不返回凭据内部数据。
 * 客户端连解析它们的代码都不该有。
 */
export interface HostedPasskeySummary {
  /** 服务端行 id。删除时用它，**不是** credential ID。 */
  id: string;
  /** ISO 8601 字符串（原样透传服务端，不在这里转 Date）。 */
  createdAt: string;
  /** ISO 8601 或 null（从未使用过）。 */
  lastUsedAt: string | null;
}

/** 只把服务端给的三个字段挑出来。缺任何一个都判 `malformed-response`。 */
function parsePasskeySummaries(body: unknown): HostedPasskeySummary[] | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const list = (body as Record<string, unknown>)['passkeys'];
  if (!Array.isArray(list)) return undefined;

  const summaries: HostedPasskeySummary[] = [];
  for (const entry of list) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
    const record = entry as Record<string, unknown>;
    const id = record['id'];
    const createdAt = record['createdAt'];
    const lastUsedAt = record['lastUsedAt'];
    if (typeof id !== 'string' || id === '') return undefined;
    if (typeof createdAt !== 'string' || createdAt === '') return undefined;
    if (lastUsedAt !== null && typeof lastUsedAt !== 'string') return undefined;
    // 🔴 白名单映射：服务端哪天多返回一个字段，也**不会**流到界面上。
    summaries.push({ id, createdAt, lastUsedAt });
  }
  return summaries;
}

/**
 * 列出当前账号的通行密钥。
 *
 * `token` 是访问令牌；空令牌**不发请求**（判 `unauthorized`）——
 * 未登录却去问服务端要一次 401 是没有意义的往返。
 */
export async function listPasskeys(
  options: HostedAuthOptions,
  token: string,
): Promise<HostedAuthOutcome<{ passkeys: HostedPasskeySummary[] }>> {
  const trimmed = token.trim();
  if (trimmed === '') return failure('unauthorized');

  const result = await sendJson(options, 'GET', HOSTED_AUTH_PATHS.passkeys, undefined, trimmed);
  if (!result.ok) return result;

  const passkeys = parsePasskeySummaries(result.body);
  // 2xx 但形状不对 → 不能当"没有凭据"。界面把空列表画成"还没有凭据"，
  // 一次反代配错就会让用户以为自己的凭据全没了。
  if (passkeys === undefined) return failure('malformed-response');
  return { ok: true, passkeys };
}

/**
 * 删除当前账号的一条通行密钥。
 *
 * 归属由服务端按令牌判定；本函数**不**发送任何"这是谁的"字段。
 * 404（不是自己的 / 不存在）与 409（最后一条）各有自己的
 * `HostedAuthFailureReason`，界面据此说不同的话。
 */
export async function deletePasskey(
  options: HostedAuthOptions,
  input: { token: string; id: string },
): Promise<HostedAuthOutcome<{ deleted: true }>> {
  const trimmedToken = input.token.trim();
  if (trimmedToken === '') return failure('unauthorized');
  const id = input.id.trim();
  if (id === '') return failure('invalid-input');

  const result = await sendJson(
    options,
    'DELETE',
    passkeyDeletePath(id),
    undefined,
    trimmedToken,
  );
  if (!result.ok) return result;

  return { ok: true, deleted: true };
}

// ── 已认证地给当前账号「再加一条」凭据（协议一半）──────────────
//
// 🔴 为什么不是复用 `beginPasskeyRegistration`：服务端的公开注册完成端点对
// "email 已属于一个已验证账号"**故意**提前返回成功而**不写凭据**
// （防账号枚举）。已登录用户走那条路 = 界面说成功、凭据不存在。
// 而设置页在拒绝"删最后一条"时让用户"先添加一条新的" ——
// 用户照做后删掉旧的，就再也登不进去。
//
// 归属由**令牌**决定：这两个函数都不发送任何"这是谁的"字段
// （服务端从 JWT 取 userId）。这与 `deletePasskey` 是同一条纪律。
//
// 命名刻意不叫 `*Registration`：`beginPasskeyRegistration` 已经占了
// "注册一个新账号"的语义，同名会让调用方以为可以互相顶替。

/**
 * 取"给当前账号再加一条"的注册 options。
 *
 * 空令牌**不发请求**（判 `unauthorized`）—— 未登录却去要一次 401
 * 是没有意义的往返，与 `listPasskeys` 同一条 fail-safe。
 */
export async function beginPasskeyEnrollment(
  options: HostedAuthOptions,
  token: string,
): Promise<HostedAuthOutcome<{ options: HostedPasskeyOptions }>> {
  const trimmed = token.trim();
  if (trimmed === '') return failure('unauthorized');

  // 无请求体：options 的生成完全由令牌决定，客户端没有任何输入要带。
  const result = await sendJson(
    options,
    'POST',
    HOSTED_AUTH_PATHS.passkeyEnrollOptions,
    undefined,
    trimmed,
  );
  if (!result.ok) return result;

  const passkeyOptions = parsePasskeyObject(result.body);
  if (passkeyOptions === undefined) return failure('malformed-response');
  return { ok: true, options: passkeyOptions };
}

/**
 * 交回宿主产出的 credential，让服务端把它挂到当前账号上。
 *
 * 🔴 成功（`ok: true`）**就是**"凭据已经写进去了"：服务端只有在
 * `passkey.create` 真的成功之后才返回 2xx。调用方据此刷新列表，
 * 不要自造一个"看起来成功了"的乐观更新。
 */
export async function completePasskeyEnrollment(
  options: HostedAuthOptions,
  input: { token: string; credential: HostedPasskeyCredential },
): Promise<HostedAuthOutcome<{ message: string }>> {
  const trimmedToken = input.token.trim();
  if (trimmedToken === '') return failure('unauthorized');

  // 🔴 只发 `credential`。请求体里**没有** userId / email 这类归属字段：
  // 归属只由 Authorization 头上的令牌决定。服务端就算收到多余的键也会丢弃，
  // 但契约上我们连发都不发。
  const result = await sendJson(
    options,
    'POST',
    HOSTED_AUTH_PATHS.passkeyEnrollComplete,
    { credential: input.credential },
    trimmedToken,
  );
  if (!result.ok) return result;
  return { ok: true, message: readServerMessage(result.body) ?? '' };
}
