/**
 * 邮箱 + 密码注册的邮箱验证码。
 *
 * 这条流程和旧的邮件链接注册并行存在，但不互相串联：验证码挑战自己持有
 * pendingPasswordHash，验证时只激活它绑定的用户。这样不会把一个未验证 User
 * 当前碰巧存在的 passwordHash 当成这次注册的密码，也不会用注册链接令牌列存低熵验证码。
 */
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  EMAIL_PASSWORD_REGISTRATION_CODE_LENGTH,
  EMAIL_PASSWORD_REGISTRATION_CODE_TTL_MS,
  EMAIL_PASSWORD_REGISTRATION_RESEND_COOLDOWN_MS,
} from '@heyta/shared-schema';
import { prisma } from '../db';
import { Logger } from '../logger';
import { getDefaultStorageQuotaBytes } from '../sync/services/storage-quota.service';
import { attachInviteOnRegister, settleReferralActivation } from '../activity/invite';
import { authCache } from '../auth-cache';
import { getJwtSecret, issueSession } from '../auth';
import { newJti, type SessionMeta } from '../account/access-sessions';
import { SESSION_MAX_AGE_MS } from '../central-auth/session-policy';
import { consentedLegalSetVersion } from '../legal-consent';
import { isConsentRequired, loadConfigFromEnv } from '../config';
import { sendEmailPasswordRegistrationCodeEmail } from '../email';
import { normalizeEmail } from '../account/email-normalize';
import type { ServerLocale } from '../copy.generated.js';
import { checkNewPassword } from './policy';
import { hashFor, PasswordAuthError, PASSWORD_INVALID_CREDENTIALS_MESSAGE } from './service';

export const REGISTRATION_CODE_MAX_ATTEMPTS = 5;
export const REGISTRATION_CODE_MAX_RESENDS = 5;
export const REGISTRATION_CODE_TTL_MS = EMAIL_PASSWORD_REGISTRATION_CODE_TTL_MS;
export const REGISTRATION_CODE_RESEND_COOLDOWN_MS =
  EMAIL_PASSWORD_REGISTRATION_RESEND_COOLDOWN_MS;

const REGISTRATION_CODE_PURPOSE = 'email-password-registration:v1';
const INVALID_CHALLENGE_MESSAGE = 'This registration code is invalid or has expired.';
const CODE_RATE_LIMITED_MESSAGE = 'Please wait before requesting another registration code.';
/**
 * 激活那笔事务的时间上限（Prisma 交互式事务默认 5 秒，见 `verifyRegistrationCode`
 * 里那段注释：2026-10-24 实测默认上限把"等行锁"误报成了"验证码不对"）。
 * 等锁/等连接不是用户填错 ⇒ 给足 20 秒，超了由调用方回 503 让客户端重试。
 */
export const REGISTRATION_TX_TIMEOUT_MS = 20_000;
export const REGISTRATION_TX_MAX_WAIT_MS = 10_000;

export type RegistrationOtpErrorCode =
  | 'invalid_registration_challenge'
  | 'registration_code_rate_limited';

export class RegistrationOtpError extends Error {
  constructor(
    readonly code: RegistrationOtpErrorCode,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'RegistrationOtpError';
  }
}

export interface RegistrationChallengeResponse {
  challengeId: string;
  expiresAt: number;
  resendAvailableAt: number;
  emailDelivered?: boolean;
}

export interface RequestRegistrationCodeInput {
  email: string;
  password: string;
  termsAcceptedAt?: number;
  inviteCode?: string;
  locale?: ServerLocale;
}

const codeFor = (): string =>
  randomInt(0, 1_000_000).toString().padStart(EMAIL_PASSWORD_REGISTRATION_CODE_LENGTH, '0');

/** HMAC 是低熵验证码的唯一存储形态；purpose 与 challengeId 一起防止跨用途/跨挑战重放。 */
export const registrationCodeDigest = (challengeId: string, code: string): string =>
  createHmac('sha256', getRegistrationCodeKey())
    .update(`${REGISTRATION_CODE_PURPOSE}:${challengeId}:${code}`, 'utf8')
    .digest('hex');

