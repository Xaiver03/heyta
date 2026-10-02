import { prisma } from './db';
import * as jwt from 'jsonwebtoken';
const { JsonWebTokenError, TokenExpiredError } = jwt;
import { Logger } from './logger';
import { randomBytes } from 'crypto';
import { sendLoginMagicLinkEmail, sendVerificationEmail } from './email';
import type { ServerLocale } from './copy.generated.js';
import { loadConfigFromEnv, isConsentRequired } from './config';
import { Prisma } from '@prisma/client';
import { authCache } from './auth-cache';
import { getDefaultStorageQuotaBytes } from './sync/services/storage-quota.service';
import { hashToken } from './auth-tokens';
import { consentedLegalSetVersion } from './legal-consent';

// Auth constants
const MIN_JWT_SECRET_LENGTH = 32;

// All JWT tokens live for 365 days regardless of authentication method.
// The auth method (passkey, magic link) only matters during login —
// once a JWT is issued, it represents a verified session.
export const JWT_EXPIRY = '365d';

export const VERIFICATION_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
export const MAX_VERIFICATION_RESEND_COUNT = 20;
const REGISTRATION_SUCCESS_MESSAGE =
  'Registration successful. Please check your email to verify your account.';
const LOGIN_MAGIC_LINK_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

export const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'JWT_SECRET environment variable is required. ' +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters for security`,
    );
  }
  return secret;
};

import { attachInviteOnRegister, settleReferralActivation } from './activity/invite';

const JWT_SECRET = getJwtSecret();

/**
 * 绑定邀请码，**永不抛出**。
 *
 * 🔴 注册路径必须对所有"这张码行不行"保持中性，而且**不能因为一个附带的
 * 福利功能而失败**：用户来注册账号，码是他顺手带的。让注册因为码的问题
 * 返回一个错误（哪怕措辞是"稍后再试"）都比他成功注册、只是没绑上要坏。
 *
 * 所以这里把异常全部吞掉并记日志。`attachInviteOnRegister` 自己也只对
 * "数据库真的坏了"抛异常 —— 业务性的拒绝是**返回值**，不是异常。
 */
const attachInviteSafe = async (
  inviteeUserId: number,
  rawCode: string | undefined,
): Promise<void> => {
  if (rawCode === undefined || rawCode.trim() === '') return;
  try {
    await attachInviteOnRegister({ inviteeUserId, rawCode, now: Date.now() });
  } catch (err) {
    Logger.error(
      `Invite attach failed (invitee=${inviteeUserId}): ${
        err instanceof Error ? err.message : 'unknown'
      }`,
    );
  }
};

/**
 * 结算邀请，**永不抛出**。
 *
 * ⚠️ 与 `attachInviteSafe` 不同，**验证路径必须让异常冒出去**：
 * 结算跑在验证事务里，抛出去会让事务回滚 → 令牌保留 → 用户再点一次邮件
 * 就能重试（见 `activity/invite.ts` 头注释的三条理由）。吞掉异常会造出
 * "已验证但奖励永远丢了"的状态，那是用户既看不见也无法自救的。
 *
 * 这个包装只做一件事：把"没有待结算的邀请"这种**正常情况**变成静默返回。
 */
const settleReferralSafe = async (
  db: Parameters<typeof settleReferralActivation>[0],
  inviteeUserId: number,
): Promise<void> => {
  const outcome = await settleReferralActivation(db, inviteeUserId, Date.now());
  if (!outcome.settled && outcome.reason === 'ALREADY_SETTLED') {
    // 重复验证（令牌重放 / 管理脚本）会走到这里。不是错误。
    Logger.info(`Referral already settled for invitee=${inviteeUserId}`);
  }
};

export const verifyEmail = async (token: string): Promise<boolean> => {
  const pendingPasskey = await prisma.pendingPasskeyRegistration.findUnique({
    where: { verificationToken: hashToken(token) },
  });

  if (pendingPasskey) {
    if (pendingPasskey.verificationTokenExpiresAt < BigInt(Date.now())) {
      throw new Error('Verification token has expired');
    }

    const activated = await prisma.$transaction(async (tx) => {
      const claim = await tx.user.updateMany({
        where: { id: pendingPasskey.userId, isVerified: 0 },
        data: {
          isVerified: 1,
          verificationToken: null,
          verificationTokenExpiresAt: null,
          verificationResendCount: 0,
        },
      });
      if (claim.count !== 1) return false;

      // Only the credential carried by this exact email link is trusted. Other
      // attempts for the same address may have been initiated by someone else.
      await tx.passkey.deleteMany({ where: { userId: pendingPasskey.userId } });
      await tx.passkey.create({
        data: {
          userId: pendingPasskey.userId,
          credentialId: pendingPasskey.credentialId,
          publicKey: pendingPasskey.publicKey,
          counter: pendingPasskey.counter,
          transports: pendingPasskey.transports,
        },
      });
      await tx.pendingPasskeyRegistration.deleteMany({
        where: { userId: pendingPasskey.userId },
      });

      // 🔴 邀请结算与验证**同一个事务**（见 activity/invite.ts 头注释）：
      // 要么"账号已验证 + 邀请人拿到奖励 + 通知写好了"三者同时成立，
      // 要么全都不成立、令牌保留、用户重试。
      await settleReferralSafe(tx, pendingPasskey.userId);

      return true;
    });

    if (!activated) throw new Error('Invalid verification token');
    authCache.invalidate(pendingPasskey.userId);
    Logger.info(`User verified with passkey (ID: ${pendingPasskey.userId})`);
    return true;
  }

  const user = await prisma.user.findFirst({
    where: { verificationToken: hashToken(token) },
  });

  if (!user) {
    throw new Error('Invalid verification token');
  }

  if (
    user.verificationTokenExpiresAt &&
    user.verificationTokenExpiresAt < BigInt(Date.now())
  ) {
    throw new Error('Verification token has expired');
  }

  const verified = await prisma.$transaction(async (tx) => {
    const claim = await tx.user.updateMany({
      where: { id: user.id, isVerified: 0, verificationToken: hashToken(token) },
      data: {
        isVerified: 1,
        verificationToken: null,
        verificationTokenExpiresAt: null,
        verificationResendCount: 0,
      },
    });
    if (claim.count !== 1) return false;

    // Reaching the user-token path means this is a magic-link registration:
    // passkey registration tokens live only in pendingPasskeyRegistration.
    // Email ownership does not prove ownership of a separately submitted key.
    await tx.passkey.deleteMany({ where: { userId: user.id } });
    await tx.pendingPasskeyRegistration.deleteMany({ where: { userId: user.id } });

    // 🔴 邀请结算与验证**同一个事务**（见 activity/invite.ts 头注释）。
    await settleReferralSafe(tx, user.id);

    return true;
  });
  if (!verified) throw new Error('Invalid verification token');

  // AUTH_CACHE_INVALIDATION: drop any negative (isVerified:false) entry so the
  // now-verified user isn't denied for up to the cache TTL, and so the cache
  // stays correct if a verified -> unverified path is ever added.
  authCache.invalidate(user.id);

  Logger.info(`User verified (ID: ${user.id})`);
  return true;
};

/**
 * Revoke all existing tokens for a user by incrementing their token version.
 * Call this when the user explicitly logs out all devices.
 */
export const revokeAllTokens = async (userId: number): Promise<void> => {
  // AUTH_CACHE_INVALIDATION: keep adjacent to tokenVersion writes.
  authCache.invalidate(userId);
  await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });
  // AUTH_CACHE_INVALIDATION: keep adjacent to tokenVersion writes.
  authCache.invalidate(userId);
  Logger.info(`All tokens revoked for user ${userId}`);
};

/**
 * Replace the current JWT with a new one.
 * This invalidates all existing tokens (including the current one) and returns a fresh token.
 */
export const replaceToken = async (
  userId: number,
  email: string,
): Promise<{ token: string; user: { id: number; email: string } }> => {
  // AUTH_CACHE_INVALIDATION: keep adjacent to tokenVersion writes.
  authCache.invalidate(userId);
  // Use transaction to ensure atomicity of version increment and read
  const newTokenVersion = await prisma.$transaction(async (tx) => {
    // Increment token version to invalidate all existing tokens
    const user = await tx.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
      select: { tokenVersion: true },
    });
    return user.tokenVersion;
  });
  // AUTH_CACHE_INVALIDATION: keep adjacent to tokenVersion writes.
  authCache.invalidate(userId);

  const token = jwt.sign({ userId, email, tokenVersion: newTokenVersion }, JWT_SECRET, {
    expiresIn: JWT_EXPIRY,
  });

  Logger.info(`Token replaced for user ${userId} (new version: ${newTokenVersion})`);

  return { token, user: { id: userId, email } };
};

export type TokenVerificationResult =
  | { valid: true; userId: number; email: string }
  | { valid: false; reason: string };

export const verifyToken = async (token: string): Promise<TokenVerificationResult> => {
  try {
    const payload = await new Promise<{
      userId: number;
      email: string;
      tokenVersion?: number;
    }>((resolve, reject) => {
      jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return reject(err);
        resolve(decoded as { userId: number; email: string; tokenVersion?: number });
      });
    });

    const tokenVersion = payload.tokenVersion ?? 0;
    const cachedUser = authCache.get(payload.userId);
    if (cachedUser && cachedUser.isVerified && cachedUser.tokenVersion === tokenVersion) {
      return { valid: true, userId: payload.userId, email: payload.email };
    }
    const cacheVersionBeforeRead = authCache.getInvalidationVersion(payload.userId);

    // Verify user exists, is verified, and token version matches
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, tokenVersion: true, isVerified: true },
    });

    if (!user) {
      Logger.warn(`Token verification failed: User ${payload.userId} not found in DB`);
      return { valid: false, reason: 'Account unavailable' };
    }

    if (!user.isVerified) {
      Logger.warn(`Token verification failed: User ${payload.userId} is not verified`);
      authCache.setIfCurrent(
        payload.userId,
        user.tokenVersion ?? 0,
        false,
        cacheVersionBeforeRead,
      );
      return { valid: false, reason: 'Account unavailable' };
    }

    // Check token version - if it doesn't match, the token has been revoked
    // (e.g., user used "Revoke & Replace Token"). Tokens without version are treated as version 0.
    const currentVersion = user.tokenVersion ?? 0;
    if (tokenVersion !== currentVersion) {
      Logger.warn(
        `Token verification failed: Token version mismatch for user ${payload.userId} ` +
          `(token: ${tokenVersion}, current: ${currentVersion})`,
      );
      return {
        valid: false,
        reason: 'Token was revoked. Please log in again to get a new token.',
      };
    }

    authCache.setIfCurrent(payload.userId, currentVersion, true, cacheVersionBeforeRead);
    return { valid: true, userId: payload.userId, email: payload.email };
  } catch (err) {
    if (err instanceof TokenExpiredError) {
      return {
        valid: false,
        reason: 'Token expired. Please log in again to get a new token.',
      };
    }
    // Only treat actual JWT errors as "Invalid token" (NotBeforeError extends JsonWebTokenError).
    // Database errors must propagate as 500s, not masquerade as auth failures.
    if (err instanceof JsonWebTokenError) {
      return { valid: false, reason: 'Invalid token' };
    }
    const errMsg =
      err instanceof Error ? `[${err.name}] ${err.message}` : 'non-Error value';
    Logger.error(`Token verification failed due to unexpected error: ${errMsg}`);
    throw err;
  }
};

/**
 * 🔴 **签发一枚一次性登录令牌**（32 字节随机十六进制；库里只存 SHA-256，15 分钟过期）。
 *
 * 生产唯一调用方是 `requestLoginMagicLink`（随后发邮件）；TEST_MODE 的
 * `/api/test/mint-login-link` 也走**这同一个函数** —— E2E 要贴进
 * 「粘贴邮件里的链接或令牌」的东西，必须与邮件里那枚**同一个形态**。
 * 这里曾经抽不出去：test 端点只能拿 JWT 访问令牌，而应用贴令牌页吃的是
 * 这种一次性令牌 —— 形态不匹配，主路径 12 轮从未通过（BLOCKED B10）。
 *
 * 返回 `null` = 没抢到槽位（另一并发请求刚轮换出一枚未过期的）。
 */
export const mintLoginMagicLinkToken = async (
  user: { id: number },
  now = Date.now(),
): Promise<string | null> => {
  const loginToken = randomBytes(32).toString('hex');
  const expiresAt = BigInt(now + LOGIN_MAGIC_LINK_EXPIRY_MS);

  // Claim the expired/empty token slot atomically. Concurrent requests for the
  // same account must not each rotate the token and send another email.
  const claim = await prisma.user.updateMany({
    where: {
      id: user.id,
      OR: [
        { loginToken: null },
        { loginTokenExpiresAt: null },
        { loginTokenExpiresAt: { lte: BigInt(now) } },
      ],
    },
    data: {
      loginToken: hashToken(loginToken),
      loginTokenExpiresAt: expiresAt,
    },
  });
  return claim.count === 0 ? null : loginToken;
};

/**
 * Request a magic link for passwordless login.
 * Generates a login token, stores it in the database, and sends an email.
 * Always returns success message to prevent email enumeration.
 */
export const requestLoginMagicLink = async (
  email: string,
  /**
   * 收件人的语言（**可选**，缺省时邮件按默认语言 zh-CN 渲染）。
   * 由路由层从请求里取（`?lang=` / `Accept-Language`），见 `design-html.ts` 的 `resolveLocale`。
   */
  locale?: ServerLocale,
): Promise<{ message: string }> => {
  const successMessage = {
    message: 'If an account with that email exists, a login link has been sent.',
  };

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (!user) {
    Logger.debug(`Magic link requested for non-existent email`);
    return successMessage;
  }

  if (user.isVerified === 0) {
    Logger.debug(`Magic link requested for unverified account (ID: ${user.id})`);
    return successMessage;
  }

  const now = Date.now();
  if (
    user.loginToken &&
    user.loginTokenExpiresAt !== null &&
    user.loginTokenExpiresAt > BigInt(now)
  ) {
    return successMessage;
  }

  const loginToken = await mintLoginMagicLinkToken(user, now);
  if (loginToken === null) return successMessage;

  const emailSent = await sendLoginMagicLinkEmail(email, loginToken, locale);
  if (!emailSent) {
    await prisma.user.updateMany({
      where: { id: user.id, loginToken: hashToken(loginToken) },
      data: {
        loginToken: null,
        loginTokenExpiresAt: null,
      },
    });
    return successMessage;
  }

  Logger.info(`Magic link login requested (ID: ${user.id})`);
  return successMessage;
};

/**
 * Verify a magic link login token and return a JWT.
 */
/**
 * **签发会话** —— 全仓**只有这一处**把 `{userId,email,tokenVersion}` 签成 JWT。
 *
 * 🔴 抽出来的理由：邮箱链接这条路现在有**三种令牌**都能换到会话
 * （登录令牌 / 邮箱注册令牌 / 将来手机号的），若每处各签一遍，
 * 迟早出现"某种令牌签出来的 JWT 少了 `tokenVersion`"这种极难查的破口 ——
 * 而 `tokenVersion` 正是**改密/登出全部设备**赖以生效的那一格。
 */
export const issueSession = (user: {
  id: number;
  email: string;
  tokenVersion?: number | null;
}): string =>
  jwt.sign(
    { userId: user.id, email: user.email, tokenVersion: user.tokenVersion ?? 0 },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY },
  );

export const verifyLoginMagicLink = async (
  token: string,
): Promise<{ token: string; user: { id: number; email: string; locale: string | null } }> => {
  // 邮件里那句令牌**原样**传进来，库里那一列是它的 SHA-256 ⇒ 每次按哈希查。
  const tokenHash = hashToken(token);
  const user = await prisma.user.findFirst({
    where: { loginToken: tokenHash },
  });

  if (!user) {
    throw new Error('Invalid or expired login link');
  }

  const now = BigInt(Date.now());
  if (user.loginTokenExpiresAt && user.loginTokenExpiresAt < now) {
    await prisma.user.updateMany({
      where: { id: user.id, loginToken: tokenHash },
      data: {
        loginToken: null,
        loginTokenExpiresAt: null,
      },
    });
    throw new Error('Invalid or expired login link');
  }

  // Consume the exact token atomically. A concurrent redemption or renewal
  // must not issue a second JWT or clear a replacement token.
  const consume = await prisma.user.updateMany({
    where: {
      id: user.id,
      loginToken: tokenHash,
      OR: [{ loginTokenExpiresAt: null }, { loginTokenExpiresAt: { gte: now } }],
    },
    data: {
      loginToken: null,
      loginTokenExpiresAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });
  if (consume.count !== 1) {
    throw new Error('Invalid or expired login link');
  }

  const jwtToken = issueSession(user);

  Logger.info(`User logged in via magic link (ID: ${user.id})`);

  return { token: jwtToken, user: { id: user.id, email: user.email, locale: user.locale } };
};

/** 邮箱链接换会话的结果。**判别式**：页面据此决定"写会话并跳应用"还是"只提示已确认"。 */
export type EmailLinkVerifyResult =
  | {
      kind: 'session';
      token: string;
      /** `locale` 是账号语言（可空）—— 客户端在本机无显式选择时采纳它（解析链第 2 层）。 */
      user: { id: number; email: string; locale: string | null };
    }
  | { kind: 'verified-only'; user: { id: number; email: string; locale: string | null } };

/**
 * **邮箱链接的唯一校验入口**：邮件里那个 `token` 换会话（ADR-0039 §2.1）。
 *
 * 按**同一份实现**处理三类令牌：
 *
 *  1. `User.loginToken`（登录那封）→ 委托 `verifyLoginMagicLink`；
 *  2. `User.verificationToken`（**邮箱注册**那封）→ 委托既有 `verifyEmail` 消费令牌，
 *     然后**签发会话** ⇒ 注册也是"一次点击就进去"（ADR-0039 §2.2，本 ADR 的核心改动）；
 *  3. `PendingPasskeyRegistration.verificationToken`（通行密钥注册那封）→ 同样委托
 *     `verifyEmail`（它负责激活那把钥匙），但**不签发会话**：那条路的产品语义是
 *     "验证完去用你的通行密钥"，本轮不改它。
 *
 * ⚠️ 判定顺序刻意：先试登录令牌（最常见），再分流两种验证令牌。
 * ⚠️ 令牌的**消费**仍然只在 `verifyEmail` / `verifyLoginMagicLink` 里发生 ——
 *    这里不写第二份消费逻辑，避免"两处各扣一次"的经典竞态。
 */
export const verifyEmailLink = async (token: string): Promise<EmailLinkVerifyResult> => {
  const viaLogin = await verifyLoginMagicLink(token).catch(() => null);
  if (viaLogin) return { kind: 'session', ...viaLogin };

  const pendingPasskey = await prisma.pendingPasskeyRegistration.findUnique({
    where: { verificationToken: hashToken(token) },
    select: { userId: true },
  });
  if (pendingPasskey) {
    await verifyEmail(token);
    const user = await prisma.user.findUnique({
      where: { id: pendingPasskey.userId },
      select: { id: true, email: true, locale: true },
    });
    return {
      kind: 'verified-only',
      user: user ?? { id: pendingPasskey.userId, email: '', locale: null },
    };
  }

  const user = await prisma.user.findFirst({
    where: { verificationToken: hashToken(token) },
    select: { id: true, email: true, tokenVersion: true, locale: true },
  });
  if (!user) throw new Error('Invalid or expired link');

  await verifyEmail(token);
  Logger.info(`User registered and signed in via email link (ID: ${user.id})`);
  return {
    kind: 'session',
    token: issueSession(user),
    user: { id: user.id, email: user.email, locale: user.locale },
  };
};

/**
 * Register a new user via magic link (email-only, no passkey required).
 * Sends a verification email. User can then log in via magic link after verifying.
 */
export const registerWithMagicLink = async (
  email: string,
  termsAcceptedAt?: number,
  /**
   * 邀请码（原样，未归一化）。见 `activity/invite.ts`：
   * 这里**只是登记**一条待兑现的邀请，发奖要等邮箱验证。
   */
  inviteCode?: string,
  /** 收件人的语言。**可选** —— 见 `requestLoginMagicLink` 上的同一条注释。 */
  locale?: ServerLocale,
  /**
   * 口令哈希（PHC 串）。**可选** —— 只有 `password/service.ts` 的邮箱+口令注册会带。
   *
   * 🔴 三条语义，每条都有理由：
   * 1. **给了就覆盖**：与验证令牌同一条规则 —— "最后一次注册定义这个待激活账号"。
   *    否则会出现"别人替你的邮箱注册过一次，你的链接却指向他的口令"。
   * 2. **没给绝不清空**：`/register/magic-link` 的**重发验证邮件**走的是同一个函数，
   *    它不该顺手把用户设过的口令抹掉（那等于一句"点重发就丢掉口令"）。
   * 3. **对已验证账号不可达**：上面 `isVerified === 1` 已经 return，所以这条参数
   *    在任何路径上都**覆盖不了一个活账号的口令**。口令属于验证前的登记动作。
   */
  passwordHash?: string,
): Promise<{ message: string }> => {
  const normalizedEmail = email.toLowerCase();

  // Check if email already exists and is verified
  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (existingUser?.isVerified === 1) {
    return { message: REGISTRATION_SUCCESS_MESSAGE };
  }

  const verificationToken = randomBytes(32).toString('hex');
  const tokenExpiresAt = BigInt(Date.now() + VERIFICATION_TOKEN_EXPIRY_MS);
  const acceptedAt = termsAcceptedAt !== undefined ? BigInt(termsAcceptedAt) : undefined;

  try {
    // In TEST_MODE with autoVerifyUsers, skip email and auto-verify
    const config = loadConfigFromEnv();

    // 这一行账号的 id。两条分支（重发令牌 / 新建）都会给它赋值，
    // 因为邀请码绑定需要一个明确的"被邀请人"，而它只在这两处拿得到。
    let registeredUserId: number;

    if (existingUser) {
      if (existingUser.verificationResendCount >= MAX_VERIFICATION_RESEND_COUNT) {
        Logger.warn(`Verification resend cap reached (ID: ${existingUser.id})`);
        return { message: REGISTRATION_SUCCESS_MESSAGE };
      }

      if (!config.testMode?.autoVerifyUsers) {
        // Send email BEFORE updating DB to avoid invalidating the old token on failure
        const emailSent = await sendVerificationEmail(normalizedEmail, verificationToken, locale);
        if (!emailSent) {
          return { message: REGISTRATION_SUCCESS_MESSAGE };
        }
      }

      // Update the same still-unverified row that was checked above. If another
      // request verified or removed it while the email was in flight, the link
      // is simply left inactive and the response remains neutral.
      const updated = await prisma.user.updateMany({
        where: {
          id: existingUser.id,
          isVerified: 0,
          verificationResendCount: { lt: MAX_VERIFICATION_RESEND_COUNT },
        },
        data: {
          verificationToken: hashToken(verificationToken),
          verificationTokenExpiresAt: tokenExpiresAt,
          verificationResendCount: { increment: 1 },
          ...(acceptedAt !== undefined && {
            termsAcceptedAt: acceptedAt,
            // 写了同意时刻就必须一起写版本，否则这一行又是一个"有时间、证明不了哪一版"的记录。
            // 值可能是 null（这台实例发布的不是 heyta 那套文本），判法见 `legal-consent.ts`；
            // "最后一次注册定义这个待激活账号"这条既有规则同样适用于版本。
            termsDocumentVersion: consentedLegalSetVersion(),
          }),
          // 见参数上的注释 2：undefined = 调用方没提口令这件事，**不是**"把口令清掉"。
          ...(passwordHash !== undefined && { passwordHash }),
        },
      });
      if (updated.count !== 1) return { message: REGISTRATION_SUCCESS_MESSAGE };

      registeredUserId = existingUser.id;

      Logger.info(
        `Updated verification token for unverified user (ID: ${existingUser.id})`,
      );
    } else {
      // Create new user (no passkey; a password only when the caller supplied one)
      // Never invent an acceptance — see the same guard in passkey.ts. An instance
      // with no legal pages has nothing to accept, and the column is nullable.
      const recordedAcceptedAt =
        acceptedAt ?? (isConsentRequired(config) ? BigInt(Date.now()) : null);
      const createdUser = await prisma.user.create({
        data: {
          email: normalizedEmail,
          passwordHash: passwordHash ?? null,
          // 注册语言 = 账号语言的起点（之后登录态改语言会更新它，见 /account/locale）。
          ...(locale !== undefined ? { locale } : {}),
          verificationToken: hashToken(verificationToken),
          verificationTokenExpiresAt: tokenExpiresAt,
          termsAcceptedAt: recordedAcceptedAt,
          // 同意时刻一旦落下，版本就必须跟着判一次 —— 有时间戳却没有版本，
          // 就是一条对外文本承诺过、库里却答不出"哪一版"的记录。值可以是 null，
          // 含义与写法见 `legal-consent.ts`。
          termsDocumentVersion:
            recordedAcceptedAt === null ? null : consentedLegalSetVersion(),
          // Set explicitly rather than leaning on the column default, so that
          // SUPERSYNC_DEFAULT_STORAGE_QUOTA_BYTES actually reaches new accounts.
          storageQuotaBytes: BigInt(getDefaultStorageQuotaBytes()),
        },
      });

      Logger.info(`Created new magic-link user`);

      registeredUserId = createdUser.id;

      if (!config.testMode?.autoVerifyUsers) {
        // Keep the unverified row on delivery failure. Deleting it can race a
        // concurrent registration that has already started using the same row.
        const emailSent = await sendVerificationEmail(normalizedEmail, verificationToken, locale);
        if (!emailSent) {
          return { message: REGISTRATION_SUCCESS_MESSAGE };
        }
      }
    }

    // 邀请登记：**先登记、后兑现**（发奖要等邮箱验证，见 activity/invite.ts）。
    // 刻意放在两条分支之外：重发令牌的路径也该把码绑上。
    await attachInviteSafe(registeredUserId, inviteCode);

    if (config.testMode?.autoVerifyUsers) {
      await prisma.user.update({
        where: { email: normalizedEmail },
        data: {
          isVerified: 1,
          verificationToken: null,
          verificationTokenExpiresAt: null,
        },
      });
      // 🔴 TEST_MODE 也必须结算邀请。少了这一行，所有自动化验收（e2e / verify:*）
      // 都会对着一个"奖励永远不会发"的账号跑绿 —— 而那正是最需要被验的那条路径。
      await settleReferralSafe(prisma, registeredUserId);
      Logger.info(`[TEST_MODE] Auto-verified magic-link user`);
      return {
        message: 'Registration successful. Your account has been automatically verified.',
      };
    }

    Logger.info(`Magic-link registration initiated`);
    return { message: REGISTRATION_SUCCESS_MESSAGE };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { message: REGISTRATION_SUCCESS_MESSAGE };
    }
    throw err;
  }
};
