/**
 * 邮箱验证码登录（2026-10-10）
 * =====================================================
 *
 * 与注册验证码（`registration-otp.ts`）**同族但分开**的一条挑战流：
 * 输入邮箱 → 收 6 位码 → 换会话。它存在的产品理由：魔法链接要求"从这封邮件
 * 点出去"，而验证码可以**手动跨设备输入**（手机上收码、平板上输入），且
 * 无口令账号（魔法链接 / 通行密钥注册的）此前除了链接没有第二条路。
 *
 * 🔴 反枚举口径与注册那条**逐字一致**：
 *   · 账号不存在 / 未验证 ⇒ **诱饵响应**（201、形状相同、不发信、不落库、不打日志）；
 *   · 挑战不存在 / 已过期 / 已消费 / 码不对 ⇒ 四者同一个码 `invalid_login_challenge`；
 *   · 重发冷却 / 次数上限 ⇒ `login_code_rate_limited` + `Retry-After`。
 * 区分其中任何一条，注册接口就变成一个"这个邮箱有没有账号"的预言机。
 *
 * 🔴 码的唯一存储形态是 HMAC 摘要（purpose + challengeId 一起防跨挑战重放），
 * 与注册那条共用同一个密钥派生但**purpose 不同** —— 两边的码互不可用。
 */
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  EMAIL_LOGIN_CODE_LENGTH,
  EMAIL_LOGIN_CODE_TTL_MS,
  EMAIL_LOGIN_RESEND_COOLDOWN_MS,
  EMAIL_LOGIN_ERROR_CODES,
  type EmailLoginErrorCode,
} from '@heyta/shared-schema';
import { prisma } from '../db';
import { getJwtSecret, issueSession } from '../auth';
import type { SessionMeta } from '../account/access-sessions';
import { sendLoginCodeEmail } from '../email';
import { normalizeEmail } from '../account/email-normalize';
import type { ServerLocale } from '../copy.generated.js';

export const LOGIN_CODE_MAX_ATTEMPTS = 5;
export const LOGIN_CODE_MAX_RESENDS = 5;
export const LOGIN_CODE_TTL_MS = EMAIL_LOGIN_CODE_TTL_MS;
export const LOGIN_CODE_RESEND_COOLDOWN_MS = EMAIL_LOGIN_RESEND_COOLDOWN_MS;

const LOGIN_CODE_PURPOSE = 'email-login:v1';

export type LoginOtpErrorCode = (typeof EMAIL_LOGIN_ERROR_CODES)[number];

export class LoginOtpError extends Error {
  constructor(
    readonly code: LoginOtpErrorCode,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'LoginOtpError';
  }
}

export interface EmailLoginChallengeResponse {
  challengeId: string;
  expiresAt: number;
  resendAvailableAt: number;
  emailDelivered?: boolean;
}

const codeFor = (): string =>
  randomInt(0, 1_000_000).toString().padStart(EMAIL_LOGIN_CODE_LENGTH, '0');

export const loginCodeDigest = (challengeId: string, code: string): string =>
  createHmac('sha256', getLoginCodeKey())
    .update(`${LOGIN_CODE_PURPOSE}:${challengeId}:${code}`, 'utf8')
    .digest('hex');

const getLoginCodeKey = (): Buffer =>
  createHmac('sha256', getJwtSecret())
    .update('heyta:email-login-code-key:v1', 'utf8')
    .digest();

const sameDigest = (left: string, right: string): boolean => {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
};

const invalidChallenge = (): LoginOtpError =>
  new LoginOtpError('invalid_login_challenge', 'This login code is invalid or has expired.');

const challengeResponse = (
  challengeId: string,
  expiresAt: bigint,
  resendAvailableAt: bigint,
  emailDelivered?: boolean,
): EmailLoginChallengeResponse => ({
  challengeId,
  expiresAt: Number(expiresAt),
  resendAvailableAt: Number(resendAvailableAt),
  ...(emailDelivered === undefined ? {} : { emailDelivered }),
});

/**
 * 诱饵响应：与真实挑战**同形状同状态码**，但没有 `emailDelivered` 字段
 * （真实路径只有在真的尝试发信后才会带它 —— 客户端按"字面量 false"才读出
 * "没发出去"，其余一切都说"去查收件箱"，见 hosted-auth 的严格读取）。
 */
const decoyResponse = (now: number): EmailLoginChallengeResponse => ({
  challengeId: randomUUID(),
  expiresAt: now + LOGIN_CODE_TTL_MS,
  resendAvailableAt: now + LOGIN_CODE_RESEND_COOLDOWN_MS,
});

/**
 * 发起一次码登录挑战。码在事务外生成（摘要与发信**必须**来自同一枚），
 * 事务内写摘要，事务后发信。账号不存在 / 未验证一律诱饵响应。
 */