const getRegistrationCodeKey = (): Buffer =>
  createHmac('sha256', getJwtSecret())
    .update('heyta:email-password-registration-code-key:v1', 'utf8')
    .digest();

const sameDigest = (left: string, right: string): boolean => {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
};

const invalidChallenge = (): RegistrationOtpError =>
  new RegistrationOtpError('invalid_registration_challenge', INVALID_CHALLENGE_MESSAGE);

const decoyResponse = (now: number): RegistrationChallengeResponse => ({
  challengeId: randomUUID(),
  expiresAt: now + REGISTRATION_CODE_TTL_MS,
  resendAvailableAt: now + REGISTRATION_CODE_RESEND_COOLDOWN_MS,
});

const challengeResponse = (
  challengeId: string,
  expiresAt: bigint,
  resendAvailableAt: bigint,
  emailDelivered?: boolean,
): RegistrationChallengeResponse => ({
  challengeId,
  expiresAt: Number(expiresAt),
  resendAvailableAt: Number(resendAvailableAt),
  ...(emailDelivered === undefined ? {} : { emailDelivered }),
});

/**
 * 创建一个仅由本 challenge 绑定的待激活用户。已有用户（包括未验证用户）不进入写路径，
 * 这样请求别人邮箱不会改变旧注册流程或覆盖旧 passwordHash。
 */
export const requestRegistrationCode = async (
  input: RequestRegistrationCodeInput,
): Promise<RegistrationChallengeResponse> => {
  const policy = await checkNewPassword(input.password);
  if (!policy.ok) {
    throw new PasswordAuthError('password_policy_violation', 'That password does not meet the requirements.', undefined, policy.code);
  }

  const passwordHash = await hashFor(policy.normalized);
  const email = normalizeEmail(input.email);
  const now = Date.now();
  const expiresAt = BigInt(now + REGISTRATION_CODE_TTL_MS);
  const resendAvailableAt = BigInt(now + REGISTRATION_CODE_RESEND_COOLDOWN_MS);
  const challengeId = randomUUID();
  const code = codeFor();
  const codeDigest = registrationCodeDigest(challengeId, code);
  const config = loadConfigFromEnv();
  const acceptedAt = input.termsAcceptedAt === undefined ? undefined : BigInt(input.termsAcceptedAt);
  const recordedAcceptedAt = acceptedAt ?? (isConsentRequired(config) ? BigInt(now) : null);

  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true, isVerified: true, passwordHash: true },
  });

  let userId: number | undefined;
  let challenge: {
    id: string;
    expiresAt: bigint;
    resendAvailableAt: bigint;
  } | undefined;

  if (existingUser === undefined || existingUser === null) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            passwordHash: null,
            ...(input.locale === undefined ? {} : { locale: input.locale }),
            termsAcceptedAt: recordedAcceptedAt,
            termsDocumentVersion:
              recordedAcceptedAt === null ? null : consentedLegalSetVersion(),
            storageQuotaBytes: BigInt(getDefaultStorageQuotaBytes()),
          },
          select: { id: true },
        });
        const createdChallenge = await tx.emailPasswordRegistrationChallenge.create({
          data: {
            id: challengeId,
            email,
            userId: user.id,
            pendingPasswordHash: passwordHash,
            codeDigest,
            expiresAt,
            lastSentAt: BigInt(now),
            resendAvailableAt,
            ...(acceptedAt === undefined ? {} : { termsAcceptedAt: acceptedAt }),
            ...(input.inviteCode === undefined ? {} : { inviteCode: input.inviteCode }),
            ...(input.locale === undefined ? {} : { locale: input.locale }),
          },
          select: { id: true, expiresAt: true, resendAvailableAt: true },
        });
        return { userId: user.id, challenge: createdChallenge };
      });
      userId = created.userId;
      challenge = created.challenge;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return decoyResponse(now);
      }
      throw error;
    }
  } else {
    // A pending registration is an account-bound capability. Lock the user row before
    // inspecting/replacing its challenge: two requests must not both consume the same
    // active row and then create two live passwords/codes.
    const replaced = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ id: number; email: string; is_verified: number; password_hash: string | null }>
      >`SELECT id, email, is_verified, password_hash FROM users WHERE id = ${existingUser.id} FOR UPDATE`;
      const current = locked[0];
      if (
        current === undefined ||
        current.email !== email ||
        current.is_verified !== 0 ||
        current.password_hash !== null
      ) {
        return { kind: 'decoy' as const };
      }

      const active = await tx.emailPasswordRegistrationChallenge.findFirst({
        where: {
          userId: current.id,
          consumedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, expiresAt: true, resendAvailableAt: true, resendCount: true },
      });
      if (active !== null) {
        // The unique index intentionally covers every unconsumed row, including
        // expired challenges. Expiry is not immutable, so it cannot be part of a
        // PostgreSQL partial-index predicate. Retire an expired row before
        // inserting its replacement; otherwise the insert would fail with P2002.
        if (active.expiresAt > BigInt(now)) {
          if (active.resendAvailableAt > BigInt(now)) return { kind: 'decoy' as const };
          if (active.resendCount >= REGISTRATION_CODE_MAX_RESENDS) {
            throw new RegistrationOtpError('registration_code_rate_limited', CODE_RATE_LIMITED_MESSAGE, 60);
          }
        }
        const consumed = await tx.emailPasswordRegistrationChallenge.updateMany({
          where: { id: active.id, consumedAt: null },
          data: { consumedAt: BigInt(now) },
        });
        if (consumed.count !== 1) {
          throw new RegistrationOtpError('registration_code_rate_limited', CODE_RATE_LIMITED_MESSAGE, 1);
        }
      }

      const created = await tx.emailPasswordRegistrationChallenge.create({
        data: {
          id: challengeId,
          email,
          userId: current.id,
          pendingPasswordHash: passwordHash,
          codeDigest,
          expiresAt,
          lastSentAt: BigInt(now),
          resendAvailableAt,
          resendCount:
            active === null || active.expiresAt <= BigInt(now) ? 0 : active.resendCount + 1,
          ...(acceptedAt === undefined ? {} : { termsAcceptedAt: acceptedAt }),
          ...(input.inviteCode === undefined ? {} : { inviteCode: input.inviteCode }),
          ...(input.locale === undefined ? {} : { locale: input.locale }),
        },
        select: { id: true, expiresAt: true, resendAvailableAt: true },
      });
      return { kind: 'challenge' as const, challenge: created, userId: current.id };
    });
    if (replaced.kind === 'decoy') return decoyResponse(now);
    userId = replaced.userId;
    challenge = replaced.challenge;
  }

  if (userId === undefined || challenge === undefined) return decoyResponse(now);
  const delivered = await sendEmailPasswordRegistrationCodeEmail(
    email,
    code,
    input.locale,
  );
  return challengeResponse(challenge.id, challenge.expiresAt, challenge.resendAvailableAt, delivered);
};

