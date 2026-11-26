/**
 * 日历订阅源的**无状态令牌**（HMAC 签名）
 * =====================================
 *
 * 订阅 URL 要能被 Google / Outlook / Apple 的日历客户端**无登录抓取**，所以不能靠会话
 * JWT；但也不能把 userId 明文暴露。做法：`base64url(payload) + '.' + HMAC-SHA256`。
 *
 * - payload：`{u: userId, v: 1}`（`v` 是版本，便于以后换格式）；
 * - 密钥：`CALENDAR_FEED_SECRET`（≥32 字节）。缺省/过短 ⇒ 功能禁用（路由回 503），
 *   而不是用一个弱默认密钥把所有人的日历暴露出去。
 * - 校验用 `timingSafeEqual`，避免比较期侧信道。
 *
 * 纯函数 + 注入密钥，便于单测；不碰数据库、不读环境。
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface CalendarFeedTokenPayload {
  readonly u: number;
  readonly v: 1;
}

function hmac(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

/** 签发令牌。 */
export function signCalendarFeedToken(userId: number, secret: string): string {
  const payload: CalendarFeedTokenPayload = { u: userId, v: 1 };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${hmac(body, secret)}`;
}

/** 校验令牌，返回 userId；任何不合法都返回 `undefined`（不抛、不区分原因）。 */
export function verifyCalendarFeedToken(token: string, secret: string): number | undefined {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return undefined;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = hmac(body, secret);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (parsed === null || typeof parsed !== 'object') return undefined;
    const record = parsed as Record<string, unknown>;
    const u = record['u'];
    const v = record['v'];
    if (v !== 1 || typeof u !== 'number' || !Number.isInteger(u) || u <= 0) return undefined;
    return u;
  } catch {
    return undefined;
  }
}
