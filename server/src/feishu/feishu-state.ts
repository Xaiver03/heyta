/**
 * 飞书 OAuth 的 `state`（防登录 CSRF）—— **无状态签名 + 浏览器绑定 cookie**。
 * ======================================================================
 *
 * 为什么不用服务端存储：heyta 的同步服务可能是多副本（虽然当前 `replicaCount>1`
 * 被拒），而"把 state 存进某个进程内存"会在副本间/重启后失效。这里把 state 做成
 * **HMAC 签名的自包含值**：内容（scope/回跳/nonce/过期）在串里，服务端只验签。
 *
 * 为什么还要一枚 cookie：单纯校验 state 字符串挡不住「回调 URL 转发」——
 * 攻击者在自己的浏览器发起登录拿到一条带 code+state 的回调 URL，转给受害者，
 * 受害者浏览器一访问就被登进**攻击者的账号**。所以 `/start` 时把 `nonce` 种进
 * 一枚 HttpOnly、SameSite=Lax 的 cookie，回调时要求 **query 里的 nonce == 这枚 cookie**。
 * 转发来的回调 URL 在受害者浏览器上没有这枚 cookie，直接拒。
 *
 * 安全边界：
 *   - cookie 是 `HttpOnly`（脚本读不到）、`SameSite=Lax`（顶层 GET 跳转会带上、
 *     跨站子请求不带）、生产 `Secure`。
 *   - state 串不携带任何秘密；签名密钥用 JWT_SECRET（已要求 ≥32 字符高熵）。
 */

import * as crypto from 'crypto';

import type { FeishuAuthScope } from '@heyta/shared-schema';

export interface FeishuStatePayload {
  readonly scope: FeishuAuthScope;
  /** 成功落地的产物页路径（站内绝对路径）。 */
  readonly redirectPath: string;
  /** 一次性随机串，同时写进浏览器 cookie，用于把回调和发起它的浏览器绑定。 */
  readonly nonce: string;
  /** 过期时刻（epoch 毫秒）。 */
  readonly expiresAt: number;
}

const STATE_TTL_MS = 10 * 60 * 1000;

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function sign(secret: string, data: string): string {
  return b64url(crypto.createHmac('sha256', secret).update(data).digest());
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** 生成一枚新 state。返回串与其中的 nonce（nonce 用于种 cookie）。 */
export function createState(
  payload: Omit<FeishuStatePayload, 'nonce' | 'expiresAt'>,
  secret: string,
  now: number = Date.now(),
): { state: string; nonce: string } {
  const nonce = crypto.randomBytes(24).toString('base64url');
  const full: FeishuStatePayload = {
    scope: payload.scope,
    redirectPath: payload.redirectPath,
    nonce,
    expiresAt: now + STATE_TTL_MS,
  };
  const data = b64url(Buffer.from(JSON.stringify(full), 'utf8'));
  const state = `${data}.${sign(secret, data)}`;
  return { state, nonce };
}

/**
 * 校验一枚 state。返回解析后的 payload；签名不符 / 过期 / 形状不符都返回 `null`
 * （**不区分原因** —— 对外只有一个 `invalid_state`）。
 */
export function verifyState(state: string, secret: string, now: number = Date.now()): FeishuStatePayload | null {
  const raw = String(state ?? '');
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const data = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  if (!safeEqual(sign(secret, data), signature)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  const scope = record.scope;
  if (scope !== 'app' && scope !== 'admin') return null;
  const redirectPath = record.redirectPath;
  const nonce = record.nonce;
  const expiresAt = record.expiresAt;
  if (typeof redirectPath !== 'string' || typeof nonce !== 'string' || typeof expiresAt !== 'number') return null;
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
  return { scope, redirectPath, nonce, expiresAt };
}

/** 只接受站内绝对路径：单个 `/` 开头，排除 `//host`、`/\host` 与控制字符。 */
export function sanitizeLanding(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const value = raw.trim();
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  return value;
}

// ── Cookie 小工具（不引第三方；只解析/序列化我们自己这一枚）───────────────────

export function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) {
      const value = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return null;
}

export interface CookieOptions {
  readonly maxAgeSeconds: number;
  readonly secure: boolean;
}

export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${options.maxAgeSeconds}`,
  ];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

/** 生产/HTTPS 下 cookie 加 Secure。按 PUBLIC_URL 协议判，不猜部署。 */
export function secureCookies(origin: string): boolean {
  return origin.startsWith('https://');
}

export { STATE_TTL_MS, safeEqual as timingSafeEqualString };