export const resendRegistrationCode = async (
  challengeId: string,
): Promise<RegistrationChallengeResponse> => {
  const now = Date.now();
  const challenge = await prisma.emailPasswordRegistrationChallenge.findUnique({
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
    challenge.resendCount >= REGISTRATION_CODE_MAX_RESENDS
  ) {
    throw invalidChallenge();
  }
  if (challenge.resendAvailableAt > BigInt(now)) {
    throw new RegistrationOtpError(
      'registration_code_rate_limited',
      CODE_RATE_LIMITED_MESSAGE,
      Math.max(1, Math.ceil(Number(challenge.resendAvailableAt - BigInt(now)) / 1000)),
    );
  }

  const code = codeFor();
  const nextExpiresAt = challenge.expiresAt;
  const nextResendAvailableAt = BigInt(now + REGISTRATION_CODE_RESEND_COOLDOWN_MS);
  const updated = await prisma.emailPasswordRegistrationChallenge.updateMany({
    where: {
      id: challenge.id,
      consumedAt: null,
      expiresAt: { gt: BigInt(now) },
      resendAvailableAt: { lte: BigInt(now) },
      resendCount: { lt: REGISTRATION_CODE_MAX_RESENDS },
    },
    data: {
      codeDigest: registrationCodeDigest(challenge.id, code),
      lastSentAt: BigInt(now),
      resendAvailableAt: nextResendAvailableAt,
      resendCount: { increment: 1 },
    },
  });
  if (updated.count !== 1) throw new RegistrationOtpError('registration_code_rate_limited', CODE_RATE_LIMITED_MESSAGE, 1);

  const delivered = await sendEmailPasswordRegistrationCodeEmail(
    challenge.email,
    code,
    challenge.locale === 'en' ? 'en' : 'zh-CN',
  );
  return challengeResponse(challenge.id, nextExpiresAt, nextResendAvailableAt, delivered);
};

/** 验证成功返回现有 login/email-password 同形会话；失败路径统一为 invalid_registration_challenge。 */
export const verifyRegistrationCode = async (
  input: {
    challengeId: string;
    code: string;
  },
  meta: SessionMeta = {},
): Promise<{ token: string; user: { id: number; email: string; locale: string | null } }> => {
  const now = Date.now();
  const challenge = await prisma.emailPasswordRegistrationChallenge.findUnique({
    where: { id: input.challengeId },
    select: {
      id: true,
      userId: true,
      email: true,
      pendingPasswordHash: true,
      codeDigest: true,
      inviteCode: true,
      expiresAt: true,
      consumedAt: true,
      attemptCount: true,
    },
  });
  if (challenge === null || challenge.consumedAt !== null || challenge.expiresAt <= BigInt(now)) {
    throw invalidChallenge();
  }

  const validShape = /^\d{6}$/.test(input.code);
  const digestMatches = validShape && sameDigest(challenge.codeDigest, registrationCodeDigest(challenge.id, input.code));
  if (!digestMatches) {
    await prisma.emailPasswordRegistrationChallenge.updateMany({
      where: {
        id: challenge.id,
        consumedAt: null,
        expiresAt: { gt: BigInt(now) },
        attemptCount: { lt: REGISTRATION_CODE_MAX_ATTEMPTS },
      },
      data: { attemptCount: { increment: 1 } },
    });
    throw invalidChallenge();
  }

  try {
    if (challenge.userId === null) throw invalidChallenge();
    const activatedUserId = challenge.userId;
    // 🔴 分段计时（2026-10-24 线上报障"填对了码却等 5 秒"加的抓证手段）。
    //    平时一声不吭：只有整段超过 500ms 才打一条 warn，把每一段的耗时列出来。
    //    这样下一次再慢，我们看的是**哪一段慢**，而不是"好像是数据库"。
    const verifyStarted = Date.now();
    const marks: string[] = [];
    let markFrom = verifyStarted;
    const mark = (name: string): void => {
      const now2 = Date.now();
      marks.push(`${name}=${now2 - markFrom}ms`);
      markFrom = now2;
    };
    // 🔴 显式给时间上限（Prisma 交互式事务默认 5 秒）—— 但它**不是**原先那类故障的
    //    解法，只是兜底。真正的原因 2026-10-24 抓到了，见下面 `issueSession` 那段：
    //    这笔事务**自己把自己锁死**，所以耗时永远等于上限 —— 上限是 5 秒时表现为
    //    "填对了码却说码不对"，调到 20 秒只把同一件事换成了"等 20 秒后说服务端不可用"。
    //    上限保留：等锁/等连接不是用户填错，真超时由调用方回 503 + Retry-After。
    const result = await prisma.$transaction(async (tx) => {
      // Requests lock the account row before touching its challenge. Verify in
      // the same order so a request replacing a challenge cannot deadlock with
      // a verification claiming that challenge (challenge -> user would cycle
      // against request's user -> challenge order).
      const lockedUser = await tx.$queryRaw<
        Array<{ id: number; email: string; is_verified: number; password_hash: string | null }>
      >`SELECT id, email, is_verified, password_hash FROM users WHERE id = ${activatedUserId} FOR UPDATE`;
      mark('lock-user');
      const currentUser = lockedUser[0];
      if (
        currentUser === undefined ||
        currentUser.email !== challenge.email ||
        currentUser.is_verified !== 0 ||
        currentUser.password_hash !== null
      ) {
        throw invalidChallenge();
      }

      const claim = await tx.emailPasswordRegistrationChallenge.updateMany({
        where: {
          id: challenge.id,
          codeDigest: challenge.codeDigest,
          consumedAt: null,
          expiresAt: { gt: BigInt(now) },
          attemptCount: { lt: REGISTRATION_CODE_MAX_ATTEMPTS },
        },
        data: { consumedAt: BigInt(now) },
      });
      mark('claim-challenge');
      if (claim.count !== 1) throw invalidChallenge();

      const activated = await tx.user.updateMany({
        where: {
          id: activatedUserId,
          email: challenge.email,
          isVerified: 0,
          passwordHash: null,
        },
        data: {
          passwordHash: challenge.pendingPasswordHash,
          isVerified: 1,
          verificationToken: null,
          verificationTokenExpiresAt: null,
          verificationResendCount: 0,
        },
      });
      mark('activate-user');
      if (activated.count !== 1) throw invalidChallenge();

      // Do not consume invite capacity until the email proof succeeds. The challenge
      // keeps the submitted code opaque until this transaction can bind it atomically.
      if (challenge.inviteCode !== null) {
        await attachInviteOnRegister({
          inviteeUserId: activatedUserId,
          rawCode: challenge.inviteCode,
          now,
          db: tx,
        });
      }

      mark('invite');
      const referral = await settleReferralActivation(tx, activatedUserId, now);
      if (!referral.settled && referral.reason !== 'ALREADY_SETTLED') {
        // No referral is normal; the helper's result is intentionally ignored.
      }
      const user = await tx.user.findUnique({
        where: { id: activatedUserId },
        select: { id: true, email: true, locale: true, tokenVersion: true },
      });
      mark('referral');
      if (user === null) throw invalidChallenge();
      /**
       * 🔴 **会话必须用 `tx` 落库，不许让它自己再抓一条池连接。**
       *
       * 2026-10-24 线上现场取证（`pg_locks` + `pg_stat_activity`，同一笔请求的两条连接）：
       *
       * | pid | 在干什么 | 在等什么 |
       * |---|---|---|
       * | A（本事务）| `SELECT … FOR UPDATE` 之后 **idle in transaction** | 等 JS 下一步 |
       * | B（同一请求，另抓的连接）| `INSERT INTO access_sessions …` | 等 **A 的 transactionid** |
       *
       * 机制很平常：`access_sessions.user_id` 上有外键，插入一行要对 `users` 那一行取
       * `FOR KEY SHARE`，而本事务在上面那句 `FOR UPDATE` 里握着强锁（实测：A 持锁期间，
       * 另一个会话的 `SELECT … FOR KEY SHARE` 会一直等下去）。于是**一个请求的两条连接
       * 互相等**，而 Postgres 认不出这是死锁（A 在等客户端、不是在等锁），只能等 Prisma
       * 的事务上限把它掐掉 ⇒ 耗时永远等于上限、**成功率 0**。
       *
       * 附带后果也是真的：B 那条 `INSERT` 不在事务里，它**自己提交了** —— 那次失败注册
       * 在线上留下了两行孤儿会话，而外层事务全部回滚。
       *
       * ⇒ 传 `{ tx, jti, expiresAt }`：`issueSession` 用本事务的客户端落库，既不抢第二条
       * 连接，也不可能出现"事务回滚了、会话却留下了"。
       */
      const token = await issueSession(user, meta, {
        tx,
        jti: newJti(),
        expiresAt: Date.now() + SESSION_MAX_AGE_MS,
      });
      mark('issue-session');
      return {
        token,
        user: { id: user.id, email: user.email, locale: user.locale },
      };
    }, { timeout: REGISTRATION_TX_TIMEOUT_MS, maxWait: REGISTRATION_TX_MAX_WAIT_MS });
    const verifyTotal = Date.now() - verifyStarted;
    if (verifyTotal > 500) {
      Logger.warn(`Registration verify slow: total=${verifyTotal}ms ${marks.join(' ')} (userId=${activatedUserId})`);
    }
    authCache.invalidate(activatedUserId);
    return result;
  } catch (error) {
    if (error instanceof RegistrationOtpError) throw error;
    throw error;
  }
};

export const registrationOtpErrorResponse = (error: RegistrationOtpError): {
  status: number;
  retryAfterSeconds?: number;
  body: { code: RegistrationOtpErrorCode; message: string };
} => ({
  status: error.code === 'registration_code_rate_limited' ? 429 : 400,
  ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }),
  body: { code: error.code, message: error.message },
});