export const requestLoginCode = async (input: {
  email: string;
  locale?: ServerLocale;
}): Promise<EmailLoginChallengeResponse> => {
  const email = normalizeEmail(input.email);
  const now = Date.now();

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, isVerified: true },
  });
  if (user === null || user.isVerified !== 1) return decoyResponse(now);

  const code = codeFor();
  const challengeId = randomUUID();
  const digest = loginCodeDigest(challengeId, code);

  const replaced = await prisma.$transaction(async (tx) => {
    const active = await tx.emailLoginChallenge.findFirst({
      where: { userId: user.id, consumedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, expiresAt: true, resendAvailableAt: true, resendCount: true },
    });
    if (active !== null) {
      if (active.expiresAt > BigInt(now)) {
        if (active.resendAvailableAt > BigInt(now)) return { kind: 'decoy' as const };
        if (active.resendCount >= LOGIN_CODE_MAX_RESENDS) {
          throw new LoginOtpError('login_code_rate_limited', 'Please wait before requesting another login code.', 60);
        }
      }
      const consumed = await tx.emailLoginChallenge.updateMany({
        where: { id: active.id, consumedAt: null },
        data: { consumedAt: BigInt(now) },
      });
      if (consumed.count !== 1) {
        throw new LoginOtpError('login_code_rate_limited', 'Please wait before requesting another login code.', 1);
      }
    }
    const created = await tx.emailLoginChallenge.create({
      data: {
        id: challengeId,
        email,
        userId: user.id,
        codeDigest: digest,
        expiresAt: BigInt(now + LOGIN_CODE_TTL_MS),
        lastSentAt: BigInt(now),
        resendAvailableAt: BigInt(now + LOGIN_CODE_RESEND_COOLDOWN_MS),
        resendCount:
          active === null || active.expiresAt <= BigInt(now) ? 0 : active.resendCount + 1,
        ...(input.locale === undefined ? {} : { locale: input.locale }),
      },
      select: { id: true, expiresAt: true, resendAvailableAt: true },
    });
    return { kind: 'challenge' as const, challenge: created };
  });
  if (replaced.kind === 'decoy') return decoyResponse(now);

  const delivered = await sendLoginCodeEmail(email, code, input.locale);
  return challengeResponse(replaced.challenge.id, replaced.challenge.expiresAt, replaced.challenge.resendAvailableAt, delivered);
};

export const resendLoginCode = async (
  challengeId: string,
): Promise<EmailLoginChallengeResponse> => {
  const now = Date.now();
  const challenge = await prisma.emailLoginChallenge.findUnique({
    where: { id: challengeId },
    select: {
      id: true,
      email: true,
      locale: true,
      expiresAt: true,
      resendAvailableAt: true,
      resendCount: true,
      consumedAt: true,
    },
  });
  if (
    challenge === null ||
    challenge.consumedAt !== null ||
    challenge.expiresAt <= BigInt(now) ||
    challenge.resendCount >= LOGIN_CODE_MAX_RESENDS
  ) {
    throw invalidChallenge();
  }
  if (challenge.resendAvailableAt > BigInt(now)) {
    throw new LoginOtpError(
      'login_code_rate_limited',
      'Please wait before requesting another login code.',
      Math.max(1, Math.ceil(Number(challenge.resendAvailableAt - BigInt(now)) / 1000)),
    );
  }

  const code = codeFor();
  const updated = await prisma.emailLoginChallenge.updateMany({
    where: {
      id: challenge.id,
      consumedAt: null,
      expiresAt: { gt: BigInt(now) },
      resendAvailableAt: { lte: BigInt(now) },
      resendCount: { lt: LOGIN_CODE_MAX_RESENDS },
    },
    data: {
      codeDigest: loginCodeDigest(challenge.id, code),
      lastSentAt: BigInt(now),
      resendAvailableAt: BigInt(now + LOGIN_CODE_RESEND_COOLDOWN_MS),
      resendCount: { increment: 1 },
    },
  });
  if (updated.count !== 1) {
    throw new LoginOtpError('login_code_rate_limited', 'Please wait before requesting another login code.', 1);
  }

  const delivered = await sendLoginCodeEmail(
    challenge.email,
    code,
    challenge.locale === 'en' ? 'en' : 'zh-CN',
  );
  return challengeResponse(challenge.id, challenge.expiresAt, BigInt(now + LOGIN_CODE_RESEND_COOLDOWN_MS), delivered);
};

/** 验证成功返回与邮箱口令登录同形的会话（`{ token, user }`）。 */
export const verifyLoginCode = async (input: {
  challengeId: string;
  code: string;
}, meta: SessionMeta = {}): Promise<{ token: string; user: { id: number; email: string; locale: string | null } }> => {
  const now = Date.now();
  const challenge = await prisma.emailLoginChallenge.findUnique({
    where: { id: input.challengeId },
    select: {
      id: true,
      userId: true,
      email: true,
      codeDigest: true,
      expiresAt: true,
      consumedAt: true,
      attemptCount: true,
    },
  });
  if (challenge === null || challenge.consumedAt !== null || challenge.expiresAt <= BigInt(now)) {
    throw invalidChallenge();
  }

  const validShape = /^\d{6}$/.test(input.code);
  const digestMatches = validShape && sameDigest(challenge.codeDigest, loginCodeDigest(challenge.id, input.code));
  if (!digestMatches) {
    await prisma.emailLoginChallenge.updateMany({
      where: {
        id: challenge.id,
        consumedAt: null,
        expiresAt: { gt: BigInt(now) },
        attemptCount: { lt: LOGIN_CODE_MAX_ATTEMPTS },
      },
      data: { attemptCount: { increment: 1 } },
    });
    throw invalidChallenge();
  }

  const activatedUserId = challenge.userId;
  const result = await prisma.$transaction(async (tx) => {
    const claim = await tx.emailLoginChallenge.updateMany({
      where: {
        id: challenge.id,
        codeDigest: challenge.codeDigest,
        consumedAt: null,
        expiresAt: { gt: BigInt(now) },
        attemptCount: { lt: LOGIN_CODE_MAX_ATTEMPTS },
      },
      data: { consumedAt: BigInt(now) },
    });
    if (claim.count !== 1) throw invalidChallenge();

    const user = await tx.user.findUnique({
      where: { id: activatedUserId },
      select: { id: true, email: true, locale: true, tokenVersion: true, isVerified: true },
    });
    if (user === null || user.isVerified !== 1) throw invalidChallenge();
    return {
      token: await issueSession(user, meta),
      user: { id: user.id, email: user.email, locale: user.locale },
    };
  });
  return result;
};
